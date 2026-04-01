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

相关文档：

- 仓库总览：[`../../README.md`](../../README.md)
- NPM 包发布与离线安装说明：[`../../docs/使用说明/20260329-NPM包打包发布与离线安装说明.md`](../../docs/使用说明/20260329-NPM包打包发布与离线安装说明.md)
