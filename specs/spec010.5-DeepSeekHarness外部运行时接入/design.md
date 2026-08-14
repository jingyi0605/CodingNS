# 设计文档 - DeepSeek Harness 外部运行时接入

状态：Completed

## 1. 概述

### 1.1 目标

- 在 CodingNS Host 内启动一个只监听 `127.0.0.1` 的 Harness Web sidecar。
- 用一个隔离的适配层把 Harness 的 HTTP JSON-RPC 和 WebSocket 事件转换成 CodingNS 现有 Provider、Runtime、History 和权限模型。
- 保证 Harness 不可用、协议变更或事件断线时，其他 CodingNS Provider 继续正常工作。
- 对 Harness 不支持的 CodingNS 能力返回明确的能力状态或不支持错误。

### 1.2 覆盖需求

- `requirements.md` 需求 1：本机 Sidecar 安全启动
- `requirements.md` 需求 2：会话主链路兼容
- `requirements.md` 需求 3：实时事件和断线恢复
- `requirements.md` 需求 4：工具、权限和附件能力
- `requirements.md` 需求 5：工作区、用户和权限隔离
- `requirements.md` 需求 6：能力矩阵和降级语义
- `requirements.md` 需求 7：外部依赖故障和可观测性

### 1.3 技术约束

- 后端：CodingNS Host、Fastify、现有 `session-sync-core`、Provider/Runtime 服务。
- 外部运行时：DeepSeek Harness Web，使用固定版本，不直接依赖 Harness 源码内部模块。
- 通信：HTTP JSON-RPC `POST /api/<method>`、HTTP `POST /api/respond`、下行 WebSocket `/api/events.mux` 和 `/api/events.host`。
- 数据存储：优先复用 CodingNS 现有会话索引和运行时持久化；不复制 Harness 的完整日志作为第二份权威数据源。
- 认证授权：所有用户请求先经过 CodingNS 现有认证和 workspace 权限；sidecar 只接受 loopback 流量，不承担用户认证。
- 后台任务：sidecar 健康检查、外部会话恢复和需要跨请求复用的刷新必须接入现有 `TaskManager`，不新增私有全局 timer、inflight Map 或重试队列。
- 外部依赖：Harness CLI/Node 运行环境、Harness 自身模型和工具配置。

## 2. 架构

### 2.1 系统结构

```text
CodingNS 用户请求
        │
        ▼
CodingNS Host（认证、用户隔离、工作区边界、对外 REST/WS）
        │
        ├─ DeepSeekHarnessProviderAdapter
        │    ├─ DeepSeekHarnessApiClient（HTTP JSON-RPC）
        │    ├─ DeepSeekHarnessEventBridge（两个下行 WebSocket）
        │    └─ DeepSeekHarnessSessionBindingStore
        │
        ├─ 现有 SessionHistoryService / SessionLiveRuntimeService
        ├─ 现有 ProviderRegistry / ProviderRuntimeService
        └─ 现有 TaskManager
        │
        ▼
127.0.0.1:<动态端口> DeepSeek Harness Web sidecar
```

Harness 在 CodingNS 中以 `deepseek-harness` Provider 路由出现，但这个名称表示“外部 Agent Runtime”，不表示 Harness 内部的模型 Provider。Harness 内部使用的模型、工具和 Agent 组合仍由 Harness 自己管理。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `DeepSeekHarnessSidecarManager` | 按需启动、健康检查、关闭和记录 sidecar | 版本、端口、工作目录、进程配置 | sidecar URL、PID、版本、状态 |
| `DeepSeekHarnessApiClient` | 发送 JSON-RPC、校验 envelope、映射传输错误 | RPC 方法、payload、AbortSignal | 业务结果或分类错误 |
| `DeepSeekHarnessEventBridge` | 维护 mux/host 下行 WebSocket，分发事件并触发恢复 | session id、事件帧、连接状态 | CodingNS 运行时事件、恢复任务 |
| `DeepSeekHarnessProviderAdapter` | 实现 ProviderAdapter 的发现、历史、标题、发送、Fork 和能力声明 | CodingNS session binding、Provider 请求 | `NormalizedMessage`、Provider 结果 |
| `DeepSeekHarnessRuntimeAdapter` | 实现实时运行、继续运行、中断和运行中输入 | `ProviderRuntimeRunRequest` | `RuntimeEvent`、interrupt handle |
| `DeepSeekHarnessSessionBindingStore` | 管理用户、工作区、CodingNS session 与 Harness session 的一对一关系 | session id、workspace id、Harness id | 绑定记录和访问校验 |
| `DeepSeekHarnessMessageMapper` | 把 Harness SessionEvent 转成 CodingNS 标准消息和状态 | 原始事件、事件 seq | `NormalizedMessage`、RuntimeEventInput |
| `DeepSeekHarnessCapabilityMapper` | 生成 ProviderCapabilities 和限制说明 | Harness 版本、可用 RPC、配置 | 能力快照 |

### 2.3 关键流程

#### 2.3.1 创建并发送首条消息

1. CodingNS 收到 `/api/sessions/start-live`，验证用户、workspace 和 Provider 能力。
2. `DeepSeekHarnessSidecarManager.ensureReady()` 返回本机 sidecar 地址；若未启动则通过 Host 进程管理器启动。
3. `DeepSeekHarnessSessionBindingStore` 根据 workspace id 得到规范路径，不接受请求体中的任意 cwd。
4. `DeepSeekHarnessApiClient` 调用 `session.create`，保存 Harness session id 和 CodingNS binding。
5. 适配器调用 `session.prompt` 发送首条消息。
6. `DeepSeekHarnessEventBridge` 将 Harness 事件转换后交给现有 `SessionLiveRuntimeService`。
7. CodingNS 继续使用现有 REST 响应和 `/ws` 订阅协议向前端返回结果。

#### 2.3.2 普通历史读取

1. CodingNS 读取已授权的 binding。
2. 适配器把 CodingNS cursor 转换为 Harness `beforeSeq` 和 `maxMessages`。
3. 调用 `session.history`，取得 `HistoryEntry[]`。
4. `DeepSeekHarnessMessageMapper` 只把可表达为 `NormalizedMessage` 的事件写入 CodingNS history page。
5. 原始 Harness event type、seq 和 sidecar instance id 写入 `rawRef` 或诊断元数据。

#### 2.3.3 WebSocket 断线恢复

1. `DeepSeekHarnessEventBridge` 发现 mux 或 host socket 关闭，先标记连接为 degraded。
2. 通过 `TaskManager` 以 `harness.session.reconcile` 和 `harness.sidecar.health` 的稳定 task key 合并重复恢复请求。
3. 读取每个受影响会话的最后 Harness seq，调用 `session.history` 获取缺口。
4. 按 seq、事件类型、事件原始引用去重，再交给 CodingNS runtime/history 广播。
5. 历史补齐成功后重新建立下行 WebSocket，并重放当前 pending approval/question/queue 快照。
6. 恢复失败时保留最近成功快照，向用户报告运行时降级，不删除 session binding。

#### 2.3.4 权限回复

1. Harness mux 推送 `approval/requested` 或 `question/requested`。
2. EventBridge 创建 CodingNS permission request，保存 Harness server-request rpcId 与业务 request id 的映射。
3. 用户调用 CodingNS 既有权限回复接口。
4. 适配器构造 `client-response` envelope，通过 `POST /api/respond` 回传原 rpcId。
5. Harness 返回 accepted 或 not-pending 后，CodingNS 清理映射并推送最终状态。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7

- `DeepSeekHarnessSidecarManager`：只管理 CodingNS 自己启动的 sidecar，不扫描或接管用户手工进程。
- `DeepSeekHarnessApiClient`：只暴露经过 DTO 校验的最小方法，不把 Harness 内部 TypeScript 类型泄漏到通用模块。
- `DeepSeekHarnessEventBridge`：每个 sidecar 实例最多维护一组 mux/host 订阅，再按 session id 分发。
- `DeepSeekHarnessProviderAdapter`：接入现有 `ProviderRegistry`，明确实现和拒绝每个 ProviderAdapter 方法。
- `DeepSeekHarnessRuntimeAdapter`：接入现有 `ProviderRuntimeService`，把 Harness 的异步 Agent 运行转换为 CodingNS 运行状态。
- `DeepSeekHarnessMessageMapper`：处理消息、工具、状态、usage 和未知事件，未知事件不能直接当普通文本显示。

### 3.2 数据结构

#### 3.2.1 `DeepSeekHarnessSidecarState`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `instanceId` | `string` | 是 | CodingNS 为本次 sidecar 生成的实例标识 | 进程生命周期内唯一 |
| `status` | `stopped \| starting \| ready \| degraded \| stopping \| failed` | 是 | sidecar 当前状态 | 状态转换必须合法 |
| `pid` | `number \| null` | 否 | 仅记录 CodingNS 自己启动的 PID | 退出后清空 |
| `baseUrl` | `string \| null` | 否 | `http://127.0.0.1:<port>` | 禁止非 loopback |
| `harnessVersion` | `string \| null` | 否 | sidecar 实际版本 | 健康检查后写入 |
| `startedAt` | `string \| null` | 否 | 启动时间 | ISO 时间 |
| `lastError` | `string \| null` | 否 | 最近一次启动、协议或连接错误 | 不含密钥和完整路径 |

#### 3.2.2 `DeepSeekHarnessSessionBinding`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `codingnsSessionId` | `string` | 是 | CodingNS 会话 id | 唯一 |
| `harnessSessionId` | `string` | 是 | Harness 会话 id | 在同一 sidecar 实例内唯一 |
| `userId` | `string` | 是 | 所属用户 | 每次访问都校验 |
| `workspaceId` | `string` | 是 | CodingNS 工作区 id | 必须能解析为当前用户可访问工作区 |
| `workspacePath` | `string` | 是 | 规范化后的工作区路径 | 禁止通过请求覆盖 |
| `rawStoreRef` | `string` | 是 | 外部日志引用 | 格式为 `harness://<instanceId>/<sessionId>` |
| `harnessVersion` | `string` | 是 | 创建或最近恢复时的版本 | 用于兼容性诊断 |
| `lastEventSeq` | `number` | 是 | 最近成功处理的 Harness event seq | 单调递增 |
| `status` | `idle \| running \| interrupted \| failed \| unavailable` | 是 | CodingNS 侧投影状态 | 不替代 Harness 原始状态 |

优先复用 CodingNS 现有会话索引保存 `provider`、`providerSessionId` 和 `rawStoreRef`。只有现有索引无法保存用户、工作区或版本绑定时，才增加最小迁移，不复制 Harness 完整事件日志。

#### 3.2.3 `DeepSeekHarnessEventCursor`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `sessionId` | `string` | 是 | CodingNS session id | 必须存在 binding |
| `lastSeq` | `number` | 是 | 已处理的 Harness seq | 初始值为 `-1` |
| `lastMessageId` | `string \| null` | 否 | 最近转换消息 id | 只用于辅助去重 |
| `connectionEpoch` | `number` | 是 | WebSocket 连接代次 | 重连时递增 |

#### 3.2.4 `DeepSeekHarnessCapabilitySnapshot`

能力快照转换为现有 `ProviderCapabilities`，至少固定以下语义：

| CodingNS 能力 | 首版值 | 说明 |
| --- | --- | --- |
| `canStartSession` | `true` | `session.create` 可用时开启 |
| `canResumeSession` | `false` | Web API 没有独立 resume RPC，首版不伪造 |
| `canSendMessage` | `true` | `session.prompt` 可用时开启 |
| `inRunInputMode` | `queued_guidance` | queue/steer 可映射，暂不声明 streaming guidance |
| `supportsSubagents` | `true` | 以 subagent RPC 和事件契约测试为准 |
| `supportsInterrupt` | `true` | `session.cancel` |
| `supportsStructuredToolCalls` | `true` | tool/call 与 tool/result |
| `supportsTokenUsage` | `false` | 首版不依赖事件中不稳定的 usage 字段 |
| `supportsAttachments` | `true` | 受图片大小和模型能力限制 |
| `supportsPermissionPrompt` | `true` | approval/question + respond |
| `supportsSessionFork` | `true` | 仅已完成 turn 的 Fork |
| `supportsSessionDelete` | `false` | Harness Web API 无公开删除接口 |
| `supportsSessionDiff` | `false` | 无 changed-files/diff 接口 |
| `supportsSessionShare` | `false` | 无分享接口 |
| `supportsAsyncPrompt` | `true` | prompt 返回 accepted，结果由事件流提供 |

### 3.3 接口契约

#### 3.3.1 `DeepSeekHarnessApiClient.call`

- 类型：HTTP JSON-RPC
- 路径：`POST /api/<method>`
- 输入：`{ type: "client-request", rpcId, method, payload }`
- 输出：`{ type: "server-response", rpcId, result }`
- 校验：请求和响应必须校验 type、rpcId、method、payload；响应 rpcId 必须等于请求 rpcId。
- 错误：HTTP carrier 错误、协议错误、业务 `result.ok=false` 分开处理。
- 关键方法：`session.list/search/create/history/prompt/cancel/updateQueue/fork/rename/models/selectModel/attachment`、`subagent.*`、`workspace.archiveSession`、`respond`。

#### 3.3.2 `DeepSeekHarnessEventBridge.subscribe`

- 类型：下行 WebSocket
- 路径：`GET /api/events.mux`、`GET /api/events.host`
- 输入：只建立连接；客户端不得向 socket 发送业务消息。
- 输出：`server-request` envelope，mux 载荷包含 `session/event`、approval、question、queue 等帧，host 载荷包含 session status 和 agent error。
- 校验：解析 envelope 后再解析具体 frame；未知 frame 不得阻塞后续 frame。
- 错误：连接关闭、malformed frame、stream error、恢复失败。

#### 3.3.3 `DeepSeekHarnessSessionBindingStore.resolve`

- 类型：内部 Function
- 输入：`userId`、`codingnsSessionId` 或 `harnessSessionId`、请求来源。
- 输出：经过用户和 workspace 校验的 `DeepSeekHarnessSessionBinding`。
- 校验：一对一关系、workspace 路径边界、sidecar instance 归属、会话状态。
- 错误：`SESSION_NOT_FOUND`、`WORKSPACE_FORBIDDEN`、`HARNESS_SESSION_BINDING_CONFLICT`。

#### 3.3.4 `DeepSeekHarnessCapabilityMapper.snapshot`

- 类型：内部 Function
- 输入：sidecar 版本、RPC 可用性、运行配置。
- 输出：CodingNS `ProviderCapabilities`。
- 校验：不支持的能力必须为 false，并写入限制说明。
- 错误：版本不在允许范围时返回 `HARNESS_VERSION_UNSUPPORTED`，不开放 Provider。

#### 3.3.5 现有 CodingNS 路由兼容面

适配器不新增一套前端专用协议，优先接入现有路由：

| CodingNS 入口 | Harness 调用 |
| --- | --- |
| `/api/sessions/start-live` | `session.create` + `session.prompt` |
| `/api/sessions/:id/messages` | `session.prompt` |
| `/api/sessions/:id/messages/live` | `session.prompt` + EventBridge |
| `/api/sessions/:id/queue` | `session.prompt(mode=queue)` |
| `/api/sessions/:id/interrupt` | `session.cancel` |
| `/api/sessions/:id/messages` GET/历史服务 | `session.history` |
| `/api/sessions/:id/forks` | `session.fork`，仅支持完成 turn 语义 |
| `/api/sessions/:id/permission-requests/:requestId/reply` | `/api/respond` |
| `/api/sessions/:id/attachments/...` | `session.attachment` |
| `/ws` 的 session subscribe | 由 EventBridge 转成 CodingNS `session.*` envelope |

### 3.4 ProviderAdapter 与 RuntimeAdapter 约束

- `DeepSeekHarnessProviderAdapter` 使用 `providerId = "deepseek-harness"`。
- Harness session id 存入 `providerSessionId`，`rawStoreRef` 只存外部引用，不把 Harness JSONL/SQLite 路径暴露给 CodingNS。
- `detectSessions` 通过 `session.list` 后按 workspacePath 过滤，不允许把 Harness 全局会话直接并入用户列表。
- `readSessionHistory` 将 CodingNS cursor 映射为 Harness `beforeSeq`；forward 读取通过本地已知 seq 重组，不能假设 Harness 支持相同 cursor。
- `resumeSession` 首版实现为能力拒绝，或只做已绑定会话的重新校验；不得把“能读历史”冒充“已恢复 Agent”。
- `deleteSession`、收藏、Diff 和分享保持不支持状态。
- `DeepSeekHarnessRuntimeAdapter` 只负责实时执行和事件桥接；不要在适配器内部新增第二套消息持久化、私有队列或全局重试器。

## 4. 数据与状态模型

### 4.1 数据关系

```text
User 1 ── * Workspace
Workspace 1 ── * CodingNS Session
CodingNS Session 1 ── 1 Harness Session
Sidecar Instance 1 ── * Harness Session
Harness Session 1 ── * Harness Event(seq)
```

CodingNS session binding 是访问控制入口；Harness session 是 Agent 执行和原始事件的权威源；CodingNS history/runtime 是面向现有产品接口的投影。任何一方异常都不能悄悄覆盖另一方的身份关系。

### 4.2 状态流转

#### 4.2.1 Sidecar 状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `stopped` | 未启动 | Host 初始化或上次退出 | 首次请求触发启动 |
| `starting` | 正在拉起并等待 API | spawn 成功 | 健康检查成功或超时 |
| `ready` | 可接受 RPC 和事件订阅 | `host.describe` 或等价健康检查通过 | 进程退出、协议失败 |
| `degraded` | 进程还在但事件/RPC 不完整 | socket 断线、恢复失败 | 恢复成功或进程退出 |
| `stopping` | CodingNS 正在关闭 sidecar | Host shutdown | 进程退出 |
| `failed` | 启动或协议不兼容 | 启动失败、版本拒绝 | 明确重启请求 |

#### 4.2.2 会话运行状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `idle` | 已绑定但没有运行 | 创建成功或完成 | 发送 prompt |
| `running` | Harness 正在执行 Agent turn | 收到 running/turn start | completed、interrupted、failed |
| `interrupted` | 被用户或外部中断 | `session.cancel` 成功或事件确认 | 新 prompt |
| `failed` | Harness 执行失败 | agent error 或 runtime error | 明确恢复或新运行 |
| `unavailable` | sidecar 或 binding 暂不可用 | sidecar 退出、恢复失败 | sidecar ready 且重新校验成功 |

### 4.3 事件转换规则

| Harness 事件 | CodingNS 结果 | 规则 |
| --- | --- | --- |
| `user/message` | user message | 保留原始 seq 和 rpcId 来源 |
| `assistant/message` | assistant message | 提取文本、thinking 和可识别 usage |
| `tool/call` | tool_call | `callId` 必须稳定，状态为 running |
| `tool/result` | tool_result | 按 callId 配对，completed/failed 由 error 决定 |
| `turn/start`、`turn/end` | runtime status | 不直接创建可见消息 |
| `host/session-status` | runtime status | 以最新 status 为准 |
| 未知 session event | raw diagnostic | 不伪装成普通文本 |

## 5. 错误处理

### 5.1 错误类型

- `HARNESS_SIDECAR_START_FAILED`：sidecar 无法启动或健康检查超时。
- `HARNESS_SIDECAR_UNAVAILABLE`：进程退出、连接拒绝或正在恢复。
- `HARNESS_VERSION_UNSUPPORTED`：Harness 版本不在适配器允许范围。
- `HARNESS_RPC_TRANSPORT_ERROR`：HTTP 非 2xx、超时或连接中断。
- `HARNESS_RPC_PROTOCOL_ERROR`：envelope、rpcId、method 或 frame 校验失败。
- `HARNESS_RPC_BUSINESS_ERROR`：Harness 返回 `result.ok=false`。
- `HARNESS_EVENT_GAP`：历史恢复无法补齐 seq 缺口。
- `HARNESS_WORKSPACE_FORBIDDEN`：路径、用户或 workspace 校验失败。
- `HARNESS_SESSION_BINDING_CONFLICT`：同一 CodingNS session 或 Harness session 被绑定到不同主体。
- `HARNESS_CAPABILITY_UNSUPPORTED`：CodingNS 请求了 Harness 没有的能力。

### 5.2 错误响应格式

对外优先复用 CodingNS 现有 AppError 和 Provider capability 错误格式；适配器内部日志使用如下结构：

```json
{
  "error_code": "HARNESS_RPC_TRANSPORT_ERROR",
  "detail": "Harness sidecar request failed",
  "provider": "deepseek-harness",
  "codingns_session_id": "session-xxx",
  "harness_session_id": "session-yyy",
  "sidecar_instance_id": "sidecar-xxx",
  "method": "session.prompt",
  "retryable": true,
  "timestamp": "2026-08-14T00:00:00Z"
}
```

禁止记录 API key、完整附件内容、完整 prompt 和未经脱敏的本机绝对路径。

### 5.3 处理策略

1. 输入验证错误：在 CodingNS Host 入口拒绝，不启动 Harness 请求。
2. 权限和 workspace 错误：直接返回 401/403 或 CodingNS 现有权限错误。
3. Harness 业务错误：保留错误码和受控 message，转换为 Provider/Session 业务错误。
4. 传输错误：短时失败可由 TaskManager 合并恢复；请求主链路只等待有界超时。
5. 事件缺口：先读 history，不能补齐时进入 degraded/unavailable，不清理绑定。
6. 不支持能力：返回 `HARNESS_CAPABILITY_UNSUPPORTED`，并保持能力矩阵为 false。

## 6. 正确性属性

### 6.1 属性 1：会话绑定唯一性

*对于任何*有效用户和工作区，系统都应该保证一个 CodingNS session id 只绑定一个 Harness session id，一个 Harness session id 不会同时归属不同用户或工作区。

**验证需求：** 需求 2、需求 5

### 6.2 属性 2：事件顺序单调

*对于任何*同一 Harness session，CodingNS 已确认处理的事件 seq 都不得倒退；重连补发的旧事件不能覆盖更新事件。

**验证需求：** 需求 3

### 6.3 属性 3：权限边界不下沉

*对于任何*来自浏览器的 workspace、session、attachment 或 permission 请求，sidecar 调用前必须完成 CodingNS 用户和 workspace 校验。

**验证需求：** 需求 4、需求 5

### 6.4 属性 4：不支持能力不伪造成功

*对于任何*没有 Harness 对应 RPC 的 CodingNS 能力，系统都应该返回明确的不支持状态或错误，而不是写入成功记录。

**验证需求：** 需求 6

### 6.5 属性 5：外部故障隔离

*对于任何* Harness sidecar 启动失败、协议失败或事件恢复失败，CodingNS 其他 Provider 的会话创建、读取和运行都应该保持可用。

**验证需求：** 需求 1、需求 7

## 7. 测试策略

### 7.1 单元测试

- RPC envelope 生成、响应 rpcId 校验和业务错误解析。
- Harness cursor 与 CodingNS cursor 的转换。
- `SessionEvent` 到 `NormalizedMessage`、`RuntimeEvent` 的转换。
- 工具调用和工具结果按 callId 配对。
- 能力矩阵和不支持能力映射。
- workspace 路径规范化、符号链接越界和用户绑定校验。
- sidecar 状态机和进程所有权判断。

### 7.2 集成测试

- 使用 fake Harness HTTP server 验证 session.create/history/prompt/fork/cancel/respond。
- 使用 fake WebSocket server 验证 mux/host frame、malformed frame、approval/question 和重连。
- 验证 TaskManager 对 `harness.sidecar.health`、`harness.session.reconcile` 的去重、超时和观测记录。
- 验证现有 CodingNS session routes、runtime routes 和 `/ws` 收到转换后的标准结果。
- 验证 sidecar 不可用时其他 Provider 不受影响。

### 7.3 端到端测试

- 在隔离临时工作区启动锁定版本 Harness sidecar，完成创建会话、发送文本、工具调用、权限确认、附件和中断。
- 强制关闭 WebSocket 后恢复历史，确认消息连续且不重复。
- 强制终止 sidecar 后重新启动，确认绑定保留、错误可见、恢复路径可用。
- 多用户或多 workspace 夹具验证跨用户 session 不可见。

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.3.1、§4.2.1、§5 | sidecar 生命周期集成测试、启动失败测试 |
| `requirements.md` 需求 2 | `design.md` §2.3.1、§3.3.5、§3.4 | session route 和 ProviderAdapter 集成测试 |
| `requirements.md` 需求 3 | `design.md` §2.3.3、§4.2.2、§4.3 | WebSocket 重连、历史补齐、去重测试 |
| `requirements.md` 需求 4 | `design.md` §2.3.4、§4.3 | 工具、权限、附件端到端测试 |
| `requirements.md` 需求 5 | `design.md` §3.2.2、§3.3.3、§5.3 | 用户隔离和路径边界测试 |
| `requirements.md` 需求 6 | `design.md` §3.2.4、§3.3.4、§6.4 | capability snapshot 和不支持能力测试 |
| `requirements.md` 需求 7 | `design.md` §5.1、§5.2、§6.5 | 错误映射、日志字段和 Provider 隔离测试 |

## 8. 风险与待确认项

### 8.1 风险

- Harness 仍处于 Developer Preview，API endpoint、事件字段和启动方式可能发生兼容性破坏。
- Harness Web API 当前没有认证层，任何非 loopback 暴露都会放大代码执行风险。
- Harness session history 是事件日志，CodingNS 使用 NormalizedMessage；转换遗漏会导致 UI、搜索或运行时状态不一致。
- Harness `events.mux` 的 since 恢复能力当前未实现，断线恢复依赖 history 读取和本地去重。
- Windows 下 sidecar 进程树、退出信号和端口释放需要单独验证。
- 如果 CodingNS 是多用户 Host，共享 sidecar 的全局会话列表必须由 BindingStore 做严格过滤。

### 8.2 待确认项

- 生产环境允许锁定的 Harness 版本和分发方式，是随 CodingNS 安装包提供还是由用户单独安装。
- Harness 模型凭据由 Harness 自己管理，还是需要 CodingNS 的 Provider 配置页面代管。
- 首版是否要求现有 Provider 列表显示 `deepseek-harness`，还是只在实验性入口开放。
- 是否需要在首版新增持久化 binding 表，还是现有 session index 足以保存用户、工作区和外部引用。
- 是否允许 sidecar 为每个用户单独启动，以解决多用户 Host 的隔离和凭据问题。
