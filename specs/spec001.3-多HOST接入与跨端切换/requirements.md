# 需求文档 - spec001.3 多HOST接入与跨端切换

状态：Draft

## 简介

当前前端其实已经有一点“可切 host”的影子，但结构是错的。

真实情况是：

- 运行时配置里只有一个 `hostBaseUrl`
- 登录页和设置页本质上只是给这个字符串换值
- 历史地址只是输入历史，不是正式的 HOST 管理
- 登录态、记住密码、实时连接都还是单槽位思维

这会直接导致三个问题：

1. 用户可以改地址，但不能真正管理多个 HOST
2. 切换 HOST 后，登录态和运行时状态容易串
3. 桌面端和移动端都没有一个顺手的切换入口

这次要解决的事很明确：

1. 把 HOST 从“一个字符串”升级成正式的 `HOST Profile`
2. 支持桌面端和移动端方便切换当前激活 HOST
3. 让每个 HOST 的登录态、记住密码和最近连接信息彼此隔离
4. 保证现有工作区、会话、实时链路不会因为切换 HOST 被搞成半死不活

## 术语表

- **HOST Profile**：前端保存的一条可连接 Host 记录，至少包含 `id`、`name`、`baseUrl`
- **激活 HOST**：当前前端正在连接并用于请求 API / WebSocket 的 HOST
- **HOST 级登录态**：只属于某个 HOST 的 access token、refresh token 和登录用户信息
- **HOST 树**：移动端顶部切换器里的树状结构，第一层是 HOST，第二层是该 HOST 下可见的工作区
- **快速切换器**：桌面端标题栏里的 HOST 切换入口，用于在当前已保存 HOST 之间快速切换

## 范围说明

### In Scope

- 定义多 HOST 配置模型和迁移规则
- 定义 `activeHostId + hosts[]` 的运行时配置结构
- 按 HOST 保存登录态、记住密码、最近连接时间、最近用户信息
- 定义 HOST 切换时的统一前端事务
- 桌面端顶部切换器接入，位置固定在收起按钮和通知按钮之间
- 移动端顶部工作区切换器改成 `HOST -> 工作区` 树状排序
- 明确桌面端和移动端原生持久化边界

### Out of Scope

- 同时激活多个 HOST 并在一个会话页里混合展示数据
- 后端新增“多 HOST 聚合网关”
- H5 浏览器端完整复刻原生多 HOST 管理体验
- 把设备级 HOST 配置做成账号级跨端同步
- 重写现有 Host 认证协议、权限语义或数据库用户模型

## 需求

### 需求 1：前端必须有正式的多 HOST 配置模型

**用户故事：** 作为经常切换不同环境的用户，我希望客户端能保存多个 HOST，并且明确知道当前正在连接哪一个，而不是每次手输地址。

#### 验收标准

1. WHEN 客户端读取运行时配置 THEN System SHALL 读取 `hosts[]` 和 `activeHostId`，而不是继续只读单个 `hostBaseUrl`
2. WHEN 老版本本地配置里只有 `hostBaseUrl` THEN System SHALL 自动迁移成一条默认 HOST Profile，避免用户升级后配置丢失
3. WHEN 用户新增或编辑 HOST THEN System SHALL 对 `baseUrl` 做统一规范化，避免同一地址因为格式差异产生重复 Profile

### 需求 2：不同 HOST 的登录态必须隔离保存

**用户故事：** 作为同时连接测试环境和正式环境的用户，我希望每个 HOST 各自记住自己的登录态和账号，不会因为切换一下地址就把另一个环境的 token 覆盖掉。

#### 验收标准

1. WHEN 用户登录某个 HOST THEN System SHALL 只把该登录态保存到对应 HOST 的会话槽位
2. WHEN 用户切换到另一个 HOST THEN System SHALL 读取该 HOST 自己的登录态；如果没有，则进入未登录态
3. WHEN 用户在某个 HOST 退出登录 THEN System SHALL 只清理该 HOST 的登录态，不得顺手清空其他 HOST 的登录态
4. WHEN 用户启用记住密码 THEN System SHALL 按 HOST 保存对应账号密码，不得只保留最后一次登录的单条记录

### 需求 3：切换 HOST 必须是一个完整事务，不能留半截状态

**用户故事：** 作为正在使用工作台的用户，我希望切换 HOST 时客户端要么完整切过去，要么明确失败，不能出现页面还是旧数据、请求却打到新 HOST 的垃圾状态。

#### 验收标准

1. WHEN 用户切换激活 HOST THEN System SHALL 统一切换 HTTP 基址、WebSocket 连接目标和当前登录态来源
2. WHEN 旧 HOST 下存在工作台、会话、终端、Butler 等运行时状态 THEN System SHALL 在切换时统一销毁或重建这些运行时对象，不得继续复用旧 HOST 的内存状态
3. WHEN 目标 HOST 不可达或配置无效 THEN System SHALL 明确给出失败反馈，并保持原激活 HOST 不变

### 需求 4：桌面端必须有顺手的顶部快速切换入口

**用户故事：** 作为桌面端用户，我希望不用钻进设置页改地址，而是在主界面顶部就能切 HOST。

#### 验收标准

1. WHEN 桌面端进入主工作台 THEN System SHALL 在顶部标题栏区域提供 HOST 快速切换器
2. WHEN 布局渲染该切换器 THEN System SHALL 将其放在收起按钮和通知按钮之间
3. WHEN 用户展开切换器 THEN System SHALL 展示当前已保存 HOST 列表、当前激活项和新增入口
4. WHEN 用户切换 HOST 成功 THEN System SHALL 在主工作台立刻反映新的 HOST 上下文，而不是要求重启应用

### 需求 5：移动端必须在顶部工作区切换器里展示 HOST 树

**用户故事：** 作为移动端用户，我希望在一个入口里同时看到“我连了哪些 HOST”和“每个 HOST 下有哪些工作区”，而不是先切 HOST 再切工作区。

#### 验收标准

1. WHEN 移动端打开顶部工作区切换器 THEN System SHALL 以树状结构展示 `HOST -> 工作区`
2. WHEN 一个 HOST 当前没有可见工作区 THEN System SHALL 仍然展示该 HOST 节点，并允许用户切到该 HOST
3. WHEN 用户点击某个 HOST 节点 THEN System SHALL 把它切成激活 HOST，并把工作区列表刷新成该 HOST 的结果
4. WHEN 用户点击某个工作区节点 THEN System SHALL 先确保对应 HOST 激活，再进入该工作区

### 需求 6：现有工作区和导航主流程必须保持兼容

**用户故事：** 作为现有用户，我希望升级到多 HOST 后，原来“单 HOST + 工作区 + 会话”的使用方式还能正常工作，不会一升级全断。

#### 验收标准

1. WHEN 老用户升级后本地只有一条旧 `hostBaseUrl` THEN System SHALL 自动生成默认 HOST，并保持现有工作区主流程可用
2. WHEN 当前只有一个 HOST Profile THEN System SHALL 保持现有使用习惯，不强迫用户理解复杂的多 HOST 管理概念
3. WHEN 多 HOST 功能尚未配置第二个 HOST THEN System SHALL 不破坏现有登录、设置、工作区和会话流程

## 非功能需求

### 非功能需求 1：向后兼容

1. WHEN 老配置被迁移 THEN System SHALL 不要求用户清缓存或重新输入原地址
2. WHEN 桌面端已有 `client-runtime-config.json` THEN System SHALL 能兼容读取旧字段并平滑写入新结构

### 非功能需求 2：一致性

1. WHEN 当前激活 HOST 改变 THEN System SHALL 保证 HTTP、WebSocket、登录态和页面运行时看到的是同一个 HOST
2. WHEN 多窗口桌面端存在多个前端窗口 THEN System SHALL 明确主工作台切换 HOST 后其他窗口如何同步或重建，不能各连各的还假装是一套状态

### 非功能需求 3：安全

1. WHEN 保存 HOST 级登录态和记住密码 THEN System SHALL 保证它们至少在存储结构上彼此隔离，不得继续使用单键覆盖
2. WHEN 用户删除某个 HOST Profile THEN System SHALL 同时清理该 HOST 对应的敏感认证数据

## 成功定义

- 用户能在客户端里保存多个 HOST，并明确知道当前激活的是哪一个
- 桌面端能通过顶部切换器快速切 HOST，位置符合标题栏布局约束
- 移动端能在顶部切换器里看到 `HOST -> 工作区` 树状列表
- 不同 HOST 的登录态和记住密码互不串线
- 切换 HOST 后，工作台和实时连接不会出现“新旧 HOST 混用”的脏状态
