# 设计文档 - spec001.9 公共隧道服务接入与端到端加密远程访问

状态：Draft

## 1. 概述

### 1.1 目标

- 让没有公网地址的 Host 也能通过 CodingNS 官方公共隧道服务被访问
- 在本仓库内实现 Host 侧隧道客户端、客户端 / H5 接入层和端到端加密传输
- 把公共云站点、支付、流量账本和数据面转发节点放到独立子仓库
- 保持现有 Host 业务接口、登录体系和本地直连流程稳定

### 1.2 覆盖需求

- `requirements.md` 需求 1：强制分仓
- `requirements.md` 需求 2：实例级公共隧道配置模型
- `requirements.md` 需求 3：账号绑定与三级域名
- `requirements.md` 需求 4：端到端加密信道
- `requirements.md` 需求 5：可信接入端与三级域名边界
- `requirements.md` 需求 6：保留现有业务认证
- `requirements.md` 需求 7：流量计量与流量限额
- `requirements.md` 需求 8：成熟支付购买流量套餐
- `requirements.md` 需求 9：长连接、自动重连和启动恢复
- `requirements.md` 需求 10：未初始化实例阻断

### 1.3 技术约束

- Host 继续沿用现有 `Node.js + Fastify + ws`
- 现有 `/api/*` 与 `/ws` 业务语义尽量不改，优先改传输层，不重写所有业务接口
- 公共云站点代码不放进本仓库
- 公共隧道数据面必须默认视为不可信，只能看到密文字节
- 前端显示文案必须进入 i18n 字典

### 1.4 当前实现诊断

当前项目已经有两类访问方式：

1. 本地 / 局域网直连
2. `spec001.4` 里定义的 Tailscale 远程访问

这两条链路都解决不了“官方托管公网入口 + 流量套餐 + 支付”这个问题。

已经确认的现状：

1. 现有客户端核心访问模型还是 `HTTP + WebSocket`
2. Host 的设置页已经有“远程访问”入口，适合继续扩展成多种远程接入方式
3. Host 端已经有后台任务和 helper 进程的接入规范，长连接和重连不能再长散装 `timer`

一句人话：
这次不该去重写整套业务 API，应该在现有 Host 之上加一层“加密隧道传输层”。

## 2. 总体架构

### 2.1 三个边界，别混

这次必须拆成三块：

1. **本仓库**
   - Host 侧隧道客户端
   - 客户端 / H5 隧道接入层
   - 端到端加密协议
   - 设置页和状态接口
2. **独立子仓库：`apps/codingns-proxy/`**
   - 账号系统
   - 三级域名分配
   - 支付、订单、流量钱包
   - 公网数据面中继节点
3. **现有 Host 业务层**
   - 继续提供 `/api/*` 和 `/ws`
   - 继续负责业务登录、Token 和权限

### 2.2 信任模型

#### 2.2.1 中继能看到什么

公共隧道中继只能看到这些：

- 哪个账号
- 哪个 Host
- 哪个三级域名
- 哪条隧道会话
- 上下行传输了多少字节
- 连接何时建立、断开、超额

中继默认看不到这些：

- 业务 HTTP 请求体
- 业务 HTTP 响应体
- WebSocket 消息正文
- Host 内部会话内容
- 用户的业务 token 明文

#### 2.2.2 不能自欺欺人的地方

如果让用户三级域名直接托管完整业务 H5 页面，再声称“中继绝对看不到内容”，那是胡扯。

原因很简单：

- 只要业务 H5 代码直接从中继域名加载，中继就有机会替换页面代码
- 页面代码一旦可替换，后续端到端加密也失去意义

所以本 Spec 定死一条规则：

- **三级域名只做入口、路由标识或跳转入口**
- **官方 H5 只能从固定可信域名加载**

例如：

- 用户入口：`https://alice.example.codingns.cn`
- 可信 H5：`https://app.codingns.cn/connect/alice.example.codingns.cn`

### 2.3 总体链路

```text
官方客户端 / 官方H5
        |
        | 1. 连接公共中继（外层 TLS）
        | 2. 与 Host 做应用层 E2EE 握手
        v
公共隧道数据面（盲中继）
        |
        | 只转发密文帧并记录字节数
        v
Host 隧道客户端
        |
        | 解密后转为本地 HTTP / WS
        v
本地 CodingNS Host
```

## 3. 模块划分

### 3.1 本仓库新增模块

| 模块 | 职责 | 位置 |
| --- | --- | --- |
| `relay-tunnel-service` | 管理实例级公共隧道配置和状态机 | `apps/host/src/modules/relay-tunnel/*` |
| `relay-tunnel-client` | 维护 Host 到中继的数据面长连接 | `apps/host/src/modules/relay-tunnel/*` |
| `relay-crypto` | Host 身份密钥、握手、加密帧 | `apps/host/src/modules/relay-tunnel/crypto/*` 或共享包 |
| `relay-system-routes` | 对设置页暴露状态、绑定、启停接口 | `apps/host/src/routes/system.ts` 附近 |
| `remote-tunnel-transport` | 客户端 / H5 发起隧道连接、握手和加密帧收发 | `apps/user-app/src/network/*` |
| `RemoteAccessPanel` | 远程访问设置页入口，支持 Tailscale / 公共隧道 provider 切换 | `apps/user-app/src/settings/*` |

### 3.2 独立子仓库模块

| 模块 | 职责 |
| --- | --- |
| `console-web` | 公共隧道站点控制面 |
| `control-api` | 账号、Host 绑定、三级域名、套餐、订单、流量钱包 |
| `relay-edge` | 公网隧道数据面，做盲中继和字节统计 |
| `billing-worker` | 订单回调、流量发放、超额处理 |

### 3.3 为什么不直接复用现有 `/proxy/*`

仓库里现有 `/proxy/*` 是模板开发代理，解决的是“本地 dev server 代理”和资源改写问题。

它不是公网盲中继，更不是端到端加密隧道。

如果把两者混用，会马上出现三坨垃圾：

1. 内部模板代理逻辑和公网中继语义混在一起
2. 计费、限流和账号绑定被硬塞进本地开发代理
3. 安全边界失真，看起来像复用，实际是烂耦合

所以这次必须另起一套模块，不复用模板代理实现。

## 4. 数据结构

### 4.1 InstanceRelayTunnelConfig

```ts
export interface InstanceRelayTunnelConfig {
  enabled: boolean;
  provider: "codingns_relay";
  relayBaseUrl: string | null;
  controlBaseUrl: string | null;
  accountId: string | null;
  tunnelDomain: string | null;
  bindingId: string | null;
  hostPublicKey: string | null;
  hostKeyFingerprint: string | null;
  localTargetBaseUrl: string;
  updatedAt: string;
}
```

说明：

- `relayBaseUrl` 是数据面入口
- `controlBaseUrl` 是控制面入口
- `tunnelDomain` 是分配到的三级域名
- `hostPublicKey` 和 `hostKeyFingerprint` 是 Host 身份材料
- `localTargetBaseUrl` 指向本地 Host 真实监听地址

### 4.2 InstanceRelayTunnelStatus

```ts
export type RelayTunnelPhase =
  | "disabled"
  | "blocked_uninitialized"
  | "unbound"
  | "binding"
  | "connecting"
  | "running"
  | "quota_exhausted"
  | "error";

export interface InstanceRelayTunnelStatus {
  phase: RelayTunnelPhase;
  connected: boolean;
  bindingId: string | null;
  tunnelDomain: string | null;
  hostFingerprint: string | null;
  trafficUsedBytes: string | null;
  trafficRemainingBytes: string | null;
  quotaResetAt: string | null;
  lastError: string | null;
  observedAt: string | null;
}
```

说明：

- `phase` 是设置页展示真相
- `trafficUsedBytes` 和 `trafficRemainingBytes` 来自控制面，不由本地猜
- `quota_exhausted` 是正式状态，不要把它塞进错误字符串里

### 4.3 加密帧模型

第一阶段不改业务协议语义，改传输层。

客户端和 Host 在端到端握手完成后，所有业务数据都变成加密帧：

```ts
export interface TunnelFrame {
  sessionId: string;
  streamId: string;
  kind:
    | "handshake"
    | "http.request.head"
    | "http.request.body"
    | "http.response.head"
    | "http.response.body"
    | "ws.open"
    | "ws.message"
    | "ws.close"
    | "ping"
    | "pong"
    | "error";
  payload: Uint8Array;
}
```

一句人话：
中继只认识“帧”和“字节数”，不认识业务内容。

## 5. 加密方案

### 5.1 基本原则

- 外层仍然走 TLS，避免裸奔
- 内层再做一层应用级端到端加密，防止中继解密业务内容
- 不允许明文回退

### 5.2 身份与握手

第一阶段建议：

1. Host 首次启用时生成长期身份密钥对
2. Host 把公钥和指纹注册到控制面
3. 客户端 / H5 连接前先拿到 Host 公钥和指纹
4. 双方基于临时密钥 + Host 长期公钥协商会话密钥
5. 后续所有业务帧都用会话密钥加密

这里不把具体算法写死到代码级，但设计要求必须满足：

- 有正式密钥协商
- 有会话密钥
- 有完整性校验
- 能检测指纹不匹配

### 5.3 为什么不直接把 Access Token 当“加密密钥”

因为那是垃圾设计。

Access Token 的职责是鉴权，不是加密。

把鉴权 token 直接当密钥会造成：

- 密钥生命周期和登录态绑死
- 无法做正式握手
- 无法做安全轮换
- 风险面扩大

所以鉴权和加密必须分层。

## 6. 核心流程

### 6.1 首次启用与绑定流程

1. 管理员在设置页选择“公共隧道”
2. Host 检查 bootstrap 是否完成
3. Host 若还没有身份密钥，则先生成并落库
4. 管理员登录公共隧道账号
5. 控制面创建或确认 Host 绑定，分配三级域名
6. Host 保存 `bindingId / tunnelDomain / hostPublicKey / fingerprint`
7. Host 启动隧道客户端并连到数据面
8. 状态进入 `running` 或返回明确错误

### 6.2 客户端访问流程

1. 客户端知道要访问的 `tunnelDomain`
2. 客户端先向控制面获取该 Host 的公开绑定信息和公钥材料
3. 客户端连到数据面
4. 客户端与 Host 完成端到端握手
5. 握手成功后，客户端把业务 HTTP / WS 封成加密帧发给 Host
6. Host 解密后转发到本地 `http://127.0.0.1:<host-port>`
7. Host 再把响应封成加密帧回传

### 6.3 官方 H5 流程

1. 用户访问三级域名
2. 公共站点只返回跳转、打开说明或短入口页
3. 真正业务 H5 从固定可信域名加载
4. H5 拿到 `tunnelDomain` 后，按和客户端相同的方式建立端到端握手

### 6.4 流量计量与限额流程

1. 数据面按会话统计双向密文字节数
2. 控制面异步汇总到用户流量钱包
3. 达到上限后，控制面把绑定状态切为 `quota_exhausted`
4. 数据面拒绝新连接，并对活跃会话执行受控断流

### 6.5 启动恢复与自动重连

1. Host 启动时读取实例级公共隧道配置
2. 若 `enabled=true` 且已绑定，则注册后台任务并尝试恢复长连接
3. 网络抖动时由 `TaskManager` 管理重连节奏
4. 长时间失败则写入 `error`

## 7. 与现有业务链路的关系

### 7.1 业务 Host 不改语义

现有 Host 仍提供：

- `GET /api/...`
- `POST /api/...`
- `WebSocket /ws`

隧道层只负责把这些请求改成“加密帧 <-> 本地转发”。

### 7.2 认证仍由业务 Host 负责

访问顺序保持这样：

1. 先通过公共隧道到达 Host
2. 再由 Host 执行现有业务登录、Token 校验和 WebSocket 鉴权

也就是说：

- 公共隧道负责“通路”
- CodingNS Host 负责“业务认证”

## 8. 后台任务与进程模型

### 8.1 为什么必须走 TaskManager

公共隧道客户端有这些特点：

- 跨请求长期存在
- 要自动重连
- 要去重
- 要可观测

这类东西如果不用 `TaskManager`，一定会长出私有 `timer/inflight` 垃圾。

所以规则定死：

- Host 侧长连接恢复、重连、状态刷新都走 `TaskManager`
- 执行位点默认用 `helper_process` 或合适的后台位点
- 设置页只读状态和发操作，不直接自己跑重逻辑

### 8.2 推荐任务

- `relay_tunnel.connect`
- `relay_tunnel.reconnect`
- `relay_tunnel.binding_refresh`
- `relay_tunnel.traffic_refresh`

## 9. UI 方案

### 9.1 设置页结构

“远程访问”页改成 provider 化：

- 本地 / 局域网
- Tailscale
- 公共隧道

公共隧道面板至少展示：

- 当前状态
- 绑定账号
- 三级域名
- Host 指纹
- 套餐余量
- 最近错误
- 启用 / 停用
- 绑定 / 解绑
- 打开控制台

### 9.2 用户文案

必须说人话：

- 已绑定，可通过以下域名访问
- 当前流量已用尽，请先购买套餐
- 正在连接公共隧道
- 端到端加密握手失败

不要把 `relay edge disconnected` 这种内部错误直接甩给普通用户。

## 10. 独立子仓库约束

### 10.1 路径建议

后续真正实现公共云站点时，建议固定路径：

- `apps/codingns-proxy/`

要求：

- 该目录拥有自己的 `.git`
- 主仓库 `.gitignore` 明确忽略该目录
- 主仓库 CI 不扫描该子仓库代码

### 10.2 支付边界

支付只发生在独立子仓库控制面。

本仓库只关心：

- 当前 Host 是否有可用配额
- 配额剩余多少
- 为什么被限流

本仓库不关心：

- 订单创建细节
- 第三方支付 SDK
- 支付回调签名

## 11. 风险与取舍

### 11.1 最大风险

最大的风险不是“连不上”，而是信任模型写错。

如果后续实现又偷偷把完整 H5 放到用户三级域名下，这个 Spec 就被自己打脸了。

### 11.2 第一阶段取舍

第一阶段先做这些：

- 官方客户端接入
- 官方 H5 从可信域名加载
- 流量包购买
- 单账号、单 Host 绑定

先不做这些：

- 团队共享套餐
- 复杂订阅
- 多入口品牌域名
- 开放第三方自建中继

## 12. 验证策略

### 12.1 本仓库验证

- Host 隧道配置和状态仓储测试
- Host 隧道状态机测试
- 端到端握手失败 / 指纹不匹配测试
- 客户端加密帧传输测试
- 未初始化阻断测试
- 本地直连 / Tailscale / 公共隧道并存测试

### 12.2 独立子仓库验证

- 三级域名分配与释放测试
- 流量计量测试
- 超额断流测试
- 支付到账和流量发放一致性测试

### 12.3 联调验证

- 通过客户端访问无公网地址 Host
- 通过官方 H5 访问无公网地址 Host
- 抓包确认中继只看到密文和字节数
- 超额后拒绝新连接并显示明确状态
