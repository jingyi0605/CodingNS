# 需求文档 - spec003.3 运行时消息直推与稳定标识

状态：Draft

## 1. 背景

当前聊天窗口已经有“真实运行时”和“历史消息同步”两条链路，但正文和状态没走同一条路。

现状大致是这样：

1. provider runtime 在运行时已经产出了消息事件
2. Host 持久化这些事件，但不把正文直接推给聊天 WebSocket
3. 前端再靠历史层轮询把正文补回来

这套做法的问题很现实：

- 用户看到的正文不是第一时间到达
- 同一条消息如果持续变长，后续版本可能被历史去重挡掉
- 状态是实时的，正文是轮询回放的，最后两边容易打架

这个问题不是“体验优化”，而是主链路走偏了。

## 2. 目标

本 Spec 要达成下面四件事：

1. 运行时消息正文直接进入聊天 WebSocket
2. 历史层只负责首屏回放、断线补偿、Host 重启后的真相恢复
3. 三个 provider 都有清楚、稳定、不撒谎的消息 ID 规则
4. 前端继续沿用现有消息合并模型，不额外造一套消息状态机

## 3. 术语说明

- **运行时消息**：provider 在执行过程中实时产出的正文、thinking、工具调用和工具结果
- **历史回放**：按 provider 原生会话真相读取的消息页，用于首屏、补偿和恢复
- **稳定消息 ID**：同一条逻辑消息在后续更新时保持不变的消息标识
- **块级流式**：按完整消息块或步骤更新，不承诺 token 级逐字输出

## 4. 用户故事

### 4.1 聊天中的开发者

作为正在看聊天窗口的开发者，我希望 AI 一有新内容就立刻显示，而不是等一轮历史轮询之后才出现，这样我才能及时判断是不是要继续补充指令。

### 4.2 断线后回来的开发者

作为中途刷新页面或网络抖动后回来的开发者，我希望页面能靠历史回放把遗漏的内容补齐，但不要把已经看到的实时消息重复插一遍。

### 4.3 维护 provider 接入的人

作为后续继续接 provider 的开发者，我希望消息 ID 规则是明确的，不会再出现某家 provider 靠 sequence、另一家靠文件偏移、第三家靠临时去重补丁这种烂摊子。

## 5. 功能需求

### 5.1 运行时正文必须直推

1. WHEN provider runtime 产出消息事件 THEN System SHALL 直接把该消息作为聊天 WebSocket 事件推给前端。
2. WHEN Host 推送运行时正文 THEN System SHALL 不要求前端等待历史轮询才能看到该正文。
3. WHEN 运行时只产生状态事件而没有正文 THEN System SHALL 继续推送状态事件，但不得伪造正文。

### 5.2 历史层退回回放职责

1. WHEN 前端首次打开会话 THEN System SHALL 继续使用历史层回放最近消息。
2. WHEN WebSocket 断线、页面重连或 Host 重启 THEN System SHALL 继续使用历史层补齐遗漏消息。
3. WHEN 会话处于正常实时连接中 THEN System SHALL 不再把历史轮询作为正文主分发链路。

### 5.3 必须有稳定消息标识

1. WHEN `opencode` 推送同一个 `part` 的后续更新 THEN System SHALL 保持同一个消息 ID。
2. WHEN `claude-code` 推送同一逻辑消息的 partial/progress 更新 THEN System SHALL 保持同一个消息 ID，不得继续使用 runtime sequence 当消息身份。
3. WHEN `codex` 当前 SDK 只暴露 completed 级事件 THEN System SHALL 按块级消息处理，不得伪造 token 级流式消息。
4. WHEN 任意 provider 推送同一条逻辑消息的新版本 THEN System SHALL 让前端覆盖更新，而不是追加成第二条重复气泡。

### 5.4 去重必须区分“同一消息更新”和“新消息追加”

1. WHEN 同一消息 ID 再次出现 THEN System SHALL 视为更新。
2. WHEN 新消息 ID 到达 THEN System SHALL 视为新增。
3. WHEN 历史层回放到的消息和运行时直推消息重复 THEN System SHALL 合并，不得重复渲染。

### 5.5 终态保护不能被打坏

1. WHEN 会话已经进入 `completed`、`failed` 或 `interrupted` THEN System SHALL 避免被迟到的实时正文打回错误状态。
2. WHEN 终态之后还需要补历史 THEN System SHALL 只补消息，不把终态覆盖成 `running`。

### 5.6 对现有 UI 的要求要收敛

1. WHEN 新的实时正文事件接入前端 THEN System SHALL 继续复用现有 `session-runtime-store` 消息合并逻辑。
2. WHEN 最后一条消息内容持续变化 THEN System SHALL 继续保持自动滚动到底部。
3. WHEN 本阶段完成 THEN System SHALL 不要求同步重写消息页面结构。

## 6. 非功能需求

### 6.1 时效性

1. WHEN provider runtime 产出第一条正文 THEN System SHALL 尽可能直接推给前端，不再额外引入历史轮询延迟。
2. Host 新增的运行时正文转发链路不得阻塞现有中断、错误和队列调度能力。

### 6.2 兼容性

1. 不得破坏现有会话历史分页接口。
2. 不得破坏现有运行状态查询接口。
3. 不得要求 provider 修改自己的原生会话存储格式。

### 6.3 可排障性

1. 运行时正文事件必须能追溯到 provider 原始消息引用。
2. 当消息合并失败或去重异常时，日志里必须能区分“运行时直推”和“历史回放”来源。

## 7. 非目标

- 不承诺 `codex` 在当前阶段实现 token 级逐字输出
- 不在本阶段实现 OpenCode 的所有富 part 专属 UI
- 不把历史轮询彻底删除
- 不做跨线程、多窗口协同编辑消息

## 8. 验收重点

1. 聊天窗口能先收到运行时正文，再收到历史补偿，而不是反过来。
2. `opencode` 同一 part 的内容增长时，前端表现为同一条消息续写。
3. `claude-code` 运行中 partial 更新不会一段一段插成多条重复气泡。
4. `codex` 维持块级输出，不假装成逐 token 流式。
5. 断线重连后不会因为历史补偿把刚刚的实时正文重复显示。
