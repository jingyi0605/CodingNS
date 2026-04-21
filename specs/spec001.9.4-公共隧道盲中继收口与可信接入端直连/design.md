# 设计文档 - spec001.9.4 公共隧道盲中继收口与可信接入端直连

状态：Draft

## 1. 概述

### 1.1 目标

- 把 `relay-edge` 收口成真正的盲中继
- 在支持桌面客户端和可信 H5 的前提下，简化公共隧道建立流程
- 保留客户端与 Host 之间现有的端到端加密和业务包语义
- 让 Host 改成一条持久上游信道，减少重复建连和边缘伪客户端逻辑

### 1.2 这次不追求什么

- 不追求浏览器 raw TCP
- 不追求把 Host 本地业务协议整个翻新
- 不追求一次性做完多节点全局中继架构

一句人话：
这次做的是“把边缘代理砍掉，保住客户端到 Host 的加密直连”，不是另起一套完全陌生的网络系统。

## 2. 当前问题诊断

### 2.1 现在哪里错了

当前公共隧道里，`relay-edge` 干了两类互相打架的事：

1. 一类是好事：会话预留、Host 配对、字节转发、流量计量
2. 一类是坏事：读取公网 HTTP / WebSocket 明文，再自己去和 Host 建加密会话

坏事带来的结果：

- 中继能看到业务明文
- `relay-edge` 变成了“伪客户端”
- 边缘需要解密再加密，链路更长、更慢
- 失败点增多，错误信息变成 `PUBLIC_TUNNEL_FAILED` 这种混合错误

### 2.2 当前链路里哪些步骤是纯浪费

当前多出来的浪费步骤主要有四个：

1. 边缘读取公网业务 HTTP body / WS message
2. 边缘把明文再包装成 `http.request / ws.message`
3. 边缘自己和 Host 建立一条端到端加密会话
4. 边缘把 Host 回包解密，再回给公网客户端

这些步骤一旦存在，中继就不是盲中继。

## 3. 最简方案

### 3.1 总体判断

在必须支持 H5 的前提下，最简方案不是 raw TCP，而是：

- **可信 H5 / 官方桌面客户端**
- **一条对 `relay-edge` 的 WSS 连接**
- **客户端与 Host 之间的端到端加密**
- **`relay-edge` 只做会话配对和密文字节转发**

这里“最简”指的是：

- 保留浏览器可用性
- 保留现有客户端到 Host 的业务包模型
- 删除边缘明文桥接和边缘伪客户端

### 3.2 新链路

#### 3.2.1 Host 上线链路

```text
Host
  -> relay-edge 申请 challenge
  -> Host 用长期私钥签 challenge
  -> 建立单条 host 上游 WSS
  -> 后续多个下游会话都复用这条上游信道
```

一句人话：
Host 上线一次，后面别再为每个新访客重新 claim 一遍。

#### 3.2.2 桌面客户端 / H5 建连链路

```text
可信接入端
  -> control-api 请求 connect-init
  <- 返回 relayBaseUrl + sessionId + connectTicket + Host 公钥 + 指纹
  -> 直接连接 relay-edge downstream WSS
  -> 与 Host 完成 E2EE 握手
  -> 后续业务都走密文帧
```

一句人话：
客户端只需要先问一次控制面“该连谁、怎么连”，后面直接和 Host 对话。

### 3.3 `*.tunnelDomain` 的收口规则

`*.tunnelDomain` 不再承载业务代理。

它只允许做这三种事之一：

1. 返回跳转到可信 H5 域名
2. 返回“请使用官方客户端或可信 H5 打开”的提示页
3. 作为路由标识，让可信 H5 读取后自己建立隧道

不再允许：

1. 直接把公网业务 HTTP 请求代理给 Host
2. 直接把公网业务 WebSocket 消息桥接给 Host
3. 从该域名下发可执行业务 H5 代码后再宣称“中继看不到内容”

## 4. 各端职责

### 4.1 Host

Host 只做三件事：

1. 维护长期身份密钥和指纹
2. 维护一条到 `relay-edge` 的持久上游信道
3. 在本地解密后继续调用现有 `/api/*` 和 `/ws`

Host 不再做：

- 每个会话单独 claim 下一条 reservation
- 为每个客户端单独建一条新的 Host 上游 WebSocket

### 4.2 桌面客户端

桌面客户端负责：

1. 请求 `connect-init`
2. 校验 Host 公钥和指纹
3. 建立下游 WSS
4. 与 Host 完成 E2EE
5. 复用现有业务传输模型

桌面客户端不再依赖：

- `relay-edge` 的公网业务代理

### 4.3 H5 客户端

H5 负责的事情和桌面客户端一样，只是代码从可信域名加载。

H5 仍然不能做：

- raw TCP

所以 H5 的最简实现就是：

- 浏览器到 `relay-edge` 是 `WSS`
- 浏览器与 Host 在该 `WSS` 上跑端到端加密帧

### 4.4 Channel 端

Channel 端拆成两块：

#### `control-api`

负责：

- 解析 `tunnelDomain`
- 返回 Host 公钥和指纹
- 发短期会话票据
- 管理额度和订单

不负责：

- 业务代理
- 业务解密

#### `relay-edge`

负责：

- Host 上游注册
- 客户端下游接入
- 会话配对
- 字节转发
- 限流和扣量

不负责：

- 读取业务 HTTP body
- 读取业务 WebSocket 正文
- 与 Host 建立“伪客户端”加密会话

## 5. 协议收口方案

### 5.1 保留什么

保留客户端和 Host 之间现有的：

- Host 长期身份密钥
- Host 指纹校验
- 应用层端到端加密
- `http.request / http.response / ws.open / ws.message / ws.closed` 这些内层业务包语义

原因很简单：

- 这些语义已经在客户端和 Host 两端存在
- 真正的问题不在这里
- 问题在于 `relay-edge` 现在也在理解并处理这些语义

### 5.2 删除什么

删除 `relay-edge` 里的这些模块或职责：

- 公网 `/*` HTTP 业务代理
- 公网 `/*` WebSocket 业务桥接
- 边缘侧 `RelayEdgePublicTunnelConnection`
- 边缘侧“自己做下游客户端会话并解密 Host 回包”的流程

### 5.3 新增什么

#### 5.3.1 connect-init

新增控制面连接初始化接口，最小返回值：

```ts
interface TunnelConnectInitResponse {
  tunnelDomain: string;
  relayBaseUrl: string;
  sessionId: string;
  connectTicket: string;
  hostPublicKey: string;
  hostFingerprint: string;
  expiresAt: string;
}
```

这个接口把现在“resolve binding + authorize session”的两步，收口成客户端眼里的一步。

#### 5.3.2 Host 上游信道

Host 上游信道使用一条长期 WSS。

Host 建连前仍然做 challenge + proof，但只在“Host 上线”时做一次，而不是每个下游会话做一次。

#### 5.3.3 轻量级 edge envelope

因为 Host 侧是一条上游信道要复用多个客户端会话，所以 `relay-edge` 需要一个很薄的 envelope 来区分会话：

```ts
type RelayEdgeEnvelope =
  | { type: "session.open"; sessionId: string }
  | { type: "session.frame"; sessionId: string; payloadBase64Url: string }
  | { type: "session.close"; sessionId: string; code: number; reason: string | null };
```

注意：

- 这个 envelope 只给 `relay-edge` 做会话路由
- `payloadBase64Url` 里面仍然是不透明密文字节
- `relay-edge` 不理解里面的业务 HTTP / WS 语义

## 6. 数据与存储

### 6.1 `relay-edge` 允许保存的数据

- `sessionId`
- `bindingId`
- `tunnelDomain`
- `accountId`
- `hostConnected / clientConnected`
- `upstreamBytes / downstreamBytes`
- `createdAt / updatedAt / expiresAt`

### 6.2 `relay-edge` 明确不保存的数据

- 业务 HTTP body
- 业务 HTTP response body
- 业务 WebSocket message
- Host 解密后的业务包

### 6.3 调试日志红线

默认调试日志只允许输出：

- 会话 ID
- 绑定 ID
- tunnelDomain
- 错误码
- 字节数
- 时间戳

默认不允许输出：

- 请求体
- 响应体
- 业务消息正文
- 解密后的帧内容

## 7. 兼容与迁移

### 7.1 第一阶段迁移顺序

1. 先新增 `connect-init` 和 Host 持久上游信道
2. 再让桌面客户端和可信 H5 切到新建连路径
3. 补回归测试和抓包验收
4. 最后下线 `relay-edge` 公网业务代理入口

### 7.2 明确不破坏什么

- Host 本地 `/api/*`
- Host 本地 `/ws`
- 现有业务登录、token 和权限
- 本地直连、局域网直连、Tailscale

## 8. 验证策略

### 8.1 代码级验证

- 搜不到 `relay-edge` 处理公网业务 body 的路径
- 搜不到 `relay-edge` 解密业务密文帧的路径
- 搜不到 `relay-edge` 直接输出业务内容的日志

### 8.2 抓包验证

- 在 `relay-edge` 与 Host 之间抓包，只能看到密文字节
- 在 `relay-edge` 进程日志和数据库里找不到业务 body / message 正文

### 8.3 回归验证

- 桌面客户端远程登录
- H5 远程登录
- Host 断线重连
- 多会话并发
- 流量扣量
- 指纹不匹配阻断

