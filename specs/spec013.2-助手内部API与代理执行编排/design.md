# 设计文档 - spec013.2-助手内部API与代理执行编排

状态：Draft

## 1. 概述

### 1.1 目标

- 给 Butler 和后续工具链补一套正式的助手能力门面
- 把项目、会话、终端、消息、fork 这些现有能力收口成稳定接口
- 用统一语义同时映射到 Host API、CLI、内部 help 和 Skill
- 强制 Butler 走“只读分析 + 代理执行”，不再靠提示词口头约束

### 1.2 覆盖需求

- `requirements.md` 需求 1：统一能力模型
- `requirements.md` 需求 2：项目与会话查询
- `requirements.md` 需求 3：终端查询与受控输入
- `requirements.md` 需求 4：向项目会话发消息
- `requirements.md` 需求 5：会话 / 消息点 fork
- `requirements.md` 需求 6：只读分析 + 代理执行边界
- `requirements.md` 需求 7：Host API / CLI / 内部 help / Skill 映射
- `requirements.md` 需求 8：能力发现
- `requirements.md` 需求 9：审计与回执
- `requirements.md` 需求 10：兼容现有工作流

### 1.3 与 spec013 / spec013.1 的关系

- `spec013` 负责平台事实层和执行底座
- `spec013.1` 负责 Butler 控制会话、聚合上下文和前端聊天入口
- `spec013.2` 负责把底座能力正式包装成“助手可调用的工具表面”

一句话：

- `spec013` 负责“系统有什么”
- `spec013.1` 负责“助手怎么和用户说”
- `spec013.2` 负责“助手怎么用系统去查和做”

## 2. 核心思路

### 2.1 为什么这里要做 Capability Facade

现有服务已经有：

- Butler 项目和会话服务
- 普通 sessions 路由
- terminals 路由
- fork 和 runtime 路由

但这些接口是按后端模块长的，不是按助手动作长的。

助手真正需要的动作其实很少：

1. 我有哪些项目
2. 这个项目有哪些会话
3. 这个会话现在能不能继续
4. 这个终端现在在干什么
5. 往会话发一句话
6. 往终端发一个命令
7. 从这里 fork 一个分支

所以这里不该继续把路由文档塞给模型，而应该补一层明确的 `CapabilityFacade`。

### 2.2 为什么 Butler 不能直接写代码

这件事必须说死，不然后面一定会走歪。

Butler 控制会话本质上是调度者，不是执行者。

它真正该做的是：

- 查事实
- 做判断
- 选目标
- 发指令
- 收结果

真正改代码的人只能是：

- 真实项目会话
- 受控终端里的真实命令链

这样做的好处很实在：

- 用户能看到“是谁在改”
- 会话历史和终端历史都是真实的
- fork、重试、回溯都有真实落点

### 2.3 为什么 CLI、内部 help 和 Skill 要共用同一份语义

如果 CLI 一套、Skill 一套、帮助文档再一套，后面维护一定炸。

正确做法是：

1. 先定义一份能力核心合同
2. Host API 直接吃这份合同
3. CLI 只是把这份合同包成命令行参数
4. 内部 help 只是把这份合同包成按组、按动作的查询说明
5. Skill 只是告诉代理“什么时候该查哪个 help / 跑哪个命令”

这样后面新增能力时，只改一处核心语义。

## 3. 总体架构

### 3.1 分层

| 层级 | 作用 | 主要对象 |
| --- | --- | --- |
| `Existing Services` | 现有真实能力来源 | `ButlerProjectService`、`ButlerSessionService`、`SessionHistoryService`、`SessionLiveRuntimeService`、`TerminalController` 对应服务 |
| `Capability Facade` | 统一语义封装 | `assistant-capability-service` |
| `Transport Adapters` | 不同工具表面 | `assistant-capability-controller`、`codingns assistant ...` CLI、CLI help、Codex Skill |
| `Assistant Caller` | 实际消费方 | Butler 控制会话、后续 CLI provider、Codex 代理 |

### 3.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `assistant-capability-service` | 统一能力动作实现 | 结构化能力请求 | 结构化能力回执 |
| `assistant-capability-policy-service` | 判断动作是否允许 | 用户身份、目标对象、动作类型 | `allow / deny / require_approval` |
| `assistant-capability-audit-service` | 记录能力调用 | 调用上下文、结果 | 审计记录 |
| `assistant-capability-controller` | 暴露 Host API | HTTP 请求 | JSON 响应 |
| `assistant-cli` | 暴露 CLI | 命令行参数 | stdout JSON / text |
| `assistant-cli-help` | 暴露按组、按动作 help | help topic | 精简帮助文本 |
| `codingns-assistant skill` | 约束代理使用流程 | 用户请求 | “先查 help，再执行 CLI” 的工作流 |

### 3.3 与现有服务的复用关系

- 项目列表、项目上下文：复用 butler 项目与聚合服务
- 会话列表、消息历史、运行态：复用 sessions 主链路
- 发消息、续接、队列：复用 `SessionLiveRuntimeService`
- fork：复用现有 sessions fork 能力
- 终端列表、历史、输入：复用 terminal 主链路

原则不变：

**新层只做语义收口，不复制底层业务实现。**

## 4. 能力模型

### 4.1 第一阶段能力枚举

```ts
type AssistantCapabilityName =
  | "capabilities.list"
  | "projects.list"
  | "projects.get"
  | "projects.sessions.list"
  | "sessions.get"
  | "sessions.messages.list"
  | "sessions.runtime.get"
  | "sessions.message.send"
  | "sessions.fork"
  | "terminals.list"
  | "terminals.history.read"
  | "terminals.input.send";
```

### 4.2 动作分类

| 分类 | 动作 | 默认策略 |
| --- | --- | --- |
| 只读 | 查项目、查会话、查消息、查终端、查运行态 | 允许 |
| 代理执行 | 发会话消息、向终端发送输入、fork | 允许但要记审计 |
| 高风险 | 未来的直接文件写入、直接命令启动、批量执行 | 第一阶段不开放 |

### 4.3 回执结构

```ts
interface CapabilityReceipt<TPayload> {
  ok: boolean
  capability: string
  auditId: string
  timestamp: string
  targetRef: {
    kind: "project" | "session" | "terminal" | "none"
    id: string | null
  }
  payload: TPayload | null
  error: {
    code: string
    message: string
  } | null
}
```

设计重点：

- 每次调用都带 `auditId`
- 目标对象必须明确
- 失败时必须有稳定错误码

## 5. Host API 设计

### 5.1 能力发现

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/assistant/capabilities` | 返回当前开放能力、版本、限制、授权模式 |

返回示意：

```json
{
  "version": "2026-04-14",
  "items": [
    {
      "name": "projects.list",
      "mode": "read",
      "enabled": true
    },
    {
      "name": "sessions.message.send",
      "mode": "proxy_execute",
      "enabled": true
    }
  ]
}
```

### 5.2 项目与会话

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/assistant/projects` | 统一项目列表 |
| `GET` | `/api/assistant/projects/:projectId` | 项目详情 |
| `GET` | `/api/assistant/projects/:projectId/sessions` | 项目下可操作会话列表 |
| `GET` | `/api/assistant/sessions/:sessionId` | 会话详情 |
| `GET` | `/api/assistant/sessions/:sessionId/messages` | 最近消息窗口 |
| `GET` | `/api/assistant/sessions/:sessionId/runtime` | 运行态详情 |

### 5.3 代理动作

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/assistant/sessions/:sessionId/messages` | 向指定真实会话发送消息 |
| `POST` | `/api/assistant/sessions/:sessionId/forks` | 从会话或消息点 fork |
| `GET` | `/api/assistant/terminals` | 统一终端列表 |
| `GET` | `/api/assistant/terminals/:terminalId/history` | 终端历史 |
| `POST` | `/api/assistant/terminals/:terminalId/input` | 向终端发送输入 |

说明：

- 这些新路径是给助手和工具用的语义入口
- 服务端内部仍然复用现有模块

## 6. CLI 设计

### 6.1 命令分组

```bash
codingns assistant capabilities list
codingns assistant projects list
codingns assistant projects get <projectId>
codingns assistant sessions list --project <projectId>
codingns assistant sessions get <sessionId>
codingns assistant sessions send <sessionId> --message "..."
codingns assistant sessions fork <sessionId> --message-id <messageId>
codingns assistant terminals list
codingns assistant terminals history <terminalId>
codingns assistant terminals send <terminalId> --input "npm test\n"
```

### 6.2 输出原则

- 第一阶段默认输出 JSON，优先保证代理和脚本能稳定解析
- 后续如有需要，再补精简文本模式
- CLI 只是 transport adapter，不自己长业务逻辑

### 6.3 Help 设计

CLI 帮助不该是一整本长文档，而应该按层拆开：

- `codingns assistant --help`：只列能力分组
- `codingns assistant <group> --help`：只列这一组的动作
- `codingns assistant <group> <action> --help`：只列这一条动作的参数和一个最小例子

这样代理只在要用的时候才读那一小段，不会把全部命令长期塞进上下文。

## 7. Skill 设计

### 7.1 第一阶段 Skill 目标

- Skill 只告诉代理：
  - 不直接写项目代码
  - 先查能力，再查对象，再代理执行
  - 不清楚命令参数时先查 CLI help
- Skill 不复制整套命令文档
- 详细命令说明放在 Skill 的 `references/` 或 CLI 自带 help 中，按需读取

### 7.2 Skill 规则

- Skill 只承载流程约束，不承载业务实现
- Skill 内容必须瘦，避免把几十条命令长期塞进上下文
- Skill 指向 `codingns assistant ...` 和对应 help，而不是自己伪造接口说明

## 8. 授权与审计

### 8.1 策略

| 能力 | 默认授权 |
| --- | --- |
| 只读查询 | `ALLOW` |
| 会话发消息 | `ALLOW_WITH_AUDIT` |
| 会话 fork | `ALLOW_WITH_AUDIT` |
| 终端发送输入 | `ALLOW_WITH_AUDIT`，但可按工作区策略关闭 |

### 8.2 审计字段

```ts
interface AssistantCapabilityAuditRecord {
  id: string
  actorType: "butler_control_session" | "cli_user" | "codex_skill"
  actorRef: string
  capability: string
  targetKind: "project" | "session" | "terminal" | "none"
  targetId: string | null
  requestSummary: string
  resultStatus: "succeeded" | "failed" | "blocked"
  createdAt: string
}
```

## 9. Butler 接入方式

### 9.1 当前阶段

Butler 控制会话仍然通过 `AGENTS.md` / `BUTLER_API.md` 学会怎么查系统。

### 9.2 spec013.2 落地后

Butler 和 Codex Skill 不再只依赖长文档提示，而是：

1. 先调 `capabilities.list`
2. 根据用户问题选能力
3. 调能力门面
4. 把结构化回执拼回回答
5. 需要推进开发时，优先选 `sessions.message.send` 或 `terminals.input.send`

这会把“会不会调用内部系统”从提示词技巧，变成正式平台能力。

## 10. 迁移策略

### 10.1 第一阶段

- 新增 `/api/assistant/*` 能力门面
- 不删现有 `/api/butler/*`、`/api/sessions/*`、`/api/terminals/*`
- Butler 先继续保留现有 `BUTLER_API.md` 指引，同时开始补能力发现接口

### 10.2 第二阶段

- CLI 走新门面
- Skill 走 CLI + help
- `BUTLER_API.md` 改成“优先走统一能力面，需要更深细节时先查 help，再下钻旧接口”

## 11. 风险与规避

### 风险 1：新门面只是旧路由换个名字

规避：

- 按助手动作分组，不按服务模块分组
- 回执结构、审计结构必须统一

### 风险 2：Butler 仍然绕过代理执行边界

规避：

- 把“禁止直接写项目代码”写进能力策略，而不是只写在 prompt
- 不在第一阶段暴露直接文件写入能力

### 风险 3：CLI / help / Skill 各长各的

规避：

- 先定义能力合同，再生成或手写 adapter
- 所有入口共享同一份 service
