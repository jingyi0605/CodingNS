# 设计文档 - spec004.2-静态HTML演示文档编辑器与导出能力

状态：Draft

## 1. 概述

### 1.1 目标

- 在 CodingNS 文件管理里为静态 HTML 演示文档提供真正可编辑的 PPT 视图
- 用稳定的页面模型承接 HTML 导入、组件编辑、保存回写和导出
- 让编辑内核既能嵌入 CodingNS，也能单独打包
- 优先保证导出结果版式一致，再逐步提升内部结构语义化

### 1.2 覆盖需求

- `requirements.md` 需求 1：从文件管理打开静态 HTML 演示文档
- `requirements.md` 需求 2：识别稳定页面模型
- `requirements.md` 需求 3：逐页 PPT 视图编辑
- `requirements.md` 需求 4：文字和基础样式编辑
- `requirements.md` 需求 5：复制、移动和缩放
- `requirements.md` 需求 6：保存回单文件 HTML
- `requirements.md` 需求 7：导出 PDF
- `requirements.md` 需求 8：导出 PPTX
- `requirements.md` 需求 9：支持嵌入和独立打包
- `requirements.md` 需求 10：不破坏现有文件管理链路

### 1.3 与前置 Spec 的关系

- `spec004` 负责文件树、文件读写、文件搜索和文件上下文
- `spec004.1` 负责预览模态框和 HTML/PDF/图片的查看体验
- `spec004.2` 往前迈一步，做“静态 HTML 文档编辑器”，但仍然挂在 `spec004` 的文件管理边界内

一句人话：

`spec004.1` 解决“看”，`spec004.2` 解决“像 PPT 一样改”。

### 1.4 技术约束

- 后端：`Fastify + TypeScript`
- 前端：`React + TypeScript`
- 文件读写：继续走 `apps/host/src/modules/file/`
- 后台任务：新增导出任务必须遵守 `TaskManager` 规范
- 编辑内核：采用“自有壳 + 可视化编辑底座”的方式，不把第三方编辑器直接暴露给外层
- 第三方能力：
  - 可视化编辑底座优先采用 `GrapesJS`
  - `PDF` 导出优先采用浏览器渲染链路
  - `PPTX` 导出优先采用 `PptxGenJS`

## 2. 总体架构

### 2.1 系统结构

整体拆成五层，不要把所有逻辑塞进一个前端页面组件里。

1. **宿主入口层**
   - CodingNS 文件管理入口
   - 独立桌面应用入口
2. **编辑内核层**
   - 页面模型
   - 组件选择和操作
   - 编辑状态
3. **导入回写层**
   - HTML 识别
   - 页面模型生成
   - HTML 回写
4. **导出层**
   - PDF 导出
   - PPTX 导出
5. **宿主适配层**
   - 读文件
   - 保存文件
   - 导出结果落盘
   - 打开文件

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `HtmlPresentationProbe` | 判断一个 HTML 是否适合进入演示文档编辑器 | HTML 源码、文件路径 | 文档类型、页面识别结果、告警 |
| `DocumentProjectBuilder` | 把 HTML 转成内部页面模型 | HTML 源码、识别结果 | `DocumentProject` |
| `PresentationEditorKernel` | 管理页面切换、选区、组件操作、撤销重做、保存脏状态 | `DocumentProject`、用户操作 | 更新后的项目状态 |
| `HtmlProjectWriter` | 把项目状态回写成单文件 HTML | `DocumentProject`、原始 HTML | 新 HTML、警告 |
| `PdfExportService` | 通过渲染链路生成 PDF | HTML 或页面快照 | PDF 文件 |
| `PptxExportService` | 生成 PPTX | 页面快照、页面尺寸 | PPTX 文件 |
| `CodingNsEditorHostBridge` | 把内核接进 CodingNS 文件管理 | 工作区文件、保存/导出命令 | 宿主事件和结果 |
| `DesktopEditorHostBridge` | 把内核接进独立桌面外壳 | 本地文件路径、窗口命令 | 桌面端打开/保存/导出 |

### 2.3 关键流程

#### 2.3.1 从 CodingNS 文件管理进入编辑器

1. 用户在文件树中打开 HTML 文件。
2. Host 继续通过现有文件读取接口返回源码和版本信息。
3. 前端先用 `HtmlPresentationProbe` 判断文件是否符合演示文档模式。
4. 若符合，则进入静态 HTML 文档编辑器；若不符合，则保留普通 HTML 预览/源码编辑入口。
5. 编辑器把 HTML 转成内部页面模型后渲染第一页。

#### 2.3.2 编辑后保存回 HTML

1. 用户在画布中修改组件。
2. 编辑内核只更新内部项目状态，不直接在原始 DOM 上胡乱打补丁。
3. 用户保存时，`HtmlProjectWriter` 根据项目状态生成新 HTML。
4. 新 HTML 继续走现有 `saveFile` 和版本冲突保护链路。

#### 2.3.3 导出 PDF / PPTX

1. 用户触发导出。
2. 宿主层发起后台导出任务，而不是在 UI 主链路同步跑重任务。
3. 导出任务读取当前保存版或临时生成版 HTML。
4. `PdfExportService` 或 `PptxExportService` 生成导出文件。
5. 宿主层把结果写到目标路径，并把成功/失败结果回传前端。

## 3. 页面模型与编辑策略

### 3.1 为什么不能直接编辑原始 DOM

直接在任意 HTML 上做所见即所得编辑，坏处很明显：

- 任意节点都可能被脚本、选择器和布局关系牵一发动全身
- 复制和拖拽后，原始 CSS 选择器可能立刻失效
- 保存时很容易把 HTML 改成一团没人敢碰的垃圾

所以必须先把 HTML 收敛成一个可控页面模型。

### 3.2 内部页面模型

覆盖需求：1、2、3、4、5、6、9

#### 3.2.1 `DocumentProject`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | 当前编辑项目 ID | 会话内唯一 |
| `schemaVersion` | `number` | 是 | 页面模型版本 | 第一阶段固定为 `1` |
| `mode` | `"presentation" \| "report"` | 是 | 文档模式 | 第一阶段主做 `presentation` |
| `source` | `DocumentSource` | 是 | 来源信息 | 不能与 CodingNS 宿主强耦合 |
| `viewport` | `{ width: number; height: number }` | 是 | 默认页面尺寸 | 演示文档固定比例 |
| `pages` | `DocumentPage[]` | 是 | 页面列表 | 至少 1 页 |
| `assets` | `DocumentAsset[]` | 否 | 资源清单 | 图片等外部引用 |
| `warnings` | `string[]` | 否 | 导入阶段警告 | 供 UI 提示 |

#### 3.2.2 `DocumentPage`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | 页面 ID | 稳定标识 |
| `title` | `string` | 否 | 页面标题 | 可空 |
| `order` | `number` | 是 | 页面顺序 | 从 0 开始 |
| `frame` | `{ width: number; height: number; background: string \| null }` | 是 | 页面框架 | 固定尺寸 |
| `rootNodeId` | `string` | 是 | 根组件 ID | 指向组件树 |
| `sourceRef` | `SourceRef` | 是 | 对应原 HTML 页面锚点 | 不能只靠单个选择器 |

#### 3.2.3 `DocumentNode`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | 组件 ID | 项目内唯一 |
| `type` | `"group" \| "text" \| "image" \| "shape" \| "html" \| "svg" \| "decoration"` | 是 | 组件类型 | 第一阶段先收敛并保留只读类型 |
| `name` | `string` | 否 | 组件显示名 | 供图层面板使用 |
| `editable` | `boolean` | 是 | 是否允许直接编辑 | 默认显式声明 |
| `lockedReason` | `string \| null` | 否 | 锁定原因 | 锁定时必填 |
| `box` | `{ x: number; y: number; width: number; height: number; zIndex: number }` | 是 | 位置和尺寸 | 以页面坐标为准 |
| `text` | `string \| null` | 否 | 文本内容 | 仅文本组件 |
| `style` | `DocumentNodeStyle` | 是 | 基础样式 | 明确只收录白名单样式 |
| `children` | `string[]` | 否 | 子组件 ID 列表 | 容器类组件使用 |
| `sourceRef` | `SourceRef \| null` | 否 | 原 HTML 对应节点锚点 | 用于回写 |
| `patchStrategy` | `"text_only" \| "style_only" \| "text_and_style" \| "replace_node"` | 是 | 保存时采用的回写策略 | 第一阶段禁止默认整页替换 |

### 3.3 可编辑样式子集

第一阶段只开放高频、可控的样式，别把 CSS 全家桶全丢给用户。

| 样式项 | 支持情况 | 说明 |
| --- | --- | --- |
| 字体族 | 支持 | 仅对白名单字体开放 |
| 字号 | 支持 | 以像素为主 |
| 字重 | 支持 | 常见粗细档位 |
| 文字颜色 | 支持 | 直接色值 |
| 对齐 | 支持 | 左中右 |
| 行高 | 支持 | 基础数值 |
| 换行策略 | 支持 | 普通换行、保留换行 |
| 内边距 | 支持 | 仅常见 `padding` |
| 圆角 | 支持 | 仅像素值 |
| 边框颜色和宽度 | 支持 | 基础边框 |
| 背景色 | 支持 | 纯色为主 |
| 透明度 | 选做 | 第一阶段可延后 |
| 阴影、混合模式、滤镜 | 不做 | 容易引发导出不一致 |
| 动画、过渡、3D transform | 不做 | 只保留原始值，不开放直接编辑 |

补充硬规则：

- `DocumentNodeStyle` 是白名单样式子集，不是原始 CSS 全量镜像。
- 复杂 `transform` 不直接开放编辑；导入时优先换算为 `box`，换算不了的节点转为只读或受限编辑。
- 全局装饰层、翻页控件、运行态状态类不进入可编辑内容层。

### 3.4 编辑底座选型

使用策略不是“把 GrapesJS 整个 UI 搬出来”，而是：

- 用 `GrapesJS` 作为内部可视化编辑底座
- 自己做页缩略图、当前页切换、工具栏、导出入口和宿主桥
- 用自定义组件类型和样式面板收紧可编辑边界

这样做的原因很简单：

- 它已经具备组件、拖拽、缩放、复制、样式管理等底层能力
- 但它不是现成 PPT 编辑器，页面管理和宿主集成都要自己做

## 4. 导入、保存与导出

### 4.1 导入策略

覆盖需求：1、2、3、10

`HtmlPresentationProbe` 负责做三件事：

1. 判断文件是不是演示文档候选
2. 识别页面边界
3. 给出导入警告

第一阶段优先识别这些结构：

- `section.slide`
- `.slide`
- `[data-slide]`
- `body > .deck > *` 这类显式分页结构

如果页面边界不明确，就不强行进入编辑器。

补充硬规则：

- 导入顺序必须固定为：先判定候选文件，再识别分页，再过滤展示壳，最后做节点映射。
- 第一阶段优先支持初始 DOM 中静态存在的多页结构，不支持主要靠脚本运行后动态生成页面。
- 页内导入优先从主内容容器开始，自顶向下映射块级节点、文本节点、图片节点和只读复杂节点，不允许一开始把每个 `div/span` 都当独立可编辑节点。
- 翻页按钮、全局进度条、浮层提示、粒子背景、发光背景、运行态状态类默认不进入可编辑内容层。

### 4.2 回写策略

覆盖需求：4、5、6、10

保存回写必须遵守一个原则：

- **尽量补丁式回写，不做整份 HTML 大洗牌**

具体做法：

1. 导入时给可编辑节点建立稳定 `sourceRef`
2. 保存时优先修改对应节点的文本和内联样式
3. 对新增复制组件，用明确的 `data-cns-node-id` 标记
4. 对无法安全补丁回写的结构，允许整页重生成，但要只限于当前页

补充硬规则：

- 第一阶段默认只允许 `text_only`、`style_only`、`text_and_style`、`replace_node` 四类回写策略。
- 禁止把整份文档重生成作为默认保存方案。
- `SourceRef` 不能只依赖一个选择器字符串，必须至少能定位页面、同级顺序和节点路径。

### 4.3 PDF 导出

覆盖需求：7、9

第一阶段 PDF 导出用浏览器渲染链路，原因很现实：

- HTML 本来就是浏览器渲染结果
- 目标是“版式别跑”，不是把结构重新解释一遍

建议实现：

- 导出任务在后台生成临时 HTML 或直接使用当前保存版 HTML
- 用 `Playwright / Chromium print` 渲染分页 PDF

### 4.4 PPTX 导出

覆盖需求：8、9

第一阶段 `PPTX` 导出优先保证外观一致，不追求每个对象都还能在 PowerPoint 里自由编辑。

建议实现：

1. 每一页先渲染成高分辨率位图快照
2. 用 `PptxGenJS` 创建对应尺寸的幻灯片
3. 将页面快照整页铺满

这是最笨的方法，但靠谱。

如果强行在第一阶段把每个 DOM 节点翻译成 PPT 原生对象，最后大概率得到一份“理论上可编辑，实际上满屏错位”的垃圾。

### 4.5 导出任务必须走后台任务系统

覆盖需求：7、8、9

导出满足这些条件：

- 不是 HTTP 响应必须当场完成
- 同一文件会被重复触发
- 会消耗明显 CPU / I/O
- 需要超时、失败和结果观测

所以必须走 `TaskManager`。

建议任务类型：

- `presentation.export_pdf`
- `presentation.export_pptx`

建议 `key`：

- `${workspaceId}:${filePath}:pdf`
- `${workspaceId}:${filePath}:pptx`

## 5. 组件和接口

### 5.1 核心组件

覆盖需求：1 到 10

- `HtmlPresentationProbe`：判断 HTML 是否进入编辑器，并识别分页结构
- `DocumentProjectBuilder`：把 HTML 转成内部页面模型
- `PresentationEditorShell`：页导航、工具栏、属性面板、保存和导出入口
- `PresentationCanvasAdapter`：把页面模型映射到 GrapesJS 或等价编辑底座
- `HtmlProjectWriter`：把改动回写成 HTML
- `PresentationExportService`：统一调度 PDF/PPTX 导出
- `PresentationExportTaskService`：把导出任务注册到 `TaskManager`

### 5.2 数据结构

覆盖需求：2、4、5、6、7、8、9

#### 5.2.1 `PresentationEditorOpenPayload`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `workspaceId` | `string \| null` | 否 | CodingNS 工作区 ID | 独立桌面模式可空 |
| `path` | `string` | 是 | 文件路径 | 宿主负责校验 |
| `content` | `string` | 是 | HTML 源码 | UTF-8 文本 |
| `version` | `string \| null` | 否 | 文件版本 | CodingNS 模式下必带 |

#### 5.2.2 `ExportRequest`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `workspaceId` | `string \| null` | 否 | 工作区 ID | CodingNS 模式下必带 |
| `path` | `string` | 是 | 源文件路径 | 稳定标识 |
| `format` | `"pdf" \| "pptx"` | 是 | 导出格式 | 二选一 |
| `targetPath` | `string` | 是 | 导出目标路径 | 宿主负责校验 |
| `htmlContent` | `string` | 是 | 导出使用的 HTML 内容 | 以当前版本为准 |

### 5.3 接口契约

覆盖需求：1、6、7、8、9、10

#### 5.3.1 打开静态 HTML 文档编辑器

- 类型：Function / UI Action
- 标识：`openHtmlPresentationEditor`
- 输入：`PresentationEditorOpenPayload`
- 输出：前端编辑器实例状态
- 校验：
  - 文件必须是 HTML
  - 内容必须通过演示文档识别
- 错误：
  - `HTML_PRESENTATION_NOT_SUPPORTED`
  - `HTML_PRESENTATION_PARSE_FAILED`

#### 5.3.2 保存回 HTML

- 类型：HTTP / Function
- 路径或标识：复用现有 `saveFile`
- 输入：`path + content + expectedVersion`
- 输出：新版本号、更新时间
- 校验：
  - 版本冲突保护
  - 文件路径边界
- 错误：
  - `FILE_VERSION_CONFLICT`
  - `FILE_NOT_WRITABLE`

#### 5.3.3 发起导出任务

- 类型：HTTP
- 路径或标识：`POST /api/presentation-exports`
- 输入：`ExportRequest`
- 输出：任务 ID、当前状态
- 校验：
  - 导出格式必须为 `pdf / pptx`
  - 目标路径必须可写
- 错误：
  - `EXPORT_FORMAT_NOT_SUPPORTED`
  - `EXPORT_TARGET_INVALID`

#### 5.3.4 查询导出结果

- 类型：HTTP
- 路径或标识：`GET /api/presentation-exports/:taskId`
- 输入：任务 ID
- 输出：状态、结果路径、错误信息
- 校验：任务归属和权限
- 错误：
  - `EXPORT_TASK_NOT_FOUND`
  - `EXPORT_TASK_FAILED`

## 6. 数据与状态模型

### 6.1 数据关系

- 一个 `DocumentProject` 对应一个源 HTML 文件
- 一个 `DocumentProject` 包含多个 `DocumentPage`
- 一个 `DocumentPage` 通过 `rootNodeId` 关联一棵组件树
- 一个 `DocumentNode` 通过 `sourceRef` 指向原 HTML 里的节点或节点片段
- 一个导出任务对应一次 `pdf` 或 `pptx` 输出

### 6.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `idle` | 尚未打开文档 | 初始状态 | 打开文件 |
| `loading` | 正在识别和构建页面模型 | 用户打开文件 | 成功进入 `ready`，失败进入 `error` |
| `ready` | 文档可编辑 | 页面模型构建成功 | 用户修改进入 `dirty` |
| `dirty` | 有未保存修改 | 用户做出编辑 | 保存成功回到 `ready` |
| `saving` | 正在保存 | 用户触发保存 | 成功回到 `ready`，失败回到 `dirty` |
| `exporting` | 正在导出 | 用户触发导出 | 成功回到 `ready`，失败回到 `error` 或 `ready` |
| `error` | 当前操作失败 | 解析、保存或导出失败 | 用户重试或重新打开 |

## 7. 错误处理

### 7.1 错误类型

- `HTML_PRESENTATION_NOT_SUPPORTED`：HTML 不符合当前演示文档模式
- `HTML_PRESENTATION_PARSE_FAILED`：导入阶段无法构建页面模型
- `HTML_PROJECT_WRITE_FAILED`：保存回写失败
- `EXPORT_FORMAT_NOT_SUPPORTED`：请求了不支持的导出格式
- `EXPORT_RENDER_FAILED`：渲染导出失败
- `EXPORT_TARGET_INVALID`：导出目标路径不合法或不可写

### 7.2 错误响应格式

```json
{
  "detail": "当前 HTML 结构无法安全进入演示文档编辑器",
  "error_code": "HTML_PRESENTATION_NOT_SUPPORTED",
  "field": "path",
  "timestamp": "2026-05-15T00:00:00Z"
}
```

### 7.3 处理策略

1. 识别失败：允许退回普通 HTML 预览或源码编辑，不堵死用户。
2. 回写失败：保留内存中的未保存状态，提示用户重新保存或导出临时副本。
3. 导出失败：保留原文件和当前编辑状态，不允许半写入覆盖已有导出文件。
4. 后台任务异常：记录任务失败状态和错误阶段，不允许在 UI 侧只显示“失败”两个字。

## 8. 正确性属性

### 8.1 属性 1：未编辑页面不应被无意义重写

*对于任何* 只修改部分页面或部分组件的保存操作，系统都应该满足：未改动页面的 HTML 结构应尽量保持稳定，避免整份文件大面积无意义改写。

**验证需求：** 需求 6、需求 10

### 8.2 属性 2：导出优先不跑版

*对于任何* 成功完成的 `PDF / PPTX` 导出，系统都应该满足：页面尺寸、组件位置和主要文字大小的一致性优先于导出结构的可编辑性。

**验证需求：** 需求 7、需求 8

## 9. 测试策略

### 9.1 单元测试

- 页面识别和分页规则
- HTML 页面模型构建
- 样式子集映射
- HTML 回写补丁逻辑
- 导出请求参数校验

### 9.2 集成测试

- 从文件读取到进入编辑器的宿主桥接
- 保存回 HTML 与版本冲突保护
- 导出任务注册、去重、状态查询
- PDF/PPTX 导出结果文件落盘

### 9.3 端到端测试

- 用样板 HTML 打开、编辑、保存、再次打开复查
- 多页切换、复制组件、拖拽和缩放
- 导出 PDF 并核对分页和版式
- 导出 PPTX 并核对页面顺序和版面尺寸

### 9.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1、2、3 | `design.md` §2.3、§3.2、§4.1 | 样板 HTML 打开测试、分页识别测试 |
| `requirements.md` 需求 4、5、6 | `design.md` §3.3、§4.2、§5.3 | 组件编辑测试、保存回写测试 |
| `requirements.md` 需求 7、8 | `design.md` §4.3、§4.4、§4.5 | 导出任务测试、导出产物人工核对 |
| `requirements.md` 需求 9、10 | `design.md` §2.1、§5.1、§5.3 | 宿主桥接测试、旧链路回归测试 |

## 10. 风险与待确认项

### 10.1 风险

- 样板 HTML 风格虽然相似，但并不是严格统一模板，导入规则过松会导致编辑结果不稳定。
- `PPTX` 若要完全语义化导出，范围会明显超出本轮；必须接受第一阶段以位图化页面保底。
- 浏览器渲染导出依赖本地运行环境，字体缺失或平台差异可能造成轻微视觉偏差。
- GrapesJS 适合做底座，但不是现成 PPT 编辑器，页面管理、宿主适配和样式约束都要自己做。

### 10.2 待确认项

- 第一阶段是否只支持桌面端进入编辑器，还是同步开放 H5 入口。
- 报告文档模式是否与演示文档模式同一期落交互，还是先只打通演示文档模式。
- 导出目标路径在 CodingNS 桌面端和移动端是否需要不同宿主交互。
