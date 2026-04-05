# 任务清单 - spec013.1-代码管家控制面对话与聚合上下文（人话版）

状态：Draft

## 2026-04-05 进展补记

- 已确认 `spec013.1` 只处理“代码管家控制面对话、初始化配置和聚合上下文”，不去重写 `spec013` 的事实层模型。
- 已确认“直接复用项目会话当管家聊天”不是正路，已将其明确排除。
- 已完成本子 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化。
- 已补 `ButlerProfile`、`ButlerControlSession`、`ButlerContextSnapshot` 的核心设计草案。
- 已补独立 Butler Chat API、控制动作 API 和前端工作台入口设计。
- 已更新 `specs/README.md`，把 `spec013.1` 加入总览索引。

## 2026-04-06 初始化收口补记

- 已把 Butler 初始化入口收紧为“先明确管家是谁，再开始聊天”，不再用默认名字蒙混过关。
- 已把管家工作目录改成后端默认生成，落在宿主数据目录内的独立子目录，前端不再暴露这个路径。
- 已把首版 `AGENTS.md` 改成由后端根据初始化选项自动生成，并写入管家自称、语气、语言、总结风格、风险倾向和汇报优先级。
- 已保留 `inline` / `file` 两种 `AGENTS` 模式，但初始化页只解释模式差异，不再让用户一开始直接填写规则正文。
- 已把初始化页的人格和汇报偏好改成下拉枚举，并走 i18n 词典显示。

## 2026-04-06 Butler 工作台收口补记

- 已把 Butler 视图和普通工作区工具侧栏彻底拆开：进入 Butler 路由后，不再显示默认的“文件管理 / GIT 管理 / 进程管理”右侧面板，也不再显示对应折叠按钮。
- 已把 Butler 主区域改成真正的独立对话窗口风格，顶部显示管家称呼、provider、刷新和“新建会话”，并按管家名称稳定生成 emoji 头像，同时复用到消息时间线头像。
- 已补“新建会话”入口，并把 provider 切换后的行为固定为自动重置上下文并创建新控制会话；Butler 控制会话不会出现在普通工作区会话列表和 workbench 快照里。
- 已强化 Butler 独立规则说明：生成的 `AGENTS.md` 和控制会话附加说明都明确声明这是管家专用规则体系，不继承普通项目会话规则；同时继续保留独立工作目录内的最小 git 根隔离。
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

## 这份文档是干什么的

这份任务清单用来把“代码管家控制面对话”拆成真正能落地的步骤。

它优先回答这些问题：

1. 先补哪层，不补就只能做出空壳
2. 哪些事情属于控制面，哪些事情仍然属于 `spec013`
3. 前后端应该按什么顺序接，不会越做越脏
4. 怎么验证它真的是“代码管家”，而不是项目会话换皮

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
    - `specs/spec013.1-代码管家控制面对话与聚合上下文/README.md`
    - `specs/spec013.1-代码管家控制面对话与聚合上下文/requirements.md`
    - `specs/spec013.1-代码管家控制面对话与聚合上下文/design.md`
    - `specs/spec013.1-代码管家控制面对话与聚合上下文/tasks.md`
    - `specs/spec013.1-代码管家控制面对话与聚合上下文/docs/README.md`
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
    - `specs/spec013-代码管家平台与跨工作区巡检编排/README.md`
    - `specs/spec013-代码管家平台与跨工作区巡检编排/design.md`
    - `specs/spec013-代码管家平台与跨工作区巡检编排/tasks.md`
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
  - 这一步到底做什么：把管家 provider、工作目录、`AGENTS.md`、人格和工作重点做成正式模型。
  - 做完你能看到什么：系统有“管家自己是谁”的权威配置，不再靠前端临时状态拼。
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
    - 已新增 `displayName`，作为管家自称，并写入首版 `AGENTS.md`
    - 已把管家工作目录改成后端默认生成，落在宿主数据目录下的独立 `butler-workspace` 目录；前端不再直接提交工作目录
    - 已校验管家工作目录不能直接复用项目仓库目录，`AGENTS.md` 文件模式必须位于管家工作目录内
    - 已改为由后端按初始化选项生成首版 `AGENTS.md`，初始化时不再要求前端直接提交规则正文
    - 已保留 `inline` / `file` 两种 `AGENTS` 模式；`file` 模式默认落地到管家工作目录内的 `AGENTS.md`
    - 已提供 `ensureInitialized()`，为后续控制会话启动前的拒绝逻辑做准备
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit` 已通过
    - `pnpm --dir apps/host exec vitest run tests/integration/butler-profile-service.test.ts tests/integration/butler-profile-routes.test.ts tests/integration/butler-project-service.test.ts tests/integration/butler-session-service.test.ts tests/integration/butler-routes-session-lifecycle.test.ts tests/integration/butler-routes-patrol-runtime.test.ts tests/integration/butler-routes-verification-runtime.test.ts tests/integration/project-memory-service.test.ts tests/integration/patrol-plan-service.test.ts tests/integration/patrol-run-service.test.ts tests/integration/patrol-execution-service.test.ts tests/integration/verification-run-service.test.ts` 已通过
    - `pnpm --dir apps/host exec vitest run tests/integration/butler-profile-service.test.ts tests/integration/butler-profile-routes.test.ts tests/integration/butler-control-session-routes.test.ts tests/integration/butler-context-routes.test.ts tests/integration/butler-control-action-routes.test.ts` 已通过

- [x] 1.2 落地 `ButlerControlSession` 模型与基础聊天 API
  - 状态：DONE
  - 这一步到底做什么：建立独立控制会话对象，并接到现有 Host session runtime。
  - 做完你能看到什么：代码管家终于有自己独立的聊天主链路。
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
    - 已通过管家工作目录导入正式 workspace 记录，复用现有 `SessionLiveRuntimeService.startLiveSession/sendLiveMessage`
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
    - 已把聚合上下文入口写入管家工作目录下的 `AGENTS.md` / `CLAUDE.md` 附加说明，避免直接把用户消息改造成大 prompt
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
  - 做完你能看到什么：管家不只是会说，还会调系统做事。
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
  - 做完你能看到什么：管家说的每条关键结论都能落到真实对象，不是空话。
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

---

## 阶段 3：最后接前端工作台

- [x] 3.1 在左侧导航增加“管家”入口
  - 状态：DONE
  - 这一步到底做什么：在桌面工作台左侧菜单中，把“管家”插到“终端”和“搜索”之间。
  - 做完你能看到什么：用户终于能从主工作台进入管家。
  - 先依赖什么：1.4
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/app/router.tsx`
    - `apps/user-app/src/i18n/*`
  - 这一步明确不做什么：先不补详情交互。
  - 怎么算完成：
    1. 桌面端入口可见
    2. 路由可进入管家页
  - 怎么验证：
    - 前端路由测试
    - 工作台组件测试
  - 验证结果：
    - 已在 `WorkbenchLayout` 桌面侧栏中将“管家”入口插入“终端”和“搜索”之间
    - 已新增并验证 `/workspaces/:workspaceId/butler` 路由挂载在 `WorkbenchShellRoute` 下
    - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/WorkbenchLayout.test.tsx` 已通过（含入口顺序与跳转断言）

- [x] 3.2 落地管家初始化页和工作台页
  - 状态：DONE
  - 这一步到底做什么：首次进入显示初始化表单，初始化完成后进入正式的管家工作台。
  - 做完你能看到什么：用户能真正设置和使用管家。
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
    - 初始化页已新增“管家称呼”输入，并要求用户显式填写；不再默认塞入一个名字糊弄过去
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

- [x] 3.4 阶段检查：管家工作台能否成立
  - 状态：DONE
  - 这一步到底做什么：确认“独立初始化 + 独立控制会话 + 聚合上下文 + 工作台入口”已经闭环。
  - 做完你能看到什么：`spec013.1` 的最小版本成立。
  - 先依赖什么：3.1、3.2、3.3
  - 主要改哪些文件：本阶段相关实现和测试文件
  - 这一步明确不做什么：先不继续往高风险执行扩张。
  - 怎么算完成：
    1. 用户能初始化管家
    2. 用户能在工作台和管家对话
    3. 管家能解释和触发安全动作
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
