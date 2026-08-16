# 设计说明 - spec003.8 跨提供商会话统计

状态：Completed

## 1. 核心判断

✅ 值得做：原生 CLI 已经保存了真实统计，只是格式不同。把它们塞进 `ContextUsageSnapshot` 是错误的数据结构，会把会话累计值伪装成当前上下文。费用也必须从同一份已核验 usage 折叠出来，不能另起一套扫描和计费通路。

### 关键洞察

- 数据结构：`ProviderSessionStats` 是一个稀疏指标字典；缺键就是没有可信数据。
- 复杂度：统一数据壳，Provider 内保留各自最小的读取和去重规则；价格计算只消费这些已折叠的调用，不建立第二个读取器。
- 风险点：流式事件、append-only JSONL 和重写日志都可能重复 usage；订阅和代理也可能让公开价格与实际账单无关。没有稳定调用键、模型、收费路由或完整价格时就不计费。

## 2. 数据模型

`packages/session-sync-core` 定义以下独立类型：

```ts
type ProviderSessionStatSource =
  | "provider-projection"
  | "provider-session-store"
  | "provider-history-log"
  | "derived-provider-metrics";
type ProviderSessionStatSemantic =
  | "cumulative"
  | "sum-of-final-events"
  | "latest-snapshot"
  | "derived-ratio"
  | "priced-final-events";

interface ProviderSessionCostProvenance {
  kind: "provider-native" | "catalog-estimate";
  coverage: "complete";
  pricingProfileId?: string;
  priceBookVersion?: string;
  breakdown?: ProviderSessionCostBreakdown[];
  priceBook?: ProviderSessionCostPrice[];
  priceBookSource?: "builtin" | "models.dev";
  priceBookFetchedAt?: string;
  exchangeRate?: ProviderSessionCostExchangeRate;
}

interface ProviderSessionStatValue {
  value: number;
  source: ProviderSessionStatSource;
  semantic: ProviderSessionStatSemantic;
  watermark: ProviderSessionStatWatermark;
  pricing?: ProviderSessionCostProvenance;
}

interface ProviderSessionStats {
  capturedAt: string;
  metrics: Partial<Record<ProviderSessionStatMetric, ProviderSessionStatValue>>;
}
```

`ProviderSessionStatMetric` 是固定枚举，覆盖 tokens、成本、轮次、步骤及耗时。`cacheHitRate` 与目录费用都允许由 CodingNS 推导，但前者只能从同一 Provider 已核验的原生 token 桶计算，后者只能从模型、最终 usage、收费策略和本地价格表同时齐全的调用计算。`metrics` 保持稀疏：字段不可信或未出现时不写入。

每个字段的含义如下：

| 分组 | 指标 | 语义 |
| --- | --- | --- |
| Token | `inputTokens`、`outputTokens`、`reasoningTokens` | Provider 给出的会话累计值或去重后最终消息之和 |
| Token | `cacheReadTokens`、`cacheWriteTokens` | Provider 明确区分的缓存 token |
| Token | `cacheHitRate` | Provider 确认分母后的缓存读取比例；不是前端猜出的统一公式 |
| Token | `toolTokens` | Provider 明确归属到工具的 token |
| 运行 | `turns`、`steps` | Provider 投影或原生 session 定义的轮次、步骤 |
| 耗时 | `llmMs`、`toolMs`、`ttftMs`、`decodeMs` | Provider 提供的累计耗时；不从消息时间戳猜测 |
| 吞吐 | `ttftSteps`、`decodeTokens` | Harness 原生统计中的累计计数 |
| 成本 | `costUsd` | Provider 原生累计美元费用，或覆盖完整调用集合的目录估算 |

`watermark` 是一个带类型的对象，标明它是原始序号、原始时间还是本次读取时间；`capturedAt` 是 CodingNS 本次读取完成的时间。二者不能混用。

## 3. 调用链

```text
ProviderAdapter.readSessionStats
  -> SessionSyncService.readSessionStats
  -> SessionHistoryService.getSessionStats
  -> SessionLiveRuntimeService.getSessionRuntime
  -> SessionRuntimeDto.sessionStats
  -> session-runtime-store
  -> ConversationPage / ComposerPanel
```

所有统计读取均在既有 runtime 请求中执行，没有轮询器、独立成本服务或第二次 Provider 读取。统计读取异常在 runtime service 处降级为 `null`，与现有 context usage 一致。

### 3.1 同一次折叠

每个 adapter 在现有 `readSessionStats()` 读取源数据时，先产生内部 `VerifiedUsageLine`：稳定调用键、可选 turn 键、实际 provider/model、四类 token 桶、终态标记和水位。现有 token 指标、缓存率和 `costUsd` 都从这一次折叠得出。

`VerifiedUsageLine` 不是新的外部接口、数据库表或常驻账本。默认 runtime 只返回会话累计 metrics；将来需要查看逐调用明细时，也只能复用同一份折叠结果按需序列化，不能重新扫日志。

价格计算顺序固定：

1. Provider 已记录原生成本时直接使用，例如 OpenCode。
2. 否则要求新会话已有收费策略、价格表版本、实际模型和完整最终 usage。
3. 以 `(收费路由, model, token 桶)` 查询本地版本化价格表并计算。
4. 任何调用无法定价时，整个会话不输出目录 `costUsd`，避免把部分金额伪装成总费用。

价格表由 `ProviderPriceBookService` 负责维护：它用现有 `TaskManager` 低频读取 `models.dev/api.json`，只提取当前支持模型，按周写入 `data/host/price-book-snapshots/<version>.json`。同一周的快照不可覆盖；网络失败时保留最近成功快照，首次无法同步时回退到随代码发布的内置表。会话统计读取只根据 `session_bindings.price_book_version` 读取本地快照，不访问网络。既有 `session_bindings` 为新会话保存 `billingStartedAt`、`pricingProfileId` 和 `priceBookVersion`，不新建费用账本表。新会话的选中模型命中当前快照时可自动固定 `direct-api`；模型未命中时不猜测价格。旧会话继续使用其已绑定版本，不会被新周价格重算。

## 4. Provider 读取规则

| Provider | 实际模型与 usage 来源 | 费用规则 | 性能边界 |
| --- | --- | --- | --- |
| Harness | 同一次 `session.history` 响应中的原始 `request/header`、`request/context`、`assistant/chunk`、`assistant/message`、`turn/end`；以 `(turn, step)` last-wins | 仅已确认的直连收费路由使用目录估算 | adapter 与累计 projection 共用一次 history 读取；event bridge/history reconcile 只转发原始事件，不新增 sidecar 连接 |
| OpenCode | assistant 行的模型、token、cost；session 表的累计列 | 原生 `cost` 优先，不重算 | 默认只读现有 session 累计行；调用级审计仅复用同一 SQLite 读取结果 |
| Codex | `turn_context.model`、`task_*` 和 `token_count.total_token_usage` | 新会话基线后的累计差值按 turn 归因；仅完整且不并发的 turn 可估算 | 在既有 JSONL 统计读取循环中同时折叠 usage 与模型，不增加第二次扫描 |
| Claude Code / Legna | assistant progress、最终 assistant 的稳定消息 ID、model、usage | 同一消息 ID last-wins；仅已确认收费策略可估算 | 在现有 JSONL 单次折叠中保留 model，不新增读取 |
| Gemini | 同一消息节点的 ID、model、tokens | 最终重写记录同时含 model/tokens 时可估算 | 在现有解析循环中扩展 Map 的值，不新增读取 |
| Kimi | 无稳定实际模型和 usage 协议 | 不计费 | 继续返回 `null` |

Codex 的 total usage 仅输出其当前 fixture 已确认的字段。没有字段时不补算。累计快照没有 `turn_id`，因此只允许在新会话首个 turn 前建立基线、且活动 turn 唯一和终态快照完整时计算差值；任一条件不满足，费用缺失而不是猜测。

Harness 的真实事件中，路由模型位于 `request/header.data.header.config.model`，最终 assistant usage 的模型位于 `assistant/message.data.message.source.model`；解析器必须同时支持这两种位置，并以最后一条同一 `(turn, step)` 的 usage 为准。`assistant/message` 已带 usage 且存在可识别的 `turn/end` 终态时，该调用已封口；终态可以是完成、中断或失败，未知终态不得计费。

Harness 的上下文占用不从累计 `tokenUsage` 反推。它读取同一份 history 尾页 projection 的 `contextPressure`：`projectedTokens` 是原生 token-meter 从最近 provider usage 锚点推进到下一次请求的压力，`contextWindow` 是原生路由记录的窗口上限。两者齐全才返回上下文圆环，比例为 `projectedTokens / contextWindow`，并标记为估算值。当前请求的缓存桶不在该 projection 中时，`ContextUsageSnapshot` 的对应字段保持缺失；不能把累计桶、未缓存输入或 `0` 冒充当前请求拆分。

## 5. 性能与一致性

- `SessionLiveRuntimeService` 仍只调用一次 `getSessionStats()`；费用没有独立 RPC、轮询或订阅。
- 文件型 Provider 在当前统计循环中同时建立 token、模型和价格输入。Codex 利用已有增量缓存，Claude/Legna 与 Gemini 在已有 Map 折叠中增加字段。
- Harness 的 adapter 在一次 `session.history` 响应中折叠调用；event bridge 在已有 mux/host 事件和断线 history reconcile 中保留并转发原始事件，不另开 sidecar 连接。
- OpenCode 的原生累计费用不扫 message/part 求和。只有未来按需展示调用明细时，才从同一个 session 水位下的读取结果取明细，默认 runtime payload 不携带全量列表。
- 每个结果都以原始序号或时间水位去重。重放、刷新、掉线重连和重复 progress 都不得改变已确认调用的金额。
- 价格同步只在 Host 启动或创建新会话时检查是否过期，并通过 `provider.price_book_refresh` 去重执行；它不是每轮会话统计的网络依赖，也不新建独立费用计算通路。

## 6. 前端

`SessionRuntimeDto` 与 runtime store 增加 `sessionStats: ProviderSessionStatsDto | null`。页面只将该值透传给 Composer。统计入口沿用 Composer 的紧凑信息区，但只有存在至少一个可展示字段时才渲染触发器和弹层。费用明细中的价格表使用语义化表格显示提供商、模型和各 token 桶价格，并同时显示快照来源、版本和抓取时间。

展示按以下固定顺序排列：Token、运行、耗时、成本。所有实际存在的 metrics 收敛为一个有序列表，再铺入同一个连续双列网格；不再渲染“会话活动”“耗时”等内部组标题。格式化时接受 `number`，从不为未知字段创建默认值。Token 相关指标只显示 Provider 已生成的 `cacheHitRate`，不根据 `inputTokens`、`cacheReadTokens` 或 `cacheWriteTokens` 在前端重算；缺少该指标就隐藏比例。

桌面端默认把轮数、输入和输出放在输入区的横向摘要中，紧凑数字不再附加 `tok`。上下文占用圆环位于摘要左侧；有 `cacheHitRate` 时，在它右侧显示独立的缓存命中率圆环，两个圆环都能打开同一份详情。缓存率不写入摘要文字，小于 40% 为红色，40% 至小于 80% 为黄色，80% 至小于 90% 为浅绿色，90% 及以上为深绿色。圆环中的百分比数字必须居中。没有该字段时缓存圆环完全隐藏，不能用空圈或 0% 代替。Harness 上下文只有压力和上限时，圆环与已用/上限照常显示，缓存输入明细保持隐藏。移动端继续只显示一个上下文入口，避免挤压输入区。

详情弹层按从当前状态到历史累计的顺序排：上下文区显示彩色百分比、已用/上限和进度条，不重复显示数据来源、缓存明细或估算标签；缓存率区显示由红、黄、浅绿到深绿连续过渡的色轴、0、40、80、90、100 刻度，以及落在实际百分比位置的针形指示器。指针直接复用当前缓存率档位的颜色变量，并保留底板轮廓以保证在同色刻度段内可见。40/80/90 仍是状态分类阈值，渐变只负责让读数过渡自然。会话统计使用连续的紧凑双列网格，数值按指标类型着色，且不显示内部组标题、来源、语义或水位标签，避免压过实际数字；统计契约仍保留这些字段供接口和后续详情使用。弹层根据入口上方和下方的真实可用高度定位；选择上方时以入口为下边界自然向上扩展，只有屏幕本身放不下时保留可滚动访问。详情只通过点击打开或关闭，鼠标离开不关闭。

## 7. 测试策略

- core：保留 Harness projection、OpenCode 原生累计、Codex 递增快照、Claude/Legna progress/最终重复、Gemini 重写消息、Kimi 空值和每种缓存率分母；新增模型切换、重复 usage、缺模型、缺价格、订阅/代理路由、首轮基线、并发 Codex turn、Harness 多 step、价格表版本固定的 fixture。
- Host：runtime 成功透传，统计读取异常不影响 runtime 响应；断言费用不会触发第二次 `readSessionStats`、新轮询或额外 sidecar 订阅。
- Host：价格同步服务覆盖成功写入、按周版本固定、历史版本读取、网络失败保留回退值和 `TaskManager` 任务注册；新会话绑定当前快照版本，旧会话读取原绑定版本。
- user-app：只有存在完整 `costUsd` 才显示费用行；目录估算与原生成本使用现有详情入口；缺 token、成本或耗时不渲染该行，`0` 只有 Provider 明确返回 `0` 时才能显示。
- 运行 `pnpm test:related -- <改动文件>` 和 `pnpm check:sqlite-runtime`。

## 8. 破坏性分析

- 不改变已有 Provider 的 `contextUsage` 数值语义；仅允许其输入桶字段在 Provider 无法验证时缺失，前端按可用性隐藏明细。
- 不改变 Provider 发送、订阅、历史同步；只允许在既有 `session_bindings` 增加可空的收费策略元数据，不创建费用账本表。
- 新字段允许为 `null`，旧 Host、旧会话或旧 Provider 不提供数据时前端自然隐藏，保证向后兼容。
- 缓存率从前端通用推算改为 Provider 端显式生成；未确认的字段组合只会少显示一项，不会把错误比例暴露给用户。
- 目录价格只能表示估算，不得当作订阅、代理或供应商账单。模型、usage、收费路由、价格版本任一不完整时，宁可隐藏费用。
