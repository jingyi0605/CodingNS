# 任务清单 - spec007-进程管理与启动器（人话版）

状态：Draft

## 这份文档是干什么的

这份清单只做一件事：让接手的人不用猜，直接知道该先做什么、后做什么、做到什么程度算完成。

重点是三条主线：

- 启动配置模型化（`LauncherProfile`）
- 进程生命周期可控（启动/停止/重启/状态）
- 日志与端口可追踪（并且全链路鉴权）

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成并通过验证
- `CANCELLED`：取消并写明原因

规则：

- 只有 `状态：DONE` 才能勾选 `[x]`
- 每完成一个任务，必须立刻回写状态和验证结果
- `BLOCKED` 必须写清楚卡点和下一步处理方案

---

## 阶段 1：先把数据结构和服务边界立住

- [ ] 1.1 建立 `LauncherProfile` 与 `ProcessInstance` 数据模型
  - 状态：TODO
  - 这一步到底做什么：定义并落地启动配置、进程实例、端口绑定的持久化结构。
  - 做完你能看到什么：系统能完整保存“怎么启动”和“启动后发生了什么”。
  - 先依赖什么：`spec001` 的基础存储和鉴权框架可用。
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3
    - `design.md` §3.2、§4.1
  - 主要改哪里：
    - `packages/workspace-core/process-service/models/launcher-profile.ts`
    - `packages/workspace-core/process-service/models/process-instance.ts`
    - `packages/workspace-core/process-service/repositories/process-repository.ts`
  - 这一步先不做什么：不实现分布式调度，不做容器编排。
  - 怎么算完成：
    1. 三类模型字段与文档一致
    2. 实例状态流转字段可追踪
  - 怎么验证：
    - 模型与仓储单元测试
    - 字段清单对照检查
  - 对应需求：`requirements.md` 需求 1、需求 3
  - 对应设计：`design.md` §3.2、§4.1、§4.2

- [ ] 1.2 划清进程服务和终端服务边界
  - 状态：TODO
  - 这一步到底做什么：把进程控制主链路放到 `process-service`，终端只保留关联引用。
  - 做完你能看到什么：终端断开不影响进程状态，进程控制不依赖终端在线。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.1、§2.2、§6.1
  - 主要改哪里：
    - `packages/workspace-core/process-service/process-service.ts`
    - `packages/workspace-core/terminal-service/terminal-link.ts`
    - `packages/workspace-core/process-service/process-policy.ts`
  - 这一步先不做什么：不重构终端 UI，不改会话同步逻辑。
  - 怎么算完成：
    1. 进程主状态由进程事件驱动
    2. 终端仅作弱关联，不再承载进程真相
  - 怎么验证：
    - 终端断开一致性测试
    - 进程控制接口回归测试
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §2.2、§4.1、§6.1

- [ ] 1.3 阶段检查：边界是否站稳
  - 状态：TODO
  - 这一步到底做什么：检查“进程独立服务”和“模型化配置”有没有落空。
  - 做完你能看到什么：可以进入生命周期能力开发，不会边做边返工。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关代码与文档
  - 这一步先不做什么：不提前堆日志高级特性。
  - 怎么算完成：
    1. 边界评审通过
    2. 关键模型与服务职责无冲突
  - 怎么验证：
    - 评审清单
    - 单元测试通过
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §2、§3.2、§6.1

---

## 阶段 2：打通启动、停止、重启和状态反馈

- [ ] 2.1 实现启动配置管理接口
  - 状态：TODO
  - 这一步到底做什么：完成 `LauncherProfile` 的新增、查询、修改、删除以及模板创建入口。
  - 做完你能看到什么：用户可以在工作区保存和复用启动配置。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 5
    - `design.md` §3.3.1、§3.3.2
  - 主要改哪里：
    - `apps/host/src/routes/launchers.ts`
    - `packages/workspace-core/process-service/launcher-profile-service.ts`
    - `packages/workspace-core/process-service/templates/common-templates.ts`
  - 这一步先不做什么：不做团队级共享模板中心。
  - 怎么算完成：
    1. 启动配置 CRUD 可用
    2. 常见模板可一键生成配置
  - 怎么验证：
    - 配置接口集成测试
    - 模板生成用例测试
  - 对应需求：`requirements.md` 需求 1、需求 5
  - 对应设计：`design.md` §3.2.1、§3.3.1、§3.3.2

- [ ] 2.2 实现进程启动与停止
  - 状态：TODO
  - 这一步到底做什么：接通 `run`、`stop` 控制链路，保证状态转换正确。
  - 做完你能看到什么：用户能在界面里启动和停止进程，不依赖终端命令。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.3.1、§2.3.2、§4.2
  - 主要改哪里：
    - `packages/workspace-core/process-service/process-runner.ts`
    - `packages/workspace-core/process-service/process-service.ts`
    - `apps/host/src/routes/processes.ts`
  - 这一步先不做什么：不做自动伸缩策略。
  - 怎么算完成：
    1. 启动后状态进入 `RUNNING`
    2. 停止后状态进入 `STOPPED`
    3. 异常退出进入 `FAILED`
  - 怎么验证：
    - 生命周期集成测试
    - 异常命令失败用例
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §2.3.1、§2.3.2、§4.2

- [ ] 2.3 实现重启与端口识别
  - 状态：TODO
  - 这一步到底做什么：补齐重启能力和端口扫描能力，保证服务可恢复、可观察。
  - 做完你能看到什么：用户重启后能看到新实例和端口状态变化。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` §2.3.2、§2.3.3、§3.2.3
  - 主要改哪里：
    - `packages/workspace-core/process-service/port-scanner-service.ts`
    - `packages/workspace-core/process-service/process-restart.ts`
    - `apps/host/src/routes/processes.ts`
  - 这一步先不做什么：不做跨机器端口探测。
  - 怎么算完成：
    1. 重启可生成新实例并记录来源
    2. 端口状态可查询并更新
  - 怎么验证：
    - 重启流程集成测试
    - 端口占用冲突测试
  - 对应需求：`requirements.md` 需求 3、需求 4
  - 对应设计：`design.md` §2.3.2、§2.3.3、§3.3.8

- [ ] 2.4 阶段检查：生命周期主链路检查
  - 状态：TODO
  - 这一步到底做什么：串起来验证“配置 -> 启动 -> 停止 -> 重启 -> 状态反馈”。
  - 做完你能看到什么：主链路可用，可进入日志与鉴权收口阶段。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3、需求 5
    - `design.md` §2.3、§4.2
  - 主要改哪里：本阶段相关模块与测试文件
  - 这一步先不做什么：不扩展移动端通知策略。
  - 怎么算完成：
    1. 主链路回放通过
    2. 错误场景都有明确响应
  - 怎么验证：
    - E2E 回放测试
    - 人工操作复核
  - 对应需求：`requirements.md` 需求 1、需求 3、需求 5
  - 对应设计：`design.md` §2.3、§5.3、§7.3

---

## 阶段 3：日志、鉴权和最终验收收口

- [ ] 3.1 完成日志采集与增量读取
  - 状态：TODO
  - 这一步到底做什么：接入日志缓存文件与游标读取接口，保证长日志可增量查看。
  - 做完你能看到什么：用户可以持续查看日志，不会一次性拉爆内存。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3.3、§3.3.7、§4.1
  - 主要改哪里：
    - `packages/workspace-core/process-service/log-capture-service.ts`
    - `apps/host/src/routes/process-logs.ts`
    - `packages/workspace-core/process-service/log-reader.ts`
  - 这一步先不做什么：不做日志全文检索平台。
  - 怎么算完成：
    1. 日志可按游标增量读取
    2. 异常退出可保留关键日志片段
  - 怎么验证：
    - 日志滚动测试
    - 大日志压力测试
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §3.3.7、§6.3

- [ ] 3.2 完成进程接口与事件鉴权收口
  - 状态：TODO
  - 这一步到底做什么：确保进程 API 和 `process.*` 事件都受 token 保护。
  - 做完你能看到什么：未登录请求无法读取或控制进程。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §3.3.9、§6.2
  - 主要改哪里：
    - `apps/host/src/middlewares/process-auth-guard.ts`
    - `apps/host/src/ws/process-event-gateway.ts`
    - `apps/host/src/routes/processes.ts`
  - 这一步先不做什么：不引入多角色 RBAC。
  - 怎么算完成：
    1. HTTP 未授权访问返回 401
    2. WebSocket 未授权订阅被拒绝
  - 怎么验证：
    - 鉴权集成测试
    - WS 握手拒绝测试
  - 对应需求：`requirements.md` 需求 6
  - 对应设计：`design.md` §3.3.9、§6.2

- [ ] 3.3 最终检查点
  - 状态：TODO
  - 这一步到底做什么：核对需求、设计、实现、测试证据是否闭合。
  - 做完你能看到什么：`spec007` 可进入实现迭代，不留结构性大坑。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件与验收记录
  - 这一步先不做什么：不再新增需求范围。
  - 怎么算完成：
    1. 所有关键任务都可追踪到需求和设计
    2. 风险、延期项、待确认项记录完整
    3. 接手人能按文档直接开始实现
  - 怎么验证：
    - 验收清单逐项核对
    - 主链路回放复核
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
