/**
 * Test helpers: a minimal Cordis-like host context, a temporary state
 * directory, and a local HTTP capture server.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

/**
 * Create a temp directory cleaned by the returned disposer.
 * @returns {Promise<{ dir: string, cleanup: () => Promise<void> }>} temp dir.
 */
export async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bark-push-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Minimal logger that records redacted diagnostics.
 * @returns {{ info: Function, warn: Function, error: Function, debug: Function, lines: string[] }} logger.
 */
export function createLogger() {
  const lines = [];
  const push = (level) => (message) => lines.push(`${level}: ${message}`);
  return { info: push('info'), warn: push('warn'), error: push('error'), debug: push('debug'), lines };
}

/**
 * Create a fake host context with the seams dsh-bark-push reads.
 * @param {object} [options] - context options.
 * @param {Array<object>} [options.workspaces] - workspace rows.
 * @param {Array<object>} [options.sessions] - live sessions.
 * @param {string} [options.advertisedUrl] - webApp URL.
 * @param {string} [options.origin] - webServer origin.
 * @returns {object} fake context plus inspection helpers.
 */
export function createFakeCtx({ workspaces = [], sessions = [], advertisedUrl, origin } = {}) {
  const handlers = new Map();
  const effects = [];
  const routes = [];
  const ctx = {
    logger: createLogger(),
    on(name, handler) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
      return () => {
        const current = handlers.get(name) ?? [];
        handlers.set(name, current.filter((entry) => entry !== handler));
      };
    },
    effect(factory) {
      const dispose = factory();
      effects.push(dispose);
      return dispose;
    },
    inject(_deps, callback) {
      callback(ctx);
    },
    connection: {
      fetch: {
        register(route) {
          routes.push(route);
          return async () => {};
        },
      },
    },
    workspaceRegistry: {
      list: () => workspaces,
      get: (id) => workspaces.find((workspace) => workspace.id === id),
      resolveByPath: async (path) => workspaces.find((workspace) => workspace.path === path),
    },
    sessions: {
      list: () => sessions,
      get: (id) => sessions.find((session) => session.header?.id === id),
    },
    sessionTitle: {
      get: (session) => (session?.title ? { title: session.title } : undefined),
    },
    webApp: advertisedUrl ? { getAdvertisedUrl: () => advertisedUrl } : undefined,
    webServer: origin ? { getOrigin: () => origin } : undefined,
    emit(name, ...args) {
      for (const handler of handlers.get(name) ?? []) handler(...args);
    },
    handlers,
    effects,
    routes,
  };
  return ctx;
}

/**
 * Wait until a predicate becomes true or the timeout elapses.
 * @param {() => boolean} predicate - condition.
 * @param {number} [timeoutMs] - maximum wait.
 * @returns {Promise<void>} resolution.
 */
export async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Start a Bark-like capture server.
 * @param {object} [options] - server options.
 * @param {Array<{ status?: number, body?: object }>} [options.responses] - scripted responses.
 * @returns {Promise<object>} server controls.
 */
export async function createBarkServer({ responses = [] } = {}) {
  const requests = [];
  let index = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = null;
      }
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: parsed });
      const scripted = responses[index] ?? responses.at(-1) ?? { status: 200, body: { code: 200, message: 'success' } };
      index += 1;
      res.writeHead(scripted.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(scripted.body ?? { code: 200, message: 'success' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    server,
    requests,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
