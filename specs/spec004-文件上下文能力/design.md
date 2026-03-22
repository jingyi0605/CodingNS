# 设计文档 - spec004-文件上下文能力

状态：Draft

## 1. 概述

### 1.1 目标

- 提供工作区内可控的文件浏览与基础操作能力
- 提供搜索、最近打开、预览、基础编辑能力
- 提供会话文件上下文挂载能力，并与 `spec003` 会话运行时对接
- 严格执行鉴权和工作区边界校验，杜绝越权访问
- 保持“文件是上下文，不是消息真相来源”的边界

### 1.2 覆盖需求

- `requirements.md` 需求 1：文件操作受工作区边界和鉴权保护
- `requirements.md` 需求 2：文件树和基础文件操作可用
- `requirements.md` 需求 3：搜索、最近打开、预览覆盖核心场景
- `requirements.md` 需求 4：基础编辑稳定并有最小冲突保护
- `requirements.md` 需求 5：文件上下文挂载与 spec003 对接
- `requirements.md` 需求 6：文件上下文不伪造会话消息真相
- `requirements.md` 需求 7：API 边界清晰且默认受保护

### 1.3 技术约束

- 后端：`Node.js 22 + TypeScript + Fastify + ws`
- 存储：`SQLite (better-sqlite3)` + 文件系统
- 鉴权：沿用 `spec001` 的 token 鉴权机制
- 会话对接：沿用 `spec003` 的会话运行时，不创建第二套消息来源
- 安全边界：所有文件路径必须在工作区白名单根目录内，并通过 path traversal 校验

## 2. 架构

### 2.1 系统结构

`spec004` 的核心结构分三层：

1. 文件访问层：负责路径规范化、白名单校验、真实文件读写。
2. 文件能力层：负责文件树、搜索、预览、最近打开、基础编辑。
3. 会话上下文层：负责文件上下文挂载、解绑、查询，并把结果提供给 `spec003`。

请求基本流程：

1. 客户端发起受保护文件请求。
2. 服务端先过鉴权与 workspace 边界校验。
3. 根据操作类型进入文件能力层执行。
4. 如果是上下文挂载请求，写入上下文绑定元数据并返回给会话运行时。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `file-access-guard` | 鉴权、路径规范化、白名单边界校验 | token、workspaceId、path | 通过/拒绝结果 |
| `file-tree-service` | 构建文件树与节点元信息 | workspacePath、目录参数 | 文件树节点 |
| `file-content-service` | 文件读取、保存、创建、删除、重命名、移动 | 文件路径、内容、操作参数 | 操作结果与版本信息 |
| `file-search-service` | 文件名/路径搜索与分页 | workspacePath、keyword、page | 搜索结果 |
| `recent-file-service` | 最近打开记录维护与查询 | workspaceId、userId、filePath | 最近打开列表 |
| `file-preview-service` | 按类型预览文件 | filePath、mime/type | 预览数据或不支持提示 |
| `file-context-service` | 会话文件上下文挂载、解绑、查询 | sessionId、filePath、range/hash | 绑定记录列表 |

### 2.3 关键流程

#### 2.3.1 文件浏览与读取流程

1. 客户端请求文件树或文件内容。
2. `file-access-guard` 完成鉴权、workspace/path 边界校验。
3. `file-tree-service` 或 `file-content-service` 执行读取。
4. 成功返回文件信息；失败返回标准错误码。

#### 2.3.2 文件保存与冲突校验流程

1. 客户端提交保存请求，带 `expectedVersion`（或等价版本标识）。
2. 服务端校验路径边界与写权限。
3. 比较当前版本与 `expectedVersion`。
4. 一致则写入并返回新版本；不一致则返回冲突错误。
5. 更新最近打开记录和必要缓存状态。

#### 2.3.3 文件上下文挂载流程（对接 spec003）

1. 客户端在会话页选择文件并发起挂载请求。
2. 服务端校验 `sessionId`、`workspaceId`、`filePath` 一致性。
3. 写入 `FileContextBinding` 元数据（路径、范围、hash、版本、挂载人、时间）。
4. 返回绑定结果给会话运行时，用于在输入区/会话头部展示。
5. 会话消息仍由 provider/Host 链路提供，不被上下文绑定替代。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7

- `FileController`：文件树、读取、写入、重命名、删除、移动入口
- `SearchController`：文件搜索入口
- `RecentController`：最近打开查询入口
- `FileContextController`：会话文件上下文挂载与解绑入口
- `WorkspacePathGuard`：路径白名单与 path traversal 防护
- `FileVersionChecker`：保存前版本冲突检查

### 3.2 数据结构

覆盖需求：2、3、4、5、6

#### 3.2.1 `FileNode`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `path` | string | 是 | 相对工作区路径 | 不允许绝对路径 |
| `name` | string | 是 | 文件/目录名 | 非空 |
| `kind` | enum | 是 | `file` 或 `directory` | 枚举值 |
| `size` | number | 否 | 文件大小（字节） | 目录可空 |
| `updatedAt` | string | 否 | 最近修改时间 | ISO8601 |
| `children` | FileNode[] | 否 | 子节点 | 目录可有 |

#### 3.2.2 `FileSnapshot`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `workspaceId` | string | 是 | 工作区 ID | 必须存在 |
| `path` | string | 是 | 相对工作区路径 | 边界校验通过 |
| `content` | string | 是 | 文件内容 | 文本类型 |
| `encoding` | string | 是 | 编码格式 | 默认 `utf-8` |
| `version` | string | 是 | 版本标识（hash/mtime+size） | 保存前后变化 |
| `size` | number | 是 | 文件大小 | >= 0 |

#### 3.2.3 `RecentFileRecord`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 记录 ID | 全局唯一 |
| `workspaceId` | string | 是 | 工作区 ID | 必须存在 |
| `userId` | string | 是 | 用户 ID | 必须存在 |
| `path` | string | 是 | 相对工作区路径 | 边界校验通过 |
| `lastOpenedAt` | string | 是 | 最近打开时间 | ISO8601 |
| `pinned` | boolean | 是 | 是否置顶 | 默认 false |

#### 3.2.4 `FileContextBinding`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 绑定 ID | 全局唯一 |
| `sessionId` | string | 是 | 会话 ID | 必须存在 |
| `workspaceId` | string | 是 | 工作区 ID | 必须与会话一致 |
| `path` | string | 是 | 相对工作区路径 | 边界校验通过 |
| `rangeStart` | number | 否 | 片段起始行 | 可空 |
| `rangeEnd` | number | 否 | 片段结束行 | 可空 |
| `contentHash` | string | 是 | 挂载时内容 hash | 用于追溯 |
| `fileVersion` | string | 是 | 挂载时文件版本 | 用于变更提示 |
| `attachedBy` | string | 是 | 操作用户 ID | 必须存在 |
| `attachedAt` | string | 是 | 挂载时间 | ISO8601 |

### 3.3 接口契约

覆盖需求：1、2、3、4、5、7

#### 3.3.1 获取文件树

- 类型：HTTP
- 路径：`GET /api/files/tree`
- 输入：`workspaceId`、`path`（可选）、登录态 token
- 输出：`FileNode[]`
- 校验：路径必须在工作区内
- 错误：`401 UNAUTHORIZED`、`403 WORKSPACE_FORBIDDEN`、`400 PATH_OUT_OF_WORKSPACE`

#### 3.3.2 读取文件内容

- 类型：HTTP
- 路径：`GET /api/files/content`
- 输入：`workspaceId`、`path`、登录态 token
- 输出：`FileSnapshot`
- 校验：仅允许读取工作区内可访问文件
- 错误：`401 UNAUTHORIZED`、`404 FILE_NOT_FOUND`、`400 PATH_TRAVERSAL_BLOCKED`

#### 3.3.3 保存文件内容

- 类型：HTTP
- 路径：`PUT /api/files/content`
- 输入：`workspaceId`、`path`、`content`、`expectedVersion`、登录态 token
- 输出：`{ version: string, updatedAt: string }`
- 校验：边界校验 + 版本冲突检查
- 错误：`401 UNAUTHORIZED`、`409 FILE_VERSION_CONFLICT`、`400 INVALID_CONTENT`

#### 3.3.4 文件操作（创建/删除/重命名/移动）

- 类型：HTTP
- 路径：`POST /api/files/ops`
- 输入：`workspaceId`、`opType`、`srcPath`、`dstPath`（按操作必填）、登录态 token
- 输出：`{ success: true, opType: string }`
- 校验：所有路径都必须在工作区内
- 错误：`401 UNAUTHORIZED`、`400 PATH_OUT_OF_WORKSPACE`、`409 FILE_ALREADY_EXISTS`

#### 3.3.5 搜索文件

- 类型：HTTP
- 路径：`GET /api/files/search`
- 输入：`workspaceId`、`keyword`、`page`、`pageSize`、登录态 token
- 输出：`{ items: SearchItem[], total: number }`
- 校验：关键词和分页参数必须合法
- 错误：`401 UNAUTHORIZED`、`400 INVALID_QUERY`

#### 3.3.6 获取最近打开

- 类型：HTTP
- 路径：`GET /api/files/recent`
- 输入：`workspaceId`、`limit`、登录态 token
- 输出：`RecentFileRecord[]`
- 校验：仅返回当前用户可见记录
- 错误：`401 UNAUTHORIZED`、`403 WORKSPACE_FORBIDDEN`

#### 3.3.7 挂载会话文件上下文

- 类型：HTTP
- 路径：`POST /api/sessions/{sessionId}/contexts/files`
- 输入：`workspaceId`、`path`、`rangeStart`、`rangeEnd`、登录态 token
- 输出：`FileContextBinding`
- 校验：`sessionId` 与 `workspaceId` 必须匹配
- 错误：`401 UNAUTHORIZED`、`404 SESSION_NOT_FOUND`、`400 PATH_OUT_OF_WORKSPACE`

#### 3.3.8 解绑会话文件上下文

- 类型：HTTP
- 路径：`DELETE /api/sessions/{sessionId}/contexts/files/{bindingId}`
- 输入：`sessionId`、`bindingId`、登录态 token
- 输出：`{ success: true }`
- 校验：绑定关系必须存在且属于当前会话
- 错误：`401 UNAUTHORIZED`、`404 CONTEXT_BINDING_NOT_FOUND`

## 4. 数据与状态模型

### 4.1 数据关系

- 一个 `Workspace` 包含多个文件节点 `FileNode`。
- 一个用户在一个工作区可有多条 `RecentFileRecord`。
- 一个 `Session` 可挂载多条 `FileContextBinding`。
- `FileContextBinding` 只保存引用元数据，不保存会话消息正文。
- 会话消息真相仍由 `spec002` 的 provider 链路提供，`spec004` 不改这条链路。

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `IDLE` | 文件面板空闲 | 页面初始化完成 | 发起操作 |
| `LOADING` | 正在读取文件/文件树 | 发起读取请求 | 成功或失败 |
| `EDITING` | 文件处于编辑态 | 读取成功并进入编辑 | 保存或关闭 |
| `SAVING` | 正在保存 | 发起保存请求 | 成功、冲突或失败 |
| `CONFLICT` | 版本冲突 | 保存时版本不一致 | 手动刷新后重试 |
| `ERROR` | 失败状态 | 任意操作失败 | 用户重试或离开 |

## 5. 错误处理

### 5.1 错误类型

- `鉴权错误`：未登录或 token 无效
- `边界错误`：路径不在工作区或 path traversal
- `资源错误`：文件不存在、目录不存在、绑定记录不存在
- `冲突错误`：文件版本冲突、重命名目标已存在
- `输入错误`：参数缺失、范围非法、分页非法

### 5.2 错误响应格式

```json
{
  "detail": "文件路径超出工作区边界",
  "error_code": "PATH_OUT_OF_WORKSPACE",
  "field": "path",
  "timestamp": "2026-01-01T00:00:00Z"
}
```

### 5.3 处理策略

1. 输入验证错误：直接拒绝并返回字段级错误信息。
2. 业务规则错误：返回明确错误码，不做静默降级。
3. 外部依赖错误：记录日志并返回可重试提示。
4. 重试与补偿：版本冲突要求先刷新再保存，不允许盲目覆盖。

## 6. 正确性属性

### 6.1 属性 1：文件操作永不越界

*对于任何* 文件请求，系统都应该满足：路径必须经过工作区白名单与 traversal 校验，越界请求必拒绝。

**验证需求：** 需求 1、需求 7

### 6.2 属性 2：文件上下文不改变会话消息真相

*对于任何* 会话文件上下文挂载操作，系统都应该满足：只新增/更新绑定元数据，不产生第二份会话原始消息源。

**验证需求：** 需求 5、需求 6

### 6.3 属性 3：保存冲突可检测且可恢复

*对于任何* 带版本保存请求，系统都应该满足：版本不一致时返回冲突，不发生盲写覆盖。

**验证需求：** 需求 4

## 7. 测试策略

### 7.1 单元测试

- 路径规范化与工作区边界校验
- 文件版本冲突检查
- 文件上下文绑定模型校验

### 7.2 集成测试

- 文件树读取、文件读写、文件操作接口
- 搜索与最近打开接口
- 文件上下文挂载/解绑接口与会话联动

### 7.3 端到端测试

- 会话页中“打开文件 -> 编辑保存 -> 挂载上下文 -> 解除挂载”完整链路
- 未登录访问文件接口与越界访问拦截链路

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.1、§3.3、§6.1 | 安全测试 + 集成测试 |
| `requirements.md` 需求 3 | `design.md` §2.2、§3.3.5、§3.3.6 | 搜索/最近打开集成测试 |
| `requirements.md` 需求 5 | `design.md` §2.3.3、§3.3.7、§6.2 | 端到端链路测试 |

## 8. 风险与待确认项

### 8.1 风险

- 大型仓库文件树和搜索性能抖动，可能影响会话主界面体验。
- 文件版本冲突策略如果设计过弱，会导致误覆盖用户修改。
- 文件上下文挂载如果没有统一约束，前端容易把它误当成消息来源。

### 8.2 待确认项

- 第一阶段文件预览支持的类型白名单（例如 `txt/md/json/js/ts/yaml`）最终清单。
- 文件上传下载是否在本阶段最小实现内，还是放到后续增强任务。
