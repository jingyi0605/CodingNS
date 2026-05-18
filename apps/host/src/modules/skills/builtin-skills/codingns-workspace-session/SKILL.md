---
name: codingns-workspace-session
description: Use when running inside a CodingNS 工作区会话。This skill no longer teaches the full CLI surface; it only defines workspace-scoped routing and safety rules, while formal office capabilities are exposed through MCP tools.
---

# CodingNS Workspace Session

## 概述

这套 Skill 只服务工作区普通会话，不服务 Butler 助手控制面。

工作区会话里的正式能力优先来自运行时已经挂载的 MCP / tool schema；这份 Skill 只负责路由和安全规则，不再承担整套 CLI 教程。

不要自己拼私有 HTTP，不要脑补不存在的跨工作区能力，不要为了“找能力”退回去翻源码和编译产物。

## 工作区边界

- 当前会话只能在当前 `workspaceId`，以及可选的当前 `projectId` 范围内行动。
- 不要尝试跨工作区、跨项目调用能力。
- 能力是否可用，以当前 runtime 已暴露的 MCP 工具或 `codingns assistant capabilities list` 的真实返回为准。
- 默认可直接执行只读型终端/浏览器操作；仅在会产生写入、删除、提交、支付、发布、merge、修改系统状态的操作前征得用户确认。

## 办公能力路由

- 文档产物、模板导出、结构化文档更新：优先走 `office.document.*`。
- 真实站点网页、企业后台、登录流程、页面抓取、表单提交、下载文件：优先走 `office.browser.*`。
- SSH 主机、浏览器运维目标、远程任务：优先走 `office.ops.*`。
- 终端只处理当前工作区里的本地命令和调试，不替代正式浏览器/运维入口。

## 浏览器意图分流规则

- 命中以下意图时，默认先走 `office.browser.*`，不要先退回本地 Browser 或源码探测：
  - 打开网页
  - 登录网站
  - 抓取页面内容
  - 读取 DOM / 标题 / 主要区块
  - 截图
  - 点按钮、切标签、翻页
  - 填表单、提交表单
  - 下载文件
- 只有下面这些场景，才优先保留 Codex 自带 Browser：
  - 本地预览 `localhost` / `127.0.0.1` / `::1`
  - 检查当前 Codex 内嵌浏览器里已经打开的本地页面
  - 前端开发调试、热更新验证、UI 冒烟检查
  - 用户明确点名要用 Browser / in-app browser / 当前浏览器标签
- 如果任务既像“网页操作”又像“本地前端调试”，先看目标 URL：
  - `localhost` / `127.0.0.1` / `::1`：优先 Codex Browser
  - 其他真实站点或内网地址：优先 `office.browser.*`
- 如果当前会话同时还能看到 `$codingns-opencli`，不要被它里面的站点命令带偏：
  - 公开页面、公开榜单、公开帖子、公开趋势数据：可以考虑 `codingns-opencli`
  - 登录态、验证码、订单、购物车、个人账户、后台页面、表单提交、下载文件、点击页面控件、复用人工已登录 Chrome/Edge：一律不要直接运行 browser-dependent 的 OpenCLI 命令，必须走 `office.browser.*`
- 就算 `codingns-opencli` 里存在 `taobao/*`、`jd/*` 这类 browser-dependent 命令，也不能把它们当成工作区真实站点任务的默认入口。
- 如果是真实站点登录、验证码、二次确认弹窗、复杂前端交互、必须复用人工已登录 Chrome/Edge 登录态，创建浏览器任务时优先显式传 `executionBackend=opencli_bridge`。
- 只有页面明显适合无头执行，或者用户明确要求无头链路时，才继续用默认 `playwright`。

## 默认工作流

1. 先看当前 runtime 已暴露的 MCP 工具；必要时再用 `codingns assistant capabilities list` 复核。
2. 命中文档类意图时，优先 `office.document.*`。
3. 命中真实网页类意图时，优先 `office.browser.*`。
4. 命中远程运维类意图时，优先 `office.ops.*`。
5. 只有本地 `localhost` / `127.0.0.1` / `::1` 页面调试，才优先 Codex 自带 Browser。
6. 需要本地命令执行时，先新建终端；只读命令可直接执行，只有会产生写入、删除、提交、支付、发布、merge、修改系统状态的命令才先征得用户确认。

## 资源

- `references/cli-workflow.md`：保留最小 CLI 兜底参考，主要用于 MCP 不可用时排障。
