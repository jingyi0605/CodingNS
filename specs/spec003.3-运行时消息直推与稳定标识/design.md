# 设计文档 - spec003.3 运行时消息直推与稳定标识

状态：Draft

## 1. 概述

### 1.1 目标

- 把聊天正文从“历史轮询补回来”改成“运行时直接推过来”
- 让历史层回到本职工作，只负责回放和补偿
- 给 `claude-code`、`codex`、`opencode` 建立清楚的稳定消息 ID 规则
- 保持前端合并逻辑可复用，不把问题甩给 UI 重写

### 1.2 覆盖范围

- `packages/session-sync-core` 的 runtime 消息模型和 provider 归一化策略
- `apps/host` 的会话 WS 转发链路和历史补偿边界
- `apps/user-app` 的实时客户端事件类型和消息合并入口

### 1.3 不覆盖范围

- 消息富内容 UI 重做
- provider 新能力接入
- 会话列表或工作台布局重写

## 2. 核心判断

### 【核心判断】

✅ 值得做：当前主问题不是 UI 不会渲染，而是消息通道把“实时正文”和“历史回放”搅在一起了。

### 【关键洞察】

- 数据结构：真正应该稳定的是“逻辑消息 ID”，不是 runtime sequence。
- 复杂度：如果正文继续绕历史层，去重逻辑永远会把“更新”误判成“重复”。
- 风险点：一旦实时正文和历史补偿没有清楚来源边界，就会出现重复消息、迟到覆盖和状态回退。

## 3. 现状问题

### 3.1 当前链路

现在的链路是：

1. provider runtime 产出 `RuntimeEvent.message`
2. Host 持久化 runtime event
3. 聊天 WebSocket 只转发 `runtime_status/runtime_error/interrupted`
4. 前端正文依赖 `session.backfill/session.delta`
5. 历史层每 300ms 轮询 provider 历史

这条路的问题有两个：

- 正文不是实时主链路
- 历史层的消息去重只认 `messageId`，不认“同一消息的新版本”

### 3.2 为什么这是坏味道

历史层本来就该做三件事：

1. 首屏回放
2. 断线补偿
3. Host 重启后的恢复

现在硬让它兼职“实时正文分发”，等于让回放层承担了流式语义。这个职责分配本身就是错的。

## 4. 目标结构

### 4.1 新链路

改造后的正文链路：

1. provider runtime 产出 `RuntimeEvent.message`
2. Host 直接把消息转成 WebSocket 事件推给前端
3. 前端把实时正文并入现有消息列表
4. 历史层只在首屏、断线、恢复时补偿

### 4.2 事件模型

新增独立事件，而不是复用历史事件冒充：

```ts
type SessionRuntimeMessageEnvelope = {
  type: "session.runtime_message";
  sessionId: string;
  message: HistoryMessageDto;
  source: "runtime";
};
```

这样做的原因很简单：

- `session.delta` 语义上是历史增量
- `session.runtime_message` 语义上是运行时直推
- 两种来源必须能在日志、调试和去重时区分清楚

## 5. 模块设计

### 5.1 session-sync-core

#### 5.1.1 RuntimeEvent 继续作为统一入口

`RuntimeEvent.message` 不需要推倒重来，真正要改的是每个 provider 怎样生成稳定消息 ID。

#### 5.1.2 三家 provider 的消息身份策略

##### `opencode`

- 继续沿用 `part` 级 `rawRef`
- `messageId = messageIdFromRawRef(partRawRef)`
- 同一 `part` 的 delta/update 都映射到同一消息

这家现在的数据结构最像样，不该乱动。

##### `claude-code`

- 不再使用 runtime sequence 参与消息身份
- 为每个逻辑 part 建立稳定 identity key
- key 组成优先级：
  1. `tool_use.id` / `tool_result.tool_use_id`
  2. provider 原始消息时间戳 + 角色 + `partIndex` + `part.type`
  3. 仅在没有更好锚点时，退化为当前 turn 内的稳定槽位

实现上需要在 runtime adapter 里维护“当前正在更新的 part 槽位”，而不是每次 emit 都重新造一个 sequence message。

##### `codex`

- 当前只按 `item.completed` / `item.started` 产出消息
- 工具调用优先使用 `item.id` / `call_id`
- assistant text / reasoning 只按 item 级输出
- 不做 token 级 partial，因为现在没有可信的 partial 输入

这一步的原则是：没有真实增量，就别造假。

### 5.2 Host

#### 5.2.1 运行时订阅要能转发正文

当前 `mapRuntimeEventToEnvelope` 直接把 `message` 丢掉，这里必须改。

目标行为：

1. `RuntimeEvent.message` 直接映射为 `session.runtime_message`
2. `status/error/interrupted` 保持原有事件类型
3. 聊天 WebSocket 在同一连接里同时收到实时正文和状态

#### 5.2.2 历史层只保留两种触发方式

保留：

1. 首次订阅时的 `session.backfill`
2. 连接中断、页面重连、Host 恢复后的补偿 `session.delta`

收敛：

- 正常实时连接期间，历史层不再承担正文主推送职责

#### 5.2.3 去重规则

Host 不应该只靠 `sentMessageIds` 永久屏蔽同 ID 消息。

新的判断应该是：

1. 同一来源、同一 `messageId`、同一内容签名：丢弃
2. 同一 `messageId` 但内容签名变了：视为更新，允许继续下发
3. 历史层补偿到同一 `messageId` 的终态版本：允许覆盖实时版本

### 5.3 user-app

#### 5.3.1 WebSocket 客户端

前端实时客户端新增 `session.runtime_message` 事件类型。

这个事件进入的不是新 store，而是现有 `SessionRuntimeStore` 的消息合并入口。

#### 5.3.2 store 合并策略

继续复用当前 `mergeAuthoritativeMessages` 思路，但补上一个明确前提：

- 同一 `messageId` 的运行时消息，允许覆盖已有内容

换句话说，这里不是重做 store，而是把输入喂对。

#### 5.3.3 时间线

时间线组件已经具备“最后一条消息内容变化时继续滚动到底部”的能力，这部分不需要重做。

## 6. 数据流

### 6.1 正常实时连接

1. 用户发送消息
2. provider runtime 开始执行
3. runtime 产出 `RuntimeEvent.message`
4. Host 转发 `session.runtime_message`
5. 前端按 `messageId` 合并并刷新
6. 历史层稍后可回放同一条消息的确认版本

### 6.2 断线重连

1. WebSocket 中断
2. 前端保留已有消息
3. 重新订阅后先拿 `session.backfill/session.delta`
4. 按稳定 `messageId` 合并遗漏内容
5. 后续恢复接收 `session.runtime_message`

### 6.3 Host 重启

1. 活动 runtime 句柄丢失
2. 历史层成为恢复真相的唯一来源
3. 前端收到补偿历史，不伪造仍然实时运行

## 7. Provider 方案

### 7.1 Claude Code

优先做成“同一条消息续写”。

原因：

- 这家已经是长连接输入输出
- 本来就有 partial/progress 价值
- 现在的问题只是身份策略太烂

### 7.2 Codex

按块级输出落地。

本阶段明确：

- 可实时显示完成的 `agent_message`
- 可实时显示完成的 `reasoning`
- 可实时显示工具调用开始和结束
- 不承诺 token 级逐字输出

### 7.3 OpenCode

优先利用它已有的 `part` 级结构。

本阶段关键动作：

- `message.part.delta` 更新内存后，要允许产出新的 runtime message 更新
- 同一 `partId` 反复 emit 时保持同一个 `messageId`

## 8. 风险与对策

### 8.1 重复消息

风险：

- 运行时直推一遍
- 历史补偿再来一遍

对策：

- 明确区分来源
- 统一按稳定 `messageId + 内容签名` 合并

### 8.2 终态被迟到消息打回

风险：

- 会话已完成
- 迟到正文或补偿消息又把状态拖回 `running`

对策：

- 正文更新消息列表，不直接决定运行状态
- 终态只允许被更强的终态或显式恢复动作改变

### 8.3 Claude 稳定 identity 不够稳

风险：

- partial 更新找不到正确旧消息

对策：

- 在 runtime adapter 内建立 part identity resolver
- 先覆盖最常见的 `text/thinking/tool_use/tool_result`
- 难以稳定映射的极端情况，允许退回块级消息，但不能继续用 sequence 作为长期身份

## 9. 验证策略

### 9.1 session-sync-core

- `opencode` 同一 `partId` 多次更新，消息 ID 不变
- `claude-code` 同一逻辑 partial 更新，消息 ID 不变
- `codex` 完成级消息保持块级，不额外拆 token

### 9.2 host

- `RuntimeEvent.message` 能直接转成 WS 事件
- 历史补偿不再是实时正文必经链路
- 同 ID 不同内容的消息更新不会被错误去重

### 9.3 user-app

- `session.runtime_message` 能并入现有消息流
- 同一条消息续写时不会新增第二个气泡
- 最后一条消息变化时仍会自动滚动
