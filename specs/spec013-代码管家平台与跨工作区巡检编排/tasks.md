# 任务清单 - spec013-代码管家平台与跨工作区巡检编排（人话版）

状态：Draft

## 这份文档是干什么的

这份清单只做一件事：把“代码管家平台”拆成真正能落地的步骤，避免最后做出一个会登记项目、却不会持续巡视；会调用 provider、却没有记忆和验证闭环的半残系统。

这份任务清单优先回答：

1. 第一阶段先把哪些地基立住
2. 哪些东西必须平台自己做，不能继续甩锅给 provider
3. MVP 到底砍到哪，才不会变成大而空
4. 哪些任务已经完成，哪些还只是规划

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：已经完成，并且已回写状态
- `CANCELLED`：取消，不做了，但必须写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻回写本文件
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 0：先把 Spec 立住，别空谈平台

- [x] 0.1 建立 `spec013` 文档骨架并锁定能力边界
  - 状态：DONE
  - 这一步到底做什么：创建 `README.md`、`requirements.md`、`design.md`、`tasks.md` 和 `docs/README.md`，把“代码管家平台”从口头设想变成正式 Spec。
  - 做完你能看到什么：`spec013` 目录完整存在，可实现性结论、技术边界、架构方向和 MVP 切分已经明确。
  - 先依赖什么：无
  - 开始前先看：
    - `spec001`
    - `spec002`
    - `spec006`
    - `spec007`
    - `spec010`
    - `spec012`
  - 主要改哪里：
    - `specs/spec013-代码管家平台与跨工作区巡检编排/*`
    - `specs/README.md`
  - 这一步先不做什么：不写实现代码，不改现有 provider 主链路。
  - 怎么算完成：
    1. `spec013` 主文档齐全
    2. 已明确平台层职责与 provider 边界
    3. 已明确 MVP 不做全自动无人值守开发
  - 怎么验证：
    - 文档自检
    - 总览索引更新
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

- [x] 0.2 明确“统一人格”和“统一文件名”不是一回事
  - 状态：DONE
  - 这一步到底做什么：把 `AGENTS.md`、`CLAUDE.md`、system prompt 注入的差异压进适配层，避免后续上层逻辑继续散落 provider 分支。
  - 做完你能看到什么：设计文档里已经明确 `InstructionAdapter` 的职责和降级规则。
  - 先依赖什么：0.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` §2.2、§6、§7
  - 主要改哪里：
    - `specs/spec013-代码管家平台与跨工作区巡检编排/design.md`
    - `specs/spec013-代码管家平台与跨工作区巡检编排/tasks.md`
  - 这一步先不做什么：不实现真实注入逻辑。
  - 怎么算完成：
    1. 已定义统一指令模型
    2. 已定义 provider 注入映射和降级规则
  - 怎么验证：
    - 文档交叉检查
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §2.2、§6、§7

- [x] 0.3 输出数据库表、服务接口和模块目录草案
  - 状态：DONE
  - 这一步到底做什么：把 `spec013` 从“原则级设计”继续往下压，补出数据库表、HTTP 接口和模块目录三份落地草案。
  - 做完你能看到什么：后续进入实现阶段时，宿主端该加哪些表、哪些路由、哪些模块文件，已经有了第一版统一蓝图。
  - 先依赖什么：0.1、0.2
  - 开始前先看：
    - `design.md` §3、§5、§8
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/routes/*`
    - `apps/host/src/modules/*`
  - 主要改哪里：
    - `specs/spec013-代码管家平台与跨工作区巡检编排/docs/README.md`
    - `specs/spec013-代码管家平台与跨工作区巡检编排/docs/20260402-数据库表草案.md`
    - `specs/spec013-代码管家平台与跨工作区巡检编排/docs/20260402-服务接口草案.md`
    - `specs/spec013-代码管家平台与跨工作区巡检编排/docs/20260402-模块目录草案.md`
  - 这一步先不做什么：不改宿主端实际代码，不提交 schema 迁移，不新增真实路由实现。
  - 怎么算完成：
    1. 已给出 butler 相关表结构建议
    2. 已给出 `/api/butler/...` 接口草案
    3. 已给出 `apps/host/src/modules/butler` 目录草案
  - 怎么验证：
    - 与现有 `schema.sql` 命名风格交叉检查
    - 与现有 `routes` 和 `modules` 目录组织方式交叉检查
  - 对应需求：`requirements.md` 需求 1、需求 4、需求 5、需求 8、需求 10、需求 11
  - 对应设计：`design.md` §3、§5、§8

---

## 阶段 1：先把项目、会话、记忆数据结构立住

- [x] 1.1 落地 `ButlerProject`、`ButlerSession`、`SessionCheckpoint` 持久化模型
  - 状态：DONE
  - 这一步到底做什么：把托管项目、托管会话和会话快照做成正式表结构与仓储接口。
  - 做完你能看到什么：平台能稳定知道“有哪些项目”“有哪些会话”“它们现在什么状态”。
  - 先依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §5.1、§5.2、§5.3
  - 主要改哪里：
    - 代码管家模块模型与仓储
    - 存储迁移脚本
  - 这一步先不做什么：不跑巡视，不跑验证。
  - 怎么算完成：
    1. 三类核心对象可持久化
    2. 会话状态和快照字段完整
  - 怎么验证：
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm --dir apps/host test -- tests/integration/butler-project-service.test.ts tests/integration/butler-session-service.test.ts`
  - 对应需求：`requirements.md` 需求 1、需求 10、需求 11
  - 对应设计：`design.md` §5

- [x] 1.2 落地 `ProjectMemory` 存储、检索与状态管理
  - 状态：DONE
  - 这一步到底做什么：把项目长期记忆做成独立表和检索服务，而不是挂在 provider 私有记忆里。
  - 做完你能看到什么：平台可以按项目和路径回灌记忆，并支持修正和归档。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3、§4.3、§5.4
  - 主要改哪里：
    - 记忆服务
    - 候选记忆确认逻辑
  - 这一步先不做什么：不做复杂向量检索平台。
  - 怎么算完成：
    1. 记忆可写入与检索
    2. 记忆带来源、置信度和状态
    3. 支持修正和归档
  - 怎么验证：
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm --dir apps/host test -- tests/integration/project-memory-service.test.ts`
  - 对应需求：`requirements.md` 需求 4、需求 9
  - 对应设计：`design.md` §4.3、§5.4、§8.6

- [ ] 1.3 阶段检查：平台是否已经有自己的权威对象模型
  - 状态：TODO
  - 这一步到底做什么：确认平台已经不再依赖 provider 自带索引来理解项目、会话和记忆。
  - 做完你能看到什么：后续接巡视、验证、执行时不会再次把状态逻辑散回 provider。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 4
    - `design.md` §2、§5
  - 主要改哪里：本阶段相关实现和测试文件
  - 这一步先不做什么：不做 UI。
  - 怎么算完成：
    1. 项目、会话、记忆对象稳定
    2. 状态读取不依赖 provider 私有内存
  - 怎么验证：
    - 集成回放
    - 评审清单
  - 对应需求：`requirements.md` 需求 1、需求 4、需求 11
  - 对应设计：`design.md` §2、§5

---

## 阶段 2：接通 provider 适配与统一指令注入

- [x] 2.1 实现 `ProviderAdapter` 注册与能力位声明
  - 状态：DONE
  - 这一步到底做什么：建立统一 provider 入口，先接 `Codex` 和 `Claude Code` 两个适配器。
  - 做完你能看到什么：上层逻辑不再直接写 provider 分支。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §3.1、§6
  - 主要改哪里：
    - provider 适配注册表
    - `codex` / `claude-code` 适配器
  - 这一步先不做什么：不接第三个 provider。
  - 怎么算完成：
    1. 适配器注册可用
    2. 能暴露能力位
    3. 上层编排不直接分支 provider
  - 怎么验证：
    - 适配器单元测试
    - 能力位对照测试
  - 对应需求：`requirements.md` 需求 2、需求 11
  - 对应设计：`design.md` §3.1、§6

- [x] 2.2 实现 `InstructionAdapter`
  - 状态：DONE
  - 这一步到底做什么：把统一规则、记忆、任务目标映射到 `Codex` 和 `Claude Code` 的启动上下文。
  - 做完你能看到什么：不同 provider 启动出来的会话都具备统一代码管家认知。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.2、§7
  - 主要改哪里：
    - 指令封装器
    - `AGENTS.md` / `CLAUDE.md` / prompt 注入映射
  - 这一步先不做什么：不要求所有 provider 原生都落同一个文件。
  - 怎么算完成：
    1. 能生成统一 `InstructionEnvelope`
    2. 能按 provider 映射注入
    3. 不支持项会有降级记录
  - 怎么验证：
    - 注入映射测试
    - 降级路径测试
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §2.2、§7

- [x] 2.3 实现会话创建、登记、续接和快照采集闭环
  - 状态：DONE
  - 最新进展（2026-04-03）：
    1. `importSession` 登记时已立即采集首个 `SessionCheckpoint`
    2. `ButlerSession.lastSummary/lastCheckpointAt` 已在登记时同步回写
    3. 巡视 run 启动后会持续回写会话快照，失败路径也会写阻塞快照
    4. 新增后续快照采样入口（按 `butlerSessionId` 手动采样并回写会话状态）
    5. 新增会话创建入口（按项目直接启动 live session 并登记为 `ButlerSession`）
    6. 新增会话续接入口（按 `butlerSessionId` 续接 provider 会话并同步快照）
    7. 新增 butler 路由集成测试覆盖 `sessions/start|resume|snapshot`
    8. 补齐 `sessions/start|resume|snapshot` 路由异常分支测试（`INVALID_INPUT`、`BUTLER_SESSION_NOT_FOUND`）并验证错误契约稳定
    9. 补齐 `sessions/start|resume` 能力缺失错误契约测试（`BUTLER_SESSION_START_UNAVAILABLE`、`BUTLER_SESSION_RESUME_UNAVAILABLE`）
  - 这一步到底做什么：把 provider 会话接入到平台 `ButlerSession` 生命周期里。
  - 做完你能看到什么：平台可以统一登记、续接和总结会话。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3
    - `design.md` §8.2
  - 主要改哪里：
    - 会话服务
    - 快照采集
    - 会话状态同步
  - 这一步先不做什么：不执行写入类任务。
  - 怎么算完成：
    1. 可创建/登记会话
    2. 可续接会话
    3. 可采集第一份和后续快照
  - 怎么验证：
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm --dir apps/host exec vitest run tests/integration/butler-session-service.test.ts tests/integration/butler-routes-session-lifecycle.test.ts`
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3
  - 对应设计：`design.md` §8.2

---

## 阶段 3：先做只读巡视闭环

- [x] 3.1 落地 `PatrolPlan` 与调度执行
  - 状态：DONE
  - 稳定性补充（2026-04-03）：
    1. 增加运行超时回收，避免 `running` 长时间悬挂阻塞后续调度
    2. 增加巡视 run 终态守卫，防止晚到回调覆盖已完成状态
  - 这一步到底做什么：为托管项目提供周期巡视计划和任务触发。
  - 做完你能看到什么：系统会按计划主动巡视项目，而不是被动等用户提问。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §5.5、§8.3
  - 主要改哪里：
    - 调度器
    - 巡视计划服务
  - 这一步先不做什么：不做跨机器调度。
  - 怎么算完成：
    1. 可创建巡视计划
    2. 到点可触发巡视执行
    3. 可记录巡视执行结果
  - 怎么验证：
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm --dir apps/host test -- tests/integration/patrol-plan-service.test.ts tests/integration/patrol-run-service.test.ts tests/integration/patrol-scheduler.test.ts`
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §8.3

- [x] 3.2 实现项目进展总结、风险提示和下一步建议
  - 状态：DONE
  - 最新进展（2026-04-03）：
    1. 巡视结构化输出新增 JSON 契约兜底解析（代码块/宽松对象/降级文本提取）
    2. 风险等级、进度状态支持从自然语言推断并保守降级
    3. 建议项与下一步动作已支持去重聚合，避免空结果
    4. 新增类 JSON 解析能力（中文字段、单引号、未加引号 key、布尔/空值与尾逗号容错）
    5. 增加纯文本降级抽取，覆盖风险分级、建议项与下一步动作去重
    6. 新增 provider 适配集成测试样本，覆盖非标准 JSON 与无 JSON 输出场景
  - 这一步到底做什么：让巡视输出可读、可决策的项目结论，而不是一堆原始日志。
  - 做完你能看到什么：每次巡视后，用户能看到项目到底推进到哪、卡在哪里、该干什么。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 6、需求 7
    - `design.md` §8.3
  - 主要改哪里：
    - 巡视总结生成器
    - 风险分级逻辑
  - 这一步先不做什么：不自动写代码。
  - 怎么算完成：
    1. 巡视输出结构化总结
    2. 风险等级明确
    3. 下一步建议可用
  - 怎么验证：
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm --dir apps/host exec vitest run tests/integration/provider-adapter-registry.test.ts`
  - 对应需求：`requirements.md` 需求 6、需求 7
  - 对应设计：`design.md` §2.4、§8.3

- [ ] 3.3 阶段检查：只读代码管家是否成立
  - 状态：TODO
  - 这一步到底做什么：确认系统已经具备“登记项目 -> 巡视项目 -> 输出总结与风险”的最小闭环。
  - 做完你能看到什么：MVP-1 的地基成立。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md` 需求 5、需求 6、需求 7
    - `design.md` §10.1
  - 主要改哪里：本阶段相关实现和测试文件
  - 这一步先不做什么：不做高风险执行。
  - 怎么算完成：
    1. 周期巡视可运行
    2. 项目总结可读
    3. 不会发生自动写入
  - 怎么验证：
    - 集成回放
    - 审计检查
  - 对应需求：`requirements.md` 需求 5、需求 6、需求 7
  - 对应设计：`design.md` §10.1

---

## 阶段 4：补上真实验证闭环

- [ ] 4.1 实现 `VerificationRunner` 基础验证能力
  - 状态：TODO
  - 这一步到底做什么：提供命令测试、健康检查和结果回写。
  - 做完你能看到什么：系统开始具备“不是只听 agent 自己说完成”的能力。
  - 先依赖什么：3.3
  - 开始前先看：
    - `requirements.md` 需求 8、需求 9
    - `design.md` §3.1、§8.5
  - 主要改哪里：
    - 验证执行器
    - 验证结果模型与回写逻辑
  - 这一步先不做什么：不接复杂外部指标平台。
  - 怎么算完成：
    1. 可跑测试与健康检查
    2. 可记录 `VerificationRun`
    3. 可把结果挂回项目与会话
  - 怎么验证：
    - 验证执行测试
    - 回写测试
  - 对应需求：`requirements.md` 需求 8、需求 9
  - 对应设计：`design.md` §5.7、§8.5

- [ ] 4.2 增加浏览器与视觉验证能力
  - 状态：TODO
  - 这一步到底做什么：让平台能运行页面交互、截图、视觉采样和结果记录。
  - 做完你能看到什么：前端项目和带界面的项目终于能被真实验证。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 8
    - `design.md` §2.3、§8.5
  - 主要改哪里：
    - 浏览器验证适配器
    - 截图产物索引
  - 这一步先不做什么：不绑定到某一个 provider 私有浏览器能力。
  - 怎么算完成：
    1. 可执行浏览器动作
    2. 可记录截图和产物
    3. 验证失败可回溯
  - 怎么验证：
    - 浏览器验证回放
    - 产物路径检查
  - 对应需求：`requirements.md` 需求 8、需求 10
  - 对应设计：`design.md` §8.5、§12

- [ ] 4.3 阶段检查：验证闭环是否可信
  - 状态：TODO
  - 这一步到底做什么：确认系统已经能把“执行结果”和“验证结果”明确区分开。
  - 做完你能看到什么：MVP-2 成立。
  - 先依赖什么：4.1、4.2
  - 开始前先看：
    - `requirements.md` 需求 8、需求 9
    - `design.md` §10.2
  - 主要改哪里：本阶段相关实现和测试文件
  - 这一步先不做什么：不做自动写入。
  - 怎么算完成：
    1. 验证记录稳定
    2. 失败不会被包装成成功
    3. 时间线可追溯
  - 怎么验证：
    - 集成测试
    - 审计检查
  - 对应需求：`requirements.md` 需求 8、需求 9、需求 10
  - 对应设计：`design.md` §10.2

---

## 阶段 5：最后才开受控执行

- [ ] 5.1 实现 `ApprovalGate`
  - 状态：TODO
  - 这一步到底做什么：把只读、受控、自动三种授权模式和风险分级真正落到系统。
  - 做完你能看到什么：平台终于知道哪些动作能做，哪些动作必须等人拍板。
  - 先依赖什么：4.3
  - 开始前先看：
    - `requirements.md` 需求 6、需求 10
    - `design.md` §9
  - 主要改哪里：
    - 授权决策服务
    - 待审批任务模型
  - 这一步先不做什么：不默认开放全自动执行。
  - 怎么算完成：
    1. 授权模式可配置
    2. 高风险动作可拦截
    3. 审批结果可审计
  - 怎么验证：
    - 风险分级测试
    - 拦截路径测试
  - 对应需求：`requirements.md` 需求 6、需求 10
  - 对应设计：`design.md` §9

- [ ] 5.2 实现受控执行与结果/记忆回写
  - 状态：TODO
  - 这一步到底做什么：在授权通过后，让平台可以调 agent 真正推进开发任务，并把结果沉淀回项目。
  - 做完你能看到什么：MVP-3 的最小闭环成立。
  - 先依赖什么：5.1
  - 开始前先看：
    - `requirements.md` 需求 6、需求 9
    - `design.md` §8.4、§8.6
  - 主要改哪里：
    - 执行编排器
    - 结果回写
    - 候选记忆生成
  - 这一步先不做什么：不自动合并代码。
  - 怎么算完成：
    1. 授权后可执行任务
    2. 结果与验证可回写
    3. 可生成候选记忆
  - 怎么验证：
    - 执行链路回放
    - 记忆候选生成测试
  - 对应需求：`requirements.md` 需求 6、需求 9
  - 对应设计：`design.md` §8.4、§8.6、§10.3

---

## 当前 MVP 结论

- `MVP-1`：先做只读代码管家，先让系统会看、会记、会总结
- `MVP-2`：再补真实验证，让系统会证伪，不再靠嘴
- `MVP-3`：最后再放开受控执行，让系统在闸门内替用户推进开发

别反过来做。

如果一开始就追“全自动开发”，最后只会得到一个能到处乱跑、还不会验证自己的问题制造机。
