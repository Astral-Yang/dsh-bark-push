/**
 * Notification orchestration: mute checks, duplicate suppression, formatting,
 * click-through links, and asynchronous delivery.
 *
 * Every public method returns immediately. Work is placed on a bounded queue;
 * the only awaited path is the explicit test-push API, whose caller is the
 * management page.
 *
 * @module dsh-bark-push/notifier
 */

import { buildSessionUrl, formatApproval, formatQuestion, formatReply, formatTest } from './format.js';
import { TtlSet } from './ttl-set.js';

/**
 * Stable 32-bit hash for a question batch used as a dedupe fallback when the
 * host does not supply a tool call id.
 * @param {unknown} value - JSON-serializable value.
 * @returns {string} hexadecimal hash.
 */
export function hashValue(value) {
  let hash = 0x811c9dc5;
  const text = JSON.stringify(value ?? null);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Return the final path segment of a cwd, used as a last-resort session label.
 * @param {unknown} cwd - working directory.
 * @returns {string} label.
 */
function baseName(cwd) {
  if (typeof cwd !== 'string') return '';
  const parts = cwd.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts.at(-1) ?? '';
}

/**
 * Read one service without letting a missing optional peer throw.
 * @param {object} ctx - host context.
 * @param {string} key - service key.
 * @returns {any} service or undefined.
 */
export function optionalService(ctx, key) {
  try {
    // Cordis resolves services with get() without requiring the plugin to
    // declare them in `inject`; direct property access only covers injected
    // services and silently yields undefined for the rest.
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
 * Owns all notification policy and delivery.
 */
export class Notifier {
  /**
   * @param {object} options - notifier options.
   * @param {object} options.ctx - host Cordis context.
   * @param {() => Record<string, unknown>} options.getConfig - current effective config.
   * @param {object} options.state - StateStore.
   * @param {object} options.bark - BarkClient.
   * @param {object} options.queue - SerialQueue.
   * @param {{ info: Function, warn: Function, error: Function, debug: Function }} options.logger - logger.
   * @param {string} options.version - plugin version for diagnostics.
   */
  constructor({ ctx, getConfig, state, bark, queue, logger, version }) {
    this.ctx = ctx;
    this.getConfig = getConfig;
    this.state = state;
    this.bark = bark;
    this.queue = queue;
    this.logger = logger;
    this.version = version;
    this.seen = new TtlSet({ ttlMs: 30 * 60 * 1000, capacity: 1024 });
    /** @type {Map<string, { key: string, at: number }>} */
    this.workspaceCache = new Map();
    this.lastDelivery = null;
  }

  /**
   * Resolve the workspace key a Session belongs to. The registry membership is
   * checked first (it also covers persisted Sessions), then the canonical cwd.
   * The result is cached briefly because it is stable but resolving it touches
   * the filesystem.
   * @param {string} sessionId - Session id.
   * @param {unknown} session - live Session, when available.
   * @param {boolean} [fresh] - bypass the cache.
   * @returns {Promise<string | undefined>} workspace id or `cwd:` fallback key.
   */
  async workspaceKeyFor(sessionId, session, fresh = false) {
    const now = Date.now();
    if (!fresh) {
      const cached = this.workspaceCache.get(sessionId);
      if (cached !== undefined && now - cached.at < 60_000) return cached.key;
    }
    const registry = optionalService(this.ctx, 'workspaceRegistry');
    let key;
    try {
      const list = typeof registry?.list === 'function' ? registry.list() : [];
      for (const workspace of list) {
        if (Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId)) {
          key = String(workspace.id);
          break;
        }
      }
    } catch {
      // A broken registry is not a reason to stop notifying.
    }
    const cwd = session?.header?.cwd;
    if (key === undefined && typeof cwd === 'string' && cwd.length > 0) {
      try {
        const workspace = await registry?.resolveByPath?.(cwd);
        if (workspace?.id !== undefined) key = String(workspace.id);
      } catch {
        // Missing directories and unavailable registries fall through.
      }
      if (key === undefined) key = `cwd:${cwd}`;
    }
    if (key !== undefined) {
      this.workspaceCache.set(sessionId, { key, at: now });
      if (this.workspaceCache.size > 500) {
        const oldest = this.workspaceCache.keys().next().value;
        if (oldest !== undefined) this.workspaceCache.delete(oldest);
      }
    }
    return key;
  }

  /**
   * Resolve a session label without requiring the session-title service.
   * @param {unknown} session - live Session.
   * @param {string} [cached] - title learned from `session/title`.
   * @returns {string} label.
   */
  sessionTitleFor(session, cached) {
    if (typeof cached === 'string' && cached.length > 0) return cached;
    try {
      const snapshot = optionalService(this.ctx, 'sessionTitle')?.get?.(session);
      if (typeof snapshot?.title === 'string' && snapshot.title.length > 0) return snapshot.title;
    } catch {
      // Fall through to cwd/id labels.
    }
    const cwdLabel = baseName(session?.header?.cwd);
    if (cwdLabel.length > 0) return cwdLabel;
    const id = typeof session?.header?.id === 'string' ? session.header.id : '';
    return id.length > 0 ? id : '当前会话';
  }

  /**
   * Resolve a workspace label for an approval body.
   * @param {string | undefined} workspaceKey - key from {@link workspaceKeyFor}.
   * @returns {string | undefined} title.
   */
  workspaceTitleFor(workspaceKey) {
    if (workspaceKey === undefined || workspaceKey.startsWith('cwd:')) return undefined;
    try {
      return optionalService(this.ctx, 'workspaceRegistry')?.get?.(workspaceKey)?.title;
    } catch {
      return undefined;
    }
  }

  /**
   * The advertised public root used by click-through links.
   * @returns {string | undefined} absolute base URL.
   */
  baseUrl() {
    const configured = this.getConfig().publicBaseUrl;
    if (typeof configured === 'string' && configured.length > 0) return configured;
    try {
      const advertised = optionalService(this.ctx, 'webApp')?.getAdvertisedUrl?.();
      if (typeof advertised === 'string' && advertised.length > 0) return advertised;
    } catch {
      // No Web app mounted.
    }
    try {
      const origin = optionalService(this.ctx, 'webServer')?.getOrigin?.();
      if (typeof origin === 'string' && origin.length > 0) return `${origin.replace(/\/+$/, '')}/`;
    } catch {
      // No Web server mounted.
    }
    return undefined;
  }

  /**
   * Record one delivery verdict for the management page.
   * @param {object} record - sanitized verdict.
   */
  #record(record) {
    this.lastDelivery = {
      at: new Date().toISOString(),
      kind: record.kind,
      ok: record.ok === true,
      skipped: record.skipped === true,
      reason: record.reason,
      results: Array.isArray(record.results)
        ? record.results.slice(0, 20).map((entry) => ({
            maskedKey: entry.maskedKey,
            ok: entry.ok === true,
            status: entry.status ?? null,
            attempts: entry.attempts ?? null,
          }))
        : [],
    };
  }

  /**
   * Schedule one reply notification.
   * @param {object} input - reply input.
   * @param {unknown} input.session - live Session.
   * @param {string} input.sessionId - Session id.
   * @param {number} input.turn - turn number.
   * @param {string} input.text - assistant text.
   * @param {string} [input.sessionTitle] - cached title.
   */
  reply({ session, sessionId, turn, text, sessionTitle }) {
    const config = this.getConfig();
    if (config.notifyOnReply !== true) return;
    const key = `reply:${sessionId}:${turn}`;
    if (!this.seen.add(key)) return;
    const label = this.sessionTitleFor(session, sessionTitle);
    const note = formatReply({ text, sessionTitle: label, config });
    if (note === null) return;
    void this.#deliver({
      kind: 'reply',
      note,
      text,
      session,
      sessionId,
      sessionTitle: label,
      focus: 'reply',
    });
  }

  /**
   * Schedule one approval notification.
   * @param {object} input - approval input.
   * @param {unknown} input.session - live Session.
   * @param {string} input.sessionId - Session id.
   * @param {string} input.requestId - approval request id.
   * @param {string} input.toolName - tool name.
   * @param {string} [input.reason] - asker reason.
   * @param {string} [input.sessionTitle] - cached title.
   */
  approval({ session, sessionId, requestId, toolName, reason, sessionTitle }) {
    const config = this.getConfig();
    if (config.notifyOnApproval !== true) return;
    const key = `approval:${requestId}`;
    if (!this.seen.add(key)) return;
    const label = this.sessionTitleFor(session, sessionTitle);
    void this.#deliver({
      kind: 'approval',
      note: formatApproval({
        toolName,
        reason,
        sessionTitle: label,
        workspaceTitle: undefined,
        config,
      }),
      approval: { toolName, reason },
      session,
      sessionId,
      sessionTitle: label,
      focus: 'approval',
    });
  }

  /**
   * Schedule one user-question notification. The waterfall request is observed
   * without claiming it; the UI answerer keeps ownership of the interaction.
   * @param {object} request - `user-questions/request` payload.
   */
  question(request) {
    const config = this.getConfig();
    if (config.notifyOnQuestion !== true) return;
    const sessionId = typeof request?.agent?.id === 'string' ? request.agent.id : '';
    const callId = typeof request?.wait?.callId === 'string' ? request.wait.callId : '';
    const key = `question:${sessionId || 'unknown'}:${callId || hashValue(request?.questions)}`;
    if (!this.seen.add(key)) return;
    let session;
    try {
      session = sessionId.length > 0 ? optionalService(this.ctx, 'sessions')?.get?.(sessionId) : undefined;
    } catch {
      session = undefined;
    }
    void this.#deliver({
      kind: 'question',
      note: formatQuestion({
        questions: request?.questions,
        sessionTitle: this.sessionTitleFor(session ?? { header: { id: sessionId } }),
        config,
      }),
      questions: request?.questions,
      session,
      sessionId,
      sessionTitle: this.sessionTitleFor(session ?? { header: { id: sessionId } }),
      focus: 'question',
    });
  }

  /**
   * Check the latest switch, mute, key, and workspace state, then send.
   * @param {object} job - delivery job.
   * @returns {Promise<void>} completion.
   */
  async #deliver(job) {
    const accepted = this.queue.push(async () => {
      const config = this.getConfig();
      if (config.enabled !== true) return;
      if (job.kind === 'reply' && config.notifyOnReply !== true) return;
      if (job.kind === 'approval' && config.notifyOnApproval !== true) return;
      if (job.kind === 'question' && config.notifyOnQuestion !== true) return;
      if (!Array.isArray(config.deviceKeys) || config.deviceKeys.length === 0) return;

      // Re-read shared state and re-resolve the workspace immediately before
      // sending: a mute applied while this job waited (including one written
      // by another DSH process) must suppress the notification.
      this.state.refreshSync?.();
      const workspaceKey = await this.workspaceKeyFor(job.sessionId, job.session, true);
      if (this.state.isMuted({ sessionId: job.sessionId, workspaceKey })) {
        this.logger.debug?.(`bark-push: ${job.kind} 已被静音，跳过`);
        return;
      }

      // Rebuild from the current config so a length, prefix, or language
      // change made while the job waited applies to what is actually sent.
      let note;
      if (job.kind === 'reply') {
        note = formatReply({
          text: job.text,
          sessionTitle: this.sessionTitleFor(job.session, job.sessionTitle),
          config,
        });
      } else if (job.kind === 'question') {
        note = formatQuestion({ questions: job.questions, sessionTitle: job.sessionTitle, config });
      } else if (job.kind === 'approval') {
        note = formatApproval({
          toolName: job.approval?.toolName,
          reason: job.approval?.reason,
          sessionTitle: job.sessionTitle,
          workspaceTitle: this.workspaceTitleFor(workspaceKey),
          config,
        });
      } else {
        note = { ...job.note };
      }
      if (!note) return;
      if (config.linkToSession === true && job.sessionId.length > 0) {
        const url = buildSessionUrl({
          baseUrl: this.baseUrl(),
          sessionId: job.sessionId,
          focus: job.focus,
        });
        if (url !== undefined) note.url = url;
      }
      const result = await this.bark.send(note);
      this.#record({ kind: job.kind, ...result });
      if (result.ok) {
        this.logger.debug?.(`bark-push: ${job.kind} 已推送`);
      } else if (!result.skipped) {
        this.logger.warn?.(`bark-push: ${job.kind} 推送失败`);
      }
    }, job.kind);
    if (!accepted) {
      // Queue saturation is logged by the queue itself.
    }
  }

  /**
   * Send one explicit test notification with the current effective config.
   * @returns {Promise<object>} sanitized outcome.
   */
  async test() {
    const config = this.getConfig();
    const note = formatTest(config);
    const result = await this.bark.send(note, { force: true });
    this.#record({ kind: 'test', ...result });
    try {
      await this.state.recordTest({
        at: new Date().toISOString(),
        ok: result.ok === true,
        results: Array.isArray(result.results) ? result.results : [],
      });
    } catch (error) {
      this.logger.warn?.(`bark-push: 测试结果无法写入状态文件：${error?.message ?? String(error)}`);
    }
    return {
      ok: result.ok === true,
      skipped: result.skipped === true,
      reason: result.reason,
      results: Array.isArray(result.results)
        ? result.results.map((entry) => ({
            maskedKey: entry.maskedKey,
            ok: entry.ok === true,
            status: entry.status ?? null,
            attempts: entry.attempts ?? null,
            message: entry.message,
          }))
        : [],
    };
  }
}
