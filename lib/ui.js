/**
 * Self-contained management page for notification configuration and mute state.
 *
 * The page is served by the authenticated host route, so it uses only
 * same-origin fetch and no external assets. All dynamic values are written
 * through `textContent` or form values; server data never becomes HTML.
 *
 * Design intent: this is a notification-routing console embedded inside DSH
 * Settings. Hierarchy is status-first: a compact health strip, then sections
 * separated by hairline rules (not nested rounded cards), and each extra
 * channel is a single "lane" whose enabled state reads at a glance while its
 * parameters stay collapsed until needed.
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
<title>通知 · DSH</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --fg: #16181d;
    --muted: #6b7280;
    --line: #e5e7eb;
    --line-strong: #d5d9e0;
    --subtle: #f6f7f9;
    --accent: #3b6ef6;
    --on-accent: #ffffff;
    --ok: #16894f;
    --warn: #a66a00;
    --bad: #c0392b;
    --radius: 10px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16171b;
      --fg: #eceef3;
      --muted: #9aa1ad;
      --line: #2b2e36;
      --line-strong: #3a3e48;
      --subtle: #22252c;
      --accent: #7aa2ff;
      --on-accent: #0e1116;
      --ok: #5dd39e;
      --warn: #e3b341;
      --bad: #ff7b72;
    }
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { margin: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-feature-settings: "tnum" 1;
  }
  main { max-width: 860px; margin: 0 auto; padding: 30px 24px 72px; }
  body.embedded main { padding: 14px 16px 48px; }

  /* Page head: title, lead, health strip */
  .page-head h1 { font-size: 20px; font-weight: 650; letter-spacing: -0.01em; margin: 0 0 6px; display: flex; align-items: center; gap: 8px; }
  .page-head h1 svg { flex: none; }
  .lead { color: var(--muted); font-size: 13px; margin: 0 0 14px; max-width: 62ch; }
  /* Top-level notification tabs */
  .tabs { display: flex; gap: 4px; align-items: flex-end; border-bottom: 1px solid var(--line); margin: 16px 0 0; }
  .tab { appearance: none; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--muted); padding: 9px 13px 8px; min-height: 36px; font-weight: 550; }
  .tab:hover { color: var(--fg); border-bottom-color: var(--line-strong); }
  .tab[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent); }
  .tab[data-dirty="true"]::after { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); margin-left: 6px; vertical-align: middle; }
  .tab-panel { padding-top: 4px; }
  .healthstrip { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 6px; }
  .pill { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .pill.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 42%, var(--line)); }
  .pill.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 42%, var(--line)); }
  .pill.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 42%, var(--line)); }
  .hint { color: var(--muted); font-size: 12px; margin: 6px 0 0; }

  /* Save ledger: the one place that answers "did my change stick?" */
  .savebar {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    border: 1px solid var(--line); border-left: 3px solid var(--line-strong);
    border-radius: 8px; background: var(--subtle); padding: 10px 12px; margin: 0 0 10px;
  }
  .savebar[data-state="dirty"] { border-left-color: var(--warn); }
  .savebar[data-state="saved"] { border-left-color: var(--ok); }
  .savebar-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .savebar-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--muted); }
  .savebar[data-state="dirty"] .savebar-dot { background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 16%, transparent); }
  .savebar[data-state="saved"] .savebar-dot { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 14%, transparent); }
  .savebar-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .savebar-copy strong { font-size: 13px; font-weight: 600; }
  .savebar-copy small { color: var(--muted); font-size: 12px; }
  .savebar[data-state="dirty"] .savebar-copy strong { color: var(--warn); }
  .savebar-actions { display: flex; flex-wrap: wrap; gap: 8px; flex: none; }
  .section-state { margin-left: auto; color: var(--muted); font-size: 12px; white-space: nowrap; }
  .section-state[data-state="dirty"] { color: var(--warn); font-weight: 600; }
  .section-state[data-state="saved"] { color: var(--ok); }
  .section-state[data-state="saving"] { color: var(--muted); }
  @media (max-width: 720px) {
    .savebar { align-items: flex-start; flex-direction: column; }
    .savebar-actions { width: 100%; }
    .savebar-actions button { flex: 1 1 auto; }
  }

  /* Sections: continuous surface, hairline separated, no nested cards */
  .section { padding: 20px 0; border-top: 1px solid var(--line); }
  .section:first-of-type { border-top: 0; padding-top: 14px; }
  .section-head { display: flex; align-items: baseline; gap: 10px; margin: 0 0 4px; }
  .section-head h2 { font-size: 15px; font-weight: 650; margin: 0; letter-spacing: -0.005em; }
  .section-head .count { font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; font-variant-numeric: tabular-nums; }
  .section-sub { color: var(--muted); font-size: 12.5px; margin: 0 0 14px; max-width: 66ch; }

  /* Field rows */
  .row { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 8px 16px; align-items: center; margin: 0 0 12px; }
  .row > label:first-child { color: var(--muted); font-size: 13px; }
  .row.wide { grid-template-columns: 1fr; }
  input[type=text], input[type=number], input[type=password], select, textarea {
    width: 100%; padding: 7px 10px; border: 1px solid var(--line-strong); border-radius: 8px;
    background: var(--bg); color: var(--fg); font: inherit; min-height: 34px;
  }
  textarea { min-height: 68px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
  .checks { display: flex; flex-wrap: wrap; gap: 10px 18px; }
  .checks label { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }

  /* Rule grid (notification toggles) */
  .rule-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
  .rule { display: flex; gap: 9px; align-items: flex-start; border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px; background: var(--subtle); }
  .rule input { margin-top: 2px; }
  .rule .rt { display: flex; flex-direction: column; gap: 1px; }
  .rule .rt b { font-weight: 550; font-size: 13px; }
  .rule .rt small { color: var(--muted); font-size: 12px; }

  /* Buttons */
  button {
    appearance: none; border: 1px solid var(--line-strong); background: var(--bg); color: var(--fg);
    border-radius: 8px; padding: 7px 12px; font: inherit; font-size: 13px; cursor: pointer; min-height: 32px;
  }
  button:hover { border-color: var(--muted); }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 550; }
  button.primary:hover { filter: brightness(1.04); }
  button.primary:disabled { background: var(--line); border-color: var(--line); color: var(--muted); opacity: 1; }
  button.danger { color: var(--bad); }
  button.danger:hover { border-color: var(--bad); }
  button:disabled { opacity: .5; cursor: default; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; }
  .save-status { font-size: 12px; margin-left: 4px; }
  .save-status.ok { color: var(--ok); }
  .save-status.bad { color: var(--bad); }
  .save-status.warn { color: var(--warn); }

  /* Key list */
  .keylist { display: flex; flex-direction: column; gap: 3px; margin: 0 0 6px; color: var(--muted); }
  .keylist code { color: var(--fg); font-variant-numeric: tabular-nums; }

  /* Advanced disclosure */
  details.advanced { margin: 14px 0 2px; border: 1px solid var(--line); border-radius: var(--radius); padding: 2px 14px 10px; background: var(--subtle); }
  details.advanced > summary { cursor: pointer; color: var(--accent); font-weight: 600; font-size: 13px; padding: 9px 0; list-style: none; user-select: none; }
  details.advanced > summary::-webkit-details-marker { display: none; }
  details.advanced > summary::before { content: '▸ '; }
  details.advanced[open] > summary::before { content: '▾ '; }
  .advanced-group { margin: 8px 0 2px; }
  .advanced-group h3 { font-size: 12px; font-weight: 600; color: var(--muted); margin: 10px 0 8px; }

  /* Channel lanes */
  .lane { border: 1px solid var(--line); border-radius: var(--radius); background: var(--subtle); margin: 0 0 10px; }
  .lane-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; flex-wrap: wrap; }
  .lane .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 18%, transparent); }
  .lane[data-enabled="0"] .dot { background: transparent; border: 1.5px solid var(--muted); box-shadow: none; }
  .lane[data-enabled="0"] .lane-name { color: var(--muted); }
  .lane-name { font-size: 14px; font-weight: 600; }
  .tag { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 0 6px; }
  .lane-grow { flex: 1; }
  .switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
  .lane-toggle { padding: 5px 10px; min-height: 28px; }
  .lane-head button { padding: 5px 10px; min-height: 28px; }
  .lane-fields { padding: 6px 12px 12px; border-top: 1px dashed var(--line); }
  .channel-field { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 8px 14px; align-items: center; margin: 0 0 9px; }
  .channel-field > label { color: var(--muted); font-size: 13px; }
  .channel-field .req { color: var(--bad); }
  .channel-add { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 14px; }
  .channel-add select { max-width: 260px; }
  .empty-channel { border: 1px dashed var(--line-strong); border-radius: var(--radius); padding: 18px; color: var(--muted); font-size: 13px; text-align: center; }

  /* Test result breakdown */
  .test-result { margin-top: 10px; border-top: 1px dashed var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 5px; }
  .test-result .tr-title { font-size: 12.5px; font-weight: 600; }
  .test-result .tr-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
  .test-result .tr-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .test-result .tr-msg { color: var(--muted); font-size: 12px; }

  /* Mute lists */
  .lists { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  @media (max-width: 720px) { .lists { grid-template-columns: 1fr; } .row { grid-template-columns: 1fr; } .channel-field { grid-template-columns: 1fr; } }
  .list-title { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); margin: 0 0 8px; }
  .list-title .count { font-size: 11px; line-height: 18px; border: 1px solid var(--line); border-radius: 999px; padding: 0 7px; font-variant-numeric: tabular-nums; }
  .list { max-height: 320px; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius); padding: 6px; }
  .item { display: flex; gap: 9px; align-items: flex-start; padding: 6px; border-radius: 8px; }
  .item:hover { background: var(--subtle); }
  .item .meta { min-width: 0; }
  .item .title { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .sub { color: var(--muted); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; word-break: break-word; }
  .empty { color: var(--muted); padding: 10px; font-size: 13px; }

  .page-foot { color: var(--muted); font-size: 12px; margin-top: 30px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

  #toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: var(--fg); color: var(--bg); padding: 8px 14px; border-radius: 999px;
    font-size: 13px; opacity: 0; pointer-events: none; transition: opacity .18s ease;
    max-width: 80vw; text-align: center; z-index: 10;
  }
  #toast.show { opacity: 1; }
  #toast.bad { background: var(--bad); color: #fff; }
</style>
</head>
<body class="${embedded ? 'embedded' : ''}">
<main>
  <header class="page-head">
    <h1><svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>通知</h1>
    <p class="lead">统一管理推送通知与浏览器通知。推送通知负责离开页面后的送达；浏览器通知只在 DSH 页面打开时工作，两套渠道可以独立启用。</p>
    <div class="savebar" id="savebar" data-state="loading" role="status" aria-live="polite">
      <div class="savebar-main">
        <span class="savebar-dot" aria-hidden="true"></span>
        <div class="savebar-copy">
          <strong id="saveStateLabel">正在读取配置…</strong>
          <small id="saveStateHint">读取完成后会显示保存状态</small>
        </div>
      </div>
      <div class="savebar-actions">
        <button class="primary" id="saveAll" type="button" disabled>保存全部更改</button>
        <button id="discardAll" type="button" disabled>放弃更改</button>
      </div>
    </div>
    <div class="healthstrip" id="status"><span class="pill">读取中…</span></div>
    <p class="hint" id="warnings" hidden></p>
  </header>

  <nav class="tabs" role="tablist" aria-label="通知设置">
    <button class="tab" id="tab-push" data-tab="push" role="tab" aria-selected="true" aria-controls="panel-push">推送通知</button>
    <button class="tab" id="tab-browser" data-tab="browser" role="tab" aria-selected="false" aria-controls="panel-browser">浏览器通知</button>
  </nav>

  <div class="tab-panel" id="panel-push" role="tabpanel" aria-labelledby="tab-push">

  <section class="section" id="section-default">
    <div class="section-head"><h2>默认渠道 · Bark</h2><span class="section-state" data-section-state="default">已保存</span></div>
    <p class="section-sub">Bark 是内置的第一渠道。填入服务器与 Device Key 即可使用；其余按需展开「高级选项」。</p>
    <div class="row"><label for="server">Bark Server</label><input id="server" type="text" placeholder="https://api.day.app"></div>
    <div class="row"><label>已配置 Device Key</label><div><div class="keylist" id="keylist"></div><p class="hint">页面只显示掩码；新增密钥逐行粘贴，保存后不再显示完整值。</p></div></div>
    <div class="row"><label for="newKeys">新增 Device Key</label><textarea id="newKeys" placeholder="每行一个"></textarea></div>

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
        <p class="hint"><strong>级别说明</strong>　主动通知会亮屏提醒；时效性通知可在专注模式显示；静默通知只进通知中心；紧急通知可突破静音并在 Bark App 授权「重要警告」后生效（iOS 15+，未授权则降级为普通通知，铃声音量由 volume 控制）。</p>
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
      <button class="primary" id="save">保存全部更改</button>
      <button id="test">测试默认渠道</button>
      <button id="reset" class="danger">恢复默认</button>
      <button id="addKeys">追加密钥</button>
      <button id="clearKeys" class="danger">清空密钥</button>
      <span id="barkSaveStatus" class="save-status" role="status" aria-live="polite"></span>
    </div>
    <div class="test-result" id="barkTestResult" hidden></div>
  </section>

  <section class="section" id="section-rules">
    <div class="section-head"><h2>通知规则</h2><span class="section-state" data-section-state="rules">已保存</span></div>
    <p class="section-sub">选择哪些事件需要推送。总开关关闭后不发送任何通知。</p>
    <div class="rule-grid">
      <label class="rule"><input id="enabled" type="checkbox"><span class="rt"><b>总开关</b><small>关闭后暂停全部推送</small></span></label>
      <label class="rule"><input id="notifyOnReply" type="checkbox"><span class="rt"><b>Agent 回复</b><small>一轮结束后推送最后回复</small></span></label>
      <label class="rule"><input id="notifyOnApproval" type="checkbox"><span class="rt"><b>需要批准</b><small>工具请求授权时推送</small></span></label>
      <label class="rule"><input id="notifyOnQuestion" type="checkbox"><span class="rt"><b>等待选择</b><small>等待你回答选择时推送</small></span></label>
      <label class="rule"><input id="includeSubagents" type="checkbox"><span class="rt"><b>包含子代理</b><small>子代理会话也推送</small></span></label>
    </div>
    <div class="actions">
      <button id="saveRules">保存全部更改</button>
      <span id="rulesSaveStatus" class="save-status" role="status" aria-live="polite"></span>
    </div>
  </section>

  <section class="section" id="section-channels">
    <div class="section-head"><h2>渠道</h2><span class="count" id="channelCount">0</span><span class="section-state" data-section-state="channels">已保存</span></div>
    <p class="section-sub">Bark 之外可同时启用多个渠道，互不影响；点「参数」展开填写，点「测试」会先保存当前配置，再单独验证该渠道。</p>
    <div id="channelList"></div>
    <div class="channel-add">
      <select id="channelTypeSelect" aria-label="渠道类型"></select>
      <button id="addChannel">添加渠道</button>
      <button id="saveChannels">保存全部更改</button>
      <span id="channelsSaveStatus" class="save-status" role="status" aria-live="polite"></span>
    </div>
  </section>

  <section class="section" id="section-mute">
    <div class="section-head"><h2>静音管理</h2><span class="section-state">即时生效</span></div>
    <p class="section-sub">工作区静音优先于会话静音；任一层级静音即停止推送，状态持久化。会话列表与 DSH 左侧会话栏采用同一套可见性规则。</p>
    <div class="lists">
      <div>
        <p class="list-title">工作区</p>
        <div class="list" id="workspaces"><div class="empty">读取中…</div></div>
      </div>
      <div>
        <p class="list-title">会话 <span class="count" id="sessionCount">0</span></p>
        <input id="sessionSearch" type="text" placeholder="按标题或 ID 过滤" style="margin-bottom:8px">
        <div class="list" id="sessions"><div class="empty">读取中…</div></div>
      </div>
    </div>
  </section>
  </div>

  <div class="tab-panel" id="panel-browser" role="tabpanel" aria-labelledby="tab-browser" hidden>
    <section class="section" id="section-browser">
      <div class="section-head"><h2>浏览器通知</h2><span class="section-state" data-section-state="browser">已保存</span></div>
      <p class="section-sub">通过浏览器系统通知提醒回复、审批和选择请求；不依赖 Bark 或任何推送渠道。浏览器通知只在 DSH 页面打开时生效。</p>
      <div class="healthstrip" id="browserPermissionStatus"><span class="pill">检查中…</span></div>
      <div class="actions">
        <button id="requestNotifyPermission">请求通知权限</button>
        <button id="testBrowserNotify">发送测试通知</button>
      </div>
      <div class="rule-grid" style="margin-top:14px">
        <label class="rule"><input id="browserNotifyEnabled" type="checkbox"><span class="rt"><b>启用浏览器通知</b><small>与推送通知总开关独立</small></span></label>
        <label class="rule"><input id="browserNotifyOnReply" type="checkbox"><span class="rt"><b>回复完成</b><small>一轮结束时提醒</small></span></label>
        <label class="rule"><input id="browserNotifyOnApproval" type="checkbox"><span class="rt"><b>需要批准</b><small>工具请求授权时提醒</small></span></label>
        <label class="rule"><input id="browserNotifyOnQuestion" type="checkbox"><span class="rt"><b>等待选择</b><small>等待你回答时提醒</small></span></label>
        <label class="rule"><input id="browserNotifySkipForeground" type="checkbox"><span class="rt"><b>前台免打扰</b><small>当前会话且页面在前台时不提醒</small></span></label>
      </div>
      <div class="row" style="margin-top:14px"><label>静音策略</label><div class="checks"><label><input id="browserNotifyUsePushMutes" type="checkbox"> 复用推送通知的工作区/会话静音</label></div></div>
      <p class="hint">关闭复用后，可在下方使用浏览器通知自己的静音管理；不会影响 Bark 推送的静音状态。</p>
    </section>

    <section class="section" id="section-browser-templates">
      <div class="section-head"><h2>正文模板</h2><span class="section-state" data-section-state="browser">已保存</span></div>
      <p class="section-sub">通知标题固定为会话标题，正文由模板生成。支持占位符：<code>{status}</code>、<code>{session}</code>、<code>{summary}</code>、<code>{turn}</code>、<code>{tool}</code>、<code>{reason}</code>、<code>{question}</code>、<code>{questionCount}</code>、<code>{description}</code>。</p>
      <div class="row wide"><label for="browserNotifyReplyBody">回复完成</label><textarea id="browserNotifyReplyBody" rows="2"></textarea><p class="hint" id="browserReplyPreview"></p></div>
      <div class="row wide"><label for="browserNotifyApprovalBody">需要批准</label><textarea id="browserNotifyApprovalBody" rows="2"></textarea><p class="hint" id="browserApprovalPreview"></p></div>
      <div class="row wide"><label for="browserNotifyQuestionBody">等待选择</label><textarea id="browserNotifyQuestionBody" rows="2"></textarea><p class="hint" id="browserQuestionPreview"></p></div>
      <div class="row"><label for="browserNotifyMaxBodyLength">正文最大长度</label><input id="browserNotifyMaxBodyLength" type="number" min="32" max="500"></div>
      <div class="actions">
        <button class="primary" id="saveBrowser">保存全部更改</button>
        <span id="browserSaveStatus" class="save-status" role="status" aria-live="polite"></span>
      </div>
    </section>

    <section class="section" id="section-browser-mute">
      <div class="section-head"><h2>浏览器通知静音管理</h2><span class="section-state">即时生效</span></div>
      <p class="section-sub" id="browserMuteHint">当前复用推送通知的静音设置。关闭上方「复用推送通知的工作区/会话静音」后，可在这里管理独立的浏览器通知静音。</p>
      <div class="lists" id="browserMuteLists">
        <div>
          <p class="list-title">工作区</p>
          <div class="list" id="browserWorkspaces"><div class="empty">读取中…</div></div>
        </div>
        <div>
          <p class="list-title">会话 <span class="count" id="browserSessionCount">0</span></p>
          <input id="browserSessionSearch" type="text" placeholder="按标题或 ID 过滤" style="margin-bottom:8px">
          <div class="list" id="browserSessions"><div class="empty">读取中…</div></div>
        </div>
      </div>
    </section>
  </div>

  <footer class="page-foot">dsh-bark-push v${safeVersion} · 所有通知配置仅保存在本机。</footer>
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
  let savedForm = null;
  let lastSavedAt = '';
  let saveBusy = false;
  let saveError = '';

  const BROWSER_SAMPLES = {
    reply: { status: '回复完成', session: '示例会话', summary: '已完成会话列表修复', turn: '3', description: '已完成会话列表修复' },
    approval: { status: '需要批准', session: '示例会话', tool: 'Bash', reason: '写入工作区文件', description: 'Bash · 写入工作区文件' },
    question: { status: '等待选择', session: '示例会话', question: '请选择部署环境', questionCount: '2', description: '请选择部署环境' }
  };

  function setTab(name, updateHash) {
    const target = name === 'browser' ? 'browser' : 'push';
    const push = $('panel-push');
    const browser = $('panel-browser');
    const pushTab = $('tab-push');
    const browserTab = $('tab-browser');
    if (!push || !browser || !pushTab || !browserTab) return;
    push.hidden = target !== 'push';
    browser.hidden = target !== 'browser';
    pushTab.setAttribute('aria-selected', target === 'push' ? 'true' : 'false');
    browserTab.setAttribute('aria-selected', target === 'browser' ? 'true' : 'false');
    if (updateHash) {
      try {
        const url = new URL(window.location.href);
        if (target === 'browser') url.searchParams.set('view', 'browser');
        else url.searchParams.delete('view');
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      } catch (_) { /* hash updates are optional */ }
    }
    postHeight();
  }

  function notificationState() {
    if (typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') {
      return { key: 'unsupported', label: '当前浏览器不支持通知', cls: 'bad' };
    }
    const permission = Notification.permission;
    if (permission === 'granted') return { key: 'granted', label: '浏览器通知权限：已授权', cls: 'ok' };
    if (permission === 'denied') return { key: 'denied', label: '浏览器通知权限：已拒绝', cls: 'bad' };
    return { key: 'default', label: '浏览器通知权限：未授权', cls: 'warn' };
  }

  function renderBrowserPermission() {
    const box = $('browserPermissionStatus');
    if (!box) return;
    const state = notificationState();
    box.replaceChildren();
    const pill = document.createElement('span');
    pill.className = 'pill ' + state.cls;
    text(pill, state.label);
    box.append(pill);
    const button = $('requestNotifyPermission');
    if (button) {
      button.disabled = state.key === 'unsupported' || state.key === 'granted';
      button.textContent = state.key === 'granted' ? '已授权' : '请求通知权限';
    }
    if (state.key === 'denied') {
      const hint = document.createElement('span');
      hint.className = 'hint';
      text(hint, '请在浏览器站点设置中允许通知后重新打开页面。');
      box.append(hint);
    }
  }

  function renderTemplatePreview(kind) {
    const input = $('browserNotify' + kind[0].toUpperCase() + kind.slice(1) + 'Body');
    const target = $('browser' + kind[0].toUpperCase() + kind.slice(1) + 'Preview');
    if (!input || !target) return;
    const template = input.value || '';
    const values = BROWSER_SAMPLES[kind] || {};
    let preview = template.replace(/\\{([A-Za-z][A-Za-z0-9]*)\\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? '') : match);
    const unknown = [];
    template.replace(/\\{([A-Za-z][A-Za-z0-9]*)\\}/g, (match, name) => {
      if (!Object.prototype.hasOwnProperty.call(values, name)) unknown.push(match);
      return match;
    });
    text(target, '预览：' + (preview.trim() || '（空模板，将使用默认值）') + (unknown.length ? '　未知占位符：' + unknown.join('、') : ''));
  }

  function renderTemplatePreviews() {
    renderTemplatePreview('reply');
    renderTemplatePreview('approval');
    renderTemplatePreview('question');
  }

  function updateBrowserMuteVisibility() {
    const reuse = $('browserNotifyUsePushMutes');
    const lists = $('browserMuteLists');
    const hint = $('browserMuteHint');
    if (!reuse || !lists || !hint) return;
    const independent = !reuse.checked;
    lists.hidden = !independent;
    text(hint, independent
      ? '当前使用独立的浏览器通知静音集合，不影响 Bark 推送。'
      : '当前复用推送通知的静音设置。关闭上方「复用推送通知的工作区/会话静音」后，可在这里管理独立的浏览器通知静音。');
  }

  async function requestBrowserPermission() {
    const state = notificationState();
    if (state.key === 'unsupported') {
      toast('当前浏览器不支持通知', true);
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      renderBrowserPermission();
      toast(permission === 'granted' ? '浏览器通知权限已授予' : '浏览器通知权限未授予', permission !== 'granted');
    } catch (error) {
      if (window.parent && window.parent !== window) {
        try {
          window.parent.postMessage({ type: 'dsh-bark-push:browser-permission-request' }, window.location.origin);
          toast('已向浏览器请求通知权限');
          return;
        } catch (_) { /* fall through to error */ }
      }
      toast('请求通知权限失败：' + error.message, true);
    }
  }

  function testBrowserNotification() {
    const state = notificationState();
    if (state.key !== 'granted') {
      toast('请先授予浏览器通知权限', true);
      return;
    }
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ type: 'dsh-bark-push:browser-test' }, window.location.origin);
        toast('测试通知已发送');
        return;
      } catch (_) { /* fall through to a local Notification */ }
    }
    try {
      new Notification('DSH 浏览器通知测试', { body: '浏览器通知已开启。' });
      toast('测试通知已发送');
    } catch (error) {
      toast('发送测试通知失败：' + error.message, true);
    }
  }

  renderBrowserPermission();
  renderTemplatePreviews();

  function toast(message, bad) {
    const text = message == null ? '' : String(message);
    // Embedded in the DSH Settings iframe the page has no scroll viewport of
    // its own, so hand the notice to the parent which renders it in the
    // frame-wide shell.overlay layer; also show a local toast when standalone.
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage(
          { type: 'dsh-bark-push:toast', message: text, kind: bad ? 'bad' : 'ok' },
          window.location.origin,
        );
        return;
      } catch (_) { /* fall back to local toast */ }
    }
    const node = $('toast');
    if (!node) return;
    node.textContent = text;
    node.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.className = ''; }, 3200);
  }

  function text(node, value) { node.textContent = value == null ? '' : String(value); }

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

  const SECTION_KEYS = {
    default: [
      'server', 'group', 'icon', 'soundReply', 'soundApproval', 'soundQuestion',
      'levelReply', 'levelApproval', 'levelQuestion', 'titlePrefix', 'titleMode',
      'maxTitleLength', 'maxBodyLength', 'timeoutMs', 'maxRetries', 'retryDelayMs',
      'publicBaseUrl', 'linkToSession', 'trace', '__pendingDeviceKeys',
    ],
    rules: ['enabled', 'notifyOnReply', 'notifyOnApproval', 'notifyOnQuestion', 'includeSubagents'],
    channels: ['channels'],
    browser: [
      'browserNotifyEnabled', 'browserNotifyOnReply', 'browserNotifyOnApproval',
      'browserNotifyOnQuestion', 'browserNotifySkipForeground', 'browserNotifyUsePushMutes',
      'browserNotifyReplyBody', 'browserNotifyApprovalBody', 'browserNotifyQuestionBody',
      'browserNotifyMaxBodyLength',
    ],
  };

  function pendingKeyText() {
    const input = $('newKeys');
    return input ? input.value.trim() : '';
  }

  function readForm() {
    try {
      const form = collect();
      form.__pendingDeviceKeys = pendingKeyText();
      return form;
    } catch (_) { return null; }
  }

  function formSignature(form) {
    return JSON.stringify(form ?? null);
  }

  function isFormDirty() {
    return savedForm !== null && formSignature(readForm()) !== formSignature(savedForm);
  }

  function hasConfigChanges() {
    if (savedForm === null) return false;
    const current = readForm();
    if (!current) return false;
    const currentConfig = { ...current };
    const savedConfig = { ...savedForm };
    delete currentConfig.__pendingDeviceKeys;
    delete savedConfig.__pendingDeviceKeys;
    return formSignature(currentConfig) !== formSignature(savedConfig);
  }

  function sectionIsDirty(name) {
    if (savedForm === null) return false;
    const form = readForm();
    const keys = SECTION_KEYS[name];
    if (!form || !keys) return false;
    return keys.some((key) => JSON.stringify(form[key]) !== JSON.stringify(savedForm[key]));
  }

  function renderSaveState() {
    const bar = $('savebar');
    if (!bar) return;
    const loading = savedForm === null;
    const dirty = !loading && formSignature(readForm()) !== formSignature(savedForm);
    const state = loading ? 'loading' : dirty ? 'dirty' : 'saved';
    bar.dataset.state = state;

    const pendingKeys = pendingKeyText().length > 0;
    const label = $('saveStateLabel');
    const hint = $('saveStateHint');
    if (label) {
      text(label, saveBusy ? '正在保存…' : saveError ? '保存失败' : loading ? '正在读取配置…' : pendingKeys ? '有未追加的 Device Key' : dirty ? '有未保存的更改' : '全部更改已保存');
    }
    if (hint) {
      text(hint, saveBusy ? '正在写入配置文件…' : saveError ? saveError : loading ? '读取完成后会显示保存状态' : pendingKeys ? '先点击「追加密钥」把密钥加入配置' : dirty ? '点击「保存全部更改」写入配置' : (lastSavedAt ? '上次保存 ' + lastSavedAt : '当前配置已载入，尚未修改'));
    }

    const saveAll = $('saveAll');
    const discard = $('discardAll');
    if (saveAll) saveAll.disabled = saveBusy || loading || !dirty || pendingKeys;
    if (discard) discard.disabled = saveBusy || loading || !dirty;
    for (const id of ['save', 'saveChannels', 'saveRules', 'saveBrowser']) {
      const button = $(id);
      if (button) button.disabled = saveBusy || loading || !dirty || pendingKeys;
    }

    const inline = saveBusy ? '保存中…' : saveError ? saveError : loading ? '' : dirty ? '有未保存的更改' : (lastSavedAt ? '已保存 ' + lastSavedAt : '已保存');
    const inlineKind = saveBusy || saveError ? 'warn' : dirty ? 'warn' : 'ok';
    for (const id of ['barkSaveStatus', 'rulesSaveStatus', 'channelsSaveStatus', 'browserSaveStatus']) {
      const node = $(id);
      if (!node) continue;
      node.textContent = inline;
      node.className = 'save-status' + (inline ? ' ' + inlineKind : '');
    }

    document.querySelectorAll('[data-section-state]').forEach((node) => {
      const name = node.getAttribute('data-section-state');
      const sectionDirty = sectionIsDirty(name);
      node.dataset.state = loading ? '' : saveBusy ? 'saving' : sectionDirty ? 'dirty' : 'saved';
      text(node, loading ? '读取中…' : saveBusy ? '保存中…' : sectionDirty ? '未保存' : '已保存');
    });

    const pushDirty = sectionIsDirty('default') || sectionIsDirty('rules') || sectionIsDirty('channels');
    const browserDirty = sectionIsDirty('browser');
    const pushTab = $('tab-push');
    const browserTab = $('tab-browser');
    if (pushTab) pushTab.dataset.dirty = pushDirty ? 'true' : 'false';
    if (browserTab) browserTab.dataset.dirty = browserDirty ? 'true' : 'false';
  }

  function captureSavedForm(stamp) {
    savedForm = readForm();
    if (stamp) lastSavedAt = stamp;
    saveError = '';
    saveBusy = false;
    renderSaveState();
  }

  function refreshDirtyState() {
    if (savedForm !== null) {
      saveError = '';
      renderSaveState();
    }
  }

  function saveFailed(message) {
    saveBusy = false;
    saveError = message || '保存失败';
    renderSaveState();
  }

  function markChannelsDirty() {
    refreshDirtyState();
  }

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
    if (payload.ok === false) throw new Error(payload.error || '请求被拒绝');
    return payload;
  }

  function typeInfo(type) { return channelTypes.find((entry) => entry.type === type); }
  function typeLabel(type) { const info = typeInfo(type); return info ? info.name : type; }

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
  // remove / structural change) does not discard edits. An empty secret stays
  // empty and the host keeps the stored value.
  function syncChannels() {
    const lanes = $('channelList') ? $('channelList').querySelectorAll('.channel') : [];
    for (const lane of lanes) {
      const index = Number(lane.dataset.index);
      const channel = channelDraft[index];
      if (!channel) continue;
      const enabledBox = lane.querySelector('[data-role="enabled"]');
      if (enabledBox) channel.enabled = enabledBox.checked;
      const config = {};
      lane.querySelectorAll('[data-field]').forEach((input) => {
        const key = input.dataset.field;
        if (input.dataset.kind === 'checkbox') config[key] = input.checked;
        else config[key] = input.value;
      });
      channel.config = config;
    }
  }

  function collectChannels() {
    syncChannels();
    return channelDraft.map((channel) => ({
      id: channel.id, type: channel.type, label: channel.label || '',
      enabled: channel.enabled !== false, config: Object.assign({}, channel.config)
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
      empty.className = 'empty-channel';
      text(empty, '还没有额外渠道。选下面的类型，点“添加渠道”即可接入。');
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
    const lane = document.createElement('div');
    lane.className = 'lane channel';
    lane.dataset.index = String(index);
    lane.dataset.id = channel.id;
    lane.dataset.enabled = channel.enabled !== false ? '1' : '0';

    const head = document.createElement('div');
    head.className = 'lane-head';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'lane-name';
    text(name, channel.label || (info ? info.name : channel.type));
    const tag = document.createElement('span');
    tag.className = 'tag';
    text(tag, info ? info.name : channel.type);
    const grow = document.createElement('span');
    grow.className = 'lane-grow';

    const sw = document.createElement('label');
    sw.className = 'switch';
    const enabledBox = document.createElement('input');
    enabledBox.type = 'checkbox';
    enabledBox.checked = channel.enabled !== false;
    enabledBox.dataset.role = 'enabled';
    enabledBox.addEventListener('change', () => {
      channel.enabled = enabledBox.checked;
      lane.dataset.enabled = channel.enabled ? '1' : '0';
      markChannelsDirty();
      toast((channel.label || (info ? info.name : '渠道')) + (channel.enabled ? ' 已启用，点保存生效' : ' 已停用，点保存生效'));
    });
    sw.append(enabledBox, document.createTextNode('启用'));

    const toggle = channelButton('参数', 'lane-toggle', () => {
      const fields = lane.querySelector('.lane-fields');
      const opening = fields.hidden;
      fields.hidden = !opening;
      toggle.textContent = opening ? '收起' : '参数';
      toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
    });
    toggle.setAttribute('aria-expanded', 'false');

    const testBtn = channelButton('测试', '', () => testChannel(channel.id, testBtn, info));
    const removeBtn = channelButton('删除', 'danger', () => {
      syncChannels();
      channelDraft = channelDraft.filter((entry) => entry.id !== channel.id);
      renderChannels();
      markChannelsDirty();
      toast('已移除渠道「' + (channel.label || (info ? info.name : channel.type)) + '」，点保存生效');
    });
    head.append(dot, name, tag, grow, sw, toggle, testBtn, removeBtn);
    lane.append(head);

    const fields = document.createElement('div');
    fields.className = 'lane-fields';
    fields.hidden = true;
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
        input.value = alreadySet ? '' : (stored != null ? stored : (field.default || ''));
        if (alreadySet) input.placeholder = '已设置，留空保持不变';
        else if (field.placeholder) input.placeholder = field.placeholder;
      }
      input.dataset.field = field.key;
      input.dataset.kind = field.kind;
      input.addEventListener('input', markChannelsDirty);
      row.append(label, input);
      fields.append(row);
    }
    lane.append(fields);

    const result = document.createElement('div');
    result.className = 'test-result channel-result';
    result.hidden = true;
    lane.append(result);
    return lane;
  }

  async function testChannel(id, button, info) {
    if (pendingKeyText()) { toast('请先点击「追加密钥」添加新增密钥', true); return; }
    button.disabled = true;
    try {
      const saved = await request(api.config, collect());
      current = saved;
      if (Array.isArray(saved.channelTypes)) channelTypes = saved.channelTypes;
      fill(saved.config);
      status(saved);
      renderMutes(saved);
      captureSavedForm(nowStamp());
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

  function renderResultInto(box, result) {
    if (!box) return;
    const results = (result && Array.isArray(result.results)) ? result.results : [];
    box.replaceChildren();
    if (!results.length) { box.hidden = true; return; }
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
      text(name, entry.channelType ? (entry.label || typeLabel(entry.channelType)) : ('Bark ' + (entry.maskedKey || '设备')));
      const pill = document.createElement('span');
      if (entry.ok === true) { pill.className = 'pill ok'; text(pill, '成功'); }
      else if (entry.skipped === true) { pill.className = 'pill warn'; text(pill, '未发送'); }
      else { pill.className = 'pill bad'; text(pill, '失败'); }
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

  function renderBarkTestResult(result) { renderResultInto($('barkTestResult'), result); }

  function findChannelCard(id) {
    const lanes = $('channelList') ? $('channelList').querySelectorAll('.channel') : [];
    for (const lane of lanes) if (lane.dataset && lane.dataset.id === id) return lane;
    return null;
  }

  function renderChannelTestResult(id, result) {
    const lane = findChannelCard(id);
    renderResultInto(lane ? lane.querySelector('.channel-result') : null, result);
  }

  function fill(config) {
    $('newKeys').value = '';
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

    $('browserNotifyEnabled').checked = config.browserNotifyEnabled === true;
    $('browserNotifyOnReply').checked = config.browserNotifyOnReply !== false;
    $('browserNotifyOnApproval').checked = config.browserNotifyOnApproval !== false;
    $('browserNotifyOnQuestion').checked = config.browserNotifyOnQuestion !== false;
    $('browserNotifySkipForeground').checked = config.browserNotifySkipForeground !== false;
    $('browserNotifyUsePushMutes').checked = config.browserNotifyUsePushMutes !== false;
    $('browserNotifyReplyBody').value = config.browserNotifyReplyBody || '{status} · {summary}';
    $('browserNotifyApprovalBody').value = config.browserNotifyApprovalBody || '{status} · {tool} · {reason}';
    $('browserNotifyQuestionBody').value = config.browserNotifyQuestionBody || '{status} · {question}';
    $('browserNotifyMaxBodyLength').value = config.browserNotifyMaxBodyLength || 200;
    renderBrowserPermission();
    renderTemplatePreviews();
    updateBrowserMuteVisibility();

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

  function status(data) {
    if (Array.isArray(data.channelTypes) && data.channelTypes.length > 0) channelTypes = data.channelTypes;
    const cfg = data.config || {};
    const node = $('status');
    node.replaceChildren();
    const add = (label, cls) => {
      const pill = document.createElement('span');
      pill.className = 'pill' + (cls ? ' ' + cls : '');
      text(pill, label);
      node.append(pill);
    };
    add(cfg.enabled ? '已启用' : '已停用', cfg.enabled ? 'ok' : 'warn');
    add((cfg.deviceKeyCount || 0) + ' 台设备', cfg.deviceKeyCount ? '' : 'warn');
    const channelCount = Array.isArray(cfg.channels) ? cfg.channels.length : 0;
    add(channelCount + ' 个渠道');
    const recent = [];
    if (data.lastTest) recent.push('测试' + (data.lastTest.ok ? ' ✓' : ' ✗'));
    if (data.lastDelivery) {
      const d = data.lastDelivery;
      recent.push(labelOf(d.kind) + (d.ok ? ' ✓' : d.skipped ? ' –' : ' ✗'));
    }
    if (recent.length) add('最近　' + recent.join(' · '), data.lastDelivery && data.lastDelivery.ok === false ? 'warn' : '');
    const countEl = $('channelCount');
    if (countEl) text(countEl, String(channelCount));

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
    const sessionCount = $('sessionCount');
    if (sessionCount) text(sessionCount, String(rows.length));
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'empty'; text(empty, '没有会话记录');
      sessionBox.append(empty);
    }
    for (const session of rows) {
      const workspaceLabel = session.workspaceTitle || session.workspaceId;
      const subLines = [
        session.id,
        workspaceLabel ? ('工作区 ' + workspaceLabel) : '',
        session.running ? '运行中' : '',
        session.archived ? '已归档' : '',
        session.orphaned && !session.archived ? '仅保留静音记录' : '',
      ].filter(Boolean);
      sessionBox.append(muteRow('session', session.id, session.title || '未命名', subLines, mutedSessions.has(session.id)));
    }
    renderBrowserMutes(data);
  }

  function renderBrowserMutes(data) {
    if (!data || !data.mute || !data.catalog) return;
    const mutedWorkspaces = new Set(data.mute.browserWorkspaces || []);
    const mutedSessions = new Set(data.mute.browserSessions || []);
    const workspaceBox = $('browserWorkspaces');
    if (workspaceBox) {
      workspaceBox.replaceChildren();
      if (!data.catalog.workspaces.length) {
        const empty = document.createElement('div'); empty.className = 'empty'; text(empty, '没有工作区记录');
        workspaceBox.append(empty);
      }
      for (const workspace of data.catalog.workspaces) {
        workspaceBox.append(muteRow('workspace', workspace.id, workspace.title || workspace.id, workspace.path, mutedWorkspaces.has(workspace.id), 'browser'));
      }
    }

    const queryInput = $('browserSessionSearch');
    const query = queryInput ? (queryInput.value || '').trim().toLowerCase() : '';
    const sessionBox = $('browserSessions');
    if (sessionBox) {
      sessionBox.replaceChildren();
      const rows = data.catalog.sessions.filter((session) => {
        if (!query) return true;
        return String(session.title || '').toLowerCase().includes(query) || String(session.id).toLowerCase().includes(query);
      });
      const sessionCount = $('browserSessionCount');
      if (sessionCount) text(sessionCount, String(rows.length));
      if (!rows.length) {
        const empty = document.createElement('div'); empty.className = 'empty'; text(empty, '没有会话记录');
        sessionBox.append(empty);
      }
      for (const session of rows) {
        const workspaceLabel = session.workspaceTitle || session.workspaceId;
        const subLines = [
          session.id,
          workspaceLabel ? ('工作区 ' + workspaceLabel) : '',
          session.running ? '运行中' : '',
          session.archived ? '已归档' : '',
          session.orphaned && !session.archived ? '仅保留静音记录' : '',
        ].filter(Boolean);
        sessionBox.append(muteRow('session', session.id, session.title || '未命名', subLines, mutedSessions.has(session.id), 'browser'));
      }
    }
    updateBrowserMuteVisibility();
  }

  function muteRow(kind, id, title, sub, muted, channel) {
    const item = document.createElement('label');
    item.className = 'item';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = muted;
    box.addEventListener('change', async () => {
      box.disabled = true;
      try {
        const data = await request(api.mute, { kind, id, muted: box.checked, channel: channel || 'push' });
        current = data;
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
    meta.append(titleNode);
    const subLines = Array.isArray(sub) ? sub : [sub];
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

  function postHeight() {
    if (window.parent === window) return;
    const height = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0,
    );
    if (!Number.isFinite(height) || height <= 0) return;
    window.parent.postMessage({ type: 'dsh-bark-push:height', height }, window.location.origin);
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.type !== 'dsh-bark-push:browser-permission-result') return;
    renderBrowserPermission();
    toast(data.permission === 'granted' ? '浏览器通知权限已授予' : '浏览器通知权限未授予', data.permission !== 'granted');
  });

  if (window.parent !== window) {
    window.addEventListener('load', postHeight);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(postHeight).observe(document.body);
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
      trace: $('trace').checked,
      browserNotifyEnabled: $('browserNotifyEnabled').checked,
      browserNotifyOnReply: $('browserNotifyOnReply').checked,
      browserNotifyOnApproval: $('browserNotifyOnApproval').checked,
      browserNotifyOnQuestion: $('browserNotifyOnQuestion').checked,
      browserNotifySkipForeground: $('browserNotifySkipForeground').checked,
      browserNotifyUsePushMutes: $('browserNotifyUsePushMutes').checked,
      browserNotifyReplyBody: $('browserNotifyReplyBody').value,
      browserNotifyApprovalBody: $('browserNotifyApprovalBody').value,
      browserNotifyQuestionBody: $('browserNotifyQuestionBody').value,
      browserNotifyMaxBodyLength: Number($('browserNotifyMaxBodyLength').value)
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
      captureSavedForm();
    } catch (error) {
      saveError = '读取失败：' + error.message;
      renderSaveState();
      toast('读取失败：' + error.message, true);
    }
  }

  const STATUS_BY_BUTTON = { saveChannels: 'channelsSaveStatus', saveRules: 'rulesSaveStatus', save: 'barkSaveStatus', saveBrowser: 'browserSaveStatus' };

  // Single save path shared by every section's "保存全部更改" button. It always
  // persists the whole config; only the inline status location differs.
  function broadcastBrowserConfig(config) {
    if (window.parent === window || !config) return;
    try {
      window.parent.postMessage({
        type: 'dsh-bark-push:config-updated',
        config: {
          browserNotifyEnabled: config.browserNotifyEnabled === true,
          browserNotifySkipForeground: config.browserNotifySkipForeground !== false,
        },
      }, window.location.origin);
    } catch (_) { /* optional parent bridge */ }
  }

  async function persistConfig(button) {
    if (pendingKeyText()) { toast('请先点击「追加密钥」添加新增密钥', true); return false; }
    const statusId = (button && STATUS_BY_BUTTON[button.id]) || 'barkSaveStatus';
    if (button) button.disabled = true;
    saveBusy = true;
    saveError = '';
    renderSaveState();
    setSaveStatus(statusId, '保存中…', '');
    try {
      const data = await request(api.config, collect());
      current = data;
      if (Array.isArray(data.channelTypes) && data.channelTypes.length > 0) channelTypes = data.channelTypes;
      fill(data.config);
      status(data);
      renderMutes(data);
      broadcastBrowserConfig(data.config);
      captureSavedForm(nowStamp());
      toast('配置已保存');
      return true;
    } catch (error) {
      saveFailed('保存失败：' + (error.message || '未知错误'));
      toast('保存失败：' + error.message, true);
      return false;
    } finally {
      if (button) button.disabled = false;
      renderSaveState();
    }
  }

  $('addChannel').addEventListener('click', () => {
    syncChannels();
    const type = $('channelTypeSelect').value;
    const info = typeInfo(type);
    if (!info) { toast('请选择渠道类型', true); return; }
    const config = {};
    for (const field of info.fields) if (field.default !== undefined) config[field.key] = field.default;
    channelDraft.push({ id: genChannelId(), type, label: '', enabled: true, config, secretsSet: {} });
    renderChannels();
    markChannelsDirty();
    toast('已添加 ' + info.name + '，展开“参数”填写后保存');
  });

  $('save').addEventListener('click', () => { void persistConfig($('save')); });
  $('saveChannels').addEventListener('click', () => { void persistConfig($('saveChannels')); });
  $('saveRules').addEventListener('click', () => { void persistConfig($('saveRules')); });
  $('saveBrowser').addEventListener('click', () => { void persistConfig($('saveBrowser')); });
  $('saveAll').addEventListener('click', () => { void persistConfig($('saveAll')); });
  $('discardAll').addEventListener('click', async () => {
    if (!isFormDirty()) return;
    if (!window.confirm('放弃当前未保存的更改，恢复为最近保存的配置？')) return;
    await load();
    toast('已恢复为最近保存的配置');
  });
  document.addEventListener('input', (event) => {
    if (event.target && event.target.closest && event.target.closest('main')) refreshDirtyState();
  });
  document.addEventListener('change', (event) => {
    if (event.target && event.target.closest && event.target.closest('main')) refreshDirtyState();
  });
  window.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || String(event.key).toLowerCase() !== 's') return;
    event.preventDefault();
    if (!saveBusy && savedForm !== null && isFormDirty()) void persistConfig($('saveAll'));
  });
  window.addEventListener('beforeunload', (event) => {
    if (savedForm === null || !isFormDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  $('tab-push').addEventListener('click', () => setTab('push', true));
  $('tab-browser').addEventListener('click', () => setTab('browser', true));
  $('requestNotifyPermission').addEventListener('click', () => { void requestBrowserPermission(); });
  $('testBrowserNotify').addEventListener('click', testBrowserNotification);
  $('browserNotifyUsePushMutes').addEventListener('change', updateBrowserMuteVisibility);
  $('browserSessionSearch').addEventListener('input', () => { if (current) renderBrowserMutes(current); });
  for (const kind of ['reply', 'approval', 'question']) {
    const input = $('browserNotify' + kind[0].toUpperCase() + kind.slice(1) + 'Body');
    if (input) input.addEventListener('input', () => renderTemplatePreview(kind));
  }

  $('addKeys').addEventListener('click', async () => {
    if (hasConfigChanges()) { toast('请先保存当前更改，再追加密钥', true); return; }
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
      captureSavedForm(nowStamp());
      toast('已追加 ' + keys.length + ' 个密钥');
    } catch (error) {
      toast('保存失败：' + error.message, true);
    } finally {
      $('addKeys').disabled = false;
    }
  });

  $('clearKeys').addEventListener('click', async () => {
    if (hasConfigChanges()) { toast('请先保存当前更改，再清空 Device Key', true); return; }
    if (!window.confirm('确定清空全部 Device Key？')) return;
    try {
      const data = await request(api.config, { clearDeviceKeys: true });
      current = data;
      fill(data.config);
      status(data);
      renderMutes(data);
      captureSavedForm(nowStamp());
      toast('已清空 Device Key');
    } catch (error) {
      toast('保存失败：' + error.message, true);
    }
  });

  $('reset').addEventListener('click', async () => {
    if (hasConfigChanges()) { toast('请先保存或放弃当前更改，再恢复默认配置', true); return; }
    if (!window.confirm('恢复默认配置？静音状态、Device Key 与已配置渠道不会被清除。')) return;
    try {
      const data = await request(api.config, { reset: true });
      current = data;
      fill(data.config);
      status(data);
      renderMutes(data);
      captureSavedForm(nowStamp());
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
        status(data.state);
        renderMutes(data.state);
      }
      const result = data.result || {};
      renderBarkTestResult(result);
      const results = Array.isArray(result.results) ? result.results : [];
      if (result.skipped) toast('未发送：' + (result.reason || '尚未配置 Device Key'), true);
      else if (results.length > 0) {
        const okCount = results.filter((entry) => entry.ok === true).length;
        if (okCount === results.length) toast('测试推送成功（' + okCount + ' 台设备）');
        else toast('测试完成：' + okCount + ' 成功 / ' + (results.length - okCount) + ' 失败（详见下方结果）', true);
      } else toast(result.ok ? '测试推送成功' : '测试推送失败', result.ok !== true);
    } catch (error) {
      toast('测试失败：' + error.message, true);
    } finally {
      $('test').disabled = false;
    }
  });

  $('sessionSearch').addEventListener('input', () => { if (current) renderMutes(current); });
  try {
    if (new URL(window.location.href).searchParams.get('view') === 'browser') setTab('browser', false);
  } catch (_) { /* default to push tab */ }
  load();
})();
</script>
</body>
</html>`;
}
