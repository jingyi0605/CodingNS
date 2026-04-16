# @jingyi0605/codingns

`@jingyi0605/codingns` 是项目的第一版统一服务包。

安装名是 `@jingyi0605/codingns`，实际命令仍然是 `codingns`。

安装后可以直接启动完整服务，不需要再分别启动前端和后端：

```bash
npx @jingyi0605/codingns start --port 3002
```

或者：

```bash
npm install -g @jingyi0605/codingns
codingns start --port 3002
```

常用参数：

- `--host`：监听地址，默认 `0.0.0.0`
- `--port`：监听端口，默认 `3002`
- `--data-dir`：数据目录，默认 `~/.codingns`

这个包适合放在自托管服务器、开发机或者家里的常驻设备上，统一提供 CodingNS 服务入口。

当前包含的核心能力：

- 会话同步：发现并接续 Claude Code、Codex、OpenCode 等 CLI 会话
- 工作区工具：提供文件、Git、终端、进程等后端能力
- 实时通信：通过 HTTP 与 WebSocket 向客户端推送会话和工作区状态
- 本地数据落盘：默认把数据写到 `~/.codingns`，方便持久化和迁移

## 助手能力 CLI

从 `spec013.2` 开始，`codingns` 额外提供了一层给助手和自动化工具使用的统一能力命令。

这层命令自己不长业务逻辑，只是把命令行参数映射到 Host 的 `/api/assistant/*` 能力门面。

建议使用方式：

- 先用 help 看分组和动作，不要硬猜参数
- 真正执行时再跑具体命令
- 让 AI 代理按需查询 help，而不是把整份命令说明塞进上下文

使用前需要准备：

- Host 服务地址，默认 `http://127.0.0.1:3002`
- 有效的 access token

可以通过参数传入，也可以通过环境变量传入：

```bash
export CODINGNS_BASE_URL=http://127.0.0.1:3002
export CODINGNS_ACCESS_TOKEN=your-access-token
```

常用示例：

```bash
codingns assistant --help
codingns assistant help workspaces
codingns assistant help worktrees
codingns assistant help sessions
codingns assistant sessions send --help
codingns assistant capabilities list
codingns assistant projects list --status active
codingns assistant projects get project-123
codingns assistant workspaces list
codingns assistant workspaces management workspace-123
codingns assistant worktrees tree --root-workspace-id workspace-123
codingns assistant worktrees create --source-workspace-id workspace-123 --branch-name feature/demo
codingns assistant sessions list --project project-123
codingns assistant sessions get session-123
codingns assistant sessions messages session-123 --limit 20
codingns assistant sessions runtime session-123
codingns assistant sessions send session-123 --message "继续修复类型错误"
codingns assistant sessions fork session-123 --message-id msg-123
codingns assistant terminals list --project-id project-123
codingns assistant terminals history terminal-123 --limit 50
codingns assistant terminals send terminal-123 --input "npm test\n"
```

相关文档：

- 仓库总览：[`../../README.md`](../../README.md)
- NPM 包发布与离线安装说明：[`../../docs/使用说明/20260329-NPM包打包发布与离线安装说明.md`](../../docs/使用说明/20260329-NPM包打包发布与离线安装说明.md)
