import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { normalizeConfig } from '../lib/config.js';
import { Notifier } from '../lib/notifier.js';
import { SerialQueue } from '../lib/queue.js';
import { StateStore } from '../lib/state.js';
import { createFakeCtx, createLogger, tempDir, waitFor } from './helpers.js';

function session(id, cwd, title) {
  return { id, header: { id, cwd, createdAt: Date.now() }, title };
}

async function setup({ workspaces = [], sessions = [] } = {}) {
  const { dir, cleanup } = await tempDir();
  const state = new StateStore({ file: join(dir, 'state.json'), logger: createLogger() });
  state.loadSync();
  let config = normalizeConfig({
    deviceKeys: ['test-key'],
    linkToSession: true,
    notifyOnReply: true,
    notifyOnApproval: true,
    notifyOnQuestion: true,
  }).config;
  const sent = [];
  const bark = {
    async send(note) {
      sent.push(note);
      return { ok: true, results: [{ maskedKey: 'test••••', ok: true, status: 200, attempts: 1 }] };
    },
  };
  const ctx = createFakeCtx({ workspaces, sessions, advertisedUrl: 'https://dsh.example/' });
  const queue = new SerialQueue({ concurrency: 1, limit: 20, logger: ctx.logger });
  const notifier = new Notifier({
    ctx,
    getConfig: () => config,
    state,
    bark,
    queue,
    logger: ctx.logger,
    version: 'test',
  });
  return {
    state,
    sent,
    notifier,
    ctx,
    queue,
    setConfig: (patch) => {
      config = normalizeConfig({ ...config, ...patch }).config;
    },
    cleanup: async () => {
      queue.dispose();
      await cleanup();
    },
  };
}

test('one completed turn produces exactly one reply notification', async () => {
  const env = await setup();
  try {
    const s = session('s1', '/work/a', '会话 A');
    env.notifier.reply({ session: s, sessionId: 's1', turn: 1, text: '第一条回复', sessionTitle: '会话 A' });
    env.notifier.reply({ session: s, sessionId: 's1', turn: 1, text: '第一条回复', sessionTitle: '会话 A' });
    await waitFor(() => env.sent.length >= 1);
    assert.equal(env.sent.length, 1);
    assert.equal(env.sent[0].title, '会话 A');
    assert.equal(env.sent[0].body, '第一条回复');
    assert.equal(env.sent[0].url.startsWith('https://dsh.example/?barkSession=s1'), true);
  } finally {
    await env.cleanup();
  }
});

test('duplicate approval ids are suppressed', async () => {
  const env = await setup();
  try {
    const s = session('s1', '/work/a', '会话 A');
    env.notifier.approval({ session: s, sessionId: 's1', requestId: 'req-1', toolName: 'Bash', reason: 'write' });
    env.notifier.approval({ session: s, sessionId: 's1', requestId: 'req-1', toolName: 'Bash', reason: 'write' });
    await waitFor(() => env.sent.length >= 1);
    assert.equal(env.sent.length, 1);
    assert.equal(env.sent[0].title, '需要批准');
    assert.equal(env.sent[0].url.includes('barkFocus=approval'), true);
  } finally {
    await env.cleanup();
  }
});

test('a muted session is skipped while another session still pushes', async () => {
  const env = await setup({
    workspaces: [{ id: 'ws-1', title: '项目', path: '/work/a', sessionIds: ['s1', 's2'] }],
    sessions: [session('s1', '/work/a', 'A'), session('s2', '/work/a', 'B')],
  });
  try {
    await env.state.setMuted('session', 's1', true);
    env.notifier.reply({ session: session('s1', '/work/a', 'A'), sessionId: 's1', turn: 1, text: '来自 A' });
    env.notifier.reply({ session: session('s2', '/work/a', 'B'), sessionId: 's2', turn: 1, text: '来自 B' });
    await waitFor(() => env.sent.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(env.sent.length, 1);
    assert.equal(env.sent[0].body, '来自 B');
  } finally {
    await env.cleanup();
  }
});

test('workspace mute suppresses every session in that workspace', async () => {
  const env = await setup({
    workspaces: [{ id: 'ws-1', title: '项目', path: '/work/a', sessionIds: ['s1', 's2'] }],
    sessions: [session('s1', '/work/a', 'A'), session('s2', '/work/a', 'B')],
  });
  try {
    await env.state.setMuted('workspace', 'ws-1', true);
    env.notifier.reply({ session: session('s1', '/work/a', 'A'), sessionId: 's1', turn: 1, text: '来自 A' });
    env.notifier.reply({ session: session('s2', '/work/a', 'B'), sessionId: 's2', turn: 1, text: '来自 B' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(env.sent.length, 0);
  } finally {
    await env.cleanup();
  }
});

test('a mute applied after enqueue still suppresses the queued notification', async () => {
  const env = await setup({
    workspaces: [{ id: 'ws-1', title: '项目', path: '/work/a', sessionIds: ['s1'] }],
    sessions: [session('s1', '/work/a', 'A')],
  });
  try {
    env.notifier.reply({ session: session('s1', '/work/a', 'A'), sessionId: 's1', turn: 1, text: '排队中的回复' });
    await env.state.setMuted('workspace', 'ws-1', true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(env.sent.length, 0);
  } finally {
    await env.cleanup();
  }
});

test('question notifications format the options and do not claim the waterfall', async () => {
  const env = await setup({ sessions: [session('s1', '/work/a', '设计')] });
  try {
    env.notifier.question({
      agent: { id: 's1' },
      wait: { callId: 'call-1' },
      questions: [{ id: 'q1', question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] }],
    });
    await waitFor(() => env.sent.length >= 1);
    assert.equal(env.sent[0].title, '等待选择');
    assert.equal(env.sent[0].body.includes('1) A'), true);
    assert.equal(env.sent[0].url.includes('barkFocus=question'), true);
  } finally {
    await env.cleanup();
  }
});

test('a disabled global switch at send time suppresses a queued job', async () => {
  const env = await setup({ sessions: [session('s1', '/work/a', 'A')] });
  try {
    env.notifier.reply({ session: session('s1', '/work/a', 'A'), sessionId: 's1', turn: 1, text: '排队中的回复' });
    env.setConfig({ enabled: false });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(env.sent.length, 0);
  } finally {
    await env.cleanup();
  }
});

test('a throwing Bark client never escapes the queue', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const ctx = createFakeCtx({ sessions: [session('s1', '/work/a', 'A')] });
    const state = new StateStore({ file: join(dir, 'state.json'), logger: ctx.logger });
    state.loadSync();
    let config = normalizeConfig({ deviceKeys: ['k'] }).config;
    const queue = new SerialQueue({ concurrency: 1, limit: 5, logger: ctx.logger });
    const notifier = new Notifier({
      ctx,
      getConfig: () => config,
      state,
      queue,
      logger: ctx.logger,
      version: 'test',
      bark: {
        async send() {
          throw new Error('network down');
        },
      },
    });
    notifier.reply({ session: session('s1', '/work/a', 'A'), sessionId: 's1', turn: 1, text: '回复' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(ctx.logger.lines.some((line) => line.includes('失败')), true);
    queue.dispose();
  } finally {
    await cleanup();
  }
});

test('the default test push only exercises Bark, never the extra channels', async () => {
  const { dir, cleanup } = await tempDir();
  const state = new StateStore({ file: join(dir, 'state.json'), logger: createLogger() });
  state.loadSync();
  const config = normalizeConfig({
    deviceKeys: ['k'],
    channels: [{ id: 'ch_a', type: 'gotify', config: { server: 'https://g', token: 't', priority: '5' } }],
  }).config;
  const barkCalls = [];
  const channelCalls = [];
  const bark = { async send(note) { barkCalls.push(note); return { ok: true, results: [{ maskedKey: 'k••••', ok: true, status: 200, attempts: 1 }] }; } };
  const channels = {
    hasEnabled: () => true,
    async send(note) { channelCalls.push(note); return { ok: true, results: [{ channelId: 'ch_a', channelType: 'gotify', label: 'g', ok: true }] }; },
  };
  const ctx = createFakeCtx({});
  const queue = new SerialQueue({ concurrency: 1, limit: 20, logger: ctx.logger });
  const notifier = new Notifier({ ctx, getConfig: () => config, state, bark, channels, queue, logger: ctx.logger, version: 'test' });
  try {
    const result = await notifier.test();
    assert.equal(barkCalls.length, 1);
    assert.equal(channelCalls.length, 0);
    assert.equal(result.ok, true);
  } finally {
    queue.dispose();
    await cleanup();
  }
});
