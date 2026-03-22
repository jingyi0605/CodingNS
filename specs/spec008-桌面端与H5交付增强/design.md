# 设计文档 - spec008 桌面端与H5交付增强

状态：Draft

## 1. 概述

### 1.1 目标

- 用 `Tauri 2` 完成桌面壳接入，但把壳层严格限制在平台集成能力
- 让桌面端和 H5 共用同一套 Host 能力访问方式与大部分 UI 状态模型
- 建立稳定的连接建立与恢复链路，避免“看起来在线，实际不可用”
- 定义桌面分发、升级、配置边界，保证发布可回退

### 1.2 覆盖需求

- `requirements.md` 需求 1：Tauri 必须被限制为桌面壳
- `requirements.md` 需求 2：桌面端和 H5 必须共享后端能力和大部分 UI 状态
- `requirements.md` 需求 3：连接建立必须稳定且可诊断
- `requirements.md` 需求 4：连接恢复必须有自动机制和人工兜底
- `requirements.md` 需求 5：桌面分发、升级、配置必须可控
- `requirements.md` 需求 6：受保护数据必须建立在登录态之上
- `requirements.md` 需求 7：明确不做移动端专属内容

### 1.3 技术约束

- 后端：沿用 `spec001` 的 Host 约束（`Node.js 22 + TypeScript + Fastify + ws + better-sqlite3`）
- 前端：沿用 `spec003` 的共享 Web 运行时（`React + TypeScript + Vite`）
- 桌面壳：`Tauri 2`（Windows/macOS）
- 认证：用户名密码 + access token + refresh token
- 通信：HTTP + WebSocket，受保护接口和事件默认鉴权
- 明确不做：移动端专属实现、壳层业务化、独立桌面业务协议

## 2. 架构

### 2.1 系统结构

spec008 的结构分四层：

1. `Host Core`：唯一业务真相，提供工作区、会话、文件、Git、终端、进程等 API 与事件。
2. `Shared UI Runtime`：桌面端和 H5 复用的 UI 代码、状态模型、路由与鉴权逻辑。
3. `Platform Adapter`：平台差异收口层，区分 `desktop` 与 `web` 的能力适配。
4. `Desktop Shell (Tauri)`：窗口、菜单、托盘、系统通知代理、安装升级，不承载业务状态。

关键原则：

- 业务请求统一走 Host，不在壳层发明第二套协议。
- 平台差异统一收口在 `platform-adapter`，不在业务页面散落分支。
- 受保护数据必须先通过登录态检查。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `ui-bootstrap` | 初始化平台、配置、登录态和连接探测 | 启动参数、缓存 token | 可进入业务路由的运行时上下文 |
| `auth-gateway` | 处理登录、刷新、登出、401 收口 | 登录凭据、token | 有效会话或登录引导 |
| `connection-manager` | 管理 HTTP 连通性检查与 WS 连接状态 | Host 地址、token | 连接状态、重连事件 |
| `platform-adapter` | 收口平台差异能力（桌面/浏览器） | 平台标识、能力请求 | 统一平台能力接口 |
| `tauri-shell-bridge` | 提供窗口与系统壳能力桥接 | UI 调用 | 壳层行为执行结果 |
| `release-manager` | 桌面更新检查、升级执行、回退 | 当前版本、通道配置 | 更新状态、升级结果 |
| `client-config-service` | 管理客户端配置（Host 地址、通道、启动行为） | 配置修改请求 | 持久化配置 |

### 2.3 关键流程

#### 2.3.1 桌面端首次启动与连接流程

1. 桌面壳启动共享 Web 入口，注入 `platform=desktop`。
2. `ui-bootstrap` 读取客户端配置（Host 地址、发布通道、上次登录上下文）。
3. 客户端调用 `GET /api/public/bootstrap-status` 判断 Host 初始化状态。
4. 若 Host 未初始化，则引导初始化与登录；若已初始化，进入登录校验。
5. 登录成功后建立 HTTP 会话与 WebSocket 连接，进入工作区入口。

#### 2.3.2 H5 访问与恢复流程

1. 浏览器端访问 H5，`platform=web` 启动。
2. `ui-bootstrap` 执行 token 校验与连接探测。
3. 若 token 失效，触发刷新或重新登录。
4. 连接成功后加载共享业务页面；连接失败显示可重试引导。

#### 2.3.3 断线重连与状态恢复流程

1. `connection-manager` 监听 WS 断开和 HTTP 探测失败。
2. 进入 `RECONNECTING`，按退避策略自动重连。
3. 重连成功后触发关键状态刷新（工作区摘要、会话摘要）。
4. 超过重连阈值进入 `RECONNECT_FAILED`，展示手动恢复入口。

#### 2.3.4 桌面更新流程

1. `release-manager` 拉取发布通道的版本元数据。
2. 校验签名和版本可升级性。
3. 用户确认后执行升级。
4. 升级失败时回滚到上一可用版本，保留用户配置。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7

- `BootstrapApp`：客户端启动入口，统一执行配置读取、鉴权检查、连接探测
- `ConnectionStatusBanner`：连接状态提示与手动恢复入口
- `PlatformProvider`：平台能力上下文提供器（desktop/web）
- `DesktopShellBridge`：桌面壳能力调用桥接层
- `ReleasePanel`：桌面更新检查与升级交互界面
- `ClientConfigStore`：Host 地址、通道、启动选项等配置状态

### 3.2 数据结构

覆盖需求：2、3、4、5、6

#### 3.2.1 `ClientRuntimeConfig`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `platform` | `desktop \| web` | 是 | 运行平台 | 枚举值 |
| `hostBaseUrl` | `string` | 是 | Host 基础地址 | 必须为合法 URL |
| `releaseChannel` | `stable \| beta` | 否 | 发布通道 | 桌面端可配置 |
| `autoReconnect` | `boolean` | 是 | 是否自动重连 | 默认 `true` |
| `autoCheckUpdate` | `boolean` | 否 | 是否自动检查更新 | 仅桌面端生效 |

#### 3.2.2 `ConnectionSessionState`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `authState` | `unknown \| authenticated \| unauthenticated` | 是 | 登录态状态 | 枚举值 |
| `httpState` | `up \| down \| probing` | 是 | HTTP 连通状态 | 枚举值 |
| `wsState` | `connected \| reconnecting \| failed \| closed` | 是 | WS 状态 | 枚举值 |
| `lastErrorCode` | `string` | 否 | 最近错误码 | 可空 |
| `lastRecoveredAt` | `string` | 否 | 最近恢复时间 | ISO8601 |

#### 3.2.3 `ReleaseManifest`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `channel` | `string` | 是 | 发布通道 | 非空 |
| `platform` | `string` | 是 | 目标平台 | 如 `windows-x64` |
| `version` | `string` | 是 | 目标版本号 | 语义化版本 |
| `notes` | `string` | 否 | 版本说明 | 可空 |
| `packageUrl` | `string` | 是 | 升级包地址 | 合法 URL |
| `signature` | `string` | 是 | 包签名 | 不可为空 |
| `publishedAt` | `string` | 是 | 发布时间 | ISO8601 |

### 3.3 接口契约

覆盖需求：2、3、4、5、6

#### 3.3.1 `GET /api/public/bootstrap-status`

- 类型：HTTP（公开）
- 输入：无
- 输出：`{ initialized: boolean }`
- 校验：无
- 错误：`INTERNAL_ERROR`

#### 3.3.2 `POST /api/auth/login`

- 类型：HTTP（公开入口，返回登录态）
- 输入：`{ username: string, password: string }`
- 输出：`{ accessToken: string, refreshToken: string, expiresIn: number }`
- 校验：用户名和密码必填
- 错误：`INVALID_CREDENTIALS`、`ACCOUNT_LOCKED`

#### 3.3.3 `POST /api/auth/refresh`

- 类型：HTTP（受保护会话续期）
- 输入：`{ refreshToken: string }`
- 输出：新 token 对
- 校验：refresh token 有效
- 错误：`TOKEN_INVALID`、`TOKEN_EXPIRED`

#### 3.3.4 `GET /api/client/runtime-config`

- 类型：HTTP（受保护）
- 输入：access token
- 输出：`ClientRuntimeConfig`（服务端可覆盖的运行时策略）
- 校验：必须登录
- 错误：`UNAUTHORIZED`

#### 3.3.5 `GET /api/client/release-manifest?channel=&platform=`

- 类型：HTTP（桌面升级接口）
- 输入：发布通道、平台标识
- 输出：`ReleaseManifest`
- 校验：参数合法，签名存在
- 错误：`MANIFEST_NOT_FOUND`、`MANIFEST_INVALID`

#### 3.3.6 `WS /ws`

- 类型：WebSocket（受保护）
- 输入：access token、订阅主题
- 输出：连接状态事件、业务增量事件
- 校验：握手必须鉴权
- 错误：`WS_UNAUTHORIZED`、`WS_SUBSCRIBE_DENIED`

#### 3.3.7 `DesktopShellBridge`（内部）

- 类型：Function（平台桥接）
- 标识：`openExternal`、`showNotification`、`setWindowState`、`readDesktopConfig`、`writeDesktopConfig`
- 输入：统一参数对象
- 输出：标准执行结果 `{ ok, errorCode?, detail? }`
- 校验：仅桌面端可调用；Web 调用返回 `PLATFORM_NOT_SUPPORTED`
- 错误：`PLATFORM_NOT_SUPPORTED`、`SHELL_BRIDGE_ERROR`

## 4. 数据与状态模型

### 4.1 数据关系

- 桌面端和 H5 共用 `Shared UI Runtime` 的业务状态模型。
- 平台差异信息由 `platform-adapter` 提供，业务页面只消费统一能力，不感知平台实现细节。
- 连接状态由 `connection-manager` 统一维护，供头部、提示条和路由守卫复用。
- 桌面升级元数据与业务数据分离，升级失败不影响业务数据真相。

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `BOOTSTRAPPING` | 客户端启动初始化中 | 应用启动 | 初始化完成 |
| `AUTH_REQUIRED` | 需要登录 | 无有效 token 或刷新失败 | 登录成功 |
| `CONNECTING` | 建立连接中 | 已登录且开始探测 Host | 连通或失败 |
| `CONNECTED` | 可正常使用 | HTTP/WS 都可用 | 连接中断 |
| `RECONNECTING` | 自动重连中 | WS/HTTP 中断 | 重连成功或失败阈值 |
| `RECONNECT_FAILED` | 自动重连失败 | 达到重连阈值 | 手动重连成功 |
| `UPDATING_DESKTOP` | 桌面升级进行中 | 用户确认升级 | 升级成功或回退 |

## 5. 错误处理

### 5.1 错误类型

- `AUTH_ERROR`：未登录、令牌失效、刷新失败
- `HOST_UNREACHABLE`：Host 不可达或地址错误
- `WS_CONNECT_ERROR`：WebSocket 握手失败或订阅失败
- `UPDATE_ERROR`：更新元数据异常、签名校验失败、升级失败
- `PLATFORM_ADAPTER_ERROR`：平台桥接调用失败

### 5.2 错误响应格式

```json
{
  "detail": "当前连接已断开，请重试",
  "error_code": "HOST_UNREACHABLE",
  "field": "hostBaseUrl",
  "timestamp": "2026-03-22T00:00:00Z"
}
```

### 5.3 处理策略

1. 鉴权错误：清理受保护缓存并跳转登录。
2. 连接错误：先自动重连，超过阈值后提示手动恢复。
3. 升级错误：停止升级流程并回退，不影响当前可用版本。
4. 平台适配错误：仅影响当前平台特性，不影响核心业务访问。

## 6. 正确性属性

### 6.1 属性 1：壳层不承载业务真相

*对于任何* 桌面端业务场景，系统都应该满足：业务真相来自 Host，Tauri 只做壳能力。

**验证需求：** 需求 1

### 6.2 属性 2：桌面端与 H5 能力口径一致

*对于任何* 共享业务模块，系统都应该满足：桌面端和 H5 通过同一 Host 协议访问，状态口径一致。

**验证需求：** 需求 2、需求 6

### 6.3 属性 3：受保护数据必须先过登录态

*对于任何* 受保护请求，系统都应该满足：未认证请求无法读取工作区数据或订阅业务事件。

**验证需求：** 需求 6

## 7. 测试策略

### 7.1 单元测试

- `platform-adapter`：桌面与 Web 适配分支行为
- `connection-manager`：状态机转移与重连策略
- `release-manager`：版本比较、签名校验、回退分支

### 7.2 集成测试

- 登录后建立 HTTP/WS 连接链路
- token 过期刷新与失败回退
- Host 暂时不可达后的自动重连与手动恢复

### 7.3 端到端测试

- 桌面端首次启动 -> 登录 -> 进入工作区
- H5 访问 -> 登录 -> 刷新页面后恢复连接
- 桌面端检查更新 -> 升级失败 -> 回退成功

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.1、§2.2、§6.1 | 架构评审 + 桌面壳代码清单检查 |
| `requirements.md` 需求 2 | `design.md` §2.1、§4.1、§6.2 | 桌面/H5 同功能对照测试 |
| `requirements.md` 需求 3、4 | `design.md` §2.3、§4.2、§5.3 | 连通与重连集成测试 |
| `requirements.md` 需求 5 | `design.md` §2.3.4、§3.2.3、§7.3 | 更新链路 E2E |
| `requirements.md` 需求 6 | `design.md` §3.3、§6.3 | 鉴权与未授权拦截测试 |
| `requirements.md` 需求 7 | `design.md` §1.3、§2.1 | 范围检查与评审记录 |

## 8. 风险与待确认项

### 8.1 风险

- 平台适配层设计不收口，后续业务页面会被平台分支污染。
- 桌面更新策略不完整，升级失败可能影响可用性。
- 连接状态和登录态处理不一致，容易出现“表面在线、实际不可用”。

### 8.2 待确认项

- 桌面端更新元数据托管位置与签名发布流程由哪一套 CI/CD 承担。
- H5 默认连接地址策略（手工输入、环境注入、发现服务）最终采用哪一种。
