# 任务清单 - spec001.2 后端任务调度与主线程压力治理（人话版）

状态：In Progress

## 2026-04-12 进展补记

- 已启动 `spec001.2`，明确这次只处理“后台任务调度、主线程压力治理、缓存优先与观测”，不扩成泛化线程管理
- 已确认首批必须收编的任务是：`workspace discovery`、`provider capability refresh`
- 已确认 `getOverview()` 不能再先造全量 snapshot 再裁切，必须继续走摘要版聚合
- 已确认 provider 会话发现不能再在 Host 主进程里同步 `fs/sqlite` 扫描，至少要走 helper 进程
- 已确认 `PatrolScheduler` 和 `ButlerFollowUpScheduler` 在无任务时仍会周期醒一次，但当前只做轻查询或轻判断，属于“空转调度器”
- 已完成一轮代码止血改造，并通过 Host 构建和定向测试
- 已新增 `apps/host/src/modules/tasks/` 最小骨架，落地 `TaskRegistry`、`TaskScheduler`、`TaskMetrics` 与薄 `TaskManager`
- 已把 `session-history-service` 里的 `workspaceDiscoveryInflight`、`providerCapabilityRefreshInflight` 收口到统一任务入口
- 已补任务骨架和 `session-history-service` 接入测试，并通过 Host 构建、任务模块测试、`provider-cli-availability` 与 `workbench-service` 定向测试
- 已新增 `20260412-后台任务接入规范.md`，后续新任务必须按统一规范接入，不允许再长散装 `inflight/timer`

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并已回写
- `CANCELLED`：取消并写明原因

规则：

- 只有 `状态：DONE` 的任务才能勾成 `[x]`
- 每做完一个任务，都要立刻回写这份文档
- `BLOCKED` 和 `CANCELLED` 必须写清楚卡在哪、为什么不做

---

## 阶段 0：先把问题边界钉死

- [x] 0.1 启动 spec001.2 并完成文档骨架
  - 状态：DONE
  - 这一做到底做什么：建立 `spec001.2` 目录和 4 份主文档，把范围、边界、已有止血项和核心术语写清楚
  - 做完以后能看到什么结果：仓库里出现完整的 `spec001.2` 文档目录，任何接手的人都知道这次要治理的到底是什么
  - 依赖什么：无
  - 主要改哪些文件：
    - `specs/spec001.2-后端任务调度与主线程压力治理/*`
  - 这一步先不做什么：不引入新的代码实现
  - 怎么验证：
    - 文档走查

- [x] 0.2 回写父规格和总览，挂上 `spec001.2`
  - 状态：DONE
  - 这一做到底做什么：把 `spec001` 和 `specs/README.md` 里补上子规格边界，避免后面继续把任务治理写回主规格正文里
  - 做完以后能看到什么结果：总览和父规格里都能看到 `spec001.2` 的职责说明
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/design.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
  - 这一步先不做什么：不改 `spec001` 既有需求主体
  - 怎么验证：
    - 文档走查

---

## 阶段 1：先把任务模型和指标说清楚

- [x] 1.1 盘点当前后台任务和执行位点
  - 状态：DONE
  - 这一做到底做什么：列出当前请求链路、Host 后台异步、helper 进程、外部 provider 进程各自承载的任务
  - 做完以后能看到什么结果：能回答“任务跑在哪里、为什么会影响主线程”
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `specs/spec001.2-后端任务调度与主线程压力治理/design.md`
    - 必要的现状盘点文档
  - 这一步先不做什么：不做调度器实现
  - 怎么验证：
    - 评审时能明确说出首批任务清单和执行位点
  - 验证结果：`design.md` 已写明 `request_main_thread`、`host_background`、`helper_process`、`external_process` 四类执行位点，并点名 `workspace discovery`、`provider capability refresh`、巡检/跟进调度器的当前归属与风险
  - 对应设计：`design.md` §2.2、§2.3、§2.5
  - 回写时间：2026-04-12

- [x] 1.2 定义统一任务指标和主线程压力指标
  - 状态：DONE
  - 这一做到底做什么：把任务等待时长、执行时长、空转次数、事件循环延迟这些指标名称和采集点定下来
  - 做完以后能看到什么结果：后续实现和回归比较有共同口径
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `specs/spec001.2-后端任务调度与主线程压力治理/design.md`
    - 相关观测说明文档
  - 这一步先不做什么：不急着做仪表盘
  - 怎么验证：
    - 指标清单走查
  - 验证结果：`design.md` 已定义 `enqueue`、`dedupe`、`started`、`finished`、`failed`、`cancelled`、`timeout`、`wait_ms`、`run_ms`、`cache_hit` 等任务指标，并补齐调度器空转与主线程代理指标口径
  - 对应设计：`design.md` §2.4.4、§2.7
  - 回写时间：2026-04-12

---

## 阶段 2：实现最小后台任务管理器骨架

- [x] 2.1 建立 `TaskRegistry`、`TaskScheduler`、`TaskMetrics` 最小骨架
  - 状态：DONE
  - 这一做到底做什么：把任务注册、按键去重、执行位点分发和统一指标入口搭起来
  - 做完以后能看到什么结果：新老后台任务有了共同入口，不再只能靠私有 `Map` 管状态
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/host/src/modules/tasks/*`
    - 相关类型定义和测试
  - 这一步先不做什么：不一次性迁完全部旧任务
  - 怎么验证：
    - 单元测试
    - Host 构建
  - 验证结果：
    - 已新增 `apps/host/src/modules/tasks/task-types.ts`
    - 已新增 `apps/host/src/modules/tasks/task-registry.ts`
    - 已新增 `apps/host/src/modules/tasks/task-scheduler.ts`
    - 已新增 `apps/host/src/modules/tasks/task-metrics.ts`
    - 已新增 `apps/host/src/modules/tasks/task-manager.ts`
    - `TaskScheduler` 已支持按 `taskType + key` 去重、取消、超时、重试钩子、按任务类型并发限制与最小指标累积
    - 已通过 `pnpm --filter host build`
    - 已通过 `pnpm --filter host test -- tests/integration/task-manager.test.ts`
  - 回写时间：2026-04-12

- [x] 2.2 接入基础观测和调试出口
  - 状态：DONE
  - 这一做到底做什么：让任务指标和主线程压力采样能被记录和导出
  - 做完以后能看到什么结果：排查时不再只能翻零散日志
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/host/src/modules/tasks/*`
    - `apps/host/src/server/*`
  - 这一步先不做什么：不做复杂可视化页面
  - 怎么验证：
    - 定向测试
    - 指标输出样例检查
  - 验证结果：
    - 已新增 `GET /api/observability/runtime` 只读观测出口
    - 已补 `EventLoopMonitor`，返回 `min/max/mean/stddev/p50/p95/p99`
    - 已补 `RuntimeObservabilityService`，统一导出 `backgroundTasks`、`schedulers`、`eventLoop`
    - 已通过 `pnpm --filter host test -- tests/integration/observability-routes.test.ts`
  - 回写时间：2026-04-12

---

## 阶段 3：先收编最痛的两个任务

- [x] 3.1 收编 `workspace discovery`
  - 状态：DONE
  - 这一做到底做什么：把工作区会话发现正式纳入后台任务管理器，统一缓存、去重、helper 执行和指标
  - 做完以后能看到什么结果：overview、search、工作台刷新不再顺手现扫
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/provider/provider-discovery-helper-*`
    - 相关测试
  - 这一步先不做什么：不扩到所有 provider runtime
  - 怎么验证：
    - `pnpm --filter host test -- tests/integration/workbench-service.test.ts`
  - 验证结果：
    - `SessionHistoryService.discoverWorkspaceSessions()` 与 `requestWorkspaceDiscovery()` 已改走统一 `TaskManager`
    - 任务类型固定为 `workspace.discovery`，执行位点声明为 `helper_process`
    - 缓存命中时会直接返回索引结果并记录 `cache_hit`
    - 已通过 `pnpm --filter host test -- tests/integration/session-history-background-tasks.test.ts tests/integration/workbench-service.test.ts`
  - 回写时间：2026-04-12

- [x] 3.2 收编 `provider capability refresh`
  - 状态：DONE
  - 这一做到底做什么：把 provider 能力缓存和异步刷新纳入统一任务模型
  - 做完以后能看到什么结果：新建会话入口不再被实时探测绑死
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/provider/*`
    - 相关测试
  - 这一步先不做什么：不扩展新的 provider 协议
  - 怎么验证：
    - `pnpm --filter host test -- tests/integration/provider-cli-availability.test.ts`
  - 验证结果：
    - `SessionHistoryService.scheduleProviderCapabilityRefresh()` 已改走统一 `TaskManager`
    - 任务类型固定为 `provider.capability_refresh`，执行位点声明为 `external_process`
    - 能力缓存命中时会直接复用最近值并记录 `cache_hit`
    - 已通过 `pnpm --filter host test -- tests/integration/session-history-background-tasks.test.ts tests/integration/provider-cli-availability.test.ts`
  - 回写时间：2026-04-12

---

## 阶段 4：把空转调度器纳入统一观测

- [x] 4.1 盘点巡检、跟进、摘要调度器的空转行为
  - 状态：DONE
  - 这一做到底做什么：明确哪些调度器没有任务时仍会周期醒，醒来后到底做多少工作
  - 做完以后能看到什么结果：能分清“有任务执行”和“只是空转 tick”
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/host/src/modules/butler/*scheduler.ts`
    - 相关测试和文档
  - 这一步先不做什么：不改 Butler 业务规则
  - 怎么验证：
    - 定向测试
    - 日志/指标检查
  - 验证结果：
    - `PatrolScheduler` 已记录 `taskCount / idle / duration / nextDelay`
    - `ButlerFollowUpService.runDueTasks()` 已返回活跃任务数、到期任务数和处理任务数，供 scheduler 区分空转与命中
    - `ButlerSessionSummaryService.runOnce()` 已返回 `scheduled/summarized` 结果，供 scheduler 区分空转与命中
    - 已通过：
      - `pnpm --filter host test -- tests/integration/patrol-scheduler.test.ts`
      - `pnpm --filter host test -- tests/integration/butler-follow-up-scheduler.test.ts`
      - `pnpm --filter host test -- tests/integration/session-summary-scheduler.test.ts`
  - 回写时间：2026-04-12

- [x] 4.2 增加空转退让策略或统一调度收口
  - 状态：DONE
  - 这一做到底做什么：让连续空转的调度器至少具备后续可扩展的退让能力，避免固定频率永远无脑醒
  - 做完以后能看到什么结果：无任务场景下的后台噪音下降
  - 依赖什么：4.1
  - 主要改哪些文件：
    - `apps/host/src/modules/butler/*scheduler.ts`
    - `apps/host/src/modules/tasks/*`
  - 这一步先不做什么：不做复杂优先级系统
  - 怎么验证：
    - 定向测试
    - 指标对比
  - 验证结果：
    - `PatrolScheduler`、`ButlerFollowUpScheduler`、`SessionSummaryScheduler` 已从固定 `setInterval` 改成按 tick 结果递归调度
    - 连续空转时会按基础间隔逐步退让，直到 `maxIntervalMs`
    - 有真实任务命中时，下一轮调度会回到基础间隔
    - 已通过：
      - `pnpm --filter host test -- tests/integration/patrol-scheduler.test.ts`
      - `pnpm --filter host test -- tests/integration/butler-follow-up-scheduler.test.ts`
      - `pnpm --filter host test -- tests/integration/session-summary-scheduler.test.ts`
  - 回写时间：2026-04-12

---

## 阶段 5：回归和量化验收

- [x] 5.1 建立优化前后对比口径
  - 状态：DONE
  - 这一做到底做什么：确定请求耗时、缓存命中、事件循环延迟、任务耗时的对比方式
  - 做完以后能看到什么结果：后续每次优化都有统一对比表
  - 依赖什么：3.2、4.2
  - 主要改哪些文件：
    - 验证记录
    - 指标说明文档
  - 这一步先不做什么：不做长期报表平台
  - 怎么验证：
    - 评审记录
  - 验证结果：
    - 已新增 `20260412-任务与主线程观测对比口径.md`
    - 文档已明确 `backgroundTasks`、`schedulers`、`eventLoop` 三组对比字段和推荐回归步骤
  - 主要改哪些文件：
    - `specs/spec001.2-后端任务调度与主线程压力治理/20260412-任务与主线程观测对比口径.md`
  - 回写时间：2026-04-12

- [x] 5.2 最终回归与验收
  - 状态：DONE
  - 这一做到底做什么：确认收件箱、代码助手、工作台刷新、新建会话四类入口都不再被重扫描或实时探测卡死
  - 做完以后能看到什么结果：本次性能治理不是“看起来差不多”，而是能拿指标说话
  - 依赖什么：5.1
  - 主要改哪些文件：
    - 测试与验证记录
  - 这一步先不做什么：不扩更多功能范围
  - 怎么验证：
    - `pnpm --filter host build`
    - `pnpm --filter host test -- tests/integration/task-manager.test.ts tests/integration/session-history-background-tasks.test.ts tests/integration/observability-routes.test.ts`
    - `pnpm --filter user-app exec vitest run src/features/settings/pages/SettingsPage.test.tsx`
    - `pnpm --filter user-app build`
  - 验证结果：
    - Host 观测接口已经改成会话式按需启停，调试窗口关闭后会停止 `event loop` 采样并清空最近任务执行记录
    - PC 设置页已新增“高级设置 / 并行任务调试”，可以通过模态框实时查看后台任务指标、最近执行记录、调度器状态和 `event loop` 延迟
    - `workspace discovery`、`provider capability refresh` 继续通过统一 `TaskManager` 收口，没有回退到散装 `inflight` 状态
  - 回写时间：2026-04-12
