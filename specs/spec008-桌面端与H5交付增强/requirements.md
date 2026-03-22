# 需求文档 - spec008 桌面端与H5交付增强

状态：Draft

## 简介

这个 Spec 解决的是“怎么把已经有的核心能力稳定交付给桌面端和 H5”，不是再发明一套新业务。

我们要把下面几件事定死：

- `Tauri` 只是桌面壳，不承载核心业务逻辑
- 桌面端和 H5 共享同一套后端能力与大部分 UI 状态模型
- 连接建立、断线恢复、登录态保护必须可验证
- 桌面分发、升级、配置要有明确边界和回滚路径

## 术语表

- **System**：`码不能停` 的客户端交付层（桌面端 + H5）与 `CodingNS Host` 连接体系
- **Desktop Shell（桌面壳）**：`Tauri` 壳层，负责窗口、系统集成、安装包，不负责业务真相
- **Shared UI Runtime（共享 UI 运行时）**：桌面端和 H5 共同使用的 Web UI 代码与状态模型
- **Connection Session（连接会话）**：客户端与 Host 之间的登录态连接上下文（HTTP + WebSocket）
- **Release Channel（发布通道）**：桌面端升级来源通道，如 `stable`、`beta`

## 范围说明

### In Scope

- Tauri 桌面壳接入与壳层边界定义
- H5 访问体验与共享 UI 运行时约束
- 连接建立、断线恢复、重连提示
- 桌面分发、升级、配置管理
- 桌面端与 H5 共享后端能力和大部分 UI 状态模型
- 登录态下受保护数据访问约束

### Out of Scope

- 移动端专属交互和通知策略（归 `spec009`）
- 会话同步核心协议改造（归 `spec002`）
- 文件 / Git / 终端 / 进程业务本体实现（归 `spec004` ~ `spec007`）
- 把核心业务逻辑迁入 Tauri Rust 层

## 需求

### 需求 1：Tauri 必须被限制为桌面壳

**用户故事：** 作为架构维护者，我希望桌面端壳层只负责壳能力，以便业务逻辑始终在 Host 和共享 Web 层，不会出现双份实现。

#### 验收标准

1. WHEN 定义桌面端架构 THEN System SHALL 明确 `Tauri` 只负责窗口、托盘、系统集成、安装升级。
2. WHEN 新增桌面端能力 THEN System SHALL 优先走 Host API 或共享 Web 代码，不把业务状态逻辑塞进 Rust 壳层。
3. WHEN 评审桌面端改动 THEN System SHALL 可检查“壳层代码未承载业务真相”。

### 需求 2：桌面端和 H5 必须共享后端能力和大部分 UI 状态

**用户故事：** 作为多端用户，我希望桌面端和 H5 行为一致，以便换端后不用重新学习，也不会出现数据口径冲突。

#### 验收标准

1. WHEN 桌面端和 H5 访问同一工作区 THEN System SHALL 使用同一套 Host API 和 WebSocket 事件协议。
2. WHEN 页面加载同一业务模块 THEN System SHALL 复用同一套主要 UI 状态模型（如会话、连接、鉴权状态）。
3. WHEN 需要平台差异能力 THEN System SHALL 通过平台适配层收口，不在业务组件散落分支。

### 需求 3：连接建立必须稳定且可诊断

**用户故事：** 作为用户，我希望首次连接 Host 时流程明确，以便快速完成登录并进入工作区，而不是卡在模糊错误里。

#### 验收标准

1. WHEN 客户端首次连接 Host THEN System SHALL 给出连接探测、登录校验和失败提示。
2. WHEN Host 未初始化 THEN System SHALL 引导走初始化与登录流程，不允许直接访问受保护数据。
3. WHEN 连接失败 THEN System SHALL 返回可读错误信息和可执行重试动作。

### 需求 4：连接恢复必须有自动机制和人工兜底

**用户故事：** 作为远程使用者，我希望网络抖动后能自动恢复，以便不中断工作流。

#### 验收标准

1. WHEN 短时断网 THEN System SHALL 自动重连并恢复会话通道。
2. WHEN 重连失败达到阈值 THEN System SHALL 展示明确状态和手动重连入口。
3. WHEN 连接恢复 THEN System SHALL 自动刷新关键状态，避免“已连接但数据过期”。

### 需求 5：桌面分发、升级、配置必须可控

**用户故事：** 作为发布维护者，我希望桌面端交付有稳定发布和回滚策略，以便升级失败时不把用户卡死。

#### 验收标准

1. WHEN 发布桌面版本 THEN System SHALL 支持按平台和发布通道分发安装包与升级元数据。
2. WHEN 检查更新 THEN System SHALL 提供升级可用性、版本说明和签名校验结果。
3. WHEN 升级失败 THEN System SHALL 支持回退到上一可用版本并保留用户配置。

### 需求 6：受保护数据必须建立在登录态之上

**用户故事：** 作为系统管理员，我希望桌面端和 H5 都遵守同一鉴权规则，以便不会出现某一端绕过登录读数据。

#### 验收标准

1. WHEN 未登录访问受保护 API 或 WebSocket THEN System SHALL 拒绝访问并引导登录。
2. WHEN access token 失效 THEN System SHALL 触发刷新或重新登录，不继续透传受保护请求。
3. WHEN 客户端进入工作区界面 THEN System SHALL 先确认登录态有效，再加载受保护数据。

### 需求 7：明确不做移动端专属内容

**用户故事：** 作为项目负责人，我希望 spec008 不扩范围做移动端专属内容，以便交付节奏可控。

#### 验收标准

1. WHEN 编写 spec008 任务 THEN System SHALL 不包含移动端专属 UI、通知、手势方案。
2. WHEN 出现移动端专属需求 THEN System SHALL 标记为 `spec009` 处理，不在 spec008 实现。
3. WHEN 进行阶段验收 THEN System SHALL 以桌面端 + H5 交付为唯一完成范围。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 桌面端冷启动进入登录页 THEN System SHALL 在可接受时间内完成基础壳加载与 UI 启动（目标 P95 <= 3 秒）。
2. WHEN H5 首次进入受保护页面 THEN System SHALL 在网络正常时快速完成连接探测和首屏渲染（目标 P95 <= 2 秒）。

### 非功能需求 2：可靠性

1. WHEN Host 临时不可达 THEN System SHALL 提供自动重试和可见错误状态，不静默失败。
2. WHEN 桌面端升级异常 THEN System SHALL 不破坏本地配置，并支持恢复到上一可用版本。

### 非功能需求 3：可维护性

1. WHEN 新增平台差异能力 THEN System SHALL 通过统一平台适配层扩展，不污染业务组件。
2. WHEN 联调排障 THEN System SHALL 能快速区分壳层问题、Web 运行时问题和 Host 连接问题。

## 成功定义

- 桌面端和 H5 可以在同一套登录与连接协议下稳定访问同一工作区能力。
- 桌面壳边界清晰，业务真相不进入 Tauri Rust 层。
- 连接建立、断线恢复、升级失败回退都有可验证路径。
- spec008 交付不混入移动端专属需求，范围保持干净。
