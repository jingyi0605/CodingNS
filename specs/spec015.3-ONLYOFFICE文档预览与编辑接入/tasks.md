# 任务清单 - spec015.3-ONLYOFFICE文档预览与编辑接入（人话版）

状态：IN_PROGRESS

## 这份文档是干什么的

这份清单只做一件事：让接手的人一眼看明白这次 ONLYOFFICE 接入到底做到哪了，还剩什么。

## 阶段 1：先把配置和后端能力搭起来

- [x] 1.1 建 ONLYOFFICE 配置模型和状态接口
  - 状态：DONE
  - 这一步到底做什么：给 Host 加一份能持久化的 ONLYOFFICE 配置，并提供读取、保存、检测接口。
  - 做完你能看到什么：设置页不再靠硬编码，Host 能返回“已启用 / 未启用 / 地址不通 / 有风险”这类明确状态。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §2.3.1「保存与检测 ONLYOFFICE 配置」
    - `design.md` §3.2.1「OfficeOnlyOfficeSettingRecord」
  - 主要改哪里：
    - `apps/host/src/modules/office/`
    - `apps/host/src/routes/office.ts`
    - `apps/host/src/storage/`
  - 这一步先不做什么：先不碰前端 viewer，也不接回调落盘。
  - 怎么算完成：
    1. Host 有配置读写接口
    2. Host 有状态检测接口
    3. 配置能持久化到 SQLite
  - 怎么验证：
    - `pnpm -C apps/host exec tsc --noEmit`
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §2.3.1、§3.2.1、§3.3.1、§3.3.2、§3.3.3

- [x] 1.2 打通工作区 / 事务文档库的 Office 预览配置生成
  - 状态：DONE
  - 这一步到底做什么：让两条文件预览链路在识别 `docx / xlsx / pptx` 后，都能拿到 ONLYOFFICE 启动配置。
  - 做完你能看到什么：前端预览接口返回 `kind=office` 和可直接启动编辑器的数据。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` §2.3.2、§2.3.3
    - `design.md` §3.2.2「OnlyOfficePreviewConfig」
  - 主要改哪里：
    - `apps/host/src/modules/file/`
    - `apps/host/src/modules/workspace/`
    - `apps/host/src/modules/office/`
  - 这一步先不做什么：先不在前端渲染编辑器。
  - 怎么算完成：
    1. 工作区文件预览接口能返回 Office 配置
    2. 事务文档库预览接口也能返回同类配置
  - 怎么验证：
    - `pnpm -C apps/host exec tsc --noEmit`
  - 对应需求：`requirements.md` 需求 3、需求 4
  - 对应设计：`design.md` §2.3.2、§2.3.3、§3.2.2、§6.1

- [x] 1.3 接回调保存链路
  - 状态：DONE
  - 这一步到底做什么：给 ONLYOFFICE 一个可回调的保存入口，并把结果写回原文件。
  - 做完你能看到什么：ONLYOFFICE 保存后，不是“看起来保存了”，而是真的落回原路径。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` §2.3.4「ONLYOFFICE 回调保存」
    - `design.md` §6.2「回调只能写回绑定文件」
  - 主要改哪里：
    - `apps/host/src/modules/office/`
    - `apps/host/src/routes/office.ts`
  - 这一步先不做什么：先不做多人冲突合并。
  - 怎么算完成：
    1. 回调 URL 可以被调用
    2. 下载到的结果会覆盖原文件
    3. 非法 token 不会写回别的路径
  - 怎么验证：
    - `pnpm -C apps/host exec vitest run tests/integration/auth-guard-public-routes.test.ts`
  - 对应需求：`requirements.md` 需求 3、需求 4
  - 对应设计：`design.md` §2.3.4、§3.3.4、§6.2

## 阶段 2：把前端入口接上

- [x] 2.1 在 office 设置页增加 ONLYOFFICE 配置和检测
  - 状态：DONE
  - 这一步到底做什么：在现有 `office` tab 里补 ONLYOFFICE 配置区，不另起新页面。
  - 做完你能看到什么：用户能在 UI 里开关、填地址、保存、重新检测。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §2.3.1
    - `docs/20260603-macOS与外部部署推荐方案.md`
  - 主要改哪里：
    - `apps/user-app/src/settings/SkillManagementPanel.tsx`
    - `apps/user-app/src/features/settings/api/office-capability-api.ts`
    - `apps/user-app/src/shared/i18n/index.ts`
  - 这一步先不做什么：先不做自动部署助手。
  - 怎么算完成：
    1. 页面能读写配置
    2. 页面能展示检测结果
    3. 文案是给普通用户看的，不是工程术语堆砌
  - 怎么验证：
    - `pnpm -C apps/user-app exec tsc --noEmit`
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §2.3.1、§3.3.1、§3.3.2、§3.3.3

- [x] 2.2 在 FileViewerPanel 里嵌入 ONLYOFFICE
  - 状态：DONE
  - 这一步到底做什么：给现有查看器加一个 `office` 分支，加载 ONLYOFFICE 编辑器。
  - 做完你能看到什么：`docx / xlsx / pptx` 不再只显示不支持，而是直接在现有查看器里打开。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` §2.3.2、§2.3.3
    - `spec004.1-文件预览内核与模态工具增强`
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/FileViewerModal.tsx`
    - `apps/user-app/src/features/conversation/api/file-context-api.ts`
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/app/styles.css`
  - 这一步先不做什么：不重做 viewer 外壳，不单独长 Office 页面。
  - 怎么算完成：
    1. 工作区 Office 文件能打开
    2. 事务文档库 Office 文件也能打开
    3. 配置无效时有明确提示，不白屏
  - 怎么验证：
    - `pnpm -C apps/user-app exec vitest run src/features/conversation/components/FileViewerModal.test.tsx -t "Office 文件会加载 ONLYOFFICE 预览器"`
    - `pnpm -C apps/user-app exec tsc --noEmit`
  - 对应需求：`requirements.md` 需求 3、需求 4
  - 对应设计：`design.md` §2.3.2、§2.3.3、§6.1

## 阶段 3：收口文档和验证

- [ ] 3.1 补部署说明、跑定向验证、回写状态
  - 状态：IN_PROGRESS
  - 这一步到底做什么：把 macOS / Windows 推荐部署方式写清楚，跑完关键测试，再把任务状态回写完整。
  - 做完你能看到什么：功能不只是“代码写了”，而是真的可交付、可复核。
  - 先依赖什么：1.3、2.1、2.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `docs/20260603-macOS与外部部署推荐方案.md`
  - 主要改哪里：
    - `specs/spec015.3-ONLYOFFICE文档预览与编辑接入/docs/`
    - `tasks.md`
    - 相关测试文件
  - 这一步先不做什么：不再顺手扩更多 Office 格式。
  - 怎么算完成：
    1. 关键测试已跑
    2. 部署说明已能直接指导配置
    3. 任务状态与实际实现一致
    4. ONLYOFFICE 会自动带入当前登录用户，且不再弹匿名初始化
  - 怎么验证：
    - 已完成：
      - `pnpm -C apps/host exec tsc --noEmit`
      - `pnpm -C apps/user-app exec tsc --noEmit`
      - `pnpm -C apps/host exec vitest run tests/integration/auth-guard-public-routes.test.ts`
      - `pnpm -C apps/host exec vitest run tests/integration/spec004-file-context.e2e.test.ts -t "事务文档库 Office 预览会自动带入当前登录用户，并关闭匿名初始化"`
      - `pnpm -C apps/user-app exec vitest run src/features/conversation/components/FileViewerModal.test.tsx -t "Office 文件会加载 ONLYOFFICE 预览器"`
      - `pnpm -C apps/user-app exec vitest run src/settings/SkillManagementPanel.test.tsx -t "ONLYOFFICE 配置会显示单独的设置按钮，并在独立弹窗里编辑"`
      - `pnpm -C apps/user-app exec vitest run src/features/settings/pages/SettingsPage.test.tsx -t "桌面设置页的能力管理分类会提供 ONLYOFFICE 设置入口"`
    - 待补：
      - 接真实 ONLYOFFICE 服务做一次保存回写联调
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
