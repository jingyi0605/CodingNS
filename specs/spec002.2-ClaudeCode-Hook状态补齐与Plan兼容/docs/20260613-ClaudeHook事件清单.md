# 20260613-ClaudeHook事件清单

这份表只回答三件事：

1. Claude Code 官方有哪些 Hook 事件
2. 我们现在已经接到哪一步
3. 下一步该先补什么，不要乱补

---

## 1. 现在怎么判断“已经接入”

这里把接入状态分成 4 档，别混着看：

- **A. 已声明支持**
  - Hook bridge 的 `supportedEvents` 里已经列出来
- **B. 已进入 Host**
  - `isSupportedClaudeHookEvent(...)` 不会把它直接忽略
- **C. 已有处理**
  - 不是纯接收，而是已经变成审批、问题回答、运行态或别的业务状态
- **D. 已对用户可见**
  - 用户能在前端看到，或者能真的操作

如果只做到 A / B，不能算“已经打通”。

---

## 2. 官方 Hook 清单与当前对照

> 参考 2026-06-13 当天核对的 Anthropic Claude Code Hooks 文档与 Hooks Guide。

| 事件 | 官方用途大意 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| `PreToolUse` | 工具执行前拦截 | 已打通 | 已用于权限审批、`AskUserQuestion`、`ExitPlanMode` |
| `PostToolUse` | 单次工具执行后 | 已打通 | 已映射为运行中状态 |
| `PostToolUseFailure` | 单次工具执行失败后 | 已打通 | 已映射为运行中状态，不会误判成整轮失败 |
| `PostToolBatch` | 一批工具执行后 | 未接 | 当前缺口，批量工具场景还会丢信息 |
| `PermissionRequest` | 工具权限请求 | 已打通 | 已走审批链路 |
| `PermissionDenied` | 权限被拒绝后 | 已打通 | 已映射为运行中状态 |
| `Notification` | Claude 发送通知 | 半接入 | 已声明支持，但当前没有变成用户可见状态 |
| `UserPromptSubmit` | 用户输入提交 | 已打通 | 已映射运行中状态 |
| `UserPromptExpansion` | 用户输入扩展/整理 | 未接 | 和 `UserPromptSubmit` 属于同类前置状态 |
| `SessionStart` | 会话启动 | 已打通 | 已映射运行中状态 |
| `Stop` | 本轮停止 | 已打通 | 已映射 completed / running |
| `StopFailure` | 停止失败 / 本轮失败 | 已打通 | 已映射 failed |
| `SessionEnd` | 会话结束 | 已打通 | 已映射 completed |
| `SubagentStart` | 子任务开始 | 未接 | 现在只接了 stop，没有 start，不完整 |
| `SubagentStop` | 子任务结束 | 已打通 | 已映射运行中状态 |
| `TaskCreated` | 创建任务 | 已打通 | 已映射运行中状态 |
| `TaskCompleted` | 完成任务 | 已打通 | 已映射运行中状态 |
| `PreCompact` | 压缩上下文前 | 已打通 | 已映射运行中状态 |
| `PostCompact` | 压缩上下文后 | 已打通 | 已映射运行中状态 |
| `Setup` | 启动/初始化阶段 | 未接 | 当前完全没进白名单 |
| `MessageDisplay` | 展示消息 | 未接 | 还没决定是否要给前端看 |
| `TeammateIdle` | 协作/队友空闲 | 未接 | 当前系统里也没有对应展示语义 |
| `InstructionsLoaded` | 指令已加载 | 未接 | 更偏环境态/调试态 |
| `ConfigChange` | 配置变化 | 未接 | 更偏环境态/调试态 |
| `CwdChanged` | 工作目录变化 | 未接 | 更偏环境态/调试态 |
| `FileChanged` | 文件变化 | 未接 | 更偏环境态/调试态 |
| `Elicitation` | Claude 发起补充提问/征询 | 未接 | 和当前问题回答链路是同类能力，值得优先补 |
| `ElicitationResult` | 征询结果回流 | 未接 | 应和 `Elicitation` 配对考虑 |
| `WorktreeCreate` | 创建工作树 | 未接 | 当前没接 |
| `WorktreeRemove` | 移除工作树 | 未接 | 当前没接 |

---

## 3. 当前已经补到什么程度

### 3.1 已真正打通

- `PreToolUse`
  - 普通权限审批
  - `AskUserQuestion`
  - `ExitPlanMode`
- `PermissionRequest`
- 关键运行态：
  - `PostToolUse`
  - `PostToolUseFailure`
  - `PermissionDenied`
  - `TaskCreated`
  - `TaskCompleted`
  - `SubagentStop`
  - `PreCompact`
  - `PostCompact`
  - `UserPromptSubmit`
  - `SessionStart`
  - `Stop`
  - `StopFailure`
  - `SessionEnd`

### 3.2 看起来接了，其实还没打通

- `Notification`
  - 现在只是 bridge 和 Host 接收时不报错
  - 但没有映射成用户能看到的状态
  - 这不算真正打通

---

## 4. 剩余 Hook 的优先级

### P0：下一轮就该补

这些不补，当前 Claude Hook 兼容仍然是不完整的。

1. `SubagentStart`
   - 原因：现在只有开始后的结束，没有开始，事件对不起来
2. `PostToolBatch`
   - 原因：批量工具执行会丢阶段信息
3. `Notification`
   - 原因：已经声明支持，但没有真正落状态，这是最别扭的一类
4. `Elicitation`
   - 原因：和现有“问题回答”最接近，应该纳入统一交互链路

### P1：建议紧跟着补

1. `ElicitationResult`
   - 原因：和 `Elicitation` 是一对，只补一边会残
2. `UserPromptExpansion`
   - 原因：和 `UserPromptSubmit` 是同类前置状态，补了更完整
3. `Setup`
   - 原因：有助于看清 Claude 初始化阶段在做什么

### P2：先留着，不急

这些更偏环境态、调试态或低频辅助事件。

- `MessageDisplay`
- `TeammateIdle`
- `InstructionsLoaded`
- `ConfigChange`
- `CwdChanged`
- `FileChanged`
- `WorktreeCreate`
- `WorktreeRemove`

一句人话：
先补用户真会遇到、而且缺了会断链路的事件；别先去做一堆“看起来全了”的调试态事件。

---

## 5. 分阶段建议

### 阶段 4：把“还差一口气”的核心状态补齐

目标：

- 把现在已经半接入或明显缺一半的事件补完整

建议范围：

- `SubagentStart`
- `PostToolBatch`
- `Notification`
- `Elicitation`

验收标准：

1. 这些事件不再只是 accepted
2. 至少能落成可追踪状态或可交互请求
3. 不破坏现有 `AskUserQuestion` / `ExitPlanMode` / 权限审批

### 阶段 5：把同类成对事件补对

目标：

- 把同类事件成对补齐，别只接前半截

建议范围：

- `ElicitationResult`
- `UserPromptExpansion`
- `Setup`

验收标准：

1. Claude 前置阶段和结果阶段状态更完整
2. 前端不会把这些状态误当成完成或失败

### 阶段 6：再决定要不要接环境态事件

目标：

- 只在确实有产品价值时，再补环境态和调试态

建议范围：

- `MessageDisplay`
- `TeammateIdle`
- `InstructionsLoaded`
- `ConfigChange`
- `CwdChanged`
- `FileChanged`
- `WorktreeCreate`
- `WorktreeRemove`

验收标准：

1. 每个事件都能说清“用户为什么要看到它”
2. 不为“全量覆盖”而堆事件

---

## 6. 当前最实际的结论

现在不能说“Claude Hook 都透传了”。

更准确的说法是：

- **核心审批链路**：已基本打通
- **Claude Plan**：已打通
- **关键运行态**：已补一批
- **全部 Hook**：还没有
- **下一轮最值得补的**：`SubagentStart`、`PostToolBatch`、`Notification`、`Elicitation`

如果后续继续做，优先按上面的 P0 / P1 走，不要东一榔头西一棒子。
