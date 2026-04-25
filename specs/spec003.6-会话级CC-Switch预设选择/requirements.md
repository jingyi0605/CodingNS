# 需求文档 - spec003.6 会话级CC-Switch预设选择

状态：Draft

## 1. 背景

现在项目已经把 `cc-switch` 接进来了，但接法只完成了一半。

已经做好的部分是：

- 设置页可以看到 `Codex`、`Claude Code`、`Gemini`、`OpenCode` 的 `cc-switch` 预设
- 用户可以在设置页切全局当前 preset

真正没做好的部分是：

- 新建会话时不能直接选 preset
- 会话本身不会记住它启动时用的是哪个 preset
- 运行时和历史恢复仍然默认依赖全局 `homeDir`

这在只有一个会话时勉强能凑合，但一旦用户想同时开多个不同 preset 的会话，问题就会立刻暴露：

1. 一个会话切了全局 preset，另一个会话就被连带影响
2. 旧会话继续运行时，系统拿到的是“现在的全局配置”，不是“当时的会话配置”
3. 前端看上去像是能选 provider，实际上 provider 下面的真实运行上下文仍然只有一个全局值

这不是按钮放错位置的问题，这是数据结构没分层。

## 2. 目标

本 Spec 第一阶段只达成下面六件事：

1. `Codex`、`Claude Code`、`Gemini` 会话在原有模型位置可以直接选择 `cc-switch` 配置文件和模型
2. 会话创建成功后，系统会把所选 preset 绑定到该 session
3. 会话进行中切换部署后，后续继续发送、自动续跑、应用重启后的恢复都沿用最新一次绑定的 preset 上下文
4. 现有设置页里的全局切换能力继续保留，但不再是唯一入口
5. 显式 `model` 参数继续有效，不会因为 preset 默认模型把现有行为打烂
6. 旧会话和不选择 preset 的新会话继续兼容现有全局默认配置

## 3. 非目标

下面这些明确不在本阶段做：

- 不做 `OpenCode` 的会话级 preset 绑定
- 不做 `Kimi` 的会话级 preset 绑定
- 不做 `cc-switch` 预设的新增、编辑、删除
- 不做所有 provider 的统一配置编辑器
- 不做“运行中直接替换当前 run 的 preset”

## 4. 术语说明

- **Provider Preset**：`cc-switch` 中已有的一条 provider 配置，通常包含模型、认证、endpoint 和其他运行参数。
- **会话级 preset 绑定**：某个 session 创建时绑定到一个 preset，后续继续运行时都沿用这条绑定。
- **全局默认 preset**：当前通过设置页或命令行切到 provider 当前生效的默认预设。
- **会话运行上下文**：某个 session 实际运行时使用的 provider 配置快照或专属 `runtimeHomeDir`。
- **runtimeHomeDir**：为某个 session 准备的 provider 运行目录，用来承载该 session 的配置文件和运行期数据。
- **显式模型参数**：用户在会话发送时主动选择的 `model`，优先级高于 preset 的默认模型。

## 5. 用户故事

### 5.1 多预设并行用户

作为会同时测试多个模型供应商配置的用户，我希望在会话页的模型位置直接选择 preset，这样我可以同时开多个不同 preset 的会话，而且会话进行中切换部署后也能立刻验证效果，而不是反复来回切全局配置。

### 5.2 会话恢复维护者

作为系统维护者，我希望一个会话在恢复、继续发送和自动续跑时都回到它原来绑定的 preset，而不是偷偷吃当前全局默认值。

### 5.3 前端开发者

作为前端开发者，我希望“provider 选择”和“preset 选择”都有明确字段，不用再靠 provider 名称和设置页状态拼猜运行上下文，而且同一套部署选择器可以复用到 composer、fork、并行会话和选区操作弹框。

## 6. 功能需求

### 6.1 会话页必须支持选择 provider 下的 cc-switch preset

1. WHEN 用户在会话页的模型位置选择 `Codex`、`Claude Code`、`Gemini` THEN System SHALL 提供 preset 选择入口。
2. WHEN 当前 provider 在 `cc-switch` 中存在多个可用 preset THEN System SHALL 允许用户显式选择其中一项。
3. WHEN 用户不想显式选择 THEN System SHALL 允许用户继续使用“当前全局默认 preset”。
4. WHEN 当前 provider 没有可用 preset THEN System SHALL 明确显示原因，而不是假装可以选择。

### 6.2 会话创建成功后必须持久化 preset 绑定

1. WHEN 会话使用显式 preset 创建成功 THEN System SHALL 持久化该会话绑定的 `providerPresetId`。
2. WHEN 会话使用显式 preset 创建成功 THEN System SHALL 持久化该会话对应的运行上下文引用，例如 `runtimeHomeDir` 或等价字段。
3. WHEN 会话未显式选择 preset THEN System SHALL 明确记录它走的是全局默认模式，而不是留成含糊状态。

### 6.3 会话后续继续发送时必须复用当前绑定的 preset 上下文

1. WHEN 用户继续向已有会话发送消息 THEN System SHALL 复用该 session 当前绑定的 preset 上下文。
2. WHEN 用户在会话进行中切换配置文件或模型 THEN System SHALL 让后续消息按新的绑定执行。
3. WHEN 队列自动续跑下一条消息 THEN System SHALL 继续复用同一 preset 上下文。
4. WHEN 会话恢复或应用重启后重新接管该会话 THEN System SHALL 使用该会话已保存的 preset 上下文，而不是当前全局默认 preset。

### 6.4 允许切换 preset，但必须更新会话绑定

1. WHEN 会话已经创建 THEN System SHALL 允许在会话页模型位置切换 preset。
2. WHEN 用户切换 preset 后继续同一话题 THEN System SHALL 更新该 session 的 provider 绑定，而不是只改前端本地状态。
3. WHEN 前端展示会话当前 preset THEN 该信息 SHALL 与 Host 持久化状态保持一致，刷新后不能丢。

### 6.5 设置页全局切换能力必须继续保留，但语义要收窄

1. WHEN 用户进入设置页模型管理区域 THEN System SHALL 继续允许其切全局当前 preset。
2. WHEN 用户未在会话里显式选择 preset THEN 新会话和旧会话 SHALL 继续使用当前全局默认 preset。
3. WHEN 用户已在会话里显式选择 preset THEN 之后全局切换 SHALL NOT 反向污染这个会话。

### 6.6 显式 model 参数必须保持现有优先级

1. WHEN 会话发送请求显式传入 `model` THEN System SHALL 继续按显式 `model` 执行。
2. WHEN 会话未显式传入 `model` THEN System SHALL 允许 provider 走该 preset 的默认模型。
3. WHEN 用户切换全局 preset THEN System SHALL NOT 强行改写已有会话里已经显式选择的 `model`。

### 6.7 只有三家 provider 进入这次能力范围

1. WHEN 当前 provider 为 `codex` THEN System SHALL 支持会话级 preset 绑定。
2. WHEN 当前 provider 为 `claude-code` THEN System SHALL 支持会话级 preset 绑定。
3. WHEN 当前 provider 为 `gemini` THEN System SHALL 支持会话级 preset 绑定。
4. WHEN 当前 provider 为 `opencode` 或 `kimi` THEN System SHALL 明确不走这套逻辑。

## 7. 非功能需求

### 7.1 兼容性

1. 不得破坏现有未显式选择 preset 的会话创建链路。
2. 不得破坏现有设置页全局模型切换链路。
3. 不得破坏现有显式 `model` 参数优先级。

### 7.2 可恢复性

1. WHEN 会话已绑定 preset THEN 服务重启后 SHALL 能根据持久化信息继续运行。
2. WHEN `runtimeHomeDir` 或会话运行上下文缺失 THEN System SHALL 返回明确错误，而不是默默退回当前全局默认配置。

### 7.3 最小复杂度

1. System SHALL 优先复用现有 `session_bindings`、会话创建接口和 provider runtime。
2. System SHALL 不为了本次需求再造第二套“provider 会话真相”。
3. System SHALL 不把完整敏感配置原样暴露给前端或日志。

## 8. 验收重点

1. `Codex`、`Claude Code`、`Gemini` 会话在原有模型位置可以直接选择 preset。
2. 会话创建成功后能稳定记住自己的 `providerPresetId` 和运行上下文。
3. 会话进行中切换 preset 后，后续消息立刻按新配置执行。
4. 同一 provider 下两个不同 preset 的会话可以并行存在，互不踩配置。
5. 旧会话恢复时不会被当前全局默认 preset 偷偷污染。
6. 设置页全局切换能力仍然可用，但不会反向污染显式绑定 preset 的会话。
