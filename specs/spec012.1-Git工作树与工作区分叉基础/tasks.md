# 任务清单 - spec012.1 Git工作树与工作区分叉基础（人话版）

状态：Draft

## 2026-04-12 进展补记

- 已确认 `spec012` 不再直接承接 worktree 基础实现，先拆出 `spec012.1`
- 已确认第一阶段只做 worktree 生命周期，不做多 provider 并行编排
- 已确认工作台采用方案 A：
  - 保留“当前主工作树会话”
  - 新增“子工作树”区块
  - 保留“归档会话”
- 已确认需要在列表文字颜色、聊天界面和右侧信息栏上区分父工作区与子工作树

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并已回写
- `CANCELLED`：取消并写明原因

规则：

- 只有 `状态：DONE` 的任务才能勾成 `[x]`
- 每做完一个任务，都要立刻回写本文件
- `BLOCKED` 和 `CANCELLED` 必须写明原因

---

## 阶段 0：先把边界钉死，别让 spec012 再背锅

- [x] 0.1 新建 `spec012.1` 文档骨架
  - 状态：DONE
  - 这一步到底做什么：建立 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`
  - 做完以后能看到什么结果：仓库里出现独立的 `spec012.1`，不再把 worktree 地基和上层并行编排混写
  - 依赖什么：无
  - 主要改哪些文件：
    - `specs/spec012.1-Git工作树与工作区分叉基础/*`
  - 这一步先不做什么：不改实现代码
  - 怎么验证：
    - 文档走查

- [x] 0.2 回写总览和父规格依赖
  - 状态：DONE
  - 这一步到底做什么：把 `specs/README.md` 和 `spec012` 的依赖说明补齐
  - 做完以后能看到什么结果：任何人看目录都知道先做 `012.1`，再做 `012`
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec012-并行项目编排与结果对比/README.md`
  - 这一步先不做什么：不重写 `spec012` 正文
  - 怎么验证：
    - 文档走查

---

## 阶段 1：先把 worktree 对象和 Git 生命周期立住

- [x] 1.1 新增工作树元数据表和仓储
  - 状态：DONE
  - 这一步到底做什么：新增 `workspace_worktrees`，把父子关系、分支、状态、合并目标这些信息正式落库
  - 做完以后能看到什么结果：系统知道哪个 `workspace` 是哪个根工作区下面的子工作树
  - 依赖什么：0.2
  - 主要改哪些文件：
    - SQLite schema
    - worktree repository
    - 相关 domain type
  - 这一步先不做什么：不接 UI
  - 怎么验证：
    - `pnpm --filter host test -- tests/integration/workspace-worktree-repository.test.ts`
    - `pnpm --filter host test -- tests/integration/sqlite-bootstrap.test.ts`
    - `pnpm --filter host build`

- [x] 1.2 实现 `worktree-manager` 创建能力
  - 状态：DONE
  - 这一步到底做什么：从源工作区创建分支、创建 `git worktree`、注册新 `workspace`、写入元数据
  - 做完以后能看到什么结果：用户能从现有工作区长出一个真正独立的子工作树
  - 依赖什么：1.1
  - 主要改哪些文件：
    - Host worktree service
    - Git service 扩展
    - workspace service 对接
  - 这一步先不做什么：不做批量创建
  - 怎么验证：
    - `pnpm --filter host test -- tests/integration/worktree-routes.test.ts`
    - `pnpm --filter host test -- tests/integration/spec005-git-context.e2e.test.ts`
    - `pnpm --filter host test -- tests/integration/workspace-clone.test.ts`
    - `pnpm --filter host test -- tests/integration/workspace-worktree-repository.test.ts`
    - `pnpm --filter host build`

- [x] 1.3 支持从子工作树继续 fork
  - 状态：DONE
  - 这一步到底做什么：允许从已有子工作树继续创建下一级节点
  - 做完以后能看到什么结果：worktree 树不只是一层，可以继续往下长
  - 依赖什么：1.2
  - 主要改哪些文件：
    - worktree service
    - worktree tree query
  - 这一步先不做什么：不支持跨根工作区迁移
  - 怎么验证：
    - `pnpm --filter host test -- tests/integration/worktree-routes.test.ts`
    - `pnpm --filter host build`

- [x] 1.4 回读和修复 `git worktree` 状态
  - 状态：DONE
  - 这一步到底做什么：用 `git worktree list` 回读真实状态，发现目录丢失或残留
  - 做完以后能看到什么结果：worktree 元数据不会越用越脏
  - 依赖什么：1.3
  - 主要改哪些文件：
    - worktree sync service
    - 状态修复逻辑
  - 这一步先不做什么：不自动修复所有异常
  - 怎么验证：
    - `pnpm --filter host test -- tests/integration/worktree-routes.test.ts`
    - `pnpm --filter host test -- tests/integration/spec005-git-context.e2e.test.ts`
    - `pnpm --filter host test -- tests/integration/workbench-service.test.ts`
    - `pnpm --filter host test -- tests/integration/workspace-clone.test.ts`
    - `pnpm --filter host build`

---

## 阶段 2：把工作台结构接上，但别破坏现有布局

- [x] 2.1 扩展 workbench snapshot，支持“子工作树”区块
  - 状态：DONE
  - 这一步到底做什么：让根工作区快照除了当前会话，还能返回子工作树树
  - 做完以后能看到什么结果：前端拿到的数据结构能表达方案 A
  - 依赖什么：1.4
  - 主要改哪些文件：
    - `workbench-service`
    - workbench ws hub
    - 前端 DTO
  - 这一步先不做什么：不改会话排序规则
  - 怎么验证：
    - `pnpm --filter host test -- tests/integration/workbench-service.test.ts`
    - `pnpm --filter host test -- tests/integration/worktree-routes.test.ts`
    - `pnpm --filter host build`
    - `pnpm --filter user-app build`

- [x] 2.2 桌面端侧边栏落地方案 A
  - 状态：DONE
  - 这一步到底做什么：在根工作区展开内容里新增“子工作树”区块，根会话和归档会话保持原位
  - 做完以后能看到什么结果：顶层工作区列表基本不变，但展开后能看到 worktree 树
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `WorkbenchLayout`
    - 导航 tree 相关工具
  - 这一步先不做什么：不重写整个侧边栏
  - 怎么验证：
    - `pnpm --filter user-app exec vitest run src/features/conversation/components/WorkbenchLayout.test.tsx -t "会在工作区展开内容里显示子工作树区块并递归展示子节点"`
    - `pnpm --filter user-app build`

- [x] 2.3 移动端工作区与会话页接入子工作树
  - 状态：DONE
  - 这一步到底做什么：复用移动端左上角顶部工作区切换容器，把根工作区和子工作树统一做成一棵切换树，并接入工作区首页、工作区详情页、会话页和新建会话弹层
  - 做完以后能看到什么结果：移动端可以直接从顶部切换容器进入子工作树，也能在子工作树上下文里查看自己的会话并创建新会话
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-shell/components/MobileWorkspaceSwitcherHeader.tsx`
    - `apps/user-app/src/features/mobile-sessions/components/MobileCreateSessionSheet.tsx`
    - `apps/user-app/src/features/mobile-workspaces/pages/WorkspaceHomePage.tsx`
    - `apps/user-app/src/features/mobile-workspaces/pages/WorkspaceDetailPage.tsx`
    - `apps/user-app/src/features/mobile-sessions/pages/SessionIndexPage.tsx`
    - `apps/user-app/src/features/workbench/utils/mobile-workspace-tree.ts`
  - 这一步先不做什么：不额外设计一套新导航，不做 worktree merge / cleanup 入口
  - 怎么验证：
    - `pnpm --filter user-app exec vitest run src/features/mobile-workspaces/pages/WorkspaceHomePage.test.tsx src/features/mobile-workspaces/pages/WorkspaceDetailPage.test.tsx src/features/mobile-sessions/pages/SessionIndexPage.test.tsx`
    - `pnpm --filter user-app exec vitest run src/features/conversation/components/SessionProviderPicker.test.tsx`
    - `pnpm --filter user-app build`

---

## 阶段 3：做上下文视觉区分和合并清理

- [x] 3.1 落地工作树上下文视觉标识
  - 状态：DONE
  - 这一步到底做什么：基于 worktree 元数据统一计算当前工作区上下文，在桌面和移动端的会话列表、聊天页头部、右侧信息栏落地稳定的父工作区 / 子工作树视觉区分
  - 做完以后能看到什么结果：用户进入子工作树后，会话列表文字和卡片底色会偏离父工作区默认样式，聊天页头部会明确提示当前属于父工作区还是子工作树，右侧信息栏背景也会跟随当前上下文切换
  - 依赖什么：2.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/workbench/utils/worktree-visual-context.ts`
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/features/conversation/components/SessionHeader.tsx`
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/mobile-sessions/components/SessionListItem.tsx`
    - `apps/user-app/src/features/mobile-sessions/pages/SessionIndexPage.tsx`
    - `apps/user-app/src/app/styles.css`
    - `apps/user-app/src/features/mobile-sessions/styles.css`
  - 这一步先不做什么：不做全局主题切换，不单独给 worktree 新长一套页面
  - 怎么验证：
    - `pnpm --filter user-app exec vitest run src/features/conversation/pages/ConversationPage.test.tsx src/features/conversation/components/WorkbenchLayout.test.tsx src/features/mobile-sessions/pages/SessionIndexPage.test.tsx`
    - `pnpm --filter user-app build`

- [x] 3.2 实现“合并回直接父节点”预检与执行
  - 状态：DONE
  - 这一步到底做什么：只支持把当前子工作树合回直接父节点，并先做预检
  - 做完以后能看到什么结果：第一阶段可以闭环处理 worktree 改动回收
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/host/src/modules/worktree/worktree-merge-service.ts`
    - `apps/host/src/modules/worktree/worktree-controller.ts`
    - `apps/host/src/routes/worktrees.ts`
    - `apps/host/tests/integration/worktree-routes.test.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.test.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/app/styles.css`
  - 这一步先不做什么：不支持任意目标 merge
  - 怎么验证：
    - `pnpm --filter host exec vitest run tests/integration/worktree-routes.test.ts`
    - `pnpm --filter host build`
    - `pnpm --filter user-app exec vitest run src/features/conversation/components/WorkbenchLayout.test.tsx`
    - `pnpm --filter user-app build`

- [x] 3.3 实现 worktree 清理
  - 状态：DONE
  - 这一步到底做什么：清理 worktree、目录和元数据，并拦截仍有活跃资源占用的节点
  - 做完以后能看到什么结果：用户能安全收尾，不会把项目目录越跑越脏
  - 依赖什么：3.2
  - 主要改哪些文件：
    - `apps/host/src/modules/worktree/worktree-cleanup-service.ts`
    - `apps/host/src/modules/worktree/worktree-controller.ts`
    - `apps/host/src/routes/worktrees.ts`
    - `apps/host/tests/integration/worktree-routes.test.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
  - 这一步先不做什么：不默认删除分支
  - 怎么验证：
    - `pnpm --filter host exec vitest run tests/integration/worktree-routes.test.ts`
    - `pnpm --filter host build`
    - `pnpm --filter user-app exec vitest run src/features/conversation/components/WorkbenchLayout.test.tsx`
    - `pnpm --filter user-app build`

---

## 阶段 4：阶段验收

- [ ] 4.1 端到端回放“创建 -> 继续 fork -> 进入子工作树 -> 合并 -> 清理”
  - 状态：TODO
  - 这一步到底做什么：完整回放第一阶段主链路
  - 做完以后能看到什么结果：`spec012.1` 能独立闭环，不再只是文档设想
  - 依赖什么：3.3
  - 主要改哪些文件：
    - 集成测试
    - 必要的验收记录
  - 这一步先不做什么：不引入并行会话组和会话级临时隔离工作区
  - 怎么验证：
    - 集成测试
    - 人工验收
