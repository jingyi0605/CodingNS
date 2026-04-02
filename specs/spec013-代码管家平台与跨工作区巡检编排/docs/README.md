# 补充文档目录

`docs/` 用于存放 `spec013-代码管家平台与跨工作区巡检编排` 的补充材料。

当前已补充的材料：

- `20260402-数据库表草案.md`
  - `spec013` 的 SQLite 表结构建议、与现有 `workspaces/session_*` 表的关系、索引与迁移顺序
- `20260402-服务接口草案.md`
  - `spec013` 的 `/api/butler/...` 路由草案、请求响应模型和 MVP 接口切分
- `20260402-模块目录草案.md`
  - `apps/host/src/routes`、`modules`、`repositories` 的落地目录建议和职责边界

后续还建议继续补这些文档：

- `provider-adapter.md`
  - `Codex`、`Claude Code` 适配差异与能力位说明
- `instruction-mapping.md`
  - `AGENTS.md`、`CLAUDE.md`、system prompt 注入映射规则
- `acceptance-checklist.md`
  - 巡视、总结、验证、授权、审计的验收清单
- `risk-log.md`
  - 记录 provider 差异泄漏、错误记忆污染、误执行、假验证通过等风险
