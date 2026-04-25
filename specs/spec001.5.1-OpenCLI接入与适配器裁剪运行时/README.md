# spec001.5.1-OpenCLI接入与适配器裁剪运行时

## 当前定位

这是 `spec001.5-多CLI-Skill统一管理与同步` 的子规格。

它不再讨论“本地 Skill 目录怎么纳管”这种通用问题，而是只解决 `OpenCLI` 这一类特殊对象怎么接进来。

`OpenCLI` 不是普通 `SKILL.md` 目录，它同时包含：

- 可执行 binary
- 内置适配器命令目录
- 浏览器桥诊断链路
- 用户态数据目录 `~/.opencli`

所以这次解决的不是“把 OpenCLI 当成另一个 Skill 上传”，而是下面这些真问题：

- 技能面板里怎么展示 `OpenCLI` 的安装状态、健康状态和适配器目录
- 用户手动启用或禁用 `OpenCLI` 后，AI 会话里怎么真正生效，而不是前端按钮自嗨
- 用户只启用一部分适配器时，怎么保证没启用的适配器在 CodingNS 管理的 CLI 环境里根本用不了
- 不改用户全局 `opencli` 安装的前提下，怎么生成一份只包含允许适配器的裁剪运行时
- `Claude Code`、`Codex` 这类隔离会话里，`OpenCLI` 怎么安全读到用户真实的 `~/.opencli`

一句人话：
这次做的是“OpenCLI provider 接入 + 会话可控裁剪运行时”，不是“把 OpenCLI 当普通 Skill 导入”，也不是“直接改用户机器上的全局 OpenCLI 安装”。

## 计划覆盖

- `OpenCLIProvider` 的状态模型和宿主边界
- 技能面板里的 OpenCLI 分区、启用开关、适配器列表和选择性启用
- 以 `cli-manifest.json` 为核心的命令目录读取、缓存和差异更新
- 根据面板勾选结果生成裁剪版 OpenCLI 运行时
- CodingNS 管理的会话、助手沙箱和相关 CLI 环境如何切换到裁剪版运行时
- `OpenCLI` 的真实 HOME 策略和浏览器桥健康检查
- 禁用项如何在会话里真正失效，而不是只在 UI 上隐藏

## 依赖关系

- 前置依赖：
  - `spec001.5-多CLI-Skill统一管理与同步`
  - `spec010-Provider扩展框架`
- 强相关依赖：
  - `spec002-ClaudeCode与Codex会话同步核心`
  - `spec003.1-原生会话实时对话运行时`
  - `spec013.4-助手专用Skill隔离与调用身份收口`
- 直接影响：
  - `apps/host`
  - `apps/user-app`
  - `packages/codingns`

## 本阶段明确不做

- 不改用户系统里原本的全局 `opencli` 包内容
- 不要求用户在自己终端里运行的全局 `opencli` 也同步受面板限制
- 不做 OpenCLI 远端市场、社区推荐、在线搜索
- 不把 OpenCLI 的所有浏览器扩展安装步骤自动化到一键完成
- 不在这一期里支持任意第三方 CLI Hub，先只把 OpenCLI 这一个对象接好

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
