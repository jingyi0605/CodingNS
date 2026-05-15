# 设计文档 - spec013.5-工作区会话助手能力开放与作用域收口

状态：Draft

## 1. 概述

### 1.1 目标

- 给工作区会话补正式的助手能力入口，而不是继续只靠 prompt
- 新增 `workspace_session` 调用者身份和 `workspace-scoped` 能力档位
- 让服务端按档位和作用域真正过滤能力，而不是“先放出来再提醒别用”
- 补齐 `terminals.create`，把当前工作区终端链补完整
- 把文档、浏览器、运维、工作树这些办公能力接到工作区会话可用入口

### 1.2 覆盖需求

- `requirements.md` 需求 1：`workspace_session` 调用者身份
- `requirements.md` 需求 2：scoped token
- `requirements.md` 需求 3：能力档位过滤
- `requirements.md` 需求 4：默认开放能力
- `requirements.md` 需求 5：条件开放能力
- `requirements.md` 需求 6：暂不开放能力
- `requirements.md` 需求 7：`terminals.create`
- `requirements.md` 需求 8：工作区会话能力说明注入
- `requirements.md` 需求 9：统一办公能力入口
- `requirements.md` 需求 10：Butler 兼容

### 1.3 与前置 Spec 的关系

- `spec013.2` 解决“助手能力怎么通过 Host API / CLI 暴露出来”
- `spec013.4` 解决“助手能力调用者是谁”
- `spec013.5` 解决“工作区会话能拿到哪一部分助手能力，以及只能在什么范围里拿”
- `spec015` 解决“文档、浏览器、运维这些办公能力本身是什么”

一句话：

- `spec013.2` 造门
- `spec013.4` 看门
- `spec013.5` 决定工作区会话能进哪几间屋子

## 2. 核心思路

### 2.1 为什么不能直接把全量 assistant 暴露给工作区会话

当前 `codingns assistant` 不只是办公能力，还包含：

- 会话控制
- 跨项目或跨工作区对象读取
- 自动化编排
- 审批回执
- 条件执行和潜在高风险写动作

如果一股脑全放给工作区会话，会立即出现三个问题：

1. 当前工作区会话会拿到跨工作区视野，破坏最基本的作用域边界
2. 模型会把 Butler 控制面命令误当成当前项目内的常规能力
3. 后续只要某个新 assistant 命令接进来，就会被默认暴露到工作区，风险不可控

所以必须先把“调用者档位”和“能力档位”分开，再根据档位做真正过滤。

### 2.2 为什么要用 scoped token，而不是只用 sessionId

只用 `sessionId` 有两个问题：

1. 服务端很难快速判断这个会话到底属于哪个工作区、现在允许哪些能力
2. 一旦后续要把能力透传到文档、浏览器、运维等统一任务模型里，就必须反复回查会话上下文

scoped token 的好处是一次把关键事实写死：

- 这是 `workspace_session`
- 它属于哪个 `workspaceId`
- 当前有无 `projectId`
- 它默认是什么能力档位

执行层只需要校验 token 和目标资源是否一致，不需要每次重新猜调用来源。

### 2.3 为什么能力要分成默认开放、条件开放、暂不开放

工作区会话的本质是“当前工作区内的助手”。

所以能力分层应该非常简单：

- 默认开放：读当前上下文、建当前工作区内的办公任务、建终端、建工作树这类低风险动作
- 条件开放：会写终端、会执行运维任务、会真正 merge 这种有副作用的动作
- 暂不开放：跨工作区会话管理、审批回执、自动化编排、工作区删除重排这些全局管理动作

这种分层能把边界写死，避免后续每加一个命令都重新争论一遍。

### 2.4 为什么 `terminals.create` 必须补

现在工作区会话就算拿到终端能力，也只能：

- `terminals.list`
- `terminals.history.read`
- `terminals.input.send`
- `terminals.close`

这是一套残缺接口，因为它默认假设“终端早就存在”。

真实使用场景不是这样。工作区会话首先要做的，往往就是“在当前工作区开一个新终端”。

所以 `terminals.create` 不是锦上添花，而是把终端能力从半残状态补成可用状态。

## 3. 总体架构

### 3.1 新增或调整的核心模块

| 模块 | 职责 | 主要改动 |
| --- | --- | --- |
| `assistant-caller-profile` | 定义调用者种类和默认能力档位 | 新增 `workspace_session` |
| `assistant-capability-profile-service` | 维护能力白名单和条件开放规则 | 新增 `workspace-scoped` profile |
| `assistant-capability-service` | 对外返回能力清单并做能力级鉴权 | 接入按调用者档位过滤 |
| `assistant-auth-scope-service` | 解析和校验 scoped token | 新增 `workspaceId/projectId/capabilityProfile` 校验 |
| `workspace-assistant-context` | 给工作区会话注入能力说明和调用方式 | 新增会话提示注入 |
| `assistant-terminal-service` | 封装工作区会话终端能力 | 新增 `terminals.create` |

### 3.2 复用的现有模块

| 现有模块 | 复用方式 |
| --- | --- |
| `AuthService` / `auth-guard` | 继续承载调用者身份识别和请求鉴权 |
| `AssistantCapabilityService` | 继续作为所有 assistant 能力的统一注册表 |
| `ButlerWorkspaceContextService` 或相邻上下文模块 | 复用现有提示注入思路，为工作区会话补能力说明 |
| `TerminalService` / `TerminalSessionService` | 复用既有 PTY 创建和生命周期管理 |
| `WorktreeService` | 继续承载工作树创建、预览、清理和合并 |
| `office task/document/browser/ops` 相关服务 | 继续承载 `spec015` 的真实办公能力 |

### 3.3 分层

| 层级 | 作用 |
| --- | --- |
| 身份层 | 判断请求来自 `butler_runtime / butler_ui / workspace_session` |
| 档位层 | 决定这个调用者能看到哪些能力 |
| 作用域层 | 决定它能操作哪个 `workspaceId / projectId` |
| 执行层 | 真正调用终端、文档、浏览器、运维、工作树服务 |
| 提示层 | 告诉工作区会话“你有哪些能力、怎么正确用” |

## 4. 数据与配置模型

### 4.1 调用者种类

```ts
type AssistantCallerKind =
  | "butler_runtime"
  | "butler_ui"
  | "workspace_session";
```

说明：

- `butler_runtime`：Butler 运行时专用调用
- `butler_ui`：Butler 页面显式操作
- `workspace_session`：工作区普通会话调助手能力

### 4.2 能力档位

```ts
type AssistantCapabilityProfile =
  | "butler-full"
  | "butler-ui"
  | "workspace-scoped";
```

说明：

- `butler-full`：Butler 运行时完整能力集
- `butler-ui`：Butler 页面显式入口能力集
- `workspace-scoped`：工作区会话受控能力集

### 4.3 工作区 scoped token 负载

```ts
interface WorkspaceAssistantScopeTokenPayload {
  sub: string
  callerKind: "workspace_session"
  capabilityProfile: "workspace-scoped"
  workspaceId: string
  projectId: string | null
  sessionId: string
  issuedAt: string
  expiresAt: string
}
```

说明：

- `workspaceId` 是第一约束
- `projectId` 只有当前会话已经绑定项目时才存在
- `sessionId` 方便后续审计和最小排障
- 这个 token 不是全局长期凭证，而是当前工作区会话的受控凭证

### 4.4 能力注册元数据扩展

当前 assistant 能力注册表只需要知道“这个命令是什么”。本轮要扩成至少包含：

```ts
interface AssistantCapabilityDefinition {
  key: string
  title: string
  riskLevel: "read" | "write" | "high-risk"
  allowedProfiles: AssistantCapabilityProfile[]
  workspaceScope: "none" | "workspace" | "project"
  requiresApproval: boolean
}
```

说明：

- `allowedProfiles` 决定谁看得到
- `workspaceScope` 决定作用域怎么校验
- `requiresApproval` 决定是否为条件开放能力

## 5. 能力分层设计

### 5.1 `workspace-scoped` 默认开放能力

| 能力 | 说明 | 作用域 |
| --- | --- | --- |
| `capabilities.list` | 返回当前工作区会话真正可用能力 | workspace |
| `projects.get` | 读取当前工作区绑定项目信息 | project |
| `sessions.get` | 读取当前工作区会话自身状态 | workspace |
| `sessions.messages.list` | 读取当前工作区会话消息 | workspace |
| `sessions.runtime.get` | 读取当前工作区会话运行时 | workspace |
| `terminals.create` | 在当前工作区新建终端 | workspace |
| `terminals.list` | 列出当前工作区终端 | workspace |
| `terminals.history.read` | 读取当前工作区终端历史 | workspace |
| `office.document.*` | 当前工作区文档创建、编辑、导出 | workspace |
| `office.browser.*` | 当前工作区浏览器任务与会话操作 | workspace |
| `office.ops.target.*` | 当前工作区内可见的运维目标查询 | workspace |
| `office.ops.ssh-task.create` | 创建 SSH 运维任务 | workspace |
| `office.ops.browser-task.create` | 创建浏览器运维任务 | workspace |
| `office.ops.task.get` | 查询当前工作区运维任务回执 | workspace |
| `worktrees.tree` | 读取当前项目工作树结构 | project |
| `worktrees.create` | 为当前项目创建子工作树 | project |
| `worktrees.merge-preview` | 预览合并影响 | project |
| `worktrees.cleanup` | 清理当前项目子工作树 | project |

### 5.2 条件开放能力

| 能力 | 触发条件 | 原因 |
| --- | --- | --- |
| `terminals.input.send` | 用户显式确认或终端策略允许 | 会执行真实命令 |
| `terminals.close` | 用户显式确认 | 可能打断运行中任务 |
| `office.ops.task.execute` | 审批通过或满足安全白名单 | 会真正改远端系统状态 |
| `debug-targets.*` 执行类 | 用户显式确认 | 可能拉起或改变调试目标 |
| `worktrees.merge-into-parent` | 用户显式确认，必要时审批 | 会改父分支状态 |

### 5.3 暂不开放能力

| 能力 | 不开放原因 |
| --- | --- |
| `office.task.approval.reply` | 工作区会话不应处理全局审批回执 |
| `sessions.start` | 工作区会话不是新的全局会话调度器 |
| `sessions.message.send` | 容易越权操作其他会话 |
| `sessions.fork` | 涉及跨会话派生和更多上下文管理 |
| `sessions.delete` | 破坏性过强 |
| `sandboxes.*` | 属于 Butler 编排级能力，不是当前工作区默认动作 |
| `automations.*` | 属于控制面自动化编排，不是普通工作区职责 |
| `workspaces.remove` | 破坏性过强 |
| `workspaces.reorder` | 属于全局工作区管理动作 |

## 6. 关键流程

### 6.1 工作区会话拿能力的初始化流程

1. 工作区会话创建或恢复时，系统判断这是普通工作区会话，不是 Butler 控制面。
2. Host 为该会话构造 `workspace_session` 调用者上下文。
3. Host 签发 `workspace-scoped` token，绑定当前 `workspaceId` 和可选 `projectId`。
4. 会话提示注入模块写入“当前可用 assistant 能力说明”。
5. 工作区会话调用 `capabilities.list` 时，Host 根据 profile 和作用域返回过滤后的结果。

### 6.2 能力执行校验流程

1. 工作区会话提交 assistant 能力调用请求。
2. `auth-guard` 解析 scoped token，确认 `callerKind=workspace_session`。
3. `assistant-capability-service` 校验：
   - 当前 profile 是否允许该能力
   - 该能力是否需要额外审批
   - 请求里的 `workspaceId/projectId` 是否与 token 一致
4. 通过后进入真实服务执行。
5. 回执里带上最小审计字段：`callerKind`、`workspaceId`、能力 key、结果摘要。

### 6.3 `terminals.create` 流程

1. 工作区会话请求 `terminals.create`。
2. 请求体只允许传当前 token 作用域内的 `workspaceId`，可选 `cwd` 必须在工作区目录下。
3. 终端服务创建新的 PTY 会话并绑定到该工作区。
4. 返回：
   - `terminalId`
   - `workspaceId`
   - `status`
   - `createdAt`
   - 初始提示摘要

### 6.4 办公能力回收到当前工作区的流程

1. 工作区会话调用 `office.document.*`、`office.browser.*`、`office.ops.*`。
2. 办公能力服务从 scoped token 拿到 `workspaceId`。
3. 文档产物、浏览器会话、运维任务都落到当前工作区名下。
4. 返回统一回执：
   - `taskId` 或 `documentId`
   - `workspaceId`
   - `summary`
   - `artifacts`
   - `status`

## 7. 工作区会话能力说明注入

### 7.1 注入目标

不是给模型塞大段平台手册，而是给它几条明确规则：

- 你可以调哪些受控助手能力
- 这些能力只限当前工作区
- 哪些能力需要确认
- 哪些事情别试

### 7.2 注入内容骨架

建议在工作区会话提示里增加一段固定说明：

1. 当需要正式创建或更新文档时，优先调用 `assistant office.document.*`
2. 当需要用真实浏览器执行网页操作时，优先调用 `assistant office.browser.*`
3. 当需要 SSH 或浏览器运维任务时，优先调用 `assistant office.ops.*`
4. 当需要开终端时，先用 `assistant terminals.create`
5. 当需要写终端、执行高风险运维、merge 工作树时，必须先征得用户确认
6. 不要尝试操作其他工作区、其他项目或未开放的 assistant 能力

### 7.3 注入落点

可选落点如下：

- 工作区会话初始化时的系统提示构造器
- 工作区 provider 适配层注入的能力说明块
- 工作区会话可见的内置能力帮助文档

第一阶段优先选系统提示注入，因为这是最便宜也最直接的入口。

## 8. Host API 与 CLI 设计

### 8.1 Host API

新增或调整接口：

| 接口 | 说明 |
| --- | --- |
| `GET /api/assistant/capabilities` | 按 caller profile 返回过滤后的能力列表 |
| `POST /api/assistant/terminals/create` | 在当前工作区创建终端 |
| `POST /api/assistant/...` | 其他既有接口继续复用，但统一接入 profile 和 scope 校验 |

说明：

- 不要求为每个能力重造一套路由
- 重点是统一把 profile 和作用域校验接到现有助手能力路由里

### 8.2 CLI

`codingns assistant` 现有命令面保留，并增加：

```bash
codingns assistant terminals create --workspace <workspaceId> [--cwd <path>] [--title <name>]
```

说明：

- 如果调用者是工作区 scoped token，则 `--workspace` 只能等于 token 里的当前工作区
- 如果调用者是 Butler 控制面，可继续按其自身权限规则执行

### 8.3 能力帮助输出

工作区会话如果调用：

```bash
codingns assistant capabilities list
```

返回结果不应是全量命令表，而应是当前可用子集，并显式标记：

- `default`
- `conditional`

避免模型把“列得出来”误当成“现在就能执行”。

## 9. 测试与回归

### 9.1 必测场景

1. 工作区会话拿到的能力列表已过滤，不包含 `sessions.start`、`automations.*` 等未开放能力。
2. 工作区会话可以创建当前工作区终端，且不能跨工作区创建。
3. 工作区会话可以调用文档、浏览器、运维、工作树默认开放能力。
4. 工作区会话触发条件开放能力时，会被要求确认或审批。
5. Butler 控制面现有能力不受影响。

### 9.2 回归重点

- 现有 Butler token 与 `butler-ui` 请求头鉴权不能被打坏
- `spec015` 办公能力的 assistant 路由不能因为作用域检查被误拒
- 终端既有 list/read/send/close 行为要继续兼容

## 10. 风险与取舍

### 10.1 最大风险

最大风险不是“功能不够多”，而是：

- 能力列表和真实执行校验不一致
- 看起来只开放了当前工作区，实际上某些执行入口还能越过作用域

这个风险如果不压住，整个设计就是假的。

### 10.2 当前取舍

- 先做固定 capability profile，不做用户自定义复杂权限矩阵
- 先给工作区会话开放当前工作区办公能力，不开放全局自动化和审批管理
- 先把 `terminals.create` 补齐，再谈更复杂的终端策略
