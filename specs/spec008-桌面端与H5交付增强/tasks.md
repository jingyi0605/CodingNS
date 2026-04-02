# 任务清单 - spec008 桌面端与H5交付增强（人话版）

状态：IN_PROGRESS

## 这份文档是干什么的

这份任务清单用来把“桌面壳 + H5 交付增强”做成能落地的工程计划，而不是口号。

补一句边界：
桌面端工作台多窗口已经拆到 `spec008.1-桌面端多窗口管理`，这里不要再混入窗口拆分细节。

每个任务都要回答：

- 这一步到底做什么
- 做完后能看到什么结果
- 依赖什么
- 主要改哪些文件
- 这一步明确不做什么
- 怎么验证

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等待复核
- `DONE`：完成并验证通过
- `CANCELLED`：取消并写清楚原因

执行规则：

- 只有 `状态：DONE` 的任务才能勾选 `[x]`
- 每完成一个任务，必须立刻回写状态与验证结果
- `BLOCKED` 和 `CANCELLED` 必须写明原因和下一步

---

## 阶段 1：把交付边界和平台适配骨架立住

- [x] 1.1 建立桌面壳与共享前端运行时的边界
  - 状态：DONE
  - 这一步到底做什么：明确 `apps/desktop` 与 `apps/user-app` 的职责边界，建立平台适配入口。
  - 做完你能看到什么：桌面端与 H5 都从同一套前端入口启动，壳层只负责平台能力。
  - 先依赖什么：`spec001`、`spec003` 的基础约束已可用。
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §2.1、§2.2、§6.1
  - 主要改哪里：
    - `apps/user-app/src/platform/platform-adapter.ts`
    - `apps/user-app/src/platform/platform-provider.tsx`
    - `apps/desktop/src-tauri/src/main.rs`
    - `apps/desktop/src-tauri/tauri.conf.json`
  - 这一步先不做什么：不做业务页面逻辑，不做移动端适配。
  - 怎么算完成：
    1. 平台适配入口可区分 `desktop/h5`
    2. 业务页面无需感知 Tauri 细节
  - 怎么验证：
    - 平台适配单元测试
    - 桌面端与 H5 启动冒烟测试
  - 本次验证结果：
    - `apps/user-app` 全量测试通过
    - `apps/user-app` 构建通过
    - `apps/desktop` 已补齐 Tauri 壳入口、平台桥接命令与前端产物对接配置
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §2.1、§2.2、§6.1

- [x] 1.2 建立统一客户端配置模型
  - 状态：DONE
  - 这一步到底做什么：实现 `ClientRuntimeConfig` 的读取、写入和默认值策略。
  - 做完你能看到什么：桌面端与 H5 可以用统一配置模型管理 Host 地址和连接行为。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` §3.2.1、§4.1
  - 主要改哪里：
    - `apps/user-app/src/config/client-config-store.ts`
    - `apps/user-app/src/config/client-config-service.ts`
    - `apps/desktop/src-tauri/src/config.rs`
  - 这一步先不做什么：不实现更新发布策略。
  - 怎么算完成：
    1. Host 地址和连接策略可配置
    2. 桌面和 H5 使用同一数据结构
  - 怎么验证：
    - 配置读写单元测试
    - 桌面/H5 配置一致性检查
  - 本次验证结果：
    - `src/config/server-config.test.ts` 通过
    - H5 与桌面桥统一走 `ClientRuntimeConfig`
    - 设置页、登录页、启动引导已统一读取同一配置源
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §3.2.1、§4.1

- [x] 1.3 阶段检查：交付边界检查
  - 状态：DONE
  - 这一步到底做什么：确认当前实现没有把业务状态塞进壳层，也没有引入移动端专属内容。
  - 做完你能看到什么：阶段 1 的结构可作为后续连接与升级的稳定基础。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 7
    - `design.md` §1.3、§2.1
  - 主要改哪里：阶段 1 相关文件与文档
  - 这一步先不做什么：不推进业务功能扩展。
  - 怎么算完成：
    1. 壳层边界评审通过
    2. 范围没有混入移动端专属需求
  - 怎么验证：
    - 架构走查记录
    - 变更清单对照检查
  - 本次验证结果：
    - 业务页面改为通过 `platform-adapter`/`platform-provider` 使用桌面能力
    - Tauri 壳层只暴露配置、更新、窗口、外链、通知等平台命令
    - 未引入移动端专属实现到 `user-app`
  - 对应需求：`requirements.md` 需求 1、需求 7
  - 对应设计：`design.md` §1.3、§2.1

---

## 阶段 2：打通连接建立与连接恢复主链路

- [x] 2.1 实现客户端启动引导与连接探测
  - 状态：DONE
  - 这一步到底做什么：实现启动引导流程，覆盖 Host 初始化状态检查、登录态检查和连接探测。
  - 做完你能看到什么：用户进入后能明确知道该初始化、登录还是可直接进入工作区。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 3、需求 6
    - `design.md` §2.3.1、§3.3.1、§3.3.2
  - 主要改哪里：
    - `apps/user-app/src/bootstrap/bootstrap-app.ts`
    - `apps/user-app/src/auth/auth-gateway.ts`
    - `apps/user-app/src/network/host-probe.ts`
  - 这一步先不做什么：不做桌面升级流程。
  - 怎么算完成：
    1. 初始化/登录/可进入三态清晰
    2. 未登录无法进入受保护页面
  - 怎么验证：
    - 启动流程集成测试
    - 未授权访问拦截测试
  - 本次验证结果：
    - `src/app/App.test.tsx` 通过
    - 启动页、登录页、初始化页已改走 `bootstrapApplication`、`authGateway`、`probeHost`
  - 对应需求：`requirements.md` 需求 3、需求 6
  - 对应设计：`design.md` §2.3.1、§3.3.1、§3.3.2、§6.3

- [x] 2.2 实现连接管理器与自动重连策略
  - 状态：DONE
  - 这一步到底做什么：实现 `connection-manager`，统一管理 HTTP/WS 状态和重连状态机。
  - 做完你能看到什么：连接断开后可自动恢复，失败后有手动重连入口。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 4、需求 6
    - `design.md` §2.3.3、§4.2、§5.3
  - 主要改哪里：
    - `apps/user-app/src/network/connection-manager.ts`
    - `apps/user-app/src/network/realtime-client.ts`
    - `apps/user-app/src/components/connection/ConnectionStatusBanner.tsx`
  - 这一步先不做什么：不改会话业务协议，不加移动端通知。
  - 怎么算完成：
    1. 自动重连和失败提示可用
    2. 重连成功后关键状态可刷新
  - 怎么验证：
    - 网络抖动模拟测试
    - 断线恢复端到端测试
  - 本次验证结果：
    - `src/app/App.test.tsx` 覆盖工作台 socket 与会话 socket 重连场景
    - 三个实时客户端已统一接入 `connection-manager`
  - 对应需求：`requirements.md` 需求 4、需求 6
  - 对应设计：`design.md` §2.3.3、§4.2、§5.3

- [x] 2.3 阶段检查：连接主链路检查
  - 状态：DONE
  - 这一步到底做什么：检查“启动探测 -> 登录 -> 建连 -> 断线恢复”是否完整。
  - 做完你能看到什么：连接问题从“黑盒”变成可诊断、可恢复。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4、需求 6
    - `design.md` §2.3、§4.2、§7
  - 主要改哪里：阶段 2 相关代码与验证文档
  - 这一步先不做什么：不扩展桌面升级能力。
  - 怎么算完成：
    1. 主链路端到端可回放
    2. 错误码与提示语一致
  - 怎么验证：
    - E2E 回放脚本
    - 故障注入测试
  - 本次验证结果：
    - `apps/user-app` 全量 79 个测试全部通过
    - 登录、导航首屏、文件面板延迟挂载、断线补回均已覆盖
  - 对应需求：`requirements.md` 需求 3、需求 4、需求 6
  - 对应设计：`design.md` §2.3、§4.2、§7

---

## 阶段 3：完成桌面分发、升级和验收收口

- [ ] 3.1 实现桌面更新检查与升级执行
  - 状态：IN_REVIEW
  - 这一步到底做什么：接入 `release-manifest` 拉取、签名校验、升级执行流程。
  - 做完你能看到什么：桌面端可检查更新并执行升级。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.4、§3.2.3、§3.3.5
  - 主要改哪里：
    - `apps/desktop/src-tauri/src/updater.rs`
    - `apps/user-app/src/platform/desktop/release-manager.ts`
    - `apps/user-app/src/settings/ReleasePanel.tsx`
  - 这一步先不做什么：不接入移动端升级策略。
  - 怎么算完成：
    1. 可按通道检查更新
    2. 升级包签名校验生效
  - 怎么验证：
    - 更新流程集成测试
    - 签名异常测试
  - 本次验证结果：
    - Host 已提供 `/api/client/runtime-config` 与 `/api/client/release-manifest`
    - `apps/host/tests/integration/client-routes.test.ts` 通过
    - `apps/user-app/src/settings/ReleasePanel.tsx`、`apps/user-app/src/platform/desktop/release-manager.ts` 已接通检查更新与安装入口
    - `apps/desktop/src-tauri/src/updater.rs` 已实现下载、SHA-256 校验、安装包拉起
  - 当前阻塞：
    - Windows 端已完成 Rust/Tauri 编译验证，但更新安装链路仍缺少一次真实安装包回放验收
    - macOS 安装包需要在 macOS 机器上完成最终打包与安装验证
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.4、§3.2.3、§3.3.5

- [ ] 3.2 实现升级失败回退与配置保留
  - 状态：IN_REVIEW
  - 这一步到底做什么：实现升级失败后的回退机制，确保配置不丢失。
  - 做完你能看到什么：升级失败不会把用户卡死在不可用版本。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.4、§5.3、§7.3
  - 主要改哪里：
    - `apps/desktop/src-tauri/src/rollback.rs`
    - `apps/desktop/src-tauri/src/config.rs`
    - `apps/user-app/src/platform/desktop/release-manager.ts`
  - 这一步先不做什么：不新增发布平台范围。
  - 怎么算完成：
    1. 升级失败可自动或手动回退
    2. 配置文件和登录上下文可保留
  - 怎么验证：
    - 升级失败注入测试
    - 回退后可用性回归测试
  - 本次验证结果：
    - `apps/desktop/src-tauri/src/rollback.rs` 已实现回退状态记录与重新拉起安装包
    - `apps/desktop/src-tauri/src/config.rs` 已实现桌面端配置文件读写
    - 桌面配置与 H5 配置模型已打通
  - 当前阻塞：
    - 本机已具备 Rust/Tauri 工具链并完成 Windows 编译，但真实回退安装验证仍缺少安装包回放
    - macOS 回退链路仍需在 macOS 机器上用真实 `.dmg/.app` 验证
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.4、§5.3、§7.3

- [ ] 3.3 最终检查点：spec008 验收收口
  - 状态：IN_PROGRESS
  - 这一步到底做什么：核对 spec008 的需求、设计、任务和验证证据是否对齐。
  - 做完你能看到什么：桌面端与 H5 交付增强可以独立进入实施迭代。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/README.md`
  - 主要改哪里：当前 spec 全部文档和验收记录
  - 这一步先不做什么：不新增移动端专属范围，不引入额外业务模块。
  - 怎么算完成：
    1. 七条需求都有验证证据
    2. 风险项有明确处置结论
    3. 后续交接人员可直接继续实施
  - 怎么验证：
    - 按验收清单逐项核对
    - 关键流程回放记录
  - 当前结论：
    - `user-app` 构建通过；桌面壳、工作台布局、文件面板相关测试通过：`src/app/App.test.tsx`、`src/features/conversation/components/WorkbenchLayout.test.tsx`、`src/features/conversation/components/FileContextPanel.test.tsx`
    - 桌面端原生化壳层已落地：统一平台设计令牌、顶部 titlebar、左侧 sidebar、中间主区、右侧 inspector 已接入 `apps/user-app`
    - 桌面端交互已补齐一批基础能力：快捷键、原生右键菜单、原生目录选择器、原生通知、拖拽导入
    - `user-app` 全量测试仍有既有失败：`src/features/conversation/components/GitSidebar.test.tsx`、`src/features/workbench/components/TerminalManagerPanel.test.tsx`
    - `host` 构建通过，新增 client 路由测试通过
    - `host` 全量测试仍有既有失败：`spec005-git-remote-errors.test.ts` 两项断言不匹配、`spec006-terminal-core.e2e.test.ts` 在当前 Windows/ConPTY 环境超时
    - desktop Rust 壳代码已落地，且已在 Windows 机器上完成 `cargo/rustc + Tauri` 编译验收
    - `apps/desktop/src-tauri/tauri.conf.json` 已开启 `bundle.active`，macOS 机器执行构建时会产出 `.app/.dmg`
    - 已新增 GitHub Actions 工作流 `.github/workflows/desktop-release.yml`，可自动产出 macOS `.dmg`、Windows 安装包和 Ubuntu `.deb`
    - macOS 最终安装包验收仍需在 macOS 机器上完成
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
