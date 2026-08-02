# 设计文档 - spec003.7 会话级模型与配置选择持久化

状态：In Progress

## 1. 概述

### 1.1 目标

- 将模型选择从账号偏好下沉到已有会话的 `session_bindings`。
- 复用已有会话级 preset 绑定，不再另建一份 composer 本地状态。
- 在用户切换选择器时立即保存，避免必须发送消息才落库。
- 保留账号默认模型作为新会话与旧数据的兜底。

### 1.2 覆盖需求

- `requirements.md` 需求 1：模型隔离。
- `requirements.md` 需求 2：preset 隔离和恢复。
- `requirements.md` 需求 3：安全保存和运行时边界。

### 1.3 技术约束

- 前端：React，所有显示文案继续走现有 i18n 字典。
- 后端：Fastify 和 TypeScript。
- 数据存储：Host 使用 `better-sqlite3`；禁止引入 `node:sqlite`。
- 运行时：继续复用 `SessionProviderConfigService` 生成 preset 对应的 `runtimeHomeDir`。

## 2. 数据与职责

### 2.1 单一数据来源

`session_bindings` 是已有会话和 provider 运行上下文的绑定表。本 Spec 在该表增加 `selected_model TEXT`：

| 字段 | 类型 | 含义 | 兼容默认值 |
| --- | --- | --- | --- |
| `selected_model` | `TEXT NULL` | 用户为该会话选定的模型；`NULL` 表示不强制模型 | `NULL` |
| `provider_config_mode` | `TEXT` | `global-default` 或 `cc-switch-preset` | 已有字段 |
| `provider_preset_id` | `TEXT NULL` | `cc-switch` preset ID | 已有字段 |

不新增“会话偏好表”。三个值都描述同一个会话运行选择，拆表只会制造不同步的第二真相源。

`SessionBinding`、`SessionListItem` 和前端 `SessionSummaryDto` 均暴露 `selectedModel: string | null`。历史记录与迁移后的空值统一解释为“未指定模型”。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `SessionBindingRepository` | 读写会话绑定和模型选择 | 会话绑定记录 | 最新绑定记录 |
| `SessionHistoryService` | 鉴权、验证并保存后续使用的会话选择 | sessionId、用户、模型、preset | 最新会话摘要 |
| `SessionController` | 提供保存接口 | HTTP 请求 | 会话摘要或标准错误 |
| `conversation-api.ts` | 声明前端请求和摘要字段 | 会话级选择 | DTO |
| `ComposerPanel` | 显示选择，并向页面报告用户改动 | 选择器事件 | 当前选择 |
| `ConversationPage` / runtime store | 调用保存接口并回写导航与当前会话 | 选择变化 | 下一次加载可恢复的会话状态 |

## 3. 接口和流程

### 3.1 保存会话选择

- 类型：HTTP
- 路径：`PATCH /api/sessions/:sessionId/composer-settings`
- 请求体：

```json
{
  "selectedModel": "gpt-5.4",
  "providerConfigMode": "cc-switch-preset",
  "providerPresetId": "work"
}
```

- 字段规则：
  - `selectedModel` 可以为 `null` 或非空字符串；空白字符串按 `null` 处理。
  - `global-default` 必须配 `providerPresetId: null`。
  - `cc-switch-preset` 必须带非空 preset ID，并由既有 `SessionProviderConfigService` 检查 provider 是否支持及 preset 是否存在。
- 输出：含 `selectedModel`、`providerConfigMode`、`providerPresetId` 的最新 `SessionListItem`。
- 鉴权：仅会话所属用户可以修改。

### 3.2 保存流程

1. Composer 的模型或 preset 变化后，页面保留即时显示状态，并发起保存请求。
2. Host 读取当前会话绑定，确认用户归属。
3. Host 通过既有配置服务计算新的 preset 绑定；模型只保存，不向正在运行的 provider 发送控制指令。
4. Host 在同一个会话绑定记录中写入模型、配置模式、preset、runtimeHomeDir 和更新时间。
5. Host 返回最新摘要；前端只接受仍对应最新选择请求的响应，并更新当前 runtime store 与导航摘要。

### 3.3 下次运行的取值顺序

后续消息使用：请求中显式传入的模型（Composer 当前会话选择）优先；没有显式值时使用 `SessionBinding.selectedModel`；仍为空时沿用 provider 或 preset 默认模型。

对配置文件，调用方未传字段时沿用当前绑定；传入合法 preset 时更新绑定。这与 `spec003.6` 已有规则一致。

### 3.4 新会话和旧会话

- 草稿会话尚无真实 `sessionId`，首次 `start-live` 仍把模型和 preset 带入。Host 创建绑定时写入 `selectedModel`。
- 历史会话没有 `selected_model` 时，前端继续采用账号默认模型；不对历史数据做批量回填。
- 分叉和并行会话已存在各自的创建配置；创建出的真实会话需把模型选择写入自己的绑定，不与来源会话共享可变状态。

## 4. 状态与并发

### 4.1 可见状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| 未指定 | 会话没有强制模型或指定 preset | 历史数据或用户选默认值 | 用户选择模型或 preset |
| 保存中 | UI 已切换，保存请求未返回 | 发起 PATCH | 成功或失败 |
| 已保存 | 服务端、导航和页面一致 | 收到最新成功响应 | 用户再次修改 |
| 保存失败 | 新选择未确认写入 | 请求失败 | 用户再次修改或刷新 |

### 4.2 并发规则

模型和 preset 的每次变更带一个递增请求序号。后返回的旧响应不得覆盖较新的本地选择。服务端以最后成功写入为准；前端通过返回摘要同步，而不是猜测数据库状态。

## 5. 错误处理

| 场景 | HTTP / 错误码 | 处理 |
| --- | --- | --- |
| 会话不存在或不属于当前用户 | 404 / 403，沿用现有会话错误 | 不泄露其他用户数据 |
| 配置模式非法 | 400 `INVALID_INPUT` | 不写数据库 |
| preset 缺失或不支持当前 provider | 沿用配置服务错误 | 保持已有绑定不变 |
| 网络或 Host 保存失败 | 现有 API 错误 | UI 保留当前选择并显示错误，账号默认模型不变 |

## 6. 正确性属性

### 6.1 会话隔离

*对于任何* 两个不同 `sessionId`，保存 A 的 `selectedModel` 或 preset 不得修改 B 的绑定记录或账号 `defaultModel`。

**验证需求：** 需求 1、需求 2。

### 6.2 默认兼容

*对于任何* 没有 `selected_model` 的历史会话，加载后的行为必须与改动前一致：模型仍由账号默认值或 provider 默认值决定。

**验证需求：** 需求 1、非功能需求 6.1。

### 6.3 运行中边界

*对于任何* 正在运行的会话，保存选择不得修改当前 run 的已提交参数。

**验证需求：** 需求 3。

## 7. 测试策略

### 7.1 Host 单元和集成测试

- 数据库升级后新增字段读写正确。
- 保存接口鉴权、模型空值、全局默认和 preset 校验。
- A/B 会话隔离，且账号偏好没有被修改。
- 新绑定和从草稿 `start-live` 创建的会话均保存模型。

### 7.2 user-app 测试

- `ComposerPanel` 改模型不再调用 `updatePreferences`。
- 打开 A/B 会话时，Composer 接收各自的 `selectedModel` 和 preset。
- 旧会话没有值时仍接收账号默认模型。
- 快速连续切换时旧保存响应不覆盖新选择。

### 7.3 验证命令

- `pnpm test:related -- <本次改动文件>`
- `pnpm check:sqlite-runtime`

## 8. 风险与边界

- 现有 `session_bindings` 是关键表，schema 只能增量加列，不能重建或删除用户数据。
- 配置保存会创建或切换会话的专属运行目录，但不应干扰已在运行的进程。
- 任何辅助状态放在 localStorage 都会造成跨设备和刷新后的第二真相源，因此本 Spec 明确不使用它。

