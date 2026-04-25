# 设计文档 - spec003.6 会话级CC-Switch预设选择

状态：Draft

## 1. 概述

### 1.1 目标

- 在不推翻现有 `spec003.*` 会话运行时主链路的前提下，补上“会话级 provider preset 绑定”
- 让 `Codex`、`Claude Code`、`Gemini` 在会话页原有模型位置直接选择 `cc-switch` 预设
- 让会话后续继续发送、续跑、恢复都绑定回当前 preset 上下文
- 保留设置页的全局切换能力，但把它收窄成“默认 preset 管理”

### 1.2 覆盖需求

- `requirements.md` 需求 6.1：会话页选择 preset
- `requirements.md` 需求 6.2：持久化 preset 绑定
- `requirements.md` 需求 6.3：继续发送复用原 preset
- `requirements.md` 需求 6.4：会话内切换后更新绑定
- `requirements.md` 需求 6.5：保留全局切换但语义收窄
- `requirements.md` 需求 6.6：保持显式 model 优先级
- `requirements.md` 需求 6.7：只覆盖 `codex / claude-code / gemini`

### 1.3 技术约束

- 继续复用现有 `SessionController`、`SessionLiveRuntimeService`、`SessionBindingRepository`
- 继续复用现有 `cc-switch` 适配层读取预设列表
- 不允许前端直接调用本地 `cc-switch`
- 不允许通过“临时切全局 preset 再开会话”的方式冒充会话级能力
- `OpenCode` 和 `Kimi` 不接入本次设计

## 2. 核心设计

### 2.1 先把数据结构改对

现在项目里缺的不是按钮，是正式的数据模型。

当前 `session_bindings` 只有：

- `sessionId`
- `workspaceId`
- `provider`
- `providerSessionId`
- `rawStoreRef`

这意味着系统只知道“这个 session 对应哪个 provider 会话”，但不知道“这个 session 当时是用哪个 preset 启动的”。

本次先补一个正式模型：

```ts
type SessionProviderConfigMode = "global-default" | "cc-switch-preset";

interface SessionProviderBinding {
  providerConfigMode: SessionProviderConfigMode;
  providerPresetId: string | null;
  runtimeHomeDir: string | null;
}
```

语义：

- `global-default`
  旧行为，继续依赖 provider 当前全局默认配置
- `cc-switch-preset`
  新行为，会话显式绑定到一个 preset，并有对应的 `runtimeHomeDir`

### 2.2 不改新建会话入口，部署选择收在会话页模型位置

这是这次设计最重要的取舍。

用户已经把需求说得很清楚：

1. 新建会话入口保持原样，不再多长一层 preset 入口
2. 会话页原来选模型的位置改成双列部署选择
3. 会话里改完配置文件和模型，后续消息立刻按新的绑定执行

关键点不是“能不能切”，而是“切了以后 Host 有没有正式更新会话绑定”。

所以本次明确：

1. 不改新建会话入口逻辑
2. 允许在会话页切换 preset 和 model
3. 每次发送都按当前 deployment 选择把绑定写回 session
4. 页面刷新或恢复后，继续从持久化绑定恢复当前 deployment

### 2.3 运行上下文不直接存敏感配置，存受控目录引用

Host 不应该把 `cc-switch` 里的完整 `settings_config` 原样塞到数据库里。

正确做法是：

1. 创建会话前，Host 从 `cc-switch` 读取目标 preset
2. Host 为当前 session 生成一个专属 `runtimeHomeDir`
3. Host 把这个 preset 需要的配置 materialize 到该目录
4. 数据库只记录：
   - `providerPresetId`
   - `providerConfigMode`
   - `runtimeHomeDir`

这样做的好处：

- 运行时可以稳定复用这个目录
- 敏感配置不必原样返回前端
- 会话恢复时有明确落点

## 3. 模块与职责

### 3.1 模块划分

| 模块 | 新职责 |
| --- | --- |
| `cc-switch-adapter` | 读取 preset 快照；新增按 preset 构造运行配置所需的安全输入 |
| `session-provider-config-service` | 新增，会话创建时根据 preset 生成 `runtimeHomeDir` |
| `SessionController` | 接受 `providerPresetId / providerConfigMode` |
| `SessionLiveRuntimeService` | 创建和继续会话时解析并使用 session 自己的运行上下文 |
| `SessionBindingRepository` | 持久化 preset 绑定和 `runtimeHomeDir` |
| `user-app` 会话页与会话相关弹框 | 展示 deployment 选择器并提交创建参数 |

### 3.2 为什么要单独有 `session-provider-config-service`

不能把“读 preset”和“创建会话目录”直接揉到 controller 里。

这一步的真实职责是：

1. 校验当前 provider 是否允许走会话级 preset
2. 校验 preset 是否存在
3. 按 provider 生成 session 专属 `runtimeHomeDir`
4. 返回一个安全的 `SessionProviderRuntimeContext`

这样后续 `SessionLiveRuntimeService` 只需要消费结果，不需要自己再懂 `cc-switch` 的内部存储细节。

## 4. 数据结构和接口

### 4.1 数据库字段扩展

扩展 `session_bindings`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `provider_config_mode` | string | `global-default` 或 `cc-switch-preset` |
| `provider_preset_id` | string nullable | 绑定的 preset id |
| `runtime_home_dir` | string nullable | 会话专属 provider 运行目录 |

兼容策略：

- 旧数据统一回填为：
  - `provider_config_mode = global-default`
  - `provider_preset_id = null`
  - `runtime_home_dir = null`

### 4.2 会话创建和继续发送接口扩展

扩展 `POST /api/sessions/start-live`、`POST /api/sessions/:id/messages/live`，以及 fork / 并行会话等会触发新会话创建的等价入口：

```ts
interface StartLiveSessionBody {
  workspaceId?: string;
  provider?: string;
  content?: string;
  clientRequestId?: string;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
  providerConfigMode?: "global-default" | "cc-switch-preset";
  providerPresetId?: string | null;
}
```

规则：

1. 默认不传，等价于旧行为
2. 只有 `codex / claude-code / gemini` 接受 `cc-switch-preset`
3. `providerConfigMode = cc-switch-preset` 时，`providerPresetId` 必填

### 4.3 会话详情返回字段

前端至少需要拿到只读展示字段：

```ts
interface SessionProviderConfigSummary {
  providerConfigMode: "global-default" | "cc-switch-preset";
  providerPresetId: string | null;
  providerPresetName: string | null;
}
```

前端不需要拿到：

- 完整 `settings_config`
- token
- endpoint 明文全文

## 5. 关键流程

### 5.1 会话页显式选择 deployment

1. 前端先读取 provider preset 列表
2. 用户在会话页模型位置选定 provider preset 和 model
3. 前端调用 `start-live` 或继续发送接口
4. Host 校验 provider 与 preset
5. Host 生成或复用 `runtimeHomeDir`
6. Host 写入或更新 session binding
7. Host 用该 `runtimeHomeDir` 拉起 provider runtime

### 5.2 未显式选择时继续走全局默认 preset

1. 前端不传 `providerPresetId`
2. Host 记为 `providerConfigMode = global-default`
3. 运行时继续使用现有全局 `homeDir`

### 5.3 已有会话继续发送

1. Host 按 `sessionId` 读取 binding
2. 前端如果显式传了新的 deployment 选择，Host 先更新 binding
3. 若为 `global-default`，沿用旧行为
4. 若为 `cc-switch-preset`，必须取出 `runtimeHomeDir`
5. provider runtime 使用该目录继续发送

### 5.4 服务重启后恢复

1. Host 启动后读取 `session_bindings`
2. 旧会话若绑定 `runtimeHomeDir`，恢复时直接走该目录
3. 若目录丢失或损坏，明确报错，不允许静默退回当前全局默认配置

## 6. Provider 级实现策略

### 6.1 Claude Code

这是三家里最容易先落地的。

现状：

- Claude runtime 本来就是按 `homeDir` 工作
- helper process 启动时也能注入 `--home-dir`

方案：

1. 会话创建时生成 session 专属 Claude 配置目录
2. 把 preset 对应的配置 materialize 到该目录
3. `ClaudeRuntimeHelperAdapter` 不再只依赖全局单例目录，而是按 session 解析 `runtimeHomeDir`

结论：

- Claude 适合作为第一家打通的 provider

### 6.2 Gemini

Gemini 也能做，但要老实一点。

现状：

- Gemini runtime 启动时通过 `GEMINI_HOME` 指向运行目录
- 这说明它天然支持按进程切运行目录

方案：

1. 会话创建时生成 session 专属 Gemini 目录
2. 按 preset 输出 Gemini CLI 需要的配置文件或环境映射
3. `GeminiRuntimeAdapter` 继续吃 `homeDir`，只是来源从全局改成 session 级

结论：

- Gemini 结构上可行，但 materialize 规则必须按真实 CLI 行为实现，不能瞎猜

### 6.3 Codex

Codex 最脏，原因不在 adapter，而在 helper。

现状：

- Codex runtime 现在通过 `CodexAppServerHelperClient` 长驻进程工作
- 这个 helper 在构造时就把 `CODEX_HOME` 固定死了

如果继续用全局单例 helper，就不可能支持多个 preset 并行。

方案：

1. 把 Codex helper 从“全局单例”改成“按 active run 或按 session 创建”
2. helper 启动时带入该 session 的 `runtimeHomeDir`
3. run 结束后释放 helper，避免多个 preset 串线

结论：

- Codex 不能偷懒复用现有全局 helper
- 这一步是本次改造里唯一真正有结构调整的 provider

## 7. 前端方案

### 7.1 交互规则

仅在新建会话时展示 preset 选择器。

展示顺序：

1. 先选 provider
2. 再显示该 provider 的 preset 区域
3. 默认项是“使用当前默认 preset”
4. 可选项是该 provider 下 `cc-switch` 已存在的 preset 列表

### 7.2 展示规则

会话创建后：

- 会话头部或详情区显示当前 preset 名称
- 只读展示，不可直接编辑

`OpenCode` / `Kimi`：

- 不显示这套 preset 选择器

## 8. 风险与控制

### 8.1 最大风险

最大风险不是 UI，而是“恢复链路忘了读 session 自己的 `runtimeHomeDir`”。

如果这个点漏掉，就会出现：

- 第一次创建时看起来正常
- 第二次继续发送时悄悄回到全局默认 preset

这会把整个功能做成假的。

### 8.2 控制策略

1. 所有继续发送路径都必须只从 binding 取运行上下文
2. 任何缺少 `runtimeHomeDir` 的 preset 会话都明确报错
3. Codex helper 必须去全局单例化

## 9. 实施顺序

1. 先扩数据库与接口
2. 再做前端新建会话选择器
3. 先打通 Claude
4. 再打通 Gemini
5. 最后拆 Codex 全局 helper

这个顺序不是为了好看，是为了先把最稳的链路做成，再去拆最脏的那一块。
