# 需求说明 - spec003.8 跨提供商会话统计

状态：Completed

## 1. 问题

不同 CLI 会把会话统计写在完全不同的位置：Harness 已经提供累计 projection，OpenCode 在自己的 SQLite 中维护累计值，Codex、Claude Code 和 Gemini 只能从追加或重写的日志中归并。现有 `ContextUsageSnapshot` 仅表示当前上下文窗口，复用它会把“累计输入输出”和“本轮 prompt”混在一起，数据一定会错。

费用统计还有一个额外前提：模型名、最终 token 用量和收费路由必须能落到同一笔模型调用。只拿会话当前模型、累计 token 或用户选择意图去乘价格，都会在模型切换、工具循环、订阅账号和代理路由下得出错误金额。

## 2. 目标

为单个会话提供独立的 `ProviderSessionStats`：

1. 每一个已输出指标都有数值、来源、统计语义和水位时间。
2. Harness 直接转发原生累计 projection 作为会话累计统计；逐调用费用仅消费同一会话的原始事件，不从 projection 反推。
3. OpenCode 读取原生 SQLite 的累计统计，不扫消息再求和。
4. Codex、Claude Code、Gemini 根据各自日志格式去重折叠，避免流式更新、重写记录和最终记录重复计数。
5. 前端按可用指标分组显示；不存在的字段完全隐藏，绝不把未知值显示成 `0`。
6. Kimi 在获得稳定 usage 协议或持久化字段前继续不提供统计。
7. 缓存命中率只在 Provider 已确认输入与缓存桶的关系后生成；页面不得用一条通用公式猜分母。
8. 每一笔可计费模型调用都必须同时有稳定调用键、实际模型、最终 usage、收费策略和原始水位；先按模型调用计费，再在 Provider 有可靠 turn 边界时汇总为用户轮次。
9. `costUsd` 必须由既有 `ProviderSessionStats` 的同一次读取和折叠产生。系统不得增加 `readCost`、独立成本 API、第二份日志扫描或平行账本；价格表同步可以作为低频后台任务存在，但不能进入会话读取主链路。
10. OpenCode 已记录的原生成本优先于任何目录价格。其他 Provider 仅在已确认直连收费路由且价格表覆盖全部 token 桶时，才输出目录估算费用。
11. 目录价格必须来自版本固定的本地价格表。运行时只读本地快照，不在每轮会话统计中访问外部价格 URL；机器可读目录（当前为 `models.dev`）只能作为受控的低频同步输入。同步失败时继续使用最近成功快照或内置价格表。
12. 仅统计功能启用后新建的会话。新会话的选中模型命中当前 Provider 的本地价格表时可以自动启用直连收费 profile；模型未命中价格表时仍需显式确认收费路由。旧会话、订阅账号、未知代理、模型缺失、usage 缺失、并发归因不清或价格缺失的调用不输出费用。

## 3. 非目标

- 不重算其他 Provider 的上下文占用；Harness 仅使用原生 projection 中已经给出的上下文压力和窗口上限。
- 不新增费用账本表、独立成本服务或每轮网络价格查询。允许新增一个使用现有 `TaskManager` 的低频价格快照同步任务，以及存放价格快照的普通文件目录；为新会话在既有 `session_bindings` 保存收费策略版本属于会话元数据，不是新账本。
- 不把目录估算伪装成供应商账单；订阅、免费额度、折扣、代理加价和未知路由一律不计算为费用。
- 不从当前选中模型、文本、上下文占用或不完整累计快照猜测每轮 token、模型或费用。
- 不为 Kimi 从消息文本或 wire 日志猜测统计。

## 4. 验收标准

### 4.1 数据契约

1. WHEN Provider 返回一个统计指标 THEN System SHALL 同时返回 `value`、`source`、`semantic`、`watermark`。
2. WHEN Provider 无法确认某指标 THEN System SHALL 省略该指标，不得使用 `0`、`null` 数值或估算值代替。
3. `ProviderSessionStats` SHALL 独立于 `ContextUsageSnapshot`，两个类型、读取接口和前端状态不得复用。
4. WHEN System 输出 `cacheHitRate` THEN 它 SHALL 标明为基于已核验原生统计推导的比例，并继承其原始数据水位。
5. WHEN System 输出 `costUsd` THEN 它 SHALL 同时携带“原生费用”或“目录估算”、价格表版本或原生来源、覆盖范围和原始水位；没有完整覆盖范围时不得输出会话总费用。
6. 费用折叠的原子单位 SHALL 是模型调用。Provider 有显式 `turnId` 或 `(turn, step)` 时系统 SHALL 用它们分组；没有可靠用户轮次边界时，系统只保留调用级归因，不虚构轮次。
7. 新会话 SHALL 在创建时固定收费策略 ID、价格表版本和启用时间。旧会话没有这三项元数据时 SHALL 保持 `costUsd` 缺失。

### 4.2 Provider 行为

1. Harness SHALL 转发原生 session projection 中已有的累计统计及 token usage；该 projection 不得被用于反推逐调用费用。
2. OpenCode SHALL 读取其 session 累计字段，保留其原生累计语义。
3. Codex SHALL 用稳定的累计 usage 记录与事件标识归并，不能把相同累计记录多次相加。
4. Claude Code 与 Legna SHALL 以稳定消息标识折叠 progress 和最终 assistant usage。
5. Gemini SHALL 以消息标识 last-wins 折叠被重写的 token 记录。
6. Kimi SHALL 返回 `null`。
7. Harness、OpenCode、Claude Code 和 Legna SHALL 将未缓存输入、缓存读取和缓存写入作为互不重叠的输入桶；Codex 和 Gemini SHALL 将缓存读取视为总输入的子集。Codex 出现未定义关系的正缓存写入时 SHALL 省略缓存命中率。
8. Harness SHALL 在 history 尾页同时存在 `contextPressure.projectedTokens` 与正数 `contextPressure.contextWindow` 时返回上下文占用；比例 SHALL 使用 `projectedTokens / contextWindow`，并标记为估算值。
9. Harness 未提供当前请求的未缓存或缓存输入桶时 SHALL 省略这些字段；页面不得为了显示上下文占用而伪造 `0`。
10. Claude Code 与 Legna SHALL 从同一条最终 assistant usage 记录读取模型和 token；模型、usage 或收费策略任一缺失时 SHALL 省略该调用费用。
11. Codex SHALL 将 `turn_context` 的模型与累计 token 快照差值关联。新会话的首个快照作为基线；检测到并发 turn、缺基线、缺终态快照或模型切换无法归因时 SHALL 省略相关调用费用。
12. Harness SHALL 从原始 `request/header`、`request/context`、`assistant/chunk`、`assistant/message` 和 `turn/end` 事件折叠 `(turn, step)`。模型字段必须兼容当前 DSH 事件的真实位置：路由配置读取 `data.header.config.model`，assistant 消息读取 `data.message.source.model`，并保留同一条 usage 的 route/model。累计 projection 只能继续服务会话总统计和上下文，不能反推逐轮费用。
13. OpenCode SHALL 保留 session 表中的原生成本，不得重新按目录价格相加；其逐调用模型和 token 仅用于审计和覆盖校验。
14. Gemini SHALL 在同一条消息 ID 的 last-wins 折叠中同时保留最终 model 与 tokens；最终记录未同时提供两者时 SHALL 省略该调用费用。
15. Kimi SHALL 继续返回 `null`，直至有稳定的实际模型和 usage 持久化协议。

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
15. `costUsd` SHALL 继续在既有会话统计详情中显示；页面不得新增独立费用入口、费用页面或每轮费用列表的常驻载荷。
16. WHEN `costUsd` 缺失 THEN 页面 SHALL 隐藏费用行；不得显示 `0 USD`、未定价小计或“按当前模型估算”的误导性文字。
17. WHEN 用户打开价格表 THEN 页面 SHALL 使用表格列出提供商、模型、输入、输出、缓存读取和缓存写入价格；价格表 SHALL 标明版本、来源和抓取时间（如有）。
18. 价格快照默认按周生成，同一周的版本不得覆盖；已绑定旧版本的会话 SHALL 继续使用原版本，不得因后续同步改变历史金额。

## 5. 兼容性与成功定义

- 旧 Provider 或旧会话读取失败时，现有会话运行、历史加载、上下文占用和发送功能保持不变。
- 任一单独统计读取失败只能使 `sessionStats` 为 `null`，不能让 runtime 接口整体失败。
- 测试证明各 Provider 的重复日志不会导致累计值翻倍，且前端不会渲染缺失字段。
- 费用计算不得增加一次 Provider 读取。runtime 请求仍只调用既有 `getSessionStats()`；新增的模型归因、定价和总价在这次读取内部完成。
- 价格表更新不得改变已固定收费策略的新会话历史金额；升级前没有收费策略的旧会话仍不回填费用。
- `models.dev` 不可访问、返回格式变化或没有匹配模型时，价格同步任务 SHALL 失败并保留旧快照；不能清空当前可用价格表。
