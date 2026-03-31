# 任务清单 - spec003.4 会话活动状态权威源与稳定显示（人话版）

状态：DONE

## 2026-03-31 进展补记

- 0.1 已完成：
  - Host 和前端 DTO 已补齐统一活动状态基础字段：`activityResolutionSource`、`activityConfidence`、`runId`、`watchdogTriggeredAt`
  - `runningState` 合同已为后续 `stale/unknown` 状态预留
- 1.1 已完成：
  - 已新增 `SessionActivityAuthorityService`
  - Host runtime 接口现在会优先通过 authority service 产出统一裁决结果
  - 已补 authority service 的来源优先级和 watchdog 降级测试
- 1.2 已完成：
  - `SessionHistoryService` 现在也会把日志扫描结果先送进 authority service，再决定列表/详情返回什么状态
  - 旧的 `session_states` 仍保留兼容写入，但不再被当成唯一真相
- 3.1 已完成：
  - `create-server` 已改成给 `SessionHistoryService` 和 `SessionLiveRuntimeService` 共享同一个 authority service 实例
  - 列表接口和 runtime 接口现在都会返回同一套统一裁决字段
  - 已补集成测试，验证 Claude provider event 进入后，列表和 runtime 接口读到的是同一份状态来源
- 3.2 已完成：
  - Host WebSocket 已新增统一 `session.activity` 事件
  - runtime 订阅现在会先推送统一裁决结果，watchdog 降级也能通过 authority service 订阅回流到前端
- 4.1 已完成：
  - 工作台导航、移动会话列表、移动预览现在都按后端统一裁决字段显示活动状态
  - 前端不再只靠 `activityState === running` 这一条旧线索硬猜 `stale/unknown`
- 4.2 已完成：
  - 已补 `runtimeStale` / `runtimeUnknown` 文案
  - 已补桌面端、原生工作台、移动会话列表的 `stale/unknown` 视觉区分
- 2.1 已完成：
  - `SessionActivityAuthorityService` 现在会根据 `lastObservedAt` 为 authoritative runtime 安排 watchdog
  - 长时间无新事件会按 `running -> stale -> unknown` 降级
  - 收到同一轮更新的更新鲜 runtime 事件后可以恢复，不会无证据直接写成 `failed`
- 2.2 已完成：
  - watchdog 结果现在已经进入统一裁决输出
  - runtime 接口、会话列表和 `session.activity` 事件都会带 `watchdogTriggeredAt`
  - 前端可以明确区分“provider 明确终态”和“Host 失去稳定活动证据”
- 5.1 已完成：
  - 已补 authority service、runtime service、runtime/list 对齐的 Host 集成测试
  - 已覆盖来源优先级、终态保护、watchdog 降级、旧快照不能误抬回 running
- 5.2 进展补记：
  - 已补 `session-runtime-store` 的 `session.activity` 消费测试
  - 已补 `WorkbenchLayout` 的 stale 状态显示测试
  - `ConversationPage` 页面级 stale 状态测试也已补完
- 5.3 已完成：
  - Host 自发起会话、provider 事件回刷、日志推断现在都会先收口到 authority service
  - 前端页面、列表、移动预览都只读后端统一裁决结果
  - 这次收口解决的是“状态真相唯一且显示稳定”，不等于三家 provider 都天然提供明确终态事件

## 这份文档是干什么的

这份任务清单用来把“会话活动状态唯一权威源”拆成能落地的步骤。

这次不要再犯两个低级错误：

1. 一边说后端统一裁决，一边还允许多个模块各自写最终状态
2. 一边说前端不再脑补，一边还让列表摘要和 runtime 快照互相覆盖

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已完成，待复核
- `DONE`：已经完成并回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻回写本文档
- `BLOCKED` 必须写清楚卡在哪里

---

## 阶段 0：先把状态模型钉死

- [x] 0.1 定义统一活动状态、来源、可信度和轮次模型
  - 状态：DONE
  - 这一步到底做什么：把 `runningState`、`activitySource`、`activityConfidence`、`runId`、`watchdogTriggeredAt` 这些字段定义清楚，并写进 Host / 前端 DTO 合同。
  - 做完以后能看到什么结果：后面所有模块都按同一套字段说话，不再各自发明名词。
  - 这一步依赖什么：无
  - 主要改哪些文件：
    - `specs/spec003.4-会话活动状态权威源与稳定显示/requirements.md`
    - `specs/spec003.4-会话活动状态权威源与稳定显示/design.md`
    - `apps/host/src/types/domain.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
  - 这一步明确不做什么：先不改具体 provider 实现。
  - 怎么验证是不是真的做完了：
    1. 后端和前端 DTO 使用同一套状态枚举
    2. 字段语义在文档里已写清楚

---

## 阶段 1：把后端统一裁决服务建起来

- [x] 1.1 新增 SessionActivityAuthorityService
  - 状态：DONE
  - 这一步到底做什么：新增统一裁决服务，让 runtime、provider event、inferred log 先变成 observation，再产出唯一裁决结果。
  - 做完以后能看到什么结果：后端终于有一个专门负责活动状态真相的地方。
  - 这一步依赖什么：0.1
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/session-activity-authority-service.ts`（预期新增）
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
  - 这一步明确不做什么：先不接 watchdog。
  - 怎么验证是不是真的做完了：
    1. 三类来源都能送入 authority service
    2. authority service 能输出统一裁决结果

- [x] 1.2 收紧现有模块职责，禁止散落写最终状态
  - 状态：DONE
  - 这一步到底做什么：让 `session-live-runtime-service`、`session-history-service`、`session-activity-inspector` 不再直接各自写最终真相，而是统一经 authority service。
  - 做完以后能看到什么结果：状态判断路径收口，不再多头写库。
  - 这一步依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/sessions/session-activity-inspector.ts`
  - 这一步明确不做什么：先不改前端。
  - 怎么验证是不是真的做完了：
    1. 关键状态写入点只剩 authority service
    2. 终态保护规则通过测试

---

## 阶段 2：给 Host 自己发起的 run 增加 watchdog

- [x] 2.1 为 active run 增加 lastObservedAt 与 watchdog 定时检查
  - 状态：DONE
  - 这一步到底做什么：在 Host 自己持有的 active run 上增加超时检查，避免挂死 run 永远显示运行中。
  - 做完以后能看到什么结果：长时间无新事件的 run 会先降级成 `stale`，再视情况变成 `unknown`。
  - 这一步依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/session-activity-authority-service.ts`
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
  - 这一步明确不做什么：不靠系统进程扫描判断死活。
  - 怎么验证是不是真的做完了：
    1. 超过阈值后状态会降级
    2. 收到新事件后可恢复
    3. 不会无证据直接改成 `failed`

- [x] 2.2 把 watchdog 结果纳入统一裁决与输出
  - 状态：DONE
  - 这一步到底做什么：让 watchdog 触发结果能进入统一裁决、API 返回和实时事件输出。
  - 做完以后能看到什么结果：排查时能看出“这是 provider 真停了”还是“只是 watchdog 判定失去可信活动证据”。
  - 这一步依赖什么：2.1
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/session-activity-authority-service.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
  - 这一步明确不做什么：先不改 UI 文案。
  - 怎么验证是不是真的做完了：
    1. runtime DTO 含 `watchdogTriggeredAt`
    2. 列表和 `session.activity` 事件也能看到 watchdog 触发信息

---

## 阶段 3：统一 API 和 WS 输出

- [x] 3.1 runtime 接口与会话列表改成同一套裁决字段
  - 状态：DONE
  - 这一步到底做什么：让列表、详情、runtime 接口都返回统一的活动状态字段。
  - 做完以后能看到什么结果：前端不再从不同接口拿到互相矛盾的状态。
  - 这一步依赖什么：1.2、2.2
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/session-controller.ts`
    - `apps/host/src/storage/repositories/session-index-repository.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
  - 这一步明确不做什么：先不删旧字段，允许过渡兼容。
  - 怎么验证是不是真的做完了：
    1. 列表和 runtime 接口能返回 `activitySource/activityConfidence`
    2. 同一会话在两个接口里状态一致

- [x] 3.2 WebSocket 增加统一 session.activity 事件
  - 状态：DONE
  - 这一步到底做什么：新增统一活动状态事件，让前端订阅同一份裁决结果。
  - 做完以后能看到什么结果：前端不再只靠局部 `session.runtime_status` 事件拼状态。
  - 这一步依赖什么：3.1
  - 主要改哪些文件：
    - `apps/host/src/ws/ws-server.ts`
    - `apps/user-app/src/network/realtime-client.ts`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
  - 这一步明确不做什么：先不删除旧事件，允许兼容。
  - 怎么验证是不是真的做完了：
    1. 能收到 `session.activity`
    2. 前端已接入这个事件

---

## 阶段 4：让前端停止自己脑补状态

- [x] 4.1 前端活动状态显示只消费后端统一裁决结果
  - 状态：DONE
  - 这一步到底做什么：清理前端把导航摘要、本地 optimistic、runtime 快照互相覆盖的逻辑，只保留统一裁决结果作为活动状态显示依据。
  - 做完以后能看到什么结果：前端状态不再来回跳。
  - 这一步依赖什么：3.1、3.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/features/mobile-sessions/components/SessionListItem.tsx`
  - 这一步明确不做什么：不重做页面布局。
  - 怎么验证是不是真的做完了：
    1. 导航摘要不会再冲掉本地 running
    2. `stale/unknown` 显示清楚

- [x] 4.2 补前端显示文案和样式
  - 状态：DONE
  - 这一步到底做什么：为 `stale/unknown` 等状态补齐人话文案和视觉区分。
  - 做完以后能看到什么结果：用户能看懂“仍在运行”和“状态待确认”的差别。
  - 这一步依赖什么：4.1
  - 主要改哪些文件：
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/app/styles.css`
  - 这一步明确不做什么：不做新视觉体系。
  - 怎么验证是不是真的做完了：
    1. 新状态都有字典文案
    2. 样式可区分

---

## 阶段 5：补测试和验收

- [x] 5.1 补 Host 活动状态裁决和 watchdog 测试
  - 状态：DONE
  - 这一步到底做什么：为来源优先级、终态保护、watchdog 降级补回归测试。
  - 做完以后能看到什么结果：后续改 provider 或 runtime 时不容易再把状态打坏。
  - 这一步依赖什么：1.2、2.2、3.2
  - 主要改哪些文件：
    - `apps/host/tests/integration/session-runtime-status.test.ts`
    - `apps/host/tests/integration/session-live-runtime-service.test.ts`
    - 必要时新增 authority service 测试文件
  - 这一步明确不做什么：不靠手工点点点代替回归测试。
  - 怎么验证是不是真的做完了：
    1. 有来源冲突测试
    2. 有 watchdog 超时测试
    3. 有终态保护测试

- [x] 5.2 补前端活动状态消费测试
  - 状态：DONE
  - 这一步到底做什么：验证前端只按统一裁决结果显示状态，不再自己脑补。
  - 做完以后能看到什么结果：会话页面和列表页面的状态显示回归可控。
  - 这一步依赖什么：4.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.test.ts`
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.test.tsx`
    - `apps/user-app/src/features/conversation/pages/ConversationPage.test.tsx`
  - 这一步明确不做什么：不只测 happy path。
  - 怎么验证是不是真的做完了：
    1. 有 `stale/unknown` 场景测试
    2. 有导航摘要冲突测试

- [x] 5.3 阶段验收：前端看到的活动状态来源已经唯一、可信、稳定
  - 状态：DONE
  - 这一步到底做什么：做最终验收，确认本 Spec 真正收口了活动状态真相，而不是又堆了一层旁路。
  - 做完以后能看到什么结果：可以明确说“前端活动状态只读后端统一裁决结果”。
  - 这一步依赖什么：0.1 到 5.2
  - 主要改哪些文件：
    - `specs/spec003.4-会话活动状态权威源与稳定显示/tasks.md`
    - 必要时补 `docs/` 验收记录
  - 这一步明确不做什么：不临时扩大范围。
  - 怎么验证是不是真的做完了：
    1. Host 自发起会话状态稳定
    2. 三家 provider 都能输出统一来源信息
    3. 前端只消费统一裁决结果
