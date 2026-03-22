# 任务清单 - spec005-Git上下文与提交规则引擎（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单的目标很简单：  
把 Git 从“能点按钮”做成“可控提交流程”。

每个任务都必须回答：

- 这一步到底建什么
- 做完后能看到什么
- 依赖什么
- 改哪些文件
- 明确不做什么
- 怎么验证

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：有结果，待复核
- `DONE`：完成并验证通过
- `CANCELLED`：取消并写明原因

规则：

- 只有 `状态：DONE` 才能勾选 `[x]`
- 每完成一个任务，必须立刻回写状态
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 1：先把 Git 上下文基础能力跑通

- [ ] 1.1 建立受保护 Git API 骨架和工作区仓库边界校验
  - 状态：TODO
  - 这一步到底做什么：创建 Git 路由入口和统一中间件，保证所有 Git 接口默认鉴权并绑定工作区仓库根目录。
  - 做完你能看到什么：未登录请求被拒绝，越界路径操作被拒绝。
  - 先依赖什么：`spec001` 初始化与鉴权链路已可用。
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.1、§2.2、§3.3
  - 主要改哪里：
    - `apps/host/src/routes/git.ts`
    - `apps/host/src/modules/git/git-context-controller.ts`
    - `apps/host/src/modules/git/workspace-repo-guard.ts`
  - 这一步先不做什么：不实现规则引擎，不做 AI 生成。
  - 怎么算完成：
    1. Git 路由全部走受保护链路
    2. 工作区和仓库边界校验生效
  - 怎么验证：
    - 集成测试：未登录访问返回 401
    - 集成测试：越界路径操作返回边界错误
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.1、§2.2、§3.3

- [ ] 1.2 实现状态、diff、变更集合读取
  - 状态：TODO
  - 这一步到底做什么：落 `GitReadService`，实现状态摘要、文件变更和 diff 查询。
  - 做完你能看到什么：用户能看到可操作的 Git 全景信息。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.3.1、§3.2、§3.3
  - 主要改哪里：
    - `apps/host/src/modules/git/git-read-service.ts`
    - `apps/host/src/modules/git/git-command-runner.ts`
    - `apps/host/src/modules/git/dto/git-repo-snapshot.ts`
  - 这一步先不做什么：不做提交写操作。
  - 怎么算完成：
    1. 状态接口返回分支、ahead/behind、dirty 状态
    2. diff 接口可按文件返回内容
  - 怎么验证：
    - 集成测试：status/diff 成功路径
    - 异常测试：非 Git 仓库返回明确错误
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §2.3.1、§3.2、§3.3

- [ ] 1.3 实现暂存与取消暂存
  - 状态：TODO
  - 这一步到底做什么：实现文件级暂存/取消暂存，提交前能精确控制变更集合。
  - 做完你能看到什么：变更文件可自由进出暂存区。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.3.1、§3.3.3、§3.3.4
  - 主要改哪里：
    - `apps/host/src/modules/git/git-write-service.ts`
    - `apps/host/src/modules/git/git-context-controller.ts`
  - 这一步先不做什么：不执行 commit。
  - 怎么算完成：
    1. 暂存与取消暂存后状态实时刷新
    2. 非法目标文件被拦截
  - 怎么验证：
    - 集成测试：stage/unstage 回放
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §2.3.1、§3.3.3、§3.3.4

- [ ] 1.4 阶段检查：Git 基础读写能力检查
  - 状态：TODO
  - 这一步到底做什么：确认状态、diff、暂存三条链路稳定可用。
  - 做完你能看到什么：可以进入提交流程和规则引擎开发。
  - 先依赖什么：1.1、1.2、1.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3
    - `design.md` §2.3.1、§3.3
  - 主要改哪里：本阶段相关实现和测试文件
  - 这一步先不做什么：不扩展分支、历史、远程同步。
  - 怎么算完成：
    1. 基础能力通过集成测试
    2. 鉴权和边界校验无漏口
  - 怎么验证：
    - `pnpm test`（或等价测试命令）
    - 人工回放一轮状态 -> diff -> stage -> unstage
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3
  - 对应设计：`design.md` §2.3.1、§3.3、§6.2、§6.3

---

## 阶段 2：把提交规则引擎和提交流程做硬

- [ ] 2.1 建立规则配置模型与持久化
  - 状态：TODO
  - 这一步到底做什么：实现 `CommitRuleProfile` 模型、读取与更新接口。
  - 做完你能看到什么：工作区可绑定提交规则配置，不靠硬编码。
  - 先依赖什么：1.4
  - 开始前先看：
    - `requirements.md` 需求 6、需求 8
    - `design.md` §3.2.3、§4.1
  - 主要改哪里：
    - `apps/host/src/modules/git/rules/git-rule-repository.ts`
    - `apps/host/src/modules/git/rules/commit-rule-profile.ts`
    - `apps/host/src/routes/git-rules.ts`
  - 这一步先不做什么：不接 AI 草稿。
  - 怎么算完成：
    1. 可读取并更新规则配置
    2. 无配置时有默认规则兜底
  - 怎么验证：
    - 单元测试：规则配置读写
    - 集成测试：规则接口鉴权与边界
  - 对应需求：`requirements.md` 需求 6、需求 8
  - 对应设计：`design.md` §3.2.3、§4.1、§3.3

- [ ] 2.2 实现规则引擎与提交校验接口
  - 状态：TODO
  - 这一步到底做什么：实现格式、长度、语言、body、issue 等规则校验。
  - 做完你能看到什么：提交草稿有明确的“通过/失败”与违规明细。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 6、需求 8
    - `design.md` §2.3.2、§3.2.5、§3.3.6
  - 主要改哪里：
    - `apps/host/src/modules/git/rules/commit-rule-engine.ts`
    - `apps/host/src/modules/git/rules/commit-validation-result.ts`
    - `apps/host/src/modules/git/git-context-controller.ts`
  - 这一步先不做什么：不执行真正 commit。
  - 怎么算完成：
    1. 校验接口返回完整违规项
    2. 规则失败时不能进入提交执行
  - 怎么验证：
    - 单元测试：各规则维度
    - 集成测试：校验失败拦截提交
  - 对应需求：`requirements.md` 需求 6、需求 8
  - 对应设计：`design.md` §2.3.2、§3.2.5、§3.3.6、§6.1

- [ ] 2.3 接入 AI 草稿与二次校验流程
  - 状态：TODO
  - 这一步到底做什么：实现 `commit/draft` 和 `commit` 提交编排，强制二次校验。
  - 做完你能看到什么：AI 可以帮起草，但未经二次校验不能提交。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §2.3.2、§3.3.5、§3.3.7
  - 主要改哪里：
    - `apps/host/src/modules/git/commit-orchestrator.ts`
    - `apps/host/src/modules/git/commit-draft-service.ts`
    - `apps/host/src/modules/git/git-write-service.ts`
  - 这一步先不做什么：不追求 AI 完美文案，不做模型编排平台。
  - 怎么算完成：
    1. AI 草稿返回可编辑文本
    2. 提交前执行二次校验且可阻断
  - 怎么验证：
    - 集成测试：AI 草稿 -> 修改 -> 校验 -> 提交
    - 失败测试：二次校验失败被阻断
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §2.3.2、§3.3.5、§3.3.7、§6.1

- [ ] 2.4 阶段检查：提交流程可控性检查
  - 状态：TODO
  - 这一步到底做什么：验证“规则先于生成、AI 只是草稿、二次校验必须通过”三条硬约束。
  - 做完你能看到什么：提交流程不再靠人工自觉。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md` 需求 6、需求 7、需求 8
    - `design.md` §2.3.2、§6.1
  - 主要改哪里：本阶段相关实现和测试文件
  - 这一步先不做什么：不扩展远程同步能力。
  - 怎么算完成：
    1. 规则优先链路有自动化验证
    2. AI 不能绕过规则直接提交
  - 怎么验证：
    - 端到端回放：stage -> draft -> validate -> commit
    - 规则违规回放：提交被阻断
  - 对应需求：`requirements.md` 需求 6、需求 7、需求 8
  - 对应设计：`design.md` §2.3.2、§3.3、§6.1

---

## 阶段 3：分支、历史、远程同步和收口验收

- [ ] 3.1 实现分支管理与历史分页
  - 状态：TODO
  - 这一步到底做什么：实现分支列表、创建、切换和历史分页读取。
  - 做完你能看到什么：常见分支和历史操作可在工作台完成。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3.1、§3.3.8、§3.3.9
  - 主要改哪里：
    - `apps/host/src/modules/git/branch-service.ts`
    - `apps/host/src/modules/git/history-service.ts`
    - `apps/host/src/routes/git.ts`
  - 这一步先不做什么：不做代码评审流。
  - 怎么算完成：
    1. 分支创建/切换结果可回读
    2. 历史分页稳定可用
  - 怎么验证：
    - 集成测试：branch/history 主链路
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §2.3.1、§3.3.8、§3.3.9

- [ ] 3.2 实现远程同步能力与错误映射
  - 状态：TODO
  - 这一步到底做什么：实现 fetch/pull/push/publish，统一错误返回。
  - 做完你能看到什么：用户可以完成从本地提交到远程同步的闭环。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.3、§3.3.10、§5.1
  - 主要改哪里：
    - `apps/host/src/modules/git/remote-sync-service.ts`
    - `apps/host/src/modules/git/git-command-runner.ts`
    - `apps/host/src/routes/git.ts`
  - 这一步先不做什么：不做托管 Git 平台替代能力。
  - 怎么算完成：
    1. 远程同步动作全部可调用
    2. 远程失败返回可读错误
  - 怎么验证：
    - 集成测试：fetch/pull/push
    - 异常测试：认证失败、网络失败
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.3、§3.3.10、§5

- [ ] 3.3 最终验收与文档收口
  - 状态：TODO
  - 这一步到底做什么：核对需求、设计、任务与测试证据是否一致，补齐交付文档。
  - 做完你能看到什么：这个 Spec 可交付、可交接、可追踪。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：
    - `specs/spec005-Git上下文与提交规则引擎/docs/integration.md`
    - `specs/spec005-Git上下文与提交规则引擎/docs/acceptance-checklist.md`
    - `specs/spec005-Git上下文与提交规则引擎/docs/acceptance-result.md`
  - 这一步先不做什么：不新增功能范围。
  - 怎么算完成：
    1. 关键链路有验证证据
    2. 风险和边界写清楚
    3. 后续接手人能直接继续
  - 怎么验证：
    - 按验收清单逐项核对
    - 关键测试报告归档
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
