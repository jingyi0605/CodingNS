# 任务清单 - spec010.3-KimiCLI兼容接入（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单用来把 Kimi 接入拆成真正能执行的步骤。

它优先回答这些问题：

1. Kimi 该走哪条主链路，哪些只是 fallback
2. 哪些公共硬编码必须先拆
3. 历史、运行时、运行中引导和 fixture 怎么排顺序
4. 什么时候 Kimi 才算真接完

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

## 阶段 0：先把 Kimi 的真实边界摸实

- [x] 0.1 收集 Kimi 官方资料并确认三条链路边界
  - 状态：DONE
  - 这一步到底做什么：确认 Kimi 官方公开了哪些运行时协议、哪些本地数据结构，不靠猜。
  - 做完你能看到什么：
    - 已确认官方存在 `wire mode`
    - 已确认官方存在命令模式和 `stream-json`
    - 已确认本地会话目录及 `context.jsonl / wire.jsonl / state.json`
  - 先依赖什么：无
  - 开始前先看：
    - Kimi 官方文档
  - 主要改哪里：
    - `specs/spec010.3-KimiCLI兼容接入/requirements.md`
    - `specs/spec010.3-KimiCLI兼容接入/design.md`
  - 这一步先不做什么：不开始写接入代码。
  - 怎么算完成：
    1. 主链路、fallback、发现链路边界明确
    2. 已知风险写清楚
  - 怎么验证：
    - 文档核对
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 6、需求 8
  - 对应设计：`design.md` §2.1、§4.3、§4.4

- [x] 0.2 建立 spec010.3 初稿并锁定主接入路线
  - 状态：DONE
  - 这一步到底做什么：把 Kimi 接入的目标、范围、主链路、fallback 和禁止事项写成正式 Spec。
  - 做完你能看到什么：`README.md`、`requirements.md`、`design.md`、`tasks.md` 已建立，方向从讨论变成正式文档。
  - 先依赖什么：0.1
  - 开始前先看：
    - `spec010`
    - `spec010.1`
  - 主要改哪里：
    - `specs/spec010.3-KimiCLI兼容接入/*`
  - 这一步先不做什么：不实现 Kimi provider。
  - 怎么算完成：
    1. Spec 主文档齐全
    2. 已明确 `wire mode` 为主链路
  - 怎么验证：
    - 文档自检
    - 总览索引更新
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

---

## 阶段 1：先拆掉 Kimi 接入前的硬障碍

- [ ] 1.1 清理前后端 provider 硬编码残留
  - 状态：TODO
  - 这一步到底做什么：把偏好、UI 元数据、样式、DTO、状态机里残留的三家写死逻辑继续收口。
  - 做完你能看到什么：Kimi 作为第四或第五家 provider 可以合法进入主链路。
  - 先依赖什么：0.2
  - 开始前先看：
    - `apps/user-app/src/features/conversation/capability/provider-ui.ts`
    - `apps/user-app/src/preferences/*`
    - `apps/host/src/modules/preferences/profile-service.ts`
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/capability/*`
    - `apps/user-app/src/preferences/*`
    - `apps/host/src/modules/preferences/*`
    - `apps/host/src/types/domain.ts`
  - 这一步先不做什么：先不接 Kimi 真实运行时。
  - 怎么算完成：
    1. Kimi 可作为合法 provider 出现在主链路
    2. 不新增新一轮散落 provider 特判
  - 怎么验证：
    - TypeScript 类型检查
    - 前端相关单测
  - 对应需求：`requirements.md` 需求 1、需求 4、需求 5
  - 对应设计：`design.md` §4.1

- [ ] 1.2 增加 Kimi Host 配置、路径解析和配置文件读取
  - 状态：TODO
  - 这一步到底做什么：为 Kimi CLI 增加 Host 配置项、命令路径解析和基础 model/config 读取能力。
  - 做完你能看到什么：Host 能稳定找到 Kimi CLI，并能读取默认模型配置。
  - 先依赖什么：1.1
  - 开始前先看：
    - `apps/host/src/config/env.ts`
  - 主要改哪里：
    - `apps/host/src/config/env.ts`
    - `apps/host/src/modules/provider/*`
  - 这一步先不做什么：先不实现 wire 通讯。
  - 怎么算完成：
    1. Kimi CLI 路径可配置
    2. 基础模型配置可读取
  - 怎么验证：
    - 配置单测
    - 本机配置读取验证
  - 对应需求：`requirements.md` 需求 2、需求 4、需求 5
  - 对应设计：`design.md` §4.7、§8.4

- [ ] 1.3 阶段检查：Kimi 进入主链路前的地基就绪
  - 状态：TODO
  - 这一步到底做什么：确认 Kimi 不会再被类型、配置或偏好层卡死。
  - 做完你能看到什么：后续实现 Kimi adapter/runtime 不再先和基础层打架。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - 当前阶段相关代码和测试
  - 主要改哪里：当前阶段相关文件
  - 这一步先不做什么：不接 Kimi 历史和运行时。
  - 怎么算完成：
    1. Kimi 可注册
    2. Kimi 配置可解析
  - 怎么验证：
    - 类型检查
    - 人工走查硬编码
  - 对应需求：`requirements.md` 需求 1、需求 5
  - 对应设计：`design.md` §3.1、§4.1

---

## 阶段 2：接 Kimi 的会话发现和历史读取

- [ ] 2.1 实现 Kimi 会话发现
  - 状态：TODO
  - 这一步到底做什么：扫描本地会话目录，统一产出 Kimi session 列表。
  - 做完你能看到什么：项目能发现 Kimi 原生会话。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §4.2、§4.3
  - 主要改哪里：
    - `packages/session-sync-core/src/providers/kimi.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
  - 这一步先不做什么：先不接实时运行时。
  - 怎么算完成：
    1. 会话发现结果使用 Kimi 原生 session id
    2. 能按工作区正确过滤
  - 怎么验证：
    - KimiAdapter 单测
    - 本地样本发现测试
  - 对应需求：`requirements.md` 需求 3、需求 7
  - 对应设计：`design.md` §4.2、§4.3

- [ ] 2.2 实现 Kimi 历史读取和消息归一化
  - 状态：TODO
  - 这一步到底做什么：从 `context.jsonl / wire.jsonl / state.json` 恢复历史，并映射到统一消息模型。
  - 做完你能看到什么：Kimi 会话可以回读历史。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` §4.3、§4.5
  - 主要改哪里：
    - `packages/session-sync-core/src/providers/kimi.ts`
    - `packages/session-sync-core/src/types.ts`
  - 这一步先不做什么：先不承诺 token usage。
  - 怎么算完成：
    1. 文本、thinking、tool 事件能正确归一化
    2. 解析失败会返回结构化错误
  - 怎么验证：
    - 历史样本 fixture 测试
  - 对应需求：`requirements.md` 需求 3、需求 4、需求 8
  - 对应设计：`design.md` §4.3、§4.5、§6.2

- [ ] 2.3 阶段检查：Kimi 可以作为“只读 provider”安全进入系统
  - 状态：TODO
  - 这一步到底做什么：确认在运行时接入前，Kimi 已具备规范的会话发现和历史读取能力。
  - 做完你能看到什么：就算运行时还没接，历史层已经是干净的。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - 当前阶段相关代码和测试
  - 主要改哪里：当前阶段相关文件
  - 这一步先不做什么：不接 wire mode。
  - 怎么算完成：
    1. 可发现
    2. 可读历史
  - 怎么验证：
    - 集成测试
    - 人工走查 rawRef 语义
  - 对应需求：`requirements.md` 需求 3、需求 7
  - 对应设计：`design.md` §4.2、§4.3

---

## 阶段 3：接 Kimi 真实运行时

- [ ] 3.1 实现 Kimi Wire RuntimeAdapter
  - 状态：TODO
  - 这一步到底做什么：通过 wire mode 打通新建、恢复、prompt、中断和事件流。
  - 做完你能看到什么：Kimi 运行时主链路正式可用。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4
    - `design.md` §4.4、§4.6
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/kimi-runtime.ts`
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
  - 这一步先不做什么：先不做所有高级 UI。
  - 怎么算完成：
    1. 可创建 Kimi 原生会话
    2. 可恢复同一原生会话
    3. 可中断运行
  - 怎么验证：
    - Runtime 单测
    - 非破坏性本地联调
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 4
  - 对应设计：`design.md` §4.2、§4.4、§5.2

- [ ] 3.2 实现 Kimi 运行中引导与提问映射
  - 状态：TODO
  - 这一步到底做什么：把 Kimi 的运行中引导、提问或 steer 类能力映射进现有系统。
  - 做完你能看到什么：Kimi 不会被错误压成 `inRunInputMode = none`。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §4.4.2、§4.6
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/kimi-runtime.ts`
    - `apps/host/src/modules/sessions/session-permission-request-service.ts`
    - `apps/user-app/src/features/conversation/*`
  - 这一步先不做什么：先不做所有复杂问答表单。
  - 怎么算完成：
    1. 能表达运行中输入能力
    2. 有清晰降级策略
  - 怎么验证：
    - 集成测试
    - capability 断言
  - 对应需求：`requirements.md` 需求 4、需求 6
  - 对应设计：`design.md` §4.4.2、§4.6

- [ ] 3.3 实现 Kimi 命令模式 fallback
  - 状态：TODO
  - 这一步到底做什么：当 wire mode 不可用时，回退到命令模式和 `stream-json`。
  - 做完你能看到什么：Kimi 运行时不会因为主链路异常彻底失能。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 6、需求 8
    - `design.md` §4.4.3、§6.2
  - 主要改哪里：
    - `packages/session-sync-core/src/runtime/kimi-runtime.ts`
    - `apps/host/src/modules/sessions/session-provider-error-mapper.ts`
  - 这一步先不做什么：先不做所有平台的复杂恢复策略。
  - 怎么算完成：
    1. fallback 可明确启用
    2. fallback 来源可观测
  - 怎么验证：
    - fallback 集成测试
  - 对应需求：`requirements.md` 需求 2、需求 6、需求 8
  - 对应设计：`design.md` §4.4.3、§6.2

- [ ] 3.4 补齐 Kimi capability、前端入口和基础 UI
  - 状态：TODO
  - 这一步到底做什么：把 Kimi provider 卡片、图标、能力门控和模型选择接起来。
  - 做完你能看到什么：Kimi 能在前端正常创建、查看和继续会话。
  - 先依赖什么：3.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 4
    - `design.md` §4.6、§4.7
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/*`
    - `apps/user-app/src/assets/provider-icons/*`
  - 这一步先不做什么：先不做专属富 UI。
  - 怎么算完成：
    1. 草稿会话可选 Kimi
    2. capability 生效
  - 怎么验证：
    - 前端单测
    - 手工联调
  - 对应需求：`requirements.md` 需求 1、需求 4、需求 5
  - 对应设计：`design.md` §4.1、§4.6、§4.7

---

## 阶段 4：样本、回归和验收

- [ ] 4.1 沉淀 Kimi fixture 样本
  - 状态：TODO
  - 这一步到底做什么：沉淀 `context.jsonl / wire.jsonl / state.json` 样本和 wire mode 运行时样本。
  - 做完你能看到什么：Kimi 接入不再建立在猜测上。
  - 先依赖什么：3.4
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §5.1、§7
  - 主要改哪里：
    - `packages/session-sync-core/tests/fixtures/kimi/*`
  - 这一步先不做什么：不追求一次性覆盖所有边角能力。
  - 怎么算完成：
    1. 核心场景样本齐
    2. 样本可脱敏
  - 怎么验证：
    - fixture 回放测试
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §5.1、§7

- [ ] 4.2 完成 Kimi 集成验收
  - 状态：TODO
  - 这一步到底做什么：验证 Kimi 的发现、历史、运行时、运行中引导和 fallback 都真的可用。
  - 做完你能看到什么：Kimi 可以正式标记为可交付 provider。
  - 先依赖什么：4.1
  - 开始前先看：
    - 当前 spec 全部文档
  - 主要改哪里：
    - `specs/spec010.3-KimiCLI兼容接入/tasks.md`
    - `specs/spec010.3-KimiCLI兼容接入/docs/*`
  - 这一步先不做什么：不继续扩 Kimi 高级能力。
  - 怎么算完成：
    1. 验收清单走完
    2. 任务状态回写
  - 怎么验证：
    - 集成联调
    - 验收记录
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` §7、§8
