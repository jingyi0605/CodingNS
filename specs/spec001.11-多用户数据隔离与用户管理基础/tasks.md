# 任务清单 - 多用户数据隔离与用户管理基础（人话版）

状态：DONE

## 这份文档是干什么的

这份任务清单就是把“多用户隔离”拆成能一段一段落地的事，避免边改边散。

重点不是讲概念，而是让人一眼知道：

- 先补哪层
- 哪些表必须先动
- 哪些地方最容易串数据
- 每一步做完怎么验

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

---

## 阶段 1：先把归属模型和迁移地基立住

- [x] 1.1 梳理核心对象归属并补数据库设计
  - 状态：DONE
  - 本轮结果：已经给 `auth_users.status`、`workspaces.owner_user_id`、`session_bindings.user_id`、`butler_profiles.user_id`、`butler_projects.user_id`、`butler_sessions.user_id`、`butler_control_sessions.user_id` 补了 schema、索引和旧库迁移；旧数据会挂到历史默认用户，避免升级后丢数据。
  - 这一步到底做什么：把工作区、会话、Butler、后台任务这些核心对象分清楚哪些是用户私有，哪些还能继续实例共享，然后把数据库字段和索引方案定下来。
  - 做完你能看到什么：关键表的新增字段、唯一约束、迁移方向都定清楚了，后面不会一边写代码一边猜数据该挂谁名下。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3、需求 5
    - `design.md` §3.2「数据结构」
    - `design.md` §4.1「数据关系」
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/sqlite/client.ts`
    - 相关 repository 的建模代码
  - 这一步先不做什么：先不改前端页面，不急着补完整用户管理 UI。
  - 怎么算完成：
    1. `workspaces`、`session_bindings`、`butler_*` 等关键表的归属字段设计明确
    2. 迁移时旧数据挂到哪个用户、失败时怎么停住写清楚
  - 怎么验证：
    - 人工走查 `schema.sql`
    - 最小必要的 SQLite 迁移测试
  - 本轮验证：
    - `python3` 超时包装执行 `pnpm --dir apps/host exec vitest run tests/integration/sqlite-bootstrap.test.ts -t 可以给旧工作区表补 owner_user_id 并完成启动`
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 5
  - 对应设计：`design.md` §3.2、§4.1、§5.3

- [x] 1.2 建用户管理后端基础接口
  - 状态：DONE
  - 本轮结果：后端已经补了用户列表、创建、编辑、删除未使用用户、启用、禁用和使用详情接口；停用用户会撤销登录态，删除用户只允许未产生业务数据的新用户，避免误删工作区和会话。
  - 这一步到底做什么：补管理员创建用户、查看用户、停用用户登录态这些基础后端能力。
  - 做完你能看到什么：系统不再只能靠首次初始化那个账号硬撑，管理员能正式管理第二个、第三个用户。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.3.1「新用户创建与登录」
    - `design.md` §3.3.1「用户管理接口」
  - 主要改哪里：
    - `apps/host/src/modules/auth/*`
    - `apps/host/src/routes/auth.ts`
    - 用户相关 repository
  - 这一步先不做什么：先不做复杂角色体系和组织管理。
  - 怎么算完成：
    1. 管理员可以创建新用户
    2. 管理员可以查看用户列表并让某个用户现有登录态失效
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/integration/auth-user-management.test.ts`
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.3.1、§3.3.1、§5.1

### 阶段检查

- [x] 1.3 阶段 1 检查点：归属口径统一
  - 状态：DONE
  - 本轮结果：工作区、会话、Butler 主表都已经有明确用户归属；后台链路不能再退回“第一个用户”。
  - 这一步到底做什么：检查“这条数据到底归谁”这件事是不是已经说清楚，不再让后续任务各改各的。
  - 做完你能看到什么：后续改代码时不会再反复争论某张表到底是共享还是私有。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关文档和 schema 设计
  - 这一步先不做什么：不扩到团队协作权限。
  - 怎么算完成：
    1. 关键对象归属表已经列清楚
    2. 用户管理后端基础入口已经有明确方案
  - 怎么验证：
    - 人工走查
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 5
  - 对应设计：`design.md` §2、§3、§4

---

## 阶段 2：改核心后端，让工作区、会话、Butler 真正隔开

- [x] 2.1 改工作区查询和写入归属
  - 状态：DONE
  - 本轮结果：普通工作区接口和 assistant 工作区接口都改为按当前 `userId` 读取、导入、克隆、重排、删除和读取管理详情；内部旧方法保留给后台链路，避免一次性打断现有任务。
  - 这一步到底做什么：把工作区从“全局列表”改成“按当前用户读取和创建”，并给相关接口补无权限处理。
  - 做完你能看到什么：第二个用户登录后，不会再自动看到第一个用户的工作区。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.3.2「用户读取工作区与会话」
    - `design.md` §4.1「数据关系」
  - 主要改哪里：
    - `apps/host/src/modules/workspace/*`
    - `apps/host/src/storage/repositories/workspace-repository.ts`
    - `apps/host/src/routes/workspaces.ts`
  - 这一步先不做什么：先不做工作区共享成员模型。
  - 怎么算完成：
    1. 工作区列表、详情、导入、创建、克隆都带用户归属
    2. 无权限用户访问别人的工作区会被拦住
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/integration/workspace-user-scope.test.ts`
  - 本轮验证：
    - `python3` 超时包装执行 `pnpm --dir apps/host exec vitest run tests/integration/workspace-management.test.ts tests/integration/sqlite-bootstrap.test.ts`
    - `python3` 超时包装执行 `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `python3` 超时包装执行 `pnpm check:sqlite-runtime`
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §2.3.2、§3.2、§4.1

- [x] 2.2 改会话核心归属和读取校验
  - 状态：DONE
  - 本轮结果：`session_bindings.user_id` 已写入并用于会话查询；会话能力、续接、发送、分叉、权限请求主链路都按当前用户收口。
  - 这一步到底做什么：给 `session_bindings` 和相关核心表补用户归属，并把会话读取、续接、分叉、权限请求这些链路按用户收口。
  - 做完你能看到什么：会话不再只是“显示状态按用户分”，而是底层绑定也属于明确用户。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` §3.2「关键表改造」
    - `design.md` §6.1、§6.2「正确性属性」
  - 主要改哪里：
    - `apps/host/src/modules/sessions/*`
    - `apps/host/src/storage/repositories/session-*.ts`
    - `apps/host/src/routes/sessions.ts`
  - 这一步先不做什么：先不处理所有历史边缘会话表的彻底重构，先保主链路。
  - 怎么算完成：
    1. 会话创建、读取、续接、分叉主链路带用户归属
    2. 访问非本用户会话时会被拒绝
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/integration/session-user-scope.test.ts`
  - 本轮验证：
    - `python3` 超时包装执行 `pnpm --dir apps/host exec vitest run tests/integration/session-user-scope.test.ts`
    - `python3` 超时包装执行 `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - 对应需求：`requirements.md` 需求 3、需求 4
  - 对应设计：`design.md` §3.2、§3.3、§4.1、§6.1、§6.2

- [x] 2.3 改 Butler 归属，去掉全局默认对象
  - 状态：DONE
  - 本轮结果：Butler profile、project、session、control session 都补了 `user_id`，仓库和主服务按 userId 读写；旧的 `id = default` profile 会迁到 `default:<userId>`。
  - 这一步到底做什么：把 Butler profile、project、session、control session 从“全局默认一份”改成按用户独立。
  - 做完你能看到什么：每个用户只能看到自己的 Butler 数据，不会共用一个 `default` Butler 档案。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §3.2「关键表改造」
    - `design.md` §4.1「数据关系」
  - 主要改哪里：
    - `apps/host/src/modules/butler/*`
    - `apps/host/src/storage/repositories/butler-*.ts`
    - 相关 Butler 路由
  - 这一步先不做什么：先不扩新 Butler 功能。
  - 怎么算完成：
    1. Butler 核心表能按用户读写
    2. 旧的全局默认 Butler 逻辑被替换掉
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/integration/butler-user-scope.test.ts`
  - 本轮验证：
    - `python3` 超时包装执行 `pnpm --dir apps/host exec vitest run tests/integration/butler-user-scope.test.ts`
    - `python3` 超时包装执行 `pnpm --dir apps/host exec vitest run tests/integration/sqlite-bootstrap.test.ts -t 可以把旧 Butler 全局表挂到历史默认用户并完成启动`
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §3.2、§4.1、§6.1

### 阶段检查

- [x] 2.4 阶段 2 检查点：核心资源主链路已隔离
  - 状态：DONE
  - 本轮结果：工作区、会话、Butler 主链路都已有最小集成测试覆盖；assistant 能力入口和 workbench 也按当前用户收口。
  - 这一步到底做什么：检查工作区、会话、Butler 这三条最关键主链路是不是都已经真正按用户隔开。
  - 做完你能看到什么：项目最容易串数据的地方已经被收住，不再只是文档上说支持多用户。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关后端代码和测试
  - 这一步先不做什么：不继续扩外部平台细节功能。
  - 怎么算完成：
    1. 两个用户互相看不到对方工作区和会话
    2. Butler 主链路已经按用户隔离
  - 怎么验证：
    - 关键集成测试
    - 人工走查主要接口
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §2.3.2、§3.2、§4.1、§6.1

---

## 阶段 3：补后台任务、前端入口和迁移验收

- [x] 3.1 清理后台任务里的单用户假设
  - 状态：DONE
  - 本轮结果：正式代码里 `listIds()[0]` 的默认用户假设已清掉；权限请求从 binding/workspace owner 推断用户，Butler 后台摘要逐个用户处理。
  - 这一步到底做什么：把 `listIds()[0]` 这类“默认第一个用户”的实现全部清掉，让后台刷新、权限请求、运行态恢复都显式带 `userId`。
  - 做完你能看到什么：后台不会再偷偷把数据写到错误用户名下。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3.3「后台任务执行」
    - `design.md` §6.2「后台任务不会偷偷退回第一个用户」
    - `specs/spec001.2-后端任务调度与主线程压力治理/20260412-后台任务接入规范.md`
  - 主要改哪里：
    - `apps/host/src/modules/sessions/*`
    - `apps/host/src/modules/butler/*`
    - `apps/host/src/server/*`
  - 这一步先不做什么：不新长私有调度器，严格复用 `TaskManager`。
  - 怎么算完成：
    1. 关键后台链路不再依赖默认用户
    2. 缺少用户上下文时会明确失败
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/integration/background-user-scope.test.ts`
  - 本轮验证：
    - `rg "listIds\(\)\[0\]|authUserRepository\.listIds\(\)\[0\]" apps/host/src -n` 无结果
    - `python3` 超时包装执行 `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §2.3.3、§5.3、§6.2

- [x] 3.2 补前端用户管理入口和最小交互
  - 状态：DONE
  - 本轮结果：已在设置页「安全与隐私」加入用户管理入口；模态框使用统一 `DesktopModal` / `MobileSheet`，包含「用户列表」和「使用详情」两个标签页。用户列表支持查看、添加、编辑、删除未使用用户、启用和禁用；使用详情按天/周/月展示用户会话数、Token 图表、模型、CLI 提供商和模型供应商统计。当前 Host 还没有真实 Token 用量落库，所以界面明确提示 Token 暂无记录，不造假数据。
  - 这一步到底做什么：在 `user-app` 里补一个可用的用户管理入口，让管理员能创建、查看和管理用户。
  - 做完你能看到什么：这次改造不是只有后端能力，管理员能真的操作第二个用户，并能查看每个用户的基础使用情况。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §3.3.1「用户管理接口」
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
  - 主要改哪里：
    - `apps/user-app/src/features/*`
    - `apps/user-app/src/i18n/*`
    - 相关前端路由与 API 封装
  - 这一步先不做什么：先不做复杂角色权限后台页面。
  - 怎么算完成：
    1. 管理员能看到用户列表
    2. 管理员能添加、编辑、启用、禁用和删除未使用用户
    3. 管理员能按天、周、月查看每个用户的会话和使用详情
  - 怎么验证：
    - `python3` 超时包装执行 `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
    - `python3` 超时包装执行 `pnpm --dir apps/user-app test -- src/features/settings/pages/SettingsPage.test.tsx src/settings/AuthDeviceManagementPanel.test.tsx`
    - `python3` 超时包装执行 `pnpm --dir apps/host exec vitest run tests/integration/auth-user-management.test.ts --testTimeout 20000`
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §3.3.1、§7.3

- [x] 3.3 做老数据迁移和回归验证
  - 状态：DONE
  - 本轮结果：旧工作区、会话绑定、Butler profile/project/session/control session 的归属迁移已有 SQLite 启动测试；前端入口和用户管理接口也已补齐，整体验收可闭合。
  - 这一步到底做什么：把旧实例里的全局数据迁到明确用户归属下，并验证升级后老数据还能继续用。
  - 做完你能看到什么：不是新装才支持多用户，老实例升级后也能稳住。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.4「老数据迁移」
    - `design.md` §6.3「迁移不会无声破坏旧数据」
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/*`
    - 迁移相关服务和测试
  - 这一步先不做什么：不顺手把所有非关键边角数据一起大迁移。
  - 怎么算完成：
    1. 旧实例升级后关键工作区、会话、Butler 数据可继续访问
    2. 迁移失败时会停住并给出可排查结果
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/integration/multi-user-migration.test.ts`
    - `pnpm check:sqlite-runtime`
  - 本轮验证：
    - `python3` 超时包装执行 `pnpm --dir apps/host exec vitest run tests/integration/sqlite-bootstrap.test.ts -t 可以把旧 Butler 全局表挂到历史默认用户并完成启动`
    - `python3` 超时包装执行 `pnpm check:sqlite-runtime`
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.4、§5.3、§6.3

### 最终检查

- [x] 3.4 最终检查点
  - 状态：DONE
  - 本轮结果：已完成多用户存储归属、工作区隔离、会话隔离、Butler 隔离、用户管理接口、设置页用户管理入口和最小回归验证。后续真正要补的是 Token 用量落库；这轮没有假装已有 Token 数据。
  - 这一步到底做什么：确认这次 Spec 真的把“多用户隔离基础”做到了，不是只把字段补了一半。
  - 做完你能看到什么：需求、设计、任务、测试和迁移证据能对得上。
  - 先依赖什么：3.1、3.2、3.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件和相关验证记录
  - 这一步先不做什么：不再追加新范围，比如团队协作或组织系统。
  - 怎么算完成：
    1. 多用户主链路隔离已经可验证
    2. 风险和后续未做项已写清楚
    3. 接手的人能直接按任务继续做
  - 怎么验证：
    - `python3` 超时包装执行 `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `python3` 超时包装执行 `pnpm --dir apps/host exec vitest run tests/integration/auth-user-management.test.ts tests/integration/butler-user-scope.test.ts tests/integration/session-user-scope.test.ts tests/integration/sqlite-bootstrap.test.ts tests/integration/workspace-management.test.ts -t 支持编辑、删除未使用用户，并按用户返回会话使用详情|按当前用户隔离工作区列表和管理入口|可以把旧 Butler 全局表挂到历史默认用户并完成启动|会话绑定和列表按 user_id 隔离|Butler profile --testTimeout 20000`
    - `python3` 超时包装执行 `pnpm check:sqlite-runtime`
    - `python3` 超时包装执行 `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
    - `python3` 超时包装执行 `pnpm --dir apps/user-app test -- src/features/settings/pages/SettingsPage.test.tsx src/settings/AuthDeviceManagementPanel.test.tsx`
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
