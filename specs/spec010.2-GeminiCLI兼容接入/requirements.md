# 需求文档 - spec010.2-GeminiCLI兼容接入

状态：Draft

## 简介

这个 Spec 解决的是 `Gemini CLI` 接入时最容易犯蠢的地方。

现在我们已经知道两件事：

1. `Gemini CLI` 官方已经提供了正式的程序化入口，至少包括 `ACP`、`headless --output-format stream-json`、`--resume`、`--list-sessions`
2. 社区项目 `siteboon/claudecodeui` 已经证明 Gemini 在工程上能接进 UI，但它混用了官方会话目录和自建 sessionManager，两套真相掺在一起

这就意味着：

- Gemini 不是“完全不可接”
- 但也不能因为别人跑通了，就把一堆权宜之计原样抄过来

当前项目真正要做的是把 Gemini 纳入统一 provider 契约，同时守住两条底线：

- 原生 `providerSessionId` 必须始终对应 Gemini 官方原生 session id
- 项目不能再扩大 provider 名字硬编码

## 已确认的现实前提

基于 2026-04-02 联网查到的官方资料和参考项目，已经确认：

- Gemini 官方文档公开了 `ACP Mode`
- Gemini 官方文档公开了 `Headless mode`，支持 `--output-format stream-json`
- Gemini 官方文档公开了 `Session management`，支持 `--resume`、`--list-sessions`
- Gemini 官方文档公开了会话落盘目录 `~/.gemini/tmp/<project_hash>/chats/`
- 但 Gemini 官方没有把该目录下 JSON 文件格式承诺成稳定公共 schema
- 参考项目 `siteboon/claudecodeui` 已验证：
  - 可以从 `init` 事件中拿到原生 `session_id`
  - 可以从本地 chats 目录读历史
  - 也额外维护了一套自建会话缓存，这部分不适合直接搬进当前项目

一句话说清楚：Gemini 能接，而且能接得比较完整，但必须分清官方协议、官方落盘和第三方项目自己的补账逻辑。

## 术语表

- **Gemini ACP**：Gemini 官方提供的 Agent Client Protocol 模式，用于程序化控制会话
- **Gemini Headless**：Gemini 官方提供的无交互命令模式，可输出 `stream-json`
- **Gemini Native Session ID**：Gemini 官方原生会话 ID，由 Gemini 自己生成和识别
- **Gemini Local Chats**：Gemini 在 `~/.gemini/tmp/<project_hash>/chats/` 下的本地会话文件
- **Primary Path（主接入链路）**：运行期优先依赖的正式链路，这里是 `ACP`
- **Fallback Path（兜底链路）**：主链路不可用时用于降级、排障或兼容的辅助链路，这里是 `headless stream-json`
- **Discovery Path（发现链路）**：会话发现和历史回读使用的链路，这里是 `Session management + 本地 chats 目录`

## 范围说明

### In Scope

- 定义 Gemini provider 的正式接入边界
- 定义 Gemini `ACP`、`headless`、本地会话目录三条链路的使用优先级
- 定义 Gemini 会话发现、历史读取、实时运行和中断策略
- 定义 Gemini 能力描述和降级规则
- 定义 Gemini fixture、回归和验收策略
- 定义当前仓库里必须拆掉的 Gemini 接入障碍

### Out of Scope

- 一次性实现 Gemini 全部高级 UI
- 引入第三方自建 Gemini 会话缓存体系
- 假定 Gemini 内部 chats JSON 永远不会变化
- 在本 Spec 内直接完成所有代码实现

## 需求

### 需求 1：Gemini 必须作为正式 provider 接入，而不是旁路功能

**用户故事：** 作为系统维护者，我希望 Gemini 通过统一 provider 契约接入，以便后续维护不会再多一套特殊分支。

#### 验收标准

1. WHEN 新增 Gemini provider THEN System SHALL 允许其通过统一 provider 注册机制接入。
2. WHEN Gemini 接入 THEN System SHALL 不要求继续在主流程里新增 `provider === "gemini"` 的散落硬编码。
3. WHEN 现有公共抽象不足以承载 Gemini THEN System SHALL 先补抽象，再接 Gemini。

### 需求 2：Gemini 运行时主链路必须优先走官方 ACP

**用户故事：** 作为接入开发者，我希望 Gemini 的实时运行能力建立在官方正式协议上，而不是靠脆弱的命令拼接和输出猜测。

#### 验收标准

1. WHEN 系统新建或恢复 Gemini 会话 THEN System SHALL 优先通过 Gemini 官方 `ACP` 完成。
2. WHEN `ACP` 暂时不可用或不满足某项功能 THEN System SHALL 允许回退到 `headless --output-format stream-json`。
3. WHEN Gemini 运行时链路降级 THEN System SHALL 明确记录当前走的是 fallback，而不是静默切换。

### 需求 3：Gemini 历史与会话发现必须绑定官方原生 session id

**用户故事：** 作为平台开发者，我希望项目里的 Gemini 会话始终绑定官方原生 session id，以便不会出现第二套会话真相。

#### 验收标准

1. WHEN 系统发现 Gemini 会话 THEN System SHALL 使用 Gemini 原生 session id 作为 `providerSessionId`。
2. WHEN 系统读取 Gemini 历史 THEN System SHALL 优先利用官方会话管理能力和本地官方会话目录，而不是自造会话缓存。
3. WHEN 项目会话与 Gemini 原生会话建立绑定 THEN System SHALL 保留稳定 `rawStoreRef` 和 `rawRef`。

### 需求 4：Gemini 消息与能力差异必须通过统一模型和 capability 暴露

**用户故事：** 作为前端开发者，我希望 Gemini 的能力差异继续走统一 capability，而不是把 UI 再写成 provider if/else 垃圾堆。

#### 验收标准

1. WHEN Gemini 支持中断、权限模式、模型切换等能力 THEN System SHALL 通过 capability descriptor 暴露。
2. WHEN Gemini 某些能力当前项目先不交付，例如图片附件原生支持不明确 THEN System SHALL 在 capability 中明确说明限制。
3. WHEN 老客户端未识别 Gemini 新字段 THEN System SHALL 允许其安全忽略，不破坏基础会话能力。

### 需求 5：Gemini 接入不能破坏现有 Claude/Codex/OpenCode 运行时语义

**用户故事：** 作为现有系统维护者，我希望引入 Gemini 时不会把已经工作的 provider 顺手打坏。

#### 验收标准

1. WHEN 接入 Gemini THEN System SHALL 不破坏现有 provider 的会话发现、历史读取、实时运行和发送队列行为。
2. WHEN Gemini 的运行中输入语义与现有 provider 不同 THEN System SHALL 通过能力和策略显式表达。
3. WHEN Gemini 扩展公共字段 THEN System SHALL 保持旧链路兼容。

### 需求 6：Gemini 接入必须明确哪些做主链路，哪些只是兼容层

**用户故事：** 作为维护者，我希望 Gemini 接入边界清楚，避免以后连自己都分不清哪些是官方协议、哪些只是补丁。

#### 验收标准

1. WHEN Gemini 使用 `ACP` THEN System SHALL 标记为主运行时链路。
2. WHEN Gemini 使用 `headless stream-json` THEN System SHALL 标记为运行时 fallback。
3. WHEN Gemini 使用本地 chats 目录 THEN System SHALL 仅用于会话发现、历史读取、排障和 fixture，不当成运行时事件真相。
4. WHEN 评估参考项目实现 THEN System SHALL 允许借鉴其历史读取和事件归一化思路，但 SHALL NOT 引入其自建 sessionManager 作为主真相。

### 需求 7：Gemini 必须有真实样本和回归

**用户故事：** 作为维护者，我希望 Gemini 的接入建立在真实官方会话样本和运行时样本上，而不是凭感觉写 adapter。

#### 验收标准

1. WHEN 启动 Gemini 接入 THEN System SHALL 基于真实本地 chats 样本和真实运行事件提取 fixture。
2. WHEN Gemini 官方输出格式或本地会话结构发生变化 THEN System SHALL 通过 fixture 回归尽快发现差异。
3. WHEN 样本覆盖不到关键场景，例如 `ACP` 新建、恢复、取消、headless fallback THEN System SHALL 不允许标记为完成接入。

### 需求 8：Gemini 排障必须能区分 ACP、headless 和本地 chats 三层问题

**用户故事：** 作为维护者，我希望 Gemini 出问题时能快速看出是官方协议坏了、fallback 坏了，还是本地历史读取坏了。

#### 验收标准

1. WHEN Gemini 解析失败或运行失败 THEN System SHALL 记录 provider、session id、错误码、链路来源和原始引用。
2. WHEN 历史读取失败 THEN System SHALL 能区分是本地 chats 找不到、schema 变化还是原生 session id 不匹配。
3. WHEN 前端展示异常 THEN System SHALL 能追踪到当前 capability 输出和运行时来源。

## 非功能需求

### 非功能需求 1：可靠性

1. WHEN `ACP` 暂时不可用 THEN System SHALL 至少保证 Gemini fallback 运行时和历史读取链路可用。
2. WHEN Gemini 单独出兼容性问题 THEN System SHALL 不影响其他 provider 主链路。

### 非功能需求 2：可维护性

1. WHEN Gemini 接入完成 THEN System SHALL 把主要改动收敛在 provider 抽象层、Gemini provider 目录、capability 扩展和前端门控层。
2. WHEN 后续再加新 provider THEN System SHALL 尽量复用这次为 Gemini 补齐的公共抽象。

### 非功能需求 3：可观测性

1. WHEN Gemini 运行异常 THEN System SHALL 输出可检索的 provider 级日志和结构化错误。
2. WHEN fixture 执行失败 THEN System SHALL 输出差异详情，而不是只报一句“失败”。

## 成功定义

- Gemini 能作为正式 provider 接入，而不是旁路命令功能
- 项目会话始终绑定 Gemini 原生 session id，不引入第二套会话真相
- Gemini 运行时优先走官方 `ACP`，fallback 边界清楚
- Gemini 本地 chats 样本可沉淀为 fixture，并支撑后续回归
- 前端继续按 capability 做门控，不出现新一轮 provider 特判泛滥
