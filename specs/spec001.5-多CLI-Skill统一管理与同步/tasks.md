# 任务清单 - spec001.5-多CLI-Skill统一管理与同步（人话版）

状态：Draft

## 2026-04-14 立项补记

- 已确认本 Spec 的核心目标是统一本地 skill 管理，不是做 Skill 市场。
- 已确认第一阶段只处理“读本地目录、纳管、同步、为指定 CLI 添加”，不接远端仓库。
- 已确认前端入口第一阶段只放在设置页下，不新增工作台顶级导航。
- 已确认当前仓库里最需要被替换的是 Butler 中 Codex 专用的 `codingns-assistant` skill 复制硬编码。
- 已完成本子 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化。

## 2026-04-14 实施进展

- 已新增受管 skill 领域类型：
  - `ManagedSkillRecord`
  - `SkillTargetBindingRecord`
  - `SkillSourceType`
  - `ManagedSkillState`
  - `SkillTargetCli`
  - `SkillTargetSyncStatus`
- 已在 Host SQLite 模式里新增两张表：
  - `managed_skills`
  - `skill_target_bindings`
- 已补两个基础仓储：
  - `ManagedSkillRepository`
  - `SkillTargetBindingRepository`
- 已新增第一版目标适配器：
  - `ClaudeCodeSkillTargetAdapter`
  - `CodexSkillTargetAdapter`
  - `GeminiSkillTargetAdapter`
  - `OpenCodeSkillTargetAdapter`
- 已补集成测试：
  - `apps/host/tests/integration/skill-management-repositories.test.ts`
  - `apps/host/tests/integration/skill-target-adapters.test.ts`
- 已补扫描与对账主链路：
  - `apps/host/src/modules/skills/skill-manager-service.ts`
  - `apps/host/src/modules/skills/skill-reconciler.ts`
- 已补新增与单目标同步主链路：
  - `apps/host/src/modules/skills/skill-sync-planner.ts`
  - `apps/host/src/modules/skills/skill-manager-service.ts`
- 已补扫描相关领域类型：
  - `SkillScanEntry`
  - `SkillScanDiagnostic`
  - `SkillScanResult`
- 已补扫描集成测试：
  - `apps/host/tests/integration/skill-scan-service.test.ts`
- 已补新增与同步集成测试：
  - `apps/host/tests/integration/skill-add-service.test.ts`
- 已补未纳管导入主链路：
  - `apps/host/src/modules/skills/skill-manager-service.ts`
- 已补未纳管导入集成测试：
  - `apps/host/tests/integration/skill-import-service.test.ts`
- 已补 Host Skill API 入口：
  - `apps/host/src/modules/skills/skill-controller.ts`
  - `apps/host/src/routes/skills.ts`
  - `apps/host/src/server/create-server.ts`
- 已补 `codingns skills` CLI 入口：
  - `packages/codingns/bin/codingns.mjs`
- 已补 Skill API 集成测试：
  - `apps/host/tests/integration/skill-routes.test.ts`
- 已验证：
  - `pnpm --dir apps/host test -- skill-management-repositories.test.ts`
  - `pnpm --dir apps/host test -- skill-target-adapters.test.ts`
  - `pnpm --dir apps/host test -- skill-management-repositories.test.ts skill-target-adapters.test.ts skill-scan-service.test.ts`
  - `pnpm --dir apps/host test -- skill-add-service.test.ts skill-scan-service.test.ts skill-management-repositories.test.ts skill-target-adapters.test.ts`
  - `pnpm --dir apps/host test -- skill-import-service.test.ts skill-add-service.test.ts skill-scan-service.test.ts skill-management-repositories.test.ts skill-target-adapters.test.ts`
  - `pnpm --dir apps/host test -- skill-routes.test.ts skill-import-service.test.ts skill-add-service.test.ts skill-scan-service.test.ts skill-management-repositories.test.ts skill-target-adapters.test.ts`
  - `pnpm --dir apps/host test -- sqlite-bootstrap.test.ts`
  - `pnpm --dir apps/host build`
  - `node packages/codingns/bin/codingns.mjs skills --help`
  - `node packages/codingns/bin/codingns.mjs skills add --help`
- 构建过程中顺手清掉一个旧的 TypeScript 历史问题：
  - `apps/host/src/modules/tailscale/tailscale-helper-client.ts`
  - `apps/host/src/modules/tailscale/tailscale-manager.ts`

## 这份文档是干什么的

这份任务清单不是为了列一堆抽象词。

它只回答这些问题：

- 先把哪层立起来
- 哪一步是在补统一模型，哪一步是在替换旧逻辑
- 每一步主要改哪里
- 做完以后怎么确认不是假完成

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，等复核
- `DONE`：已经完成，并已回写本文档
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每做完一个任务，必须立刻回写这里

## 阶段 1：先把统一模型和边界钉死

- [x] 1.1 建 `SkillManager` 的最小数据模型
  - 状态：DONE
  - 这一步到底做什么：把受管 skill、目标绑定、扫描结果这三类对象的字段、状态和持久化边界定下来。
  - 做完你能看到什么：后面写扫描、导入、同步时，不再边写边猜字段。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 4
    - `design.md` §2.1「系统结构」
    - `design.md` §3.2「数据结构」
  - 主要改哪里：
    - `apps/host/src/modules/skills/`
    - `apps/host/src/storage/`
  - 这一步先不做什么：先不接 Butler，不先做 CLI 页面。
  - 怎么算完成：
    1. 已有受管 skill 记录和目标绑定模型
    2. 已有最小仓储接口或表结构草案
  - 怎么验证：
    - `pnpm --dir apps/host test -- skill-management-repositories.test.ts`
    - `pnpm --dir apps/host test -- sqlite-bootstrap.test.ts`
    - `pnpm --dir apps/host build`
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 4
  - 对应设计：`design.md` §2.1、§3.2、§4.1

- [x] 1.2 建各 CLI 的 `SkillTargetAdapter`
  - 状态：DONE
  - 这一步到底做什么：把 `codex`、`claude-code`、`gemini`、`opencode` 的 skill 根目录解析逻辑收口成统一适配器。
  - 做完你能看到什么：主流程里不再散落每个 CLI 的目录判断。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 5
    - `design.md` §2.2「模块职责」
    - `design.md` §3.1「核心组件」
  - 主要改哪里：
    - `apps/host/src/modules/skills/skill-target-adapters/`
  - 这一步先不做什么：先不写同步，不先写 API。
  - 怎么算完成：
    1. 每个目标 CLI 都能给出 skill 根目录
    2. 未受支持目标会返回统一错误
  - 怎么验证：
    - `pnpm --dir apps/host test -- skill-target-adapters.test.ts`
    - `pnpm --dir apps/host build`
  - 对应需求：`requirements.md` 需求 1、需求 5
  - 对应设计：`design.md` §2.2、§3.1、§3.3

### 阶段检查

- [x] 1.3 检查统一模型是不是站稳了
  - 状态：DONE
  - 这一步到底做什么：确认后续扫描、导入、同步都能基于前面这套模型往下做，而不是再推翻一次。
  - 做完你能看到什么：下一阶段可以开始写真实行为，不会中途返工数据模型。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不扩新范围。
  - 怎么算完成：
    1. 数据模型和目标适配器已能支撑后续主流程
    2. 已知缺口已经记清楚
  - 怎么验证：
    - 人工走查
    - `pnpm --dir apps/host build`
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 5
  - 对应设计：`design.md` §2、§3、§4

## 阶段 2：把扫描、导入、同步主链路做出来

- [x] 2.1 落本地扫描与未纳管识别
  - 状态：DONE
  - 这一步到底做什么：实现扫描各 CLI skill 目录、识别 `managed/unmanaged/conflicted` 结果的主链路。
  - 做完你能看到什么：系统第一次能清楚回答“这台机器现在到底有哪些 skill”。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 4
    - `design.md` §2.3.1「本地扫描流程」
    - `design.md` §3.3.1「scanSkills()」
  - 主要改哪里：
    - `apps/host/src/modules/skills/skill-manager-service.ts`
    - `apps/host/src/modules/skills/skill-reconciler.ts`
  - 这一步先不做什么：先不替换 Butler。
  - 怎么算完成：
    1. 能返回受管、未纳管、冲突和诊断四类结果
    2. 缺目录或读失败不会把全部扫描打死
  - 怎么验证：
    - 集成测试
    - 临时目录回放
    - `pnpm --dir apps/host test -- skill-scan-service.test.ts`
    - `pnpm --dir apps/host build`
  - 对应需求：`requirements.md` 需求 1、需求 4
  - 对应设计：`design.md` §2.3.1、§3.3.1、§4.2

- [x] 2.2 落新增 skill 与单目标同步
  - 状态：DONE
  - 这一步到底做什么：实现从本地目录纳入管理、写入 SSOT、同步到指定 CLI 的主链路。
  - 做完你能看到什么：维护者可以正式为某个 CLI 添加新 skill，不再手工复制目录。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` §2.3.2「新增 skill 流程」
    - `design.md` §3.3.2「addManagedSkill()」
  - 主要改哪里：
    - `apps/host/src/modules/skills/skill-manager-service.ts`
    - `apps/host/src/modules/skills/skill-sync-planner.ts`
  - 这一步先不做什么：不做批量市场安装，不做在线编辑。
  - 怎么算完成：
    1. 可以把合法目录加入 SSOT
    2. 可以只同步到用户指定的目标 CLI
    3. 同名不同内容会明确报冲突
  - 怎么验证：
    - 单元测试
    - 多目标目录集成测试
    - `pnpm --dir apps/host test -- skill-add-service.test.ts`
    - `pnpm --dir apps/host build`
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §2.3.2、§3.3.2、§6.2

- [x] 2.3 落未纳管导入与冲突分支
  - 状态：DONE
  - 这一步到底做什么：实现从现有 CLI 目录导入未纳管 skill，并把同名不同内容的情况拦下来。
  - 做完你能看到什么：老机器上的 skill 可以被纳入统一管理，不需要从头重建。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3.3「导入未纳管 skill 流程」
    - `design.md` §6.3「同名不同内容不能自动合并」
  - 主要改哪里：
    - `apps/host/src/modules/skills/skill-manager-service.ts`
    - `apps/host/src/modules/skills/skill-reconciler.ts`
  - 这一步先不做什么：先不接前端页面。
  - 怎么算完成：
    1. 可以导入未纳管 skill
    2. 多来源同名冲突时不会自动覆盖
  - 怎么验证：
    - 集成测试
    - 冲突回放测试
    - `pnpm --dir apps/host test -- skill-import-service.test.ts`
    - `pnpm --dir apps/host build`
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §2.3.3、§6.3

### 阶段检查

- [x] 2.4 检查主链路是不是已经跑通
  - 状态：DONE
  - 这一步到底做什么：确认扫描、导入、添加、同步已经形成完整闭环。
  - 做完你能看到什么：后面接 Host API 和 Butler 时不是在接半成品。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不扩页面。
  - 怎么算完成：
    1. 本地扫描、新增、导入、同步都可验证
    2. 冲突和失败路径已能区分
  - 怎么验证：
    - 关键流程回放
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 4
  - 对应设计：`design.md` §2.3、§5、§6

## 阶段 3：接外部入口、补设置页入口并替换旧硬编码

- [x] 3.1 落 Host API 和 `codingns skills` CLI
  - 状态：DONE
  - 这一步到底做什么：给统一 skill 管理补最小对外入口，让外部不再直接调文件系统。
  - 做完你能看到什么：可以通过 API 或 CLI 扫描、导入、添加、同步 skill。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` §3.3「接口契约」
  - 主要改哪里：
    - `apps/host/src/modules/skills/`
    - `apps/host/src/routes/`
    - `packages/codingns/`
  - 这一步先不做什么：不做完整设置页。
  - 怎么算完成：
    1. 已有最小 HTTP 入口
    2. 已有 `codingns skills ...` 命令入口
  - 怎么验证：
    - API 集成测试
    - CLI 命令测试
    - `pnpm --dir apps/host test -- skill-routes.test.ts`
    - `node packages/codingns/bin/codingns.mjs skills --help`
    - `node packages/codingns/bin/codingns.mjs skills add --help`
  - 对应需求：`requirements.md` 需求 3、需求 4
  - 对应设计：`design.md` §3.3、§7.2

- [x] 3.2 在设置页挂最小 Skill 管理入口
  - 状态：DONE
  - 这一步到底做什么：复用现有 `/settings/:section` 结构，新增 `skills` 分段，展示 skill 概况、未纳管列表、最小导入和同步入口。
  - 做完你能看到什么：普通用户可以在设置页里看到并管理本机 skill，不需要先学 CLI 命令。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §2.3.5「前端入口流程」
    - `design.md` §3.3.8「设置页入口约定」
  - 主要改哪里：
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - `apps/user-app/src/app/router.tsx`
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步先不做什么：不做工作台顶级入口，不做 Skill 市场式页面。
  - 怎么算完成：
    1. 设置页里已有 Skill 分段入口
    2. 页面能展示 skill 概况、受管和未纳管结果
    3. 页面能触发最小导入和同步动作
  - 怎么验证：
    - `pnpm --dir apps/user-app test src/features/settings/pages/SettingsPage.test.tsx`
    - `pnpm --dir apps/user-app test src/settings/SkillManagementPanel.test.tsx`
    - 人工走查设置页桌面端与移动端入口
  - 对应需求：`requirements.md` 需求 6
  - 对应设计：`design.md` §2.3.5、§3.3.8、§6.4

- [x] 3.3 替换 Butler 里的 Codex 专用 skill 复制逻辑
  - 状态：DONE
  - 这一步到底做什么：把 `butler-control-session-service.ts` 里直接复制 `codingns-assistant` 目录的做法迁到统一 `SkillManager`。
  - 做完你能看到什么：Butler 不再知道 skill 目录细节，只表达“确保目标环境有这个 skill”。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.4「Butler 迁移流程」
  - 主要改哪里：
    - `apps/host/src/modules/butler/butler-control-session-service.ts`
    - `apps/host/tests/integration/butler-control-session-service.test.ts`
  - 这一步先不做什么：不重写 Butler 会话提示词主流程。
  - 怎么算完成：
    1. 旧的目录复制硬编码被移除或收口到统一服务
    2. Butler 集成测试仍然通过
  - 怎么验证：
    - `pnpm --dir apps/host test -- butler-control-session-service.test.ts`
    - `pnpm --dir apps/host build`
    - 人工走查 Butler 独立 Codex home 的 skill 来源已经改成 SSOT
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.4、§6.1

### 最终检查

- [ ] 3.4 最终检查点
  - 状态：TODO
  - 这一步到底做什么：确认这个 Spec 交付的是统一 skill 管理层，而不是几段新的复制脚本。
  - 做完你能看到什么：新增目标 CLI 时，主要扩展点清楚；现有单 CLI 硬编码已经收口。
  - 先依赖什么：3.1、3.2、3.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件和相关实现
  - 这一步先不做什么：不再追加 Skill 市场范围。
  - 怎么算完成：
    1. 需求、设计、任务、验证映射完整
    2. 旧硬编码已被统一入口替换
    3. 设置页入口已存在且没有污染工作台主流程
    4. 后续新增 CLI 不需要再改业务主流程
  - 怎么验证：
    - 按 Spec 验收清单逐项核对
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
