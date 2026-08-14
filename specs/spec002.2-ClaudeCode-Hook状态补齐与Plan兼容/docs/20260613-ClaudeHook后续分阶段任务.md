# 20260613-ClaudeHook后续分阶段任务

这份文档不讲空话，只讲后面继续做时该怎么拆。

---

## 阶段 4：补核心剩余 Hook

### 这一步做什么

把当前最影响 Claude Hook 完整性的 4 个事件补上：

- `SubagentStart`
- `PostToolBatch`
- `Notification`
- `Elicitation`

### 做完以后能看到什么

- 子任务开始/结束能对上
- 批量工具执行后不再只剩单工具状态
- `Notification` 不再是“声明支持但没显示”
- Claude 发起补充征询时，系统能接住而不是吞掉

### 依赖什么

- spec002.2 当前阶段 1 ~ 3 已完成

### 主要改哪些文件

- `apps/host/src/modules/sessions/session-live-runtime-service.ts`
- `apps/host/src/modules/sessions/session-permission-request-service.ts`
- `apps/host/tests/integration/session-live-runtime-service.test.ts`
- 可能补前端展示文件

### 明确不做什么

- 不在这一阶段顺手接所有环境态事件
- 不新长一套独立 Hook 事件系统

### 怎么验证

- `CI=1 pnpm --dir apps/host test tests/integration/session-live-runtime-service.test.ts tests/integration/session-permission-request-service.test.ts`

---

## 阶段 5：补同类成对事件

### 这一步做什么

把已经有一半、但还没成对的事件补齐：

- `ElicitationResult`
- `UserPromptExpansion`
- `Setup`

### 做完以后能看到什么

- Claude 前置动作和结果状态更完整
- Claude 补充征询链路不是只发起、不收口

### 依赖什么

- 阶段 4

### 主要改哪些文件

- `apps/host/src/modules/sessions/session-live-runtime-service.ts`
- `apps/host/tests/integration/session-live-runtime-service.test.ts`

### 明确不做什么

- 不强行把这些事件全做成复杂前端卡片

### 怎么验证

- `CI=1 pnpm --dir apps/host test tests/integration/session-live-runtime-service.test.ts`

---

## 阶段 6：再决定是否补环境态事件

### 这一步做什么

只在确认有产品价值时，再评估下面这些事件：

- `MessageDisplay`
- `TeammateIdle`
- `InstructionsLoaded`
- `ConfigChange`
- `CwdChanged`
- `FileChanged`
- `WorktreeCreate`
- `WorktreeRemove`

### 做完以后能看到什么

- 不是“Hook 全量收集”这种自嗨结果
- 而是确实多了对用户有用的可见状态

### 依赖什么

- 阶段 5

### 主要改哪些文件

- 看最终决定，不预设改动面

### 明确不做什么

- 不为了清单好看把所有低价值事件都接进去

### 怎么验证

- 按最终实际接入范围补最小测试
