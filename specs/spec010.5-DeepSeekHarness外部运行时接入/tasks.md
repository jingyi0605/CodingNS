# 任务清单 - DeepSeek Harness 外部运行时接入（人话版）

状态：Completed

## 这份文档是干什么的

这份任务清单用于把 Harness 接入拆成可以单独执行和验收的工作单元。每个任务都写清楚要解决的问题、主要文件、明确不做什么以及完成后的验证方式。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`。
- `BLOCKED` 必须写清楚卡在哪里以及恢复条件。
- 每完成一个任务，必须立刻回写本文件。
- 实现任务验证通过后，先创建符合 `类型：名称` 格式的实现提交，再回写完整 Commit ID。
- 任务记录回写使用独立提交：`文档：回写任务 <任务编号> 提交记录`。

---

## 阶段 1：先把 Harness 运行环境和协议边界固定下来

### 1.1 固定 Harness 版本并建立可重复的协议夹具

- [x] 1.1 固定 Harness 版本并建立可重复的协议夹具
  - 状态：DONE
  - 业务解释：先把外部依赖的版本和请求格式固定住，后面协议变化时才能知道是 Harness 变了还是 CodingNS 改坏了。
  - 这一步到底做什么：记录允许使用的 Harness 版本、启动命令、HTTP JSON-RPC envelope、WebSocket frame，并建立 fake Harness server 夹具。
  - 做完你能看到什么：测试可以不依赖真实模型，稳定模拟 `session.create/history/prompt/cancel/respond` 和 mux/host 事件。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3、需求 6
    - `design.md` §1.3、§3.3、§4.3、§7.2
    - Harness 仓库 `README.md` 的 Developer Preview 说明
  - 主要改哪里：
    - `packages/session-sync-core/`（Provider 类型和测试夹具入口）
    - `apps/host/tests/fixtures/` 或现有外部运行时测试夹具目录
    - `specs/spec010.5-DeepSeekHarness外部运行时接入/docs/20260814-Harness协议与版本基线.md`
  - 这一步先不做什么：不启动真实模型，不实现 ProviderAdapter，不把 Harness 源码依赖引入 CodingNS。
  - 怎么算完成：
    1. 允许版本、Node/命令要求和协议路径已经写入文档。
    2. fake server 能返回成功、业务错误、rpcId 不匹配、未知事件和断线场景。
  - 怎么验证：
    - 针对 fake server 的单元测试。
    - 人工检查测试夹具没有读取真实密钥和用户工作区。
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 6
  - 对应设计：`design.md` §1.3、§3.3、§7.2、§8.2
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；

### 1.2 实现 sidecar 生命周期管理

- [x] 1.2 实现 sidecar 生命周期管理
  - 状态：DONE
  - 业务解释：用户不应该先手工启动 Harness；Host 也不能因为启动失败把整个 CodingNS 拖死。
  - 这一步到底做什么：实现按需启动、loopback 端口分配、健康检查、退出回收、版本读取和进程所有权判断。
  - 做完你能看到什么：第一次使用 Harness 时自动拉起 sidecar，关闭 Host 后只回收自己启动的进程。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 7
    - `design.md` §2.2、§4.2.1、§5.3
    - `specs/spec001.2-后端任务调度与主线程压力治理/20260412-后台任务接入规范.md`
    - `apps/host/src/modules/tasks/` 的 TaskManager 接入样例
  - 主要改哪里：
    - `apps/host/src/modules/sessions/deepseek-harness/deepseek-harness-sidecar-manager.ts`
    - `apps/host/src/modules/sessions/deepseek-harness/deepseek-harness-task-types.ts`
    - `apps/host/src/modules/tasks/`（仅注册统一任务，不新增私有重试队列）
    - Windows/Unix 进程测试文件
  - 这一步先不做什么：不实现会话调用，不实现 WebSocket 事件恢复，不支持远程 Harness 地址。
  - 怎么算完成：
    1. sidecar 只绑定 `127.0.0.1`，非 loopback 配置直接拒绝。
    2. 启动超时、退出、重复启动和 Host shutdown 都有明确状态与日志。
    3. 健康检查和重启任务使用稳定 taskType/key，并能被观测。
  - 怎么验证：
    - sidecar manager 单元测试。
    - `pnpm --dir apps/host test -- --run tests/integration/deepseek-harness-sidecar-manager.test.ts`（实现后）
    - TaskManager 去重、超时和取消测试。
  - 对应需求：`requirements.md` 需求 1、需求 7
  - 对应设计：`design.md` §2.2、§2.3.1、§4.2.1、§5.3
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；

### 阶段检查

- [x] 1.3 阶段 1 检查：协议和 sidecar 可以独立验证
  - 状态：DONE
  - 业务解释：确认外部依赖已经被隔离，避免后面的适配器建立在不确定的启动和协议基础上。
  - 这一步到底做什么：检查版本基线、fake server、sidecar 生命周期和 TaskManager 接入是否齐全。
  - 做完你能看到什么：可以在不接入会话主链路的情况下稳定启动或拒绝 Harness。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md` §1、§2、§7
    - `tasks.md` 阶段 1 全部任务
  - 主要改哪里：阶段 1 相关文件和验证文档
  - 这一步先不做什么：不新增会话能力，不修改前端入口。
  - 怎么算完成：
    1. 真实 sidecar 不可用时，测试可以使用 fake server 完成协议验证。
    2. 失败不会阻塞现有 Provider 的 Host 启动。
  - 怎么验证：
    - 阶段 1 单元和集成测试。
    - 人工走查任务观测和日志字段。
  - 对应需求：`requirements.md` 需求 1、需求 7
  - 对应设计：`design.md` §2、§5、§7
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；

---

## 阶段 2：接入会话、历史和实时事件

### 2.1 实现 HTTP JSON-RPC 客户端和用户工作区绑定

- [x] 2.1 实现 HTTP JSON-RPC 客户端和用户工作区绑定
  - 状态：DONE
  - 业务解释：把 Harness 的请求格式封装起来，并确保每一次调用都知道“谁在访问哪个工作区的哪个会话”。
  - 这一步到底做什么：实现 envelope 校验、rpcId 校验、业务错误解析、session binding 创建读取和路径边界校验。
  - 做完你能看到什么：适配器可以安全调用 Harness，跨用户或任意 cwd 请求会在发出请求前失败。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 5、需求 7
    - `design.md` §3.2.2、§3.3.1、§3.3.3、§5
    - `apps/host/src/modules/auth/` 和 workspace 权限校验实现
  - 主要改哪里：
    - `apps/host/src/modules/sessions/deepseek-harness/deepseek-harness-api-client.ts`
    - `apps/host/src/modules/sessions/deepseek-harness/deepseek-harness-session-binding-store.ts`
    - 现有 session index/repository（仅补缺失字段）
    - 相关错误定义和集成测试
  - 这一步先不做什么：不转换消息，不打开前端 Provider 入口，不实现 WebSocket。
  - 怎么算完成：
    1. 成功、HTTP 错误、业务错误、协议错误和 rpcId 不匹配有不同结果。
    2. binding 一对一约束、userId 校验和 workspace 路径边界有测试。
    3. sidecar URL、API key 和本机绝对路径不会进入用户可见错误。
  - 怎么验证：
    - API client 单元测试。
    - binding store 用户隔离和路径越界集成测试。
  - 对应需求：`requirements.md` 需求 2、需求 5、需求 7
  - 对应设计：`design.md` §3.2.2、§3.3.1、§3.3.3、§5.2
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；

### 2.2 实现 ProviderAdapter 的发现、历史和能力矩阵

- [x] 2.2 实现 ProviderAdapter 的发现、历史和能力矩阵
  - 状态：DONE
  - 业务解释：让 Harness 会话能进入 CodingNS 现有会话列表和历史读取流程，同时明确哪些按钮不能开放。
  - 这一步到底做什么：实现 `deepseek-harness` Provider 的会话发现、历史分页、标题、模型目录和 `ProviderCapabilities`，并拒绝首版不支持的操作。
  - 做完你能看到什么：会话列表和历史服务可以读到 Harness 会话，能力接口不会显示删除、Diff 等假能力。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 6
    - `design.md` §3.2.4、§3.3.5、§3.4、§4.3
    - `packages/session-sync-core/src/types.ts`
    - `packages/session-sync-core/src/registry.ts`
    - `apps/host/src/modules/sessions/session-history-service.ts`
  - 主要改哪里：
    - `packages/session-sync-core/src/providers/deepseek-harness.ts`
    - `apps/host/src/modules/sessions/deepseek-harness/deepseek-harness-message-mapper.ts`
    - Provider registry 和 capability catalog 注册位置
    - ProviderAdapter 单元和会话历史集成测试
  - 这一步先不做什么：不实现实时运行、不实现跨 Provider Fork、不实现删除和收藏。
  - 怎么算完成：
    1. `detectSessions` 只返回当前用户和工作区可见的 Harness 会话。
    2. `readSessionHistory` 能把 Harness cursor/seq 转成 CodingNS HistoryPage。
    3. `canResumeSession`、`supportsSessionDelete`、`supportsSessionDiff` 等首版限制准确返回 false。
  - 怎么验证：
    - `pnpm --dir apps/host test -- --run tests/integration/deepseek-harness-provider.test.ts`（实现后）
    - `pnpm --dir packages/session-sync-core test -- --run src/providers/deepseek-harness.test.ts`（实现后）
  - 对应需求：`requirements.md` 需求 2、需求 6
  - 对应设计：`design.md` §3.2.4、§3.3.5、§3.4、§4.3
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”；补充会话标题读取回归断言已通过。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c、b7be35a180abaef931237656d685ed077890f67c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；修复：修正Harness会话标题读取；

### 2.3 实现实时事件桥和断线恢复

- [x] 2.3 实现实时事件桥和断线恢复
  - 状态：DONE
  - 业务解释：让用户看到的文本和工具结果不会因为 WebSocket 断线而丢失或重复。
  - 这一步到底做什么：实现 mux/host 两条下行 WebSocket、事件转换、按 session 分发、history 补洞、去重和重新订阅。
  - 做完你能看到什么：Harness 实时输出能进入 CodingNS `/ws`，断开连接后恢复出来的消息仍然连续。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4、需求 7
    - `design.md` §2.3.3、§3.3.2、§4.2.2、§4.3
    - `specs/spec001.2-后端任务调度与主线程压力治理/20260412-后台任务接入规范.md`
    - `apps/host/src/ws/ws-server.ts`
  - 主要改哪里：
    - `apps/host/src/modules/sessions/deepseek-harness/deepseek-harness-event-bridge.ts`
    - `apps/host/src/modules/sessions/deepseek-harness/deepseek-harness-runtime-adapter.ts`
    - `apps/host/src/modules/sessions/session-live-runtime-router-service.ts`
    - `/ws` envelope 转换和事件恢复测试
  - 这一步先不做什么：不改前端组件，不实现真实模型验证，不添加每会话私有无限重连 timer。
  - 怎么算完成：
    1. mux/host socket 各只有一个 sidecar 级订阅，并按 session id 分发。
    2. 断线后先 history 补齐，再重新订阅；重复事件不会重复广播。
    3. 恢复任务使用 TaskManager，读接口不偷偷触发重扫描。
  - 怎么验证：
    - fake WebSocket 事件桥单元测试。
    - 断线、乱序、重复、未知 frame 和恢复失败集成测试。
    - CodingNS `/ws` 订阅回归测试。
  - 对应需求：`requirements.md` 需求 3、需求 4、需求 7
  - 对应设计：`design.md` §2.3.3、§3.3.2、§4.2.2、§5.3、§6.2
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”。
    - 2026-08-14 真实凭据回归发现首轮订阅竞态：模型已完成但 mux/host 订阅尚未连接，导致输出漏进 CodingNS。现已改为订阅就绪后才发送 `session.prompt`，并补充快速完成回归测试。
    - 2026-08-14 流式消息回归：Harness 的 `assistant/chunk` 会按 `turn + step + block index` 归并为稳定消息 ID，`reasoning-delta` 映射为思考消息，`text-delta` 映射为正式消息；最终 `assistant/message` 使用相同 ID 覆盖增量内容。桥接层每 32ms 合并增量，避免单 token 触发一次 Host 持久化。
    - 2026-08-14 真实 sidecar 结构核对：已从本机 `dsh web` 读取历史，确认上游实际发送 `block-start.blockType`、`reasoning-delta`、`text-delta`、`block-end.block` 和含 `reasoning`、`text` 内容块的最终 `assistant/message`，与适配器字段一致。
    - 2026-08-14 真实 sidecar 回放：当前构建产物把一条已有的最终 Harness 消息拆成 2 条 CodingNS 消息，分别为 `thinking`（134 字，`part=0`）和 `text`（101 字，`part=1`）；验证过程未发送模型提示词，也未输出原始对话内容。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；

### 阶段检查

- [x] 2.4 阶段 2 检查：会话主链路和实时事件跑通
  - 状态：DONE
  - 业务解释：确认 Harness 已经不只是“能发请求”，而是能在 CodingNS 的现有会话模型里连续工作。
  - 这一步到底做什么：用 fake Harness 完成创建、历史、实时消息、运行状态和断线恢复的完整流程回放。
  - 做完你能看到什么：CodingNS 现有会话列表、历史和 `/ws` 能看到一条完整 Harness 会话。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` §2.3、§3、§4、§6
    - `tasks.md` 阶段 2 全部任务
  - 主要改哪里：阶段 2 相关实现和测试记录
  - 这一步先不做什么：不扩展 UI，不开放高级能力，不处理 Harness 未提供的接口。
  - 怎么算完成：
    1. 事件和历史的 seq 单调，断线恢复不重复。
    2. 其他 Provider 的主链路回归不受影响。
  - 怎么验证：
    - Provider、Runtime、WebSocket 相关最小测试集。
    - 记录一份 `docs/20260814-主链路联调记录.md`。
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 7
  - 对应设计：`design.md` §2、§3、§4、§6
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；

---

## 阶段 3：补齐工具、权限和产品入口

### 3.1 接入工具、权限、问题询问、附件和队列

- [x] 3.1 接入工具、权限、问题询问、附件和队列
  - 状态：DONE
  - 业务解释：让 Harness 的 Agent 行为能使用 CodingNS 已有的确认和消息界面，而不是在产品里出现第二套交互。
  - 这一步到底做什么：完成 tool call/result、approval/question、`/api/respond`、图片附件、queue/steer/cancel 的转换和权限校验。
  - 做完你能看到什么：工具调用、权限确认、问题回答、附件发送和运行中中断都能走 CodingNS 既有接口。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` §2.3.4、§3.3.1、§4.3、§5.3
    - `apps/host/src/modules/sessions/session-permission-request-service.ts`
    - `apps/host/src/modules/sessions/session-message-attachment-service.ts`
  - 主要改哪里：
    - `apps/host/src/modules/sessions/deepseek-harness/deepseek-harness-event-bridge.ts`
    - `apps/host/src/modules/sessions/deepseek-harness/deepseek-harness-message-mapper.ts`
    - `apps/host/src/modules/sessions/session-live-runtime-service.ts`
    - 权限、附件和队列集成测试
  - 这一步先不做什么：不开放任意文件读取，不绕过 CodingNS 权限服务，不实现 MCP 管理。
  - 怎么算完成：
    1. tool call/result 能按 callId 配对并显示正确状态。
    2. approval/question 回复只使用原始 rpcId，通过 `/api/respond` 完成。
    3. 附件大小、类型和 workspace 权限在 Host 侧先校验。
  - 怎么验证：
    - 权限请求和回复集成测试。
    - 附件发送、读取和越界测试。
    - queue/steer/cancel 运行时回归测试。
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §2.3.4、§3.3.1、§4.3、§5.3
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；

### 3.2 接入 Fork、模型、Subagent 和受限归档

- [x] 3.2 接入 Fork、模型、Subagent 和受限归档
  - 状态：DONE
  - 业务解释：把 Harness 已经提供但语义有边界的高级能力接入，同时把限制直接告诉用户。
  - 这一步到底做什么：接入 session.fork、session.models/selectModel、subagent RPC，并按实际条件决定是否映射 workspace archive。
  - 做完你能看到什么：用户可以在支持的范围内 Fork、切换 Harness 模型、查看 Subagent；不支持的跨 Provider Fork 会被拒绝。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 6
    - `design.md` §3.2.4、§3.3.5、§3.4
    - `apps/host/src/modules/sessions/session-controller.ts` 的 Fork 和 capability 处理
    - `apps/user-app` provider 能力显示规范（实现 UI 前必须阅读项目指定前端设计规范）
  - 主要改哪里：
    - `packages/session-sync-core/src/providers/deepseek-harness.ts`
    - `apps/host/src/modules/sessions/deepseek-harness/`
    - Provider catalog/capability 返回模块
    - 相关前端 Provider 列表和能力提示（如确有需要）
  - 这一步先不做什么：不把 Harness 的模型目录冒充 CodingNS 全局模型目录，不实现收藏、删除、Diff、Share。
  - 怎么算完成：
    1. Fork 明确只接受 Harness 已完成 turn 的语义。
    2. 模型切换只影响 Harness 会话内部，不覆盖 CodingNS 其他 Provider 配置。
    3. Subagent 访问经过 user/session binding 校验。
  - 怎么验证：
    - Fork、模型切换、Subagent capability 集成测试。
    - 如修改 user-app，执行对应组件单测和人工走查。
  - 对应需求：`requirements.md` 需求 2、需求 6
  - 对应设计：`design.md` §3.2.4、§3.3.5、§3.4、§8.2
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；

### 3.3 补齐 Provider 可见性和错误提示

- [x] 3.3 补齐 Provider 可见性和错误提示
  - 状态：DONE
  - 业务解释：让用户看到 Harness 是否可用、哪些能力受限，避免点进一个必然失败的入口。
  - 这一步到底做什么：把 `deepseek-harness` 接入现有 Provider catalog、能力矩阵和会话入口，显示 sidecar 不可用及能力受限状态。
  - 做完你能看到什么：设置和会话入口可以识别 Harness；sidecar 未安装、未启动或能力不支持时有明确提示。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 6、需求 7
    - `design.md` §3.2.4、§5.1、§5.2
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
    - `specs/spec010.4-CLI提供商启用控制与能力矩阵/`
  - 主要改哪里：
    - `apps/host/src/modules/provider/`
    - `apps/user-app/src/features/conversation/`
    - `apps/user-app/src/features/settings/`
    - `apps/user-app/src/i18n/`
  - 这一步先不做什么：不新增独立的 Harness 管理页面，不让前端直连 sidecar，不把暂不支持的能力显示成可用。
  - 怎么算完成：
    1. Provider catalog 能表达安装、运行和能力受限状态。
    2. 现有 Provider picker 不会把 Harness 的内部模型列表混入其他 Provider。
    3. 错误提示使用统一 i18n 字典，不写硬编码显示文本。
  - 怎么验证：
    - Provider catalog 和会话入口单测。
    - `pnpm --dir apps/user-app test -- ...` 点名运行受影响测试（实现后）。
    - 人工检查桌面端和移动端入口。
  - 对应需求：`requirements.md` 需求 1、需求 6、需求 7
  - 对应设计：`design.md` §3.2.4、§5.1、§5.2、§7
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；
    - 2026-08-14 回归修复：Provider runtime state 统一从 `deepseekHarnessCliPath` 探测 Harness。catalog 返回解析后的可执行文件路径；会话入口把 `deepseek-harness` 纳入可选 Provider。未安装时明确显示“未检测到”，不再显示“状态未知”。

### 阶段检查

- [x] 3.4 阶段 3 检查：用户能用统一入口完成核心工作
  - 状态：DONE
  - 业务解释：确认新增 Provider 没有长出第二套界面和错误口径。
  - 这一步到底做什么：按创建、发送、工具、权限、附件、中断、Fork 和能力提示路径做一次完整回放。
  - 做完你能看到什么：Harness 体验与 CodingNS 现有 Provider 使用同一套入口和状态表达。
  - 先依赖什么：3.1、3.2、3.3
  - 开始前先看：
    - `requirements.md`
    - `design.md` §3、§4、§5、§7
    - `tasks.md` 阶段 3 全部任务
  - 主要改哪里：阶段 3 相关实现、测试和验收记录
  - 这一步先不做什么：不新增能力，不扩展到远程 Harness。
  - 怎么算完成：
    1. 核心路径均能追踪到具体 Harness RPC 或事件。
    2. 不支持能力在前端、Host 和 Provider capability 三处口径一致。
  - 怎么验证：
    - 最小端到端测试集。
    - 人工走查和 `docs/20260814-主链路联调记录.md` 更新。
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 4、需求 6
  - 对应设计：`design.md` §2、§3、§4、§7
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；

---

## 阶段 4：回归、文档和发布前验收

### 4.1 完成专项测试、观测和联调文档

- [x] 4.1 完成专项测试、观测和联调文档
  - 状态：DONE
  - 业务解释：把这次外部运行时接入变成以后能复查、能回滚、能交接的能力，而不是只能靠现场记忆维护。
  - 这一步到底做什么：补齐单元、集成、端到端测试，记录任务观测、错误样例、版本基线和故障恢复方法。
  - 做完你能看到什么：维护者能从日志和文档判断问题发生在 sidecar、RPC、事件恢复还是 CodingNS 自身。
  - 先依赖什么：3.4
  - 开始前先看：
    - `requirements.md` 全部需求
    - `design.md` §5、§6、§7、§8
    - `specs/spec001.2-后端任务调度与主线程压力治理/20260412-后台任务接入规范.md`
  - 主要改哪里：
    - `apps/host/tests/integration/`
    - `packages/session-sync-core/src/providers/` 测试
    - `specs/spec010.5-DeepSeekHarness外部运行时接入/docs/20260814-主链路联调记录.md`
    - `specs/spec010.5-DeepSeekHarness外部运行时接入/docs/20260814-故障恢复与回滚说明.md`
  - 这一步先不做什么：不扩大功能范围，不把真实用户凭据写入测试或文档。
  - 怎么算完成：
    1. 核心链路、断线恢复、权限、隔离和不支持能力均有自动化验证。
    2. 任务观测能看到 enqueue、dedupe、started、finished、failed、timeout。
    3. 文档记录固定版本、启动前提、已知限制和回滚步骤。
  - 怎么验证：
    - 按变更文件运行 `pnpm test:related -- <变更文件>` 或仓库对应最小测试命令。
    - 运行 Harness 专项集成测试并保留结果。
    - 人工走查日志脱敏和故障恢复。
  - 对应需求：`requirements.md` 需求 1、需求 3、需求 5、需求 7
  - 对应设计：`design.md` §5、§6、§7、§8
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；

### 最终检查

- [x] 4.2 最终检查：Harness 接入可安全交付
  - 状态：DONE
  - 业务解释：确认这次接入满足可交付标准，不把版本、隔离和不支持能力的风险留到用户现场。
  - 这一步到底做什么：逐条核对需求、设计、任务、测试和文档，确认其他 Provider 无回归。
  - 做完你能看到什么：Spec 可以进入 Approved/In Progress，后续 Codex 能按任务直接执行，不需要重新猜边界。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件、验收记录和必要的实现文件
  - 这一步先不做什么：不新增远程访问、不承诺删除/收藏/Diff/Share。
  - 怎么算完成：
    1. 每条需求都能追踪到设计章节、任务和验证证据。
    2. 所有完成任务均已回写验证结论、实现 Commit ID 和提交信息。
    3. 已知风险、待确认项和回滚路径已经写清楚。
  - 怎么验证：
    - 按 Spec 规范第 9 节逐项自检。
    - 运行本轮最小必要测试集。
    - 维护者人工审阅需求、设计和任务追踪关系。
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
  - 任务结果：
    - 验证结论：通过，详见文末“统一验证记录”。
    - 实现提交 ID：92ff90da80f1282ea12b71d335e8aaf8cf5cb53c
    - 实现提交信息：功能：spec010.5-接入DeepSeek Harness本机运行时；

## 统一验证记录

- 2026-08-14 真实运行时验证：固定提交 `47f943859bef60e4160492346772ded9b24f765a` 已完整构建，`dsh --version` 返回 `0.1.0-rc.5`。通过 `DeepSeekHarnessSidecarManager` 实际启动 `dsh web`，完成 `host.describe` 和 `session.create`，关闭后 sidecar 状态为 `stopped`。`host.describe.version` 返回上游占位值 `0.0.1`，版本校验以 CLI 输出为准。未发送模型 prompt，真实模型回答仍依赖 Harness 自身凭据。
- 2026-08-14 真实凭据回归：用户配置凭据并发送消息后，Harness `session.history` 记录了第二轮的连续 `assistant/chunk`、最终 `assistant/message` 和 `turn/end`，证明模型实际成功返回。问题是 CodingNS 在下行订阅完成前发出了 `session.prompt`，导致快速完成的事件没有转发。现已等待两条订阅就绪后再发 prompt；`pnpm --dir apps/host test -- tests/integration/deepseek-harness-provider.test.ts tests/integration/deepseek-harness-sidecar-manager.test.ts` 通过，9 项测试全部通过；其中新增快速完成不丢消息回归。
- 2026-08-14 Provider 可见性回归：`pnpm --dir apps/host test -- provider-catalog-routes.test.ts provider-cli-availability.test.ts` 通过，7 项测试全部通过；覆盖 Harness 的版本号和可执行文件路径。
- 2026-08-14 前端入口和能力表：`pnpm --dir apps/user-app test -- ProviderManagementPanel.test.tsx SessionProviderPicker.test.tsx provider-ui.test.ts` 通过，24 项测试全部通过；`pnpm --dir apps/user-app build` 通过。
- 2026-08-14 流式与思考消息修复（当前工作区，尚未单独提交）：`pnpm --dir apps/host exec vitest run --root ../../packages/session-sync-core tests/deepseek-harness-provider.test.mjs` 通过，3/3；`pnpm exec vitest run tests/integration/deepseek-harness-provider.test.ts`（在 `apps/host`）通过，8/8，覆盖思考/正文 token 累积、稳定消息 ID、最终消息覆盖和快速完成不丢输出；`env NODE_ENV=test pnpm exec vitest run src/features/conversation/components/MessageTimeline.test.tsx -t "DeepSeek Harness 的思考和正式回复会按消息类型分开渲染"`（在 `apps/user-app`）通过，1/1。当前终端的全局 `NODE_ENV=production` 会使 React 测试加载生产构建，因此前端测试必须只为测试进程覆盖为 `test`。
- 2026-08-14 构建与真实回放：`pnpm build`（在 `apps/host`，包含核心包构建）通过。通过本机已运行的 `dsh web` 只读读取 6 个会话的历史，确认上游事件字段；当前构建产物将一条实际 `assistant/message` 映射为 `thinking`（134 字，`part=0`）和 `text`（101 字，`part=1`）两条消息，未打印对话正文。
- 核心包构建：`pnpm -C packages/session-sync-core build` 通过。
- Host 类型检查：`pnpm exec tsc -p tsconfig.json --noEmit`（在 `apps/host`）通过。
- Host 专项集成测试：`pnpm test:all -- tests/integration/deepseek-harness-provider.test.ts tests/integration/deepseek-harness-sidecar-manager.test.ts`（在 `apps/host`）通过，7 项测试全部通过。
- 核心包适配器测试：`pnpm --filter @codingns/session-sync-core exec vitest run tests/deepseek-harness-provider.test.mjs` 通过，2 项测试全部通过。
- SQLite 规则：`pnpm check:sqlite-runtime` 通过；`git diff --cached --check` 通过。
- 当前 pnpm 10.7.1 不兼容仓库里遗留的 `pnpm --dir` 传参形式，Host 默认测试包装器会在启动子进程时返回 `spawn EINVAL`。本轮已先构建核心包，再通过 Host 的 `test:all` 脚本精确执行专项测试；这不影响测试结论。
- 2026-08-15 会话刷新状态恢复：`session.list.running=false` 只表示运行停止，不再直接当作成功。Host 刷新历史会读取 Harness 最后一条 `turn/end` 作为权威终态，分别写回 `completed`、`failed`、`interrupted`，并在成功或中断时清除遗留的 `SUBSCRIBE_FAILED`、`PROVIDER_READ_FAILED`；历史分页只使用 Harness sequence cursor。已验证：`pnpm --dir packages/session-sync-core build`、核心适配器测试 11/11、Host DSH 运行时测试 11/11、状态恢复测试 10/10、Host 类型检查和 `git diff --check` 均通过。
- 2026-08-15 运行时终态实时收敛：`ActiveRunRegistry` 的监听器按队列异步投递，`ProviderRuntimeService` 现在会在正常完成、运行异常和启动异常时先等待该会话已排队的监听器写完，再释放 active run。这样 Harness 的 `turn/end` 终态会立刻落库，不会继续显示旧的红色失败指示器直到下一轮刷新。已验证：核心包构建通过；运行时服务测试 6/6（含“队列被前一事件占住时完成态仍会投递”回归）；Host DSH 专项测试 11/11；会话运行时集成测试 70/70。
- 2026-08-15 完成态订阅误报修复（当前工作区，尚未单独提交）：完成事件与 SQLite 状态写入之间存在竞态，历史订阅遇到 `PROVIDER_NOT_SUPPORTED` 时不能把有效的 DeepSeek Harness binding 改写为 `SUBSCRIBE_FAILED`。现在仅对该 provider 的这个内部适配器错误停止历史轮询、清空旧同步错误并保持 `idle`；真正的模型失败和其他 provider 错误不受影响。已验证：状态恢复测试 11/11（覆盖运行态尚未写回的竞态）、Harness 专项测试 11/11、Host 类型检查和 `git diff --check` 均通过；运行中的开发 Host 已自动重载，当前已索引的 5 条 DSH 会话均为终态且没有残留同步错误。
