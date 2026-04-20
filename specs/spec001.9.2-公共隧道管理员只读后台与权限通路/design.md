# 设计文档 - spec001.9.2 公共隧道管理员只读后台与权限通路

状态：Draft

## 1. 概述

### 1.1 目标

- 给公共隧道服务补最小可用的管理员权限通路
- 保持现有用户控制台不变
- 先把只读查询链路做稳，再谈后台写操作

### 1.2 覆盖需求

- `requirements.md` 需求 1：账号角色模型
- `requirements.md` 需求 2：管理员鉴权通路
- `requirements.md` 需求 3：全局账号与设备查询
- `requirements.md` 需求 4：激活码与核心事件日志
- `requirements.md` 需求 5：独立管理员前端视图
- `requirements.md` 需求 6：第一期先把只读后台做稳
- `requirements.md` 需求 7：第二期只做最小写操作
- `requirements.md` 需求 8：管理员在线批量生成激活码

### 1.3 当前实现诊断

当前实现有几个硬伤，躲不开：

1. `accounts` 表没有 `role`
2. `AccountProfile` 契约没有角色信息
3. 后端只有 `requireAccount()`，没有管理员鉴权
4. 当前 store 基本都是“按当前账号查自己的数据”
5. `console-web` 只有 `/login`、`/register`、`/forgot-password`、`/dashboard`
6. 浏览器 session 只存 `accessToken` 和 `expiresAt`

这意味着：

- 现在根本不存在真正的管理员后台
- 如果继续把管理员能力塞进用户 `Dashboard`，只会把已有用户界面和接口污染掉

## 2. 总体设计

### 2.1 一套账号体系，两条视图通路

这次不新造第二套账号体系，继续复用现有 `accounts + sessions`。

只新增一件关键数据：

```ts
type AccountRole = "user" | "admin";
```

系统分成两条通路：

1. 用户通路
   - `/api/v1/*`
   - `/dashboard`
2. 管理员通路
   - `/api/admin/*`
   - `/admin/*`

一句人话：
同一套登录态，不同的路由和权限边界。别把两种视图混着做。

### 2.2 分两期收敛，而不是一口气做成垃圾后台

第一期故意收窄：

1. 先做角色
2. 再做鉴权
3. 再做只读查询
4. 最后做前端页面

第二期继续收窄，只补三类最小写操作：

1. 管理员解绑任意绑定
2. 管理员停用 / 重新启用未兑换激活码
3. 管理员在线批量生成激活码

不先做更多写操作，原因很简单：

- 写操作最容易把权限边界搞脏
- 真正急的是先把运营最常见、边界最清楚的动作补上
- 设备解绑、激活码状态切换和激活码生成都能复用现有数据结构，不需要再造新表

## 3. 数据模型设计

### 3.1 accounts 增加 role

数据库迁移新增一条：

```sql
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

UPDATE accounts
SET role = 'user'
WHERE role IS NULL;
```

约束策略：

- 第一版允许值只有 `user` / `admin`
- 默认值固定 `user`
- 旧账号全部兼容为 `user`

### 3.2 共享契约补 role

`AccountProfile` 增加：

```ts
interface AccountProfile {
  accountId: string;
  email: string;
  emailVerified: boolean;
  role: "user" | "admin";
  createdAt: string;
}
```

影响范围：

- `RegisterByEmailResponse`
- `LoginByEmailResponse`
- `AuthMeResponse`

好处很直接：

- 前端不需要再靠猜测当前账号是不是管理员
- 老接口路径不变，只是账号对象多一个字段

## 4. 后端设计

### 4.1 鉴权分层

保留现有：

```ts
requireAccount()
```

新增：

```ts
requireAdmin()
```

行为约定：

1. `requireAccount()` 只负责“是不是有效登录用户”
2. `requireAdmin()` 先走 `requireAccount()`，再判断 `account.role === "admin"`

返回规则：

- 未登录：`401 AUTH_INVALID`
- 非管理员：`403 AUTH_FORBIDDEN`

### 4.2 API 命名空间

管理员接口全部放到独立命名空间：

- `GET /api/admin/accounts`
- `GET /api/admin/bindings`
- `DELETE /api/admin/bindings/:bindingId`
- `GET /api/admin/activation-codes`
- `POST /api/admin/activation-codes/generate`
- `POST /api/admin/activation-codes/:activationCodeId/disable`
- `POST /api/admin/activation-codes/:activationCodeId/enable`
- `GET /api/admin/logs/payment-events`
- `GET /api/admin/logs/relay-usage`

这样做的原因：

1. 普通用户接口继续只表达“当前账号自己的数据”
2. 管理员接口可以名正言顺查全局数据
3. 后续加筛选、分页、导出时不会把用户接口越改越怪

### 4.3 独立管理员读模型

不要把管理员全局查询硬塞进现有用户 store。

当前这些 store 的职责已经很清楚：

- `binding-store.ts`：按账号查绑定，处理绑定和解绑
- `traffic-order-store.ts`：按账号查订单，处理支付事件
- `traffic-wallet-store.ts`：处理钱包和 grant

管理员查询新建独立 `admin-store.ts`，负责跨表只读聚合。

第一版建议提供这些方法：

```ts
listAccounts(input)
listBindings(input)
listActivationCodes(input)
listPaymentEvents(input)
listRelayUsageEvents(input)
```

这样后续后台继续长，也不会把用户侧 store 搞成垃圾。

### 4.4 第二期写操作规则

写操作故意不再新建“管理员万能 store”，而是复用现有领域 store：

- 绑定解绑继续走 `binding-store.ts`
- 激活码状态切换和生成继续走 `traffic-wallet-store.ts`

这样做的原因：

1. 绑定解绑本来就是绑定领域自己的动作，不该被管理员读模型接管
2. 激活码状态和生成本来就在钱包 / 激活码领域里，管理员只是多了一个入口，不是另一套业务

状态规则要写死：

1. 设备解绑允许管理员按 `bindingId` 直接释放，不要求带目标账号 ID
2. 激活码只允许 `active -> disabled`
3. 激活码只允许 `disabled -> active`
4. 已兑换或已过期激活码禁止改状态
5. 用户 `/api/v1/hosts/:bindingId` 和 `/api/v1/activation-codes/*` 语义保持不变
6. 在线生成接口只允许管理员调用，完整码只在当前次响应里返回一次

### 4.5 在线生成激活码

这条能力不新造脚本专用分支，直接复用现有激活码生成和入库逻辑。

请求字段保持最小：

- `count`
- `batchTag`
- `spec`
- `codeExpiresDays`

响应分两层：

1. 当前次生成结果返回完整码和掩码
2. 后台列表和后续查询继续只返回掩码

这样做的原因：

- 管理员确实需要一次性拿到完整码去分发
- 系统不应该把完整码永久暴露给后台列表
- 复用现有生成逻辑，避免再长出一套脚本实现和一套后台实现

### 4.6 列表字段设计

#### 4.6.1 账号列表

每行最小返回：

- `accountId`
- `email`
- `role`
- `createdAt`
- `bindingCount`
- `orderCount`
- `remainingBytes`
- `activeGrantCount`

#### 4.6.2 绑定列表

每行最小返回：

- `bindingId`
- `accountId`
- `accountEmail`
- `hostFingerprint`
- `tunnelDomain`
- `status`
- `createdAt`

#### 4.6.3 激活码列表

每行最小返回：

- `activationCodeId`
- `codeMask`
- `batchTag`
- `activationCodeSpec`
- `status`
- `redeemedByAccountId`
- `redeemedByEmail`
- `redeemedAt`
- `createdAt`

#### 4.6.4 支付事件日志

每行最小返回：

- `eventId`
- `provider`
- `orderId`
- `providerTransactionId`
- `eventType`
- `processedAt`

#### 4.6.5 relay usage 日志

每行最小返回：

- `usageId`
- `accountId`
- `accountEmail`
- `bindingId`
- `tunnelDomain`
- `upstreamBytes`
- `downstreamBytes`
- `observedAt`
- `processedAt`

### 4.7 分页和筛选

第一版不做复杂搜索，只做最小必要筛选：

- `accounts`：`email`、`role`、`limit`、`cursor`
- `bindings`：`accountId`、`status`、`limit`、`cursor`
- `activation-codes`：`batchTag`、`status`、`spec`、`limit`、`cursor`
- `payment-events`：`orderId`、`providerTransactionId`、`limit`、`cursor`
- `relay-usage`：`accountId`、`bindingId`、`limit`、`cursor`

原因：

- 后台没有筛选就是废物
- 但第一版也没必要先上复杂全文搜索

## 5. 前端设计

### 5.1 路由分层

当前路由保持不动：

- `/login`
- `/register`
- `/forgot-password`
- `/dashboard`

新增管理员路由：

- `/admin`
- `/admin/users`
- `/admin/devices`
- `/admin/activation-codes`
- `/admin/logs/payment-events`
- `/admin/logs/relay-usage`

`/admin` 默认重定向到 `/admin/users`。

### 5.2 登录后跳转

登录成功后：

- `role === "admin"`：默认进 `/admin/users`
- 其他账号：继续进 `/dashboard`

### 5.3 浏览器 session 兼容

当前浏览器 session 只存：

- `accessToken`
- `expiresAt`

这次增加：

- `role`

但不能强行让所有旧 session 失效。

兼容策略：

1. 读取本地 session 时，如果有 `role`，直接用
2. 如果没有 `role`，在应用启动后补拉一次 `/api/v1/auth/me`
3. 拿到 `role` 后回写本地 session

### 5.4 页面结构

管理员前端继续只做列表页，不做复杂面板。

页面最小集合：

1. 用户列表页
2. 设备绑定页
3. 激活码页
4. 支付事件页
5. relay usage 页

每页都遵守两条原则：

1. 文案走 i18n
2. 不与用户 `DashboardPage.tsx` 共用一坨条件分支

第二期写操作按钮也守同样规则：

1. 设备页在列表行右侧直接给“解除绑定”
2. 激活码页只在 `active` / `disabled` 状态显示操作按钮
3. 不新做弹窗系统，先用最小确认交互把风险压住
4. 按钮样式继续走现有按钮语义，不重新长一套后台皮肤

## 6. 兼容性与风险

### 6.1 向后兼容策略

这次改动必须守住这几条：

1. 现有 `/api/v1/*` 路由路径不改
2. 现有用户页面路由不改
3. 现有登录、绑定、钱包、订单、兑换行为不改
4. 老账号默认 `role = 'user'`
5. 老 session 缺 `role` 时通过补拉 `me` 兼容

### 6.2 已知风险

风险 1：管理员查询会写出跨表大 SQL

- 处理办法：收敛到独立 `admin-store.ts`

风险 2：前端为了省事把管理员页面塞回用户 `Dashboard`

- 处理办法：强制独立路由和独立页面目录

风险 3：后台写操作长成没有边界的一锅粥

- 处理办法：第二期只允许解绑设备和切换激活码状态，不碰 grant、封禁和复杂 RBAC

## 7. 实施顺序

1. 先做 `accounts.role`、契约和账号 store
2. 再做 `requireAdmin()` 和 `/api/admin/*` 空骨架
3. 再做管理员读模型和只读接口
4. 最后做前端 `/admin/*`
5. 第二期补最小写接口和前端动作按钮
6. 收尾补测试和文档

这个顺序最笨，但最稳。
