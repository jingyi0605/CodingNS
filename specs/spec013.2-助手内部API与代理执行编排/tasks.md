# 任务清单 - spec013.2-助手内部API与代理执行编排（人话版）

状态：In Progress

## 2026-04-14 立项补记

- 已确认 `spec013.2` 不再讨论 Butler 页面结构，而是专门处理“助手内部能力面”。
- 已确认本子 Spec 的核心目标不是再加几个路由，而是把现有项目 / 会话 / 终端 / fork 能力统一收口成正式的 Host API、CLI、内部 help、Skill 表面。
- 已确认 Butler 的强边界：默认只允许“只读分析 + 代理执行”，不允许 Butler 自己直接改项目代码。
- 已完成本子 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化。

## 2026-04-14 实施进展

- 已新增 Host 侧 `assistant-capability` 能力门面骨架，开始提供统一的 `/api/assistant/*` 路由。
- 当前已落的第一批入口包括：
  - `GET /api/assistant/capabilities`
  - `GET /api/assistant/projects`
  - `GET /api/assistant/projects/:projectId`
  - `GET /api/assistant/projects/:projectId/sessions`
  - `GET /api/assistant/sessions/:sessionId`
  - `GET /api/assistant/sessions/:sessionId/messages`
  - `GET /api/assistant/sessions/:sessionId/runtime`
  - `POST /api/assistant/sessions/:sessionId/messages`
  - `POST /api/assistant/sessions/:sessionId/forks`
  - `GET /api/assistant/terminals`
  - `GET /api/assistant/terminals/:terminalId/history`
  - `POST /api/assistant/terminals/:terminalId/input`
- 已确认这批路由只是薄门面，不复制底层业务逻辑：
  - 项目能力复用 `ButlerProjectService` / `ButlerSessionService`
  - 会话能力复用 `SessionHistoryService` / `SessionLiveRuntimeService`
  - 终端能力复用 `TerminalService`
- 已补最小路由测试 `apps/host/tests/integration/assistant-capability-routes.test.ts`，验证统一回执、分页参数透传、消息发送清洗、终端参数校验、fork 默认策略。
- 已给 `packages/codingns/bin/codingns.mjs` 增加 `codingns assistant ...` 第一批命令，把 CLI 参数直接映射到 `/api/assistant/*`。
- 已补 `packages/codingns/README.md` 的助手能力 CLI 使用说明，明确 `CODINGNS_BASE_URL` / `CODINGNS_ACCESS_TOKEN` 这两个入口参数。
- 已确认不走 MCP 方案，后续改为 `CLI + 内部 help + Skill`，避免把工具 schema 和长说明塞进每次会话上下文。
- 已把 Butler 控制会话的自动生成说明改成“优先走 `codingns assistant ...` + 分层 help”，不再把旧 REST 路由当主工作流。
- 已开始把 `codingns-assistant` skill 同步进 Butler 专用 `codex-home/skills/`，让独立 Butler Codex 运行时也能看到这套 skill。
- 当前阻塞不在本 Spec 新代码，而在 Host 现有 TypeScript 全量检查还有两处历史错误，后续要单独清掉：
  - `apps/host/src/modules/sessions/session-history-service.ts`
  - `apps/host/src/modules/terminal/runtime/terminal-log-writer-client.ts`

## 任务 1：先把能力边界说死

目标结果：
做完后，所有人都知道 Butler 第一阶段到底能查什么、能做什么、明确不能做什么。

依赖：
- `spec013`
- `spec013.1`

主要文件：
- `requirements.md`
- `design.md`

明确不做：
- 不开放直接文件写入能力
- 不开放脱离项目会话的代码修改能力

当前状态：
- [x] 已完成需求与边界初稿

## 任务 2：定义统一能力合同

目标结果：
做完后，项目、会话、终端、消息、fork 这些动作会有统一名字、统一输入输出、统一错误码。

依赖：
- 任务 1

主要文件：
- `design.md`
- 后续实现代码目录待定

明确不做：
- 不一次性覆盖所有 butler 对象

当前状态：
- [x] 已完成统一能力名、输入输出回执与第一批能力范围定义

## 任务 3：落 Host API 能力门面

目标结果：
做完后，Host 会有一组给助手用的 `/api/assistant/*` 入口，语义统一，底层继续复用现有服务。

依赖：
- 任务 2

主要文件：
- `apps/host/src/routes/`
- `apps/host/src/modules/assistant-capability/`

明确不做：
- 不删除旧路由
- 不复制底层业务逻辑

当前状态：
- [ ] 进行中
- 已完成第一批 `/api/assistant/*` 路由、控制器、服务门面接线
- 尚未完成失败回执统一化、审计持久化、真实集成链路补测

## 任务 4：落 CLI 命令入口

目标结果：
做完后，平台自家 CLI 可以稳定调用统一能力面，而不是继续散落地拼 HTTP 请求。

依赖：
- 任务 3

主要文件：
- `packages/codingns/`

明确不做：
- 不在第一阶段搞复杂交互式 TUI

当前状态：
- [ ] 进行中
- 已完成 `codingns assistant capabilities/projects/sessions/terminals` 第一批命令入口
- 当前仍缺少 CLI 自动登录串联、输出格式细分和回执错误码统一测试

## 任务 5：落 Skill 与内部 help 入口

目标结果：
做完后，代理只需要知道“有这些能力”和“去哪查帮助”，真正执行时通过 CLI help 和 `codingns assistant ...` 按需取用，而不是把整套命令文档长期塞进上下文。

依赖：
- 任务 3

主要文件：
- `packages/codingns/`
- 本地 Skill 目录

明确不做：
- 不做 MCP server
- 不把完整命令手册硬塞进 Skill

当前状态：
- [ ] 进行中
- 已完成 CLI 第一版按组、按动作 help
- 已完成本地 `codingns-assistant` Skill 第一版，内容只保留流程约束和按需查 help 的导航

## 任务 6：把 Butler 接到统一能力面

目标结果：
做完后，Butler 会优先调能力门面，只有在需要更深细节时才下钻底层接口。

依赖：
- 任务 3
- 任务 5

主要文件：
- `apps/host/src/modules/butler/`
- `apps/user-app/src/features/butler/`

明确不做：
- 不重做 Butler 聊天 UI

当前状态：
- [ ] 待开始
- 已完成 Butler 控制会话指令的第一轮收口：先看摘要，再查 CLI help，再用 `codingns assistant` 代理执行
- 尚未把所有 Butler 相关旁路文档和旧提示全部清空，后续还要继续收紧

## 任务 7：补审计、验证和兼容回归

目标结果：
做完后，能力调用有审计记录，旧页面不受影响，CLI / Skill / Butler 三条入口能跑通最小闭环。

依赖：
- 任务 3
- 任务 4
- 任务 5
- 任务 6

主要文件：
- 审计存储与测试文件
- 集成测试与文档

明确不做：
- 不追求第一阶段全量回归所有场景

当前状态：
- [ ] 待开始
