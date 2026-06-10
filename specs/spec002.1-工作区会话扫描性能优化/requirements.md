# 需求文档 - spec002.1 工作区会话扫描性能优化

状态：Draft

## 简介

这个 Spec 解决的是一个已经在线上出现的真实性能问题。

截至 **2026-06-10** 的排查结果，Host 端 CPU 高占用的主要热点不是 office/browser，也不是普通 workbench 列表渲染，而是工作区会话 discovery：

- `workspace.discovery`
- `workspace.discovery_scan`

继续深挖后，问题不是单点，而是几层坏味道叠在一起：

1. removed 的旧工作区还会被 discovery 触发
2. 同一个 transcript/jsonl 文件会被反复读取，只为了再次判断它还是不是这个工作区
3. 归属识别、归档判断、活动状态刷新被绑成一锅，每次都容易升级成重扫描
4. 不同 provider 的存储形态差异很大，但当前策略还不够分层
5. 观测里虽然已经能看到 `scannedFiles / parsedFiles / bytesRead`，但还没有落成长期可比较的数据

一句人话：
当前系统已经有会话绑定、会话索引、状态快照，但还缺“来源指纹缓存”和“扫描门禁”。所以它总在重复做已经做过的脏活。

## 术语表

- **Workspace Discovery（工作区会话发现）**：从某个工作区关联的 provider 来源里找出可用会话，并更新 Host 侧索引。
- **Session Source（会话来源）**：某条会话在 provider 侧的原始承载物，例如 `jsonl` 文件、SQLite 行、server session、index entry。
- **Source Fingerprint（来源指纹）**：用于判断来源是否变化的轻量特征，通常包括路径、mtime、size、可选 inode/dev、结构化版本号等。
- **Source Index（来源索引）**：Host 自己维护的“来源 -> 会话归属/摘要/最近校验结果”缓存表。
- **Ownership Scan（归属扫描）**：确认某个来源到底属于哪个工作区、哪个会话的重一点的识别动作。
- **Archive Sync（归档状态对齐）**：把 Host 里的 `isArchived` 尽量与 provider 的真实归档/删除状态对齐。
- **Structured Source（结构化来源）**：provider 暴露的 SQLite、server API、metadata index 这类不用全读 transcript 也能取到关键信息的来源。
- **Cold Workspace（冷工作区）**：当前不可见、最近未访问、也没有新脏标记的工作区。

## 范围说明

### In Scope

- `workspace.discovery` / `workspace.discovery_scan` 的入口门禁、状态模型和执行预算
- Host 侧来源索引的表结构、仓储和复用策略
- 轻量枚举 + 增量重验 + 冲突重扫的 discovery 新流程
- Codex / OpenCode / Claude Code / Gemini / Kimi 等 provider 的分层扫描策略
- workbench 触发 discovery 的优先级策略
- providerDiagnostics 的持久化、验收指标和修复工具

### Out of Scope

- 会话消息正文读取和实时消息推送协议重写
- 前端页面重构
- 改造 provider 官方存储格式
- 把所有历史性能问题都塞进这一个 Spec 里
- 引入分布式任务系统

## 需求

### 需求 1：removed 工作区不能再参与正常 discovery

**用户故事：** 作为系统维护者，我希望已经 removed 的工作区不再继续参与工作区会话 discovery，这样 CPU 不会浪费在已经不存在的目标上。

#### 验收标准

1. WHEN `requestWorkspaceDiscovery()`、`discoverWorkspaceSessions()` 或 workbench 后台刷新收到一个 removed 工作区 THEN System SHALL 直接拒绝入队，并记录轻量原因。
2. WHEN 工作区列表只返回当前可见工作区 THEN System SHALL 只为这些工作区安排常规 discovery，不得顺带把 removed 工作区再扫一轮。
3. WHEN 历史 `session_bindings` 或其他脏引用仍指向 removed 工作区 THEN System SHALL 把它们留给显式修复任务处理，而不是在正常读链路里反复触发重扫描。

### 需求 2：同一个来源扫过一次后，未变化时必须直接复用

**用户故事：** 作为用户，我希望同一个 jsonl 或其他来源被扫过一次后，只要它没变，系统就直接复用结果，而不是每次再把内容重新读一遍。

#### 验收标准

1. WHEN discovery 进入文件型 provider THEN System SHALL 先做轻量枚举，优先拿到 `path + mtime + size + 可选 inode/dev` 这类来源指纹。
2. WHEN 来源索引命中且来源指纹未变化 THEN System SHALL 直接复用已知工作区归属、providerSessionId 和摘要信息，并跳过正文解析。
3. WHEN 来源指纹变化、路径变化、providerSessionId 冲突或工作区归属不一致 THEN System SHALL 只对冲突来源做重验，而不是拖着整个工作区全量重扫。
4. WHEN 某来源长时间未变但又没有结构化状态来源 THEN System SHALL 支持低频抽样重验，避免缓存永久失真。

### 需求 3：归属扫描、归档状态对齐、活动状态刷新必须拆开

**用户故事：** 作为排查性能问题的人，我希望知道系统这次到底是在做“归属扫描”、还是“归档对齐”、还是“活动状态刷新”，而不是所有事都混成一次大扫描。

#### 验收标准

1. WHEN workbench 只需要当前会话列表 THEN System SHALL 先返回已有索引结果，不得把全量归属扫描绑在读接口里现算。
2. WHEN 只需要刷新归档状态或最近活动状态 THEN System SHALL 走更轻的刷新通道，不得默认重跑 ownership scan。
3. WHEN discovery 完成 THEN System SHALL 分别记录归属扫描结果、归档对齐结果和活动状态刷新结果，便于独立观测。

### 需求 4：provider 必须按真实存储特点分层优化，不能一刀切 SQLite-first

**用户故事：** 作为实现者，我希望系统能按 provider 真实情况选择最快的可信来源，而不是强迫所有 provider 走同一条假统一路线。

#### 验收标准

1. WHEN provider 有结构化来源可直接提供工作区、归档或标题信息 THEN System SHALL 优先使用结构化来源，不必再全量解析 transcript。
2. WHEN provider 本质上还是文件驱动 THEN System SHALL 允许继续走 file-first，但必须接入来源索引和增量跳过逻辑。
3. WHEN provider 没有稳定的结构化归档来源 THEN System SHALL 明确降级策略，不得假装“每次重扫全文就是对齐”。
4. WHEN 新增 provider 接入 discovery THEN System SHALL 明确写出它的主来源、兜底来源和禁止事项。

### 需求 5：扫描必须有优先级、预算和冷却时间

**用户故事：** 作为用户，我希望系统优先照顾当前正在看的工作区，而不是把 CPU 平均浪费给一堆冷工作区。

#### 验收标准

1. WHEN workbench、会话页或订阅链路触发 discovery THEN System SHALL 优先刷新当前可见、最近访问或明确变脏的工作区。
2. WHEN 工作区属于冷工作区且没有新的脏标记 THEN System SHALL 降低其扫描频率，并允许继续使用最近结果。
3. WHEN 单轮 discovery 执行 THEN System SHALL 限制每轮可解析来源数量、单工作区预算和 provider 并发，防止一次刷新占满 CPU。
4. WHEN 工作区还在冷却期且没有新增脏标记 THEN System SHALL 直接命中最近结果，不得重复发起等价重活。

### 需求 6：watcher 和读接口必须遵守后台任务边界

**用户故事：** 作为后续接手的人，我希望工作区扫描链路遵守现有后台任务规则：读接口只读、watcher 只打脏、重活走 TaskManager。

#### 验收标准

1. WHEN 读接口返回工作区会话列表或 workbench 快照 THEN System SHALL 先读现有索引和缓存，不得在当前读方法里偷偷做重扫描。
2. WHEN watcher、文件事件或 provider 事件到来 THEN System SHALL 只打脏标记并安排后台刷新，不得直接在回调里做重解析。
3. WHEN 同一工作区同一类 discovery 任务已经在跑 THEN System SHALL 合并新的脏原因，不得继续创建并发重复任务。

### 需求 7：必须保留长期可比较的观测数据和修复入口

**用户故事：** 作为排查线上问题的人，我希望不仅能看到当前任务很慢，还能知道它到底扫了多少文件、跳过多少、解析多少、读取了多少字节，以及哪些工作区一直在反复触发。

#### 验收标准

1. WHEN discovery 完成 THEN System SHALL 持久化至少这些指标：`workspaceId`、provider、`scannedFiles`、`skippedByFingerprint`、`parsedFiles`、`bytesRead`、耗时、是否完整、触发源。
2. WHEN 来源索引失真、工作区恢复、provider 结构变化或缓存冲突 THEN System SHALL 提供显式重建/修复入口，而不是要求用户删库重来。
3. WHEN 线上再出现 CPU 异常 THEN System SHALL 能从持久化观测里快速看出是 removed 工作区回流、来源缓存失效、还是某个 provider 结构化来源退化。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 工作区会话来源未变化 THEN System SHALL 让 discovery 的 `parsedFiles` 接近 0，主要工作应退化为轻量枚举与缓存命中。
2. WHEN workbench 做常规后台刷新 THEN System SHALL 优先保证当前可见工作区的 discovery 在可接受时间内完成，冷工作区不得抢占主要 CPU。
3. WHEN removed 工作区存在于历史数据中 THEN System SHALL 让它们在正常 discovery 观测中降到 0 次或仅剩显式修复任务可见。

### 非功能需求 2：可靠性

1. WHEN Host 重启 THEN System SHALL 继续复用已持久化的来源索引和最近 discovery 结果，而不是回到“所有来源重新扫一遍”。
2. WHEN provider 的结构化来源暂时不可用 THEN System SHALL 有明确降级路径，并保留最近可用结果。

### 非功能需求 3：可维护性

1. WHEN 后续新增或修改 provider discovery THEN System SHALL 只在 provider 策略和来源索引契约上扩展，不要求复制一套新的散装缓存逻辑。
2. WHEN 代码审查 discovery 相关改动 THEN System SHALL 能按“入口门禁、来源指纹、归属缓存、状态刷新、观测持久化”这五个点做检查。

## 成功定义

- removed 工作区不再出现在常规 `workspace.discovery` 任务流里。
- 未变化来源的 discovery 主要靠指纹命中和缓存复用，正文解析次数明显下降。
- Codex / OpenCode 的归档状态优先从结构化来源对齐，不再默认靠全文扫描兜底。
- workbench 读取链路和 discovery 后台刷新边界清楚，读接口不再顺手拖起重活。
- 线上再出现 CPU 异常时，可以从持久化观测快速定位到具体工作区、provider 和来源类型。
