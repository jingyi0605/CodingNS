# 设计文档 - spec003.5 会话分叉与消息级派生

状态：Draft

## 1. 概述

### 1.1 目标

- 把 `codingns` 的会话分叉从“只能识别已有父子关系”推进到“可以主动创建 fork”
- 第一阶段只实现消息级派生，不碰 Git worktree 和状态快照
- 优先利用 provider 原生 fork 能力，不强行自建完整权威原始会话账本
- 由平台统一维护父子关系和 fork 元数据，前后端展示标准一致

### 1.2 覆盖范围

- `packages/session-sync-core` 的 provider fork 能力抽象
- `apps/host` 的统一 fork 服务、元数据保存和前端 DTO
- `apps/user-app` 的消息级 fork 入口和父子会话展示

### 1.3 不覆盖范围

- Git worktree / shell / 文件副作用隔离
- 工具调用结果继承
- 完整消息账本重建
- 完整状态树恢复

## 2. 核心判断

### 【核心判断】

✅ 值得做：这不是假问题。用户真实需要“从某个历史节点继续聊”，而不是只会从当前最新节点重开一个会话。

### 【关键洞察】

- 数据结构：第一阶段真正需要平台自己托管的不是全部原始消息，而是**fork 元数据**
- 复杂度：三家 provider 的原生能力不一样，但只要把 fork 方法分级，外层接口就能统一
- 风险点：如果不记录 fork 锚点和 fork 方法，后面前端树显示、问题排查和 provider 扩展都会乱掉

## 3. 当前项目现状

### 3.1 已有基础

当前项目不是完全线性的，已经有会话树雏形：

1. SQLite `session_indices` 已有 `parent_session_id`
2. `apps/host/src/modules/sessions/session-history-service.ts` 会把 provider 的 `parentProviderSessionId` 映射成平台 `parentSessionId`
3. `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx` 已能按 `parentSessionId` 构树展示
4. `packages/session-sync-core/src/types.ts` 里已经有 `supportsSessionFork?: boolean`
5. `packages/session-sync-core/src/providers/opencode.ts` 已声明 `supportsSessionFork: true`

### 3.2 明确缺口

当前真正缺的不是“树形 UI”，而是主动 fork 能力：

1. `packages/session-sync-core/src/services.ts` 没有统一 `forkSession` 动作
2. 后端没有统一保存 fork 锚点、fork 方法、来源 message id
3. 当前父子关系主要来自 provider 现有记录，不是平台主动创建
4. 前端虽然能显示树，但没有“对某条历史消息发起 fork”的稳定入口

### 3.3 当前数据结构为什么不够用

现有结构勉强能表达“这个会话有个父会话”，但还远远不够：

- `parent_session_id` 只能表达父子关系，不能表达 fork 是从整场会话还是某条消息来的
- 当前没有统一字段区分 `native_session_fork` 和 `reconstructed_message_fork`
- 当前没有稳定字段记录来源 `messageId`
- 当前没有统一字段记录来源 provider 的 `providerSessionId` / `providerMessageId`

这就是典型的“先有半截关系，再靠猜补剩下一半”。这种设计很容易烂。

## 4. 本轮真实测试结果

以下结果均为 2026-04-10 的真实测试结论。

### 4.1 Codex

测试环境：

- CLI 版本：`codex-cli 0.118.0`
- 登录态：`codex login status` 可用

已验证能力：

1. `codex exec resume <thread_id>` 可继续原会话
2. `codex app-server` 的 `thread/fork` 可创建原生子线程
3. `thread/read` + `thread/resume(history=[截断后的历史])` 可实现按任意历史消息点派生

结论：

- 会话级 fork：可做
- 消息级 fork：可做
- 推荐接入路径：不要依赖交互式 `codex fork` TUI，优先走现有 app-server helper 进程

注意点：

- `thread/fork` 需要 `initialize.capabilities.experimentalApi = true`
- 真正适合宿主接入的是 app-server JSON-RPC，不是交互式 TUI

### 4.2 Claude Code

测试环境：

- CLI 版本：`2.1.81`
- 登录态：`claude auth status` 可用

已验证能力：

1. `claude --resume <session_id>` 可继续原会话
2. `claude --resume <session_id> --fork-session` 可创建原生子会话
3. 通过 transcript 截断重建 prompt，可实现按任意历史消息点派生

结论：

- 会话级 fork：可做，而且是原生
- 消息级 fork：可做，但当前应按**重建型消息 fork**落地

注意点：

- 当前公开 CLI 能力没有证明存在官方 `message-id` 级原生 fork
- transcript 重建时必须稳定保存父子关系和 fork 锚点，不然很快就会乱

### 4.3 OpenCode

测试环境：

- CLI 版本：`1.3.4`

已验证能力：

1. `opencode run --session <id>` 可继续原会话
2. `opencode run --session <id> --fork` 可做原生会话 fork
3. 官方 server `POST /session/:id/fork` 支持 `messageID`

结论：

- 会话级 fork：可做，而且是原生
- 消息级 fork：可做，而且是原生
- 从官方能力完整度看，它是三家里最干净的一个

注意点：

- `opencode serve` 的工作目录要稳定，否则 fork 出来的会话目录可能漂移

## 5. 官方资料与测试依据

### 5.1 官方资料

- OpenCode CLI 文档：<https://opencode.ai/docs/zh-cn/cli/>
- OpenCode Server 文档：<https://opencode.ai/docs/server/>
- OpenCode 官方类型定义：<https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts>
- Claude Code CLI 文档：<https://code.claude.com/docs/zh-CN/cli-reference>
- Claude Code Hooks 文档：<https://code.claude.com/docs/zh-CN/hooks>
- Claude Agent SDK Sessions：<https://platform.claude.com/docs/id/agent-sdk/sessions>
- Claude Code 官方 issue：<https://github.com/anthropics/claude-code/issues/10856>
- Codex 官方仓库：<https://github.com/openai/codex>

### 5.2 本项目内部依据

- `apps/host/src/storage/sqlite/schema.sql`
- `apps/host/src/modules/sessions/session-history-service.ts`
- `apps/host/src/modules/sessions/session-live-runtime-service.ts`
- `apps/host/src/modules/sessions/codex-app-server-helper-process.ts`
- `packages/session-sync-core/src/types.ts`
- `packages/session-sync-core/src/services.ts`
- `packages/session-sync-core/src/providers/codex.ts`
- `packages/session-sync-core/src/providers/claude-code.ts`
- `packages/session-sync-core/src/providers/opencode.ts`
- `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`

## 6. 统一 fork 能力分级

不要再把三家 provider 混成一个抽象名词。真正可落地的分级应该是下面三种：

### 6.1 `native_session_fork`

定义：

- provider 官方能力支持从一个现有会话直接派生新会话
- 不保证能锚定到某个历史消息点

适用：

- Codex
- Claude Code
- OpenCode

### 6.2 `native_message_fork`

定义：

- provider 官方能力支持按 message id 或等价历史片段直接创建子会话

适用：

- OpenCode：官方 server `messageID`
- Codex：通过官方 app-server 的 `thread/read` + `thread/resume(history)` 实现等价消息级派生

### 6.3 `reconstructed_message_fork`

定义：

- 平台读取目标会话历史
- 截断到目标消息锚点
- 重组成一个新 prompt 或新历史
- 启动新的 provider 会话

适用：

- Claude Code 第一阶段消息级派生
- 未来其他只支持 session fork、但能读取 transcript 的 provider

## 7. 建议的统一数据模型

第一阶段不要上来重做全文消息账本。最小够用的数据模型应该围绕 fork 元数据展开。

### 7.1 建议新增字段

可优先落在 `session_indices`，或者拆到新的 `session_forks` 表。为了少改主流程，建议新增独立表。

```ts
type ForkSourceType = "session" | "message";

type ForkMethod =
  | "native_session_fork"
  | "native_message_fork"
  | "reconstructed_message_fork";

interface SessionForkRecord {
  sessionId: string;                 // 新子会话
  parentSessionId: string;           // 平台父会话
  provider: string;
  forkSourceType: ForkSourceType;    // 从整场会话 fork，还是从某条消息 fork
  forkSourceSessionId: string;       // 平台来源会话
  forkSourceMessageId: string | null;// 平台来源消息，消息级 fork 必填
  providerParentSessionId: string | null;
  providerSourceMessageId: string | null;
  forkMethod: ForkMethod;
  createdAt: string;
}
```

### 7.2 为什么建议单独建表

如果把所有字段都硬塞进 `session_indices`，很快就会脏：

- 一个会话索引表同时承担列表展示、关系索引、fork 审计三种职责
- 后面一旦要补更多 fork 来源字段，表会越来越像垃圾桶

第一阶段更干净的做法是：

1. `session_indices.parent_session_id` 继续保留，负责列表和树结构查询
2. 新增 `session_forks`，负责保存 fork 元数据和来源锚点

## 8. 建议的统一后端接口

### 8.1 Host 接口草案

```http
POST /api/workspaces/:workspaceId/sessions/:sessionId/forks
```

请求体：

```json
{
  "provider": "codex",
  "sourceType": "message",
  "sourceMessageId": "msg_123",
  "strategy": "auto"
}
```

说明：

- `sourceType=message` 时，后端必须把目标消息作为锚点
- `strategy=auto` 表示优先走 provider 原生，做不到再按 provider 规则降级

返回体：

```json
{
  "sessionId": "child-session-id",
  "providerSessionId": "provider-child-session-id",
  "parentSessionId": "parent-session-id",
  "forkMethod": "native_message_fork",
  "forkSourceType": "message",
  "forkSourceMessageId": "msg_123"
}
```

### 8.2 Provider 抽象草案

建议在 `packages/session-sync-core` 新增：

```ts
interface ForkSessionOptions {
  rawStoreRef: string;
  sourceType: "session" | "message";
  sourceMessageId?: string | null;
  strategy?: "auto" | "native-only" | "reconstruct-only";
}

interface ForkSessionResult {
  session: ProviderSessionSummary;
  forkMethod: "native_session_fork" | "native_message_fork" | "reconstructed_message_fork";
  providerSourceMessageId?: string | null;
}
```

然后补到 `ProviderAdapter`：

```ts
forkSession?(
  providerSessionId: string,
  workspacePath: string,
  options: ForkSessionOptions
): Promise<ForkSessionResult>;
```

这里必须注意一件事：

- `forkSession` 要允许 provider 自己做降级
- 但最终降级结果必须回传 `forkMethod`
- 不允许宿主以为走的是原生消息 fork，实际上 provider 偷偷回退成了重建 fork

## 9. 三家 provider 的接入建议

### 9.1 第一批：Codex

推荐顺序第一，不是因为它最简单，而是因为用户最高频使用它，而且项目里已经有 app-server helper 基础。

接入方式：

1. 会话级 fork：补 `thread/fork`
2. 消息级 fork：补 `thread/read` + 按锚点截断历史 + `thread/resume(history)`
3. 不走交互式 `codex fork` TUI

原因：

- 当前宿主更适合消费 app-server JSON-RPC
- 任意历史消息点派生已经实测成功

### 9.2 第二批：Claude Code

接入方式：

1. 会话级 fork：`--resume <session_id> --fork-session`
2. 消息级 fork：读 transcript，截断到目标消息，重建 prompt 启新会话

必须额外做的事：

- transcript 解析要稳定映射到平台消息 id
- 后端必须保存 `forkMethod = reconstructed_message_fork`
- 要明确把“原生 session fork”和“重建消息 fork”区分开

### 9.3 第三批：OpenCode

接入方式：

1. 会话级 fork：CLI `--fork`
2. 消息级 fork：server `POST /session/:id/fork` + `messageID`

为什么放第三：

- 不是因为它弱，恰好相反，它能力最完整
- 只是用户当前日常优先顺序是 `Codex -> Claude -> OpenCode`

## 10. 关键流程

### 10.1 消息级 fork 总流程

1. 用户在前端选中某条历史消息点击 fork
2. 前端把 `sessionId + messageId` 发送给 Host
3. Host 读取会话绑定和 provider 类型
4. Host 调用 provider `forkSession`
5. provider 按自己的能力选择：
   - 原生消息 fork
   - 原生会话 fork
   - 重建型消息 fork
6. Host 保存：
   - 新 `session_indices.parent_session_id`
   - `session_forks` 元数据
7. Host 返回新的子会话信息
8. 前端刷新树结构并切换到子会话

### 10.2 失败处理原则

不要偷偷降级成错误行为：

1. 用户请求消息级 fork，但 provider 最终只会从最新上下文 fork
   - 这不算成功，必须报错或明确标成不满足请求
2. provider 需要读取 transcript，但 transcript 缺失
   - 直接失败，不得伪造子会话
3. fork 成功，但平台没有把父子关系写入本地
   - 这也算失败，因为树会断

## 11. 风险与边界

### 11.1 数据结构风险

- 只有 `parent_session_id` 没有来源锚点，后面一定会追不清为什么这个子会话会挂在这里

### 11.2 兼容性风险

- 如果前端继续偷看 provider 特有字段，后续接更多 CLI 时会继续烂

### 11.3 状态一致性风险

- Claude 的消息级 fork 属于重建型，不是 provider 内部真正继承，会和原生 fork 有行为差异

### 11.4 黑盒依赖风险

- Codex 和 Claude 的原生能力都可能继续演化，接入层必须显式记录 `forkMethod`，不能假装所有子会话都一样

## 12. 最小落地顺序

### 阶段 A：先打通统一 fork 抽象和元数据

- 新增 `forkSession` provider 合同
- 新增 `session_forks` 表或等价存储
- 新增 Host 统一 fork 接口

### 阶段 B：先接 Codex

- 先做会话级 fork
- 再做消息级派生
- 验证历史消息点可选

### 阶段 C：再接 Claude Code

- 先做原生 session fork
- 再做 transcript 重建消息 fork

### 阶段 D：最后接 OpenCode

- 直接接原生 session fork 和 message-level fork
- 顺便把统一抽象补齐成对更多 provider 可复用的形式
