import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_STATUS,
  BrowserNotifyHub,
  buildBrowserNotification,
  renderBrowserTemplate,
} from '../lib/browser-notify.js';

const BASE_CONFIG = {
  browserNotifyEnabled: true,
  browserNotifyOnReply: true,
  browserNotifyOnApproval: true,
  browserNotifyOnQuestion: true,
  browserNotifySkipForeground: true,
  browserNotifyUsePushMutes: true,
  browserNotifyReplyBody: '{status} · {summary}',
  browserNotifyApprovalBody: '{status} · {tool} · {reason}',
  browserNotifyQuestionBody: '{status} · {question}',
  browserNotifyMaxBodyLength: 200,
};

function helperNotifier() {
  return {
    workspaceKeyFor: async () => 'ws-1',
    sessionTitleFor: (_session, cached) => cached || '默认会话',
  };
}

function fakeState({ pushMuted = false, browserMuted = false } = {}) {
  return {
    refreshSync() {},
    isMuted: () => pushMuted,
    isBrowserMuted: () => browserMuted,
  };
}

test('renders known browser template placeholders and leaves unknown ones visible', () => {
  assert.equal(
    renderBrowserTemplate('{status} · {tool} · {question} · {missing}', {
      status: '需要批准',
      tool: 'Bash',
      question: '选哪个？',
    }),
    '需要批准 · Bash · 选哪个？ · {missing}',
  );
});

test('builds default reply, approval, and question browser notifications', () => {
  const notifier = helperNotifier();
  const reply = buildBrowserNotification(
    'reply',
    { sessionId: 's1', text: '## 完成\n\n第一条回复。', sessionTitle: '会话一' },
    BASE_CONFIG,
    notifier,
  );
  assert.equal(reply.status, BROWSER_STATUS.reply);
  assert.equal(reply.sessionTitle, '会话一');
  assert.equal(reply.body, '回复完成 · 完成');

  const approval = buildBrowserNotification(
    'approval',
    { sessionId: 's1', toolName: 'Bash', reason: '写入工作区文件', sessionTitle: '会话一' },
    BASE_CONFIG,
    notifier,
  );
  assert.equal(approval.status, BROWSER_STATUS.approval);
  assert.equal(approval.body, '需要批准 · Bash · 写入工作区文件');

  const question = buildBrowserNotification(
    'question',
    {
      sessionId: 's1',
      questions: [{ question: '请选择部署环境' }, { question: '第二个问题' }],
      sessionTitle: '会话一',
    },
    BASE_CONFIG,
    notifier,
  );
  assert.equal(question.status, BROWSER_STATUS.question);
  assert.equal(question.body, '等待选择 · 请选择部署环境');
});

test('uses custom templates and supports {session}, {turn}, {reason}, and {questionCount}', () => {
  const notifier = helperNotifier();
  const config = {
    ...BASE_CONFIG,
    browserNotifyReplyBody: '{session}|{turn}|{summary}',
    browserNotifyApprovalBody: '{session}|{tool}|{reason}',
    browserNotifyQuestionBody: '{session}|{question}|{questionCount}',
  };
  assert.equal(
    buildBrowserNotification('reply', { sessionId: 's1', turn: 3, text: '结果', sessionTitle: '标题' }, config, notifier).body,
    '标题|3|结果',
  );
  assert.equal(
    buildBrowserNotification(
      'approval',
      { sessionId: 's1', toolName: 'Bash', reason: '原因', sessionTitle: '标题' },
      config,
      notifier,
    ).body,
    '标题|Bash|原因',
  );
  assert.equal(
    buildBrowserNotification(
      'question',
      { sessionId: 's1', questions: [{ question: '问题' }, { question: '问题二' }], sessionTitle: '标题' },
      config,
      notifier,
    ).body,
    '标题|问题|2',
  );
});

test('hub respects browser switches independently from Bark settings', async () => {
  const events = [];
  const hub = new BrowserNotifyHub({
    getConfig: () => ({ ...BASE_CONFIG, enabled: false, notifyOnReply: false, deviceKeys: [] }),
    state: fakeState(),
    notifier: helperNotifier(),
    logger: { warn() {} },
  });
  // Observe the private path through a subscriber; this also exercises SSE serialization.
  const response = hub.subscribe(new Request('http://localhost/api/bark-push/browser-events'));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = '';
  const readUntil = async (needle) => {
    for (let i = 0; i < 20; i += 1) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += decoder.decode(chunk.value, { stream: true });
      if (output.includes(needle)) return output;
    }
    return output;
  };
  await readUntil('event: ready');
  hub.reply({ sessionId: 's1', turn: 1, text: '回复', sessionTitle: '会话一' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  output = await readUntil('event: browser-notify');
  assert.equal(output.includes('"kind":"reply"'), true);
  assert.equal(output.includes('"body":"回复完成 · 回复"'), true);
  await reader.cancel();
  hub.dispose();
});

test('hub suppresses push and browser mutes according to browserNotifyUsePushMutes', async () => {
  const pushMutedHub = new BrowserNotifyHub({
    getConfig: () => ({ ...BASE_CONFIG }),
    state: fakeState({ pushMuted: true }),
    notifier: helperNotifier(),
    logger: { warn() {} },
  });
  pushMutedHub.reply({ sessionId: 's1', turn: 1, text: '回复', sessionTitle: '会话一' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(pushMutedHub.buffer.length, 0);
  pushMutedHub.dispose();

  const independent = new BrowserNotifyHub({
    getConfig: () => ({ ...BASE_CONFIG, browserNotifyUsePushMutes: false }),
    state: fakeState({ pushMuted: true, browserMuted: true }),
    notifier: helperNotifier(),
    logger: { warn() {} },
  });
  independent.reply({ sessionId: 's1', turn: 1, text: '回复', sessionTitle: '会话一' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(independent.buffer.length, 0);
  independent.dispose();

  const independentAllowed = new BrowserNotifyHub({
    getConfig: () => ({ ...BASE_CONFIG, browserNotifyUsePushMutes: false }),
    state: fakeState({ pushMuted: true, browserMuted: false }),
    notifier: helperNotifier(),
    logger: { warn() {} },
  });
  independentAllowed.reply({ sessionId: 's1', turn: 1, text: '回复', sessionTitle: '会话一' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(independentAllowed.buffer.length, 1);
  independentAllowed.dispose();
});

test('hub maps user-question waterfall requests to session ids', async () => {
  const hub = new BrowserNotifyHub({
    getConfig: () => ({ ...BASE_CONFIG }),
    state: fakeState(),
    notifier: helperNotifier(),
    getSession: () => ({ header: { id: 's1', cwd: '/work/a' } }),
    logger: { warn() {} },
  });
  hub.question({ agent: { id: 's1' }, wait: { callId: 'call-1' }, questions: [{ question: '选哪个？' }] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(hub.buffer.length, 1);
  assert.equal(hub.buffer[0].sessionId, 's1');
  assert.equal(hub.buffer[0].body, '等待选择 · 选哪个？');
  hub.dispose();
});

test('hub skips subagent sessions and deduplicates repeated events', async () => {
  const hub = new BrowserNotifyHub({
    getConfig: () => ({ ...BASE_CONFIG }),
    state: fakeState(),
    notifier: helperNotifier(),
    logger: { warn() {} },
  });
  const child = { header: { id: 'child', origin: 'subagent' } };
  hub.reply({ session: child, sessionId: 'child', turn: 1, text: '子代理', sessionTitle: '子代理' });
  hub.reply({ sessionId: 's1', turn: 1, text: '回复', sessionTitle: '会话一' });
  hub.reply({ sessionId: 's1', turn: 1, text: '重复回复', sessionTitle: '会话一' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(hub.buffer.length, 1);
  assert.equal(hub.buffer[0].sessionId, 's1');
  hub.dispose();
});
