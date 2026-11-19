/**
 * Host HTTP surface for the management page and the client plugin.
 *
 * Every route is registered through `ctx.connection.fetch`, the harness's
 * authenticated exact-route registry below `/api`. That means the shared
 * browser-token authentication, Host/Origin fence, and owner-Peer check run
 * before any handler here. A composition without `client-connection` (the
 * headless profile) simply gets no HTTP surface; notifications still work.
 *
 * @module dsh-bark-push/http
 */

import { normalizeDeviceKeys, publicConfig, writableConfigPatch } from './config.js';
import { channelTypeSummaries, providerFor } from './channels.js';
import { renderUiPage } from './ui.js';

/** Exact route paths, all below `/api`. */
export const ROUTES = Object.freeze({
  ui: '/api/bark-push/ui',
  state: '/api/bark-push/state',
  config: '/api/bark-push/config',
  mute: '/api/bark-push/mute',
  toggle: '/api/bark-push/toggle',
  test: '/api/bark-push/test',
  testChannel: '/api/bark-push/test-channel',
  browserEvents: '/api/bark-push/browser-events',
});

/** Maximum accepted JSON request body. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * JSON response with no-store and the browser's no-sniff protection.
 * @param {unknown} value - response body.
 * @param {number} [status] - HTTP status.
 * @returns {Response} response.
 */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * Read and bound a JSON request body.
 * @param {Request} request - Fetch request.
 * @returns {Promise<Record<string, unknown>>} parsed object body.
 * @throws {Error} when the body is too large or not a JSON object.
 */
async function readJson(request) {
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new Error('请求体过大');
  const parsed = text.length === 0 ? {} : JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体必须是 JSON 对象');
  return parsed;
}

/**
 * Enforce the management page's same-origin action header on writes. The
 * browser cannot send a custom header cross-origin without a CORS preflight,
 * which this route never answers, so this is a cheap second fence behind the
 * harness's own Origin check.
 * @param {Request} request - Fetch request.
 * @returns {boolean} whether the write is allowed.
 */
function writeAllowed(request) {
  if (request.headers.get('x-dsh-bark-action') !== '1') return false;
  const type = request.headers.get('content-type') ?? '';
  return type.includes('application/json');
}

/**
 * Validate one mute target.
 * @param {unknown} kind - `workspace` or `session`.
 * @param {unknown} id - target id.
 * @returns {{ kind: 'workspace'|'session', id: string } | null} normalized target.
 */
function muteTarget(kind, id) {
  if (kind !== 'workspace' && kind !== 'session') return null;
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  return { kind, id: trimmed };
}

/**
 * Normalize one optional mute channel. Unknown values are rejected rather than
 * silently writing to the wrong mute set.
 * @param {unknown} value - raw channel.
 * @returns {'push'|'browser'|null} normalized channel.
 */
function muteChannel(value) {
  if (value === undefined || value === null) return 'push';
  return value === 'push' || value === 'browser' ? value : null;
}

/**
 * Read one optional Cordis service without an inject requirement.
 * @param {object} ctx - host context.
 * @param {string} key - service key.
 * @returns {any} service or undefined.
 */
function serviceOf(ctx, key) {
  try {
    if (typeof ctx?.get === 'function') {
      const value = ctx.get(key);
      if (value !== undefined && value !== null) return value;
    }
    return ctx?.[key];
  } catch {
    return undefined;
  }
}

/**
 * Record a best-effort catalog read failure. The management page must still
 * render with whatever source is available.
 * @param {object} ctx - host context.
 * @param {string} message - diagnostic line.
 * @returns {void}
 */
function warnCatalog(ctx, message) {
  try {
    ctx?.logger?.warn?.(message);
  } catch {
    // Diagnostics never break the catalog.
  }
}

/**
 * Normalize one Session summary from the Host's Session controller or the raw
 * Session query corpus into the small row shape this page consumes.
 * @param {unknown} item - summary-like object.
 * @param {object} [fallbackHeader] - explicit header when the item is a Session.
 * @returns {object|null} normalized row, or null without an id.
 */
function normalizeSessionRow(item, fallbackHeader) {
  if (item === null || typeof item !== 'object') return null;
  const header = fallbackHeader ?? (item.header !== null && typeof item.header === 'object' ? item.header : {});
  const id = typeof item.sessionId === 'string'
    ? item.sessionId
    : typeof item.id === 'string'
      ? item.id
      : typeof header.id === 'string'
        ? header.id
        : '';
  if (id.length === 0) return null;
  const projections = item.projections !== null && typeof item.projections === 'object' ? item.projections : undefined;
  const values = projections && projections.values !== null && typeof projections.values === 'object' ? projections.values : undefined;
  const projectedTitle = typeof values?.title === 'string' ? values.title : '';
  const directTitle = typeof item.title === 'string' ? item.title : '';
  const updatedAt = Number.isFinite(item.updatedAt)
    ? item.updatedAt
    : Number.isFinite(header.createdAt)
      ? header.createdAt
      : 0;
  return {
    id,
    title: projectedTitle || directTitle,
    updatedAt,
    blank: item.blank === true,
    origin: typeof item.origin === 'string' ? item.origin : typeof header.origin === 'string' ? header.origin : null,
    cwd: typeof item.cwd === 'string' ? item.cwd : typeof header.cwd === 'string' ? header.cwd : '',
    running: item.running === true,
    agentAvailable: item.agentAvailable !== false,
  };
}

/**
 * Read Session summaries through the low-level query service and its durable
 * projection cache. This is the fallback when the Web Session controller is
 * absent; it mirrors the fields `ApiSessionList` builds for the sidebar.
 * @param {object} ctx - host context.
 * @param {AbortSignal} [signal] - request cancellation.
 * @returns {Promise<Array<object>|null>} normalized rows, or null when unavailable.
 */
async function listViaSessionQuery(ctx, signal) {
  const query = serviceOf(ctx, 'sessionQuery');
  if (typeof query?.listSessions !== 'function') return null;
  let records;
  try {
    records = await query.listSessions(signal);
  } catch (error) {
    warnCatalog(ctx, `bark-push: 会话查询失败：${error?.message ?? String(error)}`);
    return null;
  }
  if (!Array.isArray(records)) return null;
  const cache = serviceOf(ctx, 'sessionProjectionCache');
  const sessionsService = serviceOf(ctx, 'sessions');
  const titles = serviceOf(ctx, 'sessionTitle');
  const rows = [];
  for (const record of records) {
    const header = record?.header !== null && typeof record?.header === 'object' ? record.header : {};
    let snapshot;
    try {
      snapshot = cache?.cachedSnapshot?.(header);
    } catch {
      snapshot = undefined;
    }
    let title = typeof snapshot?.values?.title === 'string' ? snapshot.values.title : '';
    const live = typeof sessionsService?.get === 'function' ? sessionsService.get(header.id) : undefined;
    if (title.length === 0 && live !== undefined) {
      try {
        title = titles?.get?.(live)?.title ?? '';
      } catch {
        title = '';
      }
    }
    const row = normalizeSessionRow({
      sessionId: header.id,
      title,
      updatedAt: header.createdAt,
      blank: snapshot?.values?.sessionListMetadata?.blank === true,
      origin: header.origin,
      cwd: header.cwd,
      running: false,
      agentAvailable: live !== undefined,
      projections: snapshot === undefined ? undefined : { values: snapshot.values },
    });
    if (row !== null) rows.push(row);
  }
  return rows;
}

/**
 * Last-resort live Session enumeration. It cannot see cold sessions, but it
 * still applies the sidebar's subagent/blank filters in buildCatalog.
 * @param {object} ctx - host context.
 * @returns {Array<object>} normalized rows.
 */
function listLiveSessions(ctx) {
  const sessionsService = serviceOf(ctx, 'sessions');
  const live = typeof sessionsService?.list === 'function' ? sessionsService.list() : [];
  const titles = serviceOf(ctx, 'sessionTitle');
  const rows = [];
  for (const session of live) {
    let title = '';
    try {
      title = titles?.get?.(session)?.title ?? session?.title ?? '';
    } catch {
      title = '';
    }
    const row = normalizeSessionRow(
      {
        sessionId: session?.header?.id ?? session?.id,
        title,
        updatedAt: session?.header?.createdAt,
        origin: session?.header?.origin,
        cwd: session?.header?.cwd,
        running: false,
        agentAvailable: true,
      },
      session?.header,
    );
    if (row !== null) rows.push(row);
  }
  return rows;
}

/**
 * Read the canonical Session list. Prefer `sessionController.list`, the same
 * visible summary feed the Web sidebar consumes (including cold titles and
 * blank/origin metadata); fall back to the raw query engine, then to live
 * Sessions only.
 * @param {object} ctx - host context.
 * @param {AbortSignal} [signal] - request cancellation.
 * @returns {Promise<Array<object>>} normalized summaries.
 */
async function collectSessionSummaries(ctx, signal) {
  const controller = serviceOf(ctx, 'sessionController');
  if (typeof controller?.list === 'function') {
    try {
      const value = await controller.list({}, signal);
      const items = Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : null;
      if (items !== null) return items.map((item) => normalizeSessionRow(item)).filter((row) => row !== null);
    } catch (error) {
      warnCatalog(ctx, `bark-push: 会话列表读取失败，改用底层查询：${error?.message ?? String(error)}`);
    }
  }
  const queried = await listViaSessionQuery(ctx, signal);
  if (queried !== null) return queried;
  return listLiveSessions(ctx);
}

/**
 * Build the catalog shown on the management page: every registered workspace
 * and the Sessions visible in DSH's own sidebar, with current mute flags.
 *
 * Visibility follows `dsh-client-ui-workspace`: subagent Sessions, blank
 * Sessions, and archived Sessions (the default archived filter) never appear.
 * Muted Sessions that are now hidden remain as rows so their mute can still
 * be cleared.
 * @param {object} ctx - host context.
 * @param {object} snapshot - state snapshot.
 * @param {AbortSignal} [signal] - request cancellation.
 * @returns {Promise<{ workspaces: Array<object>, sessions: Array<object>, sessionWorkspace: Record<string, string> }>} catalog.
 */
export async function buildCatalog(ctx, snapshot, signal) {
  const mutedWorkspaces = new Set(snapshot.mutedWorkspaces);
  const mutedSessions = new Set(snapshot.mutedSessions);
  const allMutedSessions = new Set([
    ...mutedSessions,
    ...(Array.isArray(snapshot.browserMutedSessions) ? snapshot.browserMutedSessions : []),
  ]);
  const workspaces = [];
  /** Session id -> workspace id for every Session the registry knows. */
  const workspaceBySession = new Map();
  /** Workspace id -> display title. */
  const workspaceTitleById = new Map();
  let archivedSessionIds = new Set();
  let pinnedSessionIds = [];
  try {
    const registry = serviceOf(ctx, 'workspaceRegistry');
    const list = typeof registry?.list === 'function' ? registry.list() : [];
    for (const workspace of list) {
      const id = String(workspace.id);
      const path = typeof workspace.path === 'string' ? workspace.path : '';
      const title = typeof workspace.title === 'string' && workspace.title.length > 0 ? workspace.title : id;
      workspaces.push({
        id,
        title,
        path,
        muted: mutedWorkspaces.has(id),
      });
      workspaceTitleById.set(id, title);
      for (const sessionId of Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []) {
        workspaceBySession.set(String(sessionId), id);
      }
    }
    if (Array.isArray(registry?.archivedSessionIds)) {
      archivedSessionIds = new Set(registry.archivedSessionIds.map(String));
    }
    if (Array.isArray(registry?.pinnedSessionIds)) {
      pinnedSessionIds = registry.pinnedSessionIds.map(String);
    }
  } catch {
    // A missing or broken registry only means the page shows no projects.
  }

  let summaries = [];
  try {
    summaries = await collectSessionSummaries(ctx, signal);
  } catch (error) {
    warnCatalog(ctx, `bark-push: 会话目录构建失败：${error?.message ?? String(error)}`);
  }

  // The controller already carries titles, but a live title can be newer than
  // the cached projection; fill any gap before rendering.
  const sessionsService = serviceOf(ctx, 'sessions');
  const titlesService = serviceOf(ctx, 'sessionTitle');
  for (const row of summaries) {
    if (row.title.length > 0) continue;
    const live = typeof sessionsService?.get === 'function' ? sessionsService.get(row.id) : undefined;
    if (live === undefined) continue;
    try {
      const title = titlesService?.get?.(live)?.title;
      if (typeof title === 'string' && title.length > 0) row.title = title;
    } catch {
      // A title failure leaves the row unnamed.
    }
  }

  const summaryById = new Map(summaries.map((row) => [row.id, row]));
  const visible = summaries.filter((row) => row.blank !== true && row.origin !== 'subagent' && !archivedSessionIds.has(row.id));
  const pinRank = new Map(pinnedSessionIds.map((id, index) => [id, index]));
  visible.sort((left, right) => {
    const leftPinned = pinRank.has(left.id);
    const rightPinned = pinRank.has(right.id);
    if (leftPinned && rightPinned) return pinRank.get(left.id) - pinRank.get(right.id);
    if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
    return left.id.localeCompare(right.id);
  });

  const sessions = [];
  const seen = new Set();
  for (const row of visible) {
    const workspaceId = workspaceBySession.get(row.id) ?? null;
    sessions.push({
      id: row.id,
      title: row.title,
      cwd: row.cwd,
      workspaceId,
      workspaceTitle: workspaceId === null ? '' : workspaceTitleById.get(workspaceId) ?? workspaceId,
      origin: row.origin,
      createdAt: row.updatedAt,
      updatedAt: row.updatedAt,
      running: row.running,
      muted: mutedSessions.has(row.id),
      archived: false,
      orphaned: false,
    });
    seen.add(row.id);
  }

  // A mute outlives the row it was set on: keep archived, subagent, blank, or
  // deleted Sessions visible here so the user can still clear that mute.
  for (const id of allMutedSessions) {
    if (seen.has(id)) continue;
    const summary = summaryById.get(id);
    const workspaceId = workspaceBySession.get(id) ?? null;
    sessions.push({
      id,
      title: summary?.title ?? '',
      cwd: summary?.cwd ?? '',
      workspaceId,
      workspaceTitle: workspaceId === null ? '' : workspaceTitleById.get(workspaceId) ?? workspaceId,
      origin: summary?.origin ?? null,
      createdAt: summary?.updatedAt ?? 0,
      updatedAt: summary?.updatedAt ?? 0,
      running: false,
      muted: mutedSessions.has(id),
      archived: archivedSessionIds.has(id),
      orphaned: true,
    });
    seen.add(id);
  }

  return { workspaces, sessions, sessionWorkspace: Object.fromEntries(workspaceBySession) };
}

/**
 * Register the plugin's authenticated routes.
 * @param {object} ctx - host context carrying `connection`.
 * @param {object} runtime - plugin runtime facade.
 * @param {object} [host] - root host context used to read workspace/session services.
 * @returns {() => void} disposer that removes every route.
 */
export function installHttpRoutes(ctx, runtime, host = ctx) {
  const connection = ctx.connection;
  if (typeof connection?.fetch?.register !== 'function') return () => {};
  /** @type {Array<() => Promise<void>>} */
  const disposers = [];

  /**
   * Register one exact route.
   * @param {string} path - absolute path below `/api`.
   * @param {string[]} methods - accepted methods.
   * @param {(request: Request) => Promise<Response>} fetch - handler.
   */
  const register = (path, methods, fetch) => {
    const dispose = connection.fetch.register({
      path,
      methods,
      requestBody: 'buffered',
      fetch,
    });
    disposers.push(dispose);
  };

  /**
   * Build the complete management payload.
   * @param {Request} [request] - current request, used for cancellation.
   * @returns {Promise<object>} payload.
   */
  const statePayload = async (request) => {
    const config = runtime.getConfig();
    const snapshot = runtime.getState();
    return {
      ok: true,
      version: runtime.version,
      config: publicConfig(config),
      channelTypes: channelTypeSummaries(),
      mute: {
        workspaces: snapshot.mutedWorkspaces,
        sessions: snapshot.mutedSessions,
        browserWorkspaces: snapshot.browserMutedWorkspaces ?? [],
        browserSessions: snapshot.browserMutedSessions ?? [],
      },
      catalog: await buildCatalog(host, snapshot, request?.signal),
      lastTest: snapshot.lastTest,
      lastDelivery: runtime.lastDelivery(),
      warnings: runtime.warnings(),
    };
  };

  register(ROUTES.ui, ['GET'], async (request) => {
    const url = new URL(request.url);
    const embedded = url.searchParams.get('embed') === '1';
    return new Response(renderUiPage({ version: runtime.version, embedded }), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'none'; frame-ancestors 'self'; base-uri 'none'",
      },
    });
  });

  register(ROUTES.state, ['GET'], async (request) => json(await statePayload(request)));

  register(ROUTES.config, ['POST'], async (request) => {
    if (!writeAllowed(request)) return json({ ok: false, error: 'forbidden' }, 403);
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return json({ ok: false, error: error?.message ?? '无效请求' }, 400);
    }
    try {
      await runtime.updateConfig(body);
      return json(await statePayload(request));
    } catch (error) {
      return json({ ok: false, error: error?.message ?? '保存失败' }, 400);
    }
  });

  register(ROUTES.mute, ['POST'], async (request) => {
    if (!writeAllowed(request)) return json({ ok: false, error: 'forbidden' }, 403);
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return json({ ok: false, error: error?.message ?? '无效请求' }, 400);
    }
    const target = muteTarget(body.kind, body.id);
    if (target === null) return json({ ok: false, error: '无效的静音目标' }, 400);
    const channel = muteChannel(body.channel);
    if (channel === null) return json({ ok: false, error: '无效的静音通道' }, 400);
    if (typeof body.muted !== 'boolean') return json({ ok: false, error: 'muted 必须是布尔值' }, 400);
    try {
      await runtime.setMute(target.kind, target.id, body.muted, channel);
      return json(await statePayload(request));
    } catch (error) {
      return json({ ok: false, error: error?.message ?? '保存失败' }, 500);
    }
  });

  register(ROUTES.toggle, ['POST'], async (request) => {
    if (!writeAllowed(request)) return json({ ok: false, error: 'forbidden' }, 403);
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return json({ ok: false, error: error?.message ?? '无效请求' }, 400);
    }
    const target = muteTarget(body.kind, body.id);
    if (target === null) return json({ ok: false, error: '无效的静音目标' }, 400);
    const channel = muteChannel(body.channel);
    if (channel === null) return json({ ok: false, error: '无效的静音通道' }, 400);
    try {
      const result = await runtime.toggleMute(target.kind, target.id, channel);
      return json({ ...(await statePayload(request)), muted: result.muted });
    } catch (error) {
      return json({ ok: false, error: error?.message ?? '保存失败' }, 500);
    }
  });

  register(ROUTES.browserEvents, ['GET'], async (request) => {
    if (typeof runtime.browserNotify?.subscribe !== 'function') {
      return json({ ok: false, error: '浏览器通知通道不可用' }, 501);
    }
    return runtime.browserNotify.subscribe(request);
  });

  register(ROUTES.test, ['POST'], async (request) => {
    if (!writeAllowed(request)) return json({ ok: false, error: 'forbidden' }, 403);
    try {
      const result = await runtime.test();
      return json({ ok: result.ok, result, state: await statePayload(request) });
    } catch (error) {
      return json({ ok: false, error: error?.message ?? '测试推送失败' }, 500);
    }
  });

  register(ROUTES.testChannel, ['POST'], async (request) => {
    if (!writeAllowed(request)) return json({ ok: false, error: 'forbidden' }, 403);
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return json({ ok: false, error: error?.message ?? '无效请求' }, 400);
    }
    if (typeof body.id !== 'string' || body.id.trim().length === 0) {
      return json({ ok: false, error: '缺少渠道 id' }, 400);
    }
    if (typeof runtime.testChannel !== 'function') {
      return json({ ok: false, error: '当前运行时未启用渠道测试' }, 501);
    }
    try {
      const result = await runtime.testChannel(body.id.trim());
      return json({ ok: result.ok, result, state: await statePayload(request) });
    } catch (error) {
      return json({ ok: false, error: error?.message ?? '渠道测试失败' }, 500);
    }
  });

  return () => {
    for (const dispose of disposers) {
      try {
        Promise.resolve(dispose()).catch(() => {});
      } catch {
        // Route removal during disposal is best effort.
      }
    }
  };
}

/**
 * Normalize a management-page config write into a complete state overlay.
 * Exported for tests; the HTTP handler owns the persistence call.
 * @param {Record<string, unknown>} currentOverlay - existing overlay.
 * @param {Record<string, unknown>} body - request body.
 * @param {Record<string, unknown>} [effective] - current effective config, used
 *   as the key baseline when the overlay does not already override keys.
 * @returns {{ overlay: Record<string, unknown>, reset: boolean }} next overlay.
 */
export function nextConfigOverlay(currentOverlay, body, effective = {}) {
  const input = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (input.reset === true) return { overlay: {}, reset: true };
  const overlay = { ...currentOverlay, ...writableConfigPatch(input) };
  const baseline = Array.isArray(overlay.deviceKeys)
    ? overlay.deviceKeys
    : Array.isArray(effective.deviceKeys)
      ? effective.deviceKeys
      : [];
  if (Array.isArray(input.deviceKeys)) {
    overlay.deviceKeys = normalizeDeviceKeys(input.deviceKeys);
  } else if (Array.isArray(input.addDeviceKeys)) {
    overlay.deviceKeys = normalizeDeviceKeys([...baseline, ...input.addDeviceKeys]);
  }
  if (input.clearDeviceKeys === true) overlay.deviceKeys = [];
  if (Array.isArray(input.channels)) {
    overlay.channels = resolveChannelSecrets(input.channels, effective.channels);
  } else if (input.clearChannels === true) {
    overlay.channels = [];
  }
  return { overlay, reset: false };
}

/**
 * Merge incoming channel edits with the stored secrets. A blank secret field
 * keeps the previously stored value, because the browser is never shown it.
 * @param {Array<unknown>} incoming - channels from the request body.
 * @param {unknown} effective - current effective channels (with real secrets).
 * @returns {Array<object>} resolved channels.
 */
export function resolveChannelSecrets(incoming, effective) {
  const stored = new Map(
    (Array.isArray(effective) ? effective : [])
      .filter((channel) => channel && typeof channel.id === 'string')
      .map((channel) => [channel.id, channel]),
  );
  const out = [];
  for (const item of incoming) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const provider = providerFor(item.type);
    if (!provider) continue;
    const baseConfig = stored.get(item.id)?.config ?? {};
    const rawConfig = item.config !== null && typeof item.config === 'object' && !Array.isArray(item.config) ? item.config : {};
    const config = {};
    for (const field of provider.fields) {
      if (field.kind === 'secret') {
        const value = typeof rawConfig[field.key] === 'string' ? rawConfig[field.key].trim() : '';
        config[field.key] = value.length > 0 ? value : typeof baseConfig[field.key] === 'string' ? baseConfig[field.key] : '';
      } else {
        config[field.key] = rawConfig[field.key];
      }
    }
    out.push({
      id: item.id,
      type: item.type,
      label: typeof item.label === 'string' ? item.label : '',
      enabled: item.enabled !== false,
      config,
    });
  }
  return out;
}
