# 任务清单 - spec009.1 移动端工作台导航与信息架构重构（人话版）

状态：IN_PROGRESS

## 2026-03-26 进展补记

- 已确认这个子 Spec 只处理“当前 PC 三栏工作台如何改造成移动端导航和信息架构”。
- 已确认当前移动端主要问题不是功能缺失，而是继续沿用桌面双侧栏和边缘手柄思路。
- 已完成本子 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化。
- 已回写 `spec009` 与 `spec009.1` 的职责边界。
- 已补当前工作台入口与动作迁移矩阵、宽度分级说明。
- 已补移动端导航层级图和动作呈现规则。
- 已补实施切片、迁移说明和验收清单草稿。

## 这份文档是干什么的

这份任务清单用来把“移动端三栏改造”拆成能落地的步骤。

它必须始终回答清楚下面几件事：

1. 这一步到底要建什么
2. 做完以后用户能看到什么变化
3. 依赖什么
4. 主要改哪些文件
5. 这一步明确不做什么
6. 怎么验证不是假完成

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被别的问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并验证
- `CANCELLED`：取消并写原因

执行规则：

- 只有 `状态：DONE` 才能勾选 `[x]`
- 每完成一个任务，必须立刻回写本文档
- `BLOCKED` 和 `CANCELLED` 必须写明原因和后续处理

---

## 阶段 0：先把范围钉死，别把桌面垃圾原样带到手机上

- [x] 0.1 启动 spec009.1 并完成范围收敛
  - 状态：DONE
  - 这一步到底做什么：明确本子 Spec 只解决移动端导航、信息架构、动作改造，不去重写业务协议。
  - 做完你能看到什么：`spec009.1` 目录、主文档和任务清单已经建立。
  - 先依赖什么：`spec009`
  - 主要改哪些文件：
    - `specs/spec009.1-移动端工作台导航与信息架构重构/README.md`
    - `specs/spec009.1-移动端工作台导航与信息架构重构/requirements.md`
    - `specs/spec009.1-移动端工作台导航与信息架构重构/design.md`
    - `specs/spec009.1-移动端工作台导航与信息架构重构/tasks.md`
    - `specs/spec009.1-移动端工作台导航与信息架构重构/docs/README.md`
  - 这一步明确不做什么：不直接改业务代码。
  - 怎么算完成：
    1. 子 Spec 文档落盘
    2. 范围、依赖、非目标已写清楚
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成 `spec009.1` 主文档初始化

- [x] 0.2 盘点当前三栏工作台和移动端问题
  - 状态：DONE
  - 这一步到底做什么：确认当前 `WorkbenchLayout` 的移动端不是新架构，而是桌面双侧栏的折叠版。
  - 做完你能看到什么：后续设计建立在真实问题上，不靠猜。
  - 先依赖什么：无
  - 主要改哪些文件：文档分析阶段，无代码改动
  - 这一步明确不做什么：不在这个阶段修改 UI。
  - 怎么算完成：
    1. 已识别当前移动端依赖左右抽屉和边缘手柄
    2. 已识别左栏、右栏、小图标的职责堆叠问题
  - 怎么验证：
    - 代码走查
    - 产品文档对照
  - 验证结果：
    - 已走查 `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - 已对照 `docs/产品方案/20260322-码不能停-产品方案与技术规划.md`

- [x] 0.3 确认与 spec009 主 Spec 的边界和引用关系
  - 状态：DONE
  - 这一步到底做什么：把 `spec009.1` 明确标成 `spec009` 的子问题，避免后面把通知、权限、分享也塞进来。
  - 做完你能看到什么：后续任务边界清楚，不会扩成大杂烩。
  - 先依赖什么：0.1
  - 主要改哪些文件：
    - `specs/spec009-移动端体验与通知/*`
    - `specs/spec009.1-移动端工作台导航与信息架构重构/*`
  - 这一步明确不做什么：不改动主业务代码。
  - 怎么算完成：
    1. 主 Spec 与子 Spec 的职责边界清楚
    2. 不再出现重复定义
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已在 `spec009/README.md` 增加子 Spec 拆分说明
    - 已在 `spec009/design.md` 增加 `1.5 与 spec009.1 的边界`
    - 已在 `spec009/tasks.md` 回写 `spec009.1` 的职责说明

---

## 阶段 1：先把“手机里到底有哪些页面”说清楚

- [x] 1.1 盘点当前工作台所有入口和小图标动作
  - 状态：DONE
  - 这一步到底做什么：列出当前工作区、会话、搜索、文件、Git、终端、批量选择、导入、克隆、收藏、归档等全部入口。
  - 做完你能看到什么：不会漏掉 PC 上已有但移动端还没安排位置的能力。
  - 先依赖什么：0.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `specs/spec009.1-移动端工作台导航与信息架构重构/design.md`
    - `specs/spec009.1-移动端工作台导航与信息架构重构/docs/*`
  - 这一步明确不做什么：先不改交互实现。
  - 怎么算完成：
    1. 有完整动作清单
    2. 每个动作都有“高频 / 次要 / 风险”分级
  - 怎么验证：
    - 设计走查
    - 入口矩阵核对
  - 验证结果：
    - 已新增 `docs/interaction-matrix.md`
    - 已新增 `docs/breakpoints.md`
    - 已按左侧导航、工作区区块、会话卡片、右侧信息栏、移动端边缘手柄五类盘点当前入口

- [x] 1.2 定义移动端一级导航、二级页面和路由意图
  - 状态：DONE
  - 这一步到底做什么：把工作区、会话、工具、设置这些目的地和工作区详情、会话详情、工具子页的层级关系定死。
  - 做完你能看到什么：移动端不再靠抽屉理解结构。
  - 先依赖什么：1.1
  - 主要改哪些文件：
    - `specs/spec009.1-移动端工作台导航与信息架构重构/design.md`
    - `apps/user-app/src/app/router.tsx`
    - `apps/user-app/src/features/mobile-shell/*`（预期新增）
  - 这一步明确不做什么：先不补页面视觉细节。
  - 怎么算完成：
    1. 一级导航目的地固定
    2. 列表页、详情页、工具页关系清楚
  - 怎么验证：
    - 路由草图走查
    - 设计评审
  - 验证结果：
    - `design.md` 已固定 `工作区 / 会话 / 工具 / 设置` 四个一级目的地
    - 已新增 `docs/navigation-map.md`
    - 已明确工作区流、会话流、工具流、设置流的页面层级和返回规则

- [x] 1.3 定义动作迁移矩阵和平台呈现规则
  - 状态：DONE
  - 这一步到底做什么：规定哪些动作做直达按钮，哪些动作进菜单，哪些动作进编辑模式或确认流。
  - 做完你能看到什么：小图标不再漫无目的地散在头部和列表里。
  - 先依赖什么：1.1、1.2
  - 主要改哪些文件：
    - `specs/spec009.1-移动端工作台导航与信息架构重构/design.md`
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步明确不做什么：先不接平台特有样式。
  - 怎么算完成：
    1. 每个动作有明确呈现方式
    2. 主操作和次操作边界清楚
  - 怎么验证：
    - 动作矩阵评审
    - 交互稿走查
  - 验证结果：
    - 已新增 `docs/action-presentation-rules.md`
    - `docs/interaction-matrix.md` 已把当前动作迁移到按钮、菜单、sheet、编辑模式
    - 已明确 H5 / iOS / Android 三端的动作呈现差异

---

## 阶段 2：把共享移动端壳立起来

- [x] 2.1 引入 `compact / medium / expanded` 宽度等级模型
  - 状态：DONE
  - 这一步到底做什么：把当前单一 `720px` 断点升级为宽度等级模型。
  - 做完你能看到什么：后续页面不再只能“桌面”或“手机”二选一。
  - 先依赖什么：1.2
  - 主要改哪些文件：
    - `apps/user-app/src/platform/platform-adapter.ts`
    - `apps/user-app/src/platform/platform-provider.tsx`
    - `apps/user-app/src/app/styles.css`
  - 这一步明确不做什么：不先改业务页面细节。
  - 怎么算完成：
    1. 页面能识别 3 档宽度
    2. 宽度等级可被壳和页面消费
  - 怎么验证：
    - 单元测试
    - 断点走查
  - 验证结果：
    - 已在 `platform-adapter.ts` 增加 `ViewportClass`、`resolveViewportClass()` 和 `ios/android` runtime 识别
    - 已在 `PlatformProvider` 监听 `resize`，并把 `data-viewport-class` 写入 DOM dataset
    - 已新增 `src/platform/platform-adapter.test.ts`，覆盖三档宽度和 iOS / Android runtime 识别

- [x] 2.2 新建移动端工作台壳，不再直接复用桌面双抽屉主路径
  - 状态：DONE
  - 这一步到底做什么：建立 `MobileWorkbenchShell`，让紧凑宽度走新的页面结构，而不是继续走 `WorkbenchLayout` 的左右抽屉。
  - 做完你能看到什么：移动端终于有自己的骨架。
  - 先依赖什么：2.1
  - 主要改哪些文件：
    - `apps/user-app/src/app/router.tsx`
    - `apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.tsx`
    - `apps/user-app/src/features/workbench/components/WorkbenchShellRoute.tsx`
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/features/workbench/pages/WorkbenchPlaceholderPage.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
  - 这一步明确不做什么：先不做所有页面内容。
  - 怎么算完成：
    1. 紧凑宽度不再依赖左右抽屉作为主导航
    2. 移动端壳能承载底部一级导航和详情栈
  - 怎么验证：
    - 路由冒烟测试
    - 手动走查
  - 验证结果：
    - 已新增 `MobileWorkbenchShell`，提供顶部操作区和底部一级导航
    - 已新增 `WorkbenchShellRoute`，把 router 从单一 `WorkbenchLayout` 改成桌面壳 / 移动壳分流
    - `WorkbenchLayout` 已改成共享状态容器，桌面壳与移动壳共用同一套 workbench context
    - 已新增 `src/features/workbench/components/WorkbenchShellRoute.test.ts`
    - 已回归 `src/features/conversation/components/WorkbenchLayout.test.tsx`
    - 已通过 `pnpm --dir apps/user-app build`

- [x] 2.3 清理边缘手柄和移动端侧栏主路径
  - 状态：DONE
  - 这一步到底做什么：把当前 `mobile-sidebar-handle`、双抽屉入口从主流程里退场。
  - 做完你能看到什么：不会再和 iOS / Android 系统边缘手势打架。
  - 先依赖什么：2.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/app/styles.css`
  - 这一步明确不做什么：不删除桌面端侧栏能力。
  - 怎么算完成：
    1. 紧凑宽度主流程里没有左右边缘手柄
    2. 主导航都能通过可见入口到达
  - 怎么验证：
    - iOS / Android 手势走查
    - 移动端交互回归
  - 验证结果：
    - 已删除 `WorkbenchLayout.tsx` 中未再使用的 `MobileSidebarHandle`
    - 已删除 `styles.css` 中全部 `mobile-sidebar-handle*` 样式和对应主题变量
    - 已保留 `MobileNavDrawer` 作为移动端顶部按钮触发的抽屉，不再把边缘手柄当主入口
    - 已新增移动壳回归测试，断言没有边缘手柄 DOM，且可通过顶部按钮打开主导航
    - 已通过 `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/WorkbenchLayout.test.tsx src/features/workbench/components/WorkbenchShellRoute.test.ts src/platform/platform-adapter.test.ts`
    - 当前分支已通过 `pnpm --dir apps/user-app build`

---

## 阶段 3：分别把 H5、iOS、Android 的壳做对

- [x] 3.1 落地 H5 移动端壳和响应式安全区处理
  - 状态：DONE
  - 这一步到底做什么：让 H5 移动端具备底部导航、动态视口高度、安全区和键盘联动处理。
  - 做完你能看到什么：手机浏览器里终于不是桌面网页缩放版。
  - 先依赖什么：2.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-shell/h5/*`（预期新增）
    - `apps/user-app/src/app/styles.css`
  - 这一步明确不做什么：不伪装系统原生皮肤。
  - 怎么算完成：
    1. H5 紧凑宽度壳可用
    2. 键盘、底部导航、安全区不打架
  - 怎么验证：
    - 手机浏览器走查
    - 响应式回归测试
  - 验证结果：
    - 已新增 `src/features/mobile-shell/h5/useH5ViewportState.ts`，基于 `visualViewport` 同步真实可视高度和键盘状态
    - `MobileWorkbenchShell` 已接入 H5 运行时判断，键盘弹起时自动收起底部导航，避免与输入区冲突
    - `styles.css` 已补 H5 壳的安全区变量、动态视口高度和移动抽屉安全区处理
    - 已新增 `src/features/mobile-shell/components/MobileWorkbenchShell.test.tsx`，覆盖真实视口高度同步、键盘弹起隐藏底部导航、卸载清理根节点状态
    - 已通过 `pnpm --dir apps/user-app exec vitest run src/features/mobile-shell/components/MobileWorkbenchShell.test.tsx src/features/workbench/components/WorkbenchShellRoute.test.ts src/features/conversation/components/WorkbenchLayout.test.tsx src/platform/platform-adapter.test.ts`
    - 已通过 `pnpm --dir apps/user-app build`

- [x] 3.2 落地 iOS 导航壳
  - 状态：DONE
  - 这一步到底做什么：实现 iOS 风格的 Tab Bar、Navigation Bar、sheet 和详情栈。
  - 做完你能看到什么：iPhone 上的主流程看起来像 iOS 应用。
  - 先依赖什么：2.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-shell/ios/*`（预期新增）
    - `apps/user-app/src/shared/theme/*`
  - 这一步明确不做什么：不复制 Android 呈现细节。
  - 怎么算完成：
    1. iOS 主导航和返回路径正确
    2. 次操作通过 menu / sheet 呈现
  - 怎么验证：
    - iPhone 模拟器走查
    - 返回与转场验证
  - 验证结果：
    - 已新增 `src/features/mobile-shell/ios/IosWorkbenchShell.tsx`，为 iOS runtime 提供独立 Navigation Bar、Tab Bar 和 action sheet
    - `MobileWorkbenchShell` 已按 runtime 分流到 iOS 专属壳，不再继续复用 H5 头部和底栏样式
    - 会话详情等非顶层路径已提供显式返回按钮，避免只依赖系统返回或浏览器返回
    - 次操作已收进 iOS action sheet，顶部常驻区只保留导航、搜索和更多入口
    - 已新增 `src/features/mobile-shell/ios/IosWorkbenchShell.test.tsx`，覆盖详情页返回和 action sheet 行为
    - 已通过 `pnpm --dir apps/user-app exec vitest run src/features/mobile-shell/components/MobileWorkbenchShell.test.tsx src/features/mobile-shell/ios/IosWorkbenchShell.test.tsx src/features/workbench/components/WorkbenchShellRoute.test.ts src/features/conversation/components/WorkbenchLayout.test.tsx src/platform/platform-adapter.test.ts`
    - 已通过 `pnpm --dir apps/user-app build`

- [x] 3.3 落地 Android 导航壳
  - 状态：DONE
  - 这一步到底做什么：实现 Android 风格的 Top App Bar、Bottom Navigation、Bottom Sheet 和 back stack。
  - 做完你能看到什么：Android 上的主流程看起来像 Android 应用。
  - 先依赖什么：2.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-shell/android/*`（预期新增）
    - `apps/user-app/src/shared/theme/*`
  - 这一步明确不做什么：不照抄 iOS 壳。
  - 怎么算完成：
    1. Android 系统返回和页面状态一致
    2. 更多操作和主操作符合 Material 习惯
  - 怎么验证：
    - Android 模拟器走查
    - back stack 验证
  - 验证结果：
    - 已新增 `src/features/mobile-shell/android/AndroidWorkbenchShell.tsx`，为 Android runtime 提供 Top App Bar、Bottom Navigation 和 bottom sheet
    - `MobileWorkbenchShell` 已按 runtime 分流到 Android 专属壳，不再共用 iOS / H5 的顶部与底部容器
    - 非顶层路径已提供显式返回按钮，详情页返回优先走当前 back stack
    - 次操作已收进 Android bottom sheet，主界面只保留导航、搜索和更多入口
    - 已新增 `src/features/mobile-shell/android/AndroidWorkbenchShell.test.tsx`，覆盖详情返回和 bottom sheet 行为
    - 已通过 `pnpm --dir apps/user-app exec vitest run src/features/mobile-shell/android/AndroidWorkbenchShell.test.tsx src/features/mobile-shell/ios/IosWorkbenchShell.test.tsx src/features/mobile-shell/components/MobileWorkbenchShell.test.tsx src/features/workbench/components/WorkbenchShellRoute.test.ts src/features/conversation/components/WorkbenchLayout.test.tsx src/platform/platform-adapter.test.ts`
    - 已通过 `pnpm --dir apps/user-app build`

- [ ] 3.4 落地中宽度和大宽度自适应布局
  - 状态：TODO
  - 这一步到底做什么：为平板、折叠屏和更宽窗口增加列表 + 详情或双区布局。
  - 做完你能看到什么：不是把手机单栏页面强行拉宽。
  - 先依赖什么：2.1、3.1、3.2、3.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-shell/layouts/*`（预期新增）
    - `apps/user-app/src/app/styles.css`
  - 这一步明确不做什么：不回退成旧桌面抽屉思路。
  - 怎么算完成：
    1. `medium` 和 `expanded` 有明确布局策略
    2. 宽度变化不丢上下文
  - 怎么验证：
    - 平板和折叠屏模拟器走查
    - 断点切换测试

---

## 阶段 4：把工作区、会话、工具三大域迁进去

- [ ] 4.1 改造工作区首页和工作区详情页
  - 状态：TODO
  - 这一步到底做什么：把导入、克隆、切换、新建会话、工作区详情这些入口从旧左栏拆出来。
  - 做完你能看到什么：工作区相关任务都能在工作区域完成，不需要先打开侧栏。
  - 先依赖什么：3.1、3.2、3.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-workspaces/*`（预期新增）
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
  - 这一步明确不做什么：不在这里实现所有工具页细节。
  - 怎么算完成：
    1. 工作区总览和详情页可用
    2. 导入、克隆、新建会话入口都可见
  - 怎么验证：
    - 工作区流程走查
    - 相关测试补充

- [ ] 4.2 改造会话索引页和会话详情页
  - 状态：TODO
  - 这一步到底做什么：把最近会话、收藏、归档、重命名、消息流和输入区放进移动端正确位置。
  - 做完你能看到什么：会话页终于是“会话页”，不是工作台中间那块被抽离出来的半成品。
  - 先依赖什么：3.1、3.2、3.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-sessions/*`（预期新增）
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
  - 这一步明确不做什么：不在会话页常驻文件树和 Git 面板。
  - 怎么算完成：
    1. 会话索引可浏览最近/收藏
    2. 会话详情可沉浸使用
  - 怎么验证：
    - 会话主流程回归测试
    - 移动端输入区走查

- [ ] 4.3 改造工具页和工具子页
  - 状态：TODO
  - 这一步到底做什么：把文件、Git、终端、进程、日志这类能力迁进工具流。
  - 做完你能看到什么：右信息栏的职责被拆散到合理的移动端页面里。
  - 先依赖什么：3.1、3.2、3.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-tools/*`（预期新增）
    - `apps/user-app/src/features/conversation/components/FileContextPanel.tsx`
    - `apps/user-app/src/features/conversation/components/GitSidebar.tsx`
    - `apps/user-app/src/features/workbench/components/TerminalManagerPanel.tsx`
  - 这一步明确不做什么：不删除现有领域能力。
  - 怎么算完成：
    1. 文件、Git、终端、进程可从工具流进入
    2. 重操作页可升级成全屏
  - 怎么验证：
    - 工具流手动走查
    - 相关页面测试

- [ ] 4.4 改造动作菜单、编辑模式和搜索入口
  - 状态：TODO
  - 这一步到底做什么：把当前散落在桌面列表头和行尾的小图标收敛成菜单、长按动作、编辑模式和独立搜索入口。
  - 做完你能看到什么：手机上不再看到一堆密集小图标。
  - 先依赖什么：1.3、3.1、3.2、3.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-shared/*`（预期新增）
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步明确不做什么：不牺牲高频主操作。
  - 怎么算完成：
    1. 高风险和低频动作已迁入正确呈现方式
    2. 搜索入口独立清晰
  - 怎么验证：
    - 交互走查
    - 文案与 i18n 检查

---

## 阶段 5：回归验证和收口

- [ ] 5.1 完成 H5 / iOS / Android 三端回归测试
  - 状态：TODO
  - 这一步到底做什么：验证三端主流程、返回、键盘、安全区、菜单、工具页上下文是否稳定。
  - 做完你能看到什么：这次不是“看起来能用”，而是真的可回归。
  - 先依赖什么：4.1、4.2、4.3、4.4
  - 主要改哪些文件：
    - `apps/user-app/src/**/*.test.tsx`
    - `apps/user-app/src/**/*.test.ts`
    - `specs/spec009.1-移动端工作台导航与信息架构重构/docs/*`
  - 这一步明确不做什么：不继续扩范围加新功能。
  - 怎么算完成：
    1. 三端主流程都通过
    2. 关键断点和手势冲突都被覆盖
  - 怎么验证：
    - 自动化测试
    - 模拟器和真机走查

- [ ] 5.2 输出验收清单和迁移说明
  - 状态：TODO
  - 这一步到底做什么：把改造前后的入口变化、已完成范围和残留风险写清楚。
  - 做完你能看到什么：后续接手的人知道哪里变了，怎么验收。
  - 先依赖什么：5.1
  - 主要改哪些文件：
    - `specs/spec009.1-移动端工作台导航与信息架构重构/docs/acceptance-checklist.md`
    - `specs/spec009.1-移动端工作台导航与信息架构重构/docs/migration.md`
  - 这一步明确不做什么：不再改动主逻辑。
  - 怎么算完成：
    1. 验收清单可执行
    2. 迁移说明可读
  - 怎么验证：
    - 文档走查
