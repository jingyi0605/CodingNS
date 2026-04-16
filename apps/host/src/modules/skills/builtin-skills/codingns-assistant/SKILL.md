---
name: codingns-assistant
description: Use when working inside CodingNS and needing to inspect托管项目、真实会话、受控终端，或通过 `codingns assistant ...` 代理推进任务。 This skill enforces the boundary “不直接写项目代码，只通过会话或终端代理执行”, and tells Codex to discover capabilities first, query CLI help on demand, then run the minimum necessary CLI command.
---

# CodingNS Assistant

## 概述

用这套 Skill 时，永远把 `codingns assistant ...` 当成唯一正式入口。

不要直接写项目代码，不要自己编造接口，不要把整份命令手册长期塞进上下文。

## 固定边界

- 禁止直接修改项目文件。
- 只能通过真实项目会话或受控终端代理执行。
- 优先查事实，再决定要不要发送消息、发终端输入或 fork。
- 不清楚命令参数时，先跑 help，再执行真正命令。

## 默认工作流

1. 先跑 `codingns assistant capabilities list`，确认当前环境开放了哪些能力。
2. 要找工作区或工作树时，先跑 `codingns assistant workspaces --help`、`codingns assistant worktrees --help`。
3. 要找项目时，先跑 `codingns assistant projects --help`，再决定用 `list` 还是 `get`。
4. 要找会话时，先跑 `codingns assistant sessions --help`，再决定用 `list / get / messages / runtime`。
5. 要推进开发时，优先用 `codingns assistant sessions send`。
6. 只有明确需要终端链路时，才用 `codingns assistant terminals send`。
7. 要从现有上下文开新分支时，才用 `codingns assistant sessions fork`。

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
- “终端里补一个测试命令”：
  先 `codingns assistant terminals history <terminalId>` 看最近输出，再决定是否 `send`。

## 资源

- `references/cli-workflow.md`：命令分组、建议查询顺序、常用 help 入口。
