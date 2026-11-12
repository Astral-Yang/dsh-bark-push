/**
 * dsh-bark-push — host entry.
 *
 * The plugin observes DSH's own seams instead of patching core code:
 *   - `session/event` for completed turns and approval audit events;
 *   - the `user-questions/request` waterfall for structured questions;
 *   - `ctx.connection.fetch` for the authenticated management API;
 *   - `ctx.workspaceRegistry` / `ctx.sessions` / `ctx.sessionTitle` for labels.
 *
 * Bark delivery is queued, timed out, retried, and fully isolated: a failing
 * Bark server never rejects an event handler or blocks the agent.
 *
 * @module dsh-bark-push
 */

import { readFileSync } from 'node:fs';

import { mergeConfig, normalizeConfig, objectOf, publicConfig } from './config.js';
import { BarkClient } from './bark.js';
import { installSessionBridge, installQuestionBridge } from './events.js';
import { installHttpRoutes, nextConfigOverlay } from './http.js';
import { Notifier } from './notifier.js';
import { SerialQueue } from './queue.js';
import { resolveStateFile, StateStore } from './state.js';

/** Package version, read from the shipped manifest so it cannot drift. */
const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = String(PACKAGE.version ?? '0.0.0');

/** Stable Cordis plugin name. */
export const name = 'dsh-bark-push';

/** No hard dependency: optional services are looked up lazily. */
export const inject = [];

/**
 * Build a small logger facade that tolerates a missing or unusual Cordis
 * logger. Diagnostics never contain message bodies or raw device keys.
 * @param {object} ctx - host context.
 * @returns {{ info: Function, warn: Function, error: Function, debug: Function }} logger.
 */
function createLogger(ctx) {
  const source = ctx?.logger;
  const call = (level, message) => {
    try {
      const method = source?.[level];
      if (typeof method === 'function') method.call(source, message);
    } catch {
      // Logging must never break delivery or the host.
    }
  };
  return {
    info: (message) => call('info', message),
    warn: (message) => call('warn', message),
    error: (message) => call('error', message),
    debug: (message) => call('debug', message),
  };
}

/**
 * Read the plugin version from the package manifest when available. A failure
 * falls back to {@link VERSION}; version reporting is never worth a boot error.
 * @returns {string} version.
 */
function packageVersion() {
  return VERSION;
}

/**
 * Apply the plugin.
 * @param {object} ctx - host Cordis context.
 * @param {unknown} config - loader-entry config; every field is optional.
 * @returns {void}
 */
export function apply(ctx, config) {
  const logger = createLogger(ctx);
  const rawConfig = objectOf(config);
  const warnings = [];

  const boot = normalizeConfig(rawConfig);
  warnings.push(...boot.warnings);
  const baseConfig = boot.config;

  const stateFile = resolveStateFile(rawConfig);
  const state = new StateStore({ file: stateFile, logger });
  const loadResult = state.loadSync();
  warnings.push(...loadResult.warnings);
  for (const warning of loadResult.warnings) logger.warn(`bark-push: ${warning}`);

  let effective = mergeConfig(baseConfig, state.snapshot().config).config;
  const abort = new AbortController();

  const reload = () => {
    const merged = mergeConfig(baseConfig, state.snapshot().config);
    effective = merged.config;
    if (merged.warnings.length > 0) {
      warnings.push(...merged.warnings);
      for (const warning of merged.warnings) logger.warn(`bark-push: ${warning}`);
    }
  };
  reload();

  /** @returns {Record<string, unknown>} current effective config. */
  const getConfig = () => effective;

  const queue = new SerialQueue({ concurrency: 1, limit: 100, logger });
  const bark = new BarkClient({ getConfig, logger, signal: abort.signal });
  const notifier = new Notifier({
    ctx,
    getConfig,
    state,
    bark,
    queue,
    logger,
    version: packageVersion(),
  });

  /** @type {Array<() => void>} */
  const disposers = [];
  disposers.push(
    installSessionBridge(ctx, {
      notifier,
      getConfig,
      logger,
    }),
  );
  disposers.push(installQuestionBridge(ctx, { notifier, logger }));

  const runtime = {
    version: packageVersion(),
    getConfig,
    getState: () => state.snapshot(),
    warnings: () => [...new Set(warnings)],
    lastDelivery: () => notifier.lastDelivery,
    /**
     * Persist a management-page config write, then reload the effective values.
     * @param {Record<string, unknown>} body - request body.
     * @returns {Promise<void>} completion.
     */
    async updateConfig(body) {
      const snapshot = state.snapshot();
      const current = getConfig();
      if (body?.reset === true) {
        // Credentials are the one thing a "restore defaults" action must not
        // silently destroy: keep configured keys unless the caller clears them.
        const keys = Array.isArray(current.deviceKeys) ? current.deviceKeys : [];
        await state.setConfig(keys.length > 0 ? { deviceKeys: keys } : {});
      } else {
        const next = nextConfigOverlay(snapshot.config, body, current);
        await state.setConfig(next.overlay);
      }
      reload();
      logger.info('bark-push: 配置已更新');
    },
    /**
     * Set one mute flag.
     * @param {'workspace'|'session'} kind - mute level.
     * @param {string} id - target id.
     * @param {boolean} muted - desired state.
     * @returns {Promise<void>} completion.
     */
    async setMute(kind, id, muted) {
      await state.setMuted(kind, id, muted);
    },
    /**
     * Toggle one mute flag.
     * @param {'workspace'|'session'} kind - mute level.
     * @param {string} id - target id.
     * @returns {Promise<{ muted: boolean }>} new value.
     */
    async toggleMute(kind, id) {
      const result = await state.toggleMuted(kind, id);
      return { muted: result.muted };
    },
    /** @returns {Promise<object>} sanitized test outcome. */
    test: () => notifier.test(),
  };

  // The management API is optional: headless compositions have no browser
  // connection, and notifications still work without an HTTP surface.
  ctx.inject(['connection'], (scope) => {
    scope.effect(
      () => installHttpRoutes(scope, runtime, ctx),
      'bark-push: authenticated management routes',
    );
  });

  ctx.effect(
    () => () => {
      abort.abort();
      queue.dispose();
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          // Listener removal is best effort during teardown.
        }
      }
    },
    'bark-push: lifecycle',
  );

  const configSummary = publicConfig(effective);
  if (effective.enabled !== true) {
    logger.info('bark-push: 已加载，但总开关处于关闭状态');
  } else if (configSummary.deviceKeyCount === 0) {
    logger.warn('bark-push: 已加载，但尚未配置 Device Key；打开设置页或 cordis.patch.yml 配置后才会推送');
  } else {
    logger.info(
      `bark-push: 已启用（group=${effective.group}，设备 ${configSummary.deviceKeyCount} 个，状态文件 ${stateFile}）`,
    );
  }
}

export default { name, inject, apply, VERSION };
