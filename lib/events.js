/**
 * Session-event and waterfall observation.
 *
 * Only committed Session events are read, so streaming deltas never reach this
 * module: one `assistant/message` is appended per model step, and one
 * `turn/end` closes the turn. A notification is produced from the last
 * assistant text of a completed turn, never from reasoning or tool logs.
 *
 * @module dsh-bark-push/events
 */

/**
 * Return the durable Session id from a live Session object.
 * @param {unknown} session - Session-like object.
 * @returns {string} Session id or an empty string.
 */
export function sessionIdOf(session) {
  const header = session !== null && typeof session === 'object' ? session.header : undefined;
  const headerId = header !== null && typeof header === 'object' ? header.id : undefined;
  const direct = session !== null && typeof session === 'object' ? session.id : undefined;
  const value = headerId ?? direct;
  return typeof value === 'string' ? value : '';
}

/**
 * Whether a Session belongs to a subagent.
 * @param {unknown} session - Session-like object.
 * @returns {boolean} true for delegated child Sessions.
 */
export function isSubagentSession(session) {
  const header = session !== null && typeof session === 'object' ? session.header : undefined;
  if (header === null || typeof header !== 'object') return false;
  if (header.origin === 'subagent') return true;
  return Number.isFinite(header.delegationDepth) && Number(header.delegationDepth) > 0;
}

/**
 * Extract visible text blocks from an AssistantMessage. Reasoning, tool calls,
 * and images are deliberately ignored.
 * @param {unknown} message - AssistantMessage-like value.
 * @returns {string} joined visible text.
 */
export function extractAssistantText(message) {
  const content = message !== null && typeof message === 'object' ? message.content : undefined;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      const text = block.text.trim();
      if (text.length > 0) parts.push(text);
    }
  }
  return parts.join('\n\n').trim();
}

/**
 * Normalize a `turn/end` reason, accepting both the structured current shape
 * and the plain string older logs may carry.
 * @param {unknown} reason - raw reason.
 * @returns {string} reason kind or an empty string.
 */
export function turnEndKind(reason) {
  if (typeof reason === 'string') return reason;
  if (reason !== null && typeof reason === 'object' && typeof reason.kind === 'string') return reason.kind;
  return '';
}

/**
 * Install the Session-event bridge.
 * @param {object} ctx - host Cordis context.
 * @param {object} options - bridge dependencies.
 * @param {object} options.notifier - notifier with `reply`/`approval` methods.
 * @param {() => Record<string, unknown>} options.getConfig - current config.
 * @param {{ info: Function, warn: Function, error: Function, debug: Function }} options.logger - logger.
 * @returns {() => void} disposer.
 */
export function installSessionBridge(ctx, { notifier, getConfig, logger }) {
  /** @type {Map<string, { turn: number, text: string }>} */
  const pending = new Map();
  /** @type {Map<string, string>} */
  const titles = new Map();

  /**
   * Read a cached session title, refreshed from `session/title` events.
   * @param {string} id - Session id.
   * @returns {string | undefined} title.
   */
  const titleOf = (id) => titles.get(id);

  /**
   * Handle one committed event. Every path is contained: a malformed event
   * must never take down the host's session feed.
   * @param {unknown} session - Session-like object.
   * @param {unknown} event - Session event.
   */
  const handle = (session, event) => {
    if (event === null || typeof event !== 'object' || typeof event.type !== 'string') return;
    const id = sessionIdOf(session);
    if (id.length === 0) return;
    const config = getConfig();
    if (isSubagentSession(session) && config.includeSubagents !== true) return;

    if (event.type === 'session/title') {
      const title = typeof event.data?.title === 'string' ? event.data.title : '';
      if (title.length > 0) titles.set(id, title);
      return;
    }

    if (event.type === 'assistant/message') {
      const turn = Number(event.data?.turn);
      if (!Number.isFinite(turn)) return;
      const text = extractAssistantText(event.data?.message);
      if (text.length === 0) return;
      pending.set(id, { turn, text });
      return;
    }

    if (event.type === 'turn/end') {
      const turn = Number(event.data?.turn);
      const record = pending.get(id);
      pending.delete(id);
      if (!Number.isFinite(turn)) return;
      if (turnEndKind(event.data?.reason) !== 'completed') return;
      if (record === undefined || record.turn !== turn || record.text.length === 0) return;
      notifier.reply({
        session,
        sessionId: id,
        turn,
        text: record.text,
        sessionTitle: titleOf(id),
      });
      return;
    }

    if (event.type === 'approval/asked') {
      const requestId = typeof event.data?.id === 'string' ? event.data.id : '';
      if (requestId.length === 0) return;
      notifier.approval({
        session,
        sessionId: id,
        requestId,
        toolName: typeof event.data?.toolName === 'string' ? event.data.toolName : '',
        reason: typeof event.data?.reason === 'string' ? event.data.reason : '',
        callId: typeof event.data?.callId === 'string' ? event.data.callId : undefined,
        sessionTitle: titleOf(id),
      });
    }
  };

  const offEvent = ctx.on('session/event', (session, event) => {
    try {
      handle(session, event);
    } catch (error) {
      logger.warn(`bark-push: 会话事件处理失败：${error?.message ?? String(error)}`);
    }
  });

  const offDisposed = ctx.on('session/disposed', (session) => {
    try {
      const id = sessionIdOf(session);
      if (id.length === 0) return;
      pending.delete(id);
      titles.delete(id);
    } catch {
      // A disposal observer must never throw back into the Session store.
    }
  });

  return () => {
    offEvent?.();
    offDisposed?.();
  };
}

/**
 * Install the user-question waterfall observer.
 *
 * The listener never claims the request: it schedules a notification and
 * delegates with `next()`, so the real UI answerer still owns the interaction.
 * @param {object} ctx - host Cordis context.
 * @param {object} options - observer dependencies.
 * @param {object} options.notifier - notifier with `question` method.
 * @param {{ warn: Function }} options.logger - logger.
 * @returns {() => void} disposer.
 */
export function installQuestionBridge(ctx, { notifier, logger }) {
  const off = ctx.on('user-questions/request', (request, next) => {
    try {
      notifier.question(request);
    } catch (error) {
      logger.warn(`bark-push: 选择请求处理失败：${error?.message ?? String(error)}`);
    }
    return typeof next === 'function' ? next() : Promise.reject(new Error('bark-push: missing waterfall delegate'));
  });
  return () => off?.();
}
