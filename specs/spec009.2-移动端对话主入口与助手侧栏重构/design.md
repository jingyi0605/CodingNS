# 设计文档 - spec009.2 移动端对话主入口与助手侧栏重构

状态：Draft

## 1. 概述

### 1.1 目标

- 让移动端对话页重新承担“工作主舞台”角色
- 把文件 / Git 从独立工具入口收回到对话上下文里
- 把底部导航里的“工具 / 终端 / 助手”职责重新摆正
- 把当前 `butler` 页面提升为真正的移动端一级页面，并补齐左右侧页
- 保证旧工具路由还有兼容出口，不把现有入口直接打断

### 1.2 覆盖需求

- `requirements.md` 需求 1：对话页重新成为主入口
- `requirements.md` 需求 2：文件 / Git 收回对话上下文
- `requirements.md` 需求 3：工具入口改终端
- `requirements.md` 需求 4：终端入口改助手
- `requirements.md` 需求 5：助手页统一头部
- `requirements.md` 需求 6：助手页左右双侧页
- `requirements.md` 需求 7：助手右侧信息栏三段切换
- `requirements.md` 需求 8：返回和系统手势兼容
- `requirements.md` 需求 9：上下文连续

### 1.3 技术约束

- 不改 Host 协议，不改文件 / Git / 终端 / 助手接口契约
- 前端只改 `apps/user-app`
- 继续复用 `ConversationPage` 现有的移动端预览轨道和手势控制器，不再凭空造第二套滑动状态机
- 助手页优先复用 `MobileWorkspaceSwitcherHeader`
- 所有页面名、按钮名、标签名改动都要走 i18n

### 1.4 当前实现诊断

现在的问题很具体：

1. `MobileWorkbenchShell` 的底部导航还是 `工作区 / 对话 / 终端 / 工具 / 设置`，其中“工具”实际承载文件 / Git / 进程，“终端”和“助手”却被拆开了。
2. `ConversationPage` 已经有一套成熟的左滑预览轨道，但里面装的是会话列表，不是文件 / Git。
3. `TerminalPage` 已经有独立抽屉和工作区切换头，说明“一级页面 + 左侧抽屉”这件事已经有现成模式。
4. `MobileButlerPage` 只有页内 `信息 / 自动化` 双标签，没有左右侧页，也没有把“助手对话列表”和“当前助手信息栏”拆出来。

一句人话：
不是没有基础，而是现有基础各长一套，职责还放错了地方。

## 2. 信息架构调整

### 2.1 底部一级导航调整

新的移动端底部导航仍保持 5 个一级入口，但职责调整为：

- `工作区`
- `对话`
- `助手`
- `终端`
- `设置`

对应关系：

| 旧入口 | 新入口 | 原因 |
| --- | --- | --- |
| 工作区 | 工作区 | 不变 |
| 对话 | 对话 | 不变 |
| 终端 | 助手 | 助手已经是高频主路径，应该升一级 |
| 工具 | 终端 | 终端比“工具集合页”更值得一级直达 |
| 设置 | 设置 | 不变 |

说明：

- 旧的“工具页”不再作为底部一级导航目的地
- 文件 / Git 收到对话页左侧页
- 进程页保留为终端页内的次级入口，或者通过兼容路由继续进入

### 2.2 对话页结构调整

对话页改成三块逻辑区域：

| 区域 | 作用 | 呈现方式 |
| --- | --- | --- |
| 主舞台 | 消息流、状态、输入区 | 当前 `ConversationPage` 主体 |
| 左侧页 | 文件 / Git | 左滑呼出，全屏覆盖 |
| 顶部头部 | 工作区切换、标题、动作 | 继续用 `MobileWorkspaceSwitcherHeader` |

新的左侧页标签：

- `文件`
- `Git`

旧的“会话预览轨道”不在本子 Spec 里继续扩展成并存双轨。对话页左侧页只服务文件 / Git，避免一个方向塞两套东西。

### 2.3 助手页结构调整

助手页改成三块逻辑区域：

| 区域 | 作用 | 打开方式 |
| --- | --- | --- |
| 主舞台 | 当前助手页主内容 | 默认可见 |
| 左侧页 | 助手对话列表 | 右滑打开 |
| 右侧页 | 当前助手的信息 / 自动化 / 设置 | 左滑打开 |

顶部统一使用：

- `MobileWorkspaceSwitcherHeader`

右侧信息栏标签固定为：

- `信息`
- `自动化`
- `设置`

## 3. 交互模型

### 3.1 对话页左侧页

#### 3.1.1 打开规则

- 从主舞台左滑打开
- 从头部或显式按钮打开
- 默认先落到上次使用的标签，首次默认 `文件`

#### 3.1.2 关闭规则

- 从左侧页右滑关闭
- 系统返回优先关闭侧页
- 头部返回按钮关闭并回到主舞台

#### 3.1.3 内容承载

- `文件` 直接复用 `FileContextPanel`
- `Git` 直接复用 `GitSidebar`

要求：

- 只换容器，不重写文件 / Git 面板
- 保持当前 `workspaceId` 和 `sessionId` 透传

### 3.2 助手页左右侧页

#### 3.2.1 左侧页：助手对话列表

目标：

- 展示当前工作区下助手相关对话入口
- 支持点击切换当前对话
- 保持和主页面一样的工作区上下文

承载方式：

- 优先抽成和对话页预览轨道相同的“侧页容器”
- 内容上不复用“文件 / Git”标签，而是渲染助手对话列表

#### 3.2.2 右侧页：信息 / 自动化 / 设置

目标：

- 把当前助手相关的静态信息、自动化能力和页面设置都放进统一右侧页

标签职责：

| 标签 | 作用 |
| --- | --- |
| 信息 | 当前助手概况、配置摘要、状态说明 |
| 自动化 | 现有自动化相关内容 |
| 设置 | 助手页级设置与后续扩展占位 |

### 3.3 手势冲突处理

原则很简单：

- 先判断是否明显横滑，再决定是否接管
- 页面内部可滚动区域优先保持自己的纵向滚动
- 系统返回手势优先级高于自定义“从屏幕边缘开始的横滑”

约束：

1. 自定义手势只在页面主舞台或明确侧页区域内生效。
2. 不从屏幕最边缘抢系统返回。
3. 侧页打开时，系统返回先关侧页，再退路由。

## 4. 路由与状态

### 4.1 底部导航激活态

`MobileWorkbenchEntry` 从：

```ts
"workspaces" | "terminals" | "sessions" | "tools" | "settings"
```

改成：

```ts
"workspaces" | "sessions" | "butler" | "terminals" | "settings"
```

说明：

- `tools` 从一级导航里移除
- `butler` 成为新一级入口

### 4.2 路由兼容策略

保留现有路由，但职责变化：

| 旧路由 | 新行为 |
| --- | --- |
| `/workspaces/:workspaceId/tools` | 兼容跳转到当前工作区对话主入口，并打开文件 / Git 侧页默认标签 |
| `/workspaces/:workspaceId/tools/files` | 兼容跳转到当前工作区最近对话或会话索引，并打开 `文件` 侧页 |
| `/workspaces/:workspaceId/tools/git` | 兼容跳转到当前工作区最近对话或会话索引，并打开 `Git` 侧页 |
| `/workspaces/:workspaceId/tools/processes` | 暂时保留，作为终端页下的兼容子路由 |
| `/workspaces/:workspaceId/butler` | 保留，页面内部结构升级 |

说明：

- 如果当前工作区没有活动会话，则先进入会话索引页或最近会话恢复逻辑，再决定是否打开左侧页
- 不允许旧路由直接 404

### 4.3 面板状态

建议新增两套轻量状态：

#### 对话页

```ts
type MobileConversationSidePanel = "closed" | "files" | "git";
```

#### 助手页

```ts
type MobileButlerSidePanel = "closed" | "sessions" | "details";
type MobileButlerDetailTab = "info" | "automation" | "settings";
```

要求：

- 状态以页面本地状态或轻量持久化为主，不引入新的全局 store
- 标签默认记住上一次用户选择

## 5. 模块落点

### 5.1 主要文件

| 文件 | 需要做什么 |
| --- | --- |
| `apps/user-app/src/features/mobile-shell/components/mobile-workbench-shell-types.ts` | 调整移动端一级入口枚举 |
| `apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.tsx` | 调整底部导航顺序、图标、文案和跳转 |
| `apps/user-app/src/features/mobile-shell/android/AndroidWorkbenchShell.tsx` | 同步 Android 壳底部导航 |
| `apps/user-app/src/features/mobile-shell/ios/IosWorkbenchShell.tsx` | 同步 iOS 壳底部导航 |
| `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx` | 调整一级入口激活态和路由跳转 |
| `apps/user-app/src/features/conversation/pages/ConversationPage.tsx` | 把移动端左滑侧页改成文件 / Git 容器 |
| `apps/user-app/src/features/mobile-tools/ToolsHomePage.tsx` | 降级为兼容入口或重定向承载页 |
| `apps/user-app/src/features/butler/pages/MobileButlerPage.tsx` | 接入统一头部、左右侧页、三标签右栏 |
| `apps/user-app/src/features/workbench/utils/workbench-navigation.ts` | 补路由兼容构造函数时可能需要的辅助 |
| `apps/user-app/src/i18n/zh-CN.ts` | 更新中文文案 |
| `apps/user-app/src/i18n/en-US.ts` | 更新英文文案 |

### 5.2 推荐拆分

为了避免继续把页面写成巨型组件，建议拆出：

- `MobileConversationToolRail`
- `MobileConversationToolPanel`
- `MobileButlerSessionRail`
- `MobileButlerDetailPanel`
- `mobile-side-panel-gesture.ts` 或类似轻量手势辅助

## 6. 风险与对策

### 6.1 最大风险

最大风险不是样式，而是路径被打断。

典型出事方式：

- 老路由失效
- 左滑和系统返回互相抢
- 对话页左侧页打开后找不到回主舞台的路径
- 助手页三块内容继续写死在一个组件里，最后不可维护

### 6.2 对策

1. 先保路由兼容，再改 UI 呈现。
2. 优先复用现有轨道和手势逻辑，不再平地起第二套状态机。
3. 所有侧页都要有“手势关闭 + 返回关闭 + 显式按钮关闭”三条路。
4. 先把页面容器拆清楚，再往里塞内容。

## 7. 验证策略

### 7.1 自动化测试

- `WorkbenchLayout`：底部入口激活态和跳转
- `ConversationPage`：文件 / Git 侧页切换与关闭
- `MobileButlerPage`：左右侧页、右栏标签切换、工作区切换
- `ToolsHomePage`：兼容跳转

### 7.2 手动验证

至少覆盖：

1. 从对话页左滑打开文件，再切到 Git，再右滑回对话
2. 从底部新终端入口进入终端页
3. 从底部新助手入口进入助手页
4. 在助手页右滑打开对话列表，左滑打开右侧信息栏
5. 在助手右侧信息栏切换 `信息 / 自动化 / 设置`
6. 打开旧工具路由，确认不会死掉
