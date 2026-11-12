import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { apply } from '../lib/index.js';
import { nextConfigOverlay, ROUTES } from '../lib/http.js';
import { createBarkServer, createFakeCtx, tempDir } from './helpers.js';

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
