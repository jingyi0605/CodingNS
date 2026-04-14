# 设计文档 - spec001.4 Tailscale接入与实例级远程访问

状态：Draft

## 1. 概述

### 1.1 目标

- 把 Tailscale 接入做成 `CodingNS` 的实例级运行能力
- 让设置页能动态启用、停用、绑定和查看 Tailscale 状态
- 保持 Host 主服务和业务认证体系稳定，不被 Tailscale 逻辑侵入
- 把“对外 tailnet 暴露”收口成单独的管理模块，而不是散落在 CLI 和前端里

### 1.2 覆盖需求

- `requirements.md` 需求 1：实例级 Tailscale 配置模型
- `requirements.md` 需求 2：设置页动态启用和停用
- `requirements.md` 需求 3：绑定当前实例到 Tailscale 账号
- `requirements.md` 需求 4：自定义 control server
- `requirements.md` 需求 5：展示 tailnet 可访问信息
- `requirements.md` 需求 6：保留现有业务认证
- `requirements.md` 需求 7：未初始化实例的暴露限制

### 1.3 技术约束

- 业务 Host 继续沿用 `Node.js + Fastify + ws`
- Tailscale 接入作为独立运行能力管理，不把网络控制逻辑塞进前端
- 实例级配置必须落在 Host 可持久化存储中，不走用户偏好表
- 现有业务认证、会话和 token 协议不变
- 用户可见文案必须进入 i18n 字典

### 1.4 当前实现诊断

当前系统没有正式的“实例级远程访问管理”。

已经确认的现状：

1. `packages/codingns` 只有启动入口，没有运行中网络能力控制面。
2. 设置页能改的是客户端连哪个 Host，不是当前 Host 自己怎么对外暴露。
3. Host 当前没有 `TailscaleManager` 这类长期驻留组件。
4. 实例首次初始化和业务登录已经成型，所以这次不该去动认证体系。

一句人话：
真正缺的不是一个参数，而是一套运行中可管理的实例级接入层。

## 2. 架构

### 2.1 总体结构

这次方案拆四层：

1. **TailscaleConfigStore**
   - 保存实例级配置和最近状态快照
2. **TailscaleManager**
   - 负责启用、停用、登录绑定、状态同步和自动恢复
3. **Tailscale Helper**
   - 负责真正接入 tailnet，并把外部访问代理到本地 Host
4. **Settings UI**
   - 展示状态、收集配置、触发操作

### 2.2 为什么不动态改 Host 监听地址

因为那是错误的抓手。

Host 当前的监听是在启动时一次性完成的，见现有 `start-host` 逻辑。  
如果把“动态启用 Tailscale”理解成“运行中重绑 Host 的监听 IP”，只会引入：

- WS 连接抖动
- 路由层状态中断
- 与现有服务生命周期冲突

所以本 Spec 定死一条规则：

- Host 自己继续稳定监听本地地址
- Tailscale 负责新增一层对外访问入口

对用户来说，这表现为“可访问地址动态出现或消失”；  
对系统来说，Host 主服务的内网监听保持稳定。

### 2.3 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `tailscale-config-repository` | 保存实例级配置和状态快照 | 配置写入、状态更新 | 配置记录、状态记录 |
| `tailscale-manager` | 管理 helper 生命周期和状态机 | 启用/停用/登录/登出请求 | 当前状态、错误、可访问地址 |
| `tailscale-helper-client` | 与 helper 进程通讯 | Host 指令 | helper 状态、登录链接、节点信息 |
| `tailscale-helper-process` | 真正接入 tailnet 并做代理 | control server、状态目录、本地目标地址 | tailnet 节点和代理出口 |
| `tailscale-controller` | 对外提供 Host API | 设置页请求 | JSON 状态和操作结果 |
| `settings/tailscale-panel` | 渲染设置页交互 | Host API 返回值 | 用户操作和状态展示 |

### 2.4 与现有业务认证的关系

这次不做 Tailscale SSO。

访问链路保持这样：

1. 外部设备先通过 tailnet 打到当前实例
2. helper 把请求转到本地 Host
3. Host 继续走现有 `bootstrap/login/token/ws-auth` 体系

也就是说：

- Tailscale 负责通路
- CodingNS 负责认证

分层清楚，不互相污染。

## 3. 数据结构

### 3.1 InstanceTailscaleConfig

```ts
export interface InstanceTailscaleConfig {
  enabled: boolean;
  controlServerUrl: string | null;
  hostname: string | null;
  stateDir: string;
  updatedAt: string;
}
```

说明：

- `enabled` 是管理员在设置页里切出来的目标状态
- `controlServerUrl` 允许为空，空值表示默认官方控制面
- `hostname` 是用户想给当前实例起的可读节点名
- `stateDir` 是 helper 的持久状态目录，避免服务重启后重新登录

### 3.2 InstanceTailscaleStatus

```ts
export type TailscalePhase =
  | "disabled"
  | "blocked_uninitialized"
  | "starting"
  | "needs_login"
  | "running"
  | "stopping"
  | "error";

export interface InstanceTailscaleStatus {
  phase: TailscalePhase;
  connected: boolean;
  loginUrl: string | null;
  controlServerUrl: string | null;
  hostname: string | null;
  tailnetFqdn: string | null;
  tailnetIpv4: string | null;
  tailnetIpv6: string | null;
  reachableBaseUrl: string | null;
  lastError: string | null;
  observedAt: string | null;
}
```

说明：

- `phase` 才是设置页该展示的真相，不要拿几个布尔值硬拼
- `reachableBaseUrl` 是给用户看的最终访问入口
- `loginUrl` 只在需要授权时出现

### 3.3 为什么不用用户偏好表

因为这玩意不是“这个用户喜欢什么”，而是“这台服务怎么接网”。

如果把它塞进用户偏好，会出现三个垃圾后果：

1. 多个业务用户看到不一致状态
2. 管理员切换用户后配置来源不清楚
3. 实例重启恢复逻辑跟用户登录状态绑死

所以必须单独建实例级配置表。

## 4. 核心流程

### 4.1 设置页读取状态流程

1. 设置页打开 Tailscale 面板
2. 调用 `GET /api/system/tailscale/status`
3. Host 读取持久配置和当前运行状态
4. 返回当前 phase、地址、错误、登录链接等信息

### 4.2 启用流程

1. 管理员填写可选的 control server 和 hostname
2. 前端调用 `PUT /api/system/tailscale/config`
3. 前端调用 `POST /api/system/tailscale/enable`
4. Host 先检查 bootstrap 是否已完成
5. 若未完成，直接返回 `blocked_uninitialized`
6. 若已完成，`TailscaleManager` 启动 helper
7. helper 进入连接流程
8. 若需要登录，返回 `needs_login + loginUrl`
9. 登录完成后进入 `running`

### 4.3 停用流程

1. 管理员点击停用
2. 前端调用 `POST /api/system/tailscale/disable`
3. `TailscaleManager` 停止 helper
4. 状态更新为 `disabled`
5. 设置页停止展示可访问地址

### 4.4 登录绑定流程

1. 当前 phase 为 `needs_login`
2. 管理员点击“继续绑定”或“重新获取登录链接”
3. 前端调用 `POST /api/system/tailscale/login`
4. Host 向 helper 请求最新登录链接
5. 前端展示登录链接或辅助说明
6. 用户在外部完成授权
7. helper 状态变更为 `running`
8. Host 同步并推送最新状态

### 4.5 自动恢复流程

1. Host 启动时读取实例级配置
2. 若 `enabled=true`，则尝试自动恢复 `TailscaleManager`
3. 若状态目录仍有效，则直接恢复连接
4. 若恢复失败，则写入 `error` 状态，等待管理员处理

## 5. 接口设计

### 5.1 Host API

新增一组实例级系统接口：

- `GET /api/system/tailscale/status`
- `PUT /api/system/tailscale/config`
- `POST /api/system/tailscale/enable`
- `POST /api/system/tailscale/disable`
- `POST /api/system/tailscale/login`
- `POST /api/system/tailscale/logout`

这些接口都必须是受保护接口，只允许已登录管理员调用。

### 5.2 WebSocket / 轮询状态同步

第一阶段不强求新开一条实时频道。

最小方案：

- 操作完成后主动刷新状态
- 页面进入面板时定时轻量轮询

后续如果状态变化频率和交互复杂度上来了，再补专用实时推送，不要一开始就过度设计。

## 6. UI 方案

### 6.1 设置页面板内容

Tailscale 面板至少要展示：

- 当前开关状态
- 当前阶段文案
- control server 输入框
- hostname 输入框
- 登录绑定按钮 / 登出解绑按钮
- tailnet 可访问地址
- 最近错误信息

### 6.2 用户可见状态

设置页文案必须直接说人话：

- 未启用
- 未初始化，暂时不能启用
- 正在启动
- 需要完成 Tailscale 登录
- 已连接，可通过以下地址访问
- 停用中
- 启动失败 / 连接失败

不要展示一堆内部术语让用户自己猜。

## 7. 安全与边界

### 7.1 未初始化实例阻断

这是第一阶段必须做的硬限制。

原因很简单：
当前 Host 在未初始化时会暴露 setup 入口。  
如果这时直接开放 tailnet 访问，就等于把首个管理员入口暴露出去了。

所以规则是：

- 未初始化时允许保存配置
- 未初始化时不允许真正启用对外暴露

### 7.2 现有访问方式兼容

Tailscale 不是唯一入口。

未启用 Tailscale 时：

- 本地地址访问继续有效
- 原有客户端连法继续有效

启用 Tailscale 时：

- 新增 tailnet 入口
- 不删除原有本地访问方式

## 8. 验证策略

### 8.1 后端验证

- 配置读写测试
- `TailscaleManager` 状态机测试
- 未初始化阻断测试
- helper 异常退出回传测试

### 8.2 前端验证

- 设置页面板交互测试
- 启用/停用状态切换测试
- control server 保存与回显测试
- 错误状态展示测试

### 8.3 联调验证

- 正常启用并拿到 tailnet 地址
- 登录绑定完成后可通过 tailnet 访问登录页
- 业务登录流程保持不变
- 停用后外部地址失效
