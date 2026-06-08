# 设计文档 - spec009.3 移动端首页代码事务与文档库体验重构

状态：Draft

## 1. 概述

### 1.1 目标

- 把移动端底部导航调整为 `首页 / 对话 / 代码 / 文档 / 工作台`
- 让首页成为代码模式和事务模式的统一待处理入口
- 把当前按工作区筛选的移动端会话列表迁到代码页
- 让对话页只承担事务轻量会话职责
- 按当前 PC 文档库真实能力重做移动端文档页
- 保持 PC 端事务三栏和现有代码会话链路不变

### 1.2 覆盖需求

- `requirements.md` 需求 1：底部导航匹配新结构
- `requirements.md` 需求 2：首页聚合代码和事务待处理
- `requirements.md` 需求 3：对话页是事务轻量会话
- `requirements.md` 需求 4：代码页保留工作区切换器
- `requirements.md` 需求 5：文档页贴合 PC 文档库真实功能
- `requirements.md` 需求 6：移动端对象详情关键操作
- `requirements.md` 需求 7：工作台承载事务事项
- `requirements.md` 需求 8：高信息密度但可触控
- `requirements.md` 需求 9：不破坏 PC 和已有主链路

### 1.3 技术约束

- 前端只改 `apps/user-app`
- 新增和修改用户可见文案必须走 `apps/user-app/src/shared/i18n/index.ts` 和英文 i18n
- 移动端页面和样式要遵守 `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
- 涉及移动端 sheet 或弹窗时，还要遵守模态框规范
- 不改 Host 文档库接口，不改文档库 SQLite/索引器
- 不新增脱离 `AffairsWorkbenchView` 的文档库数据模型
- 不编辑 `dist` 或编译产物

### 1.4 当前实现诊断

当前代码里已经有几块可复用基础：

- `MobileWorkbenchShell`：移动端底部导航和主内容壳
- `MobileWorkspaceSwitcherHeader`：移动端工作区 / Host 切换头
- `SessionIndexPage`：当前“顶部工作区切换器 + 当前工作区会话列表”的页面
- `AffairsWorkbenchView`：PC 端事务视图，包含文档库、对话、工作台等真实数据和逻辑
- 文档库相关数据结构：`DocumentRecord`、`FolderRecord`、`TagRecord`、`LibraryEntry`
- 文档库相关能力：收藏、标签树、目录浏览、网格 / 列表、对象详情、标签分配、刷新、设置

当前问题也很明确：

1. 移动端底部导航仍然带旧结构，和现在产品分层不一致。
2. 当前移动端“对话”页实际是代码工作区会话列表，名字错了，职责也错了。
3. 文档页原型如果只做“最近文档 / 通用标签 / 收藏文章”，会完全偏离当前 PC 文档库。
4. PC 文档库是三栏结构，手机不能照搬，但必须保留同一套对象和动作。

一句人话：不是缺能力，是现有能力在手机上摆错了位置。

## 2. 信息架构

### 2.1 一级导航

移动端一级导航固定为：

| 入口 | 职责 | 是否有代码工作区 |
| --- | --- | --- |
| 首页 | 聚合代码和事务的待处理、未读、进行中摘要 | 否，但展示代码工作区摘要 |
| 对话 | 事务轻量会话 | 否 |
| 代码 | 代码工作区、代码会话、文件/Git/终端入口 | 是 |
| 文档 | 全局文档库移动端视图 | 否 |
| 工作台 | 事务事项和待确认结果 | 否 |

`我的 / 设置 / 通知 / Host 管理` 不再占底部入口，放到首页顶部头像菜单。

### 2.2 首页结构

首页只做一件事：告诉用户现在要处理什么。

页面分区：

1. 顶部：标题、搜索、头像菜单
2. 摘要：待处理、代码未读、工作台、文档更新
3. 等待处理：事务待处理 + 代码会话完成未读
4. 今日概览：代码、事务、文档的简短状态
5. 快捷入口：新建对话、进入代码、打开文档库

首页不直接展示：

- 文件树
- Git diff 详情
- 终端日志详情
- 文档库完整目录树

这些都进入对应页面。

### 2.3 对话页结构

对话页不再使用代码工作区切换器。

页面分区：

1. 轻量会话列表
2. 等待输入
3. 最近对话
4. 新建轻量对话
5. 可选关联文档或工作台对象

如果现有事务轻量会话能力还没有完整列表组件，要先从 `AffairsWorkbenchView` 当前事务对话相关接口和列表状态里抽出可复用数据适配层，而不是复用代码会话列表假装事务对话。

### 2.4 代码页结构

代码页复用当前 `SessionIndexPage` 的核心结构，但改名和改职责。

页面分区：

1. `MobileWorkspaceSwitcherHeader`
2. 当前工作区摘要：待输入、代码会话、Git 变更、终端运行中
3. 新建代码会话
4. 当前工作区会话列表：等待输入、运行中、最近
5. 工具入口：文件、Git、终端

当前 `SessionIndexPage` 里的：

- `currentWorkspaceTarget`
- `workspaceOptions`
- `buildNavigationSessionTree`
- `MobileCreateSessionSheet`
- `SessionListItem`

都可以继续用，但页面入口应从“对话”迁到“代码”。

### 2.5 文档页结构

文档页对应 PC 文档库三栏，但手机上拆成四个视图：

```text
浏览 / 收藏 / 标签 / 详情
```

| 移动端视图 | 对应 PC 区域 | 做什么 |
| --- | --- | --- |
| 浏览 | 中间文件网格 / 列表 | 看当前目录子文件夹和文档，切网格/列表，排序，进入对象 |
| 收藏 | 左侧收藏区 | 展示文件夹收藏、标签收藏、标签组合收藏，并进入对应结果 |
| 标签 | 左侧标签树 | 搜索标签、展开标签树、选择标签、看命中文档 |
| 详情 | 右侧对象详情 | 展示文件夹/文档/标签详情，处理收藏、标签、打开、下载 |

这四个视图共享同一份文档库状态，不互相重新拉一套数据。

### 2.6 工作台页结构

工作台页只承载事务事项。

页面分区：

1. 待处理
2. 进行中
3. 已完成
4. 异常
5. 关联文档 / 对话入口

代码会话完成未读放首页聚合，不把工作台变成代码任务列表。

## 3. 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `MobileWorkbenchShell` | 底部导航、移动端主壳 | 当前路由、activeEntry | 五个一级入口和主内容区 |
| `MobileHomePage`（新增） | 首页聚合 | 事务摘要、代码会话摘要、文档库状态 | 首页待处理和概览 |
| `MobileAffairsConversationPage`（新增或从事务视图抽出） | 事务轻量会话列表 | 轻量会话列表、事务对象上下文 | 对话列表和新建入口 |
| `MobileCodePage`（由 `SessionIndexPage` 调整） | 代码工作区和代码会话 | 工作区导航组、会话树、Git/终端摘要 | 当前工作区代码页 |
| `MobileAffairsLibraryPage`（新增） | 移动端文档库 | 文档库 snapshot、documents page、favorites、tags | 浏览/收藏/标签/详情 |
| `MobileAffairsWorkbenchPage`（新增或抽出） | 事务工作台 | 事务事项列表 | 工作台卡片流 |
| `MobileUserMenuSheet`（新增） | 头像菜单 | 账号、通知、设置、Host 状态 | 用户低频入口 |

## 4. 数据与状态模型

### 4.1 首页摘要模型

首页需要的是摘要，不是完整数据。

建议模型：

```ts
interface MobileHomeSummary {
  pendingCount: number;
  unreadCompletedCodeSessionCount: number;
  workbenchPendingCount: number;
  documentUpdatedCount: number;
  pendingItems: MobileHomePendingItem[];
}

interface MobileHomePendingItem {
  id: string;
  kind: "code_session" | "affairs_conversation" | "workbench_item" | "document";
  title: string;
  subtitle: string;
  actionLabel: string;
  target: MobileNavigationTarget;
}
```

第一版可以先在前端从已有列表状态推导，不急着新增后端聚合接口。

### 4.2 代码页状态

继续复用当前工作区会话状态：

- `navigationGroups`
- `currentWorkspaceId`
- `currentSessionId`
- `favoriteSessionIds`
- `buildNavigationSessionTree(...)`

需要补的只是代码页摘要：

```ts
interface MobileCodeWorkspaceSummary {
  waitingInputCount: number;
  runningSessionCount: number;
  recentSessionCount: number;
  gitChangedFileCount: number | null;
  runningTerminalCount: number | null;
}
```

Git 和终端摘要优先用现有工具页或工作区状态已有接口，拿不到时显示“查看”入口，不阻塞代码页。

### 4.3 文档库状态

移动端文档库必须复用当前 PC 文档库模型：

- `DocumentRecord`
- `FolderRecord`
- `TagRecord`
- `LibraryEntry`
- `AffairsLibrarySnapshotDto`
- `AffairsLibraryDocumentListDto`
- `AffairsLibraryFavoriteRecordDto`
- `AffairsLibraryIndexStatusDto`

移动端新增的是视图状态：

```ts
interface MobileAffairsLibraryViewState {
  activeView: "browser" | "favorites" | "tags" | "detail";
  viewMode: "grid" | "list";
  browseMode: "folder" | "tag";
  selectedFolderPath: string | null;
  selectedTagPaths: string[];
  selectedObjectId: string | null;
}
```

注意：这只是 UI 状态，不是新的业务数据。

### 4.4 文档对象详情

移动端详情展示的数据来自当前 PC 详情计算逻辑：

- 文件夹详情：`buildFolderDetailState(...)`
- 文档详情：当前 `selectedObject.record`
- 标签详情：`selectedTagPaths` 和 `tagRecords`

移动端不单独造“详情接口”。

## 5. 页面和组件设计

### 5.1 底部导航改造

主要文件：

- `apps/user-app/src/features/mobile-shell/components/MobileWorkbenchShell.tsx`
- `apps/user-app/src/features/mobile-shell/ios/IosWorkbenchShell.tsx`
- `apps/user-app/src/features/mobile-shell/android/AndroidWorkbenchShell.tsx`
- `apps/user-app/src/features/mobile-shell/components/mobile-workbench-shell-types.ts`
- `apps/user-app/src/shared/i18n/index.ts`
- `apps/user-app/src/i18n/en-US.ts`

`MobileWorkbenchEntry` 目标：

```ts
type MobileWorkbenchEntry = "home" | "affairs-conversation" | "code" | "documents" | "workbench";
```

如果一次性改动太大，可先用兼容映射：

- `home` 新增
- `sessions` 临时映射到 `code`
- 新增 `documents`、`workbench`
- 后续再清理旧 key

### 5.2 首页组件

建议新增：

```text
apps/user-app/src/features/mobile-home/pages/MobileHomePage.tsx
apps/user-app/src/features/mobile-home/components/MobileUserMenuSheet.tsx
```

首页数据第一版从已有上下文拼：

- 代码会话：`useWorkbenchShell()` 的 `navigationGroups`
- 文档库：事务视图已有 snapshot 或新增轻量 hook
- 工作台：事务工作台已有数据源
- 轻量对话：事务对话列表已有接口

如果某个摘要暂时没有稳定数据源，不要硬编码假数据；显示“暂不可用 / 查看详情”入口。

### 5.3 代码页组件

当前：

```text
apps/user-app/src/features/mobile-sessions/pages/SessionIndexPage.tsx
```

建议做法：

1. 保留组件主体，改成代码页语义。
2. 页面标题和 i18n 从“对话”改为“代码”。
3. 新增工作区摘要区。
4. 底部导航入口指向代码页。
5. 会话详情继续走现有 `ConversationPage`。

可以重命名为：

```text
apps/user-app/src/features/mobile-code/pages/MobileCodePage.tsx
```

如果重命名影响太大，先保留文件名，但页面和路由语义改为代码页，并在任务里单独安排清理。

### 5.4 对话页组件

新增事务轻量对话页：

```text
apps/user-app/src/features/mobile-affairs/pages/MobileAffairsConversationPage.tsx
```

它不使用 `MobileWorkspaceSwitcherHeader`。

它可以复用 `AffairsWorkbenchView` 中事务对话相关的数据接口：

- `listAffairsLightweightSessions(...)`
- 事务对话创建能力
- 事务对象上下文选择能力

第一版先做：

- 等待输入
- 最近对话
- 新建轻量对话
- 空态

不在第一版做完整 Agent 会话链路。

### 5.5 文档页组件

新增：

```text
apps/user-app/src/features/mobile-affairs-library/pages/MobileAffairsLibraryPage.tsx
apps/user-app/src/features/mobile-affairs-library/components/MobileLibraryBrowserView.tsx
apps/user-app/src/features/mobile-affairs-library/components/MobileLibraryFavoritesView.tsx
apps/user-app/src/features/mobile-affairs-library/components/MobileLibraryTagsView.tsx
apps/user-app/src/features/mobile-affairs-library/components/MobileLibraryDetailView.tsx
```

为了避免复制 PC 端 `AffairsWorkbenchView.tsx` 的大块逻辑，需要先抽公共 hook：

```text
apps/user-app/src/features/workbench/hooks/useAffairsLibraryState.ts
```

这个 hook 提供：

- binding / config / snapshot / indexStatus
- current directory documents page
- favorites
- tags
- navigate folder / navigate tag
- set view mode / sort state
- refresh
- select object
- toggle favorite
- save document/folder tags

PC 端 `AffairsWorkbenchView` 和移动端文档页都使用这个 hook。这样数据只有一套，页面各画各的。

### 5.6 工作台页组件

新增或抽出：

```text
apps/user-app/src/features/mobile-affairs/pages/MobileAffairsWorkbenchPage.tsx
```

第一版只展示当前事务事项卡片：

- 待处理
- 进行中
- 已完成
- 异常

不要把代码会话塞进去。

## 6. 路由设计

目标移动端路由示例：

| 页面 | 路由 |
| --- | --- |
| 首页 | `/mobile` 或当前移动默认首页 |
| 对话 | `/affairs/conversations` 的移动端呈现，或移动壳内映射 |
| 代码 | `/workspaces/:workspaceId/sessions` 的移动端呈现，底部显示为“代码” |
| 文档 | `/affairs/library` 的移动端呈现 |
| 工作台 | `/affairs/workbench` 的移动端呈现 |

兼容原则：

- 旧 `/sessions` 移动入口跳到代码页
- 旧 `/workspaces/:workspaceId/sessions` 继续可用，但底部高亮代码
- 旧工具入口如果存在，按 009.2 的兼容策略继续处理
- 桌面端路由不变

## 7. 错误和空态

### 7.1 首页

- 没有待处理：显示“现在没有需要处理的事项”并给快捷入口
- 代码摘要加载失败：保留事务摘要，代码区显示“代码状态暂不可用”
- 文档库未绑定：显示“文档库还未绑定”，入口到文档设置

### 7.2 文档页

文档页必须处理这些状态：

- 未绑定文档库
- 文档库已关闭
- 索引刷新中
- 当前目录为空
- 当前标签无命中文档
- 文档列表加载失败
- 对象详情不存在

这些状态都来自当前文档库已有状态和错误，不新增假状态。

### 7.3 代码页

- 没有工作区：显示导入/添加工作区入口
- 当前工作区没有会话：显示新建代码会话入口
- Git / 终端摘要不可用：不阻塞会话列表

## 8. 正确性属性

### 8.1 事务页面不能依赖代码工作区

对于任何事务模式页面，页面主数据不得依赖 `currentWorkspaceId` 才能展示。

验证需求：需求 3、需求 5、需求 7

### 8.2 代码会话必须始终有工作区上下文

对于任何代码会话列表和代码会话详情，必须能确定所属工作区。

验证需求：需求 4

### 8.3 文档库移动端和 PC 端必须使用同一套文档库数据

对于任何文档库对象，移动端展示的目录、标签、收藏和详情必须来自当前文档库模型，不允许另建一套假数据。

验证需求：需求 5、需求 6、需求 9

### 8.4 首页只聚合摘要，不吞掉详情页职责

对于任何首页待处理项，首页只展示摘要和跳转目标，不直接承载详细操作。

验证需求：需求 2、需求 8

## 9. 测试策略

### 9.1 单元测试

- 底部导航 activeEntry 映射
- 首页摘要推导函数
- 代码会话完成未读筛选
- 文档库移动端视图状态切换
- 文档库收藏 / 标签 / 目录入口映射

### 9.2 组件测试

- `MobileHomePage`
- `MobileCodePage`
- `MobileAffairsConversationPage`
- `MobileAffairsLibraryPage`
- `MobileAffairsWorkbenchPage`
- `MobileUserMenuSheet`

### 9.3 回归测试

- 当前 `SessionIndexPage` 相关测试迁移或补充到代码页
- `MobileWorkbenchShell.test.tsx`
- `MobileWorkspaceSwitcherHeader.test.tsx`
- `AffairsWorkbenchView` 文档库相关测试不能因为抽 hook 失效

### 9.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §2.1、§5.1、§6 | 移动壳组件测试、路由测试 |
| 需求 2 | §2.2、§4.1、§5.2 | 首页组件测试、摘要函数测试 |
| 需求 3 | §2.3、§5.4 | 对话页组件测试、人工检查无工作区切换器 |
| 需求 4 | §2.4、§4.2、§5.3 | 代码页测试、工作区切换器测试 |
| 需求 5 | §2.5、§4.3、§5.5 | 文档页组件测试、文档库 hook 测试 |
| 需求 6 | §4.4、§5.5、§7.2 | 详情视图测试、标签/收藏操作测试 |
| 需求 7 | §2.6、§5.6 | 工作台页组件测试 |
| 需求 8 | §5、§7 | 视觉走查、组件测试 |
| 需求 9 | §1.3、§6、§9.3 | PC 端回归、相关测试 |

## 10. 风险与待确认项

### 10.1 风险

- `AffairsWorkbenchView.tsx` 已经很大，直接复制逻辑到移动端会变成垃圾代码。必须先抽文档库状态 hook。
- 首页摘要如果强行拉全量文档库和全量会话，会让移动端首屏变慢。
- 对话页从代码会话切到事务轻量会话，会影响用户旧习惯，需要旧入口兼容。
- 文档库 PC 三栏能力很多，移动端第一版必须抓主链路，不能把右键菜单全搬过来。

### 10.2 待确认项

- 事务轻量会话列表的正式数据源是否已足够稳定，还是需要先补接口适配。
- 代码会话“已完成未读”的权威字段来自哪里：会话状态、消息已读标记，还是运行时任务状态。
- 文档库移动端是否第一版支持“新建文件 / 新建目录 / 粘贴 / 删除”这些文件系统操作，还是只放进更多菜单后续做。
- 首页是否需要跨 Host 聚合，还是只看当前 Host。
