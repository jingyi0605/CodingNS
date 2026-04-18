# 任务清单 - spec013.4-助手专用Skill隔离与调用身份收口（人话版）

状态：Draft

## 2026-04-18 立项补记

- 已确认当前问题不是 `codingns-assistant` 文案不够狠，而是它被错误地分发到了公共 Skill 根目录。
- 已确认本子 Spec 的目标不是“再加一层提示词”，而是把助手专用 Skill 从公共 Skill 管理里拆出去，同时补上助手能力调用的身份边界。
- 已确认 `spec001.5` 的公共 Skill 管理模型不该继续替 Butler 专用资产背锅。
- 已完成本子 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化。

## 2026-04-18 第一轮实现进展

- 已停止 `codingns-assistant` 的公共内置 Skill 同步：`builtin-skill-service` 不再把它当公共 builtin。
- 已停止 npm `postinstall` 把 `codingns-assistant` 复制到公共 `~/.codex/skills`。
- 已把 Butler 专用 home 的 `codingns-assistant` 注入链改成直接从仓库内置资源复制，不再依赖公共 `SkillManager`。
- 已给公共 Skill 管理加保留目录名规则：`codingns-assistant` 不能再通过公共导入、纳管、builtin 同步长回来。
- 已给公共 Skill 扫描补保留目录名诊断：扫到公共目录里的 `codingns-assistant` 会标为冲突并给出明确错误码。
- 已补相关集成测试，确认：
  - Butler 专用 home 仍能看到 `codingns-assistant`
  - 公共 Skill 导入/纳管会拒绝 `codingns-assistant`
  - 公共 Skill 扫描会把历史残留标成保留冲突
  - Skill 路由真实起服链路未被这轮改动打断

## 任务 1：先把边界说死

目标结果：
做完后，团队会统一认定 `codingns-assistant` 属于助手专用运行时资产，不再属于公共 Skill。

依赖：
- `spec001.5`
- `spec013.2`

主要文件：
- `requirements.md`
- `design.md`

明确不做：
- 不在这一任务里改业务代码

当前状态：
- [x] 已完成边界与范围文档初稿

## 任务 2：拆掉 `codingns-assistant` 的公共同步和公共安装

目标结果：
做完后，Host 启动和 npm `postinstall` 都不会再把 `codingns-assistant` 落到普通公共 `skills/` 根目录。

依赖：
- 任务 1

主要文件：
- `apps/host/src/modules/skills/builtin-skill-service.ts`
- `packages/codingns/scripts/postinstall.mjs`

明确不做：
- 不影响其他公共内置 Skill 的同步

当前状态：
- [x] 已完成
- 已移除公共 builtin 同步入口
- 已移除 `packages/codingns/scripts/postinstall.mjs` 里的公共复制逻辑

## 任务 3：补 Butler 专用运行时资产注入服务

目标结果：
做完后，Butler 为 `codex` 或 `claude-code` 准备专用 home 时，仍能拿到 `codingns-assistant`，但这条链不再依赖公共 Skill 管理。

依赖：
- 任务 1

主要文件：
- `apps/host/src/modules/butler/`
- `apps/host/src/modules/skills/` 或新增专用运行时资产模块

明确不做：
- 不把这条链重新接回公共 Skill 根目录

当前状态：
- [x] 已完成
- 已把 Butler 专用上下文里的 skill 注入改成直接从仓库内置资源复制
- 当前实现先落在 `butler-workspace-context.ts`，后续如果有第二个助手专用资产，再考虑抽独立 service

## 任务 4：给公共 Skill 管理增加助手保留目录名规则

目标结果：
做完后，`codingns-assistant` 这类保留目录名不能再通过公共 Skill 导入、同步和纳管重新长回来。

依赖：
- 任务 1
- 任务 2

主要文件：
- `apps/host/src/modules/skills/skill-manager-service.ts`
- `apps/host/src/modules/skills/skill-reconciler.ts`
- 对应测试文件

明确不做：
- 不把所有 Skill 都改成复杂权限模型

当前状态：
- [x] 已完成
- 已拦截 `addManagedSkill / importUnmanagedSkill / ensureBuiltinSkill / syncManagedSkill`
- 已给扫描结果补 `SKILL_RESERVED_FOR_ASSISTANT_RUNTIME` 诊断

## 任务 5：给助手能力调用补调用者身份收口

目标结果：
做完后，系统能区分 Butler 页面显式交互和助手运行时调用，普通项目工作区不会仅靠读到 Skill 就冒充助手运行时。

依赖：
- 任务 1
- 任务 3

主要文件：
- `apps/host/src/modules/assistant-capability/`
- `apps/host/src/modules/butler/`
- `packages/codingns/bin/codingns.mjs`

明确不做：
- 不重写整套全局登录与鉴权体系

当前状态：
- [x] 已完成
- 已给 Butler 专用凭证改成可识别的运行时 token 前缀，并让旧的非前缀 `BUTLER_AUTH.json` 在下次初始化时自动轮换
- 已把 `callerKind` 接入 `AuthService -> auth-guard -> request.auth`，并补 `/api/assistant/*` 的来源校验
- 已保留 Butler 页面显式入口：页面侧通过固定请求头声明 `butler-ui` 来源，普通登录态直接调用会被拒绝
- 已给助手能力回执补 `callerKind` 透传，便于排错和审计
- 已补 Host / user-app 定向测试，覆盖助手运行时、页面显式入口和非法调用拒绝场景

## 任务 6：补旧残留识别、清理和诊断

目标结果：
做完后，老机器公共目录里留下的 `codingns-assistant` 能被识别；能确认是系统旧副本的会被清理，漂移副本会被标红诊断。

依赖：
- 任务 2
- 任务 4

主要文件：
- `apps/host/src/modules/skills/`
- `packages/codingns/` 必要时补最小诊断入口
- 对应集成测试

明确不做：
- 不静默删除用户手改过的目录

当前状态：
- [x] 已完成
- 已完成“识别和诊断”部分
- 已补“可安全确认旧副本时自动清理”收尾逻辑：
  - Host 启动时会扫描公共 skill 根目录里的 `codingns-assistant`
  - 内容哈希和内置副本一致时自动删除旧官方副本
  - 用户改动过的漂移目录不会误删，只保留并继续诊断

## 任务 7：补回归验证和最小文档

目标结果：
做完后，可以明确验证三件事：
1. 普通公共 home 默认没有官方 `codingns-assistant`
2. Butler 专用 home 仍能看到 `codingns-assistant`
3. 普通公共 Skill 管理不受影响

依赖：
- 任务 2
- 任务 3
- 任务 4
- 任务 5
- 任务 6

主要文件：
- `apps/host/tests/integration/`
- `packages/codingns/` 测试
- `docs/` 补充验收材料

明确不做：
- 不追求一次性覆盖所有历史 provider 组合

当前状态：
- [ ] 进行中
- 已补第一批 Host 集成测试
- 已补调用者身份收口相关回归：
  - Butler token caller 识别与旧凭证轮换
  - `/api/assistant/*` caller 限制与回执透传
  - Butler 设置页实际使用的 assistant API 请求头
- 已调整设置页 Skill 管理展示：
  - 助手专用 skill 单独分组展示，不再挂在“冲突项 / 诊断”语义下
  - 已补“这是助手专用，不属于工作区 skill”的用户文案说明
- 已补助手会话里的权限审批可见性和回执链：
  - Butler runtime store 现在会拉取、缓存并实时更新当前控制会话的权限请求
  - Butler 桌面页和移动页都会展示待审批列表，并在新请求到达时弹出提醒
- 已扩 Claude 助手会话的安全命令自动放行：
  - `codingns assistant ...` 继续按受控助手 CLI 规则自动放行
  - 新增一层严格的只读 shell allowlist，覆盖 `pwd / ls / rg / cat / sed -n / find / git status|diff|log|show|ls-files` 等安全查询命令
  - 带 shell 控制符、写入参数或明显副作用的命令仍然保留人工审批
- 已修正设置页“助手专用 Skill”展示数据源：
  - 不再依赖公共 skill 根目录里的残留冲突项反推助手专用 skill
  - Host 现在会直接返回内置助手专用 skill 列表，公共目录清理干净后设置页仍会稳定显示 `codingns-assistant`
- 已补本轮定向验证：
  - `apps/user-app` 的 Butler 桌面页 / 移动页测试通过
  - `apps/host` 的权限请求服务与 `session-live-runtime-service` 回归通过
- 还没补单独的迁移说明和验收清单文档
