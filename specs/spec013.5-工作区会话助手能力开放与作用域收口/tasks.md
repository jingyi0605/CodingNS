# 任务清单 - spec013.5-工作区会话助手能力开放与作用域收口（人话版）

状态：Draft

## 2026-05-15 立项补记

- 已确认当前问题不是“工作区会话不会写 prompt”，而是它拿不到正式助手能力入口。
- 已确认不能直接把全量 `codingns assistant` 开给工作区会话，否则会把跨工作区、自动化、审批和高风险执行一起放出来。
- 已确认本子 Spec 的核心目标是：给工作区会话开放一部分正式助手能力，并且把范围收死到当前工作区。
- 已确认 `terminals.create` 是现有能力面的明确缺口，必须在本子 Spec 里补上。
- 已完成本子 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化。

## 任务 1：先把开放边界和能力清单写死

目标结果：
做完后，团队会统一认定哪些助手能力工作区会话默认能用，哪些要条件开放，哪些现在不开放。

依赖：
- `spec013.2`
- `spec013.4`
- `spec015`

主要文件：
- `requirements.md`
- `design.md`

明确不做：
- 不在这一任务里改业务代码

当前状态：
- [x] 已完成 Spec 初稿

## 任务 2：定义 `workspace_session` 调用者身份和 scoped token

目标结果：
做完后，系统能正式区分工作区会话调用者，并且所有工作区会话助手请求都带有受控作用域。

依赖：
- 任务 1

主要文件：
- `apps/host/src/modules/auth/`
- `apps/host/src/modules/assistant-capability/`
- `packages/codingns/bin/codingns.mjs`

明确不做：
- 不重写整套全局鉴权体系

当前状态：
- [x] 已完成基础实现
- [ ] 待补更多链路验证与边角测试

## 任务 3：给助手能力服务补 profile 过滤和作用域校验

目标结果：
做完后，`capabilities.list` 和真实执行都按 `workspace-scoped` 档位过滤，不能再只靠提示词约束。

依赖：
- 任务 1
- 任务 2

主要文件：
- `apps/host/src/modules/assistant-capability/assistant-capability-service.ts`
- `apps/host/src/routes/assistant.ts`
- 对应测试文件

明确不做：
- 不做复杂可视化权限管理页

当前状态：
- [x] 已完成基础实现
- [x] 已补 `sessions.get/messages/runtime` 的真实工作区校验
- [x] 已补 `worktrees.*` 的真实作用域校验
- [x] 已补 `office.document.*` / `office.browser.*` 的真实作用域校验
- [x] 已补 `office.ops.*` / `debug-targets.*` / `debug-runtimes.get` 的真实作用域校验
- [x] 已补关键接口级自动化测试
- [ ] 待补更大范围回归验证

## 任务 4：补工作区会话能力说明注入

目标结果：
做完后，工作区会话知道自己什么时候该调用文档、浏览器、运维、终端和工作树能力，也知道哪些事别乱试。

依赖：
- 任务 1
- 任务 3

主要文件：
- `apps/host/src/modules/butler/` 相邻上下文模块
- 工作区会话提示构造相关文件

明确不做：
- 不做复杂 UI 配置器

当前状态：
- [x] 已完成基础实现
- [ ] 待补 Host/CLI 联调验证

## 任务 5：补 `terminals.create`

目标结果：
做完后，工作区会话可以在当前工作区里正式新建终端，而不是只能操作已有终端。

依赖：
- `spec006`
- 任务 2
- 任务 3

主要文件：
- `apps/host/src/modules/terminal/`
- `apps/host/src/routes/assistant.ts`
- `packages/codingns/bin/codingns.mjs`
- 对应测试文件

明确不做：
- 不在这一步重做整套终端 UI

当前状态：
- [x] 已完成基础注入
- [ ] 待补更多 provider 场景验证

## 任务 6：把办公能力入口正式接到工作区会话

目标结果：
做完后，工作区会话可以通过统一 `assistant office` 能力面调用文档、浏览器和运维入口，并拿到任务回执。

依赖：
- 任务 2
- 任务 3
- `spec015` 对应能力已落地部分

主要文件：
- `apps/host/src/modules/assistant-capability/`
- `apps/host/src/routes/assistant.ts`
- 办公能力相关服务和测试

明确不做：
- 不在这一步做复杂前端管理页

当前状态：
- [x] 已完成
- [x] 已把 `office.document.*` / `office.browser.*` 正式接到 `workspace-scoped`
- [x] 已把 `office.ops.target.* / office.ops.ssh-task.create / office.ops.browser-task.create / office.ops.task.get / office.ops.task.execute` 接回 `workspace-scoped`
- [x] 已给 `ops_targets` 和相关任务链补 `workspace_id`，执行入口会按当前工作区做真实校验

## 任务 7：补条件开放能力的确认与拒绝回执

目标结果：
做完后，工作区会话触发写终端、执行运维、merge 工作树这类动作时，不会直接闷头执行，而是有明确确认或拒绝回执。

依赖：
- 任务 3
- 任务 5
- 任务 6

主要文件：
- `apps/host/src/modules/assistant-capability/`
- 审批或确认相关服务
- 对应测试文件

明确不做：
- 不在这一轮设计完整 RBAC 系统

当前状态：
- [x] 已完成基础实现
- [x] 已给 `terminals.input.send` / `terminals.close` / `office.ops.task.execute` / `worktrees.merge-into-parent` 接入显式确认
- [x] 已给 `office.ops.ssh-task.create(execute=true)` / `office.ops.browser-task.create` / `debug-targets.*` 执行类接入显式确认
- [ ] 待补更完整的拒绝回执示例和更大范围回归测试

## 任务 8：补测试、示例和最小使用说明

目标结果：
做完后，可以明确验证：
1. 工作区会话能力表已按作用域过滤
2. 工作区会话能在当前工作区创建终端
3. 文档、浏览器、运维、工作树能力已能从工作区会话进入
4. Butler 控制面旧链路未被打坏

依赖：
- 任务 2 到 7

主要文件：
- `apps/host/tests/`
- `packages/codingns/` 测试
- `docs/`

明确不做：
- 不追求一次覆盖所有 provider 组合

当前状态：
- [~] 部分完成
- [x] 已通过 `pnpm -C apps/host exec tsc --noEmit`
- [x] 已补 `assistant-capability-routes.test.ts` / `assistant-capability-service.test.ts` 的接口级测试
- [ ] 待补最小人工验证记录
