/**
 * Persistent plugin state: UI-managed config overrides, muted workspaces, muted
 * sessions, and the last test result.
 *
 * The file lives under `$DSH_HOME/bark-push/state.json`. It is written with
 * mode 0600 and an atomic rename, and a malformed file is moved aside instead
 * of being silently overwritten. Reads are synchronous during activation so a
 * reload cannot briefly forget a mute; writes are serialized.
 *
 * @module dsh-bark-push/state
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

/** Current on-disk state format. */
export const STATE_VERSION = 1;

/** Bound for every persisted id list; a long-lived host must not grow forever. */
const MAX_IDS = 5000;

/** Bound for one stored id. Session ids and workspace ids are short. */
const MAX_ID_LENGTH = 200;

/**
 * Resolve the harness home without importing a DSH package.
 * @param {NodeJS.ProcessEnv} [env] - environment source.
 * @param {string} [home] - OS home override.
 * @returns {string} absolute harness home.
 */
export function resolveDshHome(env = process.env, home = homedir()) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  if (configured.length > 0) return resolve(configured);
  return join(home, '.dsh');
}

/**
 * Resolve the state-file path from plugin config.
 * @param {Record<string, unknown>} config - loader config.
 * @param {NodeJS.ProcessEnv} [env] - environment source.
 * @returns {string} absolute path.
 */
export function resolveStateFile(config, env = process.env) {
  const configured = typeof config?.stateFile === 'string' ? config.stateFile.trim() : '';
  if (configured.length > 0) {
    const expanded = configured.startsWith('~/') ? join(homedir(), configured.slice(2)) : configured;
    return isAbsolute(expanded) ? expanded : resolve(expanded);
  }
  return join(resolveDshHome(env), 'bark-push', 'state.json');
}

/**
 * Return a fresh empty state document.
 * @returns {{ version: number, config: object, mutedWorkspaces: string[], mutedSessions: string[], lastTest: object|null, updatedAt: number }} state.
 */
function emptyState() {
  return {
    version: STATE_VERSION,
    config: {},
    mutedWorkspaces: [],
    mutedSessions: [],
    lastTest: null,
    updatedAt: 0,
  };
}

/**
 * Normalize one string id.
 * @param {unknown} value - candidate.
 * @returns {string} trimmed id or an empty string.
 */
function idOf(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_ID_LENGTH ? trimmed : '';
}

/**
 * Normalize an id list.
 * @param {unknown} value - candidate list.
 * @returns {string[]} unique ids.
 */
function idsOf(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const id = idOf(item);
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

/**
 * Normalize one last-test record for persistence.
 * @param {unknown} value - candidate.
 * @returns {{ at: string, ok: boolean, results: Array<object> } | null} record.
 */
function testRecordOf(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = /** @type {Record<string, unknown>} */ (value);
  const results = Array.isArray(raw.results)
    ? raw.results.slice(0, 20).map((item) => {
        const entry = item !== null && typeof item === 'object' ? item : {};
        return {
          maskedKey: typeof entry.maskedKey === 'string' ? entry.maskedKey.slice(0, 64) : '',
          ok: entry.ok === true,
          status: Number.isFinite(entry.status) ? Number(entry.status) : null,
          attempts: Number.isFinite(entry.attempts) ? Number(entry.attempts) : null,
        };
      })
    : [];
  return {
    at: typeof raw.at === 'string' ? raw.at.slice(0, 40) : new Date().toISOString(),
    ok: raw.ok === true,
    results,
  };
}

/**
 * Validate one loaded document and fall back field by field.
 * @param {unknown} value - parsed JSON.
 * @returns {ReturnType<typeof emptyState>} normalized state.
 */
export function normalizeState(value) {
  const raw = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    version: STATE_VERSION,
    config: raw.config !== null && typeof raw.config === 'object' && !Array.isArray(raw.config) ? raw.config : {},
    mutedWorkspaces: idsOf(raw.mutedWorkspaces),
    mutedSessions: idsOf(raw.mutedSessions),
    lastTest: testRecordOf(raw.lastTest),
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : 0,
  };
}

/**
 * Serialized, crash-tolerant state store.
 */
export class StateStore {
  /**
   * @param {object} options - store options.
   * @param {string} options.file - absolute state-file path.
   * @param {{ info: Function, warn: Function, error: Function, debug: Function }} options.logger - redacting logger.
   */
  constructor({ file, logger }) {
    this.file = file;
    this.logger = logger;
    this.data = emptyState();
    this.mutedWorkspaces = new Set();
    this.mutedSessions = new Set();
    this.writeChain = Promise.resolve();
    this.loaded = false;
    this.mtimeMs = 0;
  }

  /**
   * Read the state file. Missing files are normal; malformed files are moved
   * aside so the next write cannot destroy evidence of the problem.
   * @returns {{ loaded: boolean, warnings: string[] }} load outcome.
   */
  loadSync() {
    const warnings = [];
    try {
      const text = readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(text);
      this.#adopt(normalizeState(parsed));
      this.loaded = true;
      this.mtimeMs = statSync(this.file).mtimeMs;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        this.loaded = true;
        return { loaded: true, warnings };
      }
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try {
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
        renameSync(this.file, backup);
        warnings.push(`状态文件无法解析，已移动到 ${backup}`);
      } catch (moveError) {
        warnings.push(`状态文件无法解析且无法移动：${moveError?.message ?? String(moveError)}`);
      }
      this.#adopt(emptyState());
      this.loaded = true;
    }
    return { loaded: true, warnings };
  }

  /**
   * Replace the in-memory view from a normalized state document.
   * @param {ReturnType<typeof emptyState>} state - normalized state.
   */
  #adopt(state) {
    this.data = state;
    this.mutedWorkspaces = new Set(state.mutedWorkspaces);
    this.mutedSessions = new Set(state.mutedSessions);
  }

  /**
   * Re-read the state file when another process (or a manual edit) changed it.
   * This keeps mute checks honest across DSH processes sharing one home and is
   * cheap enough to call immediately before a delivery decision.
   * @returns {boolean} whether a reload happened.
   */
  refreshSync() {
    try {
      const mtime = statSync(this.file).mtimeMs;
      if (mtime === this.mtimeMs) return false;
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      this.#adopt(normalizeState(parsed));
      this.mtimeMs = mtime;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return a detached snapshot for API responses.
   * @returns {object} snapshot with arrays instead of sets.
   */
  snapshot() {
    return {
      version: this.data.version,
      config: { ...this.data.config },
      mutedWorkspaces: [...this.mutedWorkspaces],
      mutedSessions: [...this.mutedSessions],
      lastTest: this.data.lastTest,
      updatedAt: this.data.updatedAt,
    };
  }

  /**
   * Whether a workspace or session is muted. Workspace mute wins by being
   * checked first; either level independently suppresses delivery.
   * @param {object} scope - mute scope.
   * @param {string} [scope.sessionId] - Session id.
   * @param {string} [scope.workspaceKey] - workspace id or `cwd:` fallback key.
   * @returns {boolean} whether delivery must be suppressed.
   */
  isMuted({ sessionId, workspaceKey } = {}) {
    if (workspaceKey && this.mutedWorkspaces.has(workspaceKey)) return true;
    if (sessionId && this.mutedSessions.has(sessionId)) return true;
    return false;
  }

  /**
   * Set one mute flag and persist.
   * @param {'workspace'|'session'} kind - mute level.
   * @param {string} id - workspace id or Session id.
   * @param {boolean} muted - desired state.
   * @returns {Promise<object>} snapshot after the write.
   */
  async setMuted(kind, id, muted) {
    const target = kind === 'workspace' ? this.mutedWorkspaces : this.mutedSessions;
    if (muted) target.add(id);
    else target.delete(id);
    await this.save({ config: this.data.config });
    return this.snapshot();
  }

  /**
   * Toggle one mute flag.
   * @param {'workspace'|'session'} kind - mute level.
   * @param {string} id - workspace id or Session id.
   * @returns {Promise<{ muted: boolean, state: object }>} new state.
   */
  async toggleMuted(kind, id) {
    const target = kind === 'workspace' ? this.mutedWorkspaces : this.mutedSessions;
    const next = !target.has(id);
    if (next) target.add(id);
    else target.delete(id);
    await this.save({ config: this.data.config });
    return { muted: next, state: this.snapshot() };
  }

  /**
   * Replace the UI-managed config overlay.
   * @param {object} config - complete overlay object.
   * @returns {Promise<object>} snapshot after the write.
   */
  async setConfig(config) {
    this.data.config = { ...config };
    await this.save();
    return this.snapshot();
  }

  /**
   * Clear every UI-managed config override; mute flags stay untouched.
   * @returns {Promise<object>} snapshot after the write.
   */
  async resetConfig() {
    this.data.config = {};
    await this.save();
    return this.snapshot();
  }

  /**
   * Remember one test result.
   * @param {object} result - sanitized test result.
   * @returns {Promise<void>} write completion.
   */
  async recordTest(result) {
    this.data.lastTest = testRecordOf(result);
    await this.save();
  }

  /**
   * Persist the current document atomically. Writes are serialized, and one
   * failed write does not poison the chain for later writes.
   * @param {object} [patch] - optional live state fields to persist.
   * @returns {Promise<void>} completion.
   */
  save(patch = {}) {
    if (patch.config !== undefined) this.data.config = { ...patch.config };
    this.data.mutedWorkspaces = [...this.mutedWorkspaces];
    this.data.mutedSessions = [...this.mutedSessions];
    this.data.version = STATE_VERSION;
    this.data.updatedAt = Date.now();
    const run = () => this.#write();
    this.writeChain = this.writeChain.then(run, run);
    return this.writeChain;
  }

  /**
   * Write one atomic snapshot.
   * @returns {Promise<void>} completion.
   */
  async #write() {
    const document = JSON.stringify(
      {
        version: STATE_VERSION,
        config: this.data.config,
        mutedWorkspaces: [...this.mutedWorkspaces],
        mutedSessions: [...this.mutedSessions],
        lastTest: this.data.lastTest,
        updatedAt: Date.now(),
      },
      null,
      2,
    );
    const directory = dirname(this.file);
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
    await writeFile(temporary, `${document}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => {});
    try {
      await rename(temporary, this.file);
    } catch (error) {
      // Windows cannot always replace an existing file in one rename.
      if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
        await rm(this.file, { force: true });
        await rename(temporary, this.file);
      } else {
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    }
  }

  /**
   * Read the state file asynchronously for tests and diagnostics.
   * @returns {Promise<object>} parsed document.
   */
  async readBack() {
    return JSON.parse(await readFile(this.file, 'utf8'));
  }
}
