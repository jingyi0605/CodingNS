# 设计文档 - spec015.2-插件管理能力与静态HTML插件运行时

状态：Draft

## 1. 概述

### 1.1 目标

- 为 `CodingNS` 建立正式插件管理能力，而不是继续依赖零散 HTML 页面和临时脚本入口
- 让静态 HTML 成为正式插件前端类型之一，而不是滥用普通 HTML 预览能力
- 让插件后端默认以 Node.js 动作方式按需执行，不常驻
- 让插件能力统一通过 Host API、CLI、自动化体系暴露
- 把插件工作区隔离、安全限制、桌面桥收口和运行审计正式写入系统设计

### 1.2 覆盖需求

- `requirements.md` 需求 1、2：插件清单、注册表、启用/禁用
- `requirements.md` 需求 3、11：静态 HTML 插件前端运行时与普通 HTML 预览区分
- `requirements.md` 需求 4、5：Node.js 插件动作与统一网关
- `requirements.md` 需求 6：自动化与正式后台任务接入
- `requirements.md` 需求 7：当前工作区强绑定与文件边界控制
- `requirements.md` 需求 8、9、10：权限模型、安全运行时、桌面能力中介
- `requirements.md` 需求 12：审计与可观测性

### 1.3 与前置 Spec 的关系

- `spec015`：提供统一办公任务与统一执行平台的上位设计，本 Spec 是其“插件扩展能力”分支
- `spec015.1`：已经把 `office.browser` 的真实浏览器桥接引入正式能力面，本 Spec 进一步为 HTML 插件前端提供受控插件运行时
- `spec004` / `spec004.1`：已有文件预览与 HTML 预览能力，本 Spec 明确它们不是插件运行时
- `spec006`：已有终端和命令执行基础，可作为插件 Node.js 进程执行参考
- `spec013.2` / `spec013.3`：已有助手能力门面与自动化调度基础，可复用网关与调度骨架

一句话：

这份 Spec 不是“把 HTML 预览升级一下”，而是把 `CodingNS` 正式补上插件系统的对象模型和运行时边界。

## 2. 先把对象说死

### 2.1 真正的一等公民

这一轮真正的一等公民不是“某个 HTML 页面”或“某个脚本路径”，而是：

- `PluginDefinition`
- `PluginManifest`
- `PluginEnablement`
- `PluginPermissionGrant`
- `PluginFrontendRuntime`
- `PluginActionDefinition`
- `PluginScheduleDefinition`
- `PluginRun`
- `PluginAuditEvent`

### 2.2 为什么必须先统一插件对象模型

因为你要解决的不是“能不能运行一个 HTML 页面”，而是下面这串正式问题：

1. 这个插件是谁
2. 它有没有被注册
3. 它现在是不是启用状态
4. 它声明了哪些动作
5. 它有无后端
6. 它有没有调度
7. 它拿了哪些权限
8. 它最近跑了什么
9. 它是不是越界访问了工作区外资源

如果这些对象不先统一，最后你得到的会是一堆页面开关、脚本路径和私有 if/else。那是垃圾。

### 2.3 为什么插件管理必须落在 Host

`apps/desktop` 的职责应该是：

- 本地原生能力壳
- 桌面桥接
- 窗口管理

它不是插件系统的大脑。

插件系统真正要管理的是：

- 清单注册
- 状态切换
- API / CLI 分发
- 调度与后台执行
- 权限判定
- 工作区隔离
- 审计

这些天然属于 Host。

### 2.4 为什么不能把“动态能力”做成“动态改路由树”

看起来你想要的是“插件注册后就有自己的 API 和 CLI”。

但真正应该做的是：

- 固定系统级路由入口
- 固定系统级 CLI 入口
- 由插件网关按照 manifest 做动态分发

而不是：

- 启用插件时往 Fastify 里塞一堆私有路由
- 禁用插件时再想办法拆路由
- CLI 也跟着热插拔命令树

那种设计复杂、脆弱，还不好审计。

### 2.5 为什么静态 HTML 插件前端不能复用普通 HTML 预览链路

普通 HTML 预览是文件查看。

插件前端是可执行前端程序。

两者的安全模型完全不同：

- 预览链路可以偏保守，甚至禁脚本
- 插件链路允许脚本，但必须有插件专用 CSP、sandbox、桥接协议和权限限制

如果你把这两者混起来，后面只会把普通文件预览也拖进权限风险区。

## 3. 总体结构

### 3.1 模块分层

| 层级 | 模块 | 职责 |
| --- | --- | --- |
| 对象层 | `plugin-registry-service` | 管理插件清单、注册表、状态与权限声明 |
| 运行层 | `plugin-runtime-service` | 管理插件前端运行时、后端动作执行和运行上下文 |
| 网关层 | `plugin-controller` / `plugin-cli-dispatcher` | 暴露统一 API / CLI 入口 |
| 调度层 | `plugin-scheduler-service` | 把插件调度接入正式后台任务体系 |
| 安全层 | `plugin-permission-service` | 裁决权限、工作区作用域、桌面能力中介 |
| 静态资源层 | `plugin-static-service` | 托管插件前端资源，区分普通 HTML 预览 |
| 前端容器层 | `plugin-container` | 以 iframe 或独立容器承载插件前端并注入受控桥 |
| 桌面桥接层 | `desktop-bridge` | 只提供受控本地动作，不直接暴露给插件前端 |

### 3.2 总链路

统一链路如下：

1. 维护者将插件目录放入受支持位置
2. Host 扫描目录并解析 `plugin.json`
3. `plugin-registry-service` 校验 manifest 并写入注册表
4. 用户或维护者启用插件
5. 前端通过插件管理界面查看插件并打开插件容器
6. 插件前端在受控容器中加载，必要时调用插件网关
7. 插件网关按插件定义执行前端请求的动作
8. 若动作需要后端，`plugin-runtime-service` 拉起对应 Node.js 脚本执行
9. 若动作需要桌面能力，经过 Host 权限校验后调用受控桌面桥
10. 若插件声明调度，则 `plugin-scheduler-service` 将其接入正式后台任务体系
11. 所有注册、状态切换、运行、失败、拒绝都写入 `PluginAuditEvent` / `PluginRun`

### 3.3 与现有模块的复用关系

| 现有模块 | 复用方式 |
| --- | --- |
| `FileAccessGuard` | 作为工作区内路径解析与越界拦截的最终守卫 |
| `WorkspaceSessionAuthService` | 复用工作区 scoped 会话身份模型 |
| `AssistantCapabilityService` | 复用“能力作用域”和统一代理入口思路 |
| `TaskManager` / 现有 scheduler | 承载插件调度执行，不再私长定时器 |
| `desktop bridge` | 只作为 Host 受控中介的底层能力，不直接暴露给插件页 |
| `static-web` / 文件预览基础 | 参考资源托管方式，但插件链路必须单独实现 |

## 4. 数据结构

### 4.1 `PluginManifest`

```ts
interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  frontend?: {
    entry: string
    mode?: "static_html"
  }
  backend?: {
    runtime: "node"
    mode?: "on_demand" | "daemon"
    actions: PluginActionDefinition[]
  }
  permissions: PluginPermissionManifest
  schedules?: PluginScheduleDefinition[]
}
```

说明：

- `frontend` 可选，允许“纯后端插件”预留空间，但第一阶段主目标仍是静态 HTML 前端
- `backend` 可选，允许“仅前端插件”
- `mode` 默认 `on_demand`

### 4.2 `PluginDefinition`

```ts
interface PluginDefinition {
  id: string
  version: string
  name: string
  installRoot: string
  manifestJson: string
  hasFrontend: boolean
  hasBackend: boolean
  createdAt: string
  updatedAt: string
}
```

### 4.3 `PluginEnablement`

```ts
interface PluginEnablement {
  pluginId: string
  enabled: boolean
  enabledByUserId: string | null
  enabledAt: string | null
  disabledByUserId: string | null
  disabledAt: string | null
  reason: string | null
  updatedAt: string
}
```

### 4.4 `PluginActionDefinition`

```ts
interface PluginActionDefinition {
  id: string
  title: string
  entry: string
  timeoutMs?: number
  inputSchemaJson?: string
  outputSchemaJson?: string
}
```

### 4.5 `PluginPermissionManifest`

```ts
interface PluginPermissionManifest {
  workspaceRead?: boolean
  workspaceWrite?: boolean
  network?: boolean
  desktop?: Array<"open_file" | "reveal_in_file_manager">
  hostApis?: string[]
}
```

说明：

- 第一阶段默认 `workspaceRead=false`、`workspaceWrite=false`、`network=false`
- `desktop` 必须显式列出动作
- 高风险权限不在第一阶段开放通配符

### 4.6 `PluginRun`

```ts
interface PluginRun {
  id: string
  pluginId: string
  workspaceId: string
  triggerKind: "frontend" | "cli" | "schedule" | "assistant"
  actionId: string | null
  status: "queued" | "running" | "succeeded" | "failed" | "rejected" | "cancelled"
  inputSummaryJson: string | null
  outputSummaryJson: string | null
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}
```

### 4.7 `PluginAuditEvent`

```ts
interface PluginAuditEvent {
  id: string
  pluginId: string
  workspaceId: string | null
  eventType:
    | "plugin.registered"
    | "plugin.registration_failed"
    | "plugin.enabled"
    | "plugin.disabled"
    | "plugin.action_invoked"
    | "plugin.action_rejected"
    | "plugin.frontend_loaded"
    | "plugin.scope_rejected"
    | "plugin.desktop_call"
  actorUserId: string | null
  payloadJson: string
  createdAt: string
}
```

### 4.8 表结构建议

建议新增如下表：

- `plugin_definitions`
- `plugin_enablements`
- `plugin_runs`
- `plugin_audit_events`
- `plugin_schedules`
- `plugin_permission_grants`（如后续权限授权需要独立记录）

## 5. 核心流程设计

### 5.1 插件注册流程

1. 扫描受支持插件目录
2. 读取 `plugin.json`
3. 校验必填字段、版本、前端入口、动作入口和权限声明
4. 检查文件路径是否位于插件根目录内部
5. 写入或更新 `plugin_definitions`
6. 记录注册结果审计事件

### 5.2 插件启用/禁用流程

启用：

1. 校验插件已注册
2. 校验关键资源存在
3. 写 `plugin_enablements.enabled = true`
4. 载入插件前端可见性与动作可调用性
5. 注册调度声明到后台任务体系
6. 写审计事件

禁用：

1. 写 `plugin_enablements.enabled = false`
2. 网关拒绝后续动作调用
3. 前端插件列表隐藏或标记停用
4. 取消后续调度触发
5. 若有守护进程模式，执行停用清理
6. 写审计事件

### 5.3 插件前端加载流程

1. 用户在工作区上下文打开插件
2. 前端路由进入插件容器页
3. 容器向 Host 拉取插件元数据与当前工作区上下文
4. 容器构造插件资源 URL
5. 通过受控 iframe 加载插件前端
6. 容器注入受控插件桥初始化消息
7. 插件前端如需调用能力，走插件桥或 Host API 网关

### 5.4 插件动作执行流程

1. 前端 / CLI / 调度发起 `callAction`
2. 插件网关解析 `pluginId` 与 `actionId`
3. 校验插件已启用
4. 从认证态或上下文强制绑定 `workspaceId`
5. 校验权限
6. 创建 `PluginRun`
7. 若为 Node.js 后端动作，则拉起 Node 进程执行脚本
8. 收集输出、错误、退出码
9. 更新 `PluginRun` 状态并返回结果
10. 写审计事件

### 5.5 插件调度流程

1. 插件声明 schedule
2. Host 将 schedule 编译为正式调度对象
3. 由后台任务体系触发
4. 触发后走与普通动作相同的执行链
5. 若插件被禁用，后续触发直接取消

## 6. API 与 CLI 设计

### 6.1 API 设计

固定入口，不动态拼系统结构。

建议路由：

- `GET /api/plugins`
- `GET /api/plugins/:pluginId`
- `POST /api/plugins/:pluginId/enable`
- `POST /api/plugins/:pluginId/disable`
- `POST /api/plugins/:pluginId/actions/:actionId`
- `GET /api/plugins/:pluginId/frontend/*`
- `GET /api/plugins/:pluginId/runs`
- `GET /api/plugins/:pluginId/schedules`

说明：

- `workspaceId` 不作为插件 API 的自由输入参数
- 工作区作用域从认证态和上下文中强制注入

### 6.2 CLI 设计

建议提供统一命令：

- `codingns plugins list`
- `codingns plugins get <pluginId>`
- `codingns plugins enable <pluginId>`
- `codingns plugins disable <pluginId>`
- `codingns plugins call <pluginId> <actionId> --input-json ...`
- `codingns plugins runs list --plugin <pluginId>`

说明：

- CLI 入口统一，不为单插件热插拔命令树
- 后续如需别名命令，也应以统一 dispatcher 实现

## 7. 前端运行时与安全模型

### 7.1 插件容器

建议在 `apps/user-app` 中新增插件容器页：

- 插件列表页
- 插件详情页
- 插件容器页
- 权限显示与运行记录面板

插件容器核心职责：

- 加载插件 iframe
- 管理插件生命周期
- 注入当前工作区上下文
- 提供受控桥接
- 显示错误、权限状态、调度状态

### 7.2 iframe sandbox 策略

静态 HTML 插件前端默认允许脚本，但不能放开宿主权限。

建议默认基础策略：

- `allow-scripts`
- 必要时按插件能力补 `allow-forms`
- 默认不开放 `allow-modals`
- 默认不开放 `allow-top-navigation`
- 非必要不开放 `allow-same-origin`

具体策略应由插件运行时统一生成，不允许插件自定。

### 7.3 CSP 策略

插件资源响应应由 Host 下发插件专用 `Content-Security-Policy`。

最小建议：

- `default-src 'none'`
- `script-src 'self' 'unsafe-inline'`
- `style-src 'self' 'unsafe-inline'`
- `img-src 'self' data: blob:`
- `font-src 'self' data:`
- `connect-src 'self'` 或受控 Host API 域
- `form-action 'none'` 或按声明放开
- `frame-ancestors 'self'`

原则：

- 插件是否允许网络请求，必须由权限声明决定
- 不是所有插件都默认能外联

### 7.4 插件桥协议

插件前端不能直接接触：

- `window.__TAURI_INTERNALS__`
- `window.CodingNSDesktop`
- 宿主登录 token
- 宿主私有存储

应改为受控插件桥，例如：

```ts
interface CodingNSPluginBridge {
  getContext(): Promise<{ pluginId: string; workspaceId: string }>
  callAction(actionId: string, input?: unknown): Promise<unknown>
  requestDesktopAction(action: "open_file" | "reveal_in_file_manager", input: unknown): Promise<unknown>
}
```

### 7.5 消息通道校验

所有 `postMessage` 通道必须校验：

- `event.origin`
- `event.source`
- `message.type`
- `payload schema`

长期使用 `"*"` 是坏味道，插件时代必须收口。

## 8. 工作区隔离模型

### 8.1 总原则

> 插件可以请求“当前工作区中的资源”，但不能请求“某个工作区中的资源”。

这是插件权限模型的生死线。

### 8.2 作用域绑定

- 插件容器页必须处于某个当前工作区上下文
- 插件 API 不接受自由输入的 `workspaceId`
- Host 从当前认证态、工作区会话或插件实例上下文中绑定 `workspaceId`

### 8.3 文件访问约束

所有插件文件相关调用最终都必须走正式路径守卫，例如：

- 工作区根路径解析
- 路径穿越检测
- 软链接越界检测
- 路径出工作区拒绝

### 8.4 桌面动作约束

插件请求：

- 打开文件
- 打开所在目录

时，不能直接传宿主绝对路径。

正确做法：

1. 插件传相对路径或受控引用
2. Host 在当前工作区内解析
3. Host 校验通过后调用桌面壳命令

### 8.5 审计约束

任何以下事件都要记审计：

- 跨工作区请求被拒绝
- 路径越界被拒绝
- 无权限桌面调用被拒绝
- 试图访问未授权 Host API 被拒绝

## 9. 与普通 HTML 预览的关系

### 9.1 必须严格分离

普通 HTML 预览：

- 面向文件查看
- 不等于插件页
- 可以更保守，甚至禁脚本

插件前端：

- 面向受控执行
- 允许脚本
- 但必须进入插件容器和插件桥体系

### 9.2 不破坏原则

插件系统接入后：

- 现有文件预览主流程不能被替换
- 现有 HTML 预览不能因为插件系统默认升级成高权限前端
- 现有桌面桥对普通功能继续可用，但对插件场景额外收口

## 10. 建议代码落点

### 10.1 `apps/host`

建议新增模块：

```text
apps/host/src/modules/plugins/
  plugin-manifest.ts
  plugin-registry-service.ts
  plugin-runtime-service.ts
  plugin-process-runner.ts
  plugin-permission-service.ts
  plugin-static-service.ts
  plugin-scheduler-service.ts
  plugin-controller.ts
```

并在：

- `apps/host/src/routes/plugins.ts`
- `apps/host/src/server/create-server.ts`

中接入。

### 10.2 `apps/user-app`

建议新增：

- 插件列表页
- 插件详情页
- 插件容器页
- 插件桥前端 SDK
- 插件权限与运行记录面板

### 10.3 `packages/codingns`

建议新增统一 CLI 分发：

- `plugins list`
- `plugins enable`
- `plugins disable`
- `plugins call`
- `plugins runs`

### 10.4 `apps/desktop`

只做两件事：

1. 继续提供受控桌面原生命令
2. 收口插件场景下的桥接暴露边界

不把插件系统主逻辑塞进这里。

## 11. 分阶段实施建议

### 阶段 1：对象模型与统一网关

- 插件清单
- 注册表
- 启用/禁用
- API / CLI 统一入口
- 基础运行记录

### 阶段 2：静态 HTML 插件前端运行时

- 插件资源托管
- 插件容器页
- 插件桥
- 普通预览链路与插件链路分离

### 阶段 3：Node.js 插件后端动作

- 按需拉起
- 超时控制
- 结果回执
- 失败落库

### 阶段 4：调度与自动化接入

- schedule 声明
- 后台任务接入
- 启停联动

### 阶段 5：安全加固与回归

- CSP / sandbox / postMessage 收口
- 工作区越权回归
- 桌面桥越权回归
- 普通 HTML 预览零破坏回归

## 12. 风险与取舍

### 风险 1：把普通 HTML 预览误当插件运行时

后果：

- 安全模型混乱
- 文件预览被拖入高权限风险区

处理：

- 资源链路彻底分离
- 插件容器独立实现

### 风险 2：插件前端拿到桌面桥

后果：

- 本地文件与系统能力越权

处理：

- 插件页不得直接接触原生桥
- 只给受控插件桥

### 风险 3：动态热插路由树和命令树

后果：

- 系统结构难以维护
- 禁用和卸载过程复杂

处理：

- 使用稳定网关 + manifest 分发

### 风险 4：跨工作区访问漏网

后果：

- 破坏工作区隔离，是严重设计事故

处理：

- 不允许前端自由指定 `workspaceId`
- 所有路径解析最终走统一守卫
- 桌面动作也复用相同边界校验

## 13. 结论

最小正确方案不是“把 HTML 跑起来”，而是：

1. 先定义插件对象模型
2. 用 Host 建正式插件网关
3. 用前端插件容器承载静态 HTML 前端
4. 用 Node.js 按需动作承载后端
5. 把工作区隔离和权限收口写成系统铁律
6. 让 Desktop 继续做壳，不做插件业务大脑

这才是能长期活下去的方案。
