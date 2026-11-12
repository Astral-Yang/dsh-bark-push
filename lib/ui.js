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
  .status { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--muted); font-size: 13px; }
  .pill { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; }
  .pill.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, var(--line)); }
  .pill.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, var(--line)); }
  .pill.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); }
  .keylist { display: flex; flex-direction: column; gap: 4px; margin: 0 0 10px; color: var(--muted); }
  .keylist code { color: var(--fg); }
  .lists { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 720px) { .lists { grid-template-columns: 1fr; } .row { grid-template-columns: 1fr; } }
  .list { max-height: 320px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; padding: 6px; }
  .item { display: flex; gap: 8px; align-items: flex-start; padding: 5px 6px; border-radius: 6px; }
  .item:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .item .meta { min-width: 0; }
  .item .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .sub { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body class="${embedded ? 'embedded' : ''}">
<main>
  <h1><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-4px;margin-right:8px"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>Bark 推送</h1>
  <p class="lead">把 DSH 的回复、审批和选择请求推送到 iPhone。配置保存在本机，Device Key 不会显示在页面或日志中。</p>

  <div class="card">
    <div class="status" id="status"><span class="pill">读取中…</span></div>
    <p class="hint" id="warnings" hidden></p>
  </div>

  <div class="card">
    <h2>连接与通知</h2>
    <div class="row"><label for="server">Bark Server</label><input id="server" type="text" placeholder="https://api.day.app"></div>
    <div class="row"><label>已配置 Device Key</label><div><div class="keylist" id="keylist"></div><p class="hint">页面只显示掩码。新增密钥时逐行粘贴，保存后不会再显示完整值。</p></div></div>
    <div class="row"><label for="newKeys">新增 Device Key</label><textarea id="newKeys" placeholder="每行一个"></textarea></div>
    <div class="row"><label for="group">通知分组 Group</label><input id="group" type="text" placeholder="DSH"></div>
    <div class="row"><label for="icon">图标 Icon（可选）</label><input id="icon" type="text" placeholder="https://…"></div>
    <div class="row"><label for="soundNormal">普通铃声 Sound（可选）</label><input id="soundNormal" type="text" placeholder="bell"></div>
    <div class="row"><label for="soundImportant">重要铃声 Sound（可选）</label><input id="soundImportant" type="text" placeholder="alarm"></div>
    <div class="row"><label for="levelNormal">普通级别</label><select id="levelNormal"><option>active</option><option>timeSensitive</option><option>passive</option><option>critical</option></select></div>
    <div class="row"><label for="levelImportant">重要级别</label><select id="levelImportant"><option>active</option><option>timeSensitive</option><option>passive</option><option>critical</option></select></div>
    <div class="row"><label>通知类型</label><div class="checks">
      <label><input id="enabled" type="checkbox"> 总开关</label>
      <label><input id="notifyOnReply" type="checkbox"> Agent 回复</label>
      <label><input id="notifyOnApproval" type="checkbox"> 需要批准</label>
      <label><input id="notifyOnQuestion" type="checkbox"> 等待选择</label>
      <label><input id="includeSubagents" type="checkbox"> 包含子代理</label>
    </div></div>
    <div class="row"><label for="titleMode">回复标题来源</label><select id="titleMode">
      <option value="session">会话标题</option>
      <option value="session-summary">会话标题 + 回复摘要</option>
      <option value="summary">回复摘要</option>
    </select></div>
    <div class="row"><label for="titlePrefix">标题前缀（可选）</label><input id="titlePrefix" type="text" placeholder="留空则只用所选标题"></div>
    <div class="row"><label for="maxTitleLength">标题最大长度</label><input id="maxTitleLength" type="number" min="8" max="200"></div>
    <div class="row"><label for="maxBodyLength">正文最大长度</label><input id="maxBodyLength" type="number" min="32" max="4000"></div>
    <div class="row"><label for="timeoutMs">请求超时（毫秒）</label><input id="timeoutMs" type="number" min="1000" max="30000"></div>
    <div class="row"><label for="maxRetries">最大重试次数</label><input id="maxRetries" type="number" min="0" max="5"></div>
    <div class="row"><label for="retryDelayMs">重试基础间隔（毫秒）</label><input id="retryDelayMs" type="number" min="50" max="10000"></div>
    <div class="row"><label>点击通知跳转</label><div class="checks">
      <label><input id="linkToSession" type="checkbox"> 打开对应会话</label>
      <label><input id="trace" type="checkbox"> 调试日志</label>
    </div></div>
    <div class="row"><label for="publicBaseUrl">公共访问地址（可选）</label><input id="publicBaseUrl" type="text" placeholder="https://dsh.example.com/"></div>
    <p class="hint">公共访问地址留空时使用 DSH 的 advertised URL；点击跳转依赖浏览器已登录（有 DSH 会话 Cookie）。</p>
    <div class="actions">
      <button class="primary" id="save">保存配置</button>
      <button id="test">测试推送</button>
      <button id="reset" class="danger">恢复默认</button>
      <button id="addKeys">追加密钥</button>
      <button id="clearKeys" class="danger">清空密钥</button>
    </div>
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
    test: '/api/bark-push/test'
  };
  const $ = (id) => document.getElementById(id);
  let current = null;
  let toastTimer = null;

  function toast(message, bad) {
    const node = $('toast');
    node.textContent = message;
    node.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.className = ''; }, 3200);
  }

  async function request(path, body) {
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
    if (!response.ok || !payload || payload.ok === false) {
      throw new Error((payload && payload.error) || ('HTTP ' + response.status));
    }
    return payload;
  }

  function text(node, value) { node.textContent = value == null ? '' : String(value); }

  function fill(config) {
    $('server').value = config.server || '';
    $('group').value = config.group || '';
    $('icon').value = config.icon || '';
    $('soundNormal').value = config.soundNormal || '';
    $('soundImportant').value = config.soundImportant || '';
    $('levelNormal').value = config.levelNormal || 'active';
    $('levelImportant').value = config.levelImportant || 'timeSensitive';
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
  }

  function status(data) {
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
      const sub = [session.id, session.workspaceId ? ('工作区 ' + session.workspaceId) : '', session.offline ? '离线' : '']
        .filter(Boolean).join(' · ');
      sessionBox.append(muteRow('session', session.id, session.title || '未命名会话', sub, mutedSessions.has(session.id)));
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
    const subNode = document.createElement('div');
    subNode.className = 'sub';
    text(subNode, sub);
    meta.append(titleNode, subNode);
    item.append(box, meta);
    return item;
  }

  function collect() {
    return {
      server: $('server').value,
      group: $('group').value,
      icon: $('icon').value,
      soundNormal: $('soundNormal').value,
      soundImportant: $('soundImportant').value,
      levelNormal: $('levelNormal').value,
      levelImportant: $('levelImportant').value,
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
      fill(data.config);
      status(data);
      renderMutes(data);
    } catch (error) {
      toast('读取失败：' + error.message, true);
    }
  }

  $('save').addEventListener('click', async () => {
    $('save').disabled = true;
    try {
      const data = await request(api.config, collect());
      current = data;
      fill(data.config);
      status(data);
      renderMutes(data);
      toast('配置已保存');
    } catch (error) {
      toast('保存失败：' + error.message, true);
    } finally {
      $('save').disabled = false;
    }
  });

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
      const data = await request(api.test, {});
      if (data.state) {
        current = data.state;
        fill(data.state.config);
        status(data.state);
        renderMutes(data.state);
      }
      const result = data.result || {};
      if (result.ok) toast('测试推送成功');
      else if (result.skipped) toast('未发送：' + (result.reason || '未配置设备'), true);
      else toast('测试推送失败：' + ((result.results && result.results[0] && result.results[0].message) || '未知错误'), true);
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
