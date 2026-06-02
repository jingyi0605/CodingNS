# 设计文档 - spec016.3-事务文档库标签快捷分配与智能标签

状态：Draft

## 1. 概述

### 1.1 目标

这次不是再造一套标签平台，而是把现有标签系统补成真正能用的版本：

- 手动标签创建和分配不再割裂
- 文件夹标签不再只对“当前快照”有效
- 智能标签重新回来，但必须挂在现有标签树里，且能解释

### 1.2 覆盖需求

- `requirements.md` 需求 1
- `requirements.md` 需求 2
- `requirements.md` 需求 3
- `requirements.md` 需求 4
- `requirements.md` 需求 5

## 2. 核心判断

### 2.1 不再拆两套标签系统

当前最值钱的资产不是 UI，而是已经稳定下来的四层数据：

1. `tags`
2. `manual_document_tag_bindings`
3. `folder_tag_bindings`
4. `document_tags` / `derived_document_tags`

这层不能推翻。

所以这次只做一件事：

**继续用同一棵 `tags` 树，同时补上快捷分配和智能规则。**

### 2.2 智能标签不是第二棵树

智能标签只是“带规则的标签”，不是新的分类体系。

也就是说：

- 没有规则的标签 = 普通标签
- 有规则的标签 = 智能标签

它们都在 `tags` 表里，都有正常路径和父子关系。

## 3. 数据结构

### 3.1 继续保留的数据层

1. **标签定义层**
   - `tags`
2. **文件手动绑定层**
   - `manual_document_tag_bindings`
3. **文件夹绑定层**
   - `folder_tag_bindings`
4. **最终结果层**
   - `document_tags`
   - `derived_document_tags`

### 3.2 智能规则存储

继续复用现有 `tag_rules` 表，但这次把它当正式数据，而不是遗留空壳。

第一版规则模型收成线性列表，不做嵌套表达式树。

建议的逻辑模型：

- 一个标签可以挂多条规则
- 每条规则至少包含：
  - `id`
  - `tagId`
  - `relation`：`and | or | not`
  - `ruleType`
  - `matcher`
  - `enabled`
  - `priority`
- `matcher_json` 里存不同规则类型的配置

建议支持的 `ruleType`：

- `file_name_contains`
- `file_content_contains`
- `file_extension_in`
- `modified_time_between`

### 3.3 标签来源类型

当前来源只有：

- `manual_document`
- `folder_binding`
- `system_derived`

这次新增：

- `smart_rule`

最终优先级：

1. `manual_document`
2. `folder_binding`
3. `smart_rule`
4. `system_derived`

原因很简单：

- 用户手动点的优先级最高
- 文件夹绑定是显式长期意图
- 智能规则是配置出来的自动结果
- 系统派生只是辅助标签

## 4. 后端方案

### 4.1 AffairsTagService 扩展方向

现有 `AffairsTagService` 继续做正式入口，但要补三类能力：

1. **标签快速创建能力**
   - 给文件 / 文件夹分配标签时，支持“找不到则创建”
2. **智能标签规则读写能力**
   - 标签详情返回规则
   - 保存标签时一并保存规则
3. **统一标签重算入口**
   - 不再把“apply bindings”和“recompute”拆成两套语义相同的后台任务

一句人话：

**不要再让“创建标签”“保存规则”“分配标签”“重算标签”散在四个半入口里。**

### 4.2 建议新增或调整的 Host API

现有接口保留：

- `GET /affairs/tags`
- `POST /affairs/tags`
- `GET /affairs/tags/:tagId`
- `PUT /affairs/tags/:tagId`
- `DELETE /affairs/tags/:tagId`
- `GET /affairs/documents/:documentId/tag-details`
- `PUT /affairs/documents/:documentId/tags`
- `GET /affairs/folders/tag-details`
- `PUT /affairs/folders/tags`

建议补充的能力语义：

1. `POST /affairs/tags/ensure`
   - 输入标签路径或标签名
   - 存在则返回已有标签
   - 不存在则创建并返回
2. `PUT /affairs/tags/:tagId`
   - 同时支持保存标签树信息和智能规则
3. `GET /affairs/tags/:tagId`
   - 返回标签详情时带上规则列表和是否为智能标签

如果不想额外长 `/ensure`，那就在文件 / 文件夹标签保存入口里支持：

- `existingTagIds`
- `newTagPaths`

但无论哪种做法，**前后端都必须共用同一种“找不到就新建”的正式能力**。

### 4.3 标签重算

当前 `TagRecomputeService` 只吃：

- 手动标签
- 文件夹绑定
- 系统派生标签

这次要补上智能规则执行。

最终重算输入需要包含：

- 文件路径
- 标题
- 摘要
- 扩展名
- 修改时间
- 文本内容

这里最关键的一刀是：

**文件内容规则不能再只靠 `title + summary + path` 假装全文。**

建议做法：

- 从 `chunks` 读取分块文本并拼成规则匹配用文本
- 为了避免失控，可以设单文档规则匹配文本上限，例如只取前若干字符
- 这条链继续跑在 helper process，不回主线程

### 4.4 文件夹绑定对未来文件生效

这是这次后端最需要补齐的正式保证。

当前绑定保存时会触发一次目录范围重算，但新文件后续进入该目录时，系统也必须自动再跑标签重算。

建议链路：

1. `affairs.library_index` 或 `watch-touch` 把新文件写入 catalog
2. 索引结果返回受影响路径
3. Host 再按变更范围触发标签重算
4. 标签重算把：
   - 文件夹绑定
   - 智能规则
   - 系统派生标签
   一次性补齐

## 5. 前端方案

### 5.1 统一标签快速分配器

新增一个共用组件，比如：

- `AffairsTagQuickPicker`

它至少复用到三个地方：

1. 文件详情标签区
2. 文件夹详情标签区
3. 右键文件 / 文件夹标签入口

这个组件统一负责：

- 输入关键词
- 检索已有标签
- 展示最近使用或常用标签
- 输入不存在时显示“新建并分配”动作
- 选中后调用对应 API

### 5.2 文件详情

当前文件详情已经有输入框，但能力太弱。

需要补成：

- 搜索已有标签
- 回车快速分配
- 无精确命中时支持新建并分配
- 展示已分配标签、继承标签、智能标签、系统派生标签
- 来源说明可展开查看

### 5.3 文件夹详情

当前文件夹详情还是一排 chip 直接点。

这套交互不够用了。

需要改成和文件详情同一套快速分配器，只是提交目标从文档变成文件夹。

### 5.4 右键菜单

右键菜单不再只显示前 8 个静态标签。

建议改成：

- 先展示“管理标签”
- 再展示“分配标签”入口
- 点击后弹出同一套快速分配器

不要继续把右键菜单长成一个固定标签清单，不然标签多了必废。

### 5.5 标签管理模态框

这次模态框只做正式管理，不做“必须先来这里创建标签”的绕路入口。

它负责：

- 查看标签树
- 新建 / 编辑标签
- 批量修改 / 批量删除
- 编辑智能规则

第一版规则编辑区建议直接用：

- 规则列表
- 每条规则一行
- 每行包含：
  - 关系
  - 规则类型
  - 规则值
  - 删除按钮

不要先做复杂可视化流程图。

## 6. 校验和约束

### 6.1 标签创建

- 标签名不能为空
- 同一父级下不能重名
- 标签路径冲突时禁止保存
- 输入 `父/子/孙` 这种路径时，允许自动合并现有父节点

### 6.2 智能规则

- 第一条规则不允许空关系悬挂
- 规则值不能为空
- 文件类型至少选一个扩展名
- 时间范围必须有明确上下界或明确的相对时间窗口

### 6.3 删除标签

- 删除父标签时继续级联删除子标签
- 同时删除：
  - 手动绑定
  - 文件夹绑定
  - 智能规则
  - 最终标签结果

## 7. 后台任务设计

### 7.1 保留原则

继续遵守 `spec001.2`：

- 读接口纯读
- 标签变更显式触发后台重算
- 同一资源只保留一个 inflight
- 重算和导出继续跑 helper process

### 7.2 简化建议

当前 `affairsLibraryTagRecompute` 和 `affairsLibraryTagApplyBindings` 实际都在跑 `TagRecomputeService`。

这很像一件事被拆成两个名字。

这次建议收成一个正式任务类型，例如继续保留一个统一的标签重算任务，再按 scope 区分：

- document
- folder
- tag
- full

这样更好懂，也更容易观测。

## 8. 验证方式

### 8.1 类型检查

- `pnpm -C apps/host exec tsc --noEmit`
- `pnpm -C apps/user-app exec tsc --noEmit`

### 8.2 定向测试

- `pnpm -C apps/host exec vitest run tests/modules/workspace/affairs-tag-service.test.ts`
- `pnpm -C apps/user-app exec vitest run src/features/workbench/components/AffairsWorkbenchView.test.tsx`

### 8.3 人工验收重点

- 文件详情输入标签时能直接新建并分配
- 文件夹详情和右键菜单也能走同一套逻辑
- 文件夹绑定对后续新增文件仍然生效
- 智能标签能命中、能解释、能删除
- 管理模态框只负责正式管理，不再逼用户绕路创建标签
