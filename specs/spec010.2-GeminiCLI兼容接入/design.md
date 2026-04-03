# 设计文档 - spec010.2-GeminiCLI兼容接入

状态：Draft

## 1. 概述

### 1.1 目标

- 把 Gemini 接进现有 provider 体系，而不是搞成第四套旁路逻辑
- 明确 Gemini `ACP`、`headless`、本地 chats 目录的主次关系
- 让 Gemini 的原生 session id、历史、实时运行和能力声明在项目里有稳定落点
- 借这次接入继续收口仓库里剩余的 provider 硬编码

### 1.2 覆盖需求

- `requirements.md` 需求 1：Gemini 必须作为正式 provider 接入
- `requirements.md` 需求 2：Gemini 运行时主链路必须优先走官方 ACP
- `requirements.md` 需求 3：历史与会话发现必须绑定官方原生 session id
- `requirements.md` 需求 4：消息与能力差异必须通过统一模型和 capability 暴露
- `requirements.md` 需求 5：不能破坏现有运行时语义
- `requirements.md` 需求 6：主链路和兼容层边界必须写清楚
- `requirements.md` 需求 7：必须有真实样本和回归
- `requirements.md` 需求 8：排障必须能区分三层链路

### 1.3 技术约束

- 后端：`Node.js 22 + TypeScript + Fastify + ws`
- 会话同步核心：`packages/session-sync-core`
- Host 与前端仍残留少量 provider 名字硬编码，需要继续拆
- Gemini 官方程序化能力以 `ACP` 和 `headless stream-json` 为主
- Gemini 官方会话目录目前可发现于 `~/.gemini/tmp/<project_hash>/chats/`
- 本次接入可以参考 `siteboon/claudecodeui` 的思路，但不能引入它的自建 sessionManager 真相

## 2. 核心判断

### 2.1 主接入路线

Gemini 主接入路线定为：

1. `Gemini ACP` 负责新建会话、恢复会话、发送 prompt、取消运行、设置会话模式和模型
2. `Gemini Headless` 负责主链路不可用时的运行时 fallback
3. `Gemini Local Chats` 负责会话发现、历史读取、样本抽取和排障

原因很简单：

- `ACP` 是 Gemini 官方明确提供给集成方的正式协议
- `headless --output-format stream-json` 也属于官方公开能力，适合做 runtime fallback
- 本地 chats 目录虽然真实存在，但官方没有把内部 JSON schema 承诺成长期稳定公共协议

### 2.2 明确禁止的路线

- 不允许把 Gemini 接成一个只会 `spawn("gemini")` 的终端命令功能
- 不允许引入参考项目那种自建 `sessionManager` 作为主会话真相
- 不允许把本地 chats JSON 当成比 `ACP` 更高优先级的协议
- 不允许为了 Gemini 在前端主流程里再散落 `provider === "gemini"` 判断

## 3. 架构

### 3.1 目标结构

Gemini 接入由六块组成：

1. `provider-contract cleanup`：继续拆剩余 provider 硬编码
2. `gemini-provider-adapter`：会话发现、历史读取、能力描述
3. `gemini-runtime-adapter`：新建、恢复、发送、中断、事件流
4. `gemini-message-normalizer`：把 `ACP` 或 `headless` 事件映射到统一消息模型
5. `gemini-capability-mapper`：输出 Gemini provider/session capability
6. `gemini-fixture-kit`：沉淀 chats 样本、ACP 样本、fallback 样本和回归工具

### 3.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `provider-contract cleanup` | 清理 Gemini 接入前的公共障碍 | 当前类型、DTO、注册逻辑 | 可扩展 provider 基础层 |
| `GeminiAdapter` | 发现会话、读取历史、读 capability | Session management、Local Chats | 统一 session/history/capability |
| `GeminiRuntimeAdapter` | 启动、恢复、发送、中断 | ACP，必要时 headless | 统一 runtime 事件 |
| `GeminiMessageNormalizer` | 归一化 Gemini 运行时事件 | ACP 事件、stream-json 事件 | `NormalizedMessage` |
| `GeminiCapabilityMapper` | 生成 Gemini capability | Gemini 原生能力和项目接入现状 | `ProviderCapabilities` |
| `GeminiFixtureKit` | 脱敏样本、回放、断言 | 本地 chats、运行时事件日志 | fixture 和测试报告 |

## 4. 关键设计

### 4.1 先拆当前硬编码

当前 Gemini 接入前必须重点检查：

- [provider-ui.ts](/Users/jackson/Documents/Code/CodingNS/apps/user-app/src/features/conversation/capability/provider-ui.ts#L23)
- [types.ts](/Users/jackson/Documents/Code/CodingNS/apps/user-app/src/preferences/types.ts#L3)
- [user-preference-store.ts](/Users/jackson/Documents/Code/CodingNS/apps/user-app/src/preferences/user-preference-store.ts#L40)
- [profile-service.ts](/Users/jackson/Documents/Code/CodingNS/apps/host/src/modules/preferences/profile-service.ts#L23)
- [domain.ts](/Users/jackson/Documents/Code/CodingNS/apps/host/src/types/domain.ts#L236)
- [session-live-runtime-service.ts](/Users/jackson/Documents/Code/CodingNS/apps/host/src/modules/sessions/session-live-runtime-service.ts#L2234)

这些点不先处理干净，Gemini 接进来之后还会继续膨胀特判。

### 4.2 会话绑定模型

Gemini 在项目里沿用现有 `session binding` 机制，但字段语义明确如下：

| 字段 | 设计 |
| --- | --- |
| `provider` | 固定为 `gemini` |
| `providerSessionId` | 对应 Gemini 官方原生 session id |
| `rawStoreRef` | 使用稳定逻辑引用：`gemini://session/<sessionId>` |
| `rawRef` | 细粒度引用到 Gemini session/message/part 或本地文件锚点 |

原因：

- 项目会话 ID 是项目自己的锚点
- `providerSessionId` 绝不能再用 UI 伪造 ID
- `rawStoreRef` 不能直接假设必须是物理文件路径

建议原始引用格式：

- session：`gemini://session/<sessionId>`
- message：`gemini://session/<sessionId>/message/<messageId>`
- local chat line：`gemini://session/<sessionId>#file=<encoded>&index=<n>`

### 4.3 会话发现与历史读取设计

#### 4.3.1 会话发现

优先顺序：

1. Gemini 官方 `--list-sessions`
2. 本地 `~/.gemini/tmp/<project_hash>/chats/*.json`

理由：

- `--list-sessions` 是官方入口，优先级更高
- 本地 chats 目录适合补足会话元信息和做兜底发现
- 两者不一致时，以原生 session id 去重并记录来源

#### 4.3.2 历史读取

历史读取优先走：

1. 与 session id 对应的本地 chats JSON
2. 运行期增量补历史

这里要承认现实：Gemini 官方公开了会话目录位置，但没有正式承诺 JSON schema 长期稳定。
所以设计上必须做到：

- 历史解析器单独隔离在 Gemini provider 内部
- 解析失败时返回结构化错误和 fallback 信息
- 通过 fixture 及时发现 schema 变化

### 4.4 实时运行时设计

#### 4.4.1 主运行时

主运行时优先走 `ACP`：

1. `initialize`
2. `authenticate`
3. `newSession` 或 `loadSession`
4. `setSessionMode`
5. `unstable_setSessionModel`
6. `prompt`
7. `cancel`

#### 4.4.2 运行时 fallback

当 `ACP` 不可用时，回退到：

- `gemini --prompt ... --resume ... --output-format stream-json`

fallback 只承担：

- 实时输出
- 工具调用与工具结果事件
- 新建或恢复会话
- 基础中断

### 4.5 消息模型设计

Gemini 第一阶段继续映射到现有统一消息模型：

| Gemini 事件 | 第一阶段映射 |
| --- | --- |
| `message` | `kind = text` 或运行中增量消息 |
| `tool_use` | `kind = tool_call` |
| `tool_result` | `kind = tool_result` |
| `error` | 运行时错误消息 |
| `result` | 运行完成状态 |

补充规则：

- 增量文本统一由运行时层合并，不让前端背锅
- 工具调用必须保留 `toolId/name/input/output/status`
- 若 Gemini 后续暴露更宽的结构，先以可选扩展字段承载，不污染现有主模型

### 4.6 capability 设计

第一阶段 Gemini capability 建议：

- `canStartSession = true`
- `canResumeSession = true`
- `canSendMessage = true`
- `supportsInterrupt = true`
- `supportsStructuredToolCalls = true`
- `supportsTokenUsage = false`
- `supportsAttachments = false`
- `supportsPermissionPrompt = true`
- `supportsCheckpoint = false`
- `supportsSubagents = false`

限制说明必须明确写进 `limitations`：

- 当前 token usage 暂不保证稳定读取
- 图片附件第一阶段不承诺
- 本地 chats schema 变化会由 fixture 回归兜底

### 4.7 参考项目借鉴边界

参考 `siteboon/claudecodeui`，可以借的：

- `stream-json` 事件归一化思路
- 从 `init` 事件拿原生 `session_id`
- 从官方本地 chats 目录做会话发现和历史读取

不能直接借的：

- 自建 `sessionManager`
- UI 生成伪会话 ID 再映射回原生 session id
- 图片通过临时文件路径硬塞 prompt 的默认方案

## 5. 数据与状态模型

### 5.1 样本结构

第一阶段建议沉淀三类真实样本：

- `ACP` 新建会话样本
- `ACP` 恢复会话样本
- `headless stream-json` 事件样本
- `Local Chats` 历史样本

### 5.2 运行状态映射

| Gemini 状态 | 项目运行状态 |
| --- | --- |
| session created / init | `starting` |
| first assistant delta | `running` |
| result success | `completed` |
| cancel acknowledged | `interrupted` |
| error | `failed` |

## 6. 兼容与降级策略

### 6.1 对现有 provider 的兼容

- Gemini 不能改动 Claude/Codex/OpenCode 既有 rawRef 语义
- Gemini 不能要求现有运行时服务为它单独改主流程
- Gemini 扩展字段一律走可选字段，老前端可安全忽略

### 6.2 Gemini 自身的降级策略

- `ACP` 不可用：回退 `headless`
- `headless` 不可用：至少保留历史发现与错误提示
- chats schema 解析失败：返回结构化错误，不伪造历史成功

## 7. 验证策略

### 7.1 核心验证

- `GeminiAdapter` 单元测试
- `GeminiRuntimeAdapter` 单元测试
- 基于真实 chats 样本的 fixture 回放测试
- `ACP -> fallback -> history` 三条链路的集成验证

### 7.2 验收标准

- 项目内可以创建 Gemini 草稿并查询 capability
- Host 可以发现 Gemini 原生会话
- 运行时优先通过 `ACP` 新建和恢复会话
- fallback 工作时，系统能明确记录来源
- 历史消息可从官方 chats 样本恢复

## 8. 风险与对策

### 8.1 最大风险

- Gemini 本地 chats JSON schema 非正式公开协议，未来可能变化

### 8.2 对策

- 解析逻辑隔离在 Gemini provider 内部
- 不把 chats schema 泄漏成公共契约
- 用 fixture 回归兜底

### 8.3 次级风险

- `ACP` 在不同平台安装形态下可执行入口不一致

### 8.4 对策

- Host 配置层单独增加 Gemini CLI 路径解析
- 优先使用显式配置，其次再做平台探测
