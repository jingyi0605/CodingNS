# 任务清单 - spec006.2-终端入口与对话工作台布局重构（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单只做一件事：

把“终端入口迁移 + 代码视图终端同屏布局 + 布局状态恢复”拆成真能落地的步骤。

重点不是写多少代码，而是别把这轮事情做歪：

- 不要碰后端终端逻辑
- 不要复制一套快捷应用代码
- 不要把终端面板开关和终端实例生命周期搅成一锅

---

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，等复核
- `DONE`：已经完成，并且已经回写结果
- `CANCELLED`：取消，不做了，但必须写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每做完一个任务，必须立刻回写这里
- 如果任务被卡住，必须写清楚卡点，不准装死

---

## 阶段 0：先把边界钉死，别一上来乱改

- [x] 0.1 建立 spec006.2 并锁定“只改前端入口和布局”的范围
  - 状态：DONE
  - 这一步到底做什么：把这轮终端改造的范围、目标和不做项写成正式 Spec，先防止实现时一路顺手把后端也改了。
  - 做完你能看到什么：`spec006.2` 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 已建立，方向明确。
  - 先依赖什么：用户已确认启动 Spec 流程并指定编号 `006.2`。
  - 开始前先看：
    - `spec006`
    - `spec006.1`
    - `spec016`
    - 本轮用户需求
  - 主要改哪里：
    - `specs/spec006.2-终端入口与对话工作台布局重构/*`
  - 这一步先不做什么：先不改任何业务代码。
  - 怎么算完成：
    1. 主文档都已创建
    2. 已写清“后端不动、前端重排”的边界
  - 怎么验证：
    - 文档自检
    - 与用户原始需求逐条对照
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

---

## 阶段 1：先把快捷应用入口收成一套

- [ ] 1.1 抽出代码视图和事务视图共用的快捷应用渲染层
  - 状态：IN_REVIEW
  - 这一步到底做什么：把事务视图底部快捷应用里真正可复用的渲染和交互抽出来，避免代码视图复制粘贴一份。
  - 做完你能看到什么：代码视图和事务视图能共用同一套快捷应用项展示规则。
  - 先依赖什么：0.1
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.1「系统结构」
    - `design.md` §2.2「模块职责」
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - `apps/user-app/src/features/workbench/utils/affairs-dashboard-state.ts`
    - 代码视图入口挂载点相关文件，但不再新增独立快捷应用实现
  - 这一步先不做什么：先不接终端面板布局。
  - 怎么算完成：
    1. 快捷应用列表渲染不再只绑死在事务视图里
    2. 代码视图可以复用同一套列表项结构
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.1、§2.2、§3.1

- [ ] 1.2 给代码视图补出系统快捷应用入口
  - 状态：IN_REVIEW
  - 这一步到底做什么：在代码视图左侧边栏底部加快捷应用区，并把“终端”“技能”作为固定置顶入口塞进去。
  - 做完你能看到什么：用户进代码视图就能直接看到终端和技能入口，不用再翻菜单。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.3.1「从快捷应用打开终端」
    - `design.md` §3.2.1「SystemShortcutApp」
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/app/styles.css`
  - 这一步先不做什么：先不处理终端同屏布局。
  - 怎么算完成：
    1. 代码视图出现快捷应用区
    2. 终端和技能为固定不可编辑项
    3. 旧菜单入口不再是主入口
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.3.1、§3.2.1

### 阶段检查

- [ ] 1.3 检查入口是不是已经统一
  - 状态：IN_PROGRESS
  - 这一步到底做什么：只检查“终端入口是不是已经从菜单迁到快捷应用”，不顺手扩范围。
  - 做完你能看到什么：入口层收住了，可以继续做终端面板布局。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 1
    - `tasks.md`
  - 主要改哪里：本阶段相关文件
  - 这一步先不做什么：不加新面板功能。
  - 怎么算完成：
    1. 代码视图快捷应用入口可用
    2. 固定快捷应用不可删不可编辑
  - 怎么验证：
    - 人工走查
    - 本轮最小必要前端测试
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.1、§3.1、§3.2

---

## 阶段 2：把终端塞回代码视图中间，不再单独飘着

- [ ] 2.1 新增代码视图终端面板壳层
  - 状态：TODO
  - 这一步到底做什么：在 `WorkbenchLayout` 中间区挂上“对话区 + 终端区”的双面板壳层，让终端能从底部展开出来。
  - 做完你能看到什么：点击终端后，不再跳独立页，而是在当前对话区域内出现终端面板。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.2「模块职责」
    - `design.md` §2.3.1「从快捷应用打开终端」
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - 新增终端面板壳层组件文件
    - `apps/user-app/src/app/styles.css`
  - 这一步先不做什么：先不做比例持久化。
  - 怎么算完成：
    1. 点击终端快捷应用能在代码视图中打开终端面板
    2. 对话区不会被整个替换掉
    3. 手动关闭后能回到正常对话视图
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §2.2、§2.3.1、§4.2

- [ ] 2.2 把终端标签列表改到终端区右侧
  - 状态：TODO
  - 这一步到底做什么：调整终端前端显示结构，把终端标签列表固定到终端区右侧，同时继续复用现有终端数据。
  - 做完你能看到什么：终端切换更像正常 IDE，标签列表不再跑到别的区域。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.2「模块职责」
    - `design.md` §3.3.2「终端数据来源接口」
  - 主要改哪里：
    - `apps/user-app/src/features/terminal/pages/TerminalPage.tsx`
    - `apps/user-app/src/features/workbench/components/TerminalManagerPanel.tsx`
    - `apps/user-app/src/app/styles.css`
  - 这一步先不做什么：先不动后端终端订阅。
  - 怎么算完成：
    1. 终端标签列表在终端区右侧稳定显示
    2. 切换终端标签不影响后台其他终端运行
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/terminal/pages/TerminalPage.tsx`
    - `pnpm test:related -- apps/user-app/src/features/workbench/components/TerminalManagerPanel.tsx`
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §2.2、§3.3

### 阶段检查

- [ ] 2.3 检查终端是不是已经能在代码视图里正常同屏
  - 状态：TODO
  - 这一步到底做什么：确认终端不是“看起来嵌进去了”，而是真的能和对话同屏工作。
  - 做完你能看到什么：终端同屏主链路能跑通，再继续做布局状态。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `tasks.md`
  - 主要改哪里：本阶段相关文件
  - 这一步先不做什么：不扩到移动端。
  - 怎么算完成：
    1. 代码视图里终端和对话可以同屏
    2. 终端标签切换正常
  - 怎么验证：
    - 人工主链路回归
    - 本轮最小必要前端测试
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §2.3、§4.2

---

## 阶段 3：把布局切换、拖拽比例和恢复状态做完整

- [ ] 3.1 新增终端面板布局状态存储
  - 状态：TODO
  - 这一步到底做什么：把终端面板是否打开、方向、比例、手动关闭标记按工作区存起来。
  - 做完你能看到什么：终端面板不再每次回到默认状态。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` §3.3.1「前端本地状态接口」
    - `design.md` §4.1「数据关系」
  - 主要改哪里：
    - 新增终端面板状态工具文件
    - `apps/user-app/src/shared/cache/view-snapshot-cache` 相关调用点
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
  - 这一步先不做什么：先不优化动画细节。
  - 怎么算完成：
    1. 按工作区记住终端面板开关、方向、比例
    2. 坏快照能回退默认值
  - 怎么验证：
    - 新增状态工具测试
    - `pnpm test:related -- <新增状态文件>`
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §3.2.2、§3.3.1、§4.1

- [ ] 3.2 接入上下 / 左右布局切换和拖拽调比例
  - 状态：TODO
  - 这一步到底做什么：给终端面板加方向切换和中间分隔拖拽，让上下、左右两种布局都能用。
  - 做完你能看到什么：用户能像 IDE 一样自己摆终端和对话的比例。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3.2「手动调整布局方向和比例」
    - `design.md` §4.2「状态流转」
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - 新增终端面板壳层组件文件
    - `apps/user-app/src/app/styles.css`
  - 这一步先不做什么：先不处理独立终端页废弃。
  - 怎么算完成：
    1. 默认上下布局
    2. 可切换成左右布局
    3. 两种布局都能拖拽调比例
    4. 比例有最小尺寸保护
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §2.3.2、§3.2.2、§4.2

- [ ] 3.3 接入“切走再回来”的恢复逻辑
  - 状态：TODO
  - 这一步到底做什么：把终端面板恢复逻辑接进代码视图路由和工作区恢复链路，确保不是手动关闭就继续显示。
  - 做完你能看到什么：用户从别的页面回来时，终端面板按上次状态恢复。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.3「切走页面再回来」
    - `design.md` §2.3.4「手动关闭终端面板」
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - 终端面板状态工具文件
  - 这一步先不做什么：不改终端实例生命周期。
  - 怎么算完成：
    1. 普通切页不会把终端面板误判成关闭
    2. 手动关闭后不会自动恢复
    3. 重新打开仍能看到原有终端
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/conversation/components/WorkbenchLayout.tsx`
    - 人工切页回归
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.3、§2.3.4、§5.3

### 最终检查

- [ ] 3.4 最终检查：这轮是不是只改了该改的东西
  - 状态：TODO
  - 这一步到底做什么：确认终端入口、同屏布局、方向切换、比例拖拽、状态恢复都成立，同时没有误伤后端终端逻辑。
  - 做完你能看到什么：这个 Spec 可以进入实现和回归，而不是半吊子。
  - 先依赖什么：3.1、3.2、3.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本 Spec 相关前端文件和文档
  - 这一步先不做什么：不再追加新功能。
  - 怎么算完成：
    1. 需求和设计都能对上实现点
    2. 关键测试和人工回归路径都明确
    3. 已知遗留项写清楚
  - 怎么验证：
    - 按 Spec 验收清单逐项核对
    - 本轮最小必要测试回放
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
