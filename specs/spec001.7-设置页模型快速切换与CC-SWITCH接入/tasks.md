# 任务清单 - spec001.7-设置页模型快速切换与CC-SWITCH接入（人话版）

状态：IN_REVIEW

## 2026-04-15 进展补记

- 已启动 `spec001.7`
- 已确认第一阶段不做“任意模型编辑”，只做“基于 `cc-switch` 预设的模型快速切换”
- 已确认切换动作必须走 Host 调用 `cc-switch` CLI，不让前端直接碰本地命令
- 已确认读取状态不能靠解析漂亮表格输出，要走结构化状态源
- Host 已接入 `cc-switch` 命令路径和数据库路径配置，支持从环境变量和默认路径发现命令
- Host 已提供 `/api/system/model-switch` 的读取与切换接口，并补了集成测试
- 设置页已新增“模型管理”分区，桌面端和移动端都能图形化切换四个应用的预设
- 切换成功后会清理 provider capability 缓存，避免会话侧继续读旧状态
- 定向验证已完成，但 `host build` 仍被仓库里既有 TypeScript 错误阻塞，见阶段 4 备注

## 这份文档是干什么的

这份任务清单只回答下面这些问题：

- 第一阶段模型管理到底做什么，不做什么
- Host 侧 `cc-switch` 适配层怎么切
- 设置页入口怎么补
- 切换后怎么验证系统真的吃到了新状态

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
- `BLOCKED` 和 `CANCELLED` 必须写清楚卡在哪

---

## 阶段 0：先把边界钉死

- [x] 0.1 建立 `spec001.7` 文档骨架
  - 状态：DONE
  - 这一步到底做什么：创建 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`，把第一阶段范围和边界写清楚。
  - 做完以后能看到什么结果：仓库里出现完整的 `spec001.7` 目录，后续实现不再靠聊天记录兜底。
  - 依赖什么：无
  - 主要改哪些文件：
    - `specs/spec001.7-设置页模型快速切换与CC-SWITCH接入/*`
  - 这一步先不做什么：不直接改实现代码。
  - 怎么验证：
    - 文档走查
  - 回写时间：2026-04-15

- [x] 0.2 更新总览和父 Spec 入口
  - 状态：DONE
  - 这一步到底做什么：把 `specs/README.md` 和 `spec001` 主文档挂上 `spec001.7`，避免新 Spec 变成游离目录。
  - 做完以后能看到什么结果：总览和父 Spec 都能找到这份子规格。
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/design.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
  - 这一步先不做什么：不修改父 Spec 主体需求。
  - 怎么验证：
    - 文档走查
  - 回写时间：2026-04-15

---

## 阶段 1：Host 先把 `cc-switch` 接成一条受控链路

- [x] 1.1 增加 `cc-switch` 命令路径发现和可用性判断
  - 状态：DONE
  - 这一步到底做什么：在 Host 里新增 `cc-switch` 命令路径发现逻辑，支持环境变量和常见默认路径。
  - 做完以后能看到什么结果：系统能明确知道当前机器有没有可用的 `cc-switch`。
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/host/src/config/env.ts`
    - `apps/host/src/modules/model-switch/cc-switch-adapter.ts`
  - 这一步先不做什么：不让前端直接执行本地命令。
  - 怎么验证：
    - 本机确认 `~/.local/bin/cc-switch` 可被发现
    - `model-switch-routes.test.ts`
  - 回写时间：2026-04-15

- [x] 1.2 建立 `cc-switch` 结构化读取适配层
  - 状态：DONE
  - 这一步到底做什么：把当前预设、候选预设、当前模型和状态原因统一抽成安全快照。
  - 做完以后能看到什么结果：前端能拿到统一的四应用快照，不需要知道 `cc-switch` 内部细节。
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/modules/model-switch/cc-switch-adapter.ts`
    - `apps/host/src/modules/model-switch/model-switch-service.ts`
    - `apps/host/src/modules/model-switch/model-switch-controller.ts`
  - 这一步先不做什么：不解析 `cc-switch` 漂亮表格输出，直接读 sqlite 结构化数据。
  - 怎么验证：
    - `model-switch-routes.test.ts` 覆盖四个应用快照
    - 验证 `ready / unconfigured / unavailable / error` 四类状态都能返回
  - 回写时间：2026-04-15

- [x] 1.3 增加模型管理 API 和切换接口
  - 状态：DONE
  - 这一步到底做什么：提供读取快照和执行切换的最小 Host API。
  - 做完以后能看到什么结果：前端可以通过正式接口拉数据和切换，而不是拼命令。
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/host/src/modules/model-switch/model-switch-controller.ts`
    - `apps/host/src/routes/system.ts` 或等价新路由
    - `apps/host/src/server/create-server.ts`
  - 这一步先不做什么：不做批量切换，不做任务系统化。
  - 怎么验证：
    - `GET /api/system/model-switch` 返回四应用快照
    - `POST /api/system/model-switch` 能切换 `codex` 预设
    - 顺手补上 `AuthService` 在 `create-server.ts` 的装配遗漏，恢复测试登录链路
  - 回写时间：2026-04-15

---

## 阶段 2：设置页补正式入口

- [x] 2.1 新增前端模型管理 API 封装
  - 状态：DONE
  - 这一步到底做什么：在 `user-app` 里新增模型管理接口类型和请求函数。
  - 做完以后能看到什么结果：设置页组件不再自己拼 URL 和数据结构。
  - 依赖什么：1.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/settings/api/model-switch-api.ts`
  - 这一步先不做什么：不加 UI。
  - 怎么验证：
    - `ModelManagementPanel.test.tsx`
  - 回写时间：2026-04-15

- [x] 2.2 新增桌面端 `ModelManagementPanel`
  - 状态：DONE
  - 这一步到底做什么：新增设置页面板，显示四个应用卡片、当前状态和切换入口。
  - 做完以后能看到什么结果：桌面端设置页出现正式模型管理区域。
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/user-app/src/settings/ModelManagementPanel.tsx`
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
    - `apps/user-app/src/app/styles.css`
  - 这一步先不做什么：不顺手改会话页模型工具栏。
  - 怎么验证：
    - `ModelManagementPanel.test.tsx`
    - `SettingsPage.test.tsx`
  - 回写时间：2026-04-15

- [x] 2.3 补移动端入口和分区页面
  - 状态：DONE
  - 这一步到底做什么：在移动端设置 section 列表里增加“模型管理”，并挂上独立分区。
  - 做完以后能看到什么结果：移动端也能进模型管理，不再只有桌面端可用。
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - i18n 字典
  - 这一步先不做什么：不新增新的顶级导航。
  - 怎么验证：
    - `SettingsPage.test.tsx` 覆盖移动端入口和分区渲染
  - 回写时间：2026-04-15

---

## 阶段 3：把切换结果接回现有 provider 显示链路

- [x] 3.1 切换成功后刷新相关 provider capability 显示
  - 状态：DONE
  - 这一步到底做什么：保证设置页切换成功后，相关“跟随 CLI 默认模型”显示能尽快更新。
  - 做完以后能看到什么结果：用户切完以后不是还盯着旧值发愣。
  - 依赖什么：2.3
  - 主要改哪些文件：
    - `apps/user-app/src/settings/ModelManagementPanel.tsx`
    - `apps/user-app/src/features/conversation/components/SessionProviderPicker.tsx`
  - 这一步先不做什么：不强行改已经显式指定模型的会话。
  - 怎么验证：
    - 切换成功后调用 `clearSessionProviderPickerCapabilityCache()`
    - `ModelManagementPanel.test.tsx`
  - 回写时间：2026-04-15

- [x] 3.2 补错误状态、不可用状态和部分成功验证
  - 状态：DONE
  - 这一步到底做什么：补齐命令不存在、单应用未配置、单应用切换失败、单应用读取失败的界面和接口表现。
  - 做完以后能看到什么结果：模型管理页不是只有理想路径能看。
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/host/src/modules/model-switch/*`
    - `apps/user-app/src/settings/ModelManagementPanel.tsx`
    - 前端 i18n 和测试
  - 这一步先不做什么：不加重试队列。
  - 怎么验证：
    - `model-switch-routes.test.ts`
    - `ModelManagementPanel.test.tsx`
  - 回写时间：2026-04-15

---

## 阶段 4：验收和补记

- [ ] 4.1 形成验收清单和手工验证记录
  - 状态：TODO
  - 这一步到底做什么：把四个应用的可用、不可用、切换成功和失败路径逐项验收并回写文档。
  - 做完以后能看到什么结果：别人接手时知道这功能到底在哪些机器和状态下验证过。
  - 依赖什么：3.2
  - 主要改哪些文件：
    - `specs/spec001.7-设置页模型快速切换与CC-SWITCH接入/docs/*`
    - `tasks.md`
  - 这一步先不做什么：不扩 Scope。
  - 怎么验证：
    - 文档和测试记录走查
  - 当前备注：
    - 已完成定向自动化验证：
      - `pnpm --filter user-app exec vitest run src/settings/ModelManagementPanel.test.tsx src/features/settings/pages/SettingsPage.test.tsx`
      - `pnpm --filter host test -- model-switch-routes.test.ts`
    - `pnpm --filter host build` 仍失败，当前看到的阻塞项在：
      - `apps/host/src/modules/auth/auth-service.ts`
      - `apps/host/src/modules/sessions/session-history-service.ts`
      - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
