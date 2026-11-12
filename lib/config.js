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

/** Bark notification levels accepted by the official server and most forks. */
export const LEVELS = Object.freeze(['active', 'timeSensitive', 'passive', 'critical']);

/** How a reply's Bark title is composed. */
export const TITLE_MODES = Object.freeze(['session', 'session-summary', 'summary']);

/** Hard safety bound for the number of device keys one installation may fan out to. */
export const MAX_DEVICE_KEYS = 20;

/** Hard safety bound for one device key. Bark keys are short; longer input is a mistake. */
export const MAX_DEVICE_KEY_LENGTH = 256;

/** Every configurable key, in the order the management page renders them. */
export const CONFIG_KEYS = Object.freeze([
  'enabled',
  'server',
  'deviceKeys',
  'group',
  'icon',
  'soundNormal',
  'soundImportant',
  'levelNormal',
  'levelImportant',
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
]);

/** Defaults used when neither the profile patch nor the state file supplies a value. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  server: 'https://api.day.app',
  deviceKeys: Object.freeze([]),
  group: 'DSH',
  icon: '',
  soundNormal: '',
  soundImportant: '',
  levelNormal: 'active',
  levelImportant: 'timeSensitive',
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
    group: textOf(raw.group, base.group, 64),
    icon: typeof raw.icon === 'string' ? raw.icon.trim().slice(0, 512) : base.icon,
    soundNormal: typeof raw.soundNormal === 'string' ? raw.soundNormal.trim().slice(0, 64) : base.soundNormal,
    soundImportant:
      typeof raw.soundImportant === 'string' ? raw.soundImportant.trim().slice(0, 64) : base.soundImportant,
    levelNormal: LEVELS.includes(raw.levelNormal) ? raw.levelNormal : base.levelNormal,
    levelImportant: LEVELS.includes(raw.levelImportant) ? raw.levelImportant : base.levelImportant,
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
    if (key === 'deviceKeys') continue;
    out[key] = source[key];
  }
  out.deviceKeyCount = keys.length;
  out.deviceKeysMasked = keys.map((key) => maskDeviceKey(key));
  return out;
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
