# 任务清单 - spec003.7 会话级模型与配置选择持久化

状态：In Progress

## 阶段 1：把会话选择变成正式数据

- [x] 1.1 增加会话绑定的模型字段和迁移
  - 状态：DONE
  - 这一步到底做什么：在已有 `session_bindings` 上增加可为空的模型选择字段，并让仓库、领域类型和会话摘要完整传递它。
  - 做完你能看到什么：任意会话都能从数据库读出自己的 `selectedModel`，旧会话读到 `null`。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.1「单一数据来源」
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/client.ts`
    - `apps/host/src/storage/repositories/session-binding-repository.ts`
    - `apps/host/src/types/domain.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
  - 这一步先不做什么：不改前端选择器，不做历史数据回填。
  - 怎么算完成：
    1. 新旧数据库都能正常打开。
    2. 会话摘要包含 `selectedModel`。
  - 怎么验证：
    - Host 定向测试
    - `pnpm check:sqlite-runtime`
  - 对应需求：`requirements.md` 需求 1 / 验收 1.1、1.4
  - 对应设计：`design.md` §2.1
  - 实际完成：2026-08-02 已在 `session_bindings` 增加可空 `selected_model`，并通过绑定仓库、会话索引摘要、Host 与前端 DTO 传递。

- [x] 1.2 提供保存会话选择的 Host 接口
  - 状态：DONE
  - 这一步到底做什么：为已有会话增加一个带归属校验的 PATCH 接口，在同一条绑定记录中保存模型和 preset。
  - 做完你能看到什么：前端能收到最新会话摘要，而不是靠本地状态猜保存结果。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` §3.1、§3.2、§5
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/sessions/session-controller.ts`
    - `apps/host/src/routes/sessions.ts`
  - 这一步先不做什么：不向运行中的 provider 发送配置变更。
  - 怎么算完成：
    1. 模型、全局默认配置和 preset 都能合法保存。
    2. 非所属用户和非法 preset 不能写入。
  - 怎么验证：
    - Host 路由或服务定向测试
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §3、§5
  - 实际完成：2026-08-02 已增加 `PATCH /api/sessions/:sessionId/composer-settings`。它复用会话归属校验和 `SessionProviderConfigService`，只更新后续运行会使用的绑定。

## 阶段 2：接回会话页

- [x] 2.1 让 Composer 保存当前会话选择
  - 状态：DONE
  - 这一步到底做什么：模型或配置文件变化时调用新接口；模型变化不再写账号 `defaultModel`。
  - 做完你能看到什么：A、B 两个已存在会话可以显示并保存不同选择。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §2.2、§3.2、§4.2
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
  - 这一步先不做什么：不改设置页默认模型功能，也不保存 reasoning level。
  - 怎么算完成：
    1. 页面刷新后恢复当前会话的模型和 preset。
    2. 选择“默认模型”会清除会话显式模型。
  - 怎么验证：
    - user-app 定向组件和页面测试
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §3.2、§3.3、§4
  - 实际完成：2026-08-02 Composer 改模型或 preset 时立即保存到当前 session；模型选择不再写入账号 `defaultModel`。页面恢复时优先读取会话摘要中的 `selectedModel`。

- [x] 2.2 把新会话、分叉和排队消息接到同一字段
  - 状态：DONE
  - 这一步到底做什么：确认首次 `start-live` 创建的会话与后续消息都使用并保留同一份模型和 preset 选择。
  - 做完你能看到什么：新会话、分叉会话和普通继续对话不会再回退到别的会话的选择。
  - 先依赖什么：1.1、1.2、2.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §3.3、§3.4
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
  - 这一步先不做什么：不改变运行中 run 的参数。
  - 怎么算完成：
    1. 新创建的真实会话摘要带回模型选择。
    2. 后续 send 和 queue dispatch 保持会话绑定。
  - 怎么验证：
    - Host 集成测试
    - 会话页定向测试
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3
  - 对应设计：`design.md` §3.3、§3.4
  - 实际完成：2026-08-02 `start-live` 和原生会话首次启动都会写入选择的模型；分叉会话的首条消息会覆盖来源绑定，队列仍沿用已有显式 model/preset 载荷。

## 阶段 3：验证与验收

- [ ] 3.1 补齐隔离和兼容回归测试
  - 状态：IN_REVIEW
  - 这一步到底做什么：用两条会话、一个旧会话和一个活动 run 证明改动没有串数据或改写当前执行。
  - 做完你能看到什么：关键行为有自动化证据，而不是只看页面表面。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 全部需求
    - `design.md` §6、§7
  - 主要改哪里：
    - `apps/host/tests/`
    - `apps/user-app/src/features/conversation/**/*.test.*`
    - `tasks.md`
  - 这一步先不做什么：不扩展到其他 composer 选项。
  - 怎么算完成：
    1. A/B 会话隔离、旧会话回退、运行中边界都有测试。
    2. SQLite 运行时检查通过。
  - 怎么验证：
    - `pnpm test:related -- <变更文件>`
    - `pnpm check:sqlite-runtime`
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` §6、§7
  - 当前验证：2026-08-02 `session-user-scope.test.ts` 已验证两个会话的独立模型读写及摘要投影；Composer 已验证模型切换只上报会话级选择，不触碰账号偏好；会话页与 Composer 共 80 项测试通过。
  - 本轮补充：发现并修复两个前端状态问题：
    1. “切换模型后立即发送”竞态。Composer 现在会等待最近一次模型/preset 会话写入完成，再发送消息；新增回归测试证明发送不会抢在保存请求之前。
    2. “选择 5.5 立刻跳回 5.4”的旧摘要覆盖问题。`initialModel` 现在只负责进入会话时初始化；用户在同一会话里手动选择模型后，迟到的旧 `initialModel` 不再覆盖当前选择，除非当前选择已经不在模型列表里。
    3. “切换到其他会话再切回时模型不恢复”的 runtime 缓存覆盖问题。Composer 现在优先使用导航列表中刚保存的会话模型/preset，只有导航摘要缺字段时才回退 runtime 摘要。
    4. “切换会话后导航摘要丢失模型”的 Host 投影问题。`/api/workbench` 原先只投影 provider 和活动状态，没有返回 `selectedModel`、`providerConfigMode`、`providerPresetId`，导致切回会话时只能回退账号默认模型；现在已补齐三个字段。
    5. runtime 摘要合并现在会保留已有会话选择字段，旧缓存或活动状态快照缺字段时不会覆盖已保存的模型/preset。
    6. 文本选择操作弹窗切换会话时也优先读取当前会话的 `selectedModel`，不再无条件重置为账号默认模型。
  - 本轮验证：
    - `pnpm --dir apps/user-app test -- run src/features/conversation/components/ComposerPanel.test.tsx`：49 项通过。
    - `pnpm --dir apps/user-app test -- run src/features/conversation/pages/ConversationPage.test.tsx`：34 项通过。
    - `pnpm --dir apps/host test -- run tests/integration/session-live-runtime-service.test.ts`：70 项通过。
    - `pnpm --dir apps/user-app build`：通过；仅有仓库既存的 Rollup chunk 警告。
    - `pnpm check:sqlite-runtime`：通过。
    - `pnpm --dir apps/host test -- --run tests/integration/workbench-service.test.ts`：13 项通过，覆盖 workbench 摘要保留会话模型/preset。
    - `pnpm --dir apps/user-app test -- --run src/features/conversation/runtime/session-runtime-store.mark-seen.test.ts src/features/conversation/components/ConversationSelectionActions.test.tsx src/features/conversation/pages/ConversationPage.test.tsx src/features/conversation/components/ComposerPanel.test.tsx`：97 项通过。
  - 尚缺什么：还没有为新 PATCH 路由单独补 HTTP 鉴权和活动 run 的集成测试。

- [ ] 3.2 最终验收与回写
  - 状态：IN_REVIEW
  - 这一步到底做什么：核对需求、代码和测试一一对应，并把真实验证结果回写。
  - 做完你能看到什么：下一位接手者能知道做了什么、怎么验证、还剩什么风险。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：
    - `specs/spec003.7-会话级模型与配置选择持久化/tasks.md`
  - 这一步先不做什么：不增加新的功能范围。
  - 怎么算完成：
    1. 已完成任务标记为 `DONE` 并勾选。
    2. 验证命令和结果已如实记录。
  - 怎么验证：
    - 人工逐项核对
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
  - 当前验证记录：
    - `pnpm --dir apps/host build`：通过。
    - `pnpm --dir apps/user-app build`：通过；仅有仓库既存的 Rollup chunk 警告。
    - `pnpm --dir apps/host test -- run tests/integration/session-user-scope.test.ts`：1 项通过。
    - `pnpm --dir apps/user-app test -- run src/features/conversation/components/ComposerPanel.test.tsx src/features/conversation/pages/ConversationPage.test.tsx`：80 项通过。
    - `pnpm check:sqlite-runtime`：通过。
    - `pnpm test:related -- <变更文件>`：超时；脚本错误纳入 Relay/Git 等不相关慢测，其中存在既有超时，未将其当作本 Spec 的通过结果。
