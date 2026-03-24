# 设计文档 - spec003.1 原生会话实时对话运行时

状态：Draft

## 1. 概述

### 1.1 目标

- 把当前“只会读写会话文件”的 provider 适配层升级成“真正可启动、可恢复、可流式推送”的运行时层。
- 保持现有会话发现、历史读取和工作区绑定能力可用，不推倒重来。
- 保证新建会话、继续旧会话、回到原生环境继续，这三件事使用同一套原生会话真相。

### 1.2 覆盖需求

- `requirements.md` 需求 1：系统必须能新建原生会话并立即开始实时对话
- `requirements.md` 需求 2：系统必须能接着已有的原生会话继续对话
- `requirements.md` 需求 3：在本项目中创建的会话必须还能回到原生环境继续
- `requirements.md` 需求 4：实时消息流必须和历史消息同步层保持同一个真相来源
- `requirements.md` 需求 5：运行中会话必须支持恢复订阅、中断和失败回传
- `requirements.md` 需求 6：Provider 参数映射必须清楚且可降级
- `requirements.md` 需求 7：系统必须保持工作区归属和安全边界不被破坏

### 1.3 技术约束

- 后端继续使用 `Node.js + TypeScript + Fastify + ws + better-sqlite3`
- 前端继续使用 `React + TypeScript + Vite`
- 现有 `SessionSyncService`、会话索引表、`user-app` 会话页和 WebSocket 通道必须尽量复用
- 不允许新建脱离原生 provider 的私有会话格式
- 参考实现来自 `C:\Code\CodingNS\data\claudecodeui`，但本项目要按自己的模块边界落地，不能把参考项目整坨搬进来

## 2. 架构

### 2.1 系统结构

这次改造后，会话能力拆成两层，别再混成一坨：

1. **会话发现/历史同步层**
   继续负责扫描 `Claude Code` / `Codex` 的原生会话、读取历史、维护索引和工作区归属。
2. **实时运行时层**
   新增，负责启动会话、恢复会话、发送消息、接收流式事件、处理中断和运行时错误。
3. **前端会话页**
   继续展示历史消息和实时消息，但消息来源改为“历史补偿 + 运行时事件”统一合并，而不是“假发送 + 文件轮询”。

简化后的数据流：

1. 用户从前端发起“新建会话”或“继续对话”
2. `SessionRuntimeService` 校验会话映射、工作区和用户归属
3. `ProviderRuntimeService` 选择具体 `Runtime Adapter`
4. Adapter 调用 Claude/Codex 的真实运行能力，产出流式事件
5. Host 归一化事件，广播到 WebSocket，同时按需要更新历史快照和状态表
6. 前端把实时事件和历史补偿合并成唯一消息流

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `SessionSyncService` | 发现原生会话、读取历史、同步索引 | 工作区路径、provider 会话引用 | 会话摘要、历史消息 |
| `ProviderRuntimeService` | 统一管理实时会话运行时 | 会话映射、发送参数、用户动作 | 运行时事件、运行状态 |
| `Runtime Adapter: Claude` | 调用 Claude 真实会话创建、恢复和流式执行 | 工作区、原生会话 ID、prompt、参数 | Claude 原始事件 |
| `Runtime Adapter: Codex` | 调用 Codex 真实线程创建、恢复和流式执行 | 工作区、原生会话 ID、prompt、参数 | Codex 原始事件 |
| `ActiveRunRegistry` | 维护当前运行中会话的内存注册表 | sessionId、providerSessionId、连接上下文 | 查询、恢复附着、中断入口 |
| `RuntimeEventNormalizer` | 把 provider 原始事件转成系统统一事件 | Claude/Codex 原始事件 | 统一消息、状态、错误事件 |
| `SessionRuntimeService` | 连接同步层和运行时层 | HTTP/WS 请求 | 会话详情、发送结果、WS 增量 |
| `RealtimeClient + SessionRuntimeStore` | 前端实时订阅、重连、合并显示 | WS 事件、历史分页、发送动作 | UI 状态、消息时间线 |

### 2.3 关键流程

#### 2.3.1 新建原生会话并发送首条消息

1. 前端调用 `POST /api/sessions/start-live`，提交工作区、provider 和首条消息。
2. Host 校验工作区归属和 provider 支持情况。
3. `ProviderRuntimeService` 调用对应 `Runtime Adapter`：
   - Claude：创建原生 session
   - Codex：创建原生 thread
4. Adapter 返回真实原生会话 ID，Host 立即持久化项目映射。
5. Adapter 开始执行首条消息并产生流式事件。
6. Host 把事件归一化后通过 WebSocket 推给前端。
7. 前端显示“发送中 -> AI 实时输出 -> 完成/失败”。

#### 2.3.2 继续已有原生会话

1. 用户打开一个已同步的会话页。
2. 前端加载历史消息和能力描述，并建立 WebSocket 订阅。
3. 用户再次发送消息时，Host 查出该会话绑定的 `providerSessionId`。
4. `Runtime Adapter` 使用 provider 的恢复能力，把消息送入该原生会话上下文。
5. 运行时事件持续推回，前端与历史消息统一合并。

#### 2.3.3 运行中会话重连附着

1. 某个会话正在运行时，前端刷新页面或 WebSocket 断线。
2. `ActiveRunRegistry` 仍保留该会话的运行时句柄。
3. 前端重连后重新订阅该会话。
4. Host 将订阅挂回同一个运行中会话，同时发送必要的补偿消息。
5. 如果 Host 已重启导致句柄丢失，则返回“当前运行状态不可恢复”，前端改为历史模式，不伪造仍在运行。

#### 2.3.4 中断和失败处理

1. 用户点击中断时，前端调用 `POST /api/sessions/{sessionId}/interrupt`。
2. Host 查找运行中句柄并转发给对应 Adapter。
3. Adapter 调用 provider 的中断能力。
4. Host 将中断成功、用户拒绝权限、工具失败、运行时异常等都转为结构化事件。
5. 前端基于事件更新头部状态、时间线和输入区可用性。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7

- `packages/session-sync-core/src/runtime/types.ts`
  定义统一运行时接口、运行中句柄、流式事件和参数映射。
- `packages/session-sync-core/src/runtime/provider-runtime-service.ts`
  统一调度各 provider 的实时运行时。
- `packages/session-sync-core/src/runtime/claude-runtime.ts`
  Claude 真实运行时适配器，优先走 SDK 能力。
- `packages/session-sync-core/src/runtime/codex-runtime.ts`
  Codex 真实运行时适配器，优先走 SDK 线程能力。
- `apps/host/src/modules/sessions/session-runtime-service.ts`
  扩展为既能读历史，也能驱动实时运行时。
- `apps/host/src/ws/ws-server.ts`
  扩展会话事件种类，支持运行状态、中断结果、错误和恢复附着。
- `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
  从“发一条 HTTP 消息”升级为“启动/继续一次真实运行”。

### 3.2 数据结构

覆盖需求：1、2、3、4、5、6、7

#### 3.2.1 `RuntimeSendOptions`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `content` | `string` | 是 | 用户发送的消息 | 不可为空 |
| `clientRequestId` | `string \| null` | 否 | 前端临时请求 ID | 用于对账 |
| `model` | `string \| null` | 否 | 目标模型 | 由 adapter 决定是否支持 |
| `reasoningLevel` | `string \| null` | 否 | 推理强度 | 仅在 provider 支持时生效 |
| `permissionMode` | `string \| null` | 否 | 权限模式 | 必须可映射到 provider 真实能力 |

#### 3.2.2 `RuntimeEvent`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `type` | `message \| status \| error \| session_created \| complete \| interrupted` | 是 | 事件类型 | 枚举 |
| `sessionId` | `string` | 是 | 项目内会话 ID | 不可为空 |
| `provider` | `claude-code \| codex` | 是 | provider 标识 | 枚举 |
| `providerSessionId` | `string` | 否 | 原生会话 ID | 新建成功后必须有值 |
| `message` | `NormalizedMessage \| null` | 否 | 归一化消息 | 消息类事件必填 |
| `status` | `string \| null` | 否 | 运行状态 | 例如 running、completed、interrupted |
| `detail` | `string \| null` | 否 | 错误或补充信息 | 人可读 |
| `rawEventRef` | `string \| null` | 否 | 原始事件引用 | 便于排查 |
| `timestamp` | `string` | 是 | 事件时间 | ISO8601 |

#### 3.2.3 `ActiveRunHandle`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `sessionId` | `string` | 是 | 项目内会话 ID | 唯一 |
| `provider` | `claude-code \| codex` | 是 | provider | 枚举 |
| `providerSessionId` | `string` | 是 | 原生会话 ID | 唯一绑定 |
| `workspaceId` | `string` | 是 | 工作区 ID | 不可为空 |
| `runningState` | `idle \| running \| completed \| failed \| interrupted` | 是 | 当前运行状态 | 枚举 |
| `attachedClients` | `number` | 是 | 当前已附着订阅数 | `>= 0` |
| `interrupt` | `() => Promise<void>` | 否 | 中断入口 | provider 支持时存在 |
| `dispose` | `() => Promise<void>` | 是 | 释放句柄 | 不可为空 |

### 3.3 接口契约

覆盖需求：1、2、3、5、6、7

#### 3.3.1 `POST /api/sessions/start-live`

- 类型：HTTP
- 输入：`workspaceId`、`provider`、首条消息、可选模型参数
- 输出：项目会话 ID、provider、原生会话 ID、已受理时间、首条用户消息
- 校验：工作区必须存在且属于当前用户；provider 必须受支持；首条消息不能为空
- 错误：`WORKSPACE_NOT_FOUND`、`PROVIDER_NOT_SUPPORTED`、`INVALID_INPUT`、`PROVIDER_RUNTIME_ERROR`

#### 3.3.2 `POST /api/sessions/{sessionId}/messages/live`

- 类型：HTTP
- 输入：会话 ID、消息内容、可选模型参数、`clientRequestId`
- 输出：已受理时间、当前原生会话 ID、用户消息确认信息
- 校验：会话必须存在、归属匹配、工作区绑定正确、provider 支持继续对话
- 错误：`SESSION_NOT_FOUND`、`SESSION_WORKSPACE_MISMATCH`、`CAPABILITY_NOT_SUPPORTED`、`PROVIDER_RUNTIME_ERROR`

#### 3.3.3 `POST /api/sessions/{sessionId}/interrupt`

- 类型：HTTP
- 输入：会话 ID
- 输出：中断请求是否受理
- 校验：会话必须在运行中，provider 必须支持中断
- 错误：`SESSION_NOT_RUNNING`、`CAPABILITY_NOT_SUPPORTED`、`PROVIDER_RUNTIME_ERROR`

#### 3.3.4 `GET /api/sessions/{sessionId}/runtime`

- 类型：HTTP
- 输入：会话 ID
- 输出：当前运行状态、是否存在活动句柄、是否可恢复附着、当前 provider 能力
- 校验：会话归属必须匹配
- 错误：`SESSION_NOT_FOUND`、`UNAUTHORIZED`

#### 3.3.5 `WS /ws`

- 类型：WebSocket
- 输入：现有 `session.subscribe`，扩展支持运行时事件
- 输出事件：
  - `session.subscribed`
  - `session.backfill`
  - `session.delta`
  - `session.runtime_status`
  - `session.runtime_error`
  - `session.interrupted`
- 校验：沿用现有鉴权，继续校验用户是否有权订阅目标会话
- 错误：`UNAUTHORIZED`、`SESSION_NOT_FOUND`、`WS_SUBSCRIBE_DENIED`

## 4. 数据与状态模型

### 4.1 数据关系

- `session_binding` 继续保存项目会话 ID 与原生 `providerSessionId` 的关系，这是跨页面、跨重启的稳定锚点。
- `session_index` 继续保存列表页和工作台需要的摘要信息。
- `session_status_snapshot` 扩展记录运行时状态，例如是否正在运行、最近一次运行结果、最近一次原生运行附着时间。
- `ActiveRunRegistry` 只保存内存态运行句柄，不写成第二套持久化真相。
- 历史消息仍以 provider 原生消息为准；实时事件只是历史的增量输入，不是另建消息仓。

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `idle` | 当前未运行 | 页面初始、运行完成后 | 用户再次发送消息 |
| `starting` | 正在创建或恢复原生会话 | 新建会话、继续会话开始 | 收到首个运行事件或失败 |
| `running` | provider 正在执行 | 收到首个 AI/工具/推理事件 | 完成、中断、失败 |
| `reconnecting` | 前端订阅丢失，尝试重新附着 | WS 断开重连 | 重新附着成功或失败 |
| `completed` | 一轮执行完成 | 收到完成事件 | 用户再次发送消息 |
| `interrupted` | 本轮被中断 | 用户中断成功 | 用户再次发送消息 |
| `failed` | 本轮执行失败 | provider 运行报错 | 用户重试或再次发送消息 |

## 5. 错误处理

### 5.1 错误类型

- `映射错误`：项目会话 ID 找不到、原生会话 ID 丢失、工作区绑定不一致
- `运行时错误`：provider SDK/CLI 启动失败、恢复失败、流式执行失败
- `能力错误`：请求了当前 provider 不支持的中断、模型参数或推理参数
- `恢复错误`：前端重连时，运行句柄已不存在或 Host 已重启
- `安全错误`：用户越权访问或尝试在错误工作区继续会话

### 5.2 错误响应格式

```json
{
  "detail": "当前会话无法继续，因为原生会话与工作区绑定不一致",
  "error_code": "SESSION_WORKSPACE_MISMATCH",
  "field": "sessionId",
  "timestamp": "2026-03-24T00:00:00Z"
}
```

### 5.3 处理策略

1. 映射错误：立即拒绝执行，不允许猜测或静默修正。
2. 运行时错误：返回结构化错误事件，同时更新会话状态为 `failed`。
3. 能力错误：前后端都做门控，前端不让误点，后端再兜底拒绝。
4. 恢复错误：明确告诉用户“当前运行不可恢复”，退回历史模式，不伪造运行中。

## 6. 正确性属性

### 6.1 属性 1：原生会话唯一性

*对于任何* 可继续对话的会话，系统都应该满足：项目内会话始终绑定一个真实存在的原生 `providerSessionId`，不会再派生第二个私有会话真相。

**验证需求：** 需求 1、需求 2、需求 3

### 6.2 属性 2：历史与实时一致性

*对于任何* 前端展示的消息，系统都应该满足：它要么来自 provider 历史读取，要么来自 provider 实时事件，两者最终收敛到同一个归一化消息模型。

**验证需求：** 需求 4

### 6.3 属性 3：恢复安全性

*对于任何* 会话恢复和继续对话请求，系统都应该满足：只有在用户归属、工作区归属和原生会话绑定都成立时才允许继续执行。

**验证需求：** 需求 2、需求 5、需求 7

### 6.4 属性 4：运行态可解释

*对于任何* 运行中的会话，系统都应该满足：前端能看到当前状态是启动中、运行中、完成、中断还是失败，不能出现“实际上死了，UI 还假装在线”。

**验证需求：** 需求 5

## 7. 测试策略

### 7.1 单元测试

- `Runtime Adapter` 参数映射测试
- `RuntimeEventNormalizer` 事件归一化和去重测试
- `ActiveRunRegistry` 附着、移除、中断测试
- 前端 `SessionRuntimeStore` 实时事件收敛测试

### 7.2 集成测试

- Claude 新建会话并流式返回
- Codex 恢复已有会话并继续执行
- WebSocket 重连后重新附着运行中会话
- 中断能力和失败事件回传

### 7.3 端到端测试

- 在本项目新建 `Claude Code` 会话，实时对话完成
- 在本项目新建 `Codex` 会话，实时对话完成
- 加载已有原生会话并继续发送消息
- 本项目创建的会话在原生环境中可继续

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` 2.3.1、3.3.1 | 集成测试 + E2E |
| `requirements.md` 需求 2 | `design.md` 2.3.2、4.1 | 集成测试 + E2E |
| `requirements.md` 需求 3 | `design.md` 2.1、4.1、6.1 | 原生会话回接验证 |
| `requirements.md` 需求 4 | `design.md` 2.1、3.2.2、6.2 | 事件去重测试 + 历史/实时合并测试 |
| `requirements.md` 需求 5 | `design.md` 2.3.3、5.3、6.4 | 运行时中断/重连测试 |
| `requirements.md` 需求 6 | `design.md` 3.2.1、3.3.2 | 参数映射测试 |
| `requirements.md` 需求 7 | `design.md` 3.3、5.1、6.3 | 权限与工作区校验测试 |

## 8. 风险与待确认项

### 8.1 风险

- 风险 1：Claude/Codex SDK 版本和本地安装环境可能不一致，导致“参考项目能跑，本项目一接就炸”。
- 风险 2：同一个会话如果外部原生工具和本项目同时操作，事件顺序和去重可能出现边角问题。
- 风险 3：Host 重启后活动运行句柄丢失，只能安全退化，做不到无损恢复。

### 8.2 待确认项

- 待确认 1：Claude 在本项目里最终采用纯 SDK，还是保留 CLI fallback。
- 待确认 2：Codex 在当前环境里优先走官方 SDK 还是 CLI/PTY 兼容层。
- 待确认 3：前端是否要把“启动会话并发送首条消息”做成一个单独入口，而不是复用当前 `start + send` 两段式调用。
