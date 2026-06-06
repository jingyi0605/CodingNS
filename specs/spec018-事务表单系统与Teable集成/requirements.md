# 需求文档 - spec018-事务表单系统与Teable集成

状态：Ready

## 简介

`CodingNS` 需要使用 `Teable` 的表能力来承载结构化数据，但不再把 Teable 原生页面嵌进事务工作台。

这次要解决的是三件事：

1. 在 `CodingNS` 里全局配置一个 Teable 实例。
2. 把本地标签、会话记录、代办同步到 Teable 指定表。
3. 让用户在设置里配置同步范围、字段映射，并查看同步日志。

已经放弃的方向也明确写在这里：

- 不做事务工作台 Teable iframe 块。
- 不做 Teable 分享页 Host 代理。
- 不做表单分享页嵌入和新建记录弹窗。
- 后续如果要展示或编辑 Teable 表数据，使用 Teable API 做 CodingNS 自己的前端页面。

## 术语表

- **System**：当前 `CodingNS` 系统，包含 `apps/host`、`apps/user-app` 和事务工作台。
- **Teable**：外部自部署表格系统，本阶段只使用它的表、字段和基础 API。
- **全局绑定**：整个事务工作台共享的一套 Teable 连接配置。
- **镜像表**：CodingNS 把本地真源数据同步到 Teable 后形成的目标表。
- **字段映射**：CodingNS 源字段和 Teable 目标字段之间的对应关系。
- **同步日志**：Host 保存的同步任务执行记录。

## 范围说明

### In Scope

- 工作台级全局 Teable 连接配置。
- 允许局域网 `http://` Teable 地址。
- 读取 Teable 已有表和字段。
- 在 Teable 指定表中按需创建字段。
- 标签、会话记录、代办三类数据的单向同步。
- 同步范围配置。
- 图形化字段映射。
- 手动同步。
- 本地变化触发同步。
- 同步日志查看。

### Out of Scope

- Teable AI。
- Teable Automation。
- Teable App Builder。
- 把 Teable 原生页面嵌入事务工作台。
- Host 代理 Teable 分享页。
- 通过 Teable 分享页创建记录。
- Teable 表单结果回流到 CodingNS。
- 第一阶段做复杂双向同步。

## 需求

### 需求 1：事务工作台必须能全局绑定一个 Teable 实例

**用户故事：** 作为事务工作台用户，我希望给整个事务工作台配置一个 Teable 站点，这样所有同步配置都使用同一个 Teable 实例，而不是每个工作区各配一份。

#### 验收标准

1. WHEN 用户在设置里开启 Teable 集成 THEN System SHALL 保存 Teable 地址、空间 ID、Base ID、认证信息和启用状态。
2. WHEN 当前还没有绑定 Teable THEN System SHALL 显示未绑定状态，不展示假数据。
3. WHEN 配置无效、站点不可达或认证失效 THEN System SHALL 返回明确错误，并且不影响本地数据。
4. WHEN Teable 与 Host 在同一局域网 THEN System SHALL 允许保存 `http://` 地址。

### 需求 2：设置页必须能添加需要同步的 Teable 表

**用户故事：** 作为设置维护者，我希望手动选择哪些 Teable 表作为同步目标，而不是让系统把当前 Base 下所有表都列成同步对象。

#### 验收标准

1. WHEN 用户进入 Teable 设置 THEN System SHALL 提供“连接设置”和“表同步设置”两个主要标签页，并提供同步日志入口。
2. WHEN 用户在“表同步设置”里添加目标表 THEN System SHALL 把添加后的表显示在左侧列表里。
3. WHEN 用户选中一张同步表 THEN System SHALL 在右侧显示这张表的同步内容、范围和字段映射。
4. WHEN 用户没有添加某张表 THEN System SHALL 不把它当成同步目标。

### 需求 3：会话记录同步必须支持全部工作区或指定工作区

**用户故事：** 作为设置维护者，我希望同步会话记录时可以选全部工作区，也可以只选指定工作区，并且同步后的记录能看出属于哪个工作区。

#### 验收标准

1. WHEN 用户配置会话同步 THEN System SHALL 支持“全部工作区”和“指定工作区”两种范围。
2. WHEN 会话同步到 Teable THEN System SHALL 带上工作区 ID 和工作区名称。
3. WHEN 用户选择指定工作区 THEN System SHALL 只处理被选中的工作区。

### 需求 4：标签同步必须只从事务文档库标签入口读取

**用户故事：** 作为设置维护者，我希望选择文档库根标签时只看到事务文档库里的标签树，不要因为每个代码工作区都读一遍导致重复。

#### 验收标准

1. WHEN 用户配置标签同步 THEN System SHALL 只从事务模式文档库标签入口读取根标签。
2. WHEN 用户选择一个根标签 THEN System SHALL 同步该根标签下全部子标签。
3. WHEN 标签树变化 THEN System SHALL 在下一次同步中同步新增、改名、删除和父子关系变化。

### 需求 5：代办同步必须覆盖工作区代办和事务模式代办

**用户故事：** 作为设置维护者，我希望代办同步能覆盖普通工作区代办和事务模式代办，并且可以按工作区范围控制。

#### 验收标准

1. WHEN 用户启用代办同步 THEN System SHALL 支持同步工作区代办和事务模式代办。
2. WHEN 代办同步到 Teable THEN System SHALL 带上来源类型，至少能区分 `workspace` 和 `affairs`。
3. WHEN 用户选择指定工作区 THEN System SHALL 只同步范围内的工作区代办，事务模式代办按事务来源规则处理。

### 需求 6：字段映射必须能手动配置，也能自动建字段

**用户故事：** 作为设置维护者，我希望可以手动把 CodingNS 字段映射到 Teable 字段；如果目标表缺字段，也可以让系统帮我创建字段并自动映射。

#### 验收标准

1. WHEN 用户配置同步表 THEN System SHALL 提供图形化字段映射界面。
2. WHEN 用户点击“添加字段并自动映射” THEN System SHALL 打开单独弹窗，让用户勾选需要创建的字段。
3. WHEN Teable 字段创建成功 THEN System SHALL 把新字段写入当前映射草稿。
4. WHEN 目标字段缺失、重复或类型不支持 THEN System SHALL 给出明确提示。

### 需求 7：同步必须从 CodingNS 端触发并记录日志

**用户故事：** 作为维护者，我希望同步由 CodingNS 主动推送到 Teable，并且每次同步都有日志可查。

#### 验收标准

1. WHEN 用户手动触发同步 THEN System SHALL 把同步任务放入 TaskManager。
2. WHEN 本地标签、会话或代办发生变化且已开启本地变化自动同步 THEN System SHALL 自动触发同步任务。
3. WHEN 同步开始、成功、部分失败或失败 THEN System SHALL 写入同步日志。
4. WHEN 用户打开同步日志 THEN System SHALL 能看到触发方式、同步内容、状态、数量统计和错误摘要。

### 需求 8：事务工作台不再显示 Teable 嵌入块

**用户故事：** 作为用户，我不希望事务工作台继续展示不稳定的 Teable 分享页 iframe。我只希望设置页保留同步配置，后续再用 CodingNS 自己的前端做展示和编辑。

#### 验收标准

1. WHEN 用户打开事务工作台添加块面板 THEN System SHALL 不再显示 Teable 嵌入块。
2. WHEN 本地历史状态里残留 Teable 块 THEN System SHALL 在状态归一化时丢弃它，不再渲染。
3. WHEN 前端代码编译 THEN System SHALL 不再依赖 `AffairsTeableFormBlock`。
4. WHEN Host 启动 THEN System SHALL 不再注册 Teable 分享页代理路由。

### 需求 9：旧接口要清楚废弃，不要假装还能用

**用户故事：** 作为维护者，我希望旧的表单接入和分享页接口要么移除，要么返回清楚的废弃提示，避免后续继续沿着错误路线开发。

#### 验收标准

1. WHEN 调用旧的 `GET /api/affairs/teable/forms` 或 `POST /api/affairs/teable/forms` THEN System SHALL 返回 `410 Gone`。
2. WHEN 搜索前端 API THEN System SHALL 不再看到 `form-catalog`、`form-bindings`、`view-proxy-link` 的调用封装。
3. WHEN 搜索 Host 路由 THEN System SHALL 不再看到 `teable-view` 分享页代理入口。

## 非功能需求

### 性能

1. WHEN 执行同步 THEN System SHALL 通过镜像记录映射和 fingerprint 跳过未变化记录，不默认全量重刷。
2. WHEN 读取设置状态 THEN System SHALL 只读状态，不顺手启动同步任务。

### 可靠性

1. WHEN Teable 不可达、超时或认证失效 THEN System SHALL 记录失败原因，并允许用户重试。
2. WHEN 同步任务中断 THEN System SHALL 保留日志，方便下一次重试。

### 可维护性

1. WHEN 后续增加新的同步数据类型 THEN System SHALL 复用表同步配置、字段映射和 TaskManager。
2. WHEN 后续要做 Teable 数据展示或编辑 THEN System SHALL 新建 CodingNS 自定义前端，不复活 iframe 分享页方案。

## 成功定义

- 可以保存和测试全局 Teable 连接。
- 可以选择 Teable 已有表作为镜像同步目标。
- 可以配置标签、会话记录、代办的同步范围。
- 可以手动映射字段，也可以自动创建字段并映射。
- 可以手动同步，也可以在本地变化后自动触发同步。
- 可以在设置页查看同步日志。
- 事务工作台添加块面板不再出现 Teable 嵌入块。
- Host 不再代理 Teable 分享页。
