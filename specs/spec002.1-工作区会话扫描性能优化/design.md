# 设计文档 - spec002.1 工作区会话扫描性能优化

状态：Draft

## 1. 概述

### 1.1 目标

- 砍掉 removed 工作区和冷工作区带来的无意义 discovery 开销。
- 给工作区会话 discovery 增加真正可复用的来源索引，让“扫过一次的东西不用反复重扫”。
- 把归属扫描、归档状态对齐、活动状态刷新拆成三条不同轻重的链路。
- 按 provider 真实存储特点做分层优化，不搞假的大统一。
- 保持现有 API 和主流程兼容，不破坏用户已经在用的会话能力。

### 1.2 覆盖需求

- `requirements.md` 需求 1：removed 工作区不能再参与正常 discovery
- `requirements.md` 需求 2：同一个来源扫过一次后，未变化时必须直接复用
- `requirements.md` 需求 3：归属扫描、归档状态对齐、活动状态刷新必须拆开
- `requirements.md` 需求 4：provider 必须按真实存储特点分层优化，不能一刀切 SQLite-first
- `requirements.md` 需求 5：扫描必须有优先级、预算和冷却时间
- `requirements.md` 需求 6：watcher 和读接口必须遵守后台任务边界
- `requirements.md` 需求 7：必须保留长期可比较的观测数据和修复入口

### 1.3 技术约束

- 后台任务必须继续走现有 `TaskManager`，不能重新长私有 `inflight/timer/retry queue`。
- discovery 的重活必须继续留在 `helper_process` 或其他非主线程链路，不能再塞回 Host 主线程。
- Host 正式运行代码的 SQLite 访问必须继续使用 `better-sqlite3` 封装，不能引入 `node:sqlite`。
- 当前项目已经不止 Claude Code / Codex 两家 provider，所以 discovery 优化必须兼容现有 provider 注册表。
- 现有 `session_bindings`、`session_indices`、`session_status_snapshots` 已经在线上使用，新增优化不能破坏这些表的兼容语义。

### 1.4 现状诊断

当前系统并不是完全没有缓存，而是缓存只做到了一半。

已经有的东西：

- `session_bindings`：保存 `workspaceId / provider / providerSessionId / rawStoreRef`
- `session_indices`：保存标题、消息数、归档状态、最近消息时间等摘要
- `session_status_snapshots`：保存同步状态、游标、最近错误

缺的关键一层是：

- **来源级缓存**：同一个来源文件或结构化记录上次怎么识别出来的
- **来源指纹**：来源没变时能不能跳过正文解析
- **来源冲突处理**：什么时候只重验冲突来源，而不是全量重扫
- **任务门禁**：哪些工作区根本不该进 discovery

一句人话：
现在系统会记住“这条会话已经存在”，却不太会记住“我是怎么识别出它来的”。所以每次都容易重新再证明一遍。

## 2. 核心判断

### 2.1 值得做的事

#### 2.1.1 先加 removed 工作区硬门禁

这是第一优先级，因为它最便宜，也最直接。

如果一个工作区已经 `removed_at IS NOT NULL`，正常读链路和常规后台刷新就不该再扫它。
这件事不需要先等来源索引建好，应该单独先拦。

#### 2.1.2 新增 Host 侧来源索引

这是核心改动。

目标不是保存原始正文，而是保存这类信息：

- 这个来源上次属于哪个工作区
- 它对应哪个 providerSessionId
- 上次识别时的摘要是什么
- 上次识别用的指纹是什么
- 什么时候需要重新验证

只要这层在，文件型 provider 才能真正做到“未变化直接跳过解析”。

#### 2.1.3 把三类刷新拆开

当前 discovery 最浪费 CPU 的原因之一，就是不同重量级的事混着跑：

1. 归属扫描：最重
2. 归档状态对齐：中等或偏轻，取决于 provider
3. 活动状态刷新：通常更轻

拆开以后：

- workbench 常规读链路优先用已有索引
- ownership scan 低频跑
- archive/activity 走更轻通道

### 2.2 不值得做的事

#### 2.2.1 不做“全部 provider 统一 SQLite-first”

这是坏主意。

原因很简单：

- OpenCode 适合 server/sqlite-first
- Codex 适合 `app-server/thread metadata + sqlite/index + transcript fallback`
- Claude Code 现在本质还是 file-first
- Gemini / Kimi 也不是纯 SQLite provider

硬做统一只会把每家 provider 的真实特点抹掉，最后得到一套又慢又脆的假抽象。

#### 2.2.2 不做“把 transcript 全量复制进 Host DB”

这同样是坏主意。

它会带来更重的落盘、更高的一致性成本和更多迁移风险，而且根本不是这次性能问题的关键。

这次只需要让 **来源识别和摘要复用** 变聪明，不需要再造第二份原始消息仓库。

## 3. 架构

### 3.1 目标结构

优化后的 discovery 结构分成七块：

1. `workspace discovery gate`：先判断这个工作区有没有资格参与 discovery
2. `workspace discovery state`：记录当前工作区 discovery 的脏标记、冷却、最近结果
3. `source enumerator`：provider 侧只做轻量来源枚举
4. `source index repo`：Host 侧持久化来源指纹、归属和最近识别摘要
5. `ownership resolver`：只在来源变化或冲突时做重一点的归属识别
6. `archive/activity refresh`：走更轻的 provider 特定刷新逻辑
7. `diagnostics repo`：持久化每轮 discovery 的关键观测数据

### 3.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `SessionHistoryService` | discovery 入口、任务门禁、状态编排 | `workspaceId`、`userId`、触发源 | 后台任务、最近结果 |
| `WorkspaceRepository` | 判断工作区是否还活着 | `workspaceId` | `removedAt`、路径、归属 |
| `ProviderDiscoveryRuntime` | 在 helper 中调用 provider 扫描 | `workspacePath`、enabled providers、known summaries | provider discovery result |
| `SessionSourceIndexRepository` | 保存来源指纹、归属、摘要、验证时间 | 来源键、指纹、会话信息 | 缓存记录 |
| `SessionDiscoveryDiagnosticsRepository` | 持久化观测指标 | 每轮 discovery 的 providerDiagnostics | 诊断记录 |
| `Provider Source Adapter` | provider 分层枚举和轻量状态读取 | workspacePath、known sessions、source cache | session summaries / archive states |
| `WorkbenchService` | 只调纯读和显式后台刷新，不再混写 | 当前用户工作区列表 | snapshot + 异步刷新请求 |

### 3.3 关键流程

#### 3.3.1 正常 workbench 刷新流程

1. workbench 读取当前可见工作区列表。
2. 先返回已有 `session_indices` 和状态快照。
3. 对当前可见且需要刷新的工作区，调用显式 `requestWorkspaceDiscovery()`。
4. `SessionHistoryService` 先做工作区门禁：
   - removed 直接跳过
   - 冷却中且无新脏标记直接命中最近结果
   - 只有 stale/runnable 才真正 enqueue
5. 后台任务完成后再更新索引和广播。

#### 3.3.2 增量 discovery 流程

1. helper 收到 `workspace.discovery_scan`。
2. provider 先做轻量来源枚举，不先急着读正文。
3. 每个来源先算 `sourceKey + fingerprint`。
4. 命中 `SessionSourceIndexRepository` 且指纹未变化：
   - 直接复用 `workspaceId / providerSessionId / rawStoreRef / title / lastMessageAt / isArchived?`
   - 标记为 `skippedByFingerprint`
5. 只有下面几类来源进入重验：
   - 新来源
   - 指纹变化
   - 归属冲突
   - provider 结构化元数据与缓存不一致
   - 抽样复验命中
6. 重验后更新：
   - `session_bindings`
   - `session_indices`
   - `session_status_snapshots`
   - `session_source_index`
7. 最后把本轮 diagnostics 落盘。

#### 3.3.3 归档状态对齐流程

1. ownership scan 完成后，不默认全文重扫归档。
2. provider 按自己的轻量来源刷新归档：
   - Codex：`thread metadata/app-server -> sqlite/index -> transcript fallback`
   - OpenCode：`server -> sqlite`
   - Claude Code：文件存在性 + Host 自己的操作记录，必要时低频重验
   - Gemini / Kimi：按本地结构化记录或文件元数据做轻量对齐
3. 只更新 `session_indices.is_archived` 和必要快照，不回退成全量归属扫描。

#### 3.3.4 冲突与修复流程

1. 如果某来源命中了缓存，但新元数据表明它属于另一个工作区，标记为冲突。
2. 冲突来源进入重验，不拖全工作区陪跑。
3. 如果冲突无法自动消解，记录 diagnostics 并进入显式 repair 队列。
4. repair 完成前，正常读链路继续使用最近一致结果。

## 4. 组件和接口

### 4.1 核心组件

覆盖需求：1、2、3、4、5、6、7

- `SessionSourceIndexRepository`：来源级缓存入口
- `SessionDiscoveryDiagnosticsRepository`：长期观测入口
- `WorkspaceDiscoveryStateStore`：工作区级 discovery 状态模型
- `ProviderSourceStrategy`：provider 分层扫描策略接口
- `ArchiveStateResolver`：归档状态轻量对齐接口

### 4.2 数据结构

覆盖需求：2、3、4、5、7

#### 4.2.1 `session_source_index`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `source_key` | string | 是 | 来源稳定键 | 全局唯一 |
| `provider` | string | 是 | provider 标识 | 已注册 provider |
| `source_kind` | string | 是 | `jsonl/sqlite_row/server_session/index_entry` | 固定枚举 |
| `workspace_id` | string | 否 | 上次确认的工作区归属 | 可空，冲突时可暂空 |
| `provider_session_id` | string | 否 | 上次确认的 provider session | 可空 |
| `raw_store_ref` | string | 否 | 原始来源定位信息 | 可空 |
| `workspace_path` | string | 否 | 上次确认的工作区路径 | 可空 |
| `fingerprint_mtime_ms` | number | 否 | 文件 mtime 或等价时间 | 可空 |
| `fingerprint_size_bytes` | number | 否 | 文件大小或等价体量 | 可空 |
| `fingerprint_inode` | string | 否 | 可选 inode/dev 组合 | 跨平台可空 |
| `fingerprint_version` | string | 否 | 结构化来源版本戳 | 可空 |
| `title` | string | 否 | 最近摘要标题 | 可空 |
| `message_count` | number | 否 | 最近消息数 | 非负整数 |
| `last_message_at` | string | 否 | 最近消息时间 | ISO8601 |
| `is_archived_hint` | number | 否 | 最近归档提示 | `0/1/null` |
| `last_parsed_at` | string | 否 | 最近做重验时间 | ISO8601 |
| `last_verified_at` | string | 否 | 最近轻量校验时间 | ISO8601 |
| `sample_due_at` | string | 否 | 下次抽样重验时间 | ISO8601 |
| `deleted_at` | string | 否 | 来源确认消失时间 | ISO8601 |
| `created_at` | string | 是 | 创建时间 | ISO8601 |
| `updated_at` | string | 是 | 更新时间 | ISO8601 |

说明：

- 这张表不保存原始正文。
- 它只回答“这个来源上次是谁、有没有变、需不需要重验”。

#### 4.2.2 `session_discovery_diagnostics`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 诊断记录 ID | 全局唯一 |
| `workspace_id` | string | 是 | 目标工作区 | 必须存在 |
| `trigger_source` | string | 是 | 触发源 | 例如 `session_history.request_workspace_discovery` |
| `provider` | string | 是 | provider 标识 | 已注册 provider |
| `is_complete` | number | 是 | 本轮 discovery 是否完整 | `0/1` |
| `status` | string | 是 | provider 诊断状态 | `ok/partial/error/skipped` |
| `duration_ms` | number | 是 | provider 处理耗时 | 非负整数 |
| `session_count` | number | 是 | 本轮返回会话数 | 非负整数 |
| `scanned_files` | number | 是 | 轻量枚举来源数 | 非负整数 |
| `skipped_by_fingerprint` | number | 是 | 指纹命中后跳过解析数 | 非负整数 |
| `parsed_files` | number | 是 | 真的去读正文/重验的来源数 | 非负整数 |
| `bytes_read` | number | 是 | 本轮正文读取字节数 | 非负整数 |
| `created_at` | string | 是 | 记录时间 | ISO8601 |

#### 4.2.3 `WorkspaceDiscoveryState`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `workspaceId` | string | 是 | 工作区 ID | 内存态或持久态键 |
| `status` | enum | 是 | `fresh/stale/running/cooldown/failed` | 固定枚举 |
| `dirtyReasons` | string[] | 是 | 当前脏原因 | 可空数组 |
| `lastRequestedAt` | number | 否 | 最近请求时间 | epoch ms |
| `lastStartedAt` | number | 否 | 最近开始时间 | epoch ms |
| `lastCompletedAt` | number | 否 | 最近完成时间 | epoch ms |
| `lastFailedAt` | number | 否 | 最近失败时间 | epoch ms |
| `nextAllowedAt` | number | 否 | 冷却截止时间 | epoch ms |
| `runningTaskId` | string | 否 | 当前任务 ID | 可空 |
| `lastVisibleAt` | number | 否 | 最近被用户看到的时间 | epoch ms |

### 4.3 Provider 策略矩阵

覆盖需求：4

| Provider | 归属主来源 | 归属兜底 | 归档主来源 | 明确不做 |
| --- | --- | --- | --- | --- |
| Codex | `thread metadata / app-server / session_index.jsonl / state_*.sqlite` | transcript 头尾读取或必要全文解析 | `app-server -> sqlite/index -> 文件存在性` | 不再把全文 transcript 扫描当常规归档刷新 |
| OpenCode | `server / sqlite` | 必要时只读 fallback | `server -> sqlite` | 不做 transcript-first 假统一 |
| Claude Code | transcript 文件 + 来源索引 | 低频重验 | 文件存在性 + Host 归档操作记录 | 不伪装成 sqlite-first |
| Gemini | CLI list + 本地 chats 文件索引 | 文件解析兜底 | 本地结构化记录或文件元数据 | 不强行要求 SQLite |
| Kimi | `kimi.json`、上下文文件和来源索引 | 文件解析兜底 | 本地配置/文件状态 | 不强行要求 SQLite |

### 4.4 接口契约

覆盖需求：1、2、3、5、6、7

#### 4.4.1 `requestWorkspaceDiscovery()`

- 类型：Function / Background task entry
- 输入：`workspaceId`、`userId`、`force?`、`refreshStateMode?`、`reason?`
- 输出：无直接结果，负责显式调度
- 校验：
  - 工作区必须存在且未 removed
  - 冷却期内若无新脏标记则直接返回
- 错误：
  - `WORKSPACE_REMOVED`
  - `WORKSPACE_NOT_FOUND`

#### 4.4.2 `discoverWorkspaceSessions()`

- 类型：Function / Cached read + optional task result
- 输入：`workspaceId`、`userId`、`maxAgeMs?`、`force?`
- 输出：最近 `SessionListItem[]`
- 校验：
  - 先读现有索引
  - 只有 stale/runnable 才等待后台任务结果
- 错误：
  - `WORKSPACE_REMOVED`
  - `DISCOVERY_FAILED`

#### 4.4.3 `ProviderSourceStrategy.enumerateSources()`

- 类型：TypeScript Interface
- 输入：`workspacePath`、`knownSessions`、`sourceCache`
- 输出：轻量来源列表（只含指纹和必要元数据）
- 校验：
  - 不返回正文
  - 尽量带上 `source_key` 和结构化元数据
- 错误：
  - `PROVIDER_SOURCE_UNAVAILABLE`
  - `PROVIDER_SOURCE_INVALID`

#### 4.4.4 `ProviderSourceStrategy.resolveChangedSources()`

- 类型：TypeScript Interface
- 输入：变更来源列表、workspacePath
- 输出：真正需要 upsert 的 session summaries
- 校验：
  - 只处理变更/冲突来源
  - 允许按 provider 分批
- 错误：
  - `PROVIDER_PARSE_FAILED`

#### 4.4.5 `ArchiveStateResolver.refreshArchiveHints()`

- 类型：TypeScript Interface
- 输入：workspacePath、existing sessions、provider source info
- 输出：`providerSessionId -> isArchived` 的轻量映射
- 校验：
  - 不得默认升级成全文归属扫描
- 错误：
  - `ARCHIVE_SOURCE_UNAVAILABLE`

## 5. 数据与状态模型

### 5.1 数据关系

- `session_bindings`、`session_indices`、`session_status_snapshots` 继续作为用户可见会话的主数据。
- `session_source_index` 是它们前面的一层来源缓存，不直接对用户展示。
- `session_discovery_diagnostics` 只做观测，不参与主流程判断。
- 同一个来源默认只属于一个工作区和一个 provider 会话；如果发生冲突，先进入冲突修复流程，而不是直接覆盖。

### 5.2 状态流转

#### 5.2.1 工作区 discovery 状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `fresh` | 最近结果可直接用 | 刚完成且无新脏标记 | 有新脏原因进入 `stale` |
| `stale` | 需要刷新，但还没开跑 | watcher / workbench / 显式刷新打脏 | 入队后进入 `running` |
| `running` | 任务正在执行 | `workspace.discovery` 已启动 | 成功进 `cooldown`，失败进 `failed` |
| `cooldown` | 刚跑完，短时间不重复重跑 | 成功完成后设置冷却 | 冷却结束回 `fresh`；收到新脏标记回 `stale` |
| `failed` | 最近一次刷新失败 | provider 枚举或解析失败 | 新的显式触发回 `stale` |

#### 5.2.2 来源缓存状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `cached` | 来源有可用缓存 | 首次重验完成 | 指纹变化或冲突 |
| `dirty` | 来源指纹变化，需要重验 | mtime/size/version 变化 | 重验成功回 `cached` |
| `conflicted` | 归属冲突，需要修复 | 新元数据和旧归属冲突 | 修复后回 `cached` |
| `deleted` | 来源确认消失 | 枚举时连续缺失或结构化源确认删除 | repair/恢复后可回 `cached` |

## 6. 错误处理

### 6.1 错误类型

- 工作区门禁错误：removed、缺失、无权限
- 来源枚举错误：provider 目录/DB/server 不可用
- 来源重验错误：正文解析失败、结构化记录缺字段
- 归档对齐错误：结构化来源暂时不可用
- 缓存冲突错误：同一来源命中多个工作区或多个 providerSessionId

### 6.2 处理策略

1. **removed 工作区**：直接拒绝常规 discovery，记一条轻量原因，不再继续扫描。
2. **结构化来源暂时失败**：允许降级到最近可用结果；必要时走 provider 兜底来源，但不能无上限升级成全量重扫。
3. **来源冲突**：只标记冲突来源，进入 repair，不拖全工作区重扫。
4. **来源索引损坏**：支持显式 rebuild；在 rebuild 前继续使用现有 `session_bindings/session_indices` 兜底。
5. **diagnostics 落盘失败**：不影响主流程结果，但要留日志。

## 7. 正确性属性

### 7.1 属性 1：removed 工作区零常规扫描

*对于任何* `removed_at IS NOT NULL` 的工作区，系统都应该满足：常规 `requestWorkspaceDiscovery()` 和 workbench 自动刷新不会再为它创建新的 discovery 任务。

**验证需求：** `requirements.md` 需求 1

### 7.2 属性 2：未变化来源不重复解析正文

*对于任何* 指纹未变化且缓存有效的来源，系统都应该满足：本轮 discovery 复用来源索引结果，而不是再次解析正文。

**验证需求：** `requirements.md` 需求 2

### 7.3 属性 3：重活只在需要时发生

*对于任何* 只要求刷新归档或活动状态的场景，系统都应该满足：不会默认升级成全量 ownership scan。

**验证需求：** `requirements.md` 需求 3、需求 5

## 8. 测试策略

### 8.1 单元测试

- 工作区门禁与冷却逻辑
- 来源指纹命中、失效、冲突判断
- provider 策略矩阵中的优先级选择
- 归档状态轻量对齐逻辑

### 8.2 集成测试

- `requestWorkspaceDiscovery()` 对 removed 工作区的拒绝路径
- Codex / OpenCode / Claude Code 的来源缓存命中路径
- 变更来源只重验局部，不拖全量
- workbench 读链路与后台刷新分离

### 8.3 性能验证

- 未变化来源场景下，`parsedFiles` 明显下降
- removed 工作区不再出现在常规 discovery diagnostics
- 冷工作区在相同观察窗口内的扫描次数下降

### 8.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §3.3.1、§6.2、§7.1 | 集成测试 + runtime diagnostics |
| `requirements.md` 需求 2 | `design.md` §3.3.2、§4.2.1、§7.2 | provider fixture 集成测试 |
| `requirements.md` 需求 3 | `design.md` §3.3.3、§5.2、§7.3 | 集成测试 + 人工回放 |
| `requirements.md` 需求 4 | `design.md` §4.3 | provider 契约测试 |
| `requirements.md` 需求 5 | `design.md` §3.3.1、§5.2 | 状态机测试 + 性能验证 |
| `requirements.md` 需求 6 | `design.md` §3.1、§4.4 | 代码走查 + 集成测试 |
| `requirements.md` 需求 7 | `design.md` §4.2.2、§6.2 | diagnostics 持久化测试 |

## 9. 风险与待确认项

### 9.1 风险

- 文件来源的 inode/dev 在不同平台上不一定稳定，不能把它当唯一指纹。
- provider 私有 SQLite 或 index 格式可能继续变化，需要留降级路径。
- 冷却时间如果配太激进，可能让极少数刚恢复的工作区结果变旧。
- repair 流程如果设计太弱，来源冲突可能长期积压。

### 9.2 待确认项

- `session_source_index` 是否需要额外保存来源头尾摘要，还是现阶段只存轻量摘要即可。
- `session_discovery_diagnostics` 保留周期和清理策略要不要单独出配置。
- Claude Code 后续如果官方暴露结构化会话索引，是否要把 archive sync 策略再升级一档。
