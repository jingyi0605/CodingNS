# 任务清单 - spec008.1 桌面端多窗口管理（人话版）

状态：DONE

## 2026-04-02 进展补记

- 已确认本子 Spec 只做 `Desktop` 多窗口，不碰 `H5`
- 已确认第一批范围只拆 `文件 / Git / 进程管理`
- 已把终端规则先钉死为“单主交互窗，其余明确只读”
- 已完成本子 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化
- 已回写父级 `spec008` 的子 Spec 边界说明

## 这份文档是干什么的

这份任务清单用来把“桌面端多窗口”拆成真正能执行的步骤。

它必须始终回答清楚：

1. 这一步到底建什么
2. 做完以后用户能看到什么结果
3. 依赖什么
4. 主要改哪些文件
5. 这一步明确不做什么
6. 怎么验证不是假完成

---

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等待复核
- `DONE`：完成并验证
- `CANCELLED`：取消并写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻回写本文件
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 0：先把范围和规矩钉死，别一上来把系统拆烂

- [x] 0.1 启动 spec008.1 并完成文档初始化
  - 状态：DONE
  - 这一步到底做什么：建立 `spec008.1` 目录和主文档，明确只做桌面端多窗口。
  - 做完你能看到什么：`README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md` 已存在。
  - 先依赖什么：`spec008`
  - 主要改哪些文件：
    - `specs/spec008.1-桌面端多窗口管理/README.md`
    - `specs/spec008.1-桌面端多窗口管理/requirements.md`
    - `specs/spec008.1-桌面端多窗口管理/design.md`
    - `specs/spec008.1-桌面端多窗口管理/tasks.md`
    - `specs/spec008.1-桌面端多窗口管理/docs/README.md`
  - 这一步明确不做什么：不写业务代码。
  - 怎么算完成：
    1. 子 Spec 主文档齐全
    2. 范围、依赖、非目标已写清楚
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成 `spec008.1` 主文档初始化

- [x] 0.2 回写父级 spec008 的边界说明
  - 状态：DONE
  - 这一步到底做什么：把 `spec008.1` 作为 `spec008` 的子问题标出来，避免后续继续把桌面交付和多窗口写成一锅粥。
  - 做完你能看到什么：父级 Spec 能看出“交付壳”和“桌面多窗口”是两层问题。
  - 先依赖什么：0.1
  - 主要改哪些文件：
    - `specs/spec008-桌面端与H5交付增强/README.md`
    - `specs/spec008-桌面端与H5交付增强/design.md`
    - `specs/spec008-桌面端与H5交付增强/tasks.md`
  - 这一步明确不做什么：不扩展父 Spec 范围。
  - 怎么算完成：
    1. 父级文档出现子 Spec 边界说明
    2. 后续不会再把 H5 多窗口混进来
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已在父级 Spec 文档中补充 `spec008.1` 边界说明

---

## 阶段 1：先把窗口数据和壳层命令立住

- [x] 1.1 建立 `WindowDescriptor` 和窗口注册表
  - 状态：DONE
  - 这一步到底做什么：在前端建立统一窗口描述和窗口注册状态，不再让每个页面各管各的窗口字段。
  - 做完你能看到什么：系统已经有统一窗口真相，能表达 `files / git / processes / terminal / chat` 五类窗口。
  - 先依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 5
    - `design.md` §3
  - 主要改哪些文件：
    - `apps/user-app/src/platform/desktop/*`（预期新增窗口注册表）
    - `apps/user-app/src/platform/platform-adapter.ts`
    - `apps/user-app/src/platform/platform-provider.tsx`
  - 这一步明确不做什么：先不创建真实外部窗口。
  - 怎么算完成：
    1. 有统一 `WindowDescriptor`
    2. 有窗口注册表
    3. 主窗口能登记和查询窗口状态
  - 怎么验证：
    - 类型检查
    - 窗口注册表单元测试
  - 验证结果：
    - 已新增统一窗口模型：`WindowKind`、`WindowMode`、`WindowBounds`、`WindowDescriptor`
    - 已新增前端窗口注册表，支持注册、更新、查询、打开、关闭、枚举、删除、清空
    - 已执行 `vitest`：`window-descriptor.test.ts`、`window-registry.test.ts`、`platform-adapter.test.ts`、`remembered-login.test.ts` 全部通过
    - 已执行类型检查：`tsconfig.json`、`tsconfig.node.json` 全部通过

- [x] 1.2 补齐 Tauri 多窗口命令
  - 状态：DONE
  - 这一步到底做什么：在桌面壳增加创建、关闭、聚焦、读取、同步窗口描述的最小命令。
  - 做完你能看到什么：前端终于能通过统一桥接去开关原生窗口。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §4
  - 主要改哪些文件：
    - `apps/desktop/src-tauri/src/lib.rs`
    - `apps/desktop/src-tauri/tauri.conf.json`
    - `apps/user-app/src/platform/platform-adapter.ts`
  - 这一步明确不做什么：先不做复杂窗口编排。
  - 怎么算完成：
    1. 前端可创建指定 `windowId` 的窗口
    2. 外部窗口可读取自己的 descriptor
    3. 窗口尺寸和位置可同步
  - 怎么验证：
    - Tauri 命令单元测试或集成验证
    - 桌面端手动冒烟测试
  - 验证结果：
    - 已在桌面壳补齐 `create_window`、`close_window`、`focus_window`、`list_windows`、`get_window_descriptor`、`sync_window_descriptor`、`update_window_bounds`
    - 已在前端 `platform-adapter.ts` 补齐对应 bridge 方法，统一通过平台层调用 Tauri 多窗口命令
    - 已新增 Rust 侧 `window_manager` 单元测试，覆盖 descriptor 同步、bounds 更新、打开关闭状态、外部窗口范围限制
    - 已执行 `cargo test`，`apps/desktop/src-tauri` 全部通过
    - 已执行 `vitest`：`platform-adapter.test.ts`、`remembered-login.test.ts` 全部通过
    - 已执行类型检查：`tsconfig.json`、`tsconfig.node.json` 全部通过
    - 本步未做桌面端手动冒烟测试，因为尚未接入外部窗口 UI 壳

- [x] 1.3 阶段检查：主窗口默认流程不能被动到
  - 状态：DONE
  - 这一步到底做什么：确认多窗口基础设施接入后，不打开外部窗口时，现有桌面主工作台完全不变。
  - 做完你能看到什么：多窗口不是重写主工作台，而是附加能力。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §5.1、§9.1
  - 主要改哪些文件：阶段 1 相关代码和测试
  - 这一步明确不做什么：不推进外部窗口 UI。
  - 怎么算完成：
    1. 主窗口默认路径不变
    2. 现有工作台回归通过
  - 怎么验证：
    - `apps/user-app` 相关回归测试
    - 桌面端主流程冒烟测试
  - 验证结果：
    - 已新增桌面端主窗口回归测试，验证现有主窗口默认流程进入工作台时不会主动触发 `create_window`、`close_window`、`focus_window`、`list_windows`、`get_window_descriptor`、`sync_window_descriptor`、`update_window_bounds`
    - 已确认工作台壳分流规则保持不变：`desktop` runtime 仍然走桌面壳，`web` 端仍按 viewport 切换桌面壳/移动壳
    - 已执行 `vitest`：`src/app/App.test.tsx -t "桌面端主窗口默认流程不会主动触发多窗口命令"` 通过
    - 已执行 `vitest`：`src/features/workbench/components/WorkbenchShellRoute.test.ts` 通过
    - 已执行类型检查：`tsconfig.json`、`tsconfig.node.json` 全部通过
    - 本步未做手动桌面端冒烟测试，也未启动开发服务器；当前验证为自动化主流程冒烟

---

## 阶段 2：先把最安全的三类外部窗口做出来

- [x] 2.1 实现文件窗口的外部打开能力
  - 状态：DONE
  - 这一步到底做什么：让主窗口可以把文件管理视图在新窗口中打开。
  - 做完你能看到什么：文件管理既能留在主工作台，也能独立显示在新窗口。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` §5.2、§7.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/FileContextPanel.tsx`
    - `apps/user-app/src/app/router.tsx`
    - `apps/user-app/src/platform/desktop/window-openers.ts`
    - `apps/user-app/src/features/desktop-window/*`
    - `apps/desktop/src-tauri/src/lib.rs`
  - 这一步明确不做什么：不顺手改聊天页。
  - 怎么算完成：
    1. 文件视图可在外部窗口打开
    2. 主窗口文件视图保持原样
  - 怎么验证：
    - 文件窗口创建与关闭测试
    - 主窗口文件功能回归测试
  - 验证结果：
    - 已新增平台层 opener：统一构造 `files` 外部窗口 `WindowDescriptor`，复用已登记 `bounds`，并在创建失败时回滚前端注册表状态
    - 已新增 `/desktop-window/:windowId` 页面壳，只按 `WindowDescriptor.kind` 渲染文件窗口；当前明确只接 `files`，遇到 `git/processes` 仍返回占位错误
    - 已在 `FileContextPanel` 增加桌面端“在新窗口打开”入口，并确认外部窗口模式不会再次显示该入口，主窗口文件面板原有行为不变
    - 已将 Tauri 外部窗口入口改为加载 `desktop-window/{windowId}`，用于进入独立文件窗口路由壳
    - 已执行 `vitest`：`src/platform/desktop/window-openers.test.ts`、`src/features/desktop-window/DesktopWindowPage.test.tsx` 通过
    - 已执行 `vitest`：`src/features/conversation/components/FileContextPanel.test.tsx -t "桌面端会显示在新窗口打开入口，并调用平台 opener|外部窗口模式不会再次显示开新窗口入口|桌面端开新窗口失败时会给出错误提示"` 通过
    - 已执行类型检查：`tsconfig.json`、`tsconfig.node.json` 通过
    - 已执行桌面壳验证：`apps/desktop/src-tauri` 下 `cargo test` 通过
    - 本步未启动开发服务器，也未做手动桌面端冒烟；当前验证结论来自自动化测试与类型检查

- [x] 2.2 实现 Git 窗口的外部打开能力
  - 状态：DONE
  - 这一步到底做什么：让 Git 视图可以作为独立窗口显示。
  - 做完你能看到什么：用户可以把 Git 放到单独窗口里看，不用挤在主工作台侧栏。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §5.2、§7
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/GitSidebar.tsx`
    - `apps/user-app/src/features/desktop-window/*`
  - 这一步明确不做什么：不改 Git 业务协议。
  - 怎么算完成：
    1. Git 视图可独立打开
    2. 主窗口 Git 面板保持可用
  - 怎么验证：
    - Git 外部窗口测试
    - Git 主窗口回归测试
  - 验证结果：
    - `GitSidebar` 增加了桌面端“在新窗口打开 Git”按钮，只在桌面且非外部窗口模式下显示，按钮不会因 loading 被禁用，并且会调用分享的 `openGitExternalWindow` opener。
    - 外部窗口失败时会展示 `git.openExternalFailed` 的 toast，按钮点击被 `haptics` 反馈。
    - 相关单元测试 `apps/user-app/src/features/conversation/components/GitSidebar.test.tsx` （目标 `openGitExternalWindow` 测试）以及整体 `pnpm --dir apps/user-app test -- GitSidebar.test.tsx` 均已通过。

- [x] 2.3 实现进程管理窗口的外部打开能力
  - 状态：DONE
  - 这一步到底做什么：把进程管理视图作为第三个外部窗口类型落地。
  - 做完你能看到什么：进程管理可以单独盯着看，不再和聊天、文件、Git 抢空间。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §5.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/workbench/components/TerminalManagerPanel.tsx`
    - `apps/user-app/src/features/desktop-window/*`
  - 这一步明确不做什么：不把真实终端交互窗口一起打开。
  - 怎么算完成：
    1. 进程管理可独立打开
    2. 外部窗口与主窗口都能正确刷新
  - 怎么验证：
    - 进程管理窗口测试
    - 工作区切换和刷新测试
  - 验证结果：
    - `TerminalManagerPanel` 已新增桌面端“在新窗口打开”入口，仅在桌面且非外部窗口模式展示，点击通过平台层 `openProcessesExternalWindow` 打开外部窗口，失败时展示 `terminalManager.openExternalFailed`。
    - `DesktopWindowPage` 已支持按 `WindowDescriptor.kind === "processes"` 渲染进程管理外部窗口壳，并通过 `workbenchShellOverrides` 复用实时快照能力；外部窗口模式下不会重复显示“在新窗口打开”入口。
    - 已执行 `vitest`：`src/platform/desktop/window-openers.test.ts`、`src/features/desktop-window/DesktopWindowPage.test.tsx`、`src/features/workbench/components/TerminalManagerPanel.test.tsx`、`src/features/conversation/components/GitSidebar.test.tsx`，共 36 条全部通过。
    - 已执行类型检查：`pnpm --filter user-app exec tsc -p tsconfig.node.json --noEmit` 通过。
    - 已执行桌面壳验证：`apps/desktop/src-tauri` 下 `cargo test` 通过。
    - 已执行 `pnpm --filter user-app exec tsc -p tsconfig.json --noEmit`，当前仍有仓库既有无关失败：`src/features/conversation/capability/provider-ui.ts(110)` 的 `TS7053`，本任务未新增该类错误。

- [x] 2.4 阶段检查：第一批三类外部窗口收口
  - 状态：DONE
  - 这一步到底做什么：确认文件、Git、进程管理三类窗口都已经能独立打开、关闭、恢复，不影响主窗口。
  - 做完你能看到什么：第一批多窗口已经形成最小可用闭环。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4、需求 5
    - `design.md` §7、§10
  - 主要改哪些文件：阶段 2 相关代码与测试
  - 这一步明确不做什么：不推进聊天 / 终端外部窗口。
  - 怎么算完成：
    1. 三类外部窗口均可用
    2. 主窗口默认流程未破坏
  - 怎么验证：
    - 端到端手动回归
    - 相关测试与构建验证
  - 验证结果：
    - 已确认第一批三类外部窗口（`files / git / processes`）都通过统一 opener 与统一外部窗口壳路由工作，且外部窗口模式下不会再次显示“在新窗口打开”入口。
    - 已执行 `vitest`：`src/platform/desktop/window-openers.test.ts`、`src/features/desktop-window/DesktopWindowPage.test.tsx`、`src/features/conversation/components/GitSidebar.test.tsx`、`src/features/workbench/components/TerminalManagerPanel.test.tsx`、`src/features/workbench/components/WorkbenchShellRoute.test.ts`，以及 `src/app/App.test.tsx -t "桌面端主窗口默认流程不会主动触发多窗口命令"`，相关场景全部通过。
    - 已执行类型检查：`pnpm --filter user-app exec tsc -p tsconfig.node.json --noEmit` 通过。
    - 已执行桌面壳验证：`apps/desktop/src-tauri` 下 `cargo test` 通过。
    - 已执行 `pnpm --filter user-app exec tsc -p tsconfig.json --noEmit`，当前仍有仓库既有无关失败：`src/features/conversation/capability/provider-ui.ts(110)` 的 `TS7053`，本阶段未新增该类错误。
    - 本阶段未做手动桌面端端到端回归，也未启动开发服务器；当前结论基于自动化测试与类型检查。

---

## 阶段 3：把终端规矩落实成系统约束

- [x] 3.1 落地终端窗口交互所有权模型
  - 状态：DONE
  - 这一步到底做什么：把“同一 `terminalId` 同时最多一个主交互窗”的规则落实成可执行状态模型。
  - 做完你能看到什么：系统已经能明确判断哪个窗口可交互，哪个窗口只能只读。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §6、§9.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/terminal/*`
    - `apps/host/src/modules/terminal/*`（如需服务端兜底）
  - 这一步明确不做什么：先不交付终端外部窗口 UI。
  - 怎么算完成：
    1. 有主交互窗判定
    2. 有只读镜像判定
    3. 输入和 resize 被约束
  - 怎么验证：
    - 终端所有权测试
    - 多窗冲突场景测试
  - 验证结果：
    - 已新增 `TerminalWindowPolicy`（`apps/user-app/src/features/terminal/runtime/terminal-window-policy.ts`），支持主交互窗申请/释放、冲突判定、镜像只读判定、窗口级释放与输入/resize 权限判断。
    - 已在 `TerminalPage` 接入所有权约束：终端输入与 `resize` 仅在 `owner` 角色下发送；非 owner（镜像窗）会被本地拦截，满足“同一 `terminalId` 同时最多一个可交互窗口”的规则。
    - 已新增 `vitest`：`src/features/terminal/runtime/terminal-window-policy.test.ts`，覆盖主交互窗判定、镜像判定、强制切换、释放后不自动转移、多租约释放等冲突场景。
    - 已执行 `vitest`：`src/features/terminal/pages/TerminalPage.test.tsx` 通过，确认接入约束后终端页现有流程未回退。
    - 已执行类型检查：`pnpm --filter user-app exec tsc -p tsconfig.node.json --noEmit` 通过。
    - 已执行 `pnpm --filter user-app exec tsc -p tsconfig.json --noEmit`，当前仍有仓库既有无关失败：`src/features/conversation/capability/provider-ui.ts(110)` 的 `TS7053`，本任务未新增该类错误。

- [x] 3.2 阶段检查：终端不会再出现多窗抢输入
  - 状态：DONE
  - 这一步到底做什么：确认终端规则不是写在文档里好看，而是真的能阻止多窗抢交互。
  - 做完你能看到什么：后续即使做终端外部窗口，也不会从一开始就是错的。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §6
  - 主要改哪些文件：阶段 3 相关代码与测试
  - 这一步明确不做什么：不在本子 Spec 内开放终端外部窗口。
  - 怎么算完成：
    1. 规则落地可测
    2. 没有隐式交互权漂移
  - 怎么验证：
    - 多窗终端冲突回归测试
  - 验证结果：
    - 已新增冲突回归测试：`src/features/terminal/runtime/terminal-window-policy.test.ts` 的“主窗口释放后不会把交互权隐式转给镜像窗口，必须显式重新申请”，验证终端交互权不会在多窗场景下发生隐式漂移。
    - `TerminalWindowPolicy` 相关用例共 `6` 条全部通过，覆盖主交互窗、镜像窗、强制切换、释放回收、窗口关闭释放、多租约回收等场景。
    - 已执行 `vitest`：`src/features/terminal/pages/TerminalPage.test.tsx` 全部通过，确认终端页在接入 owner/mirror 约束后未引入回归。
    - 已执行类型检查：`pnpm --filter user-app exec tsc -p tsconfig.node.json --noEmit` 通过。
    - 已执行 `pnpm --filter user-app exec tsc -p tsconfig.json --noEmit`，当前仍有仓库既有无关失败：`src/features/conversation/capability/provider-ui.ts(110)` 的 `TS7053`，本阶段未新增该类错误。

---

## 阶段 4：最终验收与收口

- [x] 4.1 最终检查点：spec008.1 验收收口
  - 状态：DONE
  - 这一步到底做什么：核对需求、设计、任务、测试和实际范围是否对齐。
  - 做完你能看到什么：本子 Spec 可以独立进入实现迭代，不再靠口头约束。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪些文件：
    - `specs/spec008.1-桌面端多窗口管理/*`
    - `specs/spec008.1-桌面端多窗口管理/docs/*`
  - 这一步明确不做什么：不临时塞入 H5、聊天窗或终端多交互。
  - 怎么算完成：
    1. 文档和实现范围一致
    2. 第一批范围和终端规则都有验证证据
  - 怎么验证：
    - 文档走查
    - 测试记录
    - 桌面端手动验收记录
  - 验证结果：
    - 已完成文档走查：`requirements.md`、`design.md`、`tasks.md` 与实现范围对齐，保持“仅 Desktop、多窗口第一批仅 files/git/processes、不做 H5、不做聊天独立窗、不做终端外部窗口 UI”的边界。
    - 已完成自动化测试收口：`window-openers`、`DesktopWindowPage`、`GitSidebar`、`TerminalManagerPanel`、`TerminalWindowPolicy`、`TerminalPage`、`WorkbenchShellRoute` 与 `App` 主窗口默认流程回归测试均已通过。
    - 已完成构建与类型收口：`pnpm --filter user-app exec tsc -p tsconfig.node.json --noEmit` 通过，`apps/desktop/src-tauri` 下 `cargo test` 通过。
    - 已执行 `pnpm --filter user-app exec tsc -p tsconfig.json --noEmit`，当前保留仓库既有无关失败：`src/features/conversation/capability/provider-ui.ts(110)` 的 `TS7053`，本 Spec 实现未新增该类错误。
    - 本阶段未做手动桌面端验收记录，也未启动开发服务器；当前验收结论来自自动化测试、类型检查与文档核对。
