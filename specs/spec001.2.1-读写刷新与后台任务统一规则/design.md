# 设计文档 - spec001.2.1 读写刷新与后台任务统一规则

状态：Draft

## 1. 概述

### 1.1 目标

- 把仓库里“读、写、刷新、广播、watcher、后台任务”的语义统一
- 把当前已经踩过的卡顿教训固化成规则，而不是留在个别修复里
- 让以后新增服务时，先过规则再写代码，避免同类卡顿继续复发

### 1.2 覆盖需求

- `requirements.md` 需求 1：读接口默认无副作用
- `requirements.md` 需求 2：刷新状态模型
- `requirements.md` 需求 3：跨请求后台刷新统一进 `TaskManager`
- `requirements.md` 需求 4：Host 主线程预算
- `requirements.md` 需求 5：广播链路只读缓存
- `requirements.md` 需求 6：watcher 收缩
- `requirements.md` 需求 7：写操作分级
- `requirements.md` 需求 8：命名反映副作用
- `requirements.md` 需求 9：新增服务接入清单

### 1.3 技术约束

- 当前 Host 仍是单 Node.js 主进程，`host_background` 不是独立线程
- 当前 SQLite 仍使用 `better-sqlite3`，同步事务是现实存在的
- 第一阶段必须继续复用现有 `TaskManager`、helper 进程和观测出口
- 这次先定规则和迁移任务，不做大爆炸重写

### 1.4 现状诊断

全仓库已经能看出一批稳定规律。

已经做对的：

1. [`context-aggregator.ts`](../../../apps/host/src/modules/butler/context-aggregator.ts) 的 `getOverview()` 走摘要聚合，不再先造整锅完整快照再裁切
2. [`session-history-service.ts`](../../../apps/host/src/modules/sessions/session-history-service.ts) 已把 `workspace.discovery_scan` 和 provider 标题读取迁到 helper
3. [`workspace-panel-snapshot-service.ts`](../../../apps/host/src/modules/workbench/workspace-panel-snapshot-service.ts) 的 Git 快照已经先做轻量 status，再按需查 history/branches

已经确认的坏味道：

1. [`workbench-service.ts`](../../../apps/host/src/modules/workbench/workbench-service.ts) 的 `getSnapshot()` 仍会顺手 `scheduleWorkspaceRefreshes()`，读和刷新没拆干净
2. [`workbench-ws-hub.ts`](../../../apps/host/src/ws/workbench-ws-hub.ts) 仍保留大量私有 `refreshTask`、`titleSyncTask`、定时器和订阅状态
3. [`workspace-file-watcher.ts`](../../../apps/host/src/modules/workbench/workspace-file-watcher.ts) 对文件树和 Git 面板仍是整工作区递归 `chokidar.watch`
4. [`session-history-service.ts`](../../../apps/host/src/modules/sessions/session-history-service.ts) 里还保留 `workspaceStateRefreshInflight` 这类局部刷新状态，没有纳入统一刷新状态模型
5. [`opencode-base-url-resolver.ts`](../../../apps/host/src/config/opencode-base-url-resolver.ts) 和部分 provider model options 仍用私有 `inflight`，但它们属于“同资源、短生命周期、缓存填充”的局部去重，边界需要写清，而不是一刀切禁止

一句人话：
现在最大的问题已经不是“没有后台任务系统”，而是“哪些动作必须进系统、哪些局部去重可以保留、哪些方法名在骗人”。

这不是纸上谈兵。
从你提供的并行任务调试面板可以直接看到几个危险信号：

1. `workspace.discovery` 启动 23123 次，平均执行 3322.06 ms，缓存命中中 3964
2. `workspace.discovery_scan` 启动 23123 次，平均执行 3248.06 ms
3. `workbench.sync_titles` 平均执行 8508.93 ms
4. `terminal.manager_snapshot` 启动 2034 次，平均执行 1423.57 ms

这说明当前问题不是“偶发慢一下”，而是读链路、刷新链路和广播链路已经形成了长期反复触发的任务洪水。
所以阶段 2 的规则必须把“谁能触发任务、什么时候允许重跑、什么时候只能读缓存”写死。

## 2. 统一规则

### 2.1 五类操作模型

以后全仓库的服务方法只允许落到下面五类之一。

| 类型 | 典型命名 | 是否允许副作用 | 是否允许重活 | 典型例子 |
| --- | --- | --- | --- | --- |
| 纯读 | `get/list/read/peek` | 否 | 否 | `listWorkspaceSessions`、`peekSnapshot` |
| 缓存读 | `get*Snapshot`、`getOverview` | 只允许读缓存 | 否 | `getGitPanelSnapshot` 命中缓存、Butler 概览 |
| 请求内写 | `save/update/create/delete` | 是 | 仅限小而确定 | 单文件保存、单条设置更新 |
| 后台刷新 | `schedule/ensure/refresh/invalidate` | 是 | 是，但不能堵当前请求 | `requestWorkspaceDiscovery` |
| 重扫描 | `*Scan`、helper handler | 是 | 是，必须脱离主线程 | `workspace.discovery_scan`、`workspace.code_composition_scan` |

规则：

1. 看名字先判断类型，不允许混种
2. 一旦既想读又想刷新，就拆成“先读，后显式刷新”
3. 真正的重活一律不能躲在 `get*` 里

进一步固定成下面这张审查表。

| 类型 | 调用方期待拿到什么 | 允许立即做的事 | 明确禁止 | 推荐模式 |
| --- | --- | --- | --- | --- |
| 纯读 | 当前内存/数据库里已经有的状态 | 组装 DTO、读取已有缓存、做轻量权限检查 | 排任务、改脏标记、发广播、触发 watcher 变更 | `getCachedX()`、`listX()` |
| 缓存读 | 最近一次可用结果，即使可能不是最新 | 读缓存、标记结果来源、返回 `isStale` | 现算重任务、补跑整仓库扫描 | `getXSnapshot()` + `scheduleXRefresh()` |
| 请求内写 | 当前请求必须立即完成的单资源变更 | 单文件写、单条记录写、短事务 | 批量 upsert/delete、跨目录扫描、长事务补偿 | `saveX()`、`updateX()` |
| 后台刷新 | 尽快把缓存或派生结果补新 | 写脏标记、入队、合并重复请求、更新状态机 | 在当前读请求里等待全量重算完成 | `ensureXFresh()`、`scheduleXRefresh()` |
| 重扫描 | 重新发现或重建较大范围数据 | 交给 helper/external、分批上报进度 | 留在 Host 请求链路、塞进广播回调同步执行 | `runXScan()`、helper handler |

如果代码评审里看不出某个方法属于哪一类，这个方法十有八九已经设计错了。

### 2.2 命名约束

#### 2.2.1 只读命名

- `get*`
- `list*`
- `read*`
- `peek*`

这些方法默认必须满足：

1. 不 enqueue 后台任务
2. 不改缓存状态
3. 不改数据库
4. 不发广播

例外只能是：

- 记录最近访问这种极小、可预期、局部的读侧附带信息

但这类例外必须在注释里说明，而且不能顺手触发重刷新。

#### 2.2.2 副作用命名

- `schedule*`
- `ensure*`
- `refresh*`
- `invalidate*`
- `flush*`
- `create*`
- `update*`
- `delete*`

这些名字必须明确表达：

1. 可能排任务
2. 可能改缓存
3. 可能改数据库
4. 可能触发外部进程或广播

当前最典型的反例就是 [`workbench-service.ts`](../../../apps/host/src/modules/workbench/workbench-service.ts) 的 `getSnapshot()`。
它名字像纯读，行为却会推动后台刷新。这种设计以后不允许继续新增。

### 2.3 刷新状态模型

每个支持后台刷新的资源，统一使用下面的状态概念：

- `fresh`
- `stale`
- `running`
- `cooldown`
- `failed`

最小字段：

| 字段 | 说明 |
| --- | --- |
| `dirtyReasons` | 为什么变脏 |
| `lastRequestedAt` | 最近一次请求刷新时间 |
| `lastStartedAt` | 最近一次真正开始刷新时间 |
| `lastCompletedAt` | 最近一次完成时间 |
| `lastFailedAt` | 最近一次失败时间 |
| `nextAllowedAt` | 冷却截止时间 |
| `runningTaskId` | 当前任务 ID，可空 |

规则：

1. `running` 时再次触发，只记脏，不重复入队
2. `cooldown` 时若没有新的脏原因，直接复用最近结果
3. 只有从 `fresh -> stale` 或 `cooldown -> stale` 时，才允许重新推进后台任务

#### 2.3.1 状态转移

| 当前状态 | 触发事件 | 下一状态 | 动作 |
| --- | --- | --- | --- |
| `fresh` | 文件变化、订阅建立、显式失效 | `stale` | 记录 `dirtyReasons`，准备调度 |
| `stale` | 调度成功入队 | `running` | 记录 `lastStartedAt`、`runningTaskId` |
| `running` | 新的脏事件到来 | `running` | 只追加 `dirtyReasons`，不重复入队 |
| `running` | 任务成功完成 | `cooldown` | 写 `lastCompletedAt`、清空 `runningTaskId`、设置 `nextAllowedAt` |
| `running` | 任务失败 | `failed` | 写 `lastFailedAt`、保留错误摘要、清空 `runningTaskId` |
| `failed` | 新的显式触发或脏事件 | `stale` | 允许重新调度 |
| `cooldown` | 冷却结束且无新脏标记 | `fresh` | 保持最近结果 |
| `cooldown` | 冷却期内又收到新脏事件 | `stale` | 准备下一轮调度 |

#### 2.3.2 冷却规则

冷却不是“为了偷懒”，而是为了砍掉无意义重复重活。

规则：

1. 冷却按“资源 key”生效，不按调用方生效
2. 同一资源在冷却期内允许继续返回最近结果，但不允许重复 enqueue 等价任务
3. 冷却期内如果来了新的 `dirtyReasons`，必须立即从 `cooldown` 回到 `stale`
4. 冷却时间由资源特性决定，但必须写在模块常量或配置里，不能散落在多个 `setTimeout`
5. 没有冷却理由的资源，可以把冷却设为 0，但状态字段仍然要保留，避免后面再次各长一套

#### 2.3.3 返回契约

刷新型资源对外至少要保证两件事：

1. 纯读入口能稳定返回“最近可用结果 + 是否过期”
2. 显式刷新入口能稳定返回“这次有没有真正入队，以及当前状态是什么”

不要再出现“调用方为了知道有没有刷新，只能偷看内部 `inflight` 变量”的垃圾设计。

### 2.4 `TaskManager` 与私有 `inflight` 的边界

#### 2.4.1 必须进 `TaskManager` 的场景

满足任意一条就必须进：

1. 跨请求存在
2. 需要任务指标
3. 需要取消、超时、重试、并发控制
4. 会被多个入口重复触发
5. 失败后需要保留最近结果或状态

典型例子：

- `workspace.discovery`
- `workspace.discovery_scan`
- `provider.capability_refresh`
- `workbench.sync_titles`
- `terminal.manager_snapshot`
- `workspace.management_summary`

#### 2.4.2 可以保留私有 `inflight` 的场景

只有全部满足才允许保留：

1. 同一进程内的 Promise 复用
2. 生命周期很短
3. 不跨请求长期存在
4. 不需要统一指标和重试
5. 失败后不需要独立状态机

典型可接受例子：

- [`opencode-base-url-resolver.ts`](../../../apps/host/src/config/opencode-base-url-resolver.ts) 的局部候选探测复用
- [`codex-model-options.ts`](../../../apps/host/src/modules/provider/codex-model-options.ts) 的短 TTL 配置读取复用
- [`workspace-panel-snapshot-service.ts`](../../../apps/host/src/modules/workbench/workspace-panel-snapshot-service.ts) 的同资源瞬时缓存填充

但注意：
这些局部 `inflight` 不能偷偷演化成完整后台任务系统。只要开始长出重试、队列、状态记录、跨入口刷新，就必须收回 `TaskManager`。

#### 2.4.3 一眼判定已经越界的信号

出现下面任意一个信号，就不要再嘴硬说它只是“局部去重”：

1. 这个 `inflight` 需要配 `setInterval`、`setTimeout` 或长时间保活
2. 调用方不止一个，而且触发来源跨 WebSocket、HTTP、定时器、文件事件
3. 代码开始维护 `lastRunAt`、`retryCount`、`abortController`、`lastError`
4. 模块想统计它的执行次数、耗时、命中率、超时和取消
5. 结果要在请求结束后继续保留给下一次调用复用

满足其中一条，基本就说明它已经是任务系统，只是还没承认。

#### 2.4.4 迁移原则

从私有状态迁到 `TaskManager` 时，优先按这个顺序做：

1. 先保留现有返回结构，不破坏调用方
2. 再把“是否入队、如何 dedupe、如何观测”迁到统一任务系统
3. 最后才清理历史 `inflight/timer/abort` 变量

别反过来。先删局部状态、再补统一语义，最后往往只会把线上行为搞坏。

### 2.5 主线程与执行位点规则

#### 2.5.1 `request_main_thread`

允许：

- 单文件读写
- 单条记录更新
- 小量 DTO 组装
- 小范围校验

禁止：

- 整仓库目录遍历
- Provider 本地历史扫描
- 大批量 SQLite 持久化
- 完整 Git history / branches / diff 聚合
- 长时间轮询等待

#### 2.5.2 `host_background`

适合：

- 轻聚合
- 轻状态整理
- 等待 helper / external 结果
- 分批收尾

不适合：

- 大事务
- 同步文件扫描
- 大量对象组装
- 广播链路里的现算重任务

规则：

1. 单次批处理要主动让出事件循环
2. 一旦出现秒级 `run_ms.avg` 或明显 `event_loop.lag`，优先怀疑收尾阶段没拆干净

#### 2.5.3 `helper_process`

默认放这里的任务：

- 跨目录扫描
- Provider 本地文件 / SQLite 读取
- 代码组成扫描
- 模板端口状态发现
- 标题读取和历史摘要这种重 I/O

#### 2.5.4 `external_process`

默认放这里的任务：

- CLI 模型探测
- 全局 npm 升级
- 外部工具链路

要求：

1. 请求链路必须有缓存或兜底
2. 失败不能直接把用户入口卡死

### 2.6 写操作分级

#### 2.6.1 请求内小写

可接受：

- [`file-content-service.ts`](../../../apps/host/src/modules/file/file-content-service.ts) 这种单文件读取、版本校验、单文件写回
- 单条导航状态更新
- 单次认证状态写入

理由：

- 资源边界清楚
- 体量可控
- 用户请求必须立刻拿到结果

#### 2.6.2 必须拆批或后台化的重写

必须处理：

- 批量 session upsert
- 关系修正
- 批量 stale cleanup
- 长事务 delete / merge

规则：

1. 超过单资源写入的批量动作必须可拆批
2. 批间主动 `yield`
3. 要有阶段指标，不能只有一个总耗时

### 2.7 watcher 与订阅规则

#### 2.7.1 watcher 作用域

优先级：

1. 当前文件或当前目录
2. 当前展开树
3. Git 元数据目录
4. 整仓库 watcher

整仓库 watcher 只能作为最后手段，而且必须写清：

- 为什么做不到更小范围
- 忽略规则
- 句柄成本
- 释放时机

当前 [`workspace-file-watcher.ts`](../../../apps/host/src/modules/workbench/workspace-file-watcher.ts) 是这次第一批要继续收缩的对象。

#### 2.7.2 订阅与广播

规则：

1. 订阅建立时，只挂当前需要的 watcher
2. 订阅关闭时，必须释放 watcher、timer、AbortController
3. 广播时，只读最近结果或缓存
4. 广播前不允许临时现算重任务

#### 2.7.3 watcher 准入表

| 问题 | 允许回答 | 不允许回答 |
| --- | --- | --- |
| 为什么要 watch | 用户正在看这个面板，需要低延迟感知变化 | “先全量 watch，后面再优化” |
| watch 多大范围 | 当前目录、已展开节点、`.git`、明确列出的少量路径 | 默认整个工作区递归 |
| 何时释放 | 订阅关闭、最后一个观察者离开、面板隐藏超时 | 进程结束前一直留着 |
| 触发后做什么 | 标记脏、轻量广播、调度后台刷新 | 直接同步跑 Git history / 全量扫描 |
| 如何观测 | watcher 数量、事件频率、释放日志 | 完全没有口径 |

当前 `workspace-file-watcher.ts` 的问题，不是用了 watcher，而是它把“最后手段”当成了默认路径。

### 2.8 新增服务接入清单

以后新增服务前，必须先回答下面 10 个问题：

1. 这个服务有哪些 `get/list/read` 方法，它们是不是纯读？
2. 哪些动作会改缓存、排任务、发广播？
3. 刷新资源的 key 是什么？
4. 它的脏标记从哪里来？
5. TTL 和冷却时间是多少？
6. 需要 watcher 吗？范围多大？
7. 要不要进 `TaskManager`？
8. 真正重活跑在哪个执行位点？
9. 失败时返回什么兜底结果？
10. 指标和日志字段叫什么？

答不清，这个服务就不该合入。

## 3. 仓库级改造方向

### 3.1 第一批必须继续处理的链路

1. `WorkbenchService.getSnapshot()`
   - 目标：拆掉读接口里的隐式刷新
2. `WorkbenchWsHub`
   - 目标：把订阅刷新、定时器、私有状态压成更清晰的“缓存读 + 显式刷新”模型
3. `WorkspaceFileWatcher`
   - 目标：从整仓库 watcher 收到更小范围
4. Git 面板刷新
   - 目标：降低 abort 风暴，稳定缓存复用和 quiet window
5. `workspaceStateRefreshInflight`
   - 目标：并入统一刷新状态模型，避免继续长散装状态

### 3.2 第二批要补的通用能力

1. 给 `TaskManager` 增加资源刷新状态的薄封装
2. 给新增服务提供统一检查清单
3. 补回归测试，专门防止“get* 方法又开始顺手刷新”

## 4. 验收方式

### 4.1 代码审查验收

新增代码审查时必须先看：

- 有没有纯读方法带副作用
- 有没有私有 `inflight/timer` 越权
- 有没有整仓库 watcher
- 有没有广播链路现算重任务

### 4.2 观测验收

继续使用 `spec001.2` 已有口径：

- `backgroundTasks`
- `schedulers`
- `eventLoop`

补充看：

- 某资源每分钟 refresh 次数
- watcher 数量
- abort / success 比例
- 缓存命中率

### 4.3 回归验收

至少覆盖：

1. 工作台打开和停留数小时后仍不卡
2. 文件树和 Git 面板在大仓库下不出现秒级抖动
3. 新增服务接入时能够按清单回答清楚自己的读写刷新路径
