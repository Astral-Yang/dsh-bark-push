# Changelog

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
