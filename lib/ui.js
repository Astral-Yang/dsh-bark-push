/**
 * Self-contained management page for Bark configuration and mute state.
 *
 * The page is served by the authenticated host route, so it uses only
 * same-origin fetch and no external assets. All dynamic values are written
 * through `textContent` or form values; server data never becomes HTML.
 *
 * @module dsh-bark-push/ui
 */

/**
 * Render the management page.
 * @param {object} options - render options.
 * @param {string} options.version - plugin version.
 * @param {boolean} [options.embedded] - compact layout for the Settings iframe.
 * @returns {string} complete HTML document.
 */
export function renderUiPage({ version, embedded = false }) {
  const safeVersion = String(version ?? '').replace(/[^0-9A-Za-z._-]/g, '');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bark 推送 · DSH</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --fg: #1c1d21;
    --muted: #6b6f7a;
    --line: #e3e5ea;
    --card: #f7f8fa;
    --accent: #3b6ef6;
    --ok: #16894f;
    --bad: #c0392b;
    --warn: #a66a00;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #17181c;
      --fg: #eceef3;
      --muted: #9aa0ad;
      --line: #2d3038;
      --card: #1f2127;
      --accent: #7aa2ff;
      --ok: #5dd39e;
      --bad: #ff7b72;
      --warn: #e3b341;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  main { max-width: 880px; margin: 0 auto; padding: 24px 20px 64px; }
  body.embedded main { padding: 12px 14px 40px; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: .01em; }
  h2 { font-size: 15px; margin: 0 0 12px; }
  p.lead { color: var(--muted); margin: 0 0 20px; }
  .card { border: 1px solid var(--line); background: var(--card); border-radius: 12px; padding: 16px; margin: 0 0 16px; }
  .row { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 10px 16px; align-items: center; margin: 0 0 10px; }
  .row > label:first-child { color: var(--muted); }
  .row.wide { grid-template-columns: 1fr; }
  input[type=text], input[type=number], select, textarea {
    width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px;
    background: var(--bg); color: var(--fg); font: inherit;
  }
  textarea { min-height: 70px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .checks { display: flex; flex-wrap: wrap; gap: 10px 18px; }
  .checks label { display: inline-flex; align-items: center; gap: 6px; color: var(--fg); }
  button {
    appearance: none; border: 1px solid var(--line); background: var(--bg); color: var(--fg);
    border-radius: 8px; padding: 7px 12px; font: inherit; cursor: pointer;
  }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.danger { color: var(--bad); }
  button:disabled { opacity: .5; cursor: default; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .statusbar { margin: 0 0 16px; }
  .status { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--muted); font-size: 13px; }
  .pill { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; }
  .pill.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, var(--line)); }
  .pill.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, var(--line)); }
  .pill.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); }
  .test-result { margin-top: 10px; border-top: 1px dashed var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 5px; }
  .test-result .tr-title { font-size: 13px; font-weight: 600; }
  .test-result .tr-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .test-result .tr-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .test-result .tr-msg { color: var(--muted); font-size: 12px; }
  .save-status { font-size: 12px; margin-left: 8px; align-self: center; }
  .save-status.ok { color: var(--ok); }
  .save-status.bad { color: var(--bad); }
  .save-status.warn { color: var(--warn); }
  details.advanced { margin: 12px 0 4px; border: 1px dashed var(--line); border-radius: 10px; padding: 2px 14px 10px; background: color-mix(in srgb, var(--accent) 4%, transparent); }
  details.advanced > summary { cursor: pointer; color: var(--accent); font-weight: 600; padding: 9px 0; list-style: none; user-select: none; }
  details.advanced > summary::-webkit-details-marker { display: none; }
  details.advanced > summary::before { content: '▸ '; }
  details.advanced[open] > summary::before { content: '▾ '; }
  .advanced-group { margin: 8px 0 2px; }
  .advanced-group h3 { font-size: 13px; font-weight: 600; color: var(--muted); margin: 8px 0 8px; }
  .keylist { display: flex; flex-direction: column; gap: 4px; margin: 0 0 10px; color: var(--muted); }
  .keylist code { color: var(--fg); word-break: break-all; }
  .lists { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 720px) { .lists { grid-template-columns: 1fr; } .row { grid-template-columns: 1fr; } }
  .list { max-height: 320px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; padding: 6px; }
  .item { display: flex; gap: 8px; align-items: flex-start; padding: 5px 6px; border-radius: 6px; }
  .item:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .item .meta { min-width: 0; }
  .item .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .sub { color: var(--muted); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; word-break: break-word; }
  .empty { color: var(--muted); padding: 8px; }
  #toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: var(--fg); color: var(--bg); padding: 8px 14px; border-radius: 999px;
    font-size: 13px; opacity: 0; pointer-events: none; transition: opacity .18s ease;
    max-width: 80vw; text-align: center; z-index: 10;
  }
  #toast.show { opacity: 1; }
  #toast.bad { background: var(--bad); color: #fff; }
  .hint { color: var(--muted); font-size: 12px; margin: 4px 0 0; }
  .channel { border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin: 0 0 12px; background: var(--bg); }
  .channel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .channel-head .name { font-weight: 600; }
  .channel-head .grow { flex: 1; }
  .channel-head .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); }
  .channel-field { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 8px 14px; align-items: center; margin: 0 0 8px; }
  .channel-field > label { color: var(--muted); }
  .channel-field .req { color: var(--bad); }
  .channel-add { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
  .channel-add select { max-width: 300px; }
  @media (max-width: 720px) { .channel-field { grid-template-columns: 1fr; } }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body class="${embedded ? 'embedded' : ''}">
<main>
  <h1><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-4px;margin-right:8px"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>Bark 推送</h1>
  <p class="lead">把 DSH 的回复、审批和选择请求推送到 iPhone。配置保存在本机，Device Key 不会显示在页面或日志中。</p>

  <div class="statusbar">
    <div class="status" id="status"><span class="pill">读取中…</span></div>
    <p class="hint" id="warnings" hidden></p>
  </div>

  <div class="card">
    <h2>连接与通知</h2>
    <div class="row"><label for="server">Bark Server</label><input id="server" type="text" placeholder="https://api.day.app"></div>
    <div class="row"><label>已配置 Device Key</label><div><div class="keylist" id="keylist"></div><p class="hint">页面只显示掩码；新增密钥逐行粘贴，保存后不再显示完整值。</p></div></div>
    <div class="row"><label for="newKeys">新增 Device Key</label><textarea id="newKeys" placeholder="每行一个"></textarea></div>
    <div class="row"><label>通知类型</label><div class="checks">
      <label><input id="enabled" type="checkbox"> 总开关</label>
      <label><input id="notifyOnReply" type="checkbox"> Agent 回复</label>
      <label><input id="notifyOnApproval" type="checkbox"> 需要批准</label>
      <label><input id="notifyOnQuestion" type="checkbox"> 等待选择</label>
      <label><input id="includeSubagents" type="checkbox"> 包含子代理</label>
    </div></div>

    <details class="advanced" id="barkAdvanced">
      <summary>高级选项（分组、级别与铃声、标题、长度、超时、跳转）</summary>
      <p class="hint">以下为可选设置，保持默认即可；需要时再展开调整。</p>

      <div class="advanced-group">
        <h3>分组与图标</h3>
        <div class="row"><label for="group">通知分组 Group</label><input id="group" type="text" placeholder="DSH"></div>
        <div class="row"><label for="icon">图标 Icon（可选）</label><input id="icon" type="text" placeholder="https://…"></div>
      </div>

      <div class="advanced-group">
        <h3>通知级别与铃声</h3>
        <div class="row"><label for="levelReply">回复级别</label><select id="levelReply">
          <option value="active">主动通知（active）</option>
          <option value="timeSensitive">时效性通知（timeSensitive）</option>
          <option value="passive">静默通知（passive）</option>
          <option value="critical">紧急通知（critical）</option>
        </select></div>
        <div class="row"><label for="soundReply">回复铃声（可选）</label><input id="soundReply" type="text" placeholder="bell；留空用系统默认"></div>
        <div class="row"><label for="levelApproval">审批级别</label><select id="levelApproval">
          <option value="active">主动通知（active）</option>
          <option value="timeSensitive">时效性通知（timeSensitive）</option>
          <option value="passive">静默通知（passive）</option>
          <option value="critical">紧急通知（critical）</option>
        </select></div>
        <div class="row"><label for="soundApproval">审批铃声（可选）</label><input id="soundApproval" type="text" placeholder="alarm；留空用系统默认"></div>
        <div class="row"><label for="levelQuestion">选择级别</label><select id="levelQuestion">
          <option value="active">主动通知（active）</option>
          <option value="timeSensitive">时效性通知（timeSensitive）</option>
          <option value="passive">静默通知（passive）</option>
          <option value="critical">紧急通知（critical）</option>
        </select></div>
        <div class="row"><label for="soundQuestion">选择铃声（可选）</label><input id="soundQuestion" type="text" placeholder="bell；留空用系统默认"></div>
        <p class="hint"><strong>级别说明</strong><br>
          主动通知（active）：默认级别，收到通知时会亮屏提醒。<br>
          时效性通知（timeSensitive）：优先级较高，可在允许时效性通知的专注模式下显示。<br>
          静默通知（passive）：仅显示在通知中心，不主动亮屏提醒。<br>
          紧急通知（critical）：最高优先级，可突破静音模式和专注模式，并发出提示音。需要在 Bark App 中授权「重要警告」；没有授权时会降级成普通通知，推送铃声音量由 volume 控制。需要 iOS 15 及以上。
        </p>
      </div>

      <div class="advanced-group">
        <h3>标题与长度</h3>
        <div class="row"><label for="titleMode">回复标题来源</label><select id="titleMode">
          <option value="session">会话标题</option>
          <option value="session-summary">会话标题 + 回复摘要</option>
          <option value="summary">回复摘要</option>
        </select></div>
        <div class="row"><label for="titlePrefix">标题前缀（可选）</label><input id="titlePrefix" type="text" placeholder="留空则只用所选标题"></div>
        <div class="row"><label for="maxTitleLength">标题最大长度</label><input id="maxTitleLength" type="number" min="8" max="200"></div>
        <div class="row"><label for="maxBodyLength">正文最大长度</label><input id="maxBodyLength" type="number" min="32" max="4000"></div>
      </div>

      <div class="advanced-group">
        <h3>网络与重试</h3>
        <div class="row"><label for="timeoutMs">请求超时（毫秒）</label><input id="timeoutMs" type="number" min="1000" max="30000"></div>
        <div class="row"><label for="maxRetries">最大重试次数</label><input id="maxRetries" type="number" min="0" max="5"></div>
        <div class="row"><label for="retryDelayMs">重试基础间隔（毫秒）</label><input id="retryDelayMs" type="number" min="50" max="10000"></div>
      </div>

      <div class="advanced-group">
        <h3>跳转与调试</h3>
        <div class="row"><label>点击通知跳转</label><div class="checks">
          <label><input id="linkToSession" type="checkbox"> 打开对应会话</label>
          <label><input id="trace" type="checkbox"> 调试日志</label>
        </div></div>
        <div class="row"><label for="publicBaseUrl">公共访问地址（可选）</label><input id="publicBaseUrl" type="text" placeholder="https://dsh.example.com/"></div>
        <p class="hint">公共访问地址留空时使用 DSH 的 advertised URL；点击跳转依赖浏览器已登录（有 DSH 会话 Cookie）。</p>
      </div>
    </details>

    <div class="actions">
      <button class="primary" id="save">保存配置</button>
      <button id="test">测试推送</button>
      <button id="reset" class="danger">恢复默认</button>
      <button id="addKeys">追加密钥</button>
      <button id="clearKeys" class="danger">清空密钥</button>
      <span id="barkSaveStatus" class="save-status" role="status" aria-live="polite"></span>
    </div>
    <div class="test-result" id="barkTestResult" hidden></div>
  </div>

  <div class="card">
    <h2>更多推送渠道</h2>
    <p class="hint">Bark 之外，可同时启用 Gotify、ntfy、PushDeer、Server酱、PushPlus、额外 Bark 或自定义 Webhook。每个渠道独立开关、超时与重试；任一渠道失败不影响其他渠道。密钥只保存在本机，页面和日志中只显示“已设置”。</p>
    <div id="channelList"></div>
    <div class="channel-add">
      <select id="channelTypeSelect" aria-label="渠道类型"></select>
      <button id="addChannel">添加渠道</button>
      <button class="primary" id="saveChannels">保存配置</button>
      <span id="channelsSaveStatus" class="save-status" role="status" aria-live="polite"></span>
    </div>
    <p class="hint">添加后填写参数，点本卡片内的“保存配置”即可生效（与上方表单一起保存；密钥留空表示保持原值）。</p>
  </div>

  <div class="card">
    <h2>静音管理</h2>
    <p class="hint">工作区静音优先于会话静音；任一层级静音即停止推送。静音状态持久化，重启 DSH 或插件后仍然有效。</p>
    <div class="lists">
      <div>
        <h2 style="font-size:13px">工作区</h2>
        <div class="list" id="workspaces"><div class="empty">读取中…</div></div>
      </div>
      <div>
        <h2 style="font-size:13px">会话</h2>
        <input id="sessionSearch" type="text" placeholder="按标题或 ID 过滤" style="margin-bottom:6px">
        <div class="list" id="sessions"><div class="empty">读取中…</div></div>
      </div>
    </div>
  </div>

  <p class="hint">dsh-bark-push v${safeVersion} · 只向这里配置的 Bark 服务发送内容。</p>
</main>
<div id="toast" role="status" aria-live="polite"></div>
<script>
(() => {
  'use strict';
  const api = {
    state: '/api/bark-push/state',
    config: '/api/bark-push/config',
    mute: '/api/bark-push/mute',
    toggle: '/api/bark-push/toggle',
    test: '/api/bark-push/test',
    testChannel: '/api/bark-push/test-channel'
  };
  const $ = (id) => document.getElementById(id);
  let current = null;
  let toastTimer = null;
  let channelTypes = [];
  let channelDraft = [];

  function toast(message, bad) {
    const text = message == null ? '' : String(message);
    // Embedded in the DSH Settings iframe: the page has no scroll viewport of
    // its own (the host grows the iframe to full content height), so a local
    // fixed toast would sit at the very bottom and never be seen. Hand the
    // notice to the parent, which renders it in the frame-wide overlay layer.
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage(
          { type: 'dsh-bark-push:toast', message: text, kind: bad ? 'bad' : 'ok' },
          window.location.origin,
        );
        return;
      } catch (_) {
        // Fall through to the local toast if postMessage is blocked.
      }
    }
    const node = $('toast');
    if (!node) return;
    node.textContent = text;
    node.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.className = ''; }, 3200);
  }

  // Low-level fetch that returns the parsed payload even when the payload's
  // own ok flag is false. Used by the test endpoints, where a partial
  // delivery failure is a 200 response with a detailed per-target result.
  async function requestAllowFail(path, body) {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined
        ? { accept: 'application/json' }
        : { 'content-type': 'application/json', 'x-dsh-bark-action': '1', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let payload = null;
    try { payload = await response.json(); } catch (_) { payload = null; }
    if (!response.ok || !payload) {
      throw new Error((payload && payload.error) || ('HTTP ' + response.status));
    }
    return payload;
  }

  async function request(path, body) {
    const payload = await requestAllowFail(path, body);
    if (payload.ok === false) {
      throw new Error(payload.error || '请求被拒绝');
    }
    return payload;
  }

  function text(node, value) { node.textContent = value == null ? '' : String(value); }

  // Persistent, in-place action feedback next to the save buttons. Unlike a
  // transient toast, this stays visible at the exact spot the user acted, so
  // "保存成功/失败" is never missed while scrolled to a longer card.
  function setSaveStatus(targetId, message, kind) {
    const node = $(targetId);
    if (!node) return;
    node.textContent = message || '';
    node.className = 'save-status' + (kind ? ' ' + kind : '');
  }

  function nowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function markChannelsDirty() {
    setSaveStatus('channelsSaveStatus', '有未保存的更改，点“保存配置”生效', 'warn');
  }

  function fill(config) {
    $('server').value = config.server || '';
    $('group').value = config.group || '';
    $('icon').value = config.icon || '';
    $('levelReply').value = config.levelReply || config.levelNormal || 'active';
    $('soundReply').value = config.soundReply ?? config.soundNormal ?? '';
    $('levelApproval').value = config.levelApproval || config.levelImportant || 'timeSensitive';
    $('soundApproval').value = config.soundApproval ?? config.soundImportant ?? '';
    $('levelQuestion').value = config.levelQuestion || config.levelNormal || 'active';
    $('soundQuestion').value = config.soundQuestion ?? config.soundNormal ?? '';
    $('titlePrefix').value = config.titlePrefix || '';
    $('titleMode').value = config.titleMode || 'session';
    $('maxTitleLength').value = config.maxTitleLength;
    $('maxBodyLength').value = config.maxBodyLength;
    $('timeoutMs').value = config.timeoutMs;
    $('maxRetries').value = config.maxRetries;
    $('retryDelayMs').value = config.retryDelayMs;
    $('publicBaseUrl').value = config.publicBaseUrl || '';
    $('enabled').checked = config.enabled === true;
    $('notifyOnReply').checked = config.notifyOnReply === true;
    $('notifyOnApproval').checked = config.notifyOnApproval === true;
    $('notifyOnQuestion').checked = config.notifyOnQuestion === true;
    $('includeSubagents').checked = config.includeSubagents === true;
    $('linkToSession').checked = config.linkToSession === true;
    $('trace').checked = config.trace === true;

    const list = $('keylist');
    list.replaceChildren();
    if (!config.deviceKeyCount) {
      const empty = document.createElement('span');
      empty.className = 'empty';
      text(empty, '尚未配置 Device Key');
      list.append(empty);
    } else {
      for (const masked of config.deviceKeysMasked || []) {
        const line = document.createElement('div');
        const code = document.createElement('code');
        text(code, masked);
        line.append(code);
        list.append(line);
      }
    }
    fillChannels(config);
  }

  function typeInfo(type) {
    return channelTypes.find((entry) => entry.type === type);
  }

  function genChannelId() {
    return 'ch_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
  }

  function cloneChannel(channel) {
    return {
      id: channel.id,
      type: channel.type,
      label: channel.label || '',
      enabled: channel.enabled !== false,
      config: Object.assign({}, channel.config || {}),
      secretsSet: Object.assign({}, channel.secretsSet || {})
    };
  }

  function fillChannels(config) {
    channelDraft = (Array.isArray(config.channels) ? config.channels : []).map(cloneChannel);
    renderChannels();
  }

  // Pull current input values back into the channel draft so a re-render (add /
  // remove) does not discard edits. Secret inputs are intentionally blank in
  // the DOM; an empty secret is sent as "" and the host keeps the stored one.
  function syncChannels() {
    const cards = $('channelList') ? $('channelList').querySelectorAll('.channel') : [];
    for (const card of cards) {
      const index = Number(card.dataset.index);
      const channel = channelDraft[index];
      if (!channel) continue;
      const enabledBox = card.querySelector('[data-role="enabled"]');
      if (enabledBox) channel.enabled = enabledBox.checked;
      const config = {};
      card.querySelectorAll('[data-field]').forEach((input) => {
        const key = input.dataset.field;
        const kind = input.dataset.kind;
        if (kind === 'checkbox') config[key] = input.checked;
        else config[key] = input.value;
      });
      channel.config = config;
    }
  }

  function collectChannels() {
    syncChannels();
    return channelDraft.map((channel) => ({
      id: channel.id,
      type: channel.type,
      label: channel.label || '',
      enabled: channel.enabled !== false,
      config: Object.assign({}, channel.config)
    }));
  }

  function channelButton(label, cls, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (cls) button.className = cls;
    button.addEventListener('click', onClick);
    return button;
  }

  function renderChannels() {
    const box = $('channelList');
    if (!box) return;
    box.replaceChildren();
    if (!channelDraft.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      text(empty, '尚未添加额外渠道');
      box.append(empty);
    }
    channelDraft.forEach((channel, index) => box.append(channelCard(channel, index)));
    const select = $('channelTypeSelect');
    if (select && select.options.length === 0) {
      for (const entry of channelTypes) {
        const option = document.createElement('option');
        option.value = entry.type;
        option.textContent = entry.name;
        select.append(option);
      }
    }
  }

  function channelCard(channel, index) {
    const info = typeInfo(channel.type);
    const card = document.createElement('div');
    card.className = 'channel';
    card.dataset.index = String(index);
    card.dataset.id = channel.id;

    const head = document.createElement('div');
    head.className = 'channel-head';
    const name = document.createElement('span');
    name.className = 'name';
    text(name, info ? info.name : channel.type);
    const grow = document.createElement('span');
    grow.className = 'grow';
    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'badge';
    const enabledBox = document.createElement('input');
    enabledBox.type = 'checkbox';
    enabledBox.checked = channel.enabled !== false;
    enabledBox.dataset.role = 'enabled';
    enabledBox.addEventListener('change', () => {
      channel.enabled = enabledBox.checked;
      markChannelsDirty();
      toast((info ? info.name : '渠道') + (channel.enabled ? ' 已启用，点保存生效' : ' 已停用，点保存生效'));
    });
    enabledLabel.append(enabledBox, document.createTextNode(' 启用'));
    const testBtn = channelButton('测试', '', () => testChannel(channel.id, testBtn, info));
    const removeBtn = channelButton('删除', 'danger', () => {
      syncChannels();
      channelDraft = channelDraft.filter((entry) => entry.id !== channel.id);
      renderChannels();
      markChannelsDirty();
      toast('已移除渠道「' + (info ? info.name : channel.type) + '」，点保存生效');
    });
    head.append(name, grow, enabledLabel, testBtn, removeBtn);
    card.append(head);

    for (const field of (info ? info.fields : [])) {
      const row = document.createElement('div');
      row.className = 'channel-field';
      const label = document.createElement('label');
      text(label, field.label);
      if (field.required) {
        const star = document.createElement('span');
        star.className = 'req';
        text(star, ' *');
        label.append(star);
      }
      let input;
      if (field.kind === 'select') {
        input = document.createElement('select');
        for (const option of field.options || []) {
          const opt = document.createElement('option');
          opt.value = option.value;
          opt.textContent = option.label;
          input.append(opt);
        }
        input.value = channel.config && channel.config[field.key] !== undefined ? channel.config[field.key] : (field.default || '');
      } else if (field.kind === 'textarea') {
        input = document.createElement('textarea');
        input.value = channel.config && channel.config[field.key] != null ? channel.config[field.key] : '';
        if (field.placeholder) input.placeholder = field.placeholder;
      } else if (field.kind === 'checkbox') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = channel.config ? channel.config[field.key] === true : field.default === true;
      } else {
        input = document.createElement('input');
        input.type = field.kind === 'secret' ? 'password' : field.kind === 'number' ? 'number' : 'text';
        const stored = channel.config ? channel.config[field.key] : undefined;
        const alreadySet = field.kind === 'secret' && channel.secretsSet && channel.secretsSet[field.key];
        // Stored secrets are never echoed: show blank + a hint. A brand-new
        // secret the user just typed (not yet saved) stays visible.
        input.value = alreadySet ? '' : (stored != null ? stored : (field.default || ''));
        if (alreadySet) input.placeholder = '已设置，留空保持不变';
        else if (field.placeholder) input.placeholder = field.placeholder;
      }
      input.dataset.field = field.key;
      input.dataset.kind = field.kind;
      row.append(label, input);
      card.append(row);
    }
    const result = document.createElement('div');
    result.className = 'test-result channel-result';
    result.hidden = true;
    card.append(result);
    return card;
  }

  async function testChannel(id, button, info) {
    button.disabled = true;
    try {
      // Persist first so the host tests exactly what is on screen.
      const saved = await request(api.config, collect());
      current = saved;
      channelTypes = saved.channelTypes || channelTypes;
      fill(saved.config);
      status(saved);
      const data = await requestAllowFail(api.testChannel, { id });
      const detail = (data.result && data.result.results && data.result.results[0]) || {};
      renderChannelTestResult(id, data.result || {});
      if (data.ok) toast((info ? info.name : '渠道') + ' 测试成功');
      else toast((info ? info.name : '渠道') + ' 测试失败：' + (detail.message || detail.reason || '未知错误'), true);
    } catch (error) {
      toast('测试失败：' + error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function status(data) {
    if (Array.isArray(data.channelTypes) && data.channelTypes.length > 0) channelTypes = data.channelTypes;
    const node = $('status');
    node.replaceChildren();
    const add = (label, cls) => {
      const pill = document.createElement('span');
      pill.className = 'pill' + (cls ? ' ' + cls : '');
      text(pill, label);
      node.append(pill);
    };
    add(data.config.enabled ? '已启用' : '已禁用', data.config.enabled ? 'ok' : 'warn');
    add((data.config.deviceKeyCount || 0) + ' 个设备', data.config.deviceKeyCount ? 'ok' : 'bad');
    if (Array.isArray(data.config.channels) && data.config.channels.length > 0) {
      add(data.config.channels.length + ' 个额外渠道', 'ok');
    }
    add(data.config.group ? ('分组 ' + data.config.group) : '默认分组');
    if (data.lastTest) add('上次测试 ' + (data.lastTest.ok ? '成功' : '失败'), data.lastTest.ok ? 'ok' : 'bad');
    if (data.lastDelivery) add('上次' + labelOf(data.lastDelivery.kind) + (data.lastDelivery.ok ? '成功' : (data.lastDelivery.skipped ? '跳过' : '失败')), data.lastDelivery.ok ? 'ok' : (data.lastDelivery.skipped ? 'warn' : 'bad'));

    const warnings = $('warnings');
    if (data.warnings && data.warnings.length) {
      warnings.hidden = false;
      text(warnings, data.warnings.join('；'));
    } else {
      warnings.hidden = true;
      text(warnings, '');
    }
  }

  function labelOf(kind) {
    return kind === 'reply' ? '回复' : kind === 'approval' ? '审批' : kind === 'question' ? '选择' : kind === 'test' ? '测试' : '推送';
  }

  function typeLabel(type) {
    const info = typeInfo(type);
    return info ? info.name : type;
  }

  // Render a per-target breakdown into the card that triggered the test, so
  // the result is visible right where the user acted (no scrolling to the top).
  function renderResultInto(box, result) {
    if (!box) return;
    const results = (result && Array.isArray(result.results)) ? result.results : [];
    box.replaceChildren();
    if (!results.length) {
      box.hidden = true;
      return;
    }
    const title = document.createElement('div');
    title.className = 'tr-title';
    const okCount = results.filter((entry) => entry.ok === true).length;
    text(title, '测试结果：' + okCount + ' 成功 / ' + (results.length - okCount) + ' 失败');
    box.append(title);
    for (const entry of results) {
      const row = document.createElement('div');
      row.className = 'tr-row';
      const name = document.createElement('span');
      name.className = 'tr-name';
      const label = entry.channelType
        ? (entry.label || typeLabel(entry.channelType))
        : ('Bark ' + (entry.maskedKey || '设备'));
      text(name, label);
      const pill = document.createElement('span');
      if (entry.ok === true) {
        pill.className = 'pill ok';
        text(pill, '成功');
      } else if (entry.skipped === true) {
        pill.className = 'pill warn';
        text(pill, '未发送');
      } else {
        pill.className = 'pill bad';
        text(pill, '失败');
      }
      row.append(name, pill);
      const reason = entry.message || entry.reason || '';
      if (reason && entry.ok !== true) {
        const msg = document.createElement('span');
        msg.className = 'tr-msg';
        text(msg, reason);
        row.append(msg);
      }
      box.append(row);
    }
    box.hidden = false;
  }

  function renderBarkTestResult(result) {
    renderResultInto($('barkTestResult'), result);
  }

  function findChannelCard(id) {
    const cards = $('channelList') ? $('channelList').querySelectorAll('.channel') : [];
    for (const card of cards) {
      if (card.dataset && card.dataset.id === id) return card;
    }
    return null;
  }

  function renderChannelTestResult(id, result) {
    const card = findChannelCard(id);
    const box = card ? card.querySelector('.channel-result') : null;
    renderResultInto(box, result);
  }

  function renderMutes(data) {
    const mutedWorkspaces = new Set(data.mute.workspaces || []);
    const mutedSessions = new Set(data.mute.sessions || []);
    const workspaceBox = $('workspaces');
    workspaceBox.replaceChildren();
    if (!data.catalog.workspaces.length) {
      const empty = document.createElement('div'); empty.className = 'empty'; text(empty, '没有工作区记录');
      workspaceBox.append(empty);
    }
    for (const workspace of data.catalog.workspaces) {
      workspaceBox.append(muteRow('workspace', workspace.id, workspace.title || workspace.id, workspace.path, mutedWorkspaces.has(workspace.id)));
    }

    const query = ($('sessionSearch').value || '').trim().toLowerCase();
    const sessionBox = $('sessions');
    sessionBox.replaceChildren();
    const rows = data.catalog.sessions.filter((session) => {
      if (!query) return true;
      return String(session.title || '').toLowerCase().includes(query) || String(session.id).toLowerCase().includes(query);
    });
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'empty'; text(empty, '没有会话记录');
      sessionBox.append(empty);
    }
    for (const session of rows) {
      const subLines = [
        session.id,
        session.workspaceId ? ('工作区 ' + session.workspaceId) : '',
        session.offline ? '离线' : '',
      ].filter(Boolean);
      sessionBox.append(muteRow('session', session.id, session.title || '未命名会话', subLines, mutedSessions.has(session.id)));
    }
  }

  function muteRow(kind, id, title, sub, muted) {
    const item = document.createElement('label');
    item.className = 'item';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = muted;
    box.addEventListener('change', async () => {
      box.disabled = true;
      try {
        const data = await request(api.mute, { kind, id, muted: box.checked });
        current = data;
        fill(data.config);
        status(data);
        renderMutes(data);
        toast(box.checked ? '已静音' : '已取消静音');
      } catch (error) {
        box.checked = !box.checked;
        toast('保存失败：' + error.message, true);
      } finally {
        box.disabled = false;
      }
    });
    const meta = document.createElement('div');
    meta.className = 'meta';
    const titleNode = document.createElement('div');
    titleNode.className = 'title';
    text(titleNode, title);
    const subLines = Array.isArray(sub) ? sub : [sub];
    meta.append(titleNode);
    for (const line of subLines) {
      if (!line) continue;
      const subNode = document.createElement('div');
      subNode.className = 'sub';
      text(subNode, line);
      meta.append(subNode);
    }
    item.append(box, meta);
    return item;
  }

  // The Settings shell embeds this page in an iframe. Report the content
  // height so the host can grow the iframe and leave only one scrollbar
  // (the Settings modal's), instead of nesting two vertical scrollbars.
  function postHeight() {
    if (window.parent === window) return;
    const height = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0,
    );
    if (!Number.isFinite(height) || height <= 0) return;
    window.parent.postMessage(
      { type: 'dsh-bark-push:height', height },
      window.location.origin,
    );
  }

  if (window.parent !== window) {
    window.addEventListener('load', postHeight);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(postHeight).observe(document.body);
    }
    setTimeout(postHeight, 50);
    setTimeout(postHeight, 400);
  }

  function collect() {
    return {
      channels: collectChannels(),
      server: $('server').value,
      group: $('group').value,
      icon: $('icon').value,
      soundReply: $('soundReply').value,
      soundApproval: $('soundApproval').value,
      soundQuestion: $('soundQuestion').value,
      levelReply: $('levelReply').value,
      levelApproval: $('levelApproval').value,
      levelQuestion: $('levelQuestion').value,
      titlePrefix: $('titlePrefix').value,
      titleMode: $('titleMode').value,
      maxTitleLength: Number($('maxTitleLength').value),
      maxBodyLength: Number($('maxBodyLength').value),
      timeoutMs: Number($('timeoutMs').value),
      maxRetries: Number($('maxRetries').value),
      retryDelayMs: Number($('retryDelayMs').value),
      publicBaseUrl: $('publicBaseUrl').value,
      enabled: $('enabled').checked,
      notifyOnReply: $('notifyOnReply').checked,
      notifyOnApproval: $('notifyOnApproval').checked,
      notifyOnQuestion: $('notifyOnQuestion').checked,
      includeSubagents: $('includeSubagents').checked,
      linkToSession: $('linkToSession').checked,
      trace: $('trace').checked
    };
  }

  async function load() {
    try {
      const data = await request(api.state);
      current = data;
      if (Array.isArray(data.channelTypes)) channelTypes = data.channelTypes;
      fill(data.config);
      status(data);
      renderMutes(data);
    } catch (error) {
      toast('读取失败：' + error.message, true);
    }
  }

  $('addChannel').addEventListener('click', () => {
    syncChannels();
    const type = $('channelTypeSelect').value;
    const info = typeInfo(type);
    if (!info) { toast('请选择渠道类型', true); return; }
    const config = {};
    for (const field of info.fields) {
      if (field.default !== undefined) config[field.key] = field.default;
    }
    channelDraft.push({ id: genChannelId(), type, label: '', enabled: true, config, secretsSet: {} });
    renderChannels();
    markChannelsDirty();
    toast('已添加 ' + info.name + '，填写后点“保存配置”');
  });

  // One save path shared by the Bark card and the extra-channels card, so the
  // two buttons cannot drift apart. It always persists the whole config.
  async function persistConfig(button) {
    const statusId = button && button.id === 'saveChannels' ? 'channelsSaveStatus' : 'barkSaveStatus';
    if (button) button.disabled = true;
    setSaveStatus(statusId, '保存中…', '');
    try {
      const data = await request(api.config, collect());
      current = data;
      if (Array.isArray(data.channelTypes) && data.channelTypes.length > 0) channelTypes = data.channelTypes;
      fill(data.config);
      status(data);
      renderMutes(data);
      setSaveStatus(statusId, '已保存 ' + nowStamp(), 'ok');
      toast('配置已保存');
      return true;
    } catch (error) {
      setSaveStatus(statusId, '保存失败：' + (error.message || '未知错误'), 'bad');
      toast('保存失败：' + error.message, true);
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  $('save').addEventListener('click', () => { void persistConfig($('save')); });
  $('saveChannels').addEventListener('click', () => { void persistConfig($('saveChannels')); });

  $('addKeys').addEventListener('click', async () => {
    const raw = $('newKeys').value.trim();
    if (!raw) { toast('请先粘贴至少一个 Device Key', true); return; }
    const keys = raw.split(/\\r?\\n|,/).map((part) => part.trim()).filter(Boolean);
    $('addKeys').disabled = true;
    try {
      const data = await request(api.config, { addDeviceKeys: keys });
      current = data;
      $('newKeys').value = '';
      fill(data.config);
      status(data);
      renderMutes(data);
      toast('已追加 ' + keys.length + ' 个密钥');
    } catch (error) {
      toast('保存失败：' + error.message, true);
    } finally {
      $('addKeys').disabled = false;
    }
  });

  $('clearKeys').addEventListener('click', async () => {
    if (!window.confirm('确定清空全部 Device Key？')) return;
    try {
      const data = await request(api.config, { clearDeviceKeys: true });
      current = data;
      fill(data.config);
      status(data);
      renderMutes(data);
      toast('已清空 Device Key');
    } catch (error) {
      toast('保存失败：' + error.message, true);
    }
  });

  $('reset').addEventListener('click', async () => {
    if (!window.confirm('恢复默认配置？静音状态和 Device Key 不会被清除；需要清空密钥请用“清空密钥”。')) return;
    try {
      const data = await request(api.config, { reset: true });
      current = data;
      fill(data.config);
      status(data);
      renderMutes(data);
      toast('已恢复默认配置');
    } catch (error) {
      toast('恢复失败：' + error.message, true);
    }
  });

  $('test').addEventListener('click', async () => {
    $('test').disabled = true;
    try {
      const data = await requestAllowFail(api.test, {});
      if (data.state) {
        current = data.state;
        fill(data.state.config);
        status(data.state);
        renderMutes(data.state);
      }
      const result = data.result || {};
      renderBarkTestResult(result);
      const results = Array.isArray(result.results) ? result.results : [];
      if (result.skipped) {
        toast('未发送：' + (result.reason || '尚未配置任何设备或渠道'), true);
      } else if (results.length > 0) {
        const okCount = results.filter((entry) => entry.ok === true).length;
        if (okCount === results.length) toast('测试推送成功（' + okCount + ' 个目标全部成功）');
        else toast('测试完成：' + okCount + ' 成功 / ' + (results.length - okCount) + ' 失败（详见上方结果）', true);
      } else {
        toast(result.ok ? '测试推送成功' : '测试推送失败', result.ok !== true);
      }
    } catch (error) {
      toast('测试失败：' + error.message, true);
    } finally {
      $('test').disabled = false;
    }
  });

  $('sessionSearch').addEventListener('input', () => { if (current) renderMutes(current); });
  load();
})();
</script>
</body>
</html>`;
}
