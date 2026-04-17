# 任务清单 - spec001.2.1 读写刷新与后台任务统一规则（人话版）

状态：Draft

## 2026-04-16 进展补记

- 已启动 `spec001.2.1`
- 已明确这次不是继续补单点性能 patch，而是给整个仓库建立统一的读、写、刷新、watcher、后台任务规则
- 已完成一轮全仓库现状盘点，确认当前主要风险集中在工作台链路、文件/Git 订阅链路、整仓库 watcher、读接口副作用和散装刷新状态
- 已确认 `spec001.2` 负责“止血和任务治理”，`spec001.2.1` 负责“统一规则、统一检查清单和后续新增服务标准”

## 2026-04-17 进展补记

- 已在真实运行中的 `3009` Host 上定位到新的硬问题：Git watcher 仍然把 `.git/objects` 整棵递归带进监听，导致主进程打开 `7000+` 个仓库文件句柄
- 已继续收紧 `WorkspaceFileWatcher`：Git watcher 改成只盯 `HEAD`、`index`、`packed-refs`、`refs/*`、`logs/HEAD` 和 rebase / merge 状态目录，不再直接盯整个 `.git`
- 已继续收紧 `WorkbenchWsHub`：watcher 事件现在只打 Git 脏标记并走 quiet window + 最小间隔补跑，不再带 `force: true` 直接强刷
- 已给 provider discovery helper 增加工作区级 inflight 去重和短 TTL 缓存，避免同工作区、同一批 `knownSessions` 的重复扫描并发挤爆 helper
- 已继续收紧 `SessionHistoryService` 的 discovery 持久化：未变化的 binding / index / snapshot 不再重复 `upsert(updated_at=now)`，批事务遇到 `SQLITE_BUSY` 时会做有限次退避重试
- 已给 `workspace.discovery_scan` 增加 host scheduler + helper handler 双层并发闸门，同一时刻最多只放 2 个扫描，其余排队
- 已缩小 `knownSessionsSignature`：`title`、`messageCount`、`lastMessageAt` 这类会频繁抖动但不代表底层 store 变化的字段不再触发整轮重扫
- 已给 `GeminiAdapter` 增加本地 chat 文件的 `mtime/size` 解析缓存，未变化文件不再重复 `readFile + JSON.parse`
- 已给 `workspace discovery` 补上 provider 级扫描诊断：每轮都会带出 `scanned files`、`skipped by mtime-size`、`parsed files`、`bytes read`
- 已让 `SessionSyncService` 透传 provider 自带诊断，不再把细粒度扫描统计在聚合层吞掉
- 已把 `GeminiAdapter` 的 discovery 改成“轻摘要扫描 + 命中后按需 full parse”，避免会话发现阶段为每个 chat 文件都构造完整消息数组
- 已继续把 provider 级扫描缓存补齐：
  - `codex` 继续沿用文件摘要缓存
  - `gemini` 使用本地 chat 轻摘要缓存
  - `claude-code` 新增文件摘要缓存
  - `kimi` 新增 `mtime/size` 摘要缓存
  - `opencode` 新增 provider 侧短 TTL discovery 缓存
- 已继续补强 helper 断管止血：`provider-discovery-helper` 和 `task-helper` 在高频回收后触发的 `EPIPE` / `ECONNRESET` / “子进程已退出” 不再向宿主进程扩散，client 现在会自动重拉并重试一次
- 已继续收紧 `codex` 热路径：
  - `readSessionTitle()` 优先复用索引标题和 discovery 摘要缓存，不再默认整份解析 `jsonl`
  - 子 Agent / `spawn_agent` 关系扫描已加 `mtime/size` 缓存，未变化文件不再每轮重新 `readJsonLines()`
  - workspace discovery 不再默认全量遍历 `~/.codex/archived_sessions`；有线程索引时只纳入当前工作区相关的 archived rollout 文件
- 已给 `task-helper` 和 `provider-discovery-helper` 增加 RSS 高水位空闲回收，并让客户端在子进程回收退出后自动重连，避免 helper 变成死连接
- 已补定向测试和构建验证，避免这轮修复再次被改回去
- 已继续收紧 `codex` 标题热路径：
  - `readSessionTitle()` 在直接读取标题后也会回填轻量标题缓存，避免同一 helper 生命周期内重复整文件解析
  - 工作台标题同步改成“只修复空标题或明显占位标题”，不再对已有稳定标题做全量重复重读
  - 已补 `codex-adapter` 定向测试，防止标题读取缓存再次退化
- 已把 `provider-discovery-helper` 改成真正按需拉起：
  - `ProviderDiscoveryHelperClient` 构造时不再 eager `ensureChild()`
  - helper 进程启动后立刻挂空闲退出计时，父进程断管时直接退出，避免“只创建不请求”的僵尸 helper 常驻
- 已继续收紧工作台刷新链路：
  - `workbench.refresh` 不再无条件串上标题同步
  - 前端权限轮询改成“权限结果真的变化时才 requestRefresh()”，不再每 4 秒硬刷一次工作台
  - `WorkbenchWsHub` 不再保留每 5 秒全量碰 Git / Terminal 的 sidebar 轮询；Git 继续走 watcher 脏标记，Terminal 改成事件驱动 + quiet window 合并
- 已补回归验证，避免这轮改动再次反弹：
  - `provider-discovery-helper-client` 新增“构造不提前 spawn”用例
  - `workbench-ws-hub` 新增“workbench.refresh 不再带标题同步”和“Terminal 改成事件驱动刷新”用例
  - `WorkbenchLayout` 已通过“后台运行会话收到新的权限申请时会推送系统通知”的定向用例

## 这份文档是干什么的

这份任务清单只负责把“统一规则”拆成能执行的步骤，避免最后又写成一篇正确的废话。

要求很简单：

1. 这一步到底建什么
2. 做完以后别人能看到什么变化
3. 依赖什么
4. 主要改哪些文件
5. 明确不做什么
6. 怎么验证

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并验证
- `CANCELLED`：取消并写原因

规则：

- 只有 `状态：DONE` 的任务才能勾成 `[x]`
- 每做完一个任务，都要立刻回写这份文档
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 0：先把子规格挂起来

- [x] 0.1 启动 `spec001.2.1` 并完成文档骨架
  - 状态：DONE
  - 这一步到底做什么：建立 `spec001.2.1` 目录和 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`
  - 做完以后能看到什么结果：仓库里出现完整的 `spec001.2.1` 文档骨架，任何接手的人都知道这次是“统一规则”，不是临时性能修补
  - 依赖什么：`spec001.2`
  - 主要改哪些文件：
    - `specs/spec001.2.1-读写刷新与后台任务统一规则/*`
  - 这一步明确不做什么：不改业务代码
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成主文档骨架和 `docs/README.md`

- [x] 0.2 回写总览和父规格，挂上 `spec001.2.1`
  - 状态：DONE
  - 这一步到底做什么：把 `spec001.2.1` 挂到 `specs/README.md`、`spec001` 和 `spec001.2`，避免后续继续把统一规则塞回旧规格正文里
  - 做完以后能看到什么结果：总览、父规格和 `spec001.2` 都能看出 `spec001.2.1` 是独立子问题
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/design.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
    - `specs/spec001.2-后端任务调度与主线程压力治理/README.md`
    - `specs/spec001.2-后端任务调度与主线程压力治理/tasks.md`
  - 这一步明确不做什么：不改 `spec001` 和 `spec001.2` 的主体需求
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 启动后已同步挂载到总览和父规格

---

## 阶段 1：做完整仓库盘点

- [x] 1.1 盘点全仓库的读接口副作用
  - 状态：DONE
  - 这一步到底做什么：找出所有 `get/list/read/snapshot` 方法里顺手刷新、排任务、改缓存的地方
  - 做完以后能看到什么结果：形成“哪些方法名在骗人”的清单
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/host/src/modules/**`
    - `apps/host/src/ws/**`
    - 盘点文档
  - 这一步明确不做什么：不直接改实现
  - 怎么验证：
    - 盘点文档走查
  - 验证结果：
    - 已在 `20260416-全仓库读写刷新现状盘点.md` 补出“名字像读，实际会推动刷新”的案例表
    - 已确认 `WorkbenchService.getSnapshot()` 是明确反例
    - 已确认 `WorkspaceService.getManagementSummary()` 这类命名边界不清的方法是第二批要收口的对象

- [x] 1.2 盘点私有 `inflight/timer/watcher` 的使用边界
  - 状态：DONE
  - 这一步到底做什么：区分哪些局部 Promise 去重还能保留，哪些其实已经长成散装任务系统
  - 做完以后能看到什么结果：形成“可保留 / 必须收编 / 必须重构”的分类表
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/**`
    - 盘点文档
  - 这一步明确不做什么：不一刀切删除所有私有状态
  - 怎么验证：
    - 分类表走查
  - 验证结果：
    - 已在 `20260416-全仓库读写刷新现状盘点.md` 补出三类表：
      - 可保留的局部 `inflight`
      - 需要继续治理的局部状态
      - 已进统一任务系统的正例
    - 已确认 `workspaceStateRefreshInflight` 和 `WorkbenchWsHub` 局部刷新状态需要继续收口
    - 已确认整工作区 watcher 是明确反模式

- [x] 1.3 盘点同步文件 I/O 和同步事务热点
  - 状态：DONE
  - 这一步到底做什么：区分哪些同步文件读写是正常请求内行为，哪些已经越过主线程预算
  - 做完以后能看到什么结果：形成“允许请求内 / 必须后台化 / 必须拆批”的边界表
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/host/src/modules/file/*`
    - `apps/host/src/modules/sessions/*`
    - `apps/host/src/modules/terminal/*`
    - `apps/host/src/storage/*`
  - 这一步明确不做什么：不在这一阶段改仓储层协议
  - 怎么验证：
    - 盘点文档走查
  - 验证结果：
    - 已在 `20260416-全仓库读写刷新现状盘点.md` 补出三类表：
      - 允许留在请求内的小动作
      - 必须警惕的同步事务热点
      - 不该留在请求主链路的同步扫描
    - 已明确单文件同步读写不是问题本身，批量事务和跨目录扫描才是重点风险

---

## 阶段 2：把规则落成统一标准

- [x] 2.1 固定读、写、刷新、重扫描五类操作模型
  - 状态：DONE
  - 这一步到底做什么：把仓库里的服务方法统一归类，并写死命名和副作用边界
  - 做完以后能看到什么结果：代码评审时先看名字就能知道风险
  - 依赖什么：1.3
  - 主要改哪些文件：
    - `spec001.2.1/design.md`
    - `spec001.2.1/requirements.md`
  - 这一步明确不做什么：不新增 lint 工具
  - 怎么验证：
    - 规则评审
  - 验证结果：
    - 已在 `design.md` 固定五类操作模型的审查表，写清调用方期待、允许动作、禁止动作和推荐命名
    - 已在 `requirements.md` 增补“五类之一”的强制归类要求，明确不允许同一方法混着承担多类职责

- [x] 2.2 固定刷新状态模型和冷却规则
  - 状态：DONE
  - 这一步到底做什么：定义 `fresh/stale/running/cooldown/failed` 和最小状态字段
  - 做完以后能看到什么结果：以后任何刷新型服务都能按同一模型实现
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `spec001.2.1/design.md`
    - `spec001.2.1/requirements.md`
  - 这一步明确不做什么：不一次性重构所有刷新服务
  - 怎么验证：
    - 规则评审
  - 验证结果：
    - 已在 `design.md` 补齐状态转移表、冷却规则和对外返回契约
    - 已在 `requirements.md` 固定最小状态字段、`running` 合并脏标记和 `cooldown` 复用最近结果的验收标准

- [x] 2.3 固定 `TaskManager`、私有 `inflight`、watcher 的准入标准
  - 状态：DONE
  - 这一步到底做什么：写清什么必须进统一任务系统，什么局部去重还能保留，什么 watcher 属于坏味道
  - 做完以后能看到什么结果：新增服务不再随手长出新的小系统
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `spec001.2.1/design.md`
    - `spec001.2.1/requirements.md`
    - 补充盘点文档
  - 这一步明确不做什么：不提前绑定某个具体实现细节
  - 怎么验证：
    - 规则评审
  - 验证结果：
    - 已在 `design.md` 增补私有 `inflight` 越界信号、迁移原则和 watcher 准入表
    - 已在 `requirements.md` 写死私有 `inflight` 的越界条件、watcher 释放要求和观测要求
    - 已在 `20260416-全仓库读写刷新现状盘点.md` 补入运行期指标，证明当前不是理论风险，而是真实高频重复执行

---

## 阶段 3：优先改掉当前最容易复发卡顿的链路

- [x] 3.1 把 `WorkbenchService.getSnapshot()` 改成纯读
  - 状态：DONE
  - 这一步到底做什么：拆掉 `getSnapshot()` 里的隐式 `scheduleWorkspaceRefreshes()`，改成纯读 + 显式刷新入口
  - 做完以后能看到什么结果：工作台读取快照不再顺手打后台刷新
  - 依赖什么：2.3
  - 主要改哪些文件：
    - `apps/host/src/modules/workbench/workbench-service.ts`
    - `apps/host/src/ws/workbench-ws-hub.ts`
    - 相关测试
  - 这一步明确不做什么：不重写工作台 payload 协议
  - 怎么验证：
    - 定向测试
    - 日志检查不再因 `getSnapshot()` 直接触发 discovery
  - 验证结果：
    - 已把 `getSnapshot()` 改成纯读，只保留快照组装，不再隐式调用 `scheduleWorkspaceRefreshes()`
    - 已新增显式 `scheduleSnapshotRefresh()` 入口，并在 `workbench.subscribe` 后按需调度后台刷新
    - 已通过 `tests/integration/workbench-service.test.ts`
    - 已通过 `tests/integration/workbench-ws-hub.test.ts`

- [x] 3.2 收缩文件树和 Git 的 watcher 范围
  - 状态：DONE
  - 这一步到底做什么：把整工作区递归 watcher 改成更小范围的 watcher 策略
  - 做完以后能看到什么结果：文件句柄和无效事件明显下降
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/host/src/modules/workbench/workspace-file-watcher.ts`
    - `apps/host/src/ws/workbench-ws-hub.ts`
    - 相关测试
  - 这一步明确不做什么：不牺牲 Git 面板和文件树的基本可用性
  - 怎么验证：
    - 大仓库实测
    - watcher / fd 指标对比
  - 验证结果：
    - 已把 `WorkspaceFileWatcher` 拆成文件树 watcher 和 Git watcher 两类，不再默认 `chokidar.watch(workspace.path)` 整仓库递归监听
    - 文件树 watcher 现在只盯当前展开目录，Git watcher 只盯 `.git` 元数据、worktree `gitdir/commondir`
    - `WorkbenchWsHub` 已改成按订阅路径挂载 / 释放 watcher，不再把文件树和 Git 订阅混成同一类 watcher
    - 已通过 `tests/integration/workbench-ws-hub.test.ts`
    - 2026-04-17 补充：Git watcher 进一步收紧到 `HEAD`、`index`、`packed-refs`、`refs/heads`、`refs/remotes`、`logs/HEAD` 和 rebase / merge 状态目录，不再把 `.git/objects` 递归带进 watcher
    - 2026-04-17 补充：已新增 `tests/integration/workspace-file-watcher.test.ts`，专门卡住“不允许监听 .git/objects”这条回归线
    - 残留风险：真实超大仓库下的 watcher / fd 指标还需要结合长稳运行继续观察

- [x] 3.3 平稳化 Git 面板刷新
  - 状态：DONE
  - 这一步到底做什么：降低 abort 风暴，补 quiet window 和更稳定的缓存复用
  - 做完以后能看到什么结果：Git 面板不再频繁出现 `snapshot aborted`
  - 依赖什么：3.2
  - 主要改哪些文件：
    - `apps/host/src/ws/workbench-ws-hub.ts`
    - `apps/host/src/modules/workbench/workspace-panel-snapshot-service.ts`
    - 相关测试
  - 这一步明确不做什么：不重写 Git 读服务
  - 怎么验证：
    - 错误日志对比
    - 大仓库面板回归
  - 验证结果：
    - 已在 `WorkbenchWsHub` 增加 Git quiet window 和排队刷新逻辑，文件变化不再通过高频 abort 强行顶掉正在运行的刷新
    - 已把 Git watcher 事件改成“先失效缓存，再延迟合并刷新”，并保留最小刷新间隔节流
    - 已通过 `tests/integration/workbench-ws-hub.test.ts`
    - 已新增 `Git watcher 事件会经过 quiet window 合并` 的定向用例
    - 2026-04-17 补充：Git watcher 事件不再携带 `force: true` 直接强刷，而是只打脏标记，等 quiet window 和最小刷新间隔过去后补跑一次
    - 2026-04-17 补充：`WorkspacePanelSnapshotService.invalidateGit()` 现在只记录脏版本，不再立刻清空最近快照，重复刷新会复用同一工作区的 inflight
    - 残留风险：真实大仓库下 `snapshot aborted` 的日志量还要在长时间运行场景继续对比

- [x] 3.4 把局部刷新状态收成统一模型
  - 状态：DONE
  - 这一步到底做什么：把 `workspaceStateRefreshInflight` 这类状态收编成更清晰的刷新状态机
  - 做完以后能看到什么结果：后续新增刷新链路可以直接套用同一模式
  - 依赖什么：3.3
  - 主要改哪些文件：
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - 相关测试
  - 这一步明确不做什么：不把所有局部 Promise 复用都一锅端
  - 怎么验证：
    - 定向测试
    - 观测字段检查
  - 验证结果：
    - 已把 `SessionHistoryService` 的工作区状态补刷补成明确状态模型，补齐 `failed` 也要遵守冷却窗口的边界
    - 已补 `mergeWorkspaceStateRefreshSessions()`，明确 running 时合并脏请求、cooldown/failed 冷却期结束后再继续补刷
    - 已通过 `tests/integration/session-history-background-tasks.test.ts`
    - 已新增两条定向用例：
      - 运行中合并脏请求并在冷却后只补跑一次
      - 失败后进入冷却，冷却结束前不会立刻重试

---

## 阶段 4：建立新增服务接入标准

- [x] 4.1 写新增服务接入检查清单
  - 状态：DONE
  - 这一步到底做什么：把“读、写、刷新、watcher、任务、缓存、指标”六件事变成固定检查清单
  - 做完以后能看到什么结果：以后新增服务前先过表，不再靠记忆
  - 依赖什么：3.4
  - 主要改哪些文件：
    - `spec001.2.1/docs/*`
    - 必要的规范文档
  - 这一步明确不做什么：不做审批系统
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已落地 `docs/20260416-新增服务接入检查清单.md`
    - 清单已覆盖读路径、写路径、刷新状态、TaskManager 准入、watcher、缓存、指标和合入门槛
    - 已把 `WorkbenchService.getSnapshot()`、`WorkspaceFileWatcher`、`WorkbenchWsHub` 的现成治理例子写进清单，避免文档变空话

- [x] 4.2 建立回归口径和最低验证集
  - 状态：DONE
  - 这一步到底做什么：规定以后任何刷新型服务至少要做哪些定向测试和性能回归
  - 做完以后能看到什么结果：后面再加服务不会只测功能不测卡顿
  - 依赖什么：4.1
  - 主要改哪些文件：
    - `spec001.2.1/docs/*`
    - 相关测试计划
  - 这一步明确不做什么：不做完整压测平台
  - 怎么验证：
    - 评审通过
  - 验证结果：
    - 已落地 `docs/20260416-最低回归验证集.md`
    - 已固定 V1~V8 最低验证项、指标采集口径、推荐执行顺序和验收输出格式
    - 已把本轮实际使用的三类定向用例写入文档：
      - `tests/integration/workbench-service.test.ts`
      - `tests/integration/workbench-ws-hub.test.ts`
      - `tests/integration/session-history-background-tasks.test.ts`
