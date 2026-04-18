# 设计文档 - spec003.2 运行中消息追加与原生引导

状态：Draft

## 1. 概述

### 1.1 目标

- 在不推翻 `spec003.1` 运行时主链路的前提下，补上一层项目内统一发送队列。
- 让 `Claude Code` 与 `Codex` 都能在上一条完成后自动续跑下一条。
- 保证同一 `sessionId` 在任意时刻仍然只有一条执行真相。

### 1.2 覆盖需求

- `requirements.md` 需求 1：明确暴露队列能力
- `requirements.md` 需求 2：项目内统一发送队列
- `requirements.md` 需求 3：支持删除等待项
- `requirements.md` 需求 4：`Claude Code` 直发与队列并存
- `requirements.md` 需求 5：`Codex` 通过项目队列获得连续续跑能力
- `requirements.md` 需求 6：队列续跑复用同一会话
- `requirements.md` 需求 7：前端展示并管理等待队列
- `requirements.md` 需求 8：保持向后兼容

### 1.3 技术约束

- 继续复用现有 `ProviderRuntimeService`、`ActiveRunRegistry`、`SessionLiveRuntimeService`
- 默认不新增新的 HTTP 路由
- 允许新增一张会话级发送队列表
- `Claude Code` 保留当前可持续输入的进程接法
- 队列只负责“上一条结束后自动续跑下一条”，不冒充 provider 原生运行中直发

## 2. 架构

### 2.1 核心思路

当前设计的主要问题不是“不能发消息”，而是“运行中只能靠 provider 当场接受，否则就完全卡死”。这很蠢，因为用户真正要的是串行续跑，而不是关心底层到底是不是同一进程直发。

这次改造做两件事：

1. 保留 provider 原生直发能力
2. 在 Host 层补一条统一发送队列，负责等待、删除和自动续跑

简单说：

1. 会话未运行：仍可直接发送
2. 会话运行中：可选择直发或加入项目队列
3. 当前 run 结束：Host 自动拉起队列中的下一条

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

新增统一队列能力：

```ts
interface SessionQueueCapability {
  enabled: boolean;
  canDeletePending: boolean;
}
```

默认策略：

- 两个 provider 都支持项目统一队列
- `Claude Code` 继续保留 `streaming_guidance`
- `Codex` 改成 `streaming_guidance`，底层通过 `codex app-server` 的 `turn/steer` 直发

### 2.3 模块职责调整

| 模块 | 现状 | 本次调整 |
| --- | --- | --- |
| `ProviderCapabilities` | 只描述静态发送/中断等能力 | 增加 `inRunInputMode` |
| `SessionSendQueueRepository` | 不存在 | 保存等待中的队列项 |
| `SessionSendQueueService` | 不存在 | 负责编排队列、删除等待项、自动续跑 |
| `ProviderRuntimeService` | 负责 start/continue/interrupt | 保持不变，继续作为真正发送执行器 |
| `ClaudeRuntimeAdapter` | 已支持运行中直发 | 保留 |
| `CodexRuntimeAdapter` | 不支持运行中直发 | 接入 `turn/steer`，并保留陈旧 active run 回退 |
| `SessionLiveRuntimeService` | 只负责直接发送 | 增加“排队 / 触发下一条 / steer 失败回退”入口 |
| `ComposerPanel` | 运行中按能力决定是否禁发 | `Claude` 与 `Codex` 都可显示“追加指导”，队列能力继续独立存在 |

### 2.3 队列数据结构

新增持久化表：

```ts
interface SessionSendQueueItem {
  id: string;
  sessionId: string;
  userId: string;
  content: string;
  clientRequestId: string | null;
  runtimeOptionsJson: string | null;
  status: "queued" | "dispatching" | "cancelled" | "failed";
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
}
```

说明：

- `queued`：等待发送，可删除
- `dispatching`：已被调度，不可删除
- `cancelled`：已删除
- `failed`：自动续跑失败，保留给前端提示

原始 provider 历史仍在 provider 自己的 jsonl 中；项目数据库只保存“待发送队列正文”。

## 3. 数据结构与接口

### 3.1 能力结构

在 `ProviderCapabilities`、`ProviderCapabilitiesDto`、`SessionRuntimeDto` 中新增或保留：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `inRunInputMode` | `none \| streaming_guidance \| queued_guidance` | provider 原生运行中输入模式 |
| `queueEnabled` | `boolean` | 项目统一发送队列是否可用 |
| `canDeleteQueuedMessage` | `boolean` | 是否允许删除等待中的队列项 |

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

1. 若请求要求直发且 active run 支持 `submitDuringRun`：提交到当前 active run
2. 若请求要求加入队列：落库为队列项；若当前无 active run，则立即触发队列调度
3. 若无 active run 且请求为普通发送：沿用当前逻辑，直接 start/continue

新增：

- `GET /api/sessions/{sessionId}/queue`
- `POST /api/sessions/{sessionId}/queue`
- `DELETE /api/sessions/{sessionId}/queue/{queueItemId}`

### 3.4 错误码

新增或显式化以下错误：

| 错误码 | 场景 |
| --- | --- |
| `QUEUE_ITEM_NOT_FOUND` | 队列项不存在 |
| `QUEUE_ITEM_NOT_DELETABLE` | 队列项已开始发送，不允许删除 |
| `QUEUE_DISPATCH_CONFLICT` | 当前会话已有队列项正在被调度 |

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

- npm SDK 仍只有一轮一个 `runStreamed(...)`
- 但 `codex-cli 0.118.0` 的 `app-server` 协议已公开 `turn/steer`
- 真问题已经不是“Codex 完全不支持运行中输入”，而是“宿主之前没把 `turn/steer` 接进来”

#### 4.2.2 改造方案

- `Codex Runtime Adapter` 改走 `codex app-server`
- active run 启动后保存当前 `turnId`
- 用户运行中继续发消息时，优先调用 `turn/steer`
- 如果 steer 撞上刚结束的旧 turn，则丢弃陈旧 active run 并自动续跑当前消息
- 项目队列继续保留，作为显式排队与兜底路径

#### 4.2.3 结果

- `Codex` 不再卡死在“运行中不能继续发”
- 运行中 steer 现在是真能力，不再是假文案
- npm SDK 与 CLI app-server 的能力边界也被说清楚了

## 5. 关键流程

### 5.1 会话未运行时发送消息

1. 前端调用现有 `messages/live`
2. Host 检查无 active run
3. 继续走 `start/continue`
4. 行为与 `spec003.1` 保持一致

### 5.2 会话运行中，选择加入项目队列

1. 前端调用 `POST /queue`
2. Host 保存一条 `queued` 项
3. 若当前会话仍在运行，则只返回等待结果
4. 若当前会话空闲，则队列调度器立刻开始发送第一条

### 5.3 当前 run 结束后自动续跑下一条

1. Host 监听到 runtime terminal 事件
2. 队列调度器取出最早的一条 `queued` 项
3. 标记为 `dispatching`
4. 调用现有 `start/continue` 主链路发送
5. 发送成功后把该项标记为完成并继续检查下一条

### 5.4 会话运行中，支持流式引导

1. 前端调用现有 `messages/live`
2. Host 发现 active run 存在且 `submitDuringRun` 可用
3. Host 直接把消息交给该 active run
4. Adapter 将输入写入现有长连接
5. 后续事件继续从同一流返回

### 5.5 会话运行中，选择立即直发

1. 前端调用现有 `messages/live`
2. Host 发现 active run 存在且 `submitDuringRun` 可用
3. Host 直接把消息交给该 active run
4. 不进入项目队列

## 6. 前端交互

### 6.1 输入区规则

按“项目队列 + provider 直发能力”共同决策：

| 场景 | 主动作 | 次动作 |
| --- | --- | --- |
| `Codex` 运行中 | `追加指导` | `加入队列` |
| `Claude` 运行中 | `追加指导` | `加入队列` |
| 未运行 | `发送` | 可选加入队列（非必须） |

### 6.2 兼容策略

- 若旧前端未识别队列字段，默认退化为当前单条发送逻辑
- 若旧后端未返回队列字段，前端视为队列不可用

## 7. 风险与约束

### 7.1 主要风险

- `Claude Code` 长连接输入的真实 CLI 参数与本机版本差异
- 新增队列表后，数据库会开始持久化待发送正文
- 队列自动续跑时，前端时间线与等待项状态对账更复杂

### 7.2 控制策略

- 先只打通 `Claude`
- 队列只保存“待发项”，不动 provider 原始历史
- 自动续跑严格复用现有 `start/continue` 主链路
- 删除只允许发生在 `queued` 状态，避免把已发送中的项删出半截

## 8. 验收策略

### 8.1 Claude

- 启动会话后，在运行过程中追加一条指导
- 验证无需中断、无需第二个 active run
- 验证后续事件仍落在同一原生 session

### 8.2 Codex

- 验证运行中可加入多条项目队列
- 验证当前轮完成后会自动续跑下一条
- 验证等待中的队列项可删除
