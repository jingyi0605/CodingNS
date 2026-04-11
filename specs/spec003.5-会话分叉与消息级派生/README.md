# spec003.5-会话分叉与消息级派生

## 当前定位

这个 Spec 只解决一件事：

- 在 `codingns` 里把“会话分叉”做成一个真实可验证的能力，而且第一阶段只做**消息级派生**

这里先把边界说死，免得后面又写歪：

- 这一步不追求 1:1 还原 provider 内部黑盒状态
- 这一步不设计 Git worktree 隔离
- 这一步不碰代码运行副作用快照
- 这一步只要求 fork 出来的子会话知道 fork 前聊过什么，并且可以继续稳定对话

一句话说清楚：先把“从某个历史节点继续聊下去”做成，再谈更重的状态树恢复。

## 核心判断

- ✅ 值得做：这是用户真实需要，而且三家目标 CLI 里至少两家已经有官方 fork 入口，剩下一家也能通过 transcript 重建做出可用版本。
- 第一阶段正确目标不是“状态树分叉”，而是“消息树分叉 + 平台统一维护父子关系和 fork 锚点”。

## 本轮实测结论

2026-04-10 已完成对三家工具的真实测试，不是只看文档：

1. `Codex`
   - 已验证 `codex exec resume <thread_id>` 可继续原会话
   - 已验证通过 `codex app-server` 的 `thread/fork` 可以得到原生子线程
   - 已验证通过 `thread/read` + `thread/resume(history=截断后的历史)` 可以实现“按任意历史消息点派生”
2. `Claude Code`
   - 已验证 `claude --resume <session_id> --fork-session` 可以做原生会话 fork
   - 公开 CLI 能力没有证明支持“按 message id 原生 fork”
   - 已验证可通过 transcript 读取 + 历史截断重建 prompt，实现“按任意历史消息点派生”
3. `OpenCode`
   - 已验证 `opencode run --session <id> --fork` 可做原生会话 fork
   - 已验证官方 server `POST /session/:id/fork` 支持 `messageID`，可按任意消息点原生 fork

## 当前项目现状

`codingns` 不是完全没有树，已经有一半：

- SQLite `session_indices.parent_session_id` 已存在
- `apps/host/src/modules/sessions/session-history-service.ts` 已会把 provider 的父会话关系映射到本地 `parentSessionId`
- `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx` 已按 `parentSessionId` 构树显示

但这套东西现在还不够，因为它只会“认出已有父子会话”，不会“主动创建 fork”。

当前最大缺口有两个：

1. `packages/session-sync-core` 还没有统一的 `forkSession` 合同
2. 平台还没有统一保存 fork 元数据，例如：
   - fork 是从哪个会话来的
   - fork 是从哪个消息锚点来的
   - fork 用的是原生 fork 还是重建 fork

## 计划覆盖

- 固化三家 CLI 的真实测试结果和调用方式
- 定义统一 fork 能力分级
- 定义平台统一维护的 fork 元数据
- 规划最小接入顺序：`Codex -> Claude Code -> OpenCode`
- 规划前端统一展示父子关系和 fork 来源

## 本阶段明确不做

- 不做 Git worktree / shell 副作用隔离
- 不做 provider 内部黑盒状态快照
- 不做完整原始消息账本重建
- 不做工具调用结果的跨 provider 继承

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
