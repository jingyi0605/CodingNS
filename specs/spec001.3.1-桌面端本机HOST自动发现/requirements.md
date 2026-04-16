# 需求文档 - spec001.3.1 桌面端本机HOST自动发现

状态：Draft

## 简介

现在桌面端已经支持多 HOST，但还是有个很蠢的问题：

- 本机明明已经跑了 `codingns`
- 客户端却不知道
- 用户还得自己手填一条 HOST 地址

这不是功能缺失的小瑕疵，这是连接模型没把“本机正在跑的 Host”当成一等公民。

这次要解决的事情很明确：

1. 桌面端自动扫描本机已经运行中的 `codingns` 相关进程
2. 把可连接实例展示在 HOST 列表里的“自动发现”分类下
3. 自动发现项和手动保存项按地址去重，不允许一条地址显示两次
4. 自动发现 HOST 也要支持保存用户名和密码，并且落到本地路径

## 术语表

- **自动发现 HOST**：桌面端通过本机进程扫描和探活得到的运行时 HOST，不属于用户手工新增配置
- **手动 HOST**：用户通过 HOST 列表里的新增入口明确保存的 HOST
- **自动发现分类**：HOST 列表里专门承载自动发现结果的分组，不和手动 HOST 混成一锅
- **本地凭据路径**：客户端在本机持久化 HOST 用户名和密码的存储位置
- **去重命中**：自动发现 HOST 的 `baseUrl` 与手动 HOST 的 `baseUrl` 规范化后相同

## 范围说明

### In Scope

- Windows、macOS 桌面客户端的本机 `codingns` 进程扫描
- 从进程命令行参数里提取 Host 地址、端口和展示信息
- 自动发现 HOST 的运行时展示、刷新和失效规则
- 自动发现 HOST 与手动 HOST 的去重规则
- 自动发现 HOST 的用户名、密码本地保存能力

### Out of Scope

- Linux 桌面端自动发现
- 局域网其他机器的 Host 自动发现
- Host 进程自动启动、自动重启、自动拉起
- 自动发现结果同步到服务端数据库
- 把用户名密码回传给 Host 后端做额外协议改造

## 需求

### 需求 1：桌面端必须能扫描本机正在运行的 codingns Host

**用户故事：** 作为桌面端用户，我希望客户端能自动找到我本机已经跑起来的 `codingns` Host，而不是每次手动填地址。

#### 验收标准

1. WHEN 客户端运行在 `Windows` 或 `macOS` 桌面端 THEN System SHALL 提供本机 `codingns` Host 自动扫描能力
2. WHEN 扫描到疑似 `codingns` 进程 THEN System SHALL 解析其命令行中的地址、端口等启动信息
3. WHEN 命令行里解析出了候选地址 THEN System SHALL 再做一次 Host 探活，只有可连通实例才进入自动发现结果
4. WHEN 客户端运行在 Web、iOS、Android 或 Linux THEN System SHALL 不启用该自动发现能力

### 需求 2：自动发现 HOST 必须出现在 HOST 列表的自动发现分类下

**用户故事：** 作为用户，我希望一眼分清“这是我自己保存的 HOST”还是“客户端刚刚自动发现的本机 HOST”。

#### 验收标准

1. WHEN HOST 列表存在自动发现结果 THEN System SHALL 在列表中单独显示“自动发现”分类
2. WHEN 自动发现分类存在多个结果 THEN System SHALL 给出清晰的名称、地址和当前状态，不得只显示一串端口
3. WHEN 自动发现结果消失 THEN System SHALL 从自动发现分类里移除该项，不得在用户手工 HOST 列表里留下僵尸记录

### 需求 3：自动发现 HOST 与手动 HOST 必须按地址去重

**用户故事：** 作为已经手动保存过本机 HOST 的用户，我不希望自动发现再给我重复冒出一条一模一样的地址。

#### 验收标准

1. WHEN 自动发现 HOST 与手动 HOST 的 `baseUrl` 规范化后相同 THEN System SHALL 只保留手动 HOST 作为最终展示项
2. WHEN 手动 HOST 被删除，而自动发现结果仍然存在 THEN System SHALL 继续在自动发现分类里展示该地址
3. WHEN 同一个本机实例被多个进程线索重复命中 THEN System SHALL 只展示一条自动发现结果

### 需求 4：自动发现 HOST 的用户名和密码必须保存到本地路径

**用户故事：** 作为用户，我希望自动发现到的本机 HOST 也能记住我填过的用户名和密码，下次看到它时不用重新输入。

#### 验收标准

1. WHEN 用户为自动发现 HOST 输入用户名和密码 THEN System SHALL 把它们保存到本地持久化路径
2. WHEN 同一自动发现 HOST 下次再次被扫到 THEN System SHALL 能按该 HOST 的稳定标识或地址回填对应用户名和密码
3. WHEN 自动发现 HOST 消失 THEN System MAY 保留本地凭据，但不得在 UI 中错误回填到其他地址
4. WHEN 用户删除对应的手动 HOST 或清理凭据 THEN System SHALL 同步删除该 HOST 的本地用户名和密码

### 需求 5：自动发现结果必须是运行时数据，不得污染手工 HOST 配置

**用户故事：** 作为维护者，我希望自动发现只是运行时补充视图，而不是把用户的正式 HOST 配置写乱。

#### 验收标准

1. WHEN 客户端刷新自动发现结果 THEN System SHALL 只更新运行时自动发现列表，不得直接改写手动 `hosts[]`
2. WHEN 客户端退出后重新启动 THEN System SHALL 重新扫描自动发现结果，而不是把上一次扫描结果当正式配置直接读出来
3. WHEN 用户明确把自动发现 HOST 保存成手动 HOST THEN System SHALL 生成正式手动 HOST 配置，并继续受去重规则约束

### 需求 6：扫描过程不能把客户端卡死

**用户故事：** 作为桌面端用户，我希望自动发现是顺手能力，不是每次打开 HOST 列表都卡顿几秒。

#### 验收标准

1. WHEN 客户端启动或用户展开 HOST 列表 THEN System SHALL 以后台方式发起扫描，不得阻塞主界面交互
2. WHEN 扫描失败、解析失败或没有命中进程 THEN System SHALL 保持现有 HOST 列表可用，不得影响手动 HOST 的使用
3. WHEN 短时间内重复打开 HOST 列表 THEN System SHALL 复用最近扫描结果或冷却窗口，不得每次都重新做全量扫描

## 非功能需求

### 非功能需求 1：向后兼容

1. WHEN 当前用户只使用手动 HOST THEN System SHALL 保持现有手动 HOST 行为不变
2. WHEN 桌面端没有任何可发现进程 THEN System SHALL 不影响现有新增 HOST、切换 HOST、删除 HOST 流程

### 非功能需求 2：安全

1. WHEN 保存自动发现 HOST 的用户名和密码 THEN System SHALL 继续沿用本地凭据存储边界，不把密码扩散进 HOST 元数据结构
2. WHEN 自动发现结果与手动 HOST 去重命中 THEN System SHALL 不把自动发现来源覆盖手动 HOST 的显示和凭据归属

### 非功能需求 3：可维护性

1. WHEN 后续新增 Linux 支持或更多本地发现来源 THEN System SHALL 能在现有“发现层 + 合并层 + UI 展示层”结构上扩展
2. WHEN 排查自动发现异常 THEN System SHALL 能区分“进程未命中”“命令行解析失败”“Host 探活失败”“去重命中隐藏”这几类状态

## 成功定义

- Windows、macOS 桌面端能自动发现本机已运行的 `codingns` Host
- 自动发现项单独归类显示，不和手动 HOST 混成一锅
- 自动发现项与手动 HOST 按地址成功去重
- 自动发现 HOST 的用户名和密码可以落本地并稳定回填
- 整个扫描链路不会破坏现有多 HOST 主流程
