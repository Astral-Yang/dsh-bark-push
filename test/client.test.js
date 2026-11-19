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
async function loadClient({ href = 'https://dsh.example/', state = { ok: true, mute: { workspaces: ['ws-1'], sessions: ['s1'] } }, primitives = null, notificationPermission = 'granted', sessions = [] } = {}) {
  const source = await readFile(CLIENT_PATH, 'utf8');
  const registrations = [];
  const menus = [];
  const opened = [];
  const history = [];
  const notifications = [];
  const eventSources = [];
  let loaded = null;

  function NotificationCtor(title, options) {
    this.title = title;
    this.options = options || {};
    this.closed = false;
    this.close = () => { this.closed = true; };
    notifications.push(this);
  }
  NotificationCtor.permission = notificationPermission;
  NotificationCtor.requestPermission = async () => notificationPermission;

  class EventSourceCtor {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.closed = false;
      eventSources.push(this);
    }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    emit(type, data) { const callback = this.listeners.get(type); if (callback) callback({ data }); }
    close() { this.closed = true; }
  }

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
    Notification: NotificationCtor,
    EventSource: EventSourceCtor,
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
      hasFocus: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    location: { href },
    history: {
      replaceState: (_state, _title, url) => history.push(url),
    },
    window: {
      Notification: NotificationCtor,
      EventSource: EventSourceCtor,
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
    if (request === '@deepseek-ai/dsh-client-ui-primitives' && primitives) return primitives;
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
  if (sessions.length > 0) {
    const byId = {};
    for (const id of sessions) byId[id] = { id, retainedBy: { mainView: 1 } };
    ctx.sessions = { list: { getSnapshot: () => ({ byId }) } };
  }
  exports.apply(ctx);
  await new Promise((resolve) => setTimeout(resolve, 10));
  return { exports, registrations, menus, opened, history, ctx, notifications, eventSources };
}

test('registers the Settings section plus the relocated Session mute surfaces', async () => {
  const bundle = await loadClient();
  const names = bundle.registrations.map((entry) => entry.options?.name ?? entry.name);
  assert.equal(names.includes('settings.section'), true);
  assert.equal(names.includes('sidebar.workspaces.session.menu.item'), true);
  assert.equal(names.includes('sidebar.session.row.trailing'), true);
  assert.equal(names.includes('conversation.session.header.utilities'), true);
  assert.equal(names.includes('sidebar.workspaces.session.row.action'), false);

  const section = bundle.registrations.find((entry) => entry.options?.name === 'settings.section');
  assert.equal(section.options.id, 'bark-push');

  // Session mute is a menu row rendered in both the row "..." and right-click menus.
  const menu = bundle.registrations.find((entry) => entry.options?.name === 'sidebar.workspaces.session.menu.item');
  assert.equal(menu.options.id, 'bark-push.mute');
  assert.equal(menu.options.order, 510);
  let closed = false;
  const menuButton = menu.component({
    sessionId: 's1',
    t: (key) => key,
    useMenuOpenState: () => [true, () => { closed = true; }],
  });
  assert.equal(menuButton.type, 'button');
  assert.equal(menuButton.props.role, 'menuitem');
  assert.equal(menuButton.props.className, 'bark-menuItem');
  assert.equal(menuButton.children[1].children[0], 'unmute');
  menuButton.props.onClick();
  assert.equal(closed, true);

  // The non-interactive trailing mark appears only for a muted Session.
  const mark = bundle.registrations.find((entry) => entry.options?.name === 'sidebar.session.row.trailing');
  const markNode = mark.component({ sessionId: 's1', t: (key) => key });
  assert.equal(markNode.props['data-bark-muted-mark'], 'session');
  assert.equal(mark.component({ sessionId: 's2', t: (key) => key }), null);

  // The current Session's header bell mirrors the same state.
  const header = bundle.registrations.find((entry) => entry.options?.name === 'conversation.session.header.utilities');
  assert.equal(header.options.id, 'bark-push.mute');
  const headerButton = header.component({ sessionId: 's1', t: (key) => key });
  assert.equal(headerButton.type, 'button');
  assert.equal(headerButton.props['aria-label'], 'unmute');

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

test('registers the workspace context menu (session mute moved to the menu slot)', async () => {
  const bundle = await loadClient();
  assert.equal(bundle.menus.length, 1);
  assert.equal(bundle.menus.some((menu) => menu.target === 'session'), false);
  const workspaceMenu = bundle.menus.find((menu) => menu.target === 'workspace');
  assert.ok(workspaceMenu);
  assert.equal(workspaceMenu.order, 199);
  const workspaceItems = workspaceMenu.resolve({ workspaceId: 'ws-1' });
  assert.equal(workspaceItems.length, 1);
  assert.equal(workspaceItems[0].label, '取消静音推送通知');
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
  internals.adopt({ mute: { workspaces: ['a'], sessions: ['b'] }, catalog: { sessions: [{ id: 'b', workspaceId: 'a' }] } });
  assert.equal(internals.store.workspaces.has('a'), true);
  assert.equal(internals.store.sessions.has('b'), true);
  assert.equal(internals.store.sessionWorkspace.get('b'), 'a');
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

test('prefers the host MenuItemButton primitive inside the session menu slot', async () => {
  const MenuItemButton = (props) => ({ type: 'host-menu-item', props });
  const bundle = await loadClient({ primitives: { MenuItemButton } });
  const menu = bundle.registrations.find((entry) => entry.options?.name === 'sidebar.workspaces.session.menu.item');
  let closed = false;
  const node = menu.component({
    sessionId: 's1',
    t: (key) => key,
    useMenuOpenState: () => [true, () => { closed = true; }],
  });
  assert.equal(node.type, MenuItemButton);
  assert.deepEqual(node.children, ['unmute']);
  assert.equal(node.props['data-bark-muted'], '1');
  assert.equal(typeof node.props.onSelect, 'function');
  node.props.onSelect();
  assert.equal(closed, true);
});

test('a workspace mute marks its Session rows with a workspace label', async () => {
  const bundle = await loadClient();
  const internals = bundle.exports.__internals;
  internals.adopt({
    mute: { workspaces: ['ws-1'], sessions: [] },
    catalog: { sessions: [{ id: 's9', workspaceId: 'ws-1' }] },
  });
  const mark = bundle.registrations.find((entry) => entry.options?.name === 'sidebar.session.row.trailing');
  const node = mark.component({ sessionId: 's9', t: (key) => key });
  assert.equal(node.props['data-bark-muted-mark'], 'workspace');
  assert.equal(node.props['aria-label'], 'mutedWorkspace');
  assert.equal(mark.component({ sessionId: 's10', t: (key) => key }), null);
});

test('maps workspaces from the catalog map and from a Session cwd fallback', async () => {
  const bundle = await loadClient();
  const internals = bundle.exports.__internals;
  const mark = bundle.registrations.find((entry) => entry.options?.name === 'sidebar.session.row.trailing');

  internals.adopt({
    mute: { workspaces: ['ws-1'], sessions: [] },
    catalog: { workspaces: [{ id: 'ws-1', path: '/work/a' }], sessionWorkspace: { s9: 'ws-1' } },
  });
  const fromMap = mark.component({ sessionId: 's9', t: (key) => key });
  assert.equal(fromMap.props['aria-label'], 'mutedWorkspace');

  internals.adopt({
    mute: { workspaces: ['ws-1'], sessions: [] },
    catalog: {
      workspaces: [{ id: 'ws-1', path: '/work/a' }],
      sessions: [{ id: 's11', workspaceId: null, cwd: '/work/a/sub' }],
    },
  });
  const inferred = mark.component({ sessionId: 's11', t: (key) => key });
  assert.equal(inferred.props['aria-label'], 'mutedWorkspace');
});

test('shows a browser notification, skips the current foreground session, and opens on click', async () => {
  const bundle = await loadClient({ sessions: ['s1'] });
  const internals = bundle.exports.__internals;
  internals.adopt({ config: { browserNotifyEnabled: true, browserNotifySkipForeground: true }, mute: { workspaces: [], sessions: [] } });
  const event = {
    kind: 'reply',
    sessionId: 's2',
    sessionTitle: '会话二',
    status: '回复完成',
    body: '回复完成 · 已完成',
  };
  assert.equal(internals.browser.show(bundle.ctx, event), true);
  assert.equal(bundle.notifications.length, 1);
  assert.equal(bundle.notifications[0].title, '会话二');
  assert.equal(bundle.notifications[0].options.body, '回复完成 · 已完成');
  bundle.notifications[0].onclick();
  assert.equal(bundle.opened.includes('s2'), true);
  assert.equal(bundle.notifications[0].closed, true);

  const current = { ...event, sessionId: 's1', sessionTitle: '会话一' };
  assert.equal(internals.browser.show(bundle.ctx, current), false);
  assert.equal(bundle.notifications.length, 1);
});

test('displays notifications received from the browser SSE stream', async () => {
  const bundle = await loadClient({ sessions: [], notificationPermission: 'granted' });
  const internals = bundle.exports.__internals;
  internals.adopt({ config: { browserNotifyEnabled: true, browserNotifySkipForeground: false }, mute: { workspaces: [], sessions: [] } });
  assert.equal(bundle.eventSources.length, 1);
  assert.equal(bundle.eventSources[0].url, '/api/bark-push/browser-events');
  bundle.eventSources[0].emit('browser-notify', JSON.stringify({
    kind: 'question',
    sessionId: 's1',
    sessionTitle: '会话一',
    status: '等待选择',
    body: '等待选择 · 选哪个？',
  }));
  assert.equal(bundle.notifications.length, 1);
  assert.equal(bundle.notifications[0].title, '会话一');
  assert.equal(bundle.notifications[0].options.body, '等待选择 · 选哪个？');
});

test('does not show browser notifications when permission is not granted', async () => {
  const bundle = await loadClient({ sessions: [], notificationPermission: 'denied' });
  const internals = bundle.exports.__internals;
  internals.adopt({ config: { browserNotifyEnabled: true, browserNotifySkipForeground: false }, mute: { workspaces: [], sessions: [] } });
  assert.equal(internals.browser.show(bundle.ctx, {
    kind: 'approval',
    sessionId: 's1',
    sessionTitle: '会话一',
    status: '需要批准',
    body: '需要批准 · Bash · 原因',
  }), false);
  assert.equal(bundle.notifications.length, 0);
});
