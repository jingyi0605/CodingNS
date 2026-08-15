# 设计说明 - spec003.8 跨提供商会话统计

状态：Completed

## 1. 核心判断

✅ 值得做：原生 CLI 已经保存了真实统计，只是格式不同。把它们塞进 `ContextUsageSnapshot` 是错误的数据结构，会把会话累计值伪装成当前上下文。

### 关键洞察

- 数据结构：`ProviderSessionStats` 是一个稀疏指标字典；缺键就是没有可信数据。
- 复杂度：统一数据壳，Provider 内保留各自最小的读取和去重规则，不建立一套跨 Provider 的猜测器。
- 风险点：流式事件、append-only JSONL 和重写日志都可能重复 usage；只要没有稳定去重键就不能累加。

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
  | "derived-ratio";

interface ProviderSessionStatValue {
  value: number;
  source: ProviderSessionStatSource;
  semantic: ProviderSessionStatSemantic;
  watermark: ProviderSessionStatWatermark;
}

interface ProviderSessionStats {
  capturedAt: string;
  metrics: Partial<Record<ProviderSessionStatMetric, ProviderSessionStatValue>>;
}
```

`ProviderSessionStatMetric` 是固定枚举，覆盖 tokens、成本、轮次、步骤及耗时。`cacheHitRate` 是唯一允许由 CodingNS 推导的指标：它的来源标为 `derived-provider-metrics`、语义标为 `derived-ratio`，且只从同一 Provider 已核验的原生 token 桶计算。`metrics` 保持稀疏：字段不可信或未出现时不写入。

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
| 成本 | `costUsd` | Provider 原生累计美元费用 |

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

所有统计读取均在既有 runtime 请求中执行，没有轮询器、写库或持久化缓存。统计读取异常在 runtime service 处降级为 `null`，与现有 context usage 一致。

## 4. Provider 读取规则

| Provider | 原始数据 | 算法 | 缓存命中率 |
| --- | --- | --- | --- |
| Harness | `session/projection` 或 history 尾页 projection | 直接转发最新 projection | `cacheRead / (uncachedInput + cacheRead + cacheWrite)`；三个桶缺任一项就隐藏 |
| OpenCode | 原生 session SQLite 累计列 | 直接读取单行 | `cacheRead / (input + cacheRead + cacheWrite)`；原生 session 表使用独立桶 |
| Codex | JSONL `token_count.total_token_usage` | 使用最新累计快照，不累加相同/递增快照 | `cachedInput / input`；`cachedInput` 是 `input` 子集，出现正 `cache_write_tokens` 时隐藏 |
| Claude Code / Legna | assistant progress、最终 assistant usage | 按稳定消息 ID last-wins 后求和 | `cacheRead / (input + cacheWrite + cacheRead)` |
| Gemini | Gemini 消息 `tokens` | 按消息 ID last-wins 后求和 | `cached / input`；Gemini 的 prompt token 总数包含 cached content |
| Kimi | 无稳定 usage 协议 | 返回 `null` | 不显示 |

Codex 的 total usage 仅输出其当前 fixture 已确认的字段。没有字段时不补算。

Harness 的上下文占用不从累计 `tokenUsage` 反推。它读取同一份 history 尾页 projection 的 `contextPressure`：`projectedTokens` 是原生 token-meter 从最近 provider usage 锚点推进到下一次请求的压力，`contextWindow` 是原生路由记录的窗口上限。两者齐全才返回上下文圆环，比例为 `projectedTokens / contextWindow`，并标记为估算值。当前请求的缓存桶不在该 projection 中时，`ContextUsageSnapshot` 的对应字段保持缺失；不能把累计桶、未缓存输入或 `0` 冒充当前请求拆分。

## 5. 前端

`SessionRuntimeDto` 与 runtime store 增加 `sessionStats: ProviderSessionStatsDto | null`。页面只将该值透传给 Composer。统计入口沿用 Composer 的紧凑信息区，但只有存在至少一个可展示字段时才渲染触发器和弹层。

展示按以下固定顺序排列：Token、运行、耗时、成本。所有实际存在的 metrics 收敛为一个有序列表，再铺入同一个连续双列网格；不再渲染“会话活动”“耗时”等内部组标题。格式化时接受 `number`，从不为未知字段创建默认值。Token 相关指标只显示 Provider 已生成的 `cacheHitRate`，不根据 `inputTokens`、`cacheReadTokens` 或 `cacheWriteTokens` 在前端重算；缺少该指标就隐藏比例。

桌面端默认把轮数、输入和输出放在输入区的横向摘要中，紧凑数字不再附加 `tok`。上下文占用圆环位于摘要左侧；有 `cacheHitRate` 时，在它右侧显示独立的缓存命中率圆环，两个圆环都能打开同一份详情。缓存率不写入摘要文字，小于 40% 为红色，40% 至小于 80% 为黄色，80% 至小于 90% 为浅绿色，90% 及以上为深绿色。圆环中的百分比数字必须居中。没有该字段时缓存圆环完全隐藏，不能用空圈或 0% 代替。Harness 上下文只有压力和上限时，圆环与已用/上限照常显示，缓存输入明细保持隐藏。移动端继续只显示一个上下文入口，避免挤压输入区。

详情弹层按从当前状态到历史累计的顺序排：上下文区显示彩色百分比、已用/上限和进度条，不重复显示数据来源、缓存明细或估算标签；缓存率区显示由红、黄、浅绿到深绿连续过渡的色轴、0、40、80、90、100 刻度，以及落在实际百分比位置的针形指示器。指针直接复用当前缓存率档位的颜色变量，并保留底板轮廓以保证在同色刻度段内可见。40/80/90 仍是状态分类阈值，渐变只负责让读数过渡自然。会话统计使用连续的紧凑双列网格，数值按指标类型着色，且不显示内部组标题、来源、语义或水位标签，避免压过实际数字；统计契约仍保留这些字段供接口和后续详情使用。弹层根据入口上方和下方的真实可用高度定位；选择上方时以入口为下边界自然向上扩展，只有屏幕本身放不下时保留可滚动访问。详情只通过点击打开或关闭，鼠标离开不关闭。

## 6. 测试策略

- core：Harness projection、OpenCode 原生累计、Codex 递增快照、Claude/Legna progress/最终重复、Gemini 重写消息、Kimi 空值，以及每种缓存率分母。
- Host：runtime 成功透传，统计读取异常不影响 runtime 响应。
- user-app：只有存在 metrics 才显示入口；缺 token、成本或耗时不渲染该行；`0` 只有 Provider 明确返回 `0` 时才能显示。
- 运行 `pnpm test:related -- <改动文件>` 和 `pnpm check:sqlite-runtime`。

## 7. 破坏性分析

- 不改变已有 Provider 的 `contextUsage` 数值语义；仅允许其输入桶字段在 Provider 无法验证时缺失，前端按可用性隐藏明细。
- 不改变 Provider 发送、订阅、历史同步或数据库 schema。
- 新字段允许为 `null`，旧 Host 或旧 Provider 不提供数据时前端自然隐藏，保证向后兼容。
- 缓存率从前端通用推算改为 Provider 端显式生成；未确认的字段组合只会少显示一项，不会把错误比例暴露给用户。
