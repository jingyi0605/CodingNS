# 设计文档 - spec013-代码管家平台与跨工作区巡检编排

状态：Draft

## 1. 概述

### 1.1 目标

- 把“代码管家”做成平台一等能力，而不是 provider 包装壳
- 统一 `Codex`、`Claude Code` 的会话编排、记忆回灌、巡视与验证入口
- 先建立只读巡检和验证闭环，再逐步放开受控执行能力
- 复用现有工作区、会话、终端、进程、provider 扩展底座

### 1.2 覆盖需求

- `requirements.md` 需求 1：项目与会话正式模型
- `requirements.md` 需求 2：provider 统一适配
- `requirements.md` 需求 3：统一指令注入
- `requirements.md` 需求 4：项目级长期记忆
- `requirements.md` 需求 5：周期巡视
- `requirements.md` 需求 6：只读巡检与受控执行
- `requirements.md` 需求 7：建议、总结、风险提示
- `requirements.md` 需求 8：浏览器与视觉验证
- `requirements.md` 需求 9：执行/验证/记忆回写闭环
- `requirements.md` 需求 10：审计与回溯
- `requirements.md` 需求 11：兼容现有主链路

### 1.3 技术约束

- 工作区、存储、鉴权边界沿用 `spec001`
- 会话发现、续接、归一化沿用 `spec002`
- 终端与 PTY 能力沿用 `spec006`
- 进程启动、日志、端口能力沿用 `spec007`
- provider 扩展协议沿用 `spec010`
- 并行 worktree 与多尝试编排能力沿用 `spec012`
- 管家初始化、控制会话、聚合对话和前端工作台边界拆到 `spec013.1`

## 2. 核心思路

### 2.1 为什么“代码管家”必须是平台层，而不是 provider 层

provider 只解决“某一类 agent 怎么跑”，但你要解决的是：

1. 多项目统一登记
2. 多会话持续巡视
3. 长期记忆沉淀
4. 跨 provider 统一建议
5. 统一验证与授权

这些事没有一项应该交给某个 provider 私有实现。

所以系统必须把 `ButlerProject`、`ButlerSession`、`ProjectMemory`、`PatrolPlan`、`VerificationRun` 做成平台正式对象，然后通过 `ProviderAdapter` 去调用不同 provider。

### 2.2 为什么“统一人格”不能等于“统一文件名”

这里最容易走歪。

用户真正要的是“统一的代码管家认知”，不是“所有 provider 都恰好读同一个文件名”。

所以平台应该维护统一的 `InstructionEnvelope`，再由适配层决定怎么落到具体 provider：

- `Codex`：映射到 `AGENTS.md` 或等效上下文
- `Claude Code`：映射到 `CLAUDE.md`、`--append-system-prompt`、`--system-prompt-file`

上层只关心规则语义，不关心 provider 吃的是哪种包装。

### 2.3 为什么长期记忆必须独立于 provider

provider 自带 memory 解决的是“这个 agent 下次别忘”，但平台要解决的是：

- 项目换了 provider 也不能失忆
- 项目换了工作树也不能失忆
- 某条错误记忆必须能纠正
- 记忆必须能审计、打标签、降权和归档

所以 `ProjectMemory` 必须由平台独立存储，provider memory 只作为辅助手段。

### 2.4 为什么第一版必须先只读，后写入

一上来就做“全自动开发”是糟糕品味。

正确顺序是：

1. 先会登记项目和会话
2. 先会定时巡视和总结
3. 先会做真实验证
4. 再在授权下执行修改

如果连项目现状都看不准、验证都跑不稳，就放 agent 自动写代码，那不是自治，那是放火。

## 3. 总体架构

### 3.1 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `butler-project-service` | 管理托管项目、默认策略、项目视图 | 项目登记请求 | `ButlerProject` |
| `butler-session-service` | 管理受管会话登记、续接、快照 | provider 会话引用、项目上下文 | `ButlerSession`、`SessionCheckpoint` |
| `provider-adapter-registry` | 统一分发 provider 能力调用 | `providerId`、能力请求 | 适配器实例 |
| `instruction-adapter` | 把统一规则映射为 provider 启动上下文 | `InstructionEnvelope` | provider 可消费输入 |
| `project-memory-service` | 管理项目级长期记忆 | 写入/检索请求 | `ProjectMemory` |
| `patrol-planner` | 管理巡视计划 | 调度配置 | `PatrolPlan` |
| `patrol-runner` | 执行实际巡视、生成总结 | `PatrolPlan`、项目状态 | `PatrolRun` |
| `verification-runner` | 执行测试、浏览器、截图、健康检查 | 验证任务定义 | `VerificationRun` |
| `approval-gate` | 控制写入类动作授权 | 动作请求、策略 | `ALLOW/DENY/PENDING_APPROVAL` |
| `execution-orchestrator` | 在授权范围内发起 agent 执行 | 任务请求、项目上下文 | 执行结果 |
| `audit-timeline-service` | 汇总审计与回溯事件 | 各模块事件 | 项目时间线 |

### 3.2 与现有能力的关系

- 会话基础入口、消息同步、续接索引复用 `spec002`
- 命令运行、日志、进程状态复用 `spec006/spec007`
- provider 扩展点复用 `spec010`
- 若需要并行为多个 provider 派生独立工作目录，可复用 `spec012`

原则很死：**平台层做编排与统一模型，不重复实现底层会话和进程能力。**

### 3.3 和 `spec013.1` 的职责切分

这里必须说死，不然后面一定又会把层次写烂：

- `spec013` 保留平台事实层和执行层
- `spec013.1` 承接管家初始化、控制会话、聚合上下文、聊天 API 和工作台 UI

也就是说，`spec013` 不再新增下面这些对象和入口：

- `ButlerProfile`
- `ButlerControlSession`
- `ButlerContextSnapshot`
- 独立管家聊天接口
- 前端管家工作台页面

`spec013` 只需要保证这些底层事实对上层稳定可读、可续接、可触发。

## 4. 能力分层

### 4.1 控制面

控制面回答“系统知道什么”和“系统打算做什么”：

- 哪些项目受托管
- 哪些会话活着
- 哪些项目需要巡视
- 哪些风险未处理
- 哪些任务处于待授权状态

这里说的“控制面”是平台态势视角，不是用户直接聊天的 Butler UI。

用户真正可见的管家控制会话、聊天入口和工作台页面，统一在 `spec013.1` 实现。

### 4.2 执行面

执行面回答“系统实际做了什么”：

- 启动/续接 provider 会话
- 拉取项目上下文和记忆
- 执行巡视动作
- 发起开发任务
- 跑测试与浏览器验证

### 4.3 记忆面

记忆面回答“系统学到了什么”：

- 架构约束
- 项目约定
- 历史故障
- 已验证的修复方式
- 已确认的风险模式

### 4.4 审计面

审计面回答“谁在什么时候通过什么方式干了什么”：

- 会话创建与续接
- 巡视执行
- 验证执行
- 授权决策
- 记忆写入

## 5. 数据结构

### 5.1 `ButlerProject`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 项目 ID | 全局唯一 |
| `workspaceId` | string | 是 | 所属工作区 | 外键 |
| `title` | string | 是 | 项目标题 | 长度 1-120 |
| `repoPath` | string | 是 | 仓库路径 | 位于工作区边界内 |
| `defaultProviderId` | string | 否 | 默认 provider | 可为空 |
| `instructionProfileId` | string | 否 | 默认指令模板 | 可为空 |
| `approvalMode` | string | 是 | 默认授权模式 | `READONLY/CONTROLLED/AUTO` |
| `riskLevel` | string | 是 | 当前风险等级 | `LOW/MEDIUM/HIGH` |
| `lastPatrolAt` | string | 否 | 最近巡视时间 | ISO8601 |
| `lastVerificationAt` | string | 否 | 最近验证时间 | ISO8601 |
| `createdAt` | string | 是 | 创建时间 | ISO8601 |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

### 5.2 `ButlerSession`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 会话 ID | 全局唯一 |
| `projectId` | string | 是 | 所属项目 | 外键 |
| `providerId` | string | 是 | provider 标识 | 非空 |
| `sessionRef` | string | 是 | provider 会话引用 | provider 内稳定可查 |
| `cwd` | string | 是 | 会话工作目录 | 位于项目边界内 |
| `status` | string | 是 | 会话状态 | `IDLE/RUNNING/BLOCKED/FAILED/CLOSED` |
| `capabilities` | json | 是 | 会话能力快照 | 默认空对象 |
| `lastSummary` | string | 否 | 最近摘要 | 可为空 |
| `lastCheckpointAt` | string | 否 | 最近快照时间 | ISO8601 |
| `createdAt` | string | 是 | 创建时间 | ISO8601 |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

### 5.3 `SessionCheckpoint`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 快照 ID | 全局唯一 |
| `sessionId` | string | 是 | 所属会话 | 外键 |
| `summary` | string | 是 | 当前阶段摘要 | 非空 |
| `progressStatus` | string | 是 | 进展状态 | `UNKNOWN/WORKING/BLOCKED/DONE` |
| `riskFlags` | json | 是 | 风险标记 | 默认空数组 |
| `nextSuggestion` | string | 否 | 下一步建议 | 可为空 |
| `capturedAt` | string | 是 | 采集时间 | ISO8601 |

### 5.4 `ProjectMemory`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 记忆 ID | 全局唯一 |
| `projectId` | string | 是 | 所属项目 | 外键 |
| `memoryType` | string | 是 | 记忆类型 | `ARCH/RULE/DECISION/INCIDENT/VERIFY/NOTE` |
| `scopePath` | string | 否 | 作用路径 | 可为空 |
| `content` | string | 是 | 记忆内容 | 非空 |
| `sourceType` | string | 是 | 来源类型 | `USER/SYSTEM/SESSION/VERIFY` |
| `sourceRef` | string | 否 | 来源引用 | 可为空 |
| `confidence` | number | 是 | 置信度 | 0-1 |
| `status` | string | 是 | 状态 | `ACTIVE/CANDIDATE/ARCHIVED/SUPERSEDED` |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

### 5.5 `PatrolPlan`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 计划 ID | 全局唯一 |
| `projectId` | string | 是 | 所属项目 | 外键 |
| `name` | string | 是 | 计划名称 | 非空 |
| `scheduleType` | string | 是 | 调度类型 | `INTERVAL/CRON` |
| `scheduleValue` | string | 是 | 调度表达式 | 非空 |
| `mode` | string | 是 | 巡视模式 | `READONLY/CONTROLLED` |
| `patrolSpec` | json | 是 | 巡视任务定义 | 默认空对象 |
| `enabled` | boolean | 是 | 是否启用 | 默认 `true` |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

### 5.6 `PatrolRun`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 巡视执行 ID | 全局唯一 |
| `planId` | string | 是 | 来源计划 | 外键 |
| `projectId` | string | 是 | 所属项目 | 外键 |
| `status` | string | 是 | 执行状态 | `RUNNING/PASSED/FAILED/CANCELLED` |
| `summary` | string | 否 | 巡视总结 | 可为空 |
| `riskLevel` | string | 否 | 风险等级 | 可为空 |
| `suggestions` | json | 是 | 建议列表 | 默认空数组 |
| `startedAt` | string | 是 | 开始时间 | ISO8601 |
| `finishedAt` | string | 否 | 结束时间 | ISO8601 |

### 5.7 `VerificationRun`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 验证 ID | 全局唯一 |
| `projectId` | string | 是 | 所属项目 | 外键 |
| `sessionId` | 否 | 否 | 关联会话 | 可为空 |
| `verificationType` | string | 是 | 验证类型 | `TEST/HEALTH/BROWSER/VISUAL/METRIC` |
| `status` | string | 是 | 结果状态 | `RUNNING/PASSED/FAILED/SKIPPED` |
| `artifactRefs` | json | 是 | 产物引用 | 默认空数组 |
| `summary` | string | 否 | 摘要 | 可为空 |
| `startedAt` | string | 是 | 开始时间 | ISO8601 |
| `finishedAt` | string | 否 | 结束时间 | ISO8601 |

## 6. ProviderAdapter 设计

### 6.1 统一接口

```ts
interface ProviderAdapter {
  providerId: string
  getCapabilities(): ProviderCapabilities
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>
  resumeSession(input: ResumeSessionInput): Promise<ResumeSessionResult>
  captureCheckpoint(input: CaptureCheckpointInput): Promise<SessionCheckpointDraft>
  executeTask(input: ExecuteTaskInput): Promise<ExecuteTaskResult>
  summarizeSession(input: SummarizeSessionInput): Promise<SessionSummaryResult>
}
```

### 6.2 `CodexAdapter`

负责：

- 使用 `AGENTS.md` 或等效上下文完成项目规则注入
- 对接 `Codex` 会话启动、自动化、云端或本地能力声明
- 提供能力位，例如联网、自动化、浏览器、写入许可

### 6.3 `ClaudeCodeAdapter`

负责：

- 使用 `CLAUDE.md`、`--append-system-prompt`、`--system-prompt-file` 注入规则
- 对接 `Claude Code` 会话创建、续接、remote control、scheduled tasks
- 暴露浏览器、scheduled tasks、session resume 等能力位

### 6.4 能力位建模

系统不应该只关心 provider 名称，还要关心能力：

| 能力位 | 说明 |
| --- | --- |
| `supportsSessionResume` | 是否支持续接现有会话 |
| `supportsInstructionFile` | 是否支持项目级指令文件 |
| `supportsSystemPromptAppend` | 是否支持附加系统提示词 |
| `supportsScheduledTask` | 是否支持原生周期任务 |
| `supportsRemoteControl` | 是否支持远程控制 |
| `supportsBrowserAutomation` | 是否支持浏览器自动化 |
| `supportsVisualVerification` | 是否支持视觉验证 |
| `supportsAgentWrite` | 是否支持 agent 执行写入 |

## 7. InstructionAdapter 设计

### 7.1 统一输入模型

`InstructionEnvelope` 至少包含：

- 项目规则摘要
- 任务目标
- 写入边界
- 验证要求
- 风险提醒
- 相关记忆摘要

### 7.2 输出策略

- 对 `Codex`：
  - 优先项目级 `AGENTS.md`
  - 必要时叠加运行期上下文
- 对 `Claude Code`：
  - 优先 `CLAUDE.md`
  - 需要额外补充时使用 append prompt

### 7.3 降级规则

若 provider 不支持某个注入方式：

1. 退化到等效 prompt 注入
2. 在审计事件中记录降级
3. 将不支持项回传给上层

## 8. 关键流程

### 8.1 项目纳管

1. 用户选择工作区和仓库
2. 系统创建 `ButlerProject`
3. 绑定默认 provider、默认授权模式、默认巡视计划
4. 初始化空的项目记忆容器

### 8.2 创建或登记会话

1. 用户选择 provider 与工作目录
2. `instruction-adapter` 构造启动上下文
3. `provider-adapter` 创建会话或登记已有会话
4. 平台生成 `ButlerSession`
5. 立即采集第一份 `SessionCheckpoint`

### 8.3 周期巡视

1. 调度器触发 `PatrolPlan`
2. `patrol-runner` 读取项目状态、会话状态、最近验证与记忆
3. 对 provider 会话执行总结/检查动作
4. 汇总生成巡视结论
5. 必要时生成建议或待授权任务

### 8.4 受控执行

1. 用户接受建议或主动下发任务
2. `approval-gate` 判断动作级别
3. 若允许执行，则 `execution-orchestrator` 调用 provider 会话执行
4. 结束后采集结果和新快照
5. 必要时触发验证

### 8.5 验证执行

1. 根据项目或任务配置生成验证任务
2. `verification-runner` 执行测试、浏览器、视觉或指标检查
3. 记录 `VerificationRun`
4. 将结果回写项目与会话摘要

### 8.6 记忆回写

1. 从会话摘要、执行结果、验证结果中抽取候选经验
2. 生成 `ProjectMemory` 候选条目
3. 根据策略自动确认或等待人工确认
4. 后续在相关任务中回灌

## 9. 授权与风险控制

### 9.1 授权模式

| 模式 | 含义 |
| --- | --- |
| `READONLY` | 只允许读取、总结、建议、验证读操作 |
| `CONTROLLED` | 允许执行有限写入和命令，但受规则约束 |
| `AUTO` | 允许自动执行已白名单化动作，仅用于后续阶段 |

### 9.2 风险分级

| 风险级别 | 示例 |
| --- | --- |
| `LOW` | 会话总结、读取文件、读取测试结果 |
| `MEDIUM` | 运行测试、运行浏览器验证、生成修改建议 |
| `HIGH` | 修改代码、执行写入脚本、切换分支、联网写操作 |

### 9.3 决策规则

- 高风险动作默认不自动执行
- 验证动作默认允许，但要记录审计
- 任何超出项目边界路径的动作直接拒绝

## 10. MVP 方案

### 10.1 MVP-1：只读管家

交付：

- `ButlerProject` 与 `ButlerSession`
- `Codex` / `Claude Code` 基础适配
- 统一指令注入
- `ProjectMemory`
- `PatrolPlan` 与 `PatrolRun`
- 项目总结、风险提示、建议输出

不做：

- 自动写代码
- 自动执行高风险命令
- 自动合并代码

### 10.2 MVP-2：真实验证

交付：

- `VerificationRunner`
- 命令测试与健康检查
- 浏览器/视觉验证
- 验证结果回写

不做：

- 指标平台大规模接入
- 复杂分布式验收编排

### 10.3 MVP-3：受控执行

交付：

- `ApprovalGate`
- 受控执行 orchestration
- 任务结果和记忆候选回写

不做：

- 全自动长期无人值守开发
- 自动发布和自动 merge

## 11. 兼容与迁移

### 11.1 对现有系统的兼容要求

- 不启用代码管家时，现有工作区与会话流程不变
- 现有 provider 主链路继续可用
- 现有进程、终端、Git、工作树能力继续由原模块负责

### 11.2 迁移路径

1. 先允许用户手动把项目纳入管家
2. 先纳管现有会话，不强制新建
3. 再补巡视与验证
4. 最后才开放受控执行

## 12. 风险

### 12.1 最大风险

- provider 差异被低估，导致适配层泄漏到上层
- 错误记忆污染后续会话
- 验证执行器不稳定，导致“假通过”
- 授权模型过宽，导致误改代码

### 12.2 对策

- 强制所有 provider 差异收敛到 `ProviderAdapter` 和 `InstructionAdapter`
- 所有记忆带来源、置信度和状态
- 验证与执行分层，验证失败不得包装成成功
- 高风险动作默认走审批
