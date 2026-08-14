# spec002.2-ClaudeCode Hook状态补齐与Plan兼容

## 当前定位

这个 Spec 只解决一个真问题：

- CodingNS 现在已经接住了 Claude Code 的一部分 Hook
- 但接得还不完整，尤其缺了 Plan 相关的 `ExitPlanMode`
- 另外还有一批官方已经存在的 Hook 状态，只是被吞掉、没展示、没落成统一状态

结果就是：

- Claude Code 在 CodingNS 里不是“真兼容”
- 用户能看到权限审批和问题回答，但看不到完整的计划审批、工具完成/失败、子任务结束、上下文压缩这些关键状态
- 前端任务卡片目前偏向 Codex 的 `update_plan`，Claude 的 Plan 模式没有走通

这不是“以后再优化一下体验”的问题，这是兼容层没补齐。

## 这次要解决什么

这次不重写整套会话系统，也不趁机扩成一个新的 provider 状态平台。

这次只做下面几件事：

1. 把 Claude Code 官方已支持、而 CodingNS 还没接好的 Hook 状态列清楚
2. 先补最关键的阻塞交互：`ExitPlanMode`
3. 把 Claude 的 Plan 审批、计划展示、后续执行权限提示接进现有会话链路
4. 把工具完成/失败、权限拒绝、子任务结束、压缩前后这些用户明显能感知的状态接进来
5. 保持现有权限申请、问题回答、会话运行态和 Hook bridge 兼容，不把老链路搞坏

## 计划覆盖

- Claude Code Hook settings 生成策略
- Hook bridge 支持事件清单
- Host 端 Hook 路由、阻塞交互处理、运行态映射
- 前端对 Claude Plan / Hook 状态的展示
- `ExitPlanMode` 的审批数据结构、回写协议和最小验证

## 依赖关系

- 前置依赖：`spec002`、`spec003.1`、`spec010`、`spec010.1`
- 后续依赖：Claude Code 兼容层实现、前端会话展示补齐、集成验证

## 本阶段明确不做

- 不重做会话页面整体 UI
- 不重写 Claude Code runtime 启动链路
- 不把所有 provider 的 plan 系统统一成同一个抽象
- 不在这个 Spec 里扩展成 Butler 计划系统
- 不为了看起来统一，把 Claude 的 Plan 审批硬塞成普通 Bash 权限

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
