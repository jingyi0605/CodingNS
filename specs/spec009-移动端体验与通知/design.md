# 设计文档 - spec009-移动端体验与通知

状态：Draft

## 1. 概述

### 1.1 目标

- 让移动端具备与 PC 端一致的业务能力，而不是“轻操作子集”
- 继续复用现有 Host、前置 Spec 协议和共享业务逻辑，不再造第二套内核
- 将移动端实现明确拆成 `core / platform adapter / platform ui`
- 让 iOS / Android 的视觉、导航、交互分别符合各自平台习惯
- 在不破坏桌面端与 H5 现有实现的前提下，补齐 Android / iOS 客户端交付

### 1.2 覆盖需求

- `requirements.md` 需求 1：移动端业务能力与 PC 对齐
- `requirements.md` 需求 2：平台 UI 分别优化
- `requirements.md` 需求 3：三层架构
- `requirements.md` 需求 4：iOS 原生感交互
- `requirements.md` 需求 5：Android / Material 交互
- `requirements.md` 需求 6：会话、文件、Git、终端、日志、进程完整可用
- `requirements.md` 需求 7：统一鉴权与实时保护
- `requirements.md` 需求 8：通知与系统能力适配
- `requirements.md` 需求 9：大屏适配
- `requirements.md` 需求 10：复用前置 Spec，不重复协议

### 1.3 技术约束

- 前置依赖：`spec003`、`spec004`、`spec005`、`spec006`、`spec007`、`spec008`
- 客户端壳：`Tauri Mobile`（Android / iOS）
- 前端技术：`React + TypeScript`
- 通信方式：`HTTP + WebSocket`
- 数据边界：继续以 Host / provider 为唯一业务真相，不新增第二套会话原始消息仓库
- 当前仓库入口：移动端继续基于 `apps/user-app` 演进，不另起一套脱节应用

### 1.4 当前实现状态

- 已完成：`apps/user-app/src-tauri/` 初始化，Android 首编已打通
- 已完成：壳层从错误引入的 Capacitor 路线切回 `Tauri Mobile`
- 未完成：iOS 壳初始化与编译
- 未完成：平台运行时类型仍只有 `desktop / web`，尚未扩展 `ios / android`
- 未完成：移动端专属导航、平台适配层、平台 UI 皮肤、通知中心、系统能力桥接

## 2. 架构

### 2.1 总体结构

移动端采用“三层结构 + 一套后端能力”的方案：

| 层 | 职责 | 典型内容 | 明确不做什么 |
| --- | --- | --- | --- |
| `core` | 统一业务逻辑、状态机、接口调用、领域模型 | 会话运行时、工作区状态、文件/Git/终端/进程数据流 | 不直接感知 iOS / Android UI 差异 |
| `platform adapter` | 对接系统能力和运行时差异 | 通知、权限、文件导入、分享、相机、相册、生物识别、触感反馈、后台恢复 | 不承载业务编排，不写页面布局 |
| `platform ui` | 根据平台渲染导航、容器、组件皮肤与交互 | iOS Tab Bar / Navigation Bar / Sheet；Android Top App Bar / Bottom Navigation / Bottom Sheet | 不复制业务逻辑，不重新实现网络协议 |

一句人话：
业务怎么跑，放 `core`；
手机系统能做什么，放 `platform adapter`；
页面怎么长、怎么动、怎么返回，放 `platform ui`。

### 2.2 当前代码到目标结构的落点

| 现有目录 | 目标角色 | 后续演进 |
| --- | --- | --- |
| `apps/user-app/src/features/*` | 优先沉淀到 `core` | 把与平台无关的状态、业务流程、接口调用继续收拢 |
| `apps/user-app/src/network/*` | `core` 基础设施 | 继续承载 HTTP / WebSocket 调用 |
| `apps/user-app/src/auth/*` | `core` + 安全边界 | 登录态、令牌刷新、受保护数据拦截继续复用 |
| `apps/user-app/src/platform/*` | `platform adapter` 主入口 | 扩成 `desktop / web / ios / android` 四类运行时 |
| `apps/user-app/src/app/*` | 路由与页面装配层 | 拆分平台导航壳与共享路由意图 |
| `apps/user-app/src/shared/*` | 跨平台基础组件与主题能力 | 只保留真正共享的基础件，不做假原生皮肤大杂烩 |
| `apps/user-app/src-tauri/*` | Tauri 壳层 | Android / iOS 工程、原生桥接、打包配置 |

### 2.3 运行时平台模型

当前 `RuntimePlatform` 只有 `desktop | web`，这不够。

目标运行时枚举应扩成：

- `desktop`
- `web`
- `ios`
- `android`

`PlatformUiProfile` 也要从“桌面标题栏长什么样”升级成真正的移动端上下文，至少包含：

- `platform`
- `osFamily`
- `navigationStyle`
- `prefersBottomTabs`
- `prefersPushNavigation`
- `supportsEdgeSwipeBack`
- `supportsSafeAreaInsets`
- `supportsHaptics`
- `supportsBiometricAuth`
- `supportsShareSheet`
- `supportsDocumentImport`
- `supportsBackgroundResume`

### 2.4 能力分层原则

#### 2.4.1 必须放在 `core` 的内容

- 会话读取、发送、失败重试、实时同步、能力门控
- 工作区加载、聚合状态、入口组织
- 文件、Git、终端、进程、日志的数据获取和业务动作
- 登录态校验、令牌刷新、受保护请求治理
- 与 Host 的 HTTP / WebSocket 契约

#### 2.4.2 必须放在 `platform adapter` 的内容

- 推送注册、通知渠道、应用内通知桥接
- 分享面板 / 分享 Intent
- 文件选择、文件导入、导出、系统文件权限
- 相册 / 拍照
- 生物识别
- 触感反馈
- 前后台切换、后台恢复、后台任务
- Safe Area、状态栏、窗口 inset、系统返回

#### 2.4.3 必须放在 `platform ui` 的内容

- iOS 的 Tab Bar、Navigation Bar、push、sheet、grouped list、action sheet
- Android 的 Top App Bar、Bottom Navigation、Bottom Sheet、FAB、ripple、elevation
- 平板 / 折叠屏的两栏或多区域布局
- 页面转场、模态呈现、手势返回、系统栏样式

### 2.5 导航结构

#### 2.5.1 共享导航意图

共享层只维护“用户要去哪里”，不直接决定“怎么呈现”。

共享路由意图至少包括：

- 首页
- 工作区概览
- 会话
- 文件
- Git
- 终端
- 日志
- 进程
- 设置
- 通知收件箱

#### 2.5.2 iOS 导航模型

- 一级结构：Bottom Tab Bar
- 二级结构：Navigation Stack 的 push
- 操作面板：sheet / action sheet / full-screen modal
- 默认支持：手势返回、safe area、键盘联动、轻量转场、haptic feedback

#### 2.5.3 Android 导航模型

- 一级结构：Bottom Navigation + Top App Bar
- 二级结构：标准 back stack
- 操作面板：Bottom Sheet / Dialog / Fullscreen destination
- 默认支持：系统返回、ripple、elevation、状态栏适配、权限申请流程

#### 2.5.4 大屏与折叠屏模型

- 不能只是把手机单栏拉宽
- 优先支持列表-详情双栏
- 会话、文件、Git、终端、日志等天然主次结构的页面要适配双区域布局
- 姿态变化和折叠展开时保持导航与页面状态连续

## 3. 功能设计

### 3.1 业务能力对齐清单

| 能力 | 数据来源 | `core` 复用策略 | 移动端 UI 差异 |
| --- | --- | --- | --- |
| 工作区 | 现有工作区 API / 实时状态 | 复用现有聚合数据流 | 首页、Tab 结构、卡片布局按平台变化 |
| 会话 | `spec003` 运行时 | 直接复用消息模型与能力门控 | 列表、输入区、消息操作、转场按平台变化 |
| 文件 | `spec004` | 复用文件树、读取、保存能力 | 文件树呈现、编辑器容器、导入导出交互按平台变化 |
| Git | `spec005` | 复用状态、diff、提交、同步能力 | diff 呈现、提交确认、分支选择 UI 按平台变化 |
| 终端 | `spec006` | 复用终端流、命令执行、历史 | 全屏容器、工具栏、输入保护按平台变化 |
| 日志 | `spec006/007` | 复用日志流、过滤与分页 | 全屏查看、过滤器入口按平台变化 |
| 进程 | `spec007` | 复用进程状态、启停、日志入口 | 状态卡片、操作确认、后台恢复提示按平台变化 |
| 设置 | 现有设置 API | 复用配置模型 | 表单、分组、系统能力入口按平台变化 |
| 通知 | Host 事件 + 移动端订阅 | 共享事件语义 | 推送、收件箱、系统渠道由适配层实现 |

### 3.2 关键流程

#### 3.2.1 登录与启动

1. App 启动后先读取本地配置与令牌状态
2. `platform adapter` 提供平台上下文、safe area、权限状态、通知能力状态
3. 若未登录或令牌失效，进入统一登录流程
4. 登录成功后加载工作区与用户上下文，并恢复实时订阅

#### 3.2.2 会话流程

1. 进入会话页时加载历史消息与能力描述
2. 建立实时订阅并接收增量消息
3. 用户发送消息后展示发送态、失败态、重试入口
4. 弱网、切后台、恢复前台后按游标补齐消息

#### 3.2.3 文件 / Git / 终端 / 进程流程

1. 从工作区进入对应能力页
2. 共用 `core` 的业务动作与状态流
3. 高风险动作使用平台适合的确认方式呈现
4. 若操作依赖系统能力或权限，由 `platform adapter` 先处理权限与系统入口

#### 3.2.4 通知流程

1. Host 产生会话、进程、失败、人工介入等事件
2. `core` 统一映射为通知语义
3. `platform adapter` 负责注册推送、投递系统通知、写入应用内收件箱
4. `platform ui` 根据平台规范展示通知入口、已读态、深链跳转结果

## 4. 组件与接口

### 4.1 核心组件分组

#### 4.1.1 `core` 组件

- `WorkspaceRuntime`
- `ConversationRuntime`
- `FileRuntime`
- `GitRuntime`
- `TerminalRuntime`
- `ProcessRuntime`
- `AuthRuntime`
- `NotificationRuntime`

#### 4.1.2 `platform adapter` 组件

- `NotificationAdapter`
- `FileAccessAdapter`
- `ShareAdapter`
- `PermissionAdapter`
- `BiometricAdapter`
- `HapticAdapter`
- `LifecycleAdapter`
- `WindowInsetAdapter`

#### 4.1.3 `platform ui` 组件

- `IosAppShell`
- `AndroidAppShell`
- `IosNavigationScaffold`
- `AndroidNavigationScaffold`
- `IosModalPresenter`
- `AndroidSheetPresenter`
- `AdaptiveSplitLayout`

### 4.2 数据结构

#### 4.2.1 `MobileCapabilityMatrix`

用于声明“某项业务功能是否可用，以及缺的是业务权限还是系统权限”。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `featureKey` | string | 能力标识，例如 `conversation.reply`、`git.commit` |
| `available` | boolean | 业务能力是否可用 |
| `blockedBy` | `"none" \| "business-permission" \| "system-permission" \| "device-limitation"` | 阻塞原因 |
| `detail` | string | 给用户看的原因说明 |

#### 4.2.2 `PlatformPresentationContext`

用于控制页面呈现方式。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `platform` | `"ios" \| "android" \| "desktop" \| "web"` | 当前平台 |
| `navigationStyle` | string | 导航模式 |
| `safeAreaInsets` | object | 安全区 |
| `windowSizeClass` | `"compact" \| "medium" \| "expanded"` | 尺寸等级 |
| `supportsEdgeSwipeBack` | boolean | 是否支持边缘返回 |

#### 4.2.3 `MobileNotificationItem`

沿用通知中心模型，但不再把它定义成“轻提醒”专属结构。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 通知 ID |
| `workspaceId` | string | 关联工作区 |
| `eventType` | string | 事件类型 |
| `priority` | string | 优先级 |
| `title` | string | 标题 |
| `body` | string | 摘要 |
| `deepLink` | string \| null | 深链 |
| `read` | boolean | 已读状态 |
| `createdAt` | string | 创建时间 |

### 4.3 接口契约

#### 4.3.1 继续复用的接口

下面这些能力优先复用 PC 端已有接口，不另起移动专用协议：

- 工作区
- 会话
- 文件
- Git
- 终端
- 进程
- 设置

#### 4.3.2 移动端新增接口

只新增移动端专属的设备与通知接口。

##### `POST /api/mobile/devices/register`

- 作用：登记设备标识、平台、推送 token、能力矩阵
- 输入：Access Token、设备信息、能力信息
- 输出：登记结果

##### `GET /api/mobile/notifications/inbox`

- 作用：获取应用内通知收件箱
- 输入：分页参数、Access Token
- 输出：`MobileNotificationItem[]`

##### `PATCH /api/mobile/notifications/{id}/read`

- 作用：更新已读状态
- 输入：通知 ID、已读状态、Access Token
- 输出：更新后的通知

#### 4.3.3 平台适配接口

这些不是 HTTP 接口，而是前端内部抽象：

- `requestPermission(permissionKey)`
- `showShareSheet(payload)`
- `openDocumentPicker(options)`
- `presentSystemNotification(payload)`
- `triggerHaptic(type)`
- `authenticateBiometric(reason)`
- `readSafeAreaInsets()`
- `subscribeAppLifecycle()`

## 5. 状态与错误处理

### 5.1 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `AUTH_REQUIRED` | 需要登录 | 无 token 或 token 失效 | 登录成功 |
| `BOOTSTRAPPING` | 启动中 | App 启动、恢复前台、恢复后台任务 | 完成初始化 |
| `READY` | 应用可用 | 核心数据与平台上下文已加载 | 登出或进入错误态 |
| `REALTIME_RECONNECTING` | 实时连接重连中 | WS 断开或后台恢复 | 连接恢复或失败 |
| `DEVICE_PERMISSION_REQUIRED` | 等待系统权限 | 调用平台能力前发现权限缺失 | 权限授予或用户取消 |
| `NOTIFICATION_PENDING` | 有待处理通知 | 收到未读通知 | 用户处理或清空 |

### 5.2 错误类型

- `AUTH_EXPIRED`
- `REALTIME_HANDSHAKE_FAILED`
- `PLATFORM_CAPABILITY_UNAVAILABLE`
- `PLATFORM_PERMISSION_DENIED`
- `BACKGROUND_RESUME_FAILED`
- `NOTIFICATION_DELIVERY_FAILED`
- `RESOURCE_NOT_FOUND`

### 5.3 处理策略

1. 鉴权错误：统一跳转登录并清理受保护缓存
2. 平台权限错误：提示原因、权限状态和恢复入口
3. 适配层不可用：返回统一错误语义，不在页面里散落原生错误文案
4. 后台恢复失败：提示用户当前状态已降级，并允许手动重试

## 6. 正确性属性

### 6.1 属性 1：业务能力不分叉

*对于任何* 已在 PC 端交付的核心业务能力，移动端都必须使用同一套 Host 语义和数据来源，不得再定义一套移动端专属真相。

**验证需求：** 需求 1、需求 10

### 6.2 属性 2：平台差异只停留在适配层和 UI 层

*对于任何* iOS / Android 差异，系统都应该满足：差异只存在于 `platform adapter` 或 `platform ui`，不会污染核心业务状态机。

**验证需求：** 需求 2、需求 3、需求 4、需求 5

### 6.3 属性 3：所有受保护数据统一鉴权

*对于任何* 移动端受保护请求、实时连接、后台恢复连接，系统都应该满足：未登录或令牌无效时不泄露业务数据。

**验证需求：** 需求 7

## 7. 测试策略

### 7.1 单元测试

- 运行时平台识别与 `PlatformUiProfile` 计算
- `platform adapter` 的权限、通知、分享、文件导入抽象
- 平台导航状态机
- 通知分级与深链解析

### 7.2 集成测试

- 登录、令牌刷新、WebSocket 握手、后台恢复
- 会话、文件、Git、终端、进程、通知主链路
- iOS / Android UI 壳选择与适配层注入

### 7.3 端到端测试

- Android：登录 -> 首页 -> 工作区 -> 会话 -> 文件/Git/终端 -> 返回
- iOS：登录 -> 首页 -> 工作区 -> push -> sheet -> 系统能力调用 -> 返回
- 平板 / 折叠屏：布局切换、姿态变化、状态保持
- 推送与深链：通知到达 -> 点击 -> 精确跳转 -> 已读回写

### 7.4 构建验证

- Android Debug / Release 构建
- iOS Debug / Release 构建
- Tauri Mobile 壳层桥接编译

## 8. 风险与待确认项

### 8.1 风险

- 如果继续把平台分支写进页面，后面一定会变成条件判断地狱
- 如果坚持“一套组件 everywhere”，最后只能得到两端都不像的半成品
- 如果不先扩展 `RuntimePlatform` 与 `platform adapter`，业务功能对齐会被系统能力接入反复卡住
- 大屏适配如果拖到最后补，最终只会变成放大版手机 UI

### 8.2 待确认项

- iOS 首版是否同步接入生物识别与分享面板
- Android 首版后台任务和通知渠道的最小实现范围
- 平板 / 折叠屏首版是否直接支持列表-详情双栏，还是先支持宽屏单栏增强版
