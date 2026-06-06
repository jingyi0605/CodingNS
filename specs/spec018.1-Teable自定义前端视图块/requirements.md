# 需求文档 - spec018.1-Teable自定义前端视图块

状态：Draft

## 简介

`spec018` 已经把 Teable 接成设置能力：连接、表同步、字段映射、同步日志都在设置里管理。

现在要做的是工作台画布里的展示和编辑能力：

**用户在事务工作台添加一个 Teable 块，选择 Teable 表和视图，然后 CodingNS 用自己的前端组件展示表格、表单、日历或看板。**

这次不再嵌入 Teable 分享页。浏览器只访问 CodingNS Host，Host 再调用 Teable API。

## 术语表

- **System**：CodingNS。
- **Teable 块**：事务工作台画布里的一个块，用 CodingNS 自定义前端显示 Teable 数据。
- **Teable runtime API**：Host 提供给前端的运行时接口，负责读取 Teable 表、视图、字段和记录。
- **表格视图**：按行列显示 Teable 记录。
- **表单视图**：根据 Teable 字段生成 CodingNS 自定义表单，用来创建记录。
- **日历视图**：按日期字段把记录显示到日历上。
- **看板视图**：按单选等分组字段把记录显示成卡片列。
- **记录详情抽屉**：点击记录后打开的详情编辑面板，表格、日历、看板共用。

## 范围说明

### In Scope

- 工作台添加 Teable 块。
- 添加块时选择 Teable 表和视图。
- Host runtime API 读取表、视图、字段、记录。
- 表格视图展示、分页、刷新、打开详情。
- 表单视图创建记录。
- 日历视图按日期字段展示记录。
- 看板视图按分组字段展示记录。
- 记录详情抽屉支持编辑和删除记录。
- 字段渲染和基础字段编辑器。
- 关联字段的下拉选择显示：从关联表读取候选记录，按字段设置支持单选或多选。
- 公式、查找、条件查找、汇总、条件汇总字段只读显示，并通过刷新拿 Teable 计算后的值。
- 块内只管理展示配置，不管理镜像同步配置。

### Out of Scope

- 不恢复 iframe。
- 不代理 Teable 分享页。
- 不把 Teable token 暴露给前端。
- 不复刻 Teable 全部高级表格能力。
- 第一版不做复杂公式编辑、附件上传、批量操作。
- 第一版不做 Teable 自动化、AI、插件视图。
- 不改变 `spec018` 的表同步和字段映射设置页主链路。

## 需求

### 需求 1：工作台必须能添加 Teable 自定义视图块

**用户故事：** 作为事务工作台用户，我希望能在画布里添加 Teable 块，并选择一个 Teable 表和视图，这样可以直接在工作台里查看结构化数据。

#### 验收标准

1. WHEN 用户打开添加块面板 THEN System SHALL 提供 Teable 块入口。
2. WHEN 用户选择 Teable 块 THEN System SHALL 要求先选择 Teable 表，再选择该表下的视图。
3. WHEN Teable 连接不可用 THEN System SHALL 显示清楚错误，并提供去设置页的入口。
4. WHEN 用户添加成功 THEN System SHALL 在画布中保存表 ID、视图 ID、视图类型和块标题。

### 需求 2：表格视图必须能展示和编辑 Teable 记录

**用户故事：** 作为用户，我希望 Teable 表格视图在 CodingNS 里像普通工作台块一样显示记录，并能打开记录详情进行编辑。

#### 验收标准

1. WHEN Teable 块选择表格视图 THEN System SHALL 以表格方式显示记录。
2. WHEN 记录很多 THEN System SHALL 支持分页或虚拟滚动，不一次性渲染全部 DOM。
3. WHEN 用户点击记录 THEN System SHALL 打开记录详情抽屉。
4. WHEN 用户保存修改 THEN System SHALL 通过 Host 更新 Teable 记录，并刷新当前块。
5. WHEN 用户删除记录 THEN System SHALL 二次确认后删除，并刷新当前块。

### 需求 3：表单视图必须使用 CodingNS 自定义表单创建记录

**用户故事：** 作为用户，我希望表单视图不是打开 Teable 分享页，而是在 CodingNS 里直接填写字段并创建记录。

#### 验收标准

1. WHEN Teable 块选择表单视图 THEN System SHALL 根据 Teable 字段生成表单。
2. WHEN 字段不可写或是计算字段 THEN System SHALL 不把它作为可编辑输入项。
3. WHEN 用户提交表单 THEN System SHALL 调用 Host 创建 Teable 记录。
4. WHEN 创建成功 THEN System SHALL 显示成功反馈，并按块配置清空表单或关闭弹窗。
5. WHEN 创建失败 THEN System SHALL 显示具体错误，不吞掉 Teable 返回的失败原因。

### 需求 4：日历视图必须按日期字段展示记录

**用户故事：** 作为用户，我希望能把 Teable 记录按日期显示到日历上，例如客户跟进、项目里程碑或待办日期。

#### 验收标准

1. WHEN Teable 块选择日历视图 THEN System SHALL 确定开始日期字段。
2. WHEN Teable 视图配置里没有可用日期字段 THEN System SHALL 让用户在块设置里手动选择。
3. WHEN 用户点击日历事件 THEN System SHALL 打开记录详情抽屉。
4. WHEN 用户点击某一天新建记录 THEN System SHALL 打开表单，并预填开始日期字段。
5. 第一版 MAY 只支持月视图；周视图和拖拽改日期可以后续做。

### 需求 5：看板视图必须按字段分组展示记录

**用户故事：** 作为用户，我希望可以把 Teable 记录按状态、阶段等字段分成看板列，并在工作台里查看和编辑。

#### 验收标准

1. WHEN Teable 块选择看板视图 THEN System SHALL 确定分组字段。
2. WHEN Teable 视图配置里没有可用分组字段 THEN System SHALL 让用户手动选择单选字段作为分组字段。
3. WHEN 用户点击卡片 THEN System SHALL 打开记录详情抽屉。
4. WHEN 用户在某列新建记录 THEN System SHALL 预填分组字段。
5. 第一版 SHOULD 先支持 `singleSelect` 分组；拖拽改分组可以作为第二阶段能力。

### 需求 6：字段渲染和编辑必须尊重 Teable 字段权限

**用户故事：** 作为用户，我希望可以编辑普通字段；关联字段可以从关联表里选择记录；公式、查找、汇总和系统字段只读显示，避免保存失败或破坏数据。

#### 验收标准

1. WHEN 字段是 `isComputed=true` THEN System SHALL 只读显示。
2. WHEN 字段没有创建或更新权限 THEN System SHALL 不显示为可编辑输入项。
3. WHEN 字段类型是文本、数字、日期、单选、多选、布尔值 THEN System SHALL 提供对应基础编辑器。
4. WHEN 字段类型是关联字段 THEN System SHALL 从关联表读取候选记录，并按字段配置显示单选或多选下拉框。
5. WHEN 用户选择关联记录 THEN System SHALL 只提交关联记录 ID，不允许在 CodingNS 里修改关联字段的字段结构。
6. WHEN 字段是公式、查找、条件查找、汇总或条件汇总 THEN System SHALL 只读显示 Teable 已计算好的结果。
7. WHEN 关联字段、公式字段、查找字段或汇总字段依赖的数据变化 THEN System SHALL 通过刷新记录重新读取 Teable 计算后的值。
8. WHEN 字段类型暂不支持编辑 THEN System SHALL 只读显示，并给出“不支持编辑”的提示。

### 需求 7：关联字段必须支持候选记录选择

**用户故事：** 作为用户，我希望在 CodingNS 的表格或表单里给关联字段选择已有记录，这样多表格关联关系可以在工作台里正常使用。

#### 验收标准

1. WHEN 字段是 Teable 关联字段 THEN System SHALL 根据字段配置找到关联表。
2. WHEN 用户打开关联字段下拉框 THEN System SHALL 从关联表读取候选记录，并显示候选记录的主字段内容。
3. WHEN 关联字段配置为单选 THEN System SHALL 只允许选择一条关联记录。
4. WHEN 关联字段配置为多选 THEN System SHALL 允许选择多条关联记录。
5. WHEN 候选记录很多 THEN System SHALL 支持搜索和分页加载，不一次性加载全部候选。
6. WHEN 关联字段缺少关联表配置或读取失败 THEN System SHALL 显示明确错误，不让整个记录表单崩溃。

### 需求 8：公式、查找和汇总字段必须只读并自动刷新

**用户故事：** 作为用户，我希望公式、从关联表查找字段、条件查找、汇总和条件汇总都继续由 Teable 计算，CodingNS 只负责显示最新结果。

#### 验收标准

1. WHEN 字段是公式字段 THEN System SHALL 只读显示 Teable 返回的计算值。
2. WHEN 字段是 lookup、conditional lookup、rollup 或 conditional rollup THEN System SHALL 只读显示 Teable 返回的结果。
3. WHEN 用户创建或更新记录成功 THEN System SHALL 重新读取该记录或当前页记录，让计算字段显示最新值。
4. WHEN 用户手动刷新块 THEN System SHALL 重新读取记录并显示最新计算结果。
5. WHEN 计算结果为空 THEN System SHALL 显示空值状态，而不是显示原始 JSON。

### 需求 9：块内设置只管理展示，不管理同步

**用户故事：** 作为维护者，我希望 Teable 块只负责显示和编辑 Teable 记录，同步配置仍然在设置页里管理，避免画布再次变成后台配置页面。

#### 验收标准

1. WHEN 用户打开块设置 THEN System SHALL 只显示表、视图、标题、字段显示、密度等展示选项。
2. WHEN 用户需要配置镜像同步 THEN System SHALL 引导去 `设置 -> 能力管理 -> Teable 设置`。
3. WHEN 用户保存块设置 THEN System SHALL 不修改 `spec018` 的同步配置和字段映射。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 表格记录超过 100 条 THEN System SHALL 使用分页或虚拟滚动。
2. WHEN 多个 Teable 块引用同一表 THEN System SHOULD 复用缓存 key，避免重复请求。
3. WHEN 用户编辑单条记录 THEN System SHALL 只刷新必要数据，不强制刷新整个工作台。

### 非功能需求 2：可靠性

1. WHEN Teable API 失败 THEN System SHALL 显示块级错误，不让整个事务工作台白屏。
2. WHEN 字段配置缺失 THEN System SHALL 显示可操作的修复提示，例如“选择日期字段”。
3. WHEN 记录保存失败 THEN System SHALL 保留用户输入，方便重试。

### 非功能需求 3：安全

1. WHEN 前端读取 Teable 数据 THEN System SHALL 只请求 Host runtime API。
2. WHEN Host 调用 Teable THEN System SHALL 使用当前用户保存的 Teable 认证，不把 token 返回给前端。
3. WHEN 用户没有 Teable 连接或权限 THEN System SHALL 阻止读写记录。

## 成功定义

- 工作台可以添加 Teable 块。
- Teable 块可以选择表和视图。
- 表格视图可以显示、创建、编辑、删除记录。
- 关联字段可以通过下拉框选择关联表记录，支持单选和多选。
- 公式、查找、条件查找、汇总、条件汇总字段只读显示，并能通过刷新拿到最新计算结果。
- 表单视图可以创建记录。
- 日历视图可以按日期显示记录。
- 看板视图可以按字段分组显示记录。
- 所有 Teable 数据访问都走 Host，不再出现 iframe 和分享页代理。
