---
name: codingns-assistant
description: Use when working inside CodingNS and needing to inspect托管项目、真实会话、受控终端，或通过 `codingns assistant ...` 代理推进任务。 This skill enforces the boundary “不直接修改正式工作区代码；涉及工作区时只通过会话或终端代理执行”, and tells Codex to prepare auth first in Butler workspaces, then discover capabilities, query CLI help on demand, and run the minimum necessary CLI command.
---

# CodingNS Assistant

## 概述

用这套 Skill 时，永远把 `codingns assistant ...` 当成唯一正式入口。

不要直接修改工作区代码，不要自己编造接口，不要把整份命令手册长期塞进上下文。

## 固定边界

- 禁止直接修改任何正式工作区或项目仓库文件。
- 只要涉及正式工作区，就只能通过真实项目会话或受控终端代理执行。
- 优先查事实，再决定要不要发送消息、发终端输入或 fork。
- 不清楚命令参数时，先跑 help，再执行真正命令。

## 默认工作流

1. 如果当前目录或任务里出现 `BUTLER_CONTEXT.md`、`BUTLER_API.md`、助手真实工作区，先读 `BUTLER_API.md`。
2. 在当前助手绑定的真实工作区里，优先直接执行 `codingns assistant ...`；CLI 会按固定顺序自动读取 `--token`、环境变量、`CODINGNS_AUTH_FILE` / `BUTLER_AUTH_FILE`、当前目录及上级目录里的 `BUTLER_AUTH.json`。
3. 只有这些固定认证入口都不可用时，才回头核对 `BUTLER_API.md` 里的凭证文件路径，或向用户要 token。
4. 认证入口可用后，再跑 `codingns assistant capabilities list`，确认当前环境开放了哪些能力。
5. 要看工作区或工作树时，先跑 `codingns assistant workspaces --help`、`codingns assistant worktrees --help`。
6. 要找项目时，先跑 `codingns assistant projects --help`，再决定用 `list` 还是 `get`。
7. 要找会话时，先跑 `codingns assistant sessions --help`，再决定用 `list / start / get / messages / runtime / send / fork`。
8. 如果用户没指定工作区，先补齐真实工作区或项目目标；不要再走独立沙箱。
9. 要推进正式工作区开发时，如果明确是在续写已有真实会话，才用 `codingns assistant sessions send`；如果没有明确续写目标，优先用 `codingns assistant sessions start` 按当前助手配置新建真实会话。
10. 如果要等待真实会话回复，或者未来某个具体时间后再继续，必须用 `codingns assistant timers create` 创建计时器，不能只在回答里说“稍后继续”。
11. 只有明确需要终端链路时，才用 `codingns assistant terminals send` 或 `codingns assistant terminals close`。
12. 要从现有上下文开新分支时，才用 `codingns assistant sessions fork`。

## Butler 认证补充

- 在当前助手绑定的真实工作区里，不要先故意跑一条会失败的 `codingns assistant ...` 再回头找 token。
- 优先顺序固定为：显式 `--token` / `CODINGNS_ACCESS_TOKEN` / `CODINGNS_AUTH_FILE` / 当前目录及上级目录里的 `BUTLER_AUTH.json`。
- CLI 已能自动发现 `BUTLER_AUTH.json` 时，直接继续用 `codingns assistant ...`；不要再把手工导出环境变量当成默认流程。
- 只有自动发现失败、当前目录不在当前助手绑定的真实工作区，或者你要切换到别的 Host / 凭证文件时，才手工导出环境变量。
- 如果 `BUTLER_API.md` 已经写死凭证文件路径，就把它当成兜底事实来源，不要自己猜别的认证入口。

## 什么时候读 references

- 需要知道某一组命令怎么用时，读 `references/cli-workflow.md`。
- 只需要某个动作参数时，优先直接跑：
  - `codingns assistant <group> --help`
  - `codingns assistant <group> <action> --help`
- 不要先把 `references/cli-workflow.md` 全量塞进上下文，除非你真的要连续用多条命令。

## 回答风格

- 回答项目现状时，先给结论，再引用 CLI 返回的关键字段。
- 执行前先说明你要查什么或发什么，不要闷头乱跑命令。
- 如果 CLI 返回错误，先解释错误，再决定是不是查 help 或换目标对象。

## 最小例子

- “看看当前有哪些工作区”：
  先 `codingns assistant workspaces list --help`，再执行真正命令。
- “看看某个工作区下面有哪些子工作树”：
  先 `codingns assistant worktrees tree --help`，再执行真正命令。
- “看看现在有哪些项目”：
  先 `codingns assistant projects list --help`，再执行真正命令。
- “给这个会话继续发任务”：
  先 `codingns assistant sessions send --help`，确认参数后再发送。
- “没有明确续写目标，要把任务发到真实项目里”：
  先 `codingns assistant sessions start --help`，确认参数后再新建会话。
- “等 5 分钟后再回来检查真实会话”：
  先 `codingns assistant timers create --help`，再创建计时器。
- “终端里补一个测试命令”：
  先 `codingns assistant terminals history <terminalId>` 看最近输出，再决定是否 `send`。

## 资源

- `references/cli-workflow.md`：命令分组、建议查询顺序、常用 help 入口。
