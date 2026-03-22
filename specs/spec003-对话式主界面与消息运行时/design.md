# 设计文档 - spec003 对话式主界面与消息运行时

状态：Draft

## 1. 概述

### 1.1 目标

- 把会话页做成对话主舞台，不做后台味拼盘
- 建立稳定的消息运行时，覆盖历史加载、实时更新、发送状态、断线重连
- 用统一能力门控处理不同 provider 的差异，杜绝散落式 provider 特判
- 把登录态保护接入页面和通信链路，确保受保护数据只在已登录态下可见

### 1.2 覆盖需求

- `requirements.md` 需求 1：主界面必须以对话为主舞台
- `requirements.md` 需求 2：页面行为必须由能力描述驱动
- `requirements.md` 需求 3：会话消息必须只有一个真相来源
- `requirements.md` 需求 4：所有受保护数据必须建立在已登录态之上
- `requirements.md` 需求 5：消息运行时必须支持实时更新和断线重连
- `requirements.md` 需求 6：输入区必须是复合操作面板

### 1.3 技术约束

- 后端基础约束（由 `spec001` / `spec002` 提供）：`Node.js 22 + TypeScript + Fastify + ws + better-sqlite3`
- 前端：`React + TypeScript + Vite`
- 状态：按领域拆分 store（会话运行时、鉴权态、UI 态）
- 通信：HTTP + WebSocket，受保护接口和受保护事件都要求登录态
- 数据边界：前端不持久化原始消息仓库，消息真相始终来自 Host / provider

## 2. 架构

### 2.1 系统结构

会话页按“主舞台 + 运行时 + 门控 + 鉴权”拆分：

1. 页面入口先通过 `Auth Guard` 判断登录态
2. 已登录后加载会话基础信息、能力描述和首屏消息
3. 消息运行时统一处理历史分页、实时增量、发送状态、重连状态
4. 输入区和会话头部只消费能力描述，不自行猜测 provider 行为
5. 连接异常时进入重连状态机，恢复后自动补齐消息

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `auth-guard` | 阻断未登录访问 | 当前 token、路由上下文 | 跳转登录 / 放行受保护页面 |
| `session-runtime-store` | 管理消息运行时状态 | 会话 ID、HTTP 结果、WS 事件 | 可渲染消息流、连接状态、发送状态 |
| `message-timeline` | 渲染消息列表与状态标识 | 消息视图模型 | 消息主舞台 UI |
| `composer-panel` | 输入和快捷操作面板 | 能力描述、发送状态 | 发送动作、交互反馈 |
| `capability-gate` | 功能门控与降级提示 | provider/session 能力描述 | 按钮可用性和提示文案 |
| `session-header` | 会话头部状态区 | 会话元数据、能力摘要、连接状态 | 会话标题、状态标签、能力提示 |
| `realtime-client` | WS 订阅与重连控制 | token、订阅目标、重连策略 | 实时消息事件、重连状态事件 |

### 2.3 关键流程

#### 2.3.1 页面进入与鉴权流程

1. 路由进入会话页，先执行 `auth-guard`
2. 无 token 或 token 失效时，跳转登录页并停止会话数据请求
3. 登录成功后，拉取会话详情、能力描述、首屏历史消息
4. 初始化 WebSocket 连接并订阅会话事件

#### 2.3.2 消息加载与实时增量流程

1. 页面首次加载历史消息（分页）
2. 按消息序列和时间戳生成稳定渲染列表
3. WebSocket 收到增量事件时进入合并管线
4. 去重后写入运行时状态并更新消息视图
5. 出现序列缺口时触发补偿拉取

#### 2.3.3 发送消息与状态反馈流程

1. 用户在输入区提交消息
2. 前端创建临时发送项并显示“发送中”
3. Host 确认后将临时项替换为正式消息
4. 发送失败时更新为失败态并提供重试入口

#### 2.3.4 断线重连流程

1. WS 断开时切换为 `RECONNECTING`
2. 按退避策略重连并重新订阅会话
3. 重连成功后基于最后游标补齐缺失消息
4. 连续失败达到阈值时切换为 `RECONNECT_FAILED` 并提示手动重试

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6

- `ConversationPage`：页面容器，拼装头部、消息区、输入区
- `SessionHeader`：显示会话标题、连接状态、能力摘要
- `MessageTimeline`：渲染消息主舞台和分页加载
- `ComposerPanel`：承载输入、发送和能力相关快捷入口
- `CapabilityGate`：统一能力门控组件，不允许页面散落 provider 特判
- `SessionRuntimeStore`：统一管理消息和连接状态机

### 3.2 数据结构

覆盖需求：2、3、5、6

#### 3.2.1 `SessionMessageViewModel`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | 系统消息 ID | 全局唯一 |
| `sessionId` | `string` | 是 | 所属会话 ID | 不可为空 |
| `role` | `user \| assistant \| system \| tool` | 是 | 消息角色 | 枚举值 |
| `content` | `string` | 是 | 消息内容 | 支持空字符串但需保留占位 |
| `timestamp` | `string` | 是 | 消息时间 | ISO8601 |
| `sequence` | `number` | 是 | 消息序号 | 单会话内递增 |
| `rawRef` | `string` | 是 | provider 原始引用 | 不可为空 |
| `deliveryState` | `sending \| sent \| failed` | 是 | 发送状态 | 前端暂态 |

#### 3.2.2 `ProviderCapabilities`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `provider` | `string` | 是 | provider 标识 | 与会话一致 |
| `sessionId` | `string` | 否 | 会话级能力作用域 | 会话级可为空 |
| `canStartSession` | `boolean` | 是 | 是否可新建会话 | 布尔值 |
| `canResumeSession` | `boolean` | 是 | 是否可续接会话 | 布尔值 |
| `supportsSubagents` | `boolean` | 是 | 是否支持 subagent | 布尔值 |
| `supportsInterrupt` | `boolean` | 是 | 是否支持中断 | 布尔值 |
| `supportsStructuredToolCalls` | `boolean` | 是 | 是否支持结构化工具调用 | 布尔值 |
| `supportsAttachments` | `boolean` | 是 | 是否支持附件 | 布尔值 |
| `limitations` | `string[]` | 否 | 能力限制说明 | 可为空数组 |

#### 3.2.3 `SessionRuntimeState`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `connectionState` | `connected \| reconnecting \| reconnect_failed \| closed` | 是 | 连接状态 | 枚举值 |
| `historyState` | `idle \| loading \| ready \| error` | 是 | 历史加载状态 | 枚举值 |
| `sendQueueSize` | `number` | 是 | 待确认发送队列数量 | >= 0 |
| `lastSyncedSequence` | `number` | 否 | 最近同步序号 | 缺失时为 null |
| `errorCode` | `string` | 否 | 最近错误码 | 可空 |

### 3.3 接口契约

覆盖需求：2、3、4、5、6

#### 3.3.1 `GET /api/sessions/{sessionId}`

- 类型：HTTP
- 输入：`sessionId` 路径参数 + 登录态
- 输出：会话基础信息、会话标题、provider 信息
- 校验：未登录返回 401；会话不存在返回 404
- 错误：`UNAUTHORIZED`、`SESSION_NOT_FOUND`

#### 3.3.2 `GET /api/sessions/{sessionId}/messages?cursor=<cursor>&limit=<n>`

- 类型：HTTP
- 输入：`sessionId`、分页参数 + 登录态
- 输出：消息列表、下一页游标、是否还有更多
- 校验：`limit` 必须在允许范围内
- 错误：`UNAUTHORIZED`、`INVALID_CURSOR`

#### 3.3.3 `GET /api/providers/{provider}/capabilities?sessionId=<sessionId>`

- 类型：HTTP
- 输入：provider、可选 `sessionId` + 登录态
- 输出：`ProviderCapabilities`
- 校验：provider 不支持时返回可理解错误码
- 错误：`UNAUTHORIZED`、`PROVIDER_NOT_SUPPORTED`

#### 3.3.4 `POST /api/sessions/{sessionId}/messages`

- 类型：HTTP
- 输入：消息文本、可选上下文动作 + 登录态
- 输出：受理结果（含临时消息关联 ID 或确认 ID）
- 校验：空消息、超长消息需拒绝
- 错误：`UNAUTHORIZED`、`VALIDATION_ERROR`、`CAPABILITY_NOT_SUPPORTED`

#### 3.3.5 `WS /ws`（订阅会话事件）

- 类型：WebSocket
- 输入：token + 会话订阅请求
- 输出事件：`session.message`、`session.status`
- 校验：未认证连接直接拒绝；无权限订阅返回错误事件并断开
- 错误：`WS_UNAUTHORIZED`、`WS_SUBSCRIBE_DENIED`

## 4. 数据与状态模型

### 4.1 数据关系

- 会话页只消费 Host 输出的会话数据和能力描述
- 消息渲染列表由“历史分页 + WS 增量”合并生成
- 消息项必须保留 `rawRef`，用于追溯 provider 原始消息
- 前端不做消息长期持久化，不产生“前端私有聊天数据库”

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `INIT` | 页面初始化 | 进入会话路由 | 鉴权通过或失败 |
| `AUTH_REQUIRED` | 需要登录 | 无 token / token 无效 | 登录成功 |
| `LOADING_HISTORY` | 加载历史 | 鉴权通过，开始拉历史 | 首屏消息完成或失败 |
| `READY` | 可交互 | 历史可用且订阅正常 | 连接断开或会话关闭 |
| `RECONNECTING` | 自动重连中 | WS 中断 | 重连成功或失败阈值 |
| `RECONNECT_FAILED` | 重连失败 | 达到重连阈值 | 用户手动重试成功 |
| `ERROR` | 错误态 | 接口或运行时不可恢复错误 | 用户重试或离开页面 |

## 5. 错误处理

### 5.1 错误类型

- `鉴权错误`：未登录、token 过期、无权限订阅
- `能力错误`：请求了当前会话不支持的操作
- `同步错误`：消息序号缺口、增量合并失败
- `连接错误`：WebSocket 断线、重连失败
- `输入错误`：空消息、超长消息、非法参数

### 5.2 错误响应格式

```json
{
  "detail": "当前会话不支持该操作",
  "error_code": "CAPABILITY_NOT_SUPPORTED",
  "field": "action",
  "timestamp": "2026-03-22T00:00:00Z"
}
```

### 5.3 处理策略

1. 输入验证错误：输入区内联提示，不打断整页状态。
2. 鉴权错误：清理受保护数据并跳转登录，不保留脏状态。
3. 能力错误：禁止继续提交该动作，同时展示能力限制说明。
4. 同步与连接错误：先自动重连和补偿拉取，失败后给手动重试入口。

## 6. 正确性属性

### 6.1 属性 1：消息来源一致性

*对于任何* 已展示消息，系统都应该满足：消息可追溯到 Host / provider 返回的原始引用，不来自前端自造持久记录。

**验证需求：** 需求 3

### 6.2 属性 2：能力门控一致性

*对于任何* 会话动作入口，系统都应该满足：其可用状态由 `Capability Descriptor` 决定，而不是 provider 名字硬编码判断。

**验证需求：** 需求 2、需求 6

### 6.3 属性 3：受保护数据访问安全性

*对于任何* 受保护接口或会话订阅，系统都应该满足：无有效登录态时无法访问任何受保护数据。

**验证需求：** 需求 4

### 6.4 属性 4：重连后的消息连续性

*对于任何* 断线恢复场景，系统都应该满足：重连后消息序列连续，不丢失已确认消息。

**验证需求：** 需求 5

## 7. 测试策略

### 7.1 单元测试

- `capability-gate` 的可见性和禁用策略
- `session-runtime-store` 的状态机流转和消息合并逻辑
- `composer-panel` 的发送状态流转

### 7.2 集成测试

- 鉴权拦截 + 会话加载联动
- 历史分页 + WS 增量合并
- 能力描述变化后 UI 门控刷新

### 7.3 端到端测试

- 已登录用户进入会话页、续接、发送消息、收到实时回复
- 断网重连后自动恢复订阅并补齐消息
- 未登录访问会话页被拦截到登录流程

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.1、§3.1 | 页面结构检查 + UI 集成测试 |
| `requirements.md` 需求 2 | `design.md` §2.2、§3.2、§3.3 | 能力门控单元测试 + 集成测试 |
| `requirements.md` 需求 3 | `design.md` §3.2、§4.1、§6.1 | 消息追溯检查 + 运行时日志验证 |
| `requirements.md` 需求 4 | `design.md` §2.3.1、§3.3、§6.3 | 鉴权 E2E + 未登录拦截测试 |
| `requirements.md` 需求 5 | `design.md` §2.3.4、§4.2、§6.4 | 网络抖动场景集成测试 |
| `requirements.md` 需求 6 | `design.md` §3.1、§3.2、§5.3 | 输入区交互测试 + 能力限制测试 |

## 8. 风险与待确认项

### 8.1 风险

- 风险 1：后端能力描述不稳定会导致前端门控频繁变化，用户感知混乱。
- 风险 2：弱网下重连策略不当会造成重复消息或漏消息。
- 风险 3：输入区复合操作过多可能挤占主输入体验。

### 8.2 待确认项

- 待确认 1：`session.status` 事件的最小字段集是否在 `spec002` 已冻结。
- 待确认 2：移动端会话头部可展示的能力标签数量上限。
- 待确认 3：重连阈值和退避参数的默认值由前端配置还是后端下发。
