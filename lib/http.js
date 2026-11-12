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
import { renderUiPage } from './ui.js';

/** Exact route paths, all below `/api`. */
export const ROUTES = Object.freeze({
  ui: '/api/bark-push/ui',
  state: '/api/bark-push/state',
  config: '/api/bark-push/config',
  mute: '/api/bark-push/mute',
  toggle: '/api/bark-push/toggle',
  test: '/api/bark-push/test',
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
 * Build the catalog shown on the management page: every registered workspace
 * and the live Session list, with current mute flags.
 * @param {object} ctx - host context.
 * @param {object} snapshot - state snapshot.
 * @returns {{ workspaces: Array<object>, sessions: Array<object> }} catalog.
 */
function buildCatalog(ctx, snapshot) {
  const mutedWorkspaces = new Set(snapshot.mutedWorkspaces);
  const mutedSessions = new Set(snapshot.mutedSessions);
  const workspaces = [];
  const workspaceBySession = new Map();
  try {
    const registry = ctx.workspaceRegistry;
    const list = typeof registry?.list === 'function' ? registry.list() : [];
    for (const workspace of list) {
      const id = String(workspace.id);
      workspaces.push({
        id,
        title: workspace.title,
        path: workspace.path,
        muted: mutedWorkspaces.has(id),
      });
      for (const sessionId of workspace.sessionIds ?? []) workspaceBySession.set(String(sessionId), id);
    }
  } catch {
    // A missing or broken registry only means the page shows no projects.
  }

  const sessions = [];
  const seen = new Set();
  try {
    const live = typeof ctx.sessions?.list === 'function' ? ctx.sessions.list() : [];
    const rows = live
      .map((session) => {
        const id = String(session.header?.id ?? session.id ?? '');
        let title = '';
        try {
          title = ctx.sessionTitle?.get?.(session)?.title ?? '';
        } catch {
          title = '';
        }
        return {
          id,
          title: typeof title === 'string' ? title : '',
          cwd: typeof session.header?.cwd === 'string' ? session.header.cwd : '',
          workspaceId: workspaceBySession.get(id) ?? null,
          origin: session.header?.origin ?? null,
          createdAt: Number.isFinite(session.header?.createdAt) ? session.header.createdAt : 0,
          muted: mutedSessions.has(id),
          offline: false,
        };
      })
      .filter((row) => row.id.length > 0)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 300);
    for (const row of rows) {
      sessions.push(row);
      seen.add(row.id);
    }
  } catch {
    // Live Session enumeration is optional.
  }

  for (const id of mutedSessions) {
    if (seen.has(id)) continue;
    sessions.push({ id, title: '', cwd: '', workspaceId: null, origin: null, createdAt: 0, muted: true, offline: true });
  }
  return { workspaces, sessions };
}

/**
 * Register the plugin's authenticated routes.
 * @param {object} ctx - host context carrying `connection`.
 * @param {object} runtime - plugin runtime facade.
 * @returns {() => void} disposer that removes every route.
 */
export function installHttpRoutes(ctx, runtime) {
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

  const statePayload = () => {
    const config = runtime.getConfig();
    const snapshot = runtime.getState();
    return {
      ok: true,
      version: runtime.version,
      config: publicConfig(config),
      mute: {
        workspaces: snapshot.mutedWorkspaces,
        sessions: snapshot.mutedSessions,
      },
      catalog: buildCatalog(ctx, snapshot),
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

  register(ROUTES.state, ['GET'], async () => json(statePayload()));

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
      return json(statePayload());
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
    if (typeof body.muted !== 'boolean') return json({ ok: false, error: 'muted 必须是布尔值' }, 400);
    try {
      await runtime.setMute(target.kind, target.id, body.muted);
      return json(statePayload());
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
    try {
      const result = await runtime.toggleMute(target.kind, target.id);
      return json({ ...statePayload(), muted: result.muted });
    } catch (error) {
      return json({ ok: false, error: error?.message ?? '保存失败' }, 500);
    }
  });

  register(ROUTES.test, ['POST'], async (request) => {
    if (!writeAllowed(request)) return json({ ok: false, error: 'forbidden' }, 403);
    try {
      const result = await runtime.test();
      return json({ ok: result.ok, result, state: statePayload() });
    } catch (error) {
      return json({ ok: false, error: error?.message ?? '测试推送失败' }, 500);
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
  return { overlay, reset: false };
}
