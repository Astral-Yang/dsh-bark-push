import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { apply } from '../lib/index.js';
import { ROUTES } from '../lib/http.js';
import { createBarkServer, createFakeCtx, tempDir, waitFor } from './helpers.js';

const KEY = 'TEST_DEVICE_KEY_1234567890';

function liveSession(id, cwd, title) {
  return { id, title, header: { id, cwd, createdAt: Date.now() } };
}

function reply(sessionId, turn, text) {
  return {
    assistant: {
      type: 'assistant/message',
      data: { turn, step: 1, message: { content: [{ type: 'text', text }] } },
    },
    end: { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } },
  };
}

async function invoke(ctx, path, body) {
  const route = ctx.routes.find((entry) => entry.path === path);
  assert.ok(route, `route ${path} registered`);
  const request = new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined
        ? { accept: 'application/json' }
        : { 'content-type': 'application/json', 'x-dsh-bark-action': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return route.fetch(request);
}

test('end-to-end: reply, approval, question, masking, mute and restart persistence', async () => {
  const bark = await createBarkServer();
  const { dir, cleanup } = await tempDir();
  const workspaces = [
    { id: 'ws-1', title: '项目一', path: '/work/a', sessionIds: ['s1'] },
    { id: 'ws-2', title: '项目二', path: '/work/b', sessionIds: ['s2', 's3'] },
  ];
  const sessions = [liveSession('s1', '/work/a', '会话一'), liveSession('s2', '/work/b', '会话二'), liveSession('s3', '/work/b', '会话三')];
  try {
    const ctx = createFakeCtx({ workspaces, sessions, advertisedUrl: 'https://dsh.example/' });
    apply(ctx, {
      stateFile: join(dir, 'state.json'),
      server: bark.url,
      deviceKeys: [KEY],
      maxRetries: 0,
      retryDelayMs: 50,
      group: 'DSH',
    });

    const first = reply('s1', 1, '## 完成\n\n第一条正式回复。');
    ctx.emit('session/event', sessions[0], first.assistant);
    ctx.emit('session/event', sessions[0], first.end);
    await waitFor(() => bark.requests.length === 1);
    assert.equal(bark.requests[0].body.title, '会话一');
    assert.equal(bark.requests[0].body.body.includes('第一条正式回复。'), true);
    assert.equal(bark.requests[0].body.url.includes('barkSession=s1'), true);

    const stateResponse = await invoke(ctx, ROUTES.state);
    const state = await stateResponse.json();
    assert.equal(state.config.deviceKeyCount, 1);
    assert.equal(JSON.stringify(state).includes(KEY), false);

    // Workspace mute: s1 stops, s2 in another workspace still pushes.
    await invoke(ctx, ROUTES.mute, { kind: 'workspace', id: 'ws-1', muted: true });
    const muted = reply('s1', 2, '工作区已静音');
    ctx.emit('session/event', sessions[0], muted.assistant);
    ctx.emit('session/event', sessions[0], muted.end);
    const second = reply('s2', 1, '另一个工作区');
    ctx.emit('session/event', sessions[1], second.assistant);
    ctx.emit('session/event', sessions[1], second.end);
    await waitFor(() => bark.requests.length === 2);
    assert.equal(bark.requests[1].body.body, '另一个工作区');

    // Session mute: s3 (same workspace as s2) still pushes.
    await invoke(ctx, ROUTES.mute, { kind: 'session', id: 's2', muted: true });
    const third = reply('s2', 2, '会话二已静音');
    ctx.emit('session/event', sessions[1], third.assistant);
    ctx.emit('session/event', sessions[1], third.end);
    const fourth = reply('s3', 1, '会话三正常');
    ctx.emit('session/event', sessions[2], fourth.assistant);
    ctx.emit('session/event', sessions[2], fourth.end);
    await waitFor(() => bark.requests.length === 3);
    assert.equal(bark.requests[2].body.body, '会话三正常');

    // Approval event uses the exact title and the important level.
    ctx.emit('session/event', sessions[2], {
      type: 'approval/asked',
      data: { id: 'approval-1', toolName: 'Bash', reason: '需要写入工作区外的文件' },
    });
    await waitFor(() => bark.requests.length === 4);
    assert.equal(bark.requests[3].body.title, '需要批准');
    assert.equal(bark.requests[3].body.level, 'timeSensitive');
    assert.equal(bark.requests[3].body.body.includes('Bash'), true);

    // Question waterfall: the bridge must delegate and still notify.
    const questionHandler = ctx.handlers.get('user-questions/request')[0];
    let delegated = 0;
    questionHandler(
      {
        agent: { id: 's3' },
        wait: { callId: 'call-9' },
        questions: [{ id: 'q', question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] }],
      },
      () => {
        delegated += 1;
        return Promise.resolve({ answers: [] });
      },
    );
    assert.equal(delegated, 1);
    await waitFor(() => bark.requests.length === 5);
    assert.equal(bark.requests[4].body.title, '等待选择');
    assert.equal(bark.requests[4].body.body.includes('1) A'), true);

    // Test endpoint bypasses `enabled` but still fans out to configured keys.
    const testResponse = await invoke(ctx, ROUTES.test, {});
    const testPayload = await testResponse.json();
    assert.equal(testPayload.ok, true);
    await waitFor(() => bark.requests.length === 6);
    assert.equal(bark.requests[5].body.title, 'Bark 推送测试');

    // A fresh plugin instance reads the same state file: both mutes survive.
    const ctx2 = createFakeCtx({ workspaces, sessions, advertisedUrl: 'https://dsh.example/' });
    apply(ctx2, {
      stateFile: join(dir, 'state.json'),
      server: bark.url,
      deviceKeys: [KEY],
      maxRetries: 0,
    });
    const afterRestart = reply('s1', 3, '重启后的回复');
    ctx2.emit('session/event', sessions[0], afterRestart.assistant);
    ctx2.emit('session/event', sessions[0], afterRestart.end);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(bark.requests.length, 6);
  } finally {
    await bark.close();
    await cleanup();
  }
});

test('a Bark outage returns an error to the test endpoint but keeps event handlers alive', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const ctx = createFakeCtx({ sessions: [liveSession('s1', '/work/a', 'A')], advertisedUrl: 'https://dsh.example/' });
    apply(ctx, {
      stateFile: join(dir, 'state.json'),
      server: 'http://127.0.0.1:1',
      deviceKeys: [KEY],
      maxRetries: 0,
      timeoutMs: 300,
    });
    const event = reply('s1', 1, '离线时也要继续运行');
    assert.doesNotThrow(() => {
      ctx.emit('session/event', ctx.sessions.list()[0], event.assistant);
      ctx.emit('session/event', ctx.sessions.list()[0], event.end);
    });
    const response = await invoke(ctx, ROUTES.test, {});
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.result.results[0].ok, false);
    // The plugin remains functional after the failed request.
    assert.equal(ctx.handlers.get('session/event').length >= 1, true);
  } finally {
    await cleanup();
  }
});
