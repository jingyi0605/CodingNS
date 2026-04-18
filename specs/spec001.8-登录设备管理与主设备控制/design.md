# 设计文档 - spec001.8-登录设备管理与主设备控制

状态：Draft

## 1. 概述

### 1.1 目标

- 给现有认证体系补上正式的设备管理能力
- 在设置页展示当前设备、其他在线设备和最近登录记录
- 用“稳定设备 + token 会话 + 登录事件”三层模型代替“拿 token 猜设备”
- 支持当前设备通过管理员密码设置或取消主设备
- 支持主设备退出其他设备的交互式登录状态
- 保持现有 `login / refresh / logout` 主链路兼容

### 1.2 覆盖需求

- `requirements.md` 需求 1：系统必须能识别稳定设备，而不是把 token 当设备
- `requirements.md` 需求 2：设置页必须能展示当前设备和其他在线设备
- `requirements.md` 需求 3：设置页必须展示最近登录记录，并且只保留最近 10 条
- `requirements.md` 需求 4：主设备必须由管理员密码显式设置，且主设备不唯一
- `requirements.md` 需求 5：只有主设备才能退出其他设备的登录状态
- `requirements.md` 需求 6：新能力不能破坏现有登录、刷新、登出主链路

### 1.3 技术约束

- 后端继续使用现有 `Node.js 22 + Fastify + better-sqlite3`
- 前端继续落在 `apps/user-app` 的设置页，不改历史前端目录
- 所有显示文案继续走统一 i18n 字典
- 设备来源地址只认 Host 请求上下文，不依赖前端传 IP
- 第一阶段只处理交互式用户设备，不把 `assistant_runtime` token 混入设备管理

### 1.4 当前实现判断

当前认证实现只有：

- `auth_users`
- `auth_tokens`
- `auth_login_attempts`

现状问题很直接：

1. `auth_tokens` 里没有设备维度
2. 登录和刷新都不知道“这是哪台设备”
3. 设置页没有设备管理入口
4. 退出登录只能退当前 token，没有“退出其他设备”

所以这次不能只加两个接口。
必须先把数据结构补对。

## 2. 架构

### 2.1 总体结构

这次拆成三层，不再混着来：

1. **Device（设备）**  
   稳定识别“这是哪台客户端实例”。
2. **Device Session（设备会话）**  
   描述某次登录对应的有效 token 集合。
3. **Recent Login Event（最近登录事件）**  
   只记录“最近发生过哪些成功登录”，并裁剪到 10 条。

一句话解释：
设备是“是谁”，会话是“这次登录”，事件是“发生过什么”。

### 2.2 模块划分

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `device-identity-resolver` | 解析客户端类型、实例 ID 和来源地址 | 请求头、请求上下文 | 设备识别快照 |
| `auth-device-service` | 设备创建、查找、主设备状态切换 | 用户、设备识别快照 | 设备记录 |
| `auth-device-session-service` | 登录会话绑定与批量撤销 | token 记录、设备记录 | 设备会话状态 |
| `auth-login-event-service` | 写入并裁剪最近登录记录 | 登录成功事件 | 最近 10 条事件 |
| `device-management-controller` | 设置页设备管理接口 | 当前登录态、请求参数 | 设备管理 DTO |
| `settings-device-panel` | 设置页登录设备管理 UI | 设备管理 DTO | 用户可读界面 |

### 2.3 关键原则

#### 2.3.1 token 只代表会话，不代表设备

同一台设备会刷新 token。
所以设备主键不能放在 token 本身上。

第一阶段采用：

- `clientInstanceId`：前端持久化的稳定客户端实例 ID
- `clientType`：客户端类型

如果这两个值都在，就识别为同一设备。

#### 2.3.2 来源地址只当展示和审计字段，不当设备主键

IP 会变，代理也会改写。
所以来源地址只能当“最近从哪来过”的展示字段，不能拿它当设备身份。

#### 2.3.3 主设备是设备级状态，不是 token 级状态

主设备表示“我信任这台设备可以做高风险操作”。
它应该挂在设备上，而不是某一条 access token 上。

#### 2.3.4 最近登录记录必须在写入时裁剪

只靠前端显示前 10 条是自欺欺人。
第一阶段要求服务端在写入成功登录事件后，立即把同一用户超出的旧记录删掉。

#### 2.3.5 旧登录态必须兼容

数据库升级后，现有 token 不能被粗暴打死。
第一阶段允许旧 token 没有设备 ID：

- 仍可继续鉴权
- 仍可被撤销
- 设备页里按“未知设备（旧登录态）”兜底显示

## 3. 数据结构

### 3.1 `auth_devices`

覆盖需求：1、2、4、5、6

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 设备记录 ID |
| `user_id` | string | 是 | 所属用户 |
| `client_type` | string | 是 | `desktop/web/ios/android/unknown` |
| `client_instance_id` | string | 否 | 客户端稳定实例 ID；旧登录态允许为空 |
| `display_name` | string | 否 | 设备展示名，第一阶段可由服务端生成 |
| `is_primary` | integer | 是 | 是否主设备 |
| `last_source_address` | string | 否 | 最近来源地址 |
| `last_seen_at` | string | 是 | 最近活跃时间 |
| `primary_set_at` | string | 否 | 最近一次设为主设备时间 |
| `created_at` | string | 是 | 创建时间 |
| `updated_at` | string | 是 | 更新时间 |

约束：

- 推荐唯一键：`(user_id, client_type, client_instance_id)`，但 `client_instance_id` 为空时不参与唯一识别
- `is_primary` 允许多条记录同时为 `1`

### 3.2 `auth_device_sessions`

覆盖需求：1、2、5、6

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 设备会话 ID |
| `user_id` | string | 是 | 所属用户 |
| `device_id` | string | 否 | 关联设备；旧登录态允许为空 |
| `access_token_id` | string | 否 | access token 记录 ID |
| `refresh_token_id` | string | 否 | refresh token 记录 ID |
| `revoked_at` | string | 否 | 会话失效时间 |
| `created_at` | string | 是 | 创建时间 |
| `updated_at` | string | 是 | 更新时间 |

说明：

- 这层的意义是把一次登录签发的 access / refresh token 绑成一组，方便后续按设备批量撤销。
- 旧登录态没有设备信息时，`device_id` 可以为空，但仍要允许撤销。

### 3.3 `auth_login_events`

覆盖需求：3、6

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 登录事件 ID |
| `user_id` | string | 是 | 所属用户 |
| `device_id` | string | 否 | 关联设备 |
| `client_type` | string | 是 | 客户端类型 |
| `source_address` | string | 否 | 来源地址 |
| `occurred_at` | string | 是 | 登录成功时间 |

说明：

- 第一阶段只记录成功的交互式登录事件
- 每次写入后，按 `occurred_at DESC` 仅保留每个用户最近 10 条

### 3.4 对现有 `auth_tokens` 的扩展

覆盖需求：1、5、6

现有 `auth_tokens` 不删，继续保留。

新增字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `device_session_id` | string | 否 | 关联设备会话 ID |
| `caller_kind` | string | 否 | `interactive_user/assistant_runtime` 快照，便于设备管理筛掉内部 token |

说明：

- `caller_kind` 现在可由 token 格式推断，但落库快照更利于后续筛选
- 老数据迁移后允许为空，读取时按旧规则兜底推断

## 4. 设备识别与请求约定

### 4.1 前端请求头

覆盖需求：1、6

交互式客户端在登录、刷新和受保护请求里补以下头：

- `x-codingns-client-type`
- `x-codingns-client-instance-id`

值来源：

- `clientType`：从 `platform-adapter` 的运行时平台归一化得到
- `clientInstanceId`：前端首次生成并持久化的稳定 UUID

### 4.2 来源地址解析

覆盖需求：1、3

来源地址只从 Host 取：

1. 优先 `x-forwarded-for` 的首个地址
2. 否则退回 Fastify 请求 IP
3. 解析失败则记为 `null`

不做：

- 地区解析
- ASN 解析
- 运营商归属

### 4.3 旧登录态兼容

覆盖需求：2、6

对没有 `clientInstanceId` 的历史 token：

- 不强制失效
- 可以继续走鉴权
- 设备页里显示为“未知设备（旧登录态）”
- 一旦该客户端重新登录，才创建完整设备记录

## 5. 核心流程

### 5.1 登录流程

覆盖需求：1、2、3、6

1. 客户端提交 `POST /api/auth/login`
2. Host 校验用户名密码成功
3. Host 解析 `clientType`、`clientInstanceId`、`sourceAddress`
4. Host 查找或创建 `auth_devices`
5. Host 签发 access / refresh token
6. Host 创建 `auth_device_sessions`
7. Host 记录一条 `auth_login_events`
8. Host 裁剪该用户超过 10 条的旧登录记录
9. 返回原有登录结果；第一阶段可额外返回当前设备摘要，但不要求旧客户端依赖它

### 5.2 刷新流程

覆盖需求：1、6

1. 客户端提交 `POST /api/auth/refresh`
2. Host 校验 refresh token
3. Host 签发新的 token 对
4. 如果当前请求带完整设备头，则补齐或更新设备最近活跃时间和来源地址
5. 新 token 继续绑定原来的 `device_session_id`

关键点：

- 刷新不会新建设备
- 刷新默认不会新增最近登录记录

### 5.3 设置或取消主设备流程

覆盖需求：4、6

接口建议：

- `POST /api/auth/devices/current/primary`

请求体：

```json
{
  "password": "当前管理员密码",
  "primary": true
}
```

流程：

1. 当前请求必须已经登录
2. Host 根据 access token 找到当前设备
3. Host 重新校验管理员密码
4. 通过后更新 `auth_devices.is_primary`
5. 返回当前设备最新摘要

说明：

- `primary: true` 表示设为主设备
- `primary: false` 表示取消主设备
- 主设备不唯一，所以这里不需要先把其他主设备清空

### 5.4 退出其他设备流程

覆盖需求：5、6

接口建议：

- `POST /api/auth/devices/logout-others`

流程：

1. 当前请求必须已经登录
2. Host 找到当前设备
3. 当前设备必须是主设备
4. Host 找到同一用户下 `caller_kind = interactive_user` 且不属于当前设备的所有有效设备会话
5. 批量撤销这些会话关联的 access / refresh token
6. 把这些设备会话标记为 `revoked_at`
7. 返回撤销数量和最新设备列表摘要

说明：

- 只退出“其他设备”，不退出当前设备
- 助手运行时或内部 token 不进入这条批量撤销范围

## 6. 接口设计

### 6.1 `GET /api/auth/devices`

覆盖需求：2、3

输出建议：

```ts
interface AuthDeviceManagementDto {
  currentDevice: AuthDeviceView | null;
  otherActiveDevices: AuthDeviceView[];
  recentLoginRecords: RecentLoginRecordView[];
}
```

其中：

- `currentDevice`：当前请求命中的设备
- `otherActiveDevices`：其他未失效设备
- `recentLoginRecords`：最多 10 条

### 6.2 `POST /api/auth/devices/current/primary`

覆盖需求：4

输入：

```ts
interface UpdateCurrentDevicePrimaryInput {
  password: string;
  primary: boolean;
}
```

错误：

- `401 UNAUTHORIZED`
- `400 DEVICE_CONTEXT_REQUIRED`
- `401 INVALID_CREDENTIALS`

### 6.3 `POST /api/auth/devices/logout-others`

覆盖需求：5

输出：

```ts
interface LogoutOtherDevicesResult {
  success: true;
  revokedDeviceCount: number;
}
```

错误：

- `401 UNAUTHORIZED`
- `400 DEVICE_CONTEXT_REQUIRED`
- `403 PRIMARY_DEVICE_REQUIRED`

## 7. 前端设计

### 7.1 设置页入口

覆盖需求：2、3、4、5

入口位置：

- 桌面端：`安全与隐私` 分区内增加“登录设备管理”卡片
- 移动端：`安全与隐私` 分区页面内增加设备管理区块

### 7.2 页面结构

第一阶段按三块展示：

1. 当前设备
   - 客户端类型
   - 最近来源地址
   - 最近在线时间
   - 是否主设备
   - “设为主设备 / 取消主设备”按钮
2. 其他在线设备
   - 列表展示
   - 主设备标记
   - 为空时给出空状态
3. 最近登录记录
   - 最近 10 条
   - 展示时间、客户端类型、来源地址

动作：

- 当前设备上设为主设备
- 当前设备上取消主设备
- 主设备上退出其他设备

### 7.3 前端状态处理

- 设备列表加载失败时显示明确错误，不静默吞掉
- 设置主设备成功后立即刷新设备列表
- 退出其他设备成功后立即刷新设备列表和最近登录记录
- 当前设备被判定不是主设备时，退出其他设备按钮保持禁用或明确报错

## 8. 迁移与兼容

### 8.1 数据库迁移策略

1. 新增 `auth_devices`
2. 新增 `auth_device_sessions`
3. 新增 `auth_login_events`
4. 给 `auth_tokens` 增加 `device_session_id`、`caller_kind`
5. 不对历史 token 强制补全设备记录

### 8.2 旧客户端兼容策略

- 旧客户端不带 `x-codingns-client-instance-id` 时，登录仍然成功
- 但设备页会把这类会话归成旧登录态兜底项
- 新客户端一旦重新登录或刷新，可逐步补齐设备元数据

## 9. 风险与取舍

### 9.1 为什么不用 token 直接管设备

因为那会把“设备”和“会话”混为一谈。
这不是抽象洁癖，这是为了避免后面到处写特殊判断。

### 9.2 为什么第一阶段不做逐个设备下线

因为用户当前明确要的是“主设备退出其他设备”。
先把批量撤销走通，比顺手加一堆半吊子单设备操作更值钱。

### 9.3 为什么最近登录记录只保留 10 条

这是已确认的产品边界。
第一阶段要的不是审计仓库，而是让用户能快速看最近发生了什么。
