# 设计文档 - spec006-终端核心能力

状态：Draft

## 1. 概述

### 1.1 目标

- 建立清晰可执行的终端领域模型，保障终端和进程职责分离
- 让 PTY 生命周期、断线重连、输出缓存成为稳定主链路
- 支持多终端和命令模板，提升工作区内高频操作效率
- 把终端 HTTP 与 WebSocket 通道统一纳入鉴权边界

### 1.2 覆盖需求

- `requirements.md` 需求 1：终端与进程模型分离
- `requirements.md` 需求 2：PTY 生命周期管理
- `requirements.md` 需求 3：多终端与工作区绑定
- `requirements.md` 需求 4：终端接口与 WS 鉴权
- `requirements.md` 需求 5：断线重连与输出恢复
- `requirements.md` 需求 6：命令模板执行

### 1.3 技术约束

- 后端：`Node.js 22 + TypeScript + Fastify + ws + node-pty`
- 存储：`SQLite`（终端元数据、模板、轻量状态）+ 内存/文件滚动缓存（终端输出）
- 认证授权：沿用 `spec001`（除公开接口外默认鉴权；WS 握手校验 token）
- 终端边界：不承载进程编排，不实现浏览器本地假终端
- 前端形态：消费后端终端流，不持有终端真相

## 2. 架构

### 2.1 系统结构

终端能力采用“控制面 + 运行面 + 传输面”三层：

1. 控制面：终端实例管理、命令模板管理、鉴权与权限校验。
2. 运行面：PTY 创建、输入写入、输出读取、状态变迁、异常回收。
3. 传输面：HTTP 控制接口 + WebSocket 输出与交互通道。

数据流：

1. 客户端调用 HTTP 创建终端实例。
2. Host 创建 PTY 并生成 `TerminalInstance`。
3. 客户端通过 WS 订阅终端输出流并发送输入事件。
4. 输出缓存记录最近窗口，断线后按游标补回。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `terminal-gateway` | 提供终端 HTTP / WS 入口，完成参数校验与鉴权接入 | API 请求、WS 握手 | 标准响应与事件流 |
| `terminal-session-service` | 管理终端实例元数据和状态 | 创建/关闭/查询请求 | `TerminalInstance` |
| `pty-runtime-manager` | 管理 PTY 生命周期和 I/O | 终端创建参数、输入流 | PTY 句柄、输出片段、退出事件 |
| `terminal-output-buffer` | 维护滚动输出缓存和补回窗口 | 输出片段、游标 | 缓存查询结果 |
| `terminal-reconnect-service` | 处理断线重连、订阅恢复、补回策略 | 连接断开/恢复事件 | 恢复结果与状态通知 |
| `command-template-service` | 管理工作区命令模板并触发执行 | 模板 CRUD、执行请求 | 执行结果、错误信息 |
| `terminal-auth-guard` | 统一终端 API 与 WS 认证校验 | token、上下文 | 放行或拒绝 |

### 2.3 关键流程

#### 2.3.1 终端创建与工作区绑定

1. 客户端调用 `POST /api/terminals`，提交 `workspaceId`、`cwd`、`shell`。
2. `terminal-auth-guard` 校验登录态与工作区访问权限。
3. `terminal-session-service` 生成终端实例记录。
4. `pty-runtime-manager` 创建 PTY 并绑定实例。
5. 返回 `terminalId` 与初始状态。

#### 2.3.2 终端输入输出与流式传输

1. 客户端通过 WS 订阅 `terminal.output`，并可发送 `terminal.input`。
2. `pty-runtime-manager` 将输入写入 PTY。
3. PTY 输出经 `terminal-output-buffer` 缓存后推送给订阅方。
4. 终端退出或异常时广播 `terminal.exit` 和状态事件。

#### 2.3.3 断线重连与输出补回

1. 连接中断后，终端实例保持运行，连接状态切为 `disconnected`。
2. 客户端重连时提交 `terminalId + lastCursor`。
3. `terminal-reconnect-service` 查询缓存并补回遗漏输出。
4. 若超出缓存窗口，返回部分补回 + 明确提示。

#### 2.3.4 命令模板执行

1. 客户端创建或选择工作区命令模板。
2. 执行前校验 `workspaceId`、`cwd`、命令白名单或限制规则。
3. 可在已有终端执行，或自动创建新终端执行。
4. 执行日志进入同一终端输出流，便于追踪。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6

- `TerminalController`：终端实例 HTTP 控制入口
- `TerminalWsHub`：终端 WS 事件通道与订阅管理
- `TerminalSessionRepository`：终端元数据存取
- `PtyRuntimeManager`：PTY 运行时核心
- `TerminalOutputBuffer`：输出缓存实现
- `CommandTemplateController`：命令模板与执行入口

### 3.2 数据结构

覆盖需求：1、2、3、5、6

#### 3.2.1 `TerminalInstance`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 终端实例 ID | 全局唯一 |
| `workspaceId` | string | 是 | 所属工作区 | 外键，必须存在 |
| `name` | string | 否 | 终端显示名 | 长度 1-64 |
| `cwd` | string | 是 | 当前工作目录 | 必须在工作区白名单内 |
| `shell` | string | 是 | shell 类型 | 来自允许列表 |
| `status` | string | 是 | `creating/running/disconnected/closed/error` | 枚举 |
| `createdBy` | string | 是 | 创建用户 ID | 必填 |
| `createdAt` | string | 是 | 创建时间 | ISO8601 |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

#### 3.2.2 `TerminalConnection`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `connectionId` | string | 是 | WS 连接 ID | 全局唯一 |
| `terminalId` | string | 是 | 关联终端实例 | 外键 |
| `userId` | string | 是 | 用户 ID | 必填 |
| `lastCursor` | string | 否 | 已消费输出游标 | 可空 |
| `state` | string | 是 | `connected/disconnected/reconnecting` | 枚举 |
| `connectedAt` | string | 是 | 建连时间 | ISO8601 |

#### 3.2.3 `TerminalOutputChunk`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `terminalId` | string | 是 | 终端实例 ID | 必填 |
| `cursor` | string | 是 | 输出游标 | 单调递增 |
| `stream` | string | 是 | `stdout/stderr` | 枚举 |
| `content` | string | 是 | 输出内容片段 | 可空字符串但不可缺失 |
| `timestamp` | string | 是 | 输出时间 | ISO8601 |

#### 3.2.4 `TerminalCommandTemplate`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 模板 ID | 全局唯一 |
| `workspaceId` | string | 是 | 所属工作区 | 外键 |
| `name` | string | 是 | 模板名称 | 唯一（工作区内） |
| `command` | string | 是 | 命令主体 | 不允许空 |
| `args` | string[] | 否 | 参数数组 | 可空 |
| `cwd` | string | 否 | 覆盖目录 | 需在工作区范围内 |
| `createdAt` | string | 是 | 创建时间 | ISO8601 |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

### 3.3 接口契约

覆盖需求：2、3、4、5、6

#### 3.3.1 创建终端

- 类型：HTTP
- 路径：`POST /api/terminals`
- 输入：`workspaceId`、`cwd`、`shell`、可选 `name`
- 输出：`terminalId`、`status`
- 校验：必须登录；`workspaceId` 可访问；`cwd` 合法
- 错误：`401 UNAUTHORIZED`、`403 WORKSPACE_FORBIDDEN`、`400 INVALID_CWD`

#### 3.3.2 获取终端列表

- 类型：HTTP
- 路径：`GET /api/terminals?workspaceId=<id>`
- 输入：`workspaceId`
- 输出：终端实例列表
- 校验：必须登录且工作区可访问
- 错误：`401 UNAUTHORIZED`、`404 WORKSPACE_NOT_FOUND`

#### 3.3.3 关闭终端

- 类型：HTTP
- 路径：`DELETE /api/terminals/{terminalId}`
- 输入：`terminalId`
- 输出：`success=true`
- 校验：必须登录；终端存在
- 错误：`401 UNAUTHORIZED`、`404 TERMINAL_NOT_FOUND`

#### 3.3.4 发送终端输入

- 类型：HTTP
- 路径：`POST /api/terminals/{terminalId}/input`
- 输入：输入内容（支持文本和控制键标识）
- 输出：受理结果
- 校验：必须登录；终端状态为 `running`
- 错误：`401 UNAUTHORIZED`、`409 TERMINAL_NOT_RUNNING`

#### 3.3.5 执行命令模板

- 类型：HTTP
- 路径：`POST /api/terminals/templates/{templateId}/run`
- 输入：`workspaceId`、可选 `terminalId`
- 输出：执行目标终端和执行受理结果
- 校验：必须登录；模板和工作区匹配；命令通过校验
- 错误：`401 UNAUTHORIZED`、`404 TEMPLATE_NOT_FOUND`、`400 TEMPLATE_INVALID`

#### 3.3.6 终端 WebSocket 通道

- 类型：WebSocket
- 路径：`WS /ws`（事件域：`terminal.*`）
- 输入：token、`terminal.subscribe`（含 `terminalId`、`lastCursor`）
- 输出：`terminal.output`、`terminal.status`、`terminal.exit`
- 校验：握手鉴权 + 订阅鉴权
- 错误：`WS_UNAUTHORIZED`、`WS_SUBSCRIBE_FORBIDDEN`

## 4. 数据与状态模型

### 4.1 数据关系

- 一个 `Workspace` 可以有多个 `TerminalInstance`。
- 一个 `TerminalInstance` 同时最多绑定一个活跃 PTY 运行时。
- 一个 `TerminalInstance` 可以关联多个历史 `TerminalConnection` 记录。
- 一个 `Workspace` 可以有多个 `TerminalCommandTemplate`。
- 终端输出缓存按 `terminalId` 分区，不跨工作区混用。

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `creating` | 终端创建中 | 收到创建请求 | PTY 创建成功或失败 |
| `running` | 终端可交互 | PTY 创建成功 | 连接断开、终端关闭、运行异常 |
| `disconnected` | 会话连接中断 | WS 中断但 PTY 仍在 | 重连成功或终端关闭 |
| `reconnecting` | 正在恢复连接 | 客户端发起重连 | 成功回到 running 或失败 |
| `closed` | 终端已关闭 | 用户主动关闭或进程退出 | 不可逆 |
| `error` | 终端异常 | PTY 创建或运行失败 | 人工重建终端实例 |

## 5. 错误处理

### 5.1 错误类型

- `鉴权错误`：未登录、token 无效、无权限访问工作区终端
- `输入错误`：非法 terminalId、非法 cwd、非法命令模板参数
- `运行时错误`：PTY 创建失败、写入失败、输出读取异常
- `连接错误`：WS 握手失败、订阅失败、重连失败
- `边界错误`：调用进程管理能力但请求走到了终端服务

### 5.2 错误响应格式

```json
{
  "detail": "终端当前不可写入",
  "error_code": "TERMINAL_NOT_RUNNING",
  "field": "terminalId",
  "timestamp": "2026-03-22T00:00:00Z"
}
```

### 5.3 处理策略

1. 输入验证错误：直接拒绝并返回明确字段错误。
2. 鉴权错误：HTTP 返回 401/403；WS 拒绝握手或关闭连接。
3. 运行时错误：更新终端状态为 `error` 并记录日志。
4. 重连补偿错误：先返回可恢复部分，再给出“缓存窗口不足”的明确提示。

## 6. 正确性属性

### 6.1 属性 1：终端必须严格归属工作区

*对于任何* 终端创建或访问请求，系统都应该满足：终端实例必须绑定有效 `workspaceId`，且访问者拥有该工作区权限。

**验证需求：** 需求 3、需求 4

### 6.2 属性 2：终端服务不承担进程管理职责

*对于任何* 终端接口和内部服务，系统都应该满足：不暴露进程编排能力，不写入进程生命周期字段，不替代 `spec007`。

**验证需求：** 需求 1

### 6.3 属性 3：连接中断不等于终端销毁

*对于任何* WS 临时断连场景，系统都应该满足：终端实例和 PTY 在可恢复窗口内保持存活，重连后可补回缓存输出。

**验证需求：** 需求 5

## 7. 测试策略

### 7.1 单元测试

- PTY 生命周期状态机测试
- 输出缓存游标与补回窗口测试
- 命令模板校验与执行目标解析测试

### 7.2 集成测试

- 创建终端、输入、输出、关闭全流程
- 多终端并行互不影响
- WS 鉴权失败与重连恢复流程

### 7.3 端到端测试

- 桌面端/H5 开终端、运行命令、断线重连、输出恢复
- 命令模板一键执行并回显输出

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.2、§6.2 | 代码审查 + 架构测试 |
| `requirements.md` 需求 2 | `design.md` §2.3.1、§4.2 | 集成测试 |
| `requirements.md` 需求 3 | `design.md` §3.2、§4.1 | 集成测试 |
| `requirements.md` 需求 4 | `design.md` §3.3、§5.3 | 鉴权测试 |
| `requirements.md` 需求 5 | `design.md` §2.3.3、§6.3 | 断线重连 E2E |
| `requirements.md` 需求 6 | `design.md` §2.3.4、§3.2.4 | 模板执行测试 |

## 8. 风险与待确认项

### 8.1 风险

- 高并发输出场景下缓存窗口设置不合理，导致补回失败率高。
- 不同平台 shell 行为差异（Windows/macOS/Linux）引发命令模板兼容问题。
- 若鉴权中间件接入不一致，HTTP 和 WS 可能出现策略分裂。

### 8.2 待确认项

- 输出缓存最终采用纯内存、落盘文件，还是混合策略。
- 命令模板的默认限制策略（白名单/黑名单）具体规则。
