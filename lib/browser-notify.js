/**
 * Host-side browser notification event bus.
 *
 * The browser channel is deliberately independent from Bark: it owns its own
 * switches, mute policy, templates, and in-memory SSE subscribers. A missing
 * Bark server or Device Key therefore never suppresses a browser notification.
 *
 * @module dsh-bark-push/browser-notify
 */

import {
  BROWSER_BODY_TEMPLATES,
  BROWSER_TEMPLATE_KEYS,
} from './config.js';
import { markdownToText, summarize, truncate } from './format.js';
import { hashValue } from './notifier.js';
import { TtlSet } from './ttl-set.js';

/** Browser notification status labels used by the default templates. */
export const BROWSER_STATUS = Object.freeze({
  reply: '回复完成',
  approval: '需要批准',
  question: '等待选择',
});

/** Placeholder syntax accepted by browser notification body templates. */
const PLACEHOLDER_PATTERN = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/**
 * Replace known `{name}` placeholders in one body template. Unknown
 * placeholders stay literal so a typo is visible instead of silently dropping
 * the surrounding text.
 * @param {string} template - body template.
 * @param {Record<string, string>} values - replacement values.
 * @returns {string} rendered body.
 */
export function renderBrowserTemplate(template, values) {
  return String(template ?? '').replace(PLACEHOLDER_PATTERN, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? '') : match,
  );
}

/**
 * Whether a Session is a delegated child.
 * @param {unknown} session - Session-like object.
 * @returns {boolean} true for subagent Sessions.
 */
function isSubagentSession(session) {
  const header = session !== null && typeof session === 'object' ? session.header : undefined;
  if (header === null || typeof header !== 'object') return false;
  if (header.origin === 'subagent') return true;
  return Number.isFinite(header.delegationDepth) && Number(header.delegationDepth) > 0;
}

/**
 * Pick a bounded, readable first question from a question batch.
 * @param {unknown} questions - question array.
 * @returns {string} question text.
 */
function firstQuestionText(questions) {
  const list = Array.isArray(questions) ? questions : [];
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue;
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    if (question.length > 0) return question.replace(/\s+/g, ' ');
    const header = typeof item.header === 'string' ? item.header.trim() : '';
    if (header.length > 0) return header.replace(/\s+/g, ' ');
  }
  return '需要你的选择';
}

/**
 * Build one browser-notification event.
 * @param {'reply'|'approval'|'question'} kind - event kind.
 * @param {object} input - event material.
 * @param {Record<string, unknown>} config - effective config.
 * @param {object} notifier - Notifier helper facade.
 * @returns {object|null} event payload, or null when no usable session id exists.
 */
export function buildBrowserNotification(kind, input, config, notifier) {
  const sessionId = typeof input?.sessionId === 'string' ? input.sessionId : '';
  if (sessionId.length === 0) return null;
  const session = input.session;
  if (isSubagentSession(session)) return null;

  const status = BROWSER_STATUS[kind];
  const sessionTitle = truncate(
    notifier?.sessionTitleFor?.(session ?? { header: { id: sessionId } }, input.sessionTitle) || '当前会话',
    120,
  );

  let summary = '';
  let tool = '';
  let reason = '';
  let question = '';
  let questionCount = '';
  let description = '';

  if (kind === 'reply') {
    summary = summarize(markdownToText(input.text), 60) || '已生成回复';
    description = summary;
  } else if (kind === 'approval') {
    tool = truncate(String(input.toolName ?? '').trim() || '未知工具', 120);
    reason = truncate(String(input.reason ?? '').trim().replace(/\s+/g, ' ') || '无说明', 80);
    description = `${tool} · ${reason}`;
  } else if (kind === 'question') {
    const list = Array.isArray(input.questions) ? input.questions : [];
    question = truncate(firstQuestionText(list), 80);
    questionCount = String(list.length);
    description = question;
  } else {
    return null;
  }

  const templateKey = BROWSER_TEMPLATE_KEYS[kind];
  const fallback = BROWSER_BODY_TEMPLATES[kind];
  const template = typeof config[templateKey] === 'string' && config[templateKey].trim().length > 0
    ? config[templateKey]
    : fallback;
  const values = {
    status,
    session: sessionTitle,
    summary,
    turn: String(input.turn ?? ''),
    tool,
    reason,
    question,
    questionCount,
    description,
  };
  let body = renderBrowserTemplate(template, values).trim();
  if (body.length === 0) body = renderBrowserTemplate(fallback, values).trim();
  const maxLength = Number.isFinite(config.browserNotifyMaxBodyLength)
    ? config.browserNotifyMaxBodyLength
    : 200;
  body = truncate(body, maxLength);

  return {
    kind,
    sessionId,
    sessionTitle,
    status,
    body,
    at: Date.now(),
  };
}

/**
 * In-memory browser notification hub plus an authenticated SSE responder.
 */
export class BrowserNotifyHub {
  /**
   * @param {object} options - hub options.
   * @param {() => Record<string, unknown>} options.getConfig - current effective config.
   * @param {object} options.state - StateStore with push/browser mute methods.
   * @param {object} options.notifier - Notifier helper for workspace/title resolution.
   * @param {(sessionId: string) => unknown} [options.getSession] - live Session lookup.
   * @param {{ warn: Function }} options.logger - logger facade.
   */
  constructor({ getConfig, state, notifier, getSession, logger }) {
    this.getConfig = getConfig;
    this.state = state;
    this.notifier = notifier;
    this.getSession = typeof getSession === 'function' ? getSession : () => undefined;
    this.logger = logger;
    this.subscribers = new Set();
    this.buffer = [];
    this.nextId = 1;
    this.closed = false;
    this.seen = new TtlSet({ ttlMs: 30 * 60 * 1000, capacity: 1024 });
  }

  /**
   * Publish a completed reply.
   * @param {object} input - reply input.
   * @returns {void}
   */
  reply(input) {
    this.#schedule('reply', input);
  }

  /**
   * Publish an approval request.
   * @param {object} input - approval input.
   * @returns {void}
   */
  approval(input) {
    this.#schedule('approval', input);
  }

  /**
   * Publish a user-question request.
   * @param {object} input - question input.
   * @returns {void}
   */
  question(input) {
    const sessionId = typeof input?.agent?.id === 'string' ? input.agent.id : '';
    this.#schedule('question', {
      sessionId,
      session: this.getSession(sessionId),
      questions: input?.questions,
      callId: input?.wait?.callId,
    });
  }

  /**
   * Schedule one kind after checking the browser channel switches and dedupe.
   * @param {'reply'|'approval'|'question'} kind - event kind.
   * @param {object} input - event material.
   * @returns {void}
   */
  #schedule(kind, input) {
    if (this.closed) return;
    const config = this.getConfig();
    if (!this.#kindEnabled(kind, config)) return;
    const key = this.#dedupeKey(kind, input);
    if (!this.seen.add(key)) return;
    void this.#publish(kind, input, config).catch((error) => {
      this.logger?.warn?.(`bark-push: 浏览器通知处理失败：${error?.message ?? String(error)}`);
    });
  }

  /**
   * Whether one kind is enabled in the browser channel.
   * @param {'reply'|'approval'|'question'} kind - event kind.
   * @param {Record<string, unknown>} config - effective config.
   * @returns {boolean} enabled.
   */
  #kindEnabled(kind, config) {
    if (config.browserNotifyEnabled !== true) return false;
    if (kind === 'reply') return config.browserNotifyOnReply === true;
    if (kind === 'approval') return config.browserNotifyOnApproval === true;
    if (kind === 'question') return config.browserNotifyOnQuestion === true;
    return false;
  }

  /**
   * Dedupe key for one event.
   * @param {'reply'|'approval'|'question'} kind - event kind.
   * @param {object} input - event material.
   * @returns {string} dedupe key.
   */
  #dedupeKey(kind, input) {
    if (kind === 'reply') return `reply:${input?.sessionId ?? ''}:${input?.turn ?? ''}`;
    if (kind === 'approval') return `approval:${input?.requestId ?? ''}`;
    return `question:${input?.sessionId ?? 'unknown'}:${input?.callId || hashValue(input?.questions)}`;
  }

  /**
   * Resolve mute state and publish one event.
   * @param {'reply'|'approval'|'question'} kind - event kind.
   * @param {object} input - event material.
   * @param {Record<string, unknown>} config - effective config.
   * @returns {Promise<void>} completion.
   */
  async #publish(kind, input, config) {
    if (this.closed) return;
    const sessionId = typeof input?.sessionId === 'string' ? input.sessionId : '';
    if (sessionId.length === 0) return;

    // Re-read a shared state file immediately before deciding, mirroring the
    // Bark path so a mute written by another DSH process is not forgotten.
    this.state.refreshSync?.();
    let workspaceKey;
    try {
      workspaceKey = await this.notifier.workspaceKeyFor(sessionId, input.session, true);
    } catch {
      workspaceKey = undefined;
    }
    const usePushMutes = config.browserNotifyUsePushMutes !== false;
    const muted = usePushMutes
      ? this.state.isMuted?.({ sessionId, workspaceKey }) === true
      : this.state.isBrowserMuted?.({ sessionId, workspaceKey }) === true;
    if (muted) {
      this.logger?.debug?.(`bark-push: 浏览器通知 ${kind} 已被静音，跳过`);
      return;
    }

    const session = input.session ?? this.getSession(sessionId);
    const event = buildBrowserNotification(kind, { ...input, session }, config, this.notifier);
    if (event === null) return;
    this.#broadcast(event);
  }

  /**
   * Append one event to the short replay buffer and send it to every subscriber.
   * @param {object} event - formatted event without an id.
   * @returns {void}
   */
  #broadcast(event) {
    const now = Date.now();
    this.buffer = this.buffer.filter((entry) => entry.at >= now - 30_000);
    const message = { ...event, id: this.nextId++ };
    this.buffer.push(message);
    if (this.buffer.length > 50) this.buffer.splice(0, this.buffer.length - 50);
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber.send(message);
      } catch {
        this.subscribers.delete(subscriber);
        try {
          subscriber.close?.();
        } catch {
          // The stream is already gone.
        }
      }
    }
  }

  /**
   * Create one `text/event-stream` response for an authenticated browser.
   * @param {Request} request - Fetch request.
   * @returns {Response} streaming response.
   */
  subscribe(request) {
    const encoder = new TextEncoder();
    const state = this;
    let controller;
    let heartbeat;
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat !== undefined) clearInterval(heartbeat);
      if (controller) {
        try {
          controller.close();
        } catch {
          // The stream may already be closed by the carrier.
        }
      }
      if (subscriber) state.subscribers.delete(subscriber);
    };
    const subscriber = {
      send(event) {
        if (closed) return;
        const chunk = `id: ${event.id}\nevent: browser-notify\ndata: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      },
      close: cleanup,
    };

    const stream = new ReadableStream({
      start(inner) {
        controller = inner;
        state.subscribers.add(subscriber);
        controller.enqueue(encoder.encode('retry: 3000\n\nevent: ready\ndata: {"version":1}\n\n'));
        const lastId = Number(request.headers.get('last-event-id') ?? 0);
        if (Number.isFinite(lastId) && lastId > 0) {
          for (const event of state.buffer) {
            if (event.id > lastId) subscriber.send(event);
          }
        }
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            cleanup();
          }
        }, 10_000);
        request.signal?.addEventListener('abort', cleanup, { once: true });
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  /**
   * Close all SSE streams and reject future events.
   * @returns {void}
   */
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber.close?.();
      } catch {
        // Ignore a subscriber already gone.
      }
    }
    this.subscribers.clear();
    this.buffer = [];
  }
}
