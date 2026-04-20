# 设计文档 - spec001.9.1 公共隧道服务二阶段收口与生产化验收

状态：Draft

## 1. 概述

### 1.1 目标

- 把 `spec001.9` 第一阶段的公共隧道主链路补到可上线状态
- 把 `codingns-proxy` 从演示骨架收口成可部署、可运维、可收款的正式子系统
- 补齐支付、域名、邮件、流量和中继的生产化底座
- 固定主仓库与子仓库的最终验收口径

### 1.2 覆盖需求

- `requirements.md` 需求 1：控制台站点落地
- `requirements.md` 需求 2：正式数据库
- `requirements.md` 需求 3：真实邮件与密码找回
- `requirements.md` 需求 4：正式域名池
- `requirements.md` 需求 5：relay-edge 生产化
- `requirements.md` 需求 6：支付联调、对账、人工补发
- `requirements.md` 需求 7：流量闭环
- `requirements.md` 需求 8：主仓库回归
- `requirements.md` 需求 9：E2EE 验收记录
- `requirements.md` 需求 10：部署与出款文档

### 1.3 当前实现诊断

当前状态可以简单概括成一句话：

- 主链路已经能跑，但还不是正式服务。

现状里的主要硬伤：

1. `console-web` 还没有真正的前端实现
2. `control-api` 仍然把核心数据落在文件仓储里
3. `relay-edge` 的会话和 claim 状态还是进程内内存
4. 邮箱验证码发送还是内存发送器
5. 支付测试还是 mock 为主，没做真实 Paddle 沙箱
6. 域名仍然用 `codingns.example` 这类演示值
7. 流量钱包还是累计总量模型，没法正确处理多次发量和不同到期时间
8. 部署、环境变量、对账、出款说明还没写清

如果继续在这个基础上硬往外发版本，后面只会把运营问题、支付问题和生产事故全部堆给人肉处理。

## 2. 总体设计

### 2.1 二阶段只做三件事

1. 把数据真相从“演示状态”升级成“正式状态”
2. 把用户入口从“API 骨架”升级成“真实站点”
3. 把验收从“单元测试过了”升级成“真实联调和文档闭环”

### 2.2 分层保持不变

二阶段不推翻 `spec001.9` 的三层结构，继续保持：

1. **主仓库**
   - Host 侧隧道客户端
   - 客户端 / H5 接入层
   - 端到端加密传输
   - 设置页入口与状态展示
2. **控制面**
   - 账号、绑定、域名、钱包、订单、支付事件
3. **数据面**
   - 盲中继、字节计量、会话生命周期

变化只在于：

- 控制面和数据面要从“最小骨架”升级成“正式服务”
- 正式支付没接完前，先让激活码兑换走同一套流量 grant 账本

## 3. 子仓库架构调整

### 3.1 控制面：从文件仓储切到正式数据库

当前 `control-api` 里的账号、会话、绑定、钱包、订单、验证码都在文件里。

这玩意的问题很直接：

- 单机还凑合
- 一上并发和重启恢复就很脆
- 支付、扣量、发量这些需要幂等的地方很难做干净

二阶段改法：

- 控制面主存储统一切到 `PostgreSQL`
- 继续保留一层 store 接口，但不再允许线上默认落文件
- 关键表至少包括：
  - `accounts`
  - `email_verifications`
  - `password_reset_tokens`
  - `sessions`
  - `tunnel_bindings`
  - `traffic_wallets`
  - `traffic_grants`
  - `activation_codes`
  - `traffic_orders`
  - `payment_events`
  - `domain_reservations`

为什么选 `PostgreSQL`：

- 订单、钱包、支付事件这些东西需要事务和唯一键
- JSON 文件在这里就是垃圾

### 3.2 数据面：会话状态切到共享状态层

当前 `relay-edge` 把会话预留、claim lease 和连接状态都放在内存里。

二阶段做法：

- 会话预留、Host challenge、claim lease、过期回收元数据统一放进 `Redis`
- 单条连接上的 socket 仍然在当前 relay 进程里维护
- 但“哪个会话存在、是否已被 claim、多久过期、剩余额度快照是多少”这些共享状态必须脱离进程内存

一句人话：
连接对象可以在内存里，连接元数据不能只在内存里。

### 3.3 控制台站点真正落地

`apps/console-web` 二阶段建议直接用：

- `React + Vite + React Router`

原因很简单：

- 和现有 `user-app` 技术栈接近
- 足够快，不需要为一个控制台站点搞花活

二阶段最小页面：

1. 注册页
2. 登录页
3. 忘记密码 / 重置密码页
4. 控制台首页
5. Host 绑定与域名状态页
6. 流量钱包与套餐页
7. 订单页

这里不做复杂 CMS，不做营销站，不做管理后台大盘。

## 4. 关键设计点

### 4.1 真实邮件通道

当前 `EmailSender` 接口保留不动，只替换实现。

二阶段规则：

- 默认正式实现使用 `SMTP`
- 允许后续换成其他服务商，但不先做一堆空洞抽象

为什么先用 `SMTP`：

- 够通用
- 国内外都能接
- 适合先把注册和重置密码做稳

邮件模板最小只做两类：

1. 注册验证码
2. 重置密码验证码

### 4.2 域名池模型

当前只是 `hostLabel -> slug.codingns.example`。

这会出的问题：

- 根域不可配置
- 保留词没法拦
- 域名释放后没规则

二阶段改成：

```ts
interface DomainReservation {
  domainId: string;
  rootDomain: string;
  subdomain: string;
  fullDomain: string;
  status: "available" | "reserved" | "bound" | "released";
  reservedByBindingId: string | null;
  reservedAt: string | null;
  releasedAt: string | null;
}
```

基本规则：

- 根域从配置读取
- 保留词名单可配置
- 已绑定域名不得重复分配
- 解绑后进入 `released` 或冷却期，再决定是否可重用

### 4.3 流量账本、激活码与支付发量

这块不能再继续用“给钱包总额度加 5GB”这种烂办法。

原因很简单：

- 用户可能多次兑换
- 每次兑换的到期时间不同
- 后续支付恢复后，也会和激活码一起给流量

如果还把所有来源压成一个 `granted_bytes`，那到期逻辑一定会变成一团垃圾。

二阶段先统一改成 grant 账本模型：

```ts
interface TrafficGrant {
  grantId: string;
  accountId: string;
  sourceType: "activation_code" | "order" | "manual";
  sourceId: string;
  totalBytes: string;
  usedBytes: string;
  remainingBytes: string;
  startsAt: string | null;
  expiresAt: string;
  createdAt: string;
}
```

激活码是 grant 的一个来源，不是单独再造一套钱包逻辑：

```ts
interface ActivationCodeRecord {
  activationCodeId: string;
  code: string;
  batchTag: string | null;
  spec: "5g" | "10g" | "20g" | "50g";
  monthlyBytes: string;
  redeemedByAccountId: string | null;
  redeemedGrantId: string | null;
  redeemedMode: "boost_current_cycle" | "extend_validity_months" | null;
  redeemedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}
```

控制面最小规则：

1. 注册时仍可保留默认试用 grant，但必须也是一条独立 grant
2. 激活码规格固定为 `5g / 10g / 20g / 50g` 四档，每个码代表“1 个 30 天周期”的对应月流量
3. 用户一次可以提交多个码，控制面要先做批量校验，再决定是否允许兑换
4. 兑换模式分两种：
   - `boost_current_cycle`：把通过校验的激活码全部叠加到当前活跃 30 天周期；允许混合规格
   - `extend_validity_months`：把通过校验的激活码按月排到未来周期；只允许同规格批量兑换
5. grant 的 `startsAt` 用来表示未来月份；只有 `startsAt <= now < expiresAt` 的 grant 才算当前可用额度
6. 扣量时按“当前已生效 grant 里最早到期优先”消耗，避免把长期额度提前吃掉
7. 钱包摘要不是单表真相，而是由“当前已生效且未过期 grants + 已使用汇总”推导出来
8. grant 过期后不再参与剩余额度，但历史记录继续保留

周期定义直接写死：

- `30 天 = 1 个有效月`
- 不按自然月切，不按账单月切
- 这样实现最笨，但边界最少

为什么不碰自然月：

- 自然月天数不一样
- 时区和月底边界全是坑
- 这个阶段要的是可上线，不是给自己挖坑

控制台最小入口：

1. 增加多行激活码输入框，支持一次粘贴多码
2. 先显示校验结果：有效数量、规格分布、无效原因
3. 再让用户选择兑换模式
4. grant 列表至少要能看见“当前已生效”和“未来待生效”两种状态
5. Paddle 未准备好时，不把支付按钮当成当前主路径
Paddle 支付链路继续沿用：

- `transaction`
- `checkout.url`
- `webhook`

后续支付恢复时，也必须走这套 grant 账本，不能重新把订单发量写回累计总额。

二阶段新增三块真东西：

1. **支付事件表**
   - 保存原始事件 ID、交易 ID、订单 ID、事件类型、验签结果
2. **发量记录表 / grant 记录**
   - 记录哪一笔订单或哪个激活码给哪个账号发了多少流量、何时过期
3. **人工补发工具**
   - 用内部命令或受保护接口，按订单号补发或重放发量逻辑

核心原则：

- 订单状态不是钱包状态
- 支付事件不是发量结果
- grant 才是流量可用性的真实来源
- 这三者必须能对上，但不能混成一个字段

### 4.4 relay-edge 记账原则

当前字节一边转发一边回写控制面，这个方向对，但还不够稳。

二阶段要求：

- 单条 usage 记录要带幂等键
- 控制面消费 usage 时要按幂等键去重
- relay-edge 本地要能缓存短暂失败的 usage 上报，避免控制面短抖动时直接丢量或乱扣

最小 usage 结构：

```ts
interface RelayUsageEvent {
  usageId: string;
  sessionId: string;
  bindingId: string;
  accountId: string;
  upstreamBytes: string;
  downstreamBytes: string;
  observedAt: string;
}
```

### 4.5 主仓库验收收口

二阶段不要求主仓库再长新协议。

主仓库要做的是三件事：

1. 把公共隧道相关设置页回归补齐
2. 修掉当前失真的测试
3. 固定“本地直连 / Tailscale / 公共隧道”并存的验收基线

特别注意：

- `SettingsPage` 里如果测试把 `RelayTunnelPanel` 整个 mock 掉，就别再假装测到了真实交互

## 5. 部署与运行

### 5.1 最小部署拓扑

```text
console-web
    |
    v
control-api ------ PostgreSQL
    |
    +------ Redis
    |
    v
relay-edge
```

说明：

- `console-web` 只调控制面 API
- `control-api` 负责账号、绑定、订单、钱包和内部授权
- `relay-edge` 负责盲中继和 usage 上报
- `PostgreSQL` 是正式数据真相
- `Redis` 是共享状态和短时会话元数据

### 5.2 配置样例

二阶段要补正式配置样例，至少包含：

- 控制面 URL
- 数据面 URL
- 根域名
- PostgreSQL 连接串
- Redis 连接串
- SMTP 配置
- Paddle API Key / Webhook Secret / API Base URL
- 默认流量包配置

## 6. 验收设计

### 6.1 必须落文档的验收项

1. Paddle 沙箱支付成功到账
2. webhook 重复通知不重复发量
3. 人工补发一次且只发一次
4. 流量耗尽后拒绝新会话
5. 购买成功后恢复连接
6. 本地直连、Tailscale、公共隧道三者并存
7. 抓包确认中继不可见业务明文

### 6.2 文档必须补什么

二阶段至少要补这些说明：

1. 部署说明
2. 环境变量样例
3. 支付联调说明
4. 对账与补发说明
5. Paddle -> Payoneer -> 中国大陆银行卡出款说明
6. 最低验收记录

## 7. 风险与取舍

### 7.1 真问题

- 文件仓储和内存会话表不适合正式服务
- 没有真实邮件和真实支付联调，就不能叫“支持注册和付费”
- 没有验收记录，端到端加密就只是嘴上说

### 7.2 不在二阶段解决的问题

- 企业版能力
- 自定义域名
- 全球多区域部署
- 复杂 BI 和运营大盘

一句人话：
先把能上线的版本做扎实，再谈花哨扩展。
