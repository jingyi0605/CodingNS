# 设计文档 - spec005-Git上下文与提交规则引擎

状态：Draft

## 1. 概述

### 1.1 目标

- 在工作区内提供完整的 Git 上下文能力，覆盖状态、diff、暂存、提交、分支、历史、远程同步
- 把提交信息做成“规则先于生成”的流程，AI 只负责草稿，不负责最终决策
- 确保所有 Git 能力默认受鉴权保护，并严格绑定工作区仓库边界
- 为 `spec009` 的移动端轻量 Git 操作提供稳定后端能力

### 1.2 覆盖需求

- `requirements.md` 需求 1：Git 能力必须绑定工作区并默认受鉴权保护
- `requirements.md` 需求 2：必须提供完整的 Git 上下文读能力
- `requirements.md` 需求 3：暂存与提交流程必须可控
- `requirements.md` 需求 4：分支与历史能力必须可用
- `requirements.md` 需求 5：远程同步能力必须明确边界
- `requirements.md` 需求 6：提交规则必须“规则先于生成”
- `requirements.md` 需求 7：AI 生成提交信息后必须二次校验
- `requirements.md` 需求 8：提交规则引擎至少支持基础规范项

### 1.3 技术约束

- 后端：`Node.js 22 + TypeScript + Fastify + ws`
- 数据存储：`SQLite（better-sqlite3）` 仅存配置、规则、偏好、缓存索引
- Git 执行：调用系统 `git` CLI，不自行实现 Git 协议
- 认证：沿用 `spec001` 的登录态与令牌机制
- 前端：沿用 `spec003` 的会话主界面与能力门控，不在本 Spec 重复定义 UI 主框架

## 2. 架构

### 2.1 系统结构

Git 上下文能力拆成四层：

1. 接口层：受保护 API，统一参数校验和错误码
2. 领域层：Git 读写服务、规则引擎、提交编排器
3. 执行层：Git 命令执行器、工作区边界校验器
4. 持久层：规则配置、提交模板、用户偏好存储

核心原则：

- 先校验登录态和工作区边界，再执行 Git 命令
- 先走规则校验，再允许生成或提交
- AI 草稿永远不能直接落 commit，必须过二次校验

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `git-context-controller` | 暴露 Git 相关受保护 API | HTTP 请求 + 令牌 | 结构化 Git 响应 |
| `workspace-repo-guard` | 校验工作区与仓库根目录边界 | workspaceId + path | 通过/拒绝 |
| `git-read-service` | 状态、diff、分支、历史读取 | workspaceId + 查询参数 | Git 上下文快照 |
| `git-write-service` | 暂存、提交、分支切换、远程同步 | 操作命令 + 参数 | 操作结果 |
| `commit-rule-engine` | 提交规则解析与校验 | CommitDraft + RuleProfile | 校验结果 |
| `commit-orchestrator` | 提交流程编排（规则、AI、二次校验） | 变更集 + 草稿请求 | 可提交结果或失败原因 |
| `git-command-runner` | 安全执行 git 子命令并收集输出 | 仓库路径 + 子命令 | stdout/stderr/exitCode |
| `git-rule-repository` | 持久化规则配置和模板 | RuleProfile | 存储结果 |

### 2.3 关键流程

#### 2.3.1 Git 状态与 diff 查询流程

1. 客户端调用受保护 API（携带令牌）
2. 系统校验工作区与仓库边界
3. `git-read-service` 调用 `git status --porcelain`、`git diff` 等命令
4. 结构化返回 `GitRepoSnapshot` 和 `GitChangeItem` 列表

#### 2.3.2 提交主流程（规则先于生成）

1. 客户端请求提交能力，系统先读取 `CommitRuleProfile`
2. 若用户触发 AI 草稿，系统生成 `CommitDraft`（候选文本）
3. `commit-rule-engine` 执行第一次校验，返回违规明细
4. 用户修正后提交，系统执行第二次校验
5. 二次校验通过才执行 `git commit`
6. 成功后刷新状态、历史、ahead/behind 信息

#### 2.3.3 远程同步流程

1. 客户端触发 `fetch / pull / push / publish`
2. 系统校验仓库边界和当前分支状态
3. 执行对应 Git 命令并解析关键输出
4. 返回结果摘要并刷新同步状态

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7、8

- `GitContextController`：统一受保护 API 入口
- `GitReadService`：仓库读取能力聚合
- `GitWriteService`：写操作封装与幂等防护
- `CommitRuleEngine`：规则解析与违规项输出
- `CommitOrchestrator`：提交编排器，保证“规则先于生成”
- `GitCommandRunner`：命令执行与错误映射

### 3.2 数据结构

覆盖需求：2、3、4、5、6、7、8

#### 3.2.1 `GitRepoSnapshot`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `workspaceId` | string | 是 | 工作区 ID | 受保护上下文 |
| `repoRoot` | string | 是 | 仓库根目录 | 必须在工作区内 |
| `branch` | string | 是 | 当前分支 | 非空 |
| `ahead` | number | 是 | 本地超前提交数 | >= 0 |
| `behind` | number | 是 | 本地落后提交数 | >= 0 |
| `isDirty` | boolean | 是 | 是否有未提交变更 | 布尔 |
| `lastFetchedAt` | string | 否 | 最近 fetch 时间 | ISO8601 |

#### 3.2.2 `GitChangeItem`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `path` | string | 是 | 文件相对路径 | 必须在 repoRoot 内 |
| `status` | string | 是 | 变更状态 | `A/M/D/R/U` 等 |
| `staged` | boolean | 是 | 是否已暂存 | 布尔 |
| `oldPath` | string | 否 | 重命名前旧路径 | 可空 |
| `binary` | boolean | 是 | 是否二进制变更 | 布尔 |

#### 3.2.3 `CommitRuleProfile`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 规则配置 ID | 唯一 |
| `workspaceId` | string | 是 | 绑定工作区 | 外键 |
| `name` | string | 是 | 规则名称 | 非空 |
| `subjectPattern` | string | 是 | 标题格式规则 | 默认支持 `type(scope): subject` |
| `maxSubjectLength` | number | 是 | 标题最大长度 | > 0 |
| `language` | string | 否 | 标题语言约束 | `zh/en/any` |
| `requireBody` | boolean | 是 | 是否强制 body | 布尔 |
| `requireIssue` | boolean | 是 | 是否强制 issue 编号 | 布尔 |
| `issuePattern` | string | 否 | issue 规则 | 正则 |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

#### 3.2.4 `CommitDraft`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `subject` | string | 是 | 提交标题 | 非空 |
| `body` | string | 否 | 提交正文 | 可空 |
| `footer` | string | 否 | 脚注（issue 等） | 可空 |
| `source` | string | 是 | 草稿来源 | `manual/ai` |

#### 3.2.5 `CommitValidationResult`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `passed` | boolean | 是 | 是否通过 | 布尔 |
| `errors` | array | 是 | 失败项列表 | 可空数组 |
| `warnings` | array | 是 | 警告项列表 | 可空数组 |
| `normalizedDraft` | object | 否 | 规范化草稿 | 可空 |

### 3.3 接口契约

覆盖需求：1、2、3、4、5、6、7、8

说明：以下接口默认都是 `Protected API`，必须登录后访问。

#### 3.3.1 `GET /api/git/status`

- 类型：HTTP
- 输入：`workspaceId`
- 输出：`GitRepoSnapshot` + `GitChangeItem[]`
- 校验：工作区存在且为 Git 仓库
- 错误：`UNAUTHORIZED`、`WORKSPACE_NOT_FOUND`、`GIT_REPO_NOT_FOUND`

#### 3.3.2 `GET /api/git/diff`

- 类型：HTTP
- 输入：`workspaceId`、`path`、`staged`
- 输出：文件 diff 内容
- 校验：`path` 必须在仓库内
- 错误：`UNAUTHORIZED`、`PATH_OUT_OF_WORKSPACE`、`GIT_DIFF_FAILED`

#### 3.3.3 `POST /api/git/stage`

- 类型：HTTP
- 输入：`workspaceId`、`targets[]`
- 输出：最新变更摘要
- 校验：目标文件路径有效
- 错误：`UNAUTHORIZED`、`INVALID_TARGET`、`GIT_STAGE_FAILED`

#### 3.3.4 `POST /api/git/unstage`

- 类型：HTTP
- 输入：`workspaceId`、`targets[]`
- 输出：最新变更摘要
- 校验：目标必须已暂存
- 错误：`UNAUTHORIZED`、`NOT_STAGED`、`GIT_UNSTAGE_FAILED`

#### 3.3.5 `POST /api/git/commit/draft`

- 类型：HTTP
- 输入：`workspaceId`、`mode(manual|ai)`、可选上下文
- 输出：`CommitDraft`
- 校验：`mode=ai` 时仅生成草稿，不执行提交
- 错误：`UNAUTHORIZED`、`AI_DRAFT_FAILED`

#### 3.3.6 `POST /api/git/commit/validate`

- 类型：HTTP
- 输入：`workspaceId`、`CommitDraft`
- 输出：`CommitValidationResult`
- 校验：必须加载规则配置并执行
- 错误：`UNAUTHORIZED`、`RULE_PROFILE_NOT_FOUND`

#### 3.3.7 `POST /api/git/commit`

- 类型：HTTP
- 输入：`workspaceId`、`CommitDraft`
- 输出：`commitHash`、最新状态摘要
- 校验：提交前必须通过二次校验
- 错误：`UNAUTHORIZED`、`COMMIT_VALIDATION_FAILED`、`GIT_COMMIT_FAILED`

#### 3.3.8 `GET /api/git/branches` 与 `POST /api/git/branches/switch`

- 类型：HTTP
- 输入：`workspaceId`、`branchName`
- 输出：分支列表/切换结果
- 校验：目标分支存在或可创建
- 错误：`UNAUTHORIZED`、`BRANCH_NOT_FOUND`、`GIT_BRANCH_FAILED`

#### 3.3.9 `GET /api/git/history`

- 类型：HTTP
- 输入：`workspaceId`、`cursor`、`limit`
- 输出：提交历史分页
- 校验：分页参数合法
- 错误：`UNAUTHORIZED`、`INVALID_CURSOR`

#### 3.3.10 `POST /api/git/remote/sync`

- 类型：HTTP
- 输入：`workspaceId`、`action(fetch|pull|push|publish)`
- 输出：同步结果摘要
- 校验：动作类型与仓库状态匹配
- 错误：`UNAUTHORIZED`、`GIT_REMOTE_AUTH_FAILED`、`GIT_REMOTE_FAILED`

## 4. 数据与状态模型

### 4.1 数据关系

- 一个 `Workspace` 对应一个主要 `GitRepository` 上下文
- 一个 `Workspace` 可绑定一个默认 `CommitRuleProfile`
- `CommitDraft` 是临时对象，不作为提交真相
- `CommitValidationResult` 依赖 `CommitRuleProfile` 与 `CommitDraft`

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `IDLE` | 空闲 | 打开 Git 面板 | 拉取状态 |
| `LOADING` | 读取 Git 上下文中 | 请求状态/历史/diff | 成功或失败 |
| `READY` | 可操作 | 状态加载完成 | 进入写操作 |
| `VALIDATING` | 提交规则校验中 | 触发校验 | 通过或失败 |
| `COMMITTING` | 提交执行中 | 校验通过并提交 | 成功或失败 |
| `SYNCING` | 远程同步中 | 触发 fetch/pull/push | 成功或失败 |
| `ERROR` | 错误态 | 任一关键步骤失败 | 用户重试或刷新 |

## 5. 错误处理

### 5.1 错误类型

- `鉴权错误`：未登录、令牌失效、无权限访问
- `边界错误`：路径越界、非工作区仓库、非法目标文件
- `规则错误`：提交信息不满足规则
- `Git 执行错误`：git 命令返回非零退出码
- `远程错误`：远程认证失败、网络失败、冲突失败

### 5.2 错误响应格式

```json
{
  "detail": "提交标题不符合规则：必须是 type(scope): subject",
  "error_code": "COMMIT_VALIDATION_FAILED",
  "field": "subject",
  "timestamp": "2026-03-22T12:00:00Z"
}
```

### 5.3 处理策略

1. 输入验证错误：直接拒绝请求，返回字段级错误
2. 业务规则错误：返回所有违规项，允许用户继续编辑
3. 外部依赖错误：保留 Git 原始 stderr 摘要，映射为稳定错误码
4. 重试策略：远程同步失败允许手工重试，不自动重复危险写操作

## 6. 正确性属性

### 6.1 属性 1：规则先于生成

*对于任何* 提交请求，系统都应该满足：未通过 `CommitRuleProfile` 校验则不得执行 `git commit`。

**验证需求：** 需求 6、需求 7、需求 8

### 6.2 属性 2：工作区边界不可越过

*对于任何* Git 文件操作请求，系统都应该满足：操作目标必须位于目标工作区仓库根目录内。

**验证需求：** 需求 1、需求 2、需求 3

### 6.3 属性 3：受保护接口默认鉴权

*对于任何* Git API 调用，系统都应该满足：无有效登录态时请求必须失败。

**验证需求：** 需求 1、需求 5

## 7. 测试策略

### 7.1 单元测试

- 规则引擎：格式、长度、语言、issue、body 规则校验
- 边界校验：工作区路径和仓库路径校验
- 错误映射：Git stderr 到业务错误码映射

### 7.2 集成测试

- 状态/diff/暂存/提交主链路
- 分支切换与历史分页
- 远程同步成功和失败路径
- AI 草稿生成后的二次校验流程

### 7.3 端到端测试

- 从变更查看到提交再到推送完整回放
- 未登录访问 Git 能力被拒绝
- 规则失败后修正再提交成功

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.1、§3.3 | 鉴权与路径边界集成测试 |
| `requirements.md` 需求 2、3、4、5 | `design.md` §2.3、§3.3 | Git 主链路集成与 E2E |
| `requirements.md` 需求 6、7、8 | `design.md` §2.3.2、§3.2、§6.1 | 规则引擎单测 + 提交流程回放 |

## 8. 风险与待确认项

### 8.1 风险

- 不同仓库规模下 `git diff` 输出过大，可能影响交互性能
- 规则配置过于复杂时，用户学习成本增加
- AI 草稿质量波动导致频繁手工修正

### 8.2 待确认项

- 规则配置是否允许“项目继承 + 工作区覆盖”双层模型
- 远程同步的确认步骤是否需要按操作类型细分（push/publish）
