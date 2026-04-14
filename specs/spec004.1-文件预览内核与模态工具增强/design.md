# 设计文档 - spec004.1-文件预览内核与模态工具增强

状态：Draft

## 1. 概述

### 1.1 目标

- 为 `TXT / PDF / 图片` 提供正式的内置预览能力
- 把当前预览返回模型从“文本 / 二进制”升级成可扩展的预览类型模型
- 强化 `FileViewerModal`，支持调整尺寸
- 让工具按钮按文件格式切换，而不是继续所有格式共用一套
- 给未来 `Office / 插件化预览` 留扩展位，但不在本轮实现

### 1.2 覆盖需求

- `requirements.md` 需求 1：常用格式内置预览
- `requirements.md` 需求 2：统一预览类型模型
- `requirements.md` 需求 3：模态框支持调整尺寸
- `requirements.md` 需求 4：按格式展示工具按钮
- `requirements.md` 需求 5：不破坏现有查看和保存行为
- `requirements.md` 需求 6：预留扩展接口
- `requirements.md` 需求 7：本地安全边界和性能下限

### 1.3 与 spec004 的关系

- `spec004` 负责文件管理主链路和基础预览能力
- `spec004.1` 不重做文件管理，只专门增强“查看器内核”和“查看器壳”

一句话：

`spec004` 负责“能打开文件”，`spec004.1` 负责“打开以后别难用”。

## 2. 当前问题

### 2.1 当前预览模型太粗

现有服务端预览结果本质只有三种：

- `text`
- `binary`
- `unsupported`

这导致图片和 PDF 这种高频格式一律掉进“二进制不可预览”。

### 2.2 当前 HTML 是单独特殊情况

现有前端预览壳里：

- Markdown 单独一套逻辑
- HTML 单独一套 iframe 逻辑
- 其他格式大多回到代码文本模式

继续这样加功能，只会长出更多 if/else 补丁。

### 2.3 当前模态框更像固定壳，不像真正查看器

当前预览模态框已经能打开、能切标签、能保存，但缺少：

- 尺寸调整
- 适配图片和 PDF 的专用工具
- 按格式切换工具集合

## 3. 总体方案

### 3.1 核心思路

把“预览”从一个粗暴接口，拆成三层：

1. **预览识别层**：判断文件应该按什么类型展示
2. **预览资源层**：提供文本内容或受控预览链接
3. **预览渲染层**：前端按类型挂对应 viewer 和工具按钮

这次不做外部在线预览主方案。

未来如果要接 `Office` 或插件，只能接在这三层模型的扩展位上，不能反过来把高频格式再外包出去。

### 3.2 分层结构

| 层级 | 作用 | 主要对象 |
| --- | --- | --- |
| `Preview Detection` | 识别文件预览类型 | `FilePreviewService` |
| `Preview Resource` | 输出文本内容或受控预览链接 | `FilePreviewLinkService`、`FileController.publicPreview` |
| `Viewer Shell` | 统一模态框、尺寸控制、工具栏 | `FileViewerModal` |
| `Format Viewers` | 各格式查看器 | `TextViewer`、`ImageViewer`、`PdfViewer`、`HtmlViewer` |
| `Tool Registry` | 生成各格式工具按钮 | `viewer-tool-registry`（新模块） |

## 4. 预览模型设计

### 4.1 服务端预览类型

建议把当前返回结构扩成：

```ts
type FilePreviewKind =
  | "text"
  | "markdown"
  | "html"
  | "image"
  | "pdf"
  | "binary"
  | "unsupported";

interface FilePreviewResult {
  workspaceId: string;
  path: string;
  supported: boolean;
  kind: FilePreviewKind;
  reason: string | null;
  content: string | null;
  version: string | null;
  size: number;
  updatedAt: string | null;
  previewUrl: string | null;
  capabilities: {
    canEdit: boolean;
    canRefresh: boolean;
    canResize: boolean;
    canZoom: boolean;
    canPaginate: boolean;
  };
}
```

说明：

- 文本类文件继续直接返回 `content`
- 图片 / PDF / HTML 返回 `previewUrl`
- `capabilities` 让前端少猜

### 4.2 预览识别规则

第一阶段直接走清晰白名单，不玩花活：

| 文件类型 | 识别方式 | 预览类型 |
| --- | --- | --- |
| 代码 / 配置 / `txt` / `log` | 扩展名 + 文本检测 | `text` |
| `md` / `markdown` | 扩展名 | `markdown` |
| `html` / `htm` | 扩展名 | `html` |
| `png` / `jpg` / `jpeg` / `gif` / `webp` / `svg` / `bmp` | 扩展名 | `image` |
| `pdf` | 扩展名 | `pdf` |
| 其他明显二进制 | 二进制检测 | `binary` |
| 超限文件或未支持格式 | 大小 / 类型限制 | `unsupported` |

这套规则够笨，但足够稳定。

### 4.3 预览提供者注册表

虽然第一阶段全是内置，但结构上仍预留：

```ts
interface PreviewProvider {
  kind: FilePreviewKind;
  canHandle(filePath: string): boolean;
  createPreview(...): FilePreviewResult;
}
```

当前只实现内置 provider：

- `text-preview-provider`
- `markdown-preview-provider`
- `html-preview-provider`
- `image-preview-provider`
- `pdf-preview-provider`

未来 `Office` 如果要加：

- 可以新增 `office-preview-provider`
- 或者新增 `plugin-preview-provider`

但不会改动当前主模型。

## 5. 后端设计

### 5.1 `FilePreviewService` 改造

当前问题：

- 只返回 `text / binary / unsupported`
- 图片和 PDF 无法出预览数据

改造后职责：

1. 判断文件类型
2. 文本类读取内容
3. 资源类生成受控 `previewUrl`
4. 返回统一能力声明

### 5.2 `FilePreviewLinkService` 泛化

当前 `createLink()` 只允许 HTML，这太死。

改造后要支持：

- HTML
- 图片
- PDF

受控预览链接仍走现有 token 模型，不放开匿名裸访问。

### 5.3 公共预览资源接口

继续复用：

- `GET /api/files/preview`
- `GET /api/files/preview-link`
- `GET /preview/files/:token/*`

但语义调整成：

- `preview`：拿结构化预览结果
- `preview-link`：为 `html / image / pdf` 这类资源型预览生成受控链接

### 5.4 PDF 传输策略

第一阶段要求：

- 至少支持常见体积 PDF 直接查看
- 维持受控预览链接

建议：

- 第一阶段先复用现有公共预览资源接口
- 如果后续遇到大 PDF 性能问题，再单独补 `Range` 支持

不要在这一轮就为了未来极端情况把传输层搞复杂。

## 6. 前端设计

### 6.1 `FileViewerModal` 角色调整

当前 `FileViewerModal` 同时管：

- 数据请求
- 模式切换
- HTML 特判
- 文本编辑

这会越来越难看。

建议拆成：

- `FileViewerModal`：壳、尺寸、标题栏、工具栏、模式切换
- `useFilePreviewState`：预览数据加载和刷新
- `renderViewerByKind`：按 `preview.kind` 选择具体 viewer
- `viewer-tool-registry`：生成工具按钮

### 6.2 模态框尺寸模型

第一阶段不追求花哨，直接用稳定方案：

```ts
type ViewerModalSizePreset = "default" | "wide" | "full";
```

支持两类调整方式：

1. 尺寸档位切换按钮：保证移动端和 H5 都能用
2. 桌面端拖拽边角调整：作为增强，不强制移动端支持

状态建议保留在本地 UI store，按用户设备记忆上次尺寸。

### 6.3 查看器组件

#### 6.3.1 文本查看器

- 继续复用现有代码预览 / Markdown 预览 / 编辑区
- 不破坏保存逻辑

#### 6.3.2 图片查看器

- 使用 `<img>` 或等价组件
- 支持：
  - 缩放
  - 适配容器
  - 原始尺寸查看

#### 6.3.3 PDF 查看器

- 使用前端内置 PDF viewer 方案
- 第一阶段至少支持：
  - 翻页
  - 缩放
  - 适配宽度
  - 刷新
  - 外部打开

#### 6.3.4 HTML 查看器

- 保留现有 iframe 路径
- 不与 PDF / 图片共享具体 viewer，但共享工具栏和模态框壳

## 7. 工具按钮设计

### 7.1 工具按钮注册表

```ts
interface ViewerToolAction {
  id: string;
  labelKey: string;
  visible: boolean;
  disabled?: boolean;
  run: () => void | Promise<void>;
}
```

由：

- `preview.kind`
- `preview.capabilities`
- 当前 viewer 状态

共同决定。

### 7.2 第一阶段按钮分组

| 预览类型 | 按钮 |
| --- | --- |
| `text` / `markdown` / `html` | 预览、代码、编辑、刷新、尺寸切换、外部打开（HTML） |
| `image` | 放大、缩小、适配、原始大小、刷新、尺寸切换、外部打开 |
| `pdf` | 上一页、下一页、页码、放大、缩小、适配宽度、刷新、尺寸切换、外部打开 |

原则：

- 没意义的按钮不显示
- 同一位置的按钮组含义尽量稳定

## 8. 兼容与迁移

### 8.1 不破坏现有接口调用

允许 `FilePreviewDto` 扩字段，但不要粗暴改成完全不同结构导致现有调用全部炸掉。

做法：

- 保留已有字段
- 新增 `kind` 细分值、`previewUrl`、`capabilities`
- 前端逐步切到新字段

### 8.2 不破坏现有保存逻辑

- 文本编辑继续走现有 `saveFileContent`
- 图片和 PDF 不进入编辑态
- HTML 预览仍保留既有刷新逻辑

## 9. 错误处理

### 9.1 错误类型

- `类型不支持`：当前格式没有 viewer
- `资源链接失败`：图片 / PDF / HTML 预览链接生成失败
- `PDF 渲染失败`：PDF 资源可取到，但前端渲染器失败
- `文件超限`：超出当前轻量预览上限

### 9.2 错误策略

- 能回退到代码 / 文本查看时，优先给回退
- 明显不能回退的格式，直接给清晰提示
- 不把用户扔到空白弹层里

## 10. 明确不做

- 不实现 Office viewer
- 不接第三方在线 H5 预览服务
- 不为了未来插件化而在本轮提前做复杂远端协议
- 不重写整个文件管理面板

## 11. 验证思路

### 11.1 功能验证

- 文本文件仍可预览、编辑、保存
- 图片文件可内置查看、缩放
- PDF 可内置查看、翻页、缩放
- 模态框可调尺寸
- 工具按钮随格式变化

### 11.2 回归验证

- HTML 预览不回退
- Markdown 预览不回退
- 已有保存链路不回退
- 不支持类型继续有明确提示
