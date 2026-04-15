# 任务清单 - spec009.2 移动端对话主入口与助手侧栏重构（人话版）

状态：Draft

## 2026-04-15 进展补记

- 已确认本子 Spec 编号为 `spec009.2`。
- 已确认“助手”就是当前 `butler` 页面，对外文案统一改成“助手”。
- 已完成当前移动端入口、对话页手势结构、终端页抽屉结构、助手页头部与标签结构的代码盘点。
- 已完成 `spec009.2` 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化。
- 已补手势与返回矩阵、旧路由兼容说明草稿。
- 已计划在实施阶段同步回写本任务清单。

## 这份文档是干什么的

这份任务清单只服务一个目标：

- 把移动端“对话 / 终端 / 助手”三条主路径重新排顺

它必须始终回答清楚：

1. 这一步到底建什么
2. 做完以后用户能看到什么
3. 依赖什么
4. 主要改哪些文件
5. 这一步明确不做什么
6. 怎么验证不是假完成

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并验证
- `CANCELLED`：取消并写原因

规则：

- 只有 `状态：DONE` 才能勾选 `[x]`
- 每完成一个任务，必须立刻回写本文档
- `BLOCKED` 和 `CANCELLED` 必须说明原因和后续处理

---

## 阶段 0：先把范围钉死，别把入口改着改着又长回一锅粥

- [x] 0.1 启动 spec009.2 并完成范围收敛
  - 状态：DONE
  - 这一步到底做什么：明确本子 Spec 只处理移动端对话主入口、底部导航职责调整、助手页左右侧页，不扩成新的业务 Spec。
  - 做完你能看到什么：`spec009.2` 目录和主文档已经落盘。
  - 先依赖什么：`spec009`、`spec009.1`
  - 主要改哪些文件：
    - `specs/spec009.2-移动端对话主入口与助手侧栏重构/README.md`
    - `specs/spec009.2-移动端对话主入口与助手侧栏重构/requirements.md`
    - `specs/spec009.2-移动端对话主入口与助手侧栏重构/design.md`
    - `specs/spec009.2-移动端对话主入口与助手侧栏重构/tasks.md`
    - `specs/spec009.2-移动端对话主入口与助手侧栏重构/docs/README.md`
  - 这一步明确不做什么：不直接改业务代码。
  - 怎么算完成：
    1. 子 Spec 文档已创建
    2. 范围、依赖、非目标写清楚
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成 `spec009.2` 主文档初始化

- [x] 0.2 盘点当前移动端入口、路由和手势实现
  - 状态：DONE
  - 这一步到底做什么：确认当前底部导航、对话页左滑轨道、终端页抽屉、助手页头部和标签分别长在哪里。
  - 做完你能看到什么：后面的设计不会凭空假设。
  - 先依赖什么：无
  - 主要改哪些文件：文档分析阶段，无代码改动
  - 这一步明确不做什么：不在这个阶段调整 UI。
  - 怎么算完成：
    1. 已识别底部导航现状
    2. 已识别对话页、终端页、助手页各自复用点
  - 怎么验证：
    - 代码走查
  - 验证结果：
    - 已走查 `MobileWorkbenchShell.tsx`
    - 已走查 `WorkbenchLayout.tsx`
    - 已走查 `ConversationPage.tsx`
    - 已走查 `TerminalPage.tsx`
    - 已走查 `MobileButlerPage.tsx`

---

## 阶段 1：先把壳层入口改对

- [ ] 1.1 调整移动端底部导航入口和激活态
  - 状态：TODO
  - 这一步到底做什么：把 `tools` 一级入口替换成 `butler`，并让原工具位置跳终端、原终端位置跳助手。
  - 做完你能看到什么：底部导航的按钮名和实际页面终于对得上。
  - 先依赖什么：0.1、0.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-shell/components/mobile-workbench-shell-types.ts`
    - `apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.tsx`
    - `apps/user-app/src/features/mobile-shell/android/AndroidWorkbenchShell.tsx`
    - `apps/user-app/src/features/mobile-shell/ios/IosWorkbenchShell.tsx`
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步明确不做什么：先不改对话页和助手页内部结构。
  - 怎么算完成：
    1. 新底部导航顺序和命名生效
    2. 激活态和跳转正确
  - 怎么验证：
    - `WorkbenchLayout` 与移动壳测试
    - 手动点按跳转

- [ ] 1.2 保留旧工具路由兼容，不让现有入口直接断掉
  - 状态：TODO
  - 这一步到底做什么：给旧的 `/tools`、`/tools/files`、`/tools/git` 安排兼容跳转。
  - 做完你能看到什么：外部深链和旧收藏入口仍能工作。
  - 先依赖什么：1.1
  - 主要改哪些文件：
    - `apps/user-app/src/app/router.tsx`
    - `apps/user-app/src/features/mobile-tools/ToolsHomePage.tsx`
    - `apps/user-app/src/features/mobile-tools/ToolFilesPage.tsx`
    - `apps/user-app/src/features/mobile-tools/ToolGitPage.tsx`
    - `apps/user-app/src/features/workbench/utils/workbench-navigation.ts`
  - 这一步明确不做什么：不在这个阶段重写文件 / Git 面板内容。
  - 怎么算完成：
    1. 旧路由有合理去向
    2. 不会落到死页
  - 怎么验证：
    - 路由测试
    - 手动打开旧地址验证

---

## 阶段 2：把对话页重新拉回主入口

- [ ] 2.1 抽出对话页的文件 / Git 左侧页容器
  - 状态：TODO
  - 这一步到底做什么：把当前对话页的移动端左滑轨道改成文件 / Git 容器。
  - 做完你能看到什么：在对话页就能左滑打开文件和 Git。
  - 先依赖什么：1.1、1.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/conversation/components/FileContextPanel.tsx`
    - `apps/user-app/src/features/conversation/components/GitSidebar.tsx`
    - `apps/user-app/src/features/mobile-sessions/mobile-conversation-state.ts`
  - 这一步明确不做什么：不新增文件 / Git 后端能力。
  - 怎么算完成：
    1. 左滑能打开侧页
    2. 能在文件 / Git 间切换
    3. 当前会话上下文不丢
  - 怎么验证：
    - `ConversationPage` 测试
    - 手动滑动验证

- [ ] 2.2 完成文件 / Git 侧页关闭路径和返回优先级
  - 状态：TODO
  - 这一步到底做什么：保证右滑、返回按钮、系统返回都先回对话页。
  - 做完你能看到什么：侧页不会把用户困住。
  - 先依赖什么：2.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/mobile-shell/components/*`
  - 这一步明确不做什么：不在这里继续引入新的全局导航状态。
  - 怎么算完成：
    1. 三种关闭路径都能工作
    2. 不和系统返回打架
  - 怎么验证：
    - 手势测试
    - 浏览器返回 / 系统返回人工验证

---

## 阶段 3：把助手页补成完整页面

- [ ] 3.1 助手页接入统一工作区切换头
  - 状态：TODO
  - 这一步到底做什么：用 `MobileWorkspaceSwitcherHeader` 替换助手页顶部不统一的结构。
  - 做完你能看到什么：助手页和对话页、终端页头部风格一致。
  - 先依赖什么：1.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/butler/pages/MobileButlerPage.tsx`
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步明确不做什么：先不引入左右侧页。
  - 怎么算完成：
    1. 头部统一
    2. 工作区切换正确
  - 怎么验证：
    - `MobileButlerPage` 测试
    - 手动切换工作区

- [ ] 3.2 助手页增加右滑对话列表侧页
  - 状态：TODO
  - 这一步到底做什么：给助手页补齐右滑打开的对话列表侧页。
  - 做完你能看到什么：助手页不再只有一块主内容。
  - 先依赖什么：3.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/butler/pages/MobileButlerPage.tsx`
    - `apps/user-app/src/features/butler/pages/*`（必要时拆新组件）
  - 这一步明确不做什么：不重写助手后端接口。
  - 怎么算完成：
    1. 右滑可打开
    2. 可点击切换对话
    3. 可关闭返回主内容
  - 怎么验证：
    - 侧页交互测试
    - 手动滑动验证

- [ ] 3.3 助手页增加左滑右侧信息栏和三标签切换
  - 状态：TODO
  - 这一步到底做什么：给助手页补齐左滑打开的右侧信息栏，并把标签扩成 `信息 / 自动化 / 设置`。
  - 做完你能看到什么：助手页的信息、自动化和设置终于有明确归位。
  - 先依赖什么：3.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/butler/pages/MobileButlerPage.tsx`
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步明确不做什么：不在这里扩展新的助手业务能力。
  - 怎么算完成：
    1. 左滑可打开右栏
    2. 三标签切换稳定
    3. `设置` 至少有清晰占位
  - 怎么验证：
    - 组件测试
    - 手动切换验证

---

## 阶段 4：收口兼容、测试和文案

- [ ] 4.1 完成文案统一，把 butler 对外全部叫“助手”
  - 状态：TODO
  - 这一步到底做什么：清理移动端一级入口、页面标题、标签名里的旧文案。
  - 做完你能看到什么：用户不再同时看到 “Butler / 助手 / 终端 / 工具” 乱飞。
  - 先依赖什么：1.1、3.3
  - 主要改哪些文件：
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步明确不做什么：不改接口字段名。
  - 怎么算完成：
    1. 用户可见文案统一
    2. 无硬编码残留
  - 怎么验证：
    - i18n 搜索
    - 页面走查

- [ ] 4.2 补自动化测试并完成一次移动端主路径回归
  - 状态：TODO
  - 这一步到底做什么：把底部导航、对话侧页、助手侧页、旧路由兼容都补进测试。
  - 做完你能看到什么：这次改动不是只靠肉眼检查。
  - 先依赖什么：1.2、2.2、3.3、4.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/pages/ConversationPage.test.tsx`
    - `apps/user-app/src/features/butler/pages/MobileButlerPage.test.tsx`
    - `apps/user-app/src/features/mobile-tools/*.test.tsx`
    - `apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.test.tsx`
  - 这一步明确不做什么：不把无关测试一起重写。
  - 怎么算完成：
    1. 新结构关键路径都有测试
    2. 至少跑通相关测试集
  - 怎么验证：
    - `vitest`
    - 构建验证
