/**
 * Minimal Bark HTTP client: POST `/push`, bounded retries, bounded timeout, and
 * redacted diagnostics.
 *
 * @module dsh-bark-push/bark
 */

import { barkEndpoint, maskDeviceKey } from './config.js';

/**
 * Remove a secret from a diagnostic string.
 * @param {unknown} value - raw text.
 * @param {string} secret - value that must not escape.
 * @param {number} [limit] - maximum result length.
 * @returns {string} sanitized text.
 */
export function sanitizeMessage(value, secret, limit = 200) {
  let text = typeof value === 'string' ? value : String(value ?? '');
  if (secret.length > 0) text = text.split(secret).join('••••');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * Default sleep used between retry attempts.
 * @param {number} ms - delay.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns {Promise<void>} resolved after the delay.
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * Bark push client.
 */
export class BarkClient {
  /**
   * @param {object} options - client options.
   * @param {() => Record<string, unknown>} options.getConfig - current effective config.
   * @param {{ info: Function, warn: Function, error: Function, debug: Function }} options.logger - redacting logger.
   * @param {typeof fetch} [options.fetchImpl] - fetch implementation, injectable for tests.
   * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [options.sleepImpl] - delay, injectable for tests.
   * @param {() => number} [options.random] - jitter source.
   * @param {AbortSignal} [options.signal] - plugin-lifetime cancellation.
   */
  constructor({ getConfig, logger, fetchImpl = globalThis.fetch, sleepImpl = sleep, random = Math.random, signal }) {
    this.getConfig = getConfig;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
    this.random = random;
    this.signal = signal;
    this.lastWarnAt = 0;
  }

  /**
   * Send one note to every configured device key. A disabled plugin or a
   * missing key is a skip, not an error; `force` bypasses only `enabled`.
   * @param {object} note - formatted note.
   * @param {string} note.title - notification title.
   * @param {string} note.body - notification body.
   * @param {'reply'|'approval'|'question'|'test'} note.kind - notification kind.
   * @param {object} [options] - send options.
   * @param {boolean} [options.force] - send even when the global switch is off.
   * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, results: Array<object> }>} outcome.
   */
  async send(note, options = {}) {
    const config = this.getConfig();
    if (options.force !== true && config.enabled !== true) {
      return { ok: false, skipped: true, reason: 'disabled', results: [] };
    }
    const keys = Array.isArray(config.deviceKeys) ? config.deviceKeys : [];
    if (keys.length === 0) {
      return { ok: false, skipped: true, reason: 'no-device-key', results: [] };
    }
    const results = [];
    for (const key of keys) {
      results.push(await this.#sendOne(config, key, note));
    }
    const ok = results.length > 0 && results.every((result) => result.ok === true);
    return { ok, results };
  }

  /**
   * Send one note to one device key with bounded retries.
   * @param {Record<string, unknown>} config - effective config.
   * @param {string} key - device key.
   * @param {object} note - formatted note.
   * @returns {Promise<object>} per-key result.
   */
  async #sendOne(config, key, note) {
    const masked = maskDeviceKey(key);
    const endpoint = barkEndpoint(String(config.server ?? ''));
    const profile = note.kind === 'approval'
      ? { level: config.levelApproval, sound: config.soundApproval }
      : note.kind === 'question'
        ? { level: config.levelQuestion, sound: config.soundQuestion }
        : { level: config.levelReply, sound: config.soundReply };
    const level = profile.level;
    const sound = profile.sound;
    const payload = {
      device_key: key,
      title: note.title,
      body: note.body,
      group: config.group,
      level,
    };
    if (typeof config.icon === 'string' && config.icon.length > 0) payload.icon = config.icon;
    if (typeof sound === 'string' && sound.length > 0) payload.sound = sound;
    if (typeof note.url === 'string' && note.url.length > 0) payload.url = note.url;

    const maxRetries = Math.max(0, Math.min(5, Number(config.maxRetries) || 0));
    const timeoutMs = Math.max(1000, Math.min(30000, Number(config.timeoutMs) || 8000));
    let last = { ok: false, status: null, code: null, message: 'not sent', attempts: 0 };

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (this.signal?.aborted) {
        last = { ok: false, status: null, code: null, message: 'aborted', attempts: attempt };
        break;
      }
      const started = Date.now();
      try {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const signal = this.signal ? AbortSignal.any([this.signal, timeoutSignal]) : timeoutSignal;
        const response = await this.fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
            accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal,
        });
        const raw = await response.text().catch(() => '');
        let parsed = null;
        try {
          parsed = raw.length > 0 ? JSON.parse(raw) : null;
        } catch {
          parsed = null;
        }
        const code = parsed !== null && typeof parsed === 'object' && Number.isFinite(parsed.code) ? Number(parsed.code) : null;
        const ok = response.ok && (code === null || code === 200);
        const message = sanitizeMessage(
          parsed !== null && typeof parsed === 'object' && typeof parsed.message === 'string'
            ? parsed.message
            : `HTTP ${response.status}`,
          key,
        );
        last = { ok, status: response.status, code, message, attempts: attempt + 1, ms: Date.now() - started };

        if (ok) {
          this.logger?.debug?.(`bark-push: 推送成功（${masked}，HTTP ${response.status}，${last.ms}ms）`);
          return { ...last, maskedKey: masked };
        }

        const retryable = response.status === 429 || response.status >= 500 || (code !== null && code >= 500);
        if (!retryable || attempt >= maxRetries) break;
        this.logger?.debug?.(`bark-push: 推送失败（${masked}，HTTP ${response.status}），准备重试`);
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        last = {
          ok: false,
          status: null,
          code: null,
          message: sanitizeMessage(timedOut ? '请求超时' : error?.message ?? String(error), key),
          attempts: attempt + 1,
          ms: Date.now() - started,
        };
        if (attempt >= maxRetries || this.signal?.aborted) break;
        this.logger?.debug?.(`bark-push: 推送异常（${masked}：${last.message}），准备重试`);
      }

      const base = Math.max(50, Math.min(10000, Number(config.retryDelayMs) || 500));
      const delay = Math.min(10000, base * 2 ** attempt + Math.floor(this.random() * base));
      try {
        await this.sleepImpl(delay, this.signal);
      } catch {
        last = { ...last, message: 'aborted', ok: false };
        break;
      }
    }

    // A down server can fail every queued event; keep the diagnosis but do not
    // turn an outage into a log flood.
    const now = Date.now();
    if (now - this.lastWarnAt > 60_000) {
      this.lastWarnAt = now;
      this.logger?.warn?.(
        `bark-push: 推送失败（${masked}：${last.message}，尝试 ${last.attempts} 次）`,
      );
    }
    return { ...last, maskedKey: masked, ok: false };
  }
}
