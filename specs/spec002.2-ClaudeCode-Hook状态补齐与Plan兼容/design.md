# 设计文档 - spec002.2 ClaudeCode Hook状态补齐与Plan兼容

状态：Draft

## 1. 概述

### 1.1 目标

- 把 Claude Code Hook 兼容从“半接通”补到“关键状态可用”。
- 先把 `ExitPlanMode` 这条阻塞交互打通。
- 把 Claude Plan 展示接到现有对话任务/计划区域。
- 给 Claude 的关键运行态事件补齐统一映射。
- 保持现有权限申请、问题回答、运行时绑定和 Hook bridge 不被破坏。

### 1.2 覆盖需求

- `requirements.md` 需求 1：系统必须把 Claude Code 的 Hook 支持范围补齐到官方当前清单
- `requirements.md` 需求 2：系统必须支持 Claude Code 的 Plan 审批，也就是 `ExitPlanMode`
- `requirements.md` 需求 3：系统必须把 Claude 的计划内容展示到现有对话界面里
- `requirements.md` 需求 4：系统必须补齐 Claude 的关键运行态事件
- `requirements.md` 需求 5：现有权限申请和问题回答能力不能被破坏
- `requirements.md` 需求 6：Hook 状态接入必须保持可维护，不再继续长散装分支

### 1.3 技术约束

- Claude Hook 仍然通过现有 `scripts/claude-hook-bridge.cjs` 进 Host，不新长第二套桥。
- 阻塞交互优先复用现有 `SessionPermissionRequestService`，但必须把计划审批单独建模，不能假装它是普通命令权限。
- 前端展示必须继续走 `apps/user-app`，并使用现有 i18n 字典。
- 不改 Claude transcript 主读取模型，不依赖重写 provider 历史解析。
- 只跑本轮最小必要测试，不扩成全量回归。

## 2. 先说清楚这次到底怎么分

### 2.1 三类 Hook

这次把 Claude Hook 分三类，别再混着看。

#### 2.1.1 阻塞交互

这类事件 Claude 会停下来等回复。

包括：

- `PreToolUse`
- `PermissionRequest`
- `ExitPlanMode`（通过 `PreToolUse` 的 matcher 接住）
- `AskUserQuestion`

处理原则：

- 必须能创建明确的待处理请求
- 必须能超时
- 必须能回写 Claude 需要的结构

#### 2.1.2 运行态事件

这类事件不会让 Claude 停住，但用户明显关心。

包括：

- `PostToolUse`
- `PostToolUseFailure`
- `PermissionDenied`
- `TaskCreated`
- `TaskCompleted`
- `SubagentStop`
- `PreCompact`
- `PostCompact`
- `SessionStart`
- `UserPromptSubmit`
- `Stop`
- `StopFailure`
- `SessionEnd`

处理原则：

- 至少进入统一事件映射
- 至少能转成运行态、提示或可回放的事件
- 不要求都变成审批卡片

#### 2.1.3 旁路通知

这类事件更偏提示或观测。

包括：

- `Notification`
- `InstructionsLoaded`
- `UserPromptExpansion`
- `MessageDisplay`
- `PostToolBatch`
- `CwdChanged`
- `FileChanged`

处理原则：

- 第一版可以先落轻量事件或日志
- 不能装作没看见
- 后续要有扩展点

### 2.2 为什么 `ExitPlanMode` 不能当成普通权限

因为它根本不是一回事。

普通 Bash 权限问的是：

- 这条命令让不让跑

`ExitPlanMode` 问的是：

- 这份计划你认不认可
- Claude 接下来按这个计划往下做行不行
- 可能需要哪些后续操作类别

如果把它硬塞成普通权限：

- 前端看不懂这是计划审批
- 后端没法展示 `allowedPrompts`
- 用户也分不清自己是在批准计划还是批准某条命令

所以必须单独建模。

## 3. 架构

### 3.1 系统结构

这次结构不重做，只在现有链路补层。

1. `ClaudeRuntimeAdapter` 生成 Hook settings
2. `claude-hook-bridge.cjs` 透传 Hook JSON 到 Host
3. `SessionLiveRuntimeService` 识别 Hook 事件并分流
4. `SessionPermissionRequestService` 处理阻塞交互
5. `user-app` 对话页展示审批、计划和运行态

### 3.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `claude-runtime.ts` | 生成 Hook settings 和 matcher | permissionMode、bridge 配置 | Claude settings JSON |
| `claude-hook-bridge.cjs` | 透传 Hook payload | Claude stdin JSON | Host POST 请求 |
| `session-live-runtime-service.ts` | 路由 Hook 事件 | Hook payload | 阻塞交互处理或运行态更新 |
| `session-permission-request-service.ts` | 处理权限、问题、计划审批 | Hook payload + session binding | 待处理请求 + Claude 回写 |
| `session-task-progress.ts` | 识别并构建计划/任务快照 | 会话消息、工具调用 | 计划卡片数据 |
| `MessageTimeline.tsx` | 渲染结构化问题、工具调用和计划信息 | 消息视图模型 | 用户可见界面 |

### 3.3 关键流程

#### 3.3.1 Claude Plan 审批流程

1. Claude 调用 `ExitPlanMode`。
2. Hook settings 的 `PreToolUse` matcher 命中 `ExitPlanMode`。
3. Hook bridge 把 payload 发给 Host。
4. Host 把它识别成 `plan_approval` 请求。
5. 前端展示计划说明、计划内容和 `allowedPrompts`。
6. 用户批准或拒绝。
7. Host 按 Claude Hook 协议回写批准/拒绝结果。
8. Claude 继续执行或留在计划阶段。

#### 3.3.2 Claude 关键运行态映射流程

1. Hook bridge 收到非阻塞事件。
2. Host 先判断是否属于已知事件。
3. 对于关键事件，映射成统一会话事件或运行态更新。
4. 前端按现有事件流显示状态或提示。

#### 3.3.3 Claude 计划展示流程

1. 对话消息里出现 `ExitPlanMode` 工具调用。
2. 前端解析工具名和结构化输入。
3. 能提取计划条目的，生成 Claude 计划快照。
4. 提取不到完整计划条目的，至少保留原始工具调用展开入口。

## 4. 组件和接口

### 4.1 Hook 支持矩阵

覆盖需求：1、2、4、6

| 类别 | 事件 | 第一阶段处理方式 |
| --- | --- | --- |
| 阻塞交互 | `PreToolUse` | 已有，继续保留 |
| 阻塞交互 | `PermissionRequest` | 已有，继续保留 |
| 阻塞交互 | `AskUserQuestion` | 已有，继续保留 |
| 阻塞交互 | `ExitPlanMode` | 新增计划审批 |
| 运行态 | `PostToolUse` | 新增事件映射 |
| 运行态 | `PostToolUseFailure` | 新增事件映射 |
| 运行态 | `PermissionDenied` | 新增事件映射 |
| 运行态 | `TaskCreated` | 新增事件映射 |
| 运行态 | `TaskCompleted` | 新增事件映射 |
| 运行态 | `SubagentStop` | 新增事件映射 |
| 运行态 | `PreCompact` | 新增事件映射 |
| 运行态 | `PostCompact` | 新增事件映射 |
| 旁路通知 | 其余已知事件 | 轻量接收 + 可扩展 |

### 4.2 数据结构

覆盖需求：2、3、5

#### 4.2.1 `SessionPermissionRequestKind` 扩展

新增：

- `plan_approval`

保留现有：

- `tool_call`
- `command`
- `file_change`
- `permissions`
- `user_input`

#### 4.2.2 `ClaudePlanApprovalPayload`

建议字段：

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `toolName` | `string` | 是 | 固定为 `ExitPlanMode` | 非空 |
| `planText` | `string \| null` | 否 | Claude 给出的计划正文 | 允许为空 |
| `allowedPrompts` | `Array<{ tool: string; prompt: string }>` | 否 | 后续可能执行的操作类别 | 默认为空数组 |
| `rawToolInput` | `unknown` | 是 | 原始工具输入 | 原样保留 |

#### 4.2.3 Claude 计划快照

前端新增 Claude 计划快照来源：

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `source` | `"plan"` | 是 | 复用现有计划卡片来源 | 固定值 |
| `provider` | `ProviderId` | 否 | 当前 provider | 可空 |
| `explanation` | `string \| null` | 否 | 计划摘要或说明 | 可空 |
| `items` | `ConversationTaskItem[]` | 是 | 计划条目 | 至少支持空数组回退 |
| `allowedPrompts` | `Array<{ tool: string; prompt: string }>` | 否 | 计划后续操作提示 | 可空 |

### 4.3 接口契约

覆盖需求：2、4、5、6

#### 4.3.1 Claude Hook settings 生成

- 类型：Function
- 路径或标识：`createClaudeHookSettingsFile(...)`
- 输入：bridge 配置、permissionMode
- 输出：Claude settings JSON
- 校验：
  - `ExitPlanMode` 必须进入 `PreToolUse` matcher
  - 不得移除现有 `AskUserQuestion` matcher
- 错误：生成失败时保持现有运行时错误处理

#### 4.3.2 Claude Hook 路由

- 类型：Function
- 路径或标识：`handleClaudeHookEvent(...)`
- 输入：`hook_event_name`、sessionId、cwd、toolName、toolInput
- 输出：
  - 阻塞交互：Claude Hook 协议回写
  - 非阻塞事件：运行态或事件更新
- 校验：
  - 已知事件走已知分流
  - 未知事件安全忽略
- 错误：不得因为未知事件把会话打崩

#### 4.3.3 计划审批回写

- 类型：Function
- 路径或标识：`buildClaudeExitPlanModeBridgeResponse(...)`
- 输入：approve / deny、reason、可选附加字段
- 输出：Claude 认可的 Hook 回写 JSON
- 校验：
  - 批准和拒绝都要有明确结果
  - 与普通 `PreToolUse` 的回写结构分开处理
- 错误：回写失败按现有 Hook bridge 失败路径处理

## 5. 数据与状态模型

### 5.1 请求状态

计划审批复用现有请求状态：

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `pending` | 等用户处理 | 收到 `ExitPlanMode` | 用户处理或超时 |
| `approved` | 已批准 | 用户批准 | Claude 已拿到回写 |
| `declined` | 已拒绝 | 用户拒绝 | Claude 已拿到回写 |
| `expired` | 审批超时 | 超时 | 请求结束 |

### 5.2 Hook 事件状态分类

| 分类 | 说明 | 主要去向 |
| --- | --- | --- |
| `blocking` | Claude 等待外部回复 | `SessionPermissionRequestService` |
| `runtime_update` | 改变运行态 | `SessionLiveRuntimeService` |
| `timeline_event` | 需要在会话里可见 | 前端事件流 / 消息视图 |
| `ignored` | 当前不处理，但显式记录 | debug / diagnostics |

## 6. 错误处理

### 6.1 错误类型

- `CLAUDE_PLAN_REQUEST_INVALID`：`ExitPlanMode` 输入结构不合法
- `CLAUDE_PLAN_REPLY_NOT_SUPPORTED`：计划审批请求没有可回写通道
- `CLAUDE_HOOK_EVENT_UNSUPPORTED`：收到暂不支持的事件
- `CLAUDE_HOOK_EVENT_BINDING_MISSING`：找不到会话绑定

### 6.2 处理策略

1. 输入验证错误：拒绝本次计划审批创建，并保留原始 payload 便于排查。
2. 未知 Hook 事件：安全忽略，记录 debug，不影响会话主流程。
3. 计划审批超时：明确回写拒绝或 ask-back 策略，不能无限挂起。
4. 前端解析失败：保留原始工具调用展开入口，不丢信息。

## 7. 测试策略

### 7.1 单元测试

- `resolveClaudePreToolUseHookMatchers()` 包含 `ExitPlanMode`
- Claude 计划审批请求规范化
- Claude 计划回写结构生成
- Claude 计划快照解析

### 7.2 集成测试

- Host 收到 `ExitPlanMode` 后创建 `plan_approval`
- 用户批准/拒绝后回写 Claude bridge response
- 现有 `AskUserQuestion` 和 `PermissionRequest` 不回归
- 关键 Hook 事件能进入统一映射

### 7.3 前端测试

- `MessageTimeline` / `session-task-progress` 能识别 Claude Plan
- 现有结构化问题展示不回归

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §4.1、§4.3.2 | Hook 支持清单检查 + 集成测试 |
| `requirements.md` 需求 2 | `design.md` §3.3.1、§4.2.2、§4.3.3 | 计划审批集成测试 |
| `requirements.md` 需求 3 | `design.md` §3.3.3、§4.2.3 | 前端单测 |
| `requirements.md` 需求 4 | `design.md` §2.1.2、§4.1 | Hook 运行态映射测试 |
| `requirements.md` 需求 5 | `design.md` §2.1.1、§6.2 | 回归测试 |

## 8. 风险与待确认项

### 8.1 风险

- Claude `ExitPlanMode` 的真实回写协议如果还有隐藏字段，第一版可能需要追加兼容。
- Claude 计划正文不一定总能结构化提取，前端可能要容忍“只有原始工具调用”的回退。
- 如果继续把太多状态塞进 `SessionPermissionRequestService`，后面会再次变乱。

### 8.2 待确认项

- `ExitPlanMode` 在当前 Claude 2.1.177 下的完整 Hook payload 字段是否稳定。
- `TaskCreated / TaskCompleted` 是只做时间线事件，还是还要反推任务卡片。
- `Notification` 第一版是否要直接转 toast，还是先只落会话事件。
