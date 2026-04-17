# 需求文档 - spec001.2.1 读写刷新与后台任务统一规则

状态：Draft

## 简介

`spec001.2` 已经把最痛的卡顿止住了，但仓库里还有一个根问题没被彻底写死：

- 很多读接口会顺手触发刷新
- 很多“后台任务”其实还在 Host 主线程里做重活
- 很多模块还保留私有 `inflight`、私有 `timer`、私有 watcher
- 文件树、Git、工作台、Butler、Provider 各自都有自己的“缓存 + 刷新 + 广播”小套路

这类代码短期能跑，长期一定继续长出卡顿。

所以这次不只是修几个模块，而是把整个仓库统一成一套可执行规则：

1. 什么叫纯读，什么叫有副作用的读
2. 什么写操作允许留在请求里，什么必须拆出去
3. 什么刷新必须走 `TaskManager`
4. 什么私有 `inflight` 还能保留，什么不准再保留
5. 什么 watcher 可以接受，什么 watcher 一律算坏味道

## 术语表

- **纯读**：只读取当前状态，不修改缓存、不排后台任务、不改数据库、不发广播
- **缓存读**：读取最近可用结果；允许命中缓存，但不允许在当前调用里现算重任务
- **请求内写**：用户当前请求必须立刻完成的写操作，例如保存单个文件、更新单条设置
- **后台刷新**：可以延后、可以去重、可以用最近结果兜底的刷新动作
- **重扫描**：跨目录、跨工作区、跨 Provider、跨大量记录的高成本 I/O 或 CPU 工作
- **操作预算**：某类动作允许占用的主线程时间和收尾体量边界
- **脏标记**：资源状态已经过期或被外部事件改脏，需要后续刷新
- **冷却时间**：同一资源刚刷新完的一段时间内，不允许再次发起等价重活

## 范围说明

### In Scope

- 统一定义 Host 里的读、写、刷新、广播、watcher、后台任务规则
- 为 `get/list/read/snapshot/refresh/schedule/ensure/invalidate` 等命名建立行为约束
- 为 `TaskManager`、私有 `inflight`、私有 `timer`、私有 watcher 建立准入标准
- 为文件树、Git、工作台、Butler、Provider、终端、调试链路建立统一模式
- 为新增服务建立接入检查清单和验收口径

### Out of Scope

- 一次性改完所有历史模块
- 设计分布式任务系统
- 重写所有仓储层 API
- 制定前端视觉或交互规范
- 讨论业务功能本身该不该存在

## 需求

### 需求 1：读接口必须默认无副作用，不能顺手刷新

**用户故事：** 作为维护者，我希望看到 `get/list/read/snapshot` 这类方法时，知道它们只是读，不会顺手排后台任务或改状态。

#### 验收标准

1. WHEN 方法名为 `get*`、`list*`、`read*`、`peek*`、`build*Snapshot` THEN System SHALL 默认保持无副作用
2. WHEN 某个读动作必须顺手触发刷新 THEN System SHALL 改用显式命名，例如 `ensure*`、`schedule*Refresh`，而不是继续藏在 `get*` 里
3. WHEN 一个接口既要返回当前结果又要推动后续刷新 THEN System SHALL 先完成纯读，再通过显式后台刷新入口推进，而不是在读方法内部偷偷发任务
4. WHEN 维护者新增服务方法 THEN System SHALL 先把它归类到“纯读 / 缓存读 / 请求内写 / 后台刷新 / 重扫描”五类之一，不允许同一个方法混着承担两类以上职责

### 需求 2：刷新动作必须有统一状态模型，不能只靠 dedupe 硬撑

**用户故事：** 作为排查性能问题的人，我希望知道一个资源现在到底是新鲜、过期、正在刷新还是刚刷新完，而不是只能看它有没有命中某个 inflight Promise。

#### 验收标准

1. WHEN 一个资源支持后台刷新 THEN System SHALL 至少能表达 `fresh`、`stale`、`running`、`cooldown` 这几种状态
2. WHEN 同一资源短时间内被重复触发 THEN System SHALL 根据脏标记和冷却时间决定是否真正入队，而不是每次都重新 enqueue
3. WHEN 刷新完成、失败或被取消 THEN System SHALL 更新资源刷新状态，并保留后续观测所需的最近结果或错误信息
4. WHEN 资源实现刷新状态 THEN System SHALL 至少记录 `dirtyReasons`、`lastRequestedAt`、`lastStartedAt`、`lastCompletedAt`、`lastFailedAt`、`nextAllowedAt`、`runningTaskId`
5. WHEN 资源已经处于 `running` THEN System SHALL 合并新的脏标记，不得为同一资源继续重复创建并发刷新
6. WHEN 资源处于 `cooldown` 且没有新的脏标记 THEN System SHALL 直接复用最近结果，不得为等价请求重复开重活

### 需求 3：跨请求后台刷新必须走统一任务系统

**用户故事：** 作为后续接手的人，我希望跨请求刷新都能在一个地方看到去重、并发、超时、取消和指标，而不是每个服务自己搞一套。

#### 验收标准

1. WHEN 一个任务跨请求存在、需要去重、需要观测或会影响多个入口 THEN System SHALL 通过统一 `TaskManager` 注册和调度
2. WHEN 一个任务只是在当前服务内部做很短的缓存填充，且不跨请求、不需要重试和指标 THEN System MAY 保留私有 `inflight`
3. WHEN 使用私有 `inflight` THEN System SHALL 明确它只用于“同一资源、同一进程、短生命周期”的 Promise 复用，不得悄悄替代正式后台任务
4. WHEN 私有 `inflight` 开始长出定时器、失败状态、重试、跨入口刷新、长生命周期缓存或专门的 abort 控制器 THEN System SHALL 视为越界并迁回 `TaskManager`
5. WHEN 一个刷新型任务已经需要独立指标、排队信息或任务 TTL THEN System SHALL 不再允许只靠模块内变量硬撑

### 需求 4：Host 主线程只允许做小而确定的读写

**用户故事：** 作为用户，我希望正常保存文件、改设置这类小操作保持直接，但 repo 级扫描、Provider 本地历史读取这类脏活别再堵主线程。

#### 验收标准

1. WHEN 动作是单文件读写、单条记录更新、少量 DTO 组装 THEN System MAY 留在请求主链路
2. WHEN 动作涉及跨目录遍历、整仓库扫描、大量 SQLite 记录处理、Provider 本地历史读取、完整 Git history/branches 刷新 THEN System SHALL 不在请求主链路直接执行
3. WHEN 重活已经搬到 helper 或外部进程 THEN System SHALL 同时检查 Host 收尾阶段，避免 helper 回来后又在主线程做大事务和大对象组装

### 需求 5：广播和订阅链路只读缓存，不现算重任务

**用户故事：** 作为用户，我希望终端、工作台、文件树、Git 面板互不拖累，而不是某条订阅链路里顺手现算重活，把整条链都拖慢。

#### 验收标准

1. WHEN WebSocket 广播或订阅刷新发生 THEN System SHALL 优先读取缓存或最近结果
2. WHEN 需要重算 THEN System SHALL 先调后台刷新，再在结果准备好后广播
3. WHEN 订阅关闭 THEN System SHALL 释放对应 watcher、定时器和 abort 控制器，不得继续空转

### 需求 6：watcher 必须按作用域收缩，禁止默认整仓库递归监听

**用户故事：** 作为系统维护者，我希望 watcher 只盯用户当前关心的那一点，不要为一个面板就把整个 repo 全部 watch 起来。

#### 验收标准

1. WHEN 文件树只展示当前目录 THEN System SHALL 优先监听当前展开目录及必要父级，而不是整个工作区
2. WHEN Git 面板需要感知变化 THEN System SHALL 优先监听 `.git` 元数据或更小的变化源，而不是递归 watch 整个 repo
3. WHEN 某个 watcher 需要监听整仓库 THEN System SHALL 在设计文档里说明原因、边界、忽略规则和句柄成本
4. WHEN 订阅关闭、面板隐藏或最后一个监听者离开 THEN System SHALL 及时释放 watcher、定时器和 `AbortController`
5. WHEN watcher 的监听范围无法缩小 THEN System SHALL 额外提供触发频率、句柄数量和释放时机的观测口径

### 需求 7：写操作必须区分“小写”和“重写”

**用户故事：** 作为维护者，我希望看到写操作时能一眼分清：这是请求里直接写完就行，还是应该分批、后台、异步落地。

#### 验收标准

1. WHEN 写操作只影响单个文件、单条配置或少量 SQLite 记录 THEN System MAY 在请求内完成
2. WHEN 写操作涉及批量 upsert、批量 delete、批量关系修正或大事务 THEN System SHALL 分批执行，并在批间主动让出事件循环
3. WHEN 请求内写失败 THEN System SHALL 保持明确的一致性边界，不得写一半再靠隐式重试补救

### 需求 8：命名必须反映副作用

**用户故事：** 作为读代码的人，我希望看名字就知道一个方法会不会改缓存、排任务、发广播，而不是靠猜。

#### 验收标准

1. WHEN 方法名使用 `get/list/read/peek` THEN System SHALL 保持只读语义
2. WHEN 方法会推动刷新、补齐缓存、创建资源或驱动外部副作用 THEN System SHALL 使用 `ensure/schedule/refresh/create/update/invalidate/flush` 等显式命名
3. WHEN 一个方法既有读又有明显副作用 THEN System SHALL 拆分成两个阶段或两个方法，而不是继续用混合语义命名
4. WHEN 现有历史接口暂时不能改协议 THEN System SHALL 在内部先拆成“纯读入口 + 显式刷新入口”，并把旧接口标记为待迁移，而不是继续扩散混合语义

### 需求 9：新增服务接入前必须过统一检查清单

**用户故事：** 作为团队负责人，我希望以后新增服务时，不用再靠人肉记忆判断它会不会把 Host 拖死。

#### 验收标准

1. WHEN 新增服务、面板、轮询器、Provider 适配、后台任务 THEN System SHALL 回答清楚它的读路径、写路径、刷新路径、watcher 范围、执行位点和指标名称
2. WHEN 新服务需要缓存 THEN System SHALL 明确缓存键、TTL、失效条件、脏标记来源和冷却策略
3. WHEN 新服务不能通过这份检查清单 THEN System SHALL 不允许直接合入主干

## 非功能需求

### 非功能需求 1：兼容性

1. WHEN 现有 API 和前端调用点继续访问旧接口 THEN System SHALL 保持响应结构兼容
2. WHEN 内部实现被重构为后台刷新或缓存优先 THEN System SHALL 不要求现有调用方同步改协议

### 非功能需求 2：性能

1. WHEN 同一资源被多个入口触发 THEN System SHALL 避免重复重活和重复 watcher
2. WHEN 后台任务长时间运行 THEN System SHALL 能量化排队时长、执行时长和主线程影响

### 非功能需求 3：可维护性

1. WHEN 新人接手一个模块 THEN System SHALL 让他一眼看懂哪些方法只读、哪些会刷新、哪些会真正改状态
2. WHEN 代码审查新增服务 THEN System SHALL 可以按统一清单审查，不再靠个人经验猜

## 成功定义

- 全仓库形成统一的读、写、刷新、广播、watcher、后台任务规则
- `spec001.2` 已治好的卡顿不再被新代码重新引入
- 新增服务时，能直接用统一检查清单判断它会不会拖慢主线程
- 后续性能问题可以先按规则排查，而不是继续靠经验找运气
