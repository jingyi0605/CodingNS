# spec002-ClaudeCode与Codex会话同步核心

## 当前定位

这是第一阶段最关键的业务核心 Spec。
它决定系统到底是不是“能续接原生 CLI 会话”，还是只是一个套壳聊天页。

## 计划覆盖

- `provider-claude-code`
- `provider-codex`
- 会话发现、历史读取、实时订阅
- 会话续接与新建会话
- 消息归一化
- 原始消息只读边界
- 会话索引与状态快照
- provider capability descriptor
- provider 兼容性测试样本

## 依赖关系

- 前置依赖：`spec001-平台底座与工作区基础`
- 后续依赖：`spec003`、`spec010`

## 本阶段明确不做

- 一开始接太多 provider
- 前端花活
- 团队协作能力

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
