# 设计文档 - spec001.3.3 HOST与PEERHOST资源作用域统一与切换收口

状态：Draft

## 1. 概述

### 1.1 目标

- 为工作台定义唯一可信的资源作用域模型
- 统一会话、终端、文件、Git、调试的目标 HOST 与请求工作区解析逻辑
- 让跨 HOST / 跨工作区 / 跨会话切换先清理旧连接，再建立新连接
- 第一阶段先收口 `WorkbenchLayout` 和 `TerminalPage`

### 1.2 覆盖需求

- `requirements.md` 需求 1：统一资源作用域模型
- `requirements.md` 需求 2：显示工作区与请求工作区区分
- `requirements.md` 需求 3：跨作用域切换先清理旧连接
- `requirements.md` 需求 4：会话链路按作用域定位
- `requirements.md` 需求 5：终端链路按作用域重建
- `requirements.md` 需求 6：缓存 key 和订阅 key 带作用域
- `requirements.md` 需求 7：第一阶段会话和终端优先

### 1.3 技术约束

- 前端实现继续放在 `apps/user-app`
- 不引入第二套并行状态机，优先复用现有工作台壳和终端页结构
- 现有 URL 结构尽量保持兼容，必要时继续使用 `targetHostId` 查询参数
- 只要是跨 HOST 资源，请求必须继续走当前 HOST 代理，不允许浏览器直连 PEERHOST

### 1.4 当前实现诊断

已经确认的现状问题：

1. `WorkbenchLayout` 里很多会话定位和回退逻辑仍然按全局 `sessionId` 查找，这默认假设 `sessionId` 全局唯一。
2. `flattenNavigationSessions` 和 `dedupeNavigationEntries` 仍以 `sessionId` 去重，跨 HOST 后天然有串线风险。
3. `replaceWorkspaceSessionsWithRemoteSnapshot(...)` 会把远端会话挂到本地主工作区下展示，但后续并不是所有调用点都清楚“显示工作区”和“请求工作区”不是一回事。
4. 多处跳转直接把 `currentWorkspaceRef` 复用到别的工作区或别的会话上，这会把旧作用域里的 `targetHostId / remoteWorkspaceId` 带到新页面。
5. `TerminalPage` 会自己推断 `requestWorkspaceId`，但它依赖的 `shellCurrentWorkspaceRef` 可能已经不是当前选中工作区的真实作用域。
6. 终端页和工作台壳的订阅逻辑虽然带 `targetHostId`，但没有一个显式“作用域切换”事务负责先断旧连接、再立新连接。

一句人话：
现在不是没有 `targetHostId`，而是 `targetHostId`、`workspaceId`、`sessionId` 三者没有被一个明确结构管起来。

## 2. 架构

### 2.1 总体结构

```txt
路由 / 用户点击 / 工作区选择
  -> 资源作用域解析器
      -> 显示工作区 displayWorkspaceId
      -> 目标 HOST targetHostId
      -> 请求工作区 requestWorkspaceId
      -> 可选 requestSessionId
  -> 作用域切换协调器
      -> 清理旧作用域连接
      -> 更新当前作用域状态
      -> 重建订阅 / 请求 / 页面跳转
  -> 资源模块
      -> 会话
      -> 终端
      -> 文件
      -> Git
      -> 调试
```

### 2.2 核心原则

1. 页面展示归属和实际请求归属必须分开表达。
2. 会话、终端、文件、Git、调试都不能自己猜 `targetHostId`。
3. 任何跨作用域切换都必须显式触发旧连接清理。
4. 结果回写前必须再次校验当前作用域，防止旧请求污染新页面。

## 3. 数据结构

### 3.1 WorkbenchResourceScope

第一阶段在前端定义统一结构：

```ts
export interface WorkbenchResourceScope {
  displayWorkspaceId: string;
  targetHostId: string | null;
  requestWorkspaceId: string;
  requestSessionId: string | null;
  source: "local" | "peer";
}
```

字段解释：

- `displayWorkspaceId`
  - 给路由、左侧导航、页面标题、用户可见上下文使用
- `targetHostId`
  - `null` 表示当前主 HOST
  - 非空表示目标 PEERHOST
- `requestWorkspaceId`
  - 真正发给 API、实时订阅、终端管理、Git、文件、调试接口的工作区 ID
- `requestSessionId`
  - 当前页面若锚定某个会话则填写，否则为 `null`
- `source`
  - 当前作用域来自本地主 HOST 还是远端 PEERHOST

### 3.2 ScopedSessionEntry

为了避免只靠 `sessionId` 定位，第一阶段给会话列表内部引入带作用域的定位视图：

```ts
export interface ScopedSessionEntry {
  sessionId: string;
  displayWorkspaceId: string;
  targetHostId: string | null;
  requestWorkspaceId: string;
}
```

它不一定需要暴露成最终 DTO，但工作台壳内部必须有等价信息。

### 3.3 Scope Key

统一作用域 key：

```ts
function buildScopeKey(scope: {
  targetHostId: string | null;
  requestWorkspaceId: string;
  requestSessionId?: string | null;
}): string
```

规则：

- `targetHostId ?? "current"`
- `requestWorkspaceId`
- `requestSessionId ?? "-"`（仅在需要区分会话资源时附加）

用途：

- 终端快照 key
- Git / 文件 / 工作区管理快照 key
- 当前会话定位比对
- 异步结果回写防抖和过期判断

## 4. 作用域解析

### 4.1 统一解析入口

第一阶段在 `WorkbenchLayout` 内部收口出统一入口，后续可再抽文件：

```ts
resolveResourceScope(input: {
  displayWorkspaceId: string;
  routeTargetHostId?: string | null;
  selectedWorkspaceRef?: WorkspaceRef | null;
  session?: SessionSummaryDto | null;
}): WorkbenchResourceScope | null
```

解析顺序：

1. 先确定显示工作区 `displayWorkspaceId`
2. 再确定目标 HOST `targetHostId`
3. 再根据目标 HOST 和工作区绑定关系解出 `requestWorkspaceId`
4. 如果当前有会话，再解出 `requestSessionId`

### 4.2 会话链路解析

当前会话不能再只用下面这种查法：

```ts
flattenedSessions.find((item) => item.session.sessionId === currentSessionId)
```

必须改成带作用域条件：

- `sessionId`
- 路由显示工作区
- 路由目标 HOST
- 或者会话条目解出的请求工作区

优先级：

1. 路由里显式指定的显示工作区 + 目标 HOST
2. 当前选中工作区作用域
3. 兼容旧路径时才允许回退

### 4.3 终端链路解析

`TerminalPage` 不能再通过“当前工作台 ref 猜一下”来决定 `requestWorkspaceId`。

终端页需要显式拿到终端作用域：

```ts
resolveTerminalScope(input: {
  selectedWorkspaceId: string;
  currentWorkspaceRef: WorkspaceRef | null;
  currentTargetHostId: string | null;
}): WorkbenchResourceScope | null
```

规则：

- 当前主 HOST：`requestWorkspaceId = displayWorkspaceId`
- 目标 PEERHOST：`requestWorkspaceId = currentWorkspaceRef.workspaceId`
- 如果 `currentWorkspaceRef` 不属于当前选中工作区，直接判为无效，阻止继续请求

## 5. 切换事务

### 5.1 为什么必须有切换事务

现在最大的问题不是“会不会重新请求”，而是**旧连接没死透**。

比如：

- 旧终端订阅还在收数据
- 旧会话上下文还在决定当前 workspaceRef
- 旧缓存 key 还能命中
- 旧异步返回晚到一步，又把新页面状态覆盖掉

所以第一阶段需要显式的作用域切换事务。

### 5.2 切换顺序

```txt
识别新作用域
  -> 比较旧作用域 key
  -> 若未变化，直接复用
  -> 若变化：
       1. 标记旧作用域失效
       2. 断开旧作用域订阅 / 连接
       3. 清理旧作用域页面临时状态
       4. 提交新作用域
       5. 建立新订阅
       6. 触发新请求
```

### 5.3 第一阶段要清理的对象

- 会话页当前会话上下文判定缓存
- 终端页实时连接与终端快照订阅
- 终端页当前 `requestWorkspaceId` 派生状态
- 工作台壳当前终端快照订阅
- 当前作用域下的异步请求 request id

### 5.4 结果回写保护

任何异步结果回写前都必须比对：

- 当前 scope key
- 当前 request id

只有完全匹配才允许写回。

这比“尽量断旧连接”更重要，因为网络层不能保证旧请求一定立刻停下。

## 6. 模块改造

### 6.1 WorkbenchLayout

第一阶段改造重点：

1. 增加统一作用域解析辅助函数
2. 当前会话定位改成带作用域匹配
3. 当前工作区 ref 生成只允许从当前显示工作区和目标 HOST 解出
4. 所有“打开会话”“回退到最近会话”“从搜索结果打开会话”的路径生成都必须使用会话自己的作用域
5. `favorite/archive/rename/delete/export` 等会话操作都必须使用会话对应作用域，而不是盲目复用 `currentTargetHostId`

### 6.2 TerminalPage

第一阶段改造重点：

1. 显式解析终端作用域
2. `requestWorkspaceId` 只从终端作用域得到
3. 终端快照订阅 key 使用终端作用域 key
4. 终端页切换作用域时先断开旧 pane 连接
5. 终端列表、shell options、创建/关闭/删除/重连都用当前终端作用域

### 6.3 文件 / Git / 调试

第一阶段不要求全部重写，但要统一接入规则：

- 订阅函数统一接受 `requestWorkspaceId + targetHostId`
- 缓存 key 统一带 `targetHostId`
- 后续改造只允许从统一作用域入口取值

## 7. 验证与回归

### 7.1 最小验证场景

1. 先打开某个 PEERHOST 会话，再切回主 HOST 另一个会话
2. 先打开某个 PEERHOST 终端，再切到主 HOST 工作区终端
3. 两个 HOST 下存在相同 `sessionId` 时，打开会话不串线
4. 两个 HOST 下存在相同 `workspaceId` 时，终端快照不串线

### 7.2 自动化测试优先点

- `WorkbenchLayout` 作用域解析与会话定位测试
- `TerminalPage` 请求工作区与订阅切换测试
- 终端页跨 HOST 切换后旧结果不回写测试

### 7.3 风险

最大风险不是逻辑写错，而是只修了一半：

- 如果会话改了但终端没改，系统还是糊的
- 如果路径生成改了但订阅没改，用户看到的 URL 是对的，数据还是错的
- 如果只在一个入口清理旧连接，另一个入口仍然能复用旧 ref，问题会反复出现

所以第一阶段必须把“会话 + 终端 + 统一作用域入口”一起交付。

## 8. 需求映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §3.1、§4.1 | 作用域解析单测 |
| `requirements.md` 需求 2 | `design.md` §3.1、§4.3、§6.1、§6.2 | 跨 HOST 工作区切换回归 |
| `requirements.md` 需求 3 | `design.md` §5.1、§5.2、§5.3、§5.4 | 连接清理与过期结果回写测试 |
| `requirements.md` 需求 4 | `design.md` §4.2、§6.1 | 会话定位与跳转测试 |
| `requirements.md` 需求 5 | `design.md` §4.3、§6.2 | 终端页跨 HOST 切换测试 |
| `requirements.md` 需求 6 | `design.md` §3.3、§6.2、§6.3 | 缓存 key / 订阅 key 测试 |
| `requirements.md` 需求 7 | `design.md` §6、§7 | 本轮最小回归验证 |
