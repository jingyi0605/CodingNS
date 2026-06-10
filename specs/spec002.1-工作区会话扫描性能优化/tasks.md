# 任务清单 - spec002.1 工作区会话扫描性能优化（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单不是为了凑格式，而是为了把“工作区会话扫描优化”拆成真的能做的步骤。

它优先回答这些问题：

1. 先砍哪块，才能最快止住 CPU 浪费
2. 哪些是基础设施，不做后面全是空话
3. 哪些改动是读写边界，哪些是 provider 策略
4. 怎么验证不是又写出一套新的散装后台任务

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等待复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻更新本文件
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 0：先把问题坐实，再把方案写成正式 Spec

- [x] 0.1 查明 CPU 高占用的真实热点和错误触发面
  - 状态：DONE
  - 这一步到底做什么：确认 Host 端 CPU 高占用是不是工作区会话 discovery 导致的，并把 removed 工作区混入扫描这件事坐实。
  - 做完你能看到什么：已经确认热点任务是 `workspace.discovery` / `workspace.discovery_scan`，并且观测里出现了 removed 的旧工作区继续被扫。
  - 先依赖什么：无
  - 开始前先看：
    - runtime 观测接口输出
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/workbench/workbench-service.ts`
  - 主要改哪里：
    - `specs/spec002.1-工作区会话扫描性能优化/requirements.md`
    - `specs/spec002.1-工作区会话扫描性能优化/design.md`
  - 这一步先不做什么：不开始实现代码修复。
  - 怎么算完成：
    1. 已明确主要 CPU 热点任务
    2. 已明确 removed 工作区参与 discovery 是真实问题
    3. 已明确当前缓存缺的是来源索引，而不是简单再加一层 session list cache
  - 怎么验证：
    - 人工走查排查记录
    - 对照 runtime 观测与数据库状态
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 7
  - 对应设计：`design.md` §1.4、§2

- [x] 0.2 建立 spec002.1 初稿并锁定优化边界
  - 状态：DONE
  - 这一步到底做什么：把“门禁、来源索引、归档对齐、调度预算、观测持久化”写成正式 Spec，避免后续实现时范围漂移。
  - 做完你能看到什么：`README.md`、`requirements.md`、`design.md`、`tasks.md` 和 `docs/README.md` 已建立，优化方向不再只是口头讨论。
  - 先依赖什么：0.1
  - 开始前先看：
    - `spec001.2`
    - `spec001.2.1`
    - `spec002`
    - `spec010.1`
  - 主要改哪里：
    - `specs/spec002.1-工作区会话扫描性能优化/*`
    - `specs/README.md`
  - 这一步先不做什么：不直接修改 Host 和 provider 实现代码。
  - 怎么算完成：
    1. Spec 主文档齐全
    2. 已明确“不做全 provider SQLite-first”
    3. 已明确任务分阶段推进方式
  - 怎么验证：
    - 文档自检
    - Spec 目录结构检查
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

---

## 阶段 1：先把最蠢的 CPU 浪费砍掉

- [ ] 1.1 给 removed 工作区加 discovery 硬门禁
  - 状态：DONE
  - 这一步到底做什么：在 `requestWorkspaceDiscovery()`、`discoverWorkspaceSessions()`、workbench 后台刷新入口加 removed 工作区判断，正常链路直接挡掉。
  - 做完你能看到什么：removed 工作区不会再被 workbench 常规刷新和普通 session 读链路拖进 discovery。
  - 先依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.1.1、§3.3.1、§6.2
    - `spec001.2.1` 关于“读接口只读、刷新显式入口”的规则
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/workbench/workbench-service.ts`
    - `apps/host/src/storage/repositories/workspace-repository.ts`
  - 这一步先不做什么：不顺手实现来源索引，不改 provider 细节。
  - 怎么算完成：
    1. removed 工作区不会创建新的常规 discovery 任务
    2. 读接口对 removed 工作区返回明确结果或错误，不再暗中重扫
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-history-service.test.ts`
    - 人工检查入口逻辑：removed 工作区在 `requestWorkspaceDiscovery()` 和 `discoverWorkspaceSessions()` 前就被挡掉
  - 对应需求：`requirements.md` 需求 1、需求 6
  - 对应设计：`design.md` §3.3.1、§6.2、§7.1

- [ ] 1.2 把工作区 discovery 状态补成统一状态模型
  - 状态：DONE
  - 这一步到底做什么：把现在散在 `workspaceDiscoveryStatuses` 里的状态补齐成真正可用的 `fresh/stale/running/cooldown/failed + dirtyReasons` 模型。
  - 做完你能看到什么：当前工作区为什么会重扫、为什么没重扫、是不是在冷却期，都能从一个地方看懂。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 5、需求 6
    - `design.md` §4.2.3、§5.2
    - `spec001.2.1` §2.3 刷新状态模型
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/tasks/task-types.ts`（如需补观测字段或辅助类型）
  - 这一步先不做什么：不引入新的私有 timer/retry queue。
  - 怎么算完成：
    1. discovery 有统一状态字段
    2. 重复触发时只合并脏原因，不重复并发开跑
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-history-service.test.ts`
    - 检查 `workspaceDiscoveryStatuses` 已记录 `phase / dirtyReasons / lastRequestedAt / lastStartedAt / lastCompletedAt / lastFailedAt / runningTaskId`
  - 对应需求：`requirements.md` 需求 5、需求 6
  - 对应设计：`design.md` §4.2.3、§5.2

- [ ] 1.3 阶段检查：先止血，不扩新范围
  - 状态：DONE
  - 这一步到底做什么：检查 removed 工作区门禁和 discovery 状态机是不是已经站住，避免一边补缓存一边基础边界还在漏。
  - 做完你能看到什么：后续可以安全进入来源索引改造，而不是在错误触发面上继续堆代码。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关文件
  - 这一步先不做什么：不开始 provider 大改造。
  - 怎么算完成：
    1. removed 工作区门禁已生效
    2. discovery 状态机能解释任务触发行为
  - 怎么验证：
    - 人工走查
    - `pnpm --dir apps/host test tests/integration/session-history-service.test.ts`
  - 对应需求：`requirements.md` 需求 1、需求 5、需求 6
  - 对应设计：`design.md` §2.1.1、§4.2.3、§5.2

---

## 阶段 2：把“扫过一次就记住”真正做出来

- [ ] 2.1 新增来源索引表、仓储和迁移
  - 状态：DONE
  - 这一步到底做什么：新增 `session_source_index` 和 `session_discovery_diagnostics` 的 schema、仓储和最小迁移入口。
  - 做完你能看到什么：Host 有地方记住来源指纹、归属摘要和每轮 discovery 诊断数据。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 7
    - `design.md` §4.2.1、§4.2.2、§5.1
    - SQLite 使用规则
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/sqlite/client.ts`
    - `apps/host/src/storage/repositories/session-source-index-repository.ts`
    - `apps/host/src/storage/repositories/session-discovery-diagnostics-repository.ts`
    - `apps/host/src/types/domain.ts`
  - 这一步先不做什么：不改 provider 解析逻辑，只把存储地基搭好。
  - 怎么算完成：
    1. 新表可读写
    2. schema 与迁移兼容现有库
    3. 没有引入 `node:sqlite`
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/sqlite-bootstrap.test.ts tests/integration/session-source-index-repository.test.ts`
    - `pnpm check:sqlite-runtime`
  - 对应需求：`requirements.md` 需求 2、需求 7
  - 对应设计：`design.md` §4.2.1、§4.2.2、§5.1

- [x] 2.2 重写 discovery 主链路为“轻量枚举 + 局部重验”
  - 状态：DONE
  - 这一步到底做什么：让 provider discovery 先做来源枚举和指纹比对，只对变化来源或冲突来源做重验。
  - 做完你能看到什么：未变化来源的 discovery 不再全文解析，`parsedFiles` 明显下降。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` §3.3.2、§4.4.3、§4.4.4、§7.2
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/tests/integration/session-history-service.test.ts`
  - 这一步先不做什么：不同时做所有 provider 的 archive sync 细化。
  - 怎么算完成：
    1. Host 传给 provider 的 `knownSessions` 不再只来自当前工作区 session index，而是合并 `session_source_index`
    2. provider 现有的 `mtime/size` 快速跳过逻辑能命中来源索引里的旧指纹
    3. discovery 完成后会把最新来源摘要回写到 `session_source_index`
    4. 本轮 provider diagnostics 会先落到 `session_discovery_diagnostics`
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-history-service.test.ts tests/integration/session-source-index-repository.test.ts tests/integration/sqlite-bootstrap.test.ts`
    - `pnpm check:sqlite-runtime`
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §3.3.2、§4.4.3、§4.4.4、§7.2

- [x] 2.3 给 Codex / OpenCode / Claude Code 补 provider 分层策略
  - 状态：DONE
  - 这一步到底做什么：先把 CPU 最敏感的几家 provider 分层处理好，明确谁优先读结构化来源，谁继续 file-first 但接入来源索引。
  - 做完你能看到什么：不是所有 provider 都一刀切，而是每家都按真实来源走最快可信路径。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §4.3
    - 各 provider 当前 discovery 实现
  - 主要改哪里：
    - `packages/session-sync-core/src/providers/codex.ts`
    - `packages/session-sync-core/src/providers/opencode.ts`
    - `packages/session-sync-core/src/providers/claude-session-store.ts`
    - `packages/session-sync-core/tests/codex-adapter.test.mjs`
    - `packages/session-sync-core/tests/opencode-adapter.test.mjs`
    - `packages/session-sync-core/tests/claude-paths.test.mjs`
  - 这一步先不做什么：不为了统一而牺牲 provider 特性，不重写消息历史读取。
  - 怎么算完成：
    1. Codex 不再默认全扫 `sessions/`，优先使用 thread metadata + knownSessions 收敛 active transcript 集合；只有 metadata 缺口或 knownSessions 可疑时才退回全量目录扫描
    2. OpenCode 继续 server/sqlite-first，但 sqlite 兜底查询改成按 `workspace directory` 定向，不再全表查完再过滤
    3. Claude Code 继续 file-first，但当精确项目目录已经有真实 transcript 时，不再顺手全扫整个 `projects/` 根目录；只有精确目录为空、全空或中文路径回退场景才扩大扫描
  - 怎么验证：
    - `pnpm --dir packages/session-sync-core build`
    - `node --test packages/session-sync-core/tests/codex-adapter.test.mjs`
    - `node --test packages/session-sync-core/tests/claude-paths.test.mjs packages/session-sync-core/tests/opencode-adapter.test.mjs`
    - `pnpm --dir apps/host test tests/integration/session-history-service.test.ts tests/integration/session-source-index-repository.test.ts tests/integration/sqlite-bootstrap.test.ts`
    - `pnpm check:sqlite-runtime`
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §4.3

- [ ] 2.4 持久化 diagnostics，并把字段接到现有观测链路
  - 状态：DONE
  - 这一步到底做什么：把当前 providerDiagnostics 从临时日志升级成可落库、可比较、可回放的数据。
  - 做完你能看到什么：下次再查 CPU 异常时，不用只盯实时日志，可以按工作区/provider 比较历史扫描量。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §4.2.2、§6.2
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/storage/repositories/session-discovery-diagnostics-repository.ts`
    - 相关 observability DTO / route（如存在）
  - 这一步先不做什么：不做复杂图表前端。
  - 怎么算完成：
    1. 本轮 discovery 关键指标会落库
    2. 诊断数据能定位到 workspaceId + provider + trigger_source
    3. `/api/observability/runtime` 传 `workspaceId` 后能看到最近 discovery diagnostics
    4. diagnostics 落盘失败不会拖垮正常 discovery 主流程
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/observability-routes.test.ts tests/integration/session-history-service.test.ts`
    - 人工检查 `/api/observability/runtime?sessionId=...&workspaceId=...` 返回的 `workspaceDiscoveryDiagnostics`
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §4.2.2、§6.2

- [ ] 2.5 阶段检查：来源索引已经真的接管主流程
  - 状态：DONE
  - 这一步到底做什么：检查 discovery 现在是不是已经从“反复全文扫描”切到了“指纹命中 + 局部重验”。
  - 做完你能看到什么：不是只加了表，而是真的把 CPU 热点砍下来了。
  - 先依赖什么：2.1、2.2、2.3、2.4
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关文件
  - 这一步先不做什么：不加新 provider，不扩 UI。
  - 怎么算完成：
    1. 未变化来源的 `parsedFiles` 明显下降
    2. 诊断数据可解释每轮扫描成本
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-discovery-diagnostics.test.ts`
    - `pnpm --dir apps/host test tests/integration/observability-routes.test.ts`
    - `pnpm --dir apps/host test tests/integration/session-history-service.test.ts`
    - provider fixture 回放对照第二轮 `parsedFiles <= 第一轮 parsedFiles`，且至少一个 provider 的 `skippedByFingerprint > 0`
  - 对应需求：`requirements.md` 需求 2、需求 4、需求 7
  - 对应设计：`design.md` §3.3.2、§4.3、§7.2

---

## 阶段 3：把调度、修复和验收做稳

- [ ] 3.1 给 workbench discovery 加优先级、预算和冷工作区策略
  - 状态：DONE
  - 这一步到底做什么：让当前可见工作区、最近访问工作区和明确变脏工作区优先刷新，冷工作区降频处理，并给单轮 discovery 加预算。
  - 做完你能看到什么：CPU 不会平均浪费给一堆没人看的工作区。
  - 先依赖什么：2.5
  - 开始前先看：
    - `requirements.md` 需求 5、需求 6
    - `design.md` §3.3.1、§5.2
  - 主要改哪里：
    - `apps/host/src/modules/workbench/workbench-service.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
  - 这一步先不做什么：不新长私有调度器，不把预算做成散装定时器。
  - 怎么算完成：
    1. workbench 优先刷新可见/热工作区
    2. 冷工作区明显降频
    3. 单轮扫描不会无上限扩张
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/workbench-service.test.ts tests/integration/session-history-service.test.ts`
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm check:sqlite-runtime`
    - 人工检查 workbench 刷新只会挑出预算内工作区，且冷工作树拿到更大的 `maxAgeMs`
  - 对应需求：`requirements.md` 需求 5、需求 6
  - 对应设计：`design.md` §3.3.1、§5.2

- [ ] 3.2 增加来源索引 repair / rebuild 入口
  - 状态：DONE
  - 这一步到底做什么：提供显式修复入口，用来处理来源冲突、缓存失真、工作区恢复和 provider 结构变化。
  - 做完你能看到什么：不需要靠删库重建来修会话归属问题。
  - 先依赖什么：2.5
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §3.3.4、§6.2
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - 相关 route / ops 入口（按项目现有能力收口）
  - 这一步先不做什么：不在普通读接口里偷偷触发 repair。
  - 怎么算完成：
    1. 可以按工作区或 provider 显式重建来源索引
    2. 冲突来源可单独修复
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-history-service.test.ts tests/integration/session-source-index-repair-routes.test.ts`
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm check:sqlite-runtime`
    - 人工调用 `/api/sessions/source-index/rebuild` 或 `/api/sessions/source-index/repair`，确认可按 `workspaceId`、`provider`、`rawStoreRefs/sourceKeys` 收口修复范围
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §3.3.4、§6.2

- [ ] 3.3 最终检查点
  - 状态：DONE
  - 这一步到底做什么：确认这次优化真的达到了“少扫、少解析、少扫错对象、可定位”的交付标准。
  - 做完你能看到什么：需求、设计、任务、验证数据能一一对上，不是只改了几行日志。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件和本轮改动代码
  - 这一步先不做什么：不再临时扩需求。
  - 怎么算完成：
    1. removed 工作区退出常规 discovery
    2. 未变化来源正文解析量显著下降
    3. diagnostics 能解释主要扫描成本
    4. provider 分层策略已落到实现
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/workbench-service.test.ts tests/integration/session-history-service.test.ts`
    - `pnpm --dir apps/host test tests/integration/observability-routes.test.ts`
    - `CODINGNS_VITEST_TEST_TIMEOUT_MS=60000 pnpm --dir apps/host test tests/integration/session-discovery-diagnostics.test.ts`
    - `CODINGNS_VITEST_TEST_TIMEOUT_MS=60000 pnpm --dir apps/host test tests/integration/session-source-index-repair-routes.test.ts`
    - `pnpm --dir apps/host test tests/integration/session-source-index-repository.test.ts tests/integration/sqlite-bootstrap.test.ts`
    - `pnpm --dir packages/session-sync-core build`
    - `node --test packages/session-sync-core/tests/codex-adapter.test.mjs packages/session-sync-core/tests/claude-paths.test.mjs packages/session-sync-core/tests/opencode-adapter.test.mjs`
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm check:sqlite-runtime`
    - 需求验收逐条核对：removed 工作区门禁、来源指纹复用、workbench 优先级/预算、diagnostics 持久化与 repair/rebuild 入口都已有对应实现和测试
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
