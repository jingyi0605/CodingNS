# 设计文档 - spec001.3.2 当前HOST代理访问其他HOST仓库

状态：Draft

## 1. 概述

### 1.1 目标

- 让当前 HOST 成为受控代理，代用户访问局域网里的其他 CodingNS HOST
- 让工作区视图能展示和操作不同 HOST 下的仓库
- 代理访问前必须确认目标 HOST 可达、版本一致、API 兼容
- 前端只传 `targetHostId`，不直接保存或使用目标 HOST token
- 保持 `spec001.3` 的单激活 HOST 切换模型不被破坏

### 1.2 覆盖需求

- `requirements.md` 需求 1：保存和检查 Peer HOST
- `requirements.md` 需求 2：版本一致检查
- `requirements.md` 需求 3：前端 API 客户端支持代理目标
- `requirements.md` 需求 4：目标 HOST 登录态由当前 HOST 代管
- `requirements.md` 需求 5：工作区视图区分不同 HOST 仓库
- `requirements.md` 需求 6：受控白名单代理
- `requirements.md` 需求 7：第一阶段主链路范围

### 1.3 技术约束

- 前端仍然只改 `apps/user-app`
- 后端主实现放在 `apps/host`
- Host 内部 SQLite 继续走 `better-sqlite3` 封装，不允许用 `node:sqlite`
- 涉及后台检查、刷新、缓存失效时必须遵守 `spec001.2` 后台任务规范
- 代理入口必须走当前 HOST 认证，不提供公开匿名代理
- 目标 HOST 必须是已保存 Peer HOST，不能由请求临时传 URL
- 第一阶段不开放任意路径代理

### 1.4 当前实现诊断

已经确认的现状：

1. `http-client.ts` 支持传 `baseUrl`，但认证 token 仍取当前 `authStore.session`。这只能用于“同一个 HOST 的不同入口”，不能用于另一个 HOST。
2. `workbench-realtime-client.ts` 和 `realtime-client.ts` 都从 `getHostBaseUrl()` 取当前 HOST，WebSocket 没有目标 HOST 上下文。
3. `WorkspaceDto` 没有 HOST 归属，只有 `id`、`name`、`path`、`repoRoot`。不同 HOST 下的同名仓库或相同 `workspaceId` 会冲突。
4. 当前 `/proxy/*` 是终端模板反向代理，不是 CodingNS Host API 代理，不能复用成任意 HOST 代理。
5. `spec001.3` 的主模型是单 `activeHostId`，切换时重建运行时边界。它不是多 HOST 同时在线聚合模型。

一句人话：
现有代码适合“切到另一台 HOST”，不适合“当前 HOST 代我同时操作另一台 HOST”。

## 2. 架构

### 2.1 总体结构

```txt
user-app
  -> 当前 HOST API
      -> Peer HOST 管理
      -> Peer HOST 登录态管理
      -> 受控 HTTP 代理
      -> 必要 WebSocket 代理
          -> 局域网目标 HOST API
```

关键原则：

1. 前端只登录当前 HOST
2. 前端不保存目标 HOST token
3. 前端不直接拼目标 HOST URL
4. 当前 HOST 只代理已保存、已检查通过、版本一致的 Peer HOST
5. 工作区引用必须带 `hostId`

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `peer-host-repository` | 保存 Peer HOST 配置和检查结果 | Peer HOST 记录 | 可查询、可更新的 Peer HOST |
| `peer-host-service` | 新增、编辑、删除、检查 Peer HOST | 用户输入、当前版本 | Peer HOST 状态 |
| `peer-host-auth-service` | 保存和刷新目标 HOST 登录态 | Peer HOST、登录信息 | 目标 HOST 会话 |
| `host-handshake-controller` | 暴露当前 HOST 的版本和 API 兼容信息 | 探活请求 | 版本、兼容标识、HOST 身份 |
| `host-api-proxy-service` | 代理允许清单内的 HTTP API | targetHostId、路径、请求体 | 目标 HOST 响应 |
| `host-api-proxy-routes` | 当前 HOST 代理入口 | 前端请求 | 代理响应 |
| `target-host-api-client` | 后端访问目标 HOST 的最小客户端 | baseUrl、token、请求 | fetch 结果 |
| `scoped-workspace-client` | 前端按 HOST 调用工作区 API | targetHostId、workspaceId | 工作区数据 |
| `workspace-source-view-model` | 给工作区视图补 HOST 来源 | 当前 HOST 数据、Peer HOST 数据 | 可展示树 |

### 2.3 为什么不让前端直连目标 HOST

因为那是坏设计。

直连看起来简单，但会立刻出现这些问题：

- 浏览器 CORS 受目标 HOST 配置影响
- 前端要保存多个 HOST token
- 一个 token 很容易被发到另一个 HOST
- WebSocket 和 HTTP 的目标可能不一致
- `workspaceId` 没有 HOST 作用域，页面状态会串

当前 HOST 代理虽然多一跳，但边界清楚：

- 认证集中在当前 HOST
- 目标 HOST 登录态由后端保存
- 允许代理哪些 API 有白名单
- 错误能明确归类

## 3. 数据结构

### 3.1 PeerHostRecord

```ts
export interface PeerHostRecord {
  id: string;
  ownerUserId: string;
  name: string;
  baseUrl: string;
  normalizedBaseUrl: string;
  status: "unknown" | "reachable" | "unreachable" | "version_mismatch" | "unauthorized";
  remoteVersion: string | null;
  remoteApiCompatibility: string | null;
  remoteHostFingerprint: string | null;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  createdAt: string;
  updatedAt: string;
  removedAt: string | null;
}
```

说明：

- `ownerUserId` 必须存在。Peer HOST 是用户配置，不是全局公开资源。
- `normalizedBaseUrl` 用于去重。
- `remoteHostFingerprint` 用于防止同地址背后的 HOST 被替换后仍然误用旧会话。
- `status` 不是装饰字段，代理前必须检查。

### 3.2 PeerHostSessionRecord

```ts
export interface PeerHostSessionRecord {
  peerHostId: string;
  ownerUserId: string;
  username: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  expiresAt: string;
  remoteUserId: string;
  remoteUsername: string;
  remoteHostFingerprint: string | null;
  savedAt: string;
  updatedAt: string;
}
```

说明：

- 不下发给前端。
- token 必须使用现有敏感信息存储边界处理。
- 如果目标 HOST 指纹变化，旧会话必须失效。

### 3.3 ScopedWorkspaceDto

```ts
export interface ScopedWorkspaceDto {
  hostId: string;
  hostName: string;
  hostStatus: PeerHostRecord["status"] | "current";
  workspace: WorkspaceDto;
}
```

### 3.4 WorkspaceRef

```ts
export interface WorkspaceRef {
  hostId: string;
  workspaceId: string;
}
```

规则：

- 当前 HOST 可以使用固定 `hostId = "current"`，也可以使用当前 HOST 的稳定身份 ID。第一阶段推荐先用 `current`，避免改动现有 `activeHostId`。
- 页面 key、缓存 key、路由状态里需要区分工作区时，必须使用 `hostId + workspaceId`。
- 不允许再把 `workspaceId` 当全局唯一值使用在跨 HOST 视图里。

## 4. 接口设计

### 4.1 HOST 握手接口

```txt
GET /api/public/host-handshake
```

返回：

```ts
interface HostHandshakeDto {
  product: "CodingNS";
  version: string;
  apiCompatibility: string;
  hostFingerprint: string | null;
  time: string;
}
```

用途：

- Peer HOST 探活
- 版本一致检查
- API 兼容检查
- 目标 HOST 身份变化检查

### 4.2 Peer HOST 管理接口

```txt
GET    /api/peer-hosts
POST   /api/peer-hosts
GET    /api/peer-hosts/:peerHostId
PUT    /api/peer-hosts/:peerHostId
DELETE /api/peer-hosts/:peerHostId
POST   /api/peer-hosts/:peerHostId/check
POST   /api/peer-hosts/:peerHostId/login
DELETE /api/peer-hosts/:peerHostId/session
```

关键错误：

- `PEER_HOST_NOT_FOUND`
- `PEER_HOST_UNREACHABLE`
- `PEER_HOST_VERSION_MISMATCH`
- `PEER_HOST_API_COMPATIBILITY_MISMATCH`
- `PEER_HOST_SESSION_REQUIRED`
- `PEER_HOST_IDENTITY_CHANGED`

### 4.3 受控 HTTP 代理入口

```txt
/api/host-proxy/hosts/:peerHostId/*
```

前端请求：

```ts
httpClient.request("/api/workspaces", {
  targetHostId: peerHostId
});
```

实际请求：

```txt
当前 HOST: /api/host-proxy/hosts/:peerHostId/api/workspaces
当前 HOST -> 目标 HOST: /api/workspaces
```

代理规则：

1. 必须是当前用户自己的 Peer HOST
2. Peer HOST 必须可达、同版本、API 兼容
3. 必须有目标 HOST 登录态，除非目标路径在公开探活白名单
4. 路径必须命中允许清单
5. 不转发 hop-by-hop headers
6. 不记录敏感 header 和 token

### 4.4 第一阶段允许代理的路径

第一阶段只允许这些大类：

```txt
GET  /api/workspaces
GET  /api/workbench
GET  /api/workspaces/:workspaceId/management
GET  /api/sessions
POST /api/sessions/start
GET  /api/sessions/:sessionId
GET  /api/sessions/:sessionId/history
POST /api/sessions/:sessionId/messages
POST /api/sessions/:sessionId/interrupt
GET  /api/files/tree
GET  /api/files/content
POST /api/files/content
GET  /api/files/search
GET  /api/git/status
GET  /api/git/diff
POST /api/git/stage
POST /api/git/unstage
POST /api/git/discard
POST /api/git/commit/*
GET  /api/git/history
GET  /api/git/branches
POST /api/git/branches/switch
```

说明：

- 具体实现时要用代码白名单逐条匹配，不能用 `startsWith("/api")` 这种偷懒写法。
- 后续要新增路径，必须改白名单和测试。

### 4.5 WebSocket 代理边界

第一阶段不要急着代理所有 WebSocket。

建议分两步：

1. 先让远端仓库的基础 HTTP 操作可用
2. 再增加必要的 WS 代理，例如：
   - `workbench.subscribe`
   - `session.subscribe`

WebSocket 代理入口建议：

```txt
/ws/host-proxy/hosts/:peerHostId
```

规则：

- 建连前先检查 Peer HOST 状态和登录态
- 当前 HOST 使用目标 HOST token 连接目标 HOST `/ws`
- 只转发允许的消息类型
- 断线错误必须带上 `peerHostId`

## 5. 前端改造

### 5.1 API 客户端

`RequestOptions` 新增：

```ts
interface RequestOptions extends RequestInit {
  targetHostId?: string;
}
```

行为：

- `targetHostId` 为空：沿用当前逻辑
- `targetHostId` 有值：请求当前 HOST 的 `/api/host-proxy/hosts/:targetHostId/...`
- 代理请求仍然使用当前 HOST token
- 目标 HOST token 永远不出现在前端

### 5.2 工作区 API

新增一层按 HOST 的调用入口，不要把 `targetHostId` 塞满页面组件。

示例：

```ts
listScopedWorkspaces(targetHostId?: string): Promise<ScopedWorkspaceDto[]>
getScopedWorkbenchSnapshot(targetHostId?: string): Promise<ScopedWorkbenchSnapshotDto>
```

页面只处理 `WorkspaceRef`，不要直接关心代理路径。

### 5.3 工作区视图

视图要显示：

- 当前 HOST 下的仓库
- Peer HOST 分组
- 每个 Peer HOST 的状态
- 目标 HOST 不可用时的错误提示

缓存和 React key 使用：

```ts
const key = `${hostId}:${workspaceId}`;
```

不要再裸用 `workspaceId` 做跨 HOST key。

## 6. 后端改造

### 6.1 数据库存储

新增表：

```sql
peer_hosts
peer_host_sessions
```

要求：

- `peer_hosts` 以 `owner_user_id + normalized_base_url` 去重
- 删除 Peer HOST 采用软删除或同步删除会话
- `peer_host_sessions` 不允许明文保存 token

### 6.2 Peer HOST 检查

检查流程：

1. 规范化地址
2. 请求 `/api/public/host-handshake`
3. 校验 `product`
4. 对比当前 HOST 版本
5. 对比 `apiCompatibility`
6. 保存检查结果

### 6.3 代理请求流程

1. 当前 HOST 校验当前用户登录态
2. 查找 Peer HOST
3. 校验 Peer HOST 状态
4. 校验路径白名单
5. 读取目标 HOST 会话
6. 必要时刷新目标 HOST 会话
7. 转发请求到目标 HOST
8. 原样返回状态码、响应体和允许的响应头

### 6.4 错误处理

错误响应保持现有格式：

```json
{
  "detail": "目标 HOST 版本与当前 HOST 不一致",
  "error_code": "PEER_HOST_VERSION_MISMATCH",
  "field": "peerHostId",
  "timestamp": "2026-06-09T00:00:00.000Z"
}
```

错误分类：

- 当前 HOST 未登录：`UNAUTHORIZED`
- Peer HOST 不存在：`PEER_HOST_NOT_FOUND`
- Peer HOST 不可达：`PEER_HOST_UNREACHABLE`
- Peer HOST 版本不一致：`PEER_HOST_VERSION_MISMATCH`
- Peer HOST 未登录：`PEER_HOST_SESSION_REQUIRED`
- 代理路径不允许：`PEER_HOST_PROXY_PATH_NOT_ALLOWED`
- 目标 HOST 返回 401：`PEER_HOST_SESSION_INVALID`

## 7. 正确性属性

### 7.1 token 不串 HOST

对于任何代理请求，前端只能携带当前 HOST token；目标 HOST token 只能由当前 HOST 后端读取和使用。

**验证需求：** 需求 3、需求 4、需求 6

### 7.2 workspace 不串 HOST

对于任何跨 HOST 工作区视图，同一个 `workspaceId` 在不同 `hostId` 下必须被视为不同工作区。

**验证需求：** 需求 5

### 7.3 版本不一致不能代理

对于任何 Peer HOST，只要版本或 API 兼容标识不一致，代理请求必须失败。

**验证需求：** 需求 2、需求 6

### 7.4 代理不能变成任意转发器

对于任何代理请求，目标 HOST 必须来自当前用户保存的 Peer HOST，路径必须在白名单里。

**验证需求：** 需求 6、需求 7

## 8. 测试策略

### 8.1 单元测试

- Peer HOST 地址规范化和去重
- Peer HOST 版本检查
- 代理路径白名单匹配
- 目标 HOST token 保存、读取、刷新
- 前端 `httpClient` 的 `targetHostId` 路径改写
- `hostId + workspaceId` key 生成

### 8.2 集成测试

- 当前 HOST 添加 Peer HOST 成功
- 版本不一致时禁止代理
- 目标 HOST 登录态失效时只清理目标会话
- `/api/workspaces` 通过代理返回目标 HOST 工作区
- `/api/git/status` 通过代理访问目标 HOST 仓库

### 8.3 页面测试

- 工作区视图显示 HOST 分组
- 同名仓库显示来源 HOST
- Peer HOST 不可用时显示错误状态
- 点击远端仓库后 API 请求带 `targetHostId`

### 8.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §3.1、§4.2、§6.2 | repository/service 单元测试，接口集成测试 |
| 需求 2 | §4.1、§6.2、§7.3 | 版本一致和版本不一致测试 |
| 需求 3 | §4.3、§5.1 | `httpClient` 单元测试，代理接口集成测试 |
| 需求 4 | §3.2、§6.3、§7.1 | 目标 HOST 登录态测试 |
| 需求 5 | §3.3、§3.4、§5.3、§7.2 | 工作区视图和 key 生成测试 |
| 需求 6 | §4.3、§4.4、§7.4 | 白名单和越权测试 |
| 需求 7 | §4.4、§4.5、§8 | 主链路集成测试 |

## 9. 风险与待确认项

### 9.1 风险

- 代理范围扩太快，会变成不可维护的全站转发器
- 工作区页面历史代码大量裸用 `workspaceId`，跨 HOST 时容易串状态
- 目标 HOST 登录态保存如果设计不好，会引入安全风险
- WebSocket 代理如果太早做全量，会让排错成本翻倍

### 9.2 待确认项

- 当前 HOST 的稳定身份 ID 是否已经存在；如果没有，第一阶段是否固定用 `current`
- Peer HOST 登录是复用用户名密码，还是走单独的一次性授权流程
- 第一阶段远端会话是否必须支持实时流式订阅，还是先支持 HTTP 操作
- 工作区视图里远端 HOST 分组的具体交互位置
