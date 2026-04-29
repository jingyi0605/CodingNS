# 设计文档 - spec014-通讯平台接入与助手会话桥接

状态：Draft

## 1. 设计目标

这次设计只解决一个主问题：

怎样把外部通讯平台稳定接到 `CodingNS` 的助手会话上。

做完以后，要能回答下面这几个问题：

1. 外部平台账号怎么存
2. webhook / polling 怎么进系统
3. 外部会话怎么找到对应助手会话
4. 消息怎么发进助手会话
5. 助手回复怎么再发回平台

## 2. 先把对象说死

### 2.1 这次接的是谁

这次接的是：

- `Butler control session`

不是：

- 普通 provider 会话首页
- 终端输入流
- 工作台通知系统
- 另起一套“外部聊天会话”

### 2.2 为什么必须接 Butler control session

原因很直接：

1. Butler 控制会话已经是“和助手聊天”的正式对象
2. 它已经有会话状态、消息发送、上下文聚合、后续动作能力
3. 外部平台本质上是在提供一个远程聊天入口，语义上最匹配 Butler

## 3. 总体结构

### 3.1 模块分层

第一阶段后端建议新增 `channels` 模块，结构按下面拆：

1. **账号层**
   - 保存平台账号
   - 保存平台配置
   - 保存运行状态
2. **接入层**
   - webhook 入口
   - polling 调度
   - bridge 调用
3. **映射层**
   - 外部会话 -> 助手会话
4. **桥接层**
   - 把平台文本消息送入 Butler control session
   - 等待助手回复
   - 回发平台
5. **记录层**
   - 入站事件
   - 出站回发
   - 失败记录

### 3.2 总链路

统一链路如下：

1. 平台事件进入 Host
2. 平台适配器做校验和标准化
3. 系统查找或创建“外部会话 -> 助手会话”映射
4. 系统把消息送到目标 Butler control session
5. 系统等待助手首个可回发文本结果
6. 系统按平台规则回发
7. 系统记录回发结果

## 4. 数据模型

### 4.1 `channel_accounts`

职责：

- 保存一个平台账号

建议字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `user_id` | 归属用户 |
| `platform_code` | 平台代码 |
| `display_name` | 管理端显示名 |
| `provider_id` | 这个账号默认把消息送到哪个助手 provider，只允许 `codex / claude-code` |
| `connection_mode` | `webhook / polling / bridge` |
| `status` | `active / disabled / degraded` |
| `config_json` | 平台配置 |
| `runtime_state_json` | 运行时游标、临时上下文 |
| `last_inbound_at` | 最近收到消息时间 |
| `last_outbound_at` | 最近回发时间 |
| `last_error` | 最近错误摘要 |
| `created_at / updated_at` | 时间戳 |

### 4.2 `channel_threads`

职责：

- 记录一个外部会话和一个 Butler control session 的绑定关系

建议字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `channel_account_id` | 所属平台账号 |
| `external_conversation_key` | 外部会话唯一键 |
| `external_user_id` | 外部发言人 ID |
| `external_thread_key` | 平台线程键，可空 |
| `control_session_id` | Butler control session id |
| `session_id` | 真实 provider session id，方便追踪 |
| `title` | 自动生成的会话名 |
| `status` | `active / closed / failed` |
| `last_inbound_at / last_outbound_at` | 最近收发时间 |
| `last_transport_context_json` | 平台回发临时上下文，比如 Slack response_url |
| `created_at / updated_at` | 时间戳 |

### 4.3 `channel_inbound_events`

职责：

- 记录每一条平台进来的消息，做去重和排障

建议字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `channel_account_id` | 所属账号 |
| `external_event_id` | 平台事件 ID |
| `external_conversation_key` | 外部会话键 |
| `external_user_id` | 外部用户 ID |
| `control_session_id` | 命中的助手会话 |
| `session_id` | 命中的真实 session |
| `text_content` | 归一化文本 |
| `payload_json` | 原始标准化载荷 |
| `status` | `received / dispatched / replied / failed / ignored` |
| `error_message` | 错误详情 |
| `received_at / processed_at` | 时间戳 |

### 4.4 `channel_deliveries`

职责：

- 记录系统把助手结果发回平台的结果

建议字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `channel_account_id` | 所属账号 |
| `thread_id` | 命中的外部会话映射 |
| `inbound_event_id` | 关联的入站事件 |
| `control_session_id` | 助手会话 |
| `session_id` | provider session |
| `text_content` | 回发文本 |
| `provider_message_ref` | 平台返回的消息引用 |
| `status` | `sent / failed / skipped` |
| `error_message` | 错误详情 |
| `created_at / updated_at` | 时间戳 |

## 5. 平台接入模式

### 5.1 第一阶段统一支持的模式

| 平台 | 第一阶段模式 | 说明 |
| --- | --- | --- |
| 钉钉 | `webhook` 优先，`polling` 可补 | 先把文本消息收发打通 |
| 飞书 | `webhook` 优先 | 支持 challenge / token / 可选加密 |
| Telegram | `polling` | 最直接 |
| Slack | `webhook` | 先支持 slash command / command-style 文本入口 |
| Discord | `webhook` | 先支持 interaction / slash command 入口 |
| 个人微信（claw） | `polling` | 先由 Host 发起二维码绑定，绑定成功后再轮询收发文本 |

### 5.2 为什么不强行所有平台一个模式

因为这不现实。

比如：

- Telegram 轮询很自然
- Slack / Discord 通常要先 ACK
- 个人微信不是先填一堆地址，而是要先完成扫码绑定

统一的是宿主模型，不是底层传输手段。

### 5.3 provider 选择和切换规则

这里直接按 `CodingNS` 当前能力来定：

- Butler 现在只支持 `codex` 和 `claude-code`
- 没有第三种 CLI provider
- 默认 provider 是 `codex`

第一阶段切换规则也先收紧，不做花活：

1. 每个 `channel_account` 固定一个 `provider_id`
2. 这个账号下新建的所有助手会话，默认都走这个 provider
3. 不支持在同一个外部线程里临时切 provider
4. 如果真要切，做法是改账号配置，新会话按新 provider 建，旧会话继续保留原 provider 上下文

为什么这样定：

- 同一个外部聊天上下文里来回换 provider，很容易把上下文、风格和会话状态搅乱
- 账号级固定 provider 最容易理解，也最容易排障
- 这和当前 Butler profile / Butler session 的能力边界一致

后面如果确实要做“同一平台账号下多 provider”，也应该在第二阶段做成明确配置，不要在消息里临时猜。

## 6. 助手会话映射规则

### 6.1 默认规则

默认按 `channel_account_id + external_conversation_key` 绑定一个 Butler control session。

好处：

- 同一个外部会话上下文稳定
- 同一个群、频道、私聊不会每次新建会话
- 不需要 `FamilyClaw` 那种成员绑定模型

### 6.2 首次命中时怎么建会话

首次收到外部会话消息时：

1. 查 `channel_threads`
2. 没命中就创建新的 Butler control session
3. 会话标题按“平台 + 会话名/用户名 + 时间”生成
4. 把新建的 `control_session_id` 和底层 `session_id` 存回映射表

### 6.3 为什么不用“所有平台消息都打到当前控制会话”

因为这会把不同外部聊天上下文搅在一起。

比如：

- 你在 Slack 一个频道问构建问题
- 又在 Telegram 私聊里问另一个项目

如果都塞到同一个当前控制会话，后面上下文会直接乱。

### 6.4 多会话支持矩阵

这里说的是：

一个平台账号下面，能不能稳定承载多个外部聊天上下文，并把它们分别绑到不同的 Butler control session。

第一阶段按下面的口径实现：

| 平台 | 多会话支持级别 | 第一阶段说明 |
| --- | --- | --- |
| 钉钉 | 支持 | 按 conversation 维持多条映射 |
| 飞书 | 支持 | 按 chat 维持多条映射，可预留 thread key |
| Telegram | 支持 | 按 chat id 维持多条映射，群聊和私聊都可分开 |
| Slack | 支持 | 按 channel / dm 维持多条映射，可预留 thread ts |
| Discord | 支持 | 按 channel / dm 维持多条映射，interaction 入口也落到独立会话 |
| 个人微信（claw） | 有限支持 | 取决于上游 transport 能不能稳定恢复会话上下文；第一阶段先按一对一文本会话收住 |

这张表里有两个意思，别混：

1. 平台自己有没有 thread，只是平台能力问题
2. `CodingNS` 宿主能不能做多会话，核心看能不能拿到稳定的 `external_conversation_key`

所以第一阶段宿主层统一按这个键建映射，不强依赖平台一定有 thread 子概念。

## 7. 入站处理设计

### 7.1 webhook 平台

处理顺序：

1. 读取原始请求体
2. 平台适配器校验签名 / token / challenge
3. 标准化成统一入站消息结构
4. 快速 ACK 平台
5. 后台异步推进助手处理

统一标准化结构建议如下：

```ts
interface NormalizedChannelInboundMessage {
  externalEventId: string;
  externalConversationKey: string;
  externalUserId: string | null;
  externalThreadKey: string | null;
  text: string;
  senderDisplayName: string | null;
  rawPayload: Record<string, unknown>;
  transportContext: Record<string, unknown>;
}
```

### 7.2 polling 平台

处理顺序：

1. 后台任务按账号轮询
2. 适配器拉取平台消息
3. 用 `externalEventId` 去重
4. 对每条新消息走同一套助手桥接链路

## 8. 回发设计

### 8.1 统一原则

不是每个平台都要同步等助手跑完再返回 HTTP。

统一原则：

1. 平台入口先满足平台自己的 ACK 要求
2. 真正的助手回复走后台回发

### 8.2 回复等待策略

建议桥接层这样做：

1. 把消息送进 Butler control session
2. 订阅对应 session runtime
3. 等第一个新的 `assistant` 文本消息
4. 超时则给平台一个明确 fallback 文案或记失败

### 8.3 第一阶段的回复选择规则

第一阶段先简单：

- 只取首个新的 `assistant` 文本消息回发
- 不拼接复杂 tool 结果
- 不做多轮 streaming 片段合并

这不是最终最优解，但它够稳定，也容易验证。

## 9. 后台任务设计

### 9.1 要进入 `TaskManager` 的任务

第一阶段至少这类任务要进入统一后台任务系统：

- 平台 polling
- 可能的延迟重试回发

建议 task type：

- `channel.account_poll`
- `channel.delivery_retry`

### 9.2 key 设计

- polling：`channel_account_id`
- delivery retry：`delivery_id`

### 9.3 为什么 webhook 入站处理不一定强制进 TaskManager

因为 webhook 入站本身是单次事件驱动。

但它在 ACK 之后真正推进助手处理时，不能在回复线程里长时间阻塞。这里允许两种实现：

1. 用后台 promise / 异步队列推进
2. 后续再收口成正式 task

第一阶段不强制把每条 webhook 事件都映射成一个全局 task，但 polling 必须走统一任务系统。

## 10. Host API 设计

### 10.1 管理接口

建议新增：

- `GET /api/channels/platforms`
- `GET /api/channels/accounts`
- `POST /api/channels/accounts`
- `PATCH /api/channels/accounts/:accountId`
- `POST /api/channels/accounts/:accountId/probe`
- `POST /api/channels/accounts/:accountId/poll`
- `GET /api/channels/accounts/:accountId/threads`
- `GET /api/channels/accounts/:accountId/events`
- `GET /api/channels/accounts/:accountId/deliveries`

### 10.2 公网入口

建议新增：

- `POST /api/public/channel-gateways/:accountId/webhook`

如果平台需要 `GET` challenge，也允许同一路径开 `GET`。

## 11. 个人微信（claw）第一阶段边界

这里必须说人话：

个人微信不是普通官方 Bot 平台。

这里最容易做错的一点，是把它想成“用户手填一个 bridge 地址，然后 Host 去调 `/poll` 和 `/send`”。

真实第一阶段链路应该是：

1. 管理员先创建一个 `wechat-claw` 账号
2. Host 发起二维码绑定
3. 管理员用微信扫码
4. Host 轮询登录状态
5. 绑定成功后，Host 才保存 `botToken / baseUrl / boundUserId`
6. 后续收消息和发消息都走真实 iLink polling 接口

这样做的目的也很直接：

- 不把假的表单字段塞给用户
- 先把“扫码绑定 -> 登录态 -> polling -> 文本回发”这条真链路跑通
- 再谈后面的媒体、上下文恢复和更复杂会话能力

## 12. 验证方案

第一阶段做完，至少要验证这些事：

1. 新建平台账号后能 probe 成功
2. webhook / polling 能进到统一入站记录
3. 同一个外部会话会复用同一个助手会话
4. 助手回复后能回发平台
5. Slack / Discord 这类先 ACK 再回发的链路没堵住请求
6. polling 账号不会重复长出多个 inflight
7. 没配置平台账号时，现有 Butler 会话链路不受影响
