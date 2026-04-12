# 设计文档 - spec012.1-Git工作树与工作区分叉基础

状态：Draft

## 1. 概述

### 1.1 目标

- 在不推翻现有 `workspace` 模型的前提下，补齐 `git worktree` 正式能力
- 让根工作区下面可以树状挂载子工作树
- 第一阶段只解决创建、继续 fork、合并回直接父节点、清理
- 让用户能通过列表、聊天页、右侧信息栏明确感知当前工作树上下文

### 1.2 覆盖需求

- `requirements.md` 需求 1：工作树元数据持久化
- `requirements.md` 需求 2：从工作区创建子工作树
- `requirements.md` 需求 3：从子工作树继续 fork
- `requirements.md` 需求 4：工作台结构改造
- `requirements.md` 需求 5：视觉区分
- `requirements.md` 需求 6：合并回直接父节点
- `requirements.md` 需求 7：清理
- `requirements.md` 需求 8：兼容现有工作区主链路

### 1.3 技术约束

- 工作区主模型、文件访问、终端、会话、Git 路由继续沿用 `workspaceId`
- Git 读写命令复用 `spec005`
- 移动端工作台和桌面端工作台结构复用 `spec009.1`
- 第一阶段不引入 `ParallelCase`、`ParallelAttempt` 这些上层模型

## 2. 核心思路

### 2.1 为什么这一步不要推翻 `workspace`

现有系统里，文件、Git、终端、聊天页、权限请求，都是围着 `workspaceId` 工作的。

如果为了 worktree 直接把 `workspace` 改成“一个节点可以挂多个路径”，那会把现有边界全部搞脏。

所以第一阶段的正确做法是：

- `workspace` 继续表示“一个真实可进入的目录”
- 新增一层 `worktree meta`，描述这个目录在工作树血缘里是什么身份

一句人话：
目录身份和 Git 血缘分开存，别把两个概念搅成一锅。

### 2.2 总体结构

系统里会同时存在两类对象：

1. **工作区对象**
   - 继续使用现有 `workspaces` 表
   - 每个 worktree 目录都会注册成一个独立 `workspace`

2. **工作树元数据对象**
   - 新增表记录某个 `workspace` 是否是某个根工作区下面的子工作树
   - 记录父子关系、来源、分支、合并目标和生命周期状态

### 2.3 UI 结构原则

顶层工作区列表保持不变。

只有当某个根工作区下已经存在子工作树时，展开内容才升级成 3 个区块：

1. 当前主工作树会话
2. 子工作树
3. 归档会话

这样做的目的很直接：

- 不动用户已经熟悉的顶层列表
- 不强迫根工作区会话下沉到一个虚拟 `main` 节点下
- 给子工作树留出正式位置，但不把会话列表搅乱

## 3. 架构

### 3.1 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `worktree-meta-service` | 管理工作树元数据、树关系和状态回写 | `workspaceId`、父子关系、状态变更 | 工作树树结构 |
| `worktree-manager` | 执行 `git worktree` 创建、列出、删除、修复 | `sourceWorkspaceId`、`branchName` | 新目录、新 workspace、新元数据 |
| `worktree-merge-service` | 合并回直接父节点的预检与执行 | `workspaceId` | merge 结果 |
| `worktree-cleanup-service` | 清理 worktree 与残留检测 | `workspaceId` | 清理结果 |
| `workbench-worktree-assembler` | 为工作台拼装根工作区与子工作树区块 | `rootWorkspaceId` | 导航树 DTO |
| `worktree-visual-service` | 生成稳定的颜色 token 与上下文提示文案 | `workspaceId`、树深度 | `contextTone`、提示信息 |

### 3.2 与现有能力的关系

- `workspace-service`：继续负责真实目录注册、查询与恢复
- `git-command-runner` / `git-read-service` / `git-write-service`：继续负责底层 Git 命令
- `workbench-service`：继续作为工作台快照入口，但会多拼一层子工作树区块
- `session-history-service`：继续按 `workspaceId` 查会话，不需要重写
- `file/terminal/git` 页面：继续按当前 `workspaceId` 访问

原则只有一句：
**worktree 是在现有能力上加一层组织，不复制现有能力。**

## 4. 数据结构

### 4.1 新增表：`workspace_worktrees`

这张表只记录“子工作树”。

根工作区不强制写一条镜像记录，继续沿用现有 `workspaces` 即可。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `workspace_id` | string | 是 | 当前子工作树对应的 `workspace` |
| `root_workspace_id` | string | 是 | 根工作区 |
| `parent_workspace_id` | string | 是 | 直接父节点 |
| `source_workspace_id` | string | 是 | 实际创建来源 |
| `merge_target_workspace_id` | string | 是 | 第一阶段固定等于直接父节点 |
| `branch_name` | string | 是 | 当前 worktree 对应分支 |
| `base_ref` | string | 是 | 创建时使用的引用 |
| `base_commit` | string | 是 | 创建时解析出的 commit |
| `head_commit` | string | 否 | 最近同步到的 HEAD |
| `display_name` | string | 是 | 工作台里显示的名称 |
| `depth` | number | 是 | 树深度，根的子节点为 1 |
| `lifecycle_status` | string | 是 | `active/merged/abandoned/removing/removed` |
| `merged_at` | string | 否 | 最近合并时间 |
| `removed_at` | string | 否 | 删除时间 |
| `created_at` | string | 是 | 创建时间 |
| `updated_at` | string | 是 | 更新时间 |

### 4.2 展示 DTO：`WorktreeNodeView`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `workspace` | `WorkspaceDto` | 是 | 当前节点对应工作区 |
| `meta` | `WorktreeMetaDto` | 是 | 血缘与状态信息 |
| `sessions` | `SessionSummaryDto[]` | 是 | 该工作树下当前会话 |
| `children` | `WorktreeNodeView[]` | 是 | 子工作树 |
| `contextTone` | string | 是 | 视觉 token |
| `contextHint` | string | 是 | “来源于 xxx / 分支 yyy” 之类提示 |

### 4.3 工作台快照扩展

现有 `WorkbenchSnapshotItem` 扩为：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `workspace` | `WorkspaceDto` | 是 | 根工作区 |
| `sessions` | `SessionSummaryDto[]` | 是 | 根工作区当前主工作树会话 |
| `childWorktrees` | `WorktreeNodeView[]` | 否 | 子工作树树 |
| `collapsed` | boolean | 否 | 根工作区折叠状态 |

注意：

- `sessions` 仍然只表示根工作区当前会话
- 子工作树不会再作为顶层 `items[]` 混进工作台

## 5. 关键流程

### 5.1 创建子工作树

1. 用户在根工作区或某个子工作树上点击“创建工作树”
2. 系统校验来源工作区是否干净
3. 解析 `baseRef` 与 `baseCommit`
4. 生成分支名与目标目录
5. 执行 `git worktree add`
6. 把目标目录注册成独立 `workspace`
7. 写入 `workspace_worktrees`
8. 刷新工作台快照

### 5.2 继续 fork

继续 fork 与“创建子工作树”是同一个后端动作，只是来源变成某个子工作树。

区别只有两点：

- `parent_workspace_id` 写当前节点
- `depth` 自动加一

### 5.3 合并回直接父节点

第一阶段只支持回直接父节点。

流程分两步：

1. `preview`
   - 校验目标工作区干净
   - 读取 merge base
   - 计算是否存在明显冲突风险
   - 返回来源、目标、ahead/behind、风险提示

2. `apply`
   - 只允许目标为直接父节点
   - 执行 merge
   - 成功后把当前节点标记为 `merged`
   - 保留目录与会话，不自动删

### 5.4 清理子工作树

1. 校验当前节点不是根工作区
2. 检查是否存在运行中会话、终端或其他占用
3. 将状态置为 `removing`
4. 执行 `git worktree remove`
5. 目录清理成功后标记 `removed`
6. 若失败，保留残留信息和错误详情

### 5.5 残留恢复

Host 启动或工作台刷新时，系统可选执行一次轻量同步：

- 用 `git worktree list --porcelain` 回读实际状态
- 比对数据库里仍为 `active/removing` 的节点
- 若目录已不存在但元数据还在，标记异常残留
- 若目录还在但 `workspace` 记录丢了，允许进入修复流程

## 6. 接口契约

### 6.1 `POST /api/worktrees`

- 输入：`sourceWorkspaceId`、`branchName`、`displayName?`、`baseRef?`
- 输出：新建的 `WorktreeNodeView`
- 说明：根工作区创建和子工作树继续 fork 共用这个接口

### 6.2 `GET /api/worktrees/tree`

- 输入：`rootWorkspaceId`
- 输出：`WorktreeNodeView[]`
- 说明：给工作台或详情页单独拉取子工作树树

### 6.3 `POST /api/worktrees/{workspaceId}/merge-preview`

- 输入：`workspaceId`
- 输出：预检结果

### 6.4 `POST /api/worktrees/{workspaceId}/merge-into-parent`

- 输入：`workspaceId`
- 输出：执行结果

### 6.5 `POST /api/worktrees/{workspaceId}/cleanup`

- 输入：`workspaceId`
- 输出：清理结果

## 7. 视觉区分方案

### 7.1 设计原则

- 不把整个应用主题改色
- 只在“当前上下文最关键的地方”做稳定提示
- 颜色只用来提示，不用来装饰

### 7.2 列表区

- 根工作区会话维持当前文字颜色
- 子工作树节点标题使用稳定 accent 色
- 当前选中的子工作树在名称旁显示简短上下文标签，比如 `子工作树`、`来自 feat/login`

### 7.3 聊天界面

- 顶部标题区或会话信息区显示当前工作树来源提示
- 子工作树聊天页使用轻量背景条或边框色提醒当前上下文
- 根工作区聊天页保留默认视觉，不强行染色

### 7.4 右侧信息栏

- 文件/Git/终端等右侧面板顶部显示当前工作树上下文条
- 子工作树使用浅色背景区分，根工作区保持默认底色
- 同一个工作树在列表、聊天页、右侧信息栏使用同一套 `contextTone`

### 7.5 颜色 token 生成

- 不允许随机色每次变化
- 颜色 token 从有限调色板里稳定映射
- 同一路径上的工作树可按分支名或 `workspaceId` 映射出稳定颜色
- 深度增加时优先改浅深度和强调度，不要无限加新颜色

## 8. 错误处理

### 8.1 错误类型

- `DIRTY_SOURCE_WORKSPACE`：来源工作区有未提交改动
- `WORKTREE_BRANCH_EXISTS`：分支冲突
- `WORKTREE_PATH_CONFLICT`：目标目录冲突
- `WORKTREE_PARENT_REQUIRED`：缺少父节点
- `WORKTREE_MERGE_TARGET_INVALID`：目标不是直接父节点
- `WORKTREE_RESOURCE_BUSY`：仍有运行中资源占用
- `WORKTREE_REMOVE_FAILED`：目录或 Git 状态导致删除失败

### 8.2 原则

1. 所有错误都要能定位到 `workspaceId`、`rootWorkspaceId`、`branchName`
2. 失败不能把顶层工作区主链路拖垮
3. 清理失败必须保留残留信息，方便人手处理

## 9. 与 spec012 的关系

`spec012.1` 先把下面这些地基立住：

- worktree 元数据
- worktree 创建与继续 fork
- worktree 合并与清理
- workbench 里的 worktree 树
- 上下文视觉区分

后续 `spec012` 再在这套基础上继续长：

- `ParallelCase`
- `ParallelAttempt`
- 运行时隔离
- 多 provider 批量编排
- 结果对比与 merge 建议
