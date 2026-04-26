# 任务清单 - spec010.4-CLI提供商启用控制与能力矩阵（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单用来把“provider 启用控制和能力矩阵”拆成真正能落地的步骤。

它优先回答这些问题：

1. provider 启用态到底放哪，谁说了算
2. 哪些前后端入口必须一起收口，不能只改一个开关
3. 设置页能力矩阵的数据从哪来，谁负责解释
4. 怎么验证禁用后是真的失效，而不是看起来像失效

---

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等待复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻更新本文件状态
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 0：先把边界和方向钉死

- [x] 0.1 建立 spec010.4 主文档
  - 状态：DONE
  - 这一步到底做什么：创建 `README.md`、`requirements.md`、`design.md`、`tasks.md`，把这次要解决的问题、范围和不做的事写清楚。
  - 做完你能看到什么：`spec010.4` 已经从口头讨论变成正式 Spec。
  - 先依赖什么：无
  - 开始前先看：
    - `spec010`
    - `spec010.1`
    - `spec010.2`
    - `spec010.3`
  - 主要改哪里：
    - `specs/spec010.4-CLI提供商启用控制与能力矩阵/*`
  - 这一步先不做什么：不直接改业务代码。
  - 怎么算完成：
    1. 主文档齐全
    2. 范围、依赖和不做项写清楚
  - 怎么验证：
    - 文档自检
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

- [x] 0.2 盘点当前 provider 可见性与硬编码入口
  - 状态：DONE
  - 这一步到底做什么：把当前前后端哪些地方在决定 provider 是否显示、是否可用全部列出来，避免后面漏门禁。
  - 做完你能看到什么：已经有一份正式清单说明哪些入口需要一起收口。
  - 先依赖什么：0.1
  - 开始前先看：
    - 当前仓库中的 provider picker、Fork、Skill、Butler、SessionHistoryService 相关代码
  - 主要改哪里：
    - `specs/spec010.4-CLI提供商启用控制与能力矩阵/docs/20260426-provider入口与门禁现状盘点.md`
  - 这一步先不做什么：不开始重构入口。
  - 怎么算完成：
    1. 前端关键入口清单明确
    2. 后端关键门禁点明确
  - 怎么验证：
    - 文档核对
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 5
  - 对应设计：`design.md` §5、§6

- [x] 0.3 锁定启用态归属和禁用语义
  - 状态：DONE
  - 这一步到底做什么：明确 provider 启用态是 Host 全局配置，不是账户偏好；同时明确“禁用=隐藏旧入口+阻断新动作，不删旧数据”。
  - 做完你能看到什么：后面不需要一边写代码一边重新争论数据归属。
  - 先依赖什么：0.2
  - 开始前先看：
    - `spec001.1`
    - `spec001.2`
    - `design.md`
  - 主要改哪里：
    - `specs/spec010.4-CLI提供商启用控制与能力矩阵/design.md`
  - 这一步先不做什么：不把旧会话删除。
  - 怎么算完成：
    1. Host 全局配置方案写死
    2. 禁用语义明确
  - 怎么验证：
    - 文档评审
  - 对应需求：`requirements.md` 需求 1、需求 4、需求 8
  - 对应设计：`design.md` §2

---

## 阶段 1：先把后端统一真源和总览接口做出来

- [x] 1.1 新增 provider 启用态存储与仓储
  - 状态：DONE
  - 这一步到底做什么：新增 Host 全局 provider 启用态表、仓储和默认值逻辑。
  - 做完你能看到什么：后端终于有一个地方正式回答“这个 provider 现在是不是启用”。
  - 先依赖什么：0.3
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §4.1
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/sqlite/client.ts`
    - `apps/host/src/storage/repositories/*`
  - 这一步先不做什么：不先碰前端。
  - 怎么算完成：
    1. 表结构可迁移
    2. 默认启用策略明确
  - 怎么验证：
    - `pnpm --filter host test -- --run tests/integration/provider-control-repository.test.ts`
    - `pnpm --filter host test -- --run tests/integration/sqlite-bootstrap.test.ts`
  - 已完成结果：
    - 已新增 `provider_control_profiles` 表和索引
    - 已新增 `ProviderControlRepository`，缺省记录按“默认启用”返回
    - 已在 `create-server.ts` 的仓储集合中接入 `ProviderControlRepository`
    - 已补仓储集成测试，覆盖建表、默认值和持久化读取
  - 对应需求：`requirements.md` 需求 1、需求 8
  - 对应设计：`design.md` §4.1

- [x] 1.2 新增 Provider Catalog 服务与接口
  - 状态：DONE
  - 这一步到底做什么：把启用态、原生 capability、产品能力矩阵组合成正式 DTO，对外提供统一总览和更新接口。
  - 做完你能看到什么：设置页和其他前端入口有单一数据源，不再自己拼。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 6、需求 7
    - `design.md` §4.2、§5.5、§6.3
  - 主要改哪里：
    - `apps/host/src/modules/provider/*`
    - `apps/host/src/routes/providers.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
  - 这一步先不做什么：不先改旧 picker。
  - 怎么算完成：
    1. 可读全量 provider 总览
    2. 可更新某个 provider 启用态
  - 怎么验证：
    - provider route 集成测试
    - DTO 类型测试
  - 已完成结果：
    - 已新增 `ProviderCatalogService`，统一组合 provider 启用态、安装状态、原生 capability 和产品能力矩阵
    - 已新增 `GET /api/providers/catalog` 和 `PUT /api/providers/catalog/:provider`
    - 已把 `conversation-api.ts` 补到可读取和更新 provider catalog
    - 已补 `provider-catalog-routes.test.ts`，覆盖 catalog 读取、开关更新和兼容 capability 返回
  - 对应需求：`requirements.md` 需求 1、需求 6、需求 7
  - 对应设计：`design.md` §4.2、§5.5

- [x] 1.3 定义统一禁用错误和兼容返回
  - 状态：DONE
  - 这一步到底做什么：把 disabled provider 的后端返回语义固定下来，不让控制器各自起名字。
  - 做完你能看到什么：前端和测试都知道“这是被禁用，不是安装丢了，也不是 provider 崩了”。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 3、需求 8
    - `design.md` §4.3、§7
  - 主要改哪里：
    - `apps/host/src/shared/errors/*`
    - `apps/host/src/modules/provider/*`
    - `apps/user-app/src/shared/network/*`
  - 这一步先不做什么：不先做能力矩阵 UI。
  - 怎么算完成：
    1. `PROVIDER_DISABLED` 错误码稳定
    2. 旧接口可解释
  - 怎么验证：
    - 错误映射测试
  - 已完成结果：
    - 已新增统一禁用错误 `PROVIDER_DISABLED`
    - 已新增 `provider-disabled.ts`，统一处理禁用能力降级和错误构造
    - 已让旧的 capability 路由在 provider 被禁用时返回兼容能力快照，而不是直接炸成 409
    - 已在前端 `api-error.ts` 补 `isProviderDisabledApiError`，方便后续统一识别
  - 对应需求：`requirements.md` 需求 3、需求 8
  - 对应设计：`design.md` §4.3、§7

---

## 阶段 2：把会话主链路和后台任务真正收口

- [x] 2.1 让工作区发现与后台刷新跳过 disabled provider
  - 状态：DONE
  - 这一步到底做什么：让 `discoverWorkspaceSessions`、后台发现任务、capability refresh 都不再继续扫描已禁用 provider。
  - 做完你能看到什么：provider 被关掉后，后端不会继续偷偷帮它干活。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §5.1、§5.2
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/provider/provider-discovery-runtime.ts`
    - `apps/host/src/modules/tasks/*`
  - 这一步先不做什么：不删除旧 session index。
  - 怎么算完成：
    1. disabled provider 不参与发现
    2. disabled provider 不触发 capability refresh
  - 怎么验证：
    - `pnpm --filter host test -- --run tests/integration/provider-control-session-history.test.ts`
    - `pnpm --filter host test -- --run tests/integration/provider-discovery-runtime.test.ts`
    - `pnpm --filter host test -- --run tests/integration/provider-discovery-helper-client.test.ts`
    - `pnpm --filter host test -- --run tests/integration/session-history-background-tasks.test.ts`
  - 已完成结果：
    - 已让 `SessionHistoryService.discoverWorkspaceSessions` 在进入发现链路前先过滤 disabled provider
    - 已让 discovery runtime、helper client、helper process 和任务处理链路都接受 `enabledProviders`，避免 helper 继续扫描被禁用的 provider
    - 已兼容 capability refresh 相关后台链路，不会再为 disabled provider 继续补刷
  - 对应需求：`requirements.md` 需求 3、需求 8
  - 对应设计：`design.md` §5.1、§5.2

- [x] 2.2 让会话列表隐藏 disabled provider 的旧会话
  - 状态：DONE
  - 这一步到底做什么：保留旧记录，但在正常列表和工作台返回结果里过滤掉 disabled provider 会话。
  - 做完你能看到什么：禁用后旧会话看不见，重新启用后又能回来。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.2、§5.1、§7.2
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/workbench/workbench-service.ts`
  - 这一步先不做什么：不做物理删除。
  - 怎么算完成：
    1. 正常列表不再出现 disabled provider 旧会话
    2. 重新启用后无需修数据即可恢复
  - 怎么验证：
    - `pnpm --filter host test -- --run tests/integration/provider-control-session-history.test.ts`
    - `pnpm --filter host test -- --run tests/integration/workbench-service.test.ts`
  - 已完成结果：
    - 已让 `SessionHistoryService.listWorkspaceSessions` 只返回当前仍启用 provider 的会话
    - 已保留原始 session binding 和 index，不做物理删除，重新启用后可以直接恢复可见
    - 已确认 workbench 快照继续直接使用过滤后的会话列表，不会把 disabled provider 的旧会话重新拼回来
  - 对应需求：`requirements.md` 需求 4、需求 8
  - 对应设计：`design.md` §2.2、§5.1、§7.2

- [x] 2.3 让 start/resume/send/fork 对 disabled provider 统一硬拒绝
  - 状态：DONE
  - 这一步到底做什么：在会话主动作上统一加后端门禁，不再依赖前端隐藏按钮。
  - 做完你能看到什么：就算有人手工发请求，也无法绕过禁用状态。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §5.1
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/sessions/session-controller.ts`
    - `apps/host/src/modules/assistant-capability/*`
  - 这一步先不做什么：不先改 Skill/Butler。
  - 怎么算完成：
    1. start/resume/send/fork 全部受控
    2. 错误码统一
  - 怎么验证：
    - `pnpm --filter host test -- --run tests/integration/provider-control-session-history.test.ts`
    - `pnpm --filter host test -- --run tests/integration/session-routes.test.ts`
    - `pnpm --filter host test -- --run tests/integration/assistant-capability-routes.test.ts`
  - 已完成结果：
    - 已让 `SessionHistoryService` 对 `start/resume/send/fork` 统一抛出 `PROVIDER_DISABLED`
    - 已让 `/api/sessions/*` 路由在 provider 被禁用时统一返回 `409 + PROVIDER_DISABLED`
    - 已让 `/api/assistant/sessions/*` 路由透传相同错误，避免助手链路绕过门禁
    - 已补 `start-live` 的路由回归，确认“发起新会话”这条实时入口也不会漏掉
  - 对应需求：`requirements.md` 需求 3、需求 8
  - 对应设计：`design.md` §5.1、§5.5

---

## 阶段 3：把 Skill 和 Butler 相关链路一起收住

- [x] 3.1 Skill 目标选择与同步动作遵守 provider 启用态
  - 状态：DONE
  - 这一步到底做什么：让 Skill 管理里新的目标选择、同步动作和状态解释都知道 provider 是否被禁用。
  - 做完你能看到什么：禁用 provider 后，Skill 不会继续把它当成新目标。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §5.3
  - 主要改哪里：
    - `apps/host/src/modules/skills/*`
    - `apps/user-app/src/settings/SkillManagementPanel.tsx`
    - `apps/user-app/src/features/settings/api/skills-api.ts`
  - 这一步先不做什么：不删除旧 Skill 副本。
  - 怎么算完成：
    1. disabled provider 不能作为新 Skill 目标
    2. 旧绑定仍可解释
  - 怎么验证：
    - `pnpm --filter host test -- --run tests/integration/skill-add-service.test.ts tests/integration/skill-import-service.test.ts tests/integration/skill-routes.test.ts`
    - `pnpm --filter user-app exec vitest run src/settings/SkillManagementPanel.test.tsx`
  - 已完成结果：
    - 已让 `SkillManagerService` 对 `add/import/sync` 新动作统一检查 target provider 启用态，命中 disabled provider 时直接返回 `PROVIDER_DISABLED`
    - 已让 `/api/skills`、`/api/skills/import`、`/api/skills/sync` 走真实门禁回归，防止前端绕过
    - 已让 `SkillManagementPanel` 改为读取 provider catalog 判断 target 可用性，不再靠静态列表盲选
    - 已让面板里的旧绑定、未纳管项和助手运行时目标继续可见，但会明确标注“已禁用”，把“provider 被禁用”和“目录不可用”区分开
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §5.3

- [x] 3.2 Butler / 助手 provider 入口遵守启用态
  - 状态：DONE
  - 这一步到底做什么：让 Butler 当前支持的 provider 在被禁用时一起从跟进和控制入口中收口。
  - 做完你能看到什么：关掉 `codex` 或 `claude-code` 后，助手入口不会继续把它当成可用目标。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §5.4
  - 主要改哪里：
    - `apps/host/src/modules/butler/*`
    - `apps/host/src/modules/assistant-capability/*`
    - `apps/user-app/src/features/conversation/components/SessionButlerActionButton.tsx`
    - `apps/user-app/src/features/butler/*`
  - 这一步先不做什么：不新增新的 Butler provider。
  - 怎么算完成：
    1. Butler provider 选择受控
    2. 跟进动作受控
  - 怎么验证：
    - `pnpm --filter host test -- --run tests/integration/assistant-capability-service.test.ts tests/integration/butler-profile-service.test.ts tests/integration/butler-control-session-service.test.ts`
    - `pnpm --filter host test -- --run tests/integration/assistant-capability-routes.test.ts`
    - `pnpm --filter user-app exec vitest run src/features/conversation/components/SessionButlerActionButton.test.tsx src/features/butler/pages/ButlerPage.test.tsx`
  - 已完成结果：
    - 已让 `AssistantCapabilityService` 在启动助手会话和创建 follow-up 前统一检查 provider 启用态，命中 disabled provider 时直接抛 `PROVIDER_DISABLED`
    - 已让 Butler 控制入口在 `ButlerProfileService` 和 `ButlerControlSessionService` 两层都遵守启用态：禁用 provider 不能再被初始化、切换或继续作为新的控制会话启动目标
    - 已让 `SessionButlerActionButton` 改为读取 provider catalog，只展示当前仍启用的 Butler provider；当前会话 provider 被禁用时会自动回落到仍可用项
    - 已让 Butler 页面初始化和顶部 provider 切换器读取 catalog 过滤 disabled provider；如果当前档案还指向已禁用项，会保留旧记录展示，但新的 provider 选择和新控制会话动作只能落到可用项
  - 对应需求：`requirements.md` 需求 5、需求 8
  - 对应设计：`design.md` §5.4

---

## 阶段 4：前端统一可见性和设置页面板

- [x] 4.1 收口前端 provider 列表来源
  - 状态：DONE
  - 这一步到底做什么：把会话创建、Fork、并行会话、Butler 跟进这些地方的 provider 列表统一改成读 provider catalog。
  - 做完你能看到什么：前端不再到处维护各自的 provider 可见性。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 6
    - `design.md` §6.1
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/*`
    - `apps/user-app/src/features/conversation/capability/provider-ui.ts`
  - 这一步先不做什么：不删静态 metadata。
  - 怎么算完成：
    1. 动态可见性统一
    2. 静态 metadata 只负责名字/图标/排序
  - 怎么验证：
    - provider picker 相关单测
    - Fork/并行会话单测
  - 已完成结果：
    - 已新增 `useEnabledProviderCatalog`，把“当前有哪些 provider 能显示”收口成一个统一 hook，避免各组件继续各自请求 catalog
    - 已让 `SessionProviderPicker`、选区新会话动作、并行会话弹窗、主输入区 Fork/发送相关 provider 列表统一走 catalog 可见性
    - 已把 `provider-ui.ts` 收回成静态 metadata 层，只继续负责 provider 名字、图标和排序，不再决定动态启用态
    - 已补前端回归测试，确认禁用 provider 后会从会话创建、选区动作、并行会话和 Fork 目标列表里一起消失
  - 对应需求：`requirements.md` 需求 2、需求 6
  - 对应设计：`design.md` §6.1

- [x] 4.2 新增设置页 provider 管理面板
  - 状态：DONE
  - 这一步到底做什么：在设置页里增加正式的 provider 管理区，展示启用开关和能力矩阵。
  - 做完你能看到什么：用户终于有一个地方能统一管理 provider。
  - 先依赖什么：4.1
  - 开始前先看：
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
    - `requirements.md` 需求 6、需求 7
    - `design.md` §6.2、§6.3
  - 主要改哪里：
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - `apps/user-app/src/settings/*`
    - `apps/user-app/src/i18n/*`
  - 这一步先不做什么：不把它做成新的顶级导航页面。
  - 怎么算完成：
    1. 可查看全量 provider 状态
    2. 可切换启用态
    3. 可查看矩阵
  - 怎么验证：
    - SettingsPage 单测
    - 手工视觉走查
  - 已完成结果：
    - 已新增 `ProviderManagementPanel`，统一读取 provider catalog，并在弹窗里显示启用数、禁用数、总数和每个 CLI 的能力矩阵
    - 已把 provider 管理详情全部收进模态框；设置页外层只保留说明和按钮，避免和模型配置文件切换挤在同一块明细里
    - 已把设置页原来的“模型管理”和“CLI 提供方”合并成“能力管理”；桌面端同组展示，移动端只保留一个分类入口
    - 已把能力矩阵改成“纵向 provider、横向能力、末尾状态和启用开关”的表格结构，并兼容旧的 `/settings/model-management`、`/settings/provider-management` 路由别名
    - 已把能力标记进一步收紧成参考图那种绿色对号方块；不支持的能力单元格保持留白，同时去掉每行冗余说明文案，让矩阵密度更高
    - 已让 provider catalog 向前端带出 CLI 版本号；矩阵里“状态”列显示安装状态，“CLI 名称右侧标签”改成版本号
    - 已补 `ProviderManagementPanel.test.tsx` 和 `SettingsPage.test.tsx`，覆盖入口按钮、模态框矩阵、开关更新、统一分类页和旧路由别名
  - 对应需求：`requirements.md` 需求 6、需求 7
  - 对应设计：`design.md` §6.2、§6.3

- [x] 4.3 切换启用态后清理前端 capability 缓存
  - 状态：DONE
  - 这一步到底做什么：确保用户切换开关后，旧 provider capability 缓存不会让页面继续显示过期入口。
  - 做完你能看到什么：切换是即时的，不需要用户手工刷新几次。
  - 先依赖什么：4.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 6
    - `design.md` §6.4
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/SessionProviderPicker.tsx`
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
    - 相关设置页逻辑
  - 这一步先不做什么：不重写 capability 缓存机制。
  - 怎么算完成：
    1. 切换后旧入口立即消失
    2. 再启用后立即恢复
  - 怎么验证：
    - 前端缓存失效测试
  - 已完成结果：
    - 已确认当前仍会跨 render 复用 provider capability 的前端本地缓存只剩 `SessionProviderPicker` 的 `providerCapabilitiesCache`，没有再额外长出第二套 provider capability cache
    - 已让设置页 `ProviderManagementPanel` 在切换 provider 启用态成功后主动调用 `clearSessionProviderPickerCapabilityCache()`，避免创建入口继续吃旧能力快照
    - 已补 `SessionProviderPicker.test.tsx`，明确验证清掉缓存后会重新请求 provider 能力，而不是继续复用旧值
    - 已顺手把并行会话空提示词测试改成稳定等待，避免混跑时因为状态刷新时序导致假失败
  - 对应需求：`requirements.md` 需求 2、需求 6、需求 8
  - 对应设计：`design.md` §6.4

---

## 阶段 5：最终回归与验收

- [x] 5.1 建立禁用/启用回归清单
  - 状态：DONE
  - 这一步到底做什么：整理一份最小回归集，明确每次 provider 门禁改动后至少要验哪些入口。
  - 做完你能看到什么：以后再改 provider 可见性，不会全靠记忆回归。
  - 先依赖什么：4.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
  - 主要改哪里：
    - `specs/spec010.4-CLI提供商启用控制与能力矩阵/docs/`
  - 这一步先不做什么：不顺手扩大到 provider 安装流程。
  - 怎么算完成：
    1. 有正式回归清单
    2. 入口覆盖完整
  - 怎么验证：
    - 文档验收
  - 已完成结果：
    - 已新增 `docs/20260426-provider启用控制回归清单.md`
    - 已把设置页、会话创建、选区动作、并行会话、Fork、Butler、Skill、后端门禁分成独立回归块
    - 已明确区分“自动化最小回归”和“发版前必须手点的人工验收项”，避免以后只看一个测试文件就误判完成
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` §8

- [ ] 5.2 最终检查：禁用 provider 真的能全链路收口
  - 状态：IN_REVIEW
  - 这一步到底做什么：按真实使用路径逐项验，确认这次不是“设置页看起来对了，其他地方继续漏”。
  - 做完你能看到什么：可以正式说 provider 启用控制已经落地。
  - 先依赖什么：5.1
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：相关实现、测试和验收记录
  - 这一步先不做什么：不追加新 provider 接入需求。
  - 怎么算完成：
    1. 设置页、会话主链路、Skill、Butler 都通过回归
    2. disabled provider 不再出现在正常入口
    3. 重新启用后旧会话可恢复
  - 怎么验证：
    - 自动化测试
    - 手工验收
  - 当前进展：
    - 已新增 `docs/20260426-provider启用控制验收记录.md`
    - 已完成阶段 4 相关前端自动化回归：
      - `pnpm --filter user-app exec vitest run src/settings/ProviderManagementPanel.test.tsx src/features/settings/pages/SettingsPage.test.tsx src/features/conversation/components/SessionProviderPicker.test.tsx src/features/conversation/components/ConversationSelectionActions.test.tsx src/features/conversation/components/ParallelSessionCreateModal.test.tsx src/features/conversation/components/ComposerPanel.test.tsx`
    - 已在这轮 UI 调整后重新跑通同一组前端自动化回归，确认“能力管理”合并、provider 模态框和矩阵改版没有把已有门禁逻辑打回去
    - 真实界面手工验收还没做；按项目规则，本轮没有主动启动前后端服务，所以这一步暂时停在 `IN_REVIEW`
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
