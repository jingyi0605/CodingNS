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
