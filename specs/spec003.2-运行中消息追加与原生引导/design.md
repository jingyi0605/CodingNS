# 设计文档 - spec003.2 运行中消息追加与原生引导

状态：Draft

## 1. 概述

### 1.1 目标

- 在不推翻 `spec003.1` 运行时主链路的前提下，补上“运行中输入”能力。
- 让 `Claude Code` 走原生长连接输入，让 `Codex` 只暴露当前真实可确认的原生语义。
- 保证同一 `sessionId` 在运行中仍然只有一条执行真相。

### 1.2 覆盖需求

- `requirements.md` 需求 1：明确暴露运行中输入能力矩阵
- `requirements.md` 需求 2：`Claude Code` 支持长连接运行中追加指导
- `requirements.md` 需求 3：`Codex` 只对齐原生 `queue/steer` 语义
- `requirements.md` 需求 4：运行中输入复用现有 active run
- `requirements.md` 需求 5：前端按真实能力降级
- `requirements.md` 需求 6：保持向后兼容

### 1.3 技术约束

- 继续复用现有 `ProviderRuntimeService`、`ActiveRunRegistry`、`SessionLiveRuntimeService`
- 默认不新增新的 HTTP 路由
- 默认不新增新的持久化表
- `Claude Code` 必须改用可持续输入的进程接法
- `Codex` 不得在项目内模拟一套伪原生 queue

## 2. 架构

### 2.1 核心思路

当前设计的主要问题不是“不能发消息”，而是“所有消息都只能走 start/continue 语义”。这很蠢，因为运行中的会话和静止会话根本不是一回事。

这次改造只做一件事：给 active run 增加一个可选的“运行中提交输入”入口。

简单说：

1. 会话未运行：继续走现有 `startSession/continueSession`
2. 会话运行中且支持运行中输入：把输入送给现有 active run
3. 会话运行中但不支持：明确拒绝

### 2.2 能力模型

新增统一能力字段：

```ts
type InRunInputMode = "none" | "streaming_guidance" | "queued_guidance";
```

语义说明：

- `none`
  当前 provider 或当前接入层不支持运行中输入
- `streaming_guidance`
  当前运行尚未结束时，新输入可直接进入同一长连接会话
- `queued_guidance`
  当前运行尚未结束时，新输入进入 provider 原生队列，等上一轮结束后再处理

默认策略：

- `Claude Code`：`streaming_guidance`
- `Codex`：初始保持 `none`
- 仅当确认当前接入层稳定支持原生 queue/steer 后，`Codex` 才可切换为 `queued_guidance`

### 2.3 模块职责调整

| 模块 | 现状 | 本次调整 |
| --- | --- | --- |
| `ProviderCapabilities` | 只描述静态发送/中断等能力 | 增加 `inRunInputMode` |
| `ActiveRunHandle` | 仅能中断、订阅、释放 | 增加可选 `submitDuringRun` |
| `ProviderRuntimeService` | 只负责 start/continue/interrupt | 增加 `submitToActiveRun` |
| `ClaudeRuntimeAdapter` | 一轮一个进程 | 改成长连接进程 + `stdin/jsonl` 输入 |
| `CodexRuntimeAdapter` | 一轮一个 `runStreamed(...)` | 先只暴露真实能力，不伪造 queue |
| `SessionLiveRuntimeService` | 发送消息时只会 start/continue | 先判断 active run 是否支持运行中输入 |
| `ComposerPanel` | 运行中统一禁发 | 按 `inRunInputMode` 决定文案和是否可发 |

## 3. 数据结构与接口

### 3.1 能力结构

在 `ProviderCapabilities`、`ProviderCapabilitiesDto`、`SessionRuntimeDto` 中新增：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `inRunInputMode` | `none \| streaming_guidance \| queued_guidance` | 运行中输入模式 |

可选补充字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `inRunInputLabel` | `string \| null` | 前端显示文案，可选 |

最小方案下，前端也可以自己根据 `inRunInputMode` 映射文案，不强制后端下发 `label`。

### 3.2 运行时合同

在 `packages/session-sync-core/src/runtime/types.ts` 中扩展：

```ts
interface ActiveRunHandle {
  submitDuringRun?: (options: RuntimeSendOptions) => Promise<void>;
}

interface ProviderRuntimeLaunchResult {
  submitDuringRun?: ((options: RuntimeSendOptions) => Promise<void>) | null;
}
```

说明：

- 这是最小改动，因为不需要重写 `ActiveRunRegistry` 的核心状态模型
- 不支持运行中输入的 provider 可以不实现

### 3.3 HTTP 语义

继续复用：

- `POST /api/sessions/{sessionId}/messages/live`

语义调整为：

1. 若无 active run：沿用当前逻辑，走 start/continue
2. 若有 active run 且支持 `submitDuringRun`：提交到当前 active run
3. 若有 active run 但不支持：返回明确错误 `IN_RUN_INPUT_NOT_SUPPORTED`

这样做的好处：

- API 形状不变
- 前端改动小
- 向后兼容最好

### 3.4 错误码

新增或显式化以下错误：

| 错误码 | 场景 |
| --- | --- |
| `IN_RUN_INPUT_NOT_SUPPORTED` | 当前会话在运行中，但 provider/接入层不支持运行中输入 |
| `IN_RUN_INPUT_REJECTED` | provider 拒绝本次运行中输入 |
| `IN_RUN_INPUT_QUEUE_UNAVAILABLE` | 预期支持排队，但当前接入层未能建立原生 queue |

`ACTIVE_RUN_EXISTS` 不应该再直接裸露给上层。对于支持运行中输入的 provider，这不是错误，而是分支条件。

## 4. Provider 方案

### 4.1 Claude Code

#### 4.1.1 现状问题

- 当前实现使用 `claude -p ...`
- 子进程 `stdin` 没有接入持续输入
- 每轮都是一次性请求

#### 4.1.2 改造方案

- 改为启动可持续存在的 Claude 进程
- 输入走 `--input-format stream-json`
- 输出继续走 `--output-format stream-json`
- 首条消息和运行中追加消息都通过同一 `stdin` 写入
- 继续复用当前 stdout 流事件解析和 session binding 刷新逻辑

#### 4.1.3 结果

- 同一 active run 可以接受多次运行中指导
- 不需要再为运行中输入创建新的 active run
- 会话真相仍然是同一个 Claude 原生 session

### 4.2 Codex

#### 4.2.1 现状问题

- 当前实现是一轮一个 `runStreamed(...)`
- 公开资料可以确认有 `queue/steer` 语义，但不能确认“当前 turn 立即吸收新消息”

#### 4.2.2 改造方案

- 第一阶段只新增能力字段，不新增行为
- 默认 `inRunInputMode = "none"`
- 若后续确认当前接入层可稳定调用原生 queue/steer，则只补一个 `queued_guidance` 分支
- 绝不在项目层引入私有队列来伪装成原生能力

#### 4.2.3 结果

- `Codex` 行为真实
- 不会误导用户
- 不会为将来接官方能力制造兼容负债

## 5. 关键流程

### 5.1 会话未运行时发送消息

1. 前端调用现有 `messages/live`
2. Host 检查无 active run
3. 继续走 `start/continue`
4. 行为与 `spec003.1` 保持一致

### 5.2 会话运行中，支持流式引导

1. 前端调用现有 `messages/live`
2. Host 发现 active run 存在且 `submitDuringRun` 可用
3. Host 直接把消息交给该 active run
4. Adapter 将输入写入现有长连接
5. 后续事件继续从同一流返回

### 5.3 会话运行中，仅支持排队引导

1. 前端调用现有 `messages/live`
2. Host 发现 active run 存在且模式为 `queued_guidance`
3. Adapter 调用 provider 原生 queue/steer
4. Host 返回“已加入队列”
5. 当前轮结束后，provider 原生开始处理后续输入

### 5.4 会话运行中，不支持运行中输入

1. 前端调用现有 `messages/live`
2. Host 检查 active run 存在但 `submitDuringRun` 不可用
3. Host 返回 `IN_RUN_INPUT_NOT_SUPPORTED`
4. 前端维持禁用或错误提示，不创建第二条执行链

## 6. 前端交互

### 6.1 输入区规则

按 `inRunInputMode` 决策：

| 模式 | 运行中输入框 | 主按钮文案 |
| --- | --- | --- |
| `none` | 禁用 | 保持当前运行态提示 |
| `streaming_guidance` | 可用 | `追加指导` |
| `queued_guidance` | 可用 | `加入队列` |

### 6.2 兼容策略

- 若旧前端未识别 `inRunInputMode`，默认退化为当前禁用逻辑
- 若旧后端未返回该字段，前端视为 `none`

## 7. 风险与约束

### 7.1 主要风险

- `Claude Code` 长连接输入的真实 CLI 参数与本机版本差异
- `Codex` 的 queue/steer 在当前 SDK 接入层未稳定暴露
- 运行中输入后，消息对账与 accepted message 匹配可能更复杂

### 7.2 控制策略

- 先只打通 `Claude`
- `Codex` 先做能力显式化，不抢跑实现
- 不改现有历史同步和消息归一化主结构，只补运行中输入分支

## 8. 验收策略

### 8.1 Claude

- 启动会话后，在运行过程中追加一条指导
- 验证无需中断、无需第二个 active run
- 验证后续事件仍落在同一原生 session

### 8.2 Codex

- 验证能力展示与当前接入能力一致
- 若未接入 queue/steer，则运行中输入必须明确禁用
- 若后续接入 queue/steer，则验证文案与行为是“加入队列”而不是“立即生效”
