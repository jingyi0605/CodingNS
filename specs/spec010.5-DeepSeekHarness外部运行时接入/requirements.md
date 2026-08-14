# 需求文档 - DeepSeek Harness 外部运行时接入

状态：Draft

## 简介

CodingNS 已经有统一的会话、运行时、权限和消息事件接口。DeepSeek Harness 提供了一套能力较完整的 Web API，可以通过 HTTP JSON-RPC 创建会话、发送消息、读取历史、执行 Fork，并通过 WebSocket 推送文本、工具调用和审批事件。

本 Spec 要解决的问题是：在不合并两套源码、不让前端直接访问 Harness 的前提下，让 CodingNS Host 可以把 Harness 当作一个可选的外部 Agent Runtime。CodingNS 继续负责用户认证、工作区权限和对外接口；Harness 负责 Agent 执行和自身会话日志。

首版只接入 Harness Web API 已经能够稳定表达的核心能力。Harness 当前仍是 Developer Preview，因此适配器必须隔离版本变化，并对暂不支持的 CodingNS 能力明确返回“不支持”，不能伪造成功。

## 术语表

- **System**：CodingNS Host。
- **Harness**：DeepSeek Harness Agent 运行时。
- **Sidecar**：由 CodingNS Host 在本机启动、只绑定 `127.0.0.1` 的 Harness Web 进程。
- **Harness 适配器**：CodingNS 内部负责调用 Harness HTTP/WebSocket 接口并转换为 CodingNS 标准模型的模块。
- **外部会话**：以 Harness 会话为执行权威源、由 CodingNS 保存绑定关系和展示投影的会话。
- **标准能力**：CodingNS 现有会话创建、发送、历史、运行状态、工具事件、权限、附件和中断等对外能力。

## 范围说明

### In Scope

- 本机 Harness sidecar 的启动、健康检查、退出和版本锁定。
- Harness 会话与 CodingNS 工作区、用户和会话 ID 的绑定。
- 会话创建、发送、实时输出、历史读取、中断、队列、附件、工具事件和权限请求。
- Harness 事件到 CodingNS 标准消息和运行时事件的转换。
- WebSocket 断线后的历史恢复、去重和重新订阅。
- 能力矩阵中对已支持、部分支持和不支持能力的明确声明。

### Out of Scope

- 直接合并 Harness Cordis 插件源码到 CodingNS。
- 让浏览器或远程客户端直接访问 Harness Web API。
- 把 Harness 的 Web API 宣称为稳定公共标准协议。
- 首版实现 Harness 当前没有明确对应物的收藏、删除、Changed Files、Diff、Session Share 和跨 Provider Fork。
- 修改 Harness 本身或为 Harness 增加新的业务接口。

## 需求

### 需求 1：本机 Sidecar 安全启动

**用户故事：** 作为 CodingNS 用户，我希望使用 Harness 时由 Host 自动准备一个本机运行时，以便不需要手工启动服务且不会把代码执行接口暴露到网络。

#### 验收标准

1. WHEN CodingNS 首次需要 Harness 会话 THEN System SHALL 启动锁定版本的 Harness sidecar，并只监听 `127.0.0.1`。
2. WHEN sidecar 尚未就绪、启动失败或进程退出 THEN System SHALL 返回明确的运行时不可用错误，并且不创建半成品的 CodingNS 会话绑定。
3. WHEN CodingNS Host 退出 THEN System SHALL 终止由自己启动的 sidecar，并且不得误杀用户手工启动的其他 Harness 进程。
4. WHEN 运行时配置要求远程 Harness 地址 THEN System SHALL 在首版拒绝该配置，而不是绕过本机安全边界。

### 需求 2：会话主链路兼容

**用户故事：** 作为 CodingNS 用户，我希望 Harness 会话像其他 Provider 一样出现在会话工作台中，以便使用统一的创建、发送、历史和运行状态入口。

#### 验收标准

1. WHEN 用户创建 Harness 会话 THEN System SHALL 建立 CodingNS session id 与 Harness session id 的稳定绑定，并记录所属用户和工作区。
2. WHEN 用户发送普通或实时消息 THEN System SHALL 将 CodingNS 请求转换为 Harness `session.prompt`，并返回 CodingNS 既有的接受结果。
3. WHEN 用户读取会话历史 THEN System SHALL 将 Harness `session.history` 转换为 CodingNS `NormalizedMessage`，并保留可追溯的原始事件引用。
4. WHEN 用户中断运行或处理队列消息 THEN System SHALL 分别映射到 Harness 的 `session.cancel`、`session.updateQueue` 和 `mode=queue/steer`。
5. WHEN Harness 返回不支持、会话不存在或模型不可用 THEN System SHALL 映射为 CodingNS 可识别的错误，而不是返回通用成功响应。

### 需求 3：实时事件和断线恢复

**用户故事：** 作为 CodingNS 用户，我希望看到完整且不重复的实时输出，以便 Harness 运行中的文本、工具调用和状态变化与其他 Provider 的体验一致。

#### 验收标准

1. WHEN Harness 通过 `events.mux` 推送消息或工具事件 THEN System SHALL 转换为 CodingNS 标准运行时事件，并按会话转发给现有订阅者。
2. WHEN Harness 通过 `events.host` 推送会话运行状态或 Agent 错误 THEN System SHALL 更新 CodingNS 运行时快照。
3. WHEN WebSocket 断线 THEN System SHALL 先通过 `session.history` 补齐断线期间的事件，再重新订阅实时流。
4. WHEN 历史补齐和实时流同时包含同一事件 THEN System SHALL 根据 Harness session seq、事件类型和原始引用去重，不能向用户重复显示消息。
5. WHEN Harness 事件格式无法识别 THEN System SHALL 保留原始诊断信息、跳过不可转换事件，并继续处理后续可识别事件。

### 需求 4：工具、权限和附件能力

**用户故事：** 作为 CodingNS 用户，我希望 Harness 使用工具或请求权限时仍然走 CodingNS 的标准界面，以便操作确认、工具结果和附件不会形成第二套交互。

#### 验收标准

1. WHEN Harness 推送 `tool/call` 或 `tool/result` THEN System SHALL 转换为 CodingNS 的结构化工具调用和工具结果消息。
2. WHEN Harness 推送 `approval/requested` 或 `question/requested` THEN System SHALL 创建 CodingNS 权限或问题请求，并将用户回复转换为 Harness `/api/respond`。
3. WHEN 用户发送图片附件 THEN System SHALL 在工作区边界和大小限制校验通过后转换为 Harness prompt image part。
4. WHEN Harness 返回附件引用或附件读取失败 THEN System SHALL 返回 CodingNS 标准附件错误，并且不得泄漏 sidecar 的任意文件路径。
5. WHEN Harness 工具或权限能力不可用 THEN System SHALL 在能力矩阵和会话能力接口中明确标记，不显示可点击但无法工作的入口。

### 需求 5：工作区、用户和权限隔离

**用户故事：** 作为 CodingNS 管理者，我希望 Harness 只能操作当前用户授权的工作区，以便 sidecar 不会成为绕过 CodingNS 权限的通道。

#### 验收标准

1. WHEN 创建或恢复 Harness 会话 THEN System SHALL 只接受由 CodingNS workspace id 解析出的规范路径，不接受前端直接提交的任意绝对路径。
2. WHEN 工作区路径包含符号链接越界、路径不存在或不属于当前用户 THEN System SHALL 在调用 Harness 前拒绝请求。
3. WHEN CodingNS 返回会话列表 THEN System SHALL 只返回当前用户有权访问的绑定，不得原样暴露 Harness 全局 session.list。
4. WHEN 多个用户共用一个 Host THEN System SHALL 在绑定、读取、发送、Fork、权限回复和事件转发的每个入口校验 user id。
5. WHEN sidecar 进程或连接被外部客户端直接访问 THEN System SHALL 通过 loopback 绑定和 Host 防火墙/路由策略阻止其成为公开入口。

### 需求 6：能力矩阵和降级语义

**用户故事：** 作为 CodingNS 用户，我希望看到 Harness 真正支持的能力，以便不会因为入口显示错误而执行失败操作。

#### 验收标准

1. WHEN CodingNS 查询 Harness Provider 能力 THEN System SHALL 返回稳定的 `ProviderCapabilities` 快照。
2. WHEN Harness 只部分支持某项 CodingNS 能力 THEN System SHALL 标记为受限，并说明限制，例如 Fork 只支持已完成 turn。
3. WHEN Harness 没有对应 Web API THEN System SHALL 返回“不支持”错误，至少覆盖收藏、删除、Changed Files、Diff 和 Session Share。
4. WHEN Harness 版本升级导致能力变化 THEN System SHALL 在 sidecar 健康检查和日志中记录版本，并允许适配器按版本拒绝不兼容能力。

### 需求 7：外部依赖故障和可观测性

**用户故事：** 作为维护者，我希望能区分 Harness 进程故障、协议错误和 CodingNS 业务错误，以便快速定位问题并安全回滚。

#### 验收标准

1. WHEN sidecar 启动、退出、重启或健康检查失败 THEN System SHALL 记录结构化日志，包含 sidecar 实例 id 和 Harness 版本。
2. WHEN HTTP JSON-RPC 返回 carrier 错误、业务错误或 rpcId 不匹配 THEN System SHALL 使用不同错误类别记录，并保留请求方法和会话 id。
3. WHEN WebSocket 连接连续失败 THEN System SHALL 使用统一的后台任务/重试策略，不能为每个会话私自创建无限重试定时器。
4. WHEN 适配器无法恢复外部会话 THEN System SHALL 保留 CodingNS 绑定和最后一次错误，不能静默删除用户会话。
5. WHEN 禁用或移除 Harness Provider THEN System SHALL 停止新会话和新任务，但保留已有绑定和诊断记录，便于恢复或迁移。

## 非功能需求

### 非功能需求 1：性能

1. WHEN sidecar 已就绪 THEN 普通会话 RPC 的适配层额外延迟 SHALL 控制在 100ms 内，不含 Harness Agent 执行时间。
2. WHEN 实时事件持续到达 THEN System SHALL 使用有界队列和背压，不能因为慢客户端无限积压内存。

### 非功能需求 2：可靠性

1. WHEN Harness WebSocket 断开或 sidecar 重启 THEN System SHALL 通过历史恢复保证 CodingNS 最终得到连续且不重复的会话视图。
2. WHEN 外部依赖不可用 THEN System SHALL 保留现有 CodingNS Provider 的正常运行，不得阻塞整个 Host 启动。

### 非功能需求 3：可维护性

1. WHEN Harness Web API 协议变化 THEN System SHALL 将变化隔离在适配器和契约测试中，不得扩散到前端和通用会话模型。
2. WHEN 排查单个会话问题 THEN System SHALL 能通过 CodingNS session id、Harness session id、sidecar 实例 id 和原始事件 seq 关联日志。
3. WHEN 新增 Harness 能力 THEN System SHALL 先更新能力矩阵、设计契约和测试，再开放 CodingNS 对外入口。

## 成功定义

- CodingNS 可以在本机安全启动 Harness sidecar，并在 sidecar 不可用时不影响其他 Provider。
- Harness 会话可以通过 CodingNS 现有入口完成创建、发送、历史、实时输出、中断、工具调用、权限和附件流程。
- WebSocket 断线恢复后，用户看到的消息连续、不重复，且能追溯到 Harness 原始事件。
- 不支持的能力被明确拒绝，不存在“接口返回成功但 Harness 实际没有执行”的伪兼容。
- 所有核心链路都有适配器单元测试、sidecar 契约测试和最小集成验证记录。
