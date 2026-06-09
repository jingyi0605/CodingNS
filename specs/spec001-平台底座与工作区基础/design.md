# 设计文档 - spec001-平台底座与工作区基础

状态：Draft

## 1. 概述

### 1.1 目标

- 固定第一阶段 Host 基础技术栈和模块边界，避免后续反复换底座
- 建立首次初始化、登录、鉴权的统一主链路
- 约束公开接口与受保护接口，统一 HTTP / WebSocket 访问规则
- 明确 SQLite 的表范围和写入边界
- 明确“原始会话消息只认 Provider 原始存储，本系统只存索引和状态”

### 1.2 覆盖需求

- `requirements.md` 需求 1：固定技术栈和服务边界
- `requirements.md` 需求 2：首次启动初始化
- `requirements.md` 需求 3：API / WebSocket 鉴权
- `requirements.md` 需求 4：会话原文与索引边界
- `requirements.md` 需求 5：SQLite 边界与写入约束
- `requirements.md` 需求 6：公开 / 受保护接口清单

### 1.3 技术约束

- 后端：`Node.js 22 + TypeScript + Fastify + ws`
- 数据存储：`better-sqlite3`（第一阶段唯一方案）
- 认证授权：用户名密码 + Access Token + Refresh Token
- 原始会话来源：仅来自 CLI Provider 原始存储
- 明确不做：PostgreSQL 设计与迁移、RBAC、多用户协作

### 1.4 子 Spec 边界

- `spec001` 负责单用户 Host、认证、SQLite 元数据边界和公开/受保护接口的大框架
- `spec001.1-账户偏好入库与跨客户端同步` 在这个框架上继续补“账户偏好属于谁、哪些字段进数据库、哪些字段留本地”的分层细节
- `spec001.2-后端任务调度与主线程压力治理` 在这个框架上继续补“哪些重活必须脱离请求主链路、哪些后台任务需要统一调度、如何量化主线程压力”的运行时治理规则
- `spec001.2.1-读写刷新与后台任务统一规则` 在这个框架上继续补“读接口必须多纯、写接口能写多重、刷新状态模型怎么统一、watcher 和散装 inflight 什么时候算越界”的仓库级编码规则
- `spec001.3-多HOST接入与跨端切换` 在这个框架上继续补“客户端如何保存多个 HOST、如何切换激活 HOST、如何按 HOST 隔离登录态和入口布局”的前端连接模型
- `spec001.3.1-桌面端本机HOST自动发现` 在这个框架上继续补“Windows/macOS 桌面端如何扫描本机 `codingns` 进程、如何把自动发现结果接到 HOST 列表，以及如何与手工 HOST 去重和复用本地凭据”的发现模型
- `spec001.3.2-当前HOST代理访问其他HOST仓库` 在这个框架上继续补“当前 HOST 如何代理访问局域网其他 HOST、如何检查同版本、如何避免 token 和 workspace 串线”的跨 HOST 仓库操作模型
- `spec001.4-Tailscale接入与实例级远程访问` 在这个框架上继续补“当前实例如何管理 Tailscale 接入、如何在设置页动态启停、如何暴露 tailnet 地址但不改业务认证”的远程访问能力
- `spec001.5-多CLI-Skill统一管理与同步` 在这个框架上继续补“系统内置 Skill、本地 Skill 和各 CLI skill 目录如何统一管理与同步”的工具管理边界
- `spec001.6-客户端与服务端统一更新机制` 在这个框架上继续补“桌面端、Android、服务端各自如何更新，以及哪些升级结果必须明确要求重启”的交付边界
- `spec001.7-设置页模型快速切换与CC-SWITCH接入` 在这个框架上继续补“设置页如何统一读取和切换四个 CLI 的模型预设，以及这条链路如何通过 Host 安全调用本机 `cc-switch`”的配置管理边界
- `spec001.8-登录设备管理与主设备控制` 在这个框架上继续补“登录态如何稳定映射到设备、最近登录记录如何裁剪、主设备如何显式设置，以及主设备如何退出其他设备”的账号设备边界
- `spec001` 不重新定义语言、主题、默认会话权限这些前端设置项的交互，只提供能承载它们的底层约束
- `spec001` 也不展开工作区扫描、provider 能力刷新、Butler 调度器这些后台治理细节，避免把地基 Spec 写成大杂烩

## 2. 架构

### 2.1 系统结构

第一阶段采用单 Host、单 SQLite 文件、单管理员账号模型：

1. 客户端（桌面端 / H5 / 移动端）请求 Host
2. Host 先执行初始化状态判断或鉴权判断
3. 通过鉴权后访问工作区、会话索引、配置等受保护资源
4. 会话原始消息由 Host 通过 Provider 读取，不在 SQLite 保存正文

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `host-server` | 启动 HTTP / WebSocket 服务、注册路由和中间件 | 启动配置 | 运行中的 Host 服务 |
| `bootstrap-service` | 处理初始化状态检查和首次账号创建 | 初始化请求、用户名密码 | 初始化状态、管理员账号 |
| `auth-service` | 处理登录、令牌签发、令牌刷新、登出 | 登录凭据、令牌 | 鉴权结果、Access/Refresh Token |
| `auth-guard` | 保护受保护 API 和 WebSocket 握手 | 请求上下文、令牌 | 通过或拒绝 |
| `workspace-service` | 管理工作区元数据（地基能力） | 工作区请求 | 工作区元数据 |
| `session-index-service` | 管理会话索引和状态快照 | provider 映射、状态更新 | 会话索引、会话状态 |
| `provider-read-bridge` | 从 Provider 原始存储读取原始消息 | session id、provider 信息 | 原始消息流 |
| `sqlite-repository` | 统一 SQLite 读写和事务边界 | 结构化数据写入 | 持久化结果 |

### 2.3 关键流程

#### 2.3.1 首次启动初始化流程

1. 客户端调用 `GET /api/public/bootstrap-status`
2. Host 返回 `initialized=false`
3. 客户端提交 `POST /api/public/setup`，携带默认用户名和密码
4. Host 校验并保存管理员账号哈希、初始化状态
5. Host 返回初始化成功，后续关闭 setup 入口

#### 2.3.2 登录与受保护 API 访问流程

1. 客户端调用 `POST /api/auth/login`
2. Host 校验账号密码并签发 Access Token 与 Refresh Token
3. 客户端访问受保护 API 时携带 Access Token
4. `auth-guard` 校验通过后放行，否则返回未授权
5. Access Token 过期时，客户端走刷新或重新登录

#### 2.3.3 会话读取流程（索引 + 原文分离）

1. 客户端请求会话列表，Host 从 SQLite 返回会话索引
2. 客户端请求会话消息，Host 通过 `provider-read-bridge` 读取 Provider 原始存储
3. Host 可更新会话状态快照，但不保存原始消息正文
4. 返回消息时保留 `rawRef`，便于追溯原始来源

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6

- `BootstrapController`：公开初始化接口入口，只在未初始化时可用
- `AuthController`：登录、刷新、登出接口入口
- `AuthMiddleware`：统一鉴权中间件
- `WsAuthGuard`：WebSocket 握手鉴权
- `SessionIndexRepository`：会话索引和状态持久化访问
- `ProviderMessageGateway`：会话原始消息只读网关

### 3.2 数据结构

覆盖需求：2、3、4、5

#### 3.2.1 `AuthUser`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 用户 ID | 全局唯一 |
| `username` | string | 是 | 登录用户名 | 唯一，长度 3-64 |
| `passwordHash` | string | 是 | 密码哈希 | 不允许明文 |
| `role` | string | 是 | 角色 | 第一阶段固定 `admin` |
| `createdAt` | string | 是 | 创建时间 | ISO 时间 |
| `updatedAt` | string | 是 | 更新时间 | ISO 时间 |

#### 3.2.2 `BootstrapState`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 固定主键 | 固定值 `default` |
| `initialized` | boolean | 是 | 是否已初始化 | 仅允许 `false/true` |
| `initializedAt` | string | 否 | 初始化完成时间 | 初始化后必填 |
| `initializedByUserId` | string | 否 | 初始化执行用户 | 初始化后必填 |

#### 3.2.3 `Workspace`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 工作区 ID | 全局唯一 |
| `name` | string | 是 | 工作区名称 | 长度 1-128 |
| `path` | string | 是 | 工作区路径 | 必须在白名单根目录内 |
| `repoRoot` | string | 否 | Git 根路径 | 可空 |
| `favorite` | boolean | 是 | 是否收藏 | 默认 false |
| `createdAt` | string | 是 | 创建时间 | ISO 时间 |
| `updatedAt` | string | 是 | 更新时间 | ISO 时间 |

#### 3.2.4 `SessionIndex`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 系统会话 ID | 全局唯一 |
| `workspaceId` | string | 是 | 归属工作区 | 外键 |
| `provider` | string | 是 | CLI provider 标识 | 枚举值 |
| `providerSessionId` | string | 是 | provider 原生会话 ID | 与 provider 组合唯一 |
| `title` | string | 否 | 自定义标题 | 长度 0-256 |
| `status` | string | 是 | 会话状态 | 枚举值 |
| `lastMessageAt` | string | 否 | 最后一条消息时间 | ISO 时间 |
| `rawRef` | string | 是 | 原始消息引用 | 必填，可追溯 |

#### 3.2.5 `SessionState`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `sessionId` | string | 是 | 系统会话 ID | 外键 |
| `syncCursor` | string | 否 | 同步游标 | provider 相关 |
| `lastSyncAt` | string | 否 | 最近同步时间 | ISO 时间 |
| `syncErrorCode` | string | 否 | 最近错误码 | 可空 |
| `syncErrorMessage` | string | 否 | 最近错误消息 | 可空 |

#### 3.2.6 `AuthToken`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 令牌记录 ID | 全局唯一 |
| `userId` | string | 是 | 关联用户 ID | 外键 |
| `tokenType` | string | 是 | 令牌类型 | `access` 或 `refresh` |
| `tokenHash` | string | 是 | 令牌哈希 | 不存明文 |
| `expiresAt` | string | 是 | 过期时间 | ISO 时间 |
| `revokedAt` | string | 否 | 失效时间 | 可空 |

### 3.3 接口契约

覆盖需求：2、3、4、6

#### 3.3.1 `GET /api/public/bootstrap-status`

- 类型：HTTP
- 输入：无
- 输出：`{ initialized: boolean }`
- 校验：无令牌也可访问
- 错误：`500 INTERNAL_ERROR`

#### 3.3.2 `POST /api/public/setup`

- 类型：HTTP
- 输入：`{ username: string, password: string }`
- 输出：`{ initialized: true, userId: string }`
- 校验：仅在 `initialized=false` 时允许；用户名和密码必须满足最小长度规则
- 错误：`409 BOOTSTRAP_ALREADY_DONE`、`400 INVALID_INPUT`

#### 3.3.3 `POST /api/auth/login`

- 类型：HTTP
- 输入：`{ username: string, password: string }`
- 输出：`{ accessToken: string, refreshToken: string, expiresIn: number }`
- 校验：账号存在且密码正确
- 错误：`401 INVALID_CREDENTIALS`、`423 ACCOUNT_LOCKED`

#### 3.3.4 `POST /api/auth/refresh`

- 类型：HTTP
- 输入：`{ refreshToken: string }`
- 输出：`{ accessToken: string, refreshToken: string, expiresIn: number }`
- 校验：refresh token 未过期且未失效
- 错误：`401 TOKEN_INVALID`、`401 TOKEN_EXPIRED`

#### 3.3.5 `POST /api/auth/logout`

- 类型：HTTP
- 输入：当前登录态
- 输出：`{ success: true }`
- 校验：必须登录
- 错误：`401 UNAUTHORIZED`

#### 3.3.6 `GET /api/workspaces`（受保护示例）

- 类型：HTTP
- 输入：Access Token
- 输出：工作区列表
- 校验：必须登录
- 错误：`401 UNAUTHORIZED`

#### 3.3.7 `GET /api/sessions/:sessionId/messages`（受保护示例）

- 类型：HTTP
- 输入：Access Token、`sessionId`
- 输出：消息列表（原始消息由 provider 读取）
- 校验：必须登录；会话存在且归属可见
- 错误：`401 UNAUTHORIZED`、`404 SESSION_NOT_FOUND`

#### 3.3.8 `WS /ws`（受保护）

- 类型：WebSocket
- 输入：握手阶段携带 Access Token
- 输出：实时事件流
- 校验：握手必须通过令牌校验
- 错误：握手失败直接拒绝连接

## 4. 数据与状态模型

### 4.1 数据关系

- `BootstrapState` 决定系统是否允许 `setup`
- `AuthUser` 与 `AuthToken` 是一对多关系
- `Workspace` 与 `SessionIndex` 是一对多关系
- `SessionIndex` 与 `SessionState` 是一对一关系
- `SessionIndex.rawRef` 指向 Provider 原始存储引用，不指向本地消息正文

### 4.2 状态流转

#### 4.2.1 初始化状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `UNINITIALIZED` | 系统未初始化 | SQLite 无初始化记录或 `initialized=false` | 成功执行 `POST /api/public/setup` |
| `INITIALIZED` | 系统已初始化 | 创建管理员账号并写入初始化状态 | 不允许回退 |

#### 4.2.2 登录态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `ANONYMOUS` | 匿名访问 | 未登录或令牌缺失 | 登录成功 |
| `AUTHENTICATED` | 已登录可访问受保护接口 | Access Token 校验通过 | 令牌失效、过期或登出 |

## 5. 错误处理

### 5.1 错误类型

- `INVALID_INPUT`：请求参数不满足校验规则
- `UNAUTHORIZED`：未登录或令牌无效
- `BOOTSTRAP_ALREADY_DONE`：重复初始化
- `SESSION_NOT_FOUND`：会话索引不存在
- `INTERNAL_ERROR`：系统内部异常

### 5.2 错误响应格式

```json
{
  "detail": "用户可读错误信息",
  "error_code": "UNAUTHORIZED",
  "field": "token",
  "timestamp": "2026-03-22T12:00:00Z"
}
```

### 5.3 处理策略

1. 输入验证错误：直接返回 400，不进入业务逻辑。
2. 鉴权错误：统一返回 401，WebSocket 握手直接拒绝。
3. 业务边界错误：如重复初始化，返回 409 并给出明确错误码。
4. 外部依赖错误：Provider 读取失败时保留错误状态在 `SessionState`，不污染原始消息来源规则。

## 6. 正确性属性

### 6.1 属性 1：初始化只能执行一次

*对于任何* 已处于 `INITIALIZED` 的系统，系统都应该满足：`POST /api/public/setup` 不会覆盖已有账号和初始化状态。

**验证需求：** 需求 2

### 6.2 属性 2：受保护资源不允许匿名访问

*对于任何* 受保护 HTTP API 和 WebSocket 入口，系统都应该满足：无有效令牌时必须拒绝访问。

**验证需求：** 需求 3、需求 6

### 6.3 属性 3：会话原文不重复持久化

*对于任何* 会话消息读取流程，系统都应该满足：原始消息来自 Provider 原始存储，SQLite 不保存原始消息正文。

**验证需求：** 需求 4、需求 5

### 6.4 属性 4：第一阶段数据库边界稳定

*对于任何* 第一阶段数据表变更，系统都应该满足：仅围绕元数据、索引、状态和认证信息，不引入消息正文存储。

**验证需求：** 需求 5

## 7. 测试策略

### 7.1 单元测试

- `bootstrap-service` 初始化状态与重复初始化逻辑
- `auth-service` 登录、令牌签发、刷新、失效逻辑
- `auth-guard` 对 HTTP 和 WebSocket 的统一鉴权判断
- `session-index-service` 仅保存索引和状态，不保存原文的规则

### 7.2 集成测试

- `bootstrap-status -> setup -> login -> protected api` 主链路
- Access Token 过期后刷新令牌链路
- WebSocket 握手鉴权链路
- Provider 读取失败时会话状态更新链路

### 7.3 端到端测试

- 首次安装到首次登录全流程
- 未登录客户端访问受保护资源被拒绝
- 已登录客户端读取工作区和会话索引
- 会话消息读取可追溯 `rawRef`

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §1.3、§2.2 | 文档检查 + 架构评审 |
| 需求 2 | §2.3.1、§3.3.1、§3.3.2、§4.2.1 | 集成测试 |
| 需求 3 | §2.3.2、§3.3.3~§3.3.8、§4.2.2 | 集成测试 + e2e |
| 需求 4 | §2.3.3、§3.2.4、§3.2.5、§6.3 | 单元测试 + 代码审查 |
| 需求 5 | §1.3、§3.2、§6.4 | 文档检查 + 评审 |
| 需求 6 | §3.3、§6.2 | 集成测试 |

## 8. 风险与待确认项

### 8.1 风险

- 风险 1：客户端在未初始化状态下绕过流程调用受保护 API  
  应对：统一网关判断初始化状态和鉴权状态。
- 风险 2：后续实现把原始消息正文偷偷落库  
  应对：在评审清单和测试中加入“原始消息不入库”硬检查项。
- 风险 3：令牌策略实现不一致导致多端行为不一致  
  应对：强制桌面端、H5、移动端共用同一认证协议和错误码。

### 8.2 待确认项

- 待确认 1：密码复杂度最小规则（长度、字符类型）最终阈值
- 待确认 2：Access Token / Refresh Token 的过期时长默认值
- 待确认 3：账号错误重试次数与临时锁定策略是否在第一阶段就启用
