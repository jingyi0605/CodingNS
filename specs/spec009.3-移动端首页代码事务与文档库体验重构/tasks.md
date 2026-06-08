# 任务清单 - spec009.3 移动端首页代码事务与文档库体验重构（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单用来指导正式开发。每一步都要让接手的人知道：

- 这一步到底做什么
- 做完能看到什么
- 依赖什么
- 主要改哪些文件
- 这一步明确不做什么
- 怎么验证是真的完成了

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- `BLOCKED` 必须写清楚卡在哪里
- `CANCELLED` 必须写清楚为什么不做
- 每做完一个任务，必须立刻更新这里

---

## 阶段 1：先把真实结构和入口摆正

- [ ] 1.1 梳理移动端路由和现有页面职责
  - 状态：TODO
  - 这一步到底做什么：把当前移动端底部导航、路由、页面组件和 PC 事务文档库的复用点列清楚，避免后面乱改。
  - 做完你能看到什么：一份明确的代码改造清单，知道哪些页面保留、哪些迁移、哪些新增。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3、需求 4、需求 5
    - `design.md` §1.4「当前实现诊断」
    - `design.md` §2「信息架构」
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
  - 主要改哪里：
    - 暂不改代码，先读：`apps/user-app/src/features/mobile-shell/`
    - 暂不改代码，先读：`apps/user-app/src/features/mobile-sessions/pages/SessionIndexPage.tsx`
    - 暂不改代码，先读：`apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
  - 这一步先不做什么：不写新页面，不改路由，不动样式。
  - 怎么算完成：
    1. 已确认当前“对话页”实际是代码会话列表。
    2. 已确认文档库 PC 端真实数据结构和能力来源。
    3. 已列出要新增和迁移的组件。
  - 怎么验证：
    - 人工走查代码和本 Spec 对照。
  - 对应需求：`requirements.md` 需求 1、需求 3、需求 4、需求 5
  - 对应设计：`design.md` §1.4、§2、§5

- [ ] 1.2 调整移动端底部导航模型
  - 状态：TODO
  - 这一步到底做什么：把底部导航改成 `首页 / 对话 / 代码 / 文档 / 工作台`，并让 active 状态和路由对应。
  - 做完你能看到什么：手机底部不再显示旧的工作区/助手/终端/设置组合，而是新五入口。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.1「一级导航」
    - `design.md` §5.1「底部导航改造」
  - 主要改哪里：
    - `apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.tsx`
    - `apps/user-app/src/features/mobile-shell/ios/IosWorkbenchShell.tsx`
    - `apps/user-app/src/features/mobile-shell/android/AndroidWorkbenchShell.tsx`
    - `apps/user-app/src/features/mobile-shell/components/mobile-workbench-shell-types.ts`
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步先不做什么：不实现各页面完整内容，只保证导航入口、文案和高亮正确。
  - 怎么算完成：
    1. 五个新入口都能显示。
    2. 点击入口能进入对应占位或现有页面。
    3. 设置不在底部导航里。
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.tsx apps/user-app/src/features/mobile-shell/components/mobile-workbench-shell-types.ts`
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.1、§5.1、§6

- [ ] 1.3 首页顶部头像菜单
  - 状态：TODO
  - 这一步到底做什么：新增首页头像入口，把设置、通知、Host 管理等低频入口放进头像 sheet。
  - 做完你能看到什么：首页顶部有头像，点击后出现个人菜单；底部不再需要“我的/设置”。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 8
    - `design.md` §2.2「首页结构」
    - 模态框规范：`docs/开发设计规范/20260419-模态框与按钮设计规范.md`
    - 移动端 sheet 约束：`specs/spec008.2-桌面端与移动端模态框统一模板/docs/20260418-模态框迁移与新增约束清单.md`
  - 主要改哪里：
    - `apps/user-app/src/features/mobile-home/pages/MobileHomePage.tsx`
    - `apps/user-app/src/features/mobile-home/components/MobileUserMenuSheet.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步先不做什么：不做账号体系重构，不做 Host 新能力。
  - 怎么算完成：
    1. 头像 sheet 能打开和关闭。
    2. 菜单项文案来自 i18n。
    3. 菜单入口能跳到现有设置或对应页面。
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/mobile-home/pages/MobileHomePage.tsx apps/user-app/src/features/mobile-home/components/MobileUserMenuSheet.tsx`
  - 对应需求：`requirements.md` 需求 1、需求 8
  - 对应设计：`design.md` §2.1、§2.2、§5.2

### 阶段检查

- [ ] 1.4 阶段 1 检查点
  - 状态：TODO
  - 这一步到底做什么：确认新导航和头像菜单已经站稳，旧入口没有直接断。
  - 做完你能看到什么：可以开始填首页、代码、对话、文档、工作台内容。
  - 先依赖什么：1.1、1.2、1.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：阶段 1 涉及的全部文件
  - 这一步先不做什么：不加新页面能力。
  - 怎么算完成：
    1. 新底部导航路径清楚。
    2. 旧设置入口有替代路径。
    3. i18n 没有硬编码漏网。
  - 怎么验证：
    - 人工移动端走查
    - 运行阶段 1 相关最小测试
  - 对应需求：`requirements.md` 需求 1、需求 8、需求 9
  - 对应设计：`design.md` §2.1、§5.1、§5.2

---

## 阶段 2：首页、对话页和代码页落地

- [ ] 2.1 实现首页聚合视图
  - 状态：TODO
  - 这一步到底做什么：首页展示事务待处理、代码工作区完成未读会话、工作台待确认和文档更新摘要。
  - 做完你能看到什么：打开移动端首页，就能看到“等待处理”和“今日概览”。
  - 先依赖什么：1.4
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.2「首页结构」
    - `design.md` §4.1「首页摘要模型」
  - 主要改哪里：
    - `apps/user-app/src/features/mobile-home/pages/MobileHomePage.tsx`
    - `apps/user-app/src/features/mobile-home/` 下新增摘要推导工具
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步先不做什么：不拉全量文档库，不展示 Git diff 和终端日志详情。
  - 怎么算完成：
    1. 首页能显示至少四类摘要：待处理、代码未读、工作台、文档。
    2. 代码会话完成未读能作为等待处理项出现。
    3. 摘要项能跳到对应页面。
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/mobile-home/pages/MobileHomePage.tsx`
  - 对应需求：`requirements.md` 需求 2、需求 8
  - 对应设计：`design.md` §2.2、§4.1、§5.2

- [ ] 2.2 把当前移动端会话列表迁成代码页
  - 状态：TODO
  - 这一步到底做什么：把当前 `SessionIndexPage` 的“工作区切换器 + 会话列表”语义改成代码页，并补工作区摘要。
  - 做完你能看到什么：底部点击“代码”后，看到当前工作区、路径、代码会话列表和文件/Git/终端入口。
  - 先依赖什么：1.4
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.4「代码页结构」
    - `design.md` §5.3「代码页组件」
  - 主要改哪里：
    - `apps/user-app/src/features/mobile-sessions/pages/SessionIndexPage.tsx`
    - 或新增：`apps/user-app/src/features/mobile-code/pages/MobileCodePage.tsx`
    - `apps/user-app/src/features/mobile-sessions/components/SessionListItem.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步先不做什么：不重写会话详情页，不重写文件/Git/终端工具。
  - 怎么算完成：
    1. 代码页保留 `MobileWorkspaceSwitcherHeader`。
    2. 当前工作区会话列表仍能进入会话详情。
    3. 页面文案不再把代码会话列表叫成事务对话。
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/mobile-sessions/pages/SessionIndexPage.tsx apps/user-app/src/features/mobile-sessions/pages/SessionIndexPage.test.tsx`
  - 对应需求：`requirements.md` 需求 4、需求 9
  - 对应设计：`design.md` §2.4、§4.2、§5.3

- [ ] 2.3 实现事务轻量对话页
  - 状态：TODO
  - 这一步到底做什么：新增真正的事务对话页，展示轻量会话，不再绑定代码工作区。
  - 做完你能看到什么：底部点击“对话”后，看到轻量事务会话列表和新建入口，没有工作区切换器。
  - 先依赖什么：1.4
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.3「对话页结构」
    - `design.md` §5.4「对话页组件」
    - `AffairsWorkbenchView.tsx` 中 `listAffairsLightweightSessions` 相关逻辑
  - 主要改哪里：
    - `apps/user-app/src/features/mobile-affairs/pages/MobileAffairsConversationPage.tsx`
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`（只抽必要复用逻辑，不大改页面）
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步先不做什么：不做完整 Agent 会话，不接代码工具，不显示工作区切换器。
  - 怎么算完成：
    1. 对话页能加载轻量会话列表。
    2. 新建轻量对话入口存在。
    3. 页面不依赖 `currentWorkspaceId` 才能显示主内容。
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/mobile-affairs/pages/MobileAffairsConversationPage.tsx`
  - 对应需求：`requirements.md` 需求 3、需求 9
  - 对应设计：`design.md` §2.3、§5.4、§8.1

### 阶段检查

- [ ] 2.4 阶段 2 检查点
  - 状态：TODO
  - 这一步到底做什么：确认首页、对话、代码三个核心入口职责已经分清。
  - 做完你能看到什么：用户不会再把事务对话和代码会话混在一起。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3、需求 4
    - `design.md` §2.2、§2.3、§2.4
  - 主要改哪里：阶段 2 涉及的全部文件
  - 这一步先不做什么：不补文档页和工作台页新范围。
  - 怎么算完成：
    1. 首页聚合摘要能跳转。
    2. 对话页没有工作区切换器。
    3. 代码页有工作区切换器和代码会话。
  - 怎么验证：
    - 人工移动端走查：首页 → 对话 → 代码 → 会话详情
    - 运行阶段 2 相关最小测试
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 4
  - 对应设计：`design.md` §2.2、§2.3、§2.4

---

## 阶段 3：文档库移动端真实落地

- [ ] 3.1 抽出文档库共享状态 hook
  - 状态：TODO
  - 这一步到底做什么：从 `AffairsWorkbenchView.tsx` 抽出 PC 和移动端都能用的文档库状态和操作，不复制大块逻辑。
  - 做完你能看到什么：PC 文档库和移动端文档页可以共用文档库 snapshot、documents、favorites、tags、选择对象、刷新等能力。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 5、需求 9
    - `design.md` §4.3「文档库状态」
    - `design.md` §5.5「文档页组件」
    - 后台任务规范：`specs/spec001.2-后端任务调度与主线程压力治理/20260412-后台任务接入规范.md`
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - `apps/user-app/src/features/workbench/hooks/useAffairsLibraryState.ts`
    - 相关测试文件
  - 这一步先不做什么：不改文档库后端接口，不改索引器，不重写 PC 页面视觉。
  - 怎么算完成：
    1. 文档库核心状态和操作从巨型组件中抽出。
    2. PC 文档库仍能工作。
    3. 移动端可以消费同一份 hook。
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx apps/user-app/src/features/workbench/hooks/useAffairsLibraryState.ts`
  - 对应需求：`requirements.md` 需求 5、需求 9
  - 对应设计：`design.md` §4.3、§5.5、§8.3

- [ ] 3.2 实现文档库“浏览”视图
  - 状态：TODO
  - 这一步到底做什么：移动端展示当前目录下的子文件夹和直接文档，支持网格/列表、面包屑、排序和刷新状态。
  - 做完你能看到什么：手机文档页能像 PC 中间区域一样浏览根目录、文件夹和文档。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.5「文档页结构」
    - `design.md` §5.5「文档页组件」
  - 主要改哪里：
    - `apps/user-app/src/features/mobile-affairs-library/pages/MobileAffairsLibraryPage.tsx`
    - `apps/user-app/src/features/mobile-affairs-library/components/MobileLibraryBrowserView.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步先不做什么：不做右键菜单全量能力，不做文件系统危险操作。
  - 怎么算完成：
    1. 当前目录能展示子文件夹和文档。
    2. 网格/列表切换能工作。
    3. 点击对象能选中并进入详情。
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/mobile-affairs-library/pages/MobileAffairsLibraryPage.tsx apps/user-app/src/features/mobile-affairs-library/components/MobileLibraryBrowserView.tsx`
  - 对应需求：`requirements.md` 需求 5、需求 8
  - 对应设计：`design.md` §2.5、§4.3、§5.5

- [ ] 3.3 实现文档库“收藏”和“标签”视图
  - 状态：TODO
  - 这一步到底做什么：移动端展示 PC 左侧收藏和标签树能力，支持选择收藏、搜索标签、展开标签、查看命中文档。
  - 做完你能看到什么：手机上能按收藏和标签进入文档结果，不再是通用收藏文章模型。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.5「文档页结构」
    - `AffairsWorkbenchView.tsx` 中 `AffairsLibrarySidebarContent`
  - 主要改哪里：
    - `apps/user-app/src/features/mobile-affairs-library/components/MobileLibraryFavoritesView.tsx`
    - `apps/user-app/src/features/mobile-affairs-library/components/MobileLibraryTagsView.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步先不做什么：不做标签管理完整编辑器；标签管理入口可以先进设置或后续页面。
  - 怎么算完成：
    1. 文件夹收藏、标签收藏、标签组合收藏能显示。
    2. 标签树能显示层级和数量。
    3. 选择标签后能看到命中文档。
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/mobile-affairs-library/components/MobileLibraryFavoritesView.tsx apps/user-app/src/features/mobile-affairs-library/components/MobileLibraryTagsView.tsx`
  - 对应需求：`requirements.md` 需求 5、需求 8
  - 对应设计：`design.md` §2.5、§4.3、§5.5

- [ ] 3.4 实现文档库“详情”视图和关键操作
  - 状态：TODO
  - 这一步到底做什么：移动端展示文件夹、文档、标签对象详情，并提供收藏、标签、打开、下载等常用入口。
  - 做完你能看到什么：手机上选中文件夹或文档后，可以看到和 PC 右侧对象详情一致的核心信息。
  - 先依赖什么：3.1、3.2、3.3
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §4.4「文档对象详情」
    - `AffairsWorkbenchView.tsx` 中对象详情和标签分配相关逻辑
    - 如涉及 sheet：模态框与移动端 sheet 规范
  - 主要改哪里：
    - `apps/user-app/src/features/mobile-affairs-library/components/MobileLibraryDetailView.tsx`
    - `apps/user-app/src/features/mobile-affairs-library/pages/MobileAffairsLibraryPage.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步先不做什么：不把 PC 右键菜单所有动作照搬到手机，不做批量文件操作。
  - 怎么算完成：
    1. 文件夹详情展示目录统计和时间。
    2. 文档详情展示路径、摘要、大小、更新时间和标签。
    3. 收藏和标签入口能调用现有能力。
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/mobile-affairs-library/components/MobileLibraryDetailView.tsx`
  - 对应需求：`requirements.md` 需求 6、需求 9
  - 对应设计：`design.md` §4.4、§5.5、§7.2

### 阶段检查

- [ ] 3.5 阶段 3 检查点
  - 状态：TODO
  - 这一步到底做什么：确认移动端文档页确实对齐 PC 文档库，而不是另做一套假文档页。
  - 做完你能看到什么：目录、收藏、标签、详情四条主路径都能走通。
  - 先依赖什么：3.1、3.2、3.3、3.4
  - 开始前先看：
    - `requirements.md` 需求 5、需求 6、需求 9
    - `design.md` §2.5、§4.3、§4.4、§5.5
  - 主要改哪里：阶段 3 涉及的全部文件
  - 这一步先不做什么：不补文件系统危险操作，不做标签管理完整移动端编辑器。
  - 怎么算完成：
    1. 文档页四个视图能切换。
    2. 数据来自现有文档库模型。
    3. PC 文档库测试不回退。
  - 怎么验证：
    - 人工移动端走查：浏览 → 收藏 → 标签 → 详情
    - 运行阶段 3 相关最小测试
  - 对应需求：`requirements.md` 需求 5、需求 6、需求 9
  - 对应设计：`design.md` §2.5、§5.5、§8.3

---

## 阶段 4：工作台、兼容和最终验收

- [ ] 4.1 实现移动端事务工作台页
  - 状态：TODO
  - 这一步到底做什么：移动端工作台展示事务事项的待处理、进行中、已完成、异常分组。
  - 做完你能看到什么：底部点击“工作台”后看到事务事项卡片流，而不是代码会话列表。
  - 先依赖什么：1.4、2.4
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §2.6「工作台页结构」
    - 当前 `AffairsWorkbenchView.tsx` 工作台相关逻辑
  - 主要改哪里：
    - `apps/user-app/src/features/mobile-affairs/pages/MobileAffairsWorkbenchPage.tsx`
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`（只抽必要数据，不大改 PC 页面）
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步先不做什么：不把代码会话塞进工作台，不做完整拖拽画布移动端版。
  - 怎么算完成：
    1. 工作台能显示事务事项分组。
    2. 事项能跳到关联文档或对话。
    3. 空态清楚。
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/mobile-affairs/pages/MobileAffairsWorkbenchPage.tsx`
  - 对应需求：`requirements.md` 需求 7、需求 9
  - 对应设计：`design.md` §2.6、§5.6

- [ ] 4.2 路由兼容和旧入口收口
  - 状态：TODO
  - 这一步到底做什么：处理旧移动端会话、工具、设置入口，确保不会因为导航改名导致旧链接白屏。
  - 做完你能看到什么：旧 `/sessions`、工作区会话路由、工具兼容路由都有明确去处。
  - 先依赖什么：2.4、3.5、4.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 9
    - `design.md` §6「路由设计」
  - 主要改哪里：
    - 移动端路由配置相关文件
    - `apps/user-app/src/features/mobile-shell/components/mobile-workbench-shell-route.ts`
    - `apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.tsx`
  - 这一步先不做什么：不清理所有历史命名，只保证兼容和用户路径不坏。
  - 怎么算完成：
    1. 旧代码会话列表入口高亮到“代码”。
    2. 旧设置入口能从头像菜单进入。
    3. 旧工具路由仍按 009.2 策略可恢复。
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/mobile-shell/components/mobile-workbench-shell-route.ts apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.tsx`
  - 对应需求：`requirements.md` 需求 1、需求 9
  - 对应设计：`design.md` §6、§7

- [ ] 4.3 样式收口和移动端视觉走查
  - 状态：TODO
  - 这一步到底做什么：统一五个移动端页面的紧凑 Header、列表、按钮、底部导航和 sheet 样式。
  - 做完你能看到什么：首页、对话、代码、文档、工作台看起来是一套产品，不是五个临时页面。
  - 先依赖什么：4.2
  - 开始前先看：
    - `requirements.md` 需求 8
    - `design.md` §5「页面和组件设计」
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
  - 主要改哪里：
    - `apps/user-app/src/app/styles.css`
    - 各移动端页面相关 CSS
    - 新增页面组件文件
  - 这一步先不做什么：不发明新的按钮皮肤，不改桌面端全局视觉。
  - 怎么算完成：
    1. 页面密度接近当前移动端样式，不大面积空白。
    2. 触控入口足够大。
    3. 没有硬编码用户可见中文。
  - 怎么验证：
    - 人工移动端视觉走查
    - `pnpm test:related -- apps/user-app/src/app/styles.css`
  - 对应需求：`requirements.md` 需求 8、需求 9
  - 对应设计：`design.md` §5、§7

### 最终检查

- [ ] 4.4 最终检查点
  - 状态：TODO
  - 这一步到底做什么：确认 spec009.3 的页面结构、数据来源、兼容路径和测试都对上。
  - 做完你能看到什么：移动端新结构可以进入正式验收，不再停留在静态原型。
  - 先依赖什么：4.1、4.2、4.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：当前 Spec 涉及的全部文件
  - 这一步先不做什么：不追加新需求，不补第二阶段功能。
  - 怎么算完成：
    1. 五个底部入口都能走通。
    2. 首页能聚合代码和事务摘要。
    3. 对话和代码职责分离。
    4. 文档库移动端四视图能走通。
    5. PC 事务文档库不回退。
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.tsx apps/user-app/src/features/mobile-home/pages/MobileHomePage.tsx apps/user-app/src/features/mobile-affairs-library/pages/MobileAffairsLibraryPage.tsx apps/user-app/src/features/mobile-sessions/pages/SessionIndexPage.tsx`
    - 人工走查移动端：首页 → 对话 → 代码 → 文档 → 工作台
    - 人工走查 PC 端：事务视图 → 文档库目录 → 标签 → 对象详情
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全部关键章节
