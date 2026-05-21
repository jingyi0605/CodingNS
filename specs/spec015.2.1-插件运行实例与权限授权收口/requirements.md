# 需求文档 - spec015.2.1-插件运行实例与权限授权收口

状态：Draft

## 简介

当前插件系统已经能注册插件、加载静态 HTML、执行 Node 动作，也能做基础审计。但离“正式可控”还差几步硬骨头：

- 插件前端还没有正式的“运行实例”对象，当前工作区上下文收口不够死。
- `manifest.permissions` 现在只是声明，没有和“用户授权”分开。
- 插件读写工作区文件还没有统一 Host 文件网关。
- 插件权限提示、授权记录、撤销授权、按目录放权这些实际使用会碰到的能力还没补上。

这次不是再加几个接口，而是把下面三件事补成系统铁律：

1. 插件运行时必须绑定当前工作区实例。
2. 插件权限必须先声明、再授权、再执行。
3. 工作区文件访问必须统一走 Host 网关，不能让插件前端或后端自己乱来。

## 术语表

- **System**：`CodingNS`
- **插件运行实例（Plugin Runtime Session）**：用户在某个工作区里打开某个插件时创建的正式运行会话对象。
- **权限声明（Permission Manifest）**：插件在 `plugin.json` 里声明“自己要申请哪些能力”。
- **权限授权（Permission Grant）**：用户或系统明确批准某插件在某工作区、某路径范围内使用某项能力的正式记录。
- **文件网关（Plugin File Gateway）**：Host 提供的统一文件访问入口，负责路径校验、权限判定、审计和结果返回。
- **目录级授权**：把某个目录及其子目录作为授权范围，而不是只放某一个文件。

## 范围说明

### In Scope

- `PluginRuntimeSession` 数据模型、存储和生命周期
- 前端插件桥改为基于 `runtimeSessionId` 调用 Host
- 插件动作调用去掉前端自由输入 `workspaceId`
- `PluginPermissionGrant` 数据模型、存储和权限判定逻辑
- 插件文件读/写/列目录 Host 网关
- 插件桌面动作接入同一套授权和审计链路
- 插件权限提示弹窗、授权记录展示、撤销授权
- 运行记录与审计记录补充 runtime session 和授权信息

### Out of Scope

- 真正的强沙箱后端执行器
- 远程第三方插件市场
- 任意系统命令授权
- 跨工作区联合授权
- 把普通 HTML 预览升级为插件运行时
- 插件后端直接拿本机任意路径读写权限

## 需求

### 需求 1：系统必须把“插件在当前工作区里运行”做成正式对象

**用户故事：** 作为维护者，我希望插件在某个工作区里打开时有正式运行实例，这样后面的权限、审计和动作调用才不会乱。

#### 验收标准

1. WHEN 用户在某个工作区里打开插件 THEN System SHALL 创建正式 `PluginRuntimeSession` 记录。
2. WHEN 前端插件桥调用动作或文件能力 THEN System SHALL 使用 `runtimeSessionId` 识别当前工作区，而不是要求前端自由传 `workspaceId`。
3. WHEN 前端请求体试图携带与当前实例不一致的 `workspaceId` THEN System SHALL 拒绝请求并记录审计。
4. WHEN 运行实例关闭或失效 THEN System SHALL 拒绝后续基于该实例的调用。

### 需求 2：系统必须把“权限声明”和“权限授权”分开

**用户故事：** 作为维护者，我希望插件先声明自己想申请什么，再由用户或系统决定给不给，而不是清单里写了就默认放开。

#### 验收标准

1. WHEN 插件 manifest 声明某项权限 THEN System SHALL 只把它视为“可申请能力”，不得直接视为已授权。
2. WHEN 插件请求未在 manifest 中声明的能力 THEN System SHALL 拒绝请求。
3. WHEN 插件请求已声明但尚未授权的能力 THEN System SHALL 返回可触发权限提示的正式拒绝结果。
4. WHEN 用户批准某项权限 THEN System SHALL 生成正式 `PluginPermissionGrant` 记录。

### 需求 3：系统必须支持插件文件读写和列目录的统一 Host 网关

**用户故事：** 作为使用者，我希望插件读文件、写文件、列目录都经过正式校验，而不是各写各的私有逻辑。

#### 验收标准

1. WHEN 插件请求读取工作区文件 THEN System SHALL 通过统一文件网关处理路径校验、权限判定和审计。
2. WHEN 插件请求写入工作区文件 THEN System SHALL 通过统一文件网关处理路径校验、权限判定和审计。
3. WHEN 插件请求列目录 THEN System SHALL 只返回当前工作区和已授权范围内的数据。
4. WHEN 插件请求路径越出工作区或越出已授权范围 THEN System SHALL 拒绝请求并记录审计。

### 需求 4：系统必须为插件读写和桌面动作提供权限提示与授权记录

**用户故事：** 作为使用者，我希望插件第一次读写文件或触发桌面动作时能先提示我，而不是悄悄做掉。

#### 验收标准

1. WHEN 插件首次请求需要授权的文件读能力 THEN System SHALL 提供权限提示入口。
2. WHEN 插件首次请求需要授权的文件写能力 THEN System SHALL 提供权限提示入口，并让写权限与读权限分开。
3. WHEN 用户批准权限 THEN System SHALL 支持至少一次、本次会话、目录级长期授权三种模式中的可用子集，并明确记录模式。
4. WHEN 用户撤销授权 THEN System SHALL 让后续相关调用重新回到未授权状态。

### 需求 5：系统必须把插件桌面动作收口到同一套运行实例和授权模型里

**用户故事：** 作为维护者，我希望插件“打开文件”“打开所在目录”这些桌面动作和文件读写用同一套边界，不要再长第二套后门。

#### 验收标准

1. WHEN 插件请求 `open_file` 或 `reveal_in_file_manager` THEN System SHALL 基于 `runtimeSessionId` 解析当前工作区。
2. WHEN 插件未声明对应桌面权限 THEN System SHALL 拒绝请求。
3. WHEN 插件已声明但尚未获得对应授权 THEN System SHALL 返回可提示的拒绝结果。
4. WHEN 请求路径在工作区外 THEN System SHALL 拒绝请求，不得直接透传给桌面桥。

### 需求 6：系统必须让运行记录和审计记录能追到运行实例与授权结果

**用户故事：** 作为排查问题的人，我希望知道某次插件调用到底属于哪个工作区实例、有没有授权、为什么被拒绝。

#### 验收标准

1. WHEN 插件动作执行 THEN System SHALL 在运行记录里关联 `runtimeSessionId`。
2. WHEN 插件请求因未授权被拒绝 THEN System SHALL 记录拒绝原因、权限 key、目标路径和工作区。
3. WHEN 用户创建或撤销授权 THEN System SHALL 记录操作者、授权范围、授权模式和时间。
4. WHEN 查看插件详情或运行记录 THEN System SHALL 能展示当前工作区下的授权摘要和最近授权相关事件。

## 非功能需求

### 非功能需求 1：边界稳定

1. WHEN 本次改造上线 THEN System SHALL 不破坏现有插件注册、启用/禁用、静态 HTML 容器和 Node 动作主链路。
2. WHEN 普通 HTML 文件预览继续使用旧链路 THEN System SHALL 不把插件桥或插件授权逻辑误注入进去。

### 非功能需求 2：可审计

1. WHEN 插件权限被申请、批准、拒绝或撤销 THEN System SHALL 留下正式可查询记录。
2. WHEN 插件文件访问或桌面动作被拒绝 THEN System SHALL 留下足够排查的信息。

### 非功能需求 3：可维护

1. WHEN 后续继续新增插件能力 THEN System SHALL 复用 `runtime session + permission grant + file gateway` 三层结构，而不是再长私有入口。
2. WHEN 排查插件越权问题 THEN System SHALL 能从运行记录、授权记录和审计记录定位问题。

## 成功定义

- 前端插件桥不再自由传 `workspaceId`。
- 插件文件读写和桌面动作都统一走 Host 网关。
- 授权与声明彻底分开，未授权能力不会被默认放行。
- 插件详情页可以看见当前工作区的授权摘要与最近相关记录。
