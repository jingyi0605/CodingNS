# 需求文档 - spec014-通讯平台接入与助手会话桥接

状态：Draft

## 简介

这次不是做“通知推送”，也不是做“把消息同步到某个平台”。

这次要做的是：

让外部通讯平台成为 `CodingNS` 助手会话的正式入口。

用户在钉钉、飞书、Telegram、Slack、Discord、个人微信（claw）里发来的消息，系统要能：

1. 识别来自哪个平台、哪个账号、哪个外部会话
2. 把它稳定地映射到一个助手会话
3. 把消息送进助手会话
4. 等助手有结果后，再按平台规则回发出去

这里最重要的边界只有一句：

**通讯平台对接的是助手会话，不是普通 provider 会话，也不是终端。**

## 可实现性结论

### 结论

这件事 **值得做，而且应该先按助手会话来做**。

### 原因

1. `CodingNS` 已经有助手控制会话和会话运行时，不需要再发明一套“外部聊天内核”。
2. `FamilyClaw` 已经证明“平台账号 / webhook / polling / 外部会话映射 / 回发记录”这条链路是成立的，只是那边接的是家庭助手场景。
3. `CodingNS` 的对象更简单：这里不是多成员家庭系统，核心是“一个用户通过外部平台远程和代码助手说话”。

### 当前已确认事实

1. `apps/host` 已有：
   - Butler 控制会话
   - 会话收发链路
   - 会话运行时订阅
   - 后台任务系统
2. 外部平台接入至少会涉及两类入口：
   - webhook
   - polling
3. Slack 和 Discord 这类平台通常要求先快速 ACK，再异步回发结果，不能同步傻等。
4. Telegram、个人微信（claw）更适合 polling 或桥接模式。

## 术语表

- **通讯平台账号**：某个平台上的一个接入配置，比如一个 Telegram Bot、一个飞书应用、一个 Slack App
- **外部会话**：平台里的一个真实聊天上下文，比如 Telegram chat、Slack channel、Discord channel、飞书 chat、钉钉 conversation
- **助手会话**：`CodingNS` 现有的 Butler 控制会话，外部消息最终要进入它
- **通道映射**：外部会话和助手会话之间的固定绑定关系
- **入站事件**：平台发到 `CodingNS` 的原始消息或命令
- **出站回发**：助手生成结果后，系统再发回平台
- **延迟回发**：平台先收到“已接收”，真实结果稍后再发，比如 Slack / Discord
- **桥接模式**：某个平台能力不直接内嵌进 Host，而是通过一个单独的 transport/bridge 服务接入

## 范围说明

### In Scope

- 6 个平台的统一接入框架
- 平台账号管理模型
- 外部会话到助手会话的映射模型
- 入站消息落助手会话
- 助手结果回发平台
- webhook 与 polling 的统一宿主接入
- 回发记录、失败记录、基础审计

### Out of Scope

- 富媒体、文件、图片、语音第一阶段完整支持
- 多用户、多成员权限和成员绑定
- 一套新的移动端或桌面端聊天 UI
- 把个人微信 transport 直接编进 Host 主进程
- 平台侧群管理、菜单管理、联系人同步

## 技术边界

### 边界 1：外部平台只接助手会话

- 外部消息进来以后，只能命中或创建助手会话
- 不允许直接把平台消息塞到普通 provider 会话列表
- 不允许把平台消息直接转成终端输入

### 边界 2：平台接入模型统一，但平台能力允许分层

- 所有平台都走统一的账号、会话映射、入站事件、回发记录模型
- 但每个平台的真实接法可以不同：
  - webhook
  - polling
  - bridge

### 边界 3：后台轮询和异步回发必须走正式后台链路

- polling 账号不能在请求链路里直接长时间跑
- 延迟回发不能靠匿名散装 `setTimeout` 到处长
- 新增后台任务必须服从现有 `TaskManager` 体系

### 边界 4：第一阶段优先文本消息

- 第一阶段先把文本收发打通
- 媒体、文件、卡片、按钮交互先不承诺全部可用

### 边界 5：平台安全校验不能省

- webhook 平台必须做签名、token 或 challenge 校验
- polling / bridge 模式必须有最小鉴权
- 不允许开一个匿名公网入口，谁都能拿来对助手发指令

## 需求

### 需求 1：系统必须提供统一的通讯平台账号模型

**用户故事：** 作为维护者，我希望不管接哪个平台，后台都有同一套账号模型，这样后面不会每个平台长一套私表和私逻辑。

#### 验收标准

1. WHEN 用户新增一个通讯平台账号 THEN System SHALL 保存平台类型、连接模式、配置、状态和最后一次收发状态。
2. WHEN 用户新增或修改通讯平台账号 THEN System SHALL 明确保存该账号对应的助手 provider，第一阶段只允许 `codex` 或 `claude-code`。
3. WHEN 用户没有显式指定通讯平台账号的 provider THEN System SHALL 默认使用 `codex`。
4. WHEN 用户查看通讯平台列表 THEN System SHALL 返回统一字段，而不是每个平台各自拼返回结构。
5. WHEN 某个平台需要额外字段 THEN System SHALL 放到平台配置或运行时状态里，而不是破坏公共主模型。

### 需求 2：系统必须把外部会话映射到助手会话

**用户故事：** 作为用户，我希望同一个外部聊天上下文能持续落到同一个助手会话里，不要每发一句都开新会话。

#### 验收标准

1. WHEN 系统第一次收到某个外部会话的消息 THEN System SHALL 按规则创建或选择一个助手会话。
2. WHEN 系统再次收到同一个外部会话的消息 THEN System SHALL 复用已有映射。
3. WHEN 用户显式关闭或重置映射 THEN System SHALL 支持重新建链。
4. WHEN 某个平台账号支持多会话模式 THEN System SHALL 按 `channel_account_id + external_conversation_key` 维持多条独立映射。
5. WHEN 某个平台第一阶段只支持有限多会话 THEN System SHALL 明确说明限制，而不是默默把多会话压成一个总会话。

### 需求 3：系统必须支持 6 个指定平台

**用户故事：** 作为需求提出者，我希望当前明确要求的平台都在统一接入范围里，而不是只做其中两三个。

#### 验收标准

1. WHEN 平台列表初始化 THEN System SHALL 至少声明以下平台：
   - 钉钉
   - 飞书
   - 个人微信（claw）
   - Telegram
   - Slack
   - Discord
2. WHEN 某个平台第一阶段只能走 bridge 或有限模式 THEN System SHALL 明确标注，而不是假装“全功能已支持”。
3. WHEN 用户获取平台能力清单 THEN System SHALL 能看到每个平台当前支持的连接模式、多会话支持级别和限制。

### 需求 4：系统必须支持 webhook 型平台的公网接入

**用户故事：** 作为维护者，我希望飞书、Slack、Discord 这类平台能把事件打到 Host，而不是每个平台都额外挂一套私服务。

#### 验收标准

1. WHEN 平台采用 webhook 模式 THEN System SHALL 提供正式公网入口。
2. WHEN 平台要求 challenge / token / signature 校验 THEN System SHALL 完成对应校验。
3. WHEN webhook 消息命中成功 THEN System SHALL 记录入站事件并异步推进助手处理。

### 需求 5：系统必须支持 polling 型平台的后台拉取

**用户故事：** 作为维护者，我希望 Telegram 和个人微信这类更适合轮询的平台能稳定拉消息，而不是靠手工点按钮。

#### 验收标准

1. WHEN 平台采用 polling 模式 THEN System SHALL 通过后台任务周期性拉取消息。
2. WHEN 同一个账号已有 inflight polling 任务 THEN System SHALL 去重。
3. WHEN 轮询失败 THEN System SHALL 记录失败状态和最近错误。

### 需求 6：系统必须把入站消息送入助手会话

**用户故事：** 作为用户，我希望平台里发给助手的话，最终真的进入助手会话，而不是只落库不处理。

#### 验收标准

1. WHEN 入站事件通过校验 THEN System SHALL 把文本内容送到目标助手会话。
2. WHEN 目标助手会话不存在 THEN System SHALL 按当前路由规则创建会话。
3. WHEN 助手会话当前不能接受新消息 THEN System SHALL 返回明确失败原因或进入明确排队策略。

### 需求 7：系统必须支持助手结果回发平台

**用户故事：** 作为用户，我希望平台里发完消息后，能在原平台看到助手回复。

#### 验收标准

1. WHEN 助手产出可回发文本 THEN System SHALL 按平台规则回发到原外部会话。
2. WHEN 平台要求延迟回发 THEN System SHALL 先 ACK，再异步发结果。
3. WHEN 回发失败 THEN System SHALL 保存失败记录和错误原因。

### 需求 8：系统必须记录入站事件、回发记录和基础审计

**用户故事：** 作为维护者，我希望出了问题能看见是哪条平台消息进来、落到哪个助手会话、最后回发成了什么。

#### 验收标准

1. WHEN 收到平台事件 THEN System SHALL 保存入站事件记录。
2. WHEN 助手回发平台 THEN System SHALL 保存回发记录。
3. WHEN 某条消息失败 THEN System SHALL 能追到账号、外部会话、助手会话和错误信息。

### 需求 9：系统必须提供正式管理接口

**用户故事：** 作为后续前端或 CLI 使用方，我希望不是直接改数据库，而是有正式 API 管理这些通道账号。

#### 验收标准

1. WHEN 用户管理通讯平台账号 THEN System SHALL 提供正式 API。
2. WHEN 用户需要查看某账号状态 THEN System SHALL 提供收发状态、最后错误、映射数量等基础信息。
3. WHEN 用户手动触发 probe 或 poll THEN System SHALL 提供明确入口。

### 需求 10：系统第一阶段不能破坏现有助手会话链路

**用户故事：** 作为维护者，我希望新增通讯平台接入后，原来的 Butler 会话、普通会话和终端链路不受影响。

#### 验收标准

1. WHEN 外部平台接入失败 THEN System SHALL 不影响现有助手会话页面和普通会话页面。
2. WHEN 没有配置任何平台账号 THEN System SHALL 不引入额外用户可见噪音。
3. WHEN 第一阶段功能未启用 THEN System SHALL 保持现有系统行为不变。
