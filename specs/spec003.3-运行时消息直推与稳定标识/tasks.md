# 任务清单 - spec003.3 运行时消息直推与稳定标识（人话版）

状态：DONE

## 2026-03-28 进展补记

- 0.1 已完成：
  - `README.md`、`requirements.md`、`design.md`、`tasks.md` 已创建。
  - 本 Spec 范围已收敛到三件事：运行时正文直推、稳定消息 ID、历史层职责回归。
  - 已明确本阶段不把 UI 重做、富内容扩展和新 provider 接入混进来。
- 1.1 已完成：
  - Host 现在会把 `RuntimeEvent.message` 直接映射成 `session.runtime_message` 推给聊天 WebSocket。
  - 前端 `RealtimeClient` 和 `SessionRuntimeStore` 已接住这条新事件链路，不再要求正文先绕历史轮询。
- 1.2 已完成：
  - 当前聊天正文主链路已切到 runtime 直推。
  - 历史层仍保留 `backfill/delta` 用于首屏、重连和补偿，但不再是正文唯一来源。
- 2.1 已完成：
  - `OpenCode` 同一 `partId` 的 `updated/delta` 现在会复用同一逻辑消息身份。
  - 同一消息更新时 `messageId/rawRef/sequence` 保持稳定。
- 2.2 已完成：
  - `Claude` runtime 已引入逻辑消息 identity 映射，不再把 sequence 当长期消息身份。
  - 同一逻辑消息连续更新时，`messageId/rawRef` 可保持稳定。
- 2.3 已完成：
  - 已核实 `Codex` 当前 runtime 仍按 `item.started/item.completed` 做块级输出。
  - 本阶段不伪造 token 级 partial；现状已经符合本 Spec 的真实能力边界，所以无需额外改动。
- 3.1 已完成：
  - WebSocket 去重已从“见过同 ID 就丢”改成“同 ID 且内容签名没变才丢”。
  - 运行时直推和历史补偿现在可以在同一 `messageId` 下做更新，而不是互相屏蔽。
- 3.2 已完成：
  - 前端消息合并已支持同一 `messageId` 的增量覆盖。
  - 工具消息状态可从 `running` 正常覆盖为 `completed/failed`，文本正文增长不会倒退。
- 4.1 已完成：
  - 已补 `Claude`、`OpenCode` 的稳定消息身份回归测试。
- 4.2 已完成：
  - 已补 Host 与前端侧的 runtime message 集成测试。
- 4.3 已完成：
  - `session-sync-core`、`apps/host`、`apps/user-app` 的目标回归测试已通过。
  - 这轮改造已经把聊天正文主链路切到 runtime 直推。
- 2026-03-28 Claude 补记：
  - 已补 `claude-code` history/runtime 共用的稳定消息身份规则，不再出现 runtime 一条、history 再来一条的重复 thinking。
  - 已补 `Claude stream_event` 的最小兼容，`thinking` 增量和最基本的 tool input 增量不再只能等最后整条 assistant 落地。
  - 已补对应回归测试，覆盖 Claude history 合并和 runtime stream_event thinking 增量。

## 这份文档是干什么的

这份任务清单用来把“聊天正文改走运行时直推”拆成能落地的步骤。

这次不要再犯两个低级错误：

1. 一边说实时，一边还让正文靠历史轮询主分发
2. 一边说消息更新，一边还拿 sequence 当消息身份

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

## 阶段 0：先把范围钉死，别又写成一锅粥

- [x] 0.1 启动 spec003.3 并完成范围收敛
  - 状态：DONE
  - 这一步到底做什么：把本次 Spec 明确收敛为“运行时正文直推 + 稳定消息 ID + 历史层职责回归”。
  - 做完以后能看到什么结果：后续实现不会把 UI 重做、富内容渲染和 provider 新能力混进来。
  - 这一步依赖什么：无
  - 主要改哪些文件：
    - `specs/spec003.3-运行时消息直推与稳定标识/README.md`
    - `specs/spec003.3-运行时消息直推与稳定标识/requirements.md`
    - `specs/spec003.3-运行时消息直推与稳定标识/design.md`
    - `specs/spec003.3-运行时消息直推与稳定标识/tasks.md`
  - 这一步明确不做什么：先不改业务代码。
  - 怎么验证是不是真的做完了：
    1. 四个主文档已落盘
    2. 范围、依赖和非目标已写清楚

---

## 阶段 1：把消息通道改正

- [x] 1.1 让 Host 把 runtime message 直接转成聊天 WS 事件
  - 状态：DONE
  - 这一步到底做什么：修改会话 WS 转发链路，让 `RuntimeEvent.message` 不再被丢掉，而是直接推送给前端。
  - 做完以后能看到什么结果：聊天窗口不需要等历史轮询，也能先看到实时正文。
  - 这一步依赖什么：0.1
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - `apps/host/src/ws/ws-server.ts`
    - `apps/user-app/src/network/realtime-client.ts`
  - 这一步明确不做什么：先不改 provider 的消息 ID 规则。
  - 怎么验证是不是真的做完了：
    1. WS 新增 `session.runtime_message` 事件
    2. 运行时正文能不经过历史轮询直接到前端
    3. 现有状态事件不受影响

- [x] 1.2 收紧历史层职责，只保留回放和补偿
  - 状态：DONE
  - 这一步到底做什么：梳理历史订阅链路，确保它不再承担实时正文主分发。
  - 做完以后能看到什么结果：历史层只负责首屏、重连和恢复，不再冒充实时推流。
  - 这一步依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
  - 这一步明确不做什么：先不移除历史读取接口。
  - 怎么验证是不是真的做完了：
    1. 正常在线时正文主来源是 runtime message
    2. 断线重连时仍能靠历史补齐
    3. 首屏回放能力不退化

---

## 阶段 2：统一稳定消息 ID，别再拿 sequence 顶锅

- [x] 2.1 固定 OpenCode 的 part 级消息身份
  - 状态：DONE
  - 这一步到底做什么：确认 `opencode` 的 runtime 和历史都继续按 `partRawRef` 产出同一个消息 ID。
  - 做完以后能看到什么结果：同一个 part 的内容增长时，前端表现为同一条消息续写。
  - 这一步依赖什么：1.1
  - 主要改哪些文件：
    - `packages/session-sync-core/src/runtime/opencode-runtime.ts`
    - `packages/session-sync-core/src/providers/opencode-shared.ts`
  - 这一步明确不做什么：先不扩展富 part UI。
  - 怎么验证是不是真的做完了：
    1. 同一 `partId` 多次更新时 `messageId` 不变
    2. 前端不会插出重复气泡

- [x] 2.2 重做 Claude 的逻辑消息身份
  - 状态：DONE
  - 这一步到底做什么：把 `claude-code` runtime 从“sequence 生成消息身份”改成“逻辑 part 稳定身份”。
  - 做完以后能看到什么结果：partial/progress 更新会覆盖旧消息，而不是反复新增。
  - 这一步依赖什么：1.1
  - 主要改哪些文件：
    - `packages/session-sync-core/src/runtime/claude-runtime.ts`
    - 必要时新增 `packages/session-sync-core/src/runtime/claude-message-identity.ts`
  - 这一步明确不做什么：先不重写 Claude 历史读取层。
  - 怎么验证是不是真的做完了：
    1. 同一逻辑消息更新时 `messageId` 不变
    2. `tool_use/tool_result` 关系仍正确
    3. 运行中消息不会被切成一串重复片段

- [x] 2.3 让 Codex 老老实实维持块级输出
  - 状态：DONE
  - 这一步到底做什么：把 `codex` 的实时正文定义为 item 级或步骤级输出，不伪造 token 流。
  - 做完以后能看到什么结果：Codex 的行为和它当前真实能力一致，不再误导 UI。
  - 这一步依赖什么：1.1
  - 主要改哪些文件：
    - `packages/session-sync-core/src/runtime/codex-runtime.ts`
    - `packages/session-sync-core/src/providers/codex.ts`
  - 这一步明确不做什么：不凭空制造 partial token 事件。
  - 怎么验证是不是真的做完了：
    1. assistant/reasoning/tool 事件仍能实时显示
    2. 没有假的 token 级拆分

---

## 阶段 3：把去重逻辑修成“更新覆盖”，不是“同 ID 全丢”

- [x] 3.1 Host 区分“重复事件”和“同一消息更新”
  - 状态：DONE
  - 这一步到底做什么：调整 Host 去重策略，让同一 `messageId` 但内容变化的消息可以继续下发。
  - 做完以后能看到什么结果：流式续写不会被 Host 的去重挡掉。
  - 这一步依赖什么：2.1、2.2、2.3
  - 主要改哪些文件：
    - `apps/host/src/ws/ws-server.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
  - 这一步明确不做什么：不放开完全重复的消息重发。
  - 怎么验证是不是真的做完了：
    1. 同一 `messageId` 同内容只发一次
    2. 同一 `messageId` 新内容会继续下发
    3. 历史补偿和实时正文不会互相打架

- [x] 3.2 前端按同一消息更新覆盖显示
  - 状态：DONE
  - 这一步到底做什么：让前端对 `session.runtime_message` 和历史补偿统一走覆盖式合并。
  - 做完以后能看到什么结果：最后一条消息变长时，页面表现为续写，不是多一条。
  - 这一步依赖什么：3.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-machine.ts`
  - 这一步明确不做什么：不改时间线视觉结构。
  - 怎么验证是不是真的做完了：
    1. 同 ID 消息更新能覆盖
    2. 自动滚动行为仍正常
    3. optimistic user message 对账不回退

---

## 阶段 4：补测试和验收，别留下嘴上流式

- [x] 4.1 补 session-sync-core 回归测试
  - 状态：DONE
  - 这一步到底做什么：给三家 provider 的消息身份和 runtime 更新补测试。
  - 做完以后能看到什么结果：后续改 provider 解析逻辑时不会轻易把流式续写打坏。
  - 这一步依赖什么：2.1、2.2、2.3
  - 主要改哪些文件：
    - `packages/session-sync-core/tests/opencode-runtime.test.mjs`
    - `packages/session-sync-core/tests/claude-runtime-stream-input.test.mjs`
    - `packages/session-sync-core/tests/codex-adapter.test.mjs`
  - 这一步明确不做什么：不拿手工测试代替回归测试。
  - 怎么验证是不是真的做完了：
    1. 三家 provider 都有稳定消息 ID 用例
    2. OpenCode / Claude 都有“同一消息更新”用例

- [x] 4.2 补 Host 与前端集成测试
  - 状态：DONE
  - 这一步到底做什么：验证 `session.runtime_message` 从 Host 到前端 store 的整条链路。
  - 做完以后能看到什么结果：真正证明聊天窗口吃到的是直推正文，不是轮询幻觉。
  - 这一步依赖什么：1.1、3.2
  - 主要改哪些文件：
    - `apps/host/tests/integration/session-live-runtime-service.test.ts`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.test.ts`
    - `apps/user-app/src/features/conversation/components/MessageTimeline.test.tsx`
  - 这一步明确不做什么：不只测状态事件。
  - 怎么验证是不是真的做完了：
    1. WS 能收到 runtime message
    2. 前端会把同一条消息持续更新
    3. 历史补偿不会造成重复渲染

- [x] 4.3 阶段验收：聊天正文主链路已经从历史轮询切到 runtime 直推
  - 状态：DONE
  - 这一步到底做什么：做最终验收，确认本 Spec 真解决的是主问题，不是又堆了一层旁路。
  - 做完以后能看到什么结果：可以明确说“正文主链路已切换”。
  - 这一步依赖什么：1.1 到 4.2
  - 主要改哪些文件：
    - `specs/spec003.3-运行时消息直推与稳定标识/tasks.md`
    - 必要时补 `docs/` 验收记录
  - 这一步明确不做什么：不临时加新范围。
  - 怎么验证是不是真的做完了：
    1. 运行时正文能先于历史补偿到前端
    2. 三家 provider 的消息身份规则都已落地
    3. 聊天窗口不再靠历史轮询冒充流式
