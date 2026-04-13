# 需求文档 - spec001.2 后端任务调度与主线程压力治理

状态：Draft

## 简介

现在的真问题不是“后端任务不够多”，而是任务跑错地方了。

当前 Host 有几类典型坏味道：

- 请求一进来就顺手做工作区会话发现，导致 `overview`、搜索、工作台刷新也被带着扫 provider 本地存储
- provider 能力读取把“能不能新建会话”绑死在实时模型探测上，探测一慢，入口就跟着卡
- 聚合接口先构造全量 snapshot，再裁前 5 条，CPU 白耗在对象创建和 JSON 序列化上
- 巡检、跟进、摘要这些后台调度器各自维护 `timer`、`ticking`、`inflight`，逻辑分散，指标也散

真正要解决的是三件事：

1. 先把请求链路和后台链路分开
2. 再把高成本任务放到对的执行位点
3. 最后让这些任务能被量化观测，而不是靠感觉猜“是不是主线程卡了”

## 术语表

- **请求主链路**：用户发起一个接口或 WebSocket 刷新后，必须在当前响应里完成的那段逻辑
- **后台任务**：可以延后、可以复用缓存结果、允许异步完成的工作
- **执行位点**：任务实际跑在哪里，当前先分成 `request_main_thread`、`host_background`、`helper_process`、`external_process`
- **缓存命中优先**：请求先返回最近可用结果，再异步触发刷新，而不是每次都现算
- **空转调度器**：即使没有待处理业务任务，也会按固定周期醒一次做轻查询或轻判断的调度器
- **主线程压力指标**：衡量 Host 主线程是否被 CPU、同步 I/O、序列化或长任务拖慢的一组指标

## 范围说明

### In Scope

- 为 Host 内后台任务定义统一分类和注册模型
- 为 `discoverWorkspaceSessions`、provider capability refresh、工作台刷新、Butler 聚合这些链路定义“缓存优先 + 后台刷新”规则
- 明确哪些任务必须迁到 helper 进程，哪些任务允许留在 Host 主线程异步执行
- 为巡检调度器、会话跟进调度器、会话摘要调度器定义空转治理规则
- 为后台任务补齐统一的性能指标、日志字段和可追踪 ID
- 为主线程压力评估定义量化指标和采样方式

### Out of Scope

- 把普通 CRUD 接口统一改造成队列系统
- 把所有 provider CLI 交互都改写成远程 RPC
- 在这个 Spec 里引入分布式任务系统或消息队列
- 重写 Butler 的业务规则本身
- 为了追求“绝对实时”放弃缓存优先

## 需求

### 需求 1：请求链路必须默认缓存优先，禁止现扫重任务

**用户故事：** 作为用户，我希望打开收件箱、工作台、代码助手总览时先看到可用结果，而不是每次都等后台现扫 provider 本地数据。

#### 验收标准

1. WHEN `overview`、搜索、工作台刷新、代码助手项目聚合被调用 THEN System SHALL 优先返回缓存或摘要结果，不得把 `discoverWorkspaceSessions` 作为必经同步步骤
2. WHEN 工作区会话缓存过期或被显式要求刷新 THEN System SHALL 在响应外异步触发后台刷新，而不是阻塞当前请求
3. WHEN 缓存中已有最近结果 THEN System SHALL 允许直接命中缓存，并在必要时并发发起一次去重后的后台刷新

### 需求 2：高成本 provider 会话发现必须离开 Host 主进程同步扫描

**用户故事：** 作为系统维护者，我希望 provider 的本地 `fs/sqlite` 扫描不再堵在 Host 主线程里，不然任何入口都会被拖慢。

#### 验收标准

1. WHEN 触发 provider 会话发现 THEN System SHALL 不在 Host 主进程里执行同步 `fs`/`sqlite` 重扫描
2. WHEN 需要读取 provider 本地历史或模型状态 THEN System SHALL 优先放到 helper 进程，或使用异步分批方式避免单次长任务占满事件循环
3. WHEN helper 进程发现失败 THEN System SHALL 返回最近缓存结果或安全回退值，不得因为单次发现失败把整个入口卡死

### 需求 3：全局后台任务管理器必须接管跨请求后台任务

**用户故事：** 作为后续接手的人，我希望看到一套统一的后台任务模型，而不是每个模块自己造 `inflight map`、`timer` 和重试逻辑。

#### 验收标准

1. WHEN 一个任务属于“跨请求、可延后、需要去重/限流/取消/超时/重试/观测” THEN System SHALL 通过统一的后台任务管理器注册和调度
2. WHEN 同一资源在短时间内被重复触发刷新 THEN System SHALL 按任务键去重，而不是并发发起多次等价重活
3. WHEN 任务超时、失败、被取消或完成 THEN System SHALL 产出统一状态和统一指标，而不是每个模块自己打散日志

### 需求 4：能力探测不能再决定“能不能新建会话”

**用户故事：** 作为用户，我希望新建会话入口尽快可用，不要因为模型列表探测慢就一直停在“供应商检测中”。

#### 验收标准

1. WHEN 调用 `getProviderCapabilities()` 或新建会话依赖 provider 能力 THEN System SHALL 先返回缓存结果或兜底能力
2. WHEN 后台异步模型探测完成 THEN System SHALL 刷新缓存并在后续请求中返回更新后的能力
3. WHEN 实时探测失败 THEN System SHALL 保持入口可用，并给出可解释的限制信息，而不是直接让能力为空

### 需求 5：聚合接口必须按摘要产出，禁止先造全量再裁切

**用户故事：** 作为系统维护者，我希望总览接口只做用户真正会看到的那点聚合，别为了前 5 条先把整锅都煮一遍。

#### 验收标准

1. WHEN 调用 `getOverview()` THEN System SHALL 直接生成摘要版聚合，不得先构造完整 snapshot 再切片
2. WHEN 某个聚合接口只展示有限条目 THEN System SHALL 尽量在收集阶段就限制数量，而不是等全部对象创建完再丢掉大部分
3. WHEN 聚合接口被频繁调用 THEN System SHALL 控制对象创建和 JSON 序列化开销，避免无意义 CPU 消耗

### 需求 6：空转调度器可以醒，但必须轻、可退让、可观测

**用户故事：** 作为排查性能问题的人，我希望知道哪些调度器即使没任务也会醒，它们每次醒来到底做了多少事。

#### 验收标准

1. WHEN `PatrolScheduler` 或 `ButlerFollowUpScheduler` 没有对应业务任务 THEN System SHALL 允许周期醒一次做轻查询或轻判断，但不得继续执行重业务逻辑
2. WHEN 调度器连续多个周期都没有待处理任务 THEN System SHALL 支持退让策略、最小工作量限制或后续扩展为自适应间隔
3. WHEN 调度器执行一次 tick THEN System SHALL 记录 tick 次数、空转次数、命中任务数、执行耗时和异常数

### 需求 7：主线程压力和后台任务性能必须可量化

**用户故事：** 作为性能治理负责人，我希望不用猜，就能知道主线程被什么压住了、后台任务有没有越跑越多。

#### 验收标准

1. WHEN Host 运行后台任务和请求处理 THEN System SHALL 记录任务排队时长、执行时长、成功率、失败率、取消数、超时数和缓存命中率
2. WHEN 需要评估主线程是否被阻塞 THEN System SHALL 提供事件循环延迟、请求耗时分布、任务单次最长耗时、同步扫描次数或代理指标
3. WHEN 需要比较优化前后效果 THEN System SHALL 能按接口、任务类型、执行位点输出可对比指标，而不是只看零散日志

### 需求 8：工作台和 WebSocket 广播链路禁止现算重任务

**用户故事：** 作为用户，我希望终端、工作台和侧边栏刷新互不拖累，而不是某条广播链路里顺手现算一个重任务，就把整个 Host 主线程一起卡住。

#### 验收标准

1. WHEN `workbench.refresh`、`sync_titles`、`terminal_manager_refresh`、`workspaceManagement` 等链路被触发 THEN System SHALL 优先读取缓存或最近结果，不得在 WebSocket 广播链路里直接现算重任务
2. WHEN 工作台需要刷新重数据 THEN System SHALL 通过统一后台任务调度刷新缓存，再由广播链路分发结果
3. WHEN 某条工作台链路已经声明为 `helper_process` 或 `external_process` THEN System SHALL 确保真正的重活发生在对应执行位点，而不是只打标签后仍在 Host 主线程做同步收尾

## 非功能需求

### 非功能需求 1：向后兼容

1. WHEN 旧调用方仍然调用现有 overview、search、workbench、provider capability 接口 THEN System SHALL 保持返回结构兼容
2. WHEN 后台刷新尚未完成 THEN System SHALL 返回最近可用结果或兜底结构，不得让旧前端直接拿到不可解析的空值

### 非功能需求 2：性能

1. WHEN 同一个工作区被连续触发刷新 THEN System SHALL 避免重复重扫描，减少 CPU、磁盘和 JSON 序列化浪费
2. WHEN 高成本发现任务执行 THEN System SHALL 尽量把重 I/O 和重 CPU 移出 Host 主线程

### 非功能需求 3：可维护性

1. WHEN 新增一个后台任务 THEN System SHALL 能明确回答它的任务键、执行位点、并发限制、缓存策略和指标名称
2. WHEN 删除或替换一个旧调度器 THEN System SHALL 不需要在多个模块里到处找私有 `timer/inflight` 状态
3. WHEN 一个任务被标成 `helper_process` 或 `external_process` THEN System SHALL 能明确指出真正的执行器在哪里，以及 Host 收尾阶段是否还存在同步大事务、同步文件读写或大对象组装

## 成功定义

- 收件箱、代码助手总览、工作台刷新、新建会话不再被实时 provider 扫描或实时模型探测卡住
- `discoverWorkspaceSessions`、provider capability refresh 进入统一的后台任务模型
- 巡检调度器和会话跟进调度器的空转行为有明确规则和指标，不再靠猜
- 性能排查时能直接回答三件事：任务跑在哪里、主线程受影响多大、优化前后有没有变好
