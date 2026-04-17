# 任务清单 - spec013.3-助手自动化调度与临时沙箱工作区（人话版）

状态：Draft

## 2026-04-17 立项补记

- 已确认 `spec013.3` 只解决两件事：
  - 助手自动化从一次性 timer 升级成正式调度模型
  - 助手临时会话补独立沙箱工作区
- 已确认当前主要缺口不是“再加几个参数”，而是数据结构没立住：
  - `timer` 只有一次性投递语义
  - 真实会话启动仍然只认项目目标
- 已确认本子 Spec 的后台执行必须遵守 `spec001.2` 的 `TaskManager` 规范，不能再长私有队列和新一套散装定时器
- 已完成本子 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化

## 2026-04-17 继续细化补记

- 已补 [docs/20260417-旧计时器到自动化模型兼容映射说明.md](./docs/20260417-旧计时器到自动化模型兼容映射说明.md)，把旧 `timers.*` 到新自动化模型的字段、状态、CLI、前端兼容方式写清楚。
- 已补 [docs/20260417-最小回归验证清单.md](./docs/20260417-最小回归验证清单.md)，把一次性自动化、周期自动化、条件自动化、沙箱创建、沙箱会话、失败隔离这些最小验证面收清楚。
- 已确认本子 Spec 的下一步实现不该直接上代码，而是先把任务 3 的 `TaskManager` 接入切片细化，再开始后端落地。

## 2026-04-17 一次性自动化落地补记

- 已完成第一刀后端落地，但范围只收在正式自动化的 `once`：
  - Host 已新增 `assistant_automation_tasks` / `assistant_automation_runs` 表、仓储和 `AssistantAutomationService`
  - 旧 `ButlerControlTimerService` 已改成兼容 facade，继续对外保留 `timers.*`
  - `assistant-capability` 已新增正式 `/automations` API
  - `codingns assistant automations *` CLI 最小入口已补
- 这一步明确没做：
  - 没做 `interval / cron / condition`
  - 没做临时沙箱工作区
  - 还没把自动化真正接进 `TaskManager`
- 已补最小测试覆盖：
  - `assistant-automation-service.test.ts`
  - `assistant-capability-routes.test.ts`
  - `assistant-capability-service.test.ts`
  - `butler-control-timer-service.test.ts`

## 任务 1：先把自动化和旧 timer 的边界说死

目标结果：
做完后，所有人都知道什么是正式自动化、什么只是兼容 timer，后面不会继续在旧表上缝补。

依赖：
- `spec013.1`
- `spec013.2`

主要文件：
- `requirements.md`
- `design.md`

明确不做：
- 不直接删旧 `timers.*`
- 不在旧 `ButlerControlTimer` 上继续无限加字段

当前状态：
- [x] 已完成边界初稿

## 任务 2：定义自动化任务、执行记录和触发器模型

目标结果：
做完后，单次、interval、cron、condition 都有稳定数据结构和状态推进规则。

依赖：
- 任务 1

主要文件：
- `design.md`

明确不做：
- 不做任意脚本表达式
- 不做万能工作流 DSL

当前状态：
- [x] 已完成模型初稿

## 任务 3：设计自动化调度接入 TaskManager 的方案

目标结果：
做完后，自动化扫描、条件检查、执行回写和清理都有明确的任务类型、key、执行位点和失败策略。

依赖：
- 任务 2
- `spec001.2`

主要文件：
- `design.md`
- 后续实现中的任务注册代码

明确不做：
- 不再长一套新的私有后台队列
- 不把重活留在轻量扫描环节

当前状态：
- [x] 已完成当前实现切片
- 已在 `design.md` 中补任务类型、`key` 和执行位点初稿
- 已先落一版非 `TaskManager` 的 once 自动化权威对象，先把数据结构、Host API 和兼容 timer 立住
- 已把一次性自动化扫描/执行正式接进 `TaskManager`
- 已把正式自动化四类触发器接进 `TaskManager`：
  - `once`
  - `interval`
  - `cron`
  - `condition`
- 当前 `condition` 白名单已落两类：
  - `git.remote_tag_changed`
  - `session.runtime_idle`
- 当前落地的任务切片：
  - `assistant.automation.tick` 负责扫描到期任务并按 `automationId` enqueue
  - `assistant.automation.evaluate` 负责真正执行一次性自动化并回写 run/task 状态
  - Host 重启后，如果上一次 run 已成功/失败但 task 没来得及收口，会在下一次 evaluate 前自动补齐 task 状态
  - Host 重启后，如果上一次 run 卡在 `running`，会先标记为中断失败，再重试当前到期任务
- 当前仍未做：
  - 自动化清理任务
  - 更重执行位点拆分到 helper/external process

## 任务 4：定义沙箱工作区模型和生命周期

目标结果：
做完后，助手可以创建、查看、清理、晋升自己的临时沙箱，而不是继续借正式工作区。

依赖：
- `spec013.1`
- 任务 1

主要文件：
- `requirements.md`
- `design.md`

明确不做：
- 不把沙箱默认变成正式项目
- 不做复杂的跨主机迁移

当前状态：
- [x] 已完成生命周期和边界初稿

## 任务 5：扩展真实会话启动目标

目标结果：
做完后，`sessions start` 能明确选择 `project / workspace / sandbox`，而不是只有项目目标。

依赖：
- 任务 4
- `spec013.2`

主要文件：
- `design.md`
- 后续实现中的 `assistant-capability`、CLI、会话启动服务

明确不做：
- 不允许不传目标就猜默认对象

当前状态：
- [x] 已完成当前实现切片
- `assistant-capability` 已支持 `sessions.start`
- 会话启动目标已明确支持 `project / workspace / sandbox` 三选一
- 约束已收死：
  - 不传目标不允许猜默认
  - `sandbox` 启动前会检查沙箱是否已过期或删除
  - `project` 继续走 Butler 管理会话；`workspace / sandbox` 走实时会话启动
- 已补 `sessions.start --sandbox` 的集成测试，分别覆盖：
  - 继承 `codex` 控制会话配置后启动沙箱真实会话
  - 继承 `claude-code` 控制会话配置后启动沙箱真实会话

## 任务 6：设计兼容迁移和 UI/CLI 入口

目标结果：
做完后，新自动化和沙箱有正式入口，旧 timer 和旧页面也不会立刻被打坏。

依赖：
- 任务 2
- 任务 4
- 任务 5

主要文件：
- `design.md`
- 后续实现中的 `apps/user-app`、`packages/codingns`

明确不做：
- 不要求旧调用方一次性全部改完

当前状态：
- [ ] 进行中
- 已补兼容映射文档初稿
- 已补正式 `/api/assistant/automations` API 和 `codingns assistant automations *` CLI 入口
- 自动化创建入口已支持正式触发器参数：
  - `once`
  - `interval`
  - `cron`
  - `condition`
- 已补最近运行记录接口：
  - `GET /api/assistant/automations/runs/recent`
- 旧 `timers.*` Host 服务兼容入口已切到正式自动化对象
- 已补 `codingns assistant sessions start` 新入口，支持 `--project / --workspace / --sandbox`
- 已补 `codingns assistant sandboxes list/create/promote/expire/remove`
- 已补 Butler 自动化标签页迁移：
  - 桌面 Butler 自动化页已改读正式 `assistant automations + recent runs`
  - 移动 Butler 自动化页已改读正式 `assistant automations + recent runs`
  - 自动化主列表现在只展示进行中的正式自动化任务
  - 自动化历史面板现在展示正式自动化历史任务和最近运行记录
  - 自动化取消动作已切到 `cancelAssistantAutomation`
- 已补 Butler 前端最小沙箱入口：
  - 信息标签页顶部新增“管理沙箱”按钮
  - 已接前端 `sandboxes list/create/promote/expire/remove` DTO 与 API
  - 已补桌面 Butler 的最小沙箱管理弹窗，可创建、查看、晋升、过期、删除
- 当前仍未做：
  - Butler 移动端的沙箱管理入口
  - 更完整的沙箱会话创建/跳转前端流转

## 任务 7：补验证清单和最小回归集

目标结果：
做完后，至少能证明一次性自动化、周期自动化、条件自动化、沙箱会话、沙箱清理这几条最核心链路可用。

依赖：
- 任务 3
- 任务 4
- 任务 5
- 任务 6

主要文件：
- 后续补充到 `docs/`
- 实现阶段测试文件

明确不做：
- 不追求第一阶段全量覆盖所有组合场景

当前状态：
- [ ] 进行中
- 已补最小回归验证清单初稿
- 已补一次性自动化与 timer 兼容的最小集成测试
- 当前已验证：
  - `pnpm --dir apps/host exec vitest run tests/integration/assistant-automation-service.test.ts tests/integration/butler-control-timer-service.test.ts tests/integration/assistant-capability-service.test.ts tests/integration/assistant-capability-routes.test.ts`
  - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
- 本轮新增验证：
  - `pnpm --dir apps/host exec vitest run tests/integration/assistant-automation-service.test.ts tests/integration/butler-control-timer-service.test.ts tests/integration/assistant-capability-service.test.ts tests/integration/assistant-capability-routes.test.ts tests/integration/assistant-sandbox-service.test.ts tests/integration/butler-project-service.test.ts`
  - `node --check packages/codingns/bin/codingns.mjs`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/ButlerPage.test.tsx`
  - `pnpm --dir apps/user-app exec vitest run src/features/butler/pages/MobileButlerPage.test.tsx`
  - `pnpm --dir apps/user-app exec tsc -p tsconfig.json --noEmit`
- 当前已覆盖：
  - 一次性自动化通过 `TaskManager` 扫描并执行
  - `interval / cron / condition` 正式自动化的 Host 服务、API、CLI 和最近运行记录最小链路
  - `timers.*` 继续通过兼容 facade 工作
  - `sessions.start` 支持 `workspace` 目标
  - `sessions.start --sandbox` 同时覆盖 `codex / claude-code`
  - 沙箱创建、晋升、删除与“跳过自动纳管项目”最小链路
  - Butler 桌面端自动化标签页已切到正式 `assistant automations + runs`
  - Butler 移动端自动化标签页已切到正式 `assistant automations + runs`
  - Host 重启后的一次性自动化收口恢复：
    - 已成功 run 不会因为 task 未收口而重复发消息
    - `running` run 会被标记中断后重试
