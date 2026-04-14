# 需求文档 - spec001.4 Tailscale接入与实例级远程访问

状态：Draft

## 简介

当前 `CodingNS` 的远程访问方式是靠用户自己处理网络层。

这有三个直接问题：

1. 功能入口错了，用户得去管启动命令和端口，不像一个正常产品
2. 运行时没状态，设置页里看不到“现在到底有没有接上、能不能访问”
3. 控制面缺失，想切 control server、重绑账号、停用暴露，都没有正式入口

这次要解决的事很明确：

1. 把 Tailscale 变成实例级能力，而不是启动参数
2. 在设置页里动态启用、停用和查看 Tailscale 状态
3. 支持绑定当前服务实例到默认 Tailscale 网络或自定义 control server
4. 启用后，让外部设备可以通过 tailnet 直接访问 `CodingNS`
5. 保持现有业务登录、token、权限体系不变

## 术语表

- **实例级配置**：属于当前这台 `CodingNS Host` 实例的配置，不跟某个业务用户绑定
- **Tailscale 开关**：设置页里的启用/停用状态，控制当前实例是否对 tailnet 暴露访问入口
- **control server**：Tailscale 控制服务器地址，默认是官方控制面，也允许填写自定义地址
- **helper**：负责接入 tailnet 并把外部访问代理到本地 Host 的辅助进程
- **tailnet 地址**：启用 Tailscale 后，外部设备可访问当前实例的地址，例如 FQDN、IPv4、IPv6
- **业务认证**：CodingNS 自己的用户名密码、Access Token、Refresh Token 体系

## 范围说明

### In Scope

- 定义实例级 Tailscale 配置模型
- 定义设置页里的 Tailscale 面板和交互
- 定义启用、停用、登录绑定、登出解绑、状态刷新接口
- 定义 Host 内 `TailscaleManager` 的职责和状态机
- 定义 helper 生命周期和状态回传
- 定义启用 Tailscale 后的对外访问地址展示和更新规则
- 定义未初始化实例下的暴露限制

### Out of Scope

- 用 Tailscale 登录替代 CodingNS 登录
- 把 Tailscale 用户身份灌进业务数据库
- 同时接多套不同 tailnet 出口并做切换
- 完整泛化成支持 Zerotier、FRP、Cloudflare Tunnel 的统一平台
- 在浏览器端无代理直连系统级 Tailscale 能力

## 需求

### 需求 1：系统必须有正式的实例级 Tailscale 配置模型

**用户故事：** 作为服务管理员，我希望 Tailscale 配置是这台服务自己的能力，而不是某个登录用户的私人偏好。

#### 验收标准

1. WHEN 系统保存 Tailscale 配置 THEN System SHALL 将其保存为实例级配置，而不是账户偏好
2. WHEN 不同业务用户登录同一台 Host THEN System SHALL 看到同一份 Tailscale 当前状态
3. WHEN 服务重启 THEN System SHALL 恢复上次保存的 Tailscale 配置和最近状态

### 需求 2：设置页必须支持动态启用和停用 Tailscale

**用户故事：** 作为服务管理员，我希望在设置页里直接启用或停用 Tailscale，而不是退出系统去改启动命令。

#### 验收标准

1. WHEN 管理员打开设置页 THEN System SHALL 提供独立的 Tailscale 配置面板
2. WHEN 管理员启用 Tailscale THEN System SHALL 在运行中的服务里启动接入流程，而不是要求整套服务重启
3. WHEN 管理员停用 Tailscale THEN System SHALL 关闭外部 tailnet 暴露，并把状态更新回设置页
4. WHEN 启用或停用失败 THEN System SHALL 明确显示失败原因，不得只转圈或静默失败

### 需求 3：系统必须支持绑定当前实例到 Tailscale 账号

**用户故事：** 作为服务管理员，我希望在设置页里完成当前实例的 Tailscale 绑定，而不是自己去终端手工登录。

#### 验收标准

1. WHEN 当前实例尚未完成 Tailscale 登录 THEN System SHALL 提供明确的登录绑定入口
2. WHEN 绑定流程开始 THEN System SHALL 返回可执行的授权信息，例如授权链接或配套说明
3. WHEN 用户完成授权 THEN System SHALL 将当前实例状态更新为已连接
4. WHEN 用户主动解绑或登出 THEN System SHALL 清理当前实例的绑定状态，并更新设置页展示

### 需求 4：系统必须支持自定义 control server

**用户故事：** 作为部署在自建网络环境中的管理员，我希望把当前实例接到指定的 control server，而不是被写死到默认官方服务。

#### 验收标准

1. WHEN 管理员在设置页填写 control server THEN System SHALL 校验其格式并保存为实例级配置
2. WHEN 当前实例使用自定义 control server 启动接入 THEN System SHALL 按该地址执行绑定和连接
3. WHEN control server 地址无效或无法连接 THEN System SHALL 阻止启用成功，并反馈明确错误

### 需求 5：启用后必须提供稳定可见的 tailnet 访问信息

**用户故事：** 作为服务管理员，我希望一眼看到“现在外部到底该访问哪个地址”，而不是自己去猜。

#### 验收标准

1. WHEN Tailscale 已连接 THEN System SHALL 在设置页展示当前实例的 tailnet 可访问地址
2. WHEN 节点地址、FQDN 或可达性发生变化 THEN System SHALL 将最新结果同步到设置页
3. WHEN 当前尚未连接成功 THEN System SHALL 明确展示当前阶段，例如未启用、待授权、连接中、已连接、失败

### 需求 6：启用 Tailscale 后必须保持现有业务认证体系不变

**用户故事：** 作为现有用户，我希望只是网络更容易打通，而不是整个登录体系被换掉。

#### 验收标准

1. WHEN 外部设备通过 tailnet 访问系统 THEN System SHALL 继续使用现有 CodingNS 登录流程
2. WHEN Tailscale 启用或停用 THEN System SHALL 不重写现有用户名密码、Access Token、Refresh Token 协议
3. WHEN 系统启用 Tailscale THEN System SHALL 只改变外部访问入口，不改变业务认证语义

### 需求 7：未初始化实例必须避免直接暴露初始化口子

**用户故事：** 作为服务管理员，我不希望一台还没初始化的实例一启用 Tailscale 就把首个管理员入口暴露给外部。

#### 验收标准

1. WHEN 当前实例尚未完成 bootstrap THEN System SHALL 阻止正式启用 tailnet 对外暴露，或给出显式阻断状态
2. WHEN 管理员尝试在未初始化状态启用 Tailscale THEN System SHALL 明确提示必须先完成初始化
3. WHEN 实例完成初始化后再次启用 Tailscale THEN System SHALL 正常继续后续接入流程

## 非功能需求

### 非功能需求 1：一致性

1. WHEN 设置页显示 Tailscale 状态 THEN System SHALL 保证它与实际 helper 运行状态一致，而不是展示一份旧缓存
2. WHEN helper 状态变化 THEN System SHALL 能在前端合理时间内看到更新

### 非功能需求 2：可恢复

1. WHEN helper 进程异常退出 THEN System SHALL 能把失败状态回传给设置页
2. WHEN Host 重启且配置仍为启用 THEN System SHALL 能尝试恢复 Tailscale 接入，而不是丢失开关状态

### 非功能需求 3：兼容性

1. WHEN 未启用 Tailscale THEN System SHALL 保持当前本地 / 局域网访问流程不变
2. WHEN 客户端不支持修改服务地址的场景仍在使用 THEN System SHALL 不因为本 Spec 破坏现有连接方式

## 成功定义

- 管理员可以在设置页里直接启用或停用 Tailscale
- 管理员可以在设置页里完成当前实例的绑定和解绑
- 系统支持填写并使用自定义 control server
- 启用后，设置页能明确显示 tailnet 可访问地址和当前状态
- 业务登录体系保持原样，不因为接入 Tailscale 被推翻
- 未初始化实例不会被糊里糊涂地暴露到 tailnet
