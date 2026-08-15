# spec002.1.1-会话订阅增量解析与主线程隔离

## 当前定位

这是 spec002.1 的下游子 Spec。

spec002.1 已经处理工作区会话 discovery：哪些工作区该扫、哪些来源没变时可以跳过、怎样避免整工作区反复扫描。

这里处理的是另一条链路：

- 用户已经打开一个会话
- Codex 的原始 JSONL 正在继续增长
- Host 为了把新消息推到页面上，反复读取和解析这个会话文件

当前问题不在“会不会发现这条会话”，而在“已经知道它存在以后，怎么只读新增部分、不把 Host 事件循环堵住，也不把整段历史一直留在浏览器 DOM 里”。

## 这次要解决什么

1. Codex 文件型会话订阅的重 I/O 和 JSONL 解析必须离开 Host 主线程。
2. 正常文件追加时，只读取新写入的字节和一个受控的尾部窗口，不再从头读取整份历史。
3. 同一个会话来源被多个页面订阅时，只保留一份 watcher、一次后台读取和一份结果缓存。
4. 文件 watcher 只打脏标记；真正读取统一走 TaskManager 的 helper_process。
5. 会话正文变化不再无条件触发整张工作台快照广播。
6. WebSocket 重连、helper 回收、文件截断或替换时，仍能安全回到现有历史读取路径，不丢消息、不伪造状态。
7. 客户端只挂载可视区附近的消息行，并保持旧消息的 actionState 引用稳定。

## 和现有 Spec 的关系

- 依赖 spec001.2：后台任务、helper_process、主线程预算和观测规则。
- 依赖 spec001.2.1：读接口只读、watcher 只打脏、同资源只保留一个 inflight 的规则。
- 依赖 spec002.1：复用来源键、来源指纹和 provider 分层边界，但不重做工作区 discovery。
- 必须兼容 spec003.1：原生运行时直推仍是运行中会话的优先来源，文件订阅只是历史补偿和外部会话变化感知，不能把 JSONL 轮询伪装成实时运行时。

## 计划覆盖

- Codex JSONL 的 helper 侧增量尾读和尾部可变消息重放。
- 会话来源级订阅协调、文件 watcher、quiet window 和低频兜底校验。
- session.history_delta_read 后台任务、helper 协议和观测指标。
- 现有会话 WebSocket 订阅的增量接入与重放兼容。
- 工作台快照的会话摘要签名门禁。
- 单元、集成和长会话性能回放验证。
- MessageTimeline 的动态高度虚拟列表和旧消息 actionState 引用复用。

## 本阶段明确不做

- 不重写工作区 discovery，也不把会话订阅混回 workspace.discovery。
- 不把整份 transcript 复制进 Host SQLite。
- 不给所有 provider 一次性实现增量 reader；第一阶段只落地 Codex，其他 provider 保留现有兼容路径。
- 不替换 Codex 原生运行时事件流，不降低运行中会话的直推能力。
- 不新建第二套私有任务调度器、常驻守护进程或无限存活的 watcher。

## 后续主文档

- requirements.md
- design.md
- tasks.md
- docs/20260815-会话订阅性能基线与验收口径.md
- docs/20260815-阶段验证记录.md
