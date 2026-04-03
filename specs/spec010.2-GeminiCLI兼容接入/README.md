# spec010.2-GeminiCLI兼容接入

## 当前定位

这个 Spec 负责把 `Gemini CLI` 接进现有 provider 体系，而且要接得像样，不接成一堆补丁。

它解决的不是“下拉框里再多一个 Gemini”，而是：

- `Gemini CLI` 的官方主接入链路到底该走 `ACP`、`headless stream-json`，还是本地会话文件
- 当前项目里哪些 provider 硬编码会挡住 `Gemini`
- `Gemini` 的原生会话 ID、历史读取、实时运行和权限模式怎么映射到现有系统
- 参考项目 `siteboon/claudecodeui` 里哪些实现值得借，哪些只是权宜之计

## 计划覆盖

- Gemini 的会话发现、历史读取、实时运行和中断接入方式
- Gemini `ACP`、`headless`、本地会话目录三条链路的主次关系
- Gemini 会话绑定、消息归一化和能力声明策略
- 当前仓库里阻碍第四家 provider 的硬编码拆除范围
- Gemini 真实样本、fixture、回归和验收策略

## 依赖关系

- 前置依赖：`spec002`、`spec003`、`spec003.1`、`spec010`
- 强关联依赖：`spec010.1`
- 后续依赖：Gemini provider 实际实现、前端能力补齐、fixture 回归

## 本阶段明确不做

- 不在这个 Spec 里直接交付完整代码实现
- 不把 `siteboon/claudecodeui` 的自建 sessionManager 直接搬进当前项目
- 不为了 Gemini 重写主会话页面
- 不把 `~/.gemini/tmp/...` 内部 JSON 格式当成永远稳定不变的公共协议

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
