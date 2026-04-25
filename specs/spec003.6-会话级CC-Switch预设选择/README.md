# spec003.6-会话级CC-Switch预设选择

## 当前定位

这个 Spec 只解决一件事：

- 让 `Codex`、`Claude Code`、`Gemini` 在会话界面里直接选择 `cc-switch` 的配置文件和模型，而不是每次都先去设置页切全局配置。

这里先把边界钉死，免得后面又写歪：

- 这一步只做 `Codex`、`Claude Code`、`Gemini`
- 这一步不碰 `OpenCode`，它继续走自己的供应商管理
- 这一步不碰 `Kimi`，它继续只兼容自己的配置体系
- 这一步不把“开会话前临时切全局 preset”包装成正式方案

一句话说清楚：
先把“会话级部署选择”做成真实能力，再谈更重的 provider 配置管理。

## 核心判断

- ✅ 值得做：这是用户真实会遇到的问题，而且现有全局切换方案一旦遇到并发会话就会互相踩配置。
- 第一阶段正确目标不是“万能 provider 配置中心”，而是“新会话绑定一个可继续运行、可恢复、可回放的 preset 上下文”。

## 当前项目现状

现在项目已经有两块现成能力，但它们之前没接上：

1. 设置页已经能读 `cc-switch` 的预设列表，也能切全局当前预设
2. 会话运行时已经支持 `model / reasoningLevel / permissionMode`

问题在于现在的数据结构是错位的：

- `cc-switch` 现在是“全局当前 preset”
- 会话运行时现在是“全局 homeDir + 可选显式 model”
- 系统里没有“这个 session 绑定哪个 preset / 哪个 runtimeHomeDir”的正式模型

如果还停留在旧方案，会直接导致两个现实问题：

1. 两个会话如果想用同一 provider 下的不同 preset，就会互相踩
2. 应用重启后，旧会话继续运行时只能回到当前全局配置，不能稳定回到它启动时的 preset

## 本轮目标

- 定义会话级 provider preset 绑定模型
- 明确 `Codex / Claude Code / Gemini` 三家的接入边界
- 把会话页原有模型位置改成“配置文件 + 模型”的部署选择
- 让会话进行中切换部署后，后续消息立刻吃新配置
- 设计 Host 如何从 `cc-switch` 预设生成会话专属运行上下文
- 设计旧会话兼容策略，确保不破坏现有全局切换链路

## 本阶段明确不做

- 不做设置页里新增/编辑/删除 `cc-switch` 预设
- 不做 `OpenCode` 接入这一套机制
- 不做 `Kimi` 接入这一套机制
- 不做任意 provider 的完整配置编辑器
- 不做“所有 provider 一次性统一到底”的过度设计

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
