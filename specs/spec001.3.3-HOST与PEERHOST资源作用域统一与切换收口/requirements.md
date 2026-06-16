# 需求文档 - spec001.3.3 HOST与PEERHOST资源作用域统一与切换收口

状态：Draft

## 简介

当前系统已经有两层能力：

1. 客户端可以切换当前激活 HOST
2. 当前 HOST 可以代理访问其他 HOST 的工作区和会话等资源

但资源真正落到前端工作台里以后，身份模型还是乱的。

真实问题已经暴露出来了：

- 用户先连接一个 PEERHOST 会话或终端
- 再切到另一个主 HOST 会话
- 页面会出现找不到 session
- 项目标签还会被错误显示成上一个 PEERHOST 的标签

这说明当前实现把下面几件事混在了一起：

- 页面当前显示的工作区是谁
- 当前请求该发给哪个 HOST
- 当前请求该使用哪个 workspaceId
- 当前缓存和订阅到底属于哪个资源
- 切换时旧连接应该什么时候销毁

这次要解决的事很明确：

1. 给会话、文件、Git、调试、终端定义统一的资源作用域
2. 任何跨 HOST / 跨工作区 / 跨会话切换都先清理旧连接，再建立新连接
3. 页面 URL、缓存 key、订阅 key、请求参数都从同一份作用域对象生成
4. 第一阶段先把会话和终端链路收口，因为它们现在最容易炸

## 术语表

- **显示工作区**：左侧导航、顶部标题、页面路由里给用户看的工作区
- **请求工作区**：真正发给当前 HOST 或 PEERHOST API 的 `workspaceId`
- **目标 HOST**：本次请求真正要落到的 HOST。为空表示当前主 HOST
- **资源作用域**：描述某个页面资源到底归哪个 HOST、哪个工作区、哪个会话的一份结构化对象
- **作用域切换**：从一个资源作用域切到另一个资源作用域的完整事务
- **连接清理**：销毁旧作用域下的订阅、实时连接、终端连接、调试连接和相关临时状态

## 范围说明

### In Scope

- 定义统一 `ResourceScope`
- 统一 `displayWorkspaceId / requestWorkspaceId / targetHostId` 的关系
- 会话页当前会话定位规则
- 会话页 URL 生成规则
- 终端页请求工作区与订阅工作区的统一规则
- 跨 HOST/工作区/会话切换时的连接清理和重建规则
- 文件 / Git / 调试链路的接入约束和后续迁移边界

### Out of Scope

- 不在这次里重写 Peer HOST 存储结构
- 不在这次里改所有页面视觉样式
- 不做工作区视图的全新信息架构
- 不新增浏览器端直连其他 HOST 的模式
- 不把现有所有缓存系统都替换掉

## 需求

### 需求 1：前端必须有统一的资源作用域模型

**用户故事：** 作为维护者，我希望页面里所有跨 HOST 资源都能从同一份作用域对象解出来，而不是每个组件各自猜。

#### 验收标准

1. WHEN 页面需要打开会话、文件、Git、终端或调试资源 THEN System SHALL 先解析出统一的资源作用域对象
2. WHEN 资源属于当前主 HOST THEN System SHALL 明确得到 `targetHostId = null`
3. WHEN 资源属于 PEERHOST THEN System SHALL 明确得到目标 `targetHostId` 和真正请求使用的 `requestWorkspaceId`
4. WHEN 资源作用域无法解析 THEN System SHALL 阻止继续请求，并给出明确失败状态，而不是静默退回错误默认值

### 需求 2：显示工作区和请求工作区必须明确区分

**用户故事：** 作为用户，我希望左侧看到的是我理解的项目，但请求真的能落到那个项目所在的实际 HOST 和工作区，而不是串到另一个地方。

#### 验收标准

1. WHEN 左侧展示来自 PEERHOST 的工作区内容 THEN System SHALL 保留主视图里的显示工作区归属
2. WHEN 对该工作区发起文件、Git、终端、调试、会话请求 THEN System SHALL 使用对应的请求工作区 ID，而不是盲目复用显示工作区 ID
3. WHEN 页面需要根据工作区生成 URL THEN System SHALL 使用显示工作区 ID 生成可读路径，并在需要时附带目标 HOST 信息
4. WHEN 页面需要建立实时订阅或发起 API 请求 THEN System SHALL 使用请求工作区 ID，而不是只看 URL 上的显示工作区 ID

### 需求 3：跨作用域切换必须先清理旧连接

**用户故事：** 作为用户，我希望从一个 HOST/工作区/会话切到另一个时，旧连接别偷偷活着继续污染新页面。

#### 验收标准

1. WHEN 当前资源作用域发生变化 THEN System SHALL 先断开旧作用域下的实时订阅和临时连接
2. WHEN 当前终端作用域发生变化 THEN System SHALL 先断开旧终端连接，再加载新终端集合
3. WHEN 当前调试作用域发生变化 THEN System SHALL 先释放旧调试状态，再请求新作用域的调试资源
4. WHEN 旧连接清理失败 THEN System SHALL 至少阻止旧结果继续写回新作用域页面

### 需求 4：会话链路必须按作用域定位，不得只靠 sessionId

**用户故事：** 作为用户，我希望打开一个会话时系统能准确找到它属于哪个 HOST 和工作区，而不是因为另一个 HOST 下也有相同 sessionId 就串线。

#### 验收标准

1. WHEN 当前页面根据路由定位会话 THEN System SHALL 结合显示工作区、目标 HOST 和会话归属一起判断
2. WHEN 不同 HOST 下存在相同 sessionId THEN System SHALL 仍然能正确定位当前要打开的会话
3. WHEN 会话来自 PEERHOST THEN System SHALL 使用对应作用域构造 URL、导出、删除、归档、收藏等请求
4. WHEN 会话不属于当前作用域 THEN System SHALL 不得把旧作用域里的会话对象误判成当前页面的会话

### 需求 5：终端链路必须按作用域重建请求与订阅

**用户故事：** 作为用户，我希望切换到另一个 HOST 或工作区的终端时，终端列表和实时输出是重新从正确目标加载的，不是残留的旧结果。

#### 验收标准

1. WHEN 终端页切换工作区或目标 HOST THEN System SHALL 重新计算终端请求工作区
2. WHEN 终端请求工作区或目标 HOST 变化 THEN System SHALL 重新订阅终端快照，并清理旧订阅
3. WHEN 终端列表响应返回 THEN System SHALL 只允许当前作用域的结果写回页面
4. WHEN 终端创建、关闭、删除、重连 THEN System SHALL 始终对当前终端作用域生效

### 需求 6：缓存 key 和订阅 key 必须带上作用域

**用户故事：** 作为维护者，我希望缓存和订阅不会因为只用 `workspaceId` 或 `sessionId` 而把不同 HOST 的数据覆盖掉。

#### 验收标准

1. WHEN 系统为会话、终端、Git、文件或工作区管理结果生成缓存 key THEN System SHALL 带上目标 HOST 作用域
2. WHEN 系统建立实时订阅 THEN System SHALL 带上目标 HOST 和请求工作区作用域
3. WHEN 当前 HOST 与 PEERHOST 存在相同 `workspaceId` THEN System SHALL 不发生缓存覆盖
4. WHEN 当前 HOST 与 PEERHOST 存在相同 `sessionId` THEN System SHALL 不发生当前会话误判

### 需求 7：第一阶段必须先把会话和终端收口

**用户故事：** 作为维护者，我希望这次改造先把最容易炸的链路收住，而不是一口气全仓库重写。

#### 验收标准

1. WHEN 第一阶段交付 THEN System SHALL 至少完成会话链路的作用域统一和切换清理
2. WHEN 第一阶段交付 THEN System SHALL 至少完成终端链路的作用域统一和切换清理
3. WHEN 文件、Git、调试暂未完全迁移 THEN System SHALL 已明确接入规则和后续改造入口
4. WHEN 第一阶段完成 THEN System SHALL 不再复现“会话找不到、HOST 标签串成上一个 PEERHOST”这类已知问题

## 非功能需求

### 非功能需求 1：一致性

1. WHEN 页面显示某个目标 HOST 标签 THEN System SHALL 与该页面实际请求目标保持一致
2. WHEN URL 指向某个目标 HOST 作用域 THEN System SHALL 与页面缓存、订阅和请求作用域保持一致

### 非功能需求 2：可维护性

1. WHEN 新增一个跨 HOST 资源模块 THEN System SHALL 可以复用统一作用域解析能力，而不是重新发明一套 `targetHostId` 判断
2. WHEN 排查跨 HOST 串线问题 THEN System SHALL 能明确知道错误发生在“作用域解析”“旧连接未清理”还是“结果回写错作用域”

### 非功能需求 3：兼容性

1. WHEN 资源属于当前主 HOST THEN System SHALL 保持现有单 HOST 正常行为
2. WHEN 用户未配置任何 PEERHOST THEN System SHALL 不引入额外使用负担或新故障

## 成功定义

- 会话、终端不再只靠裸 `sessionId` 或裸 `workspaceId` 猜归属
- 跨 HOST / 跨工作区 / 跨会话切换会先清理旧连接，再建立新连接
- URL、缓存、订阅、请求统一从一份资源作用域对象生成
- 第一阶段至少解决当前已暴露的会话串 HOST、标签串 HOST、终端请求串 HOST 问题
