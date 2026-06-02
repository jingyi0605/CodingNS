# 任务清单 - spec017-事务视图对话入口与轻量会话分流（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单只负责把三件事拆开：

- 在事务模式左侧补正式“对话”入口
- 在事务模式中间主区补正式对话页
- 把轻量会话和 Agent 会话分流清楚
- 把“会话模式”和“provider 选择”拆成两条轴

不做的事也要提前写死：

- 不往代码模式新建会话入口里塞新 provider
- 不把轻量会话做成“假轻量、真重链路”
- 不借机重画整套聊天页
- 不把“轻量 Codex / 轻量 Claude Code”伪装成代码模式新 provider

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，待复核
- `DONE`：已经完成，并且已回写状态
- `CANCELLED`：取消，不做了，但必须写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻回写本文件
- `BLOCKED` 和 `CANCELLED` 必须写清原因

---

## 阶段 0：先把范围和边界锁死

- [x] 0.1 建立 `spec017` 文档骨架并锁定“只在事务模式做”
  - 状态：DONE
  - 这一步到底做什么：把 README、需求、设计、任务文档先立起来，并明确轻量会话只在事务模式里做，不进入代码模式 provider 入口。
  - 做完你能看到什么：这次工作范围不会再漂移成“顺手给代码模式多加个 provider”。
  - 先依赖什么：`spec016`、`spec016.1`
  - 开始前先看：
    - `spec016/README.md`
    - `spec016/design.md`
    - `spec016.1/design.md`
  - 主要改哪里：
    - `specs/spec017-事务视图对话入口与轻量会话分流/*`
  - 这一步先不做什么：不改前端代码，不改 Host 路由。
  - 怎么算完成：
    1. `spec017` 四份主文档齐全
    2. 已明确轻量会话不进入代码模式 provider 入口
    3. 已明确 Agent 会话复用现有助手逻辑
  - 怎么验证：
    - 已完成 README / requirements / design / tasks 文档走查
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

- [x] 0.2 盘清事务模式现有助手面板和中间主区切换点
  - 状态：DONE
  - 这一步到底做什么：把当前 `AffairsWorkbenchView` 里左侧导航、中间对象区、右侧助手面板的切换逻辑盘清楚，明确“对话入口”该插在哪里。
  - 做完你能看到什么：知道事务模式现在哪些点可以复用，哪些点必须新加。
  - 先依赖什么：0.1
  - 开始前先看：
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - `apps/user-app/src/features/workbench/types/workbench-mode.ts`
    - `apps/user-app/src/features/workbench/utils/workbench-mode.ts`
  - 主要改哪里：
    - 盘点文档
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - `apps/user-app/src/features/workbench/types/workbench-mode.ts`
    - `apps/user-app/src/features/workbench/utils/workbench-mode.ts`
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
  - 这一步先不做什么：不开始写新对话页。
  - 怎么算完成：
    1. 已明确左侧导航新增入口的位置
    2. 已明确中间主区切到对话页的状态切换点
    3. 已明确右侧助手面板当前状态源
  - 怎么验证：
    - 已完成代码走查，确认：
      1. `AffairsPrimarySection` 现状只有 `library | todo | automation`
      2. `AffairsWorkbenchView` 已有左中右骨架，适合新增 `conversation` 主区
      3. 右侧助手已复用 `ButlerRuntimeStore`、`MessageTimeline`、`ComposerPanel`、`PermissionRequestList`
  - 对应需求：`requirements.md` 需求 1、需求 5、需求 8
  - 对应设计：`design.md` §2.1、§2.2、§2.3

---

## 阶段 1：先把事务模式里的“对话入口 + 对话页壳”立起来

- [x] 1.1 在事务左侧导航新增“对话”入口
  - 状态：DONE
  - 这一步到底做什么：在左侧事务导航里把“对话”作为正式分区插到文档库下方，并接通分区切换状态。
  - 做完你能看到什么：事务模式左侧会正式出现“对话”，用户不用回代码模式找聊天页。
  - 先依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.1、§3.2
    - `AffairsWorkbenchView.tsx`
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - `apps/user-app/src/features/workbench/types/workbench-mode.ts`
    - `apps/user-app/src/features/workbench/utils/workbench-mode.ts`
    - `apps/user-app/src/shared/i18n/index.ts`
  - 这一步先不做什么：不接轻量会话和 Agent 会话真实运行时。
  - 怎么算完成：
    1. 左侧有正式“对话”入口
    2. 文档库下方位置固定
    3. 分区状态能保存和恢复
  - 怎么验证：
    - 已完成 `pnpm -C apps/user-app exec vitest run src/features/workbench/components/AffairsWorkbenchView.test.tsx`
    - 已补事务左侧“对话”入口切换测试，确认点击后能切到 `conversation` 分区
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.1、§3.2、§4.2

- [x] 1.2 建立事务对话页壳层，并复用代码模式聊天页样式
  - 状态：DONE
  - 这一步到底做什么：给事务模式中间主区补一层正式对话页壳，整体样式跟 `ConversationPage` 保持一致，但先不把底层运行时全部接满。
  - 做完你能看到什么：点击“对话”后，中间主区进入正式聊天页样式，而不是只弹右侧助手面板。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.1、§3.1
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
  - 主要改哪里：
    - 新增事务对话页组件
    - `AffairsWorkbenchView.tsx`
    - 公共聊天页样式复用点
  - 这一步先不做什么：不重写现有 `ConversationPage` 通用组件。
  - 怎么算完成：
    1. 事务对话页视觉风格与代码模式聊天页一致
    2. 能在事务对象页和事务对话页之间切换
  - 怎么验证：
    - 已完成 `pnpm -C apps/user-app exec vitest run src/features/workbench/components/AffairsWorkbenchView.test.tsx`
    - 测试已确认事务主区切到 `conversation-page-shell affairs-conversation-page-shell`，而且不影响原有事务工作台其它分区
  - 对应需求：`requirements.md` 需求 2、需求 9
  - 对应设计：`design.md` §2.1、§2.3.1、§3.1

- [x] 1.2.1 在事务对话页壳层里预留“会话模式 + provider 选择”入口
  - 状态：DONE
  - 这一步到底做什么：在事务对话页第一版壳层里把“简约 + 号新建入口 + 统一创建弹窗”立起来，让页面结构能容纳“轻量 / 助手模式”和 provider 分组这两条轴。
  - 做完你能看到什么：事务对话页不是一进来就只有一个泛化聊天框，而是已经有明确的创建入口结构。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 4.1、需求 7.1、需求 9
    - `design.md` §2.3、§3.1、§3.2
  - 主要改哪里：
    - 新增事务对话空态和创建入口组件
    - `AffairsWorkbenchView.tsx`
    - 事务对话页壳层组件
  - 这一步先不做什么：不接真实 provider 运行时。
  - 怎么算完成：
    1. 页面不再平铺 4 张组合卡片
    2. 事务对话页和左侧栏都有统一的新建对话入口
    3. 新建入口点开后，弹窗里会按“轻量模式 / 助手模式”分组显示 provider
  - 怎么验证：
    - 已完成 `pnpm -C apps/user-app exec vitest run src/features/workbench/components/AffairsWorkbenchView.test.tsx`
    - 测试已确认事务对话页显示“新建对话”按钮，点击后会弹出统一 modal，并分别看到轻量模式分组和助手模式分组
  - 对应需求：`requirements.md` 需求 4.1、需求 7.1、需求 9
  - 对应设计：`design.md` §2.3、§3.1、§3.2

### 阶段检查

- [x] 1.3 事务对话入口阶段检查
  - 状态：DONE
  - 这一步到底做什么：只检查事务模式里“对话入口 + 对话页壳”是不是已经站住，不扩底层运行时。
  - 做完你能看到什么：用户至少已经知道去哪里开事务对话，不再只有右侧小面板。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不补 provider 实现细节。
  - 怎么算完成：
    1. 左侧对话入口稳定
    2. 中间对话页壳稳定
    3. 新建入口已经从平铺卡片收口成 `+` 按钮 + 统一创建弹窗
    4. 不影响文档库/待办/自动化主区切换
  - 怎么验证：
    - 定向前端测试已通过：`pnpm -C apps/user-app exec vitest run src/features/workbench/components/AffairsWorkbenchView.test.tsx`（58 tests passed）
    - 测试已确认事务对话页不再直接展示 4 张组合卡片，而是改成新建按钮和分组 modal
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 9
  - 对应设计：`design.md` §2.3.1、§4.2

---

## 阶段 2：把轻量会话、Agent 会话和 provider 选择分流清楚

- [ ] 2.1 增加事务会话类型模型和默认进入规则
  - 状态：TODO
  - 这一步到底做什么：给事务会话补正式 `kind=lightweight | agent` 类型字段，并定义第一次进入事务对话页时的默认建议规则。
  - 做完你能看到什么：事务对话不再是一坨“聊天”，而是明确知道当前是哪种模式。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 3、需求 7、需求 9
    - `design.md` §3.2、§4.1
  - 主要改哪里：
    - 事务对话状态模型
    - 事务对话空态和入口选择器
    - 如需新增 Host DTO，则补 DTO 定义
  - 这一步先不做什么：不直接实现轻量 provider 底层。
  - 怎么算完成：
    1. 事务会话类型有正式字段
    2. 第一次进入有清楚的类型选择或默认建议
    3. 会话头部能看出当前类型
  - 怎么验证：
    - 类型与空态测试
  - 对应需求：`requirements.md` 需求 3、需求 7、需求 9
  - 对应设计：`design.md` §3.2、§4.1、§4.2

- [ ] 2.1.1 增加事务对话 provider 字段，并和会话模式分开存
  - 状态：TODO
  - 这一步到底做什么：给事务对话补正式 `provider=codex | claude-code` 字段，并明确它和 `kind` 不是同一回事。
  - 做完你能看到什么：事务对话元数据里能清楚区分“这条会话是轻还是重”和“这条会话底层接谁”。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 4.1、需求 7.1
    - `design.md` §3.2、§4.1、§6.1.1
  - 主要改哪里：
    - 事务对话 DTO / 状态模型
    - provider 选择器状态
    - 如需新增 Host DTO，则补 DTO 定义
  - 这一步先不做什么：不把轻量 provider 注册到代码模式 provider catalog。
  - 怎么算完成：
    1. DTO 里 `kind` 和 `provider` 独立存在
    2. UI 展示能同时看出模式和 provider
    3. 不出现 `lightweight-codex` 这种混合假 provider id
  - 怎么验证：
    - DTO/类型测试
    - 前端状态测试
  - 对应需求：`requirements.md` 需求 4.1、需求 7.1
  - 对应设计：`design.md` §3.2、§4.1、§6.1.1

- [ ] 2.2 把轻量会话限制在事务模式内部
  - 状态：TODO
  - 这一步到底做什么：把轻量会话的可见范围锁死在事务模式，避免它出现在代码模式的 provider picker、新建会话和并行会话入口里。
  - 做完你能看到什么：代码模式看不到这个轻量入口，事务模式里才看得到。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.1、§3.3、§6.1
    - 代码模式 provider 入口相关组件
  - 主要改哪里：
    - `apps/user-app` provider 入口过滤逻辑
    - 必要时 `apps/host` 对事务会话单独建接口
  - 这一步先不做什么：不改代码模式已有 provider 排序和展示逻辑。
  - 怎么算完成：
    1. 代码模式新建会话入口看不到轻量会话
    2. 事务模式能正常创建和展示轻量会话
  - 怎么验证：
    - 回归代码模式 provider picker 测试
    - 事务模式入口测试
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §3.3、§6.1

- [ ] 2.2.1 接通事务模式下的 `Codex / Claude Code` 选择可见性
  - 状态：TODO
  - 这一步到底做什么：让事务模式复用正式 provider 可见性规则，只展示当前真可用的 `Codex` / `Claude Code`，但不把轻量模式注册成新 provider。
  - 做完你能看到什么：事务模式里能选 `Codex` / `Claude Code`，代码模式里不会多出“轻量 Codex / 轻量 Claude Code”。
  - 先依赖什么：2.1.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 7.1
    - `design.md` §3.3、§5.3、§6.1.1
    - provider catalog / 可见性相关代码
  - 主要改哪里：
    - `apps/user-app` 事务对话 provider 选择入口
    - 如有必要复用现有 provider catalog 查询
  - 这一步先不做什么：不改代码模式 provider 排序和文案。
  - 怎么算完成：
    1. 事务模式只展示当前可用的 `Codex` / `Claude Code`
    2. 轻量和 Agent 两种模式下都能选
    3. 代码模式入口无新增假 provider
  - 怎么验证：
    - provider 可见性回归测试
    - 事务模式创建入口测试
  - 对应需求：`requirements.md` 需求 7.1
  - 对应设计：`design.md` §3.3、§5.3、§6.1.1

### 阶段检查

- [ ] 2.3 会话分流阶段检查
  - 状态：TODO
  - 这一步到底做什么：检查事务会话类型和代码模式入口边界是不是已经收紧。
  - 做完你能看到什么：轻量会话和 Agent 会话不会再互相冒充，代码模式也没被污染。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关文件
  - 这一步先不做什么：不继续补 Agent 状态复用。
  - 怎么算完成：
    1. 类型分流清楚
    2. 代码模式入口无回归
  - 怎么验证：
    - 人工走查
    - 定向测试
  - 对应需求：`requirements.md` 需求 3、需求 4、需求 7
  - 对应设计：`design.md` §4.1、§6.1

---

## 阶段 3：让 Agent 会话正式复用当前助手链路

- [ ] 3.1 把 Agent 会话接到当前事务助手会话状态源
  - 状态：TODO
  - 这一步到底做什么：把事务对话页里的 Agent 会话接到现在 `AffairsAssistantPanel` 已经在用的助手会话状态源上，避免长两套消息流。
  - 做完你能看到什么：中间 Agent 对话页和右侧助手面板指向同一条会话，消息和运行态一致。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 5、需求 8
    - `design.md` §2.3.3、§2.3.4、§6.2
    - `AffairsWorkbenchView.tsx` 里的 `ButlerRuntimeStore` 使用方式
  - 主要改哪里：
    - 事务对话页 Agent 适配层
    - `AffairsWorkbenchView.tsx`
    - 必要时 Butler runtime 适配层
  - 这一步先不做什么：不重写 Butler 底层运行时。
  - 怎么算完成：
    1. Agent 对话页和右侧助手面板会话同源
    2. 权限请求、运行态和消息不再各走各的
  - 怎么验证：
    - Agent 会话集成测试
    - 人工发消息和切页回放
  - 对应需求：`requirements.md` 需求 5、需求 8
  - 对应设计：`design.md` §2.3.3、§2.3.4、§6.2

- [ ] 3.1.1 让 Agent 模式下的 Codex / Claude Code 继续复用完整助手链路
  - 状态：TODO
  - 这一步到底做什么：确认事务 Agent 会话里选 `Codex` 或 `Claude Code` 时，继续复用现在完整助手能力，包括 AGENTS.md 注入、完整工具能力和权限流。
  - 做完你能看到什么：事务 Agent 会话只是换了入口，不是换了弱化版运行时。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.3、§4.1、§6.2
  - 主要改哪里：
    - Agent 会话创建 / 恢复适配层
    - Butler runtime 适配参数
  - 这一步先不做什么：不让轻量模式共享这条重链路。
  - 怎么算完成：
    1. Agent + Codex 走完整助手链路
    2. Agent + Claude Code 走完整助手链路
    3. 轻量模式不会误进这条链路
  - 怎么验证：
    - Agent 双 provider 集成测试
    - 人工回放验证
  - 对应需求：`requirements.md` 需求 5、需求 7、需求 7.1
  - 对应设计：`design.md` §2.3.3、§4.1、§6.2

- [ ] 3.2 把 Agent 会话默认绑定到当前文档库和当前对象
  - 状态：TODO
  - 这一步到底做什么：创建或恢复 Agent 会话时，默认带入当前工作区文档库绑定和当前事务对象上下文，不再出现代码模式多工作区语义。
  - 做完你能看到什么：事务模式里的 Agent 会话一开口就在当前对象语境里。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §3.2、§4.1、§6.3
    - `spec016.1` 当前对象上下文字段
  - 主要改哪里：
    - Agent 会话初始化上下文构建逻辑
    - 事务对象 -> 助手上下文映射逻辑
    - 必要时 Host 启动入参
  - 这一步先不做什么：不扩多工作区切换 UI。
  - 怎么算完成：
    1. Agent 会话默认绑定当前文档库
    2. 选中文档/标签/文件夹时能带入对象上下文
    3. 没选对象时也能保留事务语境
  - 怎么验证：
    - 上下文初始化测试
    - 人工走文档 -> Agent 对话链路
  - 对应需求：`requirements.md` 需求 6
  - 对应设计：`design.md` §3.2、§4.1、§6.3

### 最终检查

- [ ] 3.3 最终检查点
  - 状态：TODO
  - 这一步到底做什么：确认事务模式对话入口、轻量会话分流、Agent 会话复用三块已经能连成一条完整主链路。
  - 做完你能看到什么：事务模式里既有正式对话主舞台，又没污染代码模式会话体系。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件
  - 这一步先不做什么：不再追加新需求。
  - 怎么算完成：
    1. 事务左侧“对话”入口稳定可用
    2. 中间正式对话页稳定可用
    3. 轻量会话不进入代码模式 provider 入口
    4. Agent 会话复用当前助手逻辑并绑定当前文档库/对象
  - 怎么验证：
    - 前端定向测试
    - Host/助手链路定向测试
    - 人工验收走查
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
