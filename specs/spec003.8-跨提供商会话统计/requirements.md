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
7. 缓存命中率只在 Provider 已确认输入与缓存桶的关系后生成；页面不得用一条通用公式猜分母。

## 3. 非目标

- 不重算其他 Provider 的上下文占用；Harness 仅使用原生 projection 中已经给出的上下文压力和窗口上限。
- 不新增数据库表、缓存、轮询器、后台任务或独立订阅。
- 不臆测费用、上下文窗口、token 类型或没有原生来源的耗时。
- 不为 Kimi 从消息文本或 wire 日志猜测统计。

## 4. 验收标准

### 4.1 数据契约

1. WHEN Provider 返回一个统计指标 THEN System SHALL 同时返回 `value`、`source`、`semantic`、`watermark`。
2. WHEN Provider 无法确认某指标 THEN System SHALL 省略该指标，不得使用 `0`、`null` 数值或估算值代替。
3. `ProviderSessionStats` SHALL 独立于 `ContextUsageSnapshot`，两个类型、读取接口和前端状态不得复用。
4. WHEN System 输出 `cacheHitRate` THEN 它 SHALL 标明为基于已核验原生统计推导的比例，并继承其原始数据水位。

### 4.2 Provider 行为

1. Harness SHALL 转发原生 session projection 中已有的统计及 token usage。
2. OpenCode SHALL 读取其 session 累计字段，保留其原生累计语义。
3. Codex SHALL 用稳定的累计 usage 记录与事件标识归并，不能把相同累计记录多次相加。
4. Claude Code 与 Legna SHALL 以稳定消息标识折叠 progress 和最终 assistant usage。
5. Gemini SHALL 以消息标识 last-wins 折叠被重写的 token 记录。
6. Kimi SHALL 返回 `null`。
7. Harness、OpenCode、Claude Code 和 Legna SHALL 将未缓存输入、缓存读取和缓存写入作为互不重叠的输入桶；Codex 和 Gemini SHALL 将缓存读取视为总输入的子集。Codex 出现未定义关系的正缓存写入时 SHALL 省略缓存命中率。
8. Harness SHALL 在 history 尾页同时存在 `contextPressure.projectedTokens` 与正数 `contextPressure.contextWindow` 时返回上下文占用；比例 SHALL 使用 `projectedTokens / contextWindow`，并标记为估算值。
9. Harness 未提供当前请求的未缓存或缓存输入桶时 SHALL 省略这些字段；页面不得为了显示上下文占用而伪造 `0`。

### 4.3 页面显示

1. WHEN 统计存在 THEN 页面 SHALL 仅显示具有至少一个可用字段的指标，并按固定顺序铺入连续的紧凑网格。
2. WHEN 一个字段不存在 THEN 页面 SHALL 隐藏该字段及其标签。
3. WHEN 整个 Provider 未提供统计 THEN 页面 SHALL 不新增“0 token”“0 成本”或不可用占位卡片。
4. 在桌面端，页面 SHALL 默认平铺显示轮数、输入 token 和输出 token；缓存命中率不得再占用摘要文字，其余字段通过上下文占用圆环的点击详情查看。
5. 在移动端，页面 SHALL 默认只显示一个统计入口图标，不挤压输入区的横向空间。
6. 统计详情 SHALL 只通过点击入口打开或关闭，鼠标离开入口不得自动关闭。
7. WHEN `cacheHitRate` 缺失 THEN 页面 SHALL 隐藏缓存命中率，即使输入和缓存读取字段同时存在。
8. 会话统计详情 SHALL 由上下文占用圆环或缓存命中率圆环打开，两个入口展示同一份详情，页面不得再渲染独立的会话统计详情按钮。
9. 桌面摘要中的输入和输出 SHALL 使用紧凑数字，不得附加 `tok` 单位。
10. WHEN `cacheHitRate` 存在 THEN 页面 SHALL 在上下文占用圆环右侧渲染独立的缓存命中率圆环；小于 40% 为红色，40% 至小于 80% 为黄色，80% 至小于 90% 为浅绿色，90% 及以上为深绿色。
11. 上下文占用圆环和缓存命中率圆环 SHALL 位于桌面统计摘要左侧；当 `cacheHitRate` 缺失时不得渲染缓存圆环、空圈或伪造的 0%。
12. 详情弹层 SHALL 用进度条显示上下文占用，用带 40、80 和 90 刻度的连续四档渐变进度条显示缓存命中率，并用与当前刻度档位一致的指针标示当前比例的准确位置；会话指标的数值 SHALL 按指标类型着色，默认详情不得重复显示任何指标分组标题、来源、语义和水位标签。
13. WHEN 上下文占用缺少可验证的缓存输入桶 THEN 页面 SHALL 继续显示已用量和上限，但 SHALL 隐藏缓存输入明细、数据来源和估算标签。
14. 统计详情弹层 SHALL 根据入口上方和下方的真实可用高度选择展开方向；上方空间足够时 SHALL 以入口为下边界向上扩展，只有视口本身无法容纳全部内容时才允许内部滚动。

## 5. 兼容性与成功定义

- 旧 Provider 或旧会话读取失败时，现有会话运行、历史加载、上下文占用和发送功能保持不变。
- 任一单独统计读取失败只能使 `sessionStats` 为 `null`，不能让 runtime 接口整体失败。
- 测试证明各 Provider 的重复日志不会导致累计值翻倍，且前端不会渲染缺失字段。
