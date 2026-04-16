# CodingNS Assistant CLI Workflow

## 1. 总原则

- 先查能力，再查对象，再执行动作。
- 不直接写项目代码。
- 不知道参数时先查 help，不要硬猜。

## 2. 先查哪些 help

全局入口：

```bash
codingns assistant --help
codingns assistant help workspaces
codingns assistant help worktrees
codingns assistant help sessions
codingns assistant help sessions send
```

按组查询：

```bash
codingns assistant capabilities --help
codingns assistant workspaces --help
codingns assistant worktrees --help
codingns assistant projects --help
codingns assistant sessions --help
codingns assistant terminals --help
```

按动作查询：

```bash
codingns assistant workspaces list --help
codingns assistant worktrees create --help
codingns assistant projects list --help
codingns assistant sessions get --help
codingns assistant sessions send --help
codingns assistant terminals send --help
```

## 3. 常用工作流

### 看工作区和工作树

```bash
codingns assistant workspaces list --token <token>
codingns assistant workspaces management <workspaceId> --token <token>
codingns assistant worktrees tree --root-workspace-id <workspaceId> --token <token>
codingns assistant worktrees merge-preview <workspaceId> --token <token>
```

### 看项目和会话

```bash
codingns assistant capabilities list --token <token>
codingns assistant projects list --token <token>
codingns assistant projects get <projectId> --token <token>
codingns assistant sessions list --project <projectId> --token <token>
codingns assistant sessions get <sessionId> --token <token>
codingns assistant sessions runtime <sessionId> --token <token>
codingns assistant sessions messages <sessionId> --limit 20 --token <token>
```

### 通过真实会话推进开发

```bash
codingns assistant sessions send <sessionId> --message "继续修复类型错误" --token <token>
```

如果需要从某条消息重新开分支：

```bash
codingns assistant sessions fork <sessionId> --message-id <messageId> --token <token>
```

### 通过终端补命令

先看终端状态和最近输出：

```bash
codingns assistant terminals list --project-id <projectId> --token <token>
codingns assistant terminals history <terminalId> --limit 50 --token <token>
```

确认需要发命令后再执行：

```bash
codingns assistant terminals send <terminalId> --input "npm test\n" --token <token>
```

## 4. 什么时候优先用什么

- 需要看有哪些工作区或导入目标：优先 `workspaces list`、`workspaces browse`
- 需要看子工作树结构或回收状态：优先 `worktrees tree`
- 需要看子工作树能不能合并：优先 `worktrees merge-preview`
- 需要继续已有开发上下文：优先 `sessions send`
- 需要查看会话是否还活着：优先 `sessions runtime`
- 需要看模型最近说了什么：优先 `sessions messages`
- 需要看构建、测试、脚本输出：优先 `terminals history`
- 需要补一条 shell 命令：优先 `terminals send`
