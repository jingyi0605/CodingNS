# 设计文档 - spec016.5-事务工作台画布化与插件块布局

状态：Draft

## 1. 概述

### 1.1 目标

这次先把事务视图骨架改对：

- 左侧“代办”“自动化”收成“工作台”
- 默认取消右侧常驻详情/助手栏
- 把中间区和原右侧区合并成完整工作台画布
- 画布顶部做标签工具栏
- 左侧菜单下方增加固定快捷应用栏

### 1.2 这次真正要解决的问题

不是“标签页怎么画得好看”，而是下面这几个结构问题：

1. 事务模式里还残留旧的 `todo | automation` 入口语义
2. 工作台画布还没拿到完整宽度
3. 左侧缺一个固定位置挂常用 HTML 工具
4. HTML 快捷应用、画布 HTML 块、普通 HTML 预览三者边界还不够清楚

### 1.3 技术约束

- 前端只改 `apps/user-app`
- 文案统一走 i18n
- 布局和区块样式遵守 `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
- HTML 来源边界遵守 `spec015.2-插件管理能力与静态HTML插件运行时`

## 2. 页面结构

### 2.1 新骨架

事务模式下的正式结构改成下面这样：

1. **左侧导航区**
   - 顶部：事务一级入口（文档库、对话、工作台）
   - 主体：当前分区的导航内容
   - 底部：固定快捷应用栏
   - 默认态：直接显示

2. **右侧主舞台**
   - 文档视图：对象详情栏 + 文档主区
   - 对话视图：不显示右侧栏
   - 工作台视图：顶部标签工具栏 + 完整画布区

### 2.2 明确取消的旧结构

默认不再保留“所有事务分区都长期挂一个右侧常驻栏”这套旧结构。

如果以后确实需要详情或助手信息，应该作为可打开的次级层处理，比如：

- 浮层
- 抽屉
- 临时面板

但不再是默认常驻右栏。

## 3. 模块职责

| 模块 | 负责什么 | 这次怎么改 |
| --- | --- | --- |
| `WorkbenchLayout` | 装配整个事务模式骨架 | 左栏默认显示；文档视图保留右侧详情栏；对话和工作台不挂默认右栏 |
| `AffairsWorkbenchView` | 事务视图内容分发 | 保持文档库、对话、工作台三入口；切回文档时强制显示对象详情 |
| `AffairsDashboardView` | 工作台主舞台 | 顶部标签栏 + 画布 + 块预览 |
| `AffairsSidebarPanel` | 左侧事务导航内容 | 在底部增加固定快捷应用栏 |
| `AffairsDashboardState` | 保存工作台状态 | 保存到事务视图的用户级全局配置里，不跟某个代码工作区 ID 绑定 |

## 4. 状态模型

### 4.1 主分区状态

旧状态：

- `library | conversation | todo | automation`

新状态：

- `library | conversation | workbench`

迁移规则：

- `todo -> workbench`
- `automation -> workbench`

### 4.2 工作台状态拆分

工作台状态是“事务视图自己的配置”，不是“当前代码工作区的配置”。

也就是说：不管用户从哪个代码工作区切进事务视图，看到的快捷应用栏、工作台标签页和画布布局都应该是同一份。代码工作区 ID 只用于文件来源、预览权限、文档库绑定这类业务动作，不能拿来当事务视图配置的分桶键。

工作台状态分成四层：

1. **主分区状态**：现在在文档库、对话还是工作台
2. **标签页状态**：有哪些工作台标签页、当前在哪一页
3. **画布块状态**：这一页有哪些块、每个块的配置和布局
4. **快捷应用栏状态**：左侧固定应用栏里挂了哪些 HTML 应用入口

这样拆开后：

- 改快捷应用栏，不用碰画布布局
- 改画布块，不会拖坏左侧固定应用栏
- 恢复坏数据时，也能按层兜底

### 4.3 推荐数据结构

#### `AffairsWorkbenchDashboardState`

| 字段 | 说明 |
| --- | --- |
| `workspaceId` | 固定为 `affairs-global`，只表示这是事务视图全局配置；不能写成代码工作区 ID |
| `version` | 状态版本 |
| `activeTabId` | 当前激活标签页 |
| `tabs` | 工作台标签页列表 |
| `shortcutApps` | 左侧固定快捷应用栏入口列表 |
| `updatedAt` | 最近更新时间 |

持久化位置：

- Host：`user_affairs_library_settings.dashboard_state_json`
- 前端接口：`GET /api/affairs/dashboard-state`、`PUT /api/affairs/dashboard-state`
- 本地兜底快照：`workbench.affairs.dashboard.affairs-global`

旧的 `user_preference_profiles.affairs_dashboard_states_json` 只作为迁移来源。事务视图后续不能继续按 `workspaceId` 写回旧偏好分桶。

#### `ShortcutAppState`

| 字段 | 说明 |
| --- | --- |
| `id` | 快捷应用 ID |
| `title` | 显示名称 |
| `sourceId` | 来源标识，首阶段可理解为受控的工作区 HTML 入口 |
| `entryPath` | 工作区内 HTML 文件路径或登记入口 |
| `createdAt` | 创建时间 |
| `updatedAt` | 更新时间 |

## 5. 关键流程

### 5.1 进入事务工作台

1. 用户点击左侧“工作台”
2. 事务主分区切到 `workbench`
3. 左侧导航保持默认显示
4. `WorkbenchLayout` 不装配工作台和对话视图的默认右侧常驻栏
5. 主舞台直接渲染：顶部标签工具栏 + 整块画布
6. 同时在左侧底部渲染固定快捷应用栏

### 5.2 添加快捷应用

1. 用户从工作区选择一个合法静态 HTML 文件
2. 系统校验它是否满足当前规则
3. 通过后写入 `shortcutApps`
4. 左侧固定快捷应用栏立即显示新入口
5. 重新进入事务视图时恢复该入口，不受当前代码工作区 ID 变化影响

### 5.3 添加画布块

1. 用户在当前标签页里添加块
2. 系统创建块定义和默认布局
3. 画布立即渲染块
4. 状态写回事务视图全局配置

## 6. 错误处理

### 6.1 快捷应用错误

- 文件路径无效：拒绝添加，并明确提示
- 来源不合法：拒绝添加，并说明不是受控 HTML 来源
- 恢复时入口失效：保留入口壳子并显示失效状态，允许用户移除

### 6.2 画布块错误

- 单块失败只影响当前块
- 布局损坏回退到默认标签页和默认块
- HTML 块来源失效时，不拖垮其他块

## 7. 测试策略

### 7.1 单元测试

- `todo | automation -> workbench` 迁移
- 工作台状态恢复与坏数据兜底
- 快捷应用栏状态读写和恢复

### 7.2 组件测试

- 事务工作台默认无右侧常驻栏
- 工作台标签栏显示在整块画布顶部
- 左侧固定快捷应用栏显示空态和已添加入口
- 默认标签页与默认块能正常渲染

### 7.3 最小必要验证

- `pnpm -C apps/user-app exec vitest run src/features/workbench/utils/workbench-mode.test.ts src/features/workbench/utils/affairs-dashboard-state.test.ts src/features/workbench/components/AffairsWorkbenchView.test.tsx src/features/conversation/components/WorkbenchLayout.affairs-mode.test.tsx`
