# 任务清单 - spec016.2-事务文档库外部变更感知与自动刷新（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单只干一件事：

**把“用户主要从外部编辑文件，事务文档库也得自动保持新鲜”拆成能落地的步骤。**

重点就四件事：

- 先把外部变更感知链路收口
- 再把自动刷新和周期兜底做稳
- 接着把临时文件、原子写和缺失重建这些脏边界补齐
- 最后用日志、状态和测试把这条链路钉住

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

---

## 阶段 0：先把 spec 挂起来并锁定边界

- [x] 0.1 启动 `spec016.2` 文档骨架
  - 状态：DONE
  - 这一步到底做什么：创建 `README.md`、`requirements.md`、`design.md`、`tasks.md` 和 `docs/README.md`，把“外部变更感知与自动刷新”从聊天结论变成正式 Spec。
  - 做完你能看到什么：仓库里出现完整 `spec016.2` 目录，已经写清楚 watcher、targeted refresh、周期兜底和缺失重建四条主线。
  - 先依赖什么：`spec016.1`、`spec001.2`、`spec001.2.1`
  - 开始前先看：
    - `spec016.1/README.md`
    - `spec001.2-后端任务调度与主线程压力治理/20260412-后台任务接入规范.md`
    - `apps/host/src/modules/workspace/affairs-library-dirty-watch-service.ts`
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
  - 主要改哪里：
    - `specs/spec016.2-事务文档库外部变更感知与自动刷新/*`
  - 这一步先不做什么：不写实现代码。
  - 怎么算完成：
    1. `spec016.2` 主文档齐全
    2. 已明确“用户主要从外部编辑文件”是这份 Spec 的根前提
  - 怎么验证：
    - 文档走查
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

- [x] 0.2 回写总览和父 spec 关联
  - 状态：DONE
  - 这一步到底做什么：把 `spec016.2` 挂到 `specs/README.md` 和 `spec016/README.md`，明确这是事务视图文档库的正式子规格。
  - 做完你能看到什么：以后查自动刷新、外部变更、周期兜底，不会继续塞回 `spec016.1` 里混着找。
  - 先依赖什么：0.1
  - 开始前先看：
    - `specs/README.md`
    - `specs/spec016-代码视图与事务视图双工作台重构/README.md`
  - 主要改哪里：
    - `specs/README.md`
    - `specs/spec016-代码视图与事务视图双工作台重构/README.md`
  - 这一步先不做什么：不扩新需求。
  - 怎么算完成：
    1. 总览里能看到 `spec016.2`
    2. 父 spec 已写清楚这个子规格负责什么
  - 怎么验证：
    - 文档交叉检查
  - 对应需求：`requirements.md` 需求 4、需求 6
  - 对应设计：`design.md` §1、§2

- [x] 0.3 把借鉴点收敛成分层优先级
  - 状态：DONE
  - 这一步到底做什么：把“借鉴开源网盘经验”从几条零散口号，收敛成“本轮必做 / 下轮应做 / 后续再做”三层清单。
  - 做完你能看到什么：后面落代码时知道哪些是这轮必须交付，哪些别抢跑。
  - 先依赖什么：0.2
  - 开始前先看：
    - `docs/20260531-开源网盘外部变更检测借鉴.md`
    - `README.md`
    - `design.md`
  - 主要改哪里：
    - `specs/spec016.2-事务文档库外部变更感知与自动刷新/README.md`
    - `specs/spec016.2-事务文档库外部变更感知与自动刷新/design.md`
    - `specs/spec016.2-事务文档库外部变更感知与自动刷新/docs/20260531-开源网盘外部变更检测借鉴.md`
  - 这一步先不做什么：不直接开始实现目录版本戳或专用存储适配。
  - 怎么算完成：
    1. 本轮必做项已经单独列清
    2. 下轮和后续项已经明确分层
  - 怎么验证：
    - 文档走查
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 4、需求 5、需求 6
  - 对应设计：`design.md` §2.4

---

## 阶段 1：把外部变更感知入口收口

- [ ] 1.1 固定 watcher 模型：每个资料库根目录一个监听入口
  - 状态：TODO
  - 这一步到底做什么：确认并收紧事务文档库 watcher 模型，明确只能按资料库根目录挂监听，不能再对子目录递归长 watcher。
  - 做完你能看到什么：自动刷新链路从结构上避开 `EMFILE` 老问题。
  - 先依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 4
    - `design.md` §2.1、§6.1
    - `apps/host/src/modules/workspace/affairs-library-dirty-watch-service.ts`
  - 主要改哪里：
    - `apps/host/src/modules/workspace/affairs-library-dirty-watch-service.ts`
    - 必要时相关初始化路径
  - 这一步先不做什么：不改导出逻辑，不补 UI。
  - 怎么算完成：
    1. 监听入口数量与资料库数量相关
    2. 没有子目录级 watcher 残留
  - 怎么验证：
    - 代码走查
    - 定向日志验证
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §2.1、§6.1

- [ ] 1.2 把普通外部文件变更统一收口成脏标记 + targeted refresh
  - 状态：TODO
  - 这一步到底做什么：把普通文档事件统一规范化成 `index` 脏标记和最窄 `targetPath`，再走自动刷新调度。
  - 做完你能看到什么：外部改一个文件时，不会再傻乎乎全量重扫，先刷这一个点。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.3.1、§3.2
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
  - 主要改哪里：
    - `apps/host/src/modules/workspace/affairs-library-dirty-watch-service.ts`
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
  - 这一步先不做什么：不处理周期兜底和缺失重建。
  - 怎么算完成：
    1. 外部文档变更能合并成 targeted refresh
    2. 重复事件不会直接打出多份重活
  - 怎么验证：
    - 集成测试
    - 人工修改文件回放
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.3.1、§6.2

### 阶段检查

- [ ] 1.3 外部变更感知阶段检查
  - 状态：TODO
  - 这一步到底做什么：只检查 watcher 和脏标记这层是不是已经站稳，不带着结构性问题往下做。
  - 做完你能看到什么：知道系统已经能安全接住外部改动，而不是靠碰运气。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不扩导出优化。
  - 怎么算完成：
    1. 外部事件能进自动刷新主链路
    2. 没有重新长出目录级 watcher
  - 怎么验证：
    - 人工走查
    - 定向测试
  - 对应需求：`requirements.md` 需求 1、需求 4
  - 对应设计：`design.md` §2、§6

---

## 阶段 2：把周期兜底和原子写边界补齐

- [ ] 2.1 补齐周期自动刷新兜底
  - 状态：TODO
  - 这一步到底做什么：给每个资料库补低频周期刷新，处理 watcher 漏事件、重启错过事件和外部存储通知不稳这类现实问题。
  - 做完你能看到什么：就算 watcher 没报到，事务视图过一段时间也能自己变新。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.3.2、§4.2
    - `apps/host/src/modules/workspace/affairs-library-dirty-watch-service.ts`
  - 主要改哪里：
    - `apps/host/src/modules/workspace/affairs-library-dirty-watch-service.ts`
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
  - 这一步先不做什么：不做存储类型专用通知适配。
  - 怎么算完成：
    1. 周期兜底能自动入队刷新
    2. 不会跟当前运行中的任务互相打架
  - 怎么验证：
    - 定向测试
    - 日志核对
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §2.3.2、§4.2

- [ ] 2.2 过滤常见临时文件并兼容原子写目录事件
  - 状态：TODO
  - 这一步到底做什么：把 `.tmp`、`.swp`、`#xxx#`、`~$` 这类中间产物默认忽略，并在目录级事件里补出最近真实目标路径。
  - 做完你能看到什么：外部编辑器不会因为原子写过程把事务文库刷得乱七八糟。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.3.3、§5.3
    - `apps/host/src/modules/workspace/affairs-library-dirty-watch-service.ts`
  - 主要改哪里：
    - `apps/host/src/modules/workspace/affairs-library-dirty-watch-service.ts`
    - 对应测试文件
  - 这一步先不做什么：不加可配置的复杂过滤 DSL。
  - 怎么算完成：
    1. 常见临时文件不会触发正式刷新
    2. 目录事件仍能尽量归并到真实目标路径
  - 怎么验证：
    - 单元测试
    - 原子写场景人工回放
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §2.3.3、§5.3

### 阶段检查

- [ ] 2.3 自动刷新兜底阶段检查
  - 状态：TODO
  - 这一步到底做什么：检查周期兜底和原子写边界是不是已经补齐，不让“偶尔能用”冒充真正可交付。
  - 做完你能看到什么：外部编辑主场景已经基本站稳。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不扩内存优化新范围。
  - 怎么算完成：
    1. watcher 漏事件有兜底
    2. 常见原子写中间产物已过滤
  - 怎么验证：
    - 人工走查
    - 定向测试
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §2.3.2、§2.3.3

---

## 阶段 3：把缺失重建、状态和验证钉牢

- [ ] 3.1 补索引产物缺失时的自动重建链路
  - 状态：TODO
  - 这一步到底做什么：在 `.ai-index`、导出快照或状态文件缺失时，自动把状态切成待重建并入队全量重建任务。
  - 做完你能看到什么：删掉 `.ai-index` 后，不需要人工手动补一堆步骤，系统自己会恢复。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.4、§6.3
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
  - 主要改哪里：
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
    - 相关任务触发和状态判断代码
  - 这一步先不做什么：不改索引器内部实现细节。
  - 怎么算完成：
    1. 缺失场景会自动入队重建
    2. 成功和失败状态都可读
  - 怎么验证：
    - 人工删除 `.ai-index` 回放
    - 集成测试
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.4、§6.3

- [ ] 3.2 补齐状态、日志和回归验证
  - 状态：TODO
  - 这一步到底做什么：把自动刷新入队、完成、失败、去重、缺失重建这些节点都纳入统一状态和结构化日志，并补测试证据。
  - 做完你能看到什么：以后查“最近为什么没刷新”有地方看，不再靠猜。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §3.3、§5.3、§7
    - 当前 Host 日志格式
  - 主要改哪里：
    - `apps/host/src/modules/workspace/affairs-library-service.ts`
    - DTO / 测试 / 必要的前端状态消费
  - 这一步先不做什么：不追加新产品功能。
  - 怎么算完成：
    1. 自动刷新关键节点都有结构化日志
    2. 前端能看到最近自动刷新状态
    3. 测试和人工验证步骤都齐
  - 怎么验证：
    - 日志核对
    - 测试执行
    - 人工回放
  - 对应需求：`requirements.md` 需求 6
  - 对应设计：`design.md` §3.3、§5.3、§7

### 最终检查

- [ ] 3.3 最终检查点
  - 状态：TODO
  - 这一步到底做什么：确认外部编辑主场景已经真的能用，而且没有靠新问题把旧问题换回来。
  - 做完你能看到什么：事务文档库在外部编辑为主的真实使用方式下已经站稳。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件
  - 这一步先不做什么：不再追加新需求。
  - 怎么算完成：
    1. 外部改动后能自动刷新
    2. watcher 漏事件有兜底
    3. `.ai-index` 缺失能自动重建
    4. 状态、日志、验证证据能对上
  - 怎么验证：
    - 按 Spec 验收清单逐项核对
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

