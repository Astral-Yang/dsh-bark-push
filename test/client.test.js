import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const CLIENT_PATH = join(import.meta.dirname, '..', 'lib', 'client.js');

/**
 * Load the browser bundle into a VM and return its exports.
 * @param {object} [options] - environment overrides.
 * @returns {Promise<{ exports: object, registrations: Array<object>, menus: Array<object>, opened: string[], history: Array<object> }>} bundle.
 */
async function loadClient({ href = 'https://dsh.example/', state = { ok: true, mute: { workspaces: ['ws-1'], sessions: ['s1'] } } } = {}) {
  const source = await readFile(CLIENT_PATH, 'utf8');
  const registrations = [];
  const menus = [];
  const opened = [];
  const history = [];
  let loaded = null;

  const React = {
    createElement: (type, props = {}, ...children) => ({ type, props, children }),
    useState: (value) => [value, () => {}],
    useReducer: (_reducer, initial) => [initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
  };

  const sandbox = {
    console,
    URL,
    URLSearchParams,
    JSON,
    Math,
    Date,
    Set,
    Map,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Symbol,
    Promise,
    Error,
    fetch: async () => ({ ok: true, status: 200, json: async () => state }),
    setTimeout: (fn, ms) => {
      if (ms < 1000) fn();
      return 1;
    },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    document: {
      visibilityState: 'visible',
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    location: { href },
    history: {
      replaceState: (_state, _title, url) => history.push(url),
    },
    window: {
      location: { href },
      history: {
        replaceState: (_state, _title, url) => history.push(url),
      },
      setTimeout: (fn, ms) => {
        if (ms < 1000) fn();
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
    },
    __ModuleLoader__: {
      load: (definition) => {
        loaded = definition;
      },
    },
  };
  sandbox.window.__ModuleLoader__ = sandbox.__ModuleLoader__;
  sandbox.window.document = sandbox.document;
  sandbox.window.URL = URL;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  assert.equal(loaded.id, 'dsh-bark-push');
  const exports = loaded.factory((request) => {
    if (request === 'react') return React;
    throw new Error(`unexpected require: ${request}`);
  });

  const ctx = {
    effect: (factory) => {
      const dispose = factory();
      return dispose;
    },
    inject: (_deps, callback) => callback(ctx),
    locale: {
      getLocale: () => 'zh',
      register: () => () => {},
      bind: () => (key) => key,
    },
    slots: {
      inject: (name, factory) => {
        const registration = factory();
        registrations.push({ name, registration });
        return registration;
      },
      register: (options, component) => {
        registrations.push({ name: options.name, options, component });
        return () => {};
      },
    },
    contextMenus: {
      register: (definition) => {
        menus.push(definition);
        return () => {};
      },
    },
    uiWorkspace: {
      openSession: (id) => opened.push(id),
    },
  };
  exports.apply(ctx);
  await new Promise((resolve) => setTimeout(resolve, 10));
  return { exports, registrations, menus, opened, history };
}

test('registers the Settings section and the Session row mute action', async () => {
  const bundle = await loadClient();
  const names = bundle.registrations.map((entry) => entry.options?.name ?? entry.name);
  assert.equal(names.includes('settings.section'), true);
  assert.equal(names.includes('sidebar.workspaces.session.row.action'), true);
  const section = bundle.registrations.find((entry) => entry.options?.name === 'settings.section');
  assert.equal(section.options.id, 'bark-push');
  const element = section.component({});
  assert.equal(element.type, 'div');
  const iframe = element.children.find((child) => child && child.type === 'iframe');
  assert.equal(iframe.props.src, '/api/bark-push/ui?embed=1');
});

test('registers native session and workspace context menus', async () => {
  const bundle = await loadClient();
  assert.equal(bundle.menus.length, 2);
  const sessionMenu = bundle.menus.find((menu) => menu.target === 'session');
  const workspaceMenu = bundle.menus.find((menu) => menu.target === 'workspace');
  assert.ok(sessionMenu);
  assert.ok(workspaceMenu);
  const sessionItems = sessionMenu.resolve({ sessionId: 's1' });
  assert.equal(sessionItems.length, 1);
  assert.equal(sessionItems[0].label, '取消静音 Bark 通知');
  const workspaceItems = workspaceMenu.resolve({ workspaceId: 'ws-1' });
  assert.equal(workspaceItems[0].label, '取消静音 Bark 通知');
});

test('opens a Session from ?barkSession and removes the parameter', async () => {
  const bundle = await loadClient({ href: 'https://dsh.example/?barkSession=session-42&barkFocus=approval' });
  assert.equal(bundle.opened.includes('session-42'), true);
  assert.equal(bundle.history.length >= 1, true);
  assert.equal(bundle.history[0].includes('barkSession'), false);
});

test('adopts mute state into the shared cache', async () => {
  const bundle = await loadClient();
  const internals = bundle.exports.__internals;
  internals.adopt({ mute: { workspaces: ['a'], sessions: ['b'] } });
  assert.equal(internals.store.workspaces.has('a'), true);
  assert.equal(internals.store.sessions.has('b'), true);
});
