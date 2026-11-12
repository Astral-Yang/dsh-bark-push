# Changelog

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
