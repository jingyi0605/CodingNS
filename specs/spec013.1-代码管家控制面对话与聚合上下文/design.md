# 设计文档 - spec013.1-代码助手控制面对话与聚合上下文

状态：Draft

## 1. 概述

### 1.1 目标

- 为代码助手补一个独立的控制面会话，而不是借项目会话冒充
- 为控制面会话补一套可初始化、可配置、可审计的 `ButlerProfile`
- 把项目、会话、记忆、巡视、验证事实聚合成可对话的分层上下文
- 为前端提供正式的“助手”入口和工作台

### 1.2 覆盖需求

- `requirements.md` 需求 1：代码助手初始化
- `requirements.md` 需求 2：独立控制会话
- `requirements.md` 需求 3：分层上下文聚合
- `requirements.md` 需求 4：助手身份解释能力
- `requirements.md` 需求 5：控制动作
- `requirements.md` 需求 6：provider 限制
- `requirements.md` 需求 7：provider 切换清空上下文
- `requirements.md` 需求 8：前端工作台入口
- `requirements.md` 需求 9：审计与兼容边界

### 1.3 与 spec013 的关系

`spec013` 解决的是平台事实层：

- 项目
- 会话
- 记忆
- 巡视
- 验证

`spec013.1` 解决的是控制面：

- 助手自身如何初始化
- 助手如何把事实层对象串起来
- 助手如何和用户沟通
- 助手如何触发后续动作

一句话：
`spec013` 负责“系统知道什么”，`spec013.1` 负责“系统怎么以助手的身份把这些东西说清楚并继续推动”。

## 2. 核心思路

### 2.1 为什么不能直接复用项目会话

项目会话的职责是：

- 开发
- 巡视
- 验证

控制会话的职责是：

- 汇总
- 解释
- 调度
- 续接

这两个对象的数据边界、提示词目标、工作目录、审计含义都不一样。

如果硬复用：

- 助手会失去全局视角
- 项目执行上下文会污染控制面
- provider 切换和历史管理会变得一塌糊涂

所以必须单独建 `ButlerControlSession`。

### 2.2 为什么必须有 `ButlerProfile`

“代码助手”的人格不是某个 provider 默认助手自带的，它必须显式配置。

用户需要手动定义：

- 用哪家 provider
- 用哪个工作目录
- 读哪份 `AGENTS.md`
- 说话风格是什么
- 汇报重点是什么
- 工作习惯和风险偏好是什么

这些都应该是平台正式模型，不能散落在前端本地状态里。

### 2.3 为什么必须先聚合，再对话

原始事实层对象很多：

- 项目
- 会话
- 记忆
- 巡视计划
- 巡视执行
- 验证执行

如果每次都把这些原始记录直接塞给控制会话，结果只有两个：

1. prompt 越来越大
2. 输出越来越乱

所以必须有 `ContextAggregator`，先生成：

- 全局摘要
- 项目摘要
- 会话摘要
- 风险与建议
- 可执行动作清单

然后再把这些分层结果喂给控制会话。

## 3. 总体架构

### 3.1 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `butler-profile-service` | 管理助手初始化配置 | 初始化请求、配置更新 | `ButlerProfile` |
| `butler-workspace-service` | 管理助手工作目录与指令文件 | `ButlerProfile` | 目录状态、`AGENTS.md` 状态 |
| `context-aggregator` | 聚合事实层上下文 | 项目/会话/记忆/巡视/验证数据 | `ButlerContextSnapshot` |
| `control-session-service` | 管理控制会话创建、续接、消息发送 | `ButlerProfile`、聚合上下文 | `ButlerControlSession` |
| `control-action-service` | 执行控制动作 | 控制动作请求 | 动作结果、审计事件 |
| `butler-chat-controller` | 暴露控制面 API | 前端请求 | API 响应 |

### 3.2 与现有模块的关系

- 继续复用 `ButlerProjectService`
- 继续复用 `ButlerSessionService`
- 继续复用 `ProjectMemoryService`
- 继续复用 `PatrolRunService` / `PatrolExecutionService`
- 继续复用 `VerificationRunService`
- 继续复用现有 `SessionLiveRuntimeService`

原则很简单：
控制面新增的是“调度与解释层”，不是再复制一套项目执行链路。

## 4. 数据结构

### 4.1 `ButlerProfile`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 档案 ID，固定单例也可 |
| `providerId` | `codex \| claude-code` | 是 | 当前控制会话使用的 provider |
| `workspacePath` | string | 是 | 助手独立工作目录 |
| `agentsMode` | `inline \| file` | 是 | 指令来源方式 |
| `agentsFilePath` | string | 否 | `AGENTS.md` 文件路径 |
| `agentsContent` | string | 否 | 初始化时保存的指令正文快照 |
| `persona` | object | 是 | 人格、说话方式、汇报偏好 |
| `focus` | object | 是 | 工作重点、关注项目范围、风险偏好 |
| `initializedAt` | string | 是 | 初始化时间 |
| `updatedAt` | string | 是 | 更新时间 |

说明：

- `workspacePath` 必须独立于项目仓库目录，避免控制会话直接落进某个项目上下文
- `AGENTS.md` 允许存路径，也允许落一份内容快照，避免后续路径变更时完全失忆

### 4.2 `ButlerControlSession`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 控制会话 ID |
| `providerId` | `codex \| claude-code` | 是 | 本会话对应 provider |
| `sessionId` | string | 是 | 真实 Host session ID |
| `status` | `idle \| running \| failed \| closed` | 是 | 控制会话状态 |
| `lastContextVersion` | string | 否 | 最近一次注入的上下文版本 |
| `lastSummary` | string | 否 | 最近一次控制会话摘要 |
| `createdAt` | string | 是 | 创建时间 |
| `updatedAt` | string | 是 | 更新时间 |

说明：

- `sessionId` 指向现有 Host 真实会话，这样前端 runtime 和消息链路可以复用
- `ButlerControlSession` 是控制层对象，不替代 `ButlerSession`

### 4.3 `ButlerContextSnapshot`

```ts
interface ButlerContextSnapshot {
  version: string
  generatedAt: string
  global: {
    projectCount: number
    activeProjectCount: number
    blockedProjectCount: number
    highRiskProjectCount: number
    topRisks: string[]
    nextActions: string[]
  }
  projects: ButlerProjectDigest[]
  sessions: ButlerSessionDigest[]
  memories: ButlerMemoryDigest[]
  patrols: ButlerPatrolDigest[]
  verifications: ButlerVerificationDigest[]
}
```

### 4.4 聚合层级

#### 第一层：事实层

- 原始项目记录
- 原始会话记录
- 原始记忆记录
- 原始巡视记录
- 原始验证记录

#### 第二层：摘要层

- 每个项目当前状态
- 每个项目最近关键动作
- 每个项目当前阻塞和风险
- 最近失败验证和异常巡视

#### 第三层：行动层

- 推荐优先处理的项目
- 推荐续接的会话
- 推荐发起的巡视
- 推荐发起的验证

控制会话默认只吃第二层和第三层；用户追问时再下钻到第一层。

## 5. API 设计

### 5.1 初始化与档案

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/butler/profile` | 读取当前助手档案 |
| `POST` | `/api/butler/profile/init` | 首次初始化助手档案 |
| `PATCH` | `/api/butler/profile` | 更新 provider、人格、工作重点等 |

初始化请求示意：

```json
{
  "providerId": "codex",
  "workspacePath": "/Users/jackson/WorkFile/butler",
  "agentsMode": "file",
  "agentsContent": "# AGENTS.md\n你是代码助手……",
  "persona": {
    "tone": "direct",
    "language": "zh-CN",
    "summaryStyle": "brief"
  },
  "focus": {
    "projectIds": [],
    "riskPreference": "conservative",
    "reportPriority": ["risk", "blocker", "verification"]
  }
}
```

### 5.2 控制会话

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/butler/control-session` | 读取当前 provider 对应的控制会话 |
| `POST` | `/api/butler/control-session/start` | 创建新的控制会话 |
| `POST` | `/api/butler/control-session/resume` | 续接控制会话 |
| `POST` | `/api/butler/control-session/messages` | 发送用户消息 |

设计要点：

- `start` 和 `resume` 都必须先检查 `ButlerProfile` 是否已初始化
- 创建控制会话时要把聚合上下文快照版本写入 `lastContextVersion`
- provider 切换后，不自动复用旧 provider 的控制会话

### 5.3 上下文与总览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/butler/overview` | 读取全局聚合总览 |
| `GET` | `/api/butler/context-snapshot` | 读取完整聚合快照 |
| `GET` | `/api/butler/projects/:projectId/context` | 读取单项目聚合上下文 |

### 5.4 控制动作

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/butler/actions/resume-session` | 续接某个项目会话 |
| `POST` | `/api/butler/actions/start-patrol` | 发起巡视 |
| `POST` | `/api/butler/actions/start-verification` | 发起验证 |
| `POST` | `/api/butler/actions/open-project` | 打开某个项目详情 |

说明：

- 第一阶段只允许安全控制动作
- 高风险写入动作继续留在 `spec013` 后续执行链路里

## 6. 控制会话启动流程

### 6.1 首次启动

1. 前端进入“助手”页
2. 若 `ButlerProfile` 不存在，则展示初始化表单
3. 用户提交初始化配置
4. 后端创建 `ButlerProfile`
5. 后端准备助手工作目录与 `AGENTS.md`
6. 后端聚合当前上下文
7. 后端启动 `ButlerControlSession`
8. 前端进入正式对话界面

### 6.2 正常对话

1. 前端发送用户消息
2. 后端读取最新 `ButlerContextSnapshot`
3. 若上下文版本变化明显，则在本轮消息前更新控制会话上下文
4. 后端调用真实 provider session 发送消息
5. 控制会话返回结果
6. 若结果包含控制动作请求，则走 `control-action-service`

### 6.3 provider 切换

1. 用户在前端切换 provider
2. 前端立即清空当前聊天视图状态
3. 前端重新查询新 provider 对应的控制会话
4. 若不存在，则要求重新启动控制会话
5. 旧 provider 控制会话不自动拼接到新会话里

## 7. 前端工作台设计

### 7.1 左侧导航

在桌面工作台左侧导航分段按钮中插入：

- `会话`
- `终端`
- `助手`
- `搜索`

约束：

- `助手` 必须位于“终端”和“搜索”之间
- 进入“助手”后，中间主区域不再显示普通会话页

### 7.2 助手页面结构

主区域分成两块：

1. 对话区
   - 显示控制会话消息
   - 复用现有消息时间线和输入框能力
2. 信息区
   - 项目
   - 会话
   - 记忆
   - 巡视
   - 验证

这不是后台管理页，而是“对话驱动的控制台”。

### 7.3 初始化态

首次进入时先展示初始化表单：

- provider 选择，只允许 `codex` / `claude-code`
- 助手工作目录
- `AGENTS.md` 内容
- 人格配置
- 汇报偏好
- 工作重点

未初始化时，不显示输入框发送消息。

### 7.4 provider 切换行为

前端规则必须非常死：

1. 切换 provider 后，立即清空当前对话视图
2. 清空的是当前前端显示状态，不删除历史控制会话记录
3. 新 provider 需要重新读取或重新创建控制会话

## 8. 审计与兼容

### 8.1 审计事件

至少记录：

- 助手初始化
- 助手配置变更
- 控制会话创建
- 控制会话续接
- 控制动作触发
- 控制动作结果

### 8.2 兼容策略

- 不进入“助手”页时，现有工作台行为不变
- 不初始化 `ButlerProfile` 时，现有 butler 项目接口仍可独立使用
- 控制会话失败时，不影响项目执行会话、巡视和验证主链路

## 9. MVP 拆分

### MVP-1：先让助手能被初始化并开口说话

- `ButlerProfile`
- `ButlerControlSession`
- 基础上下文聚合
- 前端“助手”页入口

### MVP-2：再让助手能解释全局状态并触发安全动作

- 全局与项目级聚合摘要
- 续接项目会话
- 发起巡视
- 发起验证

### MVP-3：最后再补更多动作和更强的上下文治理

- 更细粒度上下文版本控制
- 多项目优先级解释
- 更复杂的控制动作编排

别反过来做。

如果一开始就先做“前端聊天框”，最后只会得到一个漂亮的空壳。
