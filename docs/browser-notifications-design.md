# dsh-bark-push 浏览器通知功能设计方案

- 状态：已实现（`0.3.0`，见 CHANGELOG 与 README）
- 日期：2026-11-19
- 目标版本：`0.3.0`
- 适用范围：`dsh-bark-push` 的 Web 客户端与 Host 插件
- 不改动 DSH 核心代码，只使用 DSH 已有的客户端 Slot、Service、Connection Fetch 以及浏览器的 Notification API。

---

## 1. 目标与结论

### 1.1 目标

新增一个与 Bark/多渠道推送**独立控制**的浏览器通知通道：

1. 浏览器通知有自己的总开关和三个类型开关，不受 `enabled`、Device Key、Bark Server 或推送渠道配置影响。
2. 支持三种通知类型：
   - 回复完成
   - 需要批准
   - 等待选择
3. 通知内容只包含会话标题、状态和简短描述，不搬运推送通知的完整正文。
4. 支持自定义通知正文模板，通过占位符替换工具名、问题、回复摘要等字段。
5. 当前会话且网页在前台时默认不提醒，并允许用户关闭该行为。
6. 批准请求不要求通过通知直接批准；点击通知打开对应会话，由 DSH 原生审批面板完成决策。

### 1.2 非目标（v1 不做）

- 不做页面关闭后的 Web Push。`new Notification()` 只在页面存活期间可靠；页面关闭、浏览器退出后不会送达。
- 不做移动端 Safari / iOS 浏览器的页面通知。移动浏览器普遍不支持 `new Notification()` 构造函数，`ServiceWorkerRegistration.showNotification()` 需要额外的 Service Worker/PWA 支持，留到后续版本。
- 不做通知内直接批准/拒绝。
- 不修改 DSH 核心的 Session、Approval、Question 流程。
- 不把浏览器通知写入 Bark 的发送队列，也不要求配置任何推送渠道。

### 1.3 浏览器能力边界

| 场景 | v1 行为 |
|---|---|
| 桌面 Chrome / Edge / Firefox / Safari，页面打开且已授权 | 正常显示浏览器通知 |
| 桌面浏览器标签页在后台，但浏览器进程仍存活 | 可显示通知 |
| DSH 页面关闭、浏览器退出 | 不保证送达；请使用 Bark 推送 |
| iPhone / iPad Safari 标签页 | 不支持 `new Notification()`；使用 Bark |
| 通知操作按钮 | v1 不实现；点击通知只聚焦页面并打开会话 |
| 页面通过 HTTPS 或 localhost 访问 | 满足 Notification API 的安全上下文要求 |
| 页面通过普通 HTTP + 非 localhost 访问 | 浏览器可能直接禁用通知 |

> 结论：浏览器通知适合“人在电脑前、DSH 在后台标签页”的提醒；离开电脑或手机关屏的场景仍由 Bark 推送承担。

---

## 2. 用户可见行为

### 2.1 设置入口（已确认）

插件在 Settings 中只保留一个**独立入口「通知」**，不再增加第二个导航项。页面使用顶部 Tab，将配置拆成概览与四个工作区：

```text
Settings → 通知
          ├─ 概览         （通知链路、状态与最近动态）
          ├─ 推送渠道     （Bark / Gotify / ntfy 等送达渠道）
          ├─ 通知规则     （回复 / 批准 / 选择 / 子代理）
          ├─ 浏览器通知   （浏览器开关、权限与正文模板）
          └─ 静音管理     （推送静音、浏览器静音策略）
```

这样两个功能域共享一个设置入口，但控制面彼此独立：推送渠道不混入浏览器通知开关，浏览器通知工作区不混入 Device Key、Bark Server 或推送渠道配置。

### 2.2 浏览器通知工作区

页面内容建议：

1. **权限状态**
   - `当前浏览器不支持通知`
   - `浏览器通知权限：未授权`
   - `浏览器通知权限：已授权`
   - `浏览器通知权限：已拒绝（请在浏览器站点设置中允许通知）`
2. **总开关**：`启用浏览器通知`，默认关闭。
3. **类型开关**
   - `回复完成`
   - `需要批准`
   - `等待选择`
4. **前台免打扰开关**
   - `当前会话且页面在前台时不提醒`，默认开启。
5. **静音策略**
   - `复用推送通知的工作区/会话静音` 开关，默认开启。
   - 关闭后显示独立的「浏览器通知静音管理」，分别管理浏览器通知自己的工作区静音和会话静音，不影响 Bark 推送的静音集合。
6. **正文模板**
   - 三个独立输入框：回复完成 / 需要批准 / 等待选择
   - 每个输入框下方有可用占位符提示和实时预览
   - 「恢复默认模板」按钮
7. **操作按钮**
   - `请求通知权限`
   - `发送测试通知`
   - `保存浏览器通知设置`
8. **提示文案**
   - `浏览器通知仅在 DSH 页面打开时生效；关闭页面后请使用推送通知。`
   - `批准和选择仍需要在 DSH 页面内完成。`

### 2.3 通知示例

固定标题为会话标题，正文由模板渲染：

| 类型 | 默认正文示例 |
|---|---|
| 回复完成 | `回复完成 · 已生成回复摘要` |
| 需要批准 | `需要批准 · Bash · 写入工作区文件` |
| 等待选择 | `等待选择 · 请选择部署环境` |

---

## 3. 正文模板设计（本次新增重点）

### 3.1 模板字段

新增三个独立模板：

| 配置字段 | 默认值 |
|---|---|
| `browserNotifyReplyBody` | `{status} · {summary}` |
| `browserNotifyApprovalBody` | `{status} · {tool} · {reason}` |
| `browserNotifyQuestionBody` | `{status} · {question}` |

模板只支持简单的 `{placeholder}` 替换，不支持 JavaScript 表达式、HTML 或任意函数。通知正文始终按纯文本处理。

### 3.2 占位符

| 占位符 | 适用类型 | 含义 | 替换示例 |
|---|---|---|---|
| `{status}` | 全部 | 类型状态文案 | `回复完成` / `需要批准` / `等待选择` |
| `{session}` | 全部 | 会话标题 | `扫描当前工作目录` |
| `{summary}` | 回复完成 | 回复正文的纯文本首行摘要，默认最多 60 字 | `已完成 dsh-bark-push 会话列表修复` |
| `{turn}` | 回复完成 | 回合序号（如果事件提供） | `3` |
| `{tool}` | 需要批准 | 工具名 | `Bash` |
| `{reason}` | 需要批准 | 审批原因摘要，默认最多 80 字；无原因时为空 | `写入工作区文件` |
| `{question}` | 等待选择 | 第一个问题的文本，默认最多 80 字 | `请选择部署环境` |
| `{questionCount}` | 等待选择 | 问题数量 | `2` |
| `{description}` | 全部 | 通用描述：回复摘要 / 工具名+原因 / 问题文本 | `Bash · 写入工作区文件` |

用户重点是 `{tool}` 和 `{question}`，但建议同时保留 `{reason}`、`{summary}`、`{questionCount}`，方便组合出更完整的通知。

### 3.3 渲染规则

1. 从事件中收集可用值，并对每个值做纯文本化和长度截断。
2. 按模板逐项替换 `{name}`。
3. 未知占位符保持原样，避免用户拼写错误时静默丢内容；设置页实时预览中会原样显示。
4. 空值替换为空字符串。
5. 替换后的正文如果为空或只有空白，回退到该类型的默认模板。
6. 最终正文按 `browserNotifyMaxBodyLength`（默认 200，范围 32–500）做 Unicode 安全截断。
7. 不把完整回复正文、工具参数、命令内容或图片数据写入模板变量；只使用上面列出的短描述。

### 3.4 示例

用户把「需要批准」模板设置为：

```text
{status}｜{session}｜工具：{tool}｜原因：{reason}
```

则通知为：

```text
标题：扫描当前工作目录
正文：需要批准｜扫描当前工作目录｜工具：Bash｜原因：写入工作区文件
```

用户把「等待选择」模板设置为：

```text
{status}：{question}（共 {questionCount} 个问题）
```

则通知为：

```text
标题：部署助手
正文：等待选择：请选择部署环境（共 2 个问题）
```

### 3.5 模板校验与预览

- 设置页提供每个模板的实时预览，使用示例数据填充：
  - 回复：`{summary}` = `已完成会话列表修复`
  - 批准：`{tool}` = `Bash`，`{reason}` = `写入工作区文件`
  - 选择：`{question}` = `请选择部署环境`，`{questionCount}` = `2`
- 模板中出现未知占位符时，预览中保持字面量并给出黄色提示，不阻止保存。
- 模板字段只保存字符串，长度上限建议 300 字符。
- 输入框失焦或保存时做一次服务端 `normalizeConfig` 校验。

---

## 4. 架构与数据流

### 4.1 总览

```text
Host 进程
  session/event
    ├─ turn/end (completed) ─────────────┐
    ├─ approval/asked ───────────────────┤
  user-questions/request ────────────────┤
                                          ▼
                              BrowserNotifyHub
                          （独立配置 + 去重 + 模板渲染）
                                          │
                                          │ SSE
                                          ▼
                    GET /api/bark-push/browser-events
                                          │
                                          ▼
                        Client 浏览器插件
                          ├─ EventSource
                          ├─ 当前会话/前台判断
                          ├─ 组装本地化正文
                          └─ new Notification(...)
                                          │
                                    点击通知
                                          ▼
                            uiWorkspace.openSession(sessionId)
```

### 4.2 Host 侧模块：`lib/browser-notify.js`

新增 `BrowserNotifyHub`：

**职责**

- 接收来自 Session 事件桥的三种事件。
- 只检查浏览器通知自己的配置：
  - `browserNotifyEnabled`
  - `browserNotifyOnReply`
  - `browserNotifyOnApproval`
  - `browserNotifyOnQuestion`
  - `browserNotifySkipForeground`（发送给客户端，由客户端判断）
- 不检查：
  - `enabled`
  - `deviceKeys`
  - `server`
  - `channels`
  - `notifyOnReply` / `notifyOnApproval` / `notifyOnQuestion`（这些是 Bark 推送的开关）
- 维护最多 50 条、最多 30 秒的环形缓冲，用于 SSE 短暂断线重连。
- 按 `kind + sessionId + turn / requestId` 做短 TTL 去重。
- 在 Host 侧渲染模板，只把最终的 `sessionTitle`、`status`、短 `body` 和 `sessionId` 发送给浏览器；完整回复正文不出 Host。

**接口草案**

```js
class BrowserNotifyHub {
  publishReply({ sessionId, sessionTitle, turn, text });
  publishApproval({ sessionId, sessionTitle, requestId, toolName, reason });
  publishQuestion({ sessionId, sessionTitle, questions });
  isMuted(sessionId, session); // 根据 browserNotifyUsePushMutes 查询共享或独立静音
  subscribe(request); // 返回 text/event-stream Response
  dispose();
}
```

### 4.3 事件桥接：`lib/events.js`

在现有三个事件点旁边，额外调用 `browserNotifier`，但不影响原有 `notifier` 的推送逻辑：

```js
// turn/end
notifier.reply({ ... });              // 原有 Bark 逻辑，内部检查推送开关
browserNotifier?.publishReply({ ... }); // 独立检查浏览器通知开关

// approval/asked
notifier.approval({ ... });
browserNotifier?.publishApproval({ ... });

// user-questions/request
notifier.question(request);
browserNotifier?.publishQuestion({ ... });
```

关键点：

- 即使 Bark 的 `notifyOnReply` 为 `false`，浏览器通知仍然可以开启并正常工作。
- 即使没有配置任何 Device Key，浏览器通知也可以工作。
- 子代理会话默认不产生浏览器通知（避免内部子任务造成噪音）；后续如需支持，可单独增加 `browserNotifyIncludeSubagents`。

### 4.4 SSE 接口

```text
GET /api/bark-push/browser-events
```

- 通过 `ctx.connection.fetch.register()` 注册，复用现有 Cookie 认证、Host/Origin 检查和 owner Peer 限制。
- 响应头：
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-cache`
  - `X-Accel-Buffering: no`
- 心跳：每 20 秒发送 `: heartbeat\n\n`。
- 事件名：`browser-notify`。
- 事件 ID：单调递增整数，用于重连。
- 数据示例：

```json
{
  "kind": "approval",
  "sessionId": "session-xxx",
  "sessionTitle": "扫描当前工作目录",
  "status": "需要批准",
  "body": "需要批准 · Bash · 写入工作区文件",
  "at": 1794912345678
}
```

如果反向代理对 SSE 有缓冲，则实现时优先验证 `dsh.asgardion.space:2096`；必要时降级为 2–3 秒短轮询接口：

```text
GET /api/bark-push/browser-events?after=<eventId>&timeout=25
```

---

## 5. 客户端行为

### 5.1 连接与显示

- 插件客户端加载后创建 `EventSource('/api/bark-push/browser-events')`。
- 收到 `browser-notify` 事件后：
  1. 检查浏览器支持与权限；
  2. 检查当前会话/前台免打扰；
  3. 用 `new Notification(sessionTitle, { body, tag, data })` 显示通知。
- 连接失败时显示设置页状态“浏览器通知通道未连接”，客户端每秒/数秒自动重连。

### 5.2 当前会话与前台判断

当前会话：

```js
const snapshot = ctx.sessions.list.getSnapshot();
const current = Object.values(snapshot.byId)
  .find((row) => (row.retainedBy.mainView ?? 0) > 0);
```

前台：

```js
const foreground =
  document.visibilityState === 'visible' && document.hasFocus();
```

跳过条件：

```js
if (browserNotifySkipForeground &&
    foreground &&
    event.sessionId === current?.id) {
  return; // 不显示
}
```

该判断在客户端完成，因为 Host 不知道浏览器焦点状态。

### 5.3 通知点击

```js
notification.onclick = () => {
  window.focus();
  ctx.uiWorkspace.openSession(event.sessionId);
  notification.close();
};
```

- 批准通知点击后打开对应会话，审批卡片由 DSH 原生 UI 展示。
- 选择通知点击后打开对应会话，问题卡片由 DSH 原生 UI 展示。
- 如果会话已经不存在/归档，`openSession` 失败时静默忽略，仅保持页面聚焦。

### 5.4 多标签页去重

建议实现：

- 使用 Web Locks 选举一个 leader 标签页，只有 leader 接收 SSE 并显示通知。
- 使用 `BroadcastChannel('dsh-bark-push:browser-notify')` 同步各标签页的当前会话、可见性和焦点状态。
- 当事件属于某个“当前会话 + 前台”的标签页时，leader 跳过该通知。

如果不做多标签页处理，用户同时打开两个 DSH 标签页时会重复收到通知。v1 可以先做 leader = 单标签页模式，多标签页去重作为 P1 增强。

---

## 6. 批准请求可行性说明

### 6.1 为什么不能直接在通知里批准

- `new Notification()` 的 `actions` 必须为空；传入非空数组在 Chromium 会抛 `TypeError`。
- 操作按钮只在 `ServiceWorkerRegistration.showNotification()` 的持久通知中支持，且主要是 Chromium 桌面端；Firefox 152+ 部分支持，Safari 不支持。
- DSH Web 目前没有注册 Service Worker，不能依赖通知操作按钮。
- 即使补 Service Worker，批准请求的生命周期绑定在页面的 `approval/request` waterfall 上。通知按钮的点击发生在 Service Worker 或页面外部，无法安全地持有审批详情上下文；由通知直接批准会带来误操作风险。

### 6.2 v1 策略

- 只发送文字通知：`需要批准 · <工具名> · <原因摘要>`。
- 点击通知：聚焦页面并打开对应会话。
- 用户在 DSH 原生审批卡片中点击「允许 / 拒绝」。
- 未来若要做通知内批准，需要同时满足：
  - 注册 Service Worker；
  - 通知 action 按钮在目标浏览器可用；
  - 页面打开并且审批仍 pending；
  - 有明确的二次确认/安全设计。

v1 不纳入该能力。

---

## 7. 配置设计

### 7.1 新增配置字段

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `browserNotifyEnabled` | boolean | `false` | 浏览器通知总开关 |
| `browserNotifyOnReply` | boolean | `true` | 回复完成通知 |
| `browserNotifyOnApproval` | boolean | `true` | 需要批准通知 |
| `browserNotifyOnQuestion` | boolean | `true` | 等待选择通知 |
| `browserNotifySkipForeground` | boolean | `true` | 当前会话且页面前台时不提醒 |
| `browserNotifyUsePushMutes` | boolean | `true` | 复用推送通知的工作区/会话静音；关闭后使用浏览器通知独立静音集合 |
| `browserNotifyReplyBody` | string | `{status} · {summary}` | 回复正文模板 |
| `browserNotifyApprovalBody` | string | `{status} · {tool} · {reason}` | 批准正文模板 |
| `browserNotifyQuestionBody` | string | `{status} · {question}` | 选择正文模板 |
| `browserNotifyMaxBodyLength` | integer | `200` | 最终正文最大字符数，范围 32–500 |

### 7.2 存储位置（已确认）

浏览器通知配置按 **DSH profile 共享**，写入现有 `$DSH_HOME/bark-push/state.json` 的 `config`，与现有管理页的保存机制一致：

- `normalizeConfig` 负责校验；
- `publicConfig` 返回脱敏后的完整浏览器通知配置；
- `nextConfigOverlay` 支持保存浏览器通知字段；
- 这些配置不参与 Bark 的任何配置合并或发送逻辑。

权限状态不写入 `state.json`，因为权限是每个浏览器独立的：

- `Notification.permission` 在客户端实时读取；
- 设置页单独显示当前浏览器权限；
- 不同浏览器首次使用需要分别点击「请求通知权限」。

> 已确认：不使用 `localStorage` 作为浏览器通知配置的主存储；同一 DSH profile 下的所有浏览器共享开关、模板和静音策略。各浏览器的通知权限仍由浏览器自己管理。

### 7.3 与现有推送配置的关系

| 现有字段 | 浏览器通知是否受其影响 |
|---|---|
| `enabled` | 否 |
| `deviceKeys` | 否 |
| `server` | 否 |
| `channels` | 否 |
| `notifyOnReply` / `notifyOnApproval` / `notifyOnQuestion` | 否 |
| `includeSubagents` | 否；浏览器通知默认只发主会话 |
| `maxBodyLength` | 否；浏览器通知使用 `browserNotifyMaxBodyLength` |
| 工作区/会话静音 | 由 `browserNotifyUsePushMutes` 控制；默认复用 |

### 7.4 静音策略（已确认）

浏览器通知提供开关：

```text
[browserNotifyUsePushMutes] 复用推送通知的工作区/会话静音   （默认开启）
```

**开启时（默认）**

- 浏览器通知沿用现有 `mutedWorkspaces` / `mutedSessions` 判断；
- 用户在工作区或会话菜单里静音后，Bark 推送和浏览器通知同时静音；
- 浏览器通知工作区不显示独立的静音列表；静音统一在「静音管理」工作区中处理。

**关闭时**

- 浏览器通知使用独立的 `browserMutedWorkspaces` / `browserMutedSessions`；
- 不影响 Bark 推送的静音状态；
- 浏览器通知在「静音管理」工作区内显示独立的静音列表，复用现有工作区/会话目录和静音界面结构，但读写独立的浏览器静音集合；
- Host 状态结构新增：
  - `browserMutedWorkspaces: string[]`
  - `browserMutedSessions: string[]`

Host 的 `BrowserNotifyHub` 在发布事件前按以下逻辑判断：

```js
const usePushMutes = config.browserNotifyUsePushMutes !== false;
const muted = usePushMutes
  ? state.isMuted({ workspaceKey, sessionId })
  : state.isBrowserMuted({ workspaceKey, sessionId });
if (muted) return;
```

静音管理接口建议扩展现有 `/api/bark-push/mute` / `/api/bark-push/toggle`，增加可选 `channel: 'push' | 'browser'` 字段；不传时默认 `push`，保持现有 API 兼容。

---

## 8. 设置页与权限交互

### 8.1 页面结构

Settings → 通知（独立入口），顶部 Tab + 工作区：

```text
通知
├─ 概览
│  ├─ 事件来源 → Bark / 浏览器通知链路
│  └─ 当前状态、最近动态
├─ 推送渠道
│  └─ Bark 与额外渠道
├─ 通知规则
│  └─ 回复 / 批准 / 选择 / 子代理
├─ 浏览器通知
│  ├─ 权限状态：未授权 / 已授权 / 已拒绝 / 不支持
│  ├─ [请求通知权限]
│  ├─ 总开关 [启用浏览器通知]
│  ├─ 通知类型（回复 / 批准 / 选择）
│  ├─ [x] 当前会话且页面在前台时不提醒
│  ├─ 正文模板
│  │  ├─ 回复完成：[输入框]  [恢复默认]
│  │  ├─ 需要批准：[输入框]  [恢复默认]
│  │  └─ 等待选择：[输入框]  [恢复默认]
│  └─ [发送测试通知]
└─ 静音管理
   ├─ 复用推送通知的工作区/会话静音（默认开启）
   ├─ 推送工作区 / 会话静音列表
   └─ 独立浏览器通知静音列表（仅关闭复用后显示）
```

概览与四个工作区共享一个保存台账：顶部持续显示保存状态、上次保存时间、保存与放弃操作；各工作区的独立保存按钮只在自己的表单有修改时启用。`view=browser` 可直接打开浏览器通知工作区。

### 8.2 权限请求

- 必须由用户点击「请求通知权限」触发，禁止自动弹出。
- 如果设置页在 iframe 中，优先由 iframe 直接调用 `Notification.requestPermission()`；如果浏览器限制子框架权限请求，则通过 `postMessage` 交给客户端主页面执行，再把结果返回 iframe。
- 权限被拒绝后，不反复弹窗；显示“请在浏览器站点设置中允许通知”。
- 测试通知使用固定内容，不进入 Host 事件总线。

### 8.3 模板实时预览

在 `ui.js` 中增加纯前端渲染：

```text
回复完成预览：回复完成 · 已完成会话列表修复
需要批准预览：需要批准 · Bash · 写入工作区文件
等待选择预览：等待选择 · 请选择部署环境
```

未知占位符标黄提示，但不阻止保存。

---

## 9. 安全、隐私与可靠性

### 9.1 数据范围

浏览器通知只发送：

- 会话标题
- 类型状态
- 短描述（模板渲染后的正文）
- 会话 ID（内部使用，不直接展示）

不发送：

- 完整回复正文
- 工具参数/命令内容
- 图片、附件、diff、代码块
- 设备密钥、渠道密钥

### 9.2 认证

- SSE 路由走 `ctx.connection.fetch`，继承现有浏览器 Cookie 认证、Host/Origin 检查和 owner Peer 限制。
- 只有当前已认证的 DSH 页面能建立 SSE 连接。
- 不建议增加独立的跨域开放接口。

### 9.3 性能

- 浏览器通知不进入 Bark 的串行队列，不占用推送重试预算。
- `BrowserNotifyHub` 使用内存环形缓冲；没有订阅者时直接丢弃事件。
- SSE 心跳每 20 秒；单浏览器通常只有一个连接。
- 模板渲染只在 Host 事件发生时做一次，不影响会话主流程。

### 9.4 失败处理

| 失败 | 行为 |
|---|---|
| SSE 断开 | EventSource 自动重连；事件缓冲区短暂补发 |
| 反向代理缓冲 | 设置 `X-Accel-Buffering: no`；必要时降级短轮询 |
| 浏览器权限拒绝 | 设置页显示拒绝状态，不阻塞其它功能 |
| 浏览器不支持 | 设置页显示不支持，隐藏/禁用开启按钮 |
| 通知构造失败 | 捕获异常，不影响 DSH 页面与 Bark 推送 |
| 多标签页 | leader 选举 + 广播去重，避免重复弹窗 |

---

## 10. 涉及文件与实现顺序

### 10.1 文件清单

| 文件 | 工作 |
|---|---|
| `lib/browser-notify.js` | 新增 BrowserNotifyHub、模板渲染、SSE 流管理 |
| `lib/config.js` | 新增 `browserNotify*` 字段、默认值、校验、`publicConfig` 输出 |
| `lib/events.js` | 在 reply / approval / question 三处事件桥接浏览器通知 |
| `lib/http.js` | 新增 `browser-events` 路由；状态 payload 带浏览器通知配置；静音接口支持 `channel` |
| `lib/state.js` | 新增 `browserMutedWorkspaces` / `browserMutedSessions` 及读写、迁移 |
| `lib/index.js` | 实例化 BrowserNotifyHub，接入生命周期 |
| `lib/client.js` | EventSource、权限、当前会话/前台判断、Notification 显示、点击打开会话 |
| `lib/ui.js` | Settings「通知」页顶部 Tab、概览、浏览器通知表单、模板预览与保存台账 |
| `package.json` | `dsh.client.inject` 增加 `@deepseek-ai/dsh-api-session-controller` |
| `test/browser-notify.test.js` | 新增 Hub、模板、SSE 测试 |
| `test/client.test.js` | 客户端通知与权限测试 |
| `test/events.test.js` | 浏览器事件桥接测试 |
| `test/http.test.js` | SSE 路由与状态配置测试 |
| `test/config.test.js` | 新配置字段校验测试 |

### 10.2 实现顺序

1. `config.js` 增加浏览器通知字段与模板校验（纯数据层）。
2. `state.js` 增加浏览器通知独立静音集合与迁移。
3. `browser-notify.js` 实现 Hub、模板渲染、静音判断、去重和 SSE 流。
4. `events.js` 接入三个事件源；`index.js` 生命周期。
5. `http.js` 注册 SSE 路由，扩展静音接口并接入 `runtime`。
6. `client.js` 实现 EventSource、权限、前台判断、Notification。
7. `ui.js` 实现 Settings 顶部 Tab、概览、浏览器通知表单、模板预览和保存台账。
8. 单元测试 + 临时 DSH Web 实例端到端验证 + 真实浏览器验证。

---

## 11. 测试计划

### 11.1 自动化测试

- `config.test.js`
  - 新字段默认值
  - `browserNotifyMaxBodyLength` 边界
  - 模板字段长度/非法值回退
- `browser-notify.test.js`
  - 回复/批准/选择三种事件生成正确字段
  - 模板 `{status}`、`{session}`、`{summary}`、`{tool}`、`{reason}`、`{question}`、`{questionCount}` 替换
  - 未知占位符保留
  - 空模板回退默认
  - 去重与环形缓冲
  - 浏览器通知关闭时无事件
  - Bark 配置关闭但浏览器通知开启时仍有事件
  - `browserNotifyUsePushMutes=true` 时复用推送静音
  - `browserNotifyUsePushMutes=false` 时使用独立浏览器静音集合
- `http.test.js`
  - `GET /api/bark-push/browser-events` 返回 `text/event-stream`
  - 状态接口包含浏览器通知配置
  - 未授权请求返回 401/403
- `events.test.js`
  - `turn/end completed` 产生回复浏览器事件
  - `approval/asked` 产生批准浏览器事件
  - `user-questions/request` 产生选择浏览器事件
  - 子代理默认不产生浏览器事件
  - Bark 类型开关关闭时浏览器通知仍产生
- `client.test.js`
  - 权限 granted / denied / unsupported
  - 当前会话 + 前台 + 开关开 → 不通知
  - 当前会话 + 后台 → 通知
  - 其他会话 + 前台 → 通知
  - 点击通知调用 `openSession`
  - 模板渲染后的正文显示

### 11.2 手工验证

1. Chrome / Edge 桌面：授权 → 测试通知 → 后台标签页收到回复通知。
2. 当前会话前台：确认不弹通知；关闭「前台免打扰」后能弹。
3. 审批：通知正文包含工具名和原因；点击后打开会话审批面板，手动允许/拒绝。
4. 选择：通知正文包含问题文本；点击后打开选择面板。
5. 权限拒绝：设置页显示拒绝；恢复权限后可再次测试。
6. 页面关闭/浏览器退出：确认不产生浏览器通知，Bark 推送不受影响。
7. 多标签页：确认只有一个标签页弹通知。
8. 反向代理 `dsh.asgardion.space:2096`：确认 SSE 不被缓冲；如果被缓冲，验证短轮询降级。
9. Firefox / Safari：确认文本通知和点击打开会话可用；不依赖 action buttons。
10. Settings「通知」顶部 Tab 在概览、推送渠道、通知规则、浏览器通知、静音管理之间切换，表单互不串写。
11. 默认复用推送静音：静音会话不再触发浏览器通知；关闭复用后，推送静音不影响浏览器通知，独立静音生效。

---

## 12. 已确认决策

1. **设置入口**：Settings 使用一个独立入口「通知」，顶部 Tab 切换概览、推送渠道、通知规则、浏览器通知与静音管理。
2. **静音语义**：通过 `browserNotifyUsePushMutes` 开关控制复用或独立；默认复用推送通知的工作区/会话静音。
3. **配置存储**：浏览器通知配置按 DSH profile 共享，保存在 `state.json`；不使用 localStorage 作为主存储。
4. **回复通知默认风格**：使用 `{status} · {summary}`，即 `回复完成 · <回复首行摘要>`。
5. **运行范围**：v1 只支持“DSH 页面打开时生效”；页面关闭、浏览器退出和移动端 Safari 页面通知不纳入；需要时使用 Bark 推送。

> 设计决策已全部确认，等待用户发出执行指令后开始修改代码。

---

## 13. 版本与交付

- 目标版本：`0.3.0`（新功能，非 patch）。
- 现有 Bark 推送行为保持不变。
- 执行授权后按第 10 节顺序实现，并补充 README / CHANGELOG / 设置页截图说明。
