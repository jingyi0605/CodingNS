# 任务清单 - spec016.5-事务工作台画布化与插件块布局

状态：Draft

## 这份任务清单是干什么的

把“事务工作台画布化”拆成几步能落地的活，并且明确每一步改什么、看到什么、怎么验。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `DONE`：已经完成并回写
- `CANCELLED`：取消不做，但要写原因

---

## 阶段 0：先把边界写死

- [x] 0.1 建立 `spec016.5` 主文档骨架
  - 状态：DONE
  - 这一步做什么：建立 README、requirements、design、tasks 四份主文档。
  - 做完能看到什么：后面不会把这件事误做成“只改一个左侧菜单文案”。
  - 依赖什么：`spec016`、`spec015.2`、`spec017`
  - 主要改哪里：`specs/spec016.5-*`
  - 这一步不做什么：不写前端代码
  - 怎么验证：人工走查四份文档

- [x] 0.2 盘清旧事务模式状态和 HTML 边界
  - 状态：DONE
  - 这一步做什么：确认旧状态里还有 `todo | automation`，并确认 HTML 不能乱绕权限。
  - 做完能看到什么：知道这次必须改状态模型，不能只改视觉。
  - 依赖什么：0.1
  - 主要改哪里：Spec 文档现状和设计章节
  - 这一步不做什么：不选拖拽库，不接运行时
  - 怎么验证：人工走查现有代码和相邻 spec

- [x] 0.3 按新确认的布局重写 spec 骨架
  - 状态：DONE
  - 这一步做什么：把“左栏默认显示、文档右栏默认显示、对话和工作台右栏默认隐藏、顶部标签栏、左侧固定快捷应用栏”写进 README、需求、设计和任务。
  - 做完能看到什么：后面的实现不会再基于旧的“中间主区 + 右侧常驻栏”假设继续长。
  - 依赖什么：0.2
  - 主要改哪里：`specs/spec016.5-*`
  - 这一步不做什么：不直接接入 HTML 选择器
  - 怎么验证：人工走查四份文档，确认旧右栏假设已删掉

---

## 阶段 1：先把入口和状态收口

- [x] 1.1 把事务主分区从 `todo | automation` 收成 `workbench`
  - 状态：DONE
  - 这一步做什么：调整事务状态、路由恢复和左侧一级入口。
  - 做完能看到什么：左侧正式只有“工作台”，不再长期挂两个一级分区。
  - 依赖什么：0.2
  - 主要改哪里：`workbench-mode.ts`、`AffairsWorkbenchView.tsx`、i18n
  - 这一步不做什么：不做整画布改造
  - 怎么验证：`pnpm -C apps/user-app exec vitest run src/features/workbench/utils/workbench-mode.test.ts src/features/workbench/components/AffairsWorkbenchView.test.tsx`

- [x] 1.2 建立工作台标签页状态模型和默认布局
  - 状态：DONE
  - 这一步做什么：补默认标签页、默认块、坏数据兜底。
  - 做完能看到什么：工作台不是空白页，而是有默认标签页和默认块。
  - 依赖什么：1.1
  - 主要改哪里：`affairs-dashboard-state.ts` 及测试
  - 这一步不做什么：不接快捷应用栏
  - 怎么验证：`pnpm -C apps/user-app exec vitest run src/features/workbench/utils/workbench-mode.test.ts src/features/workbench/utils/affairs-dashboard-state.test.ts`

- [x] 1.3 把快捷应用栏状态纳入工作台模型
  - 状态：DONE
  - 这一步做什么：在工作台状态里补 `shortcutApps`，给左侧固定应用栏留正式存储位置。
  - 做完能看到什么：快捷应用栏不再是临时 UI 占位，而是有可恢复状态。
  - 依赖什么：1.2
  - 主要改哪里：`affairs-dashboard-state.ts`、`workbench-mode.ts`、测试
  - 这一步不做什么：不实现完整文件选择流程
  - 怎么验证：`pnpm -C apps/user-app exec vitest run src/features/workbench/utils/affairs-dashboard-state.test.ts`

---

## 阶段 2：把新骨架真正立起来

- [x] 2.1 按新布局重做事务工作台骨架
  - 状态：DONE
  - 这一步做什么：让左侧导航默认显示；文档视图默认显示对象详情栏；对话和工作台默认隐藏右侧栏；同时在左侧底部加固定快捷应用栏骨架。
  - 做完能看到什么：事务工作台默认就是“左栏 + 左下固定快捷应用栏 + 右侧按分区切换的主舞台”。
  - 依赖什么：1.2
  - 主要改哪里：`WorkbenchLayout.tsx`、`AffairsWorkbenchView.tsx`、`workbench-native.css`
  - 这一步不做什么：不做完整块添加器，不接真实 HTML 选择器
  - 怎么验证：`pnpm -C apps/user-app exec vitest run src/features/workbench/utils/workbench-mode.test.ts src/features/workbench/utils/affairs-dashboard-state.test.ts src/features/workbench/components/AffairsWorkbenchView.test.tsx src/features/conversation/components/WorkbenchLayout.affairs-mode.test.tsx`
  - 备注：之前按旧假设完成过一版顶部标签栏和画布壳，但用户后面重新确认了左右边栏规则，所以本任务必须重开；本轮又补齐了对话/工作台视图右栏默认收起时的展开入口，避免出现“右栏能收起但没有再打开按钮”的死状态。

- [x] 2.2 建立统一块渲染入口和错误隔离
  - 状态：DONE
  - 这一步做什么：让不同块类型都走统一 host，单块报错不炸整页。
  - 做完能看到什么：后续新增块时不用继续堆 `if/else`。
  - 依赖什么：2.1
  - 主要改哪里：`AffairsDashboardView` 周边组件
  - 这一步不做什么：不接 HTML 来源枚举 API
  - 怎么验证：定向组件测试

- [x] 2.3 接入最小块交互闭环
  - 状态：DONE
  - 这一步做什么：支持加块、删块、拖拽、缩放和恢复。
  - 做完能看到什么：工作台第一次真正可摆内容。
  - 依赖什么：2.2
  - 主要改哪里：画布组件、状态持久化、测试
  - 这一步不做什么：不做复杂联动
  - 怎么验证：`AffairsWorkbenchView.test.tsx`
  - 补充收口：工作台布局编辑默认锁定；只有解锁后才显示加块、恢复布局、移除和边框拖拽缩放等编辑工具，缩放方式也从角落按钮改成边框拖拽。

---

## 阶段 3：接具体内容

- [x] 3.1 接代办块和自动化块
  - 状态：DONE
  - 这一步做什么：先把旧代办和自动化能力正式接成块。
  - 做完能看到什么：用户不用再切两个旧入口。
  - 依赖什么：2.3
  - 主要改哪里：工作台块 host、代办/自动化块组件
  - 这一步不做什么：不接 HTML 来源
  - 怎么验证：定向组件测试

- [x] 3.2 接左侧固定快捷应用栏的静态 HTML 入口
  - 状态：DONE
  - 这一步做什么：允许把工作区里的静态 HTML 文件挂到左侧固定应用栏。
  - 做完能看到什么：左下能直接点开常用 HTML 工具。
  - 依赖什么：1.3、2.1
  - 主要改哪里：快捷应用栏组件、工作台状态、相关入口
  - 这一步不做什么：不把它和画布里的 HTML 块混成一套
  - 怎么验证：定向组件测试 + 状态恢复测试
  - 本轮补充：HTML 块和快捷应用都已支持先选来源代码工作区，再选该工作区内的 HTML 文件；预览、iframe bridge 和权限都继承来源工作区，不再强绑当前事务工作区。
  - 继续补正：`当前文档库` 不再伪装成某个代码工作区名，而是直接读取全局文档库 `rootDir`；快捷应用和画布 HTML 块现在也复用同一套树形文件选择器。

- [x] 3.3 接 HTML 统计插件块和 HTML 页面嵌入块
  - 状态：DONE
  - 这一步做什么：把受控 HTML 页面接进画布块。
  - 做完能看到什么：指标和专用页面可以直接钉在工作台里。
  - 依赖什么：2.2、2.3
  - 主要改哪里：块注册表、HTML 块组件、来源校验
  - 这一步不做什么：不开放任意网页嵌入
  - 怎么验证：HTML 来源校验测试 + 组件测试
  - 补充收口：内部状态已经从 `html_app | html_stat | html_embed` 收成统一 `html + variant`，同时移除了旧的小中大 / 前后移布局遗留接口；添加块面板也已经把三个 HTML 一级入口合成一个“HTML 块”，原来的应用 / 统计 / 页面改成创建表单里的用途预设。
  - 继续补正：画布 HTML 块的文件选择器已经和左侧快捷应用统一，都会走同一套树形文件选择器；当前文档库来源也改成直接读取全局配置路径，不再显示错误的工作区名。

---

## 阶段 4：把事务视图配置从代码工作区里拆出来

- [x] 4.1 快捷应用和工作台画布配置改成事务视图全局配置
  - 状态：DONE
  - 这一步做什么：把快捷应用、工作台标签页和画布布局从旧的 `affairsDashboardStatesByWorkspace[workspaceId]` 分桶迁出来，改成用户级事务全局配置。
  - 做完能看到什么：从不同代码工作区进入事务视图时，看到的是同一份快捷应用和画布配置，不会因为代码工作区 ID 变化看起来“丢失”。
  - 依赖什么：已有事务工作台状态模型、Host 用户级事务文档库配置表。
  - 主要改哪里：`user_affairs_library_settings.dashboard_state_json`、`AffairsLibraryService`、`/api/affairs/dashboard-state`、`AffairsWorkbenchView.tsx`、`WorkbenchLayout.tsx`。
  - 这一步不做什么：不删除旧偏好接口；旧 `affairs_dashboard_states_json` 只保留给兼容和迁移用。
  - 怎么验证：
    - `pnpm -C apps/host exec tsc --noEmit --pretty false`
    - `pnpm -C apps/user-app exec tsc --noEmit --pretty false`
    - `pnpm -C apps/host exec vitest run tests/modules/workspace/affairs-library-service.test.ts tests/integration/affairs-library-global-routes.test.ts`
    - `pnpm -C apps/user-app exec vitest run src/features/workbench/components/AffairsWorkbenchView.test.tsx`
  - 补充说明：旧 workspace 级文档库保存接口仍可能被调用，所以也必须保留 `dashboardStateJson`，不能在保存绑定、启用状态或收藏时把全局画布配置洗成 `{}`。

## 当前本轮最小必要验证

- `pnpm -C apps/host exec tsc --noEmit --pretty false`
- `pnpm -C apps/user-app exec tsc --noEmit --pretty false`
- `pnpm -C apps/host exec vitest run tests/modules/workspace/affairs-library-service.test.ts tests/integration/affairs-library-global-routes.test.ts`
- `pnpm -C apps/user-app exec vitest run src/features/workbench/components/AffairsWorkbenchView.test.tsx`
