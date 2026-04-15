# 需求文档 - spec001.7-设置页模型快速切换与CC-SWITCH接入

状态：Draft

## 简介

现在项目里有两头脱节：

- CodingNS 会话侧已经支持“跟随 CLI 默认模型”，说明系统知道“默认模型”这件事是真存在的
- 但设置页没有一个正式入口去统一切换 `codex`、`claude code`、`gemini`、`opencode` 的默认模型

用户真正想要的是：

1. 在一个地方看到四个 CLI 现在各自用的是什么模型
2. 点一下就切过去，不再去终端里手敲命令
3. 切完以后会话页和后续新会话能尽快看到变化

这里还有一个必须面对的现实：

- `cc-switch` 当前稳定暴露的非交互命令，核心是 provider 预设切换
- 它不是一个已经成型的“直接设置模型 ID”公共 API

所以第一期不能自欺欺人地写成“万能模型编辑平台”。

第一期真正要解决的问题是：
把“模型预设快速切换”做成一个可靠的设置页能力，并且诚实展示哪些应用可切、哪些当前没有配置。

## 术语表

- **Model Preset（模型预设）**：`cc-switch` 里已经存在的一条 provider 配置项。它通常同时包含 API 地址、认证信息和默认模型。第一期的“快速切换模型”本质上就是切到不同预设。
- **Current Preset（当前预设）**：某个应用当前已经生效的 `cc-switch` provider 配置。
- **Current Model（当前模型）**：从当前预设里尽可能提取出的默认模型标识；如果读不到，就明确返回未知，不装懂。
- **CC-Switch Adapter（CC-Switch 适配层）**：Host 内部负责读取本机 `cc-switch` 状态、执行切换命令、屏蔽存储细节的服务。
- **Unavailable State（不可用状态）**：包括 CLI 不存在、未配置当前预设、无可切换项、读取失败等情况。
- **Provider Capabilities（Provider 能力）**：CodingNS 现有会话侧能力接口，包含“跟随 CLI 默认模型”的可选项和部分真实模型列表。

## 范围说明

### In Scope

- 设置页增加模型管理入口
- 支持 `codex`、`claude-code`、`gemini`、`opencode` 四个应用的状态展示
- Host 通过 `cc-switch` 和本地状态源读取当前预设与可切换列表
- 用户点击后执行切换，并返回切换后的最新快照
- 切换后刷新会话侧相关显示，让“跟随 CLI 默认模型”的信息尽快同步

### Out of Scope

- 模型新增、编辑、删除
- provider 新增、编辑、删除
- 自动抓远端模型列表后直接改写预设
- 在会话运行中强制替换当前 run 的显式模型参数
- 让移动端或 Web 直接绕过 Host 调本地命令

## 需求

### 需求 1：设置页必须提供统一的模型管理入口

**用户故事：** 作为用户，我希望在设置页里统一查看和切换四个 CLI 的默认模型，而不是每个工具自己藏一套入口。

#### 验收标准

1. WHEN 用户进入设置页 THEN System SHALL 提供独立的模型管理区域，而不是把入口散落在会话页或调试页。
2. WHEN 用户使用桌面端或移动端设置页 THEN System SHALL 都能进入模型管理区域。
3. WHEN 模型管理区域加载完成 THEN System SHALL 同时展示 `codex`、`claude-code`、`gemini`、`opencode` 四个应用的状态卡片。

### 需求 2：系统必须能读取每个应用当前预设和可切换项

**用户故事：** 作为用户，我希望先看清楚当前在用什么，再决定切什么。

#### 验收标准

1. WHEN Host 成功读取某个应用的 `cc-switch` 状态 THEN System SHALL 返回当前预设、当前模型和可切换项列表。
2. WHEN 当前模型无法从预设中可靠提取 THEN System SHALL 明确返回“未知”或等价状态，而不是瞎猜。
3. WHEN 某个应用当前没有配置预设 THEN System SHALL 返回“未配置”，并且不显示伪造的当前模型。
4. WHEN 某个应用没有任何可切换项 THEN System SHALL 返回空列表和明确原因。

### 需求 3：模型切换动作必须通过 Host 调用 `cc-switch`

**用户故事：** 作为系统维护者，我希望切换动作走一条稳定、受控、可审计的链路，而不是前端各显神通。

#### 验收标准

1. WHEN 用户在设置页点击某个预设 THEN System SHALL 由 Host 执行切换，而不是前端直接调用本地 CLI。
2. WHEN Host 执行切换 THEN System SHALL 调用 `cc-switch provider switch -a <app> <id>` 或等价受控命令。
3. WHEN 切换成功 THEN System SHALL 返回切换后的最新状态快照，而不是只回一个“ok”。
4. WHEN 切换失败 THEN System SHALL 返回明确错误，不把失败伪装成未变化。

### 需求 4：界面必须明确展示可用、不可用和失败状态

**用户故事：** 作为用户，我希望知道是“还没配置”，还是“命令找不到”，还是“切换失败”，而不是看到一个灰按钮猜半天。

#### 验收标准

1. WHEN `cc-switch` 命令不存在 THEN System SHALL 明确返回命令不可用状态。
2. WHEN 本机有 `cc-switch`，但某个应用没有预设 THEN System SHALL 明确显示该应用未配置。
3. WHEN 读取状态失败 THEN System SHALL 把失败原因展示为可读错误，而不是空白面板。
4. WHEN 某个应用当前不可切换 THEN System SHALL 禁用切换按钮并说明原因。

### 需求 5：切换后必须尽快反映到现有“跟随 CLI 默认模型”链路

**用户故事：** 作为用户，我希望切完以后新的会话和相关下拉能尽快看到变化，而不是还停留在旧值。

#### 验收标准

1. WHEN 某个应用切换成功 THEN System SHALL 能让设置页立即显示新的当前预设和当前模型。
2. WHEN 当前应用在会话页使用“跟随 CLI 默认模型” THEN System SHALL 在合理时间内刷新相关显示，不长期停留旧状态。
3. WHEN 某个会话显式指定了模型 THEN System SHALL 不因为全局切换而强行改写该会话的显式参数。

### 需求 6：返回给前端的数据必须去敏感化

**用户故事：** 作为系统维护者，我希望模型管理功能不会顺手把密钥和完整配置文本暴露给前端。

#### 验收标准

1. WHEN Host 返回模型管理数据 THEN System SHALL 只返回展示和切换所需字段。
2. WHEN 预设内部包含 API key、token 或完整配置文本 THEN System SHALL 不把这些内容返回给前端。
3. WHEN 记录错误或日志 THEN System SHALL 不把敏感配置直接打印到日志里。

## 非功能需求

### 非功能需求 1：可靠性

1. WHEN Host 读取 `cc-switch` 状态 THEN System SHALL 优先使用结构化状态源，不依赖解析给人看的表格输出。
2. WHEN Host 执行切换 THEN System SHALL 在命令返回后重新读取状态，确认切换结果。
3. WHEN 某个应用当前状态未知 THEN System SHALL 允许其他应用继续展示，不因为一个应用失败把整个面板打死。

### 非功能需求 2：可维护性

1. WHEN 新增模型管理能力 THEN System SHALL 复用现有 `routes -> controller -> service` 和设置页面板模式。
2. WHEN `cc-switch` 的存储细节变化 THEN System SHALL 尽量只影响适配层，而不是把解析逻辑散到前后端各处。
3. WHEN 后续要做“模型新增/编辑” THEN System SHALL 可以在本 Spec 之上追加，而不是推翻第一期结构。

### 非功能需求 3：兼容性

1. WHEN 用户继续通过终端手工使用 `cc-switch` THEN System SHALL 不破坏这条原有工作流。
2. WHEN 会话显式传入 `model` 参数 THEN System SHALL 保持现有行为，不被全局预设切换偷偷覆盖。
3. WHEN 当前机器上只有部分 CLI 已配置 THEN System SHALL 允许部分可用、部分不可用，而不是要求四个应用一次性都准备好。

## 成功定义

- 设置页里有正式的模型管理入口
- 用户能在一个地方看到四个应用的当前预设和当前模型
- 用户能通过图形化方式完成预设切换
- 切换动作走 Host 和 `cc-switch` CLI，不靠前端直接调本地命令
- 新切换结果能尽快反映到“跟随 CLI 默认模型”的现有链路
- 敏感配置不会被前端接口和日志顺手泄漏
