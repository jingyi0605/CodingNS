# 任务清单 - spec002.2 ClaudeCode Hook状态补齐与Plan兼容（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单只回答几个最实际的问题：

1. 先补哪个 Hook，才能把 Claude Code 真正接通
2. Plan 审批到底走哪条链路
3. 哪些状态要先让用户看见，哪些可以先只落事件
4. 怎么保证不把现在已经能用的权限和问题回答搞坏

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻更新本文件
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 0：先把范围钉死，不再模糊说“支持 Claude Hook”

- [x] 0.1 盘清 Claude Code 官方 Hook 清单和本地缺口
  - 状态：DONE
  - 这一步到底做什么：把官方当前 Hook 事件清单、本机 Claude Code 版本、本地已接/未接状态全部盘清。
  - 做完你能看到什么：已经明确 `ExitPlanMode` 是关键缺口，也明确还有哪些同类状态没进系统。
  - 先依赖什么：无
  - 开始前先看：
    - Claude Code hooks 官方文档
    - `packages/session-sync-core/src/runtime/claude-runtime.ts`
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - `apps/host/src/modules/sessions/session-permission-request-service.ts`
  - 主要改哪里：
    - `specs/spec002.2-ClaudeCode-Hook状态补齐与Plan兼容/*`
  - 这一步先不做什么：不直接改代码。
  - 怎么算完成：
    1. 已明确支持/缺失 Hook 清单
    2. 已明确 `ExitPlanMode` 必须优先补
  - 怎么验证：
    - 文档走查
    - 本机 Claude Code 版本和 schema 核对
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2、§4.1

- [x] 0.2 建立 spec002.2 初稿并锁定边界
  - 状态：DONE
  - 这一步到底做什么：把 Claude Hook 状态补齐和 Plan 兼容写成正式 Spec，避免后面一边写代码一边改目标。
  - 做完你能看到什么：`README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md` 已建立。
  - 先依赖什么：0.1
  - 开始前先看：
    - `spec002`
    - `spec003.1`
    - `spec010.1`
  - 主要改哪里：
    - `specs/spec002.2-ClaudeCode-Hook状态补齐与Plan兼容/*`
  - 这一步先不做什么：不修改 Host、前端和 runtime。
  - 怎么算完成：
    1. Spec 主文档齐全
    2. 已明确“不把计划审批当普通权限”
  - 怎么验证：
    - Spec 目录结构检查
    - 文档自检
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

---

## 后续建议阶段：剩余 Hook 补齐（暂不纳入本轮交付）

- [x] 4.1 补 `SubagentStart`、`PostToolBatch`、`Notification`、`Elicitation`
  - 状态：DONE
  - 这一步到底做什么：把当前最影响完整性的剩余核心 Hook 补上，不再让 `Notification` 这种“声明支持但没落状态”的情况继续存在。
  - 做完你能看到什么：子任务开始/结束成对、批量工具状态不再丢、Claude 补充征询可接住。
  - 先依赖什么：3.3
  - 开始前先看：
    - `docs/20260613-ClaudeHook事件清单.md`
    - `docs/20260613-ClaudeHook后续分阶段任务.md`
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - `apps/host/src/modules/sessions/session-permission-request-service.ts`
    - 相关测试文件
  - 这一步先不做什么：不顺手补所有环境态 Hook。
  - 怎么算完成：
    1. 这 4 个事件不再被吞掉
    2. 至少能变成可追踪状态或可交互请求
  - 怎么验证：
    - `CI=1 pnpm --dir apps/host test tests/integration/session-live-runtime-service.test.ts tests/integration/session-permission-request-service.test.ts`

- [x] 4.2 补 `ElicitationResult`、`UserPromptExpansion`、`Setup`
  - 状态：DONE
  - 这一步到底做什么：把同类但目前缺半截的事件补齐，避免只有发起没有结果、只有提交没有扩展。
  - 做完你能看到什么：Claude 前置阶段和结果阶段更完整。
  - 先依赖什么：4.1
  - 开始前先看：
    - `docs/20260613-ClaudeHook事件清单.md`
    - `docs/20260613-ClaudeHook后续分阶段任务.md`
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - 相关测试文件
  - 这一步先不做什么：不强行全部做成复杂前端卡片。
  - 怎么算完成：
    1. 同类状态成对补齐
    2. 不破坏现有 Claude Hook 主链路
  - 怎么验证：
    - `CI=1 pnpm --dir apps/host test tests/integration/session-live-runtime-service.test.ts`

- [x] 4.3 评估环境态 Hook 是否值得接
  - 状态：DONE
  - 这一步到底做什么：只在能说清用户价值时，才评估 `MessageDisplay`、`TeammateIdle`、`InstructionsLoaded`、`ConfigChange`、`CwdChanged`、`FileChanged`、`WorktreeCreate`、`WorktreeRemove`。
  - 做完你能看到什么：剩余 Hook 的取舍有明确结论，而不是为“全量覆盖”乱接。
  - 先依赖什么：4.2
  - 开始前先看：
    - `docs/20260613-ClaudeHook事件清单.md`
  - 主要改哪里：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - 如确定接入，再改实现文件
  - 这一步先不做什么：不默认承诺所有低价值事件都实现。
  - 怎么算完成：
    1. 每个剩余事件都能说清“要不要接”
    2. 没价值的事件明确标记为暂不做
  - 怎么验证：
    - `CI=1 pnpm --dir apps/host test tests/integration/session-live-runtime-service.test.ts tests/integration/session-permission-request-service.test.ts`

---

## 后续建议阶段：前端可见 UI 美化

- [x] 5.1 把主要和前端交汇的 Claude Hook 状态做成只读卡片
  - 状态：DONE
  - 这一步到底做什么：把 `Notification`、`Setup`、`UserPromptExpansion`、`SubagentStart`、`SubagentStop`、`InstructionsLoaded`、`ConfigChange`、`CwdChanged`、`FileChanged`、`WorktreeCreate`、`WorktreeRemove` 这类主要运行态，做成时间线里的只读卡片。
  - 做完你能看到什么：这些状态不再只是底层 detail，而是会以统一卡片出现在对话时间线里。
  - 先依赖什么：4.3
  - 开始前先看：
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
    - `docs/20260614-ClaudeHook前端可见状态设计.md`
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/timeline-source-items.ts`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
    - `apps/user-app/src/features/conversation/components/MessageTimeline.tsx`
    - `apps/user-app/src/features/conversation/components/MessageTimeline.test.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
  - 这一步先不做什么：不把所有 Hook 都做成可点击卡片，不再新长一套样式体系。
  - 怎么算完成：
    1. 主要 Hook 状态能在时间线里看到
    2. 卡片样式和 Ask Question 保持统一
    3. 原有结构化问题和任务卡片不被破坏
  - 怎么验证：
    - `CI=1 pnpm --dir apps/user-app test src/features/conversation/components/MessageTimeline.test.tsx src/features/conversation/components/MessageTimeline.structured-question.test.tsx`
    - `pnpm --dir apps/user-app exec tsc -p tsconfig.json --noEmit`

---

## 阶段 1：先把 Plan 审批打通

- [x] 1.1 给 Claude Hook settings 补上 `ExitPlanMode` matcher
  - 状态：DONE
  - 这一步到底做什么：修改 Claude Hook settings 生成逻辑，让 `ExitPlanMode` 能通过 `PreToolUse` 进入现有 Hook bridge。
  - 做完你能看到什么：Claude 计划模式结束时，CodingNS 能收到请求，不再漏掉。
  - 先依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 5
    - `design.md` §2.1.1、§3.3.1、§4.3.1
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/claude-runtime.ts`
    - `apps/host/tests/integration/session-permission-request-service.test.ts`
  - 这一步先不做什么：不顺手改前端展示。
  - 怎么算完成：
    1. `ExitPlanMode` 进入 matcher
    2. 现有 `AskUserQuestion` matcher 还在
  - 怎么验证：
    - `CI=1 pnpm --dir apps/host test tests/integration/session-permission-request-service.test.ts`
  - 对应需求：`requirements.md` 需求 2、需求 5
  - 对应设计：`design.md` §2.1.1、§4.3.1

- [x] 1.2 在 Host 把 `ExitPlanMode` 规范化成计划审批请求
  - 状态：DONE
  - 这一步到底做什么：在 `SessionPermissionRequestService` 里识别 `ExitPlanMode`，创建 `plan_approval` 请求并准备 Claude 回写结构。
  - 做完你能看到什么：Host 端不再把计划审批当普通命令权限，数据结构也能带上 `allowedPrompts`。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 5、需求 6
    - `design.md` §2.2、§4.2、§4.3.3、§5.1
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-permission-request-service.ts`
    - `apps/host/tests/integration/session-permission-request-service.test.ts`
  - 这一步先不做什么：不扩全量运行态事件。
  - 怎么算完成：
    1. 新增 `plan_approval` kind
    2. 用户批准/拒绝都能生成 Claude 认可的回写
    3. 现有 `user_input` / `permissions` 不回归
  - 怎么验证：
    - `CI=1 pnpm --dir apps/host test tests/integration/session-permission-request-service.test.ts`
  - 对应需求：`requirements.md` 需求 2、需求 5、需求 6
  - 对应设计：`design.md` §2.2、§4.2、§4.3.3、§5.1

- [x] 1.3 阶段检查：Claude Plan 审批主链路已经通了
  - 状态：DONE
  - 这一步到底做什么：只检查 Claude 计划审批是不是已经从 Hook 到 Host 打通，不扩新范围。
  - 做完你能看到什么：Claude 能真正把计划请求送进 CodingNS，而不是继续漏接。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关文件
  - 这一步先不做什么：不开始补一堆运行态事件。
  - 怎么算完成：
    1. `ExitPlanMode` 已能创建审批请求
    2. 批准和拒绝都有明确回写
  - 怎么验证：
    - `CI=1 pnpm --dir apps/host test tests/integration/session-permission-request-service.test.ts`
  - 对应需求：`requirements.md` 需求 2、需求 5
  - 对应设计：`design.md` §3.3.1、§4.3.3

---

## 阶段 2：把 Claude Plan 展示接进前端

- [x] 2.1 给前端计划快照补 Claude `ExitPlanMode` 识别
  - 状态：DONE
  - 这一步到底做什么：在现有任务/计划快照逻辑里新增 Claude 计划识别，不再只认 Codex 的 `update_plan`。
  - 做完你能看到什么：Claude 提交计划后，前端能在现有计划区域看到最小可用内容。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §3.3.3、§4.2.3、§7.3
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/session-task-progress.ts`
    - `apps/user-app/src/features/conversation/session-task-progress.test.ts`
  - 这一步先不做什么：不重做整个会话页面。
  - 怎么算完成：
    1. Claude `ExitPlanMode` 能被识别成计划来源
    2. 提取不到完整条目时仍保留原始工具调用
  - 怎么验证：
    - `CI=1 pnpm --dir apps/user-app test src/features/conversation/session-task-progress.test.ts`
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §3.3.3、§4.2.3

- [x] 2.2 给对话时间线补计划审批和 `allowedPrompts` 展示
  - 状态：DONE
  - 这一步到底做什么：在现有时间线/审批区域里，把 Claude Plan 审批和后续操作提示展示出来。
  - 做完你能看到什么：用户能直接看懂 Claude 想怎么做，以及接下来可能跑哪类操作。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` §4.2.2、§4.2.3
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
    - `docs/开发设计规范/20260419-模态框与按钮设计规范.md`（如果涉及模态结构调整）
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/MessageTimeline.tsx`
    - `apps/user-app/src/features/conversation/components/MessageTimeline.test.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/app/styles.css`
  - 这一步先不做什么：不顺手改别的 provider 展示。
  - 怎么算完成：
    1. Claude 计划审批有单独可见说明
    2. `allowedPrompts` 能以用户看得懂的方式展示
    3. 不出现硬编码文案
  - 怎么验证：
    - `CI=1 pnpm --dir apps/user-app test src/features/conversation/components/MessageTimeline.test.tsx`
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §4.2.2、§4.2.3

- [x] 2.3 阶段检查：Claude Plan 从后端到前端已经能看见
  - 状态：DONE
  - 这一步到底做什么：检查 Claude 计划审批和计划展示是不是已经形成一条完整主链路。
  - 做完你能看到什么：不是只有后端能收，前端也真能看懂。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关文件
  - 这一步先不做什么：不扩其余 Hook 运行态。
  - 怎么算完成：
    1. Claude 计划审批可见
    2. Claude 计划内容可见
  - 怎么验证：
    - `CI=1 pnpm --dir apps/user-app test src/features/conversation/session-task-progress.test.ts src/features/conversation/components/MessageTimeline.test.tsx`
    - `pnpm --dir apps/user-app exec tsc -p tsconfig.json --noEmit`
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §3.3.1、§3.3.3

---

## 阶段 3：补关键运行态事件，但别把系统再写乱

- [x] 3.1 给 Claude Hook 路由补关键运行态事件映射
  - 状态：DONE
  - 这一步到底做什么：把 `PostToolUse`、`PostToolUseFailure`、`PermissionDenied`、`TaskCreated`、`TaskCompleted`、`SubagentStop`、`PreCompact`、`PostCompact` 接入统一映射。
  - 做完你能看到什么：这些关键状态不会再被吞掉。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 4、需求 6
    - `design.md` §2.1.2、§4.1、§5.2
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - 相关测试文件
  - 这一步先不做什么：不要求所有事件第一版都做成复杂前端卡片。
  - 怎么算完成：
    1. 关键运行态事件已进入统一映射
    2. 未知事件仍安全忽略
  - 怎么验证：
    - `CI=1 pnpm --dir apps/host test tests/integration/session-live-runtime-service.test.ts`
  - 对应需求：`requirements.md` 需求 1、需求 4、需求 6
  - 对应设计：`design.md` §2.1.2、§4.1、§5.2

- [x] 3.2 回归现有权限和问题回答链路
  - 状态：DONE
  - 这一步到底做什么：专门检查这次补 Hook 和 Plan 之后，原有 `PermissionRequest`、`AskUserQuestion`、普通 `PreToolUse` 有没有被改坏。
  - 做完你能看到什么：旧链路还稳，新链路也能用。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §6.2、§7.1、§7.2
  - 主要改哪里：
    - `apps/host/tests/integration/session-permission-request-service.test.ts`
    - `apps/user-app/src/features/conversation/components/MessageTimeline.structured-question.test.tsx`
  - 这一步先不做什么：不做无关 provider 回归。
  - 怎么算完成：
    1. 权限审批还可用
    2. 结构化问题还可用
    3. Claude Plan 不会串成错误请求类型
  - 怎么验证：
    - `CI=1 pnpm --dir apps/host test tests/integration/session-permission-request-service.test.ts`
    - `CI=1 pnpm --dir apps/user-app test src/features/conversation/components/MessageTimeline.structured-question.test.tsx`
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §6.2、§7.1、§7.2

- [x] 3.3 最终检查点
  - 状态：DONE
  - 这一步到底做什么：确认 Claude Hook 兼容这次是真的补到了关键状态，而不是又多了几个 if/else。
  - 做完你能看到什么：Plan 审批、计划展示、关键运行态、旧链路兼容都能对上需求和设计。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件和本轮实现文件
  - 这一步先不做什么：不再临时加新 Hook 范围。
  - 怎么算完成：
    1. `ExitPlanMode` 已打通
    2. Claude Plan 已可展示
    3. 关键 Hook 事件已统一映射
    4. 旧权限和问题回答链路未回归
  - 怎么验证：
    - `CI=1 pnpm --dir apps/host test tests/integration/session-live-runtime-service.test.ts tests/integration/session-permission-request-service.test.ts`
    - `CI=1 pnpm --dir apps/user-app test src/features/conversation/session-task-progress.test.ts src/features/conversation/components/MessageTimeline.test.tsx src/features/conversation/components/MessageTimeline.structured-question.test.tsx`
    - `pnpm --dir apps/user-app exec tsc -p tsconfig.json --noEmit`
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
