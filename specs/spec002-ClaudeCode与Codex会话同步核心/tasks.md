# 任务清单 - ClaudeCode与Codex会话同步核心（人话版）

状态：Draft

## 这份文档是干什么的

这份清单用来保证我们把 `spec002` 真正做完，而不是“写了很多字但主链路没跑通”。

每个任务都必须能回答：

- 这一步做什么
- 做完能看到什么
- 依赖什么
- 主要改哪些文件
- 明确不做什么
- 怎么验证

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，等待复核
- `DONE`：完成并验证通过
- `CANCELLED`：取消并写明原因

规则：

- 只有 `状态：DONE` 的任务可以勾选 `[x]`
- 每完成一个任务，必须立刻回写本文件状态
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因和后续处理

---

## 阶段 1：先把会话同步骨架搭起来

- [ ] 1.1 固定 provider 范围与注册机制
  - 状态：TODO
  - 这一步到底做什么：建立 `provider-registry`，并在启动时只注册 `claude-code` 和 `codex`。
  - 做完你能看到什么：系统不会加载第三个 provider，非法 provider 会被直接拒绝。
  - 先依赖什么：`spec001` 的 Host 启动框架已可用。
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §1.3、§2.2、§3.3.1
  - 主要改哪里：
    - `packages/session-sync-core/provider-registry/*`
    - `packages/session-sync-core/providers/claude-code/*`
    - `packages/session-sync-core/providers/codex/*`
  - 这一步先不做什么：不接入其他 provider，不做 UI 逻辑。
  - 怎么算完成：
    1. 仅两个 provider 可用
    2. 非法 provider 返回 `PROVIDER_NOT_SUPPORTED`
  - 怎么验证：
    - 单元测试：registry 白名单校验
    - 集成测试：非法 provider 请求失败
  - 对应需求：需求 1
  - 对应设计：§1.3、§2.2、§3.3.1

- [ ] 1.2 建立会话映射与索引存储结构
  - 状态：TODO
  - 这一步到底做什么：实现 `SessionBinding`、`SessionIndex`、`SessionStatusSnapshot` 的持久层。
  - 做完你能看到什么：系统能保存会话映射、索引和状态快照。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 7
    - `design.md` §3.2、§4.1
  - 主要改哪里：
    - `packages/session-sync-core/session-index-repo/*`
    - `packages/session-sync-core/migrations/*`（如当前工程有迁移目录）
  - 这一步先不做什么：不落原始消息正文，不做消息全文缓存。
  - 怎么算完成：
    1. 三类模型可读写
    2. 数据结构中没有“原始消息全文”字段
  - 怎么验证：
    - 持久层测试：CRUD + 唯一约束 + 外键约束
    - 检查 schema：仅索引/状态/映射字段
  - 对应需求：需求 2、需求 7
  - 对应设计：§3.2、§4.1、§6.1

- [ ] 1.3 阶段检查：骨架完整性
  - 状态：TODO
  - 这一步到底做什么：检查 provider 白名单和索引模型是否站稳。
  - 做完你能看到什么：可以进入历史读取和实时同步开发，不带结构性坑。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关文件
  - 这一步先不做什么：不提前做续接、新建和 WebSocket 细节。
  - 怎么算完成：
    1. 两个 provider 可用且受限
    2. 存储边界符合“只存索引和状态”
  - 怎么验证：
    - 人工走查 + 阶段回归测试
  - 对应需求：需求 1、需求 2、需求 7
  - 对应设计：§2.2、§3.2、§4.1

---

## 阶段 2：打通发现、历史读取、实时订阅

- [ ] 2.1 完成会话发现与分页历史读取
  - 状态：TODO
  - 这一步到底做什么：实现 `detectSessions` 与 `readSessionHistory` 主链路，支持分页和稳定顺序。
  - 做完你能看到什么：客户端可以看到工作区会话列表，并能分页读历史。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.3.1、§3.3.2、§3.3.3
  - 主要改哪里：
    - `packages/session-sync-core/session-discovery/*`
    - `packages/session-sync-core/session-sync-service/*`
    - `apps/host/src/routes/sessions/*`
  - 这一步先不做什么：不做 UI 排版和消息样式。
  - 怎么算完成：
    1. 会话列表可按工作区返回
    2. 历史读取支持 `cursor + limit`
  - 怎么验证：
    - 集成测试：两个 provider 的发现和分页读取
    - 异常测试：provider 不可用时错误码正确
  - 对应需求：需求 3
  - 对应设计：§2.3.1、§3.3.2、§3.3.3

- [ ] 2.2 完成实时订阅、去重和断线补齐
  - 状态：TODO
  - 这一步到底做什么：实现 `realtime-bridge`，支持增量消息推送、去重、重连补偿。
  - 做完你能看到什么：客户端断线后重连不会丢消息，也不会重复刷屏。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3.2、§3.3.7、§4.2
  - 主要改哪里：
    - `packages/session-sync-core/realtime-bridge/*`
    - `apps/host/src/ws/session-channel/*`
  - 这一步先不做什么：不做多 provider 泛化，不加第三方消息总线。
  - 怎么算完成：
    1. 实时消息事件按统一模型推送
    2. 断线重连后可按游标补齐
  - 怎么验证：
    - 集成测试：断线重连场景
    - 稳定性测试：重复消息去重
  - 对应需求：需求 4
  - 对应设计：§2.3.2、§3.3.7、§4.2

- [ ] 2.3 阶段检查：同步主链路可运行
  - 状态：TODO
  - 这一步到底做什么：把发现、历史、实时三段串起来回放一遍。
  - 做完你能看到什么：会话同步核心链路能完整跑通。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` §2.3、§7
  - 主要改哪里：本阶段相关文件
  - 这一步先不做什么：不做续接/新建能力和 capability 细节。
  - 怎么算完成：
    1. 工作区会话可发现
    2. 历史读取和实时同步都可验证
  - 怎么验证：
    - 端到端回放：发现 -> 读历史 -> 订阅 -> 重连补齐
  - 对应需求：需求 3、需求 4
  - 对应设计：§2.3、§7.2、§7.3

---

## 阶段 3：续接、新建、能力描述与收口

- [ ] 3.1 完成续接与新建会话链路
  - 状态：TODO
  - 这一步到底做什么：实现 `resumeSession` 与 `startSession` 接口，保障映射一致性。
  - 做完你能看到什么：用户可以续接已有会话，也可以从系统内新建会话。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.3、§3.3.4、§3.3.5
  - 主要改哪里：
    - `packages/session-sync-core/session-sync-service/*`
    - `apps/host/src/routes/sessions/*`
  - 这一步先不做什么：不扩展到第三个 provider。
  - 怎么算完成：
    1. 续接成功后状态快照更新
    2. 新建成功后映射写入完整
  - 怎么验证：
    - 集成测试：resume/start 成功和失败分支
    - 一致性测试：映射唯一性
  - 对应需求：需求 5、需求 7
  - 对应设计：§2.3.3、§3.3.4、§3.3.5、§6.3

- [ ] 3.2 完成 capability descriptor 输出
  - 状态：TODO
  - 这一步到底做什么：实现 provider 与会话级能力描述接口，输出限制说明。
  - 做完你能看到什么：前端可以按能力描述做门控，不需要 provider 名字特判。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §3.2.5、§3.3.6、§6.2
  - 主要改哪里：
    - `packages/session-sync-core/capability-service/*`
    - `apps/host/src/routes/providers/*`
  - 这一步先不做什么：不在后端写 UI 逻辑，不对前端组件做硬编码约束。
  - 怎么算完成：
    1. provider 能力接口可返回完整字段
    2. 不支持能力有清晰 `limitations`
  - 怎么验证：
    - 契约测试：字段完整性和类型
    - 集成测试：不同 provider 能力差异输出
  - 对应需求：需求 6
  - 对应设计：§3.2.5、§3.3.6、§6.2

- [ ] 3.3 鉴权与边界收口
  - 状态：TODO
  - 这一步到底做什么：确认本 Spec 涉及的 API 与 WebSocket 都走受保护路径。
  - 做完你能看到什么：未登录不能访问会话核心能力，边界清晰。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 非功能需求 4
    - `design.md` §1.3、§3.3、§5
  - 主要改哪里：
    - `apps/host/src/routes/sessions/*`
    - `apps/host/src/routes/providers/*`
    - `apps/host/src/ws/session-channel/*`
  - 这一步先不做什么：不重做认证系统本体（由 `spec001` 负责）。
  - 怎么算完成：
    1. 未登录请求被拒绝
    2. WebSocket 未鉴权握手失败
  - 怎么验证：
    - 集成测试：401/403 场景
    - WebSocket 鉴权测试
  - 对应需求：非功能需求 4
  - 对应设计：§1.3、§3.3.7、§5

- [ ] 3.4 最终检查点
  - 状态：TODO
  - 这一步到底做什么：按需求逐条验收，确认 spec002 可进入实现迭代。
  - 做完你能看到什么：需求、设计、任务、验证证据可以一一对应。
  - 先依赖什么：3.1、3.2、3.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/README.md`
  - 主要改哪里：当前 Spec 全部文件
  - 这一步先不做什么：不追加新需求，不扩范围。
  - 怎么算完成：
    1. 五条硬约束全部有落实证据
    2. 关键风险有应对策略
    3. 后续接手人能直接开工
  - 怎么验证：
    - 需求验收清单逐条核对
    - 核心回归测试通过
  - 对应需求：需求 1-7 + 非功能需求
  - 对应设计：`design.md` 全文
