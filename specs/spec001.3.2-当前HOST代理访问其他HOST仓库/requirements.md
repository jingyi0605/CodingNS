# 需求文档 - spec001.3.2 当前HOST代理访问其他HOST仓库

状态：Draft

## 简介

当前客户端已经支持保存多个 HOST，并且能在它们之间切换。但这套能力的本质还是“当前只激活一个 HOST”。

现在新的需求是：

- 用户在当前工作区视图下看到一个仓库，比如 CodingNS
- 这个仓库可能在当前 HOST，也可能在局域网里另一台 HOST
- 用户希望给这个仓库配置不同 HOST 下的路径
- 用户切换目标 HOST 后，后续文件、Git、会话等操作都落到对应 HOST 上

这里最容易做坏的地方是：让前端直接拿 `baseUrl` 到处请求。那会把 token、WebSocket、workspaceId 全搞串。

这次要做的方向很明确：

1. 前端仍然只连接当前 HOST
2. 当前 HOST 保存和检查其他 HOST
3. 当前 HOST 作为代理访问其他 HOST API
4. 工作区和会话的身份必须带 HOST 归属
5. 被代理访问的 HOST 必须版本一致，并且局域网可达

## 术语表

- **当前 HOST**：用户当前客户端已经登录并直接连接的 CodingNS HOST
- **目标 HOST**：当前 HOST 代用户访问的另一台 CodingNS HOST
- **Peer HOST**：当前 HOST 保存的一条目标 HOST 配置，包含名称、地址、版本检查结果和连接状态
- **代理访问**：前端请求当前 HOST，当前 HOST 再请求目标 HOST，并把结果返回给前端
- **同版本要求**：当前 HOST 和目标 HOST 的服务端版本、API 兼容标识必须一致，否则不允许代理访问
- **Scoped Workspace**：带 HOST 归属的工作区引用，至少能区分 `hostId + workspaceId`

## 范围说明

### In Scope

- 当前 HOST 上保存 Peer HOST 配置
- 添加或检查 Peer HOST 时做局域网可达检查
- 添加或检查 Peer HOST 时做版本一致检查
- 当前 HOST 代理访问目标 HOST 的受控 HTTP API
- 前端 API 客户端支持 `targetHostId`
- 工作区视图展示不同 HOST 下的仓库，并避免 `workspaceId` 冲突
- 当前 HOST 代管目标 HOST 登录态和刷新逻辑
- 第一阶段只覆盖工作区、会话、文件、Git 这些仓库操作主链路

### Out of Scope

- 不支持不同版本 HOST 之间互相代理
- 不支持公网任意地址或任意内网地址开放代理
- 不做全站 API 无差别转发
- 不做跨 HOST 数据同步或迁移
- 不做跨 HOST 全局搜索
- 不把目标 HOST 的 token 下发给前端
- 不修改已有单激活 HOST 切换事务的基本语义

## 需求

### 需求 1：当前 HOST 必须能保存和检查 Peer HOST

**用户故事：** 作为需要操作多台机器上仓库的用户，我希望当前 HOST 能保存其他 HOST 的地址，并清楚告诉我它是否可用。

#### 验收标准

1. WHEN 用户新增 Peer HOST THEN System SHALL 保存名称、地址、创建时间、更新时间和最近检查结果
2. WHEN 用户新增或编辑 Peer HOST THEN System SHALL 规范化 `baseUrl`，避免同一地址重复保存
3. WHEN 用户检查 Peer HOST THEN System SHALL 发起轻量探活，确认目标地址是 CodingNS HOST
4. WHEN Peer HOST 不可达 THEN System SHALL 保留原配置，但状态显示为不可达，并给出清楚错误

### 需求 2：代理访问前必须确认版本一致

**用户故事：** 作为维护者，我希望只有相同版本的 HOST 才能互相代理，避免接口结构不一致导致脏错误。

#### 验收标准

1. WHEN 当前 HOST 检查 Peer HOST THEN System SHALL 读取目标 HOST 的版本和 API 兼容标识
2. WHEN 目标 HOST 版本与当前 HOST 不一致 THEN System SHALL 标记为 `version_mismatch`，并禁止代理访问
3. WHEN 目标 HOST API 兼容标识与当前 HOST 不一致 THEN System SHALL 禁止代理访问
4. WHEN 版本检查失败 THEN System SHALL 不得把该 Peer HOST 当成可操作目标

### 需求 3：前端 API 客户端必须支持按目标 HOST 走代理

**用户故事：** 作为前端维护者，我希望调用 API 时只传 `targetHostId`，不用到处拼目标 HOST 地址和 token。

#### 验收标准

1. WHEN API 调用没有传 `targetHostId` THEN System SHALL 继续请求当前 HOST，保持现有行为不变
2. WHEN API 调用传入 `targetHostId` THEN System SHALL 请求当前 HOST 的代理入口，而不是让浏览器直连目标 HOST
3. WHEN 目标 HOST 不可用、版本不一致或没有登录态 THEN System SHALL 返回可读错误
4. WHEN 代理请求失败 THEN System SHALL 不得清空当前 HOST 的登录态

### 需求 4：目标 HOST 的登录态必须由当前 HOST 代管

**用户故事：** 作为用户，我不希望前端保存多台 HOST 的 token，也不希望一个 HOST 的 token 被错误发给另一个 HOST。

#### 验收标准

1. WHEN 用户为 Peer HOST 登录 THEN System SHALL 把目标 HOST 的登录态保存到当前 HOST 后端
2. WHEN 当前 HOST 代理访问目标 HOST THEN System SHALL 使用目标 HOST 自己的登录态
3. WHEN 目标 HOST token 过期 THEN System SHALL 由当前 HOST 尝试刷新
4. WHEN 目标 HOST 登录态失效 THEN System SHALL 只清理该 Peer HOST 的登录态，不得影响当前 HOST 登录态

### 需求 5：工作区视图必须能区分不同 HOST 下的仓库

**用户故事：** 作为用户，我希望在工作区视图里看到同名仓库来自哪台 HOST，并且点击后操作不会落错机器。

#### 验收标准

1. WHEN 工作区列表包含 Peer HOST 下的仓库 THEN System SHALL 展示 HOST 名称或可识别标签
2. WHEN 两个 HOST 下存在相同 `workspaceId` THEN System SHALL 仍然能正确区分它们
3. WHEN 用户切换某个仓库的目标 HOST THEN System SHALL 使用该仓库当前选中的 `hostId + workspaceId` 作为后续操作目标
4. WHEN 目标 HOST 不可用 THEN System SHALL 在工作区视图给出不可用状态，不得把错误伪装成空列表

### 需求 6：代理 API 必须是受控白名单，不得变成任意转发器

**用户故事：** 作为维护者，我希望代理只服务明确的 CodingNS 仓库操作，不要变成安全风险。

#### 验收标准

1. WHEN 请求代理入口 THEN System SHALL 校验用户已经登录当前 HOST
2. WHEN 请求目标 HOST THEN System SHALL 校验目标 HOST 已保存、已检查通过、版本一致
3. WHEN 请求路径不在允许清单 THEN System SHALL 拒绝代理
4. WHEN 请求目标不是已保存 Peer HOST THEN System SHALL 拒绝代理

### 需求 7：第一阶段只代理仓库操作主链路

**用户故事：** 作为产品使用者，我希望先把不同 HOST 下仓库的常用操作跑通，而不是等一个过度庞大的全量代理。

#### 验收标准

1. WHEN 第一阶段交付 THEN System SHALL 至少支持工作区列表、工作台快照、会话、文件、Git 相关 API 的代理访问
2. WHEN 某个功能还没有代理支持 THEN System SHALL 给出明确提示，而不是静默失败
3. WHEN 后续新增代理能力 THEN System SHALL 通过白名单显式添加，不得默认开放全部路径

## 非功能需求

### 非功能需求 1：安全

1. WHEN 保存目标 HOST 登录态 THEN System SHALL 加密或使用现有敏感信息存储边界
2. WHEN 代理请求发起 THEN System SHALL 不允许用户传入任意 URL
3. WHEN 日志记录代理请求 THEN System SHALL 不记录 access token、refresh token、密码

### 非功能需求 2：可靠性

1. WHEN 目标 HOST 不可达 THEN System SHALL 快速失败，并保留当前 HOST 主流程可用
2. WHEN 目标 HOST 版本变更 THEN System SHALL 在下一次检查或代理请求前发现并阻断
3. WHEN 代理链路失败 THEN System SHALL 错误里包含目标 HOST 标识、路径类别和失败原因

### 非功能需求 3：可维护性

1. WHEN 新增可代理 API THEN System SHALL 在白名单和测试里明确声明
2. WHEN 排查问题 THEN System SHALL 能区分当前 HOST 认证失败、目标 HOST 认证失败、目标 HOST 不可达、版本不一致、路径不允许这几类问题
3. WHEN 修改工作区视图 THEN System SHALL 使用 `hostId + workspaceId`，不得继续假设 `workspaceId` 全局唯一

## 成功定义

- 当前 HOST 可以保存至少一台局域网 Peer HOST
- Peer HOST 只有在可达且同版本时才可用
- 前端 API 调用可以通过 `targetHostId` 走当前 HOST 代理
- 工作区视图能展示当前 HOST 和 Peer HOST 下的仓库来源
- 文件、Git、会话主链路不会把请求落到错误 HOST
- 当前 HOST 登录态和目标 HOST 登录态不会互相污染
