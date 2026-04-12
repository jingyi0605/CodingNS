# 设计文档 - spec001.2 后端任务调度与主线程压力治理

状态：Draft

## 1. 概述

### 1.1 目标

- 把 Host 里跨请求、可延后、可缓存的重活从请求主链路中剥出去
- 建立最小可用的全局后台任务管理器，而不是继续堆散装 `inflight/timer`
- 为主线程压力、后台任务执行位点和空转调度器补齐统一观测
- 在不破坏现有接口返回结构的前提下，先完成一轮止血治理

### 1.2 覆盖需求

- `requirements.md` 需求 1：请求链路缓存优先
- `requirements.md` 需求 2：高成本发现搬离主线程
- `requirements.md` 需求 3：全局后台任务管理器
- `requirements.md` 需求 4：能力探测不阻塞入口
- `requirements.md` 需求 5：摘要版聚合
- `requirements.md` 需求 6：空转调度器治理
- `requirements.md` 需求 7：统一量化指标

### 1.3 技术约束

- 当前 Host 仍然是单 Node.js 主进程，没有专门的 worker pool 框架
- 现有 provider 发现、能力探测和会话同步逻辑已经分散在 `apps/host` 多个模块里，不能一把梭全推翻
- 现有接口返回结构和大部分调用点必须保持兼容，不能为了“架构优雅”把前端打崩
- 优先复用已有 helper 进程模式，不额外引入新常驻守护进程
- 第一阶段先解决最痛的请求卡顿和主线程压力，不做分布式任务系统

### 1.4 当前实现诊断

当前问题不是没有缓存，而是缓存、刷新和执行位点全混了。

已经确认的坏点如下：

1. `discoverWorkspaceSessions` 过去会被多个请求链路顺手触发，导致本来只想看列表，也要跟着扫 provider 本地存储
2. provider 会话发现以前跑在 Host 进程里，里面混着本地 `fs/sqlite` 扫描，这类重活对主线程不友好
3. `getOverview()` 先构造完整 snapshot 再裁切，纯属拿 CPU 换空气
4. `getProviderCapabilities()` 以前容易把“新建会话入口是否可用”绑死在实时模型探测上
5. 任务状态管理散落在 `workspaceDiscoveryInflight`、`providerCapabilityRefreshInflight`、`queueRetryTimers`、`WorkbenchWsHub.refreshTask` 和各类 scheduler 的 `ticking`
6. `PatrolScheduler`、`ButlerFollowUpScheduler` 即使没有待执行任务也会周期醒一次，但当前没有统一的空转指标和退让规则

一句人话：
这不是线程太少的问题，是主线程被拿去干了太多“不该当场干”的事。

### 1.5 已落地止血项

这轮改造已经先做了几件止血，不再从零开始：

1. `discoverWorkspaceSessions` 已支持缓存命中优先和后台刷新调度
2. provider 会话发现已迁到 helper 进程执行，避免 Host 主线程直接做同步扫描
3. `getOverview()` 已改成摘要版聚合，不再先造完整 snapshot
4. `getProviderCapabilities()` 已支持先返回缓存或兜底，再异步刷新模型列表

这个 Spec 的任务不是重复写一遍这些代码，而是把它们变成一套可持续规则。

## 2. 架构

### 2.1 总体结构

后台任务治理只保留四层：

1. **请求主链路**
   - 只做这次响应必须完成的工作
   - 优先命中缓存、摘要或最近结果
2. **Host 后台任务层**
   - 由统一任务管理器调度
   - 处理去重、限流、取消、超时、重试和指标
3. **Helper 进程执行层**
   - 负责高成本本地扫描、provider 适配读取、重 I/O
   - 通过进程消息返回结果
4. **外部 provider / CLI**
   - 仍然作为真实数据来源
   - Host 不直接把实时探测结果当成每次请求的阻塞条件

### 2.2 当前执行位点模型

先别扯“项目里一共多少线程”这种假精确数字。当前我们真正能控制的是执行位点。

现阶段按代码结构，至少有这几类执行位点：

| 执行位点 | 现在是什么 | 典型任务 | 对 Host 主线程影响 |
| --- | --- | --- | --- |
| `request_main_thread` | Node.js Host 事件循环 | 路由处理、DTO 组装、少量数据库读写 | 最高，任何长任务都会直接拖慢响应 |
| `host_background` | 同一个 Host 进程里的异步任务 | 后台刷新、摘要调度、状态补刷 | 仍会占用同一事件循环，只是脱离了当前请求 |
| `helper_process` | 子进程 helper | provider 会话发现、本地重扫描、重 I/O 读取 | 主要消耗在子进程，Host 只承担 IPC |
| `external_process` | CLI/provider 自己的进程 | provider 命令执行、模型探测 | Host 主要承担拉起、等待和结果整理 |

结论很简单：

- “异步”不等于“不会影响主线程”
- 只要还跑在同一个 Host 进程里，CPU 重活、同步 I/O、巨量对象创建照样会拖慢主线程
- 真正要减压，就得把高成本任务挪到 helper 进程，或者把主链路改成缓存命中优先

### 2.3 任务分类

统一只分四类，别再乱造名词：

| 类型 | 是否允许阻塞请求 | 是否进入任务管理器 | 例子 |
| --- | --- | --- | --- |
| `inline_required` | 允许 | 否 | 权限校验、单次必要读库、参数校验 |
| `request_refresh` | 不允许 | 是 | 工作区会话发现、provider capability refresh |
| `periodic_maintenance` | 不允许 | 是 | 巡检调度、会话跟进调度、摘要调度 |
| `offloaded_scan` | 不允许 | 是 | provider 本地 `fs/sqlite` 扫描、会话发现 |

判断规则只有一句话：
只要这个任务跨请求、可延后、需要去重或观测，就归后台任务管理器。

### 2.4 核心组件

#### 2.4.1 `TaskRegistry`

职责：

- 注册任务类型、任务键、执行位点、并发限制、默认超时、重试策略
- 统一声明缓存策略和结果复用策略

最小字段：

| 字段 | 说明 |
| --- | --- |
| `taskType` | 任务类型，例如 `workspace.discovery` |
| `key` | 资源级任务键，例如 `workspace:{id}` |
| `executionLane` | `host_background` / `helper_process` / `external_process` |
| `concurrency` | 同类任务并发限制 |
| `timeoutMs` | 超时上限 |
| `retryPolicy` | 是否重试、重试次数、退避 |
| `cachePolicy` | 是否读缓存、缓存 TTL、是否 stale-while-revalidate |

#### 2.4.2 `TaskScheduler`

职责：

- 接收任务请求并按任务键去重
- 负责排队、启动、取消、超时和重试
- 将结果写入任务状态表和指标通道

规则：

1. 同一 `taskType + key` 在运行时只保留一个活动任务
2. 新请求默认复用已有任务结果或已有 Promise
3. 周期任务进入调度器后，也走统一状态和指标

#### 2.4.3 `TaskExecutor`

职责：

- 按执行位点把任务真正跑起来

执行分支：

1. `host_background`
   - 只允许轻 CPU、轻 I/O、轻聚合
   - 任何疑似长任务都不该留在这里
2. `helper_process`
   - 适合 provider 本地扫描、历史读取、组合查询
   - Host 只负责传参和收结果
3. `external_process`
   - 适合直接调用 CLI/provider 命令
   - 返回前必须有兜底和缓存，不把它当成入口必经步骤

#### 2.4.4 `TaskMetrics`

职责：

- 记录任务级、接口级、主线程级三类指标

最小指标：

| 指标 | 说明 |
| --- | --- |
| `task_enqueued_total` | 任务进入调度次数 |
| `task_deduped_total` | 命中去重次数 |
| `task_started_total` | 实际启动次数 |
| `task_finished_total` | 完成次数 |
| `task_failed_total` | 失败次数 |
| `task_cancelled_total` | 取消次数 |
| `task_timeout_total` | 超时次数 |
| `task_wait_ms` | 排队等待时长 |
| `task_run_ms` | 执行时长 |
| `task_cache_hit_total` | 缓存命中次数 |
| `scheduler_tick_total` | 调度器 tick 次数 |
| `scheduler_idle_tick_total` | 空转 tick 次数 |
| `scheduler_task_count` | 单次 tick 命中的任务数量 |
| `event_loop_delay_ms` | 事件循环延迟 |
| `request_duration_ms` | 接口耗时分布 |

### 2.5 关键流程

#### 2.5.1 工作区会话发现

1. 请求链路先读工作区会话缓存
2. 缓存未过期则直接返回
3. 缓存过期或显式强刷时，向 `TaskScheduler` 提交 `workspace.discovery`
4. 任务通过 `helper_process` 执行 provider 本地发现
5. 完成后回写缓存和状态，再供后续请求命中

#### 2.5.2 Provider 能力获取

1. 请求链路先返回 `getProviderCapabilities()` 的缓存或兜底能力
2. 如缓存过期，提交 `provider.capability_refresh`
3. 任务在后台刷新模型列表和默认推理等级
4. 失败时保留上次缓存，并附带限制信息

#### 2.5.3 Butler 总览聚合

1. 请求链路只拉摘要数据，不再构造完整 snapshot
2. 需要补刷项目会话时，提交后台 `workspace.discovery`
3. 总览响应只取展示上限内的项目、会话、收件箱、巡检和验证摘要

#### 2.5.4 巡检和跟进调度

1. 调度器按周期醒一次
2. 进入调度器后先做轻查询：
   - `PatrolScheduler` 先查 `listDuePlans()`
   - `ButlerFollowUpScheduler` 先查 `runDueTasks()` 里的活跃任务和 `nextCheckAt`
3. 没有任务时直接记一次 `idle_tick`
4. 有任务时再进入后续业务逻辑

现状结论必须写死：

- `PatrolScheduler` 没有计划时仍会周期醒一次，但 `listDuePlans()` 为空就返回，不会创建巡视任务
- `ButlerFollowUpScheduler` 没有活跃跟进任务或还没到 `nextCheckAt` 时，也会周期醒一次，但只做轻判断，不会继续推进重逻辑

### 2.6 迁移路径

第一阶段只收编最痛的任务，别一次吞全世界。

#### 阶段 A：先把已有止血能力正式收编

- `workspace.discovery`
- `provider.capability_refresh`

#### 阶段 B：收口散装状态

- 用统一任务键替代 `workspaceDiscoveryInflight`
- 用统一任务记录替代 `providerCapabilityRefreshInflight`
- 为 `WorkbenchWsHub.refreshTask` 提供复用策略
- 为 `queueRetryTimers` 明确它属于会话运行时内部重试，不强行塞进全局后台任务管理器

#### 阶段 C：统一调度器指标

- `PatrolScheduler`
- `ButlerFollowUpScheduler`
- `SessionSummaryScheduler`

### 2.7 量化评估方法

用户问“怎么量化评估这些线程或者任务”，答案不是拍脑袋，是看四组数据。

#### 2.7.1 请求侧

- `request_duration_ms`：按接口看 P50 / P95 / P99
- `request_blocked_by_refresh_total`：本不该阻塞却仍被后台刷新卡住的次数
- `response_cache_hit_ratio`：摘要或缓存命中率

#### 2.7.2 任务侧

- 每类任务的排队时长、运行时长、成功率、失败率、超时率、重试率
- 同一资源的去重命中率
- helper 进程任务的 IPC 耗时和执行耗时拆分

#### 2.7.3 主线程侧

- `event_loop_delay_ms`
- 单次任务最长耗时
- 请求期间的 CPU 占用代理指标
- 同步 `fs/sqlite` 扫描出现次数，或其替代埋点

#### 2.7.4 调度器侧

- `tick` 次数
- 空转次数占比
- 平均每次 tick 实际处理的任务数
- 空转时长和命中任务时长

判断优化是否有效，就看两件事：

1. 请求 P95 是否下降
2. 主线程长尾任务是否明显减少

## 3. 组件和接口

### 3.1 核心接口草案

#### 3.1.1 `TaskManager.register(definition)`

- 输入：任务定义
- 输出：注册结果
- 作用：声明任务类型、执行位点和策略

#### 3.1.2 `TaskManager.enqueue(taskRequest)`

- 输入：任务类型、任务键、参数、触发来源
- 输出：任务句柄或复用结果
- 作用：进入统一调度、去重和指标链路

#### 3.1.3 `TaskManager.peek(taskType, key)`

- 输入：任务类型、任务键
- 输出：最近状态、最近结果、缓存时间
- 作用：请求链路先命中缓存或最近结果

#### 3.1.4 `TaskManager.observe()`

- 输入：无
- 输出：指标快照
- 作用：给后续性能面板或调试接口使用

### 3.2 数据结构

#### 3.2.1 `TaskDefinition`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `taskType` | string | 任务类型 |
| `executionLane` | string | 执行位点 |
| `timeoutMs` | number | 超时配置 |
| `maxConcurrency` | number | 并发限制 |
| `cacheTtlMs` | number | 缓存有效期 |
| `allowStaleReturn` | boolean | 是否允许 stale 命中 |

#### 3.2.2 `TaskExecutionRecord`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 执行记录 ID |
| `taskType` | string | 任务类型 |
| `key` | string | 资源键 |
| `status` | string | `queued/running/succeeded/failed/cancelled/timed_out` |
| `trigger` | string | 来源，例如 `request`、`scheduler`、`ws` |
| `executionLane` | string | 执行位点 |
| `queuedAt` | string | 排队时间 |
| `startedAt` | string | 开始时间 |
| `finishedAt` | string | 结束时间 |
| `durationMs` | number | 执行耗时 |
| `errorCode` | string | 错误码 |

## 4. 风险与兼容

### 4.1 最大风险

- 把所有异步逻辑都叫“后台任务”，最后把简单代码搞复杂
- helper 进程过多或 IPC 粒度过碎，反而把系统拖成另一种慢
- 指标打太散，最后没人看得懂

### 4.2 控制策略

1. 只收编跨请求、可延后、需要统一策略的任务
2. helper 进程优先复用，不乱开新进程
3. 先做最少指标，保证能回答核心问题，再考虑扩展

## 5. 正确性属性

### 5.1 属性 1：请求链路不再顺手现扫重任务

*对于任何* 工作台、总览、搜索、能力读取请求，系统都应该满足：如果存在最近可用结果，就先返回结果，再异步刷新。

### 5.2 属性 2：高成本发现不在 Host 主线程同步硬扫

*对于任何* provider 本地会话发现任务，系统都应该满足：Host 主线程不直接执行同步重扫描，优先通过 helper 进程或分批异步执行。

### 5.3 属性 3：空转调度器可被识别和量化

*对于任何* 周期调度器，系统都应该满足：即使没有业务任务，也能区分“空转醒了一次”和“真正跑了任务”，并分别记录指标。
