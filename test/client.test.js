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
    useRef: (value) => ({ current: value }),
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
        if (registration && typeof registration[Symbol.iterator] === 'function' && typeof registration.next === 'function') {
          const values = [];
          for (const value of registration) values.push(value);
          registrations.push({ name, registration: values });
          return () => {};
        }
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
  const rowAction = bundle.registrations.find((entry) => entry.options?.name === 'sidebar.workspaces.session.row.action');
  const button = rowAction.component({ sessionId: 's1', t: (key) => key });
  assert.equal(button.type, 'button');
  assert.equal(button.props['aria-label'], 'unmute');
  assert.equal(button.children[0].props.off, true);
  const navIcon = bundle.registrations.find((entry) => entry.options?.name === 'settings.section.icon');
  assert.equal(navIcon.options.id, 'bark-push');
  const element = section.component({});
  assert.equal(element.type, 'div');
  const iframe = element.children.find((child) => child && child.type === 'iframe');
  assert.equal(iframe.props.src, '/api/bark-push/ui?embed=1');
  assert.equal(element.children.some((child) => child && child.type === 'a'), false);
});

test('bundles both bell glyphs for the mute control', async () => {
  const bundle = await loadClient();
  const glyphs = bundle.exports.__internals.BELL_PATHS;
  assert.equal(Array.isArray(glyphs.bell), true);
  assert.equal(Array.isArray(glyphs.bellOff), true);
  assert.equal(glyphs.bell.length >= 2, true);
  assert.equal(glyphs.bellOff.length >= 3, true);
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
  assert.equal(sessionItems[0].icon.key, 'bark-push.bell-off');
  const workspaceItems = workspaceMenu.resolve({ workspaceId: 'ws-1' });
  assert.equal(workspaceItems[0].label, '取消静音 Bark 通知');
  assert.equal(workspaceItems[0].icon.key, 'bark-push.bell-off');
  const iconKeys = bundle.registrations
    .filter((entry) => entry.options?.name === 'contextMenu.icon')
    .map((entry) => entry.options.key);
  assert.deepEqual(iconKeys.sort(), ['bark-push.bell', 'bark-push.bell-off']);
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

test('registers the frame-wide toast overlay and exposes the toast store', async () => {
  const bundle = await loadClient();
  const overlay = bundle.registrations.find((entry) => entry.options && entry.options.name === 'shell.overlay');
  assert.ok(overlay, 'shell.overlay entry registered');
  assert.equal(overlay.options.id, 'dsh-bark-push.toast');
  assert.equal(typeof overlay.component, 'function');
  const toastStore = bundle.exports.__internals.toastStore;
  toastStore.show('渠道测试失败：HTTP 500', 'bad');
  assert.equal(toastStore.get().message, '渠道测试失败：HTTP 500');
  assert.equal(toastStore.get().kind, 'bad');
  toastStore.dismiss();
  assert.equal(toastStore.get(), null);
});
