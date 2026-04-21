# 需求文档 - spec001.9.4 公共隧道盲中继收口与可信接入端直连

状态：Draft

## 简介

当前公共隧道已经把 Host、客户端和 Channel 端接起来了，但链路里还残留一个根本性问题：

- `relay-edge` 现在不只是转发密文字节，它还会读取公网 HTTP / WebSocket 明文，再自己去和 Host 建加密会话

这直接破坏了“中继绝对看不到业务明文”这个硬目标。

这次要解决的事很明确：

1. 把 `relay-edge` 收口成真正的盲中继
2. 让桌面客户端和可信 H5 自己与 Host 建立端到端加密
3. 在不破坏 H5 支持的前提下，把连接步骤减到最少
4. 保留现有业务认证和本地 Host 语义，不重写业务协议

## 术语表

- **可信接入端**：官方桌面客户端，或从固定可信域名加载的官方 H5
- **盲中继**：中继只负责会话配对、转发密文字节和统计字节数，不参与业务解密
- **连接初始化**：客户端连接前，向控制面拿到 `relayBaseUrl`、Host 公钥、指纹和短期会话凭证的步骤
- **Host 上游信道**：Host 到 `relay-edge` 的持久连接，供多个下游会话复用
- **会话票据**：控制面发给可信接入端的短期凭证，只用于建立本次隧道会话
- **入口域名**：`*.tunnelDomain` 这类对外可见地址，只做入口标识或跳转，不承载业务代理

## 范围说明

### In Scope

- 收口 `relay-edge` 的公网 HTTP / WS 业务代理能力
- 定义 Host、桌面客户端、H5 客户端、Channel 端的最简连接链路
- 定义 `control-api` 的连接初始化接口和短期会话票据
- 定义 Host 单条持久上游信道和多会话复用方式
- 定义 `*.tunnelDomain` 的可信跳转边界
- 定义迁移策略和回归验收方式

### Out of Scope

- 浏览器 raw TCP
- 支付、订单、管理员后台的新增能力
- 全量多节点分布式中继重构
- 业务认证协议重写

## 需求

### 需求 1：`relay-edge` 不得直接处理公网业务 HTTP / WebSocket 明文

**用户故事：** 作为系统维护者，我希望中继真正只做密文转发，而不是在边缘进程里读取请求体和响应体。

#### 验收标准

1. WHEN 公网用户访问 `*.tunnelDomain` THEN System SHALL 不再让 `relay-edge` 直接代理业务 HTTP 请求到 Host
2. WHEN 公网用户通过隧道建立业务 WebSocket THEN System SHALL 不再让 `relay-edge` 解析业务 WebSocket 消息正文
3. WHEN `relay-edge` 处理会话数据 THEN System SHALL 只处理会话元数据和不透明字节帧

### 需求 2：可信 H5 和桌面客户端必须自己与 Host 建立端到端加密

**用户故事：** 作为远程用户，我希望真正的业务明文只出现在我自己的客户端和目标 Host 上。

#### 验收标准

1. WHEN 桌面客户端发起公共隧道访问 THEN System SHALL 由桌面客户端自己完成 Host 公钥校验、握手和密文帧收发
2. WHEN H5 发起公共隧道访问 THEN System SHALL 由可信 H5 页面自己完成 Host 公钥校验、握手和密文帧收发
3. WHEN 握手失败、指纹不匹配或会话密钥无效 THEN System SHALL 立即拒绝业务传输，不得回退到明文

### 需求 3：系统必须把连接初始化步骤压到最少

**用户故事：** 作为架构维护者，我希望在保留安全边界的前提下，把多余的 claim / attach / 边缘伪客户端步骤砍掉。

#### 验收标准

1. WHEN 可信接入端准备连接某个 `tunnelDomain` THEN System SHALL 能通过单个连接初始化接口拿到建立会话所需的最小信息
2. WHEN Host 已在线 THEN System SHALL 不再为每个新下游会话重新建立一条独立 Host 上游 WebSocket
3. WHEN 会话建立成功 THEN System SHALL 比当前实现减少至少一轮边缘侧“解密再加密”中间步骤

### 需求 4：Host 必须维护单条持久上游信道，并支持多个下游会话复用

**用户故事：** 作为 Host 管理员，我希望 Host 上线后维持稳定连接，而不是每来一个用户就重新 claim 一次。

#### 验收标准

1. WHEN 公共隧道已启用且 Host 在线 THEN System SHALL 维护单条长期有效的 Host 上游信道
2. WHEN 多个远程用户同时访问同一 Host THEN System SHALL 在该上游信道上复用多个下游会话，而不是重复创建 Host 上游连接
3. WHEN Host 上游信道断开 THEN System SHALL 能自动重连并恢复在线状态

### 需求 5：`*.tunnelDomain` 必须退回成入口标识或跳转入口

**用户故事：** 作为安全评审者，我希望用户入口域名不再承担业务页面托管和业务代理，避免信任边界继续混乱。

#### 验收标准

1. WHEN 用户直接访问 `*.tunnelDomain` THEN System SHALL 只返回入口信息、跳转行为或可信 H5 入口提示
2. WHEN H5 页面真正加载业务代码 THEN System SHALL 只从固定可信域名加载
3. WHEN 产品文档描述访问方式 THEN System SHALL 明确写出“入口域名不承载业务代理”

### 需求 6：Channel 端只允许保留会话元数据和流量计量数据

**用户故事：** 作为运营者，我需要记账和排障，但不应该持有业务明文。

#### 验收标准

1. WHEN `control-api` 或 `relay-edge` 存储会话记录 THEN System SHALL 只保存 `sessionId`、`bindingId`、`tunnelDomain`、连接状态、字节数和时间戳
2. WHEN 管理后台查看连接记录 THEN System SHALL 只能看到会话元数据和流量统计，不能查看业务 body 或业务消息正文
3. WHEN 调试日志开启 THEN System SHALL 默认不输出业务请求体、响应体或业务消息正文

### 需求 7：现有业务认证和其他远程访问方式必须保持兼容

**用户故事：** 作为现有用户，我希望只是隧道接入方式变干净了，不是把现有登录和本地访问一起打碎。

#### 验收标准

1. WHEN 公共隧道切到新方案 THEN System SHALL 继续保留现有 Host `/api/*` 与 `/ws` 业务语义
2. WHEN 用户通过公共隧道访问 Host THEN System SHALL 继续走现有 CodingNS 业务登录体系
3. WHEN 公共隧道不可用 THEN System SHALL 继续允许本地直连、局域网直连和 Tailscale 访问

### 需求 8：系统必须提供可执行的迁移和验收方案

**用户故事：** 作为实施者，我希望不是只画新图，而是知道旧入口怎么下线、新链路怎么验收。

#### 验收标准

1. WHEN 新方案开始上线 THEN System SHALL 明确旧公网业务代理入口的下线顺序和兼容窗口
2. WHEN 新方案完成联调 THEN System SHALL 能通过抓包、日志和回归测试证明中继看不到业务明文
3. WHEN 后续有人再改公共隧道 THEN System SHALL 有固定的最低回归清单，防止明文桥接死灰复燃

## 非功能需求

### 非功能需求 1：安全性

1. WHEN 可信接入端建立会话 THEN System SHALL 校验 Host 公钥和指纹，不得只信任 `tunnelDomain`
2. WHEN Channel 端被攻破或运营方试图读取流量 THEN System SHALL 只能拿到会话元数据和密文字节，不能直接得到业务明文
3. WHEN 会话票据过期、伪造或重放 THEN System SHALL 拒绝建立新会话

### 非功能需求 2：性能

1. WHEN 新方案替换旧公网桥接方案 THEN System SHALL 减少一轮边缘侧解密 / 再加密
2. WHEN Host 在线且多会话并发 THEN System SHALL 复用持久上游信道，减少额外建连开销
3. WHEN 业务消息经过 Channel 端 THEN System SHALL 不再发生边缘侧业务 body 的重复 JSON / base64 编解码

### 非功能需求 3：可观测性

1. WHEN 会话建立失败 THEN System SHALL 给出“票据无效 / Host 离线 / 指纹不匹配 / 握手失败”等明确错误
2. WHEN 运维排障 THEN System SHALL 能看到会话状态、在线状态、耗时和字节数，但不能查看业务正文

## 成功定义

- `relay-edge` 不再直接处理公网业务 HTTP / WS 明文
- 桌面客户端和可信 H5 自己与 Host 建立端到端加密
- Host 上游信道改成长期连接并支持多会话复用
- `*.tunnelDomain` 退回入口标识或跳转入口
- Channel 端只保留会话元数据和流量计量，不再持有业务明文
- 现有业务认证、本地直连、局域网直连和 Tailscale 不被破坏

