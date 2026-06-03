# 任务清单 - spec016.4-事务文档库刷新阻塞治理与索引稳定性改造（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单只服务一个目标：

**把事务文档库“容易卡住、状态说不清、结果更新慢”的主链路拆成可落地的治理任务。**

重点就四组事：

- 双层兜底刷新
- queue wait timeout
- per-rootDir helper 隔离
- Host 主线程去同步 I/O

---

## 阶段 0：先把 spec 挂起来并锁定边界

- [x] 0.1 启动 `spec016.4` 文档骨架
  - 状态：DONE
  - 这一步到底做什么：创建 `README.md`、`requirements.md`、`design.md`、`tasks.md` 和 `docs/README.md`，把这轮稳定性治理从聊天结论变成正式 Spec。
  - 做完你能看到什么：仓库里出现完整 `spec016.4` 目录，已经写清楚四条主线和不做 Redis 的边界。
  - 先依赖什么：`spec016.1`、`spec016.2`
  - 开始前先看：
    - `spec016.1/README.md`
    - `spec016.2/README.md`
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
    - `apps/host/src/modules/tasks/task-scheduler.ts`
  - 主要改哪里：
    - `specs/spec016.4-事务文档库刷新阻塞治理与索引稳定性改造/*`
  - 这一步先不做什么：不改实现代码。
  - 怎么算完成：
    1. `spec016.4` 主文档齐全
    2. 已明确这轮只做稳定性治理，不扩新功能面
  - 怎么验证：
    - 文档走查
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

- [x] 0.2 回写总览和父 spec 关联
  - 状态：DONE
  - 这一步到底做什么：把 `spec016.4` 挂到 `specs/README.md` 和 `spec016/README.md`，明确它负责事务文档库刷新阻塞治理和索引稳定性改造。
  - 做完你能看到什么：以后查这类问题，不会继续散落在 `spec016.1` 和 `spec016.2` 里混着找。
  - 先依赖什么：0.1
  - 开始前先看：
    - `specs/README.md`
    - `specs/spec016-代码视图与事务视图双工作台重构/README.md`
  - 主要改哪里：
    - `specs/README.md`
    - `specs/spec016-代码视图与事务视图双工作台重构/README.md`
  - 这一步先不做什么：不扩实现范围。
  - 怎么算完成：
    1. 总览里能看到 `spec016.4`
    2. 父 spec 已写清楚这个子规格负责什么
  - 怎么验证：
    - 文档交叉检查
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 4、需求 5
  - 对应设计：`design.md` §1、§2

- [x] 0.3 先把状态词和调试词收口
  - 状态：DONE
  - 这一步到底做什么：先把这轮会出现的新状态词和调试词表定下来，例如 `queue_timeout`、`stale_fallback`、`drift_detected`、`rebuild_required`，避免代码里先乱长名字。
  - 做完你能看到什么：后面写实现和前端状态时，不会同一件事用三种叫法。
  - 先依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 5
    - `design.md` §3.2、§4.2、§5
    - `apps/host/src/modules/tasks/task-types.ts`
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
  - 主要改哪里：
    - `design.md`
    - 后续实现涉及的状态 DTO 和调试日志约定文件
  - 这一步先不做什么：不直接改执行逻辑。
  - 怎么算完成：
    1. 状态词表已经固定
    2. 调试日志关键字段已经先写清
  - 怎么验证：
    - 文档走查
    - `pnpm -C apps/host exec vitest run tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/host exec tsc --noEmit`
  - 本次完成说明：
    1. 在 `design.md` 新增“状态词和调试词固定表”，把索引状态、目录来源、脏原因、对账 scope/status、调试事件和轻量对账原因前缀全部写死。
    2. 新增 `apps/host/src/modules/workspace/affairs-library-refresh-contract.ts`，把当前和后续要共用的 dirty reason、reconcile status、debug event 收口成统一常量。
    3. `apps/host/src/modules/workspace/affairs-library-service.ts` 已开始改用统一 dirty reason 常量，后续 queue timeout 和 periodic audit 继续沿用这份约定。
  - 对应需求：`requirements.md` 需求 2、需求 5
  - 对应设计：`design.md` §3.2、§4.2、§5

---

## 阶段 1：先把双层兜底刷新站稳

- [x] 1.1 实现 30~60 秒轻量对账入口
  - 状态：DONE
  - 这一步到底做什么：补一个低成本对账器，只检查状态文件、heartbeat、最近目录变化和 dirty signal 消费情况，不默认触发 full rebuild。
  - 做完你能看到什么：watcher 漏事件后，不用一直等 10 分钟，系统会先自己发现并尝试补新。
  - 先依赖什么：0.3
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.3.2、§3.3、§4.1
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
    - `apps/host/src/modules/workspace/affairs-library-dirty-watch-service.ts`
  - 主要改哪里：
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
    - 必要时新增对账服务文件
    - 对应测试文件
  - 这一步先不做什么：不改 worker 隔离模型。
  - 怎么算完成：
    1. 轻量对账能按工作区或 rootDir 定时运行
    2. 发现小范围漂移时只触发 targeted refresh 或目录 hint
  - 怎么验证：
    - 单元测试
    - 漏事件回放
    - `pnpm -C apps/host exec vitest run tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/host exec tsc --noEmit`
  - 本次完成说明：
    1. `apps/host/src/modules/workspace/affairs-library-service.ts` 新增 45 秒轻量对账定时器，按已启用工作区自动运行。
    2. 轻量对账当前只做便宜检查：索引产物是否缺失、pending dirty signal 是否丢了定时器、runtime status 是否跑到 export 前面、最近目录 mtime 是否明显新于导出时间。
    3. 发现小范围漂移时，先补 `directory hint`，再走 `affairs_library.auto_refresh` 的增量索引；只有命中 `missing_*` 这类明确缺产物场景，才会升级成全量重建原因。
    4. `apps/host/tests/modules/workspace/affairs-library-service.test.ts` 新增两条回归：一条验证 45 秒轻量对账能补跑增量刷新，一条验证健康状态下不会误触发补跑。
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.3.2、§4.1

- [x] 1.2 实现 10 分钟全库巡检，但不默认全量重建
  - 状态：DONE
  - 这一步到底做什么：补全库巡检器，先做对账，再按 `healthy / drift_detected / rebuild_required` 三类结果决定动作。
  - 做完你能看到什么：10 分钟保底不再是“每次全量重建”，而是“先体检，再决定怎么修”。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.3.3、§6.3
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
  - 主要改哪里：
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
    - 对应测试文件
  - 这一步先不做什么：不顺手重做索引器内部算法。
  - 怎么算完成：
    1. 10 分钟巡检先输出对账结论
    2. 只有明确需要时才升级为 full rebuild
  - 怎么验证：
    - 集成测试
    - 巡检日志检查
    - `pnpm -C apps/host exec vitest run tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/host exec tsc --noEmit`
  - 本次完成说明：
    1. `apps/host/src/modules/workspace/affairs-library-dirty-watch-service.ts` 的 10 分钟兜底事件已从 `periodic_refresh` 改成 `audit` + `periodic_audit`，不再直接把周期事件当刷新命令。
    2. `apps/host/src/server/create-server.ts` 现在会把周期审计事件单独分发给 `AffairsLibraryService.schedulePeriodicAudit(...)`。
    3. `apps/host/src/modules/workspace/affairs-library-service.ts` 新增全库巡检入口和 `periodic_audit` 对账决策：先查索引产物缺失、pending dirty signal、runtime/export 漂移、轻量对账连续漂移、根目录 mtime，再决定 `healthy / drift_detected / rebuild_required`。
    4. 当前实现里，只有明确缺索引产物这类场景才升级到重建原因；普通漂移仍只走全库增量索引，不默认全量重建。
    5. `apps/host/tests/modules/workspace/affairs-library-service.test.ts` 已补回归：一条验证周期巡检发现漂移时走增量索引，一条验证健康状态下不会默认补跑。
  - 对应需求：`requirements.md` 需求 1、非功能需求 1
  - 对应设计：`design.md` §2.3.3、§5.3、§6.3

### 阶段检查

- [x] 1.3 双层兜底刷新阶段检查
  - 状态：DONE
  - 这一步到底做什么：检查 watcher、轻量对账和 10 分钟巡检是不是已经形成稳定梯度，而不是互相打架。
  - 做完你能看到什么：知道系统已经不是只有一个保底按钮，而是有层次地补刷新。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不扩 queue timeout。
  - 怎么算完成：
    1. watcher 正常时仍优先 targeted refresh
    2. 漏事件场景能先被轻量对账补到
    3. 10 分钟巡检不会默认制造大量写入
  - 怎么验证：
    - 人工走查
    - 定向测试
    - `pnpm -C apps/host exec vitest run tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/host exec tsc --noEmit`
  - 本次完成说明：
    1. watcher 仍然优先产出 `watch:*` 的 targeted refresh / apply-config，不会被 45 秒轻量对账和 10 分钟巡检抢成统一全量刷新。
    2. 45 秒轻量对账现在只做便宜检查，命中漂移时优先补 `directory hint` 和增量索引。
    3. 10 分钟巡检现在先做 `periodic_audit` 对账，只在明确缺索引产物时才升级到重建原因；普通漂移只走全库增量索引。
    4. 当前三层梯度已经明确分开：
       - watcher：第一时间报信
       - lightweight reconcile：45 秒内补漏
       - periodic audit：10 分钟做更大范围体检
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.3.1、§2.3.2、§2.3.3

---

## 阶段 2：把队列等待超时和陈旧 queued 回收补上

- [x] 2.1 给 Host 调度器增加 queue wait timeout
  - 状态：DONE
  - 这一步到底做什么：给 `TaskScheduler` 增加排队等待超时和回收能力，不让 queued 任务无限挂着。
  - 做完你能看到什么：前端再看到 queued，就知道它要么很快启动，要么会明确超时，不会一直假活着。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.3.4、§3.2、§4.2
    - `apps/host/src/modules/tasks/task-scheduler.ts`
    - `apps/host/src/modules/tasks/task-types.ts`
  - 主要改哪里：
    - `apps/host/src/modules/tasks/task-scheduler.ts`
    - `apps/host/src/modules/tasks/task-types.ts`
    - 对应测试文件
  - 这一步先不做什么：不改 helper 隔离。
  - 怎么算完成：
    1. queued 任务超过阈值后进入正式超时状态
    2. 陈旧 queued 快照会被回收
  - 怎么验证：
    - 单元测试
    - 队列堵塞场景回放
    - `pnpm -C apps/host exec vitest run tests/integration/task-manager.test.ts tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/host exec tsc --noEmit`
  - 本次完成说明：
    1. `apps/host/src/modules/tasks/task-types.ts` 新增 `queue_timeout` 状态、`queueWaitTimeoutMs` 定义项，以及 `TaskQueueWaitTimeoutError`。
    2. `apps/host/src/modules/tasks/task-scheduler.ts` 新增 queued 任务老化扫描和超时回收：任务进队后会按最近超时点自动补 sweep，超过阈值直接改成 `queue_timeout`，并从 queued 桶里清掉。
    3. 这次没有额外长一套私有队列；还是在现有 `TaskScheduler` 里收口，指标继续复用 `timeout` 计数。
    4. `apps/host/src/modules/workspace/affairs-library-service.ts` 已把事务文档库重任务和目录 hint 任务接上 `queueWaitTimeoutMs`，并把 Host 快照状态映射成 `queue_timeout`，不再继续伪装成普通 `queued/running`。
    5. `apps/host/tests/integration/task-manager.test.ts` 新增队列等待超时回归；`apps/host/tests/modules/workspace/affairs-library-service.test.ts` 新增事务文档库 `queue_timeout` 状态回归。
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §2.3.4、§4.2、§5.3

- [x] 2.2 给 helper 内部排队补等待超时和清理
  - 状态：DONE
  - 这一步到底做什么：让 helper 进程里的 queued 请求也有等待超时和清理，不让 Host 已经放弃的请求继续堆在 helper 里。
  - 做完你能看到什么：Host 和 helper 的排队状态不再脱节。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.3.4、§5.3
    - `apps/host/src/modules/tasks/task-helper-process.ts`
    - `apps/host/src/modules/tasks/task-helper-client.ts`
  - 主要改哪里：
    - `apps/host/src/modules/tasks/task-helper-process.ts`
    - `apps/host/src/modules/tasks/task-helper-client.ts`
    - 对应测试文件
  - 这一步先不做什么：不做 rootDir worker 池。
  - 怎么算完成：
    1. helper queued 请求超过阈值会被清理
    2. 被清理的请求不会继续占着 bucket
  - 怎么验证：
    - 集成测试
    - helper 队列场景回放
    - `pnpm -C apps/host exec vitest run tests/modules/tasks/task-helper-client.test.ts tests/modules/tasks/task-helper-scheduling.test.ts tests/integration/task-manager.test.ts tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/host exec tsc --noEmit`
    - `pnpm -C apps/user-app exec tsc --noEmit`
  - 本次完成说明：
    1. `apps/host/src/modules/tasks/task-helper-process.ts` 现在支持 queued 请求自己的等待超时：请求如果已经进了 helper bucket，但长期没开始，会主动从 helper 队列里清掉，并回写 `TASK_QUEUE_WAIT_TIMEOUT`。
    2. `apps/host/src/modules/tasks/task-helper-client.ts` 已支持读取 helper 的结构化错误码；命中 `TASK_QUEUE_WAIT_TIMEOUT` 时，不再当普通失败，而是映射成 `TaskQueueWaitTimeoutError`。
    3. `apps/host/src/modules/tasks/task-lane-executors.ts` 会把 `queueWaitTimeoutMs` 显式带到 helper 请求协议里，避免 Host 和 helper 各自猜阈值。
    4. `apps/host/src/modules/tasks/task-scheduler.ts` 现在会把 helper 内部排队超时也统一收口成 Host 侧 `queue_timeout` 快照，不再只显示成泛化 `failed`。
    5. `apps/host/src/modules/workspace/affairs-library-service.ts` 已把目录 hint、apply-config、index、export 的队列等待阈值补齐；`apps/user-app` 同步补了 `queue_timeout` 类型和状态展示文案。
    6. 测试已覆盖三层：
       - helper client 错误码映射
       - TaskManager 收口 `queue_timeout`
       - 事务文档库状态快照展示 `queue_timeout`
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §2.3.4、§5.3

### 阶段检查

- [x] 2.3 队列状态阶段检查
  - 状态：DONE
  - 这一步到底做什么：检查 queued、running、queue_timeout、cancelled 这些状态是不是已经说真话。
  - 做完你能看到什么：以后再报“卡住”，先看状态就能少猜一半。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不扩前端大改版。
  - 怎么算完成：
    1. 排队状态不会无限悬挂
    2. 调试日志和状态 DTO 能区分不同等待/失败原因
  - 怎么验证：
    - 人工走查
    - 定向测试
    - `pnpm -C apps/host exec vitest run tests/modules/tasks/task-helper-client.test.ts tests/modules/tasks/task-helper-scheduling.test.ts tests/integration/task-manager.test.ts tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/host exec tsc --noEmit`
    - `pnpm -C apps/user-app exec tsc --noEmit`
  - 本次完成说明：
    1. Host 队列等待超时和 helper 内部排队超时，现在都统一落成 `queue_timeout`，不再混进普通 `failed`。
    2. 事务文档库索引状态和目录刷新状态都已经能区分 `queued / running / queue_timeout / failed`。
    3. `apps/user-app` 已补状态类型与标签文案，至少前端不会再把 `queue_timeout` 掉进默认分支。
    4. 当前队列状态链路已经能基本说真话：
       - Host 没开始跑：`queued`
       - Host 跑起来但 helper 内部排队卡住：`queue_timeout`
       - 真正在执行：`running`
       - 用户或系统主动取消：`cancelled`
       - 普通执行失败：`failed`
  - 对应需求：`requirements.md` 需求 2、需求 5
  - 对应设计：`design.md` §4.2、§5

---

## 阶段 3：把 helper 从共享单进程改成 per-rootDir 隔离

- [x] 3.1 设计并落地 per-rootDir helper 池
  - 状态：DONE
  - 这一步到底做什么：把共享 helper 模型改成按 `rootDir` 隔离的执行池，同根目录串行，不同根目录并行。
  - 做完你能看到什么：一个资料库卡住，不再把另一个资料库也拖死。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.1、§2.3.5、§4.2、§6.1
    - `apps/host/src/modules/tasks/task-helper-client.ts`
    - `apps/host/src/modules/tasks/task-helper-process.ts`
    - `apps/host/src/modules/tasks/task-helper-scheduling.ts`
  - 主要改哪里：
    - `apps/host/src/modules/tasks/task-helper-client.ts`
    - `apps/host/src/modules/tasks/task-helper-process.ts`
    - `apps/host/src/modules/tasks/task-helper-scheduling.ts`
    - 可能新增 `task-helper-pool.ts`
  - 这一步先不做什么：不改 Host 目录读取逻辑。
  - 怎么算完成：
    1. 同根目录任务仍串行
    2. 不同根目录任务可并行
  - 怎么验证：
    - 集成测试
    - 多 rootDir 并发回放
    - `pnpm -C apps/host exec vitest run tests/modules/tasks/task-helper-pool.test.ts tests/modules/tasks/task-helper-client.test.ts tests/integration/task-manager.test.ts tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/user-app exec tsc --noEmit`
  - 本次完成说明：
    1. 新增 `apps/host/src/modules/tasks/task-helper-pool.ts`，按 `rootDir` 维护独立 worker，默认 key 继续兜底非 rootDir 任务。
    2. `apps/host/src/modules/tasks/task-lane-executors.ts` 已改成统一走共享 helper pool；同一个 `rootDir` 会复用同一个 helper，不同 `rootDir` 会起不同 worker。
    3. `apps/host/src/server/create-server.ts` 已从回收单 helper client，切到回收共享 helper pool，避免进程退出时漏 worker。
    4. 测试已补 `apps/host/tests/modules/tasks/task-helper-pool.test.ts`，确认同 rootDir 复用、不同 rootDir 隔离。
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §2.1、§2.3.5、§4.2、§6.1

- [x] 3.2 补 cancel fallback 和 worker 健康信息
  - 状态：DONE
  - 这一步到底做什么：在软取消不生效时，只 kill 当前 `rootDir` worker，并补 pid、心跳、最近完成时间等健康信息。
  - 做完你能看到什么：worker 真卡死时，不会继续靠猜。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 5
    - `design.md` §2.3.5、§5.3
    - helper 相关实现文件
  - 主要改哪里：
    - helper 池与健康状态相关文件
    - 对应测试文件
  - 这一步先不做什么：不扩成通用分布式任务平台。
  - 怎么算完成：
    1. 软取消超时后可以只回收当前 rootDir worker
    2. 状态里能看到关键健康信息
  - 怎么验证：
    - 卡死回放
    - 取消场景测试
    - `pnpm -C apps/host exec vitest run tests/modules/tasks/task-helper-pool.test.ts tests/modules/tasks/task-helper-client.test.ts tests/integration/task-manager.test.ts tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/user-app exec tsc --noEmit`
  - 本次完成说明：
    1. `apps/host/src/modules/tasks/task-helper-client.ts` 现在会记录 `pid`、启动时间、最近心跳、最近退出时间、最近回收原因，以及远端 inflight request 数。
    2. `apps/host/src/modules/tasks/task-helper-pool.ts` 已补软取消 fallback：超时后只 kill 当前 `rootDir` 的 worker，不再误伤别的资料库。
    3. `apps/host/src/modules/workspace/affairs-library-service.ts` 把 worker health 挂进 `AffairsLibraryIndexStatusDto.workerHealth`，前端状态面板现在能直接看到 pid、心跳、最近完成时间、最近强制回收等信息。
    4. `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx` 和 i18n 已补 worker 状态展示，不再只能看一个笼统的 `running / failed`。
  - 对应需求：`requirements.md` 需求 3、需求 5
  - 对应设计：`design.md` §2.3.5、§5.3

### 阶段检查

- [x] 3.3 helper 隔离阶段检查
  - 状态：DONE
  - 这一步到底做什么：确认“共享 helper 拖全局”的旧问题已经被真正消掉，而不是换了个写法继续存在。
  - 做完你能看到什么：不同资料库之间的故障域真的缩小了。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不顺手扩更多后台任务。
  - 怎么算完成：
    1. 不同 rootDir 可并行
    2. 单 rootDir 故障只影响自己
  - 怎么验证：
    - 人工走查
    - 多 rootDir 集成测试
    - `pnpm -C apps/host exec vitest run tests/modules/tasks/task-helper-pool.test.ts tests/modules/tasks/task-helper-client.test.ts tests/integration/task-manager.test.ts tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/user-app exec tsc --noEmit`
  - 本次完成说明：
    1. 现在的隔离边界已经缩到 `rootDir`：一个 worker 卡住，只会影响自己的资料库，不会再把别的资料库索引也拖死。
    2. 软取消 fallback 已经按 rootDir 定位回收，worker health 也能直接告诉你是哪一个 worker 在卡、是不是刚被强杀过。
    3. 这轮没有另起新调度体系，还是继续复用 `TaskManager + helper_process lane`，只是把执行单元从“全局一份”收成“每个 rootDir 一份”。
  - 对应需求：`requirements.md` 需求 3、需求 5
  - 对应设计：`design.md` §2.3.5、§4.2、§6.1

---

## 阶段 4：把 Host 主线程上的重同步 I/O 收口

- [x] 4.1 盘点并打点主线程同步 I/O 热点
  - 状态：DONE
  - 这一步到底做什么：先把文档库主链路里最重的同步 I/O 路径找全、打点，不盲改。
  - 做完你能看到什么：知道到底是哪些目录读取、快照读取和 stat/readdir 在拖 Host。
  - 先依赖什么：3.3
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3.6、§4.1
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
  - 主要改哪里：
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
    - 日志/指标相关文件
  - 这一步先不做什么：不直接改所有调用路径。
  - 怎么算完成：
    1. 主要同步 I/O 热点已经列清
    2. 已有基本观测数据
  - 怎么验证：
    - 代码走查
    - 指标/日志检查
    - `pnpm -C apps/host exec vitest run tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/user-app exec tsc --noEmit`
  - 本次完成说明：
    1. 已把这轮最重的同步 I/O 主路径先打点出来：`export_data_read`、`directory_live_scan_sync`、`directory_live_scan_deferred`。
    2. `apps/host/src/modules/workspace/affairs-library-service.ts` 现在会记录导出快照读取耗时、同步 live scan 耗时，以及为什么这次没有走主线程扫盘。
    3. 这一步先做观测，不把所有路径一口气重写，避免又引入新抖动。
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §2.3.6、§4.1

- [x] 4.2 把大目录 live scan 下沉到 helper
  - 状态：DONE
  - 这一步到底做什么：把最重的大目录 live scan 从 Host 请求主链路挪到 helper，Host 只组装结果。
  - 做完你能看到什么：大目录下列表请求不再长期卡在同步扫盘上。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3.6、§3.3、§5.3
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
    - helper 相关文件
  - 主要改哪里：
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
    - `apps/host/src/modules/tasks/task-helper-process-handlers.ts`
    - 可能新增目录 live scan 服务文件
  - 这一步先不做什么：不改预览链路。
  - 怎么算完成：
    1. 大目录读取可异步完成
    2. Host 主线程只保留轻量读和结果组装
  - 怎么验证：
    - 集成测试
    - 大目录回放对比
    - `pnpm -C apps/host exec vitest run tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/user-app exec tsc --noEmit`
  - 本次完成说明：
    1. 文档库列表现在会先估算目录规模；超过阈值后，不再在 Host 请求主链路里直接 `readdir/stat` 整个目录。
    2. 大目录场景会先返回 snapshot / hot cache，再异步排 `affairs_library.directory_hint` 到 helper 做 live scan。
    3. 这一步没有新长一套目录扫描 worker，直接复用现有 helper_process + directory hint 任务。
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §2.3.6、§4.1、§5.3

- [x] 4.3 补结果来源和降级策略
  - 状态：DONE
  - 这一步到底做什么：把 `live / snapshot / mixed / stale_fallback` 这些结果来源和降级原因正式暴露出来。
  - 做完你能看到什么：前端和排查者都知道自己看到的是新结果还是保底旧结果。
  - 先依赖什么：4.2
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` §3.2、§5
    - 文档库状态 DTO 和前端使用点
  - 主要改哪里：
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
    - `apps/user-app` 对应状态展示文件
    - 对应测试文件
  - 这一步先不做什么：不重画页面布局。
  - 怎么算完成：
    1. 结果来源对外可读
    2. 降级原因对外可读
  - 怎么验证：
    - DTO 测试
    - 前端状态检查
    - `pnpm -C apps/host exec vitest run tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/user-app exec tsc --noEmit`
  - 本次完成说明：
    1. `AffairsLibraryDirectorySourceDto` 已新增 `stale_fallback`，不再把“先回旧结果”继续伪装成普通 `snapshot / mixed`。
    2. `AffairsLibraryDirectoryStatusDto` 已补 `generatedAt`、`filesystemObservedAt`、`staleReason`，前端状态面板可以直接看到当前是旧结果、旧到什么时间、为什么还没扫到新盘面。
    3. `apps/user-app` 已同步补状态文案和 worker/目录细节展示，不需要翻日志才能知道当前是不是保底结果。
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §3.2、§5

### 最终检查

- [x] 4.4 最终检查点
  - 状态：DONE
  - 这一步到底做什么：确认这轮稳定性治理真的把四个结构性问题都压住了，而不是只修了几个现场 bug。
  - 做完你能看到什么：需求、设计、实现、验证证据能一一对上。
  - 先依赖什么：4.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件
  - 这一步先不做什么：不再追加新需求。
  - 怎么算完成：
    1. 双层兜底刷新已经跑通
    2. queue wait timeout 已经生效
    3. per-rootDir helper 隔离已经生效
    4. Host 主线程同步 I/O 已经明显收口
  - 怎么验证：
    - 定向测试
    - 关键日志与状态检查
    - 人工回放典型现场
    - `pnpm -C apps/host exec vitest run tests/modules/tasks/task-helper-pool.test.ts tests/modules/tasks/task-helper-client.test.ts tests/integration/task-manager.test.ts tests/modules/workspace/affairs-library-service.test.ts`
    - `pnpm -C apps/user-app exec tsc --noEmit`
    - `pnpm -C apps/host exec tsc --noEmit`（当前仍被仓库里与本轮无关的 `src/modules/butler/butler-session-service.ts` 上 4 个 `SessionIndexRecord.isFavorite` 旧错误阻塞；本轮相关文件没有新增 tsc 报错）
  - 本次完成说明：
    1. 双层兜底刷新、queue wait timeout、per-rootDir helper 隔离、Host 主线程大目录降压，这四条主线已经全部落到代码和测试。
    2. 这轮补的是结构性收口，不是临时补丁：状态词、调试词、worker health、stale fallback 都已经有正式 DTO 和前端展示位。
    3. 当前定向测试全部通过；唯一没法给“全绿”的是 Host 全量 tsc，被仓库里本轮无关的 butler 旧错误挡住。
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
