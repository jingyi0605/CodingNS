# 任务清单 - spec001.6-客户端与服务端统一更新机制（人话版）

状态：DONE

## 2026-04-15 进展补记

- 已启动 `spec001.6`
- 已确认这次只做“客户端与服务端统一更新机制”，不把它写成泛化发布平台
- 已确认桌面端、Android、服务端必须拆成三条链路，不再强行共用一套实现
- 已确认 Android 端采用 `APK` 直装，不走 Google Play In-App Updates
- 已确认服务端全局 npm 包升级必须接入 `TaskManager`，不能在请求主链路里直接跑
- 已补服务端全局 npm 升级的细化设计，明确需要新增安装接口、任务状态接口和真正的 `external_process` 执行器
- 已把服务端更新检查改成受管包列表模型，前端不再展示裸命令
- 已接入 `POST /api/client/service-update/install` 和 `GET /api/client/service-update/tasks/:taskId`
- 已用真实 `npm install -g <package>@<tag>` 执行全局升级，并把“需要重启 Host”状态带回前端
- 已把设置页更新卡片收缩成极简结构，只保留版本、状态和必要按钮
- 已把桌面端启动自动检查接进全局启动链路，并补了独立测试
- 已补 Android 安装器返回后的取消/未完成推断，以及坏 APK 清理
- 已补统一更新说明、Android 异常说明和验收记录

## 这份文档是干什么的

这份任务清单只回答下面这些问题：

- 客户端更新先做哪条链路
- Android `APK` 直装到底补哪些环节
- 服务端全局 npm 升级怎么接进后台任务
- 发布流水线需要补哪些产物
- 每一步做完以后怎么判断不是在自欺欺人

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并已回写
- `CANCELLED`：取消并写明原因

规则：

- 只有 `状态：DONE` 的任务才能勾成 `[x]`
- 每做完一个任务，都要立刻回写这份文档
- `BLOCKED` 和 `CANCELLED` 必须写清楚卡在哪

---

## 阶段 0：先把边界定死

- [x] 0.1 建立 `spec001.6` 文档骨架
  - 状态：DONE
  - 这一步到底做什么：创建 `README.md`、`requirements.md`、`design.md`、`tasks.md`，把范围、平台边界和第一版不做的事情写清楚。
  - 做完以后能看到什么结果：仓库里出现完整的 `spec001.6` 目录，后续实现不再靠聊天记录临时记忆。
  - 依赖什么：无
  - 主要改哪些文件：
    - `specs/spec001.6-客户端与服务端统一更新机制/*`
  - 这一步先不做什么：不直接改代码实现。
  - 怎么验证：
    - 文档走查
  - 回写时间：2026-04-15

- [x] 0.2 更新总览和父 Spec 入口
  - 状态：DONE
  - 这一步到底做什么：把 `specs/README.md` 和 `spec001` 主文档挂上 `spec001.6`，避免它变成游离目录。
  - 做完以后能看到什么结果：新 Spec 在总览和父 Spec 里都能找到。
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/design.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
  - 这一步先不做什么：不修改父 Spec 的主体需求。
  - 怎么验证：
    - 文档走查
  - 回写时间：2026-04-15

---

## 阶段 1：先把现状和发布模型收口

- [x] 1.1 盘点现有桌面端、Android、服务端更新实现和缺口
  - 状态：DONE
  - 这一步到底做什么：把当前已有 UI、Rust 逻辑、Host 接口、CI 产物、Android 壳能力逐项盘清楚。
  - 做完以后能看到什么结果：知道哪些能复用，哪些必须砍掉重接。
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `design.md`
    - `docs/20260415-更新机制现状盘点.md`
  - 这一步先不做什么：不急着写新实现。
  - 怎么验证：
    - 评审时能明确说出三条链路各自的现状和缺口
  - 验证结果：
    - 已确认桌面端当前是“前端面板 + Rust 私有下载器”，不是正式 updater
    - 已确认 Android 端当前只有壳、打包脚本和 `FileProvider`，没有任何在线更新实现
    - 已确认服务端当前只有单包版本检查，没有安装接口、后台任务和重启状态
    - 已新增盘点文档：`docs/20260415-更新机制现状盘点.md`
  - 回写时间：2026-04-15

- [x] 1.2 定义统一的客户端发布清单和服务端受管包模型
  - 状态：DONE
  - 这一步到底做什么：把桌面端 manifest、Android APK manifest、服务端受管包状态和后台任务状态定成正式结构。
  - 做完以后能看到什么结果：前后端不再各拼各的字段。
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `design.md`
    - 相关类型定义
  - 这一步先不做什么：不直接上下载逻辑。
  - 怎么验证：
    - 类型和文档对齐走查
  - 验证结果：
    - `design.md` 已补齐 `DesktopReleaseManifest`、`AndroidApkManifest`、`ManagedServicePackage`、`ServiceUpdateJobState`
    - 已补“检查失败不能伪装成没有更新”的状态约束
    - 已明确桌面端、Android、服务端三条链路各自的状态流转
  - 回写时间：2026-04-15

---

## 阶段 2：桌面端更新链路改成正式方案

- [x] 2.1 把桌面端 Rust 更新逻辑切到正式 updater
  - 状态：DONE
  - 这一步到底做什么：替换当前手搓下载器，改成桌面壳官方更新入口。
  - 做完以后能看到什么结果：`安装更新` 不再只是下载并打开文件。
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/desktop/src-tauri/*`
    - `apps/user-app/src/platform/desktop/*`
  - 这一步先不做什么：不顺手改 Android。
  - 怎么验证：
    - 桌面端手工升级链路验证
  - 验证结果：
    - 桌面端 Rust 侧已切到 `tauri-plugin-updater`
    - 前端安装动作已改成“只传通道，不再自己拼安装包 URL”
    - 本地编译通过：`cargo check`（`apps/desktop/src-tauri`）
  - 回写时间：2026-04-15

- [x] 2.2 补齐桌面发布流水线所需的更新产物和签名文件
  - 状态：DONE
  - 这一步到底做什么：让 CI 在发布时把安装包、manifest、签名和校验文件一起产出来。
  - 做完以后能看到什么结果：客户端不会再拿到半套发布数据。
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `.github/workflows/desktop-release.yml`
    - 桌面发布脚本和说明文档
  - 这一步先不做什么：不补 Windows 商业代码签名全套细节。
  - 怎么验证：
    - Release 产物检查
    - CI 预演
  - 验证结果：
    - 工作流已上传 macOS `.app.tar.gz + .sig`、Windows `NSIS .exe + .sig`
    - 发布阶段已新增 `latest.json` 生成和上传逻辑
    - 发布说明已补 `TAURI_SIGNING_PUBLIC_KEY` 的要求
  - 回写时间：2026-04-15

- [x] 2.3 接入桌面端自动检查策略和设置页状态展示
  - 状态：DONE
  - 这一步到底做什么：把自动检查开关、手动检查、安装状态和失败提示接进设置页。
  - 做完以后能看到什么结果：桌面端设置页上的更新区真正可用。
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/user-app/src/settings/*`
    - 客户端配置与状态管理
  - 这一步先不做什么：不扩展 Web 端无意义按钮。
  - 怎么验证：
    - 前端测试
    - 桌面端手工验证
  - 验证结果：
    - 设置页已接到官方 updater 的手动检查和安装状态
    - 应用启动后已在桌面端全局链路自动检查一次更新，有新版本时会发系统通知
    - 定向测试通过：`src/app/DesktopAutoUpdateEffect.test.tsx`
    - 定向测试通过：`src/features/settings/pages/SettingsPage.test.tsx`
    - 定向测试通过：`src/settings/ReleasePanel.test.tsx`
  - 回写时间：2026-04-15

---

## 阶段 3：Android APK 直装链路落地

- [x] 3.1 建立 Android APK 发布清单和下载入口
  - 状态：DONE
  - 这一步到底做什么：定义 Android 清单格式、发布地址和前端读取方式。
  - 做完以后能看到什么结果：Android 客户端能知道自己该下哪个 APK。
  - 依赖什么：1.2
  - 主要改哪些文件：
    - Android 发布脚本
    - 相关说明文档
    - 移动端更新读取逻辑
  - 这一步先不做什么：不做系统安装器唤起。
  - 怎么验证：
    - 清单读取和版本比较验证
  - 验证结果：
    - Host `release-manifest` 已支持 `android-apk.json`
    - 前端已新增 Android 更新管理器和极简更新面板
    - 定向测试通过：`apps/host/tests/integration/client-routes.test.ts`
  - 回写时间：2026-04-15

- [x] 3.2 实现 Android 下载、校验和系统安装器唤起
  - 状态：DONE
  - 这一步到底做什么：把 APK 下载到本地、计算 `sha256`、校验通过后交给系统安装器。
  - 做完以后能看到什么结果：Android 更新不再停留在“知道有新版本”。
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/user-app/src-tauri/*`
    - `apps/user-app/src/platform/*`
    - 更新 UI
  - 这一步先不做什么：不做静默安装。
  - 怎么验证：
    - Android 真机手工验证
  - 验证结果：
    - Android Rust 命令已支持下载 APK、`sha256` 校验、包名/versionCode 校验和系统安装器唤起
    - `AndroidManifest.xml` 已补 `REQUEST_INSTALL_PACKAGES`
    - `file_paths.xml` 已收紧成安装所需路径
    - 本地编译通过：`cargo check`（`apps/user-app/src-tauri`）
  - 回写时间：2026-04-15

- [x] 3.3 补齐 Android 权限提示、取消安装和失败恢复
  - 状态：DONE
  - 这一步到底做什么：处理未知来源安装授权、用户取消安装、下载失败和校验失败状态。
  - 做完以后能看到什么结果：Android 更新链路不会一出错就黑箱。
  - 依赖什么：3.2
  - 主要改哪些文件：
    - Android 平台适配层
    - 更新状态 UI
  - 这一步先不做什么：不扩展 iOS。
  - 怎么验证：
    - Android 异常路径验证
  - 验证结果：
    - 已处理未知来源授权引导、下载失败、校验失败和可重试状态
    - 应用从系统安装器回到前台后，会按当前 `versionCode` 结果推断“已安装”还是“已取消/未完成”
    - `sha256` 或包信息校验失败时，坏 APK 会从缓存目录清理
    - 定向测试通过：`apps/user-app/src/settings/AndroidReleasePanel.test.tsx`
    - 本地编译通过：`cargo check`（`apps/user-app/src-tauri`）
  - 回写时间：2026-04-15

---

## 阶段 4：服务端全局 npm 包升级闭环

- [x] 4.1 把服务端更新检查从单个展示改成受管包列表
  - 状态：DONE
  - 这一步到底做什么：把当前“只有一个版本号和一条命令”的接口，改成受管包列表、通道和状态模型。
  - 做完以后能看到什么结果：服务端更新信息不再是半成品。
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/host/src/modules/client/*`
    - `apps/user-app/src/settings/*`
  - 这一步先不做什么：不直接跑升级。
  - 怎么验证：
    - 接口和前端状态验证
  - 验证结果：
    - `GET /api/client/service-update` 已返回 `packages[]`、检查状态、安装任务状态
    - 前端服务端更新面板已移除命令展示块，只保留版本、状态和动作
    - 定向测试通过：`apps/host/tests/integration/client-routes.test.ts`
  - 回写时间：2026-04-15

- [x] 4.2 接入 `TaskManager` 执行全局 npm 升级
  - 状态：DONE
  - 这一步到底做什么：新增后台任务类型、执行器和安装接口，把全局 npm 升级从点击按钮变成正式后台任务。
  - 做完以后能看到什么结果：用户点击后真的会跑更新，而且状态可追踪。
  - 依赖什么：4.1
  - 主要改哪些文件：
    - `apps/host/src/modules/tasks/*`
    - `apps/host/src/modules/client/*`
    - 相关测试
  - 这一步先不做什么：不做自动回滚。
  - 怎么验证：
    - Host 构建
    - 定向测试
  - 验证结果：
    - 已新增 `service.npm_global_update_install` 任务类型和 `external_process` 执行器
    - 已新增安装接口和任务状态接口，点击后会真实执行 `npm install -g`
    - 定向测试通过：`apps/host/tests/integration/client-routes.test.ts`
  - 回写时间：2026-04-15

- [x] 4.3 补齐“升级成功但需要重启”的状态提示
  - 状态：DONE
  - 这一步到底做什么：让系统能明确告诉用户“包升级了，但当前进程还没切过去”。
  - 做完以后能看到什么结果：服务端更新不再自欺欺人。
  - 依赖什么：4.2
  - 主要改哪些文件：
    - Host 更新状态模型
    - 设置页文案与提示
    - 相关文档
  - 这一步先不做什么：不做 supervisor 自动控制。
  - 怎么验证：
    - 手工升级链路验证
  - 验证结果：
    - 安装任务成功后，接口和前端都会返回 `restartRequired=true`
    - 设置页服务端更新卡片会明确显示“新版本已安装，重启 Host 后生效”
    - 定向测试通过：
      - `apps/host/tests/integration/client-routes.test.ts`
      - `apps/user-app/src/settings/ServiceUpdatePanel.test.tsx`
  - 回写时间：2026-04-15

---

## 阶段 5：统一交付和验收

- [x] 5.1 整理软件更新设置页的三端显示逻辑
  - 状态：DONE
  - 这一步到底做什么：统一桌面端、Android、Web 三种运行平台在设置页里的展示和按钮行为。
  - 做完以后能看到什么结果：一个页面里能看明白当前平台到底支持什么。
  - 依赖什么：2.3、3.3、4.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/settings/*`
    - `apps/user-app/src/shared/i18n/*`
  - 这一步先不做什么：不做额外页面。
  - 怎么验证：
    - 前端测试
    - 手工走查
  - 验证结果：
    - Web/H5 只显示服务端更新，不显示客户端安装动作
    - 桌面端显示桌面客户端更新，Android 显示 APK 更新，iOS 明确显示“不支持安装更新”
    - 定向测试通过：`apps/user-app/src/features/settings/pages/SettingsPage.test.tsx`
  - 回写时间：2026-04-15

- [x] 5.2 补齐发布说明、升级说明和验收记录
  - 状态：DONE
  - 这一步到底做什么：把桌面端、Android、服务端三条链路的发布和升级说明写成人话。
  - 做完以后能看到什么结果：后续发布和回归不需要再靠口口相传。
  - 依赖什么：5.1
  - 主要改哪些文件：
    - `docs/使用说明/*`
    - `specs/spec001.6-客户端与服务端统一更新机制/docs/*`
  - 这一步先不做什么：不额外扩写 marketing 文案。
  - 怎么验证：
    - 按文档走查一次
  - 验证结果：
    - 已新增统一说明文档：`docs/使用说明/20260415-软件更新与升级说明.md`
    - 已新增 Android 异常说明：`specs/spec001.6-客户端与服务端统一更新机制/docs/20260415-Android-APK直装权限与失败场景说明.md`
    - 已新增验收记录：`specs/spec001.6-客户端与服务端统一更新机制/docs/20260415-统一更新机制验收记录.md`
    - `spec001.6/docs/README.md` 已补目录索引
  - 回写时间：2026-04-15
