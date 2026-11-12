import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSessionUrl,
  formatApproval,
  formatQuestion,
  formatReply,
  markdownToText,
  summarize,
  truncate,
} from '../lib/format.js';
import { DEFAULTS } from '../lib/config.js';

const config = { ...DEFAULTS, deviceKeys: [], maxTitleLength: 40, maxBodyLength: 200 };

test('strips Markdown while keeping readable content', () => {
  const text = markdownToText(
    [
      '# 标题',
      '',
      '**粗体** 与 *斜体*，还有 `inline`。',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '- 第一项',
      '- [链接](https://example.com)',
      '',
      '> 引用',
    ].join('\n'),
  );
  assert.equal(text.includes('#'), false);
  assert.equal(text.includes('**'), false);
  assert.equal(text.includes('```'), false);
  assert.equal(text.includes('const x = 1;'), true);
  assert.equal(text.includes('链接'), true);
  assert.equal(text.includes('https://example.com'), false);
  assert.equal(text.includes('• 第一项'), true);
  assert.equal(text.includes('引用'), true);
});

test('a horizontal rule does not swallow the rest of the message', () => {
  const text = markdownToText('第一段\n\n---\n\n第二段');
  assert.equal(text.includes('第一段'), true);
  assert.equal(text.includes('第二段'), true);
  assert.equal(text.includes('———'), true);
});

test('summaries keep a leading number that is content, not a list marker', () => {
  assert.equal(summarize('3 个方案已完成', 30), '3 个方案已完成');
  assert.equal(summarize('1. 第一步', 30), '第一步');
});

test('truncates by code point and appends one ellipsis', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('你好世界', 3), '你好…');
  assert.equal(truncate('abc', 10), 'abc');
});

test('summarizes the first meaningful line', () => {
  assert.equal(summarize('\n\n- 完成啦\n第二行', 20), '完成啦');
});

test('formats a reply with the conversation title by default', () => {
  const note = formatReply({ text: '## 完成\n\n已经处理了 **所有** 项目。', sessionTitle: '部署脚本', config });
  assert.equal(note.title, '部署脚本');
  assert.equal(note.body.includes('已经处理了 所有 项目。'), true);
  assert.equal(note.kind, 'reply');
});

test('reply title modes select conversation, combined, or summary titles', () => {
  const text = '## 完成\n\n已经处理了所有项目。';
  const summary = formatReply({ text, sessionTitle: '部署脚本', config: { ...config, titleMode: 'summary' } });
  assert.equal(summary.title, '完成');
  const combined = formatReply({ text, sessionTitle: '部署脚本', config: { ...config, titleMode: 'session-summary' } });
  assert.equal(combined.title, '部署脚本 · 完成');
  const fallback = formatReply({ text, sessionTitle: '', config: { ...config, titleMode: 'session' } });
  assert.equal(fallback.title, '完成');
});

test('returns null for a reply with no visible text', () => {
  assert.equal(formatReply({ text: '   \n\n', config }), null);
});

test('formats approval and question titles exactly as specified', () => {
  const approval = formatApproval({
    toolName: 'Bash',
    reason: '需要写入工作区外的文件',
    sessionTitle: '部署脚本',
    workspaceTitle: 'HelloDeepseek',
    config,
  });
  assert.equal(approval.title, '需要批准');
  assert.equal(approval.body.includes('Bash'), true);
  assert.equal(approval.body.includes('需要写入工作区外的文件'), true);
  assert.equal(approval.body.includes('HelloDeepseek'), true);

  const question = formatQuestion({
    questions: [
      {
        id: 'q1',
        header: '选择方案',
        question: '要用哪一种实现？',
        options: [{ label: '简单方案' }, { label: '扩展方案', description: '更多代码' }],
      },
    ],
    sessionTitle: '设计讨论',
    config,
  });
  assert.equal(question.title, '等待选择');
  assert.equal(question.body.includes('要用哪一种实现？'), true);
  assert.equal(question.body.includes('1) 简单方案'), true);
  assert.equal(question.body.includes('2) 扩展方案 — 更多代码'), true);
});

test('builds a session deep link and rejects unusable bases', () => {
  const url = buildSessionUrl({ baseUrl: 'https://dsh.example.com/', sessionId: 'session-1', focus: 'approval' });
  assert.equal(url, 'https://dsh.example.com/?barkSession=session-1&barkFocus=approval');
  assert.equal(buildSessionUrl({ baseUrl: '', sessionId: 'session-1' }), undefined);
  assert.equal(buildSessionUrl({ baseUrl: 'ftp://x/', sessionId: 'session-1' }), undefined);
});
