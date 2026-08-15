# 需求说明 - spec003.8 跨提供商会话统计

状态：Completed

## 1. 问题

不同 CLI 会把会话统计写在完全不同的位置：Harness 已经提供累计 projection，OpenCode 在自己的 SQLite 中维护累计值，Codex、Claude Code 和 Gemini 只能从追加或重写的日志中归并。现有 `ContextUsageSnapshot` 仅表示当前上下文窗口，复用它会把“累计输入输出”和“本轮 prompt”混在一起，数据一定会错。

## 2. 目标

为单个会话提供独立的 `ProviderSessionStats`：

1. 每一个已输出指标都有数值、来源、统计语义和水位时间。
2. Harness 直接转发原生累计 projection，不在 CodingNS 重算。
3. OpenCode 读取原生 SQLite 的累计统计，不扫消息再求和。
4. Codex、Claude Code、Gemini 根据各自日志格式去重折叠，避免流式更新、重写记录和最终记录重复计数。
5. 前端按可用指标分组显示；不存在的字段完全隐藏，绝不把未知值显示成 `0`。
6. Kimi 在获得稳定 usage 协议或持久化字段前继续不提供统计。

## 3. 非目标

- 不改变上下文占用环、上下文窗口来源或模型最大上下文推断。
- 不新增数据库表、缓存、轮询器、后台任务或独立订阅。
- 不臆测费用、上下文窗口、token 类型或没有原生来源的耗时。
- 不为 Kimi 从消息文本或 wire 日志猜测统计。

## 4. 验收标准

### 4.1 数据契约

1. WHEN Provider 返回一个统计指标 THEN System SHALL 同时返回 `value`、`source`、`semantic`、`watermark`。
2. WHEN Provider 无法确认某指标 THEN System SHALL 省略该指标，不得使用 `0`、`null` 数值或估算值代替。
3. `ProviderSessionStats` SHALL 独立于 `ContextUsageSnapshot`，两个类型、读取接口和前端状态不得复用。

### 4.2 Provider 行为

1. Harness SHALL 转发原生 session projection 中已有的统计及 token usage。
2. OpenCode SHALL 读取其 session 累计字段，保留其原生累计语义。
3. Codex SHALL 用稳定的累计 usage 记录与事件标识归并，不能把相同累计记录多次相加。
4. Claude Code 与 Legna SHALL 以稳定消息标识折叠 progress 和最终 assistant usage。
5. Gemini SHALL 以消息标识 last-wins 折叠被重写的 token 记录。
6. Kimi SHALL 返回 `null`。

### 4.3 页面显示

1. WHEN 统计存在 THEN 页面 SHALL 仅显示具有至少一个可用字段的分组。
2. WHEN 一个字段不存在 THEN 页面 SHALL 隐藏该字段及其标签。
3. WHEN 整个 Provider 未提供统计 THEN 页面 SHALL 不新增“0 token”“0 成本”或不可用占位卡片。
4. 在桌面端，页面 SHALL 默认平铺显示轮数、输入 token、输出 token 和可计算的缓存命中率；其余字段通过省略按钮查看。
5. 在移动端，页面 SHALL 默认只显示一个统计入口图标，不挤压输入区的横向空间。
6. 统计详情 SHALL 只通过点击入口打开或关闭，鼠标离开入口不得自动关闭。

## 5. 兼容性与成功定义

- 旧 Provider 或旧会话读取失败时，现有会话运行、历史加载、上下文占用和发送功能保持不变。
- 任一单独统计读取失败只能使 `sessionStats` 为 `null`，不能让 runtime 接口整体失败。
- 测试证明各 Provider 的重复日志不会导致累计值翻倍，且前端不会渲染缺失字段。
