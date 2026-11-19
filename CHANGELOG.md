# Changelog

## 0.3.0 — 2026-11-19

- 新增独立的浏览器通知通道：回复完成、需要批准、等待选择三类事件可通过浏览器系统通知提醒；与 Bark/额外渠道的开关、Device Key 和发送队列完全分离。
- Settings 设置为「通知」入口，重构为顶部 Tab + 概览工作区：推送渠道、通知规则、浏览器通知、静音管理各自独立；浏览器通知提供独立总开关、类型开关、前台免打扰、权限状态、测试通知和正文模板。
- 浏览器通知正文支持模板与占位符：`{status}`、`{session}`、`{summary}`、`{turn}`、`{tool}`、`{reason}`、`{question}`、`{questionCount}`、`{description}`；未知占位符保留，默认模板为 `{status} · {summary}` / `{status} · {tool} · {reason}` / `{status} · {question}`。
- 新增认证 SSE 路由 `GET /api/bark-push/browser-events`；Host 侧 `BrowserNotifyHub` 负责事件去重、短缓冲和短描述输出，Web 客户端用 EventSource 接收并调用 Notification API。
- 默认只在 DSH 页面打开且页面未获得焦点/其他会话时提醒；当前会话前台时按 `browserNotifySkipForeground` 跳过。点击通知只打开对应会话，审批仍需在 DSH 原生审批面板完成。
- 静音策略默认复用现有工作区/会话推送静音；`browserNotifyUsePushMutes=false` 时使用独立的 `browserMutedWorkspaces` / `browserMutedSessions`，设置页提供独立静音管理。
- 设置页新增保存台账：顶部显示「全部更改已保存 / 有未保存的更改」与上次保存时间，分区和顶部 Tab 显示未保存圆点；支持「放弃更改」和 `Ctrl/⌘+S` 快捷保存。静音切换明确标为即时生效，渠道「测试」提示会先保存当前配置。测试：102 / 102 通过。
- 修复静音列表中的长会话标题与 Session ID 撑宽设置页：列表列宽、条目和 meta 统一 `min-width: 0`，标题省略、ID 可换行，页面不再出现横向溢出。

## 0.2.2 — 2026-11-17

- 修复设置页「静音管理」会话列表混入大量未命名/未知会话的问题：catalog 不再枚举 `workspace.sessionIds` 中的全部历史条目，改用 DSH Web 同源的 `sessionController.list()`（冷会话标题来自持久化投影缓存），并以 `sessionQuery` / 实时会话作为降级来源。
- 会话可见性与 DSH 左侧会话列表保持一致：排除 `origin === "subagent"` 的子代理会话、`blank` 空白新会话，以及默认归档过滤器下的归档会话；置顶会话按置顶顺序优先，其余按最近活跃时间排序。
- 因静音记录而保留的已归档/不可见会话继续显示并标注，避免静音状态无法清除；设置页会话区新增数量徽标，副标题改用工作区名称而非 UUID。

## 0.2.1 — 2026-11-17

- 静音入口重排，避免与其它通知插件争抢会话行尾的 hover 按钮条：
  - 移除 `sidebar.workspaces.session.row.action` 的铃铛；会话静音改由 `sidebar.workspaces.session.menu.item` slot 承担（见下），行「…」菜单与右键菜单共用，不会重复。
  - 新增 `sidebar.session.row.trailing` 的**不可点**小铃铛标记，仅在该会话被静音时显示，保留状态可见性。
  - 新增 `conversation.session.header.utilities` 的当前会话头部铃铛，提供一键静音/取消静音。
- 会话菜单项改用 `sidebar.workspaces.session.menu.item` slot，`order: 510`：该 slot 同时渲染进行「…」菜单与右键菜单，且整体位于内置「归档会话」之前，因此稳定排在其它插件项之后、归档之前；不再使用会受其它插件 order 影响的 `contextMenus` 注入。
- 会话菜单项优先渲染宿主原语 `@deepseek-ai/dsh-client-ui-primitives` 的 `MenuItemButton`，样式/间距/hover 完全跟随宿主；仅当宿主未注入该原语时回退到本地 `bark-menuItem` 样式。
- 会话菜单项样式按宿主菜单行对齐：`bark-menuItem` 使用 flex、左对齐、`6px 10px` 内边距、16px 图标与 hover 背景；修正先前裸 `<button>` 默认居中、与其它项不一致的问题。
- 修复设置页会话列表不完整：`/state` 的 catalog 现在返回“已加载会话 ∪ 工作区 sessionIds 中的持久化会话 ∪ 已静音会话”，未加载的会话标为离线；客户端据此为每个会话建立 workspace 映射，工作区静音标记不再依赖先点一次会话静音。
- 修复客户端首次拉取 `/state` 可能失败导致静音状态/映射空白：启动后按 600ms/1.5s/3s/6s/12s 重试，直到成功。
- 修复工作区静音对“未登记在 workspace.sessionIds 但位于工作区子目录”的会话不生效：服务端在精确路径匹配失败后按最长工作区路径前缀解析。
- 工作区静音增加常驻状态提示：客户端缓存 `session → workspace` 映射，会话行尾的铃铛标记现在同时反映“会话静音”和“工作区静音”，tooltip 分别显示「推送通知已静音」/「工作区推送通知已静音」。宿主未提供工作区行装饰 slot，因此标记落在该工作区的会话行上。
- 工作区菜单项 `order` 由 900 降到 199：宿主的「在文件夹显示/复制目录/打开目录/归档工作区」是一个 order 200 的 provider 组，因此放在 199 可整体位于「归档工作区」上方（无法插进组内，宿主未提供工作区菜单 slot）。
- 测试同步更新（83 / 83 通过）；已用真实 `dsh web` 验证行尾铃铛消失、行「…」菜单静音项唯一、静音后出现行尾标记。

## 0.2.0 — 2026-11-13

- 新增「更多推送渠道」：在 Bark 之外可同时启用 Gotify、ntfy、PushDeer、Server酱、PushPlus、额外 Bark 服务器与自定义 Webhook。每条通知并行投递到 Bark 和所有已启用渠道，渠道之间互相隔离，单个渠道失败不影响其他渠道或 DSH。
- 新增 `lib/channels.js`：数据驱动的渠道注册表 + 通用发送器（复用超时、指数退避重试、错误隔离）。新增渠道类型只需增加一条描述符。
- 管理页新增渠道卡片：按类型动态渲染参数、启用/停用、删除、**逐渠道测试**；敏感字段（Token/Key/Webhook 地址）只显示“已设置”，留空保存即保持原值。
- 「更多推送渠道」卡片内置独立的“保存配置”按钮（与上方共用同一保存逻辑）；默认「测试推送」只测试内置 Bark（按设备逐条列出成功/失败），额外渠道各自用卡片上的「测试」单独验证，不会一次群发所有渠道；添加/删除/启停渠道会标记“有未保存的更改”。
- 保存反馈就地化：两张卡片各自的「保存配置」按钮在保存后就地显示“已保存 HH:MM:SS”或“保存失败：…”，滚动到任何位置都能确认；同时仍触发宿主浮层 toast。
- 配置页视觉与信息架构重塑（按 frontend-design 复盘）：页面更名「推送通知」，不再堆叠同款圆角卡片；改为“分区 + 状态优先”的连续面板——顶部轻量健康条，下面依次是「默认渠道 · Bark」（含可折叠高级选项）、「通知规则」（卡片式开关）、「渠道」（每个渠道一行投递通道：状态点 / 类型标签 / 启用 / 参数展开 / 测试 / 删除）、「静音管理」。文案精简、按钮与焦点态统一、数字用等宽；设置导航与静音菜单文案同步为「推送通知」。
- 交互重构（遵循 DSH 插件最佳实践）：管理页 iframe 无法固定底部 toast（宿主会把 iframe 撑到内容全高），改由客户端半注册官方 `shell.overlay` 框架级浮层来显示 toast——它位于顶层文档、盖在所有列之上，滚动到任何位置都可见；测试结果就近显示在触发它的卡片内，页面顶部状态改为轻量状态条。
- 配置新增 `channels` 数组（最多 20 个），`publicConfig` 对渠道密钥脱敏；新增 `POST /api/bark-push/test-channel` 单渠道测试路由。
- “恢复默认”保留已配置的 Device Key 与额外渠道，避免误删凭据。
- 测试：83 / 83 通过（新增 `test/channels.test.js`、默认测试仅 Bark 的回归用例）。

## 0.1.6 — unreleased

- 静音管理的会话条目拆成标题、会话 ID、工作区三行；长 ID 自动换行，消除横向滚动条。
- 管理页通过 `postMessage` 上报实际内容高度，Settings iframe 自动增高，外层只保留一个垂直滚动条。
- 测试：63 / 63 通过。

## 0.1.5 — unreleased

- 新增 `.github/workflows/publish.yml`：通过 npm Trusted Publishing（GitHub OIDC）发布，带 provenance，不再依赖长期 npm token。
- 补齐 npm 包的 `repository` / `homepage` / `bugs` 元数据，便于 npm 页面和 provenance 校验。

## 0.1.4 — unreleased

- 修复设置页“静音管理”工作区/会话列表为空：catalog 改为从根 Host 上下文读取，并通过 `ctx.get()` 解析 `workspaceRegistry` / `sessions` / `sessionTitle`（Cordis 的 `ctx.get` 不要求 `inject`）。
- 测试：63 / 63 通过。

## 0.1.3 — unreleased

- 回复、审批、选择三类通知各自拥有独立的 `level` 与 `sound` 配置：`levelReply` / `soundReply`、`levelApproval` / `soundApproval`、`levelQuestion` / `soundQuestion`。
- 管理页按三类分别提供级别与铃声，并把 `active` / `timeSensitive` / `passive` / `critical` 映射为“主动通知 / 时效性通知 / 静默通知 / 紧急通知”，补充设备行为说明。
- 保留 `levelNormal` / `levelImportant` / `soundNormal` / `soundImportant` 作为旧配置迁移回退，管理页不再编辑这四个字段。
- 测试：62 / 62 通过。

## 0.1.2 — unreleased

- 工作区与会话右键菜单的“静音 Bark 通知”增加 bell / bell-off 图标，和会话行、Settings 导航保持一致。
- 修复会话行悬浮按钮未显示的问题：slot 组件从注入 props 读取 locale seat，并补了组件渲染测试。

## 0.1.1 — 2026-11-12

- 会话行静音按钮改用内置的 bell / bell-off SVG 图标，跟随宿主主题的 `currentColor`。
- 管理页标题和 Settings 导航图标使用 bell 图标，图标源文件保存在 `lib/assets/`。
- 移除 Settings 页面底部“在新标签页打开管理页”的外链；配置仍通过内嵌页面完成。

## 0.1.0 — 2026-11-12

- 初始版本：Agent 回复、审批请求、用户选择三类 Bark 通知。
- 工作区级与会话级静音，状态持久化到 `$DSH_HOME/bark-push/state.json`。
- 认证后的管理 API 与 Settings 管理页，支持测试推送、多 Device Key、通知类型开关、长度限制、超时与重试。
- 异步有界队列、去重、Markdown 清理、Device Key 掩码与错误隔离。
