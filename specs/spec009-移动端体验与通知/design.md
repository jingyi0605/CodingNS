# 设计文档 - spec009-移动端体验与通知

状态：Draft

## 1. 概述

### 1.1 目标

- 给移动端建立清晰的信息架构，让用户能快速查看与处理关键事项
- 打通会话查看与回复、文件/Git/进程轻操作、全屏终端与日志查看
- 定义通知与提醒策略，只提醒关键事件和人工介入事件
- 在不改前置核心协议的前提下，完成移动端交付

### 1.2 覆盖需求

- `requirements.md` 需求 1：移动端信息架构
- `requirements.md` 需求 2：会话查看与回复
- `requirements.md` 需求 3：文件 / Git / 进程轻操作
- `requirements.md` 需求 4：全屏终端与日志边界
- `requirements.md` 需求 5：通知与提醒策略
- `requirements.md` 需求 6：登录态保护
- `requirements.md` 需求 7：依赖前置 Spec 且不重复协议

### 1.3 技术约束

- 前置依赖：`spec003`（会话运行时）、`spec004`（文件上下文）、`spec005`（Git 上下文）、`spec007`（进程与启动器）、`spec008`（桌面端与 H5 交付）
- 前端技术：`React + TypeScript`（复用 `ui-web`）
- 客户端壳：`Tauri Mobile`（Android / iOS）
- 通信方式：`HTTP + WebSocket`（沿用前置 Spec，受保护接口默认鉴权）
- 数据边界：不新增会话原始消息存储，继续以 Host / provider 为唯一消息来源

## 2. 架构

### 2.1 系统结构

移动端采用“同一套后端能力 + 移动端专属交互层”的方式：

1. 移动端登录后，通过统一 API 获取工作区摘要与关键状态
2. 会话页复用 `spec003` 的消息运行时与能力门控
3. 文件/Git/进程页复用 `spec004/005/007` 能力，只保留轻操作入口
4. 终端与日志走全屏子页面，避免在小屏幕做多面板挤压
5. 通知服务订阅关键事件，写入应用内收件箱并按规则触发系统推送

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `mobile-shell` | 承载移动端生命周期、前后台切换、推送通道接入 | 系统生命周期事件 | 前后台状态、设备能力 |
| `mobile-navigation` | 维护移动端信息架构与页面跳转 | 用户点击、通知深链 | 页面路由状态 |
| `mobile-session-view` | 渲染会话消息与回复入口（复用 spec003 运行时） | 会话数据、能力描述 | 会话页面与发送动作 |
| `mobile-light-actions` | 聚合文件/Git/进程轻操作入口 | 工作区上下文、权限状态 | 轻操作执行请求 |
| `mobile-terminal-log` | 提供全屏终端与日志查看体验 | 终端流、日志流 | 全屏查看与受控输入 |
| `mobile-notification-center` | 处理通知规则、收件箱、已读状态 | 会话事件、进程事件、失败事件 | 系统通知、应用内收件箱 |
| `mobile-auth-guard` | 统一处理登录态校验与失效清理 | token、握手状态 | 放行或拦截 |

### 2.3 关键流程

#### 2.3.1 移动端首页与工作区流转

1. 用户登录后进入首页，拉取工作区摘要数据
2. 首页显示待处理会话、进程异常、最近工作区
3. 用户进入工作区后选择会话/文件/Git/进程 tab
4. 所有数据请求都经 `mobile-auth-guard` 校验

#### 2.3.2 会话查看与回复流程

1. 进入会话页时加载历史消息与能力描述
2. 建立 WebSocket 订阅并监听增量消息
3. 用户回复后显示发送状态（三态）
4. 弱网重连后按游标补齐消息并更新连接状态

#### 2.3.3 轻操作与全屏终端/日志流程

1. 用户从工作区页进入“文件/Git/进程轻操作”
2. 执行操作前展示最小影响确认（例如重启进程）
3. 需要看详情时跳转到全屏终端或全屏日志页
4. 手动输入命令需显式确认，不默认开放高风险输入

#### 2.3.4 通知触发与人工介入流程

1. 系统接收会话进展、进程状态、关键失败事件
2. `mobile-notification-center` 按规则判断事件级别
3. 高优先事件触发系统通知并附深链
4. 非高优先事件写入应用内收件箱
5. 用户点击通知进入对应页面处理，并更新已读状态

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7

- `MobileHomePage`：移动端首页，展示关键摘要
- `MobileWorkspacePage`：工作区级 tab 容器（会话/文件/Git/进程）
- `MobileConversationPage`：会话查看与回复页（复用 spec003）
- `MobileLightActionPanel`：轻操作入口面板
- `MobileTerminalPage`：全屏终端页
- `MobileLogPage`：全屏日志页
- `MobileNotificationInboxPage`：应用内通知收件箱
- `MobileAuthGuard`：移动端路由与请求鉴权守卫

### 3.2 数据结构

覆盖需求：1、3、4、5、6

#### 3.2.1 `MobileWorkspaceSummary`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `workspaceId` | string | 是 | 工作区 ID | 来自现有工作区模型 |
| `workspaceName` | string | 是 | 工作区名称 | 非空 |
| `pendingSessionCount` | number | 是 | 待处理会话数量 | >= 0 |
| `runningProcessCount` | number | 是 | 运行中进程数量 | >= 0 |
| `hasCriticalAlert` | boolean | 是 | 是否存在关键告警 | 布尔 |
| `updatedAt` | string | 是 | 最近更新时间 | ISO8601 |

#### 3.2.2 `MobileLightAction`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `actionId` | string | 是 | 操作 ID | 全局唯一 |
| `workspaceId` | string | 是 | 所属工作区 | 非空 |
| `actionType` | string | 是 | 操作类型 | `file-edit/git-commit/process-restart/...` |
| `targetRef` | string | 是 | 操作目标引用 | 非空 |
| `requiresConfirm` | boolean | 是 | 是否需确认 | 布尔 |
| `status` | string | 是 | 执行状态 | `ready/running/success/failed` |
| `errorCode` | string | 否 | 失败错误码 | 可空 |

#### 3.2.3 `MobileNotificationItem`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 通知 ID | 全局唯一 |
| `workspaceId` | string | 是 | 关联工作区 | 非空 |
| `eventType` | string | 是 | 事件类型 | `session-progress/process-alert/critical-failure/manual-action` |
| `priority` | string | 是 | 优先级 | `low/medium/high/critical` |
| `title` | string | 是 | 标题 | 非空 |
| `body` | string | 是 | 摘要内容 | 非空 |
| `deepLink` | string | 否 | 页面深链 | 可空 |
| `needIntervention` | boolean | 是 | 是否需要人工介入 | 布尔 |
| `read` | boolean | 是 | 已读状态 | 布尔 |
| `createdAt` | string | 是 | 创建时间 | ISO8601 |

### 3.3 接口契约

覆盖需求：1、2、3、4、5、6、7

说明：会话/文件/Git/进程核心接口和事件协议沿用前置 Spec，本 Spec 仅补移动端聚合与通知相关接口。

#### 3.3.1 `GET /api/mobile/workspaces/summary`

- 类型：HTTP
- 路径：`/api/mobile/workspaces/summary`
- 输入：Access Token、可选分页参数
- 输出：`MobileWorkspaceSummary[]`
- 校验：必须登录；仅返回当前用户有权限的工作区摘要
- 错误：`401 UNAUTHORIZED`、`500 INTERNAL_ERROR`

#### 3.3.2 `GET /api/mobile/workspaces/{workspaceId}/quick-actions`

- 类型：HTTP
- 路径：`/api/mobile/workspaces/{workspaceId}/quick-actions`
- 输入：`workspaceId`、Access Token
- 输出：`MobileLightAction[]`（只返回允许的轻操作）
- 校验：必须登录；`workspaceId` 必须存在
- 错误：`401 UNAUTHORIZED`、`404 WORKSPACE_NOT_FOUND`

#### 3.3.3 `POST /api/mobile/notifications/subscriptions`

- 类型：HTTP
- 路径：`/api/mobile/notifications/subscriptions`
- 输入：设备标识、推送通道信息、通知偏好、Access Token
- 输出：订阅结果（成功/失败）
- 校验：必须登录；设备标识与当前账号绑定
- 错误：`401 UNAUTHORIZED`、`400 INVALID_INPUT`

#### 3.3.4 `GET /api/mobile/notifications/inbox`

- 类型：HTTP
- 路径：`/api/mobile/notifications/inbox`
- 输入：分页参数、筛选参数、Access Token
- 输出：`MobileNotificationItem[]`
- 校验：必须登录；只返回当前账号通知
- 错误：`401 UNAUTHORIZED`

#### 3.3.5 `PATCH /api/mobile/notifications/{id}/read`

- 类型：HTTP
- 路径：`/api/mobile/notifications/{id}/read`
- 输入：通知 ID、已读状态、Access Token
- 输出：更新后的通知状态
- 校验：必须登录；通知归属必须匹配当前账号
- 错误：`401 UNAUTHORIZED`、`404 NOTIFICATION_NOT_FOUND`

## 4. 数据与状态模型

### 4.1 数据关系

- `MobileWorkspaceSummary` 由工作区、会话、进程状态聚合而来，不改变原始领域模型
- 移动端会话消息直接复用 `spec003` 会话运行时输出，不持久化另一套消息仓库
- 文件/Git/进程轻操作调用对应前置 Spec 能力，不在移动端定义新协议主字段
- 通知数据以 `workspaceId/sessionId/processId` 建立可追溯关联

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `AUTH_REQUIRED` | 需要登录 | 无 token 或 token 失效 | 登录成功 |
| `HOME_READY` | 首页可用 | 摘要加载成功 | 进入工作区或登出 |
| `WORKSPACE_READY` | 工作区轻操作页可用 | 工作区摘要和轻操作加载成功 | 进入子页面或返回首页 |
| `SYNC_RECONNECTING` | 会话实时重连中 | WS 断开且触发重连 | 重连成功或失败 |
| `NOTIFY_PENDING` | 有未处理通知 | 收到关键事件且未读 | 用户处理并标记已读 |
| `INTERVENTION_REQUIRED` | 需要人工介入 | 关键失败或审批事件到达 | 用户确认后回到常态 |

## 5. 错误处理

### 5.1 错误类型

- `AUTH_EXPIRED`：登录态过期或撤销
- `MOBILE_ACTION_NOT_ALLOWED`：移动端不允许的高风险操作
- `SYNC_UNAVAILABLE`：实时连接不可用
- `NOTIFICATION_DELIVERY_FAILED`：系统推送失败
- `RESOURCE_NOT_FOUND`：工作区、通知或目标资源不存在

### 5.2 错误响应格式

```json
{
  "detail": "当前登录状态已失效，请重新登录",
  "error_code": "AUTH_EXPIRED",
  "field": "accessToken",
  "timestamp": "2026-03-22T00:00:00Z"
}
```

### 5.3 处理策略

1. 鉴权错误：统一跳转登录并清理受保护缓存
2. 能力越界错误：提示“该操作需在桌面端完成”，不隐藏失败原因
3. 同步错误：进入可见重连状态并提供手动重试
4. 通知失败：先写入应用内收件箱，再异步补发系统通知

## 6. 正确性属性

### 6.1 属性 1：受保护数据不越权

*对于任何* 移动端受保护请求，系统都应该满足：未登录或令牌无效时，返回未授权且不泄露业务数据。

**验证需求：** 需求 6

### 6.2 属性 2：消息来源一致

*对于任何* 移动端会话展示，系统都应该满足：消息与桌面端来源一致，并可追溯到 Host / provider 返回链路。

**验证需求：** 需求 2、需求 7

### 6.3 属性 3：通知仅针对关键事件

*对于任何* 通知触发，系统都应该满足：能解释触发原因和优先级，且可区分是否需要人工介入。

**验证需求：** 需求 5

## 7. 测试策略

### 7.1 单元测试

- 通知规则判断与优先级分类
- 移动端轻操作权限检查与风险确认
- 登录态守卫与 token 失效处理

### 7.2 集成测试

- 会话查看与回复（含断线重连）
- 文件/Git/进程轻操作主链路
- 通知收件箱读写与已读状态同步

### 7.3 端到端测试

- 首页 -> 工作区 -> 会话回复 -> 返回首页
- 进程异常通知 -> 深链跳转 -> 人工处理 -> 已读回写
- 未登录访问受保护页面拦截

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.1、§2.2 | 移动端导航与首页走查 + E2E |
| `requirements.md` 需求 2 | `design.md` §2.3.2、§4.1 | 会话运行时集成测试 |
| `requirements.md` 需求 3 | `design.md` §2.3.3、§3.3 | 轻操作链路测试 |
| `requirements.md` 需求 4 | `design.md` §2.3.3、§5.3 | 全屏终端/日志可用性测试 |
| `requirements.md` 需求 5 | `design.md` §2.3.4、§3.2.3 | 通知规则与深链测试 |
| `requirements.md` 需求 6 | `design.md` §3.3、§6.1 | 鉴权拦截与 WS 握手测试 |
| `requirements.md` 需求 7 | `design.md` §1.3、§4.1 | 依赖一致性审查 |

## 8. 风险与待确认项

### 8.1 风险

- 移动端弱网下重连频繁，可能导致消息状态和通知状态抖动
- 轻操作边界如果不够严格，容易被误用成高风险操作入口
- 通知规则过松会造成噪音，过严会错过关键事件

### 8.2 待确认项

- iOS/Android 推送通道实现差异的最小兼容策略
- 移动端全屏终端手动输入的默认权限级别
- 通知“静默时段”与“强提醒事件”是否需要第一阶段就支持
