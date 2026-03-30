# 需求文档 - spec001.1 账户偏好入库与跨客户端同步

状态：Draft

## 简介

当前设置页里有一类配置放错地方了。

真实情况是：

- `defaultPermissionMode` 现在混在 `codingns.client.runtime-config` 里，只存在浏览器 `localStorage` 或桌面端本地配置文件里
- `language`、`theme`、`composer-selected-model:*`、`composer-reasoning-level:*` 也各自散落在本地
- 这些值明显属于“这个账号偏好怎么用产品”，不是“这台设备怎么连服务”
- 结果就是同一个账号换个客户端登录，默认权限、语言、主题、模型偏好全没了

真正的问题不是“再加一个持久化写入点”，而是账户偏好和设备配置混成了一锅。

这次要解决的事很明确：

1. 把账户级偏好单独定义出来，落到数据库
2. 让同一账号在多个客户端登录后拿到一致的默认值
3. 明确哪些配置该继续留在本地，别什么都往数据库里塞
4. 保证旧客户端升级后不会因为偏好迁移把现有行为搞坏

## 术语表

- **账户级偏好**：同一账号无论在哪个客户端登录，都应该保持一致的默认值，例如语言、主题、默认会话权限
- **设备级配置**：跟设备环境、安装形态、网络环境强绑定的配置，例如服务器地址、更新通道
- **Provider 默认偏好**：针对某个 provider 记录的默认模型和默认推理等级
- **Shadow Cache**：本地保留的一份账户偏好影子副本，用来解决冷启动和离线时的首屏回退
- **Legacy LocalStorage**：当前已经在线上或本地存在的旧键，例如 `codingns.client.runtime-config`、`codingns-theme`

## 范围说明

### In Scope

- 把 `defaultPermissionMode` 改成账户级数据库偏好
- 把 `language`、`theme` 改成账户级数据库偏好
- 把按 provider 的默认模型和默认推理等级改成账户级数据库偏好
- 新增后端偏好表、仓储、服务和受保护接口
- 前端拆分“账户偏好”和“设备配置”的读取与保存逻辑
- 设计并落地旧 `localStorage` 到数据库的一次性回填策略
- 明确哪些 `localStorage` 键保留本地，哪些迁到数据库

### Out of Scope

- 把 `hostBaseUrl`、`releaseChannel`、`autoReconnect`、`autoCheckUpdate` 落库
- 把 `workbench.*` 布局状态、移动端导航状态、输入草稿、终端恢复状态落库
- 把登录令牌、refresh token、remember password 这类认证数据做成数据库跨端同步
- 改写 Codex / Claude / OpenCode 的权限语义，只允许变更默认值来源

## 需求

### 需求 1：默认会话权限必须成为账户级偏好

**用户故事：** 作为同一个账号的多端用户，我希望我在任一客户端改过的默认会话权限，在别的客户端登录后也自动生效，这样我不用每台设备都重新选一遍。

#### 验收标准

1. WHEN 用户在设置页修改 `defaultPermissionMode` THEN System SHALL 将新值持久化到当前账号对应的数据库偏好记录，而不是只写本地 `localStorage`
2. WHEN 同一账号在另一台设备或另一种客户端登录 THEN System SHALL 读取数据库中的 `defaultPermissionMode` 并作为新会话和继续会话的默认权限来源
3. WHEN 用户没有设置账户级 `defaultPermissionMode` THEN System SHALL 继续回退到现有 CLI/provider 默认行为，而不是强行写入危险权限

### 需求 2：账户级偏好和设备级配置必须分层

**用户故事：** 作为系统维护者，我希望“跟账号走”的设置和“跟设备走”的设置被拆开，这样后续加新设置时不会继续把数据结构搞烂。

#### 验收标准

1. WHEN 前端初始化设置状态 THEN System SHALL 能明确区分账户级偏好和设备级配置，而不是继续把两者混在同一个存储对象里
2. WHEN 保存 `hostBaseUrl`、`releaseChannel`、`autoReconnect`、`autoCheckUpdate` THEN System SHALL 继续只写设备本地配置，不写账户偏好表
3. WHEN 保存 `defaultPermissionMode`、`language`、`theme`、provider 默认偏好 THEN System SHALL 统一走账户偏好写入链路

### 需求 3：首批适合跨端同步的偏好必须一起落库

**用户故事：** 作为日常在多端切换的用户，我希望语言、主题、默认模型这些“我个人习惯”能一起同步，而不是只同步一个默认会话权限，其他还得每端再配一次。

#### 验收标准

1. WHEN 用户修改语言或主题 THEN System SHALL 将对应值保存为账户级偏好，并在其他客户端登录后生效
2. WHEN 用户为某个 provider 选择默认模型或默认推理等级 THEN System SHALL 将该偏好按 provider 维度持久化到数据库
3. WHEN 某个 provider 没有数据库偏好 THEN System SHALL 回退到现有 provider 默认值或 CLI 默认值，不凭空生成脏数据

### 需求 4：旧本地配置必须可迁移且不破坏现有行为

**用户故事：** 作为现有用户，我希望升级之后以前已经在本地配好的默认权限、主题和模型偏好不会突然丢失，也不会因为服务暂时不可用就被清空。

#### 验收标准

1. WHEN 已登录用户首次升级到新版本且数据库里还没有对应偏好 THEN System SHALL 从现有 Legacy LocalStorage 读取可迁移的账户级偏好并执行一次幂等回填
2. WHEN 数据库偏好加载失败、接口超时或用户离线 THEN System SHALL 继续使用本地 shadow cache 或现有安全回退值，不得把设置重置成空值
3. WHEN 数据库里已经存在较新的账户偏好 THEN System SHALL 以数据库为准，不得被旧本地值反向覆盖

### 需求 5：本地保留项必须有明确清单，不能趁机乱扩

**用户故事：** 作为后续接手这个模块的人，我希望看到一份明确清单，知道哪些键保留本地，避免未来又有人把面板宽度、草稿、token 这种垃圾一起塞进数据库。

#### 验收标准

1. WHEN 评审这个 Spec THEN System SHALL 明确列出保留在本地的配置清单和原因
2. WHEN 开发者尝试把 `workbench.*`、`mobile.*`、草稿、终端恢复状态或认证令牌纳入账户偏好 THEN System SHALL 在设计和任务文档里将其视为越界
3. WHEN 新增一个设置项 THEN System SHALL 先按“账户级偏好 / 设备级配置 / 临时界面状态”分类，再决定存储位置

## 非功能需求

### 非功能需求 1：一致性

1. WHEN 同一账号在多个客户端连续保存账户偏好 THEN System SHALL 保证最后一次成功写入的值可被后续读取到
2. WHEN 前端读取账户偏好 THEN System SHALL 保持“会话显式值优先于账户默认值，账户默认值优先于本地回退值”的稳定优先级

### 非功能需求 2：向后兼容

1. WHEN 旧客户端或旧本地配置还存在 THEN System SHALL 能继续读取 Legacy LocalStorage 作为迁移输入，不要求用户手工清缓存
2. WHEN 后端暂时没有账户偏好记录 THEN System SHALL 返回可解释的默认结构，而不是让前端用 `null` 到处打补丁

### 非功能需求 3：安全

1. WHEN 账户偏好接口被调用 THEN System SHALL 仅允许已登录用户访问和修改自己的偏好记录
2. WHEN 偏好字段属于高风险默认值，例如 `defaultPermissionMode` THEN System SHALL 只接受枚举内合法值，拒绝任意字符串写入

## 成功定义

- 同一账号在两个客户端之间切换时，`defaultPermissionMode` 能稳定同步
- 首批账户级偏好 `language`、`theme`、provider 默认模型和推理等级能随账号同步
- `hostBaseUrl`、更新通道、草稿、布局状态、终端恢复状态仍然留在本地，没有被误迁进数据库
- 前端启动和登录流程能处理“数据库有值、本地有旧值、接口失败”三种常见情况，不出现莫名其妙的重置
