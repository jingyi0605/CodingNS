# 需求文档 - spec005-Git上下文与提交规则引擎

状态：Draft

## 简介

这个 Spec 解决的是一个非常实际的问题：  
现在很多“Git 面板”只能点几个按钮，看起来能用，实际提交流程是失控的。

我们要把 Git 做成可约束、可验证、可追责的工作区上下文能力，而不是“AI 随便凑一句提交信息”。

这个 Spec 做完后，至少要稳定做到：

- 在工作区内完整查看和操作 Git 状态
- 支持 diff、暂存、提交、分支、历史、远程同步
- 提交信息必须先过规则，再允许提交
- AI 生成只是候选草稿，必须经过二次校验
- 全部 Git 能力默认受鉴权保护

## 术语表

- **System**：`CodingNS Host + 客户端` 的 Git 上下文能力集合
- **Workspace（工作区）**：被 System 管理的项目目录，所有 Git 操作必须绑定它
- **GitChangeSet（变更集合）**：当前工作区中可提交的文件变更集合
- **CommitRuleProfile（提交规则配置）**：提交信息规则配置，如格式、长度、语言、必填字段
- **CommitDraft（提交草稿）**：AI 或手工生成的提交信息候选内容
- **CommitValidation（提交校验）**：对提交草稿执行规则检查并返回通过/失败明细
- **Protected API（受保护接口）**：必须携带登录态令牌才能访问的接口

## 范围说明

### In Scope

- Git 状态、diff、暂存、取消暂存、提交、分支、历史
- 远程同步能力（fetch / pull / push / publish）
- 提交规则模板与规则引擎
- AI 生成提交草稿与二次规则校验
- 工作区边界校验、仓库边界校验、统一鉴权保护

### Out of Scope

- 代码评审平台能力（评论流、审批流、Review UI）
- 企业级审计系统（合规审计、审批留痕系统）
- 托管 Git 平台替代品（不做 GitHub/GitLab 站点）

## 需求

### 需求 1：Git 能力必须绑定工作区并默认受鉴权保护

**用户故事：** 作为系统管理员，我希望所有 Git 操作都在登录态和工作区边界内执行，以便避免越权访问或误操作其他仓库。

#### 验收标准

1. WHEN 客户端访问任意 Git API 且未携带有效令牌 THEN System SHALL 返回未授权错误。
2. WHEN Git 请求中的路径不属于目标工作区仓库根目录 THEN System SHALL 拒绝执行并返回边界错误。
3. WHEN 初始化完成后新增 Git 接口 THEN System SHALL 默认归类为受保护接口。

### 需求 2：必须提供完整的 Git 上下文读能力

**用户故事：** 作为开发者，我希望在同一工作区里看到可操作的 Git 全景信息，以便快速判断当前应该提交什么。

#### 验收标准

1. WHEN 用户进入 Git 面板 THEN System SHALL 返回状态、变更集合、分支、最近提交历史。
2. WHEN 用户打开文件变更详情 THEN System SHALL 返回可读的 diff 内容和文件级状态。
3. WHEN 工作区不是 Git 仓库 THEN System SHALL 给出明确提示，而不是空白或误报成功。

### 需求 3：暂存与提交流程必须可控

**用户故事：** 作为开发者，我希望暂存、取消暂存、提交操作有清晰反馈，以便提交过程可预测可回放。

#### 验收标准

1. WHEN 用户执行暂存或取消暂存 THEN System SHALL 精确作用到目标文件或目标变更块，并返回最新状态。
2. WHEN 用户提交时暂存区为空 THEN System SHALL 拒绝提交并返回可读原因。
3. WHEN 提交成功 THEN System SHALL 返回提交哈希并刷新状态与历史。

### 需求 4：分支与历史能力必须可用

**用户故事：** 作为开发者，我希望直接在工作台完成常见分支和历史操作，以便减少来回切终端。

#### 验收标准

1. WHEN 用户查看分支 THEN System SHALL 返回当前分支、本地分支、远程分支及跟踪关系。
2. WHEN 用户创建或切换分支 THEN System SHALL 执行结果可追踪并刷新分支状态。
3. WHEN 用户查看提交历史 THEN System SHALL 返回按时间排序的提交记录并支持分页。

### 需求 5：远程同步能力必须明确边界

**用户故事：** 作为开发者，我希望能在工作台执行 fetch/pull/push/publish，以便完成完整提交流程。

#### 验收标准

1. WHEN 用户执行远程同步操作 THEN System SHALL 返回明确的成功/失败结果和关键输出摘要。
2. WHEN 远程认证失败或网络失败 THEN System SHALL 返回可读错误并保留本地状态不被污染。
3. WHEN 推送前存在明显冲突风险 THEN System SHALL 提供阻断提示或确认步骤。

### 需求 6：提交规则必须“规则先于生成”

**用户故事：** 作为团队维护者，我希望提交信息先符合规则再提交，以便保持仓库历史可读且稳定。

#### 验收标准

1. WHEN 用户打开提交操作 THEN System SHALL 先加载并应用 `CommitRuleProfile`。
2. WHEN 提交草稿不符合规则 THEN System SHALL 阻止提交并返回逐条违规项。
3. WHEN 未配置 AI 生成功能 THEN System SHALL 仍可通过规则引擎完成手工提交流程。

### 需求 7：AI 生成提交信息后必须二次校验

**用户故事：** 作为开发者，我希望 AI 帮我起草提交信息，但最终必须经过规则校验，以便避免“看起来像话但不合规”的提交。

#### 验收标准

1. WHEN 用户触发 AI 生成提交草稿 THEN System SHALL 返回可编辑草稿而不是直接提交。
2. WHEN 用户修改或确认草稿 THEN System SHALL 再次执行规则校验后才允许提交。
3. WHEN 二次校验失败 THEN System SHALL 返回具体修正建议并保持可编辑状态。

### 需求 8：提交规则引擎至少支持基础规范项

**用户故事：** 作为团队负责人，我希望规则不是摆设，以便真正约束提交质量。

#### 验收标准

1. WHEN 规则配置启用格式校验 THEN System SHALL 检查 `type(scope): subject`。
2. WHEN 规则配置启用长度与语言校验 THEN System SHALL 检查标题最大长度和中英文要求。
3. WHEN 规则配置启用扩展项 THEN System SHALL 检查 body、issue 编号等必填字段。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 用户请求 Git 状态和变更摘要 THEN System SHALL 在常规仓库规模下 2 秒内返回。
2. WHEN 用户查看单文件 diff THEN System SHALL 在可接受时间内返回结果，不阻塞核心交互。

### 非功能需求 2：可靠性

1. WHEN Git 子命令执行失败 THEN System SHALL 返回结构化错误，不吞异常。
2. WHEN 远程同步中断 THEN System SHALL 保持本地仓库状态可恢复，不写入伪成功状态。

### 非功能需求 3：可维护性

1. WHEN 团队新增提交规则项 THEN System SHALL 通过规则插件或配置扩展，不改动核心提交流程。
2. WHEN 线上排查提交失败 THEN System SHALL 能定位到“鉴权失败 / 仓库边界失败 / 规则失败 / Git 命令失败”。

### 非功能需求 4：安全性

1. WHEN 调用 Git 相关 HTTP API THEN System SHALL 强制登录态鉴权。
2. WHEN 通过 WebSocket 接收 Git 状态更新 THEN System SHALL 在握手阶段完成令牌校验。

## 成功定义

- 用户可以在工作区内完成完整 Git 主链路：状态 -> diff -> 暂存 -> 规则校验 -> 提交 -> 推送。
- 提交规则成为强约束，不再依赖“人工自觉”。
- AI 生成只作为草稿入口，最终提交必须通过二次校验。
- 所有 Git 能力默认受鉴权保护，且不越过工作区边界。
