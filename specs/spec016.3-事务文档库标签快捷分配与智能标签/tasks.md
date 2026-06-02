# 任务清单 - spec016.3-事务文档库标签快捷分配与智能标签

状态：In Progress（任务 1、2、3、4、5、6 已完成；如果后续还要补更细的批量策略，再单开增量任务）

## 任务 1：定清标签模型、来源类型和后台边界

### 这一步到底做什么

把 spec016.3 的正式数据模型、来源类型、接口范围和后台任务边界定清楚，避免后面一边写快捷分配，一边又临时补规则字段。

### 做完以后能看到什么结果

- `requirements.md` 和 `design.md` 里明确写清：
  - 标签树还是一套
  - 新增 `smart_rule` 来源
  - 智能标签规则怎么存
  - 文件夹绑定如何覆盖未来新文件
- 后续开发知道该补哪些 Host DTO 和服务能力

### 这一步依赖什么

- 现有 `apps/host` 标签树、文件标签、文件夹标签链路
- `spec001.2` 后台任务接入规范

### 主要改哪些文件

- `requirements.md`
- `design.md`
- 必要时补 `docs/` 说明

### 这一步明确不做什么

- 先不写前端 UI
- 先不改测试
- 先不碰推荐标签或 AI 标签

### 怎么验证是不是真的做完了

- 文档里能一眼看懂新模型是什么
- 文档里把 `smart_rule`、统一快速分配器、未来文件继承说清楚

### 当前进度

- 已完成：spec 全量重写，旧 `spec016.3-事务文档库手动标签树与标签分配` 已替换为新的“标签快捷分配与智能标签”方案

---

## 任务 2：补 Host 侧快捷创建、快捷分配和智能规则能力

### 这一步到底做什么

把后端接口补齐，让前端不必再绕到独立模态框里创建标签，也能正式保存和读取智能标签规则。

### 做完以后能看到什么结果

- 文件 / 文件夹分配标签时，支持“没有就创建”
- 标签详情接口能带回智能规则
- 保存标签时能同时保存标签树信息和规则

### 这一步依赖什么

- 任务 1 已把 DTO 和数据模型定清楚

### 主要改哪些文件

- `apps/host/src/modules/workspace/affairs-tag-service.ts`
- `apps/host/src/modules/workspace/affairs-tag-controller.ts`
- `apps/host/src/routes/workspaces.ts`
- `apps/host/src/modules/affairs-indexer/core/src/repositories/catalog-repository.ts`
- `apps/host/src/modules/affairs-indexer/core/src/repositories/catalog-write-repository.ts`

### 这一步明确不做什么

- 先不做复杂推荐接口
- 先不做第二套标签树

### 怎么验证是不是真的做完了

- Host 有正式入口支持快捷创建 / 快捷分配 / 规则读写
- 标签详情接口能解释智能标签规则
- 文件和文件夹分配不再只能传现有 tagId

### 当前进度

- 已完成：
  - 新增 `/affairs/tags/ensure`
  - 文件 / 文件夹标签保存接口支持 `createTagPaths`
  - 标签详情返回 `smartRules` 和 `smartRuleEnabled`
  - Host 类型检查已通过

---

## 任务 3：补标签重算链路，让文件夹绑定和智能标签对未来文件持续生效

### 这一步到底做什么

把索引、标签重算、导出刷新串起来，保证新文件进来后，不用人手再点一次，文件夹绑定和智能标签也会自动补上。

### 做完以后能看到什么结果

- 新文件进入已绑定标签的目录后，会自动出现文件夹继承标签
- 新文件命中智能规则后，会自动出现智能标签
- 标签重算继续按目录 / 文档 / 标签范围增量执行

### 这一步依赖什么

- 任务 2 已有规则读写能力
- 现有 `TaskManager` 和索引后台任务可复用

### 主要改哪些文件

- `apps/host/src/modules/affairs-indexer/core/src/services/tagging/tag-recompute-service.ts`
- `apps/host/src/modules/affairs-indexer/core/src/tagging/simple-tag-inference.ts` 或新的规则执行器
- `apps/host/src/modules/workspace/affairs-library-service.ts`
- `apps/host/src/modules/tasks/task-types.ts`

### 这一步明确不做什么

- 不回主线程现算全文
- 不新长私有 timer
- 不整库无脑全量重跑

### 怎么验证是不是真的做完了

- 新文件索引后，不用手动再点标签，也能看到继承 / 智能标签结果
- 修改单个文件夹绑定时，只重算受影响目录
- 相关任务都还挂在 `TaskManager` 下

### 当前进度

- 已完成：
  - 标签重算支持 `smart_rule`
  - 文档内容会写入 `chunks`，可用于“文件内容包含”规则
  - Host 定向测试已通过

---

## 任务 4：把前端标签入口统一成一套快捷分配器

### 这一步到底做什么

做一个前端共用的标签快速分配器，并替换文件详情、文件夹详情、右键菜单里现在分裂的三种交互。

### 做完以后能看到什么结果

- 文件详情里可以搜标签、直接新建、直接分配
- 文件夹详情里也可以搜标签、直接新建、直接绑定
- 右键菜单不再只显示固定 8 个标签

### 这一步依赖什么

- 任务 2 的后端接口已可用

### 主要改哪些文件

- `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
- 相关子组件或新建的标签选择组件
- `apps/user-app/src/shared/i18n/index.ts`
- 对应样式文件

### 这一步明确不做什么

- 不把文本写死在组件里
- 不继续保留三套互相不一致的标签输入体验

### 怎么验证是不是真的做完了

- 同一套分配器能在三个入口工作
- 输入不存在的标签时可以直接创建
- 创建完成后不需要再进管理模态框补第二步

### 当前进度

- 已完成：
  - 文件详情改成输入即搜、回车可分配、无匹配可直接创建
  - 文件夹详情改成同一套快捷分配器
  - 右键菜单改成“分配标签”统一入口，不再显示固定 8 个标签
  - 前端类型检查和定向测试已通过

---

## 任务 5：重做标签管理模态框，让它只负责正式管理

### 这一步到底做什么

把标签管理模态框改成正式管理入口：管理标签树、批量修改 / 删除、维护智能规则，不再让它承担“临时创建完再返回分配”的绕路职责。

### 做完以后能看到什么结果

- 模态框里能看到标签树和规则编辑区
- 可以创建普通标签和智能标签
- 可以批量修改、批量删除
- 用户临时打标签时不必先打开这个模态框

### 这一步依赖什么

- 任务 4 的快捷分配器已经把临时创建入口接走

### 主要改哪些文件

- `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
- 相关模态框子组件
- `apps/user-app/src/shared/i18n/index.ts`
- 相关样式文件

### 这一步明确不做什么

- 不做复杂的可视化规则流程图
- 不做第二个“智能标签专用管理页”

### 怎么验证是不是真的做完了

- 管理模态框能看、能改、能删、能配规则
- 临时分配标签时不需要依赖这个模态框

### 当前进度

- 已完成：
  - 已支持标签树查看、单标签编辑、删除、智能规则新增 / 修改 / 删除
  - 已支持批量选择标签、批量改上级、批量统一启停状态、批量删除
  - 普通手动标签的临时创建已经迁到快捷分配器

---

## 任务 6：补测试和验收文档

### 这一步到底做什么

把新的 Host 能力、前端交互和后台重算链路补齐测试，并把验收标准写清楚，避免以后再被旧思路带偏。

### 做完以后能看到什么结果

- Host 测试覆盖：快捷创建、文件夹继承、智能规则命中
- 前端测试覆盖：文件详情、文件夹详情、右键菜单、管理模态框
- docs 里有一份能照着点的验收说明

### 这一步依赖什么

- 前面 1 到 5 步都已落地

### 主要改哪些文件

- `apps/host/tests/modules/workspace/affairs-tag-service.test.ts`
- `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.test.tsx`
- `docs/20260602-标签系统重写验收说明.md`

### 这一步明确不做什么

- 不只写“理论正确”的说明
- 不把旧方案残留在验收文档里

### 怎么验证是不是真的做完了

- 类型检查通过
- 定向测试通过
- 人工验收文档能按步骤复现关键场景

### 当前进度

- 已完成：
  - `pnpm -C apps/host exec tsc --noEmit`
  - `pnpm -C apps/user-app exec tsc --noEmit`
  - `pnpm -C apps/host exec vitest run tests/modules/workspace/affairs-tag-service.test.ts tests/modules/workspace/affairs-library-service.test.ts`
  - `pnpm -C apps/user-app exec vitest run src/features/workbench/components/AffairsWorkbenchView.test.tsx`
