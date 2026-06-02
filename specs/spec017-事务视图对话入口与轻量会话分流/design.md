# 设计文档 - spec017-事务视图对话入口与轻量会话分流

状态：Draft

## 1. 概述

### 1.1 目标

- 在事务模式左侧增加正式“对话”入口，并让中间主区支持事务对话页
- 复用代码模式现有聊天页样式，不再给事务模式单独画一套聊天页
- 把事务模式对话正式拆成两条轴：
  - 会话模式：轻量会话 / Agent 会话
  - provider 选择：Codex / Claude Code
- 保证轻量会话只在事务模式里可见，不污染代码模式 provider 入口
- 让 Agent 会话直接复用当前助手会话逻辑，并绑定当前文档库与当前事务对象
- 收口事务模式右侧助手面板与事务对话页之间的职责关系

### 1.2 覆盖需求

- `requirements.md` 需求 1：事务模式左侧正式对话入口
- `requirements.md` 需求 2：事务对话页复用代码模式聊天页样式
- `requirements.md` 需求 3：轻量会话 / Agent 会话正式分流
- `requirements.md` 需求 4：轻量会话不进入代码模式 provider 入口
- `requirements.md` 需求 5：Agent 会话复用当前助手会话逻辑
- `requirements.md` 需求 6：Agent 会话默认绑定当前文档库和当前事务对象
- `requirements.md` 需求 7：轻量会话能力边界
- `requirements.md` 需求 8：右侧助手面板与事务对话页职责分工
- `requirements.md` 需求 9：默认进入和空态规则

### 1.3 技术约束

- 前端修改范围锁定在 `apps/user-app`
- 新增或修改事务视图页面、列表、按钮、空态时，必须遵守前端设计规范
- 不允许把轻量会话做成代码模式新的 CLI provider 暴露面
- 不允许把“轻量 Codex”“轻量 Claude Code”注册成代码模式 provider catalog 新条目
- Agent 会话必须优先复用当前 Butler/助手运行时，不另起第二套重运行时
- 事务模式没有多工作区切换语义，默认绑定当前事务文档库工作区

## 2. 架构

### 2.1 系统结构

整体分成四块：

1. **事务左侧导航层**
   - 在文档库下方补“对话”入口
   - 继续保留文档库、待办、自动化等对象入口
   - 在对话入口下展示事务对话列表或当前会话摘要

2. **事务主区路由层**
   - 原来主区是对象页面
   - 新增“事务对话页”这个主区分支
   - 事务模式下的主区可以在“对象页”和“对话页”之间切换

3. **事务会话模式层**
   - 轻量会话：轻能力、快入口
   - Agent 会话：复用当前助手会话逻辑
   - 两者共用页面外壳，但运行时和初始化策略不同

4. **事务 provider 选择层**
   - 两种会话模式下都可选 `Codex` / `Claude Code`
   - provider 决定底层接哪家
   - 会话模式决定到底走轻链路还是完整助手链路

5. **事务助手复用层**
   - 把现有右侧 `AffairsAssistantPanel` 对应的 ButlerRuntimeStore/消息链路继续保留
   - Agent 会话主页面与右侧助手面板共享同一条会话状态源
   - 右侧面板收口为“辅助入口”，中间对话页收口为“完整主舞台”

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `AffairsWorkbenchView` | 承载事务左侧导航和主区切换 | 当前事务状态 | 对象页或事务对话页 |
| `AffairsConversationEntry` | 左侧“对话”入口与对话列表区块 | 当前工作区、当前事务状态 | 事务对话入口 UI |
| `AffairsConversationPage` | 事务模式正式对话页 | 会话模式、provider、会话 ID、当前事务上下文 | 对话主页面 |
| `AffairsConversationProviderPicker` | 事务模式 provider 选择器 | 当前会话模式、可见 provider 列表 | provider 选择 UI |
| `LightweightAffairsSessionBridge` | 轻量会话状态适配层 | 当前工作区、轻量会话 ID | 轻量消息流和能力边界 |
| `AffairsAgentSessionBridge` | Agent 会话复用适配层 | 当前工作区、当前对象、provider、Butler runtime | Agent 会话页面状态 |
| `AffairsAssistantPanel` | 右侧事务助手面板 | 当前对象、当前 Agent 会话 | 辅助面板 |

这里先把模块职责讲清楚，不把文件名写死。

意思很简单：

- 这轮必须把“谁负责什么”讲清楚
- 但不要求实现时一定长出同名文件
- 只要职责边界对，落地时可以继续复用现有 `AffairsWorkbenchView`、`ConversationPage` 和 Butler 相关组件

### 2.3 关键流程

#### 2.3.1 从事务左侧进入对话页

1. 用户进入事务模式
2. 左侧看到 `文档库 -> 对话 -> 待办 -> 自动化` 这一层级
3. 用户点击“对话”
4. 系统把中间主区从对象页切到事务对话页
5. 若已有最近事务对话，则恢复最近一条
6. 若还没有事务对话，则进入会话类型选择空态

#### 2.3.2 创建轻量会话

1. 用户在事务对话页点击简约 `+` 按钮
2. 系统打开和代码模式同风格的统一创建弹窗
3. 用户在“轻量模式”分组里选择轻量 LLM provider
4. 系统创建事务模式内部的轻量会话记录，或先接通一个能稳定展示的占位状态源
5. 页面进入标准聊天页样式
6. 页面只暴露轻量能力：快速问答、联网搜索、轻分析
7. 如果用户需要更重执行，页面提供升级到 Agent 会话的入口

#### 2.3.3 创建 Agent 会话

1. 用户在事务对话页点击简约 `+` 按钮
2. 系统打开和代码模式同风格的统一创建弹窗
3. 用户在“助手模式”分组里选择完整 CLI provider
4. 系统读取当前工作区文档库绑定和当前事务对象
5. 系统复用当前 Butler/助手会话逻辑创建或恢复 Agent 会话
6. 事务对话页进入完整 Agent 聊天主页面
7. 右侧助手面板与该 Agent 会话共享状态源

#### 2.3.4 从右侧助手面板切到正式 Agent 对话页

1. 用户当前在文档对象页右侧助手面板里已经有上下文
2. 用户点击“展开为正式对话”或等价入口
3. 系统保持当前 Agent 会话 ID 不变
4. 中间主区切到事务对话页
5. 页面继续显示同一条 Agent 会话，不重开第二条

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、5、6、8、9

- `AffairsConversationEntry`：事务左侧对话入口和对话列表区块
- `AffairsConversationPage`：事务模式正式对话页
- `AffairsConversationCreateButton`：事务对话页和左侧栏共用的简约 `+` 新建按钮
- `AffairsConversationCreateModal`：复用代码模式样式的统一创建弹窗
- `AffairsConversationProviderPicker`：事务模式下按“轻量模式 / 助手模式”分组的 provider 选择器
- `AffairsAgentConversationPage`：复用现有 Butler/助手链路的 Agent 对话页适配层
- `AffairsLightweightConversationPage`：轻量会话适配层

### 3.2 数据结构

覆盖需求：1、3、4、5、6、7、9

#### 3.2.1 `AffairsPrimarySection`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `primarySection` | `"library" | "conversation" | "todo" | "automation"` | 是 | 当前事务主区 | 新增 `conversation` |

#### 3.2.2 `AffairsConversationKind`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `kind` | `"lightweight" | "agent"` | 是 | 事务会话类型 | 只能二选一 |

#### 3.2.3 `AffairsConversationProvider`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `provider` | `ProviderId` | 是 | 事务对话底层 provider | 必须走正式 provider id |

#### 3.2.4 `AffairsConversationSummary`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `conversationId` | `string` | 是 | 事务会话 ID | 非空 |
| `kind` | `AffairsConversationKind` | 是 | 会话类型 | 非空 |
| `provider` | `AffairsConversationProvider` | 是 | 当前会话使用的 provider | 非空 |
| `title` | `string` | 是 | 会话标题 | 可回退默认标题 |
| `workspaceId` | `string` | 是 | 所属事务工作区 | 非空 |
| `boundObjectType` | `string | null` | 否 | 启动时绑定的事务对象类型 | 可空 |
| `boundObjectId` | `string | null` | 否 | 启动时绑定的事务对象 ID | 可空 |
| `updatedAt` | `string` | 是 | 最近更新时间 | ISO 时间 |

#### 3.2.5 `AffairsConversationViewState`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `selectedConversationId` | `string | null` | 否 | 当前选中的事务会话 | 可空 |
| `lastLightweightConversationId` | `string | null` | 否 | 最近轻量会话 | 可空 |
| `lastAgentConversationId` | `string | null` | 否 | 最近 Agent 会话 | 可空 |
| `preferredConversationKind` | `"lightweight" | "agent" | null` | 否 | 默认建议类型 | 可空 |
| `preferredProvider` | `ProviderId | null` | 否 | 默认建议 provider | 可空 |

#### 3.2.6 `AffairsAgentSessionBinding`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `workspaceId` | `string` | 是 | 当前工作区 | 非空 |
| `provider` | `ProviderId` | 是 | Agent 会话目标 provider | 非空 |
| `libraryRootDir` | `string | null` | 否 | 当前文档库绑定路径 | 可空 |
| `objectType` | `string | null` | 否 | 当前事务对象类型 | 可空 |
| `objectId` | `string | null` | 否 | 当前事务对象 ID | 可空 |
| `assistantScope` | `string | null` | 否 | 当前对象助手上下文范围 | 可空 |

### 3.3 接口契约

覆盖需求：3、4、5、6、7、9

先把话说死：

- 下面这些接口是**建议落点**
- 它们是为了把数据边界讲清楚，不代表第一阶段必须一次性全实现
- 如果前端先靠现有状态模型和 Butler 会话链路把页面壳层接起来，也算符合这份设计
- 真正需要新开 Host 接口时，再按这里的边界补，不要先为了“看起来完整”硬造一堆新路由

#### 3.3.1 读取事务对话列表

- 类型：HTTP / 前端状态接口
- 路径或标识：待实现时建议走 `GET /api/workspaces/:workspaceId/affairs/conversations`
- 输入：`workspaceId`
- 输出：`AffairsConversationSummary[]`
- 校验：只允许当前事务工作区
- 错误：工作区不存在、读取失败

#### 3.3.2 创建事务轻量会话

- 类型：HTTP / runtime 启动接口
- 路径或标识：待实现时建议走 `POST /api/workspaces/:workspaceId/affairs/conversations/lightweight`
- 输入：`workspaceId`、`provider=<lightweight ProviderId>`、可选初始标题
- 输出：`AffairsConversationSummary`
- 校验：只在事务模式入口可调用
- 错误：工作区不存在、轻量运行时不可用

#### 3.3.3 创建或恢复事务 Agent 会话

- 类型：HTTP / runtime 启动接口
- 路径或标识：待实现时建议走 `POST /api/workspaces/:workspaceId/affairs/conversations/agent`
- 输入：`workspaceId`、`provider=<assistant ProviderId>`、当前文档库绑定、当前对象上下文
- 输出：`AffairsConversationSummary` + 复用的底层会话标识
- 校验：当前工作区有效
- 错误：助手链路不可用、上下文解析失败

## 4. 数据与状态模型

### 4.1 数据关系

核心关系：

1. 一个事务工作区下有一组 **事务对话**
2. 每条事务对话同时有固定 `kind=lightweight | agent`
3. 每条事务对话同时有固定 `provider=<ProviderId>`
4. `lightweight` 对话是事务模式内部会话，不进入代码模式 provider 列表
5. `agent` 对话映射到当前 Butler/助手已存在的控制会话或正式助手会话
6. `agent` 对话默认绑定当前文档库与当前事务对象

一句人话：

- `kind` 回答“这条会话是轻还是重”
- `provider` 回答“这条会话底层接谁”
- 这两个字段必须同时存在，不能偷懒合并

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `library` | 文档库主区 | 用户点击文档库 | 用户切到对话/待办/自动化 |
| `conversation` | 事务对话主区 | 用户点击对话入口 | 用户切回对象页 |
| `lightweight` | 轻量会话激活 | 选择轻量会话或恢复轻量会话 | 切到 Agent 会话或关闭 |
| `agent` | Agent 会话激活 | 选择 Agent 会话或从右侧面板展开 | 切到轻量会话或关闭 |
| `codex` | provider 为 Codex | 创建或切换到 Codex 会话 | 切换到 Claude Code |
| `claude-code` | provider 为 Claude Code | 创建或切换到 Claude Code 会话 | 切换到 Codex |
| `assistant_panel` | 右侧辅助面板模式 | 用户停留对象页并打开助手标签 | 用户切到正式 Agent 对话页 |

## 5. 错误处理

### 5.1 错误类型

- `affairs_conversation_not_found`：事务会话不存在
- `affairs_lightweight_runtime_unavailable`：轻量会话运行时不可用
- `affairs_agent_runtime_unavailable`：Agent 会话复用链路不可用
- `affairs_agent_context_missing`：当前事务文档库或对象上下文缺失
- `affairs_conversation_kind_invalid`：事务会话类型无效
- `affairs_conversation_provider_invalid`：事务会话 provider 无效
- `affairs_conversation_provider_unavailable`：当前事务模式下该 provider 不可用

### 5.2 错误响应格式

```json
{
  "detail": "当前事务工作区还没有可用的 Agent 上下文，请先选择文档或完成文档库绑定。",
  "error_code": "affairs_agent_context_missing",
  "field": "objectId",
  "timestamp": "2026-06-02T00:00:00Z"
}
```

### 5.3 处理策略

1. 没有事务会话：显示类型选择空态，不直接跳代码模式
2. 轻量会话运行时不可用：保留事务对话页，提示稍后重试或切到 Agent 会话
3. Agent 上下文缺失：提示先绑定文档库或先选对象，但仍允许查看已有 Agent 会话历史
4. Butler/助手链路不可用：明确告诉用户 Agent 会话当前不可用，不伪造会话成功
5. 当前 provider 不可用：保留模式选择，提示用户改选 `Codex` 或 `Claude Code` 中仍可用的一项

## 6. 正确性属性

### 6.1 属性 1：轻量会话不污染代码模式 provider

*对于任何* 事务轻量会话，系统都应该满足：它只在事务模式里可见，不会出现在代码模式的新建会话 provider 列表里。

**验证需求：** 需求 4

### 6.1.1 属性 1.1：会话模式和 provider 不混用

*对于任何* 事务对话，系统都应该满足：`轻量/Agent` 与 `Codex/Claude Code` 必须分别用独立字段表达，而不是拼成新的 provider id 或新的混合类型。

**验证需求：** 需求 4.1、需求 7.1

### 6.2 属性 2：Agent 会话与右侧助手面板同源

*对于任何* 事务 Agent 会话，系统都应该满足：中间正式对话页和右侧助手面板指向同一条会话状态源，而不是两套不同消息流。

**验证需求：** 需求 5、需求 8

### 6.3 属性 3：Agent 会话默认围绕当前事务上下文工作

*对于任何* 在事务模式里新开的 Agent 会话，系统都应该满足：它默认继承当前工作区文档库绑定和当前事务对象上下文，而不是退回代码模式的多工作区语义。

**验证需求：** 需求 6

## 7. 测试策略

### 7.1 单元测试

- 事务左侧导航新增 `conversation` 分区后的状态读写
- 轻量会话 / Agent 会话类型判断与默认规则
- `Codex` / `Claude Code` provider 选择状态与可见性规则
- 事务对话页空态与默认进入规则

### 7.2 集成测试

- 从事务对象页切到事务对话页
- 从右侧助手面板展开到正式 Agent 对话页
- 轻量会话创建后不出现在代码模式 provider/new-session 入口
- 轻量模式下能分别创建 `Codex` / `Claude Code` 会话
- Agent 模式下能分别创建 `Codex` / `Claude Code` 会话

### 7.3 端到端测试

- 打开事务模式 -> 文档库 -> 对话 -> 创建轻量会话
- 打开事务模式 -> 选中文档 -> 打开 Agent 会话 -> 消息同步到右侧助手面板
- 从事务对话页切回文档库，再切回对话页，状态正确恢复

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1、2 | `design.md` §2.3.1、§3.1 | 前端路由/组件测试 + 人工走查 |
| `requirements.md` 需求 3、4、4.1、7、7.1 | `design.md` §3.2、§4.1、§6.1、§6.1.1 | 类型分流测试 |
| `requirements.md` 需求 5、6、8 | `design.md` §2.3.3、§2.3.4、§6.2、§6.3 | Agent 会话集成测试 |
| `requirements.md` 需求 9 | `design.md` §2.3.1、§5.3 | 空态和默认进入测试 |

## 8. 风险与待确认项

### 8.1 风险

- 现有右侧助手面板如果状态源抽得不干净，正式 Agent 对话页很容易和它串出两套状态
- 轻量会话如果偷复用完整会话运行时，最后只会名字轻，实际不轻
- 会话模式和 provider 如果被写成一个混合字段，后面 UI、缓存和 DTO 全会变脏
- 事务模式中间主区已经承载文档库等对象页，再加对话页后，如果状态模型不清楚，很容易互相覆盖

### 8.2 待确认项

- 轻量会话 v1 是否直接使用新的 lightweight runtime，还是先用占位链路接通页面壳层
- Agent 会话默认是“每个工作区一条长期会话”，还是“每次从事务模式显式新开一条”
- 右侧助手面板是否保留“独立发消息”能力，还是只保留当前会话镜像与快捷入口
- 事务对话创建流程是先选“模式”，再选 provider；还是用一个两层选择器一次完成
