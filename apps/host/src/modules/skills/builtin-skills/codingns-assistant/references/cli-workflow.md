# CodingNS Assistant CLI Workflow

## 1. 总原则

- 先确认认证入口可用，再查能力，再查对象，再执行动作。
- 不直接修改正式工作区代码。
- 只要涉及正式工作区，就通过真实项目会话或受控终端推进执行。
- 不知道参数时先查 help，不要硬猜。

## 2. 先确认认证入口

- 显式传了 `--token` / `--base-url` 就直接用。
- 如果已设置 `CODINGNS_ACCESS_TOKEN` / `CODINGNS_BASE_URL`，直接继续执行。
- 如果设置了 `CODINGNS_AUTH_FILE` 或 `BUTLER_AUTH_FILE`，CLI 会从那个文件读取。
- 在当前助手绑定的真实工作区里，CLI 默认会继续向上查找 `BUTLER_AUTH.json`，通常不需要手工 export 环境变量。
- 只有自动发现失败、当前目录不在当前助手绑定的真实工作区，或者要切换到别的 Host / 凭证文件时，才手工导出环境变量或显式传 `--token`。

## 3. 先查哪些 help

全局入口：

```bash
codingns assistant --help
codingns assistant help debug-targets
codingns assistant help debug-runtimes
codingns assistant help workspaces
codingns assistant help worktrees
codingns assistant help sessions
codingns assistant help sessions send
```

按组查询：

```bash
codingns assistant capabilities --help
codingns assistant debug-targets --help
codingns assistant debug-runtimes --help
codingns assistant workspaces --help
codingns assistant worktrees --help
codingns assistant projects --help
codingns assistant sessions --help
codingns assistant terminals --help
```

按动作查询：

```bash
codingns assistant workspaces list --help
codingns assistant debug-targets launch-plan --help
codingns assistant debug-targets run --help
codingns assistant worktrees create --help
codingns assistant projects list --help
codingns assistant sessions get --help
codingns assistant sessions send --help
codingns assistant terminals send --help
```

## 4. 常用工作流

### 看工作区和工作树

```bash
codingns assistant workspaces list [--token <token>]
codingns assistant workspaces management <workspaceId> [--token <token>]
codingns assistant worktrees tree --root-workspace-id <workspaceId> [--token <token>]
codingns assistant worktrees merge-preview <workspaceId> [--token <token>]
```

### 分析调试目标并显式请求端口

```bash
codingns assistant debug-targets analyze --workspace-id <workspaceId> --root-path <path> [--token <token>]
codingns assistant debug-targets launch-plan <targetId> --port-request role=frontend,cwd=apps/web,port=43001 --port-request role=backend,cwd=apps/api,port=44001 [--token <token>]
codingns assistant debug-targets run <targetId> --port-request role=backend,cwd=apps/api,port=44001 [--token <token>]
codingns assistant debug-targets runtime-latest <targetId> [--token <token>]
codingns assistant debug-runtimes get <runtimeId> [--token <token>]
```

### 看项目和会话

```bash
codingns assistant capabilities list [--token <token>]
codingns assistant projects list [--token <token>]
codingns assistant projects get <projectId> [--token <token>]
codingns assistant sessions list --project <projectId> [--token <token>]
codingns assistant sessions get <sessionId> [--token <token>]
codingns assistant sessions runtime <sessionId> [--token <token>]
codingns assistant sessions messages <sessionId> --limit 20 [--token <token>]
```

### 通过真实会话推进开发

```bash
codingns assistant sessions start --project <projectId> --message "继续处理这个任务" [--token <token>]
codingns assistant sessions send <sessionId> --message "继续修复类型错误" [--token <token>]
codingns assistant timers create --after-seconds 300 --message "5 分钟后检查真实会话回复" --session-id <sessionId> --project-id <projectId> [--token <token>]
```

如果需要从某条消息重新开分支：

```bash
codingns assistant sessions fork <sessionId> --message-id <messageId> --token <token>
```

### 通过终端补命令

先看终端状态和最近输出：

```bash
codingns assistant terminals list --project-id <projectId> [--token <token>]
codingns assistant terminals history <terminalId> --limit 50 [--token <token>]
```

确认需要发命令后再执行：

```bash
codingns assistant terminals send <terminalId> --input "npm test\n" [--token <token>]
codingns assistant terminals close <terminalId> --token <token>
```

## 5. 什么时候优先用什么

- 需要看有哪些工作区或导入目标：优先 `workspaces list`、`workspaces browse`
- 需要看子工作树结构或回收状态：优先 `worktrees tree`
- 需要看子工作树能不能合并：优先 `worktrees merge-preview`
- 需要为并行工作区分析调试目标或固定端口：优先 `debug-targets analyze`、`debug-targets launch-plan`
- 需要看显式端口请求有没有落到实际运行时：优先 `debug-targets runtime-latest`、`debug-runtimes get`
- 没有明确续写目标、要把任务发进真实项目：优先 `sessions start`
- 需要继续已有开发上下文：优先 `sessions send`
- 需要等待真实会话回复或未来某个时间继续：优先 `timers create`
- 需要查看会话是否还活着：优先 `sessions runtime`
- 需要看模型最近说了什么：优先 `sessions messages`
- 需要看构建、测试、脚本输出：优先 `terminals history`
- 需要补一条 shell 命令：优先 `terminals send`
- 需要停掉一个受控进程：优先 `terminals close`
