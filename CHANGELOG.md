# Changelog

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
- 测试：77 / 77 通过（新增 `test/channels.test.js`、默认测试仅 Bark 的回归用例）。

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
