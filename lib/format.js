/**
 * Notification formatting: Markdown-to-plain-text, summaries, truncation, the
 * three note shapes, and click-through URLs.
 *
 * Bark renders a title and a body as plain text. Sending raw Markdown makes a
 * notification look like an unfinished editor buffer, so replies are reduced
 * to readable text before they leave the process. Nothing here performs I/O.
 *
 * @module dsh-bark-push/format
 */

/**
 * Truncate text by Unicode code points and mark the cut with an ellipsis.
 * @param {string} text - source text.
 * @param {number} maxLength - maximum resulting code points (including `…`).
 * @returns {string} bounded text.
 */
export function truncate(text, maxLength) {
  const source = String(text ?? '');
  const limit = Math.max(2, Math.floor(Number(maxLength) || 0));
  const chars = Array.from(source);
  if (chars.length <= limit) return source;
  return `${chars.slice(0, Math.max(1, limit - 1)).join('')}…`;
}

/**
 * Reduce Markdown to notification-friendly plain text.
 *
 * Handling is intentionally conservative: fenced code keeps its contents,
 * links keep their labels, images become alt text, headings lose their marks,
 * and inline emphasis is removed. HTML is stripped because Bark does not render
 * it and a tag would otherwise eat the visible budget.
 * @param {string} markdown - raw Markdown.
 * @returns {string} plain text.
 */
export function markdownToText(markdown) {
  let text = String(markdown ?? '').replace(/\r\n?/g, '\n');

  // Fenced code blocks keep their contents without the fence lines.
  text = text.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_, code) => `\n${String(code).trim()}\n`);
  text = text.replace(/~~~[^\n~]*\n?([\s\S]*?)~~~/g, (_, code) => `\n${String(code).trim()}\n`);

  // Inline code.
  text = text.replace(/`([^`\n]+)`/g, '$1');

  // Images first, then links: `[alt](url)` and `![alt](url)`.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => (String(alt).trim() || '[图片]'));
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Headings, blockquotes, list markers, and horizontal rules.
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
  text = text.replace(/^[ \t]{0,3}>[ \t]?/gm, '');
  text = text.replace(/^[ \t]{0,3}[-*+][ \t]+/gm, '• ');
  text = text.replace(/^[ \t]{0,3}(\d+)[.)][ \t]+/gm, '$1. ');
  text = text.replace(/^[ \t]{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/gm, '———');

  // Table separator rows.
  text = text.replace(/^[ \t]*\|?[ \t:|-]*-[ \t:|-]*\|[ \t:|-]*$/gm, '');
  // Trim cell padding while keeping the row readable.
  text = text.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_, cells) =>
    String(cells)
      .split('|')
      .map((cell) => cell.trim())
      .join(' | '),
  );

  // Emphasis and strikethrough.
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  text = text.replace(/__([^_\n]+)__/g, '$1');
  text = text.replace(/~~([^~\n]+)~~/g, '$1');
  text = text.replace(/(^|[^\w])[*_]([^*_\n]+)[*_](?!\w)/g, '$1$2');

  // Remaining HTML tags and escaped punctuation.
  text = text.replace(/<\/?[A-Za-z][^>]*>/g, '');
  text = text.replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1');

  // Whitespace normalization.
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/**
 * Build a one-line summary from already-plain text.
 * @param {string} text - plain text.
 * @param {number} maxLength - maximum code points.
 * @returns {string} summary.
 */
export function summarize(text, maxLength) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/^[•\-\s]+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter((line) => line.length > 0);
  const first = lines[0] ?? '';
  return truncate(first, maxLength);
}

/**
 * Compose a title from an optional prefix and a summary.
 * @param {string} summary - summary text.
 * @param {string} prefix - optional prefix.
 * @param {number} maxLength - total bound.
 * @returns {string} title.
 */
function titleWithPrefix(summary, prefix, maxLength) {
  const lead = String(prefix ?? '').trim();
  if (lead.length === 0) return truncate(summary, maxLength);
  return truncate(`${lead} ${summary}`, maxLength);
}

/**
 * Format one finished Agent reply.
 * @param {object} input - reply material.
 * @param {string} input.text - reply Markdown.
 * @param {string} [input.sessionTitle] - conversation label used by the `session` and `session-summary` modes.
 * @param {object} input.config - effective config.
 * @returns {{ title: string, body: string, kind: 'reply' } | null} note, or null when nothing visible remains.
 */
export function formatReply({ text, sessionTitle, config }) {
  const plain = markdownToText(text);
  if (plain.length === 0) return null;
  const summary = summarize(plain, config.maxTitleLength);
  const conversation = String(sessionTitle ?? '').trim();
  const mode = config.titleMode === 'summary' || config.titleMode === 'session-summary' ? config.titleMode : 'session';
  let base;
  if (mode === 'summary') base = summary;
  else if (mode === 'session-summary') {
    base = conversation.length > 0 && summary.length > 0 && conversation !== summary
      ? `${conversation} · ${summary}`
      : conversation || summary;
  } else {
    base = conversation || summary;
  }
  const title = titleWithPrefix(base, config.titlePrefix, config.maxTitleLength);
  const body = truncate(plain, config.maxBodyLength);
  return { title: title.length > 0 ? title : 'Agent 回复', body, kind: 'reply' };
}

/**
 * Format one approval request.
 * @param {object} input - approval material.
 * @param {string} input.toolName - tool awaiting a decision.
 * @param {string} [input.reason] - asker-supplied reason.
 * @param {string} [input.sessionTitle] - session label.
 * @param {string} [input.workspaceTitle] - workspace label.
 * @param {object} input.config - effective config.
 * @returns {{ title: string, body: string, kind: 'approval' }} note.
 */
export function formatApproval({ toolName, reason, sessionTitle, workspaceTitle, config }) {
  const tool = truncate(String(toolName ?? '').trim() || '未知工具', 120);
  const why = truncate(String(reason ?? '').trim().replace(/\s+/g, ' ') || '该操作需要你的授权', 400);
  const session = truncate(String(sessionTitle ?? '').trim() || '当前会话', 120);
  const lines = [`工具：${tool}`, `原因：${why}`, `会话：${session}`];
  if (workspaceTitle) lines.push(`工作区：${truncate(String(workspaceTitle), 120)}`);
  return {
    title: '需要批准',
    body: truncate(lines.join('\n'), config.maxBodyLength),
    kind: 'approval',
  };
}

/**
 * Format one structured user question batch.
 * @param {object} input - question material.
 * @param {Array<object>} input.questions - question items.
 * @param {string} [input.sessionTitle] - session label.
 * @param {object} input.config - effective config.
 * @returns {{ title: string, body: string, kind: 'question' }} note.
 */
export function formatQuestion({ questions, sessionTitle, config }) {
  const list = Array.isArray(questions) ? questions : [];
  const blocks = [];
  for (const [index, item] of list.slice(0, 5).entries()) {
    const question = String(item?.question ?? '').trim() || '需要你的选择';
    const header = String(item?.header ?? '').trim();
    const detail = String(item?.detail ?? '').trim();
    const heading = list.length > 1 ? `${index + 1}. ` : '';
    const lines = [`${heading}${header ? `${header}：` : ''}${truncate(question, 240)}`];
    if (detail.length > 0) lines.push(truncate(detail.replace(/\s+/g, ' '), 160));
    const options = Array.isArray(item?.options) ? item.options : [];
    if (item?.multiSelect === true) lines.push('（可多选）');
    for (const [optionIndex, option] of options.slice(0, 8).entries()) {
      const label = truncate(String(option?.label ?? '').trim() || `选项 ${optionIndex + 1}`, 80);
      const description = String(option?.description ?? '').trim();
      lines.push(`  ${optionIndex + 1}) ${label}${description ? ` — ${truncate(description.replace(/\s+/g, ' '), 80)}` : ''}`);
    }
    blocks.push(lines.join('\n'));
  }
  if (blocks.length === 0) blocks.push('Agent 正在等待你的选择。');
  const session = String(sessionTitle ?? '').trim();
  if (session.length > 0) blocks.push(`会话：${truncate(session, 120)}`);
  return {
    title: '等待选择',
    body: truncate(blocks.join('\n\n'), config.maxBodyLength),
    kind: 'question',
  };
}

/**
 * Format the test notification.
 * @param {object} config - effective config.
 * @param {Date} [now] - clock used for the timestamp.
 * @returns {{ title: string, body: string, kind: 'test' }} note.
 */
export function formatTest(config, now = new Date()) {
  const stamp = now.toLocaleString('zh-CN', { hour12: false });
  const keyCount = Array.isArray(config.deviceKeys) ? config.deviceKeys.length : 0;
  return {
    title: 'Bark 推送测试',
    body: truncate(`配置有效：DSH 可以把通知推送到 ${keyCount} 个设备。\n时间：${stamp}`, config.maxBodyLength),
    kind: 'test',
  };
}

/**
 * Build a click-through URL that the web client turns into an open session.
 *
 * DSH's Web client has no addressable session route, so `dsh-bark-push` ships a
 * small client-side bridge: the page reads `barkSession`, removes it from the
 * address bar, and calls the same `uiWorkspace.openSession()` the sidebar uses.
 * @param {object} input - link material.
 * @param {string} [input.baseUrl] - advertised public root.
 * @param {string} input.sessionId - Session id.
 * @param {string} [input.focus] - optional focus hint (`approval`).
 * @returns {string | undefined} absolute URL, or undefined when no base is known.
 */
export function buildSessionUrl({ baseUrl, sessionId, focus }) {
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) return undefined;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined;
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.searchParams.set('barkSession', sessionId);
    if (focus) url.searchParams.set('barkFocus', String(focus));
    return url.toString();
  } catch {
    return undefined;
  }
}
