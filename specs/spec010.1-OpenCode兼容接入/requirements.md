# 需求文档 - spec010.1-OpenCode兼容接入

状态：Draft

## 简介

这个 Spec 解决的是 `OpenCode` 接入时最容易踩的坑。

现在项目嘴上已经有“provider 扩展框架”，但真实代码里还有不少地方只按 `Claude Code` 和 `Codex` 两家来写。
如果这时候把 OpenCode 硬塞进去，最后大概率会出现三种垃圾结果：

- 类型和注册表继续写死第三家 provider
- 前端再补一轮 `if provider === "opencode"` 特判
- OpenCode 原生 `part`、`permission`、`diff`、`todo`、`children` 能力被压扁，最后既不像 OpenCode，也把我们自己的链路搞脏

这很蠢。

所以这个 Spec 的重点只有一个：先把 OpenCode 的真实数据结构和运行方式接住，再让现有系统按统一能力和统一契约消费它。

## 已确认的现实前提

基于当前本机样本，已经确认：

- OpenCode 本地有真实数据目录：`~/.local/share/opencode/`
- 当前真实存储核心是 `sqlite`，不是 Claude/Codex 那种以原生日志文件为核心
- 当前库中存在 `session`、`message`、`part`、`project`、`permission`、`todo` 等表
- 当前样本已经出现 `text`、`reasoning`、`tool`、`step-start`、`step-finish` 等 part
- 官方 server/sdk 还提供 `/event`、`/session/:id/diff`、`/session/:id/todo`、`/session/:id/children`、`/session/:id/permissions/:permissionID` 等能力

一句话说清楚：OpenCode 不是“再来一个读 jsonl 的 CLI”，它更像一个完整 agent runtime。

## 术语表

- **OpenCode Server**：`opencode serve` 暴露的官方 HTTP/SSE 服务
- **OpenCode Session**：OpenCode 原生会话对象，对应 `session.id`
- **OpenCode Part**：OpenCode 消息片段，类型包括 `text`、`reasoning`、`tool`、`patch`、`snapshot`、`agent` 等
- **Raw Reference（原始引用）**：能够追溯回 OpenCode 原生 session / message / part 的稳定引用
- **Primary Path（主接入链路）**：项目运行时优先依赖的官方链路，这里指 OpenCode server/sdk
- **Fallback Path（兜底链路）**：主链路不可用时用于排障、回填或 fixture 的辅助读取链路，这里指本地 sqlite 只读能力

## 范围说明

### In Scope

- 定义 OpenCode provider 的接入边界
- 定义 OpenCode session/message/part 到项目公共模型的映射策略
- 定义 OpenCode 实时运行时和历史读取的推荐链路
- 定义 OpenCode capability descriptor 的扩展项和降级规则
- 定义 OpenCode fixture 样本、回归测试和验收流程
- 定义现有仓库中必须拆掉的 provider 硬编码范围

### Out of Scope

- 一次性把 OpenCode 全部高级能力都完整 UI 化
- 为了 OpenCode 单独开一套会话页面
- 改造 OpenCode 官方存储格式
- 在本 Spec 内直接完成全部代码实现

## 需求

### 需求 1：OpenCode 必须作为正式 provider 接入，而不是补丁分支

**用户故事：** 作为系统维护者，我希望 OpenCode 接入时走统一 provider 契约，而不是变成第三套特殊代码，以便后续还能继续维护。

#### 验收标准

1. WHEN 新增 OpenCode provider THEN System SHALL 允许其通过统一 provider 注册机制接入，而不是继续写死两家 provider。
2. WHEN OpenCode provider 接入 THEN System SHALL 不要求在前端主流程、Host 主流程和 session-sync-core 中继续新增 provider 名字硬编码。
3. WHEN 现有 provider 扩展点不足以容纳 OpenCode THEN System SHALL 先补公共抽象，再接 OpenCode。

### 需求 2：OpenCode 会话真相必须来自官方 server/sdk 主链路

**用户故事：** 作为接入开发者，我希望 OpenCode 的实时和历史能力优先走官方 server/sdk，这样接入才不会建立在脆弱的私有存储猜测上。

#### 验收标准

1. WHEN 系统读取 OpenCode 会话历史、实时事件或运行状态 THEN System SHALL 优先使用 OpenCode 官方 server/sdk。
2. WHEN OpenCode server/sdk 不可用 THEN System SHALL 允许使用本地 sqlite 只读链路做有限兜底或排障，但不能把它伪装成主运行时协议。
3. WHEN 系统保存 OpenCode 会话绑定 THEN System SHALL 记录真实 `providerSessionId`，并保留稳定的原始引用定位信息。

### 需求 3：OpenCode 的宽消息结构必须有可追溯映射

**用户故事：** 作为平台开发者，我希望 OpenCode 的 `part` 结构能被完整理解或安全降级，以便不会丢掉关键语义。

#### 验收标准

1. WHEN OpenCode 返回 `text`、`reasoning`、`tool`、`step-start`、`step-finish` 等 part THEN System SHALL 能映射到项目统一消息模型或统一富内容扩展模型。
2. WHEN OpenCode 返回当前前端还不直接展示的 part 类型，例如 `patch`、`snapshot`、`agent`、`subtask` THEN System SHALL 至少保留原始引用、类型信息和安全降级展示。
3. WHEN 任意一条归一化消息被输出 THEN System SHALL 能追溯到 OpenCode 原生 `session/message/part`。

### 需求 4：OpenCode 的运行时能力差异必须通过 capability descriptor 暴露

**用户故事：** 作为前端开发者，我希望 OpenCode 比现有 provider 多出来的能力仍然通过 capability 暴露，而不是散落 provider 特判。

#### 验收标准

1. WHEN OpenCode 支持 `interrupt`、`todo`、`diff`、`children`、`permission reply`、`share`、`fork` 等能力 THEN System SHALL 通过 capability descriptor 或兼容扩展字段暴露这些能力。
2. WHEN 某个能力当前项目还没接 UI THEN System SHALL 在 capability 中明确标记，并通过 `limitations` 或降级策略说明现状。
3. WHEN 老客户端尚未识别 OpenCode 新能力字段 THEN System SHALL 允许其安全忽略，不破坏基础会话能力。

### 需求 5：OpenCode 接入不能破坏现有会话、队列和运行时语义

**用户故事：** 作为现有系统维护者，我希望引入 OpenCode 时不会把 Claude/Codex 已有链路打坏。

#### 验收标准

1. WHEN 接入 OpenCode THEN System SHALL 不破坏现有 `Claude Code` / `Codex` 的会话发现、历史读取、实时运行和发送队列行为。
2. WHEN OpenCode 的运行中输入语义与现有 provider 不同 THEN System SHALL 通过能力和运行时策略显式表达，而不是伪装成和其他 provider 一样。
3. WHEN OpenCode 原生支持异步 prompt、permission response 或 session revert THEN System SHALL 在不影响现有 provider 的前提下扩展公共边界。

### 需求 6：OpenCode 的权限、diff、todo 和子会话能力必须有边界

**用户故事：** 作为产品和工程维护者，我希望 OpenCode 的高级能力接入时边界清楚，避免一下子把范围搞失控。

#### 验收标准

1. WHEN 接入第一阶段 OpenCode THEN System SHALL 明确哪些高级能力立即交付，哪些只做 capability 占位或只读展示。
2. WHEN OpenCode 出现权限请求 THEN System SHALL 能追踪该请求，并预留统一应答链路。
3. WHEN OpenCode 返回 todo、diff 或子会话 THEN System SHALL 至少允许宿主读取并绑定到当前会话上下文，不强制第一阶段全部可编辑。

### 需求 7：OpenCode 必须有真实样本和本地回归

**用户故事：** 作为维护者，我希望 OpenCode 的接入建立在真实样本上，而不是靠想象写适配器。

#### 验收标准

1. WHEN 启动 OpenCode 接入 THEN System SHALL 基于真实本地样本提取 fixture，包括 session、message、part、diff、capability 样本。
2. WHEN OpenCode 官方升级或本地存储格式变化 THEN System SHALL 通过 fixture 回归尽快发现破坏性差异。
3. WHEN 样本覆盖不到关键 part 类型或关键运行路径 THEN System SHALL 不允许标记为完成接入。

### 需求 8：问题排查必须能快速定位到 OpenCode 层

**用户故事：** 作为维护者，我希望 OpenCode 出问题时能分清是 server、sdk、sqlite 兜底还是我们自己的适配器坏了。

#### 验收标准

1. WHEN OpenCode provider 解析失败或运行失败 THEN System SHALL 记录 provider、session id、message id、part id、错误码和接入链路来源。
2. WHEN server 主链路失败并切到 sqlite 兜底 THEN System SHALL 明确记录这是 fallback 行为，而不是静默切换。
3. WHEN 前端展示异常 THEN System SHALL 能追踪到对应 capability 版本和原始引用。

## 非功能需求

### 非功能需求 1：可靠性

1. WHEN OpenCode server 短暂不可用 THEN System SHALL 至少保证历史读取、错误提示和排障链路可用。
2. WHEN OpenCode 单独出兼容性问题 THEN System SHALL 不影响现有其他 provider 主链路。

### 非功能需求 2：可维护性

1. WHEN OpenCode 接入完成 THEN System SHALL 把主要改动收敛在 provider 抽象层、OpenCode provider 目录、capability 扩展和前端门控层。
2. WHEN 后续新增第四家 provider THEN System SHALL 尽量复用这次为 OpenCode 补齐的公共抽象。

### 非功能需求 3：可观测性

1. WHEN OpenCode 运行异常 THEN System SHALL 输出可检索的 provider 级日志和结构化错误。
2. WHEN fixture 执行失败 THEN System SHALL 输出差异详情，而不是只报“测试失败”。

## 成功定义

- OpenCode 能作为第三个正式 provider 接入，而不是临时补丁
- 项目不再继续扩大 `claude-code/codex` 写死范围
- OpenCode 的核心 part 和核心运行时能力有稳定映射
- 前端继续按 capability 做门控，不出现新一轮散落 provider 特判
- 本地真实样本可以沉淀为 fixture，并支撑后续回归
