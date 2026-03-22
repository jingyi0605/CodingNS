# 需求文档 - ClaudeCode与Codex会话同步核心

状态：Draft

## 简介

这个 Spec 解决的是一个真问题：用户已经在 Claude Code 或 Codex 里聊了一半，切到桌面端或移动端后，必须能接着同一条会话继续干活，而不是看到一份前端自己造的聊天记录。

本 Spec 只做会话同步核心，不做 UI 花活，也不做“先支持十几个 CLI 再说”的过度设计。

这一步做完后，系统应该具备：

- 发现 Claude Code / Codex 原生会话
- 读取历史消息并实时同步增量消息
- 续接已有会话和新建会话
- 用能力描述（capability descriptor，能力描述符）告诉前端每个 provider 能做什么
- 严格保证原始消息只有 CLI 一个来源

## 术语表

- **System**：`CodingNS Host`，负责会话同步、索引和状态管理的后端服务。
- **Provider（提供方适配器）**：面向某一个 CLI 的解析与能力适配实现，例如 `provider-claude-code`、`provider-codex`。
- **Capability Descriptor（能力描述符）**：由 provider 返回的能力声明，描述该 provider / session 支持哪些操作。
- **Session Index（会话索引）**：系统保存的会话检索信息，不包含原始消息正文。
- **Session Status Snapshot（会话状态快照）**：系统保存的会话状态信息，例如同步进度、最后消息时间、错误状态。
- **Raw Reference（原始引用）**：指向 CLI 原始消息的可追溯引用，用于排错和一致性校验。

## 范围说明

### In Scope

- 只支持 `Claude Code` 与 `Codex` 两个 provider
- 会话发现、历史读取、实时订阅、续接与新建会话
- 消息归一化、去重、顺序控制
- capability descriptor 的定义与输出
- 会话索引、状态快照、映射关系的存储与更新

### Out of Scope

- 接入第三个 provider（例如 Gemini CLI）
- 复杂 UI 交互设计与页面表现
- 团队协作、多人权限模型
- 把原始会话消息复制进本地数据库当主数据

## 需求

### 需求 1：Provider 支持范围必须收敛

**用户故事：** 作为开发负责人，我希望第一阶段只支持 Claude Code 与 Codex，以便把核心链路做透，避免范围失控。

#### 验收标准

1. WHEN 系统启动 provider 注册流程 THEN System SHALL 只加载 `provider-claude-code` 与 `provider-codex`。
2. WHEN 请求未支持的 provider THEN System SHALL 返回明确错误并拒绝执行。
3. WHEN 开发者尝试通过配置绕过支持范围 THEN System SHALL 在启动校验阶段阻止并记录错误日志。

### 需求 2：原始消息必须保持唯一来源

**用户故事：** 作为使用 CLI 的开发者，我希望系统展示的消息和 CLI 原生消息一致，以便我能稳定续接，不出现两套真相。

#### 验收标准

1. WHEN 系统读取会话历史 THEN System SHALL 从 provider 原生存储读取原始消息。
2. WHEN 系统持久化数据 THEN System SHALL 只保存索引、状态快照、映射与衍生信息，不保存完整原始消息副本。
3. WHEN 任意一条消息被展示 THEN System SHALL 能提供可追溯的 `rawRef` 或等价原始引用。

### 需求 3：会话发现与历史读取必须可用

**用户故事：** 作为开发者，我希望系统自动发现工作区下已有会话并读取历史，以便我不用手工迁移上下文。

#### 验收标准

1. WHEN 用户进入某个工作区 THEN System SHALL 返回该工作区下可用的 Claude Code / Codex 会话列表。
2. WHEN 用户请求历史消息 THEN System SHALL 支持分页读取，并返回稳定顺序。
3. WHEN provider 原始存储暂时不可用 THEN System SHALL 返回明确错误码和可读错误信息。

### 需求 4：实时订阅与续接链路必须可靠

**用户故事：** 作为开发者，我希望会话消息能够实时更新并可续接，以便我在多端切换时不丢上下文。

#### 验收标准

1. WHEN 会话产生新消息 THEN System SHALL 通过 WebSocket 推送标准化事件。
2. WHEN 客户端断线重连 THEN System SHALL 支持按最后游标补齐漏掉的增量消息。
3. WHEN 用户选择续接已有会话 THEN System SHALL 调用对应 provider 的 `resumeSession` 并返回续接结果。

### 需求 5：支持新建会话并建立映射

**用户故事：** 作为开发者，我希望在系统内直接新建 Claude Code 或 Codex 会话，以便不用手动切回 CLI 启动。

#### 验收标准

1. WHEN 用户发起新会话创建 THEN System SHALL 调用 provider 的 `startSession` 创建原生会话。
2. WHEN 新会话创建成功 THEN System SHALL 建立 `systemSessionId` 与 `providerSessionId` 的映射关系。
3. WHEN 创建失败 THEN System SHALL 返回标准错误码，并且不写入脏索引数据。

### 需求 6：能力差异必须显式声明

**用户故事：** 作为前端开发者，我希望后端返回稳定的能力描述符，以便页面按能力展示，而不是按 provider 名字写死逻辑。

#### 验收标准

1. WHEN 客户端请求 provider 能力 THEN System SHALL 返回 `ProviderCapabilities` 结构。
2. WHEN 客户端请求会话能力 THEN System SHALL 返回会话级能力覆盖信息（如有）。
3. WHEN 某能力不支持 THEN System SHALL 在能力描述符中明确标记，并附 `limitations` 说明。

### 需求 7：索引与状态快照必须可维护

**用户故事：** 作为系统维护者，我希望会话索引和状态快照始终可恢复、可重建，以便故障后快速恢复服务。

#### 验收标准

1. WHEN 历史同步完成 THEN System SHALL 更新会话索引和最新状态快照。
2. WHEN 状态同步失败 THEN System SHALL 记录错误状态并保留上次成功快照。
3. WHEN 执行重建任务 THEN System SHALL 可从 provider 原始存储重新构建索引与状态。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 请求单会话历史第一页（默认页大小） THEN System SHALL 在 2 秒内返回。
2. WHEN 同时订阅多个活跃会话 THEN System SHALL 保持实时消息端到端延迟在可接受范围（目标 P95 < 1 秒）。

### 非功能需求 2：可靠性

1. WHEN provider 短暂不可用 THEN System SHALL 返回可重试错误，并不破坏已存在索引数据。
2. WHEN 系统重启 THEN System SHALL 通过索引与状态快照快速恢复会话列表和同步位置。

### 非功能需求 3：可维护性

1. WHEN 新增或调整 provider 能力字段 THEN System SHALL 仅在 capability 契约和对应 provider 实现改动，不污染其他模块。
2. WHEN 线上问题排查 THEN System SHALL 提供 `sessionId/provider/rawRef` 级别的日志定位信息。

### 非功能需求 4：安全性

1. WHEN 调用受保护的会话 API THEN System SHALL 强制要求登录态令牌。
2. WHEN WebSocket 建立会话订阅 THEN System SHALL 在握手阶段完成鉴权校验。

## 成功定义

- 用户在桌面端能稳定看到并续接 Claude Code / Codex 原生会话。
- 系统内没有第二份原始消息仓库，消息展示可追溯到 provider 原始引用。
- 前端消费 capability descriptor 即可完成能力门控，不需要写死 provider 名字分支。
- 会话发现、历史读取、实时订阅、续接、新建会话五条主链路都可验证通过。
