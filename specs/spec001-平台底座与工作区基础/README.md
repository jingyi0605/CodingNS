# spec001-平台底座与工作区基础

## 当前定位

这是整个系统的地基 Spec。
先把 `CodingNS Host`、`Workspace`、基础认证、共享协议、存储边界这些不会轻易改的东西定住。

## 计划覆盖

- Host 运行形态与启动结构
- `Workspace` 核心模型
- 基础 HTTP / WebSocket 协议框架
- `shared-contracts`、`shared-events`、`shared-capabilities`
- SQLite 的表范围与写入边界
- 首次启动初始化流程
- 默认用户名和密码创建
- 单用户、单 Host 的基础认证模型
- 公开接口与受保护接口边界
- 账户级偏好和客户端配置分层的底层边界由 `spec001.1-账户偏好入库与跨客户端同步` 继续展开
- 请求链路与后台任务的拆分、主线程压力治理由 `spec001.2-后端任务调度与主线程压力治理` 继续展开
- 多 HOST Profile、激活 HOST 切换和 HOST 级登录态隔离由 `spec001.3-多HOST接入与跨端切换` 继续展开
- 实例级 Tailscale 接入、设置页动态远程访问管理和 tailnet 暴露边界由 `spec001.4-Tailscale接入与实例级远程访问` 继续展开
- 多 CLI 的 Skill 读取、同步和统一管理边界由 `spec001.5-多CLI-Skill统一管理与同步` 继续展开
- 客户端和服务端的统一更新链路由 `spec001.6-客户端与服务端统一更新机制` 继续展开
- 设置页里基于 `cc-switch` 的模型预设快速切换由 `spec001.7-设置页模型快速切换与CC-SWITCH接入` 继续展开

## 依赖关系

- 前置依赖：整体技术规划
- 后续依赖：`spec002` 到 `spec009`

## 本阶段明确不做

- 具体 CLI provider 适配实现
- 复杂 UI 交互细节
- 高级 Git、终端、进程功能

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
- `spec001.1-账户偏好入库与跨客户端同步/`
- `spec001.2-后端任务调度与主线程压力治理/`
- `spec001.3-多HOST接入与跨端切换/`
- `spec001.4-Tailscale接入与实例级远程访问/`
- `spec001.5-多CLI-Skill统一管理与同步/`
- `spec001.6-客户端与服务端统一更新机制/`
- `spec001.7-设置页模型快速切换与CC-SWITCH接入/`
