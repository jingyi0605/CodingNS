# 任务清单 - spec010-Provider扩展框架（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单是为了保证我们以后加 provider 时，不会一边接一边把系统弄脏。

它要回答的不是“能不能再接一个 CLI”，而是：

- 新 provider 必须先补什么
- 哪些事情没做完就不准说接好了
- 怎么验证没有把既有链路打坏

---

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等待复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻更新本文件状态
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 1：先把扩展规矩写死

- [ ] 1.1 固化 provider 契约和 manifest 结构
  - 状态：TODO
  - 这一步到底做什么：把新增 provider 必须实现的接口、manifest 字段和目录结构固定下来。
  - 做完你能看到什么：后续接 provider 不再靠口头约定。
  - 先依赖什么：`spec001`、`spec002`
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §2.2、§3.2、§3.3.1
  - 主要改哪里：
    - `packages/session-sync-core/provider-contract/*`
    - `packages/session-sync-core/provider-manifest/*`
  - 这一步先不做什么：不实现新 provider。
  - 怎么算完成：
    1. 契约接口可落地
    2. manifest 字段和校验规则明确
  - 怎么验证：
    - 契约单元测试
    - manifest schema 校验测试
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §2.2、§3.2、§3.3.1

- [ ] 1.2 固化 capability descriptor 和兼容规则
  - 状态：TODO
  - 这一步到底做什么：把公共能力字段、limitations 规则和向后兼容约束固定下来。
  - 做完你能看到什么：前端以后只认 descriptor，不需要补 provider 名字特判。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 6
    - `design.md` §3.2.2、§3.2.5、§6.2
  - 主要改哪里：
    - `packages/shared-capabilities/*`
    - `packages/session-sync-core/compatibility/*`
  - 这一步先不做什么：不改 UI 主流程。
  - 怎么算完成：
    1. descriptor 公共字段冻结
    2. 破坏性变更规则可检查
  - 怎么验证：
    - 契约测试
    - compatibility checker 单元测试
  - 对应需求：`requirements.md` 需求 2、需求 6
  - 对应设计：`design.md` §3.2.2、§3.2.5、§6.2、§6.3

- [ ] 1.3 阶段检查：扩展边界检查
  - 状态：TODO
  - 这一步到底做什么：确认 provider 扩展规矩已经定死，不给后面留灰区。
  - 做完你能看到什么：后续新增 provider 时知道该走哪条线，不会临时乱改。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：当前 spec 全部相关文件
  - 这一步先不做什么：不开始接新 provider。
  - 怎么算完成：
    1. 契约、descriptor、兼容规则都可追溯
    2. 不存在“前端自己补特判”的灰区
  - 怎么验证：
    - 文档评审
    - 规则清单核对
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 6
  - 对应设计：`design.md` §2.2、§3.2、§6

---

## 阶段 2：把样本、回归和接入流程做成硬门槛

- [ ] 2.1 建立 provider fixture 样本规范和回放器
  - 状态：TODO
  - 这一步到底做什么：定义样本目录结构，建立原始输入、期望输出和能力样本的回放框架。
  - 做完你能看到什么：每个 provider 都可以跑固定样本回归。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` §2.3.3、§3.2.3、§3.2.4、§3.3.3
  - 主要改哪里：
    - `packages/session-sync-core/fixtures/*`
    - `packages/session-sync-core/testing/fixture-runner/*`
  - 这一步先不做什么：不接真实新 provider。
  - 怎么算完成：
    1. 样本目录结构清晰
    2. 可执行回放并比对期望输出
  - 怎么验证：
    - fixture-runner 集成测试
    - 示例样本回放
  - 对应需求：`requirements.md` 需求 3、需求 4
  - 对应设计：`design.md` §2.3.3、§3.2.3、§3.2.4、§3.3.3

- [ ] 2.2 建立新增 provider 接入清单和发布前检查
  - 状态：TODO
  - 这一步到底做什么：把“实现接口、补样本、跑回归、验收记录”做成固定清单。
  - 做完你能看到什么：接入是否完成可以一眼判断，不再靠感觉。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` §2.3.1、§2.3.3、§5.3
  - 主要改哪里：
    - `specs/spec010-Provider扩展框架/docs/`
    - `scripts/provider-checks/*`
  - 这一步先不做什么：不处理发布平台和市场机制。
  - 怎么算完成：
    1. 接入清单可复用
    2. 发布前检查项完整
  - 怎么验证：
    - 人工走查
    - checklist 演练
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §2.3.1、§2.3.3、§5.3

- [ ] 2.3 阶段检查：样本与回归门槛检查
  - 状态：TODO
  - 这一步到底做什么：确认“没有样本就不算接完”已经变成真规则。
  - 做完你能看到什么：后续 provider 接入不会再裸奔。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` §2.3.3、§7
  - 主要改哪里：当前 spec 相关脚本和文档
  - 这一步先不做什么：不开始适配第三方 provider。
  - 怎么算完成：
    1. 回归框架可运行
    2. 接入清单和验收流程可执行
  - 怎么验证：
    - fixture-runner 试运行
    - checklist 演练记录
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §2.3.3、§7

---

## 阶段 3：收口兼容性、降级与排错能力

- [ ] 3.1 实现 compatibility checker 和降级规则校验
  - 状态：TODO
  - 这一步到底做什么：检查 capability 字段演进、消息模型演进和未知字段降级行为。
  - 做完你能看到什么：新增 provider 或升级 provider 时，不会悄悄打坏现有客户端。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 6
    - `design.md` §3.2.5、§3.3.2、§6.2、§6.3
  - 主要改哪里：
    - `packages/session-sync-core/compatibility/*`
    - `packages/shared-capabilities/*`
  - 这一步先不做什么：不做 UI 页面调整。
  - 怎么算完成：
    1. 破坏性变更能被拦下
    2. 非破坏性扩展有明确降级策略
  - 怎么验证：
    - 兼容性测试
    - 前端门控联调验证
  - 对应需求：`requirements.md` 需求 2、需求 6
  - 对应设计：`design.md` §3.2.5、§6.2、§6.3

- [ ] 3.2 补齐 provider 级日志和排错信息
  - 状态：TODO
  - 这一步到底做什么：把 provider 标识、session id、rawRef、descriptor 版本这些排错信息打进日志和测试报告。
  - 做完你能看到什么：出了问题能直接定位到 provider 层，而不是全靠猜。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §5.1、§5.3、§7
  - 主要改哪里：
    - `packages/session-sync-core/logging/*`
    - `packages/session-sync-core/testing/reports/*`
  - 这一步先不做什么：不搭复杂监控平台。
  - 怎么算完成：
    1. 契约失败和样本失败都有结构化日志
    2. 运行期错误可定位到 provider 级别
  - 怎么验证：
    - 错误注入测试
    - 日志字段检查
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §5.1、§5.3、§7.2

- [ ] 3.3 最终检查：新增 provider 不污染主链路
  - 状态：TODO
  - 这一步到底做什么：从接入流程、样本、兼容性、排错四个角度确认这个扩展框架真的能用。
  - 做完你能看到什么：以后加 provider 时有规矩、有护栏、有验证，不会再一边接一边改主系统。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 spec 全部相关文件
  - 这一步先不做什么：不开始真正接第三个 provider。
  - 怎么算完成：
    1. 契约、样本、兼容、日志四块都能对上
    2. 有完整的接入和发布前检查文档
    3. 主界面和既有 provider 不需要被强制改写
  - 怎么验证：
    - 端到端演练一次“假想新 provider 接入”
    - 文档验收清单核对
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
