# 需求文档 - spec009-移动端体验与通知

状态：Draft

## 简介

这个 Spec 的目标已经变了。

它不再是“手机上做个查看和轻操作入口”，而是：

- 把 PC 端已有的业务能力带到移动端
- 让 iOS 和 Android 各自长得像自己的平台
- 继续复用同一套 Host、同一套协议、同一套业务真相

真正要避免的垃圾方案只有两种：

1. 把桌面网页直接缩小塞进手机
2. 为移动端再造一套和 PC 端脱节的业务内核

## 术语表

- **System**：`码不能停` 的移动端客户端 + `CodingNS Host`
- **Mobile Client（移动端客户端）**：Android / iOS 应用，运行在 `Tauri Mobile` 壳内
- **PC Parity（与 PC 对齐）**：移动端具备与当前 PC 端同级别的业务能力，不再以“轻操作”作为上限
- **Core（业务内核层）**：会话、工作区、文件、Git、终端、进程、设置等共用业务逻辑、状态机和接口调用
- **Platform Adapter（平台适配层）**：文件导入、分享、通知、权限、生物识别、相机、触感反馈、后台任务等系统能力桥接
- **Platform UI（平台界面层）**：iOS 皮肤、Android 皮肤，以及对应的导航、组件、动效和布局
- **Protected Data（受保护数据）**：工作区、会话、文件、Git、终端、进程、日志等登录后才允许访问的数据

## 范围说明

### In Scope

- 移动端业务能力与 PC 端对齐
- iOS / Android 分平台导航、组件和视觉规范
- `core / platform adapter / platform ui` 三层结构
- 会话、工作区、文件、Git、终端、日志、进程、设置、通知在移动端的完整交付
- 登录态保护、实时连接保护、后台恢复、推送订阅
- 分享、文件导入、权限、生物识别、触感反馈、通知渠道等平台能力接入
- 平板、折叠屏、大屏手机的自适应布局

### Out of Scope

- 重新定义 `spec003`、`spec004`、`spec005`、`spec007`、`spec008` 已确定的核心协议
- 用“一套 UI 组件无差别通吃所有平台”的方案掩盖平台差异
- 把移动端变成桌面多窗口、多面板布局的粗暴缩放版
- 与企业 IM、企业 MDM 等重度企业集成直接绑定在第一版里

## 需求

### 需求 1：移动端业务能力必须与 PC 端对齐

**用户故事：** 作为用户，我希望在手机和平板上完成和 PC 端同一套事情，而不是被迫切回电脑处理“移动端不支持”的核心工作。

#### 验收标准

1. WHEN 某项业务能力已在 PC 端 `user-app` 交付 THEN System SHALL 在移动端提供等价的业务能力入口，而不是以“移动端只做轻操作”为理由阉割。
2. WHEN 用户在移动端查看工作区、会话、文件、Git、终端、进程、设置、通知 THEN System SHALL 使用与 PC 端同一套 Host 数据源与协议，不出现第二套业务真相。
3. WHEN 某项能力因系统权限或硬件缺失暂不可用 THEN System SHALL 明确给出平台原因和恢复路径，而不是直接假装这项能力不存在。

### 需求 2：移动端 UI 必须按平台分别优化，不能缩小网页版

**用户故事：** 作为移动端用户，我希望应用在 iPhone 和 Android 手机上都像各自平台的产品，而不是一张被压扁的网页。

#### 验收标准

1. WHEN 用户在 iOS 使用应用 THEN System SHALL 呈现符合 iOS 习惯的导航、分组列表、表单、sheet、返回手势和 safe area 处理。
2. WHEN 用户在 Android 使用应用 THEN System SHALL 呈现符合 Android / Material 习惯的 Top App Bar、Bottom Navigation、返回逻辑、状态反馈和权限流程。
3. WHEN 设计评审或实现评审 THEN System SHALL 明确禁止“一套组件 everywhere”的方案，平台差异必须体现在 UI 层，而不是靠主题色敷衍。

### 需求 3：架构必须拆成 `core / platform adapter / platform ui`

**用户故事：** 作为维护者，我希望业务逻辑、系统能力、平台界面分层清楚，这样以后加功能、修 Bug、做平台优化不会互相污染。

#### 验收标准

1. WHEN 开发业务能力 THEN System SHALL 把会话、工作区、文件、Git、终端、进程等核心逻辑放在 `core`，不把平台分支写进业务流程。
2. WHEN 调用通知、分享、文件导入、权限、生物识别、触感反馈、后台任务等系统能力 THEN System SHALL 通过 `platform adapter` 访问，不允许页面直接拼平台调用。
3. WHEN 渲染页面 THEN System SHALL 通过 `platform ui` 选择 iOS 或 Android 的页面壳、导航和组件皮肤，而不是在每个组件里堆 `if ios / if android`。

### 需求 4：iOS 体验必须遵循 iPhone 用户熟悉的交互模型

**用户故事：** 作为 iPhone 用户，我希望应用像 iOS 应用，而不是 Android 式导航或者网页弹窗乱飞。

#### 验收标准

1. WHEN 用户在 iOS 端浏览主流程 THEN System SHALL 优先使用 Bottom Tab Bar、Navigation Bar、push、sheet、full-screen modal 等原生感结构。
2. WHEN 页面显示在带刘海或 Home Indicator 的设备上 THEN System SHALL 正确处理 safe area、底部留白、手势返回和键盘顶起。
3. WHEN 需要系统能力 THEN System SHALL 优先接入 iOS 用户熟悉的分享面板、文件导入、相册/拍照、生物识别、推送和 haptic feedback。

### 需求 5：Android 体验必须遵循 Android / Material 习惯

**用户故事：** 作为 Android 用户，我希望应用在导航、反馈、权限和通知上符合 Android 习惯，而不是强行套 iOS 的壳。

#### 验收标准

1. WHEN 用户在 Android 端浏览主流程 THEN System SHALL 优先使用 Top App Bar、Bottom Navigation、Bottom Sheet、系统返回栈等模式。
2. WHEN 用户进行操作 THEN System SHALL 提供符合 Android 习惯的 ripple、elevation、状态栏适配、权限申请和错误反馈。
3. WHEN 需要系统能力 THEN System SHALL 支持 Android 文件管理、分享 Intent、通知渠道、后台任务和权限申请流程。

### 需求 6：会话、文件、Git、终端、日志、进程等能力必须在移动端完整可用

**用户故事：** 作为用户，我希望在移动端真正完成工作，而不是只能看消息、点几个按钮。

#### 验收标准

1. WHEN 用户进入会话页 THEN System SHALL 支持完整消息查看、回复、失败重试、能力门控、实时同步和断线恢复。
2. WHEN 用户进入文件、Git、终端、日志、进程相关页面 THEN System SHALL 提供与 PC 端同级别的业务能力，只允许交互路径不同，不允许能力缺席。
3. WHEN 某项操作风险较高 THEN System SHALL 通过确认、分步交互或平台合适的呈现方式控制风险，但不能直接把功能删掉。

### 需求 7：所有受保护数据与实时能力必须统一鉴权

**用户故事：** 作为系统管理员，我希望移动端和 PC / H5 端一样遵守认证边界，不出现移动端漏鉴权这种低级事故。

#### 验收标准

1. WHEN 用户未登录或令牌无效 THEN System SHALL 拦截工作区、会话、文件、Git、终端、进程、日志、通知等全部受保护请求。
2. WHEN 建立实时连接、后台恢复连接或推送订阅 THEN System SHALL 在握手和续订阶段校验令牌，失败则停止同步。
3. WHEN 用户退出登录或令牌被撤销 THEN System SHALL 清理本地受保护缓存、停止后台订阅并关闭实时通道。

### 需求 8：通知与系统能力必须通过平台适配层统一接入

**用户故事：** 作为用户，我希望移动端不只是“能看页面”，还要能像正常移动应用一样处理通知、分享、文件和设备能力。

#### 验收标准

1. WHEN 业务事件触发通知 THEN System SHALL 通过平台适配层完成推送、应用内收件箱、已读状态和深链跳转。
2. WHEN 用户执行分享、导入文件、拍照、调用生物识别、触发触感反馈等动作 THEN System SHALL 通过统一适配接口完成，不让页面直接绑定平台实现。
3. WHEN 平台权限被拒绝或系统能力不可用 THEN System SHALL 返回统一错误语义，并允许页面给出恢复引导。

### 需求 9：大屏、折叠屏和平板必须做自适应布局，不允许只放大手机 UI

**用户故事：** 作为平板或折叠屏用户，我希望界面能利用额外空间，而不是只把手机布局放大到更丑。

#### 验收标准

1. WHEN 应用运行在平板或折叠屏设备 THEN System SHALL 根据宽度和姿态切换到更适合的大屏布局，而不是简单放大手机单栏页面。
2. WHEN 页面具备天然主次分区 THEN System SHALL 支持列表-详情、主内容-辅助面板等自适应结构。
3. WHEN 设备姿态变化或窗口尺寸变化 THEN System SHALL 保持导航、输入和内容状态连续，不丢上下文。

### 需求 10：依赖前置 Spec，但不重复定义核心协议

**用户故事：** 作为维护者，我希望 spec009 明确复用前置 Spec 的协议与模型，避免文档和实现分叉。

#### 验收标准

1. WHEN 文档描述会话能力 THEN System SHALL 引用 `spec003` 的消息运行时与能力门控，不重复定义消息协议主字段。
2. WHEN 文档描述文件、Git、终端、进程等能力 THEN System SHALL 分别依赖 `spec004`、`spec005`、`spec006`、`spec007`、`spec008` 的既有协议和页面能力边界。
3. WHEN 移动端需要新增内容 THEN System SHALL 只新增移动端专属的交互、设备能力、推送、适配层契约，不重写公共业务协议。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 用户打开移动端首页或工作区 THEN System SHALL 在弱网下尽快呈现可交互骨架，并在合理时间内完成首屏数据渲染。
2. WHEN 用户进入会话、终端、日志、文件编辑等重内容页面 THEN System SHALL 保持滚动、输入和切页流畅，不出现明显卡死。

### 非功能需求 2：可靠性

1. WHEN 网络在 Wi-Fi、蜂窝、后台恢复之间切换 THEN System SHALL 自动恢复实时连接、通知同步和页面状态。
2. WHEN 推送、后台任务或系统能力暂时失败 THEN System SHALL 有可追踪的降级路径，而不是直接丢事件。

### 非功能需求 3：可维护性

1. WHEN 未来 PC 端新增业务能力 THEN System SHALL 允许先扩 `core`，再分别补 iOS / Android UI，而不是复制一套移动端业务实现。
2. WHEN 线上问题排查 THEN System SHALL 能按 `workspaceId/sessionId/processId` 关联页面状态、通知、适配层调用和 Host 事件。

### 非功能需求 4：平台一致性

1. WHEN 用户在同一账号下切换 PC、iOS、Android THEN System SHALL 保持业务状态一致，但允许 UI 呈现方式不同。
2. WHEN 设计或实现引入平台差异 THEN System SHALL 只把差异限制在 `platform adapter` 或 `platform ui`，不污染 `core`。

## 成功定义

- 用户能在移动端完成与 PC 端同级别的核心业务流程，而不是被“轻操作”边界卡住。
- iOS 看起来像 iOS，Android 看起来像 Android，不再是同一张网页换皮。
- `core / platform adapter / platform ui` 三层边界清楚，后续加能力不会越改越乱。
- 登录态、实时连接、推送订阅、后台恢复的安全边界与 PC 端保持一致。
