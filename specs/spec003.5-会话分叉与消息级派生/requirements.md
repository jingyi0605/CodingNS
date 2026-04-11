# 需求文档 - spec003.5 会话分叉与消息级派生

状态：Draft

## 1. 背景

用户现在要的不是“完美状态树恢复”，而是一个更实际的能力：

- 在 `codingns` 里选中某条历史消息
- 从这里 fork 出一个子会话
- 子会话知道 fork 前聊过什么
- 子会话能继续稳定对话
- 前后端都能看见父子关系

这个问题如果还按“平台自己重做全部会话状态真相”来开局，会直接把复杂度做炸。

第一阶段真正要解决的，是下面三个现实问题：

1. 三家 provider 的 fork 能力不一致，必须统一抽象
2. 用户要求从任意历史消息点 fork，不能只支持“从最新消息继续”
3. 不管 provider 原生能力如何，`codingns` 都必须自己维护父子会话和 fork 来源

## 2. 目标

本 Spec 第一阶段只达成下面六件事：

1. 后端提供统一的会话 fork 动作，不再让每家 provider 各玩各的
2. 支持从任意历史消息点发起 fork 请求
3. 平台统一保存父子会话关系和 fork 元数据
4. fork 出来的子会话可以继续收发消息
5. 前端按统一标准展示父子会话关系和 fork 来源
6. 三家 provider 的接入方式和降级策略明确可实施

## 3. 非目标

下面这些明确不在本阶段做：

- 不做 Git 工作树隔离
- 不做 shell 进程副作用继承
- 不做 workspace 文件状态快照与恢复
- 不做完整原始消息账本
- 不做跨 provider 的 tool result 复用
- 不追求 1:1 还原 CLI 内部压缩态、摘要态和隐式记忆

## 4. 术语说明

- **会话 fork**：从一个已有会话或会话中的某个历史锚点，派生出一个新的可继续对话的子会话。
- **会话级 fork**：只指定父会话，不指定具体消息锚点，通常等价于“从当前已知上下文继续分叉”。
- **消息级 fork**：指定某条历史消息作为 fork 锚点，从这条消息之前的上下文派生子会话。
- **原生会话 fork**：provider 官方接口直接支持从现有会话 fork。
- **原生消息 fork**：provider 官方接口直接支持按 message id 或等价历史片段 fork。
- **重建型消息 fork**：平台读取历史消息，截断到目标锚点，再把这段历史重组成新 prompt，启动新会话。
- **fork 锚点**：本次 fork 绑定的来源位置，可能是 `session`，也可能是 `message`。

## 5. 用户故事

### 5.1 日常对话分支用户

作为日常同时探索多种方案的用户，我希望从任意一条历史消息开始 fork，而不是只能从最后一条消息继续，这样我才能把某个思路单独拉出去继续聊。

### 5.2 Provider 接入开发者

作为 provider 接入开发者，我希望后端定义统一的 fork 合同和统一的元数据保存方式，这样接入新的 CLI 时不用再从头设计父子关系展示。

### 5.3 前端开发者

作为前端开发者，我希望无论底层是 Codex、Claude Code 还是 OpenCode，父子会话关系和 fork 来源字段都长得一样，这样树状展示不用写一堆 provider 特判。

## 6. 功能需求

### 6.1 后端必须提供统一 fork 动作

1. WHEN 用户对某个会话发起 fork THEN System SHALL 提供统一后端入口执行 fork，而不是前端直接拼 provider 命令。
2. WHEN fork 请求进入后端 THEN System SHALL 记录本次 fork 采用的 provider、方法、来源会话和来源锚点。
3. WHEN provider 不支持原生消息级 fork THEN System SHALL 允许降级到重建型消息 fork，但必须明确标记方法类型。

### 6.2 系统必须支持任意历史消息点 fork

1. WHEN 用户在某条历史消息上点击 fork THEN System SHALL 允许把该消息作为 fork 锚点提交到后端。
2. WHEN 目标 provider 原生支持消息级 fork THEN System SHALL 优先走原生消息级 fork。
3. WHEN 目标 provider 只支持会话级 fork，但项目侧能读取历史 THEN System SHALL 允许通过历史截断重建实现消息级 fork。
4. WHEN 历史消息不足以安全重建 THEN System SHALL 返回明确错误，而不是静默降级成“从最新消息 fork”。

### 6.3 平台必须统一维护父子关系和 fork 元数据

1. WHEN 任意 fork 成功 THEN System SHALL 在后端保存 `parentSessionId`。
2. WHEN 任意 fork 成功 THEN System SHALL 保存 fork 来源类型，例如 `session` 或 `message`。
3. WHEN 任意 fork 成功 THEN System SHALL 保存 fork 来源引用，例如来源 `sessionId`、来源 `messageId`、来源 provider session id、来源 provider message id。
4. WHEN 任意 fork 成功 THEN System SHALL 保存 fork 方法，例如 `native_session_fork`、`native_message_fork`、`reconstructed_message_fork`。

### 6.4 fork 出来的子会话必须可继续运行

1. WHEN 子会话创建成功 THEN System SHALL 能像普通会话一样继续发送消息和接收回复。
2. WHEN 子会话继续对话 THEN System SHALL 不得污染父会话记录。
3. WHEN 子会话再次 fork THEN System SHALL 允许继续派生更深的子分支。

### 6.5 前端必须统一展示父子关系和 fork 来源

1. WHEN 会话存在父子关系 THEN 前端 SHALL 统一按后端返回的 `parentSessionId` 构树显示。
2. WHEN 会话是 fork 产生 THEN 前端 SHALL 能显示 fork 来源类型和方法，不依赖 provider 名称去猜。
3. WHEN 用户从历史消息点发起 fork THEN 前端 SHALL 能把该历史锚点带到后端，不允许只支持最新消息。

### 6.6 三家 provider 都必须接入统一分级合同

1. WHEN 接入 `codex` THEN System SHALL 支持原生会话 fork 和消息级派生。
2. WHEN 接入 `claude-code` THEN System SHALL 支持原生会话 fork，并支持 transcript 重建的消息级派生。
3. WHEN 接入 `opencode` THEN System SHALL 支持原生会话 fork，并支持官方 message-level fork。

## 7. 非功能需求

### 7.1 兼容性

1. 不得破坏现有会话列表、历史回放和实时消息主流程。
2. 不得要求前端为不同 provider 维护不同树结构。
3. 不得把“消息级 fork”偷换成“总是从最新状态 fork”。

### 7.2 可排障性

1. WHEN fork 失败 THEN 后端日志 SHALL 能看出是 provider 原生失败、历史读取失败还是重建失败。
2. WHEN 需要排查父子关系错误 THEN 后端 SHALL 能查出 fork 来源和方法。
3. WHEN provider 后续补齐更强原生能力 THEN 当前元数据 SHALL 足以看出哪些历史分支是重建型，哪些是原生型。

### 7.3 最小复杂度

1. System SHALL 优先复用现有 `SessionHistoryService`、provider runtime、provider adapter 和会话树展示。
2. System SHALL 不在第一阶段引入完整消息账本或完整状态快照系统。
3. System SHALL 允许各 provider 采用不同 fork 实现，但对外字段和行为必须统一。

## 8. 验收重点

1. 前端可以对任意历史消息发起 fork 请求。
2. 后端能统一保存父子关系和 fork 来源。
3. Codex 可以从指定历史消息点派生出知道旧上下文的新会话。
4. Claude Code 可以从指定历史消息点通过 transcript 重建派生出知道旧上下文的新会话。
5. OpenCode 可以通过官方 message-level fork 从指定消息点派生新会话。
6. 树状展示不需要为三家 provider 分别写特殊结构。
