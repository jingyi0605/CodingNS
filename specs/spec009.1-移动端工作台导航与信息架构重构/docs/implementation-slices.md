# 实施切片说明

这份文档只解决一个问题：

- 后面真的开始改代码时，先改哪，后改哪，哪些文件是第一刀，哪些文件要最后动

不先排这个顺序，最容易发生的事就是：

- 一上来就直接改 `WorkbenchLayout`
- 然后桌面端和移动端一起炸

## 1. 当前入口现状

当前已登录后的页面入口非常单一：

- `App.tsx` 直接挂 `RouterProvider`
- `router.tsx` 把已登录后的主路由统一塞进 `WorkbenchLayout`
- `WorkbenchLayout` 同时承担桌面端主壳和当前移动端抽屉版壳
- `PlatformProvider` 目前只提供 `desktop / web` 视角

当前关键文件：

- `apps/user-app/src/app/App.tsx`
- `apps/user-app/src/app/router.tsx`
- `apps/user-app/src/platform/platform-provider.tsx`
- `apps/user-app/src/platform/platform-adapter.ts`
- `apps/user-app/src/config/client-config-types.ts`
- `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`

## 2. 切片顺序

### 切片 A：先把平台和宽度模型补齐

目标：

- 不再只有 `desktop | web`
- 不再只有“是否小于 720px”这一种移动端判断

第一刀文件：

- `apps/user-app/src/config/client-config-types.ts`
- `apps/user-app/src/platform/platform-adapter.ts`
- `apps/user-app/src/platform/platform-provider.tsx`

要产出的最小结果：

- `RuntimePlatform` 扩成 `desktop | web | ios | android`
- 提供统一的 `ViewportClass = compact | medium | expanded`
- `PlatformProvider` 对外暴露平台和宽度等级

为什么先做这个：

- 因为后面的移动端壳、路由分流、页面布局全都依赖这个判断

### 切片 B：把已登录后的主壳从单一 `WorkbenchLayout` 拆开

目标：

- 已登录后不再只有一个壳
- 桌面端 / expanded 继续走 `WorkbenchLayout`
- `compact` 进入新的 `MobileWorkbenchShell`

第一刀文件：

- `apps/user-app/src/app/App.tsx`
- `apps/user-app/src/app/router.tsx`
- `apps/user-app/src/features/mobile-shell/*`

要产出的最小结果：

- `Router` 仍然是一套，但壳层可以分流
- 移动端有空骨架，不要求第一天就把所有页面补完

为什么这一步不能跳：

- 不先把壳分开，后面所有移动端页面都会继续被塞回桌面工作台

### 切片 C：把 `WorkbenchLayout` 收回成桌面 / expanded 壳

目标：

- `WorkbenchLayout` 不再被当成所有平台的默认主壳
- 移动端抽屉和边缘手柄从主路径退场

第一刀文件：

- `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
- `apps/user-app/src/app/styles.css`

要产出的最小结果：

- `compact` 不再走双抽屉主导航
- `WorkbenchLayout` 聚焦桌面端和大宽度场景

注意：

- 这一刀应该在新移动端壳能承接基础路由之后再动
- 不能反过来先删抽屉，再让移动端无路可走

### 切片 D：先迁页面骨架，再迁页面内容

目标：

- 先让 `工作区 / 会话 / 工具 / 设置` 四个一级目的地跑起来
- 再逐步把真实内容接进去

第一刀文件：

- `apps/user-app/src/features/mobile-workspaces/*`
- `apps/user-app/src/features/mobile-sessions/*`
- `apps/user-app/src/features/mobile-tools/*`
- `apps/user-app/src/features/mobile-settings/*`

要产出的最小结果：

- 一级导航可见
- 页面层级成立
- 允许用已有业务页面先托底

为什么先迁骨架：

- 因为用户先需要“知道去哪”，再需要“进去后功能完整”

### 切片 E：把动作从小图标迁成菜单、按钮、编辑模式

目标：

- 不再出现桌面式 icon cluster
- 动作按主操作、次操作、风险操作重新分层

第一刀文件：

- `apps/user-app/src/i18n/zh-CN.ts`
- `apps/user-app/src/i18n/en-US.ts`
- 各移动端页面壳和列表组件

要产出的最小结果：

- 新建会话、搜索、更多、编辑模式入口清楚
- 会话和工作区动作不再靠猜图标

### 切片 F：最后再做 medium / expanded 的双区增强

目标：

- 在新导航意图成立后，再给平板和宽屏做双区布局

第一刀文件：

- `apps/user-app/src/features/mobile-shell/layouts/*`
- `apps/user-app/src/app/styles.css`

为什么最后做：

- 因为如果先做大屏双区，很容易又退回桌面三栏思路

## 3. 明确禁止的实现顺序

下面这些顺序都不对：

### 错误顺序 1

1. 先改 `WorkbenchLayout`
2. 再想移动端壳

结果：

- 桌面和移动端同时受伤

### 错误顺序 2

1. 先做一套移动端新页面
2. 不拆平台和宽度模型

结果：

- 路由和平台判断又散落到页面里

### 错误顺序 3

1. 先补样式
2. 信息架构后补

结果：

- 永远停留在“桌面页面缩小版”

## 4. 每个切片的完成标志

| 切片 | 完成标志 |
| --- | --- |
| A | 平台和宽度等级可被统一读取 |
| B | 移动端主壳可独立承接已登录路由 |
| C | 边缘手柄和双抽屉退出移动端主路径 |
| D | `工作区 / 会话 / 工具 / 设置` 四个一级目的地成立 |
| E | 主操作和次操作迁移完成 |
| F | `medium / expanded` 双区布局稳定 |

## 5. 一句话结论

先拆判断和壳，再拆页面，再迁动作，最后补大屏。

反过来做，十有八九会写成一坨垃圾。
