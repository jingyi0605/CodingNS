# 任务清单 - spec002.3 设置页会话清理工具与跨Provider级联删除（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单只回答几个最实际的问题：

1. 先做哪条主链路，才能真正开始治理旧会话
2. 哪些是设置页表面工作，哪些是 Host 里的硬骨头
3. 备份、恢复、删除怎么拆，才不会一锅乱炖
4. 怎么确保批量清理不会把现有单条删除链路搞坏

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻更新本文件
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 0：先把范围钉死，不再模糊说“加个清理按钮”

- [x] 0.1 盘清现有会话删除主链路和 provider 落点
  - 状态：DONE
  - 这一步到底做什么：确认当前会话删除已经走到哪一层、哪些 provider 已有删除能力、哪些残留还没正式接住。
  - 做完你能看到什么：已经确认 Host 有现成删除主链路和 provider 删除 CLI，可作为批量清理的核心复用点。
  - 先依赖什么：无
  - 开始前先看：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/sessions/provider-session-delete-cli.ts`
    - `packages/session-sync-core/src/providers/codex.ts`
    - `packages/session-sync-core/src/providers/claude-code.ts`
    - `packages/session-sync-core/src/providers/opencode.ts`
  - 主要改哪里：
    - `specs/spec002.3-设置页会话清理工具与跨Provider级联删除/*`
  - 这一步先不做什么：不直接写实现代码。
  - 怎么算完成：
    1. 已明确现有单条删除主链路可复用
    2. 已明确三家 provider 的主要来源类型
    3. 已明确这次必须走后台任务
  - 怎么验证：
    - 文档走查
    - 代码走查
  - 对应需求：`requirements.md` 需求 5、需求 6、需求 8
  - 对应设计：`design.md` §1.3、§2.2

- [x] 0.2 建立 spec002.3 初稿并锁定边界
  - 状态：DONE
  - 这一步到底做什么：把设置页会话清理工具、备份恢复、级联删除正式写成 Spec，避免后面一边做一边改目标。
  - 做完你能看到什么：`README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md` 已建立。
  - 先依赖什么：0.1
  - 开始前先看：
    - `spec002`
    - `spec002.1`
    - `spec008.2`
    - `spec001.2.1`
  - 主要改哪里：
    - `specs/spec002.3-设置页会话清理工具与跨Provider级联删除/*`
  - 这一步先不做什么：不改 Host、前端和数据库实现。
  - 怎么算完成：
    1. Spec 主文档齐全
    2. 已明确先只做 Codex、Claude Code、OpenCode
    3. 已明确不复制一套平行删除逻辑
  - 怎么验证：
    - Spec 目录结构检查
    - 文档自检
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

---

## 阶段 1：先把 Host 的数据模型和后台任务地基搭起来

- [x] 1.1 新增清理结果、备份记录和最近扫描结果存储
  - 状态：DONE
  - 这一步到底做什么：补会话清理工具自己的持久化地基，至少能存最近扫描结果、备份记录和逐条操作结果。
  - 做完你能看到什么：Host 有地方保存设置页重新打开后还能看的清理结果，而不是全靠内存。
  - 先依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3、需求 4、需求 7
    - `design.md` §3.2、§4.1
    - SQLite 使用规则
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/sqlite/client.ts`
    - `apps/host/src/storage/repositories/`
    - `apps/host/src/types/domain.ts`
  - 这一步先不做什么：不直接做 provider 删除逻辑。
  - 怎么算完成：
    1. 已新增 `session_cleanup_scans`、`session_cleanup_archives`、`session_cleanup_operation_items`
    2. 已新增 `SessionCleanupRepository`，可保存最近扫描、备份记录和逐条操作结果
    3. 没有引入 `node:sqlite`
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-cleanup-repository.test.ts`
    - `pnpm check:sqlite-runtime`
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 4、需求 7
  - 对应设计：`design.md` §3.2、§4.1

- [x] 1.2 注册扫描、备份、恢复、删除后台任务
  - 状态：DONE
  - 这一步到底做什么：把会话清理工具的四类重活全部接进 `TaskManager`。
  - 做完你能看到什么：前端不再直接等重活跑完，而是拿到标准任务句柄。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §2.3、§4.2
    - `spec001.2`、`spec001.2.1`
  - 主要改哪里：
    - `apps/host/src/modules/tasks/task-types.ts`
    - `apps/host/src/modules/sessions/` 或新增 `session-cleanup/` 模块
    - `apps/host/src/server/create-server.ts`
  - 这一步先不做什么：不同时做设置页 UI。
  - 怎么算完成：
    1. 已新增 `session_cleanup.scan / backup / restore / delete` 四类任务类型
    2. 已新增 `SessionCleanupService`，并在 Host 启动时注册四类后台任务
    3. 当前阶段读能力只读取仓储结果，没有在读方法里现跑重活
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-cleanup-service.test.ts`
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - 对应需求：`requirements.md` 需求 6
  - 对应设计：`design.md` §2.2、§2.3

- [x] 1.3 阶段检查：Host 地基已经站住
  - 状态：DONE
  - 这一步到底做什么：只检查清理工具有没有正式存储和后台任务地基，不再扩新范围。
  - 做完你能看到什么：可以开始接 provider 策略，而不是一边删数据一边靠内存凑状态。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不做前端，不做备份包细节。
  - 怎么算完成：
    1. 清理相关结果已可落库
    2. 四类后台任务已可创建
    3. `SessionCleanupService` 已接入 `create-server` 主程序初始化链
  - 怎么验证：
    - 人工走查
    - `pnpm --dir apps/host test tests/integration/session-cleanup-repository.test.ts tests/integration/session-cleanup-service.test.ts`
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - 对应需求：`requirements.md` 需求 6、需求 7
  - 对应设计：`design.md` §2、§4

---

## 阶段 2：把扫描和候选装配主链路做出来

- [x] 2.1 实现统一候选模型和多 provider 扫描聚合
  - 状态：DONE
  - 这一步到底做什么：把 Codex、Claude Code、OpenCode 的会话扫描结果装配成统一候选视图。
  - 做完你能看到什么：设置页能一次看到三家 provider 的会话候选，而不是三套散装数据。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.3.1、§3.2.1
    - `spec002.1` 关于来源索引和扫描门禁
  - 主要改哪里：
    - `apps/host/src/modules/session-cleanup/`
    - `packages/session-sync-core/src/providers/*`
    - `apps/host/tests/integration/`
  - 这一步先不做什么：不顺手做删除。
  - 怎么算完成：
    1. 已新增统一 `SessionCleanupCandidate` 模型
    2. `SessionCleanupService` 已能基于 `session_bindings + session_indices + session_source_index + workspace` 聚合 Codex、Claude Code、OpenCode 候选
    3. 候选里已带上时间范围、来源健康状态和大小估算，来源异常不会被静默丢掉
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-cleanup-service.test.ts`
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §2.3.1、§3.2.1

- [x] 2.2 提供最近扫描结果和筛选接口
  - 状态：DONE
  - 这一步到底做什么：让设置页能读取最近扫描结果，并按 provider 和时间范围做筛选。
  - 做完你能看到什么：用户打开面板不一定立刻重扫，也能看到最近结果再决定是否重扫。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 6
    - `design.md` §3.3.1、§3.3.2
  - 主要改哪里：
    - `apps/host/src/routes/`
    - `apps/host/src/modules/session-cleanup/`
    - `apps/user-app/src/features/settings/api/`
  - 这一步先不做什么：不做备份包读取。
  - 怎么算完成：
    1. 已新增 `GET /api/settings/session-cleanup/scans/latest`
    2. 已新增 `POST /api/settings/session-cleanup/scans`
    3. `latest` 读取最近结果并支持 provider / 时间过滤，`scan` 只创建后台任务，不在读接口现算重活
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-cleanup-routes.test.ts`
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 6
  - 对应设计：`design.md` §3.3、§4.2

- [x] 2.3 阶段检查：候选装配主链路已可用
  - 状态：DONE
  - 这一步到底做什么：检查扫描和筛选是不是已经站住，不再扩新范围。
  - 做完你能看到什么：可以开始做备份、恢复、删除，而不是还在猜候选数据是不是靠谱。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不做设置页完整 UI。
  - 怎么算完成：
    1. 最近扫描结果已可读取
    2. 三家 provider 候选已可聚合展示
    3. Host 已具备设置页最小读链路，不依赖前端先行硬编码
  - 怎么验证：
    - 人工走查
    - `pnpm --dir apps/host test tests/integration/session-cleanup-repository.test.ts tests/integration/session-cleanup-service.test.ts tests/integration/session-cleanup-routes.test.ts`
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §2.3.1、§3.3

---

## 阶段 3：把备份和恢复链路做出来

- [x] 3.1 设计并实现备份包格式和清单读写
  - 状态：DONE
  - 这一步到底做什么：先把备份包格式定下来，至少能稳定写入和重新读取清单。
  - 做完你能看到什么：备份包不是一堆散文件，而是有正式版本号和清单结构。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4、需求 7
    - `design.md` §2.3.2、§2.3.3、§3.2.2
  - 主要改哪里：
    - `apps/host/src/modules/session-cleanup/`
    - `apps/host/tests/integration/`
  - 这一步先不做什么：不顺手做删除。
  - 怎么算完成：
    1. 已实现 `SessionCleanupArchiveService`，使用带版本号的 `gzip + JSON bundle` 备份格式写入清单和原始文件材料
    2. 已支持重新读取清单和备份包检查
    3. 清单损坏、文件不存在或格式不支持时会返回结构化错误
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-cleanup-service.test.ts tests/integration/session-cleanup-routes.test.ts`
  - 对应需求：`requirements.md` 需求 3、需求 4、需求 7
  - 对应设计：`design.md` §2.3.2、§2.3.3、§5

- [x] 3.2 实现选择性恢复和冲突处理
  - 状态：DONE
  - 这一步到底做什么：从备份包里只恢复用户选中的条目，并对 providerSessionId、rawStoreRef 冲突给出明确结果。
  - 做完你能看到什么：用户不需要整包恢复，也不会静默覆盖现有会话。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 4、需求 7
    - `design.md` §2.3.3、§6.2
  - 主要改哪里：
    - `apps/host/src/modules/session-cleanup/`
    - `apps/host/src/routes/`
    - `apps/host/tests/integration/`
  - 这一步先不做什么：不做设置页最终样式。
  - 怎么算完成：
    1. 已新增 `POST /api/settings/session-cleanup/backup-inspections`，可预览备份包条目
    2. 已支持按条目选择性恢复
    3. 已对 `providerSessionId` 和 `rawStoreRef` 冲突给出结构化结果，不再静默覆盖
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-cleanup-service.test.ts tests/integration/session-cleanup-routes.test.ts`
  - 对应需求：`requirements.md` 需求 4、需求 7
  - 对应设计：`design.md` §2.3.3、§5、§6.2

- [x] 3.3 阶段检查：备份恢复已经是完整主链路
  - 状态：DONE
  - 这一步到底做什么：检查备份和恢复是不是已经能独立成立，不再扩新范围。
  - 做完你能看到什么：后面做删除时，可以放心要求“建议先备份”。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不接批量删除 UI。
  - 怎么算完成：
    1. 备份包已经可生成
    2. 备份包已经可重新打开并选择性恢复到 CodingNS 可见链路
  - 怎么验证：
    - 人工走查
    - `pnpm --dir apps/host test tests/integration/session-cleanup-repository.test.ts tests/integration/session-cleanup-service.test.ts tests/integration/session-cleanup-routes.test.ts`
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm check:sqlite-runtime`
  - 对应需求：`requirements.md` 需求 3、需求 4、需求 7
  - 对应设计：`design.md` §2.3.2、§2.3.3、§6.2

---

## 阶段 4：把级联删除真正做完整

- [x] 4.1 把批量删除接到现有单条删除核心能力
  - 状态：DONE
  - 这一步到底做什么：让批量删除复用现有 `deleteSession` 主链路，再补上批量维度的结果汇总。
  - 做完你能看到什么：不是复制一套删除实现，而是在现有主链路上做批量编排。
  - 先依赖什么：3.3
  - 开始前先看：
    - `requirements.md` 需求 5、需求 8
    - `design.md` §2.3.4、§6.1
  - 主要改哪里：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/session-cleanup/`
    - `apps/host/tests/integration/provider-session-delete.test.ts`
  - 这一步先不做什么：不顺手改普通工作台删除 UI。
  - 怎么算完成：
    1. `session_cleanup.delete` 已改为复用 `SessionHistoryService.deleteSession(...)`
    2. 已支持返回逐条删除结果
    3. 已补 `session-cleanup` 删除相关测试，单条删除既有测试也已通过功能断言
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-cleanup-service.test.ts tests/integration/session-cleanup-routes.test.ts`
    - `pnpm --dir apps/host test tests/integration/provider-session-delete.test.ts`
    - 说明：`provider-session-delete.test.ts` 本轮功能断言通过，但测试进程末尾仍出现 Vitest worker `onTaskUpdate` 超时，需要后续单独治理测试运行时稳定性
  - 对应需求：`requirements.md` 需求 5、需求 8
  - 对应设计：`design.md` §2.3.4、§6.1

- [x] 4.2 补全三家 provider 的级联删除和删除后复核
  - 状态：DONE
  - 这一步到底做什么：对 Codex、Claude Code、OpenCode 分别补齐 provider 侧删除、磁盘清理和删除后不回流复核。
  - 做完你能看到什么：删完后这些会话不会因为某一层残留又被扫回来。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.4、§6.1
    - `spec002.1` 的来源修复逻辑
  - 主要改哪里：
    - `apps/host/src/modules/session-cleanup/`
    - `packages/session-sync-core/src/providers/*`
    - `apps/host/tests/integration/`
  - 这一步先不做什么：不扩其他 provider。
  - 怎么算完成：
    1. 三家 provider 删除继续复用已有单条 provider 删除链路
    2. 删除后会额外触发 `repairSessionSourceIndex(... awaitDiscovery: true)` 做 source index 清理和 discovery 复核
    3. 如果复核后同一会话重新出现，结果会被标记为 `partial`，不会伪装成彻底成功
  - 怎么验证：
    - `pnpm --dir apps/host test tests/integration/session-cleanup-service.test.ts tests/integration/session-cleanup-routes.test.ts`
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - 对应需求：`requirements.md` 需求 5、需求 7
  - 对应设计：`design.md` §2.3.4、§5、§6.1

- [x] 4.3 阶段检查：删除链路已闭环
  - 状态：DONE
  - 这一步到底做什么：检查删除主链路是不是真的闭环，而不是“看起来删了，其实只是列表没了”。
  - 做完你能看到什么：可以开始做设置页完整交互和最终验收。
  - 先依赖什么：4.1、4.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新范围。
  - 怎么算完成：
    1. 批量删除已经可用，并复用现有单条删除主链路
    2. 删除后已经补上 source index 清理和 discovery 复核，不再只删表面索引
    3. 单条删除链路没有被重新实现，仍走原有核心能力
  - 怎么验证：
    - 人工走查
    - `pnpm --dir apps/host test tests/integration/session-cleanup-repository.test.ts tests/integration/session-cleanup-service.test.ts tests/integration/session-cleanup-routes.test.ts`
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm check:sqlite-runtime`
  - 对应需求：`requirements.md` 需求 5、需求 8
  - 对应设计：`design.md` §2.3.4、§6.1

---

## 阶段 5：接设置页 UI，并完成最终验收

- [x] 5.1 在设置页接入会话清理工具面板
  - 状态：DONE
  - 这一步到底做什么：把扫描结果、筛选、多选、备份、恢复、删除、任务状态接进正式设置页入口。
  - 做完你能看到什么：用户可以不离开设置页完成完整主链路。
  - 先依赖什么：4.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3、需求 4、需求 5、需求 7
    - `design.md` §2.1、§3.3
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
    - `docs/开发设计规范/20260419-模态框与按钮设计规范.md`
  - 主要改哪里：
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - `apps/user-app/src/settings/`
    - `apps/user-app/src/features/settings/api/`
    - `apps/user-app/src/shared/i18n/index.ts`
  - 这一步先不做什么：不重做整个设置页结构。
  - 怎么算完成：
    1. 设置页有正式入口
    2. 可以查看最近扫描结果和任务状态
    3. 可以完成多选、备份、恢复、删除
  - 怎么验证：
    - `pnpm --dir apps/user-app test src/settings/SessionCleanupPanel.test.tsx src/features/settings/pages/SettingsPage.test.tsx`
    - `pnpm --dir apps/user-app exec tsc -p tsconfig.json --noEmit`（当前被仓库既有错误 `src/features/conversation/components/GitSidebar.tsx:1334 Cannot find name 'handleOpenFile'` 阻塞，本轮未引入新的 session cleanup 类型错误）
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 4、需求 5、需求 7
  - 对应设计：`design.md` §2.1、§3.3

- [x] 5.2 最终检查点
  - 状态：DONE
  - 这一步到底做什么：确认这个 Spec 真的达到交付标准，而不是“看起来差不多”。
  - 做完你能看到什么：需求、设计、任务、测试证据能一一对上。
  - 先依赖什么：5.1
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件
  - 这一步先不做什么：不再追加新需求。
  - 怎么算完成：
    1. 扫描、备份、恢复、删除完整主链路都可验证
    2. 单条删除链路不回归
    3. 风险和延期项已写清楚
  - 怎么验证：
    - 按 Spec 验收清单逐项核对
    - Host 侧既有验证：
      - `pnpm --dir apps/host test tests/integration/session-cleanup-repository.test.ts tests/integration/session-cleanup-service.test.ts tests/integration/session-cleanup-routes.test.ts`
      - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
      - `pnpm check:sqlite-runtime`
    - 前端本轮验证：
      - `pnpm --dir apps/user-app test src/settings/SessionCleanupPanel.test.tsx src/features/settings/pages/SettingsPage.test.tsx`
    - 已知阻塞：
      - `pnpm --dir apps/user-app exec tsc -p tsconfig.json --noEmit` 仍被仓库既有错误 `src/features/conversation/components/GitSidebar.tsx(1334,22): error TS2304: Cannot find name 'handleOpenFile'.` 卡住
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
