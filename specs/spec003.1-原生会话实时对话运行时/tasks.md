# 任务清单 - spec003.1 原生会话实时对话运行时（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单用来把“真实对话运行时”拆成能落地的步骤，避免最后又做成一堆看起来很忙、实际上不能继续聊天的假功能。

重点只有一个：每一步都必须服务“真实原生会话可继续对话”这条主线。

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

## 阶段 0：先做本机环境可行性验证

- [x] 0.1 验证本机 Claude Code 真实运行入口
  - 状态：DONE
  - 这一步到底做什么：确认本机 `Claude Code` 的版本、认证、恢复参数、流式输出入口和会话恢复能力是真能用，不是只存在文档里。
  - 做完你能看到什么：能明确知道 Claude 该走哪条技术路线，哪些参数和行为在本机成立。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3、需求 5、需求 6
    - `design.md` 2.3、3.3、8.2
    - `C:\\Code\\CodingNS\\data\\claudecodeui\\server\\claude-sdk.js`
  - 主要改哪里：
    - `specs/spec003.1-原生会话实时对话运行时/tasks.md`
    - `specs/spec003.1-原生会话实时对话运行时/docs/`
  - 这一部先不做什么：先不正式改业务代码。
  - 怎么算完成：
    1. 已确认 Claude 的可执行入口、版本、关键参数和恢复方式
    2. 已完成本机最小可行性验证并记录结果
  - 怎么验证：
    - 命令行探针
    - 本机最小会话验证
  - 对应需求：`requirements.md` 需求 1、2、3、5、6
  - 对应设计：`design.md` 2.3、3.3、8.2

- [x] 0.2 验证本机 Codex 真实运行入口
  - 状态：DONE
  - 这一步到底做什么：确认本机 `Codex` 的版本、认证、可执行入口、恢复方式、流式输出和中断能力到底能不能用。
  - 做完你能看到什么：能明确知道 Codex 是直接可接、要换调用方式，还是被本机环境卡死。
  - 先依赖什么：0.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3、需求 5、需求 6
    - `design.md` 2.3、3.3、8.2
    - `C:\\Code\\CodingNS\\data\\claudecodeui\\server\\openai-codex.js`
  - 主要改哪里：
    - `specs/spec003.1-原生会话实时对话运行时/tasks.md`
    - `specs/spec003.1-原生会话实时对话运行时/docs/`
  - 这一部先不做什么：先不改 Host 代码。
  - 怎么算完成：
    1. 已确认 Codex 的真实可执行入口和调用限制
    2. 已完成本机最小可行性验证并记录结果
  - 怎么验证：
    - 命令行探针
    - 本机最小会话验证
  - 对应需求：`requirements.md` 需求 1、2、3、5、6
  - 对应设计：`design.md` 2.3、3.3、8.2

- [x] 0.3 记录双向互通验证清单和阻断项
  - 状态：DONE
  - 这一步到底做什么：把“本项目新建 -> 原生继续”和“原生已有 -> 本项目继续”两条验证路径写成清单，并记录当前阻断项。
  - 做完你能看到什么：正式开发前，团队已经知道哪些结论成立，哪些地方还不能拍脑袋。
  - 先依赖什么：0.1、0.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` 6.1、8.1、8.2
  - 主要改哪里：
    - `specs/spec003.1-原生会话实时对话运行时/docs/acceptance-checklist.md`
    - `specs/spec003.1-原生会话实时对话运行时/docs/sdk-compatibility.md`
  - 这一部先不做什么：先不写实现代码。
  - 怎么算完成：
    1. 双向互通验证路径已经写清楚
    2. 当前机器上的阻断项已记录，不再靠口头记忆
  - 怎么验证：
    - 文档走查
  - 对应需求：`requirements.md` 需求 2、3
  - 对应设计：`design.md` 6.1、8.1、8.2

---

## 阶段 1：先把运行时合同和后端入口立住

- [x] 1.1 设计并落地统一的 Provider Runtime 合同
  - 状态：DONE
  - 这一步到底做什么：新增运行时接口、运行中句柄、统一事件模型，明确“发现历史”和“实时执行”是两层能力。
  - 做完你能看到什么：后面接 Claude/Codex 时不再各写各的野路子。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 4、需求 5、需求 6
    - `design.md` 2.1、2.2、3.2.1、3.2.2、3.2.3
  - 主要改哪里：
    - `packages/session-sync-core/src/types.ts`
    - `packages/session-sync-core/src/index.ts`
    - `packages/session-sync-core/src/runtime/`
  - 这一部先不做什么：先不接 SDK 细节，先把合同定清楚。
  - 怎么算完成：
    1. 运行时接口能表达新建、恢复、发送、中断、订阅和附着
    2. Claude/Codex 后续都能挂在同一接口下
  - 怎么验证：
    - 类型检查
    - 运行时合同单元测试
  - 对应需求：`requirements.md` 需求 1、2、4、5、6
  - 对应设计：`design.md` 2.1、2.2、3.2

- [x] 1.2 扩展 Host 会话服务和 API 入口
  - 状态：DONE
  - 这一步到底做什么：在 `host` 侧补齐新建实时会话、继续实时对话、查询运行状态和中断接口。
  - 做完你能看到什么：后端不再只有“读历史”和“写文件”，而是有真实运行时入口。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 5、需求 7
    - `design.md` 2.3、3.3
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-runtime-service.ts`
    - `apps/host/src/modules/sessions/session-controller.ts`
    - `apps/host/src/routes/sessions.ts`
  - 这一部先不做什么：先不打通前端，先把后端接口做对。
  - 怎么算完成：
    1. 后端能受理“新建实时会话”和“实时发送消息”
    2. 后端能查询运行状态并支持中断入口
  - 怎么验证：
    - 接口集成测试
    - 错误场景测试
  - 对应需求：`requirements.md` 需求 1、2、5、7
  - 对应设计：`design.md` 2.3、3.3、5.1

- [x] 1.3 阶段检查：后端不再把写会话文件伪装成聊天
  - 状态：DONE
  - 这一步到底做什么：检查后端主链路是否已经切向运行时合同，而不是继续堆文件追加逻辑。
  - 做完你能看到什么：可以放心进入 provider 实现阶段，不会边做边返工。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关后端文件和测试文件
  - 这一部先不做什么：不新增 provider 特性。
  - 怎么算完成：
    1. 关键入口已经调用运行时服务而不是直接写 jsonl
    2. 错误码和状态字段已经能表达运行态
  - 怎么验证：
    - 代码走查
    - 集成测试回放
  - 对应需求：`requirements.md` 需求 1、2、5
  - 对应设计：`design.md` 2.1、2.3、3.3

---

## 阶段 2：先把 Claude Code 真实运行时打通

- [x] 2.1 实现 Claude Runtime Adapter
  - 状态：DONE
  - 这一步到底做什么：接入 Claude 的真实会话创建、恢复、发送和流式事件消费。
  - 做完你能看到什么：Claude 会话在本项目里可以像真正聊天一样跑起来。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3、需求 5、需求 6
    - `design.md` 2.2、2.3.1、2.3.2、2.3.4
    - `C:\\Code\\CodingNS\\data\\claudecodeui\\server\\claude-sdk.js`
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/claude-runtime.ts`
    - `packages/session-sync-core/src/providers/claude-code.ts`
    - `apps/host/src/modules/sessions/session-runtime-service.ts`
  - 这一部先不做什么：先不处理多余 UI 细节。
  - 怎么算完成：
    1. 能创建原生 Claude 会话并拿到真实 session id
    2. 能恢复已有 Claude 会话继续对话
    3. 能持续推送 Claude 流式事件
  - 怎么验证：
    - Claude adapter 集成测试
    - 新建/恢复会话手工验证
  - 对应需求：`requirements.md` 需求 1、2、3、5、6
  - 对应设计：`design.md` 2.2、2.3、3.1、3.2

- [ ] 2.2 把 Claude 运行时事件接回现有历史模型
  - 状态：TODO
  - 这一步到底做什么：把 Claude 的流式事件归一化成当前系统认可的消息、状态和错误事件。
  - 做完你能看到什么：前端时间线能看到 Claude 的文本、思考、工具状态，而不是只看到一条最终结果。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` 3.2.2、4.1、6.2、6.4
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/runtime-event-normalizer.ts`
    - `apps/host/src/ws/ws-server.ts`
    - `apps/user-app/src/network/realtime-client.ts`
  - 这一部先不做什么：先不优化视觉表现。
  - 怎么算完成：
    1. 实时事件和历史消息能合并且不重复
    2. 完成、失败、中断都能反映到前端
  - 怎么验证：
    - 事件归一化测试
    - 历史/实时合并测试
  - 对应需求：`requirements.md` 需求 4、5
  - 对应设计：`design.md` 3.2.2、4.1、4.2

- [ ] 2.3 阶段检查：Claude 会话已经是真聊，不是假写入
  - 状态：TODO
  - 这一步到底做什么：验证 Claude 从新建到继续会话的主链路已经可跑通。
  - 做完你能看到什么：至少一个 provider 已经从“会话浏览器”升级成“真实会话客户端”。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 1、2、3、4、5
    - `design.md` 2.3、6.1、6.2、6.4
  - 主要改哪里：本阶段 Claude 相关文件和测试
  - 这一部先不做什么：不混入 Codex 问题。
  - 怎么算完成：
    1. Claude 新建会话实时对话可用
    2. Claude 已有会话继续对话可用
    3. 会话能回到原生环境继续
  - 怎么验证：
    - E2E 验证
    - 原生环境回接验证
  - 对应需求：`requirements.md` 需求 1、2、3、4、5
  - 对应设计：`design.md` 2.3、6.1、6.2、6.4

---

## 阶段 3：把 Codex 真实运行时打通

- [x] 3.1 实现 Codex Runtime Adapter
  - 状态：DONE
  - 这一步到底做什么：接入 Codex 的真实 thread 创建、恢复、流式执行和中断。
  - 做完你能看到什么：Codex 会话在本项目里也能真正继续运行。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3、需求 5、需求 6
    - `design.md` 2.2、2.3.1、2.3.2、2.3.4
    - `C:\\Code\\CodingNS\\data\\claudecodeui\\server\\openai-codex.js`
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/codex-runtime.ts`
    - `packages/session-sync-core/src/providers/codex.ts`
    - `apps/host/src/modules/sessions/session-runtime-service.ts`
  - 这一部先不做什么：先不做 provider 间统一 UI 花活。
  - 怎么算完成：
    1. 能创建原生 Codex thread 并拿到真实 thread id
    2. 能恢复已有 Codex 会话继续对话
    3. 能接收 Codex 流式事件并可中断
  - 怎么验证：
    - Codex adapter 集成测试
    - 新建/恢复手工验证
  - 对应需求：`requirements.md` 需求 1、2、3、5、6
  - 对应设计：`design.md` 2.2、2.3、3.1、3.2

- [ ] 3.2 把 Codex 流式事件和现有时间线收敛到一套模型
  - 状态：TODO
  - 这一步到底做什么：处理 Codex 的 agent_message、reasoning、tool call、turn 完成等事件，统一成系统消息模型。
  - 做完你能看到什么：Codex 在页面上的行为和 Claude 一样可追踪、可恢复、可调试。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5、需求 6
    - `design.md` 3.2.2、4.1、4.2
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/runtime-event-normalizer.ts`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
    - `apps/user-app/src/features/conversation/components/MessageTimeline.tsx`
  - 这一部先不做什么：先不改消息视觉样式。
  - 怎么算完成：
    1. Codex 事件能正确映射到消息时间线
    2. 重连后不会重复消息或丢消息
  - 怎么验证：
    - 事件映射测试
    - 重连和去重测试
  - 对应需求：`requirements.md` 需求 4、5、6
  - 对应设计：`design.md` 3.2.2、4.1、4.2

- [ ] 3.3 阶段检查：Codex 会话链路跑通
  - 状态：TODO
  - 这一步到底做什么：确认 Codex 新建、继续、回原生继续三条链路都成立。
  - 做完你能看到什么：两个核心 provider 都已经具备真实对话能力。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md` 需求 1、2、3、4、5
    - `design.md` 2.3、6.1、6.2、6.4
  - 主要改哪里：本阶段 Codex 相关文件和测试
  - 这一部先不做什么：不扩到第三个 provider。
  - 怎么算完成：
    1. Codex 新建会话实时对话可用
    2. Codex 已有会话继续对话可用
    3. 会话能回到原生环境继续
  - 怎么验证：
    - E2E 验证
    - 原生环境回接验证
  - 对应需求：`requirements.md` 需求 1、2、3、4、5
  - 对应设计：`design.md` 2.3、6.1、6.2、6.4

---

## 阶段 4：把前端交互和运行中恢复做完整

- [x] 4.1 改造前端发送链路，区分“启动会话”和“继续一轮运行”
  - 状态：DONE
  - 这一步到底做什么：把前端从“普通发消息 API”切到“真实运行时 API”，并让发送参数真正生效。
  - 做完你能看到什么：`model`、`reasoningLevel`、发送中状态不再只是样子货。
  - 先依赖什么：3.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 5、需求 6
    - `design.md` 2.3、3.3
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
  - 这一部先不做什么：先不做新的附件上传协议。
  - 怎么算完成：
    1. 前端发送调用的是实时运行接口
    2. 参数支持和不支持都有清楚表现
  - 怎么验证：
    - 前端集成测试
    - 真实发送手工验证
  - 对应需求：`requirements.md` 需求 1、5、6
  - 对应设计：`design.md` 2.3、3.3、4.2

- [ ] 4.2 完成运行中会话的重连附着和中断体验
  - 状态：TODO
  - 这一步到底做什么：让页面刷新、WS 重连、中断按钮、失败提示这些运行态体验真正闭环。
  - 做完你能看到什么：用户不会再遇到“页面刷新一下，会话就像失忆了一样”。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5、需求 7
    - `design.md` 2.3.3、2.3.4、4.2、5.3
  - 主要改哪里：
    - `apps/host/src/ws/ws-server.ts`
    - `apps/user-app/src/network/realtime-client.ts`
    - `apps/user-app/src/features/conversation/components/ConnectionBanner.tsx`
    - `apps/user-app/src/features/conversation/components/SessionHeader.tsx`
  - 这一部先不做什么：不做离线消息缓存。
  - 怎么算完成：
    1. 运行中刷新后可恢复附着或收到明确降级提示
    2. 中断成功、失败、不可中断都能看见
  - 怎么验证：
    - 网络抖动测试
    - 页面刷新恢复测试
    - 中断测试
  - 对应需求：`requirements.md` 需求 4、5、7
  - 对应设计：`design.md` 2.3.3、2.3.4、4.2、5.3

- [ ] 4.3 阶段检查：前后端主链路闭环
  - 状态：TODO
  - 这一步到底做什么：确认从前端发起到 provider 返回再到时间线展示这条路没有断点。
  - 做完你能看到什么：后面只剩验收和补文档，不再有结构性缺口。
  - 先依赖什么：4.1、4.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关代码和测试
  - 这一部先不做什么：不扩新需求。
  - 怎么算完成：
    1. Claude/Codex 前端交互一致可用
    2. 重连、中断、失败都有清楚反馈
  - 怎么验证：
    - 主链路回放
    - 关键场景走查
  - 对应需求：`requirements.md` 需求 1、2、4、5、6、7
  - 对应设计：`design.md` 2.3、4.2、5.3

---

## 阶段 5：验收、回写和收口

- [ ] 5.1 完成互通性验收
  - 状态：TODO
  - 这一步到底做什么：验证“本项目新建 -> 原生继续”和“原生已有 -> 本项目继续”这两条最关键的互通链路。
  - 做完你能看到什么：这次改造不是自嗨，而是真的打通了跨环境会话。
  - 先依赖什么：4.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` 2.3.1、2.3.2、4.1、6.1
  - 主要改哪里：
    - `specs/spec003.1-原生会话实时对话运行时/docs/`
    - 相关测试和验收脚本
  - 这一部先不做什么：不再加功能。
  - 怎么算完成：
    1. 两个方向的互通都通过
    2. 有验收记录可追溯
  - 怎么验证：
    - 手工验收清单
    - E2E 结果
  - 对应需求：`requirements.md` 需求 2、3
  - 对应设计：`design.md` 2.3.1、2.3.2、6.1

- [ ] 5.2 最终检查点：Spec 收口
  - 状态：TODO
  - 这一步到底做什么：把需求、设计、任务和验收结果对齐，确认没有偷换目标。
  - 做完你能看到什么：后续任何人接手，都能知道这次改造到底交付了什么，还差什么。
  - 先依赖什么：5.1
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文档
  - 这一部先不做什么：不再临时追加新需求。
  - 怎么算完成：
    1. 每条需求都有设计和验证落点
    2. 每个已完成任务都已回写状态
    3. 风险和未决项写清楚，没有装死
  - 怎么验证：
    - 按 Spec 清单逐项核对
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
