# 任务清单 - spec003.5 会话分叉与消息级派生（人话版）

状态：TODO

## 这份文档是干什么的

这份任务清单用来把“会话分叉”拆成能落地的步骤。

这次必须避免两个典型烂做法：

1. 嘴上说支持 fork，实际上只能从当前最新消息继续
2. 父子关系完全跟着 provider 跑，平台自己不记任何 fork 来源

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已完成，待复核
- `DONE`：已经完成并回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻回写本文档
- `BLOCKED` 必须写清楚卡在哪里

---

## 阶段 0：先把 fork 抽象和元数据钉死

- [x] 0.1 定义统一 fork 能力分级
  - 状态：DONE
  - 这一步到底做什么：把 `native_session_fork`、`native_message_fork`、`reconstructed_message_fork` 三种方法定义清楚，并补到 `session-sync-core` 合同里。
  - 做完以后能看到什么结果：后续三家 provider 可以按同一套名字返回 fork 能力，不再各写各的术语。
  - 这一步依赖什么：无
  - 主要改哪些文件：
    - `specs/spec003.5-会话分叉与消息级派生/requirements.md`
    - `specs/spec003.5-会话分叉与消息级派生/design.md`
    - `packages/session-sync-core/src/types.ts`
    - `packages/session-sync-core/src/services.ts`
  - 这一步明确不做什么：先不写具体 provider 逻辑。
  - 怎么验证是不是真的做完了：
    1. 核心类型里存在统一 fork 方法枚举
    2. Host 可以消费统一 fork 结果

- [x] 0.2 设计并落地平台 fork 元数据存储
  - 状态：DONE
  - 这一步到底做什么：新增 `session_forks` 表或等价存储，保存 `parentSessionId`、`forkSourceType`、`forkSourceMessageId`、`forkMethod` 等字段。
  - 做完以后能看到什么结果：平台可以独立于 provider 追踪父子关系和 fork 来源。
  - 这一步依赖什么：0.1
  - 主要改哪些文件：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/sqlite/client.ts`
    - 新增 `apps/host/src/storage/repositories/session-fork-repository.ts`
    - `apps/host/src/types/domain.ts`
  - 这一步明确不做什么：先不重做全文消息库。
  - 怎么验证是不是真的做完了：
    1. 新会话可以写入 fork 元数据
    2. 单查会话时能读到 fork 元数据

---

## 阶段 1：Host 统一提供 fork 接口

- [x] 1.1 新增 Host fork API
  - 状态：DONE
  - 这一步到底做什么：提供统一后端入口，接受 `sessionId + sourceMessageId` 发起 fork。
  - 做完以后能看到什么结果：前端终于有一个稳定入口发起会话级或消息级 fork。
  - 这一步依赖什么：0.1、0.2
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/session-controller.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - 必要时新增 `apps/host/src/modules/sessions/session-fork-service.ts`
  - 这一步明确不做什么：先不做前端按钮。
  - 怎么验证是不是真的做完了：
    1. API 能接收 `sourceType=session|message`
    2. 成功返回新的子会话和 fork 方法

- [x] 1.2 统一返回父子关系和 fork 来源 DTO
  - 状态：DONE
  - 这一步到底做什么：把 fork 元数据补到会话详情和列表 DTO，保证前端不用再猜。
  - 做完以后能看到什么结果：前端拿到的每个分支会话都知道自己从哪来、怎么来的。
  - 这一步依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/types/domain.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
  - 这一步明确不做什么：先不改页面展示。
  - 怎么验证是不是真的做完了：
    1. DTO 里能看到 `forkMethod`
    2. DTO 里能看到 `forkSourceType`

---

## 阶段 2：先接 Codex

- [x] 2.1 接入 Codex 原生会话 fork
  - 状态：DONE
  - 这一步到底做什么：在现有 app-server helper 基础上补 `thread/fork`，让 Host 能创建 Codex 子会话。
  - 做完以后能看到什么结果：Codex 会话可以直接分叉，并写回平台父子关系。
  - 这一步依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/codex-app-server-helper-process.ts`
    - `packages/session-sync-core/src/providers/codex.ts`
    - `packages/session-sync-core/src/runtime/codex-runtime.ts`
  - 这一步明确不做什么：先不做任意历史消息点。
  - 怎么验证是不是真的做完了：
    1. 原会话 fork 成功
    2. 新子会话可以继续发送消息

- [x] 2.2 接入 Codex 消息级派生
  - 状态：DONE
  - 这一步到底做什么：补 `thread/read` + 历史截断 + `thread/resume(history)`，实现按任意历史消息点派生。
  - 做完以后能看到什么结果：用户可在历史消息上 fork，并且子会话记得锚点之前的对话。
  - 这一步依赖什么：2.1
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/codex-app-server-helper-process.ts`
    - `packages/session-sync-core/src/providers/codex.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
  - 这一步明确不做什么：不碰 Git worktree。
  - 怎么验证是不是真的做完了：
    1. 指定第一轮消息 fork 后，子会话回答的是第一轮上下文
    2. 平台记录 `forkMethod = native_message_fork`

---

## 阶段 3：再接 Claude Code

- [ ] 3.1 接入 Claude Code 原生会话 fork
  - 状态：TODO
  - 这一步到底做什么：补 `--resume <session_id> --fork-session` 的统一接入。
  - 做完以后能看到什么结果：Claude 会话可以直接分叉。
  - 这一步依赖什么：1.1
  - 主要改哪些文件：
    - `packages/session-sync-core/src/providers/claude-code.ts`
    - `packages/session-sync-core/src/runtime/claude-runtime.ts`
  - 这一步明确不做什么：先不做消息级派生。
  - 怎么验证是不是真的做完了：
    1. `forkMethod = native_session_fork`
    2. 新会话能延续原上下文继续对话

- [ ] 3.2 接入 Claude transcript 重建消息 fork
  - 状态：TODO
  - 这一步到底做什么：读取 transcript，截断到目标消息，重建 prompt 启新会话。
  - 做完以后能看到什么结果：虽然不是原生 message fork，但用户可以从任意历史消息点继续对话。
  - 这一步依赖什么：3.1
  - 主要改哪些文件：
    - `packages/session-sync-core/src/providers/claude-code.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - 必要时新增 transcript 重建辅助模块
  - 这一步明确不做什么：不假装这是原生 message fork。
  - 怎么验证是不是真的做完了：
    1. 指定历史消息后，新会话记住的是该锚点前的上下文
    2. 平台记录 `forkMethod = reconstructed_message_fork`

---

## 阶段 4：最后接 OpenCode

- [ ] 4.1 接入 OpenCode 原生会话 fork
  - 状态：TODO
  - 这一步到底做什么：补 CLI `--fork` 或 server 等价接口接入。
  - 做完以后能看到什么结果：OpenCode 会话可直接产生子会话，并写回统一元数据。
  - 这一步依赖什么：1.1
  - 主要改哪些文件：
    - `packages/session-sync-core/src/providers/opencode.ts`
    - `packages/session-sync-core/src/runtime/opencode-runtime.ts`
  - 这一步明确不做什么：先不做 message-level fork。
  - 怎么验证是不是真的做完了：
    1. `forkMethod = native_session_fork`
    2. 子会话继续对话正常

- [ ] 4.2 接入 OpenCode 原生消息级 fork
  - 状态：TODO
  - 这一步到底做什么：对接官方 `/session/:id/fork` + `messageID`。
  - 做完以后能看到什么结果：OpenCode 可以真正从任意历史消息点原生 fork。
  - 这一步依赖什么：4.1
  - 主要改哪些文件：
    - `packages/session-sync-core/src/providers/opencode.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
  - 这一步明确不做什么：不引入额外状态快照系统。
  - 怎么验证是不是真的做完了：
    1. 历史消息点 fork 成功
    2. 平台记录 `forkMethod = native_message_fork`

---

## 阶段 5：前端统一展示和消息入口

- [x] 5.1 在消息项上提供 fork 入口
  - 状态：DONE
  - 这一步到底做什么：在历史消息项上增加 fork 动作，把目标 `messageId` 传到后端。
  - 做完以后能看到什么结果：用户终于可以对任意历史消息点发起 fork。
  - 这一步依赖什么：1.1、1.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/conversation/components/*`
  - 这一步明确不做什么：先不做复杂确认弹窗。
  - 怎么验证是不是真的做完了：
    1. 历史消息上能看到 fork 动作
    2. 点击后会创建新子会话

- [x] 5.2 树结构统一展示 fork 来源
  - 状态：DONE
  - 这一步到底做什么：在现有树结构基础上展示父子关系和 fork 来源方法。
  - 做完以后能看到什么结果：用户可以看出某个分支是原生 fork 还是重建 fork。
  - 这一步依赖什么：1.2、5.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
  - 这一步明确不做什么：不重做整个工作台布局。
  - 怎么验证是不是真的做完了：
    1. 树节点能显示父子关系
    2. 分支来源文案正确

---

## 阶段 6：测试与验收

- [ ] 6.1 补 Host 和 provider 集成测试
  - 状态：TODO
  - 这一步到底做什么：分别覆盖 Codex、Claude、OpenCode 的会话级和消息级 fork。
  - 做完以后能看到什么结果：后续改 provider 时不会把 fork 功能 silently 搞坏。
  - 这一步依赖什么：2.2、3.2、4.2
  - 主要改哪些文件：
    - `apps/host/tests/integration/*`
    - `packages/session-sync-core/tests/*`
  - 这一步明确不做什么：不只做手工点点点验证。
  - 怎么验证是不是真的做完了：
    1. 三家 provider 都有 fork 用例
    2. 覆盖会话级和消息级场景

- [ ] 6.2 做阶段验收
  - 状态：TODO
  - 这一步到底做什么：确认“任意历史消息点 fork + 平台统一维护父子关系”已经成型。
  - 做完以后能看到什么结果：可以明确说第一阶段消息级派生闭环成立。
  - 这一步依赖什么：0.1 到 6.1
  - 主要改哪些文件：
    - `specs/spec003.5-会话分叉与消息级派生/tasks.md`
  - 这一步明确不做什么：不把“状态树分叉”混进这次验收。
  - 怎么验证是不是真的做完了：
    1. 用户可从任意历史消息发起 fork
    2. 子会话能继续对话
    3. 前端树结构能正确显示父子关系和来源
