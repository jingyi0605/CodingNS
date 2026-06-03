# 设计文档 - spec016.4-事务文档库刷新阻塞治理与索引稳定性改造

状态：Draft

## 1. 概述

### 1.1 目标

- 把文档库刷新兜底从单层保底改成双层对账
- 给任务排队等待补正式超时和陈旧回收
- 把事务文档库重任务改成按 `rootDir` 隔离执行
- 把 Host 文档库主链路里的重同步 I/O 逐步下沉

### 1.2 覆盖需求

- `requirements.md` 需求 1：双层兜底刷新
- `requirements.md` 需求 2：queue wait timeout 与回收
- `requirements.md` 需求 3：per-rootDir helper 隔离
- `requirements.md` 需求 4：Host 主线程去同步 I/O
- `requirements.md` 需求 5：状态与调试信息补齐

### 1.3 技术约束

- 后端必须继续遵守 `spec001.2` 和 `spec001.2.1`
- watcher 只打脏标记，不直接背重活
- 同一 `rootDir` 内索引产物仍然要串行更新，避免互相踩写
- 10 分钟巡检不能默认变成全量重建器
- 本轮不引入 Redis、MQ 或外部任务系统
- 前端只补必要状态展示，不借机扩成大范围 UI 改版

## 2. 架构

### 2.1 系统结构

这轮把链路拆成四块：

1. **刷新感知层**
   - watcher 继续负责第一时间报信
   - 新增轻量对账器和全库巡检器，负责补 watcher 漏洞

2. **调度与状态层**
   - Host `TaskScheduler` 负责正式任务状态
   - 新增 queue wait timeout 和 queued stale 回收
   - 文档库状态模型补“等待超时”和“阻塞原因”

3. **执行隔离层**
   - helper 从共享单进程模型，升级为按 `rootDir` 隔离的 worker 池
   - 同根目录串行，不同根目录并行

4. **读链路降压层**
   - Host 读链路优先读快照、热缓存、轻量结果
   - 大目录 live scan 逐步迁到 helper
   - 结果明确标注来源

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `AffairsLibraryDirtyWatchService` | 收外部事件、提交脏标记 | watcher 事件 | dirty signal |
| `AffairsLibraryService` | 统一调度刷新、对账、结果读取 | workspaceId、rootDir、状态文件 | 文档库快照、目录结果、状态 |
| `TaskScheduler` | Host 队列调度和状态快照 | taskType、key、input | queued/running/timeout 等状态 |
| `TaskHelperPool`（新增） | 按 `rootDir` 管理 helper worker | rootDir、handler、input | 隔离执行结果 |
| `AffairsLibraryReconcileService`（可内嵌或新增） | 轻量对账和全库巡检 | rootDir、watermark、状态文件 | drift 结果、修复动作 |
| `AffairsLibraryLiveScanService`（可内嵌或新增） | 异步目录读取和结果组装 | rootDir、directoryPath | live 目录结果 |

### 2.3 关键流程

#### 2.3.1 外部事件 -> targeted refresh

1. watcher 收到文件或目录事件
2. 标准化目标路径，过滤临时文件和 `.ai-index` 自身产物
3. 事件写入 pending dirty state
4. quiet window 到期后统一 flush
5. 如果当前没有阻塞任务，优先提交 targeted refresh
6. 如果当前有阻塞任务，只保留 dirty signal，等待下一轮

#### 2.3.2 30~60 秒轻量对账

1. 定时器按工作区或按 rootDir 触发
2. 只检查：
   - `runtime-status.json`
   - `exports/status.json`
   - command lock heartbeat
   - 最近活跃目录 mtime
   - 最近 dirty signal 是否已消费
3. 如果发现状态漂移但范围明确，提交 targeted refresh 或目录级 hint refresh
4. 如果连续多次漂移或判断不清，升级给 10 分钟巡检处理

#### 2.3.3 10 分钟全库巡检

1. 定时器触发全库巡检
2. 先做全库对账：
   - 目录/导出/状态文件 watermark 比对
   - 是否存在大面积未消费的脏目录
   - 是否存在快照长期不更新
3. 结论分三类：
   - `healthy`：无需动作
   - `drift_detected`：触发增量修复
   - `rebuild_required`：触发全量重建
4. 只有 `rebuild_required` 才允许 full rebuild

#### 2.3.4 queued 超时与回收

1. 任务 enqueue 时记录 `enqueuedAt`
2. Host 调度器周期检查 queued 任务年龄
3. 超过 `maxQueueWaitMs` 后，任务进入 `queue_timeout`
4. 清理 active/queued 快照，写结构化日志
5. helper 内部如果请求还在排队，也同步丢弃

#### 2.3.5 per-rootDir worker 执行

1. Host 调度任务时，根据 `rootDir` 选择 worker bucket
2. 同一个 `rootDir` 的重任务总是落到同一隔离执行单元
3. 不同 `rootDir` 可以各跑各的 worker
4. cancel 先走软取消
5. 软取消超时后，仅 kill 当前 `rootDir` worker

#### 2.3.6 大目录读链路降压

1. Host 收到目录读取请求
2. 先判断：
   - 是否有新鲜热缓存
   - 当前目录大小是否超过阈值
   - 当前是否已有 live scan 结果
3. 小目录：允许轻量 live scan
4. 大目录：先返回 snapshot / hot cache，并异步提交 live scan task
5. helper 完成 live scan 后更新热目录结果
6. 前端下一轮读取拿到更新后的结果，并看到真实来源标记

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5

- `AffairsLibraryService.scheduleLightweightReconcile(...)`
- `AffairsLibraryService.schedulePeriodicAudit(...)`
- `TaskScheduler.sweepQueuedTimeouts(...)`（新增）
- `TaskHelperPool`（新增）
- `AffairsLibraryService.requestLiveDirectorySnapshot(...)`（新增或改造）

### 3.2 数据结构

覆盖需求：1、2、3、4、5

#### 3.2.1 `AffairsLibraryReconcileResult`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `scope` | `"lightweight" | "periodic_audit"` | 是 | 当前对账层级 | 二选一 |
| `status` | `"healthy" | "drift_detected" | "rebuild_required"` | 是 | 对账结论 | 三选一 |
| `reason` | `string` | 是 | 发现漂移的原因 | 可读字符串 |
| `targetPaths` | `string[]` | 否 | 建议修复的范围 | 可为空 |
| `observedAt` | `string` | 是 | 对账时间 | ISO 时间 |

#### 3.2.2 `QueueWaitPolicy`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `maxQueueWaitMs` | `number` | 是 | 任务最多允许排队多久 | 大于 0 |
| `sweepIntervalMs` | `number` | 是 | 多久扫一次队列老化 | 大于 0 |
| `timeoutStatus` | `"queue_timeout"` | 是 | 超时状态标识 | 固定值 |

#### 3.2.3 `TaskBlockingInfo`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `taskId` | `string` | 是 | 阻塞任务 ID | 非空 |
| `taskType` | `string` | 是 | 阻塞任务类型 | 非空 |
| `rootDir` | `string | null` | 否 | 对应资料库根目录 | 可空 |
| `status` | `string` | 是 | 当前阻塞状态 | queued/running 等 |
| `queuedForMs` | `number | null` | 否 | 已排队多久 | 可空 |
| `runningForMs` | `number | null` | 否 | 已运行多久 | 可空 |

#### 3.2.4 `AffairsLibraryDataFreshnessDto`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `source` | `"live" | "snapshot" | "mixed" | "stale_fallback"` | 是 | 当前结果来源 | 四选一 |
| `generatedAt` | `string | null` | 否 | 当前结果生成时间 | 可空 |
| `filesystemObservedAt` | `string | null` | 否 | 最近一次真实文件系统观察时间 | 可空 |
| `staleReason` | `string | null` | 否 | 为什么当前还是旧结果 | 可空 |

### 3.3 接口契约

覆盖需求：1、2、4、5

#### 3.3.1 轻量对账入口

- 类型：Function / Service
- 标识：`scheduleLightweightReconcile(workspaceId, rootDir, reason)`
- 输入：工作区、根目录、原因
- 输出：无，异步更新状态和修复动作
- 校验：只处理已绑定、已启用文档库
- 错误：失败写日志并保留最近状态

#### 3.3.2 全库巡检入口

- 类型：Function / Service
- 标识：`schedulePeriodicAudit(workspaceId, rootDir, reason)`
- 输入：工作区、根目录、原因
- 输出：无，异步更新状态和修复动作
- 校验：只处理已绑定、已启用文档库
- 错误：失败写日志并保留最近状态

#### 3.3.3 队列老化回收入口

- 类型：Function / Scheduler
- 标识：`sweepQueuedTimeouts()`
- 输入：当前调度器中的 queued 任务
- 输出：更新后的任务状态和日志事件
- 校验：只处理仍未启动的 queued 任务
- 错误：回收失败不影响其他任务继续扫描

#### 3.3.4 目录异步 live scan 入口

- 类型：Function / Helper Task
- 标识：`requestLiveDirectorySnapshot(rootDir, directoryPath)`
- 输入：根目录、目录路径
- 输出：live 目录结果、来源、观察时间
- 校验：目录路径必须在资料库根目录之内
- 错误：失败时回退到最近快照并返回失败原因

## 4. 数据与状态模型

### 4.1 数据关系

- **watcher / 对账器** 只负责发现可能有变化
- **TaskScheduler** 负责决定任务是否排队、是否超时、是否失效
- **TaskHelperPool** 负责按 `rootDir` 隔离执行真正重活
- **AffairsLibraryService** 负责把导出快照、热目录结果、任务状态和错误摘要对前端收口
- **SQLite + 导出快照** 仍然是当前真源，不引入第二套主索引真源

### 4.2 状态流转

#### 4.2.1 文档库全局状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `fresh` | 当前结果可信 | 最近刷新成功且无新脏标记 | 新脏标记到来 |
| `stale` | 结果可能旧了 | watcher / 对账发现漂移 | 修复成功或升级为运行中 |
| `queued` | 修复任务已入队未开始 | enqueue 成功但未启动 | 启动执行或等待超时 |
| `running` | 后台修复正在执行 | worker 已开始执行 | 成功、失败或取消 |
| `queue_timeout` | 排队等待超时 | queued 超过阈值 | 新一轮任务重新入队 |
| `failed` | 最近一次修复失败 | 任务执行失败或 orphan 回收 | 下次成功修复 |
| `cooldown` | 刚完成，短时间避免重复跑 | 成功修复后进入冷却 | 冷却结束或新脏标记到来 |

#### 4.2.2 per-rootDir worker 状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `idle` | 当前 rootDir 没有执行单元在忙 | 没有活动任务 | 新任务入队 |
| `queued` | 已有待执行任务 | 同根目录前面还有任务 | 启动执行或队列超时 |
| `running` | 当前 rootDir 正在执行任务 | worker 开始执行 | 成功、失败、取消 |
| `terminating` | 正在回收当前 worker | kill fallback 启动 | worker 退出 |
| `recycled` | worker 已正常回收 | 空闲超时或高水位回收 | 新任务到来 |

## 5. 错误处理

### 5.1 错误类型

- `QUEUE_WAIT_TIMEOUT`：任务排队太久仍未启动
- `HELPER_ROOTDIR_STALLED`：某个 `rootDir` 的 worker 停滞
- `LIVE_SCAN_DEGRADED`：大目录 live scan 失败，回退到快照
- `PERIODIC_AUDIT_DRIFT`：周期巡检发现大范围漂移
- `FULL_REBUILD_REQUIRED`：漂移严重，需要全量重建

### 5.2 错误响应格式

```json
{
  "detail": "当前文档库刷新等待超时，请稍后重试或查看阻塞任务。",
  "error_code": "QUEUE_WAIT_TIMEOUT",
  "field": null,
  "timestamp": "2026-06-03T00:00:00Z"
}
```

### 5.3 处理策略

1. watcher 漏事件：进入轻量对账，不直接报错
2. queued 超时：更新状态为 `queue_timeout`，清理陈旧快照，并允许下一轮重新入队
3. worker 卡死：先软取消，再 kill 当前 `rootDir` worker
4. 大目录 live scan 失败：回退到快照，状态标记为 `stale_fallback`
5. 周期巡检发现严重漂移：升级为 full rebuild，但只在明确需要时触发

## 6. 正确性属性

### 6.1 属性 1：不同资料库互不拖死

*对于任何* 不同 `rootDir` 的事务文档库任务，系统都应该满足：一个根目录的 queued/running/kill 不会阻塞另一个根目录进入执行。

**验证需求：** `requirements.md` 需求 3

### 6.2 属性 2：排队状态不会无限悬挂

*对于任何* 进入 queued 的后台任务，系统都应该满足：它要么在阈值内进入 running，要么明确进入 `queue_timeout` 或被取消，不允许无限挂起。

**验证需求：** `requirements.md` 需求 2

### 6.3 属性 3：10 分钟保底不默认制造大写入

*对于任何* 10 分钟巡检触发场景，系统都应该满足：先做对账，只在发现严重漂移时才触发 full rebuild，而不是默认改写全部索引产物。

**验证需求：** `requirements.md` 需求 1、非功能需求 1

## 7. 测试策略

### 7.1 单元测试

- 轻量对账决策：healthy / drift_detected / rebuild_required
- queue wait timeout 和 queued stale sweeper
- per-rootDir 调度桶选择和 cancel fallback
- 大目录读链路的 snapshot / live / mixed 降级判断

### 7.2 集成测试

- 两个不同 `rootDir` 同时刷新互不阻塞
- 同一 `rootDir` 多个任务串行且状态正确
- watcher 漏事件后轻量对账能补到结果
- 10 分钟巡检发现漂移时能先走增量修复

### 7.3 端到端测试

- 用户修改文件后，目录时间和详情在合理时间内更新
- 当前目录很大时，前端能先读到最近快照，再看到异步补新的结果
- 队列故意堵塞时，前端能看到等待超时而不是永久刷新中

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.3.2、§2.3.3、§4.2 | 对账决策单测 + 周期巡检集成测试 |
| `requirements.md` 需求 2 | `design.md` §2.3.4、§4.2、§5.3 | 调度器单测 + 队列堵塞回放 |
| `requirements.md` 需求 3 | `design.md` §2.3.5、§4.2、§6.1 | 多 rootDir 并发集成测试 |
| `requirements.md` 需求 4 | `design.md` §2.3.6、§3.3、§5.3 | 大目录场景回放 + 响应时间比较 |
| `requirements.md` 需求 5 | `design.md` §3.2、§4.1、§5 | 状态 DTO 测试 + 调试日志检查 |

## 8. 风险与待确认项

### 8.1 风险

- per-rootDir worker 池如果收得太急，可能引入新的生命周期 bug
- 大目录 live scan 下沉后，如果缓存和版本号不清楚，前端仍然会误读旧结果
- queue timeout 阈值如果拍脑袋定太小，会把本来正常的等待误判成故障

### 8.2 待确认项

- 轻量对账和全库巡检是否统一走现有 `TaskManager`，还是轻量对账先用 service 内部调度
- 大目录阈值是按文件数、目录层级还是累计 stat 成本来判定
- 前端状态面板里是否直接显示阻塞 `taskId` / `rootDir`，还是只显示摘要
