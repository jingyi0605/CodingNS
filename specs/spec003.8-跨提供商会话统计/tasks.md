# 任务清单 - spec003.8 跨提供商会话统计

状态：Completed

## 阶段 1：定义独立统计契约

- [x] 1.1 新建 `ProviderSessionStats` 与读取通路
  - 状态：COMPLETED
  - 这一步做了什么：在 session-sync-core 定义稀疏统计类型，并从 Provider adapter 传到 Host runtime。
  - 做完能看到什么：runtime 响应可以有独立的 `sessionStats`，不会占用 `contextUsage`。
  - 主要修改：`packages/session-sync-core/src/types.ts`、`services.ts`、Host sessions 服务和 runtime DTO。
  - 明确不做：没有新增数据库表、缓存或后台任务。
  - 最小验证：core build、Host build、runtime 集成测试通过。

## 阶段 2：读取各 Provider 原生数据

- [x] 2.1 Harness 和 OpenCode 读取原生累计统计
  - 状态：COMPLETED
  - 这一步做了什么：Harness 转发 projection；OpenCode 读取 session SQLite 累计值，并保留明确的 0 和小数费用。
  - 做完能看到什么：两者不需要按消息重复求和。
  - 主要修改：Harness、OpenCode adapter 及定向 fixture。
  - 明确不做：没有修改原生 CLI 存储。
  - 最小验证：Harness projection 探针、OpenCode adapter 21 项测试通过。

- [x] 2.2 Codex、Claude、Gemini 去重折叠，Kimi 保持关闭
  - 状态：COMPLETED
  - 这一步做了什么：Codex 使用最新累计快照，Claude/Legna 按消息 ID 折叠 progress 与最终消息，Gemini 按消息 ID last-wins，Kimi 显式返回 `null`。
  - 做完能看到什么：重放、progress 和重写记录不会翻倍。
  - 主要修改：Codex、Claude、Legna、Gemini、Kimi adapter 及测试。
  - 明确不做：没有从不稳定文本猜 usage。
  - 最小验证：Codex、Claude、Gemini、Kimi、OpenCode 定向 Node 测试共 107 项通过；Harness projection 使用独立 Node 探针验证。

## 阶段 3：显示与验证

- [x] 3.1 前端按可用字段显示统计
  - 状态：COMPLETED
  - 这一步做了什么：把 runtime 统计透传到 Composer；桌面端显示轮数、输入、输出、缓存命中率横向摘要，移动端只显示一个入口图标，详情通过点击省略按钮打开。
  - 做完能看到什么：缺字段不显示，Provider 明确的 0 仍显示为 0，鼠标离开不会关闭详情。
  - 主要修改：`apps/user-app/src/features/conversation/` 的 API、store、页面、Composer、i18n 和样式。
  - 明确不做：没有为 Kimi 或未知字段显示占位。
  - 最小验证：ComposerPanel 53 项测试、user-app build 通过。

- [x] 3.2 最小验证和回写
  - 状态：COMPLETED
  - 这一步做了什么：运行本轮直接相关的构建和 Provider/Composer 定向测试，并回写实际边界。
  - 已通过：`pnpm --dir packages/session-sync-core build`、`node --test packages/session-sync-core/tests/opencode-adapter.test.mjs`、`pnpm --dir apps/user-app test -- run src/features/conversation/components/ComposerPanel.test.tsx`、`pnpm --dir apps/user-app build`、`pnpm check:sqlite-runtime`、`git diff --check`。
  - 边界：`pnpm test:related` 在内部 120 秒限制内超时，不能宣称聚合测试通过；runtime store 全套测试当前还有 14 项 realtime/request 断言失败，未将其误报为通过；未启动开发服务器或浏览器 E2E。

## 阶段 4：修正跨 Provider 缓存命中率

- [x] 4.1 逐个核验缓存率分母并由 Provider 生成比例
  - 状态：COMPLETED
  - 这一步做了什么：停止在前端使用 `cacheRead / (input + cacheRead)` 的通用公式。Harness、OpenCode、Claude Code 和 Legna 使用三类原生输入桶；Codex、Gemini 使用“缓存读取是总输入子集”的口径；Kimi 继续不提供统计。
  - 做完能看到什么：Codex 截图中的 `408,639,373 / 460,969,281` 显示为约 `88.6%`，而不是错误的 `47.0%`。缺少核验结果时页面不显示缓存率。
  - 主要修改：`packages/session-sync-core/src/session-stats.ts`、各 Provider adapter、Composer、DTO 和 i18n。
  - 明确不做：不修改原生 CLI 数据，不从缺失字段、文本或费用反推 token。
  - 最小验证：核心构建通过；Codex、OpenCode、Claude、Legna、Gemini、Kimi 定向 Node 测试 `111/111` 通过；Harness `16/16`、Composer `55/55` 通过；Host 与 user-app build、SQLite runtime 检查通过。

## 阶段 5：合并会话统计详情入口

- [x] 5.1 将统计详情并入上下文占用圆环
  - 状态：COMPLETED
  - 这一步做了什么：移除独立的统计省略按钮，把原有统计分组放入上下文圆环的点击弹层；桌面摘要继续显示，但输入和输出数字不再带 `tok`。
  - 做完能看到什么：点击圆环可同时查看上下文占用与会话统计。移动端不再额外占用一个统计按钮；没有上下文数据时圆环仍可作为统计入口。
  - 主要修改：`apps/user-app/src/features/conversation/components/ComposerPanel.tsx`、`ComposerPanel.test.tsx`、`apps/user-app/src/app/styles.css` 与 i18n。
  - 明确不做：不改变 Provider 统计读取、缓存命中率或上下文计算。
  - 最小验证：ComposerPanel 定向测试 `56/56` 通过，user-app build 通过，`git diff --check` 通过。

## 阶段 6：精简桌面摘要并显示缓存率圆环

- [x] 6.1 将缓存命中率从摘要移到上下文圆环
  - 状态：COMPLETED
  - 这一步做了什么：把上下文圆环移到桌面统计摘要左侧，摘要只保留轮数、输入和输出；有 Provider `cacheHitRate` 时在圆环内侧显示第二圈。
  - 做完能看到什么：缓存率低于 80% 显示黄色，80% 至低于 90% 显示浅绿色，90% 及以上显示深绿色；没有缓存率时不会出现空的第二圈或 0%。
  - 主要修改：`apps/user-app/src/features/conversation/components/ComposerPanel.tsx`、`ComposerPanel.test.tsx` 与 `apps/user-app/src/app/styles.css`。
  - 明确不做：不修改任何 Provider 的缓存率计算、上下文占用计算或详情弹层内容。
  - 最小验证：ComposerPanel 定向测试 `60/60` 通过，user-app build 通过，`git diff --check` 通过。

## 阶段 7：拆分圆环并重排统计详情

- [x] 7.1 用独立圆环和可视化详情表达统计
  - 状态：COMPLETED
  - 这一步做了什么：把缓存率从上下文圆环内层拆成右侧独立圆环；两个圆环都能打开同一份详情。详情改为上下文进度条、缓存率刻度和按类型着色的指标网格。
  - 做完能看到什么：上下文和缓存率不再挤在一个圆环里；缓存率有 80、90 阈值刻度；重复的数据来源、语义和更新时间不再在每一行重复显示。
  - 主要修改：`apps/user-app/src/features/conversation/components/ComposerPanel.tsx`、`ComposerPanel.test.tsx`、`apps/user-app/src/app/styles.css` 与 i18n。
  - 明确不做：不修改 Provider 统计读取、缓存率算法、上下文计算或移动端单入口规则。
  - 最小验证：ComposerPanel 定向测试 `60/60` 通过，user-app build 通过，`git diff --check` 通过。

## 阶段 8：细化缓存率刻度和指标层级

- [x] 8.1 补齐四档缓存率颜色并移除冗余标签
  - 状态：COMPLETED
  - 这一步做了什么：缓存率刻度改为红、黄、浅绿、深绿四档渐变，增加 40% 阈值；圆环数字改为居中；默认 Token 分组不再显示标题和来源标签。
  - 做完能看到什么：低缓存率会明确显示红色，40/80/90/100 刻度可读；两个圆环的百分比在视觉中心；会话统计首先呈现输入、输出、推理等数字。
  - 主要修改：`apps/user-app/src/features/conversation/components/ComposerPanel.tsx`、`ComposerPanel.test.tsx`、`apps/user-app/src/app/styles.css` 与 Spec。
  - 明确不做：不修改 Provider 统计读取、缓存率算法、上下文计算或移动端单入口规则。
  - 最小验证：ComposerPanel 定向测试 `62/62` 通过，user-app build 通过，`git diff --check` 通过。

## 阶段 9：明确缓存率色轴读数

- [x] 9.1 使用连续渐变并标出当前缓存率
  - 状态：COMPLETED
  - 这一步做了什么：将原本接近硬切换的四档色轴改为连续渐变，并在缓存率的准确位置加入随当前色档变化、带轮廓的针形指示器。
  - 做完能看到什么：色轴从红、黄、浅绿到深绿自然过渡，用户可直接看出当前数值落在哪个位置，指针颜色也与该档位一致。
  - 主要修改：`apps/user-app/src/features/conversation/components/ComposerPanel.tsx`、`ComposerPanel.test.tsx`、`apps/user-app/src/app/styles.css` 与 Spec。
  - 明确不做：不修改 Provider 统计读取、缓存率算法、上下文计算或移动端单入口规则。
  - 最小验证：ComposerPanel 定向测试 `62/62` 通过，user-app build 通过，`git diff --check` 通过。

## 阶段 10：接入 Harness 原生上下文占用

- [x] 10.1 读取 contextPressure 并接入现有圆环
  - 状态：COMPLETED
  - 这一步做了什么：Harness adapter 从 history 尾页 projection 读取 `contextPressure.projectedTokens` 和 `contextWindow`，直接交给既有 `contextUsage` runtime 通路；当前输入缓存桶没有原生拆分时保持缺失。
  - 做完能看到什么：具备原生压力和窗口上限的 Harness 会话会显示上下文圆环、进度条、已用量和上限；没有这两个字段的会话继续隐藏，缓存明细也不会出现伪造的 0。
  - 主要修改：`packages/session-sync-core/src/providers/deepseek-harness.ts`、上下文 DTO、Composer 与对应测试。
  - 明确不做：不从累计 token、文本或旧会话状态反推当前请求的缓存桶，不改其他 Provider 的上下文计算。
  - 最小验证：核心包构建通过；Harness adapter 测试 `19/19`、ComposerPanel 定向测试 `63/63`、Host 类型检查、user-app build 和 `git diff --check` 均通过。

## 阶段 11：压缩统计详情并按视口自适应展开

- [x] 11.1 移除冗余上下文标签和统计组标题
  - 状态：COMPLETED
  - 这一步做了什么：删除上下文占用中的来源、估算和缓存明细标签；把原本的 Token、会话活动、耗时、费用分组收敛为一个固定顺序的指标列表，只保留“会话统计”总标题。
  - 做完能看到什么：详情不再显示“会话活动”“耗时”等内部标题，指标以连续双列键值行呈现，缺失字段仍保持隐藏。
  - 主要修改：`apps/user-app/src/features/conversation/components/ComposerPanel.tsx`、`ComposerPanel.test.tsx`、i18n 与 `apps/user-app/src/app/styles.css`。
  - 明确不做：不改变 Provider 统计、缓存命中率算法或 Harness 上下文数据的读取语义。
  - 最小验证：ComposerPanel 定向测试覆盖无来源标签和无分组标题场景。

- [x] 11.2 按入口可用高度定位详情弹层
  - 状态：COMPLETED
  - 这一步做了什么：弹层根据入口上方和下方的真实可用高度选择位置，并将该高度写入 `maxHeight`；上方定位时以入口为下边界向上扩展。屏幕本身不足时保留可滚动访问。
  - 做完能看到什么：常规桌面窗口不再被固定 `520px` 高度裁切，窗口过矮时内容仍能滚动查看。
  - 主要修改：`apps/user-app/src/features/conversation/components/ComposerPanel.tsx`、`ComposerPanel.test.tsx` 与 `apps/user-app/src/app/styles.css`。
  - 明确不做：不启动开发服务器，不新增页面、后台任务或持久化数据。
  - 最小验证：ComposerPanel 定向测试 `64/64`、`pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`、`pnpm --dir apps/user-app exec vite build` 和 `git diff --check` 通过；未启动开发服务器或进行浏览器截图验证。

## 阶段 12：模型归因与费用统计

- [x] 12.1 扩展会话统计契约和新会话收费策略
  - 状态：COMPLETED
  - 这一步做什么：在既有 `ProviderSessionStats` 中定义目录费用的语义、来源和价格版本元数据；为新建 session binding 固定收费策略 ID、价格表版本和启用时间。
  - 做完以后能看到什么：新会话可以区分原生成本和目录估算；旧会话没有收费策略，因此费用字段自然缺失。
  - 依赖什么：阶段 1 的统计契约和现有 `session_bindings` 创建流程。
  - 主要修改：`packages/session-sync-core/src/types.ts`、`session-pricing.ts`、Host `session_bindings` schema/migration/repository、runtime DTO 与 user-app API 类型。
  - 这一步明确不做什么：不新建费用账本表，不回填旧会话，不在运行时下载价格表。
  - 最小验证：`session-billing.test.ts` 通过 2 项；新数据库能保存收费起点/profile/价格表版本，旧数据库迁移后的收费字段保持为空。

- [x] 12.2 在同一次统计折叠中计算目录费用
  - 状态：COMPLETED
  - 这一步做什么：在 `session-stats.ts` 定义内部模型调用 usage 行和本地版本化价格表折叠器；token、缓存率和费用由同一次 Provider 读取产出。
  - 做完以后能看到什么：没有 `readCost`，一次 `readSessionStats()` 即可给出完整覆盖时的 `costUsd`。
  - 依赖什么：12.1 的收费策略和价格表版本契约。
  - 主要修改：`packages/session-sync-core/src/session-pricing.ts`、`session-stats.ts` 与各 adapter 的既有 `readSessionStats()`。
  - 这一步明确不做什么：不创建轮询、后台任务、独立订阅、外部 HTTP 查价或第二次扫描源日志。
  - 最小验证：价格折叠测试 6 项和 core 费用测试 6 项通过；覆盖输入/输出/缓存桶、profile/版本不匹配、缺模型或未完成 usage 时隐藏费用；runtime 单次读取测试通过。

- [x] 12.3 补齐 Claude、Legna、Codex、Gemini 和 OpenCode 的调用归因
  - 状态：COMPLETED
  - 这一步做什么：在现有 usage 去重逻辑中保留实际模型和调用键；Codex 对新会话累计快照建立基线并按 turn 差值归因；OpenCode 保持原生成本优先。
  - 做完以后能看到什么：具备完整模型、usage 和收费策略的调用能进入同一统计折叠；订阅、代理、并发 Codex turn 或字段缺失时费用隐藏。
  - 依赖什么：12.2 的统一折叠器。
  - 主要改哪些文件：`claude-code.ts`、`legna-code.ts`、`codex.ts`、`gemini.ts`、`opencode.ts` 及各自 fixture 测试。
  - 这一步明确不做什么：不按当前选中模型回填历史，不把 OpenCode 原生 `cost` 重算成目录价格，不为 Kimi 增加猜测逻辑。
  - 最小验证：Claude、Legna、Codex、Gemini、OpenCode 定向回归共 107 项通过；新增费用 fixture 覆盖最终消息 last-wins、Codex 基线/模型/终态与并发 turn、Gemini 重写、OpenCode 原生 cost 优先。

- [x] 12.4 补齐 DeepSeek Harness 的原始事件归因
  - 状态：COMPLETED
  - 这一步做什么：让现有 Harness adapter 和 event bridge 保留原始 route、`(turn, step)`、usage 与 `turn/end`，在已有 mux/history reconcile 中折叠费用输入。
  - 做完以后能看到什么：Harness 不再只靠累计 projection；每个完成 step 能带真实模型和最终 token 参与统计，多个 step 正确汇总到同一 turn。
  - 依赖什么：12.2 的统一折叠器，以及当前 Harness sidecar 协议版本固定。
  - 主要改哪些文件：`packages/session-sync-core/src/providers/deepseek-harness.ts`、Host 的 `deepseek-harness-event-bridge.ts`、provider adapter 和定向 fake-server fixture。
  - 这一步明确不做什么：不从 projection 反推逐轮 token，不新增 sidecar、mux 订阅或后台扫描。
  - 最小验证：Harness core 定向测试 19 项、Host Web API/bridge 集成测试 13 项通过；同一次 history 响应折叠 `(turn, step)`、模型、最终 usage 和 `turn/end`，bridge 在已有 mux/history 水位转发原始事件，不新增订阅。

- [x] 12.5 复用现有 runtime 与统计详情展示费用
  - 状态：COMPLETED
  - 这一步做什么：将新增费用来源元数据透传到既有 `sessionStats` DTO；继续在 Composer 的会话统计详情中显示 `costUsd`，只在完整可用时渲染。
  - 做完以后能看到什么：页面没有新入口、没有常驻逐轮费用列表；原生成本和目录估算都通过现有统计详情查看，缺失时完全隐藏。
  - 依赖什么：12.1 至 12.4 至少有一个 Provider 能稳定输出费用。
  - 主要改哪些文件：Host runtime DTO、`apps/user-app/src/features/conversation/api/conversation-api.ts`、`ComposerPanel.tsx`、i18n 与对应测试。
  - 这一步明确不做什么：不创建费用页面、独立接口或每次 runtime 返回全量调用账本。
  - 最小验证：Host runtime 定向测试 74 项、ComposerPanel 定向测试 67 项通过；原生费用和目录估算均复用现有详情入口，缺少 `costUsd` 时费用行隐藏。

- [x] 12.6 进行最小必要回归和性能验证
  - 状态：COMPLETED
  - 这一步做什么：运行本次变更直接相关的 core、Host、user-app 测试，并证明费用计算没有额外 Provider 读取、轮询或订阅。
  - 做完以后能看到什么：每个可支持 Provider 的费用边界有 fixture 覆盖，Kimi 与未知收费路由明确不计费。
  - 依赖什么：12.1 至 12.5。
  - 主要改哪些文件：测试文件、必要的 fixture 和本任务状态。
  - 这一步明确不做什么：不把全量测试当默认验证，不启动开发服务器，不把未验证的真实供应商账单写成通过。
  - 最小验证：`pnpm --dir packages/session-sync-core build`、Provider 定向回归 107 项、费用/Harness core 30 项、Host binding/runtime/SQLite/bridge 定向测试（2 + 74 + 22 + 13 项）、ComposerPanel 67 项、Host `tsc --noEmit -p tsconfig.json`、user-app `tsc --noEmit -p tsconfig.json`、`pnpm check:sqlite-runtime` 和 `git diff --check` 均通过。未启动开发服务器，未做浏览器 E2E 或真实 Provider 账单核对。

- [x] 12.7 修复真实 Harness 事件中的模型归因
  - 状态：COMPLETED
  - 这一步做了什么：根据 DSH `0.1.0-rc.5` 的真实 history 形状读取 `request/header.data.header.config.model` 和 `assistant/message.data.message.source.model`；usage 只有在同一 turn 存在可识别 `turn/end` 终态时才进入费用折叠，中断/失败但已有最终 usage 的调用仍保留实际用量。
  - 做完以后能看到什么：启用收费策略的新 Harness 会话不会因为模型藏在 `message.source` 而丢失费用；没有模型、usage 或终态的调用仍然隐藏总费用。
  - 依赖什么：12.2、12.4 的既有费用折叠和 Harness history 读取。
  - 主要修改：`packages/session-sync-core/src/providers/deepseek-harness.ts`、`packages/session-sync-core/tests/session-provider-cost.test.mjs`。
  - 这一步明确不做什么：不回填旧会话收费元数据，不修改全局安装产物，不新增 Provider 读取或费用接口。
  - 最小验证：session-sync-core 编译通过；真实事件形状费用回归 7 项通过；回放当前 Harness history 能输出目录估算费用；未启动开发服务器。

- [x] 12.8 为价格表命中的新会话启用默认收费策略
  - 状态：COMPLETED
  - 这一步做了什么：当新会话的选中模型（允许带 provider 前缀或代理路由前缀）能命中当前 Provider 的本地价格表时，在既有 `session_bindings` 中固定 `direct-api`、启用时间和价格表版本；未知模型仍不自动打开目录估算。
  - 做完以后能看到什么：只要模型名称有明确价格表条目，新会话就能进入现有费用折叠；费用仍只在同一次 `readSessionStats()` 里生成。
  - 依赖什么：12.1、12.2、12.4、12.7，以及新会话已有的 selected model 和价格表匹配。
  - 主要修改：`packages/session-sync-core/src/session-pricing.ts`、`apps/host/src/modules/sessions/session-live-runtime-service.ts` 与对应 Host 测试。
  - 这一步明确不做什么：不回填当前已存在的空收费 binding，不为未命中价格表的模型猜测价格，不新增费用接口或后台任务。
  - 最小验证：session-sync-core 编译通过；Host `session-live-runtime-service` 定向测试覆盖价格表命中和未知模型；`git diff --check` 通过。

## 阶段 13：价格表快照和费用详情表格

- [x] 13.1 把费用详情中的价格表改成可对齐的表格
  - 状态：COMPLETED
  - 这一步做什么：在现有费用详情模态框中，把价格表从长文本列表改为语义化表格，按提供商、模型、输入、输出、缓存读取和缓存写入分列显示。
  - 做完以后能看到什么：点击费用信息按钮后，用户可以横向比较每个模型的单价；移动端表格保持横向滚动，不会挤坏弹窗布局。
  - 依赖什么：12.5 已透传的价格表快照。
  - 主要修改：`apps/user-app/src/features/conversation/components/ComposerPanel.tsx`、`apps/user-app/src/features/conversation/api/conversation-api.ts`、`apps/user-app/src/app/styles.css`、中英文 i18n。
  - 这一步明确不做什么：不在前端重新计算费用，不复制一份价格常量，不改变费用总额。
  - 最小验证：ComposerPanel 定向测试、user-app TypeScript 检查和 `git diff --check` 通过。

- [x] 13.2 增加按周固定的价格快照同步
  - 状态：COMPLETED
  - 这一步做什么：新增 `ProviderPriceBookService`，通过现有 `TaskManager` 低频读取 `models.dev/api.json`，只更新当前支持模型，并把快照保存到 `data/host/price-book-snapshots/`。同一周版本不覆盖，保留最近 104 份快照。
  - 做完以后能看到什么：Host 启动或创建新会话时会检查快照是否过期；同步成功的新会话绑定新的周版本，旧会话继续读取原版本；网络失败时仍可使用最近快照或内置表。
  - 依赖什么：12.1 的 `priceBookVersion`、12.2 的同一次费用折叠和后台任务接入规范。
  - 主要修改：`apps/host/src/modules/provider/provider-price-book-service.ts`、`apps/host/src/modules/tasks/task-types.ts`、`apps/host/src/modules/sessions/session-history-service.ts`、`apps/host/src/modules/sessions/session-live-runtime-service.ts`、`apps/host/src/server/create-server.ts`、`packages/session-sync-core/src/types.ts`、`packages/session-sync-core/src/session-pricing.ts`。
  - 这一步明确不做什么：不在每次会话统计时联网，不覆盖同周快照，不重算已绑定历史会话，不建立费用账本表。
  - 最小验证：价格同步服务成功/失败回退测试、core 动态价格版本测试、Host 类型检查、`pnpm check:sqlite-runtime` 和 `git diff --check` 通过。
