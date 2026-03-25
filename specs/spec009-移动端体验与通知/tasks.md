# 任务清单 - spec009-移动端体验与通知（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单不是拿来喊口号的，是拿来防止移动端继续跑偏的。

新的方向已经很清楚：

- 不是“轻操作版移动端”
- 是“业务能力与 PC 对齐”
- 但 UI 必须按 iOS / Android 分平台实现

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：已完成并验证通过
- `CANCELLED`：取消并写明原因

规则：

- 只有 `状态：DONE` 才能勾选 `[x]`
- 每完成一个任务，必须立刻回写状态和验证结果
- `BLOCKED` 与 `CANCELLED` 必须写清楚为什么，以及后面怎么处理

---

## 阶段 0：把方向和壳层先掰正

- [x] 0.1 把 spec009 从“轻操作移动端”改成“PC 功能对齐 + 平台皮肤层”
  - 状态：DONE
  - 这一步到底做什么：重写 `spec009` 的定位、需求、设计、任务，让文档不再误导后续实现。
  - 做完你能看到什么：文档明确要求“统一业务内核 + 平台适配层 + 平台 UI”，不再接受缩水版移动端。
  - 主要改哪些文件：
    - `specs/spec009-移动端体验与通知/README.md`
    - `specs/spec009-移动端体验与通知/requirements.md`
    - `specs/spec009-移动端体验与通知/design.md`
    - `specs/spec009-移动端体验与通知/tasks.md`
    - `specs/spec009-移动端体验与通知/docs/README.md`
  - 这一步先不做什么：不直接改业务代码。
  - 怎么算完成：
    1. 文档不再出现“只做轻操作”的旧定位
    2. 文档明确写出 iOS / Android 分平台 UI 和三层结构
  - 怎么验证：
    - 文档评审
    - 与当前 `user-app` 代码结构对照检查

- [x] 0.2 切回 `Tauri Mobile` 并打通 Android 首编
  - 状态：DONE
  - 这一步到底做什么：撤掉错误的 Capacitor 路线，初始化 `Tauri Mobile` 壳，并完成 Android 首次构建。
  - 做完你能看到什么：仓库已经有可用的 `src-tauri` 壳层，Android 能产出 APK。
  - 主要改哪些文件：
    - `apps/user-app/src-tauri/*`
    - `apps/user-app/package.json`
    - `.gitignore`
  - 验证结果：
    1. 已执行 `pnpm tauri:android:init --ci --skip-targets-install`
    2. 已执行 `pnpm exec tauri android build --debug --apk --target aarch64 --ci`
    3. 已产出 `apps/user-app/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
  - 这一步先不做什么：不代表移动端已经可用。

- [ ] 0.3 初始化 iOS 壳并完成首编验证
  - 状态：TODO
  - 这一步到底做什么：在现有 `Tauri Mobile` 壳基础上补 iOS 工程生成与编译链路。
  - 做完你能看到什么：iOS 端至少能生成工程、能编、能安装到模拟器或真机。
  - 先依赖什么：0.2
  - 主要改哪些文件：
    - `apps/user-app/src-tauri/*`
    - `apps/user-app/package.json`
    - iOS 生成目录与相关忽略规则
  - 这一步先不做什么：不在这一阶段解决所有 iOS UI 问题。
  - 怎么算完成：
    1. iOS 工程生成成功
    2. iOS Debug 包可编译
  - 怎么验证：
    - iOS 模拟器或真机构建日志
    - Tauri Mobile iOS 命令链路验证

---

## 阶段 1：先把三层结构搭起来

- [ ] 1.1 梳理 `user-app` 的共享业务内核，明确哪些逻辑归 `core`
  - 状态：TODO
  - 这一步到底做什么：把当前 `apps/user-app/src/features/*`、`src/network/*`、`src/auth/*` 里与平台无关的逻辑收拢成共享业务内核。
  - 做完你能看到什么：业务流程不再依赖桌面布局和桌面壳判断。
  - 先依赖什么：0.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/*`
    - `apps/user-app/src/features/workbench/*`
    - `apps/user-app/src/features/terminal/*`
    - `apps/user-app/src/network/*`
    - `apps/user-app/src/auth/*`
  - 这一步先不做什么：不做平台样式。
  - 怎么算完成：
    1. 业务流程和平台皮肤可以分开装配
    2. 页面不再直接依赖桌面专属布局假设
  - 怎么验证：
    - 模块依赖检查
    - 关键状态流走查

- [ ] 1.2 扩展运行时平台类型与 `platform adapter`
  - 状态：TODO
  - 这一步到底做什么：把当前只有 `desktop / web` 的平台识别扩成 `desktop / web / ios / android`，同时建立移动端适配层入口。
  - 做完你能看到什么：系统能识别 iOS / Android，页面能拿到平台 UI 上下文和系统能力。
  - 先依赖什么：1.1
  - 主要改哪些文件：
    - `apps/user-app/src/config/client-config-types.ts`
    - `apps/user-app/src/platform/platform-adapter.ts`
    - `apps/user-app/src/platform/platform-provider.tsx`
    - `apps/user-app/src/platform/mobile/*`（预期新增）
  - 这一步先不做什么：不在这里塞业务逻辑。
  - 怎么算完成：
    1. 平台运行时识别正确
    2. 适配层能对外暴露通知、权限、分享、文件导入、safe area、生命周期等接口
  - 怎么验证：
    - 单元测试
    - Android / iOS 运行时日志校验

- [ ] 1.3 建立移动端应用壳和平台导航容器
  - 状态：TODO
  - 这一步到底做什么：在现有 `appRouter` 基础上引入移动端壳，不再把桌面 `WorkbenchLayout` 直接塞给手机。
  - 做完你能看到什么：iOS / Android 有独立的页面骨架、导航容器和根路由。
  - 先依赖什么：1.2
  - 主要改哪些文件：
    - `apps/user-app/src/app/App.tsx`
    - `apps/user-app/src/app/router.tsx`
    - `apps/user-app/src/features/mobile-shell/*`（预期新增）
    - `apps/user-app/src/shared/theme/*`
  - 这一步先不做什么：不在这里补齐所有业务页面细节。
  - 怎么算完成：
    1. 移动端有独立根容器
    2. iOS / Android 可切到各自导航壳
  - 怎么验证：
    - 路由集成测试
    - 模拟器人工走查

---

## 阶段 2：把 iOS / Android 的 UI 地基搭好

- [ ] 2.1 实现 iOS 导航与容器骨架
  - 状态：TODO
  - 这一步到底做什么：实现 Bottom Tab Bar、Navigation Bar、push、sheet、safe area、键盘联动等 iOS 基础交互。
  - 做完你能看到什么：iPhone 上的主流程不再像网页，而像正常 iOS 应用。
  - 先依赖什么：1.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-shell/ios/*`（预期新增）
    - `apps/user-app/src/shared/theme/*`
    - `apps/user-app/src/app/styles.css`
  - 这一步先不做什么：不复制 Android 组件风格。
  - 怎么算完成：
    1. iOS 主流程能用 push / sheet 正常流转
    2. safe area 和返回手势正确
  - 怎么验证：
    - iPhone 模拟器走查
    - 页面切换与键盘联动验证

- [ ] 2.2 实现 Android 导航与容器骨架
  - 状态：TODO
  - 这一步到底做什么：实现 Top App Bar、Bottom Navigation、Bottom Sheet、系统返回、ripple、状态栏适配等 Android 基础交互。
  - 做完你能看到什么：Android 上不再是硬套 iOS 的壳。
  - 先依赖什么：1.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-shell/android/*`（预期新增）
    - `apps/user-app/src/shared/theme/*`
    - `apps/user-app/src/app/styles.css`
  - 这一步先不做什么：不做大屏特化布局。
  - 怎么算完成：
    1. Android 主流程符合系统返回栈
    2. 视觉反馈符合 Material 习惯
  - 怎么验证：
    - Android 模拟器走查
    - 系统返回和 Bottom Navigation 验证

- [ ] 2.3 完成大屏 / 折叠屏布局适配
  - 状态：TODO
  - 这一步到底做什么：为平板、折叠屏和宽屏手机增加列表-详情或双区域布局，而不是简单放大单栏。
  - 做完你能看到什么：大屏能利用额外空间，不再浪费。
  - 先依赖什么：2.1、2.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-shell/layouts/*`（预期新增）
    - `apps/user-app/src/app/styles.css`
    - 各主页面容器文件
  - 这一步先不做什么：不做桌面式多窗口。
  - 怎么算完成：
    1. 平板 / 折叠屏能切换到大屏布局
    2. 旋转和折叠状态变化不丢上下文
  - 怎么验证：
    - 宽屏模拟器测试
    - 姿态变化回归测试

---

## 阶段 3：把业务能力补到和 PC 一样

- [ ] 3.1 接入移动端会话完整能力
  - 状态：TODO
  - 这一步到底做什么：复用 `spec003` 运行时，实现完整会话查看、回复、失败重试、能力门控、断线恢复。
  - 做完你能看到什么：移动端会话不再只是“看一眼和回一句”的缩水版。
  - 先依赖什么：2.1、2.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/*`
    - `apps/user-app/src/features/mobile-conversation/*`（预期新增）
    - `apps/user-app/src/network/realtime-client.ts`
  - 这一步先不做什么：不重新定义消息协议。
  - 怎么算完成：
    1. 会话核心流程与 PC 端一致
    2. 弱网与后台恢复后状态连续
  - 怎么验证：
    - 会话 E2E
    - 断线恢复测试

- [ ] 3.2 接入移动端文件能力
  - 状态：TODO
  - 这一步到底做什么：把 PC 端已有文件浏览、读取、编辑、保存、导入导出能力完整带到移动端。
  - 做完你能看到什么：移动端文件能力不再被“轻操作”限制死。
  - 先依赖什么：1.1、1.2、2.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/file/*`（预期新增或扩展）
    - `apps/user-app/src/platform/mobile/file-*`（预期新增）
  - 这一步先不做什么：不做超出当前 PC 端范围的新编辑协议。
  - 怎么算完成：
    1. 文件浏览、打开、编辑、保存、导入导出可用
    2. 文件权限和系统导入由适配层处理
  - 怎么验证：
    - 文件操作回归测试
    - 导入导出真机测试

- [ ] 3.3 接入移动端 Git 完整能力
  - 状态：TODO
  - 这一步到底做什么：把状态、diff、暂存、提交、同步等 PC 端 Git 能力带到移动端。
  - 做完你能看到什么：Git 页面不再只是状态查看卡片。
  - 先依赖什么：3.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/git/*`（预期新增或扩展）
    - `apps/user-app/src/features/mobile-git/*`（预期新增）
  - 这一步先不做什么：不额外发明移动端专属 Git 协议。
  - 怎么算完成：
    1. Git 主流程与 PC 对齐
    2. 高风险操作通过平台合适方式确认
  - 怎么验证：
    - Git 回归测试
    - 提交 / 同步测试

- [ ] 3.4 接入移动端终端与日志完整能力
  - 状态：TODO
  - 这一步到底做什么：把终端、日志、搜索、滚动、复制、输入保护等能力补齐。
  - 做完你能看到什么：终端和日志不是“只能看几行”的样板页。
  - 先依赖什么：3.1、3.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/terminal/*`
    - `apps/user-app/src/features/mobile-terminal/*`（预期新增）
    - `apps/user-app/src/features/mobile-log/*`（预期新增）
  - 这一步先不做什么：不做桌面式多终端平铺布局。
  - 怎么算完成：
    1. 终端与日志完整主流程可用
    2. 输入保护和滚动性能达标
  - 怎么验证：
    - 终端 / 日志回归测试
    - 真机滚动与输入验证

- [ ] 3.5 接入移动端进程与启动器能力
  - 状态：TODO
  - 这一步到底做什么：补齐进程查看、启停、重启、状态反馈、日志联动和启动器配置入口。
  - 做完你能看到什么：移动端可以和 PC 端一样处理项目运行态。
  - 先依赖什么：3.4
  - 主要改哪些文件：
    - `apps/user-app/src/features/process/*`（预期新增或扩展）
    - `apps/user-app/src/features/mobile-process/*`（预期新增）
  - 这一步先不做什么：不在移动端另造一套进程模型。
  - 怎么算完成：
    1. 进程主流程与 PC 对齐
    2. 与终端、日志、通知联动
  - 怎么验证：
    - 进程操作回归测试
    - 异常恢复测试

- [ ] 3.6 接入移动端设置与运行时配置能力
  - 状态：TODO
  - 这一步到底做什么：补齐运行时设置、Host 连接配置、更新策略、通知权限入口等配置页面。
  - 做完你能看到什么：移动端不是一套半残的壳，设置入口也完整。
  - 先依赖什么：1.2、2.1、2.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/settings/*`
    - `apps/user-app/src/config/*`
  - 这一步先不做什么：不新增和 PC 端无关的设置体系。
  - 怎么算完成：
    1. 配置项与 PC 对齐
    2. 平台相关设置通过适配层提供
  - 怎么验证：
    - 设置回归测试
    - 配置持久化测试

---

## 阶段 4：把系统能力和通知接上

- [ ] 4.1 建立通知中心、推送订阅与已读同步
  - 状态：TODO
  - 这一步到底做什么：补齐设备注册、通知收件箱、系统通知、已读状态、深链跳转。
  - 做完你能看到什么：移动端通知是完整能力，不是桌面 `showNotification` 的简化副本。
  - 先依赖什么：1.2、3.1、3.5
  - 主要改哪些文件：
    - `apps/user-app/src/platform/mobile/notification-*`（预期新增）
    - `apps/user-app/src/features/notifications/*`（预期新增或扩展）
    - `apps/user-app/src/platform/platform-adapter.ts`
  - 这一步先不做什么：不做企业 IM 联动。
  - 怎么算完成：
    1. 通知订阅和收件箱可用
    2. 点击通知可精准跳转
  - 怎么验证：
    - 推送 / 收件箱集成测试
    - 深链测试

- [ ] 4.2 接入分享、文件导入、相册/拍照、生物识别、触感反馈
  - 状态：TODO
  - 这一步到底做什么：补齐 iOS / Android 作为正常移动应用应具备的系统入口。
  - 做完你能看到什么：移动端不再只是“浏览器套壳”。
  - 先依赖什么：1.2、2.1、2.2
  - 主要改哪些文件：
    - `apps/user-app/src/platform/mobile/share-*`（预期新增）
    - `apps/user-app/src/platform/mobile/file-*`（预期新增）
    - `apps/user-app/src/platform/mobile/biometric-*`（预期新增）
    - `apps/user-app/src/platform/mobile/haptic-*`（预期新增）
  - 这一步先不做什么：不引入与当前业务无关的花哨原生功能。
  - 怎么算完成：
    1. 系统能力通过统一适配接口调用
    2. 权限被拒绝时错误语义一致
  - 怎么验证：
    - 真机权限测试
    - 适配层单元测试

- [ ] 4.3 Android 通知渠道、后台任务与权限流程补齐
  - 状态：TODO
  - 这一步到底做什么：把 Android 特有的通知渠道、后台恢复、权限流程单独做完整。
  - 做完你能看到什么：Android 端不是 iOS 逻辑换个主题色。
  - 先依赖什么：4.1、4.2
  - 主要改哪些文件：
    - `apps/user-app/src/platform/mobile/android/*`（预期新增）
    - `apps/user-app/src-tauri/*`
  - 这一步先不做什么：不把 Android 逻辑塞回共享页面。
  - 怎么算完成：
    1. 通知渠道与后台任务可用
    2. 权限流程符合 Android 习惯
  - 怎么验证：
    - Android 真机测试
    - 后台恢复测试

- [ ] 4.4 iOS 分享面板、safe area、haptic、生物识别与系统推送补齐
  - 状态：TODO
  - 这一步到底做什么：把 iOS 特有的系统交互和设备能力接完整。
  - 做完你能看到什么：iPhone 上的体验像 iOS，而不是 Android 页面的复制品。
  - 先依赖什么：4.1、4.2
  - 主要改哪些文件：
    - `apps/user-app/src/platform/mobile/ios/*`（预期新增）
    - `apps/user-app/src-tauri/*`
  - 这一步先不做什么：不复用 Android 的交互模型。
  - 怎么算完成：
    1. 分享、haptic、生物识别、推送、safe area 处理完整
    2. iOS 系统交互连贯
  - 怎么验证：
    - iPhone 真机测试
    - 推送与权限测试

---

## 阶段 5：收口验证与交付

- [ ] 5.1 Android 端到端回归
  - 状态：TODO
  - 这一步到底做什么：在 Android 真机或模拟器跑完整主链路。
  - 做完你能看到什么：Android 不只是“能编”，而是真能用。
  - 先依赖什么：3.x、4.x
  - 怎么算完成：
    1. 登录 -> 首页 -> 工作区 -> 会话 -> 文件/Git/终端/进程 -> 返回 全链路通过
    2. 通知、后台恢复、权限流程通过
  - 怎么验证：
    - Android E2E
    - 真机回归清单

- [ ] 5.2 iOS 端到端回归
  - 状态：TODO
  - 这一步到底做什么：在 iOS 模拟器或真机跑完整主链路。
  - 做完你能看到什么：iOS 端不是只停留在壳层和文档。
  - 先依赖什么：0.3、3.x、4.x
  - 怎么算完成：
    1. 登录 -> 首页 -> 工作区 -> 会话 -> 文件/Git/终端/进程 -> 返回 全链路通过
    2. push / sheet / safe area / 生物识别 / 分享 等平台能力通过
  - 怎么验证：
    - iOS E2E
    - 真机回归清单

- [ ] 5.3 最终检查：移动端与 PC 能力矩阵逐项对齐
  - 状态：TODO
  - 这一步到底做什么：逐项核对移动端和 PC 端现有功能，确认没有被偷偷阉割。
  - 做完你能看到什么：spec009 的目标真正闭合，不再是壳层工程冒充产品完成。
  - 先依赖什么：5.1、5.2
  - 主要改哪些文件：
    - `specs/spec009-移动端体验与通知/docs/acceptance-checklist.md`（预期新增）
    - `specs/spec009-移动端体验与通知/docs/acceptance-result.md`（预期新增）
  - 怎么算完成：
    1. PC 能力矩阵全部有对应移动端入口
    2. 平台 UI 差异只存在于 `platform adapter / platform ui`
    3. Android / iOS 都完成构建与回归
  - 怎么验证：
    - 验收清单逐项核对
    - 评审记录
