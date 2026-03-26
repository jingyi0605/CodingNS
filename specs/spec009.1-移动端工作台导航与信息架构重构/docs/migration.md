# 迁移说明

这份说明回答四件事：

1. 这次到底改了什么
2. 旧入口怎么迁到新入口
3. 哪些旧路径已经退出移动端主流程
4. 后面接手的人先看什么，别走回头路

## 1. 这次迁移的核心，不是换皮，是换结构

旧版移动端本质上还是桌面三栏的缩小版：

- 左侧抽屉塞导航
- 右侧抽屉塞文件 / Git / 终端
- 手机上很多能力要靠边缘手柄或小图标才能碰到
- 用户得先理解桌面布局，才能在手机上完成操作

新版移动端改成了真正的页面流：

- 一级固定为 `工作区 / 会话 / 工具 / 设置`
- 工作区有首页和详情
- 会话有索引页和详情页
- 工具能力从“右侧栏 tab”改成“工具首页 + 子页”
- 三端壳按 H5 / iOS / Android 各自习惯呈现

一句话说透：

这次不是“把桌面侧栏搬到手机上更好看一点”，而是“把手机主路径从桌面思维里救出来”。

## 2. 用户能直接感知到的变化

### 2.1 进入应用后的第一感觉变了

旧版：

- 进入后还是像桌面工作台
- 入口藏在左右两边
- 手机上找功能要先猜哪边抽屉里有东西

新版：

- 进入后先看到明确的一级目的地
- 工作区、会话、工具分开走，不再混成一个桌面壳
- 主要操作直接露出来，低频操作进菜单

### 2.2 工作区操作变了

旧版：

- 切换工作区、新建会话、导入、Clone 都和侧栏状态绑在一起

新版：

- `/` 直接是工作区首页
- `/workspaces/:workspaceId` 是工作区详情
- 导入、Clone、新建会话从首页和详情页直接进入
- 文件 / Git / 终端入口从工作区详情自然继续往下走

### 2.3 会话操作变了

旧版：

- 手机点“会话”更多时候是回到某个最近会话
- 会话索引逻辑和桌面侧栏混在一起

新版：

- `/sessions` 是独立会话索引页
- 最近、收藏、当前工作区三块分开
- 会话详情继续沿用现有消息流主页面
- 收藏、归档、重命名都收进“更多操作”菜单

### 2.4 工具操作变了

旧版：

- 文件、Git、终端管理主要靠右侧栏承载

新版：

- `/tools` 是工具首页
- `/tools/files`、`/tools/git`、`/tools/processes` 是明确子页
- `/terminals` 继续作为重操作全屏页

## 3. 旧入口到新入口的迁移对照

### 工作区

- 旧：左侧栏里的工作区树
- 新：`/` 工作区首页，`/workspaces/:workspaceId` 工作区详情

### 会话

- 旧：左侧栏里的最近会话 / 收藏 / 工作区会话
- 新：`/sessions`

### 会话详情

- 旧：`/sessions/:sessionId`
- 新：不变，继续沿用

### 文件

- 旧：右侧信息栏的文件 tab
- 新：`/tools/files`

### Git

- 旧：右侧信息栏的 Git tab
- 新：`/tools/git`

### 终端管理

- 旧：右侧信息栏的终端管理 tab
- 新：`/tools/processes`

### 终端重操作

- 旧：`/terminals`
- 新：不变，继续沿用

### 搜索

- 旧：偏桌面侧栏头部语义
- 新：统一由移动壳顶部搜索入口触发

## 4. 已退出移动端主流程的旧路径

下面这些东西现在不应该再被当成移动端主流程方案：

- 左侧抽屉作为一级导航主入口
- 右侧抽屉作为工具主入口
- 左右边缘手柄
- 手机上的并排小图标群
- “点会话就直接跳回最近详情”这种只有桌面用户才理解的行为

注意两点：

1. 退出的是移动端主流程，不是桌面端全部删除
2. 如果后面有人为了省事又把这些塞回移动端，那就是回退，不是优化

## 5. 桌面端明确保留什么

这次不是把桌面端打散重做。

桌面端继续保留：

- 三栏工作台
- 左侧导航
- 右侧辅助信息栏
- 高密度效率布局

也就是说：

- 桌面还是桌面
- 移动端终于是移动端

## 6. 实际代码落点，接手时先看这些

### 路由和壳层

- `apps/user-app/src/app/router.tsx`
- `apps/user-app/src/features/workbench/components/WorkbenchShellRoute.tsx`
- `apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.tsx`

### 工作区流

- `apps/user-app/src/features/mobile-workspaces/pages/WorkspaceHomePage.tsx`
- `apps/user-app/src/features/mobile-workspaces/pages/WorkspaceDetailPage.tsx`

### 会话流

- `apps/user-app/src/features/mobile-sessions/pages/SessionIndexPage.tsx`
- `apps/user-app/src/features/mobile-sessions/components/SessionListItem.tsx`

### 工具流

- `apps/user-app/src/features/mobile-tools/ToolsHomePage.tsx`
- `apps/user-app/src/features/mobile-tools/ToolFilesPage.tsx`
- `apps/user-app/src/features/mobile-tools/ToolGitPage.tsx`
- `apps/user-app/src/features/mobile-tools/ToolProcessesPage.tsx`

### 共享上下文

- `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
- `apps/user-app/src/features/workbench/utils/workbench-navigation.ts`

## 7. 后续继续改时，别犯的几个蠢错误

### 7.1 不要为了图省事把旧抽屉重新塞回来

如果有人说：

- “先把左抽屉当一级导航顶一下”
- “右侧栏手机上保留也无所谓”
- “先加几个图标，后面再收”

这基本就是在往旧垃圾结构倒车。

### 7.2 不要给移动端再造第二套 workbench 状态源

工作区、会话、工具页现在都继续复用 `WorkbenchLayout` 上下文。

后面如果有人想在移动页里单独维护一套：

- 当前工作区
- 当前会话
- 收藏列表
- 导航快照

那很快就会和桌面态、实时态、缓存态打架。

### 7.3 不要为了“理论完整”硬拆日志页

日志页现在没单独做，是因为它还没有足够干净的实体边界。

如果后面真要做，先回答：

- 日志数据从哪里来
- 页面是看文件日志、运行日志还是 provider 日志
- 路由和上下文怎么定义

没想清楚之前，宁可不做。

### 7.4 不要把每个次操作都做成长按和复杂手势

这次已经说明了一个现实：

- 手机上的真实痛点是入口拥挤
- 不是交互花样不够多

能靠明确菜单解决的问题，不要硬上复杂手势。

## 8. 推荐的后续收口顺序

如果后面还要继续推进，我建议按这个顺序：

1. 真机和模拟器走查补档
2. 工具流的性能分包优化
3. 是否需要移动端批量编辑模式
4. 是否需要独立日志页
5. 如果真的有必要，再补更细的手势和动效

## 9. 当前已完成与未完成

当前已完成：

- 移动壳分流
- 三档宽度模型
- H5 / iOS / Android 壳
- 工作区首页与详情页
- 会话索引页
- 工具首页与工具子页
- 动作菜单与搜索入口收口

当前未完成：

- 日志独立页
- 真机截图归档
- 工具流进一步按需分包
- 移动端专门的批量编辑模式

## 10. 最后的判断

现在的迁移状态已经从“桌面三栏缩小版”跨到了“移动端独立信息架构”。

后面如果继续做，重点应该是局部打磨和性能收口。

不要再回头讨论“要不要先用旧抽屉顶一下”这种问题。那不是过渡方案，那是倒退。
