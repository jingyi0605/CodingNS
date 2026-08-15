# 任务清单 - spec002.1.1 会话订阅增量解析与主线程隔离

状态：IN_REVIEW

## 这份文档是干什么的

这份任务清单把“会话订阅不要堵 Host”拆成可验证的小步。

核心顺序不能反：

1. 先让客户端不再把整段历史挂进 DOM。
2. 再把 helper 任务和结果契约定对。
3. 再让 Codex 真正按追加字节和增量索引读取。
4. 再把 WebSocket 订阅切到来源级协调。
5. 最后才收紧工作台广播和做长会话验收。

不能先把 300ms 改成 2 秒然后宣布优化完成。那只是把卡顿变成延迟。

## 状态说明

- TODO：还没开始。
- IN_PROGRESS：正在做。
- BLOCKED：被外部问题卡住，必须写明原因。
- IN_REVIEW：已经完成实现，等待复核。
- DONE：已经完成且验证结果已记录。
- CANCELLED：确认不做，必须写明原因。

规则：

- 只有状态为 DONE 的任务才能勾选。
- 每完成一个任务，立刻回写本文件。
- 不允许为了赶进度跳过阶段检查。

---

## 阶段 0：把边界和验收基线固定下来

- [x] 0.1 建立 spec002.1.1 并锁定范围
  - 状态：DONE
  - 这一步到底做什么：创建本 Spec，明确它处理 Codex 文件型订阅读取、helper 隔离、增量 tail read、摘要广播门禁和长会话前端虚拟列表。
  - 做完你能看到什么：后续不会把工作区 discovery 或原生运行时重写混进来；客户端和服务端的长会话性能边界也清楚。
  - 先依赖什么：spec001.2、spec001.2.1、spec002.1、spec003.1。
  - 开始前先看：
    - requirements.md
    - design.md
    - docs/20260815-会话订阅性能基线与验收口径.md
  - 主要改哪里：
    - specs/spec002.1.1-会话订阅增量解析与主线程隔离/
    - specs/README.md
  - 这一步先不做什么：不修改 Host、helper、provider 或前端运行代码。
  - 怎么算完成：
    1. 需求、设计、任务和性能基线文档齐全。
    2. 明确写出与 spec002.1 和 spec003.1 的边界。
  - 怎么验证：
    - 人工检查目录和文档交叉引用。
    - rg -n "readFileSync|session.history_delta_read|workbench" specs/spec002.1.1-会话订阅增量解析与主线程隔离
  - 对应需求：requirements.md 全部需求。
  - 对应设计：design.md 全文。

### 阶段检查

- [ ] 0.2 基线证据检查
  - 状态：IN_REVIEW
  - 这一步到底做什么：用一个真实或脱敏的长 Codex JSONL 记录当前 Host 读取路径、payload 大小、workbench 广播次数和事件循环影响。
  - 做完你能看到什么：后续不是凭感觉说“快了”，而是可以对比正常追加和文件重同步。
  - 先依赖什么：0.1。
  - 开始前先看：
    - docs/20260815-会话订阅性能基线与验收口径.md
    - apps/host/src/modules/sessions/session-history-service.ts
    - packages/session-sync-core/src/providers/codex.ts
  - 主要改哪里：
    - 只补测试夹具、性能观测和验收记录。
  - 这一步先不做什么：不因采样结果直接改实现。
  - 怎么算完成：
    1. 有短文件与长文件的同一追加场景。
    2. 能记录 bytesRead、解析记录数、helper 或 Host 阶段耗时和广播次数。
  - 怎么验证：
    - 运行定向夹具回放并保存结果到本 Spec 的验收记录。
  - 本轮结果：已完成源码路径核对和 350 条记录的长 JSONL 追加夹具；生产 JSONL、Host 火焰图和浏览器基线仍未验证。
  - 对应需求：requirements.md 需求 7。
  - 对应设计：design.md §7.3。

- [x] 0.3 客户端长会话虚拟列表和 actionState 引用稳定
  - 状态：DONE
  - 这一步到底做什么：给 `MessageTimeline` 接入动态高度虚拟列表，并让未变化旧消息复用 actionState 对象。
  - 做完你能看到什么：长历史只挂载可视区附近的消息 DOM；追加新消息不会因为重建 actionState Map 让旧 Markdown 和工具卡重新渲染。
  - 先依赖什么：0.1。
  - 开始前先看：
    - requirements.md 需求 0。
    - design.md §3.9。
    - docs/开发设计规范/20260419-前端页面与样式设计规范.md。
  - 主要改哪里：
    - apps/user-app/src/features/conversation/components/MessageTimeline.tsx
    - apps/user-app/src/features/conversation/components/MessageTimeline.virtualization.test.tsx
    - apps/user-app/src/app/styles.css
    - apps/user-app/package.json
  - 这一步先不做什么：不改变消息语义、Markdown 解析规则、导出全文和不支持 ResizeObserver 的旧 WebView 行为。
  - 怎么算完成：
    1. 支持 ResizeObserver 时只渲染虚拟范围，动态高度可以重新测量。
    2. 不支持 ResizeObserver 时保留旧完整列表。
    3. 相同历史重新进入时间线时，旧 `MemoizedMessageItem` 不因 actionState 引用变化重渲染。
  - 怎么验证：
    - pnpm --dir apps/user-app test -- src/features/conversation/components/MessageTimeline.virtualization.test.tsx
    - pnpm --dir apps/user-app test -- src/features/conversation/components/MessageTimeline.apply-patch.test.tsx
    - pnpm --dir apps/user-app exec tsc -p tsconfig.json --noEmit
  - 本轮结果：已通过上述三项定向验证；未启动开发服务器，未做浏览器 E2E。
  - 对应需求：requirements.md 需求 0。
  - 对应设计：design.md §3.9。

---

## 阶段 1：先把重活真的送进 helper

- [ ] 1.1 注册来源级历史增量读取任务和 helper handler
  - 状态：DONE
  - 这一步到底做什么：新增 session.history_delta_read 任务类型和 session.history_delta_read helper handler，定义输入、输出、取消和阶段指标，并把 workspace rootDir 作为现有 helper pool 的稳定分区键。
  - 做完你能看到什么：同一个来源键的增量读取有统一去重、超时、取消和观测，不再靠 WebSocket 回调私自开重活。
  - 先依赖什么：0.2。
  - 开始前先看：
    - requirements.md 需求 1、需求 3、需求 7。
    - design.md §3.3、§3.4、§4.1。
    - specs/spec001.2-后端任务调度与主线程压力治理/20260412-后台任务接入规范.md。
  - 主要改哪里：
    - apps/host/src/modules/tasks/task-types.ts
    - apps/host/src/modules/tasks/task-helper-process-handlers.ts
    - apps/host/src/modules/tasks/task-helper-process.ts
    - apps/host/src/modules/provider/provider-discovery-runtime.ts 或等价 helper runtime 入口
    - apps/host/src/modules/sessions/session-history-service.ts
    - apps/host/tests/integration/session-history-background-tasks.test.ts
    - apps/host/tests/integration/task-helper-client.test.ts
  - 这一步先不做什么：不改变现有 JSONL 全量读取语义，不切换 WebSocket 订阅。
  - 怎么算完成：
    1. 任务明确声明为 helper_process，且真正通过 task helper pool 执行。
    2. 同来源重复入队会命中同一任务。
    3. 取消、超时和阶段指标能从现有观测看到。
  - 怎么验证：
    - CODINGNS_VITEST_TEST_TIMEOUT_MS=60000 pnpm --dir apps/host test tests/integration/session-history-background-tasks.test.ts tests/integration/task-helper-client.test.ts tests/modules/tasks/task-helper-pool.test.ts
    - pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit
  - 本轮结果：任务类型、helper handler、helper 调度并发、helper lane 集成断言和 Host 类型检查已完成；`session-history-helper-read.test.ts` 2/2、`session-history-background-tasks.test.ts` 16/16 通过。
  - 对应需求：requirements.md 需求 1、需求 3、需求 7。
  - 对应设计：design.md §3.4、§5、§6.1。

- [x] 1.2 实现 Codex JSONL 增量 tail reader
  - 状态：DONE
  - 这一步到底做什么：在 helper 内实现首屏受限 tail、追加字节读取、partialLine、尾部窗口重放、增量索引和 reset_required。
  - 做完你能看到什么：正常追加时不再调用整份 JSONL 的同步 readFileSync，也不复制整份 entries/messages；helper 只返回新增或变化消息。
  - 先依赖什么：1.1。
  - 开始前先看：
    - requirements.md 需求 1、需求 2、需求 6。
    - design.md §3.5、§4.3、§5.2、§6.2。
    - packages/session-sync-core/src/providers/codex.ts。
  - 主要改哪里：
    - packages/session-sync-core/src/providers/codex.ts
    - packages/session-sync-core/src/providers/utils.ts
    - packages/session-sync-core/src/types.ts（仅在确实需要公开结果类型时）
    - packages/session-sync-core/tests/codex-adapter.test.mjs
    - 新增最小 Codex JSONL 夹具
  - 这一步先不做什么：不为所有 provider 改 ProviderAdapter 公共接口；不把完整历史通过 helper 返回。
  - 怎么算完成：
    1. 初始读取受限于首屏或恢复所需 tail。
    2. 追加完整行只读 offset 之后的字节。
    3. 半行、工具尾部补全、截断和替换都有确定结果。
    4. 正常追加的 bytesRead、recordsParsed 和旧消息容器复制量不随着历史文件总大小线性增长。
  - 怎么验证：
    - node --test --test-timeout=60000 packages/session-sync-core/tests/codex-adapter.test.mjs
    - pnpm --dir packages/session-sync-core build
    - 用短、长 JSONL 的同一追加夹具比较 helper diagnostics。
  - 本轮结果：session-sync-core 构建通过，Codex adapter 48/48 通过；长 JSONL 追加夹具确认只读新增字节，并复用旧消息索引和容器。
  - 对应需求：requirements.md 需求 1、需求 2、需求 6、需求 7。
  - 对应设计：design.md §3.5、§5.2、§6.2。

### 阶段检查

- [x] 1.3 阶段检查：Host 已经不读订阅 JSONL 正文
  - 状态：DONE
  - 这一步到底做什么：检查 session.history_delta_read 从入口到 helper 返回的路径，确认 Host 没有留下同步文件读取或整份消息构造。
  - 做完你能看到什么：第一阶段不仅是 executionLane 标签好看，重活真的已经离开主线程。
  - 先依赖什么：1.1、1.2。
  - 开始前先看：
    - requirements.md 需求 1、需求 2。
    - design.md §1.3、§3.4、§3.5。
  - 主要改哪里：本阶段相关 Host、helper、session-sync-core 文件。
  - 这一步先不做什么：不接入 watcher，不改广播策略。
  - 怎么算完成：
    1. Host 订阅路径没有 readFileSync、全量 JSONL parse 或全量历史 IPC。
    2. helper 结果可被现有消息 ID 去重机制消费。
  - 怎么验证：
    - rg -n "readFileSync|readJsonLines" apps/host/src/modules/sessions apps/host/src/modules/tasks
    - 定向测试和 helper 阶段指标走查。
  - 本轮结果：Codex `readPage` 和订阅 delta 都经 `session.history_delta_read` 进入 helper；Host 只处理页面或 delta 小结果。helper 读取集成测试 2/2 通过，Host 类型检查通过。
  - 对应需求：requirements.md 需求 1、需求 2。
  - 对应设计：design.md §3.4、§3.5。

---

## 阶段 2：把 WebSocket 订阅改成来源级、事件驱动

- [x] 2.1 实现来源订阅协调器和文件 watcher 生命周期
  - 状态：DONE
  - 这一步到底做什么：让同一 sourceKey 的多个订阅共享一份 watcher、dirty 状态、quiet window 和 TaskManager 任务。
  - 做完你能看到什么：多个页面看同一会话时，不会各自轮询和解析同一个 JSONL；最后一个订阅关闭后资源会释放。
  - 先依赖什么：1.3。
  - 开始前先看：
    - requirements.md 需求 3、需求 4、需求 6。
    - design.md §3.1、§3.3、§3.6、§4.1、§4.2。
    - specs/spec001.2.1-读写刷新与后台任务统一规则/design.md §2.7。
  - 主要改哪里：
    - apps/host/src/modules/sessions/session-history-service.ts
    - 新增或收口到 apps/host/src/modules/sessions/ 下的来源协调模块
    - apps/host/tests/integration/session-history-service.test.ts
    - apps/host/tests/ws-server-subscription.test.ts
  - 这一步先不做什么：不递归监听 Codex home 或整个工作区；不在 watcher 回调直接读文件。
  - 怎么算完成：
    1. watcher 只监听当前 rawStoreRef。
    2. 事件只打脏并经过唯一 quiet window。
    3. 同源多订阅最多有一个真实 helper task。
    4. 重连订阅可收到当前快照，关闭后 watcher 和 timer 被释放。
  - 怎么验证：
    - CODINGNS_VITEST_TEST_TIMEOUT_MS=60000 pnpm --dir apps/host test tests/integration/session-history-service.test.ts tests/ws-server-subscription.test.ts tests/ws-server-dedupe.test.ts
    - 人工检查 watcher 事件处理函数不包含 provider 文件读取。
  - 本轮结果：来源协调器定向测试 2/2 通过，helper 订阅集成测试 2/2 通过，SessionHistoryService 集成测试 6/6 通过；watcher 回调只标记 dirty。
  - 对应需求：requirements.md 需求 3、需求 4、需求 6。
  - 对应设计：design.md §3.6、§4.1、§4.2、§6.3。

- [ ] 2.2 接入低频来源版本兜底和原生运行时优先级
  - 状态：IN_REVIEW
  - 这一步到底做什么：用可配置的低频异步 metadata stat 校验补 watcher 漏事件，并明确活跃原生运行时下文件补偿的去重和优先级。
  - 做完你能看到什么：没有 watcher 事件时不会永久不更新；有 RuntimeEvent 时不会出现同一消息双重推送。
  - 先依赖什么：2.1。
  - 开始前先看：
    - requirements.md 需求 4、需求 6。
    - design.md §3.6.3、§3.7、§5.2。
    - specs/spec003.1-原生会话实时对话运行时/design.md §2.3。
  - 主要改哪里：
    - apps/host/src/modules/sessions/session-history-service.ts
    - apps/host/src/modules/sessions/session-runtime-service.ts（仅在优先级收口确有需要时）
    - apps/host/tests/integration/session-history-recovery.test.ts
    - apps/host/tests/ws-server-subscription.test.ts
  - 这一步先不做什么：不把文件兜底改成新的高频 setInterval；不改变 RuntimeEvent 对客户端的事件格式。
  - 怎么算完成：
    1. 兜底检查只比较来源版本，未变化时不解析正文，也不在 Host 主线程执行同步文件调用。
    2. 默认间隔、quiet window 和释放时机都使用命名常量并有观测。
    3. 运行时直推和文件补偿按稳定消息 ID 合并。
  - 怎么验证：
    - CODINGNS_VITEST_TEST_TIMEOUT_MS=60000 pnpm --dir apps/host test tests/integration/session-history-recovery.test.ts tests/ws-server-subscription.test.ts tests/integration/session-history-service.test.ts
    - 用模拟 watcher 漏事件和 helper 回收场景回放。
  - 本轮结果：低频兜底已经改为异步 metadata stat，来源协调器测试覆盖 watcher 漏事件；真实 helper 回收和原生运行时竞态仍待回放复核。
  - 对应需求：requirements.md 需求 4、需求 6。
  - 对应设计：design.md §3.6、§3.7、§5.2。

- [x] 2.3 给工作台广播加会话摘要签名门禁
  - 状态：DONE
  - 这一步到底做什么：把 session.delta 和 workbench snapshot 广播拆开，只有用户可见会话摘要变化时才刷新工作台。
  - 做完你能看到什么：工具输出或正文追加仍实时显示在会话页，但不会每次拖动侧边栏和工作台快照。
  - 先依赖什么：2.1。
  - 开始前先看：
    - requirements.md 需求 5、需求 7。
    - design.md §3.8、§4.3、§6.1。
    - apps/host/src/ws/ws-server.ts。
  - 主要改哪里：
    - apps/host/src/ws/ws-server.ts
    - apps/host/src/modules/sessions/session-history-service.ts
    - apps/host/tests/ws-server-dedupe.test.ts
    - apps/host/tests/integration/workbench-ws-hub.test.ts
  - 这一步先不做什么：不改 workbench snapshot DTO，不在广播回调里追加 provider 文件读取。
  - 怎么算完成：
    1. 正文变化且摘要相同不会调用完整 workbench 广播。
    2. 摘要变化会合并广播，且不会影响会话 delta 投递。
    3. 广播失败不回滚消息投递。
  - 怎么验证：
    - CODINGNS_VITEST_TEST_TIMEOUT_MS=60000 pnpm --dir apps/host test tests/ws-server-dedupe.test.ts tests/integration/workbench-ws-hub.test.ts
    - 人工检查 ws-server 的广播条件只依赖摘要变更结果。
  - 本轮结果：WebSocket 订阅测试 3/3 通过，正文续写和工具输出不会重复触发工作台广播；运行状态和错误 envelope 仍可触发广播。
  - 对应需求：requirements.md 需求 5、需求 7。
  - 对应设计：design.md §3.8、§6.1、§6.4。

### 阶段检查

- [ ] 2.4 阶段检查：订阅不再靠高频全量读取
  - 状态：IN_REVIEW
  - 这一步到底做什么：联动检查 watcher、quiet window、低频兜底、同源去重和工作台广播门禁。
  - 做完你能看到什么：订阅既不会无意义空转，也不会漏掉可恢复的外部文件变化。
  - 先依赖什么：2.1、2.2、2.3。
  - 开始前先看：
    - requirements.md 需求 3、需求 4、需求 5、需求 6。
    - design.md §3.6、§3.7、§3.8。
  - 主要改哪里：本阶段所有相关 Host、helper 与测试文件。
  - 这一步先不做什么：不扩展到其他 provider。
  - 怎么算完成：
    1. 多订阅不重复读取。
    2. watcher 漏事件有低频版本校验补漏。
    3. 正文 delta 不触发无意义 workbench 广播。
  - 怎么验证：
    - 运行阶段 2 的全部定向测试。
    - 走查 TaskManager 观测中的 dedupe、wait、run 和取消事件。
  - 本轮结果：来源共享、quiet window、15 秒 metadata 兜底和摘要门禁已经实现；真实运行时竞态、TaskManager 完整观测回归和生产 watcher 行为仍待复核。
  - 对应需求：requirements.md 需求 3、需求 4、需求 5、需求 6。
  - 对应设计：design.md §3.6、§3.7、§3.8、§6。

---

## 阶段 3：把长会话验收和回退做扎实

- [ ] 3.1 补齐分阶段观测、夹具回放和回退测试
  - 状态：IN_REVIEW
  - 这一步到底做什么：让 append delta、tail reconcile、reset_required、helper 超时和 workbench 广播分别可量化、可回放。
  - 做完你能看到什么：性能结论有测试和指标支撑，发生文件异常时也能证明没有丢消息或让 Host 主线程读大文件。
  - 先依赖什么：2.4。
  - 开始前先看：
    - requirements.md 需求 6、需求 7。
    - design.md §5、§6、§7.3。
    - docs/20260815-会话订阅性能基线与验收口径.md。
  - 主要改哪里：
    - apps/host/src/shared/utils/perf-log.ts 或既有观测入口
    - apps/host/tests/integration/session-history-service.test.ts
    - apps/host/tests/integration/session-history-recovery.test.ts
    - packages/session-sync-core/tests/codex-adapter.test.mjs
    - specs/spec002.1.1-会话订阅增量解析与主线程隔离/docs/ 下的验收结果文件
  - 这一步先不做什么：不把性能日志默认升级成高成本常驻采样。
  - 怎么算完成：
    1. 可分清 helper 读、解析、Host 合并、序列化和广播耗时。
    2. 长短文件同追加回放证明 normal append 的读取量不随历史总大小线性增长。
    3. 文件截断、helper 回收、重连都有回退测试。
  - 怎么验证：
    - CODINGNS_VITEST_TEST_TIMEOUT_MS=60000 pnpm --dir apps/host test tests/integration/session-history-service.test.ts tests/integration/session-history-recovery.test.ts tests/integration/session-history-background-tasks.test.ts
    - node --test --test-timeout=60000 packages/session-sync-core/tests/codex-adapter.test.mjs
    - pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit
    - pnpm --dir packages/session-sync-core build
    - pnpm check:sqlite-runtime
  - 本轮结果：已写入 `docs/20260815-阶段验证记录.md`，并通过 core、frontend、Host 定向验证、后台任务回归和 SQLite runtime 检查；生产样本与浏览器 E2E 未做。
  - 对应需求：requirements.md 需求 6、需求 7。
  - 对应设计：design.md §5、§6、§7。

### 最终检查

- [ ] 3.2 最终检查点
  - 状态：IN_REVIEW
  - 这一步到底做什么：按需求逐条核对实现、测试、观测和回退边界，确认没有把前端或 discovery 的不相关任务塞进来。
  - 做完你能看到什么：长 Codex 会话订阅的主线程阻塞得到实质治理，后续接手者能从 Spec 和指标继续维护。
  - 先依赖什么：3.1。
  - 开始前先看：
    - requirements.md
    - design.md
    - tasks.md
    - docs/ 下的性能基线和验收结果。
  - 主要改哪里：本 Spec 的全部相关代码、测试和文档。
  - 这一步先不做什么：不追加新的 provider、不重写客户端消息展示语义。
  - 怎么算完成：
    1. Host 订阅路径不再同步读完整 JSONL。
    2. 正常追加只处理新增字节和固定尾部窗口。
    3. 同源订阅共享 watcher 和 TaskManager 任务。
    4. 工作台只在摘要变化时刷新。
    5. 重连、回收和文件异常都有可信恢复。
  - 怎么验证：
    - 执行 1.1、1.2、2.1、2.2、2.3、3.1 的全部定向验证。
    - 逐条核对 requirements.md 的验收标准。
    - pnpm check:sqlite-runtime。
  - 本轮结果：源码、类型和已列定向测试已核对；由于真实生产 JSONL、跨平台 watcher 和浏览器 E2E 未验证，本 Spec 保持 IN_REVIEW，不能标为 DONE。
  - 对应需求：requirements.md 全部需求。
  - 对应设计：design.md 全文。
