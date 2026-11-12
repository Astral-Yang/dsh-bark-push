import assert from 'node:assert/strict';
import test from 'node:test';

import { extractAssistantText, installQuestionBridge, installSessionBridge, turnEndKind } from '../lib/events.js';
import { createFakeCtx } from './helpers.js';

function makeNotifier() {
  const replies = [];
  const approvals = [];
  const questions = [];
  return {
    replies,
    approvals,
    questions,
    reply: (input) => replies.push(input),
    approval: (input) => approvals.push(input),
    question: (input) => questions.push(input),
  };
}

function session(id = 's1', header = {}) {
  return { id, header: { id, cwd: '/work/a', ...header } };
}

function assistant(turn, text, extra = []) {
  return {
    type: 'assistant/message',
    data: {
      turn,
      step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }, ...extra],
      },
    },
  };
}

test('extracts only visible text blocks', () => {
  assert.equal(
    extractAssistantText({
      content: [
        { type: 'reasoning', text: 'internal' },
        { type: 'text', text: 'answer' },
        { type: 'text', text: 'second' },
      ],
    }),
    'answer\n\nsecond',
  );
  assert.equal(extractAssistantText({ content: [{ type: 'reasoning', text: 'only' }] }), '');
});

test('a completed turn with several assistant messages produces one final reply', () => {
  const ctx = createFakeCtx();
  const notifier = makeNotifier();
  installSessionBridge(ctx, { notifier, getConfig: () => ({ includeSubagents: false }), logger: ctx.logger });
  const s = session();
  ctx.emit('session/event', s, assistant(1, '中间说明'));
  ctx.emit('session/event', s, assistant(1, '最终回复'));
  ctx.emit('session/event', s, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  assert.equal(notifier.replies.length, 1);
  assert.equal(notifier.replies[0].text, '最终回复');
  // Duplicate delivery of the same turn/end must not notify again.
  ctx.emit('session/event', s, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  assert.equal(notifier.replies.length, 1);
});

test('an aborted turn never notifies', () => {
  const ctx = createFakeCtx();
  const notifier = makeNotifier();
  installSessionBridge(ctx, { notifier, getConfig: () => ({}), logger: ctx.logger });
  const s = session();
  ctx.emit('session/event', s, assistant(1, '半截回复'));
  ctx.emit('session/event', s, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } });
  assert.equal(notifier.replies.length, 0);
});

test('reasoning-only assistant messages are not notified', () => {
  const ctx = createFakeCtx();
  const notifier = makeNotifier();
  installSessionBridge(ctx, { notifier, getConfig: () => ({}), logger: ctx.logger });
  const s = session();
  ctx.emit('session/event', s, {
    type: 'assistant/message',
    data: { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: 'thinking' }] } },
  });
  ctx.emit('session/event', s, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  assert.equal(notifier.replies.length, 0);
});

test('approval audit events notify once per id', () => {
  const ctx = createFakeCtx();
  const notifier = makeNotifier();
  installSessionBridge(ctx, { notifier, getConfig: () => ({}), logger: ctx.logger });
  const s = session('s1', { origin: undefined });
  const event = { type: 'approval/asked', data: { id: 'req-1', toolName: 'Bash', reason: 'write outside workspace' } };
  ctx.emit('session/event', s, event);
  ctx.emit('session/event', s, event);
  assert.equal(notifier.approvals.length, 2); // dedupe belongs to the Notifier, not this bridge
  assert.equal(notifier.approvals[0].toolName, 'Bash');
});

test('subagent sessions are skipped by default', () => {
  const ctx = createFakeCtx();
  const notifier = makeNotifier();
  installSessionBridge(ctx, { notifier, getConfig: () => ({ includeSubagents: false }), logger: ctx.logger });
  const child = session('child', { origin: 'subagent', delegationDepth: 1 });
  ctx.emit('session/event', child, assistant(1, '子代理结果'));
  ctx.emit('session/event', child, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  assert.equal(notifier.replies.length, 0);

  const ctx2 = createFakeCtx();
  const notifier2 = makeNotifier();
  installSessionBridge(ctx2, { notifier: notifier2, getConfig: () => ({ includeSubagents: true }), logger: ctx2.logger });
  ctx2.emit('session/event', child, assistant(1, '子代理结果'));
  ctx2.emit('session/event', child, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  assert.equal(notifier2.replies.length, 1);
});

test('question waterfall observer delegates and never claims', () => {
  const ctx = createFakeCtx();
  const notifier = makeNotifier();
  installQuestionBridge(ctx, { notifier, logger: ctx.logger });
  let delegated = 0;
  const handler = ctx.handlers.get('user-questions/request')[0];
  const result = handler({ questions: [{ id: 'q', question: '?' }] }, () => {
    delegated += 1;
    return Promise.resolve({ answers: [] });
  });
  assert.equal(delegated, 1);
  assert.equal(notifier.questions.length, 1);
  assert.equal(typeof result.then, 'function');
});

test('turnEndKind accepts both structured and legacy string reasons', () => {
  assert.equal(turnEndKind({ kind: 'completed' }), 'completed');
  assert.equal(turnEndKind('completed'), 'completed');
  assert.equal(turnEndKind(undefined), '');
});
