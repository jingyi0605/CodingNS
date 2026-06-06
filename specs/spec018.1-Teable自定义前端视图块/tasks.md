# 任务清单 - spec018.1-Teable自定义前端视图块（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单只服务一个目标：

**把 Teable 表数据用 CodingNS 自己的前端显示到事务工作台画布里，不再嵌入 Teable 分享页。**

每个任务都要回答：

- 这一步到底做什么
- 做完以后能看到什么
- 依赖什么
- 主要改哪些文件
- 明确不做什么
- 怎么验证

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `DONE`：已经完成
- `CANCELLED`：取消，不做了

---

## 阶段 0：先确认 Teable API 能力，不要凭空设计

- [x] 0.1 联调 Teable 记录读写 API
  - 状态：DONE
  - 这一步到底做什么：确认当前 Teable 实例支持哪些记录接口，特别是单条更新和批量更新的路径。
  - 做完以后能看到什么：知道 Host runtime API 应该调用哪个 Teable 原始接口。
  - 先依赖什么：`spec018` 的 Teable 连接可用。
  - 开始前先看：
    - `design.md` §8「风险与待确认项」
    - `docs/20260606-Teable自定义视图块接口草案.md`
    - `apps/host/src/modules/workspace/teable-api-client.ts`
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-api-client.ts`
    - `apps/host/tests/modules/workspace/teable-runtime-service.test.ts`
  - 这一步明确不做什么：不写前端页面，不做 iframe。
  - 怎么验证：
    - Host 单测覆盖 list/create/update/delete 记录调用路径。
  - 对应需求：需求 2、需求 3
  - 对应设计：§3.3、§8.2

- [x] 0.2 确认视图配置可解析程度
  - 状态：DONE
  - 这一步到底做什么：读取 Teable view API 返回值，确认 grid、form、calendar、kanban 的 options、group、columnMeta 是否足够用。
  - 做完以后能看到什么：知道哪些配置能自动读取，哪些必须让用户在块设置里手动选。
  - 先依赖什么：0.1
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` §3.2「数据结构」
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-runtime-service.ts`
    - `apps/host/tests/modules/workspace/teable-runtime-service.test.ts`
  - 这一步明确不做什么：不为了兼容所有 Teable 私有结构写复杂解析器。
  - 怎么验证：
    - 用 fixture 覆盖有配置和缺配置两种视图。
  - 对应需求：需求 4、需求 5
  - 对应设计：§2.3.1、§3.2

---

## 阶段 1：新增 Host runtime API

- [x] 1.1 新建 Teable runtime service 和 controller
  - 状态：DONE
  - 这一步到底做什么：在 Host 里新增给工作台块使用的 Teable runtime API，读取表、视图、字段、记录。
  - 做完以后能看到什么：前端可以通过 Host 读取 Teable 表结构和记录，不需要直连 Teable。
  - 先依赖什么：0.1、0.2
  - 开始前先看：
    - `docs/20260606-Teable自定义视图块接口草案.md`
    - `apps/host/src/modules/workspace/teable-catalog-service.ts`
    - `apps/host/src/modules/workspace/teable-credential-service.ts`
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-runtime-service.ts`
    - `apps/host/src/modules/workspace/teable-runtime-controller.ts`
    - `apps/host/src/routes/affairs.ts`
    - `apps/host/src/server/create-server.ts`
  - 这一步明确不做什么：不做分享页代理，不暴露 token。
  - 怎么验证：
    - `pnpm --dir apps/host test -- --run tests/integration/teable-runtime-routes.test.ts tests/modules/workspace/teable-runtime-service.test.ts`
    - `pnpm --dir apps/host exec tsc --noEmit`
  - 对应需求：需求 1、需求 2、需求 6
  - 对应设计：§2.2、§3.3

- [x] 1.2 支持记录创建、更新和删除
  - 状态：DONE
  - 这一步到底做什么：在 Host runtime API 里增加记录写入能力，并在 Host 校验不可写字段。
  - 做完以后能看到什么：前端可以创建、编辑、删除 Teable 记录。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3、需求 6
    - `design.md` §6.2「不可写字段不能被写入」
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-runtime-service.ts`
    - `apps/host/src/modules/workspace/teable-api-client.ts`
    - `apps/host/tests/modules/workspace/teable-runtime-service.test.ts`
  - 这一步明确不做什么：不支持附件上传，不做批量编辑。
  - 怎么验证：
    - Host 测试覆盖可写字段、不可写字段、Teable API 失败。
  - 对应需求：需求 2、需求 3、需求 6
  - 对应设计：§2.3.3、§2.3.4、§6.2

- [x] 1.3 支持关联字段候选记录接口
  - 状态：DONE
  - 这一步到底做什么：Host 根据关联字段配置找到关联表，读取候选记录并返回给前端下拉框。
  - 做完以后能看到什么：前端可以给关联字段加载候选记录，显示关联表主字段内容。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §3.2.6「关联字段候选记录」
    - `docs/20260606-Teable自定义视图块接口草案.md` §8
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-runtime-service.ts`
    - `apps/host/src/modules/workspace/teable-runtime-controller.ts`
    - `apps/host/tests/modules/workspace/teable-runtime-service.test.ts`
  - 这一步明确不做什么：不允许在 CodingNS 修改关联字段结构，不做新建关联表记录。
  - 怎么验证：
    - Host 测试覆盖单选关联、多选关联、缺少关联表配置、候选搜索分页。
  - 对应需求：需求 7
  - 对应设计：§3.2.6、§5.1

- [x] 1.4 支持计算字段刷新规则
  - 状态：DONE
  - 这一步到底做什么：明确公式、查找、条件查找、汇总、条件汇总字段不写入，只读显示；记录变化后重新读取 Teable 结果。
  - 做完以后能看到什么：用户保存记录后，相关公式和查找结果会刷新成 Teable 最新计算值。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 8
    - `design.md` §3.2.7「计算字段刷新」
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-runtime-service.ts`
    - `apps/user-app/src/features/workbench/teable/hooks/useTeableRecords.ts`
    - `apps/user-app/src/features/workbench/teable/fields/TeableCellRenderer.tsx`
  - 这一步明确不做什么：不在 CodingNS 本地计算公式、lookup 或 rollup。
  - 怎么验证：
    - 测试覆盖创建/更新后重新拉取记录，计算字段不进入提交体。
  - 对应需求：需求 8
  - 对应设计：§3.2.7、§6.3

---

## 阶段 2：接回工作台块入口

- [x] 2.1 新增 Teable 块类型和配置归一化
  - 状态：DONE
  - 这一步到底做什么：给事务工作台新增 `teableTable` 或同等块类型，并定义块配置结构。
  - 做完以后能看到什么：历史状态归一化能识别新的 Teable 自定义块，但不会恢复旧 iframe 块。
  - 先依赖什么：1.1
  - 开始前先看：
    - `design.md` §3.2「Teable 块配置」
    - `apps/user-app/src/features/workbench/types/workbench-mode.ts`
    - `apps/user-app/src/features/workbench/utils/affairs-dashboard-state.ts`
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/types/workbench-mode.ts`
    - `apps/user-app/src/features/workbench/utils/affairs-dashboard-state.ts`
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
  - 这一步明确不做什么：不复用旧 `AffairsTeableFormBlock`，不放 iframe。
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"`
    - `pnpm --dir apps/user-app exec tsc --noEmit`
  - 对应需求：需求 1、需求 9
  - 对应设计：§2.3.1、§3.2

- [x] 2.2 新增添加块选择器
  - 状态：DONE
  - 这一步到底做什么：添加块面板里提供 Teable 块入口，用户先选表，再选视图。
  - 做完以后能看到什么：用户能在画布里添加一个 Teable 自定义块。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.3.1「添加 Teable 块」
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/teable/TeableBlockPicker.tsx`
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
  - 这一步明确不做什么：不在添加块面板里配置同步规则。
  - 怎么验证：
    - 前端测试覆盖未配置连接、选择表、选择视图、添加成功。
  - 对应需求：需求 1、需求 9
  - 对应设计：§2.3.1、§6.4

---

## 阶段 3：先把表格视图做扎实

- [x] 3.1 实现只读表格视图
  - 状态：DONE
  - 这一步到底做什么：用 Host runtime API 读取字段和记录，在 Teable 块里渲染表格。
  - 做完以后能看到什么：工作台里能看到 Teable 表记录，不再是 iframe。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.3.2「渲染记录」
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/teable/TeableWorkbenchBlock.tsx`
    - `apps/user-app/src/features/workbench/teable/views/TeableGridView.tsx`
    - `apps/user-app/src/features/workbench/teable/fields/TeableCellRenderer.tsx`
  - 这一步明确不做什么：不做 inline edit，不做复杂筛选器。
  - 怎么验证：
    - 前端测试覆盖加载态、错误态、空态、正常记录展示。
  - 对应需求：需求 2
  - 对应设计：§2.3.2、§7.3

- [x] 3.2 实现记录详情抽屉和基础编辑
  - 状态：DONE
  - 这一步到底做什么：点击表格行打开详情抽屉，支持编辑可写字段并保存。
  - 做完以后能看到什么：用户能在 CodingNS 里修改 Teable 记录。
  - 先依赖什么：3.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 6
    - `design.md` §2.3.4「编辑记录」
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/teable/record/TeableRecordDrawer.tsx`
    - `apps/user-app/src/features/workbench/teable/fields/TeableFieldEditor.tsx`
    - `apps/user-app/src/features/workbench/teable/api/teable-runtime-api.ts`
  - 这一步明确不做什么：不做附件上传；关联字段只做候选记录选择，不做关联字段结构编辑。
  - 怎么验证：
    - 前端测试覆盖编辑成功、保存失败保留输入、不可写字段只读、关联字段单选和多选。
  - 对应需求：需求 2、需求 6
  - 对应设计：§2.3.4、§6.2

- [x] 3.3 支持关联字段选择器
  - 状态：DONE
  - 这一步到底做什么：在记录详情抽屉和表单里给关联字段提供下拉选择器，支持单选和多选。
  - 做完以后能看到什么：用户可以在 CodingNS 里选择关联表里的已有记录，建立多表关联。
  - 先依赖什么：3.2、1.3
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §3.2.6「关联字段候选记录」
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/teable/fields/TeableLinkRecordPicker.tsx`
    - `apps/user-app/src/features/workbench/teable/fields/TeableFieldEditor.tsx`
    - `apps/user-app/src/features/workbench/teable/api/teable-runtime-api.ts`
  - 这一步明确不做什么：不编辑关联字段结构，不在选择器里新建关联记录。
  - 怎么验证：
    - 前端测试覆盖候选加载、搜索、单选、多选、加载失败提示。
  - 对应需求：需求 7
  - 对应设计：§3.2.6

- [x] 3.4 支持计算字段只读显示和刷新
  - 状态：DONE
  - 这一步到底做什么：公式、查找、条件查找、汇总、条件汇总字段在表格和抽屉里只读显示；记录保存后自动刷新。
  - 做完以后能看到什么：用户能看到 Teable 计算后的值，不会看到原始 JSON，也不能编辑这些字段。
  - 先依赖什么：3.2、1.4
  - 开始前先看：
    - `requirements.md` 需求 8
    - `design.md` §3.2.7「计算字段刷新」
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/teable/fields/TeableComputedFieldRenderer.tsx`
    - `apps/user-app/src/features/workbench/teable/fields/TeableCellRenderer.tsx`
    - `apps/user-app/src/features/workbench/teable/record/TeableRecordDrawer.tsx`
  - 这一步明确不做什么：不在 CodingNS 计算公式，不实现 lookup/rollup 配置编辑。
  - 怎么验证：
    - 前端测试覆盖只读显示、空值显示、保存后刷新。
  - 对应需求：需求 8
  - 对应设计：§3.2.7、§6.3

- [x] 3.5 支持新建和删除记录
  - 状态：DONE
  - 这一步到底做什么：表格块提供新建记录按钮，详情抽屉提供删除记录。
  - 做完以后能看到什么：用户能创建和删除 Teable 记录。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` §2.3.3、§2.3.5
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/teable/record/TeableRecordDrawer.tsx`
    - `apps/user-app/src/features/workbench/teable/views/TeableGridView.tsx`
  - 这一步明确不做什么：不做批量删除。
  - 怎么验证：
    - 前端测试覆盖创建成功反馈、删除二次确认、失败提示。
  - 对应需求：需求 2、需求 3
  - 对应设计：§2.3.3、§2.3.5

---

## 阶段 4：实现表单、日历和看板第一版

- [x] 4.1 实现表单视图
  - 状态：DONE
  - 这一步到底做什么：根据字段生成 CodingNS 自定义表单，用来创建 Teable 记录。
  - 做完以后能看到什么：Teable 表单视图不再打开分享页，而是在块里直接填写和提交。
  - 先依赖什么：3.5
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.3.3
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/teable/views/TeableFormView.tsx`
    - `apps/user-app/src/features/workbench/teable/fields/TeableFieldEditor.tsx`
  - 这一步明确不做什么：不支持复杂表单布局，不做条件显隐。
  - 怎么验证：
    - 前端测试覆盖字段渲染、必填校验、提交成功和失败。
  - 对应需求：需求 3、需求 6
  - 对应设计：§2.3.3、§6.2

- [x] 4.2 实现日历视图第一版
  - 状态：DONE
  - 这一步到底做什么：按日期字段把 Teable 记录显示在月历里。
  - 做完以后能看到什么：用户能在工作台里看到 Teable 记录对应的日历事件。
  - 先依赖什么：3.5
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §3.2「字段覆盖配置」
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/teable/views/TeableCalendarView.tsx`
    - `apps/user-app/src/features/workbench/teable/utils/teable-view-config.ts`
  - 这一步明确不做什么：第一版不做拖拽改日期，不做周视图。
  - 怎么验证：
    - 前端测试覆盖有日期字段、缺日期字段、点击事件打开详情。
  - 对应需求：需求 4
  - 对应设计：§2.3.2、§5.2

- [x] 4.3 实现看板视图第一版
  - 状态：DONE
  - 这一步到底做什么：按单选字段把 Teable 记录显示成看板列。
  - 做完以后能看到什么：用户能在工作台里按状态或阶段查看卡片。
  - 先依赖什么：3.5
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §3.2「字段覆盖配置」
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/teable/views/TeableKanbanView.tsx`
    - `apps/user-app/src/features/workbench/teable/utils/teable-view-config.ts`
  - 这一步明确不做什么：第一版不做拖拽排序，不支持所有字段类型分组。
  - 怎么验证：
    - 前端测试覆盖按单选字段分组、空列、点击卡片打开详情。
  - 对应需求：需求 5
  - 对应设计：§2.3.2、§5.2

---

## 阶段 5：收尾和验收

- [ ] 5.1 清理旧 iframe 路线残留
  - 状态：TODO
  - 这一步到底做什么：确认本 Spec 没有引入任何 Teable 分享页、iframe、`_next` 代理相关代码。
  - 做完以后能看到什么：Teable 块完全是自定义前端。
  - 先依赖什么：4.3
  - 开始前先看：
    - `spec018/design.md`
    - `requirements.md` 需求 9
  - 主要改哪里：相关新增文件和旧工作台文件。
  - 这一步明确不做什么：不删 `spec018` 的同步设置能力。
  - 怎么验证：
    - `rg -n "teable-view|view-proxy|iframe|_next|shareId|form-catalog|form-bindings" apps/user-app/src apps/host/src`
  - 对应需求：需求 9
  - 对应设计：§6.1、§6.4

- [ ] 5.2 最终检查点
  - 状态：TODO
  - 这一步到底做什么：确认工作台 Teable 自定义视图块达到第一版交付标准。
  - 做完以后能看到什么：表格和表单可写，日历和看板可读，所有数据请求走 Host。
  - 先依赖什么：5.1
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本 Spec 涉及的全部文件。
  - 这一步明确不做什么：不再追加高级字段、拖拽排序、附件上传。
  - 怎么验证：
    - `pnpm --dir apps/host exec tsc --noEmit`
    - `pnpm --dir apps/user-app exec tsc --noEmit`
    - `pnpm --dir apps/host test -- --run tests/integration/teable-runtime-routes.test.ts tests/modules/workspace/teable-runtime-service.test.ts`
    - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"`
  - 对应需求：全部需求
  - 对应设计：全部设计
---

## 2026-06-06 本轮完成记录

- Host 已新增 Teable runtime API：表列表、视图列表、字段列表、记录列表、新建记录、更新记录、删除记录、关联字段候选记录。
- 前端工作台已新增 Teable 块：添加块时选择表和视图，块内按视图类型渲染表格、表单、日历、看板。
- 字段规则已接入第一版：普通字段可编辑；关联字段从 Host 候选记录接口读取；公式、查找、汇总等计算字段只读；创建或更新后重新读取记录。
- 明确没有恢复 Teable 分享页代理、`form-catalog`、`form-bindings`、`view-proxy` 和 `_next` 代理；现有 HTML 工作台块仍保留自己的 iframe，这不是 Teable 路线。
- 补充完成：非表单视图里的“新建记录”已改为独立 `DesktopModal`，不再把创建表单塞进块内容区域。
- 补充完成：Teable 表单视图会读取 Host 返回的公开视图配置，按能解析到的字段顺序、可见字段、必填字段、字段显示名、说明和占位提示渲染。Teable API 没返回的私有样式、复杂布局、条件显隐不硬猜，也不恢复 iframe 或分享页代理。
- 补充完成：Teable 表格视图现在把 Teable 视图作为运行时设计源。刷新块时会重新读取视图配置，并按 Teable 返回的字段顺序、隐藏字段和列宽渲染；记录查询也不再强制忽略 Teable 视图查询条件，避免绕开 Teable 里的筛选、排序等视图设置。
- 补充完成：添加 Teable 块时必须选择新建记录表单视图和编辑记录表单视图。新建弹窗和编辑弹窗分别按对应表单视图的字段顺序、隐藏字段、必填、字段显示名、说明和占位提示渲染；展示视图配置和表单视图配置已拆开，避免表单字段名污染表格列名。

本轮最小必要验证：

```bash
pnpm --dir apps/host exec tsc --noEmit
pnpm --dir apps/user-app exec tsc --noEmit
pnpm --dir apps/host test -- --run tests/integration/teable-runtime-routes.test.ts tests/modules/workspace/teable-runtime-service.test.ts
pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"
```
