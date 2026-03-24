# 原生会话互通验收清单

状态：Draft

## 目标

这份清单只验证一件事：`CodingNS` 做出来的对话能力，是否真能和原生 `Claude Code` / `Codex` 双向互通。

## 路径 A：本项目新建 -> 原生环境继续

### Claude Code

- [x] 在本机通过 `Claude Code` 创建新会话并得到真实 `session-id`
- [x] 在同一 `session-id` 下继续发送第二条消息
- [x] 第二条消息能读到第一条消息的上下文
- [x] 本地 `.claude/projects/.../<session-id>.jsonl` 已存在对应原生会话文件
- [ ] 用未来 `CodingNS Host` 的新建接口创建同类会话
- [ ] 再回到原生 `Claude Code` 中继续同一会话

### Codex

- [x] 在本机通过 `Codex SDK` 创建真实 thread
- [x] 获得真实 `threadId`
- [x] 使用同一 `threadId` 恢复并继续对话
- [x] 第二条消息能读到第一条消息的上下文
- [x] 本地 `.codex/sessions/...` 已生成对应原生会话文件
- [ ] 用未来 `CodingNS Host` 的新建接口创建同类 thread
- [ ] 再回到原生 Codex 环境继续同一 thread

## 路径 B：原生已有 -> 本项目继续

### Claude Code

- [x] 本机已存在历史原生会话目录
- [x] 可用 `--resume <session-id>` 继续原生会话
- [ ] 将该会话同步进 `CodingNS`
- [ ] 在 `CodingNS` 中继续对话
- [ ] 对话后回原生 `Claude Code` 继续

### Codex

- [x] 本机已存在历史原生 thread 文件
- [x] 可用 `Codex SDK resumeThread(threadId)` 继续原生 thread
- [ ] 将该 thread 同步进 `CodingNS`
- [ ] 在 `CodingNS` 中继续对话
- [ ] 对话后回原生 Codex 继续

## 当前阻断项

- `Codex` 桌面包里的 `codex.exe` 与 `codex-command-runner.exe` 在当前 PowerShell/Host 进程上下文中直接执行会报 `Access is denied`。
- 这说明 `Codex` 不能把桌面打包的 exe 当作稳定后端入口，运行时设计应优先走官方 SDK。
- `Claude Code` 的 PowerShell 别名 `claude.ps1` 会被本机执行策略拦截，但 `claude.cmd` 可正常使用，因此后端调用必须避开 `.ps1`。

## 当前结论

- `Claude Code`：CLI 真实可用，支持新建、恢复、流式输出。
- `Codex`：官方 SDK 真实可用，支持新建、恢复、事件流；桌面 exe 入口不适合直接作为 Host 后端入口。
