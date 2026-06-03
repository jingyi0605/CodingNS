# 设计文档 - ONLYOFFICE 文档预览与编辑接入

状态：Draft

## 1. 概述

### 1.1 目标

- 把 ONLYOFFICE 做成可选集成，不污染默认安装
- 继续复用现有 `FileViewerPanel`，不重做 Office 专用壳层
- 同时打通工作区文件和事务文档库两条 Office 预览链路
- 让部署者能自己配置服务地址和回调地址，兼容本机与外部部署

### 1.2 覆盖需求

- `requirements.md` 需求 1
- `requirements.md` 需求 2
- `requirements.md` 需求 3
- `requirements.md` 需求 4

### 1.3 技术约束

- 后端：Fastify + SQLite
- 前端：React + `apps/user-app`
- 数据存储：Host SQLite
- 认证授权：现有登录态保护设置接口；ONLYOFFICE 回调改为受控 token 校验
- 外部依赖：ONLYOFFICE Docs / Document Server

## 2. 架构

### 2.1 系统结构

整体分三块：

1. **配置与检测**
   - 设置页读取 / 保存 ONLYOFFICE 配置
   - Host 探测 `healthcheck` 和 `api.js`
2. **预览接入**
   - 工作区文件预览链路识别 `docx / xlsx / pptx`
   - 事务文档库预览链路同步识别这三类文件
   - Host 返回 ONLYOFFICE 启动配置，前端在 `FileViewerPanel` 里嵌入编辑器
3. **保存回写**
   - Host 为每次打开生成回调 token
   - ONLYOFFICE 保存后回调 Host
   - Host 下载编辑结果并写回原文件

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `OnlyOfficeIntegrationService` | 管配置、做检测、生成编辑器配置、处理回调 | 设置输入、文件定位信息、ONLYOFFICE 回调体 | 设置视图、状态结果、预览配置、写回结果 |
| `FilePreviewService / AffairsLibraryService` | 识别 Office 文件，返回 `office` 预览类型 | 文件路径 | `FilePreviewResult` |
| `FileController / AffairsLibraryController` | 在原预览响应上补 ONLYOFFICE 配置 | 预览请求 | 带 `onlyOffice` 配置的预览 DTO |
| `FileViewerPanel` | 继续复用查看器壳层，渲染 ONLYOFFICE 内容区 | `FilePreviewDto` | 嵌入式 Office 预览界面 |
| `SkillManagementPanel` | 展示开关、地址输入、检测状态 | 用户输入 | 配置保存与状态反馈 |

### 2.3 关键流程

#### 2.3.1 保存与检测 ONLYOFFICE 配置

1. 用户在 `office` 设置页填写开关、ONLYOFFICE 地址、CodingNS 对外地址、回调地址和可选 JWT 密钥。
2. 前端调用 `GET /api/office/onlyoffice/settings` 读取当前配置，调用 `PUT /api/office/onlyoffice/settings` 保存更新。
3. Host 规范化 URL，保存到 SQLite。
4. 前端或保存后自动调用 `GET /api/office/onlyoffice/status`。
5. Host 依次检测 `healthcheck`、`api.js`，并返回 ready / warning / error / disabled 状态和说明。

#### 2.3.2 工作区 Office 文件预览

1. 用户在工作区里打开 `docx / xlsx / pptx`。
2. `FilePreviewService` 返回 `kind = office`。
3. `FileController.preview()` 读取 ONLYOFFICE 配置。
4. Host 为该文件生成受控文件 URL、回调 token 和 ONLYOFFICE 编辑器配置。
5. 前端 `FileViewerPanel` 命中 `office` 分支，加载 ONLYOFFICE `api.js` 并实例化编辑器。

#### 2.3.3 事务文档库 Office 文件预览

1. 用户在事务文档库里打开 `docx / xlsx / pptx`。
2. `AffairsLibraryService.previewDocument()` 返回 `kind = office`。
3. `AffairsLibraryController.previewDocument()` 复用同一套 ONLYOFFICE 集成服务生成配置。
4. 前端仍使用 `FileViewerPanel + previewLoader`，只换数据源，不换壳。

#### 2.3.4 ONLYOFFICE 回调保存

1. ONLYOFFICE 通过回调 URL 调用 CodingNS。
2. Host 校验回调 token，解析目标文件来源（workspace / affairs）、workspaceId、path。
3. 当回调状态表示需要落盘时，Host 下载结果文件。
4. Host 把文件覆盖写回目标路径。
5. Host 返回 ONLYOFFICE 约定的 `{"error":0}`。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4

- `OnlyOfficeIntegrationService`：唯一的 ONLYOFFICE 配置、探测、预览配置、回调落盘入口
- `OfficeOnlyOfficeSettingRepository`：保存全局 ONLYOFFICE 配置
- `FileViewerPanel` 新增 `office` viewer 分支：只负责嵌入显示，不接管本地文本保存逻辑

### 3.2 数据结构

覆盖需求：1、2、3、4

#### 3.2.1 `OfficeOnlyOfficeSettingRecord`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `singletonKey` | `string` | 是 | 单例配置主键 | 固定 `default` |
| `enabled` | `boolean` | 是 | 是否启用 ONLYOFFICE | - |
| `serverUrl` | `string \| null` | 否 | ONLYOFFICE 服务地址 | 绝对 URL |
| `publicBaseUrl` | `string \| null` | 否 | CodingNS 对外地址 | 绝对 URL |
| `callbackBaseUrl` | `string \| null` | 否 | ONLYOFFICE 回调基地址 | 绝对 URL，可为空 |
| `jwtSecret` | `string \| null` | 否 | ONLYOFFICE JWT 密钥 | 可为空 |
| `createdAt` | `string` | 是 | 创建时间 | ISO 时间 |
| `updatedAt` | `string` | 是 | 更新时间 | ISO 时间 |

#### 3.2.2 `OnlyOfficePreviewConfig`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `apiScriptUrl` | `string` | 是 | ONLYOFFICE `api.js` 地址 | 从 `serverUrl` 派生 |
| `documentType` | `word \| cell \| slide` | 是 | 编辑器文档类型 | 按扩展名映射 |
| `fileType` | `string` | 是 | 原始扩展名 | 小写不带点 |
| `documentTitle` | `string` | 是 | 显示名称 | 文件名 |
| `documentKey` | `string` | 是 | 文档稳定键 | 来自文件路径 + 版本摘要 |
| `documentUrl` | `string` | 是 | ONLYOFFICE 拉文件用的受控 URL | 必须可被服务访问 |
| `callbackUrl` | `string` | 是 | 保存回调地址 | 必须可被服务访问 |
| `editorMode` | `edit \| view` | 是 | 是否允许编辑 | 由来源和配置决定 |
| `token` | `string \| null` | 否 | ONLYOFFICE JWT | 配了密钥才生成 |

### 3.3 接口契约

覆盖需求：1、2、3、4

#### 3.3.1 读取 ONLYOFFICE 配置

- 类型：HTTP
- 路径：`GET /api/office/onlyoffice/settings`
- 输入：登录态
- 输出：当前配置、是否已配置 JWT、更新时间
- 校验：无
- 错误：未登录返回 401

#### 3.3.2 保存 ONLYOFFICE 配置

- 类型：HTTP
- 路径：`PUT /api/office/onlyoffice/settings`
- 输入：`enabled / serverUrl / publicBaseUrl / callbackBaseUrl / jwtSecret / clearJwtSecret`
- 输出：保存后的配置视图
- 校验：URL 必须是绝对地址；启用状态下缺关键字段要报错
- 错误：`INVALID_INPUT`

#### 3.3.3 检查 ONLYOFFICE 状态

- 类型：HTTP
- 路径：`GET /api/office/onlyoffice/status`
- 输入：登录态
- 输出：`disabled / ready / warning / error`，以及每一项检测细节
- 校验：无
- 错误：外部请求失败时返回 `error` 状态而不是 500

#### 3.3.4 ONLYOFFICE 回调

- 类型：HTTP
- 路径：`POST /api/office/onlyoffice/callback/:token`
- 输入：ONLYOFFICE 回调体
- 输出：`{"error":0}`
- 校验：token 必须合法且未过期
- 错误：无效 token 返回 401；无法写回返回 `{"error":1}`

## 4. 数据与状态模型

### 4.1 数据关系

- ONLYOFFICE 设置是全局单例，不按 workspace 拆多份
- 工作区文件预览和事务文档库预览都依赖同一份设置
- 每次打开 Office 文件都会生成：
  - 一个受控文件 URL
  - 一个受控回调 token
  - 一份 ONLYOFFICE 编辑器配置

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `disabled` | 未开启 ONLYOFFICE | `enabled=false` | 打开开关并保存 |
| `misconfigured` | 已开启但关键信息没填全 | 缺地址或 URL 非法 | 补齐配置 |
| `ready` | 检测通过，可以使用 | `healthcheck` 和 `api.js` 均可访问 | 服务不可达或配置改坏 |
| `warning` | 基础可访问，但存在部署风险 | 比如外部服务配 `localhost` 回调 | 用户调整地址 |
| `error` | 探测失败 | 服务地址不可访问或返回异常 | 服务恢复或修正地址 |

## 5. 错误处理

### 5.1 错误类型

- `ONLYOFFICE_DISABLED`：未启用 ONLYOFFICE
- `ONLYOFFICE_MISCONFIGURED`：配置缺失或格式不对
- `ONLYOFFICE_STATUS_CHECK_FAILED`：服务地址可达性检查失败
- `ONLYOFFICE_CALLBACK_TOKEN_INVALID`：回调 token 非法或过期
- `ONLYOFFICE_CALLBACK_SAVE_FAILED`：回调下载或写回失败

### 5.2 错误响应格式

```json
{
  "detail": "用户能看懂的错误说明",
  "error_code": "ONLYOFFICE_MISCONFIGURED",
  "field": "serverUrl",
  "timestamp": "2026-06-03T00:00:00Z"
}
```

### 5.3 处理策略

1. 输入验证错误：直接返回字段级错误
2. 服务地址检查失败：状态接口返回 `error` 结果，不把页面打崩
3. 回调 token 非法：拒绝写回
4. 回调下载失败：返回 `{"error":1}` 给 ONLYOFFICE，并记录日志

## 6. 正确性属性

### 6.1 属性 1：不开启不影响旧链路

*对于任何* 未启用 ONLYOFFICE 的实例，系统都应该满足：已有 `HTML / 图片 / PDF / 文本` 预览行为不变，Office 文件只得到明确不可用提示。

**验证需求：** 需求 1、需求 3

### 6.2 属性 2：回调只能写回绑定文件

*对于任何* ONLYOFFICE 回调请求，系统都应该满足：只有合法 token 绑定的目标文件会被覆盖，不能通过篡改 body 把内容写到其他路径。

**验证需求：** 需求 3、需求 4

## 7. 测试策略

### 7.1 单元测试

- ONLYOFFICE 设置规范化和状态探测
- 文件扩展名到 `documentType` 的映射
- 回调 token 生成与校验

### 7.2 集成测试

- 设置接口读写与状态检查
- 工作区 `docx / xlsx / pptx` 预览响应补齐 ONLYOFFICE 配置
- ONLYOFFICE 回调把文件写回原路径

### 7.3 端到端测试

- `FileViewerModal` 命中 `office` 分支后能加载 DocEditor
- `SkillManagementPanel` 能保存 ONLYOFFICE 配置并展示状态

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.3.1、§3.3.1、§3.3.2 | Host 集成测试 + 前端设置页测试 |
| `requirements.md` 需求 2 | `design.md` §2.3.1、§4.2、§5.3 | Host 集成测试 |
| `requirements.md` 需求 3 | `design.md` §2.3.2、§2.3.4、§6.2 | Host 文件预览测试 + FileViewerModal 测试 |
| `requirements.md` 需求 4 | `design.md` §2.3.3、§2.3.4、§6.2 | Host 事务预览测试 + 复用 viewer 测试 |

## 8. 风险与待确认项

### 8.1 风险

- 外部 ONLYOFFICE 服务无法访问 `localhost` 回调地址时，会出现“能打开但不能保存”
- 某些部署默认开启 JWT，如果用户没填密钥，编辑器可能直接拒绝加载
- ONLYOFFICE 回调依赖外部网络可达性，纯前端验证无法完全证明外部一定能打回

### 8.2 待确认项

- 第一轮是否只支持 `docx / xlsx / pptx`，还是顺手放开 `doc / xls / ppt`
- 回调保存时是否需要做更严格的版本冲突保护
