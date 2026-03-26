# 设计文档 - spec010.1-OpenCode兼容接入

状态：Draft

## 1. 概述

### 1.1 目标

- 把 OpenCode 接进现有 provider 体系，而不是新开一条野路子
- 明确 OpenCode 的主接入链路、兜底链路和禁止事项
- 让 OpenCode 的消息结构、运行时能力和高级能力在项目里有稳定落点
- 借这次接入把当前仓库里阻碍第三家 provider 的硬编码拆掉

### 1.2 覆盖需求

- `requirements.md` 需求 1：OpenCode 必须作为正式 provider 接入
- `requirements.md` 需求 2：会话真相必须来自官方 server/sdk 主链路
- `requirements.md` 需求 3：宽消息结构必须有可追溯映射
- `requirements.md` 需求 4：能力差异必须通过 capability descriptor 暴露
- `requirements.md` 需求 5：不能破坏现有运行时语义
- `requirements.md` 需求 6：权限、diff、todo 和子会话能力必须有边界
- `requirements.md` 需求 7：必须有真实样本和本地回归
- `requirements.md` 需求 8：问题排查必须能快速定位到 OpenCode 层

### 1.3 技术约束

- 后端：`Node.js 22 + TypeScript + Fastify + ws`
- 会话同步核心：`packages/session-sync-core`
- 当前 provider 类型、注册表和前端 DTO 仍有两家 provider 写死代码，需要先拆
- OpenCode 官方能力以 HTTP/SSE server 和 SDK 为主，不应把 sqlite 解析当成唯一运行时协议
- OpenCode 本地已验证的真实数据目录是：`~/.local/share/opencode/`

## 2. 核心判断

### 2.1 主接入路线

主接入路线定为：

1. `OpenCode server/sdk` 负责会话发现、历史消息、实时事件、运行时控制
2. `本地 sqlite` 只负责排障、样本抽取、回填兜底和 fixture

这么做的原因很简单：

- OpenCode 已经公开提供 `/session`、`/session/:id/message`、`/event`、`/session/:id/diff`、`/session/:id/todo` 等正式接口
- 本地 sqlite 虽然真实存在，但那是私有落地格式，适合只读，不适合当主协议
- 继续走“猜本地文件格式”这条路，最后会和 `spec010` 想要的 provider 契约直接打架

### 2.2 明确禁止的路线

- 不允许把 OpenCode 当成 Claude/Codex 的变种 jsonl provider
- 不允许为了 OpenCode 在业务组件里继续散落 `provider === "opencode"` 判断
- 不允许只做“能显示文字”就算接入完成
- 不允许用 sqlite 私有结构去模拟 server 实时事件

## 3. 架构

### 3.1 目标结构

OpenCode 接入由六块组成：

1. `provider-contract cleanup`：先拆掉只支持两家 provider 的硬编码
2. `opencode-provider-adapter`：历史读取、会话发现、能力描述
3. `opencode-runtime-adapter`：新建会话、继续会话、中断、实时事件订阅
4. `opencode-event-normalizer`：把 message/part/event 映射到项目统一模型
5. `opencode-capability-mapper`：输出 OpenCode capability descriptor
6. `opencode-fixture-kit`：沉淀本地样本、回归和排障工具

### 3.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `provider-contract cleanup` | 拆 ProviderId、Registry、DTO 的两家硬编码 | 当前类型和注册逻辑 | 可扩展 provider 基础层 |
| `OpenCodeAdapter` | 发现会话、读取历史、读 capability | OpenCode server/sdk，必要时 sqlite | 统一 session/history/capability |
| `OpenCodeRuntimeAdapter` | 启动、续跑、中断和实时事件 | OpenCode server + `/event` SSE | 统一 runtime 事件 |
| `OpenCodeEventNormalizer` | 映射 OpenCode part 到项目消息模型 | session/message/part/event | `NormalizedMessage` 或富内容扩展 |
| `OpenCodeCapabilityMapper` | 生成 OpenCode provider/session capability | OpenCode 原生能力和项目接入现状 | `ProviderCapabilities` |
| `OpenCodeFixtureKit` | 真实样本脱敏、回放、断言 | 本地 sqlite、日志、session_diff | fixture 和测试报告 |

## 4. 关键设计

### 4.1 先拆当前硬编码

当前必须先处理的点：

- [types.ts](/Users/jackson/Code/CodingNS/packages/session-sync-core/src/types.ts#L3) 把 `ProviderId` 写死成两家
- [registry.ts](/Users/jackson/Code/CodingNS/packages/session-sync-core/src/registry.ts#L13) 直接校验 `claude-code,codex`
- [session-history-service.ts](/Users/jackson/Code/CodingNS/apps/host/src/modules/sessions/session-history-service.ts#L97) 只初始化两家 adapter
- [session-live-runtime-service.ts](/Users/jackson/Code/CodingNS/apps/host/src/modules/sessions/session-live-runtime-service.ts#L1820) 只初始化两家 runtime
- [conversation-api.ts](/Users/jackson/Code/CodingNS/apps/user-app/src/features/conversation/api/conversation-api.ts#L4) 和多个页面组件把 provider 当联合类型写死

这里不先改，后面所有 OpenCode 设计都只是 PPT。

### 4.2 会话绑定模型

OpenCode 在项目里沿用现有 `session binding` 机制，但字段语义调整为：

| 字段 | 设计 |
| --- | --- |
| `provider` | 固定为 `opencode` |
| `providerSessionId` | 对应 OpenCode 原生 `session.id` |
| `rawStoreRef` | 使用稳定逻辑引用：`opencode://session/<sessionId>` |
| `rawRef` | 细粒度引用到 `session/message/part` |

原因：

- OpenCode 主链路不是本地文件路径
- `rawStoreRef` 不能再假设一定是磁盘路径
- `rawRef` 必须足够细，方便追溯到 part 级别

建议的原始引用格式：

- session：`opencode://session/<sessionId>`
- message：`opencode://session/<sessionId>/message/<messageId>`
- part：`opencode://session/<sessionId>/message/<messageId>/part/<partId>`

### 4.3 历史读取设计

历史读取优先走：

1. `GET /session`
2. `GET /session/:id`
3. `GET /session/:id/message`
4. `GET /session/:id/message/:messageId`

sqlite 只在两种情况下参与：

- server 不可达时做只读排障
- 从本机真实数据抽取 fixture

### 4.4 实时运行时设计

运行时优先走：

1. `POST /session` 创建会话
2. `POST /session/:id/message` 或 `POST /session/:id/prompt_async`
3. `GET /event` 订阅 SSE 事件流
4. `POST /session/:id/abort` 做中断

实时事件要识别的最小集合：

- `server.connected`
- `session.created`
- `session.updated`
- `session.status`
- `session.idle`
- `message.updated`
- `message.part.updated`
- `message.part.delta`
- `session.diff`
- `todo.updated`
- `permission.updated`

### 4.5 消息模型设计

当前公共模型太瘦，OpenCode 接入建议分两层：

#### 4.5.1 第一层：兼容现有字段

| OpenCode part | 第一阶段映射 |
| --- | --- |
| `text` | `kind = text` |
| `reasoning` | `kind = thinking` |
| `tool` | 映射到 `tool_call` / `tool_result` |
| `step-start` | 运行状态或消息元数据 |
| `step-finish` | 运行状态、token 使用统计、finish reason |

#### 4.5.2 第二层：补富内容扩展

新增 `NormalizedMessagePart[]` 扩展结构，承载：

- `patch`
- `snapshot`
- `agent`
- `subtask`
- `file`
- `retry`
- `compaction`

这样做的好处：

- 旧 UI 还能继续吃基础字段
- 新 UI 可以逐步把 richer part 展出来
- 不会把 OpenCode 的关键信息直接压没

### 4.6 capability 设计

当前 `ProviderCapabilities` 不够表达 OpenCode，建议在保持兼容前提下扩展可选字段：

| 字段 | 说明 |
| --- | --- |
| `supportsTodo` | 是否支持 todo 能力 |
| `supportsSessionDiff` | 是否支持读取 session diff |
| `supportsPermissionRequests` | 是否支持权限请求与回复 |
| `supportsSessionFork` | 是否支持 fork 会话 |
| `supportsSessionShare` | 是否支持分享会话 |
| `supportsAsyncPrompt` | 是否支持异步 prompt |
| `supportsNativeAgents` | 是否支持原生 agent / subtask 能力 |

第一阶段 OpenCode capability 建议：

- `canStartSession = true`
- `canResumeSession = true`
- `canSendMessage = true`
- `supportsInterrupt = true`
- `supportsStructuredToolCalls = true`
- `supportsTokenUsage = true`
- `supportsAttachments = true`
- `supportsSubagents = true`
- `supportsTodo = true`
- `supportsSessionDiff = true`
- `supportsPermissionRequests = true`
- `supportsSessionFork = true`
- `supportsSessionShare = true`
- `supportsAsyncPrompt = true`

但是否真正在 UI 可见，要再看阶段范围。

### 4.7 高级能力边界

第一阶段建议交付范围：

- 会话发现
- 历史消息
- 实时对话
- 中断
- 基础工具调用展示
- 基础 reasoning 展示
- 子会话关系读取
- diff/todo/permission 的只读或可追踪能力

第一阶段明确先不做：

- 完整 revert / unrevert 交互
- 完整 share 管理界面
- 所有 part 类型的专属富 UI
- 所有 permission 类型的完整交互工作流

## 5. 数据与状态模型

### 5.1 本地样本结构

当前本机已确认：

- 主库：`~/.local/share/opencode/opencode.db`
- diff 目录：`~/.local/share/opencode/storage/session_diff/`
- 日志目录：`~/.local/share/opencode/log/`

已确认的数据表：

- `session`
- `message`
- `part`
- `project`
- `permission`
- `todo`
- `session_share`
- `workspace`

### 5.2 运行状态映射

| OpenCode 原生状态 | 项目状态 |
| --- | --- |
| `busy` | `running` |
| `idle` | `completed` 或 `idle` |
| `retry` | `running`，并附加 retry 元数据 |

注意：

- `retry` 不能简单丢掉，否则排障时会瞎
- `session.idle` 和 `session.status` 要联合判断

## 6. 错误处理

### 6.1 错误来源分类

- `SERVER_UNAVAILABLE`：OpenCode server 不可达
- `SDK_CALL_FAILED`：官方 sdk 调用失败
- `SQLITE_FALLBACK_FAILED`：sqlite 兜底失败
- `EVENT_NORMALIZATION_FAILED`：part 或 event 映射失败
- `CAPABILITY_MAPPING_FAILED`：能力映射失败

### 6.2 处理策略

1. 主链路失败时，先明确报错，再决定是否切 sqlite 只读兜底。
2. sqlite 兜底失败时，不再继续伪造成功状态。
3. part 映射失败时，优先保留原始引用和原始类型，避免信息直接丢失。

## 7. 正确性属性

### 7.1 属性 1：OpenCode 不走私有补丁接入

*对于任何* OpenCode 能力接入，系统都应该满足：它通过统一 provider 契约、统一 capability 和统一运行时边界进入系统，而不是新增一串业务层特判。

### 7.2 属性 2：OpenCode 原始语义不被压扁

*对于任何* OpenCode 消息和 part，系统都应该满足：要么被正确映射，要么被安全降级并保留原始引用，不允许静默丢失关键语义。

### 7.3 属性 3：现有 provider 主链路不被打坏

*对于任何* OpenCode 接入改动，系统都应该满足：Claude/Codex 的既有能力和行为不因此回归。

## 8. 测试策略

### 8.1 单元测试

- provider 注册和类型扩展测试
- capability 扩展字段兼容测试
- part 映射测试
- runtime 状态映射测试

### 8.2 集成测试

- OpenCode session discovery 测试
- 历史读取测试
- `/event` 实时事件订阅测试
- interrupt 测试
- diff/todo/children 读取测试

### 8.3 fixture 回归

- 真实本地 sqlite 样本脱敏后固化
- 覆盖至少 `text`、`reasoning`、`tool`、`step-start`、`step-finish`
- 后续补 `patch`、`snapshot`、`agent`、`permission`、`diff`

### 8.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §3.1、§4.1 | 类型测试 + 注册测试 |
| 需求 2 | §2.1、§4.3、§4.4 | 集成测试 + server 联调 |
| 需求 3 | §4.5、§6.2 | part fixture 测试 |
| 需求 4 | §4.6 | capability 契约测试 |
| 需求 5 | §4.7、§7.3 | 现有 provider 回归测试 |
| 需求 6 | §4.6、§4.7 | 前端门控测试 + 集成验证 |
| 需求 7 | §5.1、§8.3 | fixture runner |
| 需求 8 | §6 | 错误注入测试 + 日志检查 |

## 9. 风险与待确认项

### 9.1 风险

- OpenCode 官方 server 和本地 sqlite 版本演进不同步
- 当前公共消息模型扩展不够快，导致第一阶段只能有损展示
- 前端已有两家 provider 特判拆不干净，OpenCode 接入后会继续污染

### 9.2 待确认项

- OpenCode server 在当前宿主环境里的认证和生命周期由谁管理
- `prompt_async` 在项目发送队列语义中怎么定义最稳
- `permission` 第一阶段是只读展示，还是直接支持回复
