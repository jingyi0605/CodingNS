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
