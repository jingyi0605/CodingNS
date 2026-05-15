# 需求文档 - spec013.5-工作区会话助手能力开放与作用域收口

状态：Draft

## 简介

当前平台里，助手能力有两种极端：

1. Butler 控制面会话可以走正式的 `codingns assistant` 能力面
2. 普通工作区会话基本只能靠自身上下文和 prompt，不知道平台已经有的正式能力

这就导致一个很蠢的局面：

- 用户明明已经在当前工作区里，希望助手去开一个终端、查一个终端历史、生成一个文档、调一次浏览器、建一个工作树
- 平台里这些能力很多已经存在，或者正在被 `spec015` 补齐
- 但工作区会话拿不到正式能力入口，只能继续假装自己“会操作”，最后不是瞎编，就是绕回 Butler

更糟的是，另一种偷懒做法也不对：

- 直接把全部 `codingns assistant` 命令暴露给工作区会话
- 让工作区会话自己“注意不要乱用”

这不是权限设计，这是放弃设计。

本 Spec 的目标很直接：

- 让工作区会话正式获得一部分助手能力
- 但只能在“当前工作区、当前项目、当前终端、当前文档和办公能力入口”这个受控范围内使用
- 所有高风险、跨范围、会影响全局编排的能力，继续留在 Butler 控制面或审批流里

## 可实现性结论

### 结论

这个能力 **值得做，而且必须现在做**。

### 已确认事实

1. 当前 `codingns assistant` 已经有正式的 Host API 和 CLI 门面，不需要再发明一套平行接口。
2. 当前助手能力清单已经包括平台信息、项目与会话、终端、工作树、办公文档、办公浏览器、办公运维、自动化等多类入口。
3. 当前 `spec013.4` 已经把助手调用者身份做了第一轮收口，系统已经能区分 `butler-runtime` 和 `butler-ui`。
4. 当前用户明确要求把一部分助手能力开放给工作区会话，但必须限定范围。
5. 当前终端能力缺少 `terminals.create`，这会导致工作区会话即使拿到终端入口，也只能操作已有终端，能力是不完整的。
6. 当前办公能力已经逐步在 `spec015` 下落地，工作区会话如果拿不到统一入口，后续仍然会退化成“平台有能力，但工作区不会用”。

### 平台判断

- ✅ 值得做：这一步会把“助手能力”从控制面专用，推进到“工作区里也能真正用”
- ✅ 值得收口：必须按工作区作用域做真过滤，不能再靠提示词
- ❌ 不该全放：工作区会话不是新的超级管理员
- ❌ 不该拖着不做：否则后续文档、浏览器、运维能力接进来以后，仍然只能 Butler 会用

## 术语表

- **Workspace Session（工作区会话）**：用户在某个具体工作区里直接发起的普通代码会话，不是 Butler 控制面会话
- **Workspace Session Caller（工作区会话调用者）**：代表工作区会话调用助手能力时的正式身份
- **Capability Profile（能力档位）**：一组固定的能力白名单，用来决定某类调用者默认能看到和能执行哪些助手能力
- **Scoped Token（作用域令牌）**：发给工作区会话的受控访问令牌，至少绑定 `workspaceId`、可选 `projectId`、`callerKind` 和 `capabilityProfile`
- **Current Workspace Scope（当前工作区作用域）**：工作区会话只能操作它当前所在工作区里的资源，不能跨到别的工作区
- **Conditional Capability（条件开放能力）**：默认不直接放开，只有满足额外规则、审批或显式确认时才能执行的能力

## 范围说明

### In Scope

- 定义 `workspace_session` 调用者身份和能力档位
- 定义工作区会话可见的 `assistant` 能力白名单
- 定义默认开放、条件开放、暂不开放三类能力边界
- 定义工作区 scoped token 的结构、签发和校验规则
- 定义 `/api/assistant/capabilities` 和真实执行入口的按作用域过滤逻辑
- 定义工作区会话里的能力说明注入方式
- 定义 `terminals.create` 的能力补齐和权限边界
- 定义工作区侧如何拿到文档、浏览器、运维、工作树这些办公能力入口

### Out of Scope

- 不把 Butler 控制面全部功能复制到工作区会话
- 不在这一步开放跨工作区巡检、跨项目批量编排、自动化调度管理
- 不开放工作区会话直接审批别人发起的高风险任务
- 不在这一轮实现复杂权限管理 UI
- 不重做所有既有 CLI 子命令命名，只做必要扩展

## 技术边界

### 边界 1：工作区会话不是 Butler

- 工作区会话的目标是处理“我当前这个工作区里的事”
- 它不是新的控制面，不负责跨项目总控、全局审批和全局自动化编排

### 边界 2：必须是真过滤，不是软提示

- `capabilities.list` 不能返回“全量能力 + 提示你别用”
- 服务端必须直接过滤掉不属于当前调用者档位的能力
- 写接口执行时也必须二次校验，不能只靠列表过滤

### 边界 3：所有资源都要带工作区作用域

- 文档、终端、浏览器、工作树、运维任务都必须明确属于哪个工作区
- 不能出现“列出了当前工作区能力，但执行时悄悄跨到别的工作区”的脏设计

### 边界 4：高风险动作继续走审批或条件开放

- 能修改系统状态、影响远端机器、合并工作树、向终端写入命令这类动作，不能默认无条件放开
- 第一阶段要么继续审批，要么要求显式确认，要么只保留创建任务不直接执行

### 边界 5：兼容优先

- 现有 Butler 控制面调用不能被工作区会话扩展打断
- 现有 `codingns assistant` CLI 命令不能因为多了 `workspace_session` 档位而改坏
- 已上线的只读能力、办公能力入口和工作树能力要尽量复用，不重新长平行接口

## 需求

### 需求 1：系统必须提供 `workspace_session` 调用者身份

**用户故事：** 作为维护者，我希望系统能正式区分 Butler 控制面会话和工作区普通会话，而不是让两者共用一套模糊身份。

#### 验收标准

1. WHEN 工作区会话请求助手能力 THEN System SHALL 以 `workspace_session` 作为正式调用者身份之一参与鉴权和能力过滤。
2. WHEN 服务端记录助手能力请求 THEN System SHALL 在审计信息里保留 `callerKind=workspace_session`。
3. WHEN 调用者不是工作区会话、Butler 运行时或 Butler 页面 THEN System SHALL 拒绝访问受控助手能力。

### 需求 2：系统必须给工作区会话下发带作用域的受控令牌

**用户故事：** 作为维护者，我希望工作区会话拿到的能力凭证只能操作它自己的当前工作区，而不是拿着一个大 token 到处跑。

#### 验收标准

1. WHEN 工作区会话初始化助手能力上下文 THEN System SHALL 签发 scoped token。
2. WHEN scoped token 被签发 THEN System SHALL 至少绑定 `workspaceId`、`callerKind`、`capabilityProfile`，并在有当前项目时绑定 `projectId`。
3. WHEN 工作区会话调用任何受控能力 THEN System SHALL 校验 token 里的作用域与目标资源是否一致。

### 需求 3：系统必须按能力档位过滤工作区会话可见能力

**用户故事：** 作为工作区会话使用者，我希望 `capabilities.list` 返回的就是我现在真的能用的能力，而不是一堆看得到但不能执行的摆设。

#### 验收标准

1. WHEN 工作区会话调用 `capabilities.list` THEN System SHALL 只返回该工作区会话档位允许的能力。
2. WHEN 同一能力对不同调用者档位权限不同 THEN System SHALL 根据 `capabilityProfile` 返回不同结果。
3. WHEN 某能力对当前工作区会话暂不开放 THEN System SHALL 不出现在默认能力列表中，或明确标记为条件开放。

### 需求 4：系统必须支持工作区会话默认使用以下能力

**用户故事：** 作为用户，我希望工作区会话开箱就能用当前工作区里真正需要的能力，而不是每次都绕去 Butler。

#### 验收标准

1. WHEN 工作区会话查询平台能力 THEN System SHALL 默认开放以下能力：
   - `capabilities.list`
   - `projects.get`
   - `sessions.get`
   - `sessions.messages.list`
   - `sessions.runtime.get`
   - `terminals.create`
   - `terminals.list`
   - `terminals.history.read`
   - `office.document.*`
   - `office.browser.*`
   - `office.ops.target.*`
   - `office.ops.ssh-task.create`
   - `office.ops.browser-task.create`
   - `office.ops.task.get`
   - `worktrees.tree`
   - `worktrees.create`
   - `worktrees.merge-preview`
   - `worktrees.cleanup`
2. WHEN 上述能力被调用 THEN System SHALL 只允许访问当前工作区或当前项目对应的资源。
3. WHEN 当前工作区没有项目上下文 THEN System SHALL 仍允许使用纯工作区能力，但拒绝伪造项目级目标。

### 需求 5：系统必须把高风险能力列为条件开放，而不是默认放开

**用户故事：** 作为维护者，我希望工作区会话能做事，但不能默认无审计地做高风险动作。

#### 验收标准

1. WHEN 工作区会话访问以下能力 THEN System SHALL 将其视为条件开放能力：
   - `terminals.input.send`
   - `terminals.close`
   - `office.ops.task.execute`
   - `debug-targets.*` 执行类能力
   - `worktrees.merge-into-parent`
2. WHEN 条件开放能力被触发 THEN System SHALL 要求额外确认、审批、或满足预设允许条件后才真正执行。
3. WHEN 条件不满足 THEN System SHALL 返回明确拒绝原因，而不是静默失败。

### 需求 6：系统必须明确哪些助手能力暂不开放给工作区会话

**用户故事：** 作为维护者，我希望平台边界清楚，避免工作区会话悄悄拿到全局编排能力。

#### 验收标准

1. WHEN 工作区会话请求以下能力 THEN System SHALL 默认拒绝：
   - `office.task.approval.reply`
   - `sessions.start`
   - `sessions.message.send`
   - `sessions.fork`
   - `sessions.delete`
   - `sandboxes.*`
   - `automations.*`
   - `workspaces.remove`
   - `workspaces.reorder`
2. WHEN 用户需要上述能力 THEN System SHALL 引导转到 Butler 控制面或后续专用入口，而不是在当前工作区会话里强行放开。
3. WHEN 平台后续要开放其中某项能力 THEN System SHALL 通过新的 capability profile 或新 Spec 明确追加，而不是偷偷改默认行为。

### 需求 7：系统必须补齐 `terminals.create`

**用户故事：** 作为工作区会话使用者，我希望在当前工作区里不只是能看到终端，还能正式新建一个终端。

#### 验收标准

1. WHEN 工作区会话需要新建终端 THEN System SHALL 提供正式的 `terminals.create` 能力。
2. WHEN 创建终端 THEN System SHALL 要求目标工作区与当前 scoped token 的 `workspaceId` 一致。
3. WHEN 终端创建成功 THEN System SHALL 返回终端标识、基础运行状态和最小回执，便于后续继续读写。

### 需求 8：系统必须给工作区会话注入明确的能力说明

**用户故事：** 作为用户，我希望工作区会话知道“什么时候该用 assistant office、什么时候该用终端、什么时候不能越权”，而不是靠碰运气。

#### 验收标准

1. WHEN 工作区会话初始化系统提示或能力上下文 THEN System SHALL 注入工作区可用助手能力说明。
2. WHEN 能力说明注入完成 THEN System SHALL 明确列出文档、浏览器、运维、终端、工作树等入口的使用方式。
3. WHEN 工作区会话尝试跨工作区或调用未开放能力 THEN System SHALL 在提示中明确说明限制，不鼓励模型瞎试。

### 需求 9：系统必须给工作区会话提供统一的办公能力入口

**用户故事：** 作为用户，我希望文档、浏览器、运维这些新能力不是散在不同黑盒里，而是能从工作区会话里用同一套入口调用。

#### 验收标准

1. WHEN 工作区会话要做办公文档、浏览器操作或运维任务 THEN System SHALL 能通过 `assistant office` 能力入口统一调用。
2. WHEN 工作区会话调用文档能力 THEN System SHALL 只操作当前工作区下的文档对象和产物。
3. WHEN 工作区会话调用浏览器或运维能力 THEN System SHALL 把生成的任务、回执和产物回收到当前工作区上下文。

### 需求 10：系统必须保持 Butler 和既有助手链路兼容

**用户故事：** 作为维护者，我希望这次扩展工作区能力时，不把现有 Butler 控制面和办公能力链路打坏。

#### 验收标准

1. WHEN Butler 控制面继续调用助手能力 THEN System SHALL 维持现有调用方式和能力边界不变。
2. WHEN 工作区会话能力过滤逻辑上线 THEN System SHALL 不影响 Butler 运行时和 Butler UI 已有权限。
3. WHEN 用户完全不使用工作区会话助手能力 THEN System SHALL 保持现有代码会话主流程不变。
