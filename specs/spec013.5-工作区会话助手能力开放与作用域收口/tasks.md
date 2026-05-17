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
- [x] 已在工作台左侧技能面板复用现有 tab 结构接入“办公 / 运维”入口
- [x] 已让技能面板可查看文档模板、运维任务和当前工作区下的 SSH 主机配置
- [x] 已把文档模板添加、SSH 主机添加/编辑改成独立模态框入口，不再把表单堆在 tab 主面板里
- [x] 文档模板添加已简化为上传 `.domt/.doct` 文件，由 Host 自动保存并推导模板 key / 版本
- [x] SSH 主机配置当前只承诺正式支持字段：`host / username / port / privateKeyPath / knownHostsPath / jumpHost / workspacePath / credentialRef / strictHostKeyChecking`
- [ ] 密码认证链路仍未完整接通，本轮没有做假表单能力

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
- [x] 已补 `SkillManagementPanel.test.tsx`，覆盖办公/运维 tab 的最小前端验证
- [x] 已把 `codingns-assistant` runtime skill、Butler 注入说明、工作区会话注入说明统一改成“真实网页操作默认优先走 `office.browser.*`，只有 localhost 调试才优先 Codex Browser”
- [x] 已确认 `codingns-assistant` 仅限助手会话使用，并新增工作区会话专用内置 skill `codingns-workspace-session`
- [x] 已让 workspace session 初始化 runtime home 时同步 `codingns-workspace-session` 到 `runtimeHomeDir/skills`
- [x] 已让普通工作区会话在 `start/send live` 时显式注入组合说明文件，并把 scoped 认证环境变量直接传给当前运行时，不再依赖 Codex 默认 home 自动发现
- [x] 已补 `workspace-session-runtime-context-service.test.ts` 与 `session-live-runtime-service.test.ts`，覆盖工作区说明落盘和真实运行时注入
- [x] 已补 `browser-profile-list` CLI 正式别名，并把工作区会话注入说明/专用 skill 文案统一成真实可执行命令，减少模型误判成“没有浏览器能力”
- [x] 已把 `office.browser.task.create --input-json` 的最小 JSON 结构、动作类型列表和可直接照抄的 CLI 模板补进 CLI help、工作区专用 skill 与 Host 注入说明，避免模型继续退回去翻源码猜 payload
- [x] 已把技能面板里的 `codingns-workspace-session` 标签从“仅助手使用”改成“工作区会话使用”，避免 UI 继续误导
- [x] 已修 `workspace_session + assistant-cli` 被 auth guard 误拦截的问题；工作区会话现在可以正式读取 assistant capability 列表
- [x] 已新增可分发的工作区专用 office MCP server，正式暴露 `office.document.* / office.browser.* / office.ops.*`
- [x] 已给工作区 runtime 自动写入 Codex / Claude / OpenCode 的 MCP 配置文件，后续其他环境分发后可直接复用
- [x] 已让工作区 live session 真实跑在 CodingNS 全局目录下的工作区会话专用 runtime home 上，避免 Codex 继续漏读工作区专用 MCP 与说明文件
- [x] 已把 `codingns-workspace-session` skill 收窄成“路由 + 安全规则说明”，不再继续承担整套 CLI 教程
- [x] 已补 `workspace-office-mcp` 最小自动化测试，以及 Host 侧 runtime home / 注入链测试
- [x] 已补最小人工验证记录，明确说明怎么在工作区会话里确认 MCP 工具已真实可见
- [x] 已把 `opencode` 的托管 `server/baseUrl` 模式从“只写配置文件”收紧到“启动托管进程时真实注入 `OPENCODE_CONFIG_CONTENT`，并按 `workspaceId + runtimeHomeDir` 隔离”
- [x] 已在左侧技能面板的 `codingns-workspace-session` 卡片接入“MCP 状态”按钮，可查看当前工作区会话 runtime、全局 CLI、仓库内 CLI 和各 CLI MCP 配置是否真的可用
- [x] 已修工作区会话专用 runtime 漏同步 Codex/Claude 基础运行时的问题，避免切到专用 home 后丢失认证导致 `401 Unauthorized`
- [x] 已修工作区会话 MCP 状态里仓库内 `codingns.mjs` 的路径探测，不再误拼到 `apps/host/packages/...`
- [x] 已把工作区会话 runtime/MCP 资产从“工作区目录内 `.codingns` 落盘”收口为“CodingNS 全局数据目录统一管理”，避免污染每个项目目录
- [x] 已把 Codex 工作区会话的 office MCP 接入改成运行时 `codex app-server -c mcp_servers...` 注入：不切 `CODEX_HOME`，不改用户真实 `~/.codex/config.toml`，也不影响 transcript 落盘位置，只在当前会话 helper 进程里临时暴露 `office.browser.*`
