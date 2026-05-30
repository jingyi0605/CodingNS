# 设计文档 - spec016.1-事务视图文档库与索引HOST集成

状态：Draft

## 1. 概述

### 1.1 目标

- 把事务视图文档库从“会话占位数据”改成真实文档库对象
- 把 `doc-semantic-index-node` 的索引能力正式收进 `apps/host`
- 把索引相关重活全部接入统一 `TaskManager` / worker，避免拖 Host 主线程

### 1.2 覆盖需求

- `requirements.md` 需求 1：文档库路径绑定
- `requirements.md` 需求 2：真实文档对象
- `requirements.md` 需求 3：真实收藏和真实标签
- `requirements.md` 需求 4：索引能力进入 HOST
- `requirements.md` 需求 5：后台任务统一接入
- `requirements.md` 需求 6：统一状态和错误状态
- `requirements.md` 需求 7：助手围绕真实文档对象工作

### 1.3 技术约束

- 前端修改范围锁定在 `apps/user-app`
- Host 侧必须遵守 `spec001.2` 和 `spec001.2.1`
- 索引重活不能继续留在请求主线程
- 首阶段先复用 `doc-semantic-index-node` 已有配置文件、导出结构和 CLI 能力，不重造索引器
- 不允许再长独立的私有后台任务体系

## 2. 架构

### 2.1 系统结构

整体拆成四层：

1. **事务视图前端层**
   - 负责文档库绑定 UI
   - 负责读取文档库快照、标签、收藏、状态
   - 负责把当前选中文档传给右侧详情和助手

2. **HOST 文档库门面层**
   - 新增文档库/索引服务模块
   - 统一提供绑定、读取快照、状态读取、刷新触发 API
   - 把工作区配置、导出快照、任务状态、错误摘要对前端收口

3. **HOST 后台任务层**
   - 通过 `TaskManager` 注册索引相关任务
   - 去重、超时、观测、状态更新统一走现有任务体系
   - 重活分发到 `helper_process` 或 `external_process`

4. **索引执行层**
   - 复用 `doc-semantic-index-node` 的配置结构、CLI 和导出格式
   - 负责真实扫描、标签重算、导出刷新

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `AffairsWorkbenchView` | 事务视图文档库入口、列表、详情联动 | workspaceId、文档库快照 | 文档列表、详情、助手上下文 |
| `AffairsLibraryBindingService` | 保存/读取工作区文档库绑定 | workspaceId、rootDir | 绑定配置 |
| `WorkspaceDocumentIndexService` | Host 内部索引门面 | workspaceId、配置、任务状态 | 快照、标签、收藏、状态 |
| `TaskManager` 索引任务注册 | 调度配置应用、重扫、标签重算、导出刷新 | taskType + key + input | 任务结果、状态、指标 |
| `doc-semantic-index-node` 执行器 | 实际扫描和导出 | rootDir、CLI 参数 | 导出快照、状态文件 |

### 2.3 关键流程

#### 2.3.1 首次进入事务视图并绑定文档库

1. 前端进入 `/workspaces/:workspaceId/affairs`
2. 前端先读 Host 的工作区文档库绑定
3. 如果没有绑定，显示文档库路径绑定入口
4. 用户提交路径后，前端调用 Host 保存绑定
5. Host 写入工作区级配置
6. Host 返回绑定结果和当前索引状态
7. 前端开始读取文档库快照

#### 2.3.2 读取文档库主列表

1. 前端请求 Host 的文档库快照接口
2. Host 只读取最近可用快照和状态
3. Host 返回：文档列表、标签、收藏、状态、错误摘要
4. 前端根据当前过滤条件展示主列表
5. 用户选中文档后，右侧详情和助手上下文同步切换

#### 2.3.3 配置变化或用户显式刷新

1. 前端调用 Host 的显式刷新入口
2. Host 只更新脏状态并 enqueue 对应任务
3. `TaskManager` 按 `taskType + workspaceId` 去重
4. 重活在 `helper_process` 或 `external_process` 执行
5. 成功后 Host 更新索引状态和最近快照元信息
6. 前端下次读快照时看到新状态；必要时订阅当前状态更新

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7

- **事务视图文档库状态扩展**：给 `AffairsViewState` 补文档库绑定和浏览状态
- **Host 文档库服务**：负责绑定配置、读取快照、统一状态和错误
- **索引任务注册器**：把索引相关重活接进现有 `TaskManager`
- **索引执行桥**：受控调用 `doc-semantic-index-node` 的 CLI 或导出读取逻辑

### 3.2 数据结构

覆盖需求：1、2、3、6、7

#### 3.2.1 `AffairsLibraryBinding`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `workspaceId` | `string` | 是 | 工作区 ID | 非空 |
| `rootDir` | `string` | 是 | 文档库根路径 | 必须是工作区允许访问的真实路径 |
| `configRelativePath` | `string` | 是 | 索引配置相对路径 | 首阶段固定 `.ai-index/doc-semantic-index.config.json` |
| `exportMode` | `"v2"` | 是 | 导出模式 | 首阶段固定 `v2` |
| `updatedAt` | `string` | 是 | 最近更新时间 | ISO 时间 |

#### 3.2.2 `AffairsLibraryViewState`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `browseMode` | `"folder" | "tag"` | 是 | 当前浏览模式 | 默认 `folder` |
| `selectedFolderPath` | `string \| null` | 否 | 当前选中文件夹 | `browseMode=folder` 时可用 |
| `selectedTagPath` | `string \| null` | 否 | 当前选中标签 | `browseMode=tag` 时可用 |
| `selectedDocumentId` | `string \| null` | 否 | 当前选中文档 | 可空 |
| `selectedFavoriteId` | `string \| null` | 否 | 当前选中收藏入口 | 可空 |

#### 3.2.3 `WorkspaceDocumentLibrarySnapshot`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `binding` | `AffairsLibraryBinding \| null` | 是 | 当前绑定 | 无绑定时为空 |
| `status` | `DocumentIndexStatusSnapshot` | 是 | 当前索引状态 | 统一状态模型 |
| `documents` | `DocumentLibraryRecord[]` | 是 | 当前主列表文档 | 来自真实快照 |
| `tags` | `DocumentTagNode[]` | 是 | 标签列表/标签树 | 来自真实索引 |
| `favorites` | `DocumentFavoriteRecord[]` | 是 | 收藏列表 | 工作区文档库收藏 |
| `lastError` | `string \| null` | 否 | 最近错误摘要 | 可空 |

#### 3.2.4 `DocumentIndexStatusSnapshot`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `state` | `"fresh" | "stale" | "running" | "cooldown" | "failed"` | 是 | 当前状态 | 统一模型 |
| `dirtyReasons` | `string[]` | 是 | 脏原因 | 可空数组 |
| `lastRequestedAt` | `string \| null` | 否 | 最近请求刷新时间 | ISO 时间 |
| `lastStartedAt` | `string \| null` | 否 | 最近启动时间 | ISO 时间 |
| `lastCompletedAt` | `string \| null` | 否 | 最近完成时间 | ISO 时间 |
| `lastFailedAt` | `string \| null` | 否 | 最近失败时间 | ISO 时间 |
| `nextAllowedAt` | `string \| null` | 否 | 冷却截止时间 | ISO 时间 |
| `runningTaskId` | `string \| null` | 否 | 当前任务 ID | 可空 |
| `errorSummary` | `string \| null` | 否 | 最近失败摘要 | 可空 |

### 3.3 接口契约

覆盖需求：1、2、3、4、5、6

#### 3.3.1 读取工作区文档库绑定

- 类型：HTTP
- 路径或标识：`GET /api/workspaces/:workspaceId/affairs/library-binding`
- 输入：`workspaceId`
- 输出：`AffairsLibraryBinding | null`
- 校验：工作区必须存在且当前用户可访问
- 错误：工作区不存在、权限不足

#### 3.3.2 保存工作区文档库绑定

- 类型：HTTP
- 路径或标识：`PUT /api/workspaces/:workspaceId/affairs/library-binding`
- 输入：`rootDir`
- 输出：`AffairsLibraryBinding`
- 校验：路径非空、路径存在、路径可访问
- 错误：路径无效、索引配置不可写

#### 3.3.3 读取事务视图文档库快照

- 类型：HTTP
- 路径或标识：`GET /api/workspaces/:workspaceId/affairs/library-snapshot`
- 输入：`workspaceId`、可选筛选条件
- 输出：`WorkspaceDocumentLibrarySnapshot`
- 校验：工作区存在；若未绑定，则返回无绑定状态而不是假数据
- 错误：绑定缺失、快照损坏、工具缺失

#### 3.3.4 显式请求文档库刷新

- 类型：HTTP
- 路径或标识：`POST /api/workspaces/:workspaceId/affairs/library-refresh`
- 输入：`reason`
- 输出：当前 `DocumentIndexStatusSnapshot` 和任务摘要
- 校验：仅显式入口允许触发刷新
- 错误：绑定缺失、任务入队失败

## 4. 数据与状态模型

### 4.1 数据关系

核心关系：

1. **工作区** 绑定一份 **文档库根路径**
2. **文档库根路径** 对应一份 `.ai-index/doc-semantic-index.config.json`
3. **索引配置** 决定 `dbPath`、`exportV2Dir`、`tagRulesPath`
4. **导出快照** 提供前端主读链路
5. **后台任务状态** 单独表达刷新和失败，不混进文档列表本身

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `fresh` | 当前结果可直接用 | 最近导出可用且没有新脏标记 | 配置变化、watcher 脏标记、显式刷新 |
| `stale` | 已过期，等待刷新 | 发现脏标记 | 成功入队后进入 `running` |
| `running` | 后台任务正在执行 | 索引任务已启动 | 成功进入 `cooldown`，失败进入 `failed` |
| `cooldown` | 刚刷新完，短时间不重复跑 | 后台任务完成 | 冷却结束回 `fresh`；若新脏标记则回 `stale` |
| `failed` | 最近一次刷新失败 | 后台任务失败 | 新显式刷新或新脏标记回 `stale` |

## 5. 错误处理

### 5.1 错误类型

- **未绑定文档库**：用户还没给当前工作区配置路径
- **路径无效**：绑定路径不存在或不可访问
- **索引工具缺失**：Host 找不到 `doc-semantic-index-node`
- **导出快照缺失或损坏**：快照还没生成，或者文件结构不完整
- **后台任务失败**：扫描、重算标签、导出刷新失败

### 5.2 错误响应格式

```json
{
  "detail": "当前工作区还没有绑定文档库路径",
  "error_code": "AFFAIRS_LIBRARY_BINDING_REQUIRED",
  "timestamp": "2026-05-30T00:00:00Z"
}
```

### 5.3 处理策略

1. 绑定缺失：前端显示绑定入口，不继续展示假列表
2. 路径无效：保存失败并提示重新选择
3. 工具缺失：返回明确错误，并提示 Host 侧索引工具未就绪
4. 后台失败：保留最近一次可用结果，状态切到 `failed`

## 6. 正确性属性

### 6.1 属性 1：读接口不顺手开重活

*对于任何* 文档库读取请求，系统都应该满足：读取快照只读最近结果和状态，不在请求主线程现算重扫描。

**验证需求：** 需求 4、需求 5、需求 6

### 6.2 属性 2：同一工作区同类索引任务只能有一个 inflight

*对于任何* 同一工作区的同类索引任务，系统都应该满足：通过 `taskType + workspaceId` 去重，避免重复并发重活。

**验证需求：** 需求 5、需求 6

## 7. 测试策略

### 7.1 单元测试

- 文档库绑定状态读写
- 索引状态模型流转
- 快照读取与错误分支

### 7.2 集成测试

- Host API：绑定、读快照、显式刷新
- 任务调度：去重、状态更新、失败回退

### 7.3 端到端测试

- 首次进入事务视图 -> 绑定路径 -> 看到真实文档列表
- 选标签 / 收藏 -> 中间列表和右侧详情联动
- 刷新事务视图 -> 恢复绑定和上次浏览状态

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.3.1、§3.3 | 绑定流程测试 |
| `requirements.md` 需求 2、3 | `design.md` §2.3.2、§3.2 | 文档/标签/收藏联动测试 |
| `requirements.md` 需求 4、5、6 | `design.md` §2.1、§4.2、§6.1、§6.2 | Host 集成和任务调度测试 |
| `requirements.md` 需求 7 | `design.md` §3.2、§2.3.2 | 助手上下文联动测试 |

## 8. 风险与待确认项

### 8.1 风险

- `doc-semantic-index-node` 当前还在外部目录，真正收进 HOST 时会遇到构建、发布和运行路径管理问题
- 如果导出快照太大，前端一次性读取会带来新的性能风险，需要首阶段限制主读范围或做分段读取
- 当前 `workspace-index-apply-service.ts` 还是窄桥，后续若不收口成正式服务，很容易继续长旁路

### 8.2 待确认项

- 索引工具最终是以内嵌 workspace tool 形态复用，还是提炼成 `apps/host` 可直接依赖的内部模块
- 首阶段真实收藏的持久化是沿用工作区配置文件，还是提前进入 Host 存储层
- 前端主列表首阶段是直接吃 `exports-v2` 全量快照，还是 Host 先做裁剪快照再给前端
