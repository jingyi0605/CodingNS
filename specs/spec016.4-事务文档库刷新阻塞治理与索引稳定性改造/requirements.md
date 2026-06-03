# 需求文档 - spec016.4-事务文档库刷新阻塞治理与索引稳定性改造

状态：Draft

## 简介

事务文档库主链路已经能跑起来，但现在还存在一类非常伤体验的问题：

- 刷新状态长时间卡在“排队中”或“刷新中”
- 上次成功时间很久以前，但界面上看不清楚到底堵在哪
- 文件明明已经改了，目录列表、修改时间或详情还是旧的
- 一个资料库的重任务可能影响别的资料库
- Host 在大目录场景下还会被同步 I/O 拖慢

这些问题不是孤立 bug，而是同一条链路上的四个结构性缺口：

1. 兜底刷新过粗
2. 队列没有等待超时
3. helper 执行隔离不够
4. Host 主线程还在做太多同步 I/O

这份 Spec 的目标，就是把这四层正式拆开并收口，让事务文档库的刷新和索引链路从“偶尔能用”变成“能长期稳定跑”。

## 术语表

- **System**：`CodingNS`
- **轻量对账**：低成本检查状态文件、watermark、最近目录变化和脏标记消费情况，不默认触发全量重建
- **全库巡检**：对整个资料库做周期性一致性检查，发现漂移后优先增量修复
- **queue wait timeout**：任务已经进队列，但长时间没有开始执行时触发的等待超时
- **per-rootDir helper**：按资料库根目录隔离的 helper 执行单元
- **live scan**：直接读取当前文件系统目录结果，而不是只看导出快照
- **watermark**：用于判断当前快照、导出和目录状态是否已经追上最近变更的一组版本或时间信号

## 范围说明

### In Scope

- 双层兜底刷新策略：30~60 秒轻量对账 + 10 分钟全库巡检
- Host 队列等待超时和陈旧 queued 回收
- helper 内部排队等待超时和陈旧请求回收
- 事务文档库重任务按 `rootDir` 隔离执行
- Host 侧大目录 live scan 和同步 I/O 收口方案
- 前端可读状态补充：排队中、执行中、等待超时、阻塞原因、数据来源
- 相关日志、指标和调试信息补齐

### Out of Scope

- Redis / MQ / 外部分布式任务中心接入
- 文档库主索引从 SQLite 切换到别的存储
- 全文搜索、语义搜索和标签系统功能扩展
- 事务视图大规模 UI 重画
- 非事务文档库链路的通用任务系统重构

## 需求

### 需求 1：系统必须把刷新兜底拆成两层，而不是只靠 watcher 和单层保底

**用户故事：** 作为使用者，我希望就算 watcher 漏掉了事件，文档库也能在合理时间内自己补新，而不是一直旧着不动。

#### 验收标准

1. WHEN 外部 watcher 正常工作 THEN System SHALL 继续优先使用 targeted refresh，而不是动不动全量重建。
2. WHEN watcher 漏掉事件或短时间内状态不一致 THEN System SHALL 在 30 到 60 秒内通过轻量对账发现异常并提交修复动作。
3. WHEN 轻量对账多次发现漂移或状态持续不一致 THEN System SHALL 在 10 分钟全库巡检中升级为更大范围修复。
4. WHEN 10 分钟全库巡检运行 THEN System SHALL 先做全库对账，再决定是否增量修复或全量重建，而不是默认重建全部索引。

### 需求 2：系统必须给排队等待定义正式超时和回收规则

**用户故事：** 作为使用者，我希望“排队中”是真状态，不是一个能卡几个小时的假状态。

#### 验收标准

1. WHEN 任务进入 Host 队列后长时间没有开始执行 THEN System SHALL 触发 queue wait timeout，并把结果写进正式状态。
2. WHEN helper 内部请求已经排队很久仍未开始执行 THEN System SHALL 回收该请求，而不是让它无限等待。
3. WHEN 一个 queued 任务已经超时或失效 THEN System SHALL 清理对应快照，避免后续继续把它当成活任务。
4. WHEN 前端读取文档库状态 THEN System SHALL 能区分 queued、running、queue_timeout、failed、cancelled 等不同状态，而不是都显示成“刷新中”。

### 需求 3：系统必须把事务文档库重任务按 rootDir 隔离执行

**用户故事：** 作为维护者，我希望一个资料库卡住时，不会把别的资料库也拖死。

#### 验收标准

1. WHEN 同一个 `rootDir` 上同时触发 apply-config、index、export 等重任务 THEN System SHALL 保证同根目录串行执行。
2. WHEN 不同 `rootDir` 上同时触发重任务 THEN System SHALL 允许它们并行执行，而不是继续全局串行。
3. WHEN 某个 `rootDir` 的 helper 任务卡死或被取消 THEN System SHALL 只回收该 `rootDir` 对应执行单元，不影响别的资料库。
4. WHEN 系统需要展示阻塞原因 THEN System SHALL 能指出是哪个 `rootDir`、哪个任务类型、哪个任务 ID 在阻塞。

### 需求 4：系统必须把 Host 主线程上的重同步 I/O 收口

**用户故事：** 作为使用者，我希望文档库在大目录场景下也能稳定响应，而不是因为 Host 主线程扫盘太重导致整体发卡。

#### 验收标准

1. WHEN Host 读取文档库目录列表 THEN System SHALL 优先使用最近结果、轻量缓存或异步产物，不把大目录同步遍历长期留在主线程。
2. WHEN 当前目录很大或 live scan 很重 THEN System SHALL 允许先返回最近快照，再异步补新，而不是一直卡住请求等待同步扫盘完成。
3. WHEN 需要做重目录扫描或重文件遍历 THEN System SHALL 优先下沉到 helper 执行，而不是在请求主链路里同步完成。
4. WHEN 前端读取文档库状态或目录结果 THEN System SHALL 同时返回当前结果来源，例如 live、snapshot、mixed 或 stale fallback。

### 需求 5：系统必须让状态和调试信息足够定位问题

**用户故事：** 作为维护者，我希望看到刷新问题时，能很快知道是 watcher 漏了、队列堵了、helper 卡了，还是结果读链路还在吃旧缓存。

#### 验收标准

1. WHEN 文档库状态被读取 THEN System SHALL 暴露最近请求时间、最近开始时间、最近完成时间、最近失败时间和当前阻塞任务信息。
2. WHEN 任务处于等待、执行、超时、取消、orphan 回收等阶段 THEN System SHALL 把这些阶段写进结构化日志和状态快照。
3. WHEN 当前目录结果来自热缓存、快照或实时扫描 THEN System SHALL 明确暴露来源，不能让排查者靠猜。
4. WHEN 轻量对账或全库巡检发现漂移 THEN System SHALL 记录漂移原因、触发动作和最终处理结果。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 10 分钟巡检运行 THEN System SHALL 先做对账，不默认全量重建，以避免不必要的磁盘读写和导出写入。
2. WHEN 系统处理多个不同资料库的后台任务 THEN System SHALL 允许不同 `rootDir` 并行，减少无谓的全局串行等待。
3. WHEN Host 面对大目录和高频刷新 THEN System SHALL 控制主线程同步 I/O 规模，避免明显拖慢其他请求。

### 非功能需求 2：可靠性

1. WHEN watcher 漏事件、helper 卡死、队列堵塞或索引产物漂移 THEN System SHALL 有明确恢复动作，而不是无限停在旧状态。
2. WHEN 新结果暂时不可用 THEN System SHALL 尽量保留最近一次可读结果，并把当前问题状态明确暴露给前端。

### 非功能需求 3：可维护性

1. WHEN 后续继续新增事务文档库后台任务 THEN System SHALL 复用这次建立的 queue timeout、per-rootDir 隔离和双层兜底策略。
2. WHEN 后续需要继续优化存储或缓存 THEN System SHALL 先复用本地 SQLite + 导出快照真源，不把 Redis 当成当前主索引真源前提。

## 成功定义

- 事务文档库不会再长期卡在模糊的“排队中 / 刷新中”状态
- watcher 漏事件后，结果能在合理时间内自己补新
- 不同资料库之间不再因为共享 helper 全局互相拖死
- Host 在大目录场景下的同步 I/O 压力明显下降
- 文档库状态、日志和调试信息足够让维护者快速定位阻塞点
