# 任务清单 - spec001.1 账户偏好入库与跨客户端同步（人话版）

状态：Draft

## 2026-03-30 进展补记

- 已确认这个子 Spec 只处理“账户偏好入库、跨客户端同步、账户偏好和设备配置分层”，不顺手扩成认证改造大杂烩
- 已确认首批应该迁到数据库的偏好是：`defaultPermissionMode`、`language`、`theme`、provider 默认模型、provider 默认推理等级
- 已确认继续保留本地的配置包括：`hostBaseUrl`、更新通道、自动重连、布局状态、草稿、终端恢复状态、认证令牌
- 已完成本子 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md` 初始化
- 已回写 `spec001` 和 `specs/README.md`，补充 `spec001.1` 的边界说明

## 这份文档是干什么的

这份任务清单不是拿来堆术语的，是拿来让人直接开工的。

你打开任意一个任务，都应该能立刻看明白：

1. 这一步到底建什么
2. 做完以后能看到什么变化
3. 依赖什么
4. 主要改哪些文件
5. 这一步明确不做什么
6. 怎么验证不是假完成

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
  - 这一做到到底做什么：建立 `spec001.1` 目录和五份主文档，把目标、范围、边界先写清楚
  - 做完你能看到什么：仓库里出现完整的 `spec001.1` 文档目录，别人打开就知道这次到底要改什么
  - 先依赖什么：无
  - 开始前先看：
    - `spec001/README.md`
    - `specs/000-Spec规范/*`
  - 主要改哪里：
    - `specs/spec001.1-账户偏好入库与跨客户端同步/README.md`
    - `specs/spec001.1-账户偏好入库与跨客户端同步/requirements.md`
    - `specs/spec001.1-账户偏好入库与跨客户端同步/design.md`
    - `specs/spec001.1-账户偏好入库与跨客户端同步/tasks.md`
    - `specs/spec001.1-账户偏好入库与跨客户端同步/docs/README.md`
  - 这一先不做什么：先不改业务代码
  - 怎么算完成：
    1. 子 Spec 文档落盘
    2. 范围、依赖、非目标写清楚
  - 怎么验证：
    - 文档走查
  - 对应需求：`requirements.md` 全文
  - 对应设计：`design.md` 全文

- [x] 0.2 回写父规格和总览，说明 `spec001.1` 负责什么
  - 状态：DONE
  - 这一做到到底做什么：把 `spec001` 和 `specs/README.md` 补上子规格边界，避免后面重复造文档和重复争论范围
  - 做完你能看到什么：`spec001` 和总览文档里都能看到 `spec001.1` 的职责说明
  - 先依赖什么：0.1
  - 开始前先看：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/design.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
  - 主要改哪里：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/design.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
  - 这一先不做什么：不修改 `spec001` 的原始需求边界
  - 怎么算完成：
    1. 父 Spec 与子 Spec 的职责不再打架
    2. 总览里能找到 `spec001.1`
  - 怎么验证：
    - 文档走查
  - 对应需求：`requirements.md` 需求 2、需求 5
  - 对应设计：`design.md` 1.1、1.3、2.1

---

## 阶段 1：先把后端真相源建出来

- [ ] 1.1 新增账户偏好表和仓储
  - 状态：TODO
  - 这一做到到底做什么：在 SQLite 里新增用户通用偏好表和按 provider 的默认偏好表，并补齐 repository
  - 做完你能看到什么：数据库可以稳定保存 `defaultPermissionMode`、`language`、`theme`、默认模型和推理等级
  - 先依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3
    - `design.md` 2.2、3.2
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/repositories/user-quick-phrase-preference-repository.ts`
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/repositories/user-preference-repository.ts`
    - `apps/host/src/storage/repositories/user-provider-preference-repository.ts`
    - `apps/host/src/types/domain.ts`
  - 这一先不做什么：先不接前端，不做迁移逻辑
  - 怎么算完成：
    1. 新表结构和设计一致
    2. repository 能读写默认结构和 patch
    3. 字段枚举约束清楚
  - 怎么验证：
    - 仓储层单元测试
    - schema 走查
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3
  - 对应设计：`design.md` 2.2、3.2

- [ ] 1.2 提供账户偏好 profile 接口
  - 状态：TODO
  - 这一做到到底做什么：新增 `GET/PUT /api/preferences/profile`，把通用偏好和 provider 默认偏好统一挂到受保护接口
  - 做完你能看到什么：已登录客户端可以读取和保存完整账户偏好 profile
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3、需求 5
    - `design.md` 3.1、3.3、5.3
    - `apps/host/src/routes/preferences.ts`
  - 主要改哪里：
    - `apps/host/src/modules/preferences/preference-profile-controller.ts`
    - `apps/host/src/modules/preferences/preference-profile-service.ts`
    - `apps/host/src/routes/preferences.ts`
    - `apps/host/src/server/create-server.ts`
  - 这一先不做什么：先不做前端 store 拆分
  - 怎么算完成：
    1. 接口有稳定返回结构
    2. 非法枚举值会被拒绝
    3. 未登录访问被拒绝
  - 怎么验证：
    - 偏好接口集成测试
    - 非法输入和未授权回归测试
  - 对应需求：`requirements.md` 需求 1、需求 3、需求 5
  - 对应设计：`design.md` 3.1、3.3、5.1、5.3

- [ ] 1.3 阶段检查：后端真相源站稳了没有
  - 状态：TODO
  - 这一做到到底做什么：确认后端已经能单独承载账户偏好，不需要前端再去猜默认结构
  - 做完你能看到什么：前端后面接入时，拿到的是清晰的 profile，不是满屏 `null`
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关文档和测试说明
  - 这一先不做什么：不扩数据库范围
  - 怎么算完成：
    1. 默认结构明确
    2. 枚举校验明确
    3. provider 默认项结构明确
  - 怎么验证：
    - 人工走查
    - 接口测试结果核对
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3
  - 对应设计：`design.md` 2.1、3.2、3.3

---

## 阶段 2：把前端状态拆干净，不再把人和设备混在一起

- [ ] 2.1 拆出账户偏好 store 和设备配置 store
  - 状态：TODO
  - 这一做到到底做什么：把现在混在 `ClientRuntimeConfig` 里的账户偏好拆出去，明确保留哪些字段继续走设备级本地存储
  - 做完你能看到什么：`hostBaseUrl` 这类本地配置和 `defaultPermissionMode` 这类账户偏好不再混在一个 store 里
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 5
    - `design.md` 2.1、2.2、4.1
    - `apps/user-app/src/config/client-config-service.ts`
    - `apps/user-app/src/config/client-config-store.ts`
  - 主要改哪里：
    - `apps/user-app/src/config/*`
    - `apps/user-app/src/preferences/*`
    - `apps/user-app/src/bootstrap/bootstrap-app.ts`
  - 这一先不做什么：先不接设置页控件，不做 legacy migration
  - 怎么算完成：
    1. 设备级配置字段清单稳定
    2. 账户偏好字段清单稳定
    3. 启动链路能分别初始化两类状态
  - 怎么验证：
    - store 单元测试
    - 启动流程走查
  - 对应需求：`requirements.md` 需求 2、需求 5
  - 对应设计：`design.md` 2.1、2.2、4.1、4.2

- [ ] 2.2 接入语言、主题和默认会话权限
  - 状态：TODO
  - 这一做到到底做什么：让 App、ThemeProvider、设置页都改用账户偏好 store，默认会话权限发送链路也从账户偏好读取
  - 做完你能看到什么：语言、主题、默认会话权限会跟账号同步，不再只在当前设备生效
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3、需求 4
    - `design.md` 2.3.1、2.3.2、4.2、4.3
    - `apps/user-app/src/app/App.tsx`
    - `apps/user-app/src/shared/theme/*`
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
  - 主要改哪里：
    - `apps/user-app/src/app/App.tsx`
    - `apps/user-app/src/shared/theme/theme.ts`
    - `apps/user-app/src/shared/theme/ThemeProvider.tsx`
    - `apps/user-app/src/shared/i18n/LanguageSwitcher.tsx`
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
  - 这一先不做什么：先不接 provider 默认模型和推理等级
  - 怎么算完成：
    1. 语言和主题读取账户偏好
    2. 默认会话权限读取账户偏好
    3. 设备级配置仍可独立保存
  - 怎么验证：
    - 设置页交互测试
    - 发送链路回归测试
    - 首屏语言/主题回退测试
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 4
  - 对应设计：`design.md` 2.3、3.1、4.2、4.3、6.4

- [ ] 2.3 接入 provider 默认模型和推理等级
  - 状态：TODO
  - 这一做到到底做什么：把 `composer-selected-model:*` 和 `composer-reasoning-level:*` 改成账户偏好，并保持 provider 维度隔离
  - 做完你能看到什么：同一账号切客户端后，Codex/Claude/OpenCode 的默认模型和默认推理等级会跟着走
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` 2.3、3.2、3.3、4.2
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
    - `apps/user-app/src/preferences/*`
    - `apps/user-app/src/features/conversation/components/ComposerPanel.test.tsx`
  - 这一先不做什么：先不改 provider capabilities 协议
  - 怎么算完成：
    1. provider 默认模型和推理等级走账户偏好
    2. provider 无偏好时可安全回退
    3. 旧本地键只保留兼容读取
  - 怎么验证：
    - Composer 交互测试
    - 多 provider 回归测试
  - 对应需求：`requirements.md` 需求 3、需求 4
  - 对应设计：`design.md` 3.2、3.3、4.2、6.2

- [ ] 2.4 阶段检查：前端分层有没有重新长歪
  - 状态：TODO
  - 这一做到到底做什么：检查设置页、App 启动、发送链路是不是都已经按“账户偏好 / 设备配置”分开了
  - 做完你能看到什么：后面做迁移时不需要再返工 store 结构
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关代码和测试说明
  - 这一先不做什么：不再增加新同步字段
  - 怎么算完成：
    1. 前端没有继续用旧总配置对象承载账户偏好
    2. 设置来源和保存去向可追踪
    3. 本地保留项没有误入账户偏好 store
  - 怎么验证：
    - 人工代码走查
    - 关键测试清单核对
  - 对应需求：`requirements.md` 需求 2、需求 5
  - 对应设计：`design.md` 2.1、2.2、4.1、6.1

---

## 阶段 3：把旧数据迁过去，再做跨客户端验证

- [ ] 3.1 实现 legacy localStorage 回填和 shadow cache
  - 状态：TODO
  - 这一做到到底做什么：把旧本地键变成一次性迁移输入，同时保留 shadow cache 解决冷启动和离线回退
  - 做完你能看到什么：老用户升级后不用重配，新用户也不会因为接口失败突然丢设置
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` 2.3.4、3.2.3、4.3、5.3
    - 现有 localStorage 键清单
  - 主要改哪里：
    - `apps/user-app/src/preferences/*`
    - `apps/user-app/src/bootstrap/bootstrap-app.ts`
    - `apps/user-app/src/features/auth/pages/LoginPage.tsx`
  - 这一先不做什么：不删除所有 legacy key，只进入兼容期
  - 怎么算完成：
    1. 远端为空时能回填旧本地值
    2. 远端已有值时不会被旧值覆盖
    3. shadow cache 可用于失败回退
  - 怎么验证：
    - 迁移单元测试
    - 登录后首次升级回归测试
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` 2.3.4、3.2.3、4.3、5.3、6.3

- [ ] 3.2 明确本地保留清单并收口旧写入点
  - 状态：TODO
  - 这一做到到底做什么：把该留本地的键做成清单，并把账户偏好字段从旧本地写入路径里摘出去
  - 做完你能看到什么：不会再出现“数据库和 localStorage 同时各写一半”的脏状态
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 5
    - `design.md` 1.3、4.1、6.1
    - `apps/user-app/src/config/client-config-service.ts`
    - `apps/user-app/src/shared/theme/theme.ts`
  - 主要改哪里：
    - `apps/user-app/src/config/*`
    - `apps/user-app/src/shared/theme/*`
    - `docs/` 中的迁移说明
  - 这一先不做什么：不处理“记住密码改系统凭据库”
  - 怎么算完成：
    1. 账户级字段不再走旧本地持久化主链路
    2. 本地保留项有清单和理由
    3. 兼容期行为可解释
  - 怎么验证：
    - 本地键清单核对
    - 代码走查
  - 对应需求：`requirements.md` 需求 2、需求 5
  - 对应设计：`design.md` 1.3、4.1、6.1

- [ ] 3.3 跨客户端回归和最终验收
  - 状态：TODO
  - 这一做到到底做什么：验证桌面端、Web 端、必要时移动端之间的账户偏好同步，确认默认权限和其他首批偏好已经跨端稳定
  - 做完你能看到什么：这次不是“看起来像做完了”，而是真的能跨端用
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：
    - 自动化测试
    - 验证记录
    - 任务状态回写
  - 这一先不做什么：不扩到新的偏好字段
  - 怎么算完成：
    1. 多客户端同步链路跑通
    2. 旧本地迁移链路跑通
    3. 本地保留项没有误同步
  - 怎么验证：
    - 集成测试
    - 人工多客户端走查
    - 验证记录回写
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
