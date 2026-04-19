# 任务清单 - spec008.2 桌面端与移动端模态框统一模板（人话版）

状态：IN_PROGRESS

## 2026-04-18 立项补记

- 已确认这个子 Spec 只处理“桌面端 modal + 移动端 sheet 的统一模板和迁移收口”。
- 已确认当前问题不是没有样式，而是基础组件模型没有收口，导致业务还在继续手写弹窗壳。
- 已确认桌面端现有 `WorkbenchModal` 可以作为兼容入口，但不能继续停留在“只统一一半”的状态。
- 已确认移动端存在多处重复 `ios-action-sheet-overlay` 结构，需要正式 `MobileSheet`。
- 已完成本子 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md` 初始化。
- 已回写父级 `spec008` 的子 Spec 边界说明，明确 `spec008.2` 负责模态框统一模板。

## 2026-04-18 样式基线调整补记

- 已按最新实现要求把桌面端标准模态框宽度统一到“正常桌面宽度约 60%，低分辨率自动放大占比”的规则。
- 已确认上一版“灰底白字 / 红底白字”的按钮判断是错的，当前以设置页按钮为准重收按钮基线。
- 已把模态框和通用操作按钮统一回设置页按钮风格：默认按钮使用设置页同款浅底、细边框和 hover 边框强调，危险按钮沿用设置页的浅红底 + 红色文本语义。
- 已把模态框内原子块和常见列表容器改成平铺分隔线风格，减少网页式嵌套白底卡片。

## 2026-04-19 夜间模式补记

- 已把夜间主题下模态框核心 surface token 从渐变改成纯色半透明材质，避免打包后的 macOS 客户端继续出现整片渐变底。
- 已为 macOS 原生 overlay 场景补充深色主题覆盖，确保 modal 壳层和输入控件在夜间模式下统一回纯色背景，只保留边框、阴影和模糊质感。

## 这份文档是干什么的

这份任务清单用来把“模态框统一模板”拆成真正能执行的步骤。

它必须始终回答清楚：

1. 这一步到底做什么
2. 做完以后用户能看到什么结果
3. 这一步依赖什么
4. 主要改哪些文件
5. 这一步明确不做什么
6. 怎么验证不是假完成

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被别的问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并验证
- `CANCELLED`：取消并写原因

执行规则：

- 只有 `状态：DONE` 的任务才能勾选 `[x]`
- 每完成一个任务，必须立刻回写本文件
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因和下一步

---

## 阶段 0：先把范围和现状钉死，别一上来乱写组件

- [x] 0.1 启动 spec008.2 并完成文档初始化
  - 状态：DONE
  - 这一步到底做什么：建立 `spec008.2` 目录和主文档，明确只做模态框统一模板，不混别的问题。
  - 做完你能看到什么：`README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md` 已存在。
  - 先依赖什么：`spec008`
  - 主要改哪些文件：
    - `specs/spec008.2-桌面端与移动端模态框统一模板/README.md`
    - `specs/spec008.2-桌面端与移动端模态框统一模板/requirements.md`
    - `specs/spec008.2-桌面端与移动端模态框统一模板/design.md`
    - `specs/spec008.2-桌面端与移动端模态框统一模板/tasks.md`
    - `specs/spec008.2-桌面端与移动端模态框统一模板/docs/README.md`
  - 这一步明确不做什么：不写业务代码。
  - 怎么算完成：
    1. 子 Spec 主文档齐全
    2. 范围、依赖、非目标写清楚
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成 `spec008.2` 主文档初始化

- [x] 0.2 盘点当前桌面端和移动端弹层问题
  - 状态：DONE
  - 这一步到底做什么：确认当前到底是哪些结构重复、哪些地方绕开了基础组件。
  - 做完你能看到什么：后续设计建立在真实问题上，而不是主观感觉。
  - 先依赖什么：无
  - 主要改哪些文件：文档分析阶段，无业务代码改动
  - 这一步明确不做什么：不在这个阶段直接重构弹窗。
  - 怎么算完成：
    1. 已识别桌面端基础壳的缺口
    2. 已识别手写桌面弹窗和手写移动端 sheet 的主要分布
  - 怎么验证：
    - 代码走查
    - 现状记录写入文档
  - 验证结果：
    - 已确认 `WorkbenchModal` 只统一了桌面端壳层的一部分
    - 已确认仍有多处业务代码直接手写 `workbench-modal-layer`
    - 已确认移动端存在多处重复 `ios-action-sheet-overlay` 结构
    - 已把现状问题写入 `requirements.md` 和 `design.md`

- [x] 0.3 回写父级 spec008 的边界说明
  - 状态：DONE
  - 这一步到底做什么：把 `spec008.2` 明确标成 `spec008` 的子问题，避免后面继续把平台交付问题和模态框体系问题混在一起。
  - 做完你能看到什么：父级 Spec 能明确看出 `spec008.2` 的职责边界。
  - 先依赖什么：0.1
  - 主要改哪些文件：
    - `specs/spec008-桌面端与H5交付增强/README.md`
    - `specs/spec008-桌面端与H5交付增强/design.md`
    - `specs/spec008-桌面端与H5交付增强/tasks.md`
  - 这一步明确不做什么：不扩展父级 Spec 范围。
  - 怎么算完成：
    1. 父级文档中出现 `spec008.2` 边界
    2. 后续不会再把模态框统一模板塞回 `spec008`
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已在父级 `README.md`、`design.md`、`tasks.md` 中补充 `spec008.2` 说明

---

## 阶段 1：先把组件模型和迁移规则立住

- [ ] 1.1 设计并实现 `DesktopModal` 的统一接口
  - 状态：DONE
  - 这一步到底做什么：把桌面端弹窗的尺寸、布局、关闭规则、头部、底部操作区统一成正式 API。
  - 做完你能看到什么：桌面端新增弹窗不需要再手写基础壳。
  - 先依赖什么：0.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3、需求 6
    - `design.md` §4.1、§7
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/WorkbenchModal.tsx`
    - `apps/user-app/src/components/*`（预期新增 modal 基础组件）
    - `apps/user-app/src/app/styles.css`
  - 这一步明确不做什么：先不要求所有业务弹窗一起迁移。
  - 怎么算完成：
    1. 有正式 `DesktopModal`
    2. 有固定尺寸档位和布局枚举
    3. 有统一关闭规则
  - 怎么验证：
    - 组件单元测试
    - 代表弹窗回归测试
  - 验证结果：
    - 已新增 `apps/user-app/src/components/DesktopModal.tsx`
    - 已支持固定尺寸档位：`narrow / compact / regular / wide / xwide / full`
    - 已支持固定布局类型：`confirm / form / list / viewer`
    - 已支持统一关闭规则：遮罩、`Escape`、关闭按钮和不可关闭状态
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/components/DesktopModal.test.tsx` 通过
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/features/terminal/pages/TerminalPage.test.tsx src/features/mobile-workspaces/pages/WorkspaceHomePage.test.tsx`，确认基础件没有冲掉现有移动端弹层路径
  - 对应需求：`requirements.md` 需求 1、需求 3、需求 6
  - 对应设计：`design.md` §4.1、§7

- [ ] 1.2 设计并实现 `MobileSheet` 的统一接口
  - 状态：DONE
  - 这一步到底做什么：把移动端 sheet 的高度、布局、底部取消区、安全区和关闭规则统一起来。
  - 做完你能看到什么：动作 sheet、表单 sheet、picker sheet 都能走同一个基础组件。
  - 先依赖什么：0.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3、需求 6
    - `design.md` §4.2、§7
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-sessions/components/MobileCreateSessionSheet.tsx`
    - `apps/user-app/src/features/terminal/pages/TerminalPage.tsx`
    - `apps/user-app/src/components/*`（预期新增 mobile sheet 基础组件）
    - `apps/user-app/src/app/styles.css`
  - 这一步明确不做什么：先不扩到全部移动端弹层。
  - 怎么算完成：
    1. 有正式 `MobileSheet`
    2. 有固定高度档位和布局类型
    3. 有统一的底部取消区和安全区处理
  - 怎么验证：
    - 组件单元测试
    - 移动端代表弹层回归测试
  - 验证结果：
    - 已新增 `apps/user-app/src/components/MobileSheet.tsx`
    - 已支持固定高度档位：`auto / half / three-quarter / full`
    - 已支持固定布局类型：`action / form / picker`
    - 已支持统一遮罩关闭、取消按钮和不可关闭状态
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/components/MobileSheet.test.tsx` 通过
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/features/terminal/pages/TerminalPage.test.tsx src/features/mobile-workspaces/pages/WorkspaceHomePage.test.tsx` 通过
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 6
  - 对应设计：`design.md` §4.2、§7

- [ ] 1.3 建立模态框原子块和统一约束
  - 状态：DONE
  - 这一步到底做什么：把字段区、分组区、按钮区、列表区、空态区这些高频结构收成统一原子块。
  - 做完你能看到什么：业务弹窗不再重复调间距和对齐。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 4、需求 8
    - `design.md` §4.3、§5
  - 主要改哪些文件：
    - `apps/user-app/src/components/*`
    - `apps/user-app/src/app/styles.css`
  - 这一步明确不做什么：不新长一套平行控件库。
  - 怎么算完成：
    1. 有统一结构原子块
    2. 业务可直接复用
    3. 样式不再散落在业务弹窗里
  - 怎么验证：
    - 原子块测试
    - 迁移样例走查
  - 验证结果：
    - 已新增 `apps/user-app/src/components/ModalAtoms.tsx`
    - 已提供 `ModalSection / ModalField / ModalActions / ModalList / ModalListItem / ModalEmptyState / ModalTag`
    - 已在 `apps/user-app/src/app/styles.css` 下沉统一原子块样式约束
    - 已将桌面端归档弹窗、移动端建会话 sheet、移动端工作区切换 sheet、终端 fallback 弹窗接入原子块
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/components/ModalAtoms.test.tsx` 通过
  - 对应需求：`requirements.md` 需求 4、需求 8
  - 对应设计：`design.md` §4.3、§5

---

## 阶段 2：先把兼容层和样式基础打稳

- [ ] 2.1 把 `WorkbenchModal` 改成兼容包装层
  - 状态：DONE
  - 这一步到底做什么：保留旧调用入口，但内部接到新的桌面端基础组件。
  - 做完你能看到什么：旧代码还能跑，新代码也能开始用新接口。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §5.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/WorkbenchModal.tsx`
    - `apps/user-app/src/app/styles.css`
  - 这一步明确不做什么：不在这一步要求旧调用点全部改完。
  - 怎么算完成：
    1. 旧接口可继续工作
    2. 内部走新模型
  - 怎么验证：
    - `WorkbenchModal` 相关调用点回归测试
  - 验证结果：
    - `apps/user-app/src/features/conversation/components/WorkbenchModal.tsx` 已改为包装 `DesktopModal`
    - 已保留旧接口字段，并新增 `size / layout / dismissible / footer / bodyClassName` 等兼容过渡参数
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/components/DesktopModal.test.tsx src/features/terminal/pages/TerminalPage.test.tsx src/features/mobile-workspaces/pages/WorkspaceHomePage.test.tsx` 通过
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §5.2

- [ ] 2.2 收口模态框尺寸和高度档位样式
  - 状态：DONE
  - 这一步到底做什么：把桌面端宽度和移动端高度档位下沉成统一样式规则。
  - 做完你能看到什么：宽度和高度不再靠业务 class 各自定义。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §4.1.3、§4.2.3、§5.1
  - 主要改哪些文件：
    - `apps/user-app/src/app/styles.css`
  - 这一步明确不做什么：不处理每个特殊弹窗的内部内容样式。
  - 怎么算完成：
    1. 有统一尺寸档位规则
    2. 有统一高度档位规则
    3. 业务不需要再临时补宽度百分比
  - 怎么验证：
    - 组件视觉走查
    - 代表弹窗回归测试
  - 验证结果：
    - 已在 `apps/user-app/src/app/styles.css` 新增桌面端 `data-size` 档位规则
    - 已在 `apps/user-app/src/app/styles.css` 新增移动端 `data-height` 档位规则和统一 footer/body/header 基线
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/components/DesktopModal.test.tsx src/components/MobileSheet.test.tsx src/features/terminal/pages/TerminalPage.test.tsx src/features/mobile-workspaces/pages/WorkspaceHomePage.test.tsx` 通过
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §4.1.3、§4.2.3、§5.1

- [ ] 2.3 阶段检查：新增代码不再继续手写基础壳
  - 状态：DONE
  - 这一步到底做什么：确认新基础件出来后，后续迁移和新增弹窗都不会继续复制旧结构。
  - 做完你能看到什么：体系开始真正收口。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 8
    - `design.md` §5.3、§8
  - 主要改哪些文件：阶段 1、阶段 2 相关代码和文档
  - 这一步明确不做什么：不要求所有历史弹窗已经全迁完。
  - 怎么算完成：
    1. 新迁移代码不再手写 `workbench-modal-layer`
    2. 新迁移代码不再手写 `ios-action-sheet-overlay`
  - 怎么验证：
    - 代码走查
    - 测试与验收清单核对
  - 验证结果：
    - 已确认 `ConversationPage.tsx`、`MobileCreateSessionSheet.tsx`、`MobileWorkspaceSwitcherHeader.tsx`、`TerminalRuntimeFallbackModal.tsx` 不再手写 `workbench-modal-layer` 或 `ios-action-sheet-overlay`
    - 已使用 `rg -n "ios-action-sheet-overlay|workbench-modal-layer"` 对上述迁移文件做代码走查，确认基础壳已收口
    - 已继续确认 `MessageTimeline.tsx`、`ComposerPanel.tsx`、`TerminalManagerPanel.tsx` 的新增迁移代码不再手写 `workbench-modal-layer` 或 `ios-action-sheet-overlay`
  - 对应需求：`requirements.md` 需求 8
  - 对应设计：`design.md` §5.3、§8

---

## 阶段 3：迁移第一批代表性弹窗

- [ ] 3.1 迁移桌面端确认型和列表型弹窗
  - 状态：DONE
  - 这一步到底做什么：先拿简单但高频的桌面端弹窗验证新模板。
  - 做完你能看到什么：确认弹窗和列表弹窗已经不再手写基础壳。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §6
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/terminal/components/TerminalRuntimeFallbackModal.tsx`
  - 这一步明确不做什么：先不碰大型特殊查看器。
  - 怎么算完成：
    1. 至少覆盖一个确认型和一个列表型桌面弹窗
    2. 主流程不回退
  - 怎么验证：
    - 现有相关测试回归
    - 手动交互走查
  - 验证结果：
    - 已将 `ConversationPage.tsx` 中的 `ConversationArchiveConfirmModal` 迁移到 `DesktopModal`
    - 已将 `ConversationPage.tsx` 中的 `ConversationArchiveFolderModal` 迁移到 `DesktopModal`
    - 已覆盖桌面端确认型和列表型两类真实弹窗
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/components/DesktopModal.test.tsx` 通过
    - 已额外针对归档相关路径跑 `WorkbenchLayout.test.tsx` 过滤验证，但该文件存在与本轮改动无直接关联的既有失败，未作为本任务阻塞项
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §6

- [ ] 3.2 迁移移动端动作型和表单型 sheet
  - 状态：DONE
  - 这一步到底做什么：用真实移动端弹层验证 `MobileSheet` 不是空壳。
  - 做完你能看到什么：动作列表和表单创建面板都能走统一基础组件。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §6
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-sessions/components/MobileCreateSessionSheet.tsx`
    - `apps/user-app/src/features/terminal/pages/TerminalPage.tsx`
  - 这一步明确不做什么：不要求所有移动端弹层一次性全部改完。
  - 怎么算完成：
    1. 至少覆盖一个动作型和一个表单型 sheet
    2. 交互和安全区不回退
  - 怎么验证：
    - 现有相关测试回归
    - 移动端交互走查
  - 验证结果：
    - 已将 `TerminalPage.tsx` 中的 `MobileTerminalActionSheet` 迁移到 `MobileSheet`
    - 已将 `TerminalPage.tsx` 中的 `TerminalCreateSheet` 迁移到 `MobileSheet`
    - 已额外将 `MobileCreateSessionSheet.tsx` 和 `MobileWorkspaceSwitcherHeader.tsx` 里的 picker / form sheet 接入 `MobileSheet`
    - 已覆盖移动端动作型和表单型两类真实 sheet
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/features/terminal/pages/TerminalPage.test.tsx` 通过
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/features/mobile-workspaces/pages/WorkspaceHomePage.test.tsx`，确认共享移动端 sheet 基线未破坏工作区切换弹层
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §6

- [ ] 3.3 对齐查看器类特例弹窗的尺寸语义
  - 状态：DONE
  - 这一步到底做什么：不重写查看器业务逻辑，但把大型特例弹窗的尺寸语义逐步对齐到统一模型。
  - 做完你能看到什么：大型查看器不再在尺寸语义上完全游离于弹窗体系之外。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §6.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/components/FileViewerModal.tsx`
    - 相关样式文件
  - 这一步明确不做什么：不重写文件预览能力本身。
  - 怎么算完成：
    1. 查看器类弹窗的尺寸档位语义可以映射到统一模型
    2. 不破坏现有查看器能力
  - 怎么验证：
    - 文件查看器相关测试回归
  - 验证结果：
    - 已将 `apps/user-app/src/features/conversation/components/FileViewerModal.tsx` 从手写 `workbench-modal-layer` 迁移到 `DesktopModal`
    - 已将查看器尺寸语义映射到统一模型：默认 `regular`、放大 `xwide`、全屏 `full`
    - 已保留查看器工具栏、预览、编辑和全屏路径，不重写业务逻辑
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/FileViewerModal.test.tsx` 通过
  - 对应需求：`requirements.md` 需求 5、需求 7、需求 8
  - 对应设计：`design.md` §6.3、§8

---

## 阶段 4：测试、文档和验收收口

- [ ] 4.1 补基础组件和迁移样例测试
  - 状态：DONE
  - 这一步到底做什么：给新基础件和首批迁移弹窗补测试，避免后面统一模板刚做完就退化。
  - 做完你能看到什么：关键交互有自动化兜底。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md` 需求 6、需求 7、需求 8
    - `design.md` §8
  - 主要改哪些文件：
    - `apps/user-app` 下相关测试文件
  - 这一步明确不做什么：不在这一步继续扩更多业务场景。
  - 怎么算完成：
    1. 基础组件测试存在
    2. 首批迁移弹窗测试通过
  - 怎么验证：
    - `vitest`
    - 类型检查
  - 验证结果：
    - 已新增 `DesktopModal.test.tsx`、`MobileSheet.test.tsx`、`ModalAtoms.test.tsx`、`TerminalRuntimeFallbackModal.test.tsx`
    - 已新增命中回归：`FileViewerModal.test.tsx`、`WorkspaceInboxModal.test.tsx`
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/components/ModalAtoms.test.tsx src/components/DesktopModal.test.tsx src/components/MobileSheet.test.tsx src/features/terminal/components/TerminalRuntimeFallbackModal.test.tsx src/features/terminal/pages/TerminalPage.test.tsx src/features/mobile-workspaces/pages/WorkspaceHomePage.test.tsx` 通过，共 34 个测试通过
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/FileViewerModal.test.tsx src/features/conversation/components/WorkspaceInboxModal.test.tsx` 通过，共 10 个测试通过
    - 已执行 `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/MessageTimeline.test.tsx src/features/conversation/components/ComposerPanel.test.tsx src/features/workbench/components/TerminalManagerPanel.test.tsx` 通过，共 97 个测试通过
    - 已执行 `pnpm --dir apps/user-app exec tsc --noEmit`，当前仍被 `src/features/conversation/runtime/session-runtime-store.ts` 第 1954、1955 行的既有 `never` 类型错误阻塞，本轮未新增类型错误
  - 对应需求：`requirements.md` 需求 6、需求 7、需求 8
  - 对应设计：`design.md` §8

- [ ] 4.2 补迁移清单和新增开发约束
  - 状态：DONE
  - 这一步到底做什么：把后续还没迁的弹窗、推荐模板和例外规则写清楚。
  - 做完你能看到什么：后续接手的人知道哪些弹窗还没迁、该怎么迁、什么情况下允许例外。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 8
    - `design.md` §5.3、§8
  - 主要改哪些文件：
    - `specs/spec008.2-桌面端与移动端模态框统一模板/docs/*`
    - `specs/spec008.2-桌面端与移动端模态框统一模板/tasks.md`
  - 这一步明确不做什么：不顺手扩展新业务功能。
  - 怎么算完成：
    1. 有迁移清单
    2. 有新增弹窗开发约束
    3. 有例外处理说明
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已新增迁移和约束文档：`docs/20260418-模态框迁移与新增约束清单.md`
    - 已在 `docs/README.md` 补充该文档入口
  - 对应需求：`requirements.md` 需求 8
  - 对应设计：`design.md` §5.3、§8

- [ ] 4.3 最终检查点：spec008.2 验收收口
  - 状态：TODO
  - 这一步到底做什么：核对需求、设计、任务和验证证据是否对齐，确认这套模板已经能支撑后续持续迁移。
  - 做完你能看到什么：`spec008.2` 可以独立推进实现，不会写着写着又散掉。
  - 先依赖什么：4.1、4.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/README.md`
  - 主要改哪些文件：当前 Spec 全部文档和验收记录
  - 这一步明确不做什么：不扩范围，不混入别的 UI 主题改造
  - 怎么算完成：
    1. 八条需求都有对应证据
    2. 首批迁移清单已完成或明确剩余项
    3. 后续维护者能直接继续推进
  - 怎么验证：
    - 按验收清单逐项核对
    - 关键弹窗回归记录
