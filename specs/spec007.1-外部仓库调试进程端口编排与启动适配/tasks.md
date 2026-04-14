# 任务清单 - spec007.1 外部仓库调试进程端口编排与启动适配（人话版）

状态：Draft

## 2026-04-13 进展补记

- 已确认 `spec007.1` 处理的是“外部仓库调试运行时编排”，不是本仓库自己的开发端口
- 已确认主路径不是 AI 改源码，而是“启动适配 + 端口租约 + 最后兜底 AI”
- 已确认第一阶段不考虑 Docker、不考虑操作系统级隔离网络，只走跨平台方案
- 已确认必须先做项目框架分析，只有兼容框架才自动开启端口注入
- 已补最小 `launch-plan` / `run` 主链路：可先生成租约与绑定，再把允许自动启动的目标接进现有 Host 终端执行链路

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并已回写
- `CANCELLED`：取消并写明原因

规则：

- 只有 `状态：DONE` 的任务才能勾成 `[x]`
- 每做完一个任务，都要立刻回写本文件
- `BLOCKED` 和 `CANCELLED` 必须写明原因

---

## 阶段 0：先把边界钉死，别让这个 spec 变成万能垃圾桶

- [x] 0.1 新建 `spec007.1` 文档骨架
  - 状态：DONE
  - 这一步到底做什么：建立 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`
  - 做完以后能看到什么结果：仓库里出现独立的 `spec007.1` 目录，边界清楚，不再把“进程底座”和“外部仓库调试编排”混写
  - 依赖什么：无
  - 主要改哪些文件：
    - `specs/spec007.1-外部仓库调试进程端口编排与启动适配/*`
  - 这一步先不做什么：不改实现代码
  - 怎么验证：
    - 文档走查

- [x] 0.2 回写 specs 总览与 `spec007` 关系说明
  - 状态：DONE
  - 这一步到底做什么：让目录总览和 `spec007` README 都明确知道 `007.1` 是下层运行时编排子规格
  - 做完以后能看到什么结果：接手的人不会再把 `007` 和 `007.1` 看成一件事
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec007-进程管理与启动器/README.md`
  - 这一步先不做什么：不展开实现设计
  - 怎么验证：
    - 文档走查

- [x] 0.3 补充框架分析准入规则与兼容矩阵文档
  - 状态：DONE
  - 这一步到底做什么：把“先分析框架，再决定要不要自动注入端口”写进主规格，并补一份可直接查的框架兼容矩阵
  - 做完以后能看到什么结果：实现侧和产品侧都能明确知道哪些框架自动支持、推荐怎么注入、哪些要额外处理服务发现/HMR、哪些直接进入 AI 兜底或拒绝自动注入
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `specs/spec007.1-外部仓库调试进程端口编排与启动适配/requirements.md`
    - `specs/spec007.1-外部仓库调试进程端口编排与启动适配/design.md`
    - `specs/spec007.1-外部仓库调试进程端口编排与启动适配/tasks.md`
    - `specs/spec007.1-外部仓库调试进程端口编排与启动适配/docs/20260413-框架兼容矩阵.md`
  - 这一步先不做什么：不补实现代码
  - 怎么验证：
    - 文档走查

- [x] 0.4 补充实现清单文档
  - 状态：DONE
  - 这一步到底做什么：把新增表、分析 API、前端展示和 `LauncherProfile / ProcessInstance` 扩展字段压到“可以直接拆实现任务”的层级
  - 做完以后能看到什么结果：后续开发不再只拿着原则文档空想，可以直接按清单落库、开接口、补前端面板
  - 依赖什么：0.3
  - 主要改哪些文件：
    - `specs/spec007.1-外部仓库调试进程端口编排与启动适配/docs/20260413-实现清单.md`
    - `specs/spec007.1-外部仓库调试进程端口编排与启动适配/docs/README.md`
    - `specs/spec007.1-外部仓库调试进程端口编排与启动适配/design.md`
    - `specs/spec007.1-外部仓库调试进程端口编排与启动适配/tasks.md`
  - 这一步先不做什么：不直接改实现代码
  - 怎么验证：
    - 文档走查

---

## 阶段 1：先把统一数据模型立住

- [x] 1.1 定义调试目标、框架分析、服务、运行时、端口租约五类核心模型
  - 状态：DONE
  - 这一步到底做什么：把“外部仓库调试运行时”拆成稳定对象，尤其先把框架分析结果正式建模，避免后面所有逻辑都围着字符串命令乱转
  - 做完以后能看到什么结果：后端和前端都能基于同一套 DTO 说清楚“这是什么框架、能不能自动注入、谁在跑、占了什么端口、属于哪个服务”
  - 依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §4
  - 主要改哪些文件：
    - Host domain types
    - 框架分析仓储
    - 调试目标仓储
    - 运行时与端口租约仓储
  - 这一步先不做什么：不接 AI
  - 怎么算完成：
    1. 五类核心模型字段稳定
    2. 字段归属和状态流转说得清
  - 怎么验证：
    - `tests/integration/debug-target-repositories.test.ts`
    - `tests/integration/sqlite-bootstrap.test.ts`
    - DTO 对照检查
  - 本次落地补记：
    - 已新增 `debug_targets`、`debug_services`、`framework_analysis_results`、`debug_runtime_sessions`、`port_leases`、`runtime_bindings`、`ai_fallback_edits`
    - 已在 Host domain types 和 repository 层补齐 `DebugTargetProfile / DebugServiceSpec / FrameworkAnalysisResult / DebugRuntimeSession / RuntimeBinding / PortLeaseRecord / AiFallbackEditRecord`

- [x] 1.2 明确和 `spec007` 进程模型的关系
  - 状态：DONE
  - 这一步到底做什么：把 `ProcessInstance` 和 `DebugRuntimeSession` 的关系钉死，避免一套状态写两遍
  - 做完以后能看到什么结果：底层进程记录和上层调试运行时能互相映射，不互相抢职责
  - 依赖什么：1.1
  - 开始前先看：
    - `design.md` §3.2
    - `design.md` §4.3、§4.4
  - 主要改哪些文件：
    - 进程领域映射层
    - 运行时绑定服务
  - 这一步先不做什么：不重写现有进程服务
  - 怎么算完成：
    1. 上下层关系明确
    2. 不产生重复真相源
  - 怎么验证：
    - `tests/integration/debug-launcher-process-bridge.test.ts`
    - 设计走查
  - 本次落地补记：
    - 现仓库尚无独立 `LauncherProfile / ProcessInstance` 进程域实现，本轮按最小可行修正落在现有 `terminal_command_templates / terminal_instances`
    - 已把调试目标、服务、分析、运行时的关联字段接到现有 Host 运行模型，避免等完整 spec007 进程域落地前阻塞 spec007.1

- [x] 1.4 扩展 `LauncherProfile / ProcessInstance` 关联字段
  - 状态：DONE
  - 这一步到底做什么：把 `spec007` 的底层启动配置和进程实例正式接到 `spec007.1` 的调试目标、服务、运行时链路上
  - 做完以后能看到什么结果：运行态和配置态不再脱节，前端可以顺着配置和进程一路看到调试目标与服务语义
  - 依赖什么：1.1、1.2
  - 开始前先看：
    - `docs/20260413-实现清单.md` §7、§8
  - 主要改哪些文件：
    - `LauncherProfile` 数据结构
    - `ProcessInstance` 数据结构
    - 相关仓储与 DTO
  - 这一步先不做什么：不替换现有进程主状态机
  - 怎么验证：
    - `tests/integration/debug-launcher-process-bridge.test.ts`
    - `tests/integration/sqlite-bootstrap.test.ts`
  - 本次落地补记：
    - `terminal_command_templates` 已补 `sourceType / debugTargetId / debugServiceId / frameworkAnalysisId / adapterKind / injectionMode / generatedArtifactRef / serviceDiscoveryMode / managedBySystem`
    - `terminal_instances` 已补 `debugRuntimeSessionId / debugTargetId / debugServiceId / frameworkAnalysisId / launcherSourceType / launchStage / failureStage / adapterKind / envPatchSummary / artifactRef`
    - 因现有 `terminal_instances.runtimeSessionId` 已用于终端运行时，会与 spec 文档中的 `runtimeSessionId` 语义冲突，所以本轮采用 `debugRuntimeSessionId` 作为最小可行修正字段名

- [ ] 1.3 阶段检查：模型边界是否站稳
  - 状态：TODO
  - 这一步到底做什么：检查是不是已经把“服务对象”“运行时对象”“进程对象”分清了
  - 做完以后能看到什么结果：进入适配器设计时不返工
  - 依赖什么：1.1、1.2
  - 主要改哪些文件：本阶段文档与类型定义
  - 这一步先不做什么：不提前接路由
  - 怎么验证：
    - 评审清单
    - 文档对照

---

## 阶段 2：把启动适配器链路设计清楚

- [x] 2.1 建立适配器注册表与优先级规则
  - 状态：DONE
  - 这一步到底做什么：把 `框架分析 -> CLI -> ENV -> Override -> AI` 这条链路做成固定顺序，不允许实现时随意跳层
  - 做完以后能看到什么结果：每个服务启动前都能明确知道是否允许自动注入、先试哪一层、失败后怎么降级
  - 依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3
    - `design.md` §5
  - 主要改哪些文件：
    - 框架分析结果与准入判定
    - 适配器注册表
    - 识别结果与启动计划类型
  - 这一步先不做什么：不做具体框架适配器细节
  - 怎么算完成：
    1. 适配器顺序固定
    2. 降级条件清楚
  - 怎么验证：
    - 适配决策测试
  - 本次落地补记：
    - 已新增 `launch-adapter-registry.ts`
    - 当前固定顺序为 `cli -> env -> override -> ai_fallback`
    - `launch-plan` 已显式返回 `adapterAttempts / adapterKind / failureStage / artifactRef / aiFallback`
    - 自动运行准入已收敛为：仅 `supported / conditional` 且无额外处理缺口时允许继续进入 `run`

- [x] 2.2 落地第一批技术栈适配器
  - 状态：DONE
  - 这一步到底做什么：优先覆盖第一阶段承诺的常见前端、Node、JVM、Python 单服务项目，并根据兼容矩阵给出推荐注入方式和额外处理要求
  - 做完以后能看到什么结果：平台不是只有抽象接口，而是真的能识别框架、判定兼容等级并生成启动计划
  - 依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §8.1
  - 主要改哪些文件：
    - 技术栈识别器
    - CLI/ENV/Override 适配器实现
  - 这一步先不做什么：不追求全技术栈覆盖
  - 怎么算完成：
    1. 至少覆盖第一阶段列出的常见项目
    2. 不支持的场景能明确报未适配
  - 怎么验证：
    - 示例仓库集成测试
  - 本次落地补记：
    - 第一版已落地轻量识别与兼容矩阵判定，覆盖常见前端、Node、JVM、Python 单服务场景
    - 已纳入 `vite / nextjs / cra / astro / nuxt / vue-cli / spring-boot / uvicorn / flask / django / rails / aspnet-core / nestjs / express / koa / hono / laravel / remix`
    - 对 `electron / tauri / go-http / unknown` 已明确给出不自动注入或未知结论，不再含糊处理

- [x] 2.3 阶段检查：适配链路是否可解释
  - 状态：DONE
  - 这一步到底做什么：确保启动失败时能说清楚失败在哪一层，而不是只返回“端口冲突”
  - 做完以后能看到什么结果：用户和维护者都能看懂平台为什么这么决策
  - 依赖什么：2.2
  - 怎么验证：
    - 失败路径回放
    - 错误信息走查
  - 本次落地补记：
    - 启动计划已经把失败位置显式落在 `failureStage`
    - 适配器选择与阻断原因已经落在 `adapterAttempts`
    - `GET /api/debug-runtimes/:runtimeId` 和 `GET /api/debug-targets/:targetId/runtime-latest` 都能把最新运行态与失败阶段返回给前端

- [x] 2.4 落地框架分析结果 API 和兼容矩阵 API
  - 状态：DONE
  - 这一步到底做什么：把分析结果从内部判断变成正式接口，让前端和调试面板都能直接消费
  - 做完以后能看到什么结果：用户能看到“识别成什么框架、为什么支持或不支持、推荐如何注入”
  - 依赖什么：2.2
  - 开始前先看：
    - `docs/20260413-实现清单.md` §4
  - 主要改哪些文件：
    - 分析控制器
    - 分析路由
    - 兼容矩阵查询接口
  - 这一步先不做什么：不先做完整运行页
  - 怎么验证：
    - `tests/integration/debug-target-routes.test.ts`
  - 本次落地补记：
    - 已落地 `POST /api/debug-targets/analyze`
    - 已落地 `GET /api/debug-targets/:targetId/framework-analysis`
    - 已落地 `POST /api/debug-targets/:targetId/framework-analysis/refresh`
    - 已落地 `GET /api/framework-compatibility-matrix`
    - 当前分析器是第一版轻量文件探测器，重点先保证接口结构、兼容矩阵准入和持久化模型站住

---

## 阶段 3：把端口租约和回收机制做实

- [x] 3.1 建立端口租约仓储与分配器
  - 状态：DONE
  - 这一步到底做什么：让端口分配不再靠临时扫描和猜数字，而是有正式租约记录
  - 做完以后能看到什么结果：每个调试服务申请过哪些端口、当前占的是哪一个，都能查出来
  - 依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §6
  - 主要改哪些文件：
    - 端口租约服务
    - 仓储与冲突检查逻辑
  - 这一步先不做什么：不做分布式锁
  - 怎么验证：
    - `tests/integration/debug-target-routes.test.ts`
    - `tests/integration/debug-target-repositories.test.ts`
  - 本次落地补记：
    - 已补 `PortLeaseRepository.findActiveByPort`
    - 已在 `DebugTargetService.createLaunchPlan()` 中落地最小端口分配器，按服务角色从受管端口段分配
    - 已在分配前同时检查受管租约冲突和宿主机端口占用
    - 已落地 `POST /api/debug-targets/:targetId/launch-plan`，生成 `debug_runtime_sessions`、`port_leases`、`runtime_bindings`

- [x] 3.2 实现释放、续租和脏租约回收
  - 状态：DONE
  - 这一步到底做什么：把“进程正常结束”“启动失败”“平台异常退出”三种回收路径补齐
  - 做完以后能看到什么结果：端口不会越跑越脏
  - 依赖什么：3.1
  - 怎么验证：
    - `tests/integration/debug-target-routes.test.ts`
  - 本次落地补记：
    - 已在 `run` 失败路径中把 `runtime_bindings` 标记失败，并把租约释放为 `RELEASED`
    - 已订阅现有 `terminalService` 的 `exit` 事件，终端正常关闭后会把对应绑定释放，并把运行时状态收敛为 `STOPPED`
    - 已实现查询时对账：`GET /api/debug-runtimes/:runtimeId` 会对缺失进程实例的活跃租约做对账，先标记 `STALE`，再把运行时标记为 `FAILED`
    - 已补独立后台巡检任务，接入现有 `TaskManager` 与 scheduler；不依赖查询接口，也会自动扫描 `PREPARING / RUNNING` 运行时和已有 `STALE` 租约
    - 已在 Host 启动阶段补一次冷启动恢复检查，`app.ready()` 前会主动跑 runtime 巡检，处理上次异常退出留下的脏租约
    - 后台巡检会把缺失进程实例留下的脏租约从 `STALE` 收口到 `RELEASED`，避免端口长期卡死
    - 当前三条回收路径已经齐了：事件驱动释放、查询时对账、后台巡检回收

- [ ] 3.3 阶段检查：端口租约是否真的闭环
  - 状态：IN_REVIEW
  - 这一步到底做什么：检查租约有没有真正贯穿启动、运行、停止、恢复
  - 做完以后能看到什么结果：可以进入 AI 兜底收口阶段
  - 依赖什么：3.2
  - 怎么验证：
    - 主链路回放
  - 当前检查结论：
    - 启动阶段：`launch-plan` 已创建租约和运行时绑定
    - 运行阶段：`run` 已把运行时接进现有 Host 终端执行链路
    - 停止阶段：终端 `exit` 事件会释放租约并收敛运行态
    - 恢复阶段：查询时对账、后台巡检、Host 冷启动检查都会发现缺失进程实例，并清理脏租约
    - 还没做的风险点：更复杂的 Host 崩溃恢复、跨重启继续追踪真实外部进程，这部分还不能算完成

---

## 阶段 4：把 AI 兜底收严，不准乱改代码

- [x] 4.1 定义 AI 兜底准入条件和候选文件收敛规则
  - 状态：DONE
  - 这一步到底做什么：写死什么情况下允许 AI 介入，什么情况下必须直接拒绝
  - 做完以后能看到什么结果：AI 不会因为“看起来也许能改”就闯进仓库乱改
  - 依赖什么：3.3
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §7.1、§7.2
  - 主要改哪些文件：
    - AI 兜底编排器
    - 允许编辑文件筛选器
  - 这一步先不做什么：不追求自动修好所有启动问题
  - 怎么验证：
    - 准入判定测试
  - 本次落地补记：
    - 第一版只在条件支持框架且现有注入手段不可靠时进入 `ai_fallback`
    - 当前已对 Express 等硬编码端口场景生成受限 AI 兜底记录
    - 候选文件已收敛到分析器明确识别出的少量源码文件，例如 `server.js`
    - `unsupported / unknown` 不会直接借 AI 越权自动放行

- [x] 4.2 落地补丁记录、回滚记录和提交前阻断
  - 状态：DONE
  - 这一步到底做什么：让 AI 改动变成受控临时补丁，而不是混进正常开发提交
  - 做完以后能看到什么结果：用户知道改了什么，也能撤回
  - 依赖什么：4.1
  - 怎么验证：
    - 回滚测试
    - 提交前阻断测试
  - 本次落地补记：
    - 已落地 `ai_fallback_edits` 存储与 repository
    - 已落地 `POST /api/ai-fallback-edits/:editId/apply`
    - 已落地 `POST /api/ai-fallback-edits/:editId/reject`
    - 已落地 `POST /api/ai-fallback-edits/:editId/rollback`
    - `CommitOrchestrator` 已在提交前阻断 `PENDING / APPLIED` 状态的 AI 兜底记录

- [x] 4.3 阶段检查：AI 是否被关进笼子
  - 状态：DONE
  - 这一步到底做什么：确认 AI 只剩兜底职责，没有越权变成默认主路径
  - 做完以后能看到什么结果：第一阶段边界完整
  - 依赖什么：4.2
  - 怎么验证：
    - 规则复核
    - 风险清单走查
  - 本次落地补记：
    - AI 仍然不是主路径，当前只承担“记录、准入、阻断、状态流转”
    - `run` 在需要 AI 兜底时会直接返回 `409 DEBUG_TARGET_AI_FALLBACK_REQUIRED`
    - 本轮没有实现 AI 自动改源码本身，符合第一阶段边界

---

## 阶段 5：第一阶段交付收口

- [x] 5.1 明确第一阶段支持列表和不支持列表
  - 状态：DONE
  - 这一步到底做什么：把“能跑什么”“推荐怎么注入”“是否要额外处理前后端发现/HMR”“哪些场景必须走 AI 兜底或直接拒绝”写死到文档和产品提示里
  - 做完以后能看到什么结果：不会再拿未支持项目去碰运气，兼容策略也不靠口头约定
  - 依赖什么：4.3
  - 怎么验证：
    - 文档走查
    - UI 提示核对
  - 本次落地补记：
    - 支持与不支持列表已经固化在 `docs/20260413-框架兼容矩阵.md`
    - Host 已通过 `GET /api/framework-compatibility-matrix` 暴露给前端
    - 工作区详情页已补最小“调试准备”卡片，能直接显示兼容等级、推荐注入方式和 AI 兜底策略

- [x] 5.2 前端落地兼容矩阵页面或调试面板
  - 状态：DONE
  - 这一步到底做什么：把框架分析结果、兼容矩阵、运行时绑定和失败阶段放进用户能看懂的面板里
  - 做完以后能看到什么结果：用户不再只看到“启动失败”，而是知道为什么失败、当前框架支不支持、需要补什么条件
  - 依赖什么：2.4、3.3
  - 开始前先看：
    - `docs/20260413-实现清单.md` §6
  - 主要改哪些文件：
    - 工作区管理相关页面
    - 调试目标详情面板
    - 兼容矩阵说明弹层
  - 这一步先不做什么：不做复杂可视化编排图
  - 怎么验证：
    - 前端组件测试
    - 交互走查
  - 本次落地补记：
    - 已在 `WorkspaceDetailPage` 增加最小“调试准备”卡片
    - 页面进入后会自动触发 `analyzeDebugTarget`，并读取 `getLatestDebugRuntime`
    - 当前可显示主框架、置信度、兼容等级、推荐注入方式、服务发现/HMR/callback 要求、AI 兜底策略、最新运行态和失败阶段
    - 已补 `WorkspaceDetailPage.test.tsx` 回归测试

- [ ] 5.3 准备第一阶段验收样本仓库
  - 状态：TODO
  - 这一步到底做什么：为常见前端、Node、JVM、Python 项目准备最小验收样本
  - 做完以后能看到什么结果：后续每次改适配器都能回归
  - 依赖什么：5.1
  - 怎么验证：
    - 样本仓库回放测试

- [ ] 5.4 最终检查点
  - 状态：TODO
  - 这一步到底做什么：核对需求、设计、任务和验收样本是否闭合
  - 做完以后能看到什么结果：`spec007.1` 可以进入实现，不留结构性歧义
  - 依赖什么：5.2、5.3
  - 怎么验证：
    - 验收清单逐项核对
    - 文档与任务映射复核
