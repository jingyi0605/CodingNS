# 设计文档 - spec003.4 会话活动状态权威源与稳定显示

状态：Draft

## 1. 概述

### 1.1 目标

- 给会话活动状态建立唯一的后端权威裁决结果
- 明确区分权威源、正式事件源、推断源和未知状态
- 给 Host 自己发起的 run 增加 watchdog
- 让前端停止自己脑补活动状态

### 1.2 覆盖范围

- `packages/session-sync-core` 的 runtime 状态输出合同
- `apps/host` 的活动状态裁决、watchdog 和统一状态下发
- `apps/user-app` 的活动状态消费和显示

### 1.3 不覆盖范围

- 聊天正文消息链路重做
- 富消息 UI
- 操作系统进程管理器式能力

## 2. 核心判断

### 【核心判断】

✅ 值得做：当前主问题不是“某个 provider 特判少了一条”，而是没有唯一状态权威源。

### 【关键洞察】

- 数据结构：真正应该唯一的是 `sessionId + runId` 对应的活动状态裁决结果
- 复杂度：如果继续让 runtime、provider event、history 推断和前端各自判断，状态永远会打架
- 风险点：推断态覆盖权威态、旧轮次事件污染新轮次、长时间挂死 run 永远停不下来

## 3. 现状问题

### 3.1 当前状态来源散乱

现在的状态来源至少有三类：

1. Host 持有的 active run handle
2. provider 正式事件或外部 runtime snapshot
3. 原始日志 / transcript / jsonl 的推断结果

问题不在于来源多，而在于没有统一裁决层。

### 3.2 当前最糟糕的坏味道

1. 后端多个模块都在判断 runningState
2. 前端还会继续拿不同接口的摘要互相覆盖
3. 没有 `runId`，旧轮次迟到事件和新轮次活动容易混淆
4. Host 持有的 active run 没有 watchdog，挂死时可能一直显示运行中

## 4. 目标结构

### 4.1 新链路

改造后的活动状态链路：

1. runtime / provider event / inferred log 产出原始观测
2. `SessionActivityAuthorityService` 统一接收原始观测
3. 服务根据来源优先级、轮次、终态保护和 watchdog 输出唯一裁决结果
4. API 和 WebSocket 只下发这份裁决结果
5. 前端只根据这份裁决结果显示活动状态

### 4.2 统一状态模型

新增统一裁决结构：

```ts
type SessionActivityResolvedState =
  | "idle"
  | "starting"
  | "running"
  | "stale"
  | "completed"
  | "interrupted"
  | "failed"
  | "unknown";

type SessionActivitySource =
  | "authoritative_runtime"
  | "authoritative_provider_event"
  | "inferred_log"
  | "unknown";

type SessionActivityConfidence = "authoritative" | "strong" | "weak";

interface SessionActivityResolution {
  sessionId: string;
  runId: string | null;
  state: SessionActivityResolvedState;
  source: SessionActivitySource;
  confidence: SessionActivityConfidence;
  detail: string | null;
  errorCode: string | null;
  lastObservedAt: string | null;
  terminalAt: string | null;
  watchdogTriggeredAt: string | null;
  updatedAt: string;
}
```

这里故意把 `stale` 和 `unknown` 分开：

- `stale`：上一状态是活动态，但已经长时间没有新证据
- `unknown`：压根没有足够证据判断当前是否在活动

### 4.3 runId 规则

`runId` 的作用只有一个：隔离不同轮次。

最小实现规则：

1. Host 自己发起 `start-live` / `messages/live` 新一轮时生成新的 `runId`
2. 同一 active run 内的所有 runtime 事件都归属于同一个 `runId`
3. 外部观察来源如果拿不到 provider 原生 run 标识，则允许 `runId = null`
4. `runId = null` 的弱来源不得覆盖已有的明确 runtime 轮次终态

## 5. 模块设计

### 5.1 SessionActivityAuthorityService

新增 Host 模块：

- 建议位置：`apps/host/src/modules/sessions/session-activity-authority-service.ts`

职责只有四个：

1. 接收原始状态观测
2. 应用来源优先级和终态保护
3. 维护 watchdog
4. 输出统一裁决结果

### 5.2 原始观测模型

统一先收观测，再做裁决：

```ts
interface SessionActivityObservation {
  sessionId: string;
  runId: string | null;
  state: "starting" | "running" | "completed" | "interrupted" | "failed" | "idle";
  source: SessionActivitySource;
  confidence: SessionActivityConfidence;
  detail: string | null;
  errorCode: string | null;
  observedAt: string;
}
```

### 5.3 来源优先级

固定优先级：

1. `authoritative_runtime`
2. `authoritative_provider_event`
3. `inferred_log`
4. `unknown`

原则：

1. 低优先级不能覆盖高优先级同轮次结果
2. 推断态不能覆盖权威终态
3. 同优先级时按 `observedAt` 新旧决定

### 5.4 终态保护

终态只有：

- `completed`
- `interrupted`
- `failed`

规则：

1. 同一 `runId` 进入终态后，只允许更强的同轮次终态覆盖
2. `inferred_log` 永远不能把终态改回 `running`
3. 新轮次开始时必须带新的 `runId`

### 5.5 watchdog

watchdog 只针对 Host 自己持有的 active run。

最小策略：

1. active run 创建时登记 watchdog
2. 每次收到权威 runtime 事件时刷新 `lastObservedAt`
3. 超过阈值仍无新事件，则将裁决状态降级为 `stale`
4. 如果 active run 句柄已不存在且仍无明确终态，则进一步降级为 `unknown`
5. watchdog 不直接改成 `failed`

推荐初始阈值：

- `stale`：30 秒
- `unknown`：90 秒

这个值先做成 Host 配置项，不要写死在前端。

### 5.6 现有模块如何接入

#### 5.6.1 SessionLiveRuntimeService

职责调整：

1. runtime 事件不再直接写最终 runningState 真相
2. runtime 事件先转成 observation，交给 authority service
3. runtime 接口从 authority service 读取统一裁决结果

#### 5.6.2 SessionHistoryService / SessionActivityInspector

职责收敛：

1. 只负责产出 `inferred_log` 观测
2. 不再直接当最终状态写库真相

#### 5.6.3 Session State Repository

建议保留现有 `session_states`，但它存的应该是“统一裁决结果”，不是某个局部模块的随手判断。

必要时增加字段：

| 字段 | 说明 |
| --- | --- |
| `run_id` | 当前裁决关联的轮次 |
| `activity_source_v2` | 统一来源 |
| `activity_confidence` | 可信度 |
| `watchdog_triggered_at` | 最近一次 watchdog 触发时间 |

如果不想立刻改库，也可以先把部分字段放在 runtime DTO 和内存态里，但这只是过渡。

### 5.7 API 与 WS 合同

#### 5.7.1 Runtime DTO

`GET /api/sessions/{sessionId}/runtime` 增加：

```ts
{
  runningState: SessionActivityResolvedState;
  activitySource: SessionActivitySource;
  activityConfidence: SessionActivityConfidence;
  runId: string | null;
  watchdogTriggeredAt: string | null;
}
```

#### 5.7.2 会话列表 DTO

列表也必须返回同一套字段，否则前端还是会打架。

#### 5.7.3 WS 事件

统一推送：

```ts
type SessionActivityEnvelope = {
  type: "session.activity";
  sessionId: string;
  runId: string | null;
  runningState: SessionActivityResolvedState;
  activitySource: SessionActivitySource;
  activityConfidence: SessionActivityConfidence;
  detail: string | null;
  errorCode: string | null;
  lastObservedAt: string | null;
  terminalAt: string | null;
  watchdogTriggeredAt: string | null;
  timestamp: string;
};
```

原有 `session.runtime_status` 可以先兼容保留，但前端主消费应迁到统一活动事件。

## 6. Provider 方案

### 6.1 Claude Code

来源：

1. Host runtime handle
2. Claude hook bridge
3. transcript / jsonl 推断

策略：

- Host 自发起时优先 `authoritative_runtime`
- 外部 hook 事件记为 `authoritative_provider_event`
- transcript 推断只算 `inferred_log`

### 6.2 Codex

来源：

1. Host runtime handle
2. 外部 jsonl 中的 `task_complete / task_failed`

策略：

- Host 自发起时优先 `authoritative_runtime`
- 外部日志终态只算弱可信或正式 provider 终态补充，不得冒充强实时运行态

### 6.3 OpenCode

来源：

1. Host runtime handle
2. 官方 `/event` SSE
3. 必要时的只读历史兜底

策略：

- Host 自发起时优先 `authoritative_runtime`
- 官方 SSE 记为 `authoritative_provider_event`
- 无正式事件时允许降级为 `unknown`

## 7. 前端方案

### 7.1 前端不再自行推断活动状态

前端保留 optimistic 发送体验，但活动状态显示必须只来自后端统一裁决字段。

要收敛的点：

1. 列表摘要
2. runtime snapshot
3. realtime 状态事件

这三者必须是一份真相的不同投影，不是三套判断。

### 7.2 展示策略

建议文案方向：

- `running`：正在处理
- `stale`：状态待确认
- `unknown`：当前无法确认是否仍在运行
- `completed`：本轮已完成
- `failed`：本轮失败
- `interrupted`：已中断

对用户要说人话，不要把“推断态”和“权威态”伪装成同一种确定性。

## 8. 风险与对策

### 8.1 风险：watchdog 误伤慢任务

对策：

- 先降级成 `stale`，不要直接失败
- 阈值可配置
- 一旦有新事件立刻恢复

### 8.2 风险：旧轮次事件污染新轮次

对策：

- 引入 `runId`
- 终态保护基于轮次判断

### 8.3 风险：前端还在吃旧字段

对策：

- 保留兼容字段过渡
- 但内部统一从 authority service 生成

## 9. 验证策略

### 9.1 Host

- runtime / provider / inferred 三类观测进入同一裁决服务
- 低优先级来源不会覆盖高优先级终态
- watchdog 能把挂死 run 降级为 `stale/unknown`

### 9.2 Provider

- `claude-code`：hook 终态、runtime 终态、推断态冲突场景
- `codex`：runtime completed 与外部 task_complete 并存场景
- `opencode`：SSE `session.idle` 与 Host runtime 完成场景

### 9.3 user-app

- 前端只按统一裁决结果显示活动状态
- 导航摘要不会再把本地 running 态误覆盖
- `stale/unknown` 文案和样式清楚可区分
