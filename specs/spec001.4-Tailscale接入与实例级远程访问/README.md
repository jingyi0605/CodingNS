# spec001.4-Tailscale接入与实例级远程访问

## 当前定位

这是 `spec001` 下的新子 Spec。

它只解决一件事：
把 `CodingNS` 的远程访问从“手工配端口、手工敲命令”升级成“在系统设置页里管理 Tailscale 接入”。

这次要定住的不是一句 `--tailscale` 启动参数，而是下面这些真问题：

- Tailscale 配置到底属于谁
- 设置页怎么启用、停用和查看状态
- 服务节点怎么绑定 Tailscale 账号或自定义 control server
- 运行中的实例怎么动态暴露 tailnet 访问地址
- 现有 Host 和业务认证怎么保持不乱

一句人话：
这次做的是“实例级远程访问能力管理”，不是“给 CLI 多塞一个开关”。

## 计划覆盖

- 实例级 Tailscale 配置模型和持久化边界
- 设置页里的 Tailscale 开关、control server、登录绑定和状态展示
- Host 内部的 `TailscaleManager` 生命周期
- helper / sidecar 的启动、停用、状态同步和错误回传
- tailnet 可访问地址、节点信息和连接状态的统一对外接口
- 启用 Tailscale 后的访问链路和现有业务认证共存规则
- 未初始化实例的暴露限制和安全边界

## 依赖关系

- 前置依赖：`spec001-平台底座与工作区基础`
- 强相关依赖：
  - `spec001.1-账户偏好入库与跨客户端同步`
  - `spec001.2-后端任务调度与主线程压力治理`
  - `spec008-桌面端与H5交付增强`
  - `spec011-单包安装与统一服务发布`

## 本阶段明确不做

- 用 Tailscale 账号替代 CodingNS 自己的登录体系
- 把 Tailscale 用户映射成 CodingNS 用户或角色
- 在一个实例里同时管理多个 tailnet 出口
- 把所有系统级网络能力都抽象成“通用远程接入平台”
- 要求用户理解 CLI 子命令、手工执行 `tailscale serve` 或手工配反向代理

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
