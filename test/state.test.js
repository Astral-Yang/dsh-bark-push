import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { StateStore, normalizeState, resolveStateFile } from '../lib/state.js';
import { createLogger, tempDir } from './helpers.js';

test('persists config and both mute levels across a restart', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const file = join(dir, 'state.json');
    const logger = createLogger();
    const first = new StateStore({ file, logger });
    first.loadSync();
    await first.setMuted('workspace', 'ws-1', true);
    await first.setMuted('session', 'session-1', true);
    await first.setConfig({ group: 'Muted Group' });

    const second = new StateStore({ file, logger });
    second.loadSync();
    assert.equal(second.isMuted({ workspaceKey: 'ws-1' }), true);
    assert.equal(second.isMuted({ sessionId: 'session-1' }), true);
    assert.equal(second.snapshot().config.group, 'Muted Group');

    await second.setMuted('session', 'session-1', false);
    const third = new StateStore({ file, logger });
    third.loadSync();
    assert.equal(third.isMuted({ sessionId: 'session-1' }), false);
    assert.equal(third.isMuted({ workspaceKey: 'ws-1' }), true);
  } finally {
    await cleanup();
  }
});

test('workspace mute suppresses a session even when the session is not muted', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const store = new StateStore({ file: join(dir, 'state.json'), logger: createLogger() });
    store.loadSync();
    await store.setMuted('workspace', 'ws-1', true);
    assert.equal(store.isMuted({ workspaceKey: 'ws-1', sessionId: 'session-1' }), true);
    assert.equal(store.isMuted({ workspaceKey: 'ws-2', sessionId: 'session-1' }), false);
    await store.setMuted('session', 'session-1', true);
    assert.equal(store.isMuted({ workspaceKey: 'ws-2', sessionId: 'session-1' }), true);
  } finally {
    await cleanup();
  }
});

test('moves a corrupt state file aside instead of overwriting it', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const file = join(dir, 'state.json');
    await writeFile(file, '{not json', 'utf8');
    const store = new StateStore({ file, logger: createLogger() });
    const result = store.loadSync();
    assert.equal(result.warnings.length, 1);
    assert.deepEqual(store.snapshot().mutedSessions, []);
    await store.setMuted('session', 'ok', true);
    const statResult = await stat(file);
    assert.equal(statResult.mode & 0o777, 0o600);
  } finally {
    await cleanup();
  }
});

test('normalizes unknown state shapes without throwing', () => {
  const state = normalizeState({ mutedWorkspaces: ['a', 3, 'a', ''], mutedSessions: 'nope', config: [] });
  assert.deepEqual(state.mutedWorkspaces, ['a']);
  assert.deepEqual(state.mutedSessions, []);
  assert.deepEqual(state.browserMutedWorkspaces, []);
  assert.deepEqual(state.browserMutedSessions, []);
  assert.deepEqual(state.config, {});
});

test('persists independent browser mutes without changing push mutes', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const file = join(dir, 'state.json');
    const first = new StateStore({ file, logger: createLogger() });
    first.loadSync();
    await first.setMuted('workspace', 'ws-1', true, 'browser');
    await first.setMuted('session', 's1', true, 'browser');
    await first.setMuted('session', 's2', true, 'push');

    const second = new StateStore({ file, logger: createLogger() });
    second.loadSync();
    assert.equal(second.isBrowserMuted({ workspaceKey: 'ws-1', sessionId: 's1' }), true);
    assert.equal(second.isBrowserMuted({ sessionId: 's2' }), false);
    assert.equal(second.isMuted({ sessionId: 's1' }), false);
    assert.equal(second.isMuted({ sessionId: 's2' }), true);
    assert.deepEqual(second.snapshot().browserMutedWorkspaces, ['ws-1']);
    assert.deepEqual(second.snapshot().browserMutedSessions, ['s1']);
  } finally {
    await cleanup();
  }
});

test('resolves a state file from config and DSH_HOME', () => {
  assert.equal(resolveStateFile({}, { DSH_HOME: '/tmp/home' }), '/tmp/home/bark-push/state.json');
  assert.equal(resolveStateFile({ stateFile: '/tmp/custom.json' }, { DSH_HOME: '/tmp/home' }), '/tmp/custom.json');
});
