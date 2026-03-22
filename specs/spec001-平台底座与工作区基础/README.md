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
- 单用户、单 Host 的基础认证模型

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
