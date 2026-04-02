# 需求文档 - spec010.3-KimiCLI兼容接入

状态：Draft

## 简介

这个 Spec 解决的是 `Kimi CLI` 接入时最容易被误判的地方。

和 Gemini 不一样，Kimi 官方对本地数据位置和程序化协议公开得更直接。基于 2026-04-02 联网查到的官方资料，已经能确认：

- Kimi 官方公开了本地会话数据目录
- Kimi 官方公开了 `wire mode`
- Kimi 官方公开了 `--continue`、`--session/--resume`、`--print --output-format stream-json`
- Kimi 官方公开了 `config.toml`、provider 和 model 配置

这很重要，因为它意味着：

- Kimi 不是只能通过终端抓屏硬接
- Kimi 可以更自然地契合当前项目的 `ProviderAdapter + ProviderRuntimeAdapter` 设计

一句话说清楚：Kimi 是一条更白盒的 provider，理论上比 Gemini 更适合做“规范接入”。

## 已确认的现实前提

基于 2026-04-02 官方资料，已经确认：

- Kimi 会话目录位于 `~/.kimi/sessions/<work-dir-hash>/<session-id>/`
- 目录下存在 `context.jsonl`、`wire.jsonl`、`state.json`
- Kimi 官方公开了 `wire mode`
- Kimi 官方公开了 `--print --output-format stream-json`
- Kimi 官方公开了继续会话相关参数
- Kimi 官方公开了 `config.toml` 和 provider/model 配置文件

这意味着 Kimi 至少有三层可用面：

1. `wire mode` 适合作为运行时主链路
2. 命令模式适合作为 fallback
3. 本地会话目录适合作为会话发现、历史读取和 fixture 来源

## 术语表

- **Kimi Wire Mode**：Kimi 官方提供的程序化协议模式
- **Kimi Native Session ID**：Kimi 官方原生会话 ID
- **Kimi Local Session Store**：`~/.kimi/sessions/<hash>/<session-id>/` 下的本地会话结构
- **Kimi Context Log**：`context.jsonl`
- **Kimi Wire Log**：`wire.jsonl`
- **Primary Path（主接入链路）**：运行期优先依赖的正式链路，这里是 `wire mode`
- **Fallback Path（兜底链路）**：主链路不可用时回退到命令模式和 `stream-json`
- **Discovery Path（发现链路）**：本地会话目录及状态文件

## 范围说明

### In Scope

- 定义 Kimi provider 的正式接入边界
- 定义 Kimi `wire mode`、命令模式、本地会话目录三条链路的使用优先级
- 定义 Kimi 会话发现、历史读取、实时运行、中断和运行中引导策略
- 定义 Kimi capability descriptor 和降级规则
- 定义 Kimi fixture、回归和验收策略
- 定义当前仓库里必须拆掉的 Kimi 接入障碍

### Out of Scope

- 一次性实现 Kimi 所有高级 UI
- 重做当前统一消息主模型
- 在本 Spec 内直接完成全部代码实现
- 假装 Kimi 和 Claude/Codex 的运行时语义完全一样

## 需求

### 需求 1：Kimi 必须作为正式 provider 接入

**用户故事：** 作为系统维护者，我希望 Kimi 走统一 provider 契约接入，而不是再加一套旁路逻辑。

#### 验收标准

1. WHEN 新增 Kimi provider THEN System SHALL 允许其通过统一 provider 注册机制接入。
2. WHEN Kimi 接入 THEN System SHALL 不要求继续在主流程里新增散落 `provider === "kimi"` 判断。
3. WHEN 公共抽象不足以承载 Kimi THEN System SHALL 先补抽象，再接 Kimi。

### 需求 2：Kimi 运行时主链路必须优先走官方 wire mode

**用户故事：** 作为接入开发者，我希望 Kimi 的实时运行建立在官方程序化协议上，而不是靠 PTY 输出猜状态。

#### 验收标准

1. WHEN 系统新建、恢复或继续 Kimi 会话 THEN System SHALL 优先通过 `wire mode` 完成。
2. WHEN `wire mode` 暂时不可用 THEN System SHALL 允许回退到命令模式和 `stream-json`。
3. WHEN 运行时链路降级 THEN System SHALL 明确记录 fallback 来源。

### 需求 3：Kimi 历史与会话发现必须绑定官方原生 session id

**用户故事：** 作为平台开发者，我希望项目会话始终绑定 Kimi 原生会话 ID，而不是再造一层伪会话。

#### 验收标准

1. WHEN 系统发现 Kimi 会话 THEN System SHALL 使用 Kimi 原生 session id 作为 `providerSessionId`。
2. WHEN 系统读取 Kimi 历史 THEN System SHALL 优先利用官方本地会话目录中的真实数据。
3. WHEN 任意一条归一化消息被输出 THEN System SHALL 保留稳定 `rawStoreRef` 和 `rawRef`。

### 需求 4：Kimi 的运行中引导和提问能力必须有清晰映射

**用户故事：** 作为产品和前端开发者，我希望 Kimi 的运行中输入、提问或引导能力能在现有系统里有稳定位置，而不是被静默吞掉。

#### 验收标准

1. WHEN Kimi 原生支持运行中引导或提问 THEN System SHALL 通过 `inRunInputMode`、permission/request 模型或可兼容扩展字段表达。
2. WHEN 某项能力第一阶段不做完整 UI THEN System SHALL 明确标注限制，不伪装成完全支持。
3. WHEN 老客户端未识别 Kimi 扩展字段 THEN System SHALL 允许其安全忽略。

### 需求 5：Kimi 接入不能破坏现有 provider 运行时语义

**用户故事：** 作为现有系统维护者，我希望引入 Kimi 时不会把已经跑通的几家 provider 顺手打坏。

#### 验收标准

1. WHEN 接入 Kimi THEN System SHALL 不破坏现有 provider 的会话发现、历史读取、实时运行和发送队列行为。
2. WHEN Kimi 的运行中输入语义不同 THEN System SHALL 通过统一能力和策略表达。
3. WHEN Kimi 扩展公共字段 THEN System SHALL 保持旧链路兼容。

### 需求 6：Kimi 主链路、fallback 和本地样本来源必须分层明确

**用户故事：** 作为维护者，我希望 Kimi 接入后每一层都边界清楚，别把运行时、历史和排障搅成一锅粥。

#### 验收标准

1. WHEN Kimi 使用 `wire mode` THEN System SHALL 标记为主运行时链路。
2. WHEN Kimi 使用命令模式 THEN System SHALL 标记为 fallback。
3. WHEN 系统读取本地 `context.jsonl`、`wire.jsonl`、`state.json` THEN System SHALL 将其视作历史、发现和 fixture 来源，而不是运行时主真相。

### 需求 7：Kimi 必须有真实样本和回归

**用户故事：** 作为维护者，我希望 Kimi 的接入建立在真实会话样本和真实运行事件上，而不是凭想象写 adapter。

#### 验收标准

1. WHEN 启动 Kimi 接入 THEN System SHALL 基于真实本地会话目录和真实 `wire mode` 事件提取 fixture。
2. WHEN Kimi 官方输出格式或本地数据结构发生变化 THEN System SHALL 通过 fixture 回归尽快发现差异。
3. WHEN 样本覆盖不到关键场景，例如新建、恢复、运行中引导、中断 THEN System SHALL 不允许标记为完成接入。

### 需求 8：Kimi 排障必须能区分 wire、命令模式和本地会话三层问题

**用户故事：** 作为维护者，我希望 Kimi 出问题时能快速看出是主协议坏了、fallback 坏了，还是历史读取坏了。

#### 验收标准

1. WHEN Kimi 解析失败或运行失败 THEN System SHALL 记录 provider、session id、错误码、链路来源和原始引用。
2. WHEN 历史读取失败 THEN System SHALL 能区分是 `context.jsonl`、`wire.jsonl`、`state.json` 哪层出了问题。
3. WHEN 前端展示异常 THEN System SHALL 能追踪到当前 capability 输出和运行时来源。

## 非功能需求

### 非功能需求 1：可靠性

1. WHEN `wire mode` 暂时不可用 THEN System SHALL 至少保证 fallback 和历史读取可用。
2. WHEN Kimi 单独出兼容性问题 THEN System SHALL 不影响其他 provider 主链路。

### 非功能需求 2：可维护性

1. WHEN Kimi 接入完成 THEN System SHALL 把主要改动收敛在 provider 抽象层、Kimi provider 目录、capability 扩展和前端门控层。
2. WHEN 后续新增 provider THEN System SHALL 尽量复用这次为 Kimi 补齐的公共抽象。

### 非功能需求 3：可观测性

1. WHEN Kimi 运行异常 THEN System SHALL 输出可检索的 provider 级日志和结构化错误。
2. WHEN fixture 执行失败 THEN System SHALL 输出差异详情，而不是只报“失败”。

## 成功定义

- Kimi 能作为正式 provider 接入
- 项目会话始终绑定 Kimi 原生 session id
- Kimi 运行时优先走官方 `wire mode`
- 本地会话目录可作为规范历史和 fixture 来源
- 前端继续按 capability 做门控，不扩大 provider 特判范围
