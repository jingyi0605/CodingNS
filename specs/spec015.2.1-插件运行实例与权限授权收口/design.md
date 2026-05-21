# 设计文档 - spec015.2.1-插件运行实例与权限授权收口

状态：Draft

## 1. 概述

### 1.1 目标

- 把插件“当前工作区运行上下文”收口成正式 `PluginRuntimeSession`
- 把 `manifest.permissions` 和真实授权记录拆开
- 为插件读写文件、列目录、桌面动作补统一 Host 网关
- 让前端桥、Host API、运行记录和审计都围绕同一套运行实例和授权模型工作

### 1.2 覆盖需求

- `requirements.md` 需求 1：插件运行实例
- `requirements.md` 需求 2：声明与授权分离
- `requirements.md` 需求 3：文件网关
- `requirements.md` 需求 4：权限提示与授权记录
- `requirements.md` 需求 5：桌面动作收口
- `requirements.md` 需求 6：运行记录与审计补齐

### 1.3 与前置 Spec 的关系

- `spec015.2` 已经建立插件注册、静态 HTML 容器、Node 动作和统一网关。
- 本 Spec 不推翻 `spec015.2`，只把它缺的运行实例、授权和文件网关补齐。
- `spec015.2` 里的现有 API 和前端桥需要做兼容性调整，但主目录结构和模块分层保持不变。

## 2. 总体方案

### 2.1 核心思路

这次不再让插件前端“拿着一个插件 id 再顺手传个 workspaceId”。

改成：

1. 用户在某个工作区里打开插件
2. Host 创建 `PluginRuntimeSession`
3. 前端插件桥只拿 `runtimeSessionId`
4. 后续动作、文件访问、桌面动作都从这个 session 反查 `workspaceId`
5. 是否放行再交给 `PluginPermissionService`
6. 文件相关请求统一走 `PluginFileGateway`

### 2.2 为什么一定要加运行实例

因为真正需要收口的不是“这个插件是谁”，而是“这个插件这次是在哪个工作区里跑的”。

没有 `PluginRuntimeSession`，后面这些都说不死：

- 权限到底发给谁
- 授权是对哪个工作区生效
- 某次失败或越权是哪个页面实例触发的
- 用户关掉页面后还能不能继续调

### 2.3 模块职责

| 模块 | 职责 | 主要输入 | 主要输出 |
| --- | --- | --- | --- |
| `plugin-runtime-session-service` | 创建、读取、关闭运行实例 | `pluginId`、`workspaceId`、`userId` | `runtimeSessionId`、运行实例记录 |
| `plugin-permission-service` | 判定 manifest 是否允许申请、判定 grant 是否放行、写授权记录 | `pluginId`、`workspaceId`、权限 key、路径 | allow / deny / grant |
| `plugin-file-gateway-service` | 统一处理读文件、写文件、列目录 | `runtimeSessionId`、相对路径、内容 | 文件结果、目录结果、拒绝信息 |
| `plugin-runtime-service` | 执行动作，串起 session、权限和运行记录 | `runtimeSessionId`、`actionId`、输入 | 插件动作结果 |
| `plugin-bridge` | 前端 iframe 与 Host 之间的受控桥 | `runtimeSessionId`、桥请求 | API 调用结果、权限提示 |

## 3. 数据结构

### 3.1 `PluginRuntimeSession`

覆盖需求：1、6

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 运行实例 id | 全局唯一 |
| `pluginId` | string | 是 | 插件 id | 必须指向已注册插件 |
| `workspaceId` | string | 是 | 当前工作区 | 必须指向存在工作区 |
| `openedByUserId` | string | 是 | 打开该实例的用户 | 必须指向当前用户 |
| `source` | enum | 是 | 来源，如 `frontend` / `assistant` / `cli` | 受限枚举 |
| `status` | enum | 是 | `active` / `closed` | 受限枚举 |
| `createdAt` | string | 是 | 创建时间 | ISO 时间 |
| `updatedAt` | string | 是 | 更新时间 | ISO 时间 |
| `closedAt` | string \| null | 否 | 关闭时间 | 关闭后写入 |

### 3.2 `PluginPermissionGrant`

覆盖需求：2、4、5、6

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 授权记录 id | 全局唯一 |
| `pluginId` | string | 是 | 插件 id | 必须存在 |
| `workspaceId` | string | 是 | 授权所属工作区 | 必须存在 |
| `permissionKey` | string | 是 | 权限 key | 受限白名单 |
| `scopeType` | enum | 是 | `workspace` / `directory` / `file` | 受限枚举 |
| `scopePath` | string \| null | 否 | 授权路径范围 | 相对路径 |
| `grantMode` | enum | 是 | `once` / `session` / `persistent` | 受限枚举 |
| `grantedByUserId` | string | 是 | 谁批准的 | 必须存在 |
| `runtimeSessionId` | string \| null | 否 | 若为会话内授权则关联实例 | 可空 |
| `createdAt` | string | 是 | 创建时间 | ISO 时间 |
| `expiresAt` | string \| null | 否 | 失效时间 | `once/session` 可用 |
| `revokedAt` | string \| null | 否 | 撤销时间 | 撤销后写入 |

### 3.3 `PluginRun` 扩展

覆盖需求：6

在现有 `PluginRun` 基础上新增：

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `runtimeSessionId` | string \| null | 否 | 关联的插件运行实例 | 前端触发时必填 |

### 3.4 运行时权限 key

覆盖需求：2、3、4、5

第一批先收这些：

- `workspace.read_file`
- `workspace.list_dir`
- `workspace.write_file`
- `desktop.open_file`
- `desktop.reveal_in_file_manager`

说明：

- `manifest` 继续保留 `workspaceRead`、`workspaceWrite`、`desktop[]` 这种人能看懂的字段。
- 运行时内部统一转成更细的 `permissionKey`。
- 这样后续继续加 `create_dir`、`delete_file` 才不会重写整套模型。

## 4. 关键流程

### 4.1 打开插件并创建运行实例

1. 前端进入 `/workspaces/:workspaceId/plugins/:pluginId/run`
2. `PluginContainerPage` 调 `POST /api/plugins/:pluginId/runtime-sessions`
3. Host 校验插件已启用、工作区存在
4. Host 创建 `PluginRuntimeSession`
5. Host 返回：
   - `runtimeSessionId`
   - 前端入口 URL
   - 受控上下文
6. iframe 加载插件页
7. 插件桥初始化时只注入 `runtimeSessionId` 和只读上下文

### 4.2 插件动作调用

1. 插件前端调用 `CodingNSPlugin.callAction(actionId, input)`
2. 前端桥带 `runtimeSessionId` 调 Host API
3. Host 读取 `PluginRuntimeSession`
4. Host 从 session 反查 `workspaceId`
5. Host 校验插件已启用、动作存在
6. Host 创建 `PluginRun`
7. Host 拉起 Node 动作并传入：
   - `pluginId`
   - `actionId`
   - `runtimeSessionId`
   - `workspaceId`
   - `input`
8. Host 写运行记录和审计事件

### 4.3 插件文件读取

1. 插件前端调用 `CodingNSPlugin.readFile(path)`
2. 前端桥带 `runtimeSessionId + path` 调 Host
3. Host 校验 session 和 manifest 是否允许申请读权限
4. `PluginPermissionService` 查是否已有匹配 grant
5. 若没有 grant，则返回正式拒绝结果，前端弹权限提示
6. 用户批准后，Host 写 `PluginPermissionGrant`
7. Host 通过 `FileAccessGuard` 校验路径是否在工作区内
8. `PluginFileGateway` 读取文件并返回结果
9. 审计记录写入权限判定和读取结果

### 4.4 插件文件写入

1. 插件前端调用 `CodingNSPlugin.writeFile(path, content)`
2. Host 检查 manifest 是否允许申请写权限
3. Host 检查 grant 是否覆盖目标路径
4. 无 grant 时返回可提示拒绝结果
5. 用户批准后再继续
6. `FileAccessGuard` 校验路径边界
7. `PluginFileGateway` 执行写入
8. 写入结果和审计事件落库

### 4.5 插件桌面动作

1. 插件前端调用 `openFile(path)` 或 `revealInFileManager(path)`
2. Host 基于 `runtimeSessionId` 找工作区
3. Host 检查 manifest 是否声明桌面权限
4. Host 检查 grant 是否已批准该动作和路径范围
5. `FileAccessGuard` 解析绝对路径
6. Host 再调用桌面桥
7. 桌面结果返回给前端，并落审计

## 5. 接口契约

### 5.1 创建运行实例

- 类型：HTTP
- 路径：`POST /api/plugins/:pluginId/runtime-sessions`
- 输入：`workspaceId`（只允许来自当前工作区路由/认证上下文）
- 输出：`runtimeSessionId`、`frontend.entryUrl`、插件上下文
- 校验：插件必须存在且启用，工作区必须存在
- 错误：`PLUGIN_DISABLED`、`PLUGIN_NOT_FOUND`、`PLUGIN_SCOPE_REJECTED`

### 5.2 调用插件动作

- 类型：HTTP
- 路径：`POST /api/plugins/:pluginId/actions/:actionId`
- 输入：`runtimeSessionId`、`input`
- 输出：`run`、`output`
- 校验：session 必须有效，action 必须存在
- 错误：`PLUGIN_RUNTIME_SESSION_NOT_FOUND`、`PLUGIN_RUNTIME_SESSION_CLOSED`

### 5.3 读文件 / 写文件 / 列目录

- 类型：HTTP
- 路径：
  - `POST /api/plugins/:pluginId/files/read`
  - `POST /api/plugins/:pluginId/files/write`
  - `POST /api/plugins/:pluginId/files/list`
- 输入：`runtimeSessionId`、相对路径、可选内容
- 输出：文件内容 / 写入结果 / 目录项
- 校验：session、manifest、grant、工作区边界
- 错误：
  - `PLUGIN_PERMISSION_DECLARATION_MISSING`
  - `PLUGIN_PERMISSION_GRANT_REQUIRED`
  - `PATH_OUT_OF_WORKSPACE`

### 5.4 创建授权记录

- 类型：HTTP
- 路径：`POST /api/plugins/:pluginId/permissions/grants`
- 输入：`runtimeSessionId`、`permissionKey`、`scopeType`、`scopePath`、`grantMode`
- 输出：授权记录
- 校验：必须先通过 manifest 允许申请，再允许写 grant
- 错误：`PLUGIN_PERMISSION_DECLARATION_MISSING`、`PLUGIN_PERMISSION_SCOPE_INVALID`

### 5.5 撤销授权与查询授权

- 类型：HTTP
- 路径：
  - `GET /api/plugins/:pluginId/permissions/grants`
  - `POST /api/plugins/:pluginId/permissions/grants/:grantId/revoke`
- 输入：插件 id、当前工作区上下文、授权 id
- 输出：授权列表 / 撤销结果
- 校验：只返回当前工作区下的授权
- 错误：`PLUGIN_PERMISSION_GRANT_NOT_FOUND`

## 6. 错误处理

### 6.1 错误类型

- `PLUGIN_RUNTIME_SESSION_NOT_FOUND`：运行实例不存在
- `PLUGIN_RUNTIME_SESSION_CLOSED`：运行实例已关闭
- `PLUGIN_PERMISSION_DECLARATION_MISSING`：manifest 没声明对应能力
- `PLUGIN_PERMISSION_GRANT_REQUIRED`：声明了，但还没授权
- `PLUGIN_PERMISSION_SCOPE_INVALID`：授权范围不合法
- `PLUGIN_SCOPE_REJECTED`：请求试图越出当前工作区
- `PATH_OUT_OF_WORKSPACE`：路径超出工作区边界

### 6.2 前端可提示拒绝结果

对“还没授权”这类情况，不应该直接当普通 500。

返回结果里需要至少包含：

- `error_code`
- `detail`
- `permissionKey`
- `scopeType`
- `scopePath`
- `grantOptions`

这样前端才能决定弹什么提示。

## 7. 正确性属性

### 7.1 当前工作区强绑定

*对于任何* 来自插件前端的动作、文件访问和桌面动作请求，系统都应该满足：

**工作区上下文来自 `PluginRuntimeSession`，而不是来自前端自由输入。**

**验证需求：** 需求 1、需求 5

### 7.2 未授权不放行

*对于任何* 插件运行时请求，系统都应该满足：

**没有 manifest 声明或没有匹配 grant 的能力，不会被真正执行。**

**验证需求：** 需求 2、需求 4

### 7.3 文件不越界

*对于任何* 插件文件读写和桌面动作路径请求，系统都应该满足：

**最终解析路径必须位于当前工作区内，否则拒绝。**

**验证需求：** 需求 3、需求 5

## 8. 测试策略

### 8.1 单元测试

- `PluginRuntimeSession` 生命周期
- `PluginPermissionService` 的声明校验、grant 匹配、授权撤销
- `PluginFileGateway` 的路径与权限处理

### 8.2 集成测试

- 打开插件 -> 创建 session -> 调动作
- 读文件首次拒绝 -> 授权 -> 再次放行
- 写文件首次拒绝 -> 授权 -> 写入成功
- 桌面动作首次拒绝 -> 授权 -> 放行

### 8.3 回归测试

- 现有插件列表、详情、启用/禁用不被破坏
- 现有静态 HTML 插件容器仍可打开
- 普通 HTML 预览仍拿不到插件桥

### 8.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §3.1、§4.1、§5.1 | 运行实例创建与关闭测试 |
| 需求 2 | §3.2、§4.3、§5.4 | 声明/授权分离测试 |
| 需求 3 | §4.3、§4.4、§5.3 | 文件网关集成测试 |
| 需求 4 | §3.2、§5.4、§6.2 | 前端授权提示链路测试 |
| 需求 5 | §4.5、§7.1、§7.3 | 桌面动作与越界测试 |
| 需求 6 | §3.3、§4.2、§6.1 | 运行记录与审计测试 |

## 9. 风险与待确认项

### 9.1 风险

- 当前后端动作仍是裸 Node 子进程，这不是强沙箱，只是官方能力收口。
- 如果后端脚本故意绕开官方 SDK 直接用 `fs`，本阶段无法靠运行器彻底拦住。
- 前端权限提示如果做得太复杂，会拖慢首轮落地。

### 9.2 待确认项

- 第一批是否允许“全工作区长期授权”，还是只允许目录级长期授权。
- `once` 授权是否按单次请求消耗，还是按当前前端页面生命周期消耗。
- 是否在本 Spec 内一并提供后端 SDK，还是先只补前端文件网关。
