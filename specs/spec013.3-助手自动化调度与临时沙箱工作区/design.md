# 设计文档 - spec013.3-助手自动化调度与临时沙箱工作区

状态：Draft

## 1. 概述

### 1.1 目标

- 给 Butler 补正式的自动化任务模型，而不是继续堆一次性 timer
- 支持 `once / interval / cron / condition` 四类触发方式
- 给助手补独立的临时沙箱工作区，让临时真实会话不必绑定现有项目
- 扩展真实会话启动目标，支持 `project / workspace / sandbox`
- 保留当前 `timers.*` 兼容行为，不破坏已上线助手链路

### 1.2 覆盖需求

- `requirements.md` 需求 1：正式自动化模型
- `requirements.md` 需求 2：单次、定时循环、条件循环
- `requirements.md` 需求 3：`timers.*` 兼容入口
- `requirements.md` 需求 4：后台任务体系接入
- `requirements.md` 需求 5：自动化执行记录
- `requirements.md` 需求 6：助手私有沙箱工作区
- `requirements.md` 需求 7：会话目标支持 `project / workspace / sandbox`
- `requirements.md` 需求 8：沙箱晋升与保留
- `requirements.md` 需求 9：CLI / Host API / Butler 页面入口
- `requirements.md` 需求 10：失败隔离与兼容

### 1.3 与前置 Spec 的关系

- `spec013`：提供 Butler 项目、会话、巡视、验证这些事实层对象
- `spec013.1`：提供控制会话和独立控制面工作目录
- `spec013.2`：提供助手能力面和 CLI 代理执行入口
- `spec013.3`：补“什么时候继续做”和“在哪个临时空间里做”

一句话：

- `spec013.1` 解决“助手自己怎么聊”
- `spec013.2` 解决“助手怎么查和怎么代理做”
- `spec013.3` 解决“助手怎么持续做、以及临时在哪做”

## 2. 核心思路

### 2.1 为什么现有 timer 不够

现有 `ButlerControlTimer` 只有这些字段：

- 目标控制会话
- 一段内容
- 一个到点时间
- 一个最终状态

这东西适合“30 分钟后提醒我继续”，但不适合下面这些真实需求：

- 每小时巡检一次
- 发现远端新 tag 再通知
- 条件没满足就继续等，不是触发一次就结束
- 看历史时，区分“调度对象”和“执行结果”

所以不能在旧 `timer` 上继续打补丁加字段。那会把一次性投递对象缝成四不像。

### 2.2 为什么不直接拿 PatrolPlan 冒充助手自动化

仓库里已经有 `PatrolPlan`，而且它已经支持 `interval / cron`。

这说明平台已有两条有价值的东西：

- 触发器计算逻辑已经证明可行
- 周期调度和 `nextRunAt` 推进不是新问题

但它也不能直接拿来冒充助手自动化，因为 Patrol 解决的是“项目巡检”：

- 目标固定是 Butler 项目
- 动作固定是创建 patrol run
- UI 和审计语义都围着巡检展开

正确做法不是把 `PatrolPlan` 强行改成万金油，而是：

1. 抽出共用的触发器计算和调度基础
2. 为 Butler 自动化单独建正式模型
3. 保持 Patrol 和 Butler Automation 各自语义清楚

### 2.3 为什么沙箱必须单独建模

控制会话已经有独立工作目录，这证明平台早就承认一个事实：

- 助手控制面不该直接掉进某个项目仓库里

但现在真实执行会话还是只能从正式项目起步，这就导致两个坏结果：

1. 临时任务只能借用现有工作区，污染正式上下文
2. 助手明明只是想临时查点东西，也得先变成“项目”

正确的数据结构应该是：

- 正式项目：长期纳管，业务对象
- 普通工作区：真实可进入目录
- 助手沙箱：助手自己建、默认临时、可晋升的工作区壳

### 2.4 为什么会话启动目标要拆成三种

现在“起真实会话”默认等于“在项目里起会话”。

这对正式开发没问题，对临时执行就太蠢了。

所以这里必须把启动目标拆开：

- `project`
- `workspace`
- `sandbox`

这样助手和 CLI 才能明确表达意图，而不是偷偷拿某个默认项目兜底。

## 3. 总体架构

### 3.1 新模块

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `assistant-automation-service` | 管理自动化任务 CRUD、状态推进、兼容 timer 视图 | 自动化请求 | 自动化对象 |
| `assistant-automation-run-service` | 管理自动化执行记录 | 触发结果、执行结果 | 自动化执行记录 |
| `assistant-automation-trigger` | 计算 `once / interval / cron / condition` 的下一次触发时间 | 触发器配置、参考时间 | `nextRunAt`、条件结果 |
| `assistant-automation-scheduler` | 扫描到期自动化并 enqueue 后台任务 | 当前时间 | 后台任务 |
| `assistant-sandbox-service` | 创建、查询、清理、晋升助手沙箱 | 创建参数、生命周期命令 | 沙箱对象 |
| `assistant-session-target-resolver` | 把 `project / workspace / sandbox` 解析成真正的 `workspaceId` | 目标描述 | `workspaceId`、元数据 |

### 3.2 复用的现有模块

| 现有模块 | 复用方式 |
| --- | --- |
| `WorkspaceService` | 创建目录、导入工作区、克隆仓库、移除入口 |
| `ButlerControlSessionService` | 自动化最终继续回到控制会话 |
| `AssistantCapabilityService` | 提供统一 Host API / CLI 映射 |
| `SessionLiveRuntimeService` | 启动真实会话、发送消息 |
| `TaskManager` | 承载条件检查、自动化执行、清理任务 |

### 3.3 分层

| 层级 | 作用 |
| --- | --- |
| 数据层 | 自动化任务、自动化执行记录、沙箱工作区元数据 |
| 领域层 | 触发器计算、条件求值、沙箱生命周期、目标解析 |
| 执行层 | 调度扫描、后台执行、失败回写 |
| 暴露层 | Host API、CLI、Butler 页面兼容视图 |

## 4. 数据结构

### 4.1 `AssistantAutomationTask`

```ts
type AssistantAutomationStatus =
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

type AssistantAutomationTriggerType =
  | "once"
  | "interval"
  | "cron"
  | "condition";

type AssistantAutomationActionType =
  | "send_control_message";

interface AssistantAutomationTask {
  id: string
  userId: string
  controlSessionId: string
  projectId: string | null
  title: string | null
  triggerType: AssistantAutomationTriggerType
  triggerConfigJson: string
  actionType: AssistantAutomationActionType
  actionConfigJson: string
  status: AssistantAutomationStatus
  nextRunAt: string | null
  lastRunAt: string | null
  lastRunSummary: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
}
```

说明：

- 第一阶段 `actionType` 先只支持 `send_control_message`
- 这样可以复用现有 Butler 控制会话链路，先把“何时触发”做对
- 后续要补更复杂动作时，再新增动作类型，不污染触发器模型

### 4.2 `AssistantAutomationRun`

```ts
type AssistantAutomationRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

interface AssistantAutomationRun {
  id: string
  automationId: string
  runSeq: number
  triggerType: AssistantAutomationTriggerType
  triggerSnapshotJson: string
  actionType: AssistantAutomationActionType
  actionSnapshotJson: string
  status: AssistantAutomationRunStatus
  summary: string | null
  error: string | null
  scheduledAt: string
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}
```

说明：

- 任务对象回答“这条自动化是什么”
- 执行记录回答“它这次到底发生了什么”

### 4.3 `AssistantSandboxWorkspace`

```ts
type AssistantSandboxStatus =
  | "active"
  | "archived"
  | "expired"
  | "deleted";

type AssistantSandboxSourceKind =
  | "blank"
  | "clone"
  | "import";

interface AssistantSandboxWorkspace {
  id: string
  userId: string
  workspaceId: string
  title: string
  description: string | null
  sourceKind: AssistantSandboxSourceKind
  sourceRef: string | null
  visibility: "assistant_only" | "pinned"
  status: AssistantSandboxStatus
  purpose: string | null
  expiresAt: string | null
  promotedAt: string | null
  createdAt: string
  updatedAt: string
}
```

说明：

- `workspaceId` 继续复用现有工作区模型，不发明第二套目录对象
- 沙箱只是“工作区之上的助手私有元数据层”

### 4.4 会话启动目标

```ts
type AssistantSessionTarget =
  | { kind: "project"; projectId: string }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "sandbox"; sandboxId: string };
```

规则：

- 三选一
- 解析完成后统一落成真实 `workspaceId`
- 若来源是 `sandbox`，结果里保留 `sandboxId`，便于审计和 UI 展示

## 5. 触发器设计

### 5.1 `once`

用途：

- 几分钟后继续
- 明天某个时间提醒

配置：

```ts
interface OnceTriggerConfig {
  dueAt: string
}
```

兼容：

- 旧 `timers.create --due-at/--after-seconds` 直接映射到这里

### 5.2 `interval`

用途：

- 每小时检查一次
- 每 15 分钟跟进一次

配置：

```ts
interface IntervalTriggerConfig {
  seconds?: number
  minutes?: number
  hours?: number
  stopAt?: string | null
}
```

规则：

- 只允许正整数
- 至少有一个时间粒度
- 每次触发后系统自己计算下一次时间

### 5.3 `cron`

用途：

- 每天 09:30
- 每周一到周五 10:00

第一阶段不做全量 cron 表达式，沿用现有 Patrol 的简化模型：

```ts
interface CronTriggerConfig {
  minute: number
  hour?: number | null
  daysOfWeek?: number[] | null
  stopAt?: string | null
}
```

原因很简单：

- 仓库里已经有这套计算逻辑
- 够用
- 可测试

别为了“标准 cron”把复杂度炸开。

### 5.4 `condition`

用途：

- 发现远端仓库新 tag 再通知
- 某个会话真正 idle 再继续

配置：

```ts
type AssistantConditionKind =
  | "git.remote_tag_changed"
  | "session.runtime_idle";

interface ConditionTriggerConfig {
  conditionKind: AssistantConditionKind
  pollIntervalSeconds: number
  expiresAt?: string | null
  maxChecks?: number | null
  stateJson: string
}
```

规则：

- 第一阶段条件种类必须白名单
- `stateJson` 用于保存基线，例如最近一次 tag 名称、commit hash、上次运行态
- 条件未满足时，不创建 run，只更新下一次 `nextRunAt`
- 条件满足时，创建 run 并执行动作

## 6. 动作设计

### 6.1 第一阶段只做 `send_control_message`

```ts
interface SendControlMessageActionConfig {
  content: string
  includeTriggerContext: boolean
}
```

执行流程：

1. 读取自动化对象
2. 若本轮来自条件触发，先生成结构化触发上下文
3. 把上下文拼到控制会话消息前缀
4. 通过 `ButlerControlSessionService.sendMessage` 发送
5. 写执行记录和任务状态

这样做的好处：

- 复用现有控制会话能力
- 不把高风险直接执行塞进第一阶段
- 用户要的“通知我”“提醒我继续”“带上新 tag 基线”都能完成

### 6.2 为什么第一阶段不开放自动化直接起项目会话

因为那会马上把风险拉高：

- 会不会在错误项目里自动起会话
- 会不会偷偷消耗模型额度
- 会不会在用户不知道时推进了错误分支

所以第一阶段坚持一条铁律：

- 自动化先回 Butler 控制会话
- 是否继续起项目会话，由控制会话基于实时上下文决定

## 7. 调度与后台任务

### 7.1 调度原则

- 不再给 Butler 自动化长私有 `setTimeout` 队列
- 自动化的触发、条件检查、清理都通过 `TaskManager` 执行
- 调度层只负责“发现到期任务并 enqueue”

### 7.2 建议任务类型

| `taskType` | `key` | 作用 | 建议执行位点 |
| --- | --- | --- | --- |
| `assistant.automation.tick` | 固定 `global` | 扫描到期自动化 | `host_background` |
| `assistant.automation.evaluate` | `automationId` | 计算条件 / 执行动作 | `host_background` 或 `external_process` |
| `assistant.sandbox.cleanup` | `sandboxId` | 清理过期沙箱 | `helper_process` |

说明：

- `git.remote_tag_changed` 这类需要跑 Git 命令的条件，真正求值时应落到 `external_process`
- `assistant.automation.tick` 只做轻量扫描和 enqueue，不做重活

### 7.3 执行流程

1. `assistant.automation.tick` 找到 `nextRunAt <= now` 的活动自动化
2. 按 `automationId` enqueue `assistant.automation.evaluate`
3. `evaluate` 根据 `triggerType` 分支：
   - `once / interval / cron`：直接创建 run 并执行动作
   - `condition`：先求值，再决定是更新下一次时间还是执行动作
4. 动作成功后写 `lastRunAt / lastRunSummary`
5. 若是循环触发，重新计算 `nextRunAt`
6. 若是 `once`，则标记 `completed`

## 8. 沙箱设计

### 8.1 创建方式

第一阶段支持三种来源：

1. `blank`
   - 创建空目录并导入工作区
2. `clone`
   - 通过现有 `WorkspaceService.cloneWorkspace` 克隆仓库后导入
3. `import`
   - 把某个现有目录临时纳入助手沙箱管理

### 8.2 生命周期

| 阶段 | 含义 |
| --- | --- |
| `active` | 正常可用 |
| `archived` | 已保留，但不再默认显示 |
| `expired` | 已过期，等待清理 |
| `deleted` | 已删除入口和元数据 |

### 8.3 晋升

第一阶段只做两种晋升动作：

1. `pin`
   - 从 `assistant_only` 变成 `pinned`
   - 继续保留工作区入口
2. `promote_to_project`
   - 把该工作区纳入正式 Butler 项目入口

这里故意不做“一键万能迁移”。

先把数据边界做清楚，比搞一个什么都想包的迁移魔法重要。

## 9. Host API 与 CLI 设计

### 9.1 Host API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/assistant/automations` | 列自动化 |
| `GET` | `/api/assistant/automations/:automationId` | 读自动化详情 |
| `POST` | `/api/assistant/automations` | 创建自动化 |
| `PATCH` | `/api/assistant/automations/:automationId` | 更新 / 暂停 / 恢复 |
| `POST` | `/api/assistant/automations/:automationId/cancel` | 取消自动化 |
| `GET` | `/api/assistant/automations/:automationId/runs` | 读执行记录 |
| `GET` | `/api/assistant/sandboxes` | 列沙箱 |
| `POST` | `/api/assistant/sandboxes` | 创建沙箱 |
| `POST` | `/api/assistant/sandboxes/:sandboxId/promote` | 晋升沙箱 |
| `POST` | `/api/assistant/sandboxes/:sandboxId/expire` | 标记过期 |
| `DELETE` | `/api/assistant/sandboxes/:sandboxId` | 清理沙箱 |

### 9.2 CLI

新增命令组：

```bash
codingns assistant automations list
codingns assistant automations get <id>
codingns assistant automations create ...
codingns assistant automations cancel <id>
codingns assistant automations runs <id>

codingns assistant sandboxes list
codingns assistant sandboxes create ...
codingns assistant sandboxes promote <id>
codingns assistant sandboxes remove <id>
```

兼容命令：

```bash
codingns assistant timers create ...
```

行为：

- 继续保留
- 内部改为创建 `triggerType=once` 的自动化
- help 文案明确说明这是兼容入口，不再是主推荐能力

### 9.3 会话启动命令

现有：

```bash
codingns assistant sessions start --project <projectId> ...
```

扩展后：

```bash
codingns assistant sessions start --project <projectId> ...
codingns assistant sessions start --workspace <workspaceId> ...
codingns assistant sessions start --sandbox <sandboxId> ...
```

规则：

- 三者互斥
- 不传就报错，不允许猜默认目标

## 10. 前端与 Butler 页面

### 10.1 自动化区域

Butler 自动化区不再只展示一次性计时器，而是统一展示：

- 自动化任务
- 最近执行记录
- 兼容视图里的旧计时器

字段最少要让人看懂：

1. 这条自动化到底在等什么
2. 下一次什么时候跑
3. 最近一次跑成了还是炸了
4. 它作用在哪个控制会话 / 项目

### 10.2 沙箱区域

第一阶段不需要单独做很重的沙箱管理台，但至少要有：

- 当前沙箱列表
- 创建入口
- 是否已固定保留
- 过期时间
- 清理 / 晋升动作

## 11. 迁移与兼容

### 11.1 `ButlerControlTimer` 迁移策略

第一阶段不强制马上删老表，建议分两步：

1. 新建自动化正式表和运行表
2. `timers.*` 改成对新自动化做兼容映射

这样做的原因很直接：

- 旧 UI 和旧 CLI 还能活
- 新逻辑不再被旧表结构绑死
- 后面确认稳定后，再考虑是否把旧 timer 表只留兼容壳

### 11.2 失败隔离

- 自动化失败：只影响该自动化对象和对应控制会话提示
- 沙箱失败：只影响该沙箱对象和对应工作区入口
- 会话目标解析失败：只阻断当前启动请求，不影响其他项目会话

## 12. 验证思路

### 12.1 自动化

- 创建一次性自动化并到点触发
- 创建 interval 自动化并确认 `nextRunAt` 递进
- 创建 cron 自动化并确认周内 / 每日触发时间正确
- 创建 `git.remote_tag_changed` 条件自动化，远端无变化时不触发，有变化时生成 run 并通知控制会话
- 旧 `timers.create` 仍能走通兼容链路

### 12.2 沙箱

- 创建空白沙箱
- 基于仓库 clone 创建沙箱
- 在沙箱上启动真实会话
- 沙箱晋升为保留工作区
- 沙箱过期后被安全清理
