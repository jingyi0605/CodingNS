# 任务清单 - spec003.6 会话级CC-Switch预设选择（人话版）

状态：In Progress

## 这份文档是干什么的

这份任务清单用来把“会话里直接切换 cc-switch 配置文件和模型”拆成能落地的步骤，避免最后只多了一个下拉框，底层还是靠切全局配置硬撑。

重点只有一个：

- 新建会话入口保持原样
- 底部模型位置改成“配置文件 + 模型”的双列部署选择
- 会话切换部署后，后续消息立刻按新的配置执行

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

## 阶段 0：先把 Spec 立住，别一上来写代码

- [x] 0.1 启动 spec003.6 并完成范围收敛
  - 状态：DONE
  - 这一步到底做什么：确认本次 Spec 只处理 `Codex / Claude Code / Gemini` 的会话级 preset 绑定。
  - 做完你能看到什么：范围被钉死，`OpenCode` 和 `Kimi` 不会被顺手混进来。
  - 先依赖什么：无
  - 开始前先看：
    - `specs/spec001.7-设置页模型快速切换与CC-SWITCH接入/requirements.md`
    - `specs/spec003.1-原生会话实时对话运行时/requirements.md`
    - `specs/spec003.2-运行中消息追加与原生引导/design.md`
  - 主要改哪里：
    - `specs/spec003.6-会话级CC-Switch预设选择/`
  - 这一部先不做什么：先不改业务代码。
  - 怎么算完成：
    1. `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md` 已落盘
    2. 范围、依赖和非目标已写清楚
  - 怎么验证：
    - 文档走查
  - 对应需求：全部

- [ ] 0.2 核实三家 preset materialize 规则
  - 状态：TODO
  - 这一步到底做什么：逐家确认 `cc-switch` preset 如何变成运行时真正会读的本地配置目录。
  - 做完你能看到什么：后续实现不会建立在错误文件格式假设上。
  - 先依赖什么：0.1
  - 开始前先看：
    - `apps/host/src/modules/model-switch/cc-switch-adapter.ts`
    - `packages/session-sync-core/src/runtime/claude-runtime.ts`
    - `packages/session-sync-core/src/runtime/gemini-runtime.ts`
    - `apps/host/src/modules/sessions/codex-app-server-helper-client.ts`
  - 主要改哪里：
    - `specs/spec003.6-会话级CC-Switch预设选择/design.md`
    - 需要时补充 `docs/` 下的实测记录
  - 这一部先不做什么：先不落正式代码。
  - 怎么算完成：
    1. Claude 目录结构清楚
    2. Gemini 目录结构清楚
    3. Codex 目录结构和 helper 依赖清楚
  - 怎么验证：
    - 文档走查
  - 对应需求：`requirements.md` 6.2、6.3、6.7

---

## 阶段 1：先把数据结构和 API 改对

- [x] 1.1 扩展 `session_bindings`，正式保存会话级 provider 配置绑定
  - 状态：DONE
  - 这一步到底做什么：给 `session_bindings` 增加 `provider_config_mode`、`provider_preset_id`、`runtime_home_dir`。
  - 做完你能看到什么：系统终于知道某个会话用的是哪个 preset，而不只是知道它属于哪个 provider。
  - 先依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 6.2、6.3
    - `design.md` 2.1、4.1
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/client.ts`
    - `apps/host/src/storage/repositories/session-binding-repository.ts`
    - `apps/host/src/types/domain.ts`
  - 这一部先不做什么：先不接 runtime。
  - 怎么算完成：
    1. 旧数据可迁移
    2. Repository 可读写新字段
  - 怎么验证：
    - `pnpm --filter host build`

- [x] 1.2 扩展新建会话接口，接受 `providerConfigMode / providerPresetId`
  - 状态：DONE
  - 这一步到底做什么：让新建会话请求能正式表达“这次要不要显式绑定 preset”。
  - 做完你能看到什么：前端终于有地方传这两个参数，而不是把状态藏在本地。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 6.1、6.2、6.5
    - `design.md` 4.2
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-controller.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
  - 这一部先不做什么：先不生成 `runtimeHomeDir`。
  - 怎么算完成：
    1. 接口支持新字段
    2. 旧请求保持兼容
  - 怎么验证：
    - `pnpm --filter host build`
    - `pnpm --dir apps/user-app build`
---

## 阶段 2：补会话级运行上下文生成器

- [x] 2.1 新增 `session-provider-config-service`
  - 状态：DONE
  - 这一步到底做什么：把“读 preset、校验 provider、生成 `runtimeHomeDir`、写配置目录”收成一个正式服务。
  - 做完你能看到什么：会话创建链路不再到处散落 `cc-switch` 逻辑。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 6.2、6.3、7.3
    - `design.md` 3.1、3.2、5.1
  - 主要改哪里：
    - `apps/host/src/modules/sessions/`
    - 可能新增独立 service 文件
  - 这一部先不做什么：先不改 provider runtime。
  - 怎么算完成：
    1. 能返回 `global-default` 或 `cc-switch-preset` 的运行上下文
    2. 不把敏感配置原样暴露给前端
  - 怎么验证：
    - `pnpm --filter host build`

- [x] 2.2 会话创建时接入运行上下文生成器
  - 状态：DONE
  - 这一步到底做什么：新建会话时先生成并保存 provider 运行上下文，再启动 runtime。
  - 做完你能看到什么：显式 preset 创建出来的会话会真正记住自己的配置。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 6.2、6.3
    - `design.md` 5.1、5.2
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
  - 这一部先不做什么：先不做前端 UI。
  - 怎么算完成：
    1. 新会话 binding 能落下 preset 相关字段
    2. 未显式选择 preset 的旧链路保持可用
  - 怎么验证：
    - `pnpm --filter host build`

---

## 阶段 3：逐家 provider 接通运行时

- [x] 3.1 接通 Claude 的会话级 `runtimeHomeDir`
  - 状态：DONE
  - 这一步到底做什么：让 Claude 新建和继续会话时，优先使用 session 自己的 `runtimeHomeDir`。
  - 做完你能看到什么：两个不同 Claude preset 的会话能并行，不互相踩目录。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 6.3、6.7
    - `design.md` 6.1
  - 主要改哪里：
    - `apps/host/src/modules/sessions/claude-runtime-helper-client.ts`
    - `apps/host/src/modules/sessions/claude-runtime-helper-process.ts`
    - `packages/session-sync-core/src/runtime/claude-runtime.ts`
  - 这一部先不做什么：先不动 Codex。
  - 怎么算完成：
    1. Claude 创建和继续都能吃 session 级目录
    2. 全局默认链路仍可用
  - 怎么验证：
    - `pnpm --filter host build`

- [x] 3.2 接通 Gemini 的会话级 `runtimeHomeDir`
  - 状态：DONE
  - 这一步到底做什么：让 Gemini runtime 启动时使用 session 自己的 `GEMINI_HOME`。
  - 做完你能看到什么：两个不同 Gemini preset 的会话能并行存在。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 6.3、6.7
    - `design.md` 6.2
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/gemini-runtime.ts`
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
  - 这一部先不做什么：先不动 Codex helper。
  - 怎么算完成：
    1. Gemini 创建和继续都能吃 session 级目录
    2. 未显式 preset 的旧链路仍可用
  - 怎么验证：
    - `pnpm build:session-sync-core`
    - `pnpm --filter host build`

- [x] 3.3 拆掉 Codex 的全局单例 helper 依赖
  - 状态：DONE
  - 这一步到底做什么：把 Codex helper 从全局固定 `CODEX_HOME` 改成按 session 或按 active run 创建。
  - 做完你能看到什么：Codex 不同 preset 的会话终于不会互相踩全局目录。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 6.3、6.7
    - `design.md` 6.3
  - 主要改哪里：
    - `apps/host/src/modules/sessions/codex-app-server-helper-client.ts`
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - 需要时补 helper 生命周期管理
  - 这一部先不做什么：先不扩展更多 provider。
  - 怎么算完成：
    1. Codex active run 吃 session 级目录
    2. 不再依赖应用启动时的全局单例 helper
  - 怎么验证：
    - `pnpm build:session-sync-core`
    - `pnpm --filter host build`

---

## 阶段 4：前端把部署选择放到对的地方

- [ ] 4.1 新建会话入口增加 preset 选择器
  - 状态：CANCELLED
  - 取消原因：需求在开发中途改了。用户明确要求“不要改新建会话入口逻辑，恢复之前行为”。
  - 这一步原本做什么：在新建会话 UI 里增加 preset 选择。
  - 现在为什么不做：这会把选择入口放错位置，和最终交互冲突。

- [x] 4.2 恢复新建会话入口旧逻辑
  - 状态：DONE
  - 这一步到底做什么：撤掉桌面和移动端新建会话入口里的 preset 接线，让创建流程回到原来的 provider 选择。
  - 做完你能看到什么：新建会话入口不再多出一层配置文件选择，也不会把 preset 参数塞进 draft 路由。
  - 先依赖什么：1.2
  - 开始前先看：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/features/mobile-sessions/components/MobileCreateSessionSheet.tsx`
    - `apps/user-app/src/features/workbench/utils/workbench-navigation.ts`
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/features/mobile-sessions/components/MobileCreateSessionSheet.tsx`
    - `apps/user-app/src/features/workbench/utils/workbench-navigation.ts`
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
  - 这一部先不做什么：先不处理 composer 里的部署选择。
  - 怎么算完成：
    1. 新建会话入口恢复为“选 provider 直接进入 draft”
    2. draft 路由不再携带 preset 查询参数
  - 怎么验证：
    - `pnpm --dir apps/user-app build`

- [x] 4.3 底部模型位置改成双列部署选择
  - 状态：DONE
  - 这一步到底做什么：把原来的单列模型下拉替换成双列弹层，左列选配置文件，右列选该配置文件下的模型。
  - 做完你能看到什么：用户在原来的模型位置就能先选部署，再选模型，不用回设置页切全局。
  - 先依赖什么：1.2、2.2
  - 开始前先看：
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
    - `apps/user-app/src/features/settings/api/model-switch-api.ts`
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
    - `apps/user-app/src/app/styles.css`
    - `apps/user-app/src/shared/i18n/index.ts`
  - 这一部先不做什么：不改 `OpenCode` 的供应商管理，也不扩 `Kimi`。
  - 怎么算完成：
    1. `Codex / Claude Code / Gemini` 显示双列部署选择
    2. `OpenCode / Kimi` 继续沿用原来的模型选择
    3. 左列切换后，右列模型会按对应配置重新加载
  - 怎么验证：
    - `pnpm --dir apps/user-app build`
  - 补充回写：
    - 2026-04-25：助手对话框已抽成共享 deployment 选择组件；并行会话创建弹窗也改成同一套双列选择，提交并行成员时会把 `providerConfigMode / providerPresetId` 一起透传给 Host。

- [x] 4.4 会话进行中切换部署并立即生效
  - 状态：DONE
  - 这一步到底做什么：让 composer 发送消息时把当前 deployment 选择带给 Host，并把当前会话默认绑定更新成新的配置。
  - 做完你能看到什么：在同一个会话里切配置文件和模型后，后续消息直接按新的配置跑。
  - 先依赖什么：2.2、3.1、3.2、3.3、4.3
  - 开始前先看：
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - `apps/host/src/modules/provider/provider-controller.ts`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
    - `apps/user-app/src/features/conversation/runtime/use-live-session-controller.ts`
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-provider-config-service.ts`
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - `apps/host/src/modules/provider/provider-controller.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
    - `apps/user-app/src/features/conversation/runtime/`
  - 这一部先不做什么：先不做额外验收页。
  - 怎么算完成：
    1. `start-live` 和 `messages/live` 都能带 deployment 选择
    2. Host 会更新当前 session 的 provider 绑定
    3. 刷新页面后，当前会话还能恢复到刚才选择的配置文件
  - 怎么验证：
    - `pnpm --filter host build`
    - `pnpm --dir apps/user-app build`
  - 补充回写：
    - 2026-04-25：Host 已补上 Codex 继续会话兜底。旧 rollout 文件不存在时，不再硬复用失效 thread，而是用 Host 已保存的文本历史生成 synthetic transcript，交给 Codex runtime 的 resume-from-history fallback 继续对话，修复“切换 deployment 后继续旧会话报 no rollout found”。

---

## 阶段 5：回归与验收

- [ ] 5.1 旧会话兼容回归
  - 状态：TODO
  - 这一步到底做什么：确认老会话、未显式选择 preset 的新会话、设置页全局切换都没被打坏。
  - 做完你能看到什么：这次改造不是靠破坏旧行为换来的。
  - 先依赖什么：3.1、3.2、3.3、4.1、4.2
  - 开始前先看：
    - `requirements.md` 6.5、6.6、7.1
    - `design.md` 8.1、8.2
  - 主要改哪里：
    - Host / user-app 测试
  - 这一部先不做什么：不扩需求。
  - 怎么算完成：
    1. 旧会话继续正常
    2. 设置页全局切换仍可用
    3. 显式 `model` 仍优先
  - 怎么验证：
    - Host 集成测试
    - 前端回归测试
  - 当前进展：
    - 2026-04-25：Host 侧已补充集成测试，覆盖 Codex 原始 rollout 丢失时改用文本历史继续会话的场景；相关定向集成测试当前通过，但整项旧会话兼容回归还没全部做完，所以状态暂不改成 DONE。

- [ ] 5.2 三家 provider 的并行 preset 验收
  - 状态：TODO
  - 这一步到底做什么：确认同一 provider 下不同 preset 的两个会话能并行存在，不互相踩配置。
  - 做完你能看到什么：这次改造的核心价值被真正证明。
  - 先依赖什么：5.1
  - 开始前先看：
    - `requirements.md` 8
    - `design.md` 5、6
  - 主要改哪里：
    - 验收记录或测试补充
  - 这一部先不做什么：不继续扩 OpenCode / Kimi。
  - 怎么算完成：
    1. Claude 两个 preset 并行通过
    2. Gemini 两个 preset 并行通过
    3. Codex 两个 preset 并行通过
  - 怎么验证：
    - 定向验收测试
    - 必要时补充手测记录
