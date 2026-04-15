# 需求文档 - spec001.6-客户端与服务端统一更新机制

状态：Draft

## 简介

现在仓库里的更新能力是明显断裂的：

- 桌面端已经有更新面板，但底层还是一套手搓下载器，不是真正的官方更新链路
- Android 现在只有打包说明，没有正式的在线更新方案
- 服务端能查 npm registry，但前端只有“检查”和“打开页面”，没有真正的一键升级
- GitHub Release、安装包、校验信息、发布清单之间也没有完全收口

这不是功能少一点的问题，这是链路没闭合。

用户真正关心的是：

1. 客户端能不能知道有新版本
2. 知道以后能不能真的装上
3. 服务端能不能发现 npm 包升级并一键更新
4. 更新完以后系统会不会假装生效，实际上还是旧版本

所以这个 Spec 要解决的是一套现实问题：
客户端和服务端的更新必须真正跑通，而且每个平台都按自己的规矩来，不再拿一套逻辑硬抹平。

## 术语表

- **Desktop Update（桌面更新）**：macOS / Windows 客户端通过桌面壳完成的版本检查、下载和安装
- **Android APK Direct Install（Android APK 直装）**：应用下载新版 `APK` 后交给系统安装器继续安装的方式
- **Service Package Update（服务包更新）**：Host 检查并升级全局安装的 npm 包
- **Release Manifest（发布清单）**：客户端用于判断是否可升级的版本元数据，至少包含版本号、下载地址、校验信息和发布时间
- **Update Job（更新任务）**：通过 `TaskManager` 执行的后台更新任务，负责检查、下载或安装，不允许自己长一套私有队列
- **Restart Required（需要重启）**：更新包已经安装或下载完成，但当前进程仍在旧版本上运行，必须明确提示用户重启

## 范围说明

### In Scope

- 桌面端基于正式更新机制实现版本检查、下载和安装
- Android 基于 `APK` 直装实现版本检查、下载、校验和系统安装器唤起
- 服务端检查受管全局 npm 包是否有更新
- 服务端在用户确认后执行全局 npm 包升级
- 设置页统一展示客户端和服务端更新状态
- 发布流水线产出客户端更新所需的元数据和校验文件

### Out of Scope

- iOS 更新
- Android 静默安装
- 把服务端升级做成无监督的自我重启系统
- 第一阶段就接入所有平台的应用商店分发
- 桌面端和 Android 之外的新安装器生态

## 需求

### 需求 1：桌面端必须能检测到新版本并触发正式安装流程

**用户故事：** 作为桌面端用户，我希望应用能知道有新版本，并且在应用内直接下载和安装，而不是把我踢到网页手工找包。

#### 验收标准

1. WHEN 用户在 macOS 或 Windows 客户端执行手动检查 THEN System SHALL 返回当前版本、目标版本、发布时间和更新说明。
2. WHEN 客户端开启自动检查更新 THEN System SHALL 在桌面端启动后的合理时机自动检查一次，而不是每次页面刷新都查。
3. WHEN 桌面端发现新版本且元数据完整 THEN System SHALL 提供安装入口。
4. WHEN 用户确认安装 THEN System SHALL 进入正式安装流程，而不是仅仅打开下载页面。
5. WHEN 当前没有新版本 THEN System SHALL 明确返回“已是最新版本”。

### 需求 2：桌面端发布链路必须提供安装更新所需的签名与发布元数据

**用户故事：** 作为维护者，我希望桌面端发布后，客户端能拿到足够的元数据和签名信息完成安装，而不是运行时才发现缺文件。

#### 验收标准

1. WHEN 发布 macOS / Windows 客户端 THEN System SHALL 同时产出安装包、更新元数据和校验信息。
2. WHEN 客户端检查更新 THEN System SHALL 能取得与当前发布通道一致的目标版本信息。
3. WHEN 发布产物缺少安装包或校验信息 THEN System SHALL 在发布阶段失败，而不是把坏数据放出去。

### 需求 3：Android 客户端必须支持 `APK` 直装更新

**用户故事：** 作为 Android 用户，我希望应用能检测到新版本，下载新版 `APK`，并直接进入系统安装流程。

#### 验收标准

1. WHEN Android 客户端检查更新 THEN System SHALL 返回当前版本、目标版本、`versionCode`、下载地址、校验信息和更新说明。
2. WHEN Android 客户端发现新版本 THEN System SHALL 提供下载入口。
3. WHEN 下载完成且校验通过 THEN System SHALL 唤起系统安装器继续安装。
4. WHEN 新版 `APK` 的包名、签名或版本约束不合法 THEN System SHALL 阻止安装并给出明确错误。

### 需求 4：Android 更新流程必须明确承认系统限制

**用户故事：** 作为 Android 用户，我希望应用在需要系统授权或人工确认时讲清楚，而不是装作自己能静默升级。

#### 验收标准

1. WHEN 应用缺少“安装未知来源应用”所需授权 THEN System SHALL 给出明确引导。
2. WHEN 系统安装器需要用户确认 THEN System SHALL 明确提示当前已交给系统继续安装。
3. WHEN 下载失败、校验失败或安装被取消 THEN System SHALL 保留明确状态并允许用户重试。
4. WHEN Android 更新仍需用户最终确认 THEN System SHALL 不宣称“已自动安装完成”。

### 需求 5：服务端必须能检测受管全局 npm 包是否有更新

**用户故事：** 作为服务端使用者，我希望系统能告诉我哪些全局 npm 包有新版本，而不是让我自己登录机器手查。

#### 验收标准

1. WHEN 用户检查服务端更新 THEN System SHALL 返回受管包列表、当前版本、最新版本和是否可升级。
2. WHEN 当前发布通道为 `stable` 或 `beta` THEN System SHALL 按通道选择目标版本，而不是一律拿 `latest`。
3. WHEN npm registry 不可达 THEN System SHALL 返回明确失败状态，而不是假装“已是最新版本”。

### 需求 6：服务端必须支持点击后自动执行全局 npm 包升级

**用户故事：** 作为服务端使用者，我希望在界面里点一下就能执行全局升级，而不是再去命令行手输一遍。

#### 验收标准

1. WHEN 用户确认升级某个受管包 THEN System SHALL 在后台执行全局 npm 升级命令。
2. WHEN 后台执行升级 THEN System SHALL 通过 `TaskManager` 管理任务状态、去重、失败和日志摘要。
3. WHEN 同一个包的同一通道升级已在执行中 THEN System SHALL 去重，而不是并发跑两次。
4. WHEN 升级成功或失败 THEN System SHALL 把结果回写给前端展示。

### 需求 7：服务端更新后必须明确区分“包已升级”和“当前进程已切到新版本”

**用户故事：** 作为服务端使用者，我希望系统在升级完包以后讲清楚是否已经生效，避免我以为升级完成但进程还跑在旧版本。

#### 验收标准

1. WHEN 全局 npm 包升级成功但当前 Host 进程仍在旧版本 THEN System SHALL 标记为“需要重启”。
2. WHEN Host 运行在 `pm2`、`systemd` 或等价进程管理器下 THEN System SHALL 提供明确的后续动作提示。
3. WHEN Host 无法确认重启策略 THEN System SHALL 不宣称新版本已经生效。

### 需求 8：设置页必须提供统一的更新入口和可读状态

**用户故事：** 作为用户，我希望在一个地方看到客户端和服务端的更新状态，而不是每个平台各藏一半。

#### 验收标准

1. WHEN 用户进入设置页的软件更新区域 THEN System SHALL 同时展示客户端和服务端的更新信息。
2. WHEN 平台不支持某种安装方式 THEN System SHALL 明确说明“不支持”，而不是显示一个无效按钮。
3. WHEN 更新任务正在执行 THEN System SHALL 展示进行中状态，而不是让按钮像死了一样。

## 非功能需求

### 非功能需求 1：可靠性

1. WHEN 客户端下载更新包 THEN System SHALL 在安装前完成校验。
2. WHEN 服务端执行全局 npm 升级 THEN System SHALL 记录命令结果摘要和失败原因。
3. WHEN 更新元数据不完整 THEN System SHALL 提前失败。

### 非功能需求 2：可维护性

1. WHEN 新增更新任务 THEN System SHALL 复用现有 `TaskManager`，不允许再长私有队列。
2. WHEN 客户端平台不同 THEN System SHALL 明确分层，不把桌面和 Android 的更新逻辑硬塞进同一套实现。
3. WHEN 发布链路调整 THEN System SHALL 让桌面、Android、服务端的产物边界清楚可追踪。

### 非功能需求 3：兼容性

1. WHEN 保持现有桌面端、Android 和服务端安装方式 THEN System SHALL 尽量不破坏现有用户的数据目录和配置。
2. WHEN 客户端升级 THEN System SHALL 保留已有登录态和本地配置，除非平台本身限制。
3. WHEN 服务端升级后需要重启 THEN System SHALL 不破坏现有 `pm2` 托管方式。

## 成功定义

- macOS / Windows 客户端可以在应用内完成检查和安装
- Android 客户端可以通过 `APK` 直装链路完成下载、校验和系统安装
- 服务端可以检测受管全局 npm 包新版本，并在点击后执行升级
- 服务端升级结果能明确区分“包升级成功”和“进程已切到新版本”
- 设置页的软件更新区域不再只是展示半成品状态
