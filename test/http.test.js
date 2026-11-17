import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { apply } from '../lib/index.js';
import { buildCatalog, installHttpRoutes, nextConfigOverlay, ROUTES } from '../lib/http.js';
import { createBarkServer, createFakeCtx, createLogger, tempDir } from './helpers.js';

const KEY = 'TEST_DEVICE_KEY_1234567890';

async function invoke(ctx, path, body, headers = {}) {
  const route = ctx.routes.find((entry) => entry.path === path);
  assert.ok(route, `route ${path}`);
  const request = new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined
        ? { accept: 'application/json' }
        : { 'content-type': 'application/json', 'x-dsh-bark-action': '1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return route.fetch(request);
}

test('state catalog reads services from the root host context, not the connection scope', async () => {
  const routes = [];
  const scope = {
    connection: {
      fetch: {
        register(route) {
          routes.push(route);
          return async () => {};
        },
      },
    },
  };
  const registry = {
    list: () => [{ id: 'ws-diana', title: 'Diana', path: '/workspace/Diana', sessionIds: [] }],
    get: () => undefined,
  };
  const host = {
    // Only ctx.get() exposes the service; direct property access is undefined.
    get: (key) => (key === 'workspaceRegistry' ? registry : undefined),
  };
  const runtime = {
    version: 'test',
    getConfig: () => ({}),
    getState: () => ({ mutedWorkspaces: ['ws-diana'], mutedSessions: [], lastTest: null }),
    warnings: () => [],
    lastDelivery: () => null,
  };
  installHttpRoutes(scope, runtime, host);
  const route = routes.find((entry) => entry.path === ROUTES.state);
  const response = await route.fetch(new Request(`http://localhost${ROUTES.state}`));
  const payload = await response.json();
  assert.equal(payload.catalog.workspaces.length, 1);
  assert.equal(payload.catalog.workspaces[0].title, 'Diana');
  assert.equal(payload.catalog.workspaces[0].muted, true);
});

test('rejects writes without the same-origin action header', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const ctx = createFakeCtx();
    apply(ctx, { stateFile: join(dir, 'state.json'), server: 'https://api.day.app', deviceKeys: [KEY] });
    const response = await invoke(ctx, ROUTES.config, { group: 'X' }, { 'x-dsh-bark-action': '' });
    assert.equal(response.status, 403);
    const mute = await invoke(ctx, ROUTES.mute, { kind: 'session', id: 's', muted: true }, { 'x-dsh-bark-action': '' });
    assert.equal(mute.status, 403);
  } finally {
    await cleanup();
  }
});

test('saves, masks, adds, and clears device keys through the API', async () => {
  const { dir, cleanup } = await tempDir();
  const bark = await createBarkServer();
  try {
    const stateFile = join(dir, 'state.json');
    const ctx = createFakeCtx();
    apply(ctx, { stateFile, server: bark.url, deviceKeys: [KEY], group: 'DSH' });

    let response = await invoke(ctx, ROUTES.config, { addDeviceKeys: ['second-key'], group: 'Custom' });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.config.group, 'Custom');
    assert.equal(payload.config.deviceKeyCount, 2);
    assert.equal(JSON.stringify(payload).includes(KEY), false);
    let disk = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.deepEqual(disk.config.deviceKeys, [KEY, 'second-key']);

    response = await invoke(ctx, ROUTES.config, { clearDeviceKeys: true });
    payload = await response.json();
    assert.equal(payload.config.deviceKeyCount, 0);
    disk = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.deepEqual(disk.config.deviceKeys, []);
  } finally {
    await bark.close();
    await cleanup();
  }
});

test('reset keeps device keys but restores other defaults', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const stateFile = join(dir, 'state.json');
    const ctx = createFakeCtx();
    apply(ctx, { stateFile, server: 'https://api.day.app', deviceKeys: [KEY] });
    await invoke(ctx, ROUTES.config, { group: 'Custom', maxBodyLength: 300 });
    const response = await invoke(ctx, ROUTES.config, { reset: true });
    const payload = await response.json();
    assert.equal(payload.config.group, 'DSH');
    assert.equal(payload.config.maxBodyLength, 1200);
    assert.equal(payload.config.deviceKeyCount, 1);
    const disk = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.deepEqual(disk.config.deviceKeys, [KEY]);
  } finally {
    await cleanup();
  }
});

test('validates mute targets and toggles both levels', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const ctx = createFakeCtx();
    apply(ctx, { stateFile: join(dir, 'state.json'), deviceKeys: [KEY] });
    let response = await invoke(ctx, ROUTES.mute, { kind: 'everyone', id: 'x', muted: true });
    assert.equal(response.status, 400);
    response = await invoke(ctx, ROUTES.mute, { kind: 'session', id: '', muted: true });
    assert.equal(response.status, 400);
    response = await invoke(ctx, ROUTES.mute, { kind: 'session', id: 's1', muted: true });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.deepEqual(payload.mute.sessions, ['s1']);
    const toggled = await (await invoke(ctx, ROUTES.toggle, { kind: 'session', id: 's1' })).json();
    assert.equal(toggled.muted, false);
    assert.deepEqual(toggled.mute.sessions, []);
  } finally {
    await cleanup();
  }
});

test('serves the management page with a restrictive CSP', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const ctx = createFakeCtx();
    apply(ctx, { stateFile: join(dir, 'state.json') });
    const response = await invoke(ctx, ROUTES.ui);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type').startsWith('text/html'), true);
    assert.equal(response.headers.get('content-security-policy').includes("default-src 'none'"), true);
    const html = await response.text();
    assert.equal(html.includes('/api/bark-push/state'), true);
    assert.equal(html.includes('静音管理'), true);
    assert.equal(html.includes('主动通知（active）'), true);
    assert.equal(html.includes('紧急通知（critical）'), true);
    assert.equal(html.includes('volume'), true);
    assert.equal(html.includes('id="levelNormal"'), false);
  } finally {
    await cleanup();
  }
});

test('nextConfigOverlay handles replace, add, clear, and reset', () => {
  assert.deepEqual(nextConfigOverlay({ group: 'A' }, { deviceKeys: ['x'] }).overlay, { group: 'A', deviceKeys: ['x'] });
  assert.deepEqual(nextConfigOverlay({ deviceKeys: ['x'] }, { addDeviceKeys: ['y'] }).overlay, { deviceKeys: ['x', 'y'] });
  assert.deepEqual(nextConfigOverlay({ deviceKeys: ['x'] }, { clearDeviceKeys: true }).overlay, { deviceKeys: [] });
  assert.deepEqual(nextConfigOverlay({ group: 'A' }, { reset: true }), { overlay: {}, reset: true });
});

test('state catalog exposes the session-to-workspace mapping', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const ctx = createFakeCtx({
      workspaces: [{ id: 'ws-1', title: '项目', path: '/work/a', sessionIds: ['s1'] }],
      sessions: [{ header: { id: 's1', cwd: '/work/a', createdAt: 1 } }],
    });
    apply(ctx, { stateFile: join(dir, 'state.json') });
    const response = await invoke(ctx, ROUTES.state);
    const payload = await response.json();
    assert.equal(payload.catalog.sessionWorkspace.s1, 'ws-1');
    assert.equal(payload.catalog.sessions.find((row) => row.id === 's1').workspaceId, 'ws-1');
  } finally {
    await cleanup();
  }
});

test('state catalog includes cold ordinary sessions with projected titles', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const ctx = createFakeCtx({
      workspaces: [{ id: 'ws-1', title: '项目', path: '/work/a', sessionIds: ['s1', 's2'] }],
      sessionSummaries: [
        { sessionId: 's1', updatedAt: 2, blank: false, cwd: '/work/a', agentAvailable: true, projections: { values: { title: '活跃会话' } } },
        { sessionId: 's2', updatedAt: 1, blank: false, cwd: '/work/a', agentAvailable: false, projections: { values: { title: '历史会话' } } },
      ],
    });
    apply(ctx, { stateFile: join(dir, 'state.json') });
    const payload = await (await invoke(ctx, ROUTES.state)).json();
    const cold = payload.catalog.sessions.find((row) => row.id === 's2');
    assert.ok(cold);
    assert.equal(cold.title, '历史会话');
    assert.equal(cold.workspaceId, 'ws-1');
    assert.equal(payload.catalog.sessionWorkspace.s2, 'ws-1');
  } finally {
    await cleanup();
  }
});

test('state catalog falls back to session query projections without the web controller', async () => {
  const ctx = {
    logger: createLogger(),
    workspaceRegistry: {
      list: () => [{ id: 'ws-1', title: '项目', path: '/work/a', sessionIds: ['s1', 's2', 's3'] }],
      archivedSessionIds: [],
      pinnedSessionIds: [],
    },
    sessionQuery: {
      listSessions: async () => [
        { header: { id: 's1', cwd: '/work/a', createdAt: 3 } },
        { header: { id: 's2', cwd: '/work/a', createdAt: 2, origin: 'subagent' } },
        { header: { id: 's3', cwd: '/work/a', createdAt: 1 } },
      ],
    },
    sessionProjectionCache: {
      cachedSnapshot: (header) => ({
        values: {
          title: header.id === 's1' ? '冷会话标题' : '空白会话',
          sessionListMetadata: { blank: header.id === 's3', lastPromptAt: null },
        },
      }),
    },
    sessions: { get: () => undefined },
    sessionTitle: { get: () => undefined },
  };
  const catalog = await buildCatalog(ctx, { mutedWorkspaces: [], mutedSessions: [] });
  assert.deepEqual(catalog.sessions.map((row) => row.id), ['s1']);
  assert.equal(catalog.sessions[0].title, '冷会话标题');
});

test('state catalog mirrors the DSH sidebar visibility rules', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const ctx = createFakeCtx({
      workspaces: [{ id: 'ws-1', title: '项目', path: '/work/a', sessionIds: ['s1', 's2', 's3', 's4', 's6'] }],
      archivedSessionIds: ['s4'],
      pinnedSessionIds: ['s1'],
      sessionSummaries: [
        { sessionId: 's1', updatedAt: 3, blank: false, cwd: '/work/a', projections: { values: { title: '普通会话' } } },
        { sessionId: 's2', updatedAt: 2, blank: false, origin: 'subagent', cwd: '/work/a', projections: { values: { title: '子代理会话' } } },
        { sessionId: 's3', updatedAt: 1, blank: true, cwd: '/work/a' },
        { sessionId: 's4', updatedAt: 4, blank: false, cwd: '/work/a', projections: { values: { title: '已归档会话' } } },
        { sessionId: 's5', updatedAt: 5, blank: false, cwd: '/work/loose', projections: { values: { title: '未分组会话' } } },
      ],
    });
    apply(ctx, { stateFile: join(dir, 'state.json') });
    const payload = await (await invoke(ctx, ROUTES.state)).json();
    assert.deepEqual(payload.catalog.sessions.map((row) => row.id), ['s1', 's5']);
    assert.equal(payload.catalog.sessions.some((row) => row.id === 's6'), false);
    assert.equal(payload.catalog.sessions[0].title, '普通会话');
    assert.equal(payload.catalog.sessions[1].workspaceId, null);
    assert.equal(payload.catalog.sessionWorkspace.s2, 'ws-1');
  } finally {
    await cleanup();
  }
});

test('state catalog keeps muted archived sessions so the mute can be cleared', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const ctx = createFakeCtx({
      workspaces: [{ id: 'ws-1', title: '项目', path: '/work/a', sessionIds: ['s4'] }],
      archivedSessionIds: ['s4'],
      sessionSummaries: [
        { sessionId: 's4', updatedAt: 4, blank: false, cwd: '/work/a', projections: { values: { title: '已归档会话' } } },
      ],
    });
    apply(ctx, { stateFile: join(dir, 'state.json') });
    const response = await invoke(ctx, ROUTES.mute, { kind: 'session', id: 's4', muted: true });
    const payload = await response.json();
    const row = payload.catalog.sessions.find((session) => session.id === 's4');
    assert.ok(row);
    assert.equal(row.title, '已归档会话');
    assert.equal(row.archived, true);
    assert.equal(row.orphaned, true);
    assert.equal(row.muted, true);
  } finally {
    await cleanup();
  }
});
