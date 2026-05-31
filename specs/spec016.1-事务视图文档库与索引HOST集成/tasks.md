# 任务清单 - spec016.1-事务视图文档库与索引HOST集成（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单只负责把“事务视图接真实文档库 + 索引服务进 HOST + 重活统一进后台任务体系”拆成可落地步骤。

重点就三件事：

- 先把数据源纠正
- 再把 Host 正式能力补齐
- 最后把重活收进统一 worker / TaskManager

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

---

## 阶段 0：先把 spec 挂起来并锁定边界

- [x] 0.1 启动 `spec016.1` 文档骨架
  - 状态：DONE
  - 这一步到底做什么：创建 `README.md`、`requirements.md`、`design.md`、`tasks.md` 和 `docs/README.md`，把这次子问题从聊天结论变成正式 Spec。
  - 做完你能看到什么：仓库里出现完整 `spec016.1` 目录，已经明确“真实文档库、HOST 集成、后台任务统一接法”三条主线。
  - 先依赖什么：`spec016`、`spec001.2`、`spec001.2.1`
  - 开始前先看：
    - `spec016/requirements.md`
    - `spec001.2-后端任务调度与主线程压力治理`
    - `spec001.2.1-读写刷新与后台任务统一规则`
  - 主要改哪里：
    - `specs/spec016.1-事务视图文档库与索引HOST集成/*`
  - 这一步先不做什么：不写实现代码。
  - 怎么算完成：
    1. 子 Spec 骨架齐全
    2. 已写死 Host 集成和后台任务边界
  - 怎么验证：
    - 文档走查
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

  - 本次补充结果：
    1. 左侧正式拆成“收藏区 + 标签树”，不再混着一坨平铺列表
    2. 中间改成文件夹优先浏览，并支持图标 / 列表双视图
    3. 右侧对象详情已分成目录 / 标签 / 文档三态，事务助手标签保持原实现不动
    4. 已执行 `pnpm --dir apps/user-app build` 通过

- [x] 0.2 回写总览和父 spec 关联
  - 状态：DONE
  - 这一步到底做什么：把 `spec016.1` 挂到 `specs/README.md` 和 `spec016` 里，明确这是 `spec016` 的正式子规格。
  - 做完你能看到什么：以后查事务视图文档库接入，不会再只在大 spec 里翻半天。
  - 先依赖什么：0.1
  - 开始前先看：
    - `specs/README.md`
    - `specs/spec016-代码视图与事务视图双工作台重构/README.md`
  - 主要改哪里：
    - `specs/README.md`
    - `specs/spec016-代码视图与事务视图双工作台重构/README.md`
    - 必要时 `spec016/tasks.md`
  - 这一步先不做什么：不扩新需求。
  - 怎么算完成：
    1. 总览能看到 `spec016.1`
    2. `spec016` 能看出这部分已经拆成子 spec
  - 怎么验证：
    - 文档交叉检查
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §1、§2

## 阶段 1：先把当前假文档库替换成真实对象模型

- [ ] 1.1 盘点事务视图当前假文档链路并给出替换点
  - 状态：TODO
  - 这一步到底做什么：把 `AffairsWorkbenchView` 里当前拿会话伪造文档的地方全部列清楚，明确哪些状态、筛选和详情需要换成真实文档模型。
  - 做完你能看到什么：知道前端哪些地方现在是假的，后面替换时不会漏。
  - 先依赖什么：0.2
  - 开始前先看：
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - `apps/user-app/src/features/workbench/utils/workbench-mode.ts`
    - `spec016.1/design.md` §3.2
  - 主要改哪里：
    - 盘点文档
    - 必要时补 `docs/` 说明
  - 这一步先不做什么：不直接改 UI。
  - 怎么算完成：
    1. 已列出 fake document 数据源
    2. 已明确前端要补哪些状态字段
  - 怎么验证：
    - 盘点走查
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 7
  - 对应设计：`design.md` §2.2、§3.2

- [x] 1.2 设计并落地事务视图文档库绑定与浏览状态模型
  - 状态：DONE
  - 这一步到底做什么：给 `AffairsViewState` 补文档库绑定和浏览状态，让事务视图不再只有“分区、选中节点、选中对象”这点壳子状态。
  - 做完你能看到什么：事务视图能记住绑定路径、浏览模式、选中的标签/目录/文档，同时为右侧助手初始化态提供正式状态来源。
  - 先依赖什么：1.1
  - 开始前先看：
    - `design.md` §3.2
    - `apps/user-app/src/features/workbench/types/workbench-mode.ts`
    - `apps/user-app/src/features/workbench/utils/workbench-mode.ts`
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/types/workbench-mode.ts`
    - `apps/user-app/src/features/workbench/utils/workbench-mode.ts`
  - 这一步先不做什么：不接真实 Host 数据读取。
  - 怎么算完成：
    1. 前端已能保存文档库绑定和浏览状态
    2. 刷新后能恢复上次位置
  - 怎么验证：
    - 前端状态测试
  - 对应需求：`requirements.md` 需求 1、需求 7
  - 对应设计：`design.md` §3.2、§4.1

## 阶段 2：把索引服务收进 HOST，并接统一后台任务

- [x] 2.1 建立 Host 文档库/索引服务门面
  - 状态：DONE
  - 这一步到底做什么：在 `apps/host` 里新增正式文档库服务，统一负责绑定配置、快照读取、状态读取和刷新入口。
  - 做完你能看到什么：前端不再自己拼 CLI，也不再直接依赖外部静态页。
  - 先依赖什么：1.2
  - 开始前先看：
    - `apps/host/src/modules/file/workspace-index-apply-service.ts`
    - `apps/host/src/modules/document-runtime/*`
    - `design.md` §2.1、§3.3
  - 主要改哪里：
    - `apps/host/src/modules/...` 新文档库/索引服务
    - 对应 controller / dto
  - 这一步先不做什么：不直接做全量搜索功能。
  - 怎么算完成：
    1. Host 有正式文档库读取 API
    2. Host 能读绑定和导出快照
  - 怎么验证：
    - Host API 集成测试
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 4
  - 对应设计：`design.md` §2.1、§3.3

- [x] 2.2 把索引相关后台任务注册到 TaskManager
  - 状态：DONE
  - 这一步到底做什么：把配置应用、全量重扫、标签重算、导出刷新等重活定义成正式任务，并选对执行 lane。
  - 做完你能看到什么：索引重活进入统一任务系统，能去重、观测、看状态。
  - 先依赖什么：2.1
  - 开始前先看：
    - `spec001.2-后端任务调度与主线程压力治理`
    - `spec001.2.1/design.md`
    - `apps/host/src/modules/tasks/task-types.ts`
    - `apps/host/src/modules/tasks/task-lane-executors.ts`
  - 主要改哪里：
    - `apps/host/src/modules/tasks/task-types.ts`
    - 新索引任务注册模块
    - 必要的 helper/external 执行桥
  - 这一步先不做什么：不在请求读链路里同步执行重活。
  - 怎么算完成：
    1. 索引重活都有正式 `taskType`
    2. 同一工作区同类任务能去重
    3. 重活不跑在主线程请求链路
  - 怎么验证：
    - 任务调度测试
    - 人工看任务状态和日志
  - 对应需求：`requirements.md` 需求 4、需求 5、需求 6
  - 对应设计：`design.md` §2.1、§4.2、§6.1、§6.2

- [x] 2.3 建立索引状态快照和错误状态返回
  - 状态：DONE
  - 这一步到底做什么：把 `fresh/stale/running/cooldown/failed` 这套状态正式落到 Host，对前端统一返回。
  - 做完你能看到什么：前端能清楚知道当前文档库是正常、刷新中还是失败。
  - 先依赖什么：2.2
  - 开始前先看：
    - `spec001.2.1/requirements.md`
    - `design.md` §4.2
  - 主要改哪里：
    - Host 文档库状态模型
    - 相关 DTO / controller
  - 这一步先不做什么：不做复杂实时订阅。
  - 怎么算完成：
    1. 状态模型完整
    2. 错误摘要可返回给前端
  - 怎么验证：
    - 状态流转测试
  - 对应需求：`requirements.md` 需求 5、需求 6
  - 对应设计：`design.md` §4.2、§5.3

## 阶段 3：把真实文档库接进事务视图主链路

- [x] 3.1 事务视图接真实文档列表、标签和收藏
  - 状态：DONE
  - 这一步到底做什么：让 `apps/user-app` 从 Host 读取真实文档库快照，并替换当前 fake document 列表、标签和收藏。
  - 做完你能看到什么：事务视图左侧、中间、右侧终于围着真实文档工作。
  - 先依赖什么：2.3
  - 开始前先看：
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - `design.md` §2.3.2、§3.2
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - 相关 API 和状态 hooks
    - i18n 文案
  - 这一步先不做什么：不一次性做完所有高级筛选和搜索。
  - 怎么算完成：
    1. 中间主列表展示真实文档
    2. 左侧展示真实标签和真实收藏
    3. 右侧展示真实路径、摘要和标签
  - 怎么验证：
    - 前端交互测试
    - 人工走主链路
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 7
  - 对应设计：`design.md` §2.3.2、§3.2

- [x] 3.2 接通首次绑定、错误态和显式刷新入口
  - 状态：DONE
  - 这一步到底做什么：把首次进入未绑定、绑定失败、工具缺失、刷新失败这些状态全接进事务视图，不再只在后端静默报错。
  - 做完你能看到什么：事务视图第一次真正能用，不会因为缺状态就卡成半页空白。
  - 先依赖什么：3.1
  - 开始前先看：
    - `design.md` §5
    - 前端设计规范
    - 如涉及模态框，再看模态框规范
  - 主要改哪里：
    - `apps/user-app` 文档库绑定 UI
    - 错误态 / 空态 / 刷新入口
  - 这一步先不做什么：不继续扩待办和自动化分区。
  - 怎么算完成：
    1. 首次进入能绑定路径
    2. 错误态和空态都可读
    3. 有显式刷新入口
  - 怎么验证：
    - 前端人工走查
    - 定向测试
  - 对应需求：`requirements.md` 需求 1、需求 4、需求 6
  - 对应设计：`design.md` §2.3.1、§5.3

- [x] 3.2.1 收口文档库主链路样式改造范围
  - 状态：DONE
  - 这一步到底做什么：只把真实文档库主链路必需的样式补齐，包括绑定入口、空态、错误态、刷新态、列表和详情区，不借机无限扩样式范围。
  - 做完你能看到什么：事务视图文档库主链路能看、能用，而且样式统一，但不会把本轮拖成整页重画。
  - 先依赖什么：3.2
  - 开始前先看：
    - 前端页面与样式设计规范
    - 如涉及模态框，再看模态框与按钮设计规范
    - `design.md` §3.1.1
  - 主要改哪里：
    - `apps/user-app` 文档库相关样式和文案
    - 对应 i18n 字典
  - 这一步先不做什么：不处理与真实文档库主链路无关的纯审美改造。
  - 怎么算完成：
    1. 绑定入口、空态、错误态、刷新态都统一可读
    2. 左中右三块与真实文档库链路相关的样式完整
  - 怎么验证：
    - 人工走查
    - 定向前端测试
  - 对应需求：`requirements.md` 需求 7.2
  - 对应设计：`design.md` §3.1.1

- [x] 3.2.2 升级事务视图助手初始化逻辑
  - 状态：DONE
  - 这一步到底做什么：把右侧助手初始化从“默认沿用代码会话语境”改成“先判断文档库绑定，再判断是否已有真实文档对象”。
  - 做完你能看到什么：事务视图第一次打开时，助手就站在正确语境里，不再像旧助手页残留。
  - 先依赖什么：3.2
  - 开始前先看：
    - `design.md` §2.3.1
    - `design.md` §3.1.2
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
  - 主要改哪里：
    - `apps/user-app` 事务视图右侧详情/助手初始化逻辑
    - 对应 i18n 字典
  - 这一步先不做什么：不重写 Butler/助手底层运行时。
  - 怎么算完成：
    1. 未绑定时有明确空上下文初始化态
    2. 已绑定未选中文档时有明确等待选择态
    3. 有真实文档对象时自动切到真实对象语境
  - 怎么验证：
    - 人工走查
    - 定向前端测试
  - 对应需求：`requirements.md` 需求 7.1、需求 7
  - 对应设计：`design.md` §2.3.1、§3.1.2

### 最终检查

- [x] 3.3 最终检查点
  - 状态：DONE
  - 这一步到底做什么：确认事务视图文档库主链路已经站稳，而且索引重活没有把 Host 拖回去。
  - 做完你能看到什么：这条链路已经能交付，不是“看起来差不多”。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本 spec 全部相关文件
  - 这一步先不做什么：不追加新需求。
  - 怎么算完成：
    1. 真实文档库主链路跑通
    2. Host 索引服务和后台任务链路可验证
    3. 已知缺口和后续项写清楚
  - 怎么验证：
    - 文档走查
    - 关键 API / 前端 / 任务链路验证
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
