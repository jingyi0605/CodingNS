# 设计文档 - spec016.2-事务文档库外部变更感知与自动刷新

状态：In Review

## 1. 概述

### 1.1 目标

- 让事务文档库在“用户主要从外部编辑文件”的前提下仍能自动刷新
- 把自动刷新继续收口进现有 `TaskManager` 体系，不再长散装链路
- 用单根监听 + 脏标记 + targeted refresh + 周期兜底替代递归 watcher
- 在索引产物缺失时自动重建，不让事务视图长期挂旧状态

### 1.2 覆盖需求

- `requirements.md` 需求 1：普通外部文件变动后的自动刷新
- `requirements.md` 需求 2：周期自动刷新兜底
- `requirements.md` 需求 3：临时文件过滤与原子写兼容
- `requirements.md` 需求 4：不重新引入 EMFILE 和主线程重活
- `requirements.md` 需求 5：索引产物缺失时自动重建
- `requirements.md` 需求 6：自动刷新状态暴露

### 1.3 技术约束

- 后端必须继续遵守 `spec001.2` 和 `spec001.2.1`
- watcher 不能直接做重活
- 读接口不能回退成“读取时顺手刷新”
- 当前首选执行模型仍然是 Host 侧统一调度 + helper process 执行重活
- 默认接受“最终一致”，不承诺所有外部改动都毫秒级同步

## 2. 架构

### 2.1 系统结构

这条链路拆成五层：

1. **外部事件感知层**
   - 每个资料库根目录只挂一个监听入口
   - 负责接住 `rename` / `change` 等文件系统事件
   - 负责过滤临时文件和 `.ai-index` 自身噪音

2. **脏标记归并层**
   - 规范化路径
   - 合并多次事件
   - 区分 `config`、`tag-rules`、`index` 三类脏标记
   - 对普通文件补出最窄可刷新的 `targetPath`

3. **自动刷新调度层**
   - 经过 quiet window 后统一提交
   - 判断当前是否已有 blocking task
   - 优先入队 targeted refresh
   - 周期刷新走兜底链路

4. **后台索引任务层**
   - 继续由 `TaskManager` 负责去重、状态和观测
   - `apply-config`、`recompute-tags`、`watch-touch/index`、必要时全量重建都走 helper process

5. **状态与消费层**
   - Host 维护最近状态、最近完成时间、最近失败摘要
   - 前端继续只读状态和最近结果
   - 日志和测试用同一套事件口径排查问题

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `AffairsLibraryDirtyWatchService` | 感知外部变更、过滤临时文件、提交脏标记 | workspaceId、rootDir、fs event | `AffairsLibraryWatchDirtyEvent` |
| `AffairsLibraryService` | 合并脏标记、决定自动任务类型、入队后台任务 | dirty event、binding、task state | `TaskManager.enqueue(...)` |
| `TaskManager` | 去重、串行、超时、状态快照 | taskType、key、input | task snapshot、task result |
| `runAffairsIndexerCommand` | 执行索引命令 | rootDir、command、targetPath、reason | index/export result |
| 文档库状态读取接口 | 对前端暴露状态和最近结果 | workspaceId | status + snapshot |

### 2.3 关键流程

#### 2.3.1 外部文件变更 -> targeted refresh

1. 根目录监听收到事件
2. 标准化相对路径
3. 过滤 `.ai-index` 自身产物和临时文件
4. 如路径是普通文档，尝试定位最窄 `targetPath`
5. 把事件写进当前工作区 pending dirty state
6. quiet window 到期后统一 flush
7. `AffairsLibraryService` 判断当前没有阻塞任务后，入队 `affairsLibraryIndex`
8. 如果带 `targetPath`，实际命令走 `watch-touch`
9. helper 完成后回写状态和最近完成时间

#### 2.3.2 watcher 漏事件 -> 周期兜底刷新

1. 每个资料库 watcher 同时挂一个低频 periodic timer
2. 到点后只提交 `periodic_refresh` 脏信号
3. 调度层判断当前是否已有 blocking task
4. 没有则入队自动刷新；有则延后重试
5. 如果当前没有明确目标路径，则允许走更宽范围刷新
6. 完成后刷新最近完成时间和状态

#### 2.3.3 原子写目录事件 -> 目录补扫 -> 归并真实目标

1. watcher 只收到目录级 `rename` 或模糊事件
2. 调用短时间窗口内的目录补扫逻辑
3. 扫描最近变更的真实文件
4. 过滤临时文件后，挑出最窄 `targetPath`
5. 后续仍按 targeted refresh 提交

#### 2.3.4 索引产物缺失 -> 自动重建

1. Host 启动恢复、周期刷新或外部事件链路发现 `.ai-index` / `status.json` / `manifest.json` / 导出快照缺失
2. 当前状态切到 `stale`，脏原因记录为 `missing_index_artifact`、`missing_export_dir`、`missing_export_status`、`missing_export_manifest` 等
3. 调度层入队重建任务
4. helper 执行全量 `index`（必要时先补配置）
5. 成功后重新生成状态文件和导出快照
6. 失败则保留最近一次可读结果和错误摘要

#### 2.3.5 热目录 hint -> 轻任务刷新当前目录结果

1. 前端切到某个目录，或者 watcher 已经明确知道受影响文件在哪个目录
2. Host 不再把这类“当前目录快点变新”的诉求直接塞进全局 `affairs.library_index`
3. Host 先把目录记进热目录窗口，只保留最近 2 到 3 个目录
4. 如果这个目录还没有新鲜结果，或者已经被标脏，就入队 `affairs.library_directory_hint`
5. 这个轻任务只做一件事：重读当前目录真实文件列表，并尽量把导出快照里的标题、摘要、标签拼回来
6. 轻任务完成后只更新内存里的热目录缓存和目录状态，不写 `.ai-index`，也不跟全局 export 抢同一把锁
7. 前端读取当前目录时优先消费这份热目录结果，所以就算全局索引还在跑，当前目录也能先变新

### 2.4 借鉴策略落地优先级

这里不把“借鉴开源网盘经验”写成空话，直接落成三层优先级。

#### 2.4.1 本轮必须落地的五件事

1. **watcher 只报信**
   - 外部事件先转成 dirty signal
   - 不能在 watcher 回调里直接跑索引重活
2. **单根 watcher + targeted refresh + 周期补扫**
   - 这三件事是一个组合，不拆开做
3. **dirty signal 统一进自动调度链路**
   - 统一走 quiet window、去重、blocking task 判断
4. **读链路只读最近结果，但目录切换可以发 hint**
   - 自动刷新存在，也不能反向污染读接口边界
   - 目录切换时可以异步提交当前目录增量刷新 hint，读结果本身不等待刷新完成
5. **索引产物缺失时自动重建**
   - 缺失不是普通失败，要进入恢复链路

#### 2.4.2 下一轮应该继续补的三件事

1. **按目录归并批处理**
   - 当前 `targetPath` 已经能缩小范围，但后面还要进一步减少碎片化任务
2. **失败保留最近一次可用快照**
   - 前端继续读旧快照，状态单独表达失败
3. **更细的结构化观测**
   - 区分 watcher 停止、任务失败、任务被去重、没有新事件这几种情况

#### 2.4.3 后续再做的优化项

1. **目录版本戳 / etag-like 机制**
   - 用来优化更大规模目录的检查成本
2. **pending state 持久化恢复**
   - 解决 Host 重启时短窗口脏信号丢失问题
3. **专用存储通知适配器**
   - 不是当前第一波必须项

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6

- `AffairsLibraryDirtyWatchService`：外部变更监听和脏标记入口
- `AffairsLibraryService.scheduleAutoRefresh(...)`：统一自动刷新调度入口
- `AffairsLibraryService.scheduleDirectoryHintRefresh(...)`：当前目录轻任务入口
- `AffairsLibraryService.flushAutoTasks(...)`：把脏标记转成后台任务
- `TaskManager.peek/enqueue`：用来判断 blocking task 和任务去重
- `readIndexStatus(...)`：统一暴露索引状态、最近完成时间和错误摘要

### 3.2 数据结构

覆盖需求：1、2、3、5、6

#### 3.2.1 `AffairsLibraryWatchDirtyEvent`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `kind` | `"index" | "config" | "tag-rules"` | 是 | 脏标记类型 | 三选一 |
| `reason` | `string` | 是 | 触发原因 | 可读字符串 |
| `targetPath` | `string | undefined` | 否 | 已知受影响路径 | `kind=index` 时可带 |

#### 3.2.2 `PendingWorkspaceDirtyState`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `configChanged` | `boolean` | 是 | 配置是否变更 | 默认 `false` |
| `tagRulesChanged` | `boolean` | 是 | 标签规则是否变更 | 默认 `false` |
| `indexChanged` | `boolean` | 是 | 普通文档是否变更 | 默认 `false` |
| `reasons` | `Set<string>` | 是 | 合并后的原因集合 | quiet window 内累计 |
| `indexTargets` | `Set<string>` | 是 | 归并后的受影响路径 | 可为空 |

#### 3.2.3 `AffairsLibraryAutoTaskState`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `timer` | `NodeJS.Timeout | null` | 是 | 当前自动任务延迟器 | 可空 |
| `applyConfigReasons` | `Set<string>` | 是 | 配置类原因 | 可空 |
| `recomputeTagReasons` | `Set<string>` | 是 | 标签重算原因 | 可空 |
| `indexReasons` | `Set<string>` | 是 | 文档刷新原因 | 可空 |
| `indexTargets` | `Set<string>` | 是 | 需要 targeted refresh 的路径 | 可空 |

#### 3.2.4 `DocumentIndexStatusSnapshot`

沿用 `spec016.1` 里的统一状态模型，但这里补一条解释：

| 状态 | 含义 |
| --- | --- |
| `fresh` | 当前结果可直接用 |
| `stale` | 已发现脏标记，等刷新 |
| `running` | 自动或手动刷新任务正在跑 |
| `cooldown` | 刚刷新完，短时间内避免重复跑 |
| `failed` | 最近一次自动或手动刷新失败 |

#### 3.2.5 `HotDirectoryCacheEntry`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `workspaceId` | `string` | 属于哪个工作区 |
| `directoryPath` | `string` | 当前缓存对应的目录，相对根目录 |
| `items` | `AffairsLibraryDocumentRecordDto[]` | 当前目录直接文档列表 |
| `source` | `"live" \| "snapshot" \| "mixed"` | 当前结果是纯目录实时读、纯快照，还是两者混合 |
| `dirty` | `boolean` | 这个目录是否已经被标脏 |
| `status` | `"idle" \| "queued" \| "running" \| "fresh" \| "failed"` | 当前目录轻任务状态 |
| `lastRefreshRequestedAt` | `string \| null` | 最近一次请求目录刷新时间 |
| `lastRefreshCompletedAt` | `string \| null` | 最近一次目录刷新完成时间 |
| `lastRefreshFailedAt` | `string \| null` | 最近一次目录刷新失败时间 |
| `lastError` | `string \| null` | 最近一次目录刷新错误摘要 |

#### 3.2.6 `AffairsLibraryDirectoryStatusDto`

这份状态专门回答“当前目录现在新不新鲜”，不跟全局索引状态混在一起。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `path` | `string` | 当前目录路径，根目录统一用 `.` |
| `state` | `"idle" \| "queued" \| "running" \| "fresh" \| "failed"` | 当前目录刷新状态 |
| `source` | `"live" \| "snapshot" \| "mixed"` | 当前目录结果来源 |
| `lastRequestedAt` | `string \| null` | 最近一次目录刷新请求时间 |
| `lastCompletedAt` | `string \| null` | 最近一次目录刷新完成时间 |
| `lastFailedAt` | `string \| null` | 最近一次目录刷新失败时间 |
| `runningTaskId` | `string \| null` | 当前目录轻任务 ID |
| `errorSummary` | `string \| null` | 当前目录最近失败摘要 |

### 3.3 接口契约

覆盖需求：1、2、4、5、6

#### 3.3.1 自动刷新调度入口

- 类型：Function / Service
- 标识：`scheduleAutoRefresh(workspaceId, reason, targetPath?)`
- 输入：工作区、原因、可选目标路径
- 输出：无直接结果，只更新 pending state 并 arm timer
- 校验：`workspaceId` 非空，`targetPath` 规范化
- 错误：忽略无效输入，不抛请求级异常

#### 3.3.2 自动任务 flush 入口

- 类型：Function / Service
- 标识：`flushAutoTasks(workspaceId)`
- 输入：工作区 ID
- 输出：必要时入队索引任务
- 校验：必须先检查 binding、rootDir、blocking task
- 错误：记录日志，保留后续重试机会

#### 3.3.3 目录轻任务入口

- 类型：Function / Service
- 标识：`scheduleDirectoryHintRefresh(workspaceId, directoryPath, reason)`
- 输入：工作区、目录路径、触发原因
- 输出：无直接结果，必要时入队 `affairs.library_directory_hint`
- 校验：目录路径归一化；每个目录只允许一个 inflight
- 错误：只更新目录状态，不拖垮全局索引链路

#### 3.3.4 文档库状态读取接口

- 类型：HTTP
- 路径或标识：`GET /api/workspaces/:workspaceId/affairs/library-snapshot`
- 输入：`workspaceId`
- 输出：最近结果 + `DocumentIndexStatusSnapshot`
- 校验：工作区存在、权限通过
- 错误：绑定缺失、索引产物缺失、最近任务失败

#### 3.3.5 目录切换 hint 刷新入口

- 类型：HTTP
- 路径或标识：继续复用 `POST /api/workspaces/:workspaceId/affairs/library-refresh`
- 输入：`reason=directory_hint` + 当前目录 `targetPath`
- 输出：只返回 `scheduled/status`，不等待本轮刷新完成
- 校验：`targetPath` 允许为空；为空时退化成普通自动刷新 hint
- 错误：只影响 hint 本身，不影响当前快照读取

## 4. 数据与状态模型

### 4.1 数据关系

1. **workspaceId** 对应一条 **文档库绑定**
2. **文档库绑定** 对应一个 **rootDir**
3. **rootDir** 对应一个监听入口、一个周期 timer 和一组 pending dirty state
4. **pending dirty state** 只负责表达“哪里可能脏了”
5. **hot directory cache** 只负责当前活跃目录的直接结果和状态
6. **真正全局刷新结果** 仍然以 `.ai-index` 产物和任务状态为准

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `fresh` | 当前结果可用 | 最近一次刷新成功且没有新脏标记 | 外部事件、周期补扫、显式刷新、发现产物缺失 |
| `stale` | 已知需要刷新 | 有脏标记或发现索引产物缺失 | 自动或手动任务启动后进入 `running` |
| `running` | 刷新中 | 自动或手动任务已启动 | 成功进入 `cooldown`，失败进入 `failed` |
| `cooldown` | 刚刷新完，避免立刻重复跑 | 任务完成 | 冷却结束回 `fresh`；若新脏标记则回 `stale` |
| `failed` | 最近刷新失败 | 任务失败或 helper 异常 | 新脏标记、手动重试或周期兜底重新入队后回 `stale` |

## 5. 错误处理

### 5.1 错误类型

- **watcher 初始化失败**：根目录不可用、平台不支持或系统级监听失败
- **task helper 异常**：helper 进程退出、stdout 关闭、任务中断
- **索引产物缺失**：`.ai-index`、`status.json`、导出快照丢失
- **自动刷新失败**：watch-touch / index / recompute-tags 执行失败
- **目录补扫失败**：目录已消失、权限不足或瞬时访问失败

### 5.2 错误响应格式

```json
{
  "detail": "事务文档库自动刷新失败，请稍后重试",
  "error_code": "AFFAIRS_LIBRARY_AUTO_REFRESH_FAILED",
  "timestamp": "2026-05-31T00:00:00Z"
}
```

### 5.3 处理策略

1. watcher 初始化失败：记录日志，状态保持可读，并依赖视图懒检查 / 手动刷新 / 后续同步恢复
2. helper 异常：任务状态转失败，保留最近一次可读结果
3. 索引产物缺失：立即标 `stale` 并走重建调度
4. 目录补扫失败：当前事件降级为更宽范围刷新，而不是静默丢弃

## 5.4 AGENTS.md 变更后的 runtime instruction bundle 重写

这部分不是事务文档库索引逻辑本身，但它跟这轮暴露出来的“外部文件明明改了却长期不生效”是同一类问题：**规则文件改了，运行时却还拿旧快照。**

处理方式：

1. Host 为每个工作区根目录单独监听 `AGENTS.md`
2. 监听回调只做 debounce，不直接改 provider 运行态
3. debounce 到期后，扫描当前工作区已有的 `workspace-session-runtime` 目录
4. 找到已有 `WORKSPACE_SESSION_COMPOSED.md` 后，用最新 `AGENTS.md` 重新组合
5. 原先的 Host 注入附加规则和临时 overlay 保持不丢

边界：

- 不新长私有任务队列
- 不改 Codex/Claude transcript home 策略
- 只重写 instruction bundle 文件本身

## 6. 正确性属性

### 6.1 属性 1：监听数量不随目录树规模线性膨胀

*对于任何* 已启用的事务资料库，系统都应该满足：监听入口数量与资料库数量相关，而不是对子目录逐级递归开 watcher。

**验证需求：** 需求 4

### 6.2 属性 2：watcher 不直接做重活

*对于任何* 文件系统事件，系统都应该满足：watcher 回调只负责产生脏信号和调度，不直接执行重扫描、重导出或重 SQLite。

**验证需求：** 需求 1、需求 4

### 6.3 属性 3：索引产物缺失不会长期静默

*对于任何* 被检测到的索引产物缺失情况，系统都应该满足：状态会转为需要重建，并在后续自动链路里尝试恢复。

**验证需求：** 需求 5、需求 6

## 7. 测试策略

### 7.1 单元测试

- 临时文件过滤规则
- `targetPath` 归并与最窄路径选择
- 脏标记 quiet window 合并逻辑
- 索引产物缺失时的状态判断

### 7.2 集成测试

- 外部文件新增 / 修改 / 删除后的自动刷新入队
- 周期刷新遇到 blocking task 时的延后逻辑
- `.ai-index` 缺失后的自动重建入队
- 自动刷新日志与状态快照更新

### 7.3 端到端测试

- 在外部编辑器修改文档后，事务视图稍后看到最新结果
- watcher 漏事件或重启后，周期刷新补回最新结果
- 删除 `.ai-index` 后，等待缺失事件或下一轮周期兜底触发自动重建并恢复数据

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.3.1、§3.2 | 外部变更 -> targeted refresh 集成测试 |
| `requirements.md` 需求 2 | `design.md` §2.3.2、§4.2 | 周期刷新兜底测试 |
| `requirements.md` 需求 3 | `design.md` §2.3.3、§5.3 | 临时文件过滤与目录补扫测试 |
| `requirements.md` 需求 4 | `design.md` §2.1、§6.1、§6.2 | watcher / TaskManager 结构检查 |
| `requirements.md` 需求 5 | `design.md` §2.3.4、§6.3 | 缺失重建测试 |
| `requirements.md` 需求 6 | `design.md` §3.3、§5.3 | 状态与日志核对 |

## 8. 风险与待确认项

### 8.1 风险

- macOS / 不同文件系统对 `fs.watch(..., { recursive: true })` 的行为一致性有限，仍可能有漏事件
- 某些同步盘或网络目录会只给模糊目录事件，targeted refresh 的精度不一定总是理想
- 自动刷新如果频率控制不好，仍可能把导出链路打出过高内存峰值

### 8.2 待确认项

- 周期兜底刷新默认间隔是否继续固定为 10 分钟，还是后续下放成可配置项
- 目录补扫的扫描深度和数量上限是否需要按根目录规模再细分
- 后续是否需要把脏事件持久化落盘，避免 Host 重启后丢失短窗口内的 pending state
