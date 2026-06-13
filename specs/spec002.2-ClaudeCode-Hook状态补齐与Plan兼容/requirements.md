# 需求文档 - spec002.2 ClaudeCode Hook状态补齐与Plan兼容

状态：Draft

## 简介

这个 Spec 解决的是一个已经查明的兼容性缺口。

截至 **2026-06-13** 的核查结果，CodingNS 对 Claude Code 的 Hook 支持处于“半接通”状态：

- 已接：`PreToolUse`、`PermissionRequest`
- 已部分接：`Notification`、`UserPromptSubmit`、`SessionStart`、`Stop`、`StopFailure`、`SessionEnd`
- 未真正接好：`ExitPlanMode`
- 还没转成统一用户可见状态：`PostToolUse`、`PostToolUseFailure`、`PermissionDenied`、`TaskCreated`、`TaskCompleted`、`SubagentStop`、`PreCompact`、`PostCompact`

一句人话：
现在 CodingNS 对 Claude Code 的兼容，只够说“能跑一部分”，还不能说“这就是完整可用的 Claude Code 会话”。

## 术语表

- **Claude Hook**：Claude Code 在关键节点发出的结构化事件，比如 `PreToolUse`、`Notification`、`SessionEnd`。
- **Plan 审批**：Claude Code 准备退出计划模式并进入执行阶段时，需要用户确认计划和后续执行意图的交互。
- **ExitPlanMode**：Claude Code 的工具调用，用来提交计划并请求退出计划模式。
- **阻塞交互**：Claude Code 必须等到外部回复才能继续执行的节点。
- **运行态事件**：不会阻塞 Claude，但会影响用户对当前会话状态判断的事件。
- **Hook Bridge**：Claude Code 本地 hook 命令和 CodingNS Host 之间的事件桥。

## 范围说明

### In Scope

- Claude Code Hook 事件清单补齐
- `ExitPlanMode` 的接入、审批、回写和展示
- Claude Hook 事件在 Host 的统一状态映射
- Claude Plan 在前端任务/计划卡片中的最小兼容展示
- 与现有权限申请、结构化问题、会话运行态的兼容处理

### Out of Scope

- 重构所有 provider 的 Hook 体系
- 新造跨 provider 的通用 Plan DSL
- Butler 巡检计划、调试启动计划等其他“plan”概念的统一
- Claude Code 原始 transcript 解析重写
- 会话页面大改版

## 需求

### 需求 1：系统必须把 Claude Code 的 Hook 支持范围补齐到官方当前清单

**用户故事：** 作为使用 Claude Code 的用户，我希望 CodingNS 至少知道 Claude 官方已经有哪些 Hook 事件，并对关键事件给出明确处理，而不是默默吞掉。

#### 验收标准

1. WHEN 系统生成 Claude Hook settings 或展示兼容能力 THEN System SHALL 明确列出当前支持的 Hook 事件清单。
2. WHEN Claude 发来已知 Hook 事件 THEN System SHALL 明确区分“已完整处理”“已接收但只做状态更新”“暂不处理但显式忽略”。
3. WHEN 官方已存在而当前未接的关键 Hook 被识别出来 THEN System SHALL 在 Spec 和实现中明确补齐计划，而不是继续默认吞掉。

### 需求 2：系统必须支持 Claude Code 的 Plan 审批，也就是 `ExitPlanMode`

**用户故事：** 作为用户，我希望 Claude 在计划模式结束时，能在 CodingNS 里让我确认计划，而不是回退原生终端确认或直接断掉体验。

#### 验收标准

1. WHEN Claude 调用 `ExitPlanMode` THEN System SHALL 通过 Hook bridge 接住这次请求。
2. WHEN `ExitPlanMode` 请求到达 Host THEN System SHALL 把它转换成独立的计划审批请求，而不是普通命令权限申请。
3. WHEN 用户批准计划 THEN System SHALL 按 Claude Hook 协议回写批准结果，并允许 Claude 继续执行。
4. WHEN 用户拒绝计划或审批超时 THEN System SHALL 明确回写拒绝结果，并在会话中保留可追踪状态。
5. WHEN `ExitPlanMode` 附带 `allowedPrompts` THEN System SHALL 展示这些后续执行意图，让用户知道 Claude 计划接下来可能做什么。

### 需求 3：系统必须把 Claude 的计划内容展示到现有对话界面里

**用户故事：** 作为用户，我希望在 Claude 提交计划时，能在对话里直接看到这次计划的大意，而不是只看到一个抽象的审批条目。

#### 验收标准

1. WHEN 会话消息里出现 `ExitPlanMode` THEN System SHALL 能在前端识别这是 Claude 的计划提交，而不是普通工具调用。
2. WHEN 计划内容可解析 THEN System SHALL 在现有任务/计划展示区域显示计划条目、说明和更新时间。
3. WHEN `allowedPrompts` 存在 THEN System SHALL 在计划展示里补充“后续可能执行的操作”说明。
4. WHEN Claude 没给出结构化计划条目 THEN System SHALL 至少保留原始工具调用展开入口，避免信息丢失。

### 需求 4：系统必须补齐 Claude 的关键运行态事件

**用户故事：** 作为用户，我希望在 CodingNS 里看 Claude 会话时，能知道它是刚开始、刚结束、工具失败了、权限被拒了，还是子任务结束了。

#### 验收标准

1. WHEN Claude 发来 `PostToolUse`、`PostToolUseFailure`、`PermissionDenied` THEN System SHALL 记录可追踪的事件状态。
2. WHEN Claude 发来 `TaskCreated`、`TaskCompleted`、`SubagentStop` THEN System SHALL 能把这些状态映射成用户可理解的会话事件。
3. WHEN Claude 发来 `PreCompact`、`PostCompact` THEN System SHALL 记录上下文压缩前后状态，避免用户误判 Claude 卡住。
4. WHEN 这些事件暂时不需要额外审批 THEN System SHALL 至少进入统一运行态或事件流，而不是完全丢掉。

### 需求 5：现有权限申请和问题回答能力不能被破坏

**用户故事：** 作为已经在使用 Claude Hook 的用户，我希望这次补齐新状态时，不会把现在已经能用的权限审批和问题回答搞坏。

#### 验收标准

1. WHEN 系统新增 `ExitPlanMode` matcher 或其他 Hook 支持 THEN System SHALL 保持现有 `AskUserQuestion` 和权限审批流程可用。
2. WHEN 用户处理 `AskUserQuestion`、`PermissionRequest`、普通 `PreToolUse` THEN System SHALL 继续沿用现有回写协议和前端交互。
3. WHEN 新旧 Hook 状态同时存在 THEN System SHALL 明确区分数据类型，避免把问题、权限和计划混成同一种请求。

### 需求 6：Hook 状态接入必须保持可维护，不再继续长散装分支

**用户故事：** 作为后续接手的人，我希望 Claude Hook 的兼容逻辑是按事件类型分层的，而不是再往一个函数里堆 if/else。

#### 验收标准

1. WHEN 新增 Claude Hook 状态 THEN System SHALL 通过清晰的事件分类和映射函数接入，而不是继续堆散装条件分支。
2. WHEN 排查某个 Hook 为什么没显示 THEN System SHALL 能快速知道它属于阻塞交互、运行态事件还是旁路通知。
3. WHEN 后续官方再新增 Hook THEN System SHALL 有明确扩展点，不需要改一圈无关代码。

## 非功能需求

### 非功能需求 1：兼容性

1. WHEN 旧版本会话或旧消息不含新 Hook 状态 THEN System SHALL 保持现有展示，不得因为缺字段报错。
2. WHEN Claude Code 版本升级但仍保持当前 Hook 协议 THEN System SHALL 优先复用现有映射，不要求重做整套集成。

### 非功能需求 2：可靠性

1. WHEN Hook bridge 收到未知事件 THEN System SHALL 安全忽略并留下可排查日志，不得把整个会话打崩。
2. WHEN `ExitPlanMode` 审批超时 THEN System SHALL 回到可预测结果，不得让 Claude 和前端都卡死。

### 非功能需求 3：可维护性

1. WHEN 代码审查 Claude Hook 相关改动 THEN System SHALL 能按“Hook settings、Host 路由、审批映射、运行态映射、前端展示”这五层检查。
2. WHEN 新增测试 THEN System SHALL 能按事件类别做最小验证，不要求每次跑整套会话测试。

## 成功定义

- Claude Code 的 `ExitPlanMode` 能在 CodingNS 里发起、审批、回写并继续执行。
- 前端能识别 Claude 的计划提交，并在现有任务/计划区域展示最小可用内容。
- 关键 Hook 状态不再只剩权限和问题，工具完成/失败、任务结束、压缩前后都能被追踪。
- 现有 `AskUserQuestion` 和权限申请流程保持可用，没有被这次改坏。
