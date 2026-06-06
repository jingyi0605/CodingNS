# 设计文档 - spec018.1-Teable自定义前端视图块

状态：Draft

## 1. 概述

### 1.1 目标

这次要把 Teable 数据显示回事务工作台，但换一条正确路线：

**不嵌入 Teable 页面，只用 Teable API，把表格、表单、日历、看板都做成 CodingNS 自己的前端组件。**

目标有四个：

1. 工作台能添加 Teable 块。
2. Teable 块能选择表和视图。
3. Teable 记录能在 CodingNS 里展示、创建、编辑和删除。
4. 全部请求走 Host，前端不接触 Teable token。

### 1.2 覆盖需求

- `requirements.md` 需求 1
- `requirements.md` 需求 2
- `requirements.md` 需求 3
- `requirements.md` 需求 4
- `requirements.md` 需求 5
- `requirements.md` 需求 6
- `requirements.md` 需求 7

### 1.3 技术约束

- 后端：`apps/host`，复用 `TeableApiClient` 和现有 Teable 连接能力。
- 前端：只改 `apps/user-app`。
- 前端文案：必须走 i18n。
- 浏览器：不直连 Teable。
- 认证：Teable token 只保存在 Host，本 Spec 不返回给前端。
- 旧路线：不恢复 iframe，不代理 Teable 分享页。

## 2. 架构

### 2.1 系统结构

整体分四层：

1. **工作台块层**
   - 负责添加 Teable 块、保存块配置、渲染块头部和删除按钮。

2. **Teable 自定义视图层**
   - 表格、表单、日历、看板四种前端组件。
   - 共用字段渲染器和记录详情抽屉。

3. **Host runtime API 层**
   - 前端只请求这一层。
   - 这一层读取 Teable 表、视图、字段和记录。
   - 这一层执行创建、更新、删除记录。

4. **Teable API 层**
   - Host 使用 Teable token 调用 Teable API。
   - Teable 仍然保存表结构和真实记录。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `TeableRuntimeService` | 读取表、视图、字段、记录，并写入记录 | 用户 ID、表 ID、视图 ID、记录输入 | 前端可用 DTO |
| `TeableRuntimeController` | 暴露 Host runtime API | HTTP 请求 | JSON 响应 |
| `TeableWorkbenchBlock` | 事务工作台 Teable 块容器 | 块配置 | 具体视图组件 |
| `TeableBlockPicker` | 添加块时选择表和视图 | 表目录、视图目录 | 块配置草稿 |
| `TeableGridView` | 表格展示和记录入口 | 字段、记录 | 表格 UI |
| `TeableFormView` | 自定义表单创建记录 | 字段、默认值 | 新记录 |
| `TeableCalendarView` | 日历展示 | 日期字段、记录 | 日历 UI |
| `TeableKanbanView` | 看板展示 | 分组字段、记录 | 看板 UI |
| `TeableRecordDrawer` | 记录详情编辑 | 字段、记录 | 更新或删除记录 |
| `TeableFieldEditor` | 字段输入组件 | 字段定义、当前值 | 新值 |
| `TeableLinkRecordPicker` | 关联字段候选记录选择 | 关联字段配置、搜索词 | 关联记录 ID 列表 |
| `TeableComputedFieldRenderer` | 公式、查找、汇总字段只读显示 | 字段定义、计算值 | 只读内容 |

### 2.3 关键流程

#### 2.3.1 添加 Teable 块

1. 用户打开添加块面板。
2. 用户选择 Teable 块。
3. 前端调用 Host 读取表列表。
4. 用户选择表。
5. 前端读取该表视图列表。
6. 用户选择视图。
7. 如果视图是日历或看板，但缺少必要字段，要求用户补字段。
8. 保存块配置到事务工作台状态。
9. 工作台渲染 Teable 块。

#### 2.3.2 渲染记录

1. `TeableWorkbenchBlock` 根据 `viewType` 选择具体组件。
2. 前端读取字段和记录。
3. 具体视图组件把记录渲染出来。
4. 加载失败只显示块内错误，不影响整个工作台。

#### 2.3.3 新建记录

1. 用户点击“新建记录”。
2. 打开 `TeableRecordDrawer` 或 `TeableFormView`。
3. 前端根据字段权限只显示可写字段。
4. 如果字段是关联字段，前端从关联表读取候选记录，用户选择已有记录。
5. 公式、查找、条件查找、汇总、条件汇总字段只读显示，不进入提交体。
6. 用户提交。
5. Host 调 Teable 创建记录。
6. 成功后关闭弹窗或清空表单。
7. 当前块刷新记录。

#### 2.3.4 编辑记录

1. 用户点击表格行、日历事件或看板卡片。
2. 打开记录详情抽屉。
3. 用户修改可写字段。
4. Host 调 Teable 更新记录。
5. 当前块刷新记录。
6. 刷新后显示 Teable 重新计算出的公式、查找和汇总结果。

#### 2.3.5 删除记录

1. 用户在记录详情抽屉点击删除。
2. 前端二次确认。
3. Host 调 Teable 删除记录。
4. 成功后关闭抽屉并刷新当前块。

## 3. 组件和接口

### 3.1 核心组件

后端新增：

- `apps/host/src/modules/workspace/teable-runtime-service.ts`
- `apps/host/src/modules/workspace/teable-runtime-controller.ts`
- `apps/host/tests/modules/workspace/teable-runtime-service.test.ts`
- `apps/host/tests/integration/teable-runtime-routes.test.ts`

前端新增：

- `apps/user-app/src/features/workbench/teable/TeableWorkbenchBlock.tsx`
- `apps/user-app/src/features/workbench/teable/TeableBlockPicker.tsx`
- `apps/user-app/src/features/workbench/teable/views/TeableGridView.tsx`
- `apps/user-app/src/features/workbench/teable/views/TeableFormView.tsx`
- `apps/user-app/src/features/workbench/teable/views/TeableCalendarView.tsx`
- `apps/user-app/src/features/workbench/teable/views/TeableKanbanView.tsx`
- `apps/user-app/src/features/workbench/teable/record/TeableRecordDrawer.tsx`
- `apps/user-app/src/features/workbench/teable/fields/TeableCellRenderer.tsx`
- `apps/user-app/src/features/workbench/teable/fields/TeableFieldEditor.tsx`
- `apps/user-app/src/features/workbench/teable/api/teable-runtime-api.ts`

### 3.2 数据结构

#### 3.2.1 Teable 块配置

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `tableId` | `string` | 是 | Teable 表 ID | 不能为空 |
| `tableName` | `string` | 是 | 表名快照 | 仅用于显示 |
| `viewId` | `string | null` | 否 | Teable 视图 ID | 可以为空，表示默认表格 |
| `viewName` | `string | null` | 否 | 视图名快照 | 仅用于显示 |
| `viewType` | `grid | form | calendar | kanban` | 是 | 块展示类型 | 第一版只支持这四类 |
| `title` | `string` | 是 | 块标题 | 默认用视图名或表名 |
| `density` | `compact | comfortable` | 是 | 显示密度 | 默认 compact |
| `readOnly` | `boolean` | 是 | 是否只读 | 默认 false |
| `fieldOverrides` | `object` | 否 | 字段显示和视图必要字段配置 | 见下表 |

#### 3.2.2 字段覆盖配置

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `visibleFieldIds` | `string[]` | 要显示的字段 |
| `primaryFieldId` | `string` | 标题字段 |
| `calendarStartFieldId` | `string` | 日历开始日期字段 |
| `calendarEndFieldId` | `string` | 日历结束日期字段 |
| `kanbanGroupFieldId` | `string` | 看板分组字段 |
| `formFieldOrder` | `string[]` | 表单字段顺序 |
| `requiredFieldIds` | `string[]` | 表单必填字段 |

#### 3.2.3 字段 DTO

```ts
interface TeableRuntimeFieldDto {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  isPrimary: boolean;
  isComputed: boolean;
  isLookup: boolean;
  isMultipleCellValue: boolean;
  recordRead: boolean;
  recordCreate: boolean;
  recordUpdate: boolean;
  options: Record<string, unknown>;
  lookupOptions?: Record<string, unknown>;
  linkOptions?: {
    foreignTableId: string;
    multiple: boolean;
    displayFieldId?: string;
  } | null;
}
```

#### 3.2.4 记录 DTO

```ts
interface TeableRuntimeRecordDto {
  recordId: string;
  fields: Record<string, unknown>;
}
```


#### 3.2.5 字段编辑分级

| 字段类型 | 第一版行为 | 说明 |
| --- | --- | --- |
| 文本、长文本、数字、日期、布尔值、单选、多选 | 可编辑 | 走 `TeableFieldEditor` |
| link / 关联字段 | 可选择已有记录 | 不编辑字段结构，只提交关联记录 ID；按字段配置支持单选或多选 |
| formula / 公式 | 只读 | Teable 负责计算，CodingNS 只显示返回值 |
| lookup / 查找 | 只读 | Teable 负责从关联表取值，CodingNS 只显示返回值 |
| conditional lookup / 条件查找 | 只读 | Teable 负责计算，CodingNS 只显示返回值 |
| rollup / 汇总 | 只读 | Teable 负责汇总，CodingNS 只显示返回值 |
| conditional rollup / 条件汇总 | 只读 | Teable 负责计算，CodingNS 只显示返回值 |
| 系统字段 | 只读 | 创建时间、修改时间、创建人、修改人、自动编号等 |
| attachment | 只读 | 附件上传后续单独做 |

#### 3.2.6 关联字段候选记录

关联字段编辑只做“选择已有记录”，不做 Teable 字段结构编辑。

流程：

1. Host 从字段 `options` 或 `lookupOptions` 中解析关联表 ID 和是否多选。
2. 前端打开关联字段下拉框。
3. 前端调用 Host runtime API 读取关联表候选记录。
4. 候选项优先显示关联表主字段。
5. 单选字段只提交一个记录 ID。
6. 多选字段提交记录 ID 数组。

候选项结构：

```ts
interface TeableLinkedRecordOptionDto {
  recordId: string;
  title: string;
  subtitle?: string;
}
```

#### 3.2.7 计算字段刷新

公式、查找、条件查找、汇总、条件汇总都不在 CodingNS 里计算。

规则：

1. 创建记录成功后，重新读取当前页记录。
2. 更新记录成功后，重新读取当前记录或当前页记录。
3. 用户点击刷新后，重新读取当前页记录。
4. 返回值为空时显示空态，不把原始 JSON 直接甩给用户。

### 3.3 接口契约

接口细节见 `docs/20260606-Teable自定义视图块接口草案.md`。

本设计只强调三条规则：

1. 前端请求路径必须是 `/api/affairs/teable/runtime/...`。
2. Host 返回字段时必须标记是否可写。
3. Host 返回关联字段时必须尽量解析关联表 ID、是否多选和候选显示字段。
4. 更新记录前必须在 Host 校验字段可写，不能只靠前端禁用输入框。
5. 公式、查找、条件查找、汇总、条件汇总字段永远不进入写入请求。

## 4. 数据与状态模型

### 4.1 数据关系

- 工作台块保存的是 Teable 表和视图的引用。
- Teable 记录真身仍在 Teable。
- `spec018` 的镜像同步配置仍在设置页，不被块配置修改。
- Teable 块只是展示和编辑 Teable 表记录。

### 4.2 前端状态

每个 Teable 块内部至少有这些状态：

| 状态 | 含义 |
| --- | --- |
| `loadingSchema` | 正在读取字段和视图配置 |
| `loadingRecords` | 正在读取记录 |
| `ready` | 可以显示 |
| `savingRecord` | 正在创建或更新记录 |
| `deletingRecord` | 正在删除记录 |
| `error` | 块内错误 |

### 4.3 缓存 key

建议用：

```ts
["teable-runtime", tableId, viewId, pagination, filter, orderBy]
```

如果当前项目没有统一数据请求缓存库，先用组件内 state，不引入新库。

## 5. 错误处理

### 5.1 错误类型

- `TEABLE_BINDING_REQUIRED`：没有 Teable 连接。
- `TEABLE_AUTH_REQUIRED`：Teable token 不存在。
- `TEABLE_TABLE_NOT_FOUND`：表不存在。
- `TEABLE_VIEW_NOT_FOUND`：视图不存在。
- `TEABLE_FIELD_NOT_WRITABLE`：字段不可写。
- `TEABLE_LINK_FIELD_INVALID`：关联字段缺少关联表配置。
- `TEABLE_LINK_OPTION_LOAD_FAILED`：关联记录候选读取失败。
- `TEABLE_RECORD_NOT_FOUND`：记录不存在。
- `TEABLE_API_REQUEST_FAILED`：Teable API 调用失败。

### 5.2 处理策略

1. 连接错误：块内显示“请先配置 Teable 连接”，提供打开设置入口。
2. 表或视图不存在：块内显示“表或视图已不存在”，允许重新选择。
3. 字段缺失：日历和看板显示缺失字段提示，允许打开块设置修复。
4. 记录保存失败：保留用户输入，显示错误，允许重试。
5. Teable API 异常：Host 返回用户能看懂的摘要，不把整段内部堆栈返回给前端。

## 6. 正确性属性

### 6.1 属性 1：前端不直连 Teable

对于任何 Teable 块数据请求，系统都应该满足：请求只发到 CodingNS Host，不发到 Teable 原始地址。

验证需求：需求 1、需求 9。

### 6.2 属性 2：不可写字段不能被写入

对于任何 Teable 字段，如果字段是计算字段、查找字段、汇总字段或 Host 判断不可写，系统都不应该把它发送到创建或更新记录请求里。关联字段例外：它不是编辑字段结构，而是提交已选择的关联记录 ID。

验证需求：需求 3、需求 6。

### 6.3 属性 3：计算字段只显示 Teable 结果

对于任何公式、查找、条件查找、汇总和条件汇总字段，CodingNS 都不自己计算，只显示 Teable API 返回的结果，并在记录变化后刷新。

验证需求：需求 8。

### 6.4 属性 4：块设置不改变同步配置

对于任何 Teable 块设置保存，系统都不应该修改 `spec018` 的表同步配置、字段映射和同步日志。

验证需求：需求 9。

## 7. 测试策略

### 7.1 单元测试

- 字段是否可写判断。
- 关联字段配置解析。
- 关联候选记录标题格式化。
- 公式、查找、汇总字段只读判断。
- 字段值格式化。
- 表格列选择。
- 日历日期字段解析。
- 看板分组字段解析。
- 块配置归一化。

### 7.2 Host 集成测试

- runtime 表列表。
- runtime 视图列表。
- runtime 字段列表。
- runtime 记录列表。
- 创建记录。
- 更新记录。
- 删除记录。
- 不可写字段拦截。
- 关联字段候选记录读取。
- 关联字段单选和多选提交。

### 7.3 前端测试

- 添加块面板出现 Teable 块入口。
- 未配置连接时显示错误。
- 选择表和视图后可以添加块。
- 表格视图显示记录。
- 表单视图提交后显示成功。
- 记录详情抽屉能保存和删除。
- 关联字段下拉框能加载候选记录。
- 公式、查找、汇总字段只读显示并能刷新。
- 日历/看板缺字段时有修复提示。

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §2.3.1、§3.2 | 前端添加块测试 |
| 需求 2 | §2.3.2、§3.1 | 表格视图测试 |
| 需求 3 | §2.3.3、§3.1 | 表单提交测试 |
| 需求 4 | §2.3.2、§3.2 | 日历字段测试 |
| 需求 5 | §2.3.2、§3.2 | 看板分组测试 |
| 需求 6 | §3.2、§6.2 | 字段权限测试 |
| 需求 7 | §3.2.6 | 关联字段候选记录测试 |
| 需求 8 | §3.2.7、§6.3 | 计算字段刷新测试 |
| 需求 9 | §4.1、§6.4 | 块设置测试 |

## 8. 风险与待确认项

### 8.1 风险

- Teable 不同版本的记录更新 API 可能不完全一致，必须先联调确认。
- Teable view options 的结构可能不稳定，日历和看板第一版要允许用户手动补字段。
- link 字段第一版只做选择已有记录，不做字段结构编辑；lookup、formula、rollup 只读显示。
- 条件查找和条件汇总依赖 Teable 返回值，CodingNS 不自己计算。
- 大表性能需要分页或虚拟滚动，不能一次渲染所有记录。

### 8.2 待确认项

- 当前 Teable 实例的单条更新 API 是否为 `PATCH /api/table/{tableId}/record/{recordId}`。
- view API 返回的 `calendar` 和 `kanban` 配置是否足够直接解析字段。
- Teable 当前版本 link 字段 options 中关联表 ID、单选/多选配置的实际字段名。
- 关联候选记录搜索是否能直接使用 Teable record search 参数。
- 日历拖拽和看板拖拽是否放在第一版还是第二版。
