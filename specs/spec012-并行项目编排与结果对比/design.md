# 设计文档 - spec012-并行会话组与临时子工作区

状态：Draft

## 1. 概述

### 1.1 目标

- 把并行会话组和组成员做成正式领域模型
- 明确真实会话父子关系与并行展示关系的边界
- 让每个成员可选绑定临时隔离工作区，而不是一刀切创建正式子工作区
- 在现有工作台中落地并行创建入口、分屏布局和局部悬浮信息栏
- 保证不使用并行会话时，现有单会话链路零破坏

### 1.2 覆盖需求

- `requirements.md` 需求 1：并行会话组和组成员模型
- `requirements.md` 需求 2：从现有会话发起并行 fork
- `requirements.md` 需求 3：从工作区直接新建并行组
- `requirements.md` 需求 4：公共配置和成员级配置
- `requirements.md` 需求 5：成员级临时隔离工作区
- `requirements.md` 需求 6：临时隔离工作区升级
- `requirements.md` 需求 7：删除时清理未升级资源
- `requirements.md` 需求 8：会话树和工作台展示
- `requirements.md` 需求 9：分屏布局
- `requirements.md` 需求 10：局部悬浮信息栏
- `requirements.md` 需求 11：兼容现有主链路

### 1.3 技术约束

- 会话真实 fork 能力沿用 `spec003.5`
- 正式子工作区生命周期沿用 `spec012.1`
- 现有 `workspace`、`session`、`worktree` 主链路不能被并行关系污染
- 第一阶段不引入结果对比、自动评估和完整运行时资源隔离

## 2. 核心判断

### 2.1 真正的一等对象不是“分支”也不是“第一个会话当假父亲”

这次真正需要平台托管的对象有三个：

1. 并行会话组
2. 组成员会话
3. 会话级临时隔离工作区

如果继续把“并行组”伪装成某种父子会话树，就会出现几个直接后果：

- `parentSessionId` 被拿去同时表达真实 fork 和展示投影
- fork 深度、溯源和恢复逻辑会变脏
- 删除锚点会话后，整组展示关系会断

所以这里有一条死规则：

**真实会话血缘只放在现有 `parentSessionId` 和 `session_forks`，并行关系必须单独建模。**

### 2.2 临时隔离工作区也不是正式子工作区

用户这次要的是“先临时隔离，确实有价值再升级”。

所以会话级隔离工作区必须满足两件事：

- 底层它是真实的 Git worktree，能隔离代码目录
- 上层它不是正式子工作区，不能一创建就混入 `workspace_worktrees`

这里也有一条死规则：

**临时隔离工作区先走会话级生命周期，只有升级成功后才进入正式子工作区体系。**

## 3. 总体结构

### 3.1 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `parallel-session-group-service` | 创建、读取、删除并行会话组与成员 | 创建请求、查询请求 | `ParallelSessionGroup`、`ParallelSessionMember` |
| `parallel-session-controller` | 暴露并行会话相关 API | 组创建、组删除、升级请求 | HTTP DTO |
| `parallel-session-layout-service` | 生成并行展示投影与锚点排序 | 组、成员、现有会话树 | 分屏和会话树投影 |
| `session-isolated-workspace-service` | 创建、升级、清理临时隔离工作区 | 成员配置、会话删除、升级动作 | 临时工作区记录、正式子工作区结果 |
| `workbench-parallel-assembler` | 为工作台拼装并行标签、颜色、展示父节点和临时工作区提示 | 工作台快照、并行元数据 | 导航 DTO、分屏 DTO |
| `conversation-parallel-view-state` | 管理前端分屏状态、悬浮信息层状态 | 当前组、当前成员、布局动作 | 前端局部 UI 状态 |

### 3.2 与现有能力的关系

- 创建普通会话和 fork 真实会话，继续复用现有 `session-history-service`
- 创建正式子工作区、合并、清理，继续复用 `spec012.1` 的正式链路
- 会话级临时隔离工作区可以复用底层 Git worktree 创建能力，但不能直接写进 `workspace_worktrees`
- 工作台会话树继续使用现有会话 DTO，只额外补并行投影字段

这里的原则很死：

**不复制现有会话和 worktree 主链路，只在上层补并行编排和会话级隔离。**

## 4. 数据结构

### 4.1 新增表：`parallel_session_groups`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 组 ID | 全局唯一 |
| `workspace_id` | string | 是 | 所属工作区 | 必须存在 |
| `source_type` | string | 是 | 来源类型 | `fork/new` |
| `source_session_id` | string | 否 | 来源会话 | `source_type=fork` 时必填 |
| `source_message_id` | string | 否 | 来源消息 | 消息级 fork 时可填 |
| `shared_prompt` | string | 否 | 公共提示词 | 可为空 |
| `requested_count` | number | 是 | 期望成员数 | 2-4 |
| `anchor_session_id` | string | 否 | 当前锚点会话 | 创建成员后回填 |
| `status` | string | 是 | 组状态 | `active/deleting/deleted` |
| `created_by_user_id` | string | 是 | 创建人 | 非空 |
| `created_at` | string | 是 | 创建时间 | ISO8601 |
| `updated_at` | string | 是 | 更新时间 | ISO8601 |
| `deleted_at` | string | 否 | 删除时间 | 可为空 |

### 4.2 新增表：`parallel_session_members`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `group_id` | string | 是 | 所属并行组 | 外键 |
| `session_id` | string | 是 | 真实会话 ID | 外键，唯一 |
| `ordinal` | number | 是 | 组内顺序 | 从 0 开始稳定排序 |
| `role` | string | 是 | 组内角色 | `anchor/member` |
| `provider` | string | 是 | 创建时 provider | 非空 |
| `model` | string | 否 | 创建时模型 | 可为空，表示 provider 默认 |
| `member_prompt` | string | 否 | 成员补充提示词 | 可为空 |
| `workspace_isolation_mode` | string | 是 | 工作区隔离模式 | `none/temporary_worktree` |
| `temporary_workspace_id` | string | 否 | 临时隔离工作区 ID | 可为空 |
| `created_at` | string | 是 | 创建时间 | ISO8601 |
| `updated_at` | string | 是 | 更新时间 | ISO8601 |
| `deleted_at` | string | 否 | 删除时间 | 可为空 |

### 4.3 新增表：`session_isolated_workspaces`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 临时隔离工作区记录 ID | 全局唯一 |
| `group_id` | string | 是 | 所属并行组 | 外键 |
| `owner_session_id` | string | 是 | 所属成员会话 | 外键，唯一 |
| `workspace_id` | string | 是 | 实际导入的 workspace | 必须存在 |
| `source_workspace_id` | string | 是 | 来源工作区 | 必须存在 |
| `branch_name` | string | 是 | 临时分支名 | 在根仓库内唯一 |
| `base_ref` | string | 是 | 创建时基准引用 | 非空 |
| `base_commit` | string | 是 | 创建时基准提交 | 非空 |
| `head_commit` | string | 否 | 当前提交 | 可为空 |
| `lifecycle_status` | string | 是 | 生命周期 | `active/promoted/removing/removed` |
| `promoted_at` | string | 否 | 升级时间 | 可为空 |
| `removed_at` | string | 否 | 清理时间 | 可为空 |
| `created_at` | string | 是 | 创建时间 | ISO8601 |
| `updated_at` | string | 是 | 更新时间 | ISO8601 |

说明：

- 这里的 `workspace_id` 指向真实导入的工作区目录
- 但在 `lifecycle_status = active` 时，它还不是正式子工作区
- 升级成功后，系统再补写 `workspace_worktrees`

### 4.4 工作台和会话树投影 DTO

为了不污染真实 `parentSessionId`，工作台 DTO 额外补一层展示字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `parallelGroup` | object \| null | 当前会话所属并行组摘要 |
| `parallelGroup.groupId` | string | 并行组 ID |
| `parallelGroup.role` | `anchor/member` | 当前会话在组内角色 |
| `parallelGroup.memberCount` | number | 组成员数 |
| `parallelGroup.sourceType` | `fork/new` | 组来源 |
| `parallelGroup.sourceSessionId` | string \| null | 来源会话 |
| `parallelGroup.anchorSessionId` | string \| null | 锚点会话 |
| `parallelGroup.colorToken` | string | 组颜色 token |
| `displayParentSessionId` | string \| null | 只用于树和连接线的展示父节点 |
| `sessionIsolatedWorkspace` | object \| null | 当前会话绑定的临时隔离工作区摘要 |

规则：

- `parentSessionId` 继续表示真实父会话
- `displayParentSessionId` 只在前端树装配时使用
- 后端 fork 深度、恢复和删除逻辑一律看真实字段，不看展示字段

## 5. 关键关系规则

### 5.1 从现有会话 fork 并行组

这是最自然的一种情况。

规则如下：

1. `parallel_session_groups.source_type = fork`
2. `source_session_id` 指向当前来源会话
3. 每个成员会话都保留自己的真实 fork 关系
4. 每个成员在工作台投影里都显示为“属于来源会话下面的一组并行会话”
5. `anchor_session_id` 只作为组内默认排序和默认分屏锚点，不替代来源会话

也就是说：

- 真实语义：这些成员都是来源会话 fork 出来的
- 展示语义：这些成员还属于同一个并行组

### 5.2 从工作区新建并行组

这是最容易长歪的一种情况。

这里明确不采用“第一个会话做真实父会话”的做法。

规则如下：

1. `parallel_session_groups.source_type = new`
2. `source_session_id = null`
3. 全部成员会话都可以是根会话，`parentSessionId = null`
4. 第一个成功创建的成员默认成为 `anchor_session_id`
5. 只有展示层把非锚点成员投影为挂在锚点下面

也就是说：

- 真实语义：它们都是同级根会话
- 展示语义：锚点会话只是组内展示入口

### 5.3 锚点删除规则

如果锚点会话被删除但组还没删空，系统执行以下动作：

1. 找组内 `deleted_at IS NULL` 且 `ordinal` 最小的下一个成员
2. 把它提升为新的 `anchor_session_id`
3. 重新生成前端展示投影

这样做的目的很简单：
**组不能因为删掉第一条会话就塌掉。**

## 6. 关键流程

### 6.1 从现有会话创建并行组

1. 前端从现有会话的并行 fork 入口打开弹窗
2. 用户输入公共提示词，选择并行数量
3. 用户为每个成员选择 provider、模型、成员补充提示词和是否隔离工作区
4. 后端创建 `parallel_session_group`
5. 后端逐个创建成员：
   - 若未启用隔离，则直接复用现有会话 fork / reconstructed fork 链路
   - 若启用隔离，则先创建临时隔离工作区，再把新会话绑定到该工作区
6. 第一个成功成员回填为 `anchor_session_id`
7. 工作台进入分屏视图

说明：

- 如果目标工作区改变导致 provider 不能做原生 fork，系统按现有重建策略处理
- 真实 fork 失败只影响当前成员，不能把整组已成功成员回滚成脏状态

### 6.2 从工作区新建并行组

1. 前端从“新建工作区”左侧入口打开并行创建弹窗
2. 用户输入公共提示词、选择数量、配置每个成员
3. 后端创建 `parallel_session_group`
4. 后端逐个创建成员会话：
   - 若未启用隔离，则在当前工作区创建普通新会话
   - 若启用隔离，则先创建临时隔离工作区，再在对应工作区创建会话
5. 第一个成功成员设为 `anchor_session_id`
6. 工作台进入并行分屏

### 6.3 创建临时隔离工作区

1. 校验来源工作区干净度和路径边界
2. 生成临时分支名和目录路径
3. 复用底层 Git worktree 创建动作生成真实目录
4. 导入为可访问的 `workspace`
5. 写入 `session_isolated_workspaces`
6. 回写 `parallel_session_members.temporary_workspace_id`

注意：

- 这一步不会写入 `workspace_worktrees`
- 所以前端顶层子工作区树里不应出现它

### 6.4 升级临时隔离工作区

1. 用户在对应会话的临时工作区上点击升级
2. 系统校验该临时工作区仍处于 `active`
3. 系统把现有 `workspace_id` 补写进正式 `workspace_worktrees`
4. 系统把 `session_isolated_workspaces.lifecycle_status` 更新为 `promoted`
5. 工作台从“会话挂载资源”切换为“正式子工作区”展示

### 6.5 删除成员或删除整组

删除成员时：

1. 先删除真实会话
2. 查找该成员是否绑定 `active` 状态的临时隔离工作区
3. 若存在，则清理临时目录、分支和记录
4. 若该成员是锚点且组内仍有其他成员，则重选锚点

删除整组时：

1. 标记组状态为 `deleting`
2. 逐个删除未删除成员
3. 逐个清理未升级临时隔离工作区
4. 标记组状态为 `deleted`

说明：

- 已升级为正式子工作区的工作区不会跟着自动删
- 这里遵守“升级后就是正式资产”的规则

## 7. 接口契约

### 7.1 `POST /api/sessions/:sessionId/parallel-groups`

- 作用：从现有会话发起并行 fork
- 输入：
  - `sourceMessageId?`
  - `sharedPrompt`
  - `count`
  - `members[]`
- `members[]` 至少包含：
  - `provider`
  - `model?`
  - `memberPrompt?`
  - `enableWorkspaceIsolation`
- 输出：
  - `group`
  - `members`
  - `anchorSessionId`

### 7.2 `POST /api/workspaces/:workspaceId/parallel-groups`

- 作用：从工作区直接新建并行会话组
- 输入：
  - `sharedPrompt`
  - `count`
  - `members[]`
- 输出：
  - `group`
  - `members`
  - `anchorSessionId`

### 7.3 `GET /api/parallel-groups/:groupId`

- 作用：读取并行组详情
- 输出：
  - 组元数据
  - 成员列表
  - 锚点会话
  - 成员级临时工作区摘要

### 7.4 `DELETE /api/parallel-groups/:groupId`

- 作用：删除整个并行组
- 输出：
  - 组删除结果
  - 成员清理结果摘要
  - 临时工作区清理结果摘要

### 7.5 `POST /api/session-isolated-workspaces/:id/promote`

- 作用：把临时隔离工作区升级为正式子工作区
- 输出：
  - 升级后的正式工作区摘要
  - 临时记录状态

### 7.6 会话删除兼容

现有会话删除入口继续保留。

补充规则：

- 当删除目标会话属于并行组时，后端自动补跑并行成员清理逻辑
- 当前端只是删单个会话，不要求必须走新的并行组专用删除接口

## 8. 前端交互与布局

### 8.1 入口

- 在现有 fork 按钮旁新增并行 fork 入口
- 在“新建工作区”左侧新增并行会话入口

### 8.2 创建弹窗

弹窗分两层信息：

1. 组级公共信息
   - 公共提示词
   - 并行数量
2. 成员级配置
   - provider
   - model
   - 成员补充提示词
   - 是否启用工作区隔离

### 8.3 分屏布局

- 2 到 4 个成员统一使用并排分屏
- 每屏采用更窄的边距和更紧凑的头部信息
- 每屏顶部至少展示：
  - 会话标题
  - provider
  - model
  - 并行标签
  - 信息按钮

### 8.4 悬浮信息栏

- 进入并行分屏时，原全局右侧信息栏默认隐藏
- 改为每个分屏顶部按钮触发该分屏自己的浮层
- 浮层展示当前会话的信息、临时工作区摘要和升级入口

## 9. 状态模型

### 9.1 `ParallelSessionGroup.status`

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `active` | 组可正常使用 | 创建成功 | 删除开始 |
| `deleting` | 正在清理组和成员 | 用户删除组 | 清理完成 |
| `deleted` | 组已删除 | 清理完成 | 终态 |

### 9.2 `SessionIsolatedWorkspace.lifecycleStatus`

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `active` | 临时隔离工作区仍归属于会话 | 创建成功 | 升级或删除 |
| `promoted` | 已升级为正式子工作区 | 升级成功 | 终态 |
| `removing` | 正在清理 | 会话或组删除 | 清理完成 |
| `removed` | 已删除 | 清理完成 | 终态 |

## 10. 错误处理

### 10.1 错误类型

- `输入错误`：并行数量越界、成员 provider 缺失、模型不合法
- `来源错误`：来源会话不存在、来源消息不存在、来源工作区不存在
- `fork 错误`：某成员 fork 失败、provider 不支持目标方式
- `隔离错误`：临时工作区创建失败、路径冲突、分支冲突
- `升级错误`：临时工作区状态不允许升级、正式 worktree 元数据写入失败
- `清理错误`：目录、分支或记录未清理干净

### 10.2 关键原则

1. 真实 fork 错误和隔离工作区错误必须精确定位到具体成员
2. 组内部分成员失败时，不能把已成功成员一起抹掉成未知状态
3. 清理失败不能假装成功，必须返回残留会话、工作区或分支信息

## 11. 兼容性与迁移

- 不使用并行会话时，现有会话列表、右侧信息栏和普通 fork 完全不变
- 现有 `workspace_worktrees` 只继续承载正式子工作区
- 新增的临时隔离工作区先走独立表和独立展示，升级后再进入正式链路
- 结果对比、自动评估这类更重的能力后续另起阶段，不在本阶段混做
