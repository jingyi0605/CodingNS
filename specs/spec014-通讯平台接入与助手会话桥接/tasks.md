# 任务清单 - spec014-通讯平台接入与助手会话桥接（人话版）

状态：Draft

## 任务 1：先把对象和边界说死

这一步到底做什么：
把“通讯平台接到助手会话，不是接到普通会话或终端”写进正式 Spec，并把 6 个平台范围和第一阶段不做的东西写清楚。

做完以后能看到什么结果：
新接手的人一眼就知道：

- 这次要接哪 6 个平台
- 最终对接对象是谁
- 第一阶段不做哪些高级能力

这一步依赖什么：

- `spec013.1`
- `spec013.2`

主要改哪些文件：

- `README.md`
- `requirements.md`
- `design.md`
- `tasks.md`

这一步明确不做什么：

- 不写任何业务代码
- 不扩展到家庭成员路由

怎么验证是不是真的做完了：

1. 文档里明确写出“通讯平台对接对象是助手会话”
2. 文档里明确列出 6 个平台
3. 文档里明确列出第一阶段不做项

当前状态：
- [x] 已完成

## 任务 2：设计统一数据模型和 Host API

这一步到底做什么：
把平台账号、外部会话映射、入站事件、回发记录四类表和对应管理 API 定义出来。

做完以后能看到什么结果：
后端实现时不会再临时拍脑袋决定“这条消息该存哪”“这个平台要不要单独造一张表”。

这一步依赖什么：

- 任务 1

主要改哪些文件：

- `design.md`

这一步明确不做什么：

- 不开始写 repository 和 controller 代码

怎么验证是不是真的做完了：

1. `design.md` 里有 4 类核心数据模型
2. `design.md` 里有管理 API 清单
3. `design.md` 里说明了 webhook 与 polling 怎么接

当前状态：
- [x] 已完成

## 任务 3：实现 Host 侧通道基础设施

这一步到底做什么：
在 `apps/host` 里新增 channels 模块，把 SQLite 表、repository、service、controller、route 注册接起来。

做完以后能看到什么结果：

- Host 能创建、更新、查看通讯平台账号
- Host 能保存账号级 `provider_id`
- Host 能保存外部会话映射、入站事件和回发记录

这一步依赖什么：

- 任务 2

主要改哪些文件：

- `apps/host/src/storage/sqlite/schema.sql`
- `apps/host/src/storage/repositories/`
- `apps/host/src/modules/channels/`
- `apps/host/src/routes/`
- `apps/host/src/server/create-server.ts`

这一步明确不做什么：

- 不要求所有平台都在这一步完全打通

怎么验证是不是真的做完了：

1. 能通过 API 新增和查询平台账号
2. 账号读写时能正确保存 `provider_id`，且只允许 `codex / claude-code`
3. SQLite 新表能正常读写
4. 不影响现有 Host 启动

当前状态：
- [x] 已完成

完成说明：
- `apps/host` 已新增 `channels` 模块、4 张 SQLite 表、4 个 repository、管理 service / controller / routes。
- Host 已挂出平台能力清单、账号管理、probe / poll、threads / events / deliveries 查询接口。
- `channel_accounts.provider_id` 已收紧为 `codex / claude-code`，默认值是 `codex`。

## 任务 4：把 Butler control session 接成通道目标

这一步到底做什么：
把外部会话映射到 Butler control session，并把外部消息送进对应助手会话。

做完以后能看到什么结果：

- 同一个外部聊天上下文会稳定落到同一个助手会话
- 外部发来的文本会真的进入助手会话

这一步依赖什么：

- 任务 3

主要改哪些文件：

- `apps/host/src/modules/channels/`
- 可能涉及 `apps/host/src/modules/butler/`

这一步明确不做什么：

- 不接普通 provider 会话首页
- 不把外部消息直接改造成终端输入

怎么验证是不是真的做完了：

1. 第一次来消息会创建助手会话
2. 第二次同外部会话来消息会复用映射
3. 助手会话能看到这条消息

当前状态：
- [x] 已完成

完成说明：
- 已新增 `channel_bridge_service`，按 `channel_account_id + external_conversation_key` 复用或创建 Butler control session。
- 同一个外部会话再次进来时，会复用已有 thread 映射，而不是重复起新控制会话。
- 桥接入口走的还是现有 Butler control session 正式发送链路，没有绕开到普通 provider 会话或终端输入。

## 任务 5：实现平台适配器

这一步到底做什么：
给 6 个平台补适配器，统一产出标准化消息结构。

做完以后能看到什么结果：

- 6 个平台都出现在平台目录里
- 每个平台都清楚自己走 webhook、polling 还是 bridge
- 每个平台都清楚自己第一阶段是完全多会话还是有限多会话

这一步依赖什么：

- 任务 3
- 任务 4

主要改哪些文件：

- `apps/host/src/modules/channels/`

这一步明确不做什么：

- 不承诺第一阶段全部媒体能力
- 不承诺个人微信 transport 内嵌

怎么验证是不是真的做完了：

1. 6 个平台都能返回能力声明
2. 能从能力声明里看到连接模式、多会话支持级别和已知限制
3. webhook 平台能完成签名或 token 校验
4. polling / bridge 平台能返回标准化事件

当前状态：
- [x] 已完成

完成说明：
- 已为 6 个平台补统一 adapter registry。
- 第一阶段已落地 webhook / polling / bridge 三种入口的标准化结构，能统一产出 `NormalizedChannelInboundMessage`。
- Telegram 已接最小真实 HTTP API（`getMe / getUpdates / sendMessage`）。
- 个人微信（claw）后续不再沿用假 `bridgeBaseUrl + /poll + /send` 口径，改按“先建账号，再生成二维码绑定，再进入 polling”推进。
- Slack / Discord / 飞书 / 钉钉 继续按各自第一阶段能力收口。

## 任务 6：接入后台 polling 和延迟回发

这一步到底做什么：
把 Telegram、个人微信这类 polling 账号挂进后台任务系统，并把 Slack / Discord 这类需要先 ACK 的平台接成异步回发。

做完以后能看到什么结果：

- polling 账号会自动拉消息
- Slack / Discord 不会因为等助手回复而卡死 webhook 请求

这一步依赖什么：

- 任务 5
- `spec001.2`

主要改哪些文件：

- `apps/host/src/modules/tasks/`
- `apps/host/src/modules/channels/`
- `apps/host/src/server/create-server.ts`

这一步明确不做什么：

- 不自己再长一套私有 inflight / timer 体系

怎么验证是不是真的做完了：

1. polling 任务按账号去重
2. webhook 快速 ACK 后仍能完成回发
3. 失败状态能在账号和回发记录里看到

当前状态：
- [x] 已完成

完成说明：
- 已新增 `channel.account_poll` 后台任务，并接到现有 `TaskManager`。
- 已新增 `channel.delivery_retry` 正式后台任务；首次回发失败后会按 `delivery_id` 去重重试，Host 启动时也会补捞可重试的失败记录。
- 已新增 polling scheduler，自动扫描 `polling / bridge` 账号并 enqueue 正式后台任务，不再在请求链路里长轮询。
- webhook 和 polling 入站在桥接成功后，都会异步等待 Butler 首条文本回复并生成 `channel_deliveries` 记录。

## 任务 7：补测试和文档

这一步到底做什么：
补最小集成测试、平台能力说明和运维使用说明。

做完以后能看到什么结果：

- 后端有最小回归
- 别人知道每个平台怎么配
- 个人微信桥接模式的前置条件写清楚

这一步依赖什么：

- 任务 3
- 任务 4
- 任务 5
- 任务 6

主要改哪些文件：

- `apps/host/tests/integration/`
- `docs/`
- `specs/spec014-通讯平台接入与助手会话桥接/docs/`

这一步明确不做什么：

- 不追求一次把所有平台边角场景测满

怎么验证是不是真的做完了：

1. 至少覆盖账号管理、消息入站、助手会话映射、回发这几条链路
2. 文档写清楚 webhook、polling、bridge 的差异
3. 文档写清楚当前已知限制

当前状态：
- [x] 已完成

完成说明：
- 已补 `channels-routes`、`channel-bridge-service`、`channel-delivery-service`、`channel-gateway-and-polling` 定向测试。
- 已补一份接入说明，把当前支持的配置字段、入口模式和已知限制写清楚。
