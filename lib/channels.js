/**
 * Multi-channel push registry and generic sender.
 *
 * Bark remains the primary, first-class channel (see `bark.js` and the flat
 * `server` / `deviceKeys` config). Everything here adds *additional* channels
 * that receive the same formatted note (`{ title, body, kind, url }`):
 *
 *   - Self-hosted push: Gotify, ntfy.
 *   - Chinese push services: PushDeer, Server酱 ServerChan, PushPlus.
 *   - An extra Bark server and a fully generic Webhook.
 *
 * Every provider is a small descriptor: `fields` drive the management UI and
 * normalization, `build` turns a note into an HTTP request, and `check` reads
 * the provider's own success convention. Adding a channel is one entry in
 * {@link PROVIDERS}; nothing else needs to change.
 *
 * This module intentionally imports no other project file, so it stays a
 * dependency-free leaf that both `config.js` (for field descriptors) and the
 * runtime (for delivery) can share without a cycle.
 *
 * @module dsh-bark-push/channels
 */

/** Hard bound on configured extra channels. */
export const MAX_CHANNELS = 20;

/** Marker shown by the UI when a secret is already stored (never the value). */
export const MASKED_SECRET = '••••••••';

/**
 * JSON.parse that never throws.
 * @param {string} text - raw response body.
 * @returns {any} parsed value or null.
 */
function parseJson(text) {
  try {
    return String(text ?? '').length > 0 ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * Join a base URL and one path fragment without doubling or dropping slashes.
 * @param {string} base - server root.
 * @param {string} path - path fragment.
 * @returns {string} joined URL.
 */
function joinUrl(base, path) {
  return `${String(base ?? '').replace(/\/+$/, '')}/${String(path ?? '').replace(/^\/+/, '')}`;
}

/**
 * Truncate a string by code points.
 * @param {string} value - source.
 * @param {number} limit - maximum code points.
 * @returns {string} bounded string.
 */
function clamp(value, limit) {
  const chars = Array.from(String(value ?? ''));
  return chars.length > limit ? chars.slice(0, limit).join('') : String(value ?? '');
}

/**
 * A short human title for a channel instance.
 * @param {object} channel - channel instance.
 * @param {string} [fallback] - fallback name.
 * @returns {string} label.
 */
export function channelLabel(channel, fallback = '渠道') {
  if (channel && typeof channel.label === 'string' && channel.label.trim().length > 0) return channel.label.trim();
  const provider = PROVIDERS.find((entry) => entry.type === channel?.type);
  return provider ? provider.name : fallback;
}

/**
 * Build a fresh channel id. The pattern matches the ones the UI generates.
 * @returns {string} channel id.
 */
export function generateChannelId() {
  return `ch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Provider descriptors.
 *
 * Field shape:
 *   { key, label, kind, required?, placeholder?, options?, default?, help? }
 * `kind` is one of text | secret | url | textarea | select | checkbox | number.
 * `secret` values are never returned to the browser; an empty value on save
 * keeps the stored one.
 */
const PROVIDERS = [
  {
    type: 'gotify',
    name: 'Gotify',
    summary: '自建 Gotify 服务器',
    fields: [
      { key: 'server', label: '服务器地址', kind: 'url', required: true, placeholder: 'https://gotify.example.com' },
      { key: 'token', label: '应用 Token', kind: 'secret', required: true, placeholder: 'A…' },
      { key: 'priority', label: '优先级（0-10）', kind: 'number', default: '5' },
    ],
    build(config, note) {
      const priority = Math.max(0, Math.min(10, Number(config.priority) || 5));
      return {
        url: `${joinUrl(config.server, 'message')}?token=${encodeURIComponent(config.token)}`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: note.title, message: note.body, priority }),
      };
    },
    check(status, text) {
      if (status >= 200 && status < 300) return { ok: true };
      return { ok: false, message: clamp(text, 200) || `HTTP ${status}` };
    },
  },
  {
    type: 'ntfy',
    name: 'ntfy',
    summary: 'ntfy 主题推送（公共或自建）',
    fields: [
      { key: 'server', label: '服务器地址', kind: 'url', default: 'https://ntfy.sh', placeholder: 'https://ntfy.sh' },
      { key: 'topic', label: '主题 Topic', kind: 'text', required: true, placeholder: 'my-dsh-alerts' },
      { key: 'token', label: '访问 Token（可选）', kind: 'secret', placeholder: 'tk_…' },
    ],
    build(config, note) {
      const headers = { 'content-type': 'application/json' };
      if (typeof config.token === 'string' && config.token.length > 0) headers.authorization = `Bearer ${config.token}`;
      return {
        url: config.server || 'https://ntfy.sh',
        method: 'POST',
        headers,
        body: JSON.stringify({ topic: config.topic, title: note.title, message: note.body, priority: 3 }),
      };
    },
    check(status, text) {
      if (status >= 200 && status < 300) return { ok: true };
      return { ok: false, message: clamp(text, 200) || `HTTP ${status}` };
    },
  },
  {
    type: 'pushdeer',
    name: 'PushDeer',
    summary: 'PushDeer 推送',
    fields: [
      { key: 'server', label: '服务器地址', kind: 'url', default: 'https://api2.pushdeer.com', placeholder: 'https://api2.pushdeer.com' },
      { key: 'pushKey', label: 'PushKey', kind: 'secret', required: true, placeholder: 'PDU…' },
    ],
    build(config, note) {
      return {
        url: joinUrl(config.server || 'https://api2.pushdeer.com', 'message/push'),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pushkey: config.pushKey, text: note.title, desp: note.body, type: 'markdown' }),
      };
    },
    check(status, text) {
      const json = parseJson(text);
      if (json && json.code === 0) return { ok: true };
      return { ok: false, message: json?.error || clamp(text, 200) || `HTTP ${status}` };
    },
  },
  {
    type: 'serverchan',
    name: 'Server酱',
    summary: 'Server酱³ (ServerChan) 推送',
    fields: [
      { key: 'sendKey', label: 'SendKey', kind: 'secret', required: true, placeholder: 'SCT…' },
    ],
    build(config, note) {
      return {
        url: `https://sctapi.ftqq.com/${encodeURIComponent(config.sendKey)}.send`,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title: note.title, desp: note.body }).toString(),
      };
    },
    check(status, text) {
      const json = parseJson(text);
      if (json && (json.code === 0 || json.errno === 0)) return { ok: true };
      return { ok: false, message: json?.message || clamp(text, 200) || `HTTP ${status}` };
    },
  },
  {
    type: 'pushplus',
    name: 'PushPlus',
    summary: 'PushPlus (推送加) 推送',
    fields: [
      { key: 'token', label: 'Token', kind: 'secret', required: true, placeholder: '推送加 token' },
    ],
    build(config, note) {
      return {
        url: 'https://www.pushplus.plus/send',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: config.token, title: note.title, content: note.body, template: 'txt' }),
      };
    },
    check(status, text) {
      const json = parseJson(text);
      if (json && (json.code === 200 || json.code === 0)) return { ok: true };
      return { ok: false, message: json?.msg || clamp(text, 200) || `HTTP ${status}` };
    },
  },
  {
    type: 'bark',
    name: 'Bark（额外服务器）',
    summary: '再接入一台 Bark 服务器 / 另一组 Device Key',
    fields: [
      { key: 'server', label: 'Bark Server', kind: 'url', default: 'https://api.day.app', placeholder: 'https://api.day.app' },
      { key: 'deviceKey', label: 'Device Key', kind: 'secret', required: true, placeholder: '设备密钥' },
      { key: 'group', label: '分组 Group', kind: 'text', default: 'DSH', placeholder: 'DSH' },
      { key: 'level', label: '级别', kind: 'select', default: 'active', options: [
        { value: 'active', label: '主动通知 active' },
        { value: 'timeSensitive', label: '时效性 timeSensitive' },
        { value: 'passive', label: '静默 passive' },
        { value: 'critical', label: '紧急 critical' },
      ] },
    ],
    build(config, note) {
      const server = String(config.server || 'https://api.day.app').replace(/\/+$/, '').replace(/\/push$/, '');
      const payload = { device_key: config.deviceKey, title: note.title, body: note.body, group: config.group || 'DSH' };
      if (typeof config.level === 'string' && config.level.length > 0) payload.level = config.level;
      if (typeof note.url === 'string' && note.url.length > 0) payload.url = note.url;
      return {
        url: `${server}/push`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      };
    },
    check(status, text) {
      const json = parseJson(text);
      if (json && (json.code === 200 || json.code === null)) return { ok: true };
      if (status >= 200 && status < 300 && (!json || json.code === undefined)) return { ok: true };
      return { ok: false, message: json?.message || `HTTP ${status}` };
    },
  },
  {
    type: 'webhook',
    name: '自定义 Webhook',
    summary: '把通知 POST 到你自己的任意 HTTP 接口',
    fields: [
      { key: 'url', label: 'URL', kind: 'url', required: true, placeholder: 'https://example.com/hook' },
      { key: 'method', label: '请求方法', kind: 'select', default: 'POST', options: [
        { value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }, { value: 'GET', label: 'GET' },
      ] },
      { key: 'contentType', label: '内容类型', kind: 'select', default: 'application/json', options: [
        { value: 'application/json', label: 'application/json' },
        { value: 'application/x-www-form-urlencoded', label: 'x-www-form-urlencoded' },
        { value: 'text/plain', label: 'text/plain' },
      ] },
      { key: 'headers', label: '自定义请求头（JSON，可选）', kind: 'textarea', placeholder: '{"Authorization":"Bearer …"}' },
      { key: 'bodyTemplate', label: '请求体模板（可选）', kind: 'textarea', placeholder: '{"title":"{{title}}","body":"{{body}}","kind":"{{kind}}","url":"{{url}}"}' },
    ],
    build(config, note) {
      const method = ['POST', 'PUT', 'GET'].includes(config.method) ? config.method : 'POST';
      const contentType = typeof config.contentType === 'string' && config.contentType.length > 0 ? config.contentType : 'application/json';
      const values = { title: note.title, body: note.body, kind: note.kind, url: note.url };
      const template = typeof config.bodyTemplate === 'string' && config.bodyTemplate.trim().length > 0
        ? config.bodyTemplate
        : '{"title":"{{title}}","body":"{{body}}","kind":"{{kind}}","url":"{{url}}"}';
      const escape = contentType.includes('json')
        ? (value) => JSON.stringify(String(value ?? '')).slice(1, -1)
        : contentType.includes('x-www-form-urlencoded')
          ? (value) => encodeURIComponent(String(value ?? ''))
          : (value) => String(value ?? '');
      let body = template.replace(/\{\{\s*(title|body|kind|url)\s*\}\}/g, (_, key) => escape(values[key]));
      const headers = { 'content-type': contentType };
      if (typeof config.headers === 'string' && config.headers.trim().length > 0) {
        const extra = parseJson(config.headers);
        if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
          for (const [key, value] of Object.entries(extra)) {
            if (typeof value === 'string' || typeof value === 'number') headers[key] = String(value);
          }
        }
      }
      let url = config.url;
      if (method === 'GET') {
        if (body.trim().length > 0) url += (url.includes('?') ? '&' : '?') + body;
        return { url, method, headers, body: undefined };
      }
      return { url, method, headers, body };
    },
    check(status) {
      if (status >= 200 && status < 300) return { ok: true };
      return { ok: false, message: `HTTP ${status}` };
    },
  },
];

/** Look up one provider by type. */
export function providerFor(type) {
  return PROVIDERS.find((entry) => entry.type === type);
}

/**
 * The descriptor subset the management page needs, with no functions.
 * @returns {Array<object>} channel type summaries.
 */
export function channelTypeSummaries() {
  return PROVIDERS.map((entry) => ({
    type: entry.type,
    name: entry.name,
    summary: entry.summary,
    fields: entry.fields.map((field) => ({ ...field })),
  }));
}

/**
 * A value that must be present before this channel can send.
 * @param {object} channel - normalized channel.
 * @returns {{ ok: boolean, missing?: string }} whether the channel is complete.
 */
export function channelReady(channel) {
  const provider = providerFor(channel?.type);
  if (!provider) return { ok: false, missing: '未知渠道类型' };
  const config = channel.config ?? {};
  for (const field of provider.fields) {
    if (field.required !== true) continue;
    if (typeof config[field.key] !== 'string' || config[field.key].trim().length === 0) {
      return { ok: false, missing: field.label };
    }
  }
  return { ok: true };
}

/**
 * Build the HTTP request for one channel + note.
 * @param {object} channel - normalized channel.
 * @param {object} note - `{ title, body, kind, url? }`.
 * @returns {{ url: string, method: string, headers: object, body?: string }} request.
 */
export function buildChannelRequest(channel, note) {
  const provider = providerFor(channel?.type);
  if (!provider) throw new Error(`未知渠道类型：${channel?.type}`);
  const ready = channelReady(channel);
  if (!ready.ok) throw new Error(`渠道缺少必填项：${ready.missing}`);
  return provider.build(channel.config ?? {}, note);
}

/**
 * Interpret one channel's HTTP response.
 * @param {string} type - provider type.
 * @param {number} status - HTTP status.
 * @param {string} text - response body.
 * @returns {{ ok: boolean, message?: string }} verdict.
 */
export function checkChannelResponse(type, status, text) {
  const provider = providerFor(type);
  if (!provider) return { ok: false, message: '未知渠道类型' };
  return provider.check(status, text);
}

/**
 * Default delay used by the sender between retries.
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
 * Delivers notes to every enabled extra channel, isolated per channel with the
 * same bounded timeout / retry policy as the Bark client.
 */
export class ChannelSender {
  /**
   * @param {object} options - sender options.
   * @param {() => Record<string, unknown>} options.getConfig - effective config.
   * @param {{ warn: Function, debug: Function }} options.logger - redacting logger.
   * @param {typeof fetch} [options.fetchImpl] - injectable fetch.
   * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [options.sleepImpl] - injectable delay.
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
   * Channels that are enabled and known.
   * @returns {Array<object>} enabled channels.
   */
  #enabled() {
    const config = this.getConfig();
    const list = Array.isArray(config.channels) ? config.channels : [];
    return list.filter((channel) => channel && channel.enabled !== false && providerFor(channel.type));
  }

  /**
   * Whether any extra channel would receive a note.
   * @returns {boolean} true when at least one channel is enabled.
   */
  hasEnabled() {
    return this.#enabled().length > 0;
  }

  /**
   * Send a note to every enabled channel.
   * @param {object} note - `{ title, body, kind, url? }`.
   * @returns {Promise<{ ok: boolean, skipped?: boolean, results: Array<object> }>} outcome.
   */
  async send(note) {
    const channels = this.#enabled();
    if (channels.length === 0) return { ok: true, skipped: true, reason: 'no-channels', results: [] };
    const results = [];
    for (const channel of channels) results.push(await this.#sendOne(channel, note));
    return { ok: results.every((result) => result.ok === true), results };
  }

  /**
   * Send a note to one channel by id (used by the per-channel test button).
   * @param {string} id - channel id.
   * @param {object} note - note.
   * @returns {Promise<object>} result.
   */
  async testOne(id, note) {
    const config = this.getConfig();
    const list = Array.isArray(config.channels) ? config.channels : [];
    const channel = list.find((entry) => entry && entry.id === id);
    if (!channel) return { ok: false, skipped: true, reason: 'channel-not-found', results: [] };
    const result = await this.#sendOne(channel, note);
    return { ok: result.ok === true, results: [result] };
  }

  /**
   * Send one note to one channel with bounded retries.
   * @param {object} channel - channel instance.
   * @param {object} note - note.
   * @returns {Promise<object>} per-channel result.
   */
  async #sendOne(channel, note) {
    const base = {
      channelId: channel.id,
      channelType: channel.type,
      label: channelLabel(channel),
      ok: false,
      status: null,
      attempts: 0,
    };
    let request;
    try {
      request = buildChannelRequest(channel, note);
    } catch (error) {
      return { ...base, skipped: true, reason: error?.message ?? String(error), message: error?.message ?? String(error) };
    }
    const config = this.getConfig();
    const maxRetries = Math.max(0, Math.min(5, Number(config.maxRetries) || 0));
    const timeoutMs = Math.max(1000, Math.min(30000, Number(config.timeoutMs) || 8000));
    let last = { ...base, message: 'not sent' };

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (this.signal?.aborted) {
        last = { ...base, message: 'aborted', attempts: attempt };
        break;
      }
      const started = Date.now();
      try {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const signal = this.signal ? AbortSignal.any([this.signal, timeoutSignal]) : timeoutSignal;
        const response = await this.fetchImpl(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal,
        });
        const text = await response.text().catch(() => '');
        const verdict = checkChannelResponse(channel.type, response.status, text);
        last = {
          ...base,
          ok: verdict.ok === true && response.status >= 200 && response.status < 300,
          status: response.status,
          attempts: attempt + 1,
          ms: Date.now() - started,
          message: verdict.message ?? '',
        };
        if (last.ok) {
          this.logger?.debug?.(`bark-push: 渠道 ${base.label} 推送成功（HTTP ${response.status}，${last.ms}ms）`);
          return last;
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= maxRetries) break;
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        last = { ...base, message: timedOut ? '请求超时' : (error?.message ?? String(error)), attempts: attempt + 1, ms: Date.now() - started };
        if (attempt >= maxRetries || this.signal?.aborted) break;
      }
      const delayBase = Math.max(50, Math.min(10000, Number(config.retryDelayMs) || 500));
      const delay = Math.min(10000, delayBase * 2 ** attempt + Math.floor(this.random() * delayBase));
      try {
        await this.sleepImpl(delay, this.signal);
      } catch {
        last = { ...last, message: 'aborted', ok: false };
        break;
      }
    }

    const now = Date.now();
    if (now - this.lastWarnAt > 60_000) {
      this.lastWarnAt = now;
      this.logger?.warn?.(`bark-push: 渠道 ${base.label} 推送失败（${last.message}，尝试 ${last.attempts} 次）`);
    }
    return { ...last, ok: false };
  }
}
