# 设计文档 - spec001.9.3 公共隧道流量优化与局域网自动直连

状态：Draft

## 1. 概述

### 1.1 目标

- 让公共隧道在“同网可直连”时不再继续浪费 relay 流量
- 让远程访问高频读链路先复用缓存，再决定传什么
- 保持现有 `spec001.9` 的安全边界和兼容行为，不把用户现有链路打挂

### 1.2 覆盖需求

- `requirements.md` 需求 1：候选连接地址模型
- `requirements.md` 需求 2：验身成功后自动局域网直连
- `requirements.md` 需求 3：远程访问高频读链路少传
- `requirements.md` 需求 4：高频快照减量顺序
- `requirements.md` 需求 5：兼容现有多 HOST、Tailscale 和公共隧道
- `requirements.md` 需求 6：relay 传输层优化分阶段推进

### 1.3 当前实现诊断

当前实现已经有基础，但还不够：

1. 客户端 transport 选择还是“一个 Host 一个 `baseUrl`”
2. relay 握手失败后的 `fallbackTransport` 只是退回当前地址的 direct，不会自动切局域网地址
3. 桌面端本机自动发现只覆盖“客户端自己这台机器上正在跑的 Host”，解决不了“远程 Host 其实就在同一局域网”的问题
4. 一些高频只读链路已经有服务端本地缓存，但客户端和网络层仍然会收到整块快照

一句人话：
现在不是完全没做，而是做了一半。真正该决定“走哪条链路”的核心数据结构还没长出来。

## 2. 总体设计

### 2.1 从单一 baseUrl 升级成候选连接入口集合

当前问题的根源不是“少几个 probe”，而是 Host 模型太扁。

现在多数链路默认只有：

```ts
{
  baseUrl: string
}
```

这不够表达真实世界。

同一台 Host 至少可能同时拥有：

- 当前远程隧道域名
- 局域网 IPv4 地址
- Tailscale 地址
- 桌面端本机发现地址

所以本次要引入统一的候选入口模型：

```ts
type HostEndpointKind = "relay" | "lan" | "tailscale" | "loopback" | "custom";

interface HostCandidateEndpoint {
  endpointId: string;
  kind: HostEndpointKind;
  url: string;
  priority: number;
  expiresAt: string | null;
  source: "host_reported" | "desktop_scan" | "user_saved";
}
```

`HostProfile` 仍然保留一个“当前生效入口”的概念，但底层不再只剩单一 `baseUrl`。

### 2.2 切链路前先验身，不要靠“能 ping 通”自我感动

自动切局域网直连最容易写成垃圾：

- 能连上 HTTP 就切
- 切了再说
- 出错再让用户自己刷新

这条路不能走。

必须先验身。

第一版推荐校验下面这些信息：

- `bindingId`
- `hostKeyFingerprint`
- `hostPublicKey` 的稳定指纹
- 当前已知 `tunnelDomain`

客户端只有在“地址可达 + 身份一致”两个条件都满足时，才允许把该地址标记为可切换。

### 2.3 远程访问的链路优先级

第一版固定优先级，不做可插拔策略引擎：

1. `loopback`
2. `lan`
3. `tailscale`
4. `relay`
5. `custom`

实际生效时再叠加三条规则：

1. 用户显式关闭“自动本地直连”时，不自动升级到更高优先级入口
2. 某个入口连续失败时，短时间内进入冷却，不反复抖动切换
3. 当前活跃入口一旦失效，立即退回下一个已验证入口，优先保证可用性

### 2.4 高频只读链路先做版本短路，再做真正差量

不要一上来就把所有快照链路改成复杂 patch 协议。

先做两步：

1. 客户端保存最近一次快照的 `revision`
2. 后续请求带 `revision`，服务端判定没变化时直接返回 `not_modified`

对于当前最值得先做的链路：

- `workbench`
- `fileTree`
- `git`
- `terminalManager`

其中 `git` 其实已经有服务端局部优化思路，但还停在服务端内部缓存，没真正把“客户端别再收一整包”这件事打通。

## 3. Host 侧设计

### 3.1 Host 候选入口生成

Host 新增一个轻量接口，返回当前实例候选入口清单。

第一版来源：

1. 当前 relay 绑定域名
2. 当前实例配置的本地监听地址
3. 当前机器可用的局域网 IPv4
4. 若已启用 Tailscale，则带上 tailnet 地址

返回示意：

```ts
interface HostConnectionHintsResponse {
  hostFingerprint: string;
  bindingId: string | null;
  endpoints: HostCandidateEndpoint[];
  observedAt: string;
}
```

这个接口必须是认证后读取，不做匿名公开。

原因很简单：

- 局域网地址清单本身就是环境信息
- 只给当前已登录客户端看，边界最清楚

### 3.2 Host 局域网地址收集

Host 侧需要补一个“本机网络接口采样”能力，但范围要收紧：

- 只采集可用的私网 IPv4
- 过滤掉回环、链路本地和明显无效地址
- 不做全网扫描

如果某些平台拿不到网络接口，不报致命错误，直接退回只提供 relay / 已知地址。

### 3.3 版本化快照

高频快照接口和实时订阅都需要补 `revision`。

第一版约定：

- 每类快照都带自己的 `revision`
- 客户端订阅时可带 `knownRevision`
- 服务端检测未变化时返回 `unchanged`

示意：

```ts
interface VersionedSnapshotEnvelope<T> {
  revision: string;
  snapshot: T | null;
  unchanged: boolean;
}
```

对于 WebSocket：

- 首次订阅返回完整快照
- 后续刷新若未变化，只返回 `type + revision + unchanged`
- 后续如需再往前走，可单独扩成 patch

## 4. 客户端设计

### 4.1 Host Runtime 增加链路状态

客户端新增运行时状态：

```ts
type ActiveConnectionKind = "relay" | "lan" | "tailscale" | "loopback" | "custom";

interface HostConnectionRuntimeState {
  activeEndpointId: string | null;
  activeKind: ActiveConnectionKind | null;
  lastSwitchAt: string | null;
  autoDirectEnabled: boolean;
}
```

用户界面只需要表达两件事：

- 当前正在走哪条路
- 是不是已经自动切到了本地更优入口

不要把内部探活细节堆到主界面。

### 4.2 候选入口探活状态机

客户端新增后台探活状态机：

1. 保持当前活跃入口继续服务
2. 后台读取候选入口
3. 并行探活高优先级入口
4. 验身成功后切换
5. 原入口保留为热备

冷却和抖动控制：

- 新入口成功切换后，短时间内不反向回切
- 某入口失败后打冷却时间
- 只有当前活跃入口出错时，才触发紧急回退

### 4.3 transport 选择器收口

现在 transport registry 主要根据当前 `baseUrl` 和 `relayTunnel.enabled` 决定走 relay 还是 direct。

这次要把它改成：

1. 先看当前活跃入口
2. 再解析该入口使用 direct 还是 relay transport
3. relay 只作为候选入口之一，而不是默认唯一远程入口

这样做的好处：

- 不需要在每个 HTTP / WebSocket 客户端里自己写切换逻辑
- transport 层只关心“当前入口是谁”，不关心切换策略细节

### 4.4 本地缓存策略

现有 `view-snapshot-cache` 可以继续用，但要从“页面重开秒回显”升级成“版本校验前置缓存”。

第一版策略：

1. 页面初始化先读本地缓存
2. 同时发起带 `knownRevision` 的轻量刷新
3. 服务端若判定未变化，沿用缓存
4. 若有变化，再替换最新内容

这样收益很直接：

- 页面秒开
- 网络上少传
- 服务端不用每次都重新拼大对象

## 5. 阶段切分

### 5.1 第一阶段：候选入口与自动局域网直连

先交付：

- Host connection hints 接口
- 客户端候选入口模型
- 探活、验身、切换、回退
- 当前链路来源展示

这是最大头收益。

### 5.2 第二阶段：高频快照版本短路

再交付：

- `workbench`
- `fileTree`
- `git`
- `terminalManager`

先把“没变别重传”做扎实。

### 5.3 第三阶段：relay 传输层瘦身

最后单独评估：

- HTTP 包体二次编码
- WebSocket payload 二次编码
- 是否切二进制 envelope
- 是否支持分块或流式

这阶段不跟前两阶段绑死。

## 6. 风险与回退

### 6.1 最大风险

最大风险不是写不出来，而是误切错机器。

所以验身失败必须遵守一条铁律：

- 不切

### 6.2 第二风险

第二风险是频繁抖动。

所以必须有：

- 冷却时间
- 最近成功入口记忆
- 紧急回退优先级

### 6.3 回退策略

只要新入口有不确定性，就继续保留 relay 热备。

一句话：
先保证“永远能连”，再去追求“连得更省”。

## 7. 验证思路

### 7.1 自动局域网直连

- 同一局域网下，客户端通过远程域名登录后，后台能发现局域网地址并切换
- 切换后现有会话、工作台和订阅不断
- 拔掉局域网可达性后，自动回退 relay

### 7.2 版本短路

- 客户端持有旧快照时，刷新请求带 `knownRevision`
- 未变化时返回短响应
- 有变化时只返回必要内容

### 7.3 兼容性

- 新客户端连旧 Host 仍可访问
- 旧客户端连新 Host 仍可访问
- 关闭自动本地直连后仍可强制走 relay

