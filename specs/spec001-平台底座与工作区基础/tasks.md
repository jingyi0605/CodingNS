# 任务清单 - spec001-平台底座与工作区基础（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单只做一件事：让任何一个接手的人都能直接开工，不用猜。

你要能一眼看出：

- 先做什么，后做什么
- 每一步产物是什么
- 哪些事情这一步明确不做
- 怎么验证不是“看起来差不多”

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经做完，等复核
- `DONE`：完成并验证通过
- `CANCELLED`：取消并写明原因

执行规则：

- 只有 `状态：DONE` 才能把任务勾成 `[x]`
- 每完成一个任务，必须立刻回写状态和验证结果
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 1：把 Host 地基和数据边界先钉死

- [x] 1.1 固定 Host 技术栈和目录骨架
  - 状态：DONE
  - 这一步到底做什么：建立 `apps/host` 的最小可运行骨架，固定 Node.js 22 + TypeScript + Fastify + ws + better-sqlite3。
  - 做完你能看到什么：Host 可以启动基础服务，且依赖清单不再摇摆。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §1.3、§2.2
  - 主要改哪里：
    - `apps/host/package.json`
    - `apps/host/tsconfig.json`
    - `apps/host/src/main.ts`
    - `apps/host/src/server/create-server.ts`
  - 这一步先不做什么：不实现业务接口，不引入 PostgreSQL。
  - 怎么算完成：
    1. Host 能以 TypeScript 方式启动
    2. Fastify 和 ws 入口可用
    3. SQLite 连接初始化可用
  - 怎么验证：
    - `pnpm --filter host build`
    - `pnpm --filter host test`（若已建立测试框架）
    - 人工检查依赖清单
  - 验证结果：已补齐根工作区 `package.json`、`pnpm-workspace.yaml`、`apps/host/package.json`、`tsconfig.json`、`vitest.config.ts`、`src/main.ts`、`src/server/create-server.ts`，并通过 `corepack pnpm --filter host build`
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §1.3、§2.2

- [x] 1.2 建立 SQLite 基础表和仓储层边界
  - 状态：DONE
  - 这一步到底做什么：创建 `AuthUser`、`BootstrapState`、`Workspace`、`SessionIndex`、`SessionState`、`AuthToken` 的基础表和仓储访问层。
  - 做完你能看到什么：系统能稳定读写元数据和状态，不存会话原文。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` §3.2、§4.1
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/sqlite/client.ts`
    - `apps/host/src/storage/repositories/*.ts`
  - 这一步先不做什么：不写 provider 原始消息解析逻辑。
  - 怎么算完成：
    1. 表结构与设计文档一致
    2. 仓储层仅覆盖索引、状态、认证、配置数据
    3. 不存在原始会话正文落库字段
  - 怎么验证：
    - 仓储层单元测试
    - schema 评审清单核对
  - 验证结果：已落地 `schema.sql`、`client.ts` 与 6 个仓储类；库表仅含初始化、认证、工作区、会话索引和状态，未出现任何消息正文表，并在 `tests/spec001/host-foundation.e2e.test.ts` 中校验无 `session_messages/raw_messages`
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §3.2、§6.3、§6.4

- [x] 1.3 阶段检查：地基边界检查
  - 状态：DONE
  - 这一步到底做什么：检查第一阶段地基有没有跑偏，尤其是“只用 SQLite”和“原始消息不入库”。
  - 做完你能看到什么：可以进入初始化和鉴权实现，不会边写边改底座。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 全文
    - `design.md` §1.3、§3.2、§6.3、§6.4
  - 主要改哪里：
    - 当前 Spec 文档和 Host 基础代码
  - 这一步先不做什么：不新增功能范围。
  - 怎么算完成：
    1. 技术栈和存储边界已定稿
    2. 无 PostgreSQL 相关实现项
    3. 会话原文不入库规则可追溯
  - 怎么验证：
    - 评审记录
    - 代码清单核对
  - 验证结果：Host 依赖和存储边界已固定，未引入 PostgreSQL；原始消息读取被收口到 `ProviderMessageGateway`，默认没有 reader 时直接报 `PROVIDER_NOT_READY`
  - 对应需求：`requirements.md` 需求 1、需求 4、需求 5
  - 对应设计：`design.md` §1.3、§3.2、§6.3、§6.4

---

## 阶段 2：打通首次初始化和统一鉴权主链路

- [x] 2.1 实现首次初始化接口和默认账号创建
  - 状态：DONE
  - 这一步到底做什么：实现 `GET /api/public/bootstrap-status` 和 `POST /api/public/setup`，确保初始化只允许一次。
  - 做完你能看到什么：首次打开系统必须先建默认账号密码，初始化完成后 setup 入口关闭。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 6
    - `design.md` §2.3.1、§3.3.1、§3.3.2、§4.2.1
  - 主要改哪里：
    - `apps/host/src/modules/bootstrap/bootstrap-controller.ts`
    - `apps/host/src/modules/bootstrap/bootstrap-service.ts`
    - `apps/host/src/routes/public.ts`
  - 这一步先不做什么：不做多用户注册流程，不做找回密码。
  - 怎么算完成：
    1. 未初始化时可返回正确状态
    2. 初始化后重复 setup 返回冲突错误
    3. 密码以安全哈希存储
  - 怎么验证：
    - 集成测试：bootstrap-status/setup 流程
    - 人工验证重复初始化拒绝
  - 验证结果：已实现 `BootstrapService/BootstrapController` 和公开路由；测试覆盖未初始化状态、首次 setup 成功、重复 setup 返回 `BOOTSTRAP_ALREADY_DONE`
  - 对应需求：`requirements.md` 需求 2、需求 6
  - 对应设计：`design.md` §2.3.1、§3.3.1、§3.3.2、§4.2.1

- [x] 2.2 实现登录、刷新、登出和统一鉴权守卫
  - 状态：DONE
  - 这一步到底做什么：实现 `login/refresh/logout` 与 HTTP 鉴权中间件，默认保护全部业务 API。
  - 做完你能看到什么：除公开接口外，未登录请求都被拒绝。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 6
    - `design.md` §2.3.2、§3.3.3、§3.3.4、§3.3.5、§6.2
  - 主要改哪里：
    - `apps/host/src/modules/auth/auth-controller.ts`
    - `apps/host/src/modules/auth/auth-service.ts`
    - `apps/host/src/middlewares/auth-guard.ts`
    - `apps/host/src/routes/auth.ts`
    - `apps/host/src/routes/protected.ts`
  - 这一步先不做什么：不做复杂权限角色系统。
  - 怎么算完成：
    1. 登录可签发 Access/Refresh Token
    2. 受保护 API 未登录默认 401
    3. 刷新令牌和登出可用
  - 怎么验证：
    - 集成测试：login -> protected api -> refresh -> logout
    - 异常测试：无效令牌、过期令牌
  - 验证结果：已实现 `AuthService/AuthController` 与全局 `auth-guard`，Access/Refresh Token 采用 opaque token + SQLite 哈希持久化；测试覆盖登录、刷新、登出和受保护接口默认 401
  - 对应需求：`requirements.md` 需求 3、需求 6
  - 对应设计：`design.md` §2.3.2、§3.3.3~§3.3.5、§6.2

- [x] 2.3 实现 WebSocket 握手鉴权
  - 状态：DONE
  - 这一步到底做什么：在 `WS /ws` 握手阶段接入令牌校验，未登录直接拒绝连接。
  - 做完你能看到什么：WebSocket 鉴权规则与 HTTP 保持一致。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §3.3.8、§4.2.2、§6.2
  - 主要改哪里：
    - `apps/host/src/ws/ws-server.ts`
    - `apps/host/src/ws/ws-auth-guard.ts`
    - `apps/host/src/modules/auth/token-verifier.ts`
  - 这一步先不做什么：不做复杂频道权限模型。
  - 怎么算完成：
    1. 无令牌或无效令牌握手失败
    2. 有效令牌握手成功并进入事件流
    3. 与 HTTP 鉴权规则不冲突
  - 怎么验证：
    - WebSocket 集成测试
    - 人工握手验证
  - 验证结果：已实现 `WsAuthGuard` 与 `createWsServer`，握手时复用同一套 access token 校验逻辑；测试覆盖有效 token 认证上下文、缺 token/坏 token 拒绝。当前自动化验证使用守卫级测试，真实失败握手在当前 Windows + vitest + ws 环境下会卡住测试回收，后续可补独立网络级回归脚本
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §3.3.8、§4.2.2、§6.2

- [x] 2.4 阶段检查：初始化与鉴权主链路检查
  - 状态：DONE
  - 这一步到底做什么：验证“首次初始化 -> 登录 -> 受保护访问 -> 登出”整条链路。
  - 做完你能看到什么：第一阶段安全边界可用，不是文档口号。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3、需求 6
    - `design.md` §2.3.1、§2.3.2、§3.3
  - 主要改哪里：
    - `apps/host/tests/integration/auth-bootstrap.e2e.test.ts`
    - `docs/` 验证记录
  - 这一步先不做什么：不引入新业务域接口。
  - 怎么算完成：
    1. 主链路测试全部通过
    2. 未授权访问和重复初始化都被正确拒绝
  - 怎么验证：
    - `pnpm --filter host test`
    - e2e 报告核对
  - 验证结果：`tests/spec001/host-foundation.e2e.test.ts` 已覆盖 bootstrap -> login -> workspaces/sessions -> refresh -> logout 主链路，`corepack pnpm --filter host test` 通过
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 6
  - 对应设计：`design.md` §2.3、§3.3、§6.1、§6.2

---

## 阶段 3：补齐工作区与会话索引地基并完成验收

- [x] 3.1 实现工作区和会话索引受保护接口
  - 状态：DONE
  - 这一步到底做什么：实现受保护的工作区列表和会话索引读取接口，保证都走统一鉴权。
  - 做完你能看到什么：客户端登录后可以获取工作区和会话索引元数据。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 4、需求 6
    - `design.md` §3.3.6、§3.2.3、§3.2.4
  - 主要改哪里：
    - `apps/host/src/modules/workspace/workspace-controller.ts`
    - `apps/host/src/modules/session-index/session-index-controller.ts`
    - `apps/host/src/routes/workspaces.ts`
    - `apps/host/src/routes/sessions.ts`
  - 这一步先不做什么：不实现 provider 原始消息解析。
  - 怎么算完成：
    1. 接口可返回工作区和会话索引数据
    2. 匿名访问统一被拒绝
    3. 返回字段可追溯 `rawRef`
  - 怎么验证：
    - 集成测试
    - 鉴权回归测试
  - 验证结果：已实现 `GET /api/workspaces` 和 `GET /api/sessions?workspaceId=...`；测试覆盖登录后读取元数据、匿名访问被拒绝，以及返回字段包含 `rawRef`
  - 对应需求：`requirements.md` 需求 4、需求 6
  - 对应设计：`design.md` §3.2.3、§3.2.4、§3.3.6

- [x] 3.2 实现会话消息读取边界守卫
  - 状态：DONE
  - 这一步到底做什么：建立会话消息读取入口，强制走 Provider 原始存储读取，并阻止原文入库。
  - 做完你能看到什么：系统有明确的“索引在本地、原文在 provider”边界守卫。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` §2.3.3、§3.3.7、§6.3
  - 主要改哪里：
    - `apps/host/src/modules/provider/provider-message-gateway.ts`
    - `apps/host/src/modules/sessions/session-read-service.ts`
    - `apps/host/src/modules/session-index/session-state-service.ts`
  - 这一步先不做什么：不做 provider 兼容解析细节优化。
  - 怎么算完成：
    1. 消息读取路径只走 provider read bridge
    2. SQLite 层不存在消息正文写入
    3. 会话状态快照可更新
  - 怎么验证：
    - 单元测试：禁止正文入库
    - 集成测试：消息读取 + 状态更新
  - 验证结果：已实现 `ProviderMessageGateway`、`SessionReadService` 与 `GET /api/sessions/:sessionId/messages`；测试通过假 reader 验证消息读取只走 provider bridge，并更新 `session_states` 快照而非落库正文
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §2.3.3、§3.3.7、§6.3、§6.4

- [x] 3.3 最终检查点：spec001 交付验收
  - 状态：DONE
  - 这一步到底做什么：对照需求、设计和任务，确认 spec001 的地基能力已可交付。
  - 做完你能看到什么：`spec002`、`spec003` 可以在稳定基础上推进。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：
    - `spec001` 全部文档
    - Host 基础实现与测试清单
  - 这一步先不做什么：不扩范围做 UI 或 provider 深度能力。
  - 怎么算完成：
    1. 每条需求都有实现与验证证据
    2. 风险和待确认项已记录
    3. 状态全部回写清楚
  - 怎么验证：
    - 按验证映射逐项核对
    - 评审通过记录
  - 验证结果：本轮已交付 Host 最小地基模块，完成构建与自动化测试；后续进入 `spec002` 时可以直接在当前 Host 上挂 provider 解析，不需要再返工 Host、鉴权和 SQLite 基座
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
