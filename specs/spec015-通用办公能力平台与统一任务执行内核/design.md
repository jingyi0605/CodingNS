# 设计文档 - spec015-通用办公能力平台与统一任务执行内核

状态：Draft

## 1. 概述

### 1.1 目标

- 给 `CodingNS` 增加平台级办公执行模型，而不是继续堆零散功能
- 用统一任务模型把浏览器、文档、运维和自动化收口
- 用统一连接器模型把底层资源访问收口
- 把 `Playwright + 真实 Chrome/Edge`、`doct` 模板、`SSH + 浏览器运维` 这些硬边界正式写进平台设计

### 1.2 覆盖需求

- `requirements.md` 需求 1：统一任务模型
- `requirements.md` 需求 2、3：浏览器执行内核与登录态隔离
- `requirements.md` 需求 4、5、6：专业文档内核与 `doct` 模板导出
- `requirements.md` 需求 7、8：受控运维、审批、审计、回滚、权限分级
- `requirements.md` 需求 9：重复事务自动化内核
- `requirements.md` 需求 10：统一资源连接器
- `requirements.md` 需求 11：Host API、CLI、助手能力面统一入口
- `requirements.md` 需求 12：零破坏接入

### 1.3 与前置 Spec 的关系

- `spec001.2`：规定后台任务必须进正式调度体系
- `spec001.2.1`：规定读写刷新和后台链路不要长私有定时器
- `spec004`：已有文件对象和文件预览基础
- `spec004.2`：已有文档编辑与导出基础，可作为文档内核前置参考
- `spec006`：已有终端执行基础
- `spec007`：已有进程与日志运行时基础
- `spec013.2`：已有助手统一能力面，可作为办公能力代理入口
- `spec013.3`：已有自动化和沙箱思路，可复用调度和任务边界

一句话：

这份 Spec 不是另起炉灶，而是把现有底座上升成“统一办公执行平台”。

## 2. 先把对象说死

### 2.1 平台真正的一等公民

这一轮不再把“浏览器动作”“SSH 命令”“导出文档”当孤立操作。

真正的一等公民应该是：

- `OfficeTask`
- `OfficeTaskStep`
- `OfficeArtifact`
- `OfficeApproval`
- `OfficeReceipt`
- `OfficeConnector`
- `BrowserProfile`
- `DocumentTemplate`
- `OpsTarget`

### 2.2 为什么必须先统一任务模型

因为浏览器、文档、运维、自动化四类能力，看起来差别大，实际上都在回答同一组问题：

1. 这件事是什么任务
2. 任务分几步
3. 每步做了什么
4. 产出了什么
5. 谁批准过
6. 失败在哪
7. 怎样补偿或回滚

如果这几件事不先统一，后面每个模块都会各写一套状态机。

### 2.3 为什么浏览器核心必须平台自管

`Codex` 和 `Claude Code` 自带浏览器能力可以有用，但它们适合做：

- 上层策略
- 辅助感知
- 人工接管
- 特定场景兜底

它们不适合做平台核心执行层。

原因很直接：

- 你要的是真实浏览器控制，不是“模型会点网页”
- 你要登录态、标签页、上传下载、失败重试、可回放
- 这些都属于正式执行层问题

所以核心必须是：

- `Playwright`
- 真实 `Chrome Stable`
- 真实 `Edge`
- 独立持久化 `Profile`
- 可选 `CDP` 高级接管

### 2.4 为什么文档必须模板先行

你已经把文档要求说得很清楚：

- 必须使用指定 `doct` 模板
- 样式必须是真实生产环境样式

这意味着：

- AI 只负责内容
- 模板才是样式真相源
- 任何绕过模板的“直接导出”都不算合格方案

### 2.5 为什么运维第一阶段只做 SSH + 浏览器

这是典型的好品味问题。

真正有价值的运维动作通常就两类：

1. 进机器执行命令
2. 登控制台页面做操作

先把这两类做好，远比先搞一个“全都支持”的大杂烩平台靠谱。

## 3. 总体结构

### 3.1 模块分层

| 层级 | 模块 | 职责 |
| --- | --- | --- |
| 平台对象层 | `office-task-service` | 管理任务、步骤、审批、产物、回执 |
| 连接器层 | `connector-registry` | 统一注册浏览器、文档、系统和外部资源连接器 |
| 浏览器层 | `browser-runtime-service` | 控制真实 Chrome/Edge、Profile、标签页、动作执行 |
| 文档层 | `document-runtime-service` | 管理文档对象、模板、修订、批注和导出 |
| 运维层 | `ops-runtime-service` | 管理 SSH 目标、浏览器运维目标、执行和回滚信息 |
| 自动化层 | `workflow-runtime-service` | 管理触发器、步骤编排、分支、重试、补偿和幂等 |
| 暴露层 | `office-capability-service` | 向 Host API、CLI、助手能力面暴露统一办公能力 |

### 3.2 总链路

统一链路如下：

1. 用户、CLI 或助手发起一个办公任务
2. 平台创建 `OfficeTask`
3. 平台按任务类型选择连接器和执行器
4. 每个执行阶段写入 `OfficeTaskStep`
5. 需要审批时进入 `pending_approval`
6. 成功或失败后回写任务状态
7. 截图、导出件、日志、回执写入 `OfficeArtifact` / `OfficeReceipt`

### 3.3 与现有模块的复用关系

| 现有模块 | 复用方式 |
| --- | --- |
| `TaskManager` | 承载自动化扫描、浏览器后台任务、导出任务、清理任务 |
| `TerminalService` | 作为 SSH 和本地命令的底层执行参考，不直接等于运维模型 |
| `WorkspaceService` | 管理任务相关工作区、附件、导出目录和资源落点 |
| `AssistantCapabilityService` | 提供 `/api/assistant/*` 风格的统一代理入口参考 |
| `AssistantAutomationService` | 复用调度经验，但升级成平台级工作流对象 |

## 4. 数据结构

### 4.1 `OfficeTask`

```ts
type OfficeTaskType =
  | "browser"
  | "document"
  | "ops"
  | "workflow";

type OfficeTaskStatus =
  | "draft"
  | "pending_approval"
  | "ready"
  | "running"
  | "paused"
  | "waiting_external"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "rolled_back";

interface OfficeTask {
  id: string
  userId: string
  workspaceId: string | null
  taskType: OfficeTaskType
  title: string
  description: string | null
  connectorId: string
  targetRefKind: string | null
  targetRefId: string | null
  inputJson: string
  status: OfficeTaskStatus
  riskLevel: "low" | "medium" | "high"
  approvalPolicyId: string | null
  currentStepId: string | null
  idempotencyKey: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}
```

说明：

- 所有办公动作统一落这里
- 不再让浏览器、文档、运维各自造主任务表

### 4.2 `OfficeTaskStep`

```ts
type OfficeTaskStepStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "waiting_external"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

interface OfficeTaskStep {
  id: string
  taskId: string
  stepSeq: number
  stepType: string
  title: string
  inputJson: string | null
  outputJson: string | null
  status: OfficeTaskStepStatus
  retryCount: number
  startedAt: string | null
  finishedAt: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}
```

说明：

- 任务回答“这件事是什么”
- 步骤回答“它到底怎么跑的”

### 4.3 `OfficeArtifact`

```ts
type OfficeArtifactKind =
  | "screenshot"
  | "ocr_result"
  | "document_export"
  | "command_log"
  | "downloaded_file"
  | "dom_snapshot"
  | "approval_record"
  | "custom";

interface OfficeArtifact {
  id: string
  taskId: string
  stepId: string | null
  kind: OfficeArtifactKind
  name: string
  storagePath: string | null
  contentType: string | null
  metadataJson: string | null
  createdAt: string
}
```

### 4.4 `OfficeApproval`

```ts
type OfficeApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

interface OfficeApproval {
  id: string
  taskId: string
  stepId: string | null
  policyId: string
  status: OfficeApprovalStatus
  approverUserId: string | null
  decisionNote: string | null
  decidedAt: string | null
  createdAt: string
  updatedAt: string
}
```

### 4.5 `BrowserProfile`

```ts
type BrowserEngine =
  | "chrome"
  | "edge";

type BrowserProfileMode =
  | "persistent"
  | "cdp_attached";

interface BrowserProfile {
  id: string
  userId: string
  workspaceId: string | null
  engine: BrowserEngine
  mode: BrowserProfileMode
  displayName: string
  userDataDir: string | null
  cdpEndpoint: string | null
  ownershipScope: "user" | "workspace" | "target"
  status: "active" | "locked" | "archived" | "error"
  createdAt: string
  updatedAt: string
}
```

### 4.6 `DocumentTemplate`

```ts
interface DocumentTemplate {
  id: string
  templateKey: string
  displayName: string
  engine: "doct"
  templateVersion: string
  schemaJson: string
  outputFormatsJson: string
  status: "active" | "deprecated"
  createdAt: string
  updatedAt: string
}
```

### 4.7 `DocumentRevision`

```ts
interface DocumentRevision {
  id: string
  documentId: string
  revisionSeq: number
  contentJson: string
  summary: string | null
  createdBy: string
  createdAt: string
}
```

### 4.8 `OpsTarget`

```ts
type OpsTargetKind =
  | "ssh_host"
  | "web_console";

interface OpsTarget {
  id: string
  userId: string
  kind: OpsTargetKind
  displayName: string
  environment: string | null
  configJson: string
  credentialRef: string | null
  status: "active" | "disabled" | "error"
  createdAt: string
  updatedAt: string
}
```

### 4.9 `OfficeConnector`

```ts
type OfficeConnectorKind =
  | "browser"
  | "document"
  | "ops"
  | "external";

interface OfficeConnector {
  id: string
  connectorKey: string
  kind: OfficeConnectorKind
  displayName: string
  capabilityJson: string
  status: "active" | "disabled"
  createdAt: string
  updatedAt: string
}
```

### 4.10 `OfficeAuditEvent`

```ts
type OfficeAuditEventKind =
  | "task_created"
  | "task_updated"
  | "task_started"
  | "task_finished"
  | "task_cancelled"
  | "task_approved"
  | "task_rejected"
  | "task_rolled_back"
  | "artifact_created"
  | "external_action"
  | "permission_denied";

interface OfficeAuditEvent {
  id: string
  taskId: string | null
  stepId: string | null
  eventKind: OfficeAuditEventKind
  actorKind: "user" | "system" | "assistant" | "connector"
  actorId: string | null
  summary: string
  payloadJson: string | null
  createdAt: string
}
```

说明：

- 审计事件是“发生过什么”的权威记录
- 不是日志全文，也不是产物替身

### 4.11 `OfficeRollbackRecord`

```ts
type OfficeRollbackStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

interface OfficeRollbackRecord {
  id: string
  taskId: string
  stepId: string | null
  status: OfficeRollbackStatus
  reason: string
  compensationJson: string | null
  summary: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}
```

说明：

- 回滚记录是“怎么撤回”的权威记录
- 不能只在日志里写一句“已回滚”，那不算正式回滚

## 5. 浏览器执行内核设计

### 5.1 选型结论

正式结论直接写死：

- 核心引擎：`Playwright`
- 浏览器目标：真实 `Google Chrome Stable`、真实 `Microsoft Edge`
- 默认模式：独立持久化 `Profile`
- 高级模式：`CDP` 接管运行中的浏览器
- 插件角色：桥接和人工接管，不做核心执行

### 5.2 核心模块

| 模块 | 职责 |
| --- | --- |
| `browser-profile-service` | 创建、锁定、回收浏览器 Profile |
| `browser-session-service` | 管理浏览器会话和上下文 |
| `browser-tab-service` | 管理标签页、导航、切换和关闭 |
| `browser-action-service` | 点击、输入、上传、下载、截图、DOM 读取 |
| `browser-artifact-service` | 保存截图、OCR 结果、DOM 快照、下载文件 |
| `browser-bridge-service` | 对接插件桥接和人工接管动作 |

### 5.3 关键流程

#### 5.3.1 默认浏览器任务

1. 创建或选择独立 `BrowserProfile`
2. 启动真实 `Chrome/Edge`
3. 建立 `BrowserContext`
4. 打开标签页并执行动作
5. 记录步骤、快照和产物
6. 成功或失败后关闭或保留会话

#### 5.3.2 高级 `CDP` 接管

1. 用户显式授权接管运行中的浏览器
2. 平台连接指定 `CDP endpoint`
3. 标记该会话为“非稳定上下文”
4. 只允许在受控模式下继续执行
5. 保留特殊审计字段

### 5.4 OCR 处理

- OCR 不直接塞进浏览器步骤输出
- OCR 结果单独作为 `OfficeArtifact(kind="ocr_result")`
- 与截图产物建立引用关系

## 6. 文档内核设计

### 6.1 总体原则

- 文档内容和文档样式分离
- `doct` 模板是最终交付样式真相源
- AI 只负责内容草拟、修订建议、摘要和引用整理

### 6.2 核心模块

| 模块 | 职责 |
| --- | --- |
| `document-service` | 创建、读取、更新文档对象 |
| `document-outline-service` | 维护大纲和结构层级 |
| `document-template-service` | 管理 `doct` 模板和字段映射 |
| `document-citation-service` | 管理引用来源和引用位置 |
| `document-comment-service` | 管理批注和评论 |
| `document-export-service` | 输出 `docx/pdf/md` |

### 6.2.1 模板服务到底管什么

`document-template-service` 不是一个“存个模板名就算完”的空壳。

它至少要管这些事：

- 注册模板
- 读取模板版本
- 校验模板 schema
- 维护字段映射
- 标记模板可用状态
- 给导出服务提供模板输入约束

### 6.2.2 导出服务到底管什么

`document-export-service` 也不是简单把内容丢给渲染器。

它至少要管这些事：

- 读取文档最新修订
- 读取大纲、引用和批注
- 校验模板字段是否齐
- 组装模板输入
- 调用 `doct` 渲染
- 记录导出结果、模板版本和失败原因

### 6.2.3 模板输入输出必须能追踪

每一次正式导出都要留下可追踪信息：

- 用了哪个模板
- 用了哪个模板版本
- 输入内容来自哪个文档修订
- 导出了哪些格式
- 输出文件落在哪
- 如果失败，卡在哪一步

### 6.3 关键流程

#### 6.3.1 正式导出

1. 读取文档结构化内容
2. 校验是否满足所选 `doct` 模板字段要求
3. 渲染模板
4. 导出 `docx/pdf/md`
5. 记录模板版本和导出产物

#### 6.3.2 导出失败怎么处理

以下情况都应该直接失败并返回明确错误：

- 模板不存在
- 模板已废弃
- 模板 schema 校验不通过
- 文档缺少必填字段
- 引用来源缺失
- 批注锚点失效
- 输出格式不在模板支持范围

失败后必须保留：

- 失败步骤
- 失败原因
- 关联文档版本
- 关联模板版本

### 6.4 为什么不能直接用 Markdown 冒充正式文档

因为你要求的是：

- 指定模板
- 真实生产样式
- 可交付产物

这就决定了 Markdown 只能作为内容载体或中间格式，不是最终样式权威源。

### 6.5 为什么必须有模板注册表

没有模板注册表，后面一定会出现这些烂事：

- 模板名字到处乱写
- 同一个模板不同版本互相覆盖
- 导出时不知道该用哪个字段映射
- 失败后没法回溯到底是哪版模板坏了

所以模板必须是正式对象，不是配置字符串。

## 7. 运维内核设计

### 7.1 核心范围

第一阶段只做两类运维动作：

1. `SSH`
2. 浏览器运维

### 7.2 核心模块

| 模块 | 职责 |
| --- | --- |
| `ops-target-service` | 管理 SSH 主机和 Web 控制台目标 |
| `ops-credential-service` | 管理密钥、凭据引用和授权关系 |
| `ssh-run-service` | 执行参数化 SSH 命令 |
| `ops-browser-run-service` | 通过浏览器执行控制台运维动作 |
| `ops-approval-service` | 处理高风险审批 |
| `ops-audit-service` | 记录运维审计与回滚信息 |

### 7.2.1 SSH 运维要先管什么

SSH 这边先把下面几件事管住：

- 运维目标
- 凭据引用
- 命令模板
- 风险判断
- 审批入口
- 审计记录
- 回滚记录

如果这几项没管住，SSH 运维就只是危险脚本。

### 7.3 关键流程

#### 7.3.1 SSH 运维

1. 选择 `OpsTarget(kind="ssh_host")`
2. 校验权限和审批策略
3. 创建任务和步骤
4. 执行命令并记录输出摘要
5. 保存日志和回执

#### 7.3.1.1 SSH 运维执行前必须检查什么

执行前至少要检查：

- 目标是否有效
- 凭据引用是否存在
- 调用者是否有权限
- 命令是否触发高风险策略
- 是否需要审批

#### 7.3.1.2 SSH 运维失败后必须留下什么

失败后至少要留下：

- 失败的任务步骤
- 命令摘要
- 退出码
- 错误摘要
- 审计事件
- 如果有补偿，则要有回滚记录

#### 7.3.2 浏览器运维

1. 选择 `OpsTarget(kind="web_console")`
2. 绑定浏览器 `Profile`
3. 登录控制台并执行动作
4. 记录截图、页面证据和结果

#### 7.3.2.1 浏览器运维先管什么

浏览器运维先管这几件事：

- 控制台目标
- 浏览器 Profile
- 登录态
- 页面证据
- 操作步骤
- 失败回退

#### 7.3.2.2 浏览器运维不该做什么

浏览器运维不该直接变成一个“万能网页自动化”入口。

它要严格绑定：

- 运维目标
- 风险策略
- 审批记录
- 审计记录

## 8. 自动化内核设计

### 8.1 核心思路

这里不重复发明一套和 `spec013.3` 完全割裂的调度系统，而是把自动化正式升级成平台级工作流对象。

### 8.2 核心模块

| 模块 | 职责 |
| --- | --- |
| `workflow-definition-service` | 定义流程、触发器和步骤 |
| `workflow-run-service` | 管理一次真实运行 |
| `workflow-trigger-service` | 定时、事件、手动触发 |
| `workflow-branch-service` | 条件分支判断 |
| `workflow-retry-service` | 重试和恢复 |
| `workflow-compensation-service` | 失败补偿和回滚编排 |

### 8.3 正式触发器

- `manual`
- `once`
- `interval`
- `cron`
- `event`
- `condition`

### 8.4 幂等与补偿

- 每个流程运行支持 `idempotencyKey`
- 高风险步骤必须支持明确补偿动作或标注不可补偿
- 补偿本身也必须进入任务步骤记录

## 9. 连接器模型设计

### 9.1 统一接口

所有连接器必须至少提供下面这些能力：

- `describeCapabilities`
- `authorize`
- `connect`
- `execute`
- `listArtifacts`
- `subscribe`
- `disconnect`

### 9.2 第一批连接器

- `browser.playwright`
- `document.doct`
- `ops.ssh`
- `ops.browser_console`
- `file.workspace`
- `external.channel`

### 9.3 为什么必须做连接器注册表

因为未来你一定还会接：

- 邮件
- 表格
- 工单系统
- 企业 IM
- 知识库

没有注册表，后面每次新增能力都会把平台再撕开一次。

## 10. API 与入口设计

### 10.1 Host API

建议统一新增：

- `/api/office/tasks`
- `/api/office/tasks/:taskId`
- `/api/office/tasks/:taskId/steps`
- `/api/office/tasks/:taskId/artifacts`
- `/api/office/browser/*`
- `/api/office/documents/*`
- `/api/office/ops/*`
- `/api/office/workflows/*`
- `/api/office/connectors/*`

### 10.2 CLI

建议统一新增：

- `codingns office task ...`
- `codingns office browser ...`
- `codingns office doc ...`
- `codingns office ops ...`
- `codingns office workflow ...`
- `codingns office connector ...`

### 10.3 助手能力面

Butler 或其他助手运行时不应该绕过平台对象直接碰底层服务。

正确做法：

- 优先调用统一办公能力面
- 必要时再由办公能力面下钻到底层执行器

## 11. 状态流转

### 11.1 任务状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `draft` | 草稿态 | 刚创建 | 提交执行或删除 |
| `pending_approval` | 待审批 | 命中高风险策略 | 审批通过、拒绝或取消 |
| `ready` | 可执行 | 已准备完成 | 开始运行 |
| `running` | 运行中 | 开始执行 | 成功、失败、暂停或等待外部 |
| `paused` | 暂停 | 用户或系统暂停 | 恢复或取消 |
| `waiting_external` | 等待外部 | 等待下载、登录、回调、事件 | 继续运行、失败或取消 |
| `succeeded` | 成功 | 全部步骤成功 | 终态 |
| `failed` | 失败 | 某一步失败且无法恢复 | 终态或回滚 |
| `cancelled` | 已取消 | 用户或系统取消 | 终态 |
| `rolled_back` | 已回滚 | 失败后补偿完成 | 终态 |

### 11.2 权限分级原则

1. 低风险任务可以直接执行，但仍然要留任务和审计记录
2. 中风险任务默认进入受控执行，必要时允许人工确认
3. 高风险任务必须走审批
4. 运行中浏览器接管、SSH 破坏性命令、外部系统关键操作默认按高风险处理
5. 权限判断先看任务风险等级，再看执行者角色和目标对象

## 12. 风险与待确认项

### 12.1 风险

- `doct` 模板实际渲染链路如果过于封闭，可能需要单独桥接服务
- 浏览器 `CDP` 接管运行中用户浏览器的可预测性差，必须强提示
- SSH 凭据、审批和回滚如果做得太轻，会把平台直接做成高风险后门

### 12.2 待确认项

- `doct` 模板当前真实输入输出接口和运行环境
- 浏览器插件桥接第一阶段到底要承担哪些动作
- 权限分级要按账号、工作区还是组织层级收口

## 13. 验证策略

### 13.1 单元测试

- 任务状态流转
- 浏览器 Profile 选择与锁定
- 文档模板字段校验
- SSH 风险级别判断
- 连接器能力声明解析

### 13.2 集成测试

- 浏览器真实任务链路
- 文档从结构化内容到模板导出链路
- SSH 执行、审批、日志留存链路
- 自动化从触发到补偿链路

### 13.3 端到端验证

- 通过助手创建浏览器任务并产出截图
- 通过模板产出正式 `docx/pdf`
- 通过 SSH 或浏览器运维完成一次受控操作
- 自动化定时执行并生成任务产物
