# 设计文档 - spec002.1.1 会话订阅增量解析与主线程隔离

状态：IN_REVIEW

## 1. 概述

### 1.1 目标

- 把 Codex 文件型会话订阅中的重 I/O、JSONL 解析和消息归一化移出 Host 主线程。
- 正常追加时只读新增字节和受控尾部窗口，消除每次变更从头解析整份 JSONL 的成本。
- 让同一来源的多 WebSocket 订阅共享 watcher、刷新状态和 helper 结果。
- 保持现有 session.backfill、session.delta、session.history_older 和运行时直推的用户可见语义。
- 让工作台广播只响应会话摘要变化，不再响应每一段正文变化。
- 让长会话客户端只保留可视区附近的 DOM，并稳定旧消息的 actionState 引用。

### 1.2 覆盖需求

- requirements.md 需求 1：重读取和解析离开 Host 主线程。
- requirements.md 需求 2：按追加字节和尾部窗口读取。
- requirements.md 需求 3：来源级共享订阅与 watcher 生命周期。
- requirements.md 需求 4：watcher 优先、低频兜底和运行时直推兼容。
- requirements.md 需求 5：工作台摘要签名门禁。
- requirements.md 需求 6：重连、回收和异常文件恢复。
- requirements.md 需求 7：任务、收尾和广播分阶段观测。
- requirements.md 需求 0：客户端动态高度虚拟列表和 actionState 引用复用。

### 1.3 技术约束

- Host 仍是单 Node.js 主进程。host_background 不是独立线程，不能放同步文件读取或大 JSON 解析。
- 所有跨 WebSocket、watcher 和重连入口复用的重任务必须走现有 TaskManager。
- helper_process 必须实际通过现有 task helper pool 执行，不能只标记 executionLane 后仍在 Host 的 run 方法里读文件。
- watcher 只能监听当前 rawStoreRef，回调只打脏标记和安排刷新。
- helper 必须可懒启动、可取消、可空闲回收。不能为了保存 parser cache 新建永久守护进程。
- 原生运行时事件优先级不变；文件 reader 不能制造第二套运行时真相。
- 不新增 node:sqlite，且不把原始 transcript 全文落到 Host 数据库。

### 1.4 当前问题

当前 Host 的会话订阅会按固定间隔调用历史读取。对于 Codex，来源文件 mtime 或 size 变化后，适配器会同步读取完整 JSONL、切分全部行、解析记录、构造完整消息集合，最后才根据 cursor 取出一页。

这有三个直接问题：

1. 文件越大，单次订阅读取越慢，且同步读取和 JS 解析都占用 Host 事件循环。
2. 多个订阅者可能对同一个来源做等价读取。
3. 一条正文 delta 还会触发工作台快照广播，扩大不相关区域的成本。

## 2. 核心判断

### 2.1 值得做的事

#### 2.1.1 把读取和解析下沉到现有 helper_process

这一步能立即把同步文件读取和大对象构造从 Host 事件循环移开。Host 仍然保留鉴权、订阅关系、结果校验和小 delta 推送，但不再直接碰 JSONL 正文。

#### 2.1.2 用字节偏移做普通追加路径

Codex JSONL 正常情况下是追加写入。只要文件身份一致且 size 增长，就从上次确认的 offset 往后读。尾部窗口负责处理最近消息的补全，不能为了这个少数情况退回全文件解析。

#### 2.1.3 把 watcher 和轮询变成触发信号

watcher 负责说“可能变了”，不是负责解析。低频 stat 校验只用于补 watcher 漏事件。两者都只会驱动同一个来源键的 TaskManager 任务。

#### 2.1.4 只在摘要变更时刷新工作台

会话正文、工具输出和思考文本的变化通常不影响侧边栏摘要。当前会话订阅者需要 delta；工作台其他区域不需要每次陪跑。

### 2.2 不做的事

#### 2.2.1 不把完整历史搬进 IPC

helper 返回整份历史，会把 I/O 问题改成 IPC 和 Host 反序列化问题。这没有任何意义。

#### 2.2.2 不新建一套私有订阅任务系统

来源协调器可以保存订阅者和 watcher 句柄，但不拥有重任务队列、私有重试或私有 inflight。真正读取必须由 TaskManager 的 session.history_delta_read 统一去重和观测。

#### 2.2.3 不让文件扫描替代原生运行时

对由 CodingNS 启动的运行中会话，原生 RuntimeEvent 继续优先。文件尾读只做历史权威确认和外部会话变化补偿。

## 3. 架构

### 3.1 目标结构

数据流按下面顺序执行：

1. WebSocket 订阅建立时，Host 先重放当前来源缓存或走已有受限历史回填。
2. Host 为来源键登记订阅者，并只为该 rawStoreRef 挂一份文件 watcher。
3. watcher 事件或低频来源版本校验把来源标为 dirty。
4. Host 通过 TaskManager 入队 session.history_delta_read，key 为来源键。
5. task helper 读取新增字节、重放尾部窗口、归一化受影响消息，返回小型结果。
6. Host 校验结果、更新来源缓存和已投递签名，向相关会话订阅者发送现有 session.delta 或 session.backfill。
7. Host 计算会话摘要签名；只有签名变化时才安排一次工作台快照广播。

### 3.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| SessionHistoryService | 保持既有 API；管理来源订阅协调、重放和 Host 侧轻量合并 | sessionId、订阅者、helper 结果 | 历史 envelope、来源状态 |
| SessionHistorySourceCoordinator | 仅维护来源键到订阅者、watcher、dirty 标记和 one-shot 调度状态 | 来源键、rawStoreRef | 单次刷新请求或释放动作 |
| TaskManager | 对同一来源的重读取去重、取消、超时和指标管理 | session.history_delta_read + 来源键 | TaskHandle |
| Task helper process | 执行 Codex JSONL 尾读、解析和消息归一化 | providerSessionId、rawStoreRef、来源检查点 | 增量结果 |
| Codex 增量 reader | 持有 helper 内存中的 parser checkpoint 和尾部窗口 | 文件版本、byteOffset | append delta、tail reconcile 或 reset |
| WebSocket Server | 发送已兼容的 session envelope；仅在摘要变化时请求 workbench 广播 | delta、摘要变化标记 | WebSocket payload |
| WorkbenchWsHub | 读取已有工作台快照并发送，不在广播路径里读取 provider 文件 | 用户 ID、已准备快照 | workbench snapshot |
| MessageTimeline | 只挂载可视区附近的消息行，并复用未变化旧消息的 actionState | timeline items、滚动容器 | 动态高度虚拟行或兼容完整列表 |

### 3.3 来源键与所有权

来源键必须代表真实底层资源，而不是某个浏览器连接。

第一阶段建议由以下信息生成：

| 字段 | 作用 |
| --- | --- |
| provider | 固定为 codex |
| providerSessionId | 区分原生 thread |
| rawStoreRef | 指向实际 JSONL 文件 |
| targetHostId | 防止多 Host 场景跨机器错误复用 |

同一来源键在 Host 中只有一份协调状态。协调状态不是第二套后台任务系统，它只保存：

- 当前订阅者回调集合。
- 当前文件 watcher 及释放函数。
- 是否 dirty。
- 一次性 quiet window 定时器。
- 最近来源版本、最近可重放结果和正在使用的 TaskHandle 引用。

读取、重试、超时、去重、队列状态和执行指标全部由 TaskManager 管理。

### 3.4 新任务与 helper 协议

新增稳定任务类型：session.history_delta_read。

| 项目 | 约定 |
| --- | --- |
| executionLane | helper_process |
| task key | sourceKey |
| helper handler | session.history_delta_read |
| timeout | 第一版使用 15 到 30 秒的明确常量；长会话重同步必须有独立阶段指标 |
| 并发 | 同来源始终为 1；全局并发以保守值启动并由观测调整 |
| 重试 | 第一版不自动重试。文件异常先返回恢复模式，下一次脏事件或显式重订阅再触发 |
| 取消 | 最后订阅者关闭时取消尚未开始或仍可中止的读取 |

helper 输入：

| 字段 | 说明 |
| --- | --- |
| sourceKey | 任务去重与 helper checkpoint 键 |
| rootDir | 关联工作区路径；只用于现有 TaskHelperPool 的 helper 分区，不替代 rawStoreRef |
| providerConfig | 当前 Host 已解析的 Codex 路径与 home 配置；helper 只能依赖显式输入构造解析上下文 |
| providerSessionId | Codex 原生会话 ID |
| rawStoreRef | JSONL 实际路径 |
| requestedCursor | 当前 Host 已确认 cursor |
| expectedVersion | Host 最近来源版本，可空 |
| readMode | initial_tail、dirty_refresh 或 fallback_check |
| tailWindowPolicy | 尾部窗口字节数和最近消息数量上限 |

helper 输出：

| 字段 | 说明 |
| --- | --- |
| mode | initial_tail、append_delta、tail_reconcile、reset_required 或 unchanged |
| sourceVersion | 文件身份、mtime、size 和可选 dev/inode |
| cursor | 已确认的最新 cursor |
| messages | 本次新增或发生签名变化的消息 |
| replayMessages | 仅在初始或恢复时发送的受限快照 |
| checkpoint | 下次可继续的 byteOffset、partialLine 和尾部窗口摘要 |
| diagnostics | bytesRead、recordsParsed、tailWindowBytes、阶段耗时 |

### 3.5 Codex 增量 reader

#### 3.5.1 初始读取

新来源或 helper 没有可用 checkpoint 时，不直接全量读取。

1. 先使用现有尾部历史读取能力获得首屏所需的受限消息。
2. 建立来源版本和 checkpoint。
3. 返回 initial_tail 与可重放消息。
4. 客户端仍可通过已有 history_older 分页请求更早内容。

只有用户明确请求更早历史、文件发生不可判定重置，或当前 source contract 不能恢复时，才允许走既有分页或重同步路径。

#### 3.5.2 正常追加

文件身份不变且 size 大于 checkpoint.byteOffset 时：

1. helper 以异步文件 API 读取 byteOffset 到当前 size 的字节。
2. 将上次 partialLine 与新字节拼接，只解析完整 JSONL 行。
3. 用 Codex 既有归一化逻辑处理新增记录。
4. 对尾部窗口进行有限重放，找出旧消息中真正发生签名变化的部分。
5. 将新增和变化消息按稳定 messageId 返回，并推进 checkpoint。

读取和解析都发生在 helper，不允许 Host 再调用 readFileSync 或重新构造整份历史数组。

#### 3.5.3 尾部可变窗口

Codex 的工具输入、工具结果和部分事件可能需要关联最近记录，简单“只解析新行”会漏掉最近消息的完整状态。

因此 checkpoint 必须保存有限的尾部原始记录范围或可重放偏移。每次 append delta 额外重放该窗口，并通过消息签名筛掉不变内容。

窗口必须是受控的：

- 按字节数和消息数双重上限限制。
- 正常追加不允许窗口逐次扩大成全文件。
- 窗口不足以可靠恢复时，返回 reset_required，而不是猜。

#### 3.5.4 重置和回退

下列任一条件成立时返回 reset_required：

- 文件 size 缩小。
- dev/inode 或等价文件身份变化。
- 读取起点不再有效。
- 记录损坏使尾部上下文不能可信重建。
- checkpoint 与 Host cursor 明显矛盾。

Host 收到 reset_required 后：

1. 保留当前已展示消息和最近可用状态。
2. 通过 helper 的受限 initial_tail 或既有历史分页重新建立可信 cursor。
3. 依靠现有稳定 messageId 和 delivered signature 去重。
4. 无法可信恢复时发送结构化同步错误，不伪造运行状态。

#### 3.5.5 增量索引而不是“只少读文件”

首次建立 checkpoint 时允许为当前文件建立完整消息索引；之后的正常追加不能再复制整份 `entries` 或重新扫描整份消息数组。

Codex reader 在 checkpoint 中同时保存以下可变索引：

- dedupe key 到消息下标的映射，用于尾部记录合并。
- tool call ID 到工具名称、输入和消息下标的映射，用于工具结果补全。
- 已归一化消息数组和原始 entry 数组，追加时只替换变化下标并追加新下标。

追加路径只重放固定尾部窗口和新增记录。解析器直接复用上述索引，返回变化消息 ID 和变化下标；Host/helper 不为了一次 delta 重新 `filter`、`map` 或 `JSON.stringify` 整个历史。只有文件截断、身份变化、checkpoint 不可信或尾部上下文超过上限时，才退回受控重建。

### 3.6 watcher、quiet window 和低频兜底

#### 3.6.1 watcher

只 watch 当前来源文件，不递归 watch Codex home 或工作区目录。

watcher 收到事件后只做三件事：

1. 标记 sourceKey 为 dirty。
2. 记录轻量事件原因和时间。
3. 启动或重置该来源唯一的一次性 quiet window。

quiet window 到期后，协调器通过 TaskManager 请求 dirty_refresh。它不直接读取文件。

#### 3.6.2 quiet window

第一版使用命名常量，并在实现前通过基线回放确认默认值。初始建议为 150 到 250ms，用于合并连续 JSONL 写入。

这不是永久轮询器，也不是私有重试队列：

- 每个来源最多一个 one-shot timer。
- timer 只安排 TaskManager 任务。
- 最后订阅者离开时立即清理。
- 触发和合并次数进入观测。

#### 3.6.3 低频兜底

watcher 不是可靠数据库，可能漏报、合并或在文件替换时表现不一致。

当来源有订阅者时，协调器保留一个低频、可配置的来源版本校验。第一版使用 15 秒间隔；校验只调用异步 metadata `stat`，不读取正文、不解析 JSONL，也不在 Host 主线程使用同步文件 API：

- 未变化：返回 unchanged，不读正文。
- 变化：标记 dirty 并复用 session.history_delta_read。
- watcher 可用时，兜底不是主要更新手段。

该定时器和异步检查状态同样随最后订阅者离开而释放；检查发现变化后仍只标记 dirty，再由 TaskManager 入队 helper 读取。

### 3.7 运行时事件与文件补偿的优先级

运行中会话的真相顺序：

1. Codex 原生 RuntimeEvent。
2. 运行时结束、重连或外部启动会话的历史补偿。
3. 文件 watcher 驱动的 JSONL 增量读取。

当 ActiveRunRegistry 表明当前 CodingNS 已持有运行时句柄时，文件 delta 只用于补偿或校验，不能重复覆盖权威 runtime message。现有 delivered signature、消息 ID 和运行时 overlay 合并规则继续生效。

### 3.8 工作台摘要签名门禁

Host 在向会话订阅者发送 session.delta 前后，计算轻量摘要签名。

当前 `SessionHistoryEnvelope` 没有额外携带完整会话摘要，因此 WebSocket 层使用最近一条用户或助手文本消息的稳定 ID、时间、角色和 kind 作为正文无关的廉价代理；标题改名由既有 `sessionTitleChanged` observer 单独触发，运行状态和错误由专门 envelope 触发。后续若 envelope 增加显式摘要字段，应优先把显式字段加入签名，而不是把正文重新纳入比较。

摘要至少包含：

| 字段 | 为什么影响工作台 |
| --- | --- |
| title | 侧边栏会话名称 |
| messageCount | 会话数量标记和排序依据 |
| lastMessageAt | 最近活动排序 |
| runningState | 运行中状态显示 |
| syncStatus、lastErrorCode、lastErrorDetail | 用户可见同步和错误状态 |

正文、工具输出、thinking 文本和附件内容不纳入工作台摘要签名。

处理规则：

1. session.delta 始终只向当前会话订阅者发送。
2. 摘要签名不变时，不调用 workbenchWsHub.broadcastSnapshot。
3. 摘要签名变化时，通过已有轻量合并入口安排一次广播；广播只读已准备的摘要和缓存，不读取 provider 文件。
4. 广播失败只记观测，不能回滚已经发出的会话 delta。

### 3.9 前端长会话时间线

`MessageTimeline` 是客户端长会话的唯一重 DOM 区域，采用 `@tanstack/react-virtual` 的动态高度虚拟列表：

1. 外层滚动容器保持原有滚动、回到底部和加载更早消息逻辑。
2. 内层 virtual content 由 virtualizer 直接维护总高度；每个可见行由 `ResizeObserver` 测量真实 Markdown、工具卡和附件高度。
3. 只挂载可视区加固定 overscan 的行，行位置和容器高度由 virtualizer 直接写入 DOM，滚动时不为每个像素触发 React 全量重渲染。
4. 浏览器不支持 `ResizeObserver` 时关闭虚拟化，回退旧完整列表，优先保证旧 WebView 的可用性。
5. 导出模式继续走完整列表，不把虚拟化的可见窗口带进全文导出。
6. `useStableMessageActionStates` 按消息 ID 和 action 能力比较，复用未变化旧消息的 actionState 对象，避免 `MemoizedMessageItem` 因 Map 重建而失效。

## 4. 数据与状态模型

### 4.1 SourceSubscriptionState

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| sourceKey | string | 来源唯一键 |
| subscriberCount | number | 当前订阅者数量 |
| dirty | boolean | watcher 或兜底发现变化 |
| dirtyReasons | string[] | watcher、fallback、reconnect 等原因 |
| sourceVersion | object 或 null | 最近可信版本 |
| lastCursor | string 或 null | 最近可信 cursor |
| latestReplay | object 或 null | 受限可重放结果，不保存全量 transcript |
| quietTimer | timer 或 null | 唯一 one-shot quiet window |
| fallbackTimer | timer 或 null | 唯一 one-shot 兜底调度 |
| activeTaskId | string 或 null | TaskManager 当前任务标识 |
| watcherDispose | function 或 null | 最后订阅者离开时释放 |

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| fresh | 当前来源版本已确认 | helper 返回 unchanged 或成功结果 | watcher 或 fallback 发现变化 |
| dirty | 可能有新内容，等待 quiet window 或任务 | 文件事件、重连检查、版本变化 | TaskManager 任务开始 |
| running | helper 正在读取来源 | 任务开始 | 成功、失败或取消 |
| recover | 文件重置或 helper 状态丢失，需要受限重同步 | reset_required | initial_tail 或可信历史补偿完成 |
| released | 没有订阅者 | 最后订阅者关闭 | 新订阅建立 |

dirty 和 running 状态由来源键管理，不按单个 WebSocket 管理。新的文件事件在 running 时只追加 dirtyReasons；当前任务结束后如仍 dirty，再安排一次补跑。

### 4.3 数据归属

- Host 保存订阅关系、来源版本、cursor、受限 replay 和摘要签名。
- helper 保存可丢失的 parser checkpoint、partialLine 和尾部窗口。
- provider 原始 JSONL 始终是正文的最终来源。
- SQLite 继续保存 session binding、session index 和状态快照；本 Spec 不保存原始全文。

## 5. 错误处理

### 5.1 错误类型

| 错误 | 场景 | Host 行为 |
| --- | --- | --- |
| SOURCE_NOT_FOUND | JSONL 已删除或路径不可用 | 保留最近结果，标记同步错误，等待恢复或显式历史读取 |
| SOURCE_RESET_REQUIRED | 文件截断、替换或 checkpoint 无效 | 进入 recover，受限重同步 |
| HELPER_UNAVAILABLE | helper 未启动、管道断开或退出 | 保留最近结果，下一次触发重新建立 helper |
| HELPER_TIMEOUT | 读取或解析超过任务超时 | 取消任务、记录阶段指标，不阻塞 WebSocket |
| TAIL_PARSE_FAILED | 尾部 JSONL 不完整或记录不可信 | 保留 partialLine；无法恢复时 reset_required |
| WORKBENCH_BROADCAST_FAILED | 工作台广播失败 | 不影响已发送的会话 delta |

### 5.2 降级策略

1. 正常 append 失败时，先尝试受限 tail 重同步。
2. tail 重同步不可信时，走现有分页历史读取路径。
3. helper 失败时，下一次订阅或脏事件可重建 helper，不保留死进程状态。
4. 任一步无法保证消息正确性时，宁可返回最近可用快照和结构化错误，也不伪造完成、运行中或新消息。

## 6. 正确性属性

### 6.1 同来源单次重活

对于任意相同 sourceKey 和重叠时间窗口，系统最多执行一个真实的 session.history_delta_read helper 任务。后续触发只能合并 dirtyReasons 或等待补跑。

验证需求：requirements.md 需求 3、需求 4。

### 6.2 正常追加不依赖历史总大小

对于文件身份不变且只追加少量完整 JSONL 行的场景，helper 的 bytesRead 和 recordsParsed 上界由新增部分与固定尾部窗口决定，不由历史文件总字节数决定。

验证需求：requirements.md 需求 2、需求 7。

### 6.3 新订阅一定能看到当前状态

对于任意新建或重连的订阅者，即使来源没有新的 delta，系统也会重放当前可信快照或触发现有受限历史补偿。

验证需求：requirements.md 需求 3、需求 6。

### 6.4 正文变化不扩大工作台刷新

对于只修改已有消息正文或工具输出且摘要签名相同的更新，系统发送会话 delta，但不调用完整 workbench snapshot 广播。

验证需求：requirements.md 需求 5。

## 7. 测试策略

### 7.1 单元测试

- Codex 增量 reader：首屏 tail、追加完整行、跨调用 partialLine、尾部窗口补全、size 缩小、文件替换。
- Codex 增量索引：正常追加后复用旧 entries/messages 容器，只更新受影响下标，不重新复制整段历史。
- 来源键和摘要签名：同源去重、正文变化不触发摘要变化、标题或状态变化触发摘要变化。
- 来源协调状态：订阅加入、最后订阅释放、dirty 合并、running 后补跑、quiet window 取消。
- helper 协议：输入输出序列化、取消和 checkpoint 丢失恢复。
- MessageTimeline：长历史只挂载虚拟范围、旧 actionState 引用稳定、缺少 ResizeObserver 时回退完整列表。

### 7.2 集成测试

- TaskManager helper_process 的 session.history_delta_read 注册、去重、超时和观测。
- 两个 WebSocket 订阅同一 Codex 来源时只执行一轮 helper 读取。
- watcher 触发只打脏，解析只发生在 helper handler。
- session.subscribe 重连后的 snapshot 重放。
- session.delta 仅修改正文时 workbenchWsHub 不广播；摘要变化时只合并广播一次。
- Codex 订阅兜底版本检查只做异步 metadata stat，不读取正文。

### 7.3 性能回放

使用短 JSONL 和长 JSONL 的同一追加夹具，比较：

| 指标 | 正常追加预期 | 文件重置预期 |
| --- | --- | --- |
| Host 同步文件读取 | 0 | 0 |
| helper bytesRead | 新增字节加尾部窗口 | 允许受限重同步 |
| helper recordsParsed | 新增记录加尾部窗口 | 允许增加并明确标记 |
| workbench broadcast | 摘要不变时为 0 | 仅摘要变化时发生 |
| 任务模式 | append_delta 或 tail_reconcile | reset_required 后恢复 |

### 7.4 最小验证命令

- CODINGNS_VITEST_TEST_TIMEOUT_MS=60000 pnpm --dir apps/host test tests/integration/session-history-background-tasks.test.ts tests/integration/task-helper-client.test.ts tests/ws-server-subscription.test.ts tests/ws-server-dedupe.test.ts
- （在 `apps/host` 目录）node scripts/run-vitest.mjs tests/integration/session-history-helper-read.test.ts
- CODINGNS_VITEST_TEST_TIMEOUT_MS=60000 pnpm --dir apps/host test tests/integration/workbench-ws-hub.test.ts tests/integration/session-history-service.test.ts
- node --test --test-timeout=60000 packages/session-sync-core/tests/codex-adapter.test.mjs
- pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit
- pnpm --dir packages/session-sync-core build
- pnpm check:sqlite-runtime
- pnpm --dir apps/user-app test -- src/features/conversation/components/MessageTimeline.virtualization.test.tsx
- pnpm --dir apps/user-app exec tsc -p tsconfig.json --noEmit

## 8. 风险与待确认项

### 8.1 风险

- Codex JSONL 的真实追加和回滚行为需要用生产样本验证，不能只相信简单夹具。
- 文件 dev/inode 在不同平台可能不可用或不稳定，必须允许路径、mtime、size 的兼容判断。
- helper 被回收后 parser checkpoint 丢失，恢复路径必须受限且正确，不能为了快而猜测上下文。
- 摘要签名选得太少会造成侧边栏陈旧，选得太多会重新放大广播；需要回放实际工作台排序和状态用法。
- 原生运行时和文件补偿同时到达时，消息合并必须继续以稳定 ID 和权威优先级处理。

### 8.2 待确认项

- 生产 Codex JSONL 是否存在会在历史中间改写而不是尾部追加的真实样本。
- 低频兜底默认值是否以 2 秒起步，还是根据桌面端与远程 Host 分别配置。
- tailWindow 的字节数和消息数初始上限应由哪组生产样本确定。
- 工作台摘要中的 lastMessageAt 是否应在工具输出局部更新时保持不变，以避免无意义排序抖动。
