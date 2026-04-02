# 设计文档 - spec010.3-KimiCLI兼容接入

状态：Draft

## 1. 概述

### 1.1 目标

- 把 Kimi 接进现有 provider 体系，而不是新增一套命令分支
- 明确 Kimi `wire mode`、命令模式、本地会话目录三条链路的主次关系
- 让 Kimi 的原生 session id、历史、实时运行、运行中引导和模型配置在项目里有稳定落点
- 借这次接入继续收口当前仓库的 provider 硬编码

### 1.2 覆盖需求

- `requirements.md` 需求 1：Kimi 必须作为正式 provider 接入
- `requirements.md` 需求 2：Kimi 运行时主链路必须优先走官方 wire mode
- `requirements.md` 需求 3：历史与会话发现必须绑定官方原生 session id
- `requirements.md` 需求 4：运行中引导和提问能力必须有清晰映射
- `requirements.md` 需求 5：不能破坏现有运行时语义
- `requirements.md` 需求 6：主链路、fallback 和本地样本来源必须分层明确
- `requirements.md` 需求 7：必须有真实样本和回归
- `requirements.md` 需求 8：排障必须能区分三层链路

### 1.3 技术约束

- 后端：`Node.js 22 + TypeScript + Fastify + ws`
- 会话同步核心：`packages/session-sync-core`
- Kimi 官方已经公开会话目录和配置文件，这让发现与历史读取有更清晰依据
- Kimi 官方运行时优先应使用 `wire mode`
- 当前项目仍残留少量 provider 名字硬编码，需要在接入过程中继续清理

## 2. 核心判断

### 2.1 主接入路线

Kimi 主接入路线定为：

1. `Kimi Wire Mode` 负责新建会话、恢复会话、发送 prompt、运行中引导和中断
2. `Kimi 命令模式 + stream-json` 负责主链路不可用时的运行时 fallback
3. `Kimi Local Session Store` 负责会话发现、历史读取、样本抽取和排障

原因很简单：

- `wire mode` 是官方公开的程序化协议，天然适合接 `ProviderRuntimeAdapter`
- 本地会话目录是公开的数据位置，适合接 `ProviderAdapter`
- 命令模式适合兜底，但不应该盖过 `wire mode`

### 2.2 明确禁止的路线

- 不允许把 Kimi 只接成一个 `spawn("kimi")` 的黑盒命令
- 不允许把本地 `context.jsonl` / `wire.jsonl` 混成运行时事件主真相
- 不允许为了 Kimi 在前端主流程里继续散落 `provider === "kimi"` 判断
- 不允许假装 Kimi 的运行中输入语义和所有现有 provider 完全一样

## 3. 架构

### 3.1 目标结构

Kimi 接入由六块组成：

1. `provider-contract cleanup`：继续拆剩余 provider 硬编码
2. `kimi-provider-adapter`：会话发现、历史读取、能力描述
3. `kimi-runtime-adapter`：新建、恢复、发送、中断、运行中引导和事件流
4. `kimi-message-normalizer`：把 `wire mode` 或命令模式事件映射到统一消息模型
5. `kimi-capability-mapper`：输出 Kimi provider/session capability
6. `kimi-fixture-kit`：沉淀本地会话样本、wire 样本和回归工具

### 3.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `provider-contract cleanup` | 清理 Kimi 接入前的公共障碍 | 当前类型、DTO、注册逻辑 | 可扩展 provider 基础层 |
| `KimiAdapter` | 发现会话、读取历史、读 capability | Local Session Store、config.toml | 统一 session/history/capability |
| `KimiRuntimeAdapter` | 启动、恢复、发送、中断和运行中输入 | wire mode，必要时命令模式 | 统一 runtime 事件 |
| `KimiMessageNormalizer` | 归一化运行时事件与历史记录 | wire 事件、jsonl、stream-json | `NormalizedMessage` |
| `KimiCapabilityMapper` | 生成 Kimi capability | Kimi 原生能力和项目接入现状 | `ProviderCapabilities` |
| `KimiFixtureKit` | 脱敏样本、回放、断言 | context/wire/state 样本 | fixture 和测试报告 |

## 4. 关键设计

### 4.1 先拆当前硬编码

Kimi 接入前需要重点检查的点，和 Gemini 基本同源：

- [provider-ui.ts](/Users/jackson/Documents/Code/CodingNS/apps/user-app/src/features/conversation/capability/provider-ui.ts#L23)
- [types.ts](/Users/jackson/Documents/Code/CodingNS/apps/user-app/src/preferences/types.ts#L3)
- [user-preference-store.ts](/Users/jackson/Documents/Code/CodingNS/apps/user-app/src/preferences/user-preference-store.ts#L40)
- [profile-service.ts](/Users/jackson/Documents/Code/CodingNS/apps/host/src/modules/preferences/profile-service.ts#L23)
- [domain.ts](/Users/jackson/Documents/Code/CodingNS/apps/host/src/types/domain.ts#L236)
- [session-live-runtime-service.ts](/Users/jackson/Documents/Code/CodingNS/apps/host/src/modules/sessions/session-live-runtime-service.ts#L2234)

### 4.2 会话绑定模型

Kimi 在项目里沿用现有 `session binding` 机制，字段语义如下：

| 字段 | 设计 |
| --- | --- |
| `provider` | 固定为 `kimi` |
| `providerSessionId` | 对应 Kimi 官方原生 session id |
| `rawStoreRef` | 使用稳定逻辑引用：`kimi://session/<sessionId>` |
| `rawRef` | 细粒度引用到 context/wire/state 或事件锚点 |

建议原始引用格式：

- session：`kimi://session/<sessionId>`
- context line：`kimi://session/<sessionId>/context#line=<n>`
- wire line：`kimi://session/<sessionId>/wire#line=<n>`
- state：`kimi://session/<sessionId>/state`

### 4.3 会话发现与历史读取设计

#### 4.3.1 会话发现

会话发现优先走本地会话目录：

1. 扫描 `~/.kimi/sessions/<work-dir-hash>/<session-id>/`
2. 读取 `state.json`
3. 结合 `context.jsonl` 生成标题、消息数和最后活动时间

原因：

- 这套路径和文件位置是官方明确公开的
- 比起猜私有 SQLite，这条线更适合做正式只读协议

#### 4.3.2 历史读取

历史读取优先走：

1. `context.jsonl`
2. 必要时参考 `wire.jsonl`
3. 运行期增量补历史

原则：

- `context.jsonl` 是会话语义主历史
- `wire.jsonl` 更多承担运行时事件和排障补充
- 不让前端直接理解 Kimi 私有细节，统一由 provider 内部归一化

### 4.4 实时运行时设计

#### 4.4.1 主运行时

主运行时优先走 `wire mode`：

1. 建立 wire 连接
2. 初始化运行上下文
3. 新建或恢复原生 session
4. 发送 prompt
5. 接收事件流
6. 处理中断和运行中引导

#### 4.4.2 运行中输入

Kimi 如果原生支持运行中引导、提问或 steer 类动作，统一映射到：

- `inRunInputMode`
- permission/request 视图
- 运行时 steering 接口

这里不能偷懒。要么明确支持，要么明确降级。最蠢的是假装不存在。

#### 4.4.3 fallback

当 `wire mode` 不可用时，回退到：

- `kimi --print --output-format stream-json`

fallback 只承担：

- 实时输出
- 恢复原生会话
- 基础发送
- 基础中断

### 4.5 消息模型设计

Kimi 第一阶段继续映射到现有统一消息模型：

| Kimi 数据 | 第一阶段映射 |
| --- | --- |
| user text | `kind = text` |
| assistant text | `kind = text` |
| reasoning / thinking | `kind = thinking` |
| tool call | `kind = tool_call` |
| tool result | `kind = tool_result` |
| question / prompt | permission 或 interactive request 扩展 |
| runtime status | 运行状态事件 |

补充规则：

- `context.jsonl` 的会话顺序必须稳定恢复
- `wire.jsonl` 的运行时事件不能直接泄漏给前端，要先归一化
- 未支持的事件类型要保留类型信息和原始引用，不允许静默吞掉

### 4.6 capability 设计

第一阶段 Kimi capability 建议：

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
- `inRunInputMode = queued_guidance` 或 `streaming_guidance`

其中最关键的是：

- Kimi 的运行中引导能力不能被压成 `none`
- 如果当前阶段还没做完完整 UI，也必须通过 capability 和 limitations 把边界写清楚

### 4.7 模型与配置设计

Kimi 模型配置优先从：

1. `~/.kimi/config.toml`
2. provider/model 配置文件

输出到：

- `modelOptions`
- 默认模型
- limitations

## 5. 数据与状态模型

### 5.1 样本结构

第一阶段建议沉淀四类真实样本：

- `context.jsonl` 历史样本
- `wire.jsonl` 运行时样本
- `state.json` 元数据样本
- `wire mode` 联调事件样本

### 5.2 运行状态映射

| Kimi 状态 | 项目运行状态 |
| --- | --- |
| session created | `starting` |
| first assistant event | `running` |
| completed | `completed` |
| interrupted | `interrupted` |
| error | `failed` |

## 6. 兼容与降级策略

### 6.1 对现有 provider 的兼容

- Kimi 不能改动现有 provider 的 rawRef 语义
- Kimi 不能要求主会话页面为它单独开分支
- Kimi 扩展字段一律走可选字段，老前端可安全忽略

### 6.2 Kimi 自身降级策略

- `wire mode` 不可用：回退命令模式
- 命令模式不可用：至少保留历史读取和错误提示
- 某类运行中引导尚未接 UI：明确在 capability 中标限制

## 7. 验证策略

### 7.1 核心验证

- `KimiAdapter` 单元测试
- `KimiRuntimeAdapter` 单元测试
- 基于 `context.jsonl / wire.jsonl / state.json` 的 fixture 回放测试
- `wire -> fallback -> history` 三条链路的集成验证

### 7.2 验收标准

- 项目内可以创建 Kimi 草稿并查询 capability
- Host 可以发现 Kimi 原生会话
- 运行时优先通过 `wire mode` 新建和恢复会话
- fallback 工作时，系统能明确记录来源
- 历史消息可从官方本地样本恢复

## 8. 风险与对策

### 8.1 最大风险

- Kimi `wire mode` 在不同安装环境下的握手和事件细节可能存在版本差异

### 8.2 对策

- 运行时协议单独隔离在 `KimiRuntimeAdapter`
- 基于真实 wire 样本做 fixture
- 保留命令模式 fallback

### 8.3 次级风险

- 本地 `context.jsonl / wire.jsonl / state.json` 字段未来演进

### 8.4 对策

- 解析逻辑隔离在 Kimi provider 内部
- 不把本地字段格式泄漏成公共协议
- 用 fixture 回归兜底
