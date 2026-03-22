# 设计文档 - ClaudeCode与Codex会话同步核心

状态：Draft

## 1. 概述

### 1.1 目标

- 在 `CodingNS Host` 内稳定打通 Claude Code 与 Codex 的会话同步主链路。
- 严格执行“原始消息唯一来源”原则：原始消息只从 provider 原生存储读取。
- 对外提供稳定的 capability descriptor，让前端按能力渲染，不按 provider 名字硬编码。

### 1.2 覆盖需求

- `requirements.md` 需求 1：Provider 支持范围必须收敛
- `requirements.md` 需求 2：原始消息必须保持唯一来源
- `requirements.md` 需求 3：会话发现与历史读取必须可用
- `requirements.md` 需求 4：实时订阅与续接链路必须可靠
- `requirements.md` 需求 5：支持新建会话并建立映射
- `requirements.md` 需求 6：能力差异必须显式声明
- `requirements.md` 需求 7：索引与状态快照必须可维护

### 1.3 技术约束

- 后端：`Node.js 22 + TypeScript + Fastify + ws`
- 数据存储：`SQLite（better-sqlite3）`
- 鉴权：沿用 `spec001` 的登录态令牌校验；受保护 API 和 WebSocket 必须鉴权
- provider 范围：只允许 `provider-claude-code` 与 `provider-codex`
- 数据边界：不保存原始消息副本，只保存索引、状态、映射、衍生字段

## 2. 架构

### 2.1 系统结构

本 Spec 的结构分三层：

1. provider 适配层：只负责和 Claude Code / Codex 原生存储打交道。
2. 会话同步核心层：负责发现、解析、归一化、索引更新、状态快照、实时桥接。
3. 服务接口层：提供受保护 HTTP / WebSocket 接口给客户端消费。

关键数据流：

1. `session-discovery` 扫描工作区并识别 provider 会话。
2. `session-parser + message-normalizer` 把原始消息转成统一消息模型。
3. `session-index-repo` 写入索引与状态快照。
4. `realtime-bridge` 推送增量事件，客户端断线后按游标补齐。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `provider-registry` | 注册并管理两个 provider 实现 | provider 配置 | provider 实例 |
| `session-discovery` | 发现工作区会话并建立映射 | workspacePath | 会话列表、映射草稿 |
| `session-sync-service` | 编排历史读取、续接、新建、实时同步 | API 请求、provider 回调 | 统一消息流、状态更新 |
| `message-normalizer` | 标准化消息并补 rawRef | 原始消息 | `NormalizedMessage` |
| `session-index-repo` | 管理索引与状态快照持久化 | 标准化对象 | SQLite 记录 |
| `capability-service` | 聚合 provider/session 能力声明 | providerId、sessionId | `ProviderCapabilities` |
| `realtime-bridge` | 推送实时消息与状态事件 | 增量消息、状态变化 | WebSocket 事件 |

### 2.3 关键流程

#### 2.3.1 会话发现与历史读取

1. 客户端请求工作区会话列表。
2. `session-discovery` 调用两个 provider 的 `detectSessions(workspacePath)`。
3. 系统更新会话映射与索引（不写原始正文）。
4. 客户端请求会话历史时，系统调用 `readSessionHistory(sessionId, options)`。
5. `message-normalizer` 转成统一结构并返回，携带 `rawRef`。

#### 2.3.2 实时订阅与断线补齐

1. 客户端建立 WebSocket 并完成鉴权。
2. 客户端订阅目标会话（带上最后游标）。
3. `realtime-bridge` 建立 provider 订阅并推送增量消息。
4. 客户端断线重连后提交最后游标，系统补齐缺失消息。
5. 系统更新状态快照中的 `lastCursor` 和 `lastSyncedAt`。

#### 2.3.3 续接与新建会话

1. 客户端发起续接或新建请求。
2. `session-sync-service` 分别调用 `resumeSession` 或 `startSession`。
3. 成功后更新映射、索引、状态快照。
4. 失败时返回标准错误，不写入脏数据。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7

- `ProviderAdapter`：单个 provider 的统一适配接口。
- `SessionSyncService`：主编排服务，负责读写边界和错误收口。
- `SessionIndexRepository`：SQLite 持久层，严格限制数据落盘范围。
- `CapabilityService`：能力声明对外出口。
- `RealtimeBridge`：实时事件桥接和重连补偿。

### 3.2 数据结构

覆盖需求：2、3、4、5、6、7

#### 3.2.1 `SessionBinding`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `systemSessionId` | string | 是 | 系统会话 ID | 全局唯一 |
| `workspaceId` | string | 是 | 工作区 ID | 必须存在 |
| `provider` | enum | 是 | `claude-code`/`codex` | 仅允许两种 |
| `providerSessionId` | string | 是 | provider 原生会话 ID | provider 内唯一 |
| `createdAt` | string | 是 | 创建时间 | ISO8601 |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

#### 3.2.2 `SessionIndex`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `systemSessionId` | string | 是 | 关联系统会话 ID | 外键到 `SessionBinding` |
| `title` | string | 否 | 会话标题（可衍生） | 长度限制 1-200 |
| `lastMessageAt` | string | 否 | 最近消息时间 | ISO8601 |
| `messageCount` | number | 否 | 消息计数 | 非负整数 |
| `source` | string | 是 | 数据来源标识 | `provider-native` |
| `rawHeadRef` | string | 否 | 原始头消息引用 | 可空 |
| `rawTailRef` | string | 否 | 原始尾消息引用 | 可空 |

#### 3.2.3 `SessionStatusSnapshot`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `systemSessionId` | string | 是 | 关联系统会话 ID | 外键到 `SessionBinding` |
| `syncStatus` | enum | 是 | 同步状态 | `idle/syncing/error` |
| `lastCursor` | string | 否 | 最近同步游标 | 可空 |
| `lastSyncedAt` | string | 否 | 最近成功同步时间 | ISO8601 |
| `lastErrorCode` | string | 否 | 最近错误码 | 可空 |
| `lastErrorMessage` | string | 否 | 最近错误信息 | 可空 |

#### 3.2.4 `NormalizedMessage`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `messageId` | string | 是 | 统一消息 ID | 会话内唯一 |
| `systemSessionId` | string | 是 | 所属会话 | 必须存在 |
| `provider` | enum | 是 | provider 标识 | 仅允许两种 |
| `role` | enum | 是 | 消息角色 | `user/assistant/tool/system` |
| `content` | string | 是 | 归一化文本内容 | 可空字符串但不可缺失 |
| `timestamp` | string | 是 | 消息时间戳 | ISO8601 |
| `sequence` | number | 是 | 排序序号 | 递增 |
| `rawRef` | string | 是 | 原始引用 | 必须可追溯 |

#### 3.2.5 `ProviderCapabilities`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `provider` | enum | 是 | provider 标识 | 仅允许两种 |
| `canStartSession` | boolean | 是 | 是否支持新建会话 | 布尔 |
| `canResumeSession` | boolean | 是 | 是否支持续接 | 布尔 |
| `supportsSubagents` | boolean | 是 | 是否支持 subagent | 布尔 |
| `supportsInterrupt` | boolean | 是 | 是否支持中断 | 布尔 |
| `supportsStructuredToolCalls` | boolean | 是 | 是否支持结构化工具调用 | 布尔 |
| `supportsTokenUsage` | boolean | 是 | 是否支持 token 统计 | 布尔 |
| `supportsAttachments` | boolean | 是 | 是否支持附件 | 布尔 |
| `supportsPermissionPrompt` | boolean | 是 | 是否支持权限确认 | 布尔 |
| `supportsCheckpoint` | boolean | 是 | 是否支持检查点 | 布尔 |
| `limitations` | string[] | 否 | 已知限制说明 | 可空数组 |

### 3.3 接口契约

覆盖需求：3、4、5、6

#### 3.3.1 Provider 统一接口（内部）

- 类型：TypeScript Interface
- 标识：`ProviderAdapter`
- 输入：`workspacePath`、`sessionId`、`runtimeOptions`、分页参数
- 输出：会话列表、历史消息流、能力描述、续接/新建结果
- 校验：
  - provider 仅允许 `claude-code` 或 `codex`
  - 输入参数必须经过 schema 校验
- 错误：
  - `PROVIDER_NOT_SUPPORTED`
  - `PROVIDER_IO_ERROR`
  - `PROVIDER_DATA_INVALID`

#### 3.3.2 获取会话列表

- 类型：HTTP
- 路径：`GET /api/sessions?workspaceId={id}`
- 输入：`workspaceId`、登录态令牌
- 输出：`SessionIndex[] + SessionStatusSnapshot[]`
- 校验：`workspaceId` 必填且合法
- 错误：`UNAUTHORIZED`、`WORKSPACE_NOT_FOUND`、`PROVIDER_IO_ERROR`

#### 3.3.3 获取会话历史

- 类型：HTTP
- 路径：`GET /api/sessions/{systemSessionId}/messages?cursor=&limit=`
- 输入：会话 ID、分页参数、登录态令牌
- 输出：`NormalizedMessage[]`、`nextCursor`
- 校验：`limit` 有上限，`cursor` 必须可解析
- 错误：`UNAUTHORIZED`、`SESSION_NOT_FOUND`、`CURSOR_INVALID`

#### 3.3.4 续接会话

- 类型：HTTP
- 路径：`POST /api/sessions/{systemSessionId}/resume`
- 输入：会话 ID、运行参数、登录态令牌
- 输出：续接结果、当前状态快照
- 校验：会话与 provider 映射必须存在
- 错误：`UNAUTHORIZED`、`SESSION_NOT_FOUND`、`RESUME_NOT_SUPPORTED`

#### 3.3.5 新建会话

- 类型：HTTP
- 路径：`POST /api/sessions/start`
- 输入：`workspaceId`、`provider`、运行参数、登录态令牌
- 输出：新建后的会话映射与初始状态
- 校验：provider 必须在支持列表内
- 错误：`UNAUTHORIZED`、`PROVIDER_NOT_SUPPORTED`、`SESSION_START_FAILED`

#### 3.3.6 获取能力描述

- 类型：HTTP
- 路径：`GET /api/providers/{provider}/capabilities`
- 输入：provider、登录态令牌
- 输出：`ProviderCapabilities`
- 校验：provider 必须合法
- 错误：`UNAUTHORIZED`、`PROVIDER_NOT_SUPPORTED`

#### 3.3.7 实时消息订阅

- 类型：WebSocket Event
- 事件：`session.subscribe` / `session.message` / `session.status`
- 输入：会话 ID、最后游标、登录态令牌
- 输出：增量消息事件、状态事件
- 校验：握手鉴权必须成功
- 错误：`UNAUTHORIZED`、`SESSION_NOT_FOUND`、`SUBSCRIBE_FAILED`

## 4. 数据与状态模型

### 4.1 数据关系

- `SessionBinding` 是主键入口，连接 `workspaceId + providerSessionId + systemSessionId`。
- `SessionIndex` 与 `SessionStatusSnapshot` 都以 `systemSessionId` 外键关联。
- 原始消息正文不落库；历史读取时通过 provider 按需读取，再归一化返回。
- 每条返回消息必须保留 `rawRef`，用于一致性追溯。

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `idle` | 未同步或同步完成待命 | 初始化完成/同步完成 | 开始同步进入 `syncing` |
| `syncing` | 正在读取历史或接收增量 | 发起历史读取/建立订阅 | 成功回到 `idle`，失败进入 `error` |
| `error` | 最近一次同步失败 | provider 读取失败/解析失败 | 重试成功回到 `idle` |

## 5. 错误处理

### 5.1 错误类型

- 认证错误：未登录或令牌失效。
- provider 错误：CLI 原始存储读取失败、数据格式变化。
- 数据一致性错误：映射缺失、游标非法、重复消息冲突。
- 运行时错误：订阅中断、网络抖动导致事件丢失。

### 5.2 错误响应格式

```json
{
  "detail": "会话不存在或已失效",
  "error_code": "SESSION_NOT_FOUND",
  "field": "systemSessionId",
  "timestamp": "2026-03-22T00:00:00Z"
}
```

### 5.3 处理策略

1. 输入验证错误：直接拒绝请求并返回字段级错误。
2. provider 读取错误：保留现有索引数据，标记状态为 `error`，支持后续重试。
3. 实时订阅中断：客户端重连后按游标补齐，不直接清空状态。
4. 映射不一致：停止后续链路并触发重建流程，防止脏数据扩散。

## 6. 正确性属性

### 6.1 属性 1：消息唯一来源

*对于任何* 会话历史读取或实时消息推送，系统都应该满足：消息内容可追溯到 provider 原始存储，系统内不存在第二份原始消息主数据。

**验证需求：** 需求 2、需求 7

### 6.2 属性 2：能力声明驱动行为

*对于任何* 前端可见操作，系统都应该满足：可用性由 capability descriptor 决定，而不是由 provider 名字硬编码决定。

**验证需求：** 需求 6

### 6.3 属性 3：映射稳定性

*对于任何* 续接或新建会话，系统都应该满足：`systemSessionId` 与 `providerSessionId` 映射唯一且可持久恢复。

**验证需求：** 需求 3、需求 4、需求 5、需求 7

## 7. 测试策略

### 7.1 单元测试

- `message-normalizer`：字段映射、顺序、`rawRef` 生成。
- `capability-service`：默认能力、会话级覆盖、限制项输出。
- `session-sync-service`：映射写入、状态更新、错误分支处理。

### 7.2 集成测试

- Claude Code provider：会话发现、历史读取、续接、新建链路。
- Codex provider：会话发现、历史读取、续接、新建链路。
- SQLite 持久层：索引/状态快照写入与重建。
- WebSocket：鉴权、订阅、断线重连补齐。

### 7.3 端到端测试

- 用户登录后查看工作区会话列表并读取历史。
- 用户续接已有会话并收到实时消息。
- 用户创建新会话并看到映射和状态更新。
- 能力禁用场景下，前端能收到明确能力限制。

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §1.3、§2.2、§3.3.1 | provider 注册与白名单校验测试 |
| 需求 2 | §3.2、§4.1、§6.1 | 原始消息只读与 rawRef 追溯测试 |
| 需求 3 | §2.3.1、§3.3.2、§3.3.3 | 会话发现+分页历史读取集成测试 |
| 需求 4 | §2.3.2、§3.3.7、§4.2 | WebSocket 重连补齐与状态流转测试 |
| 需求 5 | §2.3.3、§3.3.5、§6.3 | 新建会话映射一致性测试 |
| 需求 6 | §3.2.5、§3.3.6、§6.2 | capability descriptor 契约测试 |
| 需求 7 | §3.2.2、§3.2.3、§5.3 | 索引重建与故障恢复测试 |

## 8. 风险与待确认项

### 8.1 风险

- provider 原始存储格式变更会直接影响解析链路。
- 实时订阅中断后如果游标策略设计不当，可能导致漏消息或重复消息。
- 如果把业务逻辑混入 provider 适配层，后续新增 provider 会迅速失控。

### 8.2 待确认项

- Claude Code 与 Codex 的最小可用续接参数集合需要样本校准。
- `rawRef` 的标准格式是否统一为 `provider://path#offset`，需要在实现前定稿。
- 状态重建任务的触发策略（定时/手动/API）需要在实现阶段确定。
