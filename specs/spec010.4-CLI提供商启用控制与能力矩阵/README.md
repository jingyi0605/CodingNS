# spec010.4-CLI提供商启用控制与能力矩阵

## 当前定位

这个 Spec 负责把“provider 抽象层已经有了，但产品里还没真正收口”的问题一次说清楚。

它解决的不是“设置页再加一个开关”，而是下面这几个已经开始发散的问题：

- provider 是否启用，现在没有统一真源
- 前后端很多入口还在各自写死 provider 列表
- 关闭一个 provider 后，系统并不会自动停止会话发现、会话发起、Fork、助手跟进、Skill 入口这些链路
- 用户已经能看到 capability，但还看不到一张正式、可读的 provider 能力矩阵

一句人话：

这次要把“某个 CLI provider 在项目里到底算不算可用、能做什么、该不该显示”变成一套正式规则，而不是继续靠散落判断拼起来。

## 计划覆盖

- provider 启用态的统一存储与读取方式
- 禁用 provider 后的后端硬门禁
- 禁用 provider 后的前端统一隐藏规则
- 设置页中的 provider 能力矩阵与启用控制面板
- 会话发现、会话发起、Fork、助手跟进、Skill 目标等链路的收口
- 禁用后旧会话如何隐藏、恢复后如何重新出现

## 依赖关系

- 前置依赖：`spec010`、`spec001.1`、`spec001.2`、`spec001.5`、`spec003`
- 强关联依赖：`spec001.7`、`spec010.1`、`spec010.2`、`spec010.3`、`spec013.1`
- 后续依赖：provider 设置页实现、后端门禁实现、Butler/Skill 入口回归

## 本阶段明确不做

- 不在这个 Spec 里引入 provider 在线安装、卸载或市场能力
- 不把 provider 启用态设计成“每个用户各有一份”的账户偏好
- 不为了能力矩阵重写现有 `ProviderCapabilities` 主契约
- 不在禁用时强杀已经在运行中的本地 CLI 进程
- 不在这个 Spec 里扩展 Butler 支持新的 provider 家族

## 当前默认决策

- provider 启用态默认定义为 **Host 全局配置**
- 禁用 provider 的效果是：
  - 新入口不再显示
  - 后端新动作直接拒绝
  - 会话发现与后台刷新不再继续跑
  - 旧会话不删除，只隐藏；重新启用后可再次出现

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
