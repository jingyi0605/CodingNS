# 任务清单 - spec003.2 运行中消息追加与原生引导（人话版）

状态：Draft

## 2026-03-26 进展补记

- 0.1 已完成：
  - 已确认本次 Spec 只处理“运行中输入通道”，不重复覆盖 `spec003.1` 的真实运行时主链路。
- 0.2 已完成：
  - 已完成外部能力边界核实：`Claude Code` 可按长连接流式输入路线设计；`Codex` 当前只应对齐已确认的原生 `queue/steer` 语义，不能伪造即时吸收新消息。

## 这份文档是干什么的

这份任务清单用来把“运行中追加消息”拆成能落地的步骤，避免最后又写出一堆按钮和文案，底层却还是一刀切禁用。

重点只有一个：按 provider 原生能力做，不撒谎。

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

## 阶段 0：把边界讲清楚，别胡来

- [x] 0.1 启动 spec003.2 并完成范围收敛
  - 状态：DONE
  - 这一步到底做什么：确认本次 Spec 只做“运行中输入能力”，不重复改写 `spec003.1` 的全部运行时设计。
  - 做完你能看到什么：范围被钉死，不会写成一锅粥。
  - 先依赖什么：无
  - 开始前先看：
    - `specs/spec003.1-原生会话实时对话运行时/requirements.md`
    - `specs/spec003.1-原生会话实时对话运行时/design.md`
  - 主要改哪里：
    - `specs/spec003.2-运行中消息追加与原生引导/`
  - 这一部先不做什么：先不改业务代码。
  - 怎么算完成：
    1. `README.md`、`requirements.md`、`design.md`、`tasks.md` 已落盘
    2. 范围、依赖和非目标已写清楚
  - 怎么验证：
    - 文档走查
  - 对应需求：全部

- [x] 0.2 核实 `Claude` / `Codex` 的原生能力边界
  - 状态：DONE
  - 这一步到底做什么：确认两家 provider 在“运行中输入”上的真实能力边界，避免设计建立在错误假设上。
  - 做完你能看到什么：后续实现不再靠拍脑袋决定能力模型。
  - 先依赖什么：无
  - 开始前先看：
    - 外部官方文档与公开 issue
    - 当前项目已有 `spec003.1` 运行时实现
  - 主要改哪里：
    - `specs/spec003.2-运行中消息追加与原生引导/requirements.md`
    - `specs/spec003.2-运行中消息追加与原生引导/design.md`
  - 这一部先不做什么：先不接入新代码。
  - 怎么算完成：
    1. 已确认 `Claude Code` 可按长连接流式输入路线设计
    2. 已确认 `Codex` 当前不能被设计成“运行中立即吸收修正”
  - 怎么验证：
    - 文档走查
  - 对应需求：`requirements.md` 需求 1、2、3

---

## 阶段 1：先把能力合同改对

- [ ] 1.1 扩展 provider 能力模型，显式暴露运行中输入模式
  - 状态：TODO
  - 这一步到底做什么：给 `ProviderCapabilities`、前端 DTO 和 runtime 查询结果增加 `inRunInputMode`。
  - 做完你能看到什么：前后端不再靠猜决定运行中是否可发消息。
  - 先依赖什么：0.1、0.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 5、需求 6
    - `design.md` 2.2、3.1
  - 主要改哪里：
    - `packages/session-sync-core/src/types.ts`
    - `apps/host`
    - `apps/user-app`
  - 这一部先不做什么：先不改 provider runtime 逻辑。
  - 怎么算完成：
    1. 能力接口可返回 `none` / `streaming_guidance` / `queued_guidance`
    2. 前端默认可安全退化
  - 怎么验证：
    - 类型检查
    - 能力接口测试

- [ ] 1.2 扩展 active run 合同，支持运行中输入
  - 状态：TODO
  - 这一步到底做什么：给 `ActiveRunHandle` 和 `ProviderRuntimeLaunchResult` 增加可选 `submitDuringRun`。
  - 做完你能看到什么：运行中的会话终于有了第二种动作，不再只有中断。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 4、需求 6
    - `design.md` 2.3、3.2
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/types.ts`
    - `packages/session-sync-core/src/runtime/active-run-registry.ts`
    - `packages/session-sync-core/src/runtime/provider-runtime-service.ts`
  - 这一部先不做什么：先不接具体 provider。
  - 怎么算完成：
    1. Host 能把消息投递给现有 active run
    2. 不支持的 provider 能明确拒绝
  - 怎么验证：
    - 运行时合同测试

- [ ] 1.3 调整 Host 消息入口，优先复用 active run
  - 状态：TODO
  - 这一步到底做什么：把 `messages/live` 变成“若会话运行中且支持运行中输入，则走 active run”的入口。
  - 做完你能看到什么：不再动不动撞上 `ACTIVE_RUN_EXISTS`。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5、需求 6
    - `design.md` 3.3、5.2、5.4
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - `apps/host/src/modules/sessions/session-provider-error-mapper.ts`
  - 这一部先不做什么：先不开放前端交互。
  - 怎么算完成：
    1. active run 存在时不再盲目 start/continue
    2. 错误码不再把能力问题伪装成 provider I/O 问题
  - 怎么验证：
    - Host 集成测试

---

## 阶段 2：只把 Claude 这条真能走的路打通

- [ ] 2.1 把 Claude Runtime 改成长连接 `stdin/jsonl` 输入
  - 状态：TODO
  - 这一步到底做什么：把当前一次性 `claude -p` 进程改造成能持续接收输入的运行时。
  - 做完你能看到什么：同一 Claude 会话在运行中可以继续追加指导。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4、需求 6
    - `design.md` 4.1、5.2
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/claude-runtime.ts`
  - 这一部先不做什么：先不改 Codex。
  - 怎么算完成：
    1. Claude 进程支持持续 stdin 输入
    2. 首条消息与追加指导都能走同一 active run
  - 怎么验证：
    - Claude runtime 集成测试
    - 手工运行验证

- [ ] 2.2 收敛 Claude 运行中输入的事件与消息对账
  - 状态：TODO
  - 这一步到底做什么：确保运行中追加指导后，accepted message、流式事件和历史同步不打架。
  - 做完你能看到什么：UI 不会重复插消息，也不会把会话跑分叉。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4、需求 6
    - `design.md` 4.1、5.2、7.1
  - 主要改哪里：
    - `apps/host`
    - `apps/user-app`
  - 这一部先不做什么：先不动 Codex 能力位。
  - 怎么算完成：
    1. 运行中追加指导可稳定对账
    2. 同一原生会话绑定保持不变
  - 怎么验证：
    - 消息合并测试
    - Host/前端联调验证

- [ ] 2.3 阶段检查：Claude 运行中追加指导已经是真能力
  - 状态：TODO
  - 这一步到底做什么：确认 Claude 这条路线已经不需要再靠中断重发假装支持运行中输入。
  - 做完你能看到什么：至少有一个 provider 真正把运行中输入打通。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4、需求 5、需求 6
    - `design.md` 4.1、5.2、8.1
  - 主要改哪里：本阶段 Claude 相关代码和测试
  - 这一部先不做什么：不混进 Codex 伪实现。
  - 怎么算完成：
    1. Claude 运行中能追加指导
    2. 不需要第二个 active run
    3. 事件链路和会话绑定稳定
  - 怎么验证：
    - E2E 验证

---

## 阶段 3：Codex 先说真话，再决定是否接 queue

- [ ] 3.1 把 Codex 能力显式化为真实现状
  - 状态：TODO
  - 这一步到底做什么：让 `Codex` 在能力接口和前端上明确表现为当前真实状态，而不是默认跟 Claude 一样。
  - 做完你能看到什么：用户不会再被误导成“Codex 也支持运行中继续引导”。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3、需求 5
    - `design.md` 2.2、4.2、6.1
  - 主要改哪里：
    - `packages/session-sync-core/src/providers/codex.ts`
    - `apps/user-app`
  - 这一部先不做什么：先不接 queue 行为。
  - 怎么算完成：
    1. `Codex` 默认 `inRunInputMode` 明确
    2. 前端文案与行为一致
  - 怎么验证：
    - 能力接口测试
    - 前端交互测试

- [ ] 3.2 条件任务：若官方接入层稳定支持 queue/steer，则补齐 `queued_guidance`
  - 状态：TODO
  - 这一步到底做什么：仅在当前接入层能稳定暴露原生 queue/steer 时，增加 `queued_guidance` 分支。
  - 做完你能看到什么：Codex 可按“加入队列”语义工作。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4、需求 5
    - `design.md` 4.2、5.3、8.2
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/codex-runtime.ts`
    - `apps/host`
    - `apps/user-app`
  - 这一部先不做什么：绝不自己实现项目私有队列。
  - 怎么算完成：
    1. queue 行为来自原生能力而不是项目伪造
    2. UI 文案明确是“加入队列”
  - 怎么验证：
    - 集成测试
    - 手工验证

---

## 阶段 4：把前端交互补完整

- [ ] 4.1 输入区按能力切换交互
  - 状态：TODO
  - 这一步到底做什么：让输入区根据 `inRunInputMode` 决定是否可发、显示什么按钮文案。
  - 做完你能看到什么：运行中输入不再一刀切禁用。
  - 先依赖什么：1.1、1.3
  - 开始前先看：
    - `requirements.md` 需求 5、需求 6
    - `design.md` 6.1、6.2
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
  - 这一部先不做什么：先不大改视觉样式。
  - 怎么算完成：
    1. `none` / `streaming_guidance` / `queued_guidance` 三种状态可正确表现
    2. 旧能力字段缺失时可安全退化
  - 怎么验证：
    - 组件测试
    - 页面联调

- [ ] 4.2 阶段检查：运行中输入链路收敛完成
  - 状态：TODO
  - 这一步到底做什么：确认从能力声明、Host 分发、provider 接入到前端文案已经收敛成一条可信链路。
  - 做完你能看到什么：`spec003.2` 可以进入实施阶段，而不是继续在概念上打转。
  - 先依赖什么：2.3，3.1，视情况包含 3.2，4.1
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关测试与文档
  - 这一部先不做什么：不额外扩范围。
  - 怎么算完成：
    1. Claude 路线已真打通
    2. Codex 路线已按真实能力落地
    3. 前后端行为与 spec 一致
  - 怎么验证：
    - 文档走查
    - 集成测试
    - 手工验收
