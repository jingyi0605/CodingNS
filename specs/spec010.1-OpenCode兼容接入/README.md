# spec010.1-OpenCode兼容接入

## 当前定位

这个 Spec 负责把 `OpenCode` 接进现有 provider 体系，但前提是按规矩接，不走野路子。

它解决的不是“能不能把 OpenCode 名字加到下拉框里”，而是：

- 现有 provider 扩展框架还缺哪些真抽象
- OpenCode 应该走本地 sqlite 读取，还是走官方 server/sdk
- 它比当前 `Claude Code` / `Codex` 多出来的能力，怎么在不污染主链路的前提下接进来

## 计划覆盖

- OpenCode 的会话发现、历史读取和实时事件接入方式
- OpenCode `session/message/part` 结构和项目统一消息模型的映射关系
- OpenCode 的 `diff`、`todo`、`children`、`permission` 等能力如何通过 capability 暴露
- 现有 provider 硬编码拆除范围
- 本地样本、fixture 和回归测试策略

## 依赖关系

- 前置依赖：`spec002`、`spec003`、`spec003.1`、`spec003.2`、`spec010`
- 后续依赖：OpenCode provider 实际实现、前端能力补齐、fixture 回归

## 本阶段明确不做

- 不在这个 Spec 里直接交付完整 OpenCode 代码实现
- 不为了迁就 OpenCode 重写主会话页面
- 不把 OpenCode 的 sqlite 私有格式直接当成唯一运行时协议
- 不为了第三个 provider 继续容忍新的 provider 名字硬编码

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
