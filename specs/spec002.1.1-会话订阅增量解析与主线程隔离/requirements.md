# 需求文档 - spec002.1.1 会话订阅增量解析与主线程隔离

状态：IN_REVIEW

## 简介

长 Codex 会话越用越卡，不是一个抽象的“消息多了浏览器慢”问题。

当前链路里，活跃会话的 JSONL 文件发生变化后，Host 订阅大约每 300ms 会读取历史页。Codex 适配器在文件 mtime 或 size 变化时会失去缓存，并同步读取、切分和解析整份 JSONL；之后才从完整消息数组里取 cursor 对应的增量。文件越大，这段工作越久，Node 的 Host 事件循环就被堵得越明显。

前端长时间线同样会因为整段 DOM 和不断新建的 actionState 引用而放大卡顿。本 Spec 同时处理这两个直接问题：客户端只保留可视区附近的行，后端只读取新增内容。目标不是把工作搬到另一个进程后继续全量解析，而是让正常追加场景的读取量与新增内容大小相关。

## 术语表

- **会话来源**：provider 侧承载会话内容的真实对象。这里第一阶段指 Codex JSONL 文件。
- **来源键**：稳定标识一个会话来源的键，至少包含 provider、providerSessionId 和 rawStoreRef。
- **来源版本**：用于判断文件是否还是同一份内容的轻量信息，例如路径、dev/inode、mtime、size。
- **尾读**：从上次已确认字节偏移之后读取文件新增内容，而不是重新读取整份文件。
- **尾部窗口**：为处理工具状态补全、同一消息多段记录等情况，对文件末尾保留的一小段可重放范围。
- **脏标记**：watcher 或兜底校验发现来源可能变了，但尚未读取正文的状态。
- **摘要签名**：工作台真正关心的标题、消息数、最近时间、运行状态和错误摘要的可比较值。
- **历史补偿**：客户端新建或重建订阅时，Host 发送当前可用消息快照以补齐此前错过的内容。

## 范围说明

### In Scope

- Codex 文件型历史订阅的 helper_process 增量读取。
- 来源级 watcher、订阅复用、quiet window 和低频兜底检查。
- TaskManager 任务类型、helper handler、取消和观测接入。
- JSONL 追加、尾部更新、截断、替换和 helper 重启的安全恢复。
- session.delta 与 session.backfill 的兼容发送方式。
- 工作台快照只在会话摘要实际变化时再广播。
- MessageTimeline 的动态高度虚拟列表和旧消息 actionState 引用复用。

### Out of Scope

- Markdown 解析器、消息展示语义或导出全文视图的重写。
- 工作区会话 discovery、来源归属识别和来源索引迁移。
- Codex 原生运行时事件协议重写。
- Claude Code、Gemini、Kimi、OpenCode 的增量历史 reader 实现。
- 原始消息全文入库或跨 Host 同步全文缓存。

## 需求

### 需求 0：长会话客户端只渲染可视范围，并保持旧消息引用稳定

**用户故事：** 作为正在查看长会话的用户，我希望滚动和新消息到来时浏览器不必反复布局整段历史，这样历史再长也不会因为 DOM 数量和无效重渲染越来越卡。

#### 验收标准

1. WHEN 浏览器支持动态尺寸观测 THEN System SHALL 只挂载可视区附近的消息行，并按真实 Markdown、工具卡和图片高度测量位置。
2. WHEN 新消息到来但旧消息的复制和分叉能力未变化 THEN System SHALL 复用旧消息的 actionState 对象，不得因新 Map 或新对象击穿 MemoizedMessageItem。
3. WHEN 旧 WebView 不支持 ResizeObserver THEN System SHALL 保留原有完整列表作为兼容回退，不得出现空白会话或滚动失效。
4. WHEN 用户导出会话全文 THEN System SHALL 保持原有完整导出，不把虚拟化截断带入导出结果。

### 需求 1：会话订阅的重读取和解析必须离开 Host 主线程

**用户故事：** 作为正在使用长会话的用户，我希望新消息到来时 Host 不会因为读大 JSONL 而卡住，这样其他 API、WebSocket 和页面操作不会一起变慢。

#### 验收标准

1. WHEN 已订阅的 Codex 会话需要检查历史变化 THEN System SHALL 把文件读取、JSONL 切分、JSON 解析和消息归一化放入 helper_process。
2. WHEN Host 收到 helper 结果 THEN System SHALL 只做小型结果校验、缓存更新和增量 WebSocket 推送，不得在订阅回调中同步读取 JSONL。
3. WHEN helper_process 返回正常追加结果 THEN System SHALL 只传回本次受影响的消息和必要的来源版本，不得经 IPC 回传整份历史。
4. WHEN helper_process 不可用或超时 THEN System SHALL 保留最近可用会话状态，并走明确的恢复或降级路径，不得卡死订阅。

### 需求 2：正常追加场景必须只读取新增字节和受控尾部窗口

**用户故事：** 作为长会话用户，我希望文件变大后更新成本仍然稳定，而不是每次输出一小段内容都把历史从头解析一遍。

#### 验收标准

1. WHEN 来源文件身份一致且 size 增长 THEN System SHALL 从最近确认的 byteOffset 之后读取新增字节。
2. WHEN 文件末尾存在未写完的一行 THEN System SHALL 缓存这段残留，等下一次追加后再解析，不得把半行当成错误消息。
3. WHEN 工具调用、工具结果或同一逻辑消息可能在尾部补全 THEN System SHALL 重放受控尾部窗口，并只发出签名真实变化的消息。
4. WHEN 文件 size 缩小、文件身份变化、解析上下文无法恢复或 cursor 不可信 THEN System SHALL 返回明确的重同步信号，由既有历史路径安全补偿，而不是猜测性合并。
5. WHEN 正常追加连续发生 THEN System SHALL 让读取字节数和解析记录数主要随新增内容增长，而不是随整份文件大小增长。

### 需求 3：同一个来源只保留一份订阅协调、watcher 和后台读取

**用户故事：** 作为同时打开多个页面或重连客户端的用户，我希望系统不会因为每个订阅者都各自读同一个文件而把 CPU 又翻几倍。

#### 验收标准

1. WHEN 多个 WebSocket 订阅指向同一个来源键 THEN System SHALL 共享一份来源监听和一次增量读取任务。
2. WHEN watcher 收到文件事件 THEN System SHALL 只标记来源为 dirty 并安排可去重的后台读取，不得在 watcher 回调中直接解析文件。
3. WHEN 最后一个订阅者关闭 THEN System SHALL 释放该来源的 watcher、one-shot quiet timer 和未完成读取的取消句柄。
4. WHEN 新订阅者加入且来源当前没有新变化 THEN System SHALL 能重放当前快照，不得因为“没有 delta”而让新页面空白。

### 需求 4：轮询只能作为低频兜底，不能再每 300ms 做机械历史读取

**用户故事：** 作为不要求毫秒级文件扫描的用户，我希望系统优先利用文件变化事件并合并连续写入，避免后台无意义空转。

#### 验收标准

1. WHEN 平台能为当前 JSONL 文件提供 watcher 事件 THEN System SHALL 用 watcher 作为主要脏标记来源。
2. WHEN 同一来源在 quiet window 内收到多个事件 THEN System SHALL 合并为最多一次后台读取。
3. WHEN watcher 漏事件、不可用或底层文件替换未被可靠通知 THEN System SHALL 以命名常量配置的低频轻量校验作为兜底；该校验不得直接全量解析正文。
4. WHEN Codex 原生运行时正在提供权威直接事件 THEN System SHALL 保持现有直推优先级，文件订阅只做必要补偿，不得为同一消息重复推送。
5. WHEN 没有原生直推、只能依赖文件变化 THEN System SHALL 将正常变化的可见延迟控制在 watcher 触发加 quiet window 内；兜底校验的延迟必须在文档和观测中可见。

### 需求 5：会话正文 delta 不得无条件带动整张工作台刷新

**用户故事：** 作为正在使用工作台的用户，我希望某个会话的一段工具输出更新时，侧边栏和其他工作台区域不会每次都跟着重算。

#### 验收标准

1. WHEN session.delta 只改变已存在消息的正文、工具输出或局部状态，且会话摘要签名未变化 THEN System SHALL 只向该会话订阅者发送 delta，不广播完整 workbench snapshot。
2. WHEN 标题、消息计数、最近消息时间、运行状态或用户可见错误摘要发生变化 THEN System SHALL 允许安排一次合并后的工作台快照广播。
3. WHEN 连续多个摘要变化在合并窗口内到达 THEN System SHALL 复用已有后台刷新或合并广播，不得按每条消息创建多个等价广播。
4. WHEN 工作台快照发送失败 THEN System SHALL 不影响会话 delta 已经成功发送给当前订阅者。

### 需求 6：恢复、重连和异常文件必须保持现有用户可见语义

**用户故事：** 作为用户，我希望优化后刷新页面、helper 回收或外部修改会话文件时，看到的是可靠历史，而不是重复、丢失或假装还在运行的消息。

#### 验收标准

1. WHEN WebSocket 重新订阅 THEN System SHALL 重放当前可用历史快照和 cursor，不依赖客户端是否恰好收到上一轮 delta。
2. WHEN helper 空闲回收或意外退出 THEN System SHALL 在下一次读取时通过受限 tail snapshot 或明确重同步恢复，不得依赖已经丢失的进程内全量缓存。
3. WHEN 文件截断、重命名、替换或回滚 THEN System SHALL 让客户端进入已有的历史补偿路径，并保证稳定消息 ID 的去重规则仍然有效。
4. WHEN 新实现无法给出可信结果 THEN System SHALL 优先返回最近可用状态并记录结构化错误，不得静默丢弃后续更新。

### 需求 7：必须能分清 helper 慢、Host 收尾慢还是广播慢

**用户故事：** 作为维护者，我希望下一次性能异常时可以直接知道字节读在哪里、任务排在哪里、广播为什么慢，而不是再靠猜。

#### 验收标准

1. WHEN 增量读取任务执行 THEN System SHALL 记录来源键、读取模式、bytesRead、recordsParsed、tailWindowBytes、waitMs、runMs 和是否发生重同步。
2. WHEN Host 接收 helper 结果 THEN System SHALL 分别记录结果合并、摘要比较、会话 delta 序列化和工作台广播的耗时。
3. WHEN 同一来源任务被去重、取消、超时或因 watcher 合并 THEN System SHALL 在现有 TaskManager 和 runtime observability 中可观察。
4. WHEN 验收长会话 THEN System SHALL 可以比较正常追加与重同步两种模式，证明正常追加不再依赖整份 JSONL 大小。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 正常追加小量 JSONL 记录 THEN Host 订阅路径不得同步读取整份来源文件。
2. WHEN 多个页面订阅同一来源 THEN 同一时刻最多保留一个真实 helper 读取任务。
3. WHEN 会话正文变化但摘要未变化 THEN workbench snapshot 广播次数应为 0。

### 非功能需求 2：可靠性

1. WHEN watcher 事件不可靠 THEN System SHALL 通过低频来源版本校验补漏。
2. WHEN helper 进程状态丢失 THEN System SHALL 有安全重建方式，不能依赖永久常驻进程。
3. WHEN 新增 reader 出错 THEN System SHALL 能退回既有历史读取结果，不破坏已有会话查看和继续对话。

### 非功能需求 3：兼容性与可维护性

1. WHEN 现有客户端继续发送 session.subscribe、加载更早消息或接收 session.delta THEN System SHALL 保持协议和消息 ID 兼容。
2. WHEN 后续新增 provider 增量 reader THEN System SHALL 复用来源键、结果模式、观测字段和恢复语义，不复制新的订阅调度器。
3. WHEN 代码审查订阅改动 THEN System SHALL 能按“watcher 只打脏、TaskManager 执行重活、Host 只处理小 delta、关闭必释放”四点检查。

## 成功定义

- 活跃长 Codex 会话的 JSONL 读取和解析不再堵 Host 主线程。
- 正常 JSONL 追加读取量主要随新增数据增长，而不是随历史文件大小增长。
- 多订阅者不再重复读取同一来源。
- 会话正文更新不会无条件刷新工作台。
- helper 回收、WebSocket 重连和文件异常仍能安全恢复。
- 观测能明确显示本次是 append delta、尾部重放还是重同步。
