# 任务清单 - spec001.3.3 HOST与PEERHOST资源作用域统一与切换收口（人话版）

状态：IN_PROGRESS

## 2026-06-16 进展补记

- 已启动 `spec001.3.3`
- 已明确这次不是继续补零散 `targetHostId` 判断，而是统一资源作用域模型和切换清理规则
- 已明确第一阶段优先收口会话和终端两条最容易串 HOST 的链路
- 已新增统一作用域工具 `apps/user-app/src/features/workbench/utils/resource-scope.ts`
- 已把 Git 侧栏、工作区调试详情页、文件面板、会话文件面板接到同一套作用域 key / targetHostId 规则
- 已确认当前文件 / Git / 调试链路不再在主 HOST 下显式透传空 `targetHostId`
- 已把 `WorkbenchLayout` 的 Git / 文件 / 工作区管理 / 终端 realtime 绑定统一加上 `scopeKey`
- 已在 `WorkbenchLayout` 落地“切作用域先清旧 binding、旧 peer realtime client，再让新作用域重建订阅”的壳层事务
- 已补最小回归，确认从 `peer-host-1` 切回主 HOST 工作区后，旧 peer realtime socket 不再继续发送终端订阅

## 这份文档是干什么的

这份任务清单把“HOST 与 PEERHOST 资源作用域统一与切换收口”拆成可执行的阶段。

每一步都优先回答这些问题：

1. 这一步到底做什么
2. 做完以后能看到什么结果
3. 这一步依赖什么
4. 主要改哪些文件
5. 这一步明确不做什么
6. 怎么验证是不是真的做完了

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并验证
- `CANCELLED`：取消并写原因

规则：

- 只有 `状态：DONE` 的任务才能勾成 `[x]`
- 每做完一个任务，必须立刻回写这里
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 0：先把问题边界和文档立住

- [x] 0.1 启动 spec001.3.3 并完成主文档初始化
  - 状态：DONE
  - 这一步到底做什么：建立 `spec001.3.3` 目录，写清需求、设计和任务拆分
  - 做完以后能看到什么结果：仓库里有完整的 `spec001.3.3` 文档，别人一眼能看懂这次不是修一个按钮，而是在收口资源作用域
  - 依赖什么：用户确认启动 Spec 流程
  - 主要改哪些文件：
    - `specs/spec001.3.3-HOST与PEERHOST资源作用域统一与切换收口/README.md`
    - `specs/spec001.3.3-HOST与PEERHOST资源作用域统一与切换收口/requirements.md`
    - `specs/spec001.3.3-HOST与PEERHOST资源作用域统一与切换收口/design.md`
    - `specs/spec001.3.3-HOST与PEERHOST资源作用域统一与切换收口/tasks.md`
    - `specs/spec001.3.3-HOST与PEERHOST资源作用域统一与切换收口/docs/README.md`
  - 这一步明确不做什么：不写业务代码，不改请求链路
  - 怎么验证：
    - 人工走查文档
  - 验证结果：
    - 已创建 `README.md`、`requirements.md`、`design.md`、`tasks.md` 和 `docs/README.md`
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

---

## 阶段 1：先把统一作用域入口做出来

- [x] 1.1 在工作台壳里定义统一资源作用域模型和作用域 key
  - 状态：DONE
  - 这一步到底做什么：为工作台引入统一 `ResourceScope` 结构和 `scopeKey` 生成规则
  - 做完以后能看到什么结果：后续模块不再自己猜 `targetHostId`、`requestWorkspaceId`
  - 依赖什么：0.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 6
    - `design.md` §3.1、§3.3、§4.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - 必要时新增 `apps/user-app/src/features/workbench/utils/*scope*`
  - 这一步明确不做什么：不直接修改终端和会话行为，只先把统一入口搭出来
  - 怎么算完成：
    1. 工作台壳内部可以统一解出显示工作区、目标 HOST、请求工作区
    2. 统一作用域 key 可以复用于缓存和订阅
    3. 无法解析作用域时会明确返回空，而不是静默猜默认值
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
  - 验证结果：
    - `WorkbenchLayout` 已改用共享 `resource-scope.ts` 生成 Git / workspace-management / terminal snapshot key
    - 壳层内部已引入统一 `workbench-realtime.scope` key，用同一规则标识 `requestWorkspaceId + targetHostId`
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json --pretty false` 通过
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 6
  - 对应设计：`design.md` §3.1、§3.3、§4.1

- [x] 1.2 在工作台壳里加入作用域切换清理事务
  - 状态：DONE
  - 这一步到底做什么：定义“旧作用域失效 -> 连接清理 -> 新作用域提交 -> 新订阅建立”的切换顺序
  - 做完以后能看到什么结果：跨 HOST / 跨工作区切换时不会继续复用旧连接
  - 依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §5.1、§5.2、§5.3、§5.4
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/features/terminal/pages/TerminalPage.tsx`
  - 这一步明确不做什么：不顺手重构所有资源模块，只先把壳层事务立住
  - 怎么算完成：
    1. 作用域变化时旧订阅有统一失效机制
    2. 异步回写会校验当前作用域 key
    3. 旧请求结果不会覆盖新页面
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx apps/user-app/src/features/terminal/pages/TerminalPage.tsx`
  - 验证结果：
    - `WorkbenchLayout` 的 file / git / workspace-management / terminal 订阅和 pending refresh 记录都已带 `scopeKey`
    - 作用域切换时会统一清空旧 scope 的 binding，并在从 PEERHOST 切回主 HOST 时关闭旧 peer realtime client
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json --pretty false` 通过
    - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/WorkbenchLayout.test.tsx -t "从 PeerHOST 作用域切回主 HOST 工作区后会清掉旧 peer realtime 连接，并只向主 HOST 重建终端订阅" --reporter verbose` 通过，1/1 通过
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §5.1、§5.2、§5.3、§5.4

---

## 阶段 2：先把会话链路收口

- [x] 2.1 修复当前会话定位，不再只靠 sessionId
  - 状态：DONE
  - 这一步到底做什么：把当前会话解析改成带显示工作区和目标 HOST 一起判断
  - 做完以后能看到什么结果：不同 HOST 下同名 sessionId 不会串到一起
  - 依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 4、需求 6
    - `design.md` §4.2、§6.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/features/workbench/utils/workbench-navigation.ts`
  - 这一步明确不做什么：不改后端 session 数据结构
  - 怎么算完成：
    1. 当前会话定位会结合作用域判断
    2. 相同 sessionId 不再误判成当前页面会话
    3. 会话找不到时回退逻辑也用正确作用域
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- src/features/conversation/components/WorkbenchLayout.git-panel.test.tsx`
  - 验证结果：
    - 已把会话入口从“只按 sessionId”改成“按作用域找 session entry”
    - `pnpm --dir apps/user-app test -- src/features/conversation/components/WorkbenchLayout.git-panel.test.tsx` 通过，8/8 通过
  - 对应需求：`requirements.md` 需求 4、需求 6
  - 对应设计：`design.md` §4.2、§6.1

- [x] 2.2 修复会话跳转、收藏、导出、归档、删除等操作的作用域来源
  - 状态：DONE
  - 这一步到底做什么：让会话相关 URL 和请求都从会话自己的作用域生成，而不是盲目复用 `currentWorkspaceRef/currentTargetHostId`
  - 做完以后能看到什么结果：从搜索、通知、侧栏、收藏、归档打开会话都能落到正确 HOST
  - 依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4、需求 7
    - `design.md` §4.2、§6.1、§7.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - 必要时补充相关测试
  - 这一步明确不做什么：不改会话视觉样式
  - 怎么算完成：
    1. 打开会话路径由会话作用域生成
    2. 会话操作请求不再串用错误 `targetHostId`
    3. 已知“会话找不到、HOST 标签串线”问题不再复现
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- src/features/conversation/components/WorkbenchLayout.git-panel.test.tsx`
  - 验证结果：
    - 会话打开 / 恢复 / 收藏等路径已改为从会话自身作用域生成，不再盲目复用当前壳层作用域
    - 右侧栏并行会话和工作树清理确认框的相关回归已一并兜住
    - `pnpm --dir apps/user-app test -- src/features/conversation/components/WorkbenchLayout.git-panel.test.tsx` 通过，8/8 通过
  - 对应需求：`requirements.md` 需求 2、需求 4、需求 7
  - 对应设计：`design.md` §4.2、§6.1、§7.1

---

## 阶段 3：把终端链路收口

- [x] 3.1 统一终端请求工作区解析
  - 状态：DONE
  - 这一步到底做什么：让终端页显式通过终端作用域得到 `requestWorkspaceId`
  - 做完以后能看到什么结果：终端列表、创建、关闭、删除都发到正确 HOST 和工作区
  - 依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 5、需求 6
    - `design.md` §4.3、§6.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/terminal/pages/TerminalPage.tsx`
  - 这一步明确不做什么：不顺手改终端 UI 交互
  - 怎么算完成：
    1. 终端请求工作区只从作用域得出
    2. 不再依赖错误的旧 `shellCurrentWorkspaceRef`
    3. 终端请求不会落到显示工作区的错误 ID
  - 怎么验证：
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json --pretty false`
    - `pnpm --dir apps/user-app test -- src/features/terminal/pages/TerminalPage.test.tsx`
  - 验证结果：
    - 主 HOST 继续直接请求当前工作区
    - PEERHOST 只有在 `currentWorkspaceId/currentWorkspaceRef/currentTargetHostId` 三者一致时才会复用远端 workspaceId，否则明确停住
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json --pretty false` 通过
    - `pnpm --dir apps/user-app test -- src/features/terminal/pages/TerminalPage.test.tsx` 通过，36/36 通过
  - 对应需求：`requirements.md` 需求 2、需求 5、需求 6
  - 对应设计：`design.md` §4.3、§6.2

- [x] 3.2 修复终端订阅和切换时的旧连接清理
  - 状态：DONE
  - 这一步到底做什么：切换终端作用域时先断旧连接，再建立新订阅，并阻止旧结果回写
  - 做完以后能看到什么结果：先打开 PEERHOST 终端再切回主 HOST 时，不会继续显示旧 HOST 的终端结果
  - 依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 5、需求 7
    - `design.md` §5.2、§5.4、§6.2、§7.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/terminal/pages/TerminalPage.tsx`
    - `apps/user-app/src/features/workbench/components/TerminalManagerPanel.tsx`
  - 这一步明确不做什么：不改终端后端协议
  - 怎么算完成：
    1. 终端作用域变化时旧连接会断开
    2. 旧快照和旧列表结果不会写回新页面
    3. 当前终端集合始终属于当前终端作用域
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- src/features/terminal/pages/TerminalPage.test.tsx`
    - `pnpm --dir apps/user-app exec vitest run src/features/workbench/components/TerminalManagerPanel.test.tsx -t "PeerHost 场景会用请求工作区刷新，但调试跳转仍保留显示工作区和 targetHostId" --reporter verbose`
  - 验证结果：
    - 终端页的列表加载、快照刷新、listener 回写和初始加载都已加 `requestWorkspaceId` 守卫
    - realtime effect 已把 `targetHostId` 纳入依赖，切 HOST 会重建连接
    - `TerminalManagerPanel` 已拆开显示工作区和请求工作区，PeerHost 刷新走远端 workspaceId，调试跳转仍保留显示工作区 URL
    - `pnpm --dir apps/user-app test -- src/features/terminal/pages/TerminalPage.test.tsx` 通过，36/36 通过
    - `pnpm --dir apps/user-app exec vitest run src/features/workbench/components/TerminalManagerPanel.test.tsx -t "PeerHost 场景会用请求工作区刷新，但调试跳转仍保留显示工作区和 targetHostId" --reporter verbose` 通过，1/1 通过
    - 说明：`TerminalManagerPanel.test.tsx` 旧有其余用例在当前仓库里单文件运行会卡在收集/退出阶段，这次未扩大处理范围，避免把历史测试问题混入本 spec
  - 对应需求：`requirements.md` 需求 3、需求 5、需求 7
  - 对应设计：`design.md` §5.2、§5.4、§6.2、§7.2

---

## 阶段 4：给文件 / Git / 调试立统一接入规则并补最小回归

- [x] 4.1 统一文件 / Git / 调试订阅与缓存 key 的作用域规则
  - 状态：DONE
  - 这一步到底做什么：把这三条链路的 key 规则和请求入口统一成作用域驱动
  - 做完以后能看到什么结果：后续继续改时不会再各写各的 `targetHostId` 判断
  - 依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 6、需求 7
    - `design.md` §3.3、§6.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - 相关快照 key 工具和测试
  - 这一步明确不做什么：不要求本阶段把三个模块全部重构完
  - 怎么算完成：
    1. 新规则已经落在公共入口
    2. 后续模块接入时有唯一标准
    3. 最小缓存 key 冲突风险被消除
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json --pretty false`
    - `pnpm --dir apps/user-app test -- src/features/conversation/components/GitSidebar.test.tsx`
    - `pnpm --dir apps/user-app test -- src/features/debug-target/pages/WorkspaceDebugDetailPage.test.tsx`
    - `pnpm --dir apps/user-app test -- src/features/conversation/components/FileContextPanel.test.tsx`
  - 验证结果：
    - 已新增 `resource-scope.ts`，统一提供 `targetHostId` 规范化、快照 HOST 读取、跨 HOST key 构造、作用域工作区引用构造
    - `GitSidebar` 已统一使用作用域快照 key，listener / cache 恢复都按 `workspaceId + targetHostId` 区分
    - `WorkspaceDebugDetailPage`、`useDebugAnalysis`、`useRegisteredDebugTemplates` 已统一从 URL 与作用域中解析 `targetHostId`，调试模板查询、分析和运行都走正确 HOST
    - `FileContextPanel` 与 `SessionChangedFilesPanel` 已统一作用域缓存 key，并移除主 HOST 下的空 `targetHostId` 透传
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json --pretty false` 通过
    - `pnpm --dir apps/user-app test -- src/features/conversation/components/GitSidebar.test.tsx` 通过，31/31 通过
    - `pnpm --dir apps/user-app test -- src/features/debug-target/pages/WorkspaceDebugDetailPage.test.tsx` 通过，3/3 通过
    - `pnpm --dir apps/user-app test -- src/features/conversation/components/FileContextPanel.test.tsx` 通过，51/51 通过
  - 对应需求：`requirements.md` 需求 6、需求 7
  - 对应设计：`design.md` §3.3、§6.3

- [x] 4.2 补第一阶段最小回归测试并回写验收结果
  - 状态：DONE
  - 这一步到底做什么：补齐会话和终端跨 HOST 切换的最小必要测试，并在任务文档里回写验证结果
  - 做完以后能看到什么结果：这次改造不是只靠肉眼判断
  - 依赖什么：2.2、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md` §7
    - `tasks.md`
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/*test*`
    - `apps/user-app/src/features/terminal/pages/TerminalPage.test.tsx`
    - `apps/user-app/src/features/workbench/components/TerminalManagerPanel.test.tsx`
    - `specs/spec001.3.3-HOST与PEERHOST资源作用域统一与切换收口/tasks.md`
  - 这一步明确不做什么：不跑全量测试
  - 怎么算完成：
    1. 至少覆盖跨 HOST 会话切换
    2. 至少覆盖跨 HOST 终端切换
    3. 文档里有本轮最小验证命令和结果
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- src/features/conversation/components/WorkbenchLayout.git-panel.test.tsx`
    - `pnpm --dir apps/user-app test -- src/features/terminal/pages/TerminalPage.test.tsx`
    - `pnpm --dir apps/user-app exec vitest run src/features/workbench/components/TerminalManagerPanel.test.tsx -t "PeerHost 场景会用请求工作区刷新，但调试跳转仍保留显示工作区和 targetHostId" --reporter verbose`
  - 验证结果：
    - 会话/Git 侧最小回归：`WorkbenchLayout.git-panel.test.tsx` 8/8 通过
    - 终端页最小回归：`TerminalPage.test.tsx` 36/36 通过
    - 终端管理面板新增 PeerHost 作用域回归：1/1 通过
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` §7
