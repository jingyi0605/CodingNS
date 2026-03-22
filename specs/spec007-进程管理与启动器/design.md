# 设计文档 - spec007-进程管理与启动器

状态：Draft

## 1. 概述

### 1.1 目标

- 将进程管理做成独立领域服务，和终端服务解耦
- 建立 `LauncherProfile` 与 `ProcessInstance` 的稳定数据模型
- 提供进程生命周期管理、日志读取、端口识别能力
- 保证所有进程相关 HTTP / WebSocket 操作默认受鉴权保护

### 1.2 覆盖需求

- `requirements.md` 需求 1：启动配置必须模型化
- `requirements.md` 需求 2：进程管理必须是独立服务，不挂靠终端
- `requirements.md` 需求 3：进程生命周期操作必须完整可用
- `requirements.md` 需求 4：日志与端口信息必须可追踪
- `requirements.md` 需求 5：常见项目启动模板必须内置
- `requirements.md` 需求 6：所有进程相关操作默认受鉴权保护

### 1.3 技术约束

- 后端：`Node.js 22 + TypeScript + Fastify + ws + child_process + node-pty`
- 前端：`ui-web` 通过 HTTP / WebSocket 消费进程领域接口
- 数据存储：`SQLite` 仅存元数据与状态索引，进程滚动日志落文件缓存
- 认证授权：沿用 `spec001` 的 token 鉴权，进程 API 默认受保护
- 外部依赖：项目运行环境中的 shell、Node/Python 等命令执行环境

## 2. 架构

### 2.1 系统结构

`process-service` 是 `workspace-core` 下的独立模块，不挂在 `terminal-service` 下。

主链路如下：

1. 客户端在工作区内选择 `LauncherProfile`
2. `process-service` 校验工作区边界与执行参数
3. `process-runner` 启动子进程并创建 `ProcessInstance`
4. `log-capture` 采集 stdout/stderr 到日志缓存文件
5. `port-scanner` 识别端口状态并更新实例视图
6. `process-event-bus` 通过 WebSocket 推送 `process.started/process.output/process.stopped`

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `launcher-profile-service` | 管理启动配置模板与实例化 | 工作区ID、配置请求 | `LauncherProfile` |
| `process-service` | 编排启动、停止、重启、查询 | 控制命令、实例ID | `ProcessInstance` 状态 |
| `process-runner` | 启停子进程并维护句柄 | 启动参数、信号 | 进程句柄、退出事件 |
| `process-repository` | 持久化进程元数据和状态快照 | 进程状态更新 | SQLite 记录 |
| `log-capture-service` | 日志滚动写入与读取游标管理 | stdout/stderr流、读取请求 | 日志块、游标 |
| `port-scanner-service` | 端口识别与占用状态更新 | 进程PID、端口提示 | 端口状态列表 |
| `process-auth-guard` | 保护进程 API 与日志订阅 | token、请求上下文 | 放行或拒绝 |

### 2.3 关键流程

#### 2.3.1 启动流程

1. 客户端调用 `POST /api/launchers/{profileId}/run`
2. `process-auth-guard` 验证登录态
3. `launcher-profile-service` 读取配置并校验 `cwd` 在工作区范围内
4. `process-runner` 启动子进程并生成 `ProcessInstance`
5. `log-capture-service` 开始记录日志
6. `port-scanner-service` 识别端口并更新状态
7. 系统推送 `process.started`

#### 2.3.2 停止与重启流程

1. 客户端调用 `POST /api/processes/{processId}/stop` 或 `.../restart`
2. 服务校验实例归属工作区与当前状态
3. `process-runner` 发送终止信号并等待退出
4. 停止成功后更新状态为 `STOPPED`；重启时创建新实例并关联来源实例
5. 系统推送 `process.stopped` 或 `process.started`

#### 2.3.3 日志与端口读取流程

1. 客户端请求 `GET /api/processes/{processId}/logs?cursor=...`
2. `log-capture-service` 按游标返回增量日志块
3. 客户端可并行请求 `GET /api/processes/{processId}/ports`
4. `port-scanner-service` 返回识别到的端口与健康状态

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6

- `LauncherProfileController`：启动配置管理入口
- `ProcessController`：进程生命周期控制入口
- `ProcessLogController`：日志查询与订阅入口
- `ProcessEventGateway`：进程事件 WebSocket 网关
- `ProcessPolicy`：工作区边界和状态转换规则执行器

### 3.2 数据结构

覆盖需求：1、2、3、4、5

#### 3.2.1 `LauncherProfile`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 启动配置ID | 全局唯一 |
| `workspaceId` | string | 是 | 工作区ID | 必须存在 |
| `name` | string | 是 | 配置名称 | 长度 1-64 |
| `kind` | string | 是 | 配置类型 | `frontend/backend/fullstack/custom` |
| `cwd` | string | 是 | 执行目录 | 必须在工作区路径内 |
| `command` | string | 是 | 主命令 | 不允许空值 |
| `args` | json | 否 | 参数列表 | 默认空数组 |
| `env` | json | 否 | 环境变量覆盖 | 默认空对象 |
| `ports` | json | 否 | 预期端口列表 | 默认空数组 |
| `autoRestart` | boolean | 是 | 是否自动重启 | 默认 false |
| `createdAt` | string | 是 | 创建时间 | ISO8601 |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

#### 3.2.2 `ProcessInstance`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 进程实例ID | 全局唯一 |
| `workspaceId` | string | 是 | 工作区ID | 必须存在 |
| `profileId` | string | 否 | 启动配置ID | 可空（临时启动） |
| `name` | string | 是 | 展示名称 | 非空 |
| `pid` | number | 否 | 系统进程号 | 运行中必填 |
| `status` | string | 是 | 实例状态 | `PENDING/RUNNING/STOPPED/FAILED/RESTARTING` |
| `command` | string | 是 | 实际命令行 | 非空 |
| `cwd` | string | 是 | 实际工作目录 | 在工作区边界内 |
| `exitCode` | number | 否 | 退出码 | 停止后可用 |
| `startedAt` | string | 否 | 启动时间 | 运行后必填 |
| `stoppedAt` | string | 否 | 停止时间 | 停止后必填 |
| `logRef` | string | 否 | 日志文件引用 | 运行后可用 |
| `linkedTerminalId` | string | 否 | 关联终端ID | 弱关联 |

#### 3.2.3 `ProcessPortBinding`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 记录ID | 全局唯一 |
| `processId` | string | 是 | 进程实例ID | 外键 |
| `port` | number | 是 | 端口号 | 1-65535 |
| `protocol` | string | 是 | 协议 | `tcp/udp` |
| `state` | string | 是 | 端口状态 | `LISTEN/CONFLICT/CLOSED` |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

### 3.3 接口契约

覆盖需求：1、3、4、5、6

#### 3.3.1 `GET /api/launchers`

- 类型：HTTP
- 输入：`workspaceId`
- 输出：`LauncherProfile[]`
- 校验：必须登录；`workspaceId` 必填
- 错误：`401 UNAUTHORIZED`、`404 WORKSPACE_NOT_FOUND`

#### 3.3.2 `POST /api/launchers`

- 类型：HTTP
- 输入：`workspaceId/name/kind/cwd/command/args/env/ports`
- 输出：创建后的 `LauncherProfile`
- 校验：`cwd` 必须在工作区边界内
- 错误：`400 VALIDATION_ERROR`、`403 WORKSPACE_BOUNDARY_DENIED`

#### 3.3.3 `POST /api/launchers/{profileId}/run`

- 类型：HTTP
- 输入：`profileId` + 可选覆盖参数
- 输出：新建 `ProcessInstance`
- 校验：配置存在且归属当前工作区；状态可启动
- 错误：`404 PROFILE_NOT_FOUND`、`409 PROCESS_ALREADY_RUNNING`

#### 3.3.4 `GET /api/processes`

- 类型：HTTP
- 输入：`workspaceId`、`status?`
- 输出：`ProcessInstance[]`
- 校验：必须登录
- 错误：`401 UNAUTHORIZED`

#### 3.3.5 `POST /api/processes/{processId}/stop`

- 类型：HTTP
- 输入：`processId`
- 输出：更新后的实例状态
- 校验：仅 `RUNNING/RESTARTING` 可停止
- 错误：`404 PROCESS_NOT_FOUND`、`409 INVALID_PROCESS_STATE`

#### 3.3.6 `POST /api/processes/{processId}/restart`

- 类型：HTTP
- 输入：`processId`
- 输出：重启后的新实例信息
- 校验：实例归属当前工作区；旧实例可停止
- 错误：`404 PROCESS_NOT_FOUND`、`500 PROCESS_RESTART_FAILED`

#### 3.3.7 `GET /api/processes/{processId}/logs`

- 类型：HTTP
- 输入：`processId`、`cursor?`、`limit?`
- 输出：`{ items: LogChunk[], nextCursor: string | null }`
- 校验：`limit` 有上限，默认增量读取
- 错误：`404 PROCESS_NOT_FOUND`、`416 LOG_CURSOR_INVALID`

#### 3.3.8 `GET /api/processes/{processId}/ports`

- 类型：HTTP
- 输入：`processId`
- 输出：`ProcessPortBinding[]`
- 校验：必须登录
- 错误：`404 PROCESS_NOT_FOUND`

#### 3.3.9 `WS /ws`（进程事件）

- 类型：WebSocket
- 路径或标识：`process.*`
- 输入：登录 token + `workspaceId/processId` 订阅条件
- 输出：`process.started/process.output/process.stopped/process.status`
- 校验：握手必须鉴权，订阅范围必须属于用户可访问工作区
- 错误：`401 WS_UNAUTHORIZED`、`403 WS_SUBSCRIBE_DENIED`

## 4. 数据与状态模型

### 4.1 数据关系

- 一个 `Workspace` 可以有多个 `LauncherProfile`
- 一个 `LauncherProfile` 可以创建多个 `ProcessInstance`
- 一个 `ProcessInstance` 可以关联 0 或 1 个 `TerminalLink`
- 一个 `ProcessInstance` 可以有多个 `ProcessPortBinding`
- 日志正文存文件缓存，`ProcessInstance.logRef` 只存引用

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `PENDING` | 已提交启动，等待拉起 | 调用启动接口成功入队 | 进入 `RUNNING` 或 `FAILED` |
| `RUNNING` | 进程运行中 | 子进程成功启动 | 停止、崩溃、重启 |
| `RESTARTING` | 重启流程中 | 用户触发重启 | 进入 `RUNNING` 或 `FAILED` |
| `STOPPED` | 正常停止 | 收到停止指令且退出 | 重新启动 |
| `FAILED` | 启动失败或异常退出 | 启动失败或非预期退出 | 重试启动 |

## 5. 错误处理

### 5.1 错误类型

- `鉴权错误`：未登录访问或 token 失效
- `边界错误`：`cwd` 越出工作区范围
- `状态错误`：对错误状态执行操作（例如停止已停止进程）
- `执行错误`：命令不存在、权限不足、启动失败
- `日志错误`：日志文件不可读或游标非法

### 5.2 错误响应格式

```json
{
  "detail": "当前进程状态不允许执行重启",
  "error_code": "INVALID_PROCESS_STATE",
  "field": "processId",
  "timestamp": "2026-03-22T00:00:00Z"
}
```

### 5.3 处理策略

1. 输入验证错误：直接拒绝并返回字段级错误信息
2. 业务规则错误：返回明确错误码，不做隐式降级
3. 外部依赖错误：保留失败上下文（命令、退出码、日志引用）
4. 重试与补偿：重启失败时保留旧实例记录，不覆盖历史

## 6. 正确性属性

### 6.1 属性 1：进程主状态不依赖终端连接

*对于任何* 终端断开事件，系统都应该满足：`ProcessInstance` 状态由进程句柄和进程事件决定，而不是由终端在线状态决定。

**验证需求：** 需求 2、需求 3

### 6.2 属性 2：受保护接口默认鉴权

*对于任何* 进程相关 HTTP/WS 请求，系统都应该满足：未通过鉴权的请求不能读取或控制进程数据。

**验证需求：** 需求 6

### 6.3 属性 3：日志与端口可追溯

*对于任何* 运行中的进程实例，系统都应该满足：可以通过实例 ID 查到最新日志游标和端口状态。

**验证需求：** 需求 4

## 7. 测试策略

### 7.1 单元测试

- `LauncherProfile` 校验规则（路径边界、命令格式、端口字段）
- 进程状态机转换规则
- 鉴权守卫与订阅权限校验

### 7.2 集成测试

- 启动 -> 读取日志 -> 停止 -> 重启完整链路
- 终端断开后进程状态一致性
- 未授权访问 HTTP / WebSocket 拒绝逻辑

### 7.3 端到端测试

- 桌面端/H5 启动常见模板后查看日志和端口
- 异常命令启动失败后的错误反馈与重试

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §3.2.1、§3.3.1、§3.3.2 | 配置 CRUD 集成测试 |
| `requirements.md` 需求 2 | `design.md` §2.2、§4.2、§6.1 | 终端断开一致性测试 |
| `requirements.md` 需求 3 | `design.md` §2.3.1、§2.3.2、§3.3.4~§3.3.6 | 生命周期 E2E |
| `requirements.md` 需求 4 | `design.md` §2.3.3、§3.3.7、§3.3.8、§6.3 | 日志与端口追踪测试 |
| `requirements.md` 需求 5 | `design.md` §3.2.1、§5.3 | 模板创建与运行测试 |
| `requirements.md` 需求 6 | `design.md` §3.3.9、§6.2 | 鉴权拒绝用例 |

## 8. 风险与待确认项

### 8.1 风险

- 项目环境差异导致模板命令不可用，可能引发“模板能建但跑不起来”
- 长时间高频日志输出可能带来文件缓存膨胀
- 错误地把进程控制逻辑塞回终端模块，会重新引入耦合

### 8.2 待确认项

- 日志缓存文件的保留策略（按大小清理还是按时间清理）
- 端口健康探测的默认间隔和超时阈值
- 自动重启的最大次数与退避策略
