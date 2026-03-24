# 本机 SDK / CLI 可行性记录

状态：Draft

## 测试时间

- 2026-03-24

## 测试环境

- 操作系统：Windows
- Node.js：`v22.14.0`
- npm：`10.9.2`
- 用户目录：`C:\\Users\\jackson`

## Claude Code

### 本机入口

- 可执行入口：`C:\\Users\\jackson\\AppData\\Roaming\\npm\\claude.cmd`
- `claude.ps1` 在当前 PowerShell 中会被执行策略拦截，不适合作为后端调用入口

### 已验证能力

- [x] `--version`
- [x] `--help`
- [x] `-p` 非交互请求
- [x] `--session-id <uuid>` 指定原生会话 ID
- [x] `--resume <session-id>` 恢复同一会话
- [x] `--output-format stream-json --verbose --include-partial-messages` 流式输出

### 实测结果

- 版本：`2.1.76 (Claude Code)`
- 最小请求成功返回：`OK`
- 使用自定义 `session-id` 创建并恢复同一会话成功
- 流式输出包含：
  - `system/init`
  - `stream_event`
  - `assistant`
  - `result`

### 结论

- `Claude Code` 路线可以直接纳入 `CodingNS` 的真实运行时方案。
- Host 调用时应固定走 `claude.cmd`，不要依赖 `claude.ps1`。

## Codex

### 本机入口

- 桌面包路径：
  - `C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.313.5234.0_x64__2p2nqsd0c76g0\\app\\resources\\codex.exe`
  - `C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.313.5234.0_x64__2p2nqsd0c76g0\\app\\resources\\codex-command-runner.exe`
- 本机认证文件：`C:\\Users\\jackson\\.codex\\auth.json`

### 已验证能力

- [x] 本机存在可用认证信息
- [x] 本机存在原生历史 thread 文件
- [x] 官方 SDK 可安装并加载
- [x] `Codex.startThread(...)`
- [x] `thread.runStreamed(...)`
- [x] `Codex.resumeThread(threadId, ...)`

### 已知限制

- `codex.exe` 在当前 PowerShell / Host 进程上下文中直接执行报 `Access is denied`
- `codex-command-runner.exe` 同样报 `Access is denied`
- 因此不建议把桌面打包 exe 当作后端正式入口

### 实测结果

- `@openai/codex-sdk` 可安装版本：`0.116.0`
- 最小 thread 创建成功
- 首轮 prompt `只回复OK` 返回 `OK`
- 恢复同一 `threadId` 后继续提问，能记住上一轮上下文并再次返回 `OK`
- 本地 `.codex/sessions/...` 中可见对应原生会话文件

### 结论

- `Codex` 路线应优先走官方 SDK，而不是桌面 exe。
- `CodingNS` 的 `Codex Runtime Adapter` 设计可以直接参考：
  - `new Codex()`
  - `startThread(...)`
  - `resumeThread(threadId, ...)`
  - `thread.runStreamed(prompt, ...)`

## 建议

1. `Claude Code` 运行时优先走 CLI，调用 `claude.cmd`。
2. `Codex` 运行时优先走官方 SDK。
3. 不要把“能读 `.claude/.codex` 会话文件”误当成“能真实继续对话”。
