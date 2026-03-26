# 验收清单

这份清单是给验收和回归用的，不是装样子。

只要有一项没过，就不要说这个子 Spec 已经彻底收口。

## 1. 先看结构是不是已经换了，不要再拿旧抽屉糊弄

- [x] 已登录后，工作台路由已经不是单一 `WorkbenchLayout` 直接承载全部平台
- [x] `compact / medium / expanded` 三档宽度等级已经可被壳层和页面消费
- [x] `web / ios / android` 运行时识别已经接入
- [x] 移动端一级目的地固定为 `工作区 / 会话 / 工具 / 设置`
- [x] 桌面端主路径仍然保留原有三栏工作台

怎么验：

- 看路由是否已经通过 `WorkbenchShellRoute` 分流
- 看紧凑宽度时是否进入移动壳，而不是继续走桌面双抽屉

对应文件：

- `apps/user-app/src/app/router.tsx`
- `apps/user-app/src/features/workbench/components/WorkbenchShellRoute.tsx`
- `apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.tsx`

## 2. 移动端主路径是不是已经脱离桌面残影

- [x] 手机竖屏进入后，不再靠左抽屉承担一级导航
- [x] 手机竖屏进入后，不再靠右抽屉承担文件 / Git / 终端主入口
- [x] 左右边缘手柄已经退出移动端主路径
- [x] 顶部和底部都有可见导航入口，用户不用先猜桌面三栏逻辑

怎么验：

- 在移动壳进入 `/`、`/sessions`、`/tools` 时，不应再看到边缘手柄
- 一级跳转应通过顶部按钮和底部导航完成

对应测试：

- `apps/user-app/src/features/conversation/components/WorkbenchLayout.test.tsx`
- `apps/user-app/src/features/workbench/components/WorkbenchShellRoute.test.ts`

## 3. 页面层级是不是已经完整

### 工作区

- [x] `/` 在移动端进入工作区首页
- [x] 工作区首页可以进入工作区详情 `/workspaces/:workspaceId`
- [x] 工作区首页可以直接发起导入、Clone、新建会话
- [x] 工作区详情可以继续进入文件、Git、终端、进程相关入口

### 会话

- [x] `/sessions` 已独立成会话索引页
- [x] 会话索引页能看到最近、收藏、当前工作区三个区块
- [x] `/sessions/:sessionId` 继续复用现有会话详情，不破坏消息流和输入区

### 工具

- [x] `/tools` 已独立成工具首页
- [x] `/tools/files` 可进入文件页
- [x] `/tools/git` 可进入 Git 页
- [x] `/tools/processes` 可进入进程管理页
- [x] `/terminals` 保持终端重操作全屏页
- [ ] 日志页未单独拆出

说明：

- 日志页这次没做，不是漏了，是刻意没做。当前还没有一个足够成熟的日志页实体，硬拆只会做出垃圾。

## 4. 动作是不是已经按移动端方式收过一遍

- [x] 新建会话保留一级直达
- [x] 搜索保留独立入口，不再依赖桌面侧栏头部
- [x] 导入工作区和 Clone 项目已经进入工作区首页表单流
- [x] 会话收藏、归档、重命名已经收进“更多操作”菜单
- [x] 手机列表项不再并排摆三四个小按钮
- [x] 工作区和工具页优先保留主操作，低频动作收进详情或菜单
- [ ] 批量选择会话尚未迁成独立移动编辑模式

说明：

- 这次选择的是“菜单优先”，没有额外加长按和编辑模式。
- 原因很简单：真实问题是手机上按钮太挤，不是手势不够花。先把高频和低频动作分清，比硬上复杂交互更有价值。

对应文件：

- `apps/user-app/src/features/mobile-sessions/components/SessionListItem.tsx`
- `apps/user-app/src/features/mobile-workspaces/pages/WorkspaceHomePage.tsx`
- `apps/user-app/src/features/mobile-workspaces/pages/WorkspaceDetailPage.tsx`

## 5. 工具流是不是已经真正页面化

- [x] 文件不再只能作为手机右侧栏 tab 使用
- [x] Git 不再只能作为手机右侧栏 tab 使用
- [x] 终端管理不再只能作为手机右侧栏 tab 使用
- [x] 工具首页已经把入口收成单独页面
- [x] 文件 / Git / 进程页无工作区时会显示空态，不会直接崩
- [x] 工具流只保留一套实现，不再存在双份页面代码

怎么验：

- 检查 `mobile-tools` 下只保留一套 `ToolsHomePage / ToolFilesPage / ToolGitPage / ToolProcessesPage`
- Router 不再引用重复实现目录

## 6. 三端壳是不是符合各自习惯

### H5

- [x] 底部导航、安全区、动态视口高度已经接入
- [x] 键盘弹起时底部导航会让路，不和输入区打架
- [x] 不依赖浏览器返回作为唯一返回路径

### iOS

- [x] 主导航符合 Tab Bar + Navigation Stack 思路
- [x] 次操作进入 action sheet
- [x] 详情路径提供显式返回按钮

### Android

- [x] 主导航符合 Bottom Navigation + Top App Bar 思路
- [x] 次操作进入 bottom sheet
- [x] 返回路径跟当前页面状态一致

对应测试：

- `apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.test.tsx`
- `apps/user-app/src/features/mobile-shell/ios/IosWorkbenchShell.test.tsx`
- `apps/user-app/src/features/mobile-shell/android/AndroidWorkbenchShell.test.tsx`

## 7. 宽度变化是不是不会把上下文弄丢

- [x] `compact` 是单栏堆栈式
- [x] `medium` 会按当前入口停靠一个面板
- [x] `expanded` 可以常驻导航面板和辅助面板
- [x] 宽度变化后不会丢掉当前入口和当前工作区上下文

对应测试：

- `apps/user-app/src/features/mobile-shell/layouts/AdaptiveMobilePaneLayout.test.ts`
- `apps/user-app/src/features/conversation/components/WorkbenchLayout.test.tsx`

## 8. 桌面端有没有被顺手打坏

- [x] 桌面端三栏工作台主路径仍可用
- [x] 桌面端工作区、会话、文件、Git、终端主流程没有被本轮移动端改造带崩
- [x] `WorkbenchLayout` 相关历史测试仍然通过
- [x] `App.test.tsx` 主应用路由测试仍然通过

## 9. 自动化验证结果

本轮已经跑过这些验证：

1. `pnpm --dir apps/user-app exec vitest run --maxWorkers=1 src/features/mobile-workspaces/pages/WorkspaceHomePage.test.tsx src/features/mobile-workspaces/pages/WorkspaceDetailPage.test.tsx src/features/mobile-sessions/pages/SessionIndexPage.test.tsx src/features/mobile-tools/ToolsHomePage.test.tsx src/features/mobile-tools/ToolFilesPage.test.tsx src/features/mobile-tools/ToolGitPage.test.tsx src/features/mobile-tools/ToolProcessesPage.test.tsx src/features/conversation/components/WorkbenchLayout.test.tsx src/features/workbench/components/WorkbenchShellRoute.test.ts src/app/App.test.tsx`
2. `pnpm --dir apps/user-app build`

当前结果：

- 相关 48 个测试已通过
- build 已通过
- 仍有 chunk 体积和动态导入失效 warning，但不阻塞当前功能交付

## 10. 这次验收到哪里，哪里还没做

这次已经完成：

- 移动壳
- 工作区流
- 会话索引页
- 工具流
- 动作菜单与搜索入口收口
- 三端相关自动化回归

这次明确没做：

- 日志独立页
- 移动端独立批量编辑模式
- 真机截图和交互动图归档
- 工具页拆分后的进一步性能分包优化

一句话判断标准：

现在已经可以说“移动端主路径不再是桌面三栏缩小版”，但还不能说“所有移动端细节都打磨完了”。功能路径已经完整，剩余是局部深化，不是主骨架没做完。
