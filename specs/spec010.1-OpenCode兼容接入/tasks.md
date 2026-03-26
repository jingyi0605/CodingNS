# 任务清单 - spec010.1-OpenCode兼容接入（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单用来把 OpenCode 接入拆成真正能执行的步骤。

它优先回答这些问题：

1. 先拆什么，不拆就根本没法接
2. 第一阶段到底交付什么，不交付什么
3. 哪些任务已经完成了，哪些还只是嘴上说过
4. 怎么验证不是又搞出一堆 provider 特判

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

## 阶段 0：先把问题摸实，不要瞎设计

- [x] 0.1 收集本地 OpenCode 真实样本并确认存储边界
  - 状态：DONE
  - 这一步到底做什么：确认 OpenCode 在本机的真实数据目录、表结构和样本类型，不靠想象写 Spec。
  - 做完你能看到什么：已经确认本机存在 `~/.local/share/opencode/opencode.db`、`storage/session_diff/`、`log/`，并确认 `session/message/part` 等表和真实 part 类型。
  - 先依赖什么：无
  - 开始前先看：
    - 本机 OpenCode 数据目录
    - 当前仓库 provider 抽象实现
  - 主要改哪里：
    - `specs/spec010.1-OpenCode兼容接入/requirements.md`
    - `specs/spec010.1-OpenCode兼容接入/design.md`
  - 这一步先不做什么：不开始写接入代码。
  - 怎么算完成：
    1. 已确认真实数据目录
    2. 已确认 session/message/part 基本结构
    3. 已确认当前样本中出现的关键 part 类型
  - 怎么验证：
    - 读取本地 sqlite 和日志样本
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 7
  - 对应设计：`design.md` §2.1、§4.3、§5.1

- [x] 0.2 建立 spec010.1 初稿并锁定主接入路线
  - 状态：DONE
  - 这一步到底做什么：把 OpenCode 接入的目标、范围、主链路、兜底链路和禁止事项写成正式 Spec。
  - 做完你能看到什么：`README.md`、`requirements.md`、`design.md`、`tasks.md` 已建立，接入方向从“口头讨论”变成“正式文档”。
  - 先依赖什么：0.1
  - 开始前先看：
    - `spec010`
    - 当前 OpenCode 本地样本
  - 主要改哪里：
    - `specs/spec010.1-OpenCode兼容接入/*`
  - 这一步先不做什么：不实现 OpenCode provider。
  - 怎么算完成：
    1. Spec 主文档齐全
    2. 设计明确选择 server/sdk 为主链路
    3. 任务清单已回写已完成项
  - 怎么验证：
    - 文档自检
    - 总览索引更新
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

---

## 阶段 1：先拆掉第三家 provider 的硬障碍

- [ ] 1.1 拆 `ProviderId`、`ProviderRegistry` 和 DTO 的两家写死逻辑
  - 状态：TODO
  - 这一步到底做什么：把 session-sync-core、Host、前端 API DTO 中只允许两家 provider 的类型和注册逻辑改成真正可扩展。
  - 做完你能看到什么：OpenCode 至少能作为合法 provider 被系统识别，而不是一上来就被类型和注册表卡死。
  - 先依赖什么：0.2
  - 开始前先看：
    - `packages/session-sync-core/src/types.ts`
    - `packages/session-sync-core/src/registry.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
  - 主要改哪里：
    - `packages/session-sync-core/src/types.ts`
    - `packages/session-sync-core/src/registry.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
  - 这一步先不做什么：先不接 OpenCode 真实运行时。
  - 怎么算完成：
    1. provider 类型不再写死两家
    2. provider registry 支持第三家注册
    3. 前后端 DTO 可以接受 `opencode`
  - 怎么验证：
    - 类型检查
    - provider registry 单元测试
    - 前后端基础接口测试
  - 对应需求：`requirements.md` 需求 1、需求 5
  - 对应设计：`design.md` §3.1、§4.1

- [ ] 1.2 拆前端页面里的 provider 特判，把主流程收口到 capability
  - 状态：TODO
  - 这一步到底做什么：把会话草稿、输入框、模型选择、规则消息展示等地方的 provider 名字判断收口。
  - 做完你能看到什么：前端不会因为多一个 OpenCode 再补一堆散落判断。
  - 先依赖什么：1.1
  - 开始前先看：
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
    - `apps/user-app/src/features/conversation/components/MessageTimeline.tsx`
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
    - `apps/user-app/src/features/conversation/components/MessageTimeline.tsx`
    - `apps/user-app/src/features/conversation/capability/*`
  - 这一步先不做什么：先不补 OpenCode 专属富 UI。
  - 怎么算完成：
    1. 主流程不再依赖 provider 名字散落判断
    2. OpenCode 草稿会话可以安全进入主页面
  - 怎么验证：
    - 前端单元测试
    - 静态扫描 provider 特判
  - 对应需求：`requirements.md` 需求 1、需求 4、需求 5
  - 对应设计：`design.md` §4.1、§4.6

- [ ] 1.3 阶段检查：第三家 provider 的基础道路打通
  - 状态：TODO
  - 这一步到底做什么：确认 OpenCode 还没真正接入前，系统已经不再从类型层和页面层排斥第三家 provider。
  - 做完你能看到什么：后续 OpenCode 接入不再是“先和硬编码打架”。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - 当前阶段相关代码和测试
  - 主要改哪里：当前阶段相关文件
  - 这一步先不做什么：不碰 OpenCode server。
  - 怎么算完成：
    1. provider 第三家可以注册
    2. 前端主链路不再散落两家写死判断
  - 怎么验证：
    - 回归测试
    - 人工走查
  - 对应需求：`requirements.md` 需求 1、需求 5
  - 对应设计：`design.md` §3.1、§4.1

---

## 阶段 2：接 OpenCode 主链路，不走歪门邪道

- [ ] 2.1 实现 OpenCode provider 的会话发现和历史读取
  - 状态：TODO
  - 这一步到底做什么：优先通过 OpenCode 官方 server/sdk 打通 `/session` 和 `/session/:id/message` 相关读取。
  - 做完你能看到什么：项目能把 OpenCode 会话列出来，也能读出历史消息。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` §2.1、§4.3
  - 主要改哪里：
    - `packages/session-sync-core/src/providers/opencode.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
  - 这一步先不做什么：先不接实时运行时。
  - 怎么算完成：
    1. 能发现 OpenCode session
    2. 能读取 message 和 part
    3. 有稳定 `providerSessionId` 和 `rawRef`
  - 怎么验证：
    - 本地 OpenCode 样本联调
    - provider history 集成测试
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §4.2、§4.3

- [ ] 2.2 实现 OpenCode `part` 归一化和安全降级
  - 状态：TODO
  - 这一步到底做什么：把 `text`、`reasoning`、`tool`、`step-start`、`step-finish` 先映射好，并为更宽的 part 留出富内容扩展。
  - 做完你能看到什么：OpenCode 消息不会只剩一坨文本，工具和 reasoning 也有基本语义。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §4.5
  - 主要改哪里：
    - `packages/session-sync-core/src/providers/opencode.ts`
    - `packages/session-sync-core/src/types.ts`
    - `apps/user-app/src/features/conversation/message-rich-content.ts`
  - 这一步先不做什么：先不把所有 part 做成富展示组件。
  - 怎么算完成：
    1. 核心 part 类型可映射
    2. 未完全支持的 part 保留原始引用和类型
  - 怎么验证：
    - fixture 测试
    - 前端时间线渲染测试
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §4.5、§6.2

- [ ] 2.3 实现 OpenCode runtime：创建、发送、实时事件和中断
  - 状态：TODO
  - 这一步到底做什么：通过 OpenCode server 的 `session/message/event/abort` 链路，打通真实实时运行时。
  - 做完你能看到什么：项目里能真正启动和继续 OpenCode 会话，并收到流式事件。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 5
    - `design.md` §4.4、§5.2
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/opencode-runtime.ts`
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
  - 这一步先不做什么：先不做 `revert/share` UI。
  - 怎么算完成：
    1. `start-live` 可创建 OpenCode session
    2. 后续发送可继续同一原生 session
    3. 中断和状态事件可用
  - 怎么验证：
    - 本地 server 联调
    - runtime 集成测试
  - 对应需求：`requirements.md` 需求 2、需求 5
  - 对应设计：`design.md` §4.4、§5.2

- [ ] 2.4 阶段检查：OpenCode 主链路打通
  - 状态：TODO
  - 这一步到底做什么：确认 OpenCode 已经通过官方 server/sdk 主链路在项目里跑起来。
  - 做完你能看到什么：OpenCode 已经不只是“能读库”，而是真正 provider。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - 当前阶段相关代码和联调结果
  - 主要改哪里：当前阶段相关文件
  - 这一步先不做什么：先不扩高级能力 UI。
  - 怎么算完成：
    1. 会话发现、历史、实时运行都可用
    2. 未支持能力明确降级，不撒谎
  - 怎么验证：
    - 端到端联调
    - 回归测试
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 5
  - 对应设计：`design.md` §2、§4

---

## 阶段 3：把 OpenCode 特有能力收口到 capability

- [ ] 3.1 扩展 capability descriptor，表达 OpenCode 高级能力
  - 状态：TODO
  - 这一步到底做什么：补 `todo`、`diff`、`permission`、`fork`、`share`、`async prompt` 等能力字段。
  - 做完你能看到什么：前端能按能力门控，而不是继续按 provider 名字猜。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 4、需求 6
    - `design.md` §4.6
  - 主要改哪里：
    - `packages/session-sync-core/src/types.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
    - `apps/user-app/src/features/conversation/capability/*`
  - 这一步先不做什么：先不做所有能力的完整 UI。
  - 怎么算完成：
    1. capability 能表达 OpenCode 高级能力
    2. 老客户端能安全忽略未知字段
  - 怎么验证：
    - capability 契约测试
    - 前端门控测试
  - 对应需求：`requirements.md` 需求 4、需求 6
  - 对应设计：`design.md` §4.6

- [ ] 3.2 接入 `children/todo/diff/permission` 的基础读链路
  - 状态：TODO
  - 这一步到底做什么：把 OpenCode 高级能力至少做到可读、可追踪、可门控。
  - 做完你能看到什么：这些能力不会再是文档里说有，代码里完全没有。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §4.7
  - 主要改哪里：
    - `packages/session-sync-core/src/providers/opencode.ts`
    - `apps/host/src/modules/provider/*`
    - `apps/user-app/src/features/conversation/*`
  - 这一步先不做什么：先不承诺完整编辑交互。
  - 怎么算完成：
    1. 至少能读取相关能力数据
    2. capability 和 UI 降级行为一致
  - 怎么验证：
    - 集成测试
    - 人工联调
  - 对应需求：`requirements.md` 需求 6
  - 对应设计：`design.md` §4.7

- [ ] 3.3 阶段检查：OpenCode 高级能力边界收口
  - 状态：TODO
  - 这一步到底做什么：确认第一阶段交付边界已经清楚，没接的能力不会伪装成已支持。
  - 做完你能看到什么：产品和工程对 OpenCode 第一阶段范围有统一预期。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - 当前阶段相关代码和 capability 输出
  - 主要改哪里：当前阶段相关文件
  - 这一步先不做什么：不再扩新范围。
  - 怎么算完成：
    1. capability 和实际行为一致
    2. 降级说明清楚
  - 怎么验证：
    - 门控测试
    - 人工验收
  - 对应需求：`requirements.md` 需求 4、需求 6
  - 对应设计：`design.md` §4.6、§4.7

---

## 阶段 4：样本、回归和排错补齐

- [ ] 4.1 把本地 OpenCode 样本沉淀成 fixture
  - 状态：TODO
  - 这一步到底做什么：从真实本地库和日志抽取脱敏样本，作为长期回归基础。
  - 做完你能看到什么：以后 OpenCode 升级不是靠猜，而是靠样本回放。
  - 先依赖什么：3.3
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §5.1、§8.3
  - 主要改哪里：
    - `packages/session-sync-core/tests/fixtures/opencode/*`
    - `specs/spec010.1-OpenCode兼容接入/docs/*`
  - 这一步先不做什么：不引入多余样本管理平台。
  - 怎么算完成：
    1. 样本可脱敏
    2. 样本可回放
    3. 覆盖关键 part 类型
  - 怎么验证：
    - fixture runner
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §5.1、§8.3

- [ ] 4.2 补 OpenCode provider 回归、兼容和错误注入测试
  - 状态：TODO
  - 这一步到底做什么：把 OpenCode 的正常路径、降级路径和报错路径补齐测试。
  - 做完你能看到什么：以后不是“看起来能跑”，而是回归里真能拦住坏改动。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 7、需求 8
    - `design.md` §6、§8
  - 主要改哪里：
    - `packages/session-sync-core/tests/*`
    - `apps/host/tests/integration/*`
    - `apps/user-app/src/features/conversation/*.test.tsx`
  - 这一步先不做什么：不追求一次把所有 UI 细节都测满。
  - 怎么算完成：
    1. 主链路测试可用
    2. fallback 测试可用
    3. 错误注入可定位到 OpenCode 层
  - 怎么验证：
    - 测试套件运行
  - 对应需求：`requirements.md` 需求 7、需求 8
  - 对应设计：`design.md` §6、§8

- [ ] 4.3 最终检查：OpenCode 接入方案可实施、可回归、可排错
  - 状态：TODO
  - 这一步到底做什么：把这次 Spec 的落地前提全部检查一遍，确认后续实现不会再走偏。
  - 做完你能看到什么：OpenCode 接入从现在开始已经有清晰施工图，不是边写边猜。
  - 先依赖什么：4.1、4.2
  - 开始前先看：
    - `README.md`
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：当前 spec 全部相关文件
  - 这一步先不做什么：不在这里继续追加新需求。
  - 怎么算完成：
    1. 抽象拆分顺序清楚
    2. 主链路、兜底链路和降级边界清楚
    3. fixture 和回归策略清楚
  - 怎么验证：
    - 文档评审
    - 实现前走查
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
