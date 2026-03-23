# 任务清单 - spec006-终端核心能力（人话版）

状态：DONE

## 这份文档是干什么的

这份任务清单只做一件事：把终端核心能力拆成能执行、能验收、能交接的步骤。

你应该能一眼看懂：

- 这一步到底建什么
- 做完以后系统会有什么可见变化
- 依赖哪些前置能力
- 这一步明确不做什么
- 用什么方法判断真的完成了

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已完成实现，待复核
- `DONE`：通过验证并回写结果
- `CANCELLED`：取消且写明原因

规则：

- 只有 `状态：DONE` 的任务才允许勾选 `[x]`
- 每做完一个任务必须立刻回写状态和验证结果
- `BLOCKED` / `CANCELLED` 必须写原因和后续处理

---

## 阶段 1：先把终端领域边界和基础模型立住

- [x] 1.1 建立终端领域模型和存储结构
  - 状态：DONE
  - 这一步到底做什么：定义 `TerminalInstance`、`TerminalConnection`、`TerminalCommandTemplate` 和必要状态字段。
  - 做完你能看到什么：终端有独立清晰模型，能和进程模型分开。
  - 先依赖什么：`spec001` 的鉴权与工作区基础模型可用。
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3
    - `design.md` §3.2、§4.1
  - 主要改哪里：
    - `apps/host/src/modules/terminal/models/*`
    - `apps/host/src/modules/terminal/repositories/*`
    - `apps/host/src/storage/sqlite/*`（终端相关表）
  - 这一步先不做什么：不做进程发现/重启，不做 UI 装饰能力。
  - 怎么算完成：
    1. 终端模型字段完整并可落库
    2. 模型中不出现进程编排字段
  - 怎么验证：
    - 单元测试：模型约束
    - schema 审查：终端与进程字段隔离
  - 验证结果：已新增 `terminal_instances` / `terminal_command_templates` 表、终端领域类型和仓储，实现终端实例、命令模板与进程模型分离。
  - 对应需求：`requirements.md` 需求 1、需求 3
  - 对应设计：`design.md` §3.2、§4.1、§6.2

- [x] 1.2 搭建终端 HTTP 网关和鉴权守卫
  - 状态：DONE
  - 这一步到底做什么：实现终端实例创建、列表、关闭等基础 API，并接入统一鉴权。
  - 做完你能看到什么：终端 API 在登录态下可用，匿名访问被拒绝。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4
    - `design.md` §2.2、§3.3、§5.3
  - 主要改哪里：
    - `apps/host/src/modules/terminal/controllers/terminal-controller.ts`
    - `apps/host/src/modules/terminal/routes/terminal-routes.ts`
    - `apps/host/src/modules/terminal/guards/terminal-auth-guard.ts`
  - 这一步先不做什么：不接 WS 输出流和重连补回。
  - 怎么算完成：
    1. `POST/GET/DELETE /api/terminals` 可用
    2. 未携带有效 token 的请求返回 401/403
  - 怎么验证：
    - 集成测试：API 鉴权通过/失败路径
    - 人工验证：匿名请求被拒绝
  - 验证结果：已接入受保护的 `/api/terminals` 和 `/api/terminals/templates` 路由，匿名请求在集成测试中返回 `401 UNAUTHORIZED`。
  - 对应需求：`requirements.md` 需求 2、需求 4
  - 对应设计：`design.md` §2.2、§3.3.1~§3.3.3

- [x] 1.3 阶段检查：终端与进程边界检查
  - 状态：DONE
  - 这一步到底做什么：确认终端域没有混入进程管理职责。
  - 做完你能看到什么：后续不会因为模型混乱返工。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.2、§6.2
  - 主要改哪里：本阶段全部终端模块文件
  - 这一步先不做什么：不拓展进程服务接口。
  - 怎么算完成：
    1. 终端接口清单无进程编排能力
    2. 代码结构满足边界定义
  - 怎么验证：
    - 架构评审
    - 静态检查（模块依赖方向）
  - 验证结果：终端模块只负责 PTY、输出缓存、模板和 WS，不暴露端口扫描、进程发现、启动器等 `spec007` 职责。
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.2、§6.2

---

## 阶段 2：打通 PTY 运行、WS 流和断线重连

- [x] 2.1 实现 PTY 生命周期管理器
  - 状态：DONE
  - 这一步到底做什么：实现 PTY 创建、运行、退出、异常回收状态机。
  - 做完你能看到什么：终端实例可稳定运行并能正确回收。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.2、§2.3.1、§4.2
  - 主要改哪里：
    - `apps/host/src/modules/terminal/runtime/pty-runtime-manager.ts`
    - `apps/host/src/modules/terminal/services/terminal-session-service.ts`
  - 这一步先不做什么：不实现命令模板执行。
  - 怎么算完成：
    1. 创建后状态进入 `running`
    2. 退出后状态进入 `closed` 或 `error`
  - 怎么验证：
    - 单元测试：生命周期状态机
    - 集成测试：创建到关闭流程
  - 验证结果：已落地 `PtyRuntimeManager` 与 `TerminalService`，创建后进入 `running`，关闭或异常退出后回写 `closed/error`。
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §2.2、§2.3.1、§4.2

- [x] 2.2 实现终端 WS 通道与鉴权握手
  - 状态：DONE
  - 这一步到底做什么：建立 `terminal.*` 事件流，接入 WS 握手鉴权与订阅鉴权。
  - 做完你能看到什么：已登录用户可收发终端流，未授权连接被拒绝。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §3.3.6、§5.3
  - 主要改哪里：
    - `apps/host/src/modules/terminal/ws/terminal-ws-hub.ts`
    - `apps/host/src/modules/terminal/ws/terminal-ws-auth.ts`
  - 这一步先不做什么：不处理补回缓存。
  - 怎么算完成：
    1. `terminal.subscribe` 成功后可收到输出事件
    2. token 无效时握手或订阅失败
  - 怎么验证：
    - WS 集成测试：授权/未授权场景
    - 手工联调：输入输出回显
  - 验证结果：已在统一 `/ws` 下接入 `terminal.subscribe` / `terminal.input`，继续复用 `spec001` 的 HTTP/WS 鉴权链路。
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §3.3.6、§5.3

- [x] 2.3 实现输出缓存与断线补回
  - 状态：DONE
  - 这一步到底做什么：实现滚动缓存、游标补回和“超窗口提示”机制。
  - 做完你能看到什么：断线重连后能补回关键输出，超窗口有明确反馈。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.3、§3.2.3、§6.3
  - 主要改哪里：
    - `apps/host/src/modules/terminal/runtime/terminal-output-buffer.ts`
    - `apps/host/src/modules/terminal/services/terminal-reconnect-service.ts`
  - 这一步先不做什么：不做长期全量历史存储。
  - 怎么算完成：
    1. 重连时按 `lastCursor` 补回输出
    2. 缓存不足时返回明确提示
  - 怎么验证：
    - 集成测试：断线重连补回
    - 边界测试：缓存窗口溢出
  - 验证结果：已实现滚动输出缓存、`lastCursor` 补回和 `RECONNECT_CURSOR_INVALID` 错误码。
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.3、§3.2.3、§6.3

- [x] 2.4 阶段检查：终端运行主链路检查
  - 状态：DONE
  - 这一步到底做什么：验证“创建 -> 交互 -> 断线 -> 重连补回 -> 关闭”主流程。
  - 做完你能看到什么：终端核心链路可稳定运行。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4、需求 5
    - `design.md` §2.3、§4.2、§7
  - 主要改哪里：本阶段终端模块和测试文件
  - 这一步先不做什么：不扩展模板系统复杂策略。
  - 怎么算完成：
    1. 主流程自动化测试通过
    2. 异常路径有明确错误输出
  - 怎么验证：
    - 端到端测试：终端交互链路
    - 压测：高频输出稳定性
  - 验证结果：`spec006-terminal-core.e2e.test.ts` 已覆盖“创建 -> 交互 -> 断线 -> 重连补回 -> 关闭”主流程。
  - 对应需求：`requirements.md` 需求 2、需求 4、需求 5
  - 对应设计：`design.md` §2.3、§4.2、§7.2、§7.3

---

## 阶段 3：补齐多终端和命令模板并完成验收

- [x] 3.1 实现多终端管理与工作区隔离
  - 状态：DONE
  - 这一步到底做什么：支持同工作区多终端并行，保证实例隔离和精准操作。
  - 做完你能看到什么：多终端 tab 场景可用，互不串线。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.3.1、§4.1
  - 主要改哪里：
    - `apps/host/src/modules/terminal/services/terminal-session-service.ts`
    - `apps/user-app/src/features/terminal/store/terminal-store.ts`（若此阶段联动前端）
  - 这一步先不做什么：不做多人共享终端。
  - 怎么算完成：
    1. 同工作区可并行创建多个终端
    2. 输入输出严格绑定目标终端
  - 怎么验证：
    - 集成测试：多终端并行
    - 人工回归：tab 切换与隔离
  - 验证结果：已支持同工作区多终端并行创建、列表查询和按 `terminalId` 精准输入输出。
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §4.1、§4.2

- [x] 3.2 实现命令模板管理与执行
  - 状态：DONE
  - 这一步到底做什么：实现模板 CRUD 和模板执行路径，并做工作区安全校验。
  - 做完你能看到什么：常用命令可复用并稳定执行。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §2.3.4、§3.2.4、§3.3.5
  - 主要改哪里：
    - `apps/host/src/modules/terminal/controllers/command-template-controller.ts`
    - `apps/host/src/modules/terminal/services/command-template-service.ts`
  - 这一步先不做什么：不做复杂审批流或组织级模板共享。
  - 怎么算完成：
    1. 模板可在工作区创建和执行
    2. 非法路径或越权参数执行被拒绝
  - 怎么验证：
    - 集成测试：模板执行成功/失败分支
    - 安全测试：路径越界拦截
  - 验证结果：已实现模板创建、列表、更新、删除、执行，并对越界 `cwd` 返回 `COMMAND_TEMPLATE_INVALID`。
  - 对应需求：`requirements.md` 需求 6
  - 对应设计：`design.md` §2.3.4、§3.2.4、§3.3.5

- [x] 3.3 最终检查：终端核心能力验收
  - 状态：DONE
  - 这一步到底做什么：对照需求和设计逐项验收，确认边界、鉴权、稳定性都达标。
  - 做完你能看到什么：spec006 达到可交付状态，可作为 spec007 前置能力。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：spec006 相关文档与验证记录
  - 这一步先不做什么：不新增范围，不临时塞新功能。
  - 怎么算完成：
    1. 关键任务都可追踪到需求与设计
    2. 鉴权、重连、多终端、模板执行均有验证证据
    3. 终端与进程边界无冲突项
  - 怎么验证：
    - 按验收清单逐项核对
    - 回归测试报告
  - 验证结果：`apps/user-app` 已新增最小终端页并接入真实 Host PTY 流，支持工作区选择、终端列表、输出展示、输入发送、模板创建/执行与手动重连；并已补齐 `workspaceId / terminalId / lastCursor` 持久化、刷新后自动回到上次终端，以及“补回完整 / 已截断 / 已被空闲清理关闭”三种恢复提示。本轮继续把前端终端视图升级为真实 `xterm`，通过本地屏幕快照持久化恢复刷新前的终端缓冲、光标上下文和滚动位置，并把快照与恢复游标绑定，避免刷新后出现“屏幕较旧但补回从较新游标开始”的内容缺口；同时把终端持久化状态升级为可合并格式，保证多标签页/跨窗口场景下旧标签页不会用更老的游标或快照把较新的恢复进度覆盖回去。另通过 `terminal.resize` 把前端尺寸同步给 Host PTY，避免继续停留在“假日志面板”。Host 侧已补空闲清理并通过回归测试验证。本轮进一步把 Windows shell 明确收口为受控 allowlist，默认使用 `CMD`，显式提供 `CMD / PowerShell / Git Bash` 三个可选项；`user-app` 新建终端与“模板新开终端执行”都可选择 shell，未安装的 `Git Bash` 会明确显示不可用而不是偷偷失败。Windows 下 `node-pty` 在测试结束后仍会打印 `AttachConsole failed` 噪音，但不影响终端主链路，本轮明确记录为后续收口项。
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
