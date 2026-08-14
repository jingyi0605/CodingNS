# 20260614-ClaudeHook前端可见状态设计

这份文档只讲一件事：

哪些 Claude Hook 值得做成前端可见卡片，以及这次为什么复用 `Ask Question` 的卡片样式。

---

## 1. 这次为什么不自己再长一套 UI

当前前端里，`AskUserQuestion`、结构化问题结果、待处理审批，已经有一套成熟的卡片样式：

- `permission-request-card`
- `permission-request-card-inline`
- `permission-request-card-readonly`

这套样式已经满足几个关键点：

1. 信息密度合适
2. 已经在对话时间线里存在
3. 用户已经认识这种视觉，不需要重新学习
4. 不会再长出一套新的按钮、边框、标题体系

一句人话：
能复用现成好看的，就别再发明一套丑的。

---

## 2. 哪些 Hook 值得做成前端可见卡片

不是所有 Hook 都值得做卡片。

这次只挑**真的会和用户交汇**的状态：

- `Notification`
- `Setup`
- `UserPromptExpansion`
- `SubagentStart`
- `SubagentStop`
- `InstructionsLoaded`
- `ConfigChange`
- `CwdChanged`
- `FileChanged`
- `WorktreeCreate`
- `WorktreeRemove`

这些事件有个共同点：

- 用户看到以后能理解“Claude 现在在干嘛”
- 又不需要像权限审批那样点击处理

所以最适合做成：

- **只读卡片**
- **时间线内展示**
- **沿用 Ask Question 的卡片骨架**

---

## 3. 哪些 Hook 这次先不做卡片

下面这些事件先不做成这种卡片：

- `PreToolUse`
- `PermissionRequest`
- `AskUserQuestion`
- `ExitPlanMode`
- `Elicitation`

原因很简单：

- 它们本来就已经有独立交互链路
- 再做一层卡片只会重复

另外这些结果态这次也不单独做成卡片：

- `PostToolUse`
- `PostToolUseFailure`
- `PostToolBatch`
- `TaskCreated`
- `TaskCompleted`
- `ElicitationResult`

原因：

- 这些状态更像过程记录
- 现在先保留为运行态 detail 就够
- 再往前走一步，就会开始堆很多低价值卡片

---

## 4. 这次实际展示策略

### 4.1 数据来源

前端直接使用会话运行态里的 `session.detail`。

只要 `detail` 命中主要 Hook 文案，就转成一条时间线里的 `runtime_notice`。

### 4.2 展示位置

展示在正常消息时间线里，和消息、thinking、错误状态一起排。

### 4.3 展示样式

复用：

- `permission-request-card`
- `permission-request-card-inline`
- `permission-request-card-readonly`

标题固定用人话：

- `Claude 正在处理当前任务`

副标题固定：

- `Claude 正在推进当前步骤`

右上角标签固定：

- `运行状态`

正文直接显示当前 Hook detail。

---

## 5. 这次明确不做什么

### 不做点击操作

这些卡片是只读的，不是新的审批入口。

### 不做每个 Hook 一套专属皮肤

只保留一套统一样式，不搞五颜六色的状态卡片。

### 不把所有运行态都变卡片

只做主要、用户能看懂的那批。

---

## 6. 当前结论

这次前端可见化的目标不是“所有 Hook 都可视化”，而是：

- 让主要和用户交汇的 Claude Hook 状态不再只是一句底层 detail
- 且这些状态看起来和现有 `Ask Question` 风格一致

这条路是对的。

先统一，再美化；先复用，再扩展。
