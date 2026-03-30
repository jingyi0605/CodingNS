# 任务清单 - spec001.1 账户偏好入库与跨客户端同步（人话版）

状态：In Progress

## 2026-03-30 进展补记

- 已确认这个子 Spec 只处理“账户偏好入库、跨客户端同步、账户偏好和设备配置分层”，不顺手扩成认证改造大杂烩
- 已确认首批迁到数据库的偏好是：`defaultPermissionMode`、`language`、`theme`、provider 默认模型、provider 默认推理等级
- 已确认继续保留本地的配置包括：`hostBaseUrl`、发布通道、自动重连、布局状态、草稿、终端恢复状态、认证令牌
- 已完成 `spec001.1` 主文档初始化，并回写 `spec001` 与 `specs/README.md` 的边界说明
- 已落地后端账户偏好 profile 接口与数据库表，并补了偏好接口集成测试
- 已落地前端账户偏好 store、shadow cache、legacy localStorage 回填、设置页接线、语言/主题接线、默认权限接线、Composer 默认模型/推理等级接线
- 已移除桌面端本地配置里的 `default_permission_mode`，避免数据库和桌面配置文件形成双真相
- 已通过前端类型检查、前端关键用例、`App.test.tsx`、登录页测试、后端偏好接口测试和前端生产构建

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并已回写
- `CANCELLED`：取消并写明原因

规则：

- 只有 `状态：DONE` 的任务才能勾成 `[x]`
- 每做完一个任务，都要立刻回写这份文档
- `BLOCKED` 和 `CANCELLED` 必须写清楚卡在哪、为什么不做

---

## 阶段 0：先把边界钉死，别一上来就边写边漂

- [x] 0.1 启动 spec001.1 并完成文档骨架
  - 状态：DONE
  - 这一做到底做什么：建立 `spec001.1` 目录和主文档，把目标、范围、边界先写清楚
  - 做完以后能看到什么结果：仓库里出现完整的 `spec001.1` 文档目录，别人打开就知道这次到底要改什么
  - 依赖什么：无
  - 主要改哪些文件：
    - `specs/spec001.1-账户偏好入库与跨客户端同步/*`
  - 这一步先不做什么：不改业务代码
  - 怎么验证：
    - 文档走查

- [x] 0.2 回写父规格和总览，说明 `spec001.1` 负责什么
  - 状态：DONE
  - 这一做到底做什么：把 `spec001` 和 `specs/README.md` 补上子规格边界，避免后面重复造轮子
  - 做完以后能看到什么结果：`spec001` 和总览里都能看到 `spec001.1` 的职责说明
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/design.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
  - 这一步先不做什么：不修改 `spec001` 的原始需求边界
  - 怎么验证：
    - 文档走查

---

## 阶段 1：先把后端真相源建出来

- [x] 1.1 新增账户偏好表和仓储
  - 状态：DONE
  - 这一做到底做什么：在 SQLite 里新增账户偏好持久化表和 repository，承载语言、主题、默认权限以及 provider 默认项
  - 做完以后能看到什么结果：Host 可以把账户偏好稳定读写到数据库
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/repositories/user-preference-profile-repository.ts`
    - `apps/host/src/types/domain.ts`
  - 这一步先不做什么：不接前端 UI
  - 怎么算完成：
    1. 数据表已创建
    2. repository 能读写 profile
    3. provider 默认项可持久化
  - 怎么验证：
    - `pnpm.cmd --dir apps/host exec vitest run tests/integration/preferences-profile.test.ts`

- [x] 1.2 提供账户偏好 profile 接口
  - 状态：DONE
  - 这一做到底做什么：新增 `GET/PUT /api/preferences/profile`
  - 做完以后能看到什么结果：已登录客户端可读取和保存账户偏好 profile
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/modules/preferences/profile-controller.ts`
    - `apps/host/src/modules/preferences/profile-service.ts`
    - `apps/host/src/routes/preferences.ts`
    - `apps/host/src/server/create-server.ts`
  - 这一步先不做什么：不做前端 store 分层
  - 怎么算完成：
    1. 接口返回稳定结构
    2. 支持部分 patch
    3. 非法枚举值会被拒绝
  - 怎么验证：
    - `pnpm.cmd --dir apps/host exec vitest run tests/integration/preferences-profile.test.ts`

- [x] 1.3 阶段检查：后端真相源站稳了没有
  - 状态：DONE
  - 这一做到底做什么：确认后端已经能单独承载账户偏好，不需要前端再去猜结构
  - 做完以后能看到什么结果：前端拿到的是清晰的 profile，而不是到处判空的散装字段
  - 依赖什么：1.1、1.2
  - 主要改哪些文件：
    - `apps/host/tests/integration/preferences-profile.test.ts`
  - 这一步先不做什么：不扩数据库范围
  - 怎么验证：
    - `pnpm.cmd --dir apps/host exec tsc --noEmit`
    - `pnpm.cmd --dir apps/host exec vitest run tests/integration/preferences-profile.test.ts`

---

## 阶段 2：把前端状态拆干净，不再把人和设备混在一起

- [x] 2.1 拆出账户偏好 store 和设备配置兼容层
  - 状态：DONE
  - 这一做到底做什么：新增账户偏好 store，用 shadow cache 和 legacy fallback 托底；设备配置继续保留在 `clientConfigStore`
  - 做完以后能看到什么结果：语言、主题、默认权限和 provider 默认项有了独立状态源，不再只挂在设备配置上
  - 依赖什么：1.3
  - 主要改哪些文件：
    - `apps/user-app/src/preferences/types.ts`
    - `apps/user-app/src/preferences/preferences-service.ts`
    - `apps/user-app/src/preferences/user-preference-store.ts`
    - `apps/user-app/src/preferences/preferences-store.ts`
    - `apps/user-app/src/bootstrap/bootstrap-app.ts`
  - 这一步先不做什么：不删除所有 legacy key，只进入兼容期
  - 怎么验证：
    - `pnpm.cmd --dir apps/user-app exec tsc --noEmit`

- [x] 2.2 接入语言、主题和默认会话权限
  - 状态：DONE
  - 这一做到底做什么：让 App、ThemeProvider、i18n、设置页、对话发送链路都改用账户偏好
  - 做完以后能看到什么结果：语言、主题和默认权限跟账号同步，设置页里服务器地址仍然独立保存
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/user-app/src/app/App.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/shared/i18n/LanguageSwitcher.tsx`
    - `apps/user-app/src/shared/theme/theme.ts`
    - `apps/user-app/src/shared/theme/ThemeProvider.tsx`
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
    - `apps/user-app/src/features/auth/pages/LoginPage.tsx`
  - 这一步先不做什么：不改 provider 权限语义
  - 怎么验证：
    - `pnpm.cmd --dir apps/user-app exec vitest run src/shared/i18n/index.test.ts src/features/settings/pages/SettingsPage.test.tsx src/features/conversation/runtime/session-runtime-store.test.ts`

- [x] 2.3 接入 provider 默认模型和推理等级
  - 状态：DONE
  - 这一做到底做什么：把 Composer 的默认模型和默认推理等级从本地键切到账户偏好
  - 做完以后能看到什么结果：同一账号切客户端后，Codex / Claude / OpenCode 的默认项能跟着走
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
    - `apps/user-app/src/preferences/*`
  - 这一步先不做什么：不扩到 provider capabilities 协议层
  - 怎么验证：
    - `pnpm.cmd --dir apps/user-app exec vitest run src/features/conversation/components/ComposerPanel.test.tsx`

- [x] 2.4 阶段检查：前端分层有没有重新长歪
  - 状态：DONE
  - 这一做到底做什么：确认设置来源、保存去向、回退优先级都已经稳定
  - 做完以后能看到什么结果：前端不再把账户偏好混进设备配置主链路
  - 依赖什么：2.1、2.2、2.3
  - 主要改哪些文件：
    - `apps/user-app/src/test/setup.ts`
    - `apps/user-app/src/shared/i18n/index.test.ts`
    - `apps/user-app/src/features/settings/pages/SettingsPage.test.tsx`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.test.ts`
  - 这一步先不做什么：不扩更多同步字段
  - 怎么验证：
    - `pnpm.cmd --dir apps/user-app exec tsc --noEmit`
    - `pnpm.cmd --dir apps/user-app exec vitest run src/shared/i18n/index.test.ts src/features/settings/pages/SettingsPage.test.tsx src/features/conversation/runtime/session-runtime-store.test.ts src/features/conversation/components/ComposerPanel.test.tsx`

---

## 阶段 3：把旧数据迁过去，再做跨客户端验证

- [x] 3.1 实现 legacy localStorage 回填和 shadow cache
  - 状态：DONE
  - 这一做到底做什么：把旧本地键变成迁移输入，同时保留 shadow cache 作为冷启动和未登录场景回退
  - 做完以后能看到什么结果：老用户升级后不用重配，登录前也能切语言和主题
  - 依赖什么：2.4
  - 主要改哪些文件：
    - `apps/user-app/src/preferences/user-preference-store.ts`
    - `apps/user-app/src/features/auth/pages/LoginPage.tsx`
  - 这一步先不做什么：不删除所有 legacy key
  - 怎么验证：
    - `pnpm.cmd --dir apps/user-app exec tsc --noEmit`
    - `pnpm.cmd --dir apps/user-app exec vitest run src/shared/i18n/index.test.ts src/features/settings/pages/SettingsPage.test.tsx`

- [x] 3.2 明确本地保留清单并收口旧写入点
  - 状态：DONE
  - 这一做到底做什么：收口主题和默认权限的旧本地写入主链路，并把桌面端本地配置改回纯设备配置
  - 做完以后能看到什么结果：数据库、shadow cache 和设备配置的职责不再混成一团
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/user-app/src/shared/theme/theme.ts`
    - `apps/user-app/src-tauri/src/config.rs`
    - `apps/desktop/src-tauri/src/config.rs`
  - 这一步先不做什么：不处理“记住密码改系统凭据库”
  - 怎么验证：
    - `pnpm.cmd --dir apps/user-app build`

- [ ] 3.3 跨客户端回归和最终验收
  - 状态：IN_REVIEW
  - 这一做到底做什么：确认这次改动不仅测试通过，而且真实跨客户端链路可用
  - 做完以后能看到什么结果：桌面端和 Web 端用同一账号时，默认权限、语言、主题、provider 默认项保持一致
  - 依赖什么：3.1、3.2
  - 主要改哪些文件：
    - 测试与验证记录
  - 这一步先不做什么：不扩更多偏好字段
  - 当前结果：
    1. 已完成后端偏好接口集成测试
    2. 已完成前端关键用例和生产构建
    3. 还缺真实多客户端人工走查记录
  - 怎么验证：
    - 已完成：
      - `pnpm.cmd --dir apps/host exec vitest run tests/integration/preferences-profile.test.ts`
      - `pnpm.cmd --dir apps/host exec tsc --noEmit`
      - `pnpm.cmd --dir apps/user-app exec tsc --noEmit`
      - `pnpm.cmd --dir apps/user-app exec vitest run src/shared/i18n/index.test.ts src/features/settings/pages/SettingsPage.test.tsx src/features/conversation/runtime/session-runtime-store.test.ts src/features/conversation/components/ComposerPanel.test.tsx`
      - `pnpm.cmd --dir apps/user-app exec vitest run src/features/auth/pages/LoginPage.test.tsx`
      - `pnpm.cmd --dir apps/user-app exec vitest run src/app/App.test.tsx`
      - `pnpm.cmd --dir apps/user-app build`
    - 待补：
      - 桌面端与 Web 端人工双客户端走查
