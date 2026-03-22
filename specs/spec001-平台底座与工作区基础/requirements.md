# 需求文档 - spec001-平台底座与工作区基础

状态：Draft

## 简介

这个 Spec 只做地基，不做花活。

我们要先把这几件会影响全局的事情定死：

- `CodingNS Host` 的基础运行模型
- 首次启动初始化与默认账号密码
- API / WebSocket 的统一鉴权边界
- SQLite 的存储边界
- 会话索引和会话原文的数据边界

如果这一步不先定住，后面 `spec002`、`spec003` 会反复返工。

## 术语表

- **System**：`码不能停` 全系统
- **Host**：`CodingNS Host`，负责后端核心能力和状态真相
- **Workspace（工作区）**：一个可被管理的本地或远程项目目录
- **Bootstrap（首次初始化）**：系统第一次启动时创建默认管理员账号的流程
- **Public API（公开接口）**：允许匿名访问的最小接口集合
- **Protected API（受保护接口）**：必须携带登录态令牌才能访问的接口
- **Session Index（会话索引）**：本系统保存的会话映射、状态和衍生字段
- **Provider Raw Store（Provider 原始存储）**：CLI 自身保存原始会话消息的存储位置

## 范围说明

### In Scope

- 固定第一阶段后端基础技术栈：Node.js 22 + TypeScript + Fastify + ws + better-sqlite3
- 定义 Host 基础模块边界和最小接口分组
- 设计首次启动初始化流程和默认账号密码创建流程
- 设计统一鉴权机制，覆盖 HTTP 和 WebSocket
- 设计 SQLite 表范围、写入约束和并发约束
- 定义会话索引边界，明确原始会话消息只认 Provider 原始存储
- 约束公开接口与受保护接口清单

### Out of Scope

- CLI provider 解析实现细节（归 `spec002`）
- 对话主界面与交互细节（归 `spec003`）
- Git / 终端 / 进程完整能力实现（后续 spec）
- 多用户 RBAC 权限系统
- PostgreSQL 方案设计与迁移方案

## 需求

### 需求 1：固定第一阶段 Host 技术栈和服务边界

**用户故事：** 作为项目维护者，我希望第一阶段技术栈明确且稳定，以便团队实现时不会边做边换底座。

#### 验收标准

1. WHEN 团队查阅 `spec001` THEN System SHALL 明确写出第一阶段技术栈为 `Node.js 22 + TypeScript + Fastify + ws + better-sqlite3`。
2. WHEN 新增基础后端模块 THEN System SHALL 要求模块遵守 Host 统一边界，不把业务状态散落到客户端。
3. WHEN 讨论第一阶段数据库选型 THEN System SHALL 明确仅使用 SQLite，不展开 PostgreSQL 实施方案。

### 需求 2：首次启动必须完成默认账号密码初始化

**用户故事：** 作为首次使用者，我希望第一次打开系统就完成管理员账号创建，以便系统不是裸奔状态。

#### 验收标准

1. WHEN 系统未初始化 THEN System SHALL 只开放初始化相关公开接口。
2. WHEN 用户提交首次初始化请求 THEN System SHALL 创建默认管理员用户名和密码并持久化安全哈希。
3. WHEN 系统已初始化 THEN System SHALL 拒绝再次执行初始化覆盖已有账号。

### 需求 3：除公开接口外所有 API 和 WebSocket 默认鉴权

**用户故事：** 作为系统管理员，我希望所有核心操作都需要登录态，以便避免任意客户端未经授权读取或修改工作区数据。

#### 验收标准

1. WHEN 客户端访问受保护 HTTP API 且未携带有效令牌 THEN System SHALL 返回未授权错误。
2. WHEN 客户端发起 WebSocket 握手且令牌无效 THEN System SHALL 拒绝连接建立。
3. WHEN 系统初始化完成 THEN System SHALL 仅保留登录所需公开接口，其余接口默认受保护。

### 需求 4：明确会话原文与会话索引的数据边界

**用户故事：** 作为平台开发者，我希望会话原始消息只有一个来源，以便避免双写导致的数据不一致和排查困难。

#### 验收标准

1. WHEN 系统展示会话消息 THEN System SHALL 从 Provider 原始存储读取原始消息，而不是读取本地复制的会话正文。
2. WHEN 系统持久化会话相关数据 THEN System SHALL 只写入会话索引、状态、映射和衍生字段。
3. WHEN 发现尝试将原始会话正文落库 THEN System SHALL 视为违反本 Spec 边界并拒绝纳入第一阶段实现。

### 需求 5：定义 SQLite 存储边界与写入约束

**用户故事：** 作为后端开发者，我希望 SQLite 表范围和写入规则清晰，以便避免写锁争用和后续混乱。

#### 验收标准

1. WHEN 设计数据库表 THEN System SHALL 仅包含工作区、认证、会话索引、会话状态、初始化状态和配置等元数据表。
2. WHEN 发生写操作 THEN System SHALL 使用短事务和写队列，避免长事务阻塞。
3. WHEN 处理终端输出或长日志 THEN System SHALL 不将其作为 SQLite 主写入路径。

### 需求 6：公开接口和受保护接口必须有固定最小清单

**用户故事：** 作为前端和客户端开发者，我希望知道哪些接口能匿名访问、哪些必须登录，以便避免联调时反复猜测。

#### 验收标准

1. WHEN 文档描述公开接口 THEN System SHALL 至少包含 `GET /api/public/bootstrap-status`、`POST /api/public/setup`、`POST /api/auth/login`。
2. WHEN 文档描述受保护接口 THEN System SHALL 明确工作区、会话、文件、Git、终端、进程、provider 相关接口默认都需鉴权。
3. WHEN 新增 API 或 WebSocket 事件入口 THEN System SHALL 默认归入受保护范围，除非明确标注为公开入口。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 调用 `GET /api/public/bootstrap-status` THEN System SHALL 在本地模式下 200ms 内返回初始化状态。
2. WHEN 客户端使用有效令牌访问受保护 API THEN System SHALL 在正常负载下鉴权开销可控，不成为主要延迟来源。

### 非功能需求 2：可靠性

1. WHEN Host 异常重启 THEN System SHALL 保持初始化状态、账号信息、会话索引不丢失。
2. WHEN 令牌过期 THEN System SHALL 给出明确错误并支持刷新或重新登录路径。

### 非功能需求 3：可维护性

1. WHEN 后续 Spec 新增业务模块 THEN System SHALL 复用 `spec001` 定义的鉴权中间件和接口边界，不重复发明一套。
2. WHEN 排查会话数据问题 THEN System SHALL 能明确区分“Provider 原始消息问题”与“本地索引状态问题”。

## 成功定义

- 团队在不争论基础边界的前提下启动 `spec002` 和 `spec003` 实施
- 初始化、登录、受保护访问的主链路可以被完整验证
- 文档中不存在“原始会话消息重复持久化”的灰色地带
- 第一阶段数据边界清晰：SQLite 只存元数据与状态，不存原始会话正文
