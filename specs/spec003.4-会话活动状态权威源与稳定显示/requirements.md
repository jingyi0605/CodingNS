# 需求文档 - spec003.4 会话活动状态权威源与稳定显示

状态：Draft

## 1. 背景

当前会话活动状态已经不是单点 bug，而是结构性问题。

现状大致是这样：

1. Host 自己发起的 live run 会产出 runtime 状态
2. 外部 provider 事件也可能更新状态
3. 原始日志 / transcript / jsonl 还能再推断一层状态
4. 前端又会把列表摘要、runtime 接口和实时事件一起消费

这套做法的问题很现实：

- 同一个会话会在“活动 / 停止”之间来回切换
- 推断态可能覆盖权威态
- 迟到事件可能把终态打回运行态
- 前端看到的不是唯一真相，而是多条链路的混合结果

这个问题不是“视觉抖动”，而是后端状态模型没有收口。

## 2. 目标

本 Spec 要达成下面五件事：

1. 后端对每个会话只维护一份统一的活动状态裁决结果
2. 后端明确区分状态来源和可信度
3. Host 自己发起的 run 具备 watchdog，避免挂死时永远显示运行中
4. API 和 WebSocket 只输出统一裁决后的状态，不再各说各话
5. 前端只显示后端统一裁决结果，不再自己推断活动状态

## 3. 术语说明

- **活动状态**：会话当前是否处于 `idle / starting / running / stale / completed / interrupted / failed / unknown`
- **权威源**：可以直接决定活动状态的来源，例如 Host 持有的 runtime handle
- **推断源**：只能作为降级参考的来源，例如日志追加、文件 mtime
- **状态来源**：本次状态由哪种来源给出，例如 `authoritative_runtime`
- **可信度**：当前状态可以被相信到什么程度，例如 `authoritative / strong / weak`
- **watchdog**：针对长时间无新事件的运行态做超时检查与状态降级
- **统一裁决**：后端根据来源优先级、时间戳和状态流转规则产出的唯一结果

## 4. 用户故事

### 4.1 正在看会话的开发者

作为正在看会话页面的开发者，我希望“活动中”只在真的活动时出现，“已停止/已完成”也只在真的停止后出现，这样我不会被界面误导。

### 4.2 维护 Host 的开发者

作为维护 Host 的开发者，我希望活动状态的判断逻辑只有一处，而不是散落在 runtime、history、inspector 和前端里各自猜一遍。

### 4.3 接入 provider 的开发者

作为继续接 provider 的开发者，我希望新 provider 只要声明自己的状态来源和终态信号，就能接进统一裁决链路，而不是再写一堆散落特判。

## 5. 功能需求

### 5.1 后端必须有唯一的活动状态裁决结果

1. WHEN 任意会话状态发生变化 THEN System SHALL 在后端维护唯一一份统一裁决结果。
2. WHEN API 返回会话列表、会话详情或 runtime 状态 THEN System SHALL 返回同一套状态定义，而不是多个接口各自给不同答案。
3. WHEN WebSocket 推送运行状态 THEN System SHALL 推送统一裁决后的状态，而不是绕过裁决直接转发局部来源。

### 5.2 系统必须区分状态来源和可信度

1. WHEN 后端产出活动状态 THEN System SHALL 同时标记状态来源，例如 `authoritative_runtime`、`authoritative_provider_event`、`inferred_log`、`unknown`。
2. WHEN 后端产出活动状态 THEN System SHALL 同时标记可信度，例如 `authoritative`、`strong`、`weak`。
3. WHEN 推断源和权威源冲突 THEN System SHALL 以权威源为准，不得让推断源覆盖权威源。

### 5.3 Host 自己发起的 run 必须有 watchdog

1. WHEN Host 持有 active run 且长时间没有新事件 THEN System SHALL 触发 watchdog 检查。
2. WHEN watchdog 判定当前 run 已失去可信活动证据 THEN System SHALL 把状态降级为 `stale` 或 `unknown`，而不是永远维持 `running`。
3. WHEN watchdog 触发后又收到了新的权威事件 THEN System SHALL 允许状态恢复为真实运行态。
4. WHEN watchdog 触发时没有明确失败证据 THEN System SHALL 不得武断改成 `failed`。

### 5.4 明确终态必须有单向流转规则

1. WHEN 会话进入 `completed`、`interrupted` 或 `failed` THEN System SHALL 将其视为终态。
2. WHEN 终态已经写入 THEN System SHALL 不允许被同一轮次的迟到推断事件打回 `running`。
3. WHEN 新一轮运行明确开始 THEN System SHALL 通过新的 `runId` 或等价轮次标识进入新的状态流转，而不是复用旧轮次终态。

### 5.5 外部观察会话必须诚实降级

1. WHEN 会话不是由 Host 自己发起，且缺少可靠实时状态通道 THEN System SHALL 允许返回 `unknown` 或弱可信的推断状态。
2. WHEN 外部观察会话只有日志追加证据 THEN System SHALL 明确标记为推断来源，不得伪装成权威活动态。
3. WHEN provider 提供正式事件通道 THEN System SHALL 优先消费正式事件通道，而不是继续依赖日志推断。

### 5.6 前端只能显示后端统一裁决结果

1. WHEN 前端接收到导航摘要、runtime 接口和实时事件 THEN 前端 SHALL 只按后端统一裁决字段更新活动状态显示。
2. WHEN 前端本地 optimistic 行为与后端裁决冲突 THEN 前端 SHALL 以后端裁决为准。
3. WHEN 前端需要展示提示文案 THEN 前端 SHALL 基于状态来源和可信度显示一致文案，不再自己推断活动状态。

### 5.7 三家 provider 都必须接入统一活动状态合同

1. WHEN `claude-code` 接入活动状态 THEN System SHALL 同时支持 Host runtime、Claude hook 和日志推断三类来源的统一裁决。
2. WHEN `codex` 接入活动状态 THEN System SHALL 同时支持 Host runtime 和外部日志终态识别的统一裁决。
3. WHEN `opencode` 接入活动状态 THEN System SHALL 同时支持 Host runtime、官方 SSE 事件和必要的降级路径。

## 6. 非功能需求

### 6.1 兼容性

1. 不得破坏现有会话历史接口和消息直推链路。
2. 不得要求 provider 修改原生会话存储格式。
3. 方案必须兼容 Windows 和 macOS，不得依赖特定平台进程扫描命令作为主链路。

### 6.2 可排障性

1. WHEN 排查状态异常 THEN System SHALL 能看出当前状态来自哪个来源、最后一次观测时间是什么、是否触发过 watchdog。
2. WHEN 终态被拒绝覆盖或推断态被降级 THEN 日志 SHALL 能说明为什么拒绝或降级。

### 6.3 最小复杂度

1. System SHALL 优先复用现有 runtime registry、session live service 和 session history service。
2. System SHALL 避免把状态判断散落到更多文件和更多前端特判里。

## 7. 非目标

- 不在本阶段重做聊天页布局
- 不在本阶段新增第四家 provider
- 不在本阶段做操作系统级进程治理面板
- 不在本阶段重写消息合并模型

## 8. 验收重点

1. 由本项目发起的会话在前端不再来回显示“活动 / 停止”。
2. 终态不会被迟到推断态打回运行态。
3. watchdog 能把长时间无事件的挂死 run 从“永远运行中”降级掉。
4. `claude-code`、`codex`、`opencode` 都能输出统一的来源与可信度字段。
5. 前端活动状态显示只依赖后端统一裁决结果。
