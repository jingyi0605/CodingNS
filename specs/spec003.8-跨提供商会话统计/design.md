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
type ProviderSessionStatSource = "provider-projection" | "provider-session-store" | "provider-history-log";
type ProviderSessionStatSemantic = "cumulative" | "sum-of-final-events" | "latest-snapshot";

interface ProviderSessionStatValue {
  value: number;
  source: ProviderSessionStatSource;
  semantic: ProviderSessionStatSemantic;
  watermark: string;
}

interface ProviderSessionStats {
  capturedAt: string;
  metrics: Partial<Record<ProviderSessionStatMetric, ProviderSessionStatValue>>;
}
```

`ProviderSessionStatMetric` 是固定枚举，覆盖 tokens、成本、轮次、步骤及耗时。`metrics` 保持稀疏：字段不可信或未出现时不写入。

每个字段的含义如下：

| 分组 | 指标 | 语义 |
| --- | --- | --- |
| Token | `inputTokens`、`outputTokens`、`reasoningTokens` | Provider 给出的会话累计值或去重后最终消息之和 |
| Token | `cacheReadTokens`、`cacheWriteTokens` | Provider 明确区分的缓存 token |
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

| Provider | 原始数据 | 算法 | 字段语义 |
| --- | --- | --- | --- |
| Harness | `session/projection` 或 history 尾页 projection | 直接转发最新 projection | `cumulative`，`provider-projection` |
| OpenCode | 原生 session SQLite 累计列 | 直接读取单行 | `cumulative`，`provider-session-store` |
| Codex | JSONL `token_count.total_token_usage` | 使用每个累计快照的最大值，不累加相同/递增快照 | `latest-snapshot`，`provider-history-log` |
| Claude Code / Legna | assistant progress、最终 assistant usage | 按稳定消息 ID last-wins 后求和 | `sum-of-final-events`，`provider-history-log` |
| Gemini | Gemini 消息 `tokens` | 按消息 ID last-wins 后求和 | `sum-of-final-events`，`provider-history-log` |
| Kimi | 无稳定 usage 协议 | 返回 `null` | 无 |

Codex 的 total usage 仅输出其当前 fixture 已确认的字段。没有字段时不补算。

## 5. 前端

`SessionRuntimeDto` 与 runtime store 增加 `sessionStats: ProviderSessionStatsDto | null`。页面只将该值透传给 Composer。统计入口沿用 Composer 的紧凑信息区，但只有存在至少一个可展示字段时才渲染触发器和弹层。

展示按以下顺序分组：Token、运行、耗时、成本。分组内只迭代实际存在的 metrics；格式化时接受 `number`，从不为未知字段创建默认值。Token 分组在同时拿到输入和缓存读取量且总量大于 0 时，额外显示由 `cacheReadTokens / (inputTokens + cacheReadTokens)` 得出的缓存命中率；缺任一分量就隐藏该比例。

桌面端默认把轮数、输入 token、输出 token 和缓存命中率放在输入区的横向摘要中，其余统计由省略按钮打开。移动端只保留一个统计入口图标。详情弹层只响应点击、再次点击和 Escape/外部点击，不响应鼠标离开。

## 6. 测试策略

- core：Harness projection、OpenCode 原生累计、Codex 递增快照、Claude progress/最终重复、Gemini 重写消息、Kimi 空值。
- Host：runtime 成功透传，统计读取异常不影响 runtime 响应。
- user-app：只有存在 metrics 才显示入口；缺 token、成本或耗时不渲染该行；`0` 只有 Provider 明确返回 `0` 时才能显示。
- 运行 `pnpm test:related -- <改动文件>` 和 `pnpm check:sqlite-runtime`。

## 7. 破坏性分析

- 不更改现有 `contextUsage` 字段、其上下文环或 API 语义。
- 不改变 Provider 发送、订阅、历史同步或数据库 schema。
- 新字段允许为 `null`，旧 Host 或旧 Provider 不提供数据时前端自然隐藏，保证向后兼容。
