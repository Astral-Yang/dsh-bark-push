/**
 * Configuration defaults, normalization, masking, and Bark endpoint helpers.
 *
 * The plugin deliberately avoids importing `@deepseek-ai/schemastery` or any
 * DSH package: an out-of-tree profile install only resolves the profile's own
 * `node_modules`, while the harness keeps its packages in the installation
 * tree. Every value is therefore validated here in plain JavaScript, and the
 * loader entry carries an ordinary object as `config`.
 *
 * @module dsh-bark-push/config
 */

import { generateChannelId, MAX_CHANNELS, providerFor } from './channels.js';

/** Bark notification levels accepted by the official server and most forks. */
export const LEVELS = Object.freeze(['active', 'timeSensitive', 'passive', 'critical']);

/** How a reply's Bark title is composed. */
export const TITLE_MODES = Object.freeze(['session', 'session-summary', 'summary']);

/** Pre-0.1.3 two-bucket keys, kept as migration fallbacks and hidden from the UI. */
export const LEGACY_CONFIG_KEYS = Object.freeze(['soundNormal', 'soundImportant', 'levelNormal', 'levelImportant']);

/** Hard safety bound for the number of device keys one installation may fan out to. */
export const MAX_DEVICE_KEYS = 20;

/** Hard safety bound for one device key. Bark keys are short; longer input is a mistake. */
export const MAX_DEVICE_KEY_LENGTH = 256;

/** Every configurable key, in the order the management page renders them. */
export const CONFIG_KEYS = Object.freeze([
  'enabled',
  'server',
  'deviceKeys',
  'channels',
  'group',
  'icon',
  'soundReply',
  'soundApproval',
  'soundQuestion',
  'levelReply',
  'levelApproval',
  'levelQuestion',
  'notifyOnReply',
  'notifyOnApproval',
  'notifyOnQuestion',
  'includeSubagents',
  'titlePrefix',
  'titleMode',
  'maxTitleLength',
  'maxBodyLength',
  'timeoutMs',
  'maxRetries',
  'retryDelayMs',
  'linkToSession',
  'publicBaseUrl',
  'trace',
  ...LEGACY_CONFIG_KEYS,
]);

/** Defaults used when neither the profile patch nor the state file supplies a value. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  server: 'https://api.day.app',
  deviceKeys: Object.freeze([]),
  channels: Object.freeze([]),
  group: 'DSH',
  icon: '',
  soundReply: '',
  soundApproval: '',
  soundQuestion: '',
  levelReply: 'active',
  levelApproval: 'timeSensitive',
  levelQuestion: 'active',
  notifyOnReply: true,
  notifyOnApproval: true,
  notifyOnQuestion: true,
  includeSubagents: false,
  titlePrefix: '',
  titleMode: 'session',
  maxTitleLength: 64,
  maxBodyLength: 1200,
  timeoutMs: 8000,
  maxRetries: 2,
  retryDelayMs: 500,
  linkToSession: true,
  publicBaseUrl: '',
  trace: false,
  soundNormal: '',
  soundImportant: '',
  levelNormal: 'active',
  levelImportant: 'timeSensitive',
});

/**
 * Return `value` when it is a plain object, otherwise an empty object.
 * @param {unknown} value - candidate value.
 * @returns {Record<string, unknown>} plain object view.
 */
export function objectOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * Normalize one boolean field.
 * @param {unknown} value - raw value.
 * @param {boolean} fallback - value used when the input is not a boolean.
 * @returns {boolean} normalized boolean.
 */
function booleanOf(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Normalize one finite number inside inclusive bounds.
 * @param {unknown} value - raw value.
 * @param {number} fallback - default value.
 * @param {number} min - inclusive minimum.
 * @param {number} max - inclusive maximum.
 * @returns {number} normalized integer.
 */
function integerInRange(value, fallback, min, max) {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.min(max, Math.max(min, numeric)));
}

/**
 * Normalize one short string field.
 * @param {unknown} value - raw value.
 * @param {string} fallback - default value.
 * @param {number} maxLength - maximum number of code points.
 * @returns {string} trimmed and bounded text.
 */
function textOf(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return Array.from(trimmed).slice(0, maxLength).join('');
}

/**
 * Normalize a Bark server root. The accepted forms are an origin plus optional
 * sub-path, optional trailing slash, and optional trailing `/push`.
 * Credentials, query strings, and fragments are rejected because they would be
 * logged or interpreted inconsistently by different Bark forks.
 * @param {unknown} value - raw server value.
 * @param {string} [fallback] - value used when invalid.
 * @returns {string} normalized server root without a trailing slash.
 */
export function normalizeServer(value, fallback = DEFAULTS.server) {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return fallback;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
  if (url.username || url.password || url.search || url.hash) return fallback;
  // Normalize the base root; `/push` is added by barkEndpoint(), never stored
  // twice so an operator can switch between root and full endpoint spellings.
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/push$/, '');
  return `${url.origin}${path}`;
}

/**
 * Build the POST endpoint for one normalized Bark server root.
 * @param {string} server - value produced by {@link normalizeServer}.
 * @returns {string} absolute `/push` endpoint.
 */
export function barkEndpoint(server) {
  const normalized = normalizeServer(server);
  return `${normalized}/push`;
}

/**
 * Mask a device key for display and logs. The full value is never returned by
 * this function, even for very short keys.
 * @param {string} key - device key.
 * @returns {string} masked label.
 */
export function maskDeviceKey(key) {
  const text = String(key ?? '');
  if (text.length === 0) return '';
  if (text.length <= 8) return `${text.slice(0, 1)}••••`;
  return `${text.slice(0, 4)}••••${text.slice(-2)}`;
}

/**
 * Normalize a list of device keys: trim, drop empties, deduplicate, bound the
 * count and each length.
 * @param {unknown} value - raw list.
 * @returns {string[]} normalized keys.
 */
export function normalizeDeviceKeys(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const keys = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const key = item.trim();
    if (key.length === 0 || key.length > MAX_DEVICE_KEY_LENGTH) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= MAX_DEVICE_KEYS) break;
  }
  return keys;
}

/**
 * Normalize an optional public base URL used for click-through links.
 * @param {unknown} value - raw value.
 * @param {string} [fallback] - previous value.
 * @returns {string} absolute http(s) URL or an empty string.
 */
export function normalizePublicBaseUrl(value, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return fallback;
  if (value.trim().length === 0) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

/**
 * Read a sound with the legacy two-bucket field as a migration fallback.
 * @param {unknown} value - new per-type value.
 * @param {unknown} legacy - pre-0.1.3 shared value.
 * @param {unknown} fallback - normalized base value.
 * @returns {string} normalized sound.
 */
function soundOf(value, legacy, fallback) {
  if (typeof value === 'string') return value.trim().slice(0, 64);
  if (typeof legacy === 'string') return legacy.trim().slice(0, 64);
  return typeof fallback === 'string' ? fallback : '';
}

/**
 * Read a level with the legacy two-bucket field as a migration fallback.
 * @param {unknown} value - new per-type value.
 * @param {unknown} legacy - pre-0.1.3 shared value.
 * @param {unknown} fallback - normalized base value.
 * @returns {string} normalized level.
 */
function levelOf(value, legacy, fallback) {
  if (LEVELS.includes(value)) return value;
  if (LEVELS.includes(legacy)) return legacy;
  return LEVELS.includes(fallback) ? fallback : 'active';
}

/**
 * Normalize one field value for a channel descriptor.
 * @param {object} field - descriptor field.
 * @param {unknown} raw - incoming value.
 * @param {unknown} stored - previously stored value, used for blank secrets.
 * @returns {unknown} normalized value.
 */
function normalizeChannelField(field, raw, stored) {
  if (field.kind === 'checkbox') {
    if (typeof raw === 'boolean') return raw;
    if (typeof stored === 'boolean') return stored;
    return field.default === true;
  }
  if (field.kind === 'number') {
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(numeric)) return field.default !== undefined ? String(field.default) : '';
    return String(Math.round(numeric));
  }
  const limit = field.kind === 'textarea' ? 4000 : 1000;
  let value = typeof raw === 'string' ? raw.trim() : typeof stored === 'string' ? stored : field.default !== undefined ? String(field.default) : '';
  if (value.length > limit) value = value.slice(0, limit);
  // A blank secret keeps the stored value so the browser never has to round-trip
  // a token it was never shown.
  if (field.kind === 'secret' && value.length === 0 && typeof stored === 'string') return stored;
  return value;
}

/**
 * Normalize the extra-channel list. Unknown types are dropped, ids are kept
 * stable where valid, and every value is bounded. A missing `channels` field
 * falls back to the previously normalized list so partial overlays never wipe
 * configured channels.
 * @param {unknown} value - raw channels array.
 * @param {unknown} base - previously normalized channels array.
 * @param {string[]} warnings - warning sink.
 * @returns {Array<object>} normalized channels.
 */
export function normalizeChannels(value, base = [], warnings = []) {
  const source = Array.isArray(value) ? value : Array.isArray(base) ? base : [];
  const baseById = new Map(
    (Array.isArray(base) ? base : []).filter((item) => item && typeof item.id === 'string').map((item) => [item.id, item]),
  );
  const out = [];
  const seen = new Set();
  for (const item of source) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const provider = providerFor(item.type);
    if (!provider) {
      if (typeof item.type === 'string' && item.type.length > 0) warnings.push(`未知渠道类型「${item.type}」，已忽略`);
      continue;
    }
    let id = typeof item.id === 'string' && /^ch_[A-Za-z0-9]+$/.test(item.id) ? item.id : generateChannelId();
    if (seen.has(id)) id = generateChannelId();
    seen.add(id);
    const storedConfig = baseById.get(id)?.config ?? {};
    const rawConfig = item.config !== null && typeof item.config === 'object' && !Array.isArray(item.config) ? item.config : {};
    const config = {};
    for (const field of provider.fields) {
      config[field.key] = normalizeChannelField(field, rawConfig[field.key], storedConfig[field.key]);
    }
    out.push({
      id,
      type: provider.type,
      label: typeof item.label === 'string' ? item.label.trim().slice(0, 64) : '',
      enabled: item.enabled !== false,
      config,
    });
    if (out.length >= MAX_CHANNELS) {
      if (source.length > MAX_CHANNELS) warnings.push(`渠道超过 ${MAX_CHANNELS} 个，仅保留前 ${MAX_CHANNELS} 个`);
      break;
    }
  }
  return out;
}

/**
 * Normalize a complete field set against an already-normalized base. The base
 * is always one produced by this module or {@link DEFAULTS}, so every fallback
 * has the right type.
 * @param {Record<string, unknown>} raw - raw fields.
 * @param {Record<string, unknown>} base - normalized fallback fields.
 * @param {string[]} warnings - warning sink.
 * @returns {Record<string, unknown>} normalized fields.
 */
function normalizeFields(raw, base, warnings) {
  const server = normalizeServer(raw.server ?? base.server, base.server);
  if (raw.server !== undefined && server !== normalizeServer(raw.server, '')) {
    warnings.push('server 无效，已回退到上一个有效值');
  }

  const keys = raw.deviceKeys !== undefined
    ? normalizeDeviceKeys(raw.deviceKeys)
    : raw.deviceKey !== undefined
      ? normalizeDeviceKeys([raw.deviceKey])
      : base.deviceKeys;

  if (Array.isArray(raw.deviceKeys) && raw.deviceKeys.length > MAX_DEVICE_KEYS) {
    warnings.push(`deviceKeys 超过 ${MAX_DEVICE_KEYS} 个，仅保留前 ${MAX_DEVICE_KEYS} 个`);
  }

  return {
    enabled: booleanOf(raw.enabled, base.enabled),
    server,
    deviceKeys: keys,
    channels: normalizeChannels(raw.channels, base.channels, warnings),
    group: textOf(raw.group, base.group, 64),
    icon: typeof raw.icon === 'string' ? raw.icon.trim().slice(0, 512) : base.icon,
    soundReply: soundOf(raw.soundReply, raw.soundNormal, base.soundReply),
    soundApproval: soundOf(raw.soundApproval, raw.soundImportant, base.soundApproval),
    soundQuestion: soundOf(raw.soundQuestion, raw.soundNormal, base.soundQuestion),
    levelReply: levelOf(raw.levelReply, raw.levelNormal, base.levelReply),
    levelApproval: levelOf(raw.levelApproval, raw.levelImportant, base.levelApproval),
    levelQuestion: levelOf(raw.levelQuestion, raw.levelNormal, base.levelQuestion),
    notifyOnReply: booleanOf(raw.notifyOnReply, base.notifyOnReply),
    notifyOnApproval: booleanOf(raw.notifyOnApproval, base.notifyOnApproval),
    notifyOnQuestion: booleanOf(raw.notifyOnQuestion, base.notifyOnQuestion),
    includeSubagents: booleanOf(raw.includeSubagents, base.includeSubagents),
    titlePrefix: typeof raw.titlePrefix === 'string' ? raw.titlePrefix.trim().slice(0, 32) : base.titlePrefix,
    titleMode: TITLE_MODES.includes(raw.titleMode) ? raw.titleMode : base.titleMode,
    maxTitleLength: integerInRange(raw.maxTitleLength, base.maxTitleLength, 8, 200),
    maxBodyLength: integerInRange(raw.maxBodyLength, base.maxBodyLength, 32, 4000),
    timeoutMs: integerInRange(raw.timeoutMs, base.timeoutMs, 1000, 30000),
    maxRetries: integerInRange(raw.maxRetries, base.maxRetries, 0, 5),
    retryDelayMs: integerInRange(raw.retryDelayMs, base.retryDelayMs, 50, 10000),
    linkToSession: booleanOf(raw.linkToSession, base.linkToSession),
    publicBaseUrl: normalizePublicBaseUrl(raw.publicBaseUrl, base.publicBaseUrl),
    trace: booleanOf(raw.trace, base.trace),
  };
}

/**
 * Normalize the package defaults once so every later fallback is well typed.
 * @returns {Record<string, unknown>} normalized defaults.
 */
function normalizedDefaults() {
  return normalizeFields({ ...DEFAULTS, deviceKeys: [...DEFAULTS.deviceKeys] }, DEFAULTS, []);
}

/** Normalized package defaults, shared by every call. */
const NORMALIZED_DEFAULTS = Object.freeze(normalizedDefaults());

/**
 * Normalize a complete config object.
 *
 * `base` supplies fallbacks, which lets the state-file overlay be normalized
 * against the profile patch: a field the user never edited keeps the patch
 * value instead of snapping back to the package default.
 * @param {unknown} input - raw config from the loader or the state file.
 * @param {object} [options] - normalization options.
 * @param {Record<string, unknown>} [options.base] - normalized fallback config.
 * @returns {{ config: Record<string, unknown>, warnings: string[] }} effective config and nonfatal notices.
 */
export function normalizeConfig(input, options = {}) {
  const raw = objectOf(input);
  const base = options.base === undefined ? NORMALIZED_DEFAULTS : objectOf(options.base);
  const warnings = [];
  return { config: normalizeFields(raw, { ...NORMALIZED_DEFAULTS, ...base }, warnings), warnings };
}

/**
 * Merge a validated overlay onto a base config without letting unknown keys in.
 * @param {Record<string, unknown>} base - profile-level config.
 * @param {unknown} overlay - state-file overrides.
 * @returns {{ config: Record<string, unknown>, warnings: string[] }} merged config.
 */
export function mergeConfig(base, overlay) {
  const raw = objectOf(overlay);
  const patch = {};
  for (const key of CONFIG_KEYS) {
    if (raw[key] !== undefined) patch[key] = raw[key];
  }
  return normalizeConfig({ ...base, ...patch }, { base });
}

/**
 * Project a config to the wire shape used by the management API. Device keys
 * are replaced by count and masked labels; the raw values never leave the host.
 * @param {Record<string, unknown>} config - effective config.
 * @returns {Record<string, unknown>} redacted config.
 */
export function publicConfig(config) {
  const source = objectOf(config);
  const keys = normalizeDeviceKeys(source.deviceKeys);
  const out = {};
  for (const key of CONFIG_KEYS) {
    if (key === 'deviceKeys' || key === 'channels' || LEGACY_CONFIG_KEYS.includes(key)) continue;
    out[key] = source[key];
  }
  out.deviceKeyCount = keys.length;
  out.deviceKeysMasked = keys.map((key) => maskDeviceKey(key));
  out.channels = publicChannels(normalizeChannels(source.channels, [], []));
  return out;
}

/**
 * Project channels without leaking secrets. Secret fields become empty strings
 * and a `secretsSet` map tells the page which ones are already stored.
 * @param {Array<object>} channels - normalized channels.
 * @returns {Array<object>} masked channels.
 */
export function publicChannels(channels) {
  return (Array.isArray(channels) ? channels : []).map((channel) => {
    const provider = providerFor(channel.type);
    const config = {};
    const secretsSet = {};
    for (const field of provider?.fields ?? []) {
      if (field.kind === 'secret') {
        const value = channel.config?.[field.key];
        secretsSet[field.key] = typeof value === 'string' && value.length > 0;
        config[field.key] = '';
      } else {
        config[field.key] = channel.config?.[field.key];
      }
    }
    return { id: channel.id, type: channel.type, label: channel.label, enabled: channel.enabled, config, secretsSet };
  });
}

/**
 * Extract only the config keys the management API may write.
 * @param {unknown} input - raw request body.
 * @returns {Record<string, unknown>} accepted patch.
 */
export function writableConfigPatch(input) {
  const raw = objectOf(input);
  const patch = {};
  for (const key of CONFIG_KEYS) {
    if (key === 'deviceKeys') continue;
    if (raw[key] !== undefined) patch[key] = raw[key];
  }
  return patch;
}
