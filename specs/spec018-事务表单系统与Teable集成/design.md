# 设计文档 - spec018-事务表单系统与Teable集成

状态：In Progress

## 1. 目标

这次集成现在只保留一条主线：

**CodingNS 保存真源数据，Host 把标签、会话记录、代办单向同步到 Teable 的指定表。**

已经放弃的路线也写清楚：

- 不再在事务工作台画布里嵌入 Teable 分享页。
- 不再维护 Teable iframe / 分享链接 / Host 页面代理。
- 不再在工作台添加 Teable 块来显示 Teable 原生表格、表单、看板或日历视图。
- 后续如果要在 CodingNS 里展示或编辑 Teable 数据，会通过 Teable API 做 CodingNS 自己的前端页面，不再嵌入 Teable 页面。

当前阶段要做好的只有这些：

1. 在设置里保存一个全局 Teable 连接。
2. 在设置里选择 Teable 已有表作为镜像同步目标。
3. 配置 CodingNS 数据和 Teable 字段之间的映射。
4. Host 通过 TaskManager 执行同步，并保存同步日志。
5. 本地标签、会话记录、代办发生变化时，按配置触发同步任务。

## 2. 边界

### 2.1 保留什么

- Teable 全局连接设置。
- Teable 表目录读取。
- Teable 表字段读取。
- 按需在 Teable 表里创建字段，并自动生成字段映射草稿。
- 表同步设置。
- 字段映射设置。
- 手动同步。
- 本地变化触发同步。
- 同步日志。

### 2.2 移除什么

- 事务工作台 Teable 块。
- `AffairsTeableFormBlock`。
- Teable iframe 展示。
- Teable 分享页代理。
- Teable 表单接入记录。
- Teable 表单结果回流接口。
- 工作台里的“新建记录”表单弹窗。
- `form-catalog`、`form-bindings`、`view-proxy-link`、`inbound-sync` 这些围绕分享页和表单接入的接口。

### 2.3 暂时保留的旧库兼容

SQLite 里旧的 `user_teable_form_bindings` 和 `user_teable_inbound_record_mappings` 建表/补列逻辑可以暂时保留。

原因很简单：这是旧库启动兼容，不是运行主链路。删掉它可能让老数据库升级出问题，但保留它不会让前端或 Host 继续使用废弃功能。

## 3. 数据流

### 3.1 全局连接

1. 用户打开 `设置 -> 能力管理 -> Teable 设置`。
2. 用户填写 Teable 地址、空间 ID、Base ID、认证信息和同步模式。
3. Host 校验连接。
4. Host 保存全局配置。
5. 后续所有表目录、字段目录和同步任务都使用这份配置。

Teable 连接是全局能力，不绑定某个代码工作区。

### 3.2 表同步配置

1. 用户在“表同步设置”里添加 Teable 已有表。
2. 用户选择同步内容：会话记录、代办、文档库标签。
3. 会话记录和代办可以选择全部工作区，也可以选择指定工作区。
4. 文档库标签只从事务模式文档库入口读取，不从每个代码工作区重复读取。
5. Host 保存目标表、同步范围和启用状态。

### 3.3 字段映射

字段映射有两种方式：

1. 手动映射：用户自己把 CodingNS 源字段对应到 Teable 目标字段。
2. 自动建字段：用户勾选需要的源字段，Host 调 Teable API 创建字段，并自动把新字段写入映射草稿。

保存同步配置时，Host 必须校验：

- 目标表存在。
- 必填字段已经映射。
- 同一个 Teable 字段没有被重复映射。
- 字段类型至少在当前支持范围内可用。

### 3.4 同步执行

1. 用户手动点击同步，或本地数据变化触发同步。
2. Host 把同步任务放入 TaskManager。
3. 同类资源同一时间只允许一个有效同步任务，避免并发乱写。
4. 同步任务读取当前配置和字段映射。
5. Host 从 CodingNS 真源读取数据。
6. Host 写入 Teable 指定表。
7. Host 记录同步日志。

当前增量判断主要依赖本地镜像记录映射和 fingerprint。没有变化的记录跳过，不默认全量重刷。

### 3.5 同步日志

同步日志记录：

- 触发方式：手动、本地变化、重试。
- 同步内容：标签、会话、代办。
- 任务状态：排队、运行中、成功、部分失败、失败。
- 新增、更新、删除、跳过数量。
- 错误摘要。
- 开始和结束时间。

设置页提供“同步日志”标签页查看这些记录。

## 4. 模块职责

| 模块 | 职责 | 是否保留 |
| --- | --- | --- |
| `TeableGlobalBindingService` | 保存和校验全局 Teable 连接 | 保留 |
| `TeableCatalogService` | 读取 Teable 表和字段，创建字段 | 保留 |
| `TeableWorkbenchSyncConfigService` | 保存表同步配置和范围 | 保留 |
| `TeableFieldMappingService` | 保存字段映射 | 保留 |
| `TeableMirrorSyncService` | 执行单向镜像同步 | 保留 |
| `UserTeableSyncLogRepository` | 保存同步日志 | 保留 |
| `TeableFormBindingService` | 保存 Teable 表单接入记录 | 移除 |
| `TeableInboundSyncService` | 处理表单结果回流 | 移除 |
| `AffairsTeableFormBlock` | 工作台 iframe 展示 Teable 页面 | 移除 |
| `teable-preview` route | Host 代理 Teable 分享页 | 移除 |

## 5. 接口

### 5.1 保留接口

- `GET /api/affairs/teable/global-binding`
- `PUT /api/affairs/teable/global-binding`
- `GET /api/affairs/teable/overview`
- `GET /api/affairs/teable/workbench-sync-config`
- `PUT /api/affairs/teable/workbench-sync-config`
- `GET /api/affairs/teable/table-catalog`
- `GET /api/affairs/teable/table-fields`
- `POST /api/affairs/teable/table-fields`
- `GET /api/affairs/teable/field-mappings`
- `PUT /api/affairs/teable/field-mappings`
- `POST /api/affairs/teable/mirror-sync`
- `GET /api/affairs/teable/sync-logs`

### 5.2 废弃接口

这些接口不再作为运行入口：

- `GET /api/affairs/teable/table-views`
- `GET /api/affairs/teable/view-proxy-link`
- `GET /api/affairs/teable/form-catalog`
- `GET /api/affairs/teable/form-bindings`
- `PUT /api/affairs/teable/form-bindings`
- `DELETE /api/affairs/teable/form-bindings/:formBindingId`
- `POST /api/affairs/teable/inbound-sync`
- `GET /api/public/teable-view/*`
- `GET /api/api/public/teable-view/*`
- `GET /share/:shareId/view/*`
- `GET /_next/*` 里的 Teable 代理分支

旧的 `GET /api/affairs/teable/forms` 和 `POST /api/affairs/teable/forms` 只保留 410 提示，不再创建 Teable 表单。

## 6. 数据结构

### 6.1 Teable 全局配置

| 字段 | 说明 |
| --- | --- |
| `baseUrl` | Teable 站点地址，局域网允许 `http://` |
| `spaceId` | Teable 空间 ID |
| `baseId` | Teable Base ID |
| `authRef` | 本地认证引用，前端不必暴露给用户 |
| `enabled` | 是否启用 |
| `mirrorMode` | 手动、定时或本地变化触发 |

### 6.2 表同步配置

| 字段 | 说明 |
| --- | --- |
| `sourceType` | `tags`、`sessions`、`todos` |
| `targetTableId` | Teable 目标表 ID |
| `scope` | 同步范围 |
| `enabled` | 是否启用 |

范围固定为：

- 标签：`{ rootTagIds: string[] }`
- 会话：`{ mode: "all_workspaces" }` 或 `{ mode: "selected_workspaces", workspaceIds: string[] }`
- 代办：`{ includeWorkspaceTodos: boolean, includeAffairsTodos: boolean, workspaceIds?: string[] }`

### 6.3 字段映射

| 字段 | 说明 |
| --- | --- |
| `sourceType` | 数据类型 |
| `targetTableId` | Teable 目标表 |
| `items` | 源字段到目标字段的映射 |

## 7. 正确性要求

### 7.1 真源不反转

CodingNS 始终是真源。Teable 里的镜像表不能反向覆盖本地标签、会话或代办。

### 7.2 设置归设置，画布归画布

Teable 的连接、表同步、字段映射和日志都在设置里管理。事务工作台画布不再承载 Teable 原生页面。

### 7.3 后台任务走 TaskManager

本地变化触发同步时，只把任务放进 TaskManager，不在保存标签、会话或代办的请求里等待 Teable 写入完成。

### 7.4 不再修 iframe 代理路线

Teable 分享页嵌入已经证明稳定性和体验都不合格。后续不再继续给 iframe、分享链接、Next 静态资源代理打补丁。

## 8. 测试策略

### 8.1 Host

- 全局连接保存和读取。
- Teable 表目录和字段目录读取。
- 自动创建字段。
- 表同步配置保存。
- 字段映射保存。
- 手动同步入队。
- 本地变化触发同步任务。
- 同步日志写入和读取。

### 8.2 User App

- 设置页能打开 Teable 设置弹窗。
- 连接设置能保存和测试。
- 表同步设置能添加目标表。
- 范围选择能区分全部工作区和指定工作区。
- 字段映射能手动配置。
- 自动建字段弹窗能选择字段并写入映射草稿。
- 同步日志能显示。
- 工作台添加块面板不再出现 Teable 嵌入块。

### 8.3 回归检查

- `apps/user-app` 不再引用 `AffairsTeableFormBlock`。
- `DashboardWidgetType` 不再包含 `teable`。
- Host 不再注册 Teable 分享页代理路由。
- `conversation-api.ts` 不再暴露 form catalog / form bindings / view proxy API。

## 9. 风险

- Teable API 字段类型如果变化，自动建字段需要跟着适配。
- 目标表字段被用户在 Teable 端手动删除后，同步会失败，需要在日志里明确显示。
- 旧 SQLite 表结构会暂时存在，容易被误解为功能还在；代码审查时要看是否有运行入口，而不是只看 schema。
- 后续自定义前端展示 Teable 数据时，必须另起明确设计，不要复活 iframe 分享页路线。
