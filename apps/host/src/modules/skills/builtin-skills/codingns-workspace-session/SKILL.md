---
name: codingns-workspace-session
description: Use when running inside a CodingNS 工作区会话。Defines current workspace boundaries, routing, and safety rules.
---

# CodingNS Workspace Session

## 概述

这套 Skill 只服务工作区普通会话，不服务 Butler 助手控制面。

工作区会话里的正式能力优先来自运行时已经挂载的 MCP / tool schema；这份 Skill 只负责路由和安全规则。

不要自己拼私有 HTTP，不要脑补不存在的跨工作区能力，不要为了“找能力”退回去翻源码和编译产物。

## 工作区边界

- 当前会话只能在当前 `workspaceId`，以及可选的当前 `projectId` 范围内行动。
- 不要尝试跨工作区、跨项目调用能力。
- 能力是否可用，以当前 runtime 已暴露的 MCP 工具或 `codingns assistant capabilities list` 的真实返回为准。
- 默认可直接执行只读型终端/浏览器操作；仅在会产生写入、删除、提交、支付、发布、merge、修改系统状态的操作前征得用户确认。

## 能力路由

- 当前只使用工作区会话本身暴露的 `SKILL` / MCP / tool 能力。
- 文档相关能力如果在当前 runtime 暴露，按真实工具声明使用。
- 终端只处理当前工作区里的本地命令和调试。
- 真实浏览器任务与远程运维任务交给 Codex / Claude Code 自带能力。

## 浏览器意图分流规则

- 命中网页操作意图时，优先使用 Codex / Claude Code 自带浏览器能力。
- 下面这些场景，优先使用 Codex 自带 Browser：
  - 本地预览 `localhost` / `127.0.0.1` / `::1`
  - 检查当前 Codex 内嵌浏览器里已经打开的本地页面
  - 前端开发调试、热更新验证、UI 冒烟检查
  - 用户明确点名要用 Browser / in-app browser / 当前浏览器标签
- 如果任务既像“网页操作”又像“本地前端调试”，先看目标 URL：
  - `localhost` / `127.0.0.1` / `::1`：优先 Codex Browser
  - 其他真实站点或内网地址：优先 Codex / Claude Code 自带浏览器能力

## 默认工作流

1. 先看当前 runtime 已暴露的 MCP 工具。
2. 命中文档类意图时，优先当前 runtime 真实暴露的文档能力。
3. 命中真实网页类意图时，优先 Codex / Claude Code 自带浏览器能力。
4. 命中远程运维类意图时，优先 Codex / Claude Code 自带终端或浏览器能力。
5. 需要本地命令执行时，先新建终端；只读命令可直接执行，只有会产生写入、删除、提交、支付、发布、merge、修改系统状态的命令才先征得用户确认。

## 资源

- 这份 Skill 只保留工作区边界与路由规则。
