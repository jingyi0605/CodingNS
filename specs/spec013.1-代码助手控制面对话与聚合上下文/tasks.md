# 任务清单 - spec013.1-代码助手控制面对话与聚合上下文（人话版）

状态：Draft

## 2026-04-05 进展补记

- 已确认 `spec013.1` 只处理“代码助手控制面对话、初始化配置和聚合上下文”，不去重写 `spec013` 的事实层模型。
- 已确认“直接复用项目会话当助手聊天”不是正路，已将其明确排除。
- 已完成本子 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化。
- 已补 `ButlerProfile`、`ButlerControlSession`、`ButlerContextSnapshot` 的核心设计草案。
- 已补独立 Butler Chat API、控制动作 API 和前端工作台入口设计。
- 已更新 `specs/README.md`，把 `spec013.1` 加入总览索引。

## 2026-04-06 初始化收口补记

- 已把 Butler 初始化入口收紧为“先明确助手是谁，再开始聊天”，不再用默认名字蒙混过关。
- 已把助手工作目录改成后端默认生成，落在宿主数据目录内的独立子目录，前端不再暴露这个路径。
- 已把首版 `AGENTS.md` 改成由后端根据初始化选项自动生成，并写入助手自称、语气、语言、总结风格、风险倾向和汇报优先级。
- 已保留 `inline` / `file` 两种 `AGENTS` 模式，但初始化页只解释模式差异，不再让用户一开始直接填写规则正文。
- 已把初始化页的人格和汇报偏好改成下拉枚举，并走 i18n 词典显示。

## 2026-04-06 Butler 工作台收口补记

- 已把 Butler 视图和普通工作区工具侧栏彻底拆开：进入 Butler 路由后，不再显示默认的“文件管理 / GIT 管理 / 进程管理”右侧面板，也不再显示对应折叠按钮。
- 已把 Butler 主区域改成真正的独立对话窗口风格，顶部显示助手称呼、provider、刷新和“新建会话”，并按助手名称稳定生成 emoji 头像，同时复用到消息时间线头像。
- 已补“新建会话”入口，并把 provider 切换后的行为固定为自动重置上下文并创建新控制会话；Butler 控制会话不会出现在普通工作区会话列表和 workbench 快照里。
- 已强化 Butler 独立规则说明：生成的 `AGENTS.md` 和控制会话附加说明都明确声明这是助手专用规则体系，不继承普通项目会话规则；同时继续保留独立工作目录内的最小 git 根隔离。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx src/features/butler/runtime/butler-runtime-store.test.ts src/features/conversation/components/WorkbenchLayout.test.tsx src/shared/i18n/index.test.ts`
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-profile-service.test.ts tests/integration/butler-profile-routes.test.ts tests/integration/butler-control-session-routes.test.ts tests/integration/butler-context-routes.test.ts tests/integration/butler-control-action-routes.test.ts tests/integration/workbench-service.test.ts`

## 2026-04-06 Butler 工作台纠偏补记

- 已把 Butler 聚合信息重新接回工作台正式右侧信息栏，不再把聚合信息堆在聊天主区域下方；普通项目的“文件管理 / GIT 管理 / 进程管理”不会再出现在 Butler 视图里。
- 已移除 Butler 聊天主区域中的工程师视角解释文案，只保留用户真正需要的称呼、provider 和会话输入区。
- 已补 `WorkbenchLayout` 右栏插槽，让 Butler 页面可以注册自己的右侧内容，同时保留工作台原有右栏收起、展开和尺寸逻辑。
- 已按官方 Codex 规则进一步收紧独立指令链路：
  - Butler 专用 runtime 会把 `CODEX_HOME` / `CODINGNS_CODEX_HOME` 指向独立 home
  - 会自动写入 Butler 专用 `config.toml`，把 `model_instructions_file` 指向 Butler 自己的规则文件
  - 会清理该专用 home 下的 `AGENTS.md` / `AGENTS.override.md`，避免把默认全局规则继续带进 Butler 对话
- 已补本轮纠偏验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx src/features/conversation/components/WorkbenchLayout.test.tsx src/shared/i18n/index.test.ts`
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-control-session-service.test.ts tests/integration/butler-control-session-routes.test.ts tests/integration/butler-profile-service.test.ts tests/integration/workbench-service.test.ts`

## 2026-04-06 Butler 规则隔离修复补记

- 已定位并修复 Butler 仍继承上层仓库 `AGENTS.md` 的根因：此前只伪造了一个最小 `.git` 目录，Git 仍把外层仓库识别成真正根目录。
- 已改成在 Butler 工作目录里建立真实 git 边界，不再依赖伪造 `.git` 目录；这样 Codex 按 `cwd` 向上查找规则时，会在 Butler 自己目录停住。
- 已在控制会话启动前补自动修复逻辑：旧的 Butler 工作目录即使已经落了假 `.git`，也会在下一次启动控制会话时被修正，不需要用户手工重建档案。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-profile-service.test.ts tests/integration/butler-control-session-service.test.ts`

## 2026-04-06 Butler 首条消息收口补记

- 已取消新建 Butler 会话时自动发送固定首条消息的逻辑，页面现在会直接回到空白会话状态，等待用户自己发出第一条消息。
- 已把 Butler 控制会话启动接口收紧为“必须带首条用户消息”，避免以后又把系统默认文案伪装成用户消息写进时间线。
- 已把 Butler 主聊天区补接到现成 `SessionRuntimeStore`，复用普通会话页的实时消息、运行态和轮询链路，避免首条消息发出后 Butler 页面停在一次性快照上。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/runtime/butler-runtime-store.test.ts src/features/butler/pages/ButlerPage.test.tsx`
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-control-session-service.test.ts tests/integration/butler-control-session-routes.test.ts`

## 2026-04-06 Butler Codex 会话可用性修复补记

- 已定位“发出首条消息后会话立刻停住”的真实根因，不是 Butler 页面没订阅，而是 Butler 专用 `codex-home` 把默认 Codex 配置整个抹掉了，只剩 `model_instructions_file`，导致 provider 配置和登录方式一起丢失。
- 已把 Butler 的 Codex 配置改成“继承默认 `~/.codex/config.toml` 的运行配置，只覆盖 `model_instructions_file` 指向 Butler 自己的 `AGENTS.md`”，这样既保留独立规则体系，也不再把默认 provider / 审批 / 沙箱配置弄丢。
- 已同步默认 Codex home 里的 `auth.json` 到 Butler 专用 `codex-home`，避免独立 home 因为缺认证文件而直接无法向模型发请求。
- 已补 Codex app-server 致命错误翻译：当 app-server 发出 `method = "error"` 且 `willRetry = false` 时，现在会明确落成 runtime failed，而不是继续卡在 `starting`。
- 已补相关自动化验证：
  - `pnpm --dir packages/session-sync-core build`
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-control-session-service.test.ts tests/integration/butler-control-session-routes.test.ts tests/integration/codex-runtime-adapter.test.ts tests/integration/session-runtime-status.test.ts`
- 已补运行态直连验证：
- 直接用 Butler 当前独立 `codex-home` 调 `codex app-server`
- 已确认会返回 `agentMessage` 和 `turn/completed`
- 说明 Butler 独立 Codex 会话已经能真正启动，不再是只有用户消息、没有 assistant 输出的空转

## 2026-04-06 Butler 自动纳管与对话体验修复补记

- 已补工作区自动纳管：Butler 不再只看手工创建的 `butler_projects`，现在会把当前可见工作区自动补成 `workspace-auto` 项目，同时排除 Butler 自己的专用工作目录，避免自引用。
- 已补自动归档：当工作区从当前列表消失后，对应的 `workspace-auto` 项目会自动转成归档状态，不会一直留在活跃视图里。
- 已补普通会话自动纳入：对于自动纳管项目，Butler 现在会把该工作区里已知的普通会话自动登记成 `observed` 会话，聚合总览和项目上下文不再只看手工导入的 `butler_sessions`。
- 已收紧 Butler 指令：如果 `BUTLER_CONTEXT.md` 里项目数或会话数是 0，助手不能直接下结论，必须先按 `BUTLER_API.md` 实查 `GET /api/butler/overview` 和 `GET /api/butler/projects`；如果用户追问会话内容，还要继续查 `GET /api/sessions/:sessionId/messages?direction=backward&limit=40`。
- 已修 Butler 页历史上翻：Butler 主聊天页现在把实时会话的 older history 能力正式接到 `MessageTimeline`，不再只能看最近一页。
- 已修 Butler 页底部输入区布局：聊天输入区不再被消息列表挤压，会稳定留在底部区域。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-project-service.test.ts tests/integration/butler-session-service.test.ts tests/integration/butler-context-aggregator.test.ts tests/integration/butler-control-session-service.test.ts`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-context-routes.test.ts tests/integration/butler-control-session-routes.test.ts`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx src/features/butler/runtime/butler-runtime-store.test.ts`

## 2026-04-06 Butler 首次命中同步与内部凭证补记

- 已把 Butler 的上下文聚合改成首次命中前先同步当前工作区的非归档会话，不再等后台补扫后第二轮才看见活动会话。
- 已明确收口扫描范围：默认只自动同步非归档会话；归档会话不进默认 Butler 聚合视图，后续只有在用户明确要求查某个特定会话时，才继续扩展到更大范围。
- 已新增 `ButlerAuthService`，会在助手工作目录下写入稳定的 `BUTLER_AUTH.json`，里面包含 Butler 专用内部 API 访问 token、API 基地址、签发时间和过期时间。
- 已把 `BUTLER_API.md` 改成显式引用 `BUTLER_AUTH.json`，要求助手固定从该文件读取认证信息，不再每轮临时摸索 Bearer token。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-control-session-service.test.ts tests/integration/butler-session-service.test.ts tests/integration/butler-context-aggregator.test.ts tests/integration/butler-context-routes.test.ts tests/integration/butler-control-action-service.test.ts tests/integration/butler-control-action-routes.test.ts tests/integration/butler-control-session-routes.test.ts`

## 2026-04-06 Butler 会话摘要后台扫描补记

- 已新增 Butler 后台会话摘要扫描服务，会周期检查活跃项目下发生变动的 Butler 会话，并只处理非归档会话。
- 已把摘要触发改成正式防抖：第一次发现消息数或最后消息时间变化时，只登记待摘要状态；到时后才真正调用轻量模型生成摘要。
- 已新增正式表 `butler_session_summary_states`，专门保存摘要防抖、运行态、错误信息和上次已摘要的源消息指纹，不再把这类调度状态塞进 `config_json`。
- 已把轻量摘要结果正式回写到 `butler_sessions.lastSummary` 和 `session_checkpoints(sourceKind=summary)`，这样 Butler 聚合、项目上下文和后续检索都能直接复用。
- 已把摘要运行放到代码助手自己的后台 runtime 中，避免把内部摘要会话混进普通项目工作区会话里。
- 已明确继续保留归档边界：默认扫描和默认摘要都不碰归档会话；只有未来用户明确要求查某个特定归档会话时，才扩展搜索范围。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-session-summary-service.test.ts tests/integration/session-summary-scheduler.test.ts tests/integration/butler-control-session-service.test.ts tests/integration/butler-session-service.test.ts tests/integration/butler-context-aggregator.test.ts tests/integration/butler-context-routes.test.ts tests/integration/butler-control-action-service.test.ts tests/integration/butler-control-action-routes.test.ts tests/integration/butler-control-session-routes.test.ts`

## 2026-04-06 Butler 摘要防抖配置补记

- 已把 Butler 后台会话摘要的默认防抖从 60 秒改成 5 分钟，减少会话持续活跃时的重复摘要和 token 消耗。
- 已把防抖时长纳入 `ButlerProfile.focus.summaryDebounceSeconds`，旧档案缺字段时会自动补默认值，保持兼容。
- 已在 Butler 右侧信息栏新增“助手设置”卡片，支持直接选择 1 / 3 / 5 / 10 / 15 / 30 分钟并保存。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-profile-service.test.ts tests/integration/butler-profile-routes.test.ts tests/integration/butler-session-summary-service.test.ts tests/integration/session-summary-scheduler.test.ts`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/runtime/butler-runtime-store.test.ts src/features/butler/pages/ButlerPage.test.tsx`

## 2026-04-06 Butler 增量摘要状态机补记

- 已把摘要状态表补成正式增量锚点：`butler_session_summary_states` 现在会保存 `last_summarized_sequence`，表示上一次已经摘要到哪条消息。
- 已把 Butler 后台摘要改成真正的增量模式：每次只读取 `sequence > last_summarized_sequence` 的新增消息，不再重复把最近 40 条旧消息整段塞给模型。
- 已把摘要提示词改成“旧摘要 + 本轮新增消息 -> 新的合并摘要”，输出的 `summary` 现在要求直接给出合并后的最新结论，而不是写成增量说明。
- 已保持兼容：旧数据库没有 `last_summarized_sequence` 列时，Host 启动会自动补列，不要求手工迁移。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-session-summary-service.test.ts tests/integration/session-summary-scheduler.test.ts`

## 2026-04-06 Butler 摘要优先检索补记

- 已新增 `GET /api/butler/search`，把项目、会话、记忆、巡视、验证的摘要层统一接成 Butler 检索入口。
- 已把 `ContextAggregator.resolvePromptContext()` 接到摘要检索结果，控制会话 prompt 里会额外写入“摘要命中”，要求助手优先基于这些命中回答。
- 已把 `BUTLER_API.md` 的默认查询顺序改成“先看 `BUTLER_CONTEXT.md`，再查 `/api/butler/search`，确认不够后才继续查 overview / project context / 原始消息”。
- 已明确当前边界：这里只检索摘要层，不直接展开原始消息；只有用户追问具体细节时，才继续按内部 API 下钻。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-context-aggregator.test.ts tests/integration/butler-context-routes.test.ts tests/integration/butler-control-session-service.test.ts tests/integration/butler-session-summary-service.test.ts tests/integration/session-summary-scheduler.test.ts`

## 2026-04-06 Butler 右侧信息栏标签化补记

- 已把 Butler 右侧信息栏改成四个正式标签：`信息`、`自动化`、`技能`、`配置`，标签样式对齐现有工作台会话栏风格。
- 已把原来的设置卡片从信息区移到 `配置` 标签，避免信息区和设置区继续混在一起。
- 已把 `GET /api/butler/search` 正式接到 `信息` 标签，新增“摘要检索”卡片，用户可以直接看当前命中的摘要，而不是只让助手内部使用。
- 已把 `自动化` 和 `技能` 标签先留成空白占位，不提前塞临时内容，给后续真实能力落地留位置。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx src/features/butler/runtime/butler-runtime-store.test.ts`

## 2026-04-06 Butler 信息页第一轮瘦身补记

- 已把信息页从“后台控制台”收成三块真正对用户有用的内容：`当前上下文`、`项目入口`、`当前项目`。
- 已移除原来的“整体情况大看板”和“最近操作事件流”，避免右侧继续堆一堆用户看不懂、也不直接帮助当前提问的信息。
- 已把项目区改成轻量入口，只保留项目名、所属工作区、最新摘要和进入动作，不再在这里堆控制按钮。
- 已把当前项目区改成轻量摘要卡，只保留当前摘要、第一条风险、第一条建议动作，以及“打开项目 / 打开最近会话”两个真实入口。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx`

## 2026-04-06 Butler 信息页第二轮收口补记

- 已把项目入口排序改成更贴近使用优先级的顺序：先看有阻塞的项目，再看高风险项目，最后再按最近活跃时间排。
- 已把项目卡片里的长摘要压成单行摘要，默认只给一眼能扫到的结论；需要细节时可以点进项目，或用悬浮标题看完整摘要。
- 已把“当前项目”里的风险和建议动作改成可点击摘要入口，点击后会直接触发右侧上方的 Butler 摘要检索，不再只是静态文案。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx`

## 2026-04-06 Butler 信息页第三轮压缩补记

- 已把项目入口从中部卡片列表提升到信息页最顶层，改成正式下拉选择器；用户先选项目，再看摘要和当前项目信息。
- 已继续压缩项目入口密度：未选中项目不再展示摘要正文，只在下拉项里保留项目名、阻塞/风险标签和最近活跃时间。
- 已把“当前项目”里的风险和建议动作接成检索联动入口；点击后会自动触发 Butler 摘要检索，并在命中列表里高亮对应结果。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx`

## 2026-04-07 Butler 信息页方向纠偏补记

- 已把助手页里的“摘要检索”整块移除，避免 Butler 页面继续承担搜索入口；后续检索会放到左侧统一搜索栏。
- 已把信息页重新收口成三块：顶部项目选择、当前项目、助手工作重点，不再在这里堆检索结果和原始消息补查。
- 已把“当前项目”区改成更接近用户视角的表达：只保留当前进展、需要留意、建议下一步，不再用检索联动和工程师向文案。
- 已新增“助手会帮你做什么”说明卡，明确聚焦四件事：跟进开发、功能验证、收件箱、外部通知。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx`

## 2026-04-07 Butler 信息页全局记录收口补记

- 已继续收紧 Butler 右侧 `信息` 标签，只保留三类全局记录：`会话跟进`、`会话验证`、`代办进度`。
- 已把上一轮又加回去的“摘要检索”“项目选择 / 当前项目”“助手会帮你做什么”彻底移除，不再让 Butler 页面承担这些入口和说明卡。
- 已清掉 Butler 页面里对应的死代码和旧词典项，避免后续又把已经否掉的页面结构误接回来。
- `自动化 / 技能 / 配置` 标签暂时只保留框架，不再在 Butler 页面里塞伪能力说明。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx`
  - `pnpm --dir apps/user-app exec vitest run src/shared/i18n/index.test.ts`

## 2026-04-07 Butler 页面入口再收口补记

- 已把 Butler 页右侧残留的 `自动化 / 技能 / 配置` 伪入口和页面内设置面板一起移除，避免 Butler 页面继续承担不属于它的配置入口。
- 右侧现在只保留一个“信息”标题和三类全局记录：`会话跟进`、`会话验证`、`代办进度`，页面职责进一步收紧到“只看记录，不做配置”。
- 已同步删掉对应的页面状态、设置保存逻辑、占位卡片和无用 i18n 词条，减少后续误接回旧方案的机会。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx src/shared/i18n/index.test.ts`

## 2026-04-07 会话标题栏 Butler 动作入口补记

- 已把 Butler 的正确入口从 Butler 页面挪到普通开发会话标题栏右侧，新增 `AI` 按钮；草稿会话不显示这个按钮，避免把假会话也接进 Butler 流程。
- 已新增 `GET /api/butler/session-target?sessionId=...`，专门把当前开发会话解析到对应 Butler 项目和 Butler 会话；如果目标会话还只是普通 observed 会话，会按现有自动纳管规则补齐关联，不再让前端自己扫 `overview` 猜归属。
- 已把按钮动作收紧成两件真实的事：`跟进当前会话` 和 `发起开发验证`。两者都会先确认当前 provider 下已有可用的 Butler 控制会话，再分别走现有控制动作 API，不另造一套假聊天系统。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/SessionButlerActionButton.test.tsx src/features/butler/pages/ButlerPage.test.tsx src/shared/i18n/index.test.ts`
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-session-service.test.ts tests/integration/butler-session-target-routes.test.ts`

## 2026-04-07 工作区收件箱与全局代办记录补记

- 已新增 Butler 正式收件箱对象和 CRUD 接口：`/api/butler/inbox` 现在支持按项目绑定代办的新增、编辑、删除和列表查询，不再把“代办”塞进 `nextActions` 这种摘要字段里糊弄。
- 已在工作区区块顶部把“收件箱”按钮插到“管理项目”右侧，并接出独立 `WorkspaceInboxModal`；用户现在可以直接在模态框里维护代办，并且每条代办都必须绑定真实项目。
- 已把 Butler 右侧信息栏的“代办进度”改成读取真实收件箱记录，而不是继续从 `overview.global.nextActions` 拼假数据；代办变更后会通过前端事件刷新 Butler 信息页。
- 已把收件箱纳入 Butler 聚合上下文和 prompt：全局总览、项目上下文和 Butler 提示词里都能带上当前代办，后续助手回答和跟进不会完全看不到这层信息。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-inbox-service.test.ts tests/integration/butler-inbox-routes.test.ts tests/integration/butler-context-aggregator.test.ts`
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/WorkspaceInboxModal.test.tsx src/features/butler/pages/ButlerPage.test.tsx src/features/conversation/components/SessionButlerActionButton.test.tsx src/features/conversation/components/WorkbenchLayout.test.tsx src/shared/i18n/index.test.ts`

## 2026-04-07 收件箱与全局记录验证补齐补记

- 已补齐前端测试夹具，统一 `WorkspaceInboxModal` 的更新断言为真实两参 API 形式：`updateButlerInboxItem(itemId, payload)`，不再让测试和实现各走一套。
- 已把 Butler 信息栏“会话跟进”的测试数据改成真实事件来源：由 `resume-session` 控制事件驱动，而不是继续误用 `overview.sessions` 伪造右侧记录。
- 已把新的 `ButlerInboxItemDto.projectLifecycleStatus` 补进相关测试夹具，避免测试通过但类型检查失败的假绿色状态。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/WorkbenchLayout.test.tsx src/features/conversation/components/WorkspaceInboxModal.test.tsx src/features/butler/pages/ButlerPage.test.tsx src/features/conversation/components/SessionButlerActionButton.test.tsx src/shared/i18n/index.test.ts`
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-inbox-service.test.ts tests/integration/butler-inbox-routes.test.ts tests/integration/butler-session-service.test.ts tests/integration/butler-session-target-routes.test.ts`

## 2026-04-07 会话自动跟进任务与自动化面板补记

- 已新增正式对象 `ButlerFollowUpTask` 和接口 `/api/butler/follow-up-tasks`，会把“跟进当前会话”从一次性动作改成可持续巡检的自动化任务，正式保存用户目标、检查周期、最近观察状态和自动推进结果。
- 已新增后台巡检器 `ButlerFollowUpScheduler`，会按会话运行态变化和定时检查触发处理；当前策略是：
  - 会话还在运行时只观察，不打断
  - 会话完成、失败或中断后，会先判断是否已经真的完成目标

## 2026-04-07 Butler 跟进边界与代理消息修复补记

- 已把 Butler 跟进评估规则写死到评估 prompt、后台评估器 `AGENTS.md`、Butler 首版 `AGENTS.md` 和控制会话附加说明里：
  - 如果目标或上下文提到了 spec，只能按 spec 明确写出的必做项判断完成与否
  - “建议下一步”“最佳实践”“顺手优化”默认都不是必做项，禁止顺着这些建议无限扩开发范围
  - 如果没有 spec，先归纳一句当前核心任务，后续只围绕这一个核心任务推进
- 已修复 Butler 内部评估工作区泄漏到普通工作台的问题：工作台快照和 Butler 自动纳管现在都会排除助手工作目录及其子目录，`.butler-follow-up-evaluator` 不会再出现在左侧工作区 / 会话链路里。
- 已修复“消息已经发出，但通知显示跟进失败”的并发误判：当目标会话再次进入运行态并触发 `ACTIVE_RUN_EXISTS` / `SESSION_NOT_RUNNING` 时，跟进任务不再直接标记失败，而是改成继续观察并延后下一次检查。
- 已给 Butler 自动补发到开发会话的消息加稳定 `clientRequestId` 前缀 `butler-follow-up:*`，前端消息时间上方会显示“代理发送”标签，避免用户误判来源。
- 已在普通开发会话页和 Butler 聊天页补“助手分析过程”悬浮信息：
  - 会话页悬浮在标题栏 `AI` 按钮上
  - Butler 聊天页悬浮在助手名称上
  - 统一显示当前目标、当前判断、最近分析和等待原因
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-follow-up-service.test.ts tests/integration/butler-follow-up-routes.test.ts tests/integration/workbench-service.test.ts`
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/SessionButlerActionButton.test.tsx src/features/conversation/components/MessageTimeline.test.tsx src/features/butler/pages/ButlerPage.test.tsx src/shared/i18n/index.test.ts`

## 2026-04-07 Butler 代理消息正式元数据补记

- 已把“代理发送”从临时 `clientRequestId` 前缀识别升级成正式消息元数据：
  - 新增表 `session_message_origins`
  - 由后端保存 `sessionId + clientRequestId/messageId -> origin/originRef`
  - 当前已正式支持 `butler_proxy`
- 已把 Butler 自动补发消息接到这套元数据：
  - 跟进任务补发消息成功后，会写入 `origin=butler_proxy`
  - 如果当场拿到真实 `messageId`，会直接绑定
  - 如果当场只拿到 synthetic 消息，会先保存待解析记录，等后续历史消息读到真实消息时再自动补绑 `messageId`
- 已把历史接口透出正式来源字段：
  - `/api/sessions/:sessionId/messages`
  - `readRecentHistoryEnvelope`
  - Butler 控制面和普通会话页读取到的历史消息现在都能拿到 `origin/originRef`
- 已把前端消息模型改成优先读正式 `origin` 字段显示“代理发送”；旧消息仍保留 `clientRequestId` 前缀兼容兜底，避免老数据立刻失去标签。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-follow-up-service.test.ts tests/integration/butler-follow-up-routes.test.ts tests/integration/workbench-service.test.ts`
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/MessageTimeline.test.tsx src/features/conversation/components/SessionButlerActionButton.test.tsx src/features/butler/pages/ButlerPage.test.tsx src/shared/i18n/index.test.ts`

## 2026-04-08 Butler 代理消息详情联动补记

- 已把消息里的 `originRef` 正式接到 Butler 跟进详情：
  - 后端新增 `GET /api/butler/follow-up-tasks/:taskId`
  - 前端可以按消息里的 `originRef` 直接读取对应跟进任务
- 已把“代理发送”标签升级成详情入口：
  - 如果消息已经带正式 `origin=butler_proxy` 且有 `originRef`，点击标签会弹出对应 Butler 跟进详情
  - 详情里会显示跟进目标、当前状态、最近分析和等待原因
  - 老消息如果只有 `clientRequestId` 前缀、没有 `originRef`，仍然只显示兼容标签，不伪造详情
- 已继续保持低风险边界：
  - 不新增会话页侧栏
  - 不改普通消息结构主链
  - 只在现有时间线标签上做按需详情弹层
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-follow-up-routes.test.ts tests/integration/butler-follow-up-service.test.ts tests/integration/workbench-service.test.ts`
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/MessageTimeline.test.tsx src/features/conversation/components/SessionButlerActionButton.test.tsx src/features/butler/pages/ButlerPage.test.tsx src/shared/i18n/index.test.ts`
  - 如果明显还没做完，就自动向原开发会话补发继续推进消息
  - 如果最新输出明显是在向用户要选择，就把任务转成“等待你决定”，避免盲推
- 已把普通会话标题栏右侧 `AI` 按钮改成“先收跟进目标，再创建跟进任务”；不再直接发一次空的 `resume-session` 动作糊弄成“已跟进”。
- 已把 Butler 右侧信息栏重新拆成 `信息 / 自动化` 两个标签；`自动化` 会展示“进行中的跟进”和“已结束的跟进”，让用户能直接看到助手正在盯哪些会话、哪些任务已经收尾。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-follow-up-service.test.ts tests/integration/butler-follow-up-routes.test.ts tests/integration/butler-inbox-routes.test.ts tests/integration/butler-session-target-routes.test.ts tests/integration/butler-control-action-routes.test.ts`
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/WorkbenchLayout.test.tsx src/features/conversation/components/SessionButlerActionButton.test.tsx src/features/butler/pages/ButlerPage.test.tsx src/shared/i18n/index.test.ts`

## 2026-04-07 跟进任务后台评估助手补记

- 已把 `ButlerFollowUpService` 里的“已完成 / 等你决定 / 继续推进”判断，从本地启发式规则改成真实的后台评估助手决策，不再靠关键词正则猜状态。
- 已新增 `ButlerFollowUpEvaluationInstructionAdapter`，专门给跟进任务构造评估提示词，要求 provider 返回结构化 JSON：`decision / summary / waitingReason / continuePrompt / riskLevel`。
- 已给跟进评估补独立运行环境：
  - 单独的 follow-up runtime 和 `ProviderAdapterRegistry`
  - 单独的评估工作目录 `.butler-follow-up-evaluator`
  - 单独写入 `AGENTS.md`，`claude-code` 额外写 `CLAUDE.md`
  - `codex` 额外写独立 `config.toml`，只指向评估器自己的规则文件，并同步认证文件，避免回退到普通项目规则
- 已把跟进任务主链改成：
  - 会话还在运行时继续观察
  - 会话停下后，先启动后台评估助手
  - 如果评估结果是 `continue`，就把模型返回的 `continuePrompt` 真正发回原开发会话
  - 如果评估结果是 `waiting_user / completed / failed`，就按模型返回的正式结论更新任务状态
- 已补相关测试，覆盖：
  - `continue` 时自动补发模型返回的下一条消息
  - `waiting_user` 时转成等待用户决定
  - `completed` 时直接收尾
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-follow-up-service.test.ts tests/integration/butler-follow-up-routes.test.ts tests/integration/butler-inbox-routes.test.ts tests/integration/butler-session-target-routes.test.ts tests/integration/butler-control-action-routes.test.ts`

## 2026-04-07 自动化面板评估结果展示补记

- 已把 Butler 右侧 `自动化` 标签从“一行字符串列表”改成正式跟进卡片，直接展示：
  - 当前跟的是哪个会话
  - 当前目标是什么
  - 后台评估助手最近一次判断是什么
  - 如果在等用户决定，等的到底是什么
  - 下一次什么时候继续检查，或者任务是什么时候结束的
- 已把进行中的任务排序改成更贴近使用优先级的顺序：`等待你决定` 优先，其次才是普通进行中；已结束任务按最近更新时间倒序。
- 已继续保持用户视角表达，不把 provider 术语、内部对象名和工程师向字段直接堆进右侧信息栏。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx src/shared/i18n/index.test.ts`

## 这份文档是干什么的

这份任务清单用来把“代码助手控制面对话”拆成真正能落地的步骤。

它优先回答这些问题：

1. 先补哪层，不补就只能做出空壳
2. 哪些事情属于控制面，哪些事情仍然属于 `spec013`
3. 前后端应该按什么顺序接，不会越做越脏
4. 怎么验证它真的是“代码助手”，而不是项目会话换皮

---

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被别的问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并验证
- `CANCELLED`：取消并写原因

规则：

- 只有 `状态：DONE` 才能勾选 `[x]`
- 每完成一个任务，必须立刻回写本文件
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 0：先把边界钉死，别做成项目会话套壳

- [x] 0.1 启动 spec013.1 并完成范围收敛
  - 状态：DONE
  - 这一步到底做什么：建立 `spec013.1` 目录和主文档，明确这个子 Spec 只负责控制面对话、初始化配置和聚合上下文。
  - 做完你能看到什么：`spec013.1` 已经不是口头想法，而是正式 Spec。
  - 先依赖什么：`spec013`
  - 主要改哪些文件：
    - `specs/spec013.1-代码助手控制面对话与聚合上下文/README.md`
    - `specs/spec013.1-代码助手控制面对话与聚合上下文/requirements.md`
    - `specs/spec013.1-代码助手控制面对话与聚合上下文/design.md`
    - `specs/spec013.1-代码助手控制面对话与聚合上下文/tasks.md`
    - `specs/spec013.1-代码助手控制面对话与聚合上下文/docs/README.md`
  - 这一步明确不做什么：不直接改业务代码。
  - 怎么算完成：
    1. 子 Spec 文档已落盘
    2. 范围、依赖、非目标已写清楚
    3. 已明确排除“项目会话套壳”方案
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成 `spec013.1` 主文档初始化

- [x] 0.2 更新父 Spec 与总览索引
  - 状态：DONE
  - 这一步到底做什么：把 `spec013.1` 加进 `specs/README.md`，并在 `spec013` 里补职责边界说明。
  - 做完你能看到什么：仓库里的 Spec 索引和父子边界都清楚，不会后面重复定义。
  - 先依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec013-代码助手平台与跨工作区巡检编排/README.md`
    - `specs/spec013-代码助手平台与跨工作区巡检编排/design.md`
    - `specs/spec013-代码助手平台与跨工作区巡检编排/tasks.md`
  - 这一步明确不做什么：不修改业务代码。
  - 怎么算完成：
    1. 总览列表包含 `spec013.1`
    2. `spec013` 和 `spec013.1` 的职责边界已写清楚
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - `specs/README.md` 已包含 `spec013.1`
    - `spec013/README.md` 已补“和 spec013.1 的边界”
    - `spec013/design.md` 已补职责切分和控制面说明
    - `spec013/tasks.md` 已补 2026-04-05 边界回写记录

---

## 阶段 1：先把控制面后端对象立住

- [x] 1.1 落地 `ButlerProfile` 持久化模型与初始化服务
  - 状态：DONE
  - 这一步到底做什么：把助手 provider、工作目录、`AGENTS.md`、人格和工作重点做成正式模型。
  - 做完你能看到什么：系统有“助手自己是谁”的权威配置，不再靠前端临时状态拼。
  - 先依赖什么：0.2
  - 主要改哪些文件：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/repositories/*`
    - `apps/host/src/modules/butler/*`
    - `apps/host/src/routes/butler.ts`
    - `apps/host/src/server/create-server.ts`
    - `apps/host/tests/integration/*`
  - 这一步明确不做什么：先不启动控制会话。
  - 怎么算完成：
    1. 可初始化与更新 `ButlerProfile`
    2. 未初始化时有明确错误
  - 怎么验证：
    - Host 集成测试
    - 类型检查
  - 验证结果：
    - 已新增 `butler_profiles` 正式表和 `ButlerProfile` domain/repository
    - 已提供 `GET /api/butler/profile`、`POST /api/butler/profile/init`、`PATCH /api/butler/profile`
    - 已限制 provider 只允许 `codex` / `claude-code`
    - 已新增 `displayName`，作为助手自称，并写入首版 `AGENTS.md`
    - 已把助手工作目录改成后端默认生成，落在宿主数据目录下的独立 `butler-workspace` 目录；前端不再直接提交工作目录
    - 已校验助手工作目录不能直接复用项目仓库目录，`AGENTS.md` 文件模式必须位于助手工作目录内
    - 已改为由后端按初始化选项生成首版 `AGENTS.md`，初始化时不再要求前端直接提交规则正文
    - 已保留 `inline` / `file` 两种 `AGENTS` 模式；`file` 模式默认落地到助手工作目录内的 `AGENTS.md`
    - 已提供 `ensureInitialized()`，为后续控制会话启动前的拒绝逻辑做准备
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit` 已通过
    - `pnpm --dir apps/host exec vitest run tests/integration/butler-profile-service.test.ts tests/integration/butler-profile-routes.test.ts tests/integration/butler-project-service.test.ts tests/integration/butler-session-service.test.ts tests/integration/butler-routes-session-lifecycle.test.ts tests/integration/butler-routes-patrol-runtime.test.ts tests/integration/butler-routes-verification-runtime.test.ts tests/integration/project-memory-service.test.ts tests/integration/patrol-plan-service.test.ts tests/integration/patrol-run-service.test.ts tests/integration/patrol-execution-service.test.ts tests/integration/verification-run-service.test.ts` 已通过
    - `pnpm --dir apps/host exec vitest run tests/integration/butler-profile-service.test.ts tests/integration/butler-profile-routes.test.ts tests/integration/butler-control-session-routes.test.ts tests/integration/butler-context-routes.test.ts tests/integration/butler-control-action-routes.test.ts` 已通过

- [x] 1.2 落地 `ButlerControlSession` 模型与基础聊天 API
  - 状态：DONE
  - 这一步到底做什么：建立独立控制会话对象，并接到现有 Host session runtime。
  - 做完你能看到什么：代码助手终于有自己独立的聊天主链路。
  - 先依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/modules/butler/*`
    - `apps/host/src/routes/butler.ts`
    - `apps/host/tests/integration/*`
  - 这一步明确不做什么：先不接复杂控制动作。
  - 怎么算完成：
    1. 可创建控制会话
    2. 可续接控制会话
    3. 可向控制会话发送消息
  - 怎么验证：
    - Host 路由集成测试
    - Host 类型检查
  - 验证结果：
    - 已新增 `butler_control_sessions` 正式表和 `ButlerControlSession` domain/repository
    - 已新增 `ButlerControlSessionService`，独立管理控制会话创建、续接、发送消息
    - 已通过助手工作目录导入正式 workspace 记录，复用现有 `SessionLiveRuntimeService.startLiveSession/sendLiveMessage`
    - 已提供 `GET /api/butler/control-session`、`POST /api/butler/control-session/start`、`POST /api/butler/control-session/resume`、`POST /api/butler/control-session/messages`
    - 已在启动控制会话时写入独立工作目录下的 `AGENTS.md`，`claude-code` 额外同步 `CLAUDE.md`
    - 未初始化时会明确返回 `BUTLER_PROFILE_NOT_INITIALIZED`
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit` 已通过
    - `pnpm --dir apps/host exec vitest run tests/integration/butler-control-session-service.test.ts tests/integration/butler-control-session-routes.test.ts tests/integration/butler-profile-service.test.ts tests/integration/butler-profile-routes.test.ts tests/integration/butler-project-service.test.ts tests/integration/butler-session-service.test.ts tests/integration/butler-routes-session-lifecycle.test.ts tests/integration/butler-routes-patrol-runtime.test.ts tests/integration/butler-routes-verification-runtime.test.ts tests/integration/project-memory-service.test.ts tests/integration/patrol-plan-service.test.ts tests/integration/patrol-run-service.test.ts tests/integration/patrol-execution-service.test.ts tests/integration/verification-run-service.test.ts` 已通过

- [x] 1.3 落地 `ContextAggregator` 和 `ButlerContextSnapshot`
  - 状态：DONE
  - 这一步到底做什么：把项目、会话、记忆、巡视、验证数据按分层结构聚合。
  - 做完你能看到什么：控制会话读取的是整齐的上下文，而不是数据库原始记录。
  - 先依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/modules/butler/*`
    - `apps/host/tests/integration/*`
  - 这一步明确不做什么：先不做向量检索和复杂排序引擎。
  - 怎么算完成：
    1. 有全局聚合摘要
    2. 有项目级下钻摘要
    3. 有上下文版本号
  - 怎么验证：
    - 聚合服务测试
    - Host 类型检查
    - Butler 相关路由与控制会话测试
  - 验证结果：
    - 已新增 `ContextAggregator`，可输出 `GET /api/butler/overview`、`GET /api/butler/context-snapshot`、`GET /api/butler/projects/:projectId/context`
    - 已新增 `ButlerContextSnapshot`、项目级上下文和 prompt 作用域选择逻辑，默认只返回摘要层和行动层，不默认下发记忆正文
    - 已在 `ButlerControlSessionService` 中接入上下文版本号，启动、续接、发送消息前都会刷新 `BUTLER_CONTEXT.md` 与 `BUTLER_API.md`
    - 已把聚合上下文入口写入助手工作目录下的 `AGENTS.md` / `CLAUDE.md` 附加说明，避免直接把用户消息改造成大 prompt
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit` 已通过
    - `pnpm --dir apps/host exec vitest run tests/integration/butler-context-aggregator.test.ts tests/integration/butler-context-routes.test.ts tests/integration/butler-control-session-service.test.ts tests/integration/butler-control-session-routes.test.ts tests/integration/butler-profile-service.test.ts tests/integration/butler-profile-routes.test.ts tests/integration/butler-project-service.test.ts tests/integration/butler-session-service.test.ts tests/integration/butler-routes-session-lifecycle.test.ts tests/integration/butler-routes-patrol-runtime.test.ts tests/integration/butler-routes-verification-runtime.test.ts tests/integration/project-memory-service.test.ts tests/integration/patrol-plan-service.test.ts tests/integration/patrol-run-service.test.ts tests/integration/patrol-execution-service.test.ts tests/integration/verification-run-service.test.ts` 已通过

- [x] 1.4 阶段检查：控制面后端不再依赖“项目会话套壳”
  - 状态：DONE
  - 这一步到底做什么：确认后端已经有自己独立的控制会话和聚合上下文，而不是靠普通项目会话硬撑。
  - 做完你能看到什么：前端接入时不会一开始就走错路。
  - 先依赖什么：1.2、1.3
  - 主要改哪些文件：本阶段相关实现和测试文件
  - 这一步明确不做什么：先不做 UI。
  - 怎么算完成：
    1. 控制会话模型独立
    2. 聚合上下文可稳定输出
    3. API 不再借普通项目会话冒充
  - 怎么验证：
    - 集成测试
    - 代码走查
  - 验证结果：
    - 已确认 `ButlerControlSession` 与 `ButlerSession` 分离建模，控制会话持久化、启动、续接、发消息都走独立控制面 API
    - 已确认控制会话上下文来自 `ContextAggregator` 和 `ButlerContextSnapshot`，默认使用摘要层和行动层，不复用项目执行会话上下文
    - 已补 `GET /api/butler/overview`、`GET /api/butler/context-snapshot`、`GET /api/butler/control-session/*` 等控制面 API，未借普通项目会话接口冒充
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit` 已通过
    - `pnpm --dir apps/host exec vitest run tests/integration/butler-context-aggregator.test.ts tests/integration/butler-context-routes.test.ts tests/integration/butler-control-session-service.test.ts tests/integration/butler-control-session-routes.test.ts tests/integration/butler-routes-session-lifecycle.test.ts` 已通过

---

## 阶段 2：再补控制动作和续接能力

- [x] 2.1 实现安全控制动作协议
  - 状态：DONE
  - 这一步到底做什么：定义并实现“续接项目会话 / 发起巡视 / 发起验证”等控制动作。
  - 做完你能看到什么：助手不只是会说，还会调系统做事。
  - 先依赖什么：1.4
  - 主要改哪些文件：
    - `apps/host/src/modules/butler/*`
    - `apps/host/src/routes/butler.ts`
    - `apps/host/tests/integration/*`
  - 这一步明确不做什么：先不放开高风险写入类动作。
  - 怎么算完成：
    1. 安全动作可调用
    2. 动作结果会回写控制会话
  - 怎么验证：
    - 动作集成测试
  - 验证结果：
    - 已新增 `ButlerControlActionService` 和 `butler_control_events` 正式表，用来持久化控制动作结果并回写 Butler 事件时间线
    - 已提供 `GET /api/butler/control-session/events`
    - 已提供 `POST /api/butler/actions/open-project`、`POST /api/butler/actions/resume-session`、`POST /api/butler/actions/start-patrol`、`POST /api/butler/actions/start-verification`
    - 已在动作成功和失败两种情况下写入控制事件，避免 Butler 时间线失忆
    - 已为动作结果附带关联对象引用，供后续前端做下钻和跳转
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit` 已通过
    - `pnpm --dir apps/host exec vitest run tests/integration/butler-control-action-service.test.ts tests/integration/butler-control-action-routes.test.ts tests/integration/butler-control-session-service.test.ts tests/integration/butler-control-session-routes.test.ts tests/integration/butler-routes-session-lifecycle.test.ts tests/integration/butler-routes-patrol-runtime.test.ts tests/integration/butler-routes-verification-runtime.test.ts` 已通过

- [x] 2.2 实现控制会话和项目会话的关联视图
  - 状态：DONE
  - 这一步到底做什么：让控制会话能指向具体项目、会话、巡视、验证，并能在前端跳转或查看详情。
  - 做完你能看到什么：助手说的每条关键结论都能落到真实对象，不是空话。
  - 先依赖什么：2.1
  - 主要改哪些文件：
    - `apps/host/src/modules/butler/*`
    - `apps/user-app/src/features/*`
  - 这一步明确不做什么：先不做复杂跨项目编排。
  - 怎么算完成：
    1. 结论可下钻到真实对象
    2. 续接动作可定位到真实会话
  - 怎么验证：
    - 前后端联调
  - 验证结果：
    - 前端 Butler 工作台已新增“项目下钻 + 项目关联视图 + 动作事件区”，可按项目查看真实会话、记忆、巡视和验证摘要
    - 已按 `relatedRefs.routePath` 渲染 Butler 事件跳转按钮，并支持定位到 `workspace/session/butler` 相关路由，不改普通 `ConversationPage` 主链路
    - 已为项目会话提供“打开真实会话 / 续接会话”入口，并为项目提供“发起巡视 / 发起验证”按钮
    - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx src/features/conversation/components/WorkbenchLayout.test.tsx` 已通过

- [x] 2.3 实现会话摘要后台扫描与可配置防抖
  - 状态：DONE
  - 这一步到底做什么：在 Host 后台持续观察 Butler 已纳入的项目会话，一旦会话发生变化，就在可配置防抖后用轻量模型生成短摘要。
  - 做完你能看到什么：Butler 不再只靠首次导入时的静态快照，会持续积累最新会话摘要，后续问答和检索都能直接命中这些摘要。
  - 先依赖什么：1.3、2.2
  - 主要改哪些文件：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/repositories/butler-session-summary-state-repository.ts`
    - `apps/host/src/modules/butler/butler-session-summary-service.ts`
    - `apps/host/src/modules/butler/session-summary-instruction-adapter.ts`
    - `apps/host/src/modules/butler/session-summary-scheduler.ts`
    - `apps/host/src/server/create-server.ts`
    - `apps/user-app/src/features/butler/pages/ButlerPage.tsx`
    - `apps/host/tests/integration/butler-session-summary-service.test.ts`
    - `apps/host/tests/integration/session-summary-scheduler.test.ts`
    - `apps/user-app/src/features/butler/pages/ButlerPage.test.tsx`
  - 这一步明确不做什么：
    - 先不默认扫描归档会话
    - 先不做“按摘要搜索所有归档会话”的查询接口
    - 先不引入向量库
  - 怎么算完成：
    1. 活跃项目下的非归档会话会被后台观察
    2. 会话变化后先进入可配置防抖，再生成摘要
    3. 摘要结果会正式回写 Butler 会话和 checkpoint
  - 怎么验证：
    - Host 类型检查
    - 摘要服务测试
    - 调度器测试
    - 相关 Butler 控制面回归测试
    - Butler 设置页测试
  - 验证结果：
    - 已新增 `butler_session_summary_states` 正式表，用于保存消息指纹、防抖截止时间、运行状态和错误信息
    - 已新增 `ButlerSessionSummaryService`，会先同步活跃项目下的非归档会话，再按配置防抖触发摘要
    - 已新增 `SessionSummaryScheduler` 并接入 `create-server.ts` 生命周期，Host 启动后会在后台自动跑摘要扫描
    - 已把轻量摘要默认模型固定为 `gpt-5.1-codex-mini` / `haiku`，同时把推理强度降到 `low`
    - 已把摘要写回 `butler_sessions.lastSummary` 和 `session_checkpoints(sourceKind=summary)`，现有聚合逻辑无需重写即可消费
    - 已把默认防抖改成 5 分钟，并允许通过 Butler 右侧“助手设置”卡片修改
    - 已补 `last_summarized_sequence`，并改成只摘要新增消息，再和旧摘要合并成新的完整摘要
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit` 已通过
    - `pnpm --dir apps/host exec vitest run tests/integration/butler-session-summary-service.test.ts tests/integration/session-summary-scheduler.test.ts tests/integration/butler-control-session-service.test.ts tests/integration/butler-session-service.test.ts tests/integration/butler-context-aggregator.test.ts tests/integration/butler-context-routes.test.ts tests/integration/butler-control-action-service.test.ts tests/integration/butler-control-action-routes.test.ts tests/integration/butler-control-session-routes.test.ts` 已通过

---

## 阶段 3：最后接前端工作台

- [x] 3.1 在左侧导航增加“助手”入口
  - 状态：DONE
  - 这一步到底做什么：在桌面工作台左侧菜单中，把“助手”插到“终端”和“搜索”之间。
  - 做完你能看到什么：用户终于能从主工作台进入助手。
  - 先依赖什么：1.4
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/app/router.tsx`
    - `apps/user-app/src/i18n/*`
  - 这一步明确不做什么：先不补详情交互。
  - 怎么算完成：
    1. 桌面端入口可见
    2. 路由可进入助手页
  - 怎么验证：
    - 前端路由测试
    - 工作台组件测试
  - 验证结果：
    - 已在 `WorkbenchLayout` 桌面侧栏中将“助手”入口插入“终端”和“搜索”之间
    - 已新增并验证 `/workspaces/:workspaceId/butler` 路由挂载在 `WorkbenchShellRoute` 下
    - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/WorkbenchLayout.test.tsx` 已通过（含入口顺序与跳转断言）

- [x] 3.2 落地助手初始化页和工作台页
  - 状态：DONE
  - 这一步到底做什么：首次进入显示初始化表单，初始化完成后进入正式的助手工作台。
  - 做完你能看到什么：用户能真正设置和使用助手。
  - 先依赖什么：1.1、1.2、1.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/butler/*`
    - `apps/user-app/src/app/router.tsx`
    - `apps/user-app/src/app/styles.css`
  - 这一步明确不做什么：先不做移动端完整适配。
  - 怎么算完成：
    1. 初始化态可提交配置
    2. 正常态可聊天和看信息
  - 怎么验证：
    - 前端页面测试
    - 构建验证
  - 验证结果：
    - 已新增 Butler 初始化页（未初始化态表单）和 Butler 工作台页（控制会话消息区 + 聚合信息区 + 项目下钻区 + 动作事件区）
    - 初始化页已新增“助手称呼”输入，并要求用户显式填写；不再默认塞入一个名字糊弄过去
    - 初始化页已去掉工作目录、`AGENTS.md` 路径、`AGENTS` 规则正文、默认关注项目输入
    - `语气 / 使用语言 / 总结风格 / 风险倾向 / 汇报优先级` 已改成下拉枚举，并通过 i18n 词典显示
    - 初始化页已补充 `AGENTS` 模式说明：`inline` 表示系统托管规则，`file` 表示把规则写入工作目录里的 `AGENTS.md` 供后续直接编辑
    - 消息区复用 `MessageTimeline` 与 `ComposerPanel`，发送链路改走 `features/butler/api/butler-api.ts`
    - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx` 已通过
    - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx src/features/butler/runtime/butler-runtime-store.test.ts src/features/conversation/components/WorkbenchLayout.test.tsx src/shared/i18n/index.test.ts` 已通过
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json` 已通过

- [x] 3.3 实现 provider 切换清空对话上下文
  - 状态：DONE
  - 这一步到底做什么：把 `codex` / `claude-code` 切换行为做死，切换即清空当前对话视图状态。
  - 做完你能看到什么：不会再把两家 provider 的控制上下文混在一起。
  - 先依赖什么：3.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/butler/*`
    - `apps/user-app/src/features/conversation/*`
  - 这一步明确不做什么：不删除旧控制会话历史。
  - 怎么算完成：
    1. 切换 provider 后视图清空
    2. 新 provider 会重新走控制会话读取/创建
  - 怎么验证：
    - 前端交互测试
  - 验证结果：
    - provider 切换已放在 Butler 页面层处理，切换时先清空当前 Butler 视图状态、项目下钻状态和页面 key，再重载目标 provider 控制会话
    - 未删除历史控制会话，仅切换当前视图上下文和当前 provider
    - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx src/features/butler/runtime/butler-runtime-store.test.ts` 已通过（含“先清空再重载”与“失败回滚旧状态”断言）

- [x] 3.4 阶段检查：助手工作台能否成立
  - 状态：DONE
  - 这一步到底做什么：确认“独立初始化 + 独立控制会话 + 聚合上下文 + 工作台入口”已经闭环。
  - 做完你能看到什么：`spec013.1` 的最小版本成立。
  - 先依赖什么：3.1、3.2、3.3
  - 主要改哪些文件：本阶段相关实现和测试文件
  - 这一步明确不做什么：先不继续往高风险执行扩张。
  - 怎么算完成：
    1. 用户能初始化助手
    2. 用户能在工作台和助手对话
    3. 助手能解释和触发安全动作
  - 怎么验证：
    - 前后端联调
    - 构建和测试通过
  - 验证结果：
    - 已形成“独立初始化 + 独立控制会话 + 聚合上下文 + 工作台入口”的前端闭环
    - 未破坏普通会话主链路，Butler 发送链路与普通 session API 分离
    - 已完成最小必要验证：
      - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx src/features/butler/runtime/butler-runtime-store.test.ts src/features/conversation/components/WorkbenchLayout.test.tsx src/shared/i18n/index.test.ts`
      - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
      - `pnpm --dir apps/host exec vitest run tests/integration/butler-profile-routes.test.ts tests/integration/butler-control-session-routes.test.ts tests/integration/butler-context-routes.test.ts tests/integration/butler-control-action-routes.test.ts`

## 2026-04-06 补记：历史会话检索与正式配置编辑

- 已把 `/api/butler/search` 扩成支持 `includeArchived=true`，默认仍只查非归档摘要；只有明确查历史会话时，才扩到归档摘要。
- 已把摘要命中结果补上真实 `sessionId`，右侧“信息”标签现在可以直接按需补查最近 40 条原始消息，不再只能停在摘要层。
- 已把“配置”标签补成正式编辑入口，支持修改助手称呼、AGENTS 模式、语气、使用语言、总结风格、风险倾向、汇报优先级、摘要防抖和 AGENTS 规则正文。
- 已把右侧四个标签收紧成单行显示，窄宽度下允许横向滚动，但不会换行。
- 已同步更新 Butler 内部补查说明：用户明确点名历史会话或归档会话时，先带 `includeArchived=true` 查摘要，再决定是否继续补查原始消息。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/host exec vitest run tests/integration/butler-context-aggregator.test.ts tests/integration/butler-context-routes.test.ts tests/integration/butler-session-service.test.ts`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx src/features/butler/runtime/butler-runtime-store.test.ts`

## 2026-04-06 补记：助手页版式对齐会话页

- 已把助手主对话页改成和普通会话页一致的零外边距布局，不再额外套一层大卡片和内边距容器。
- 已把助手顶部栏压成单行标题栏样式，头像、名称、provider 选择、新建会话、刷新都收进同一行，不再出现 `Provider` 上下两行的堆叠布局。
- 已把右侧信息栏的顶部分页改成 Butler 专用四列布局，修正了公共三列样式把四个标签挤坏的问题。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx`

## 2026-04-06 补记：助手标题栏工具化收口

- 已把头像和助手名称彻底锁定为左右排列，不再继承普通会话页默认的纵向居中布局。
- 已移除标题栏里的 `Provider` 文案，只保留单行 provider 下拉框。
- 已把“新建会话”和“刷新”改成终端标题栏同风格的工具按钮，并把“新建会话”移动到“刷新”左侧。
- 已把助手标题栏高度继续压低，直接复用工作台 header 的高度和 padding 变量，和左右信息栏标题高度保持一致。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx`

## 2026-04-06 补记：三栏标题基线继续对齐

- 已把助手中间标题栏从普通会话 header 样式彻底切到工作台 header 基线，避免被 `conversation-header` 默认内容布局继续撑高。
- 已把助手头像继续缩小，确保标题栏高度不会被头像尺寸反向撑开。
- 已把右侧标签栏外面补一层正式 header 壳，并用更高优先级强制 Butler 标签栏走四列单行样式，修正第四个标签掉到第二行的问题。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx`

## 2026-04-07 补记：工作台全局通知入口

- 已在左侧顶部工具栏新增全局通知按钮，位置固定在“收起会话列表”右侧、“前进 / 后退”左侧；左侧栏收起后，折叠轨道里也保留同一个入口。
- 已把通知内容收口成三类真实提醒：`等待你决定` 的会话跟进、`跟进失败` 的会话跟进、`验证失败` 的功能验证；不额外新造通知表，而是直接复用 Butler 现有事实数据组合。
- 已补未读气泡和通知面板：未读数按本地 `seenAt` 计算，打开通知面板后会标记已读；点击通知后会直接跳到对应会话或对应工作区的助手页。
- 已把通知入口实现从共享 `ref` 改成更简单的锚点判断，修掉了此前 `WorkbenchLayout` 里的类型错误、TDZ 和面板关闭异常。
- 已补本轮最小必要验证：
  - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/WorkbenchLayout.test.tsx src/shared/i18n/index.test.ts`
