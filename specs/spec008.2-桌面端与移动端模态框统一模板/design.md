# 设计文档 - spec008.2-桌面端与移动端模态框统一模板

状态：Draft

## 1. 概述

### 1.1 目标

- 建立桌面端统一 `DesktopModal`
- 建立移动端统一 `MobileSheet`
- 把尺寸、高度、布局、按钮区、表单区、列表区收成固定模型
- 为现有 `WorkbenchModal` 和一批手写弹窗提供迁移路径
- 给后续新增弹窗建立硬约束，避免继续长出手写基础壳

### 1.2 覆盖需求

- `requirements.md` 需求 1：统一桌面端模态框基础组件
- `requirements.md` 需求 2：统一移动端 sheet 基础组件
- `requirements.md` 需求 3：固定尺寸档位、高度档位和布局类型
- `requirements.md` 需求 4：统一模态框内的常见结构模板
- `requirements.md` 需求 5：支持渐进迁移，不破坏现有主流程
- `requirements.md` 需求 6：统一基础交互和可访问性规则
- `requirements.md` 需求 7：迁移代表性弹窗验证模板可用
- `requirements.md` 需求 8：建立后续新增弹窗的收口规则和验证要求

### 1.3 与相关 Spec 的边界

- `spec008` 负责桌面壳交付、连接、升级和平台边界
- `spec008.1` 负责桌面端多窗口
- `spec008.2` 负责桌面端与移动端模态框统一模板
- `spec009.1` 负责移动端导航和页面结构，不负责弹层基础组件收口
- `spec004.1` 负责文件查看器能力增强；它里的查看器尺寸能力要接入统一模态框档位，但不在这次重写文件查看器业务逻辑

一句话：

`spec008.2` 只做“弹层基础设施”，不做具体业务真相。

## 2. 当前问题

### 2.1 当前桌面端基础壳只统一了一半

当前已有桌面端基础壳：

- `apps/user-app/src/features/conversation/components/WorkbenchModal.tsx`

它已经统一了这些东西：

- portal
- backdrop
- header 基本结构
- body 容器

但还没有正式统一这些东西：

- 固定尺寸档位
- 固定布局类型
- sticky footer / 操作区模型
- 关闭行为开关
- 忙碌态下的禁止关闭规则

结果就是：

- 业务代码还是继续往 `className` 里补宽度
- 大型弹窗继续自己手写结构
- 同一类弹窗在不同页面里滚动和按钮区位置并不一致

### 2.2 当前桌面端仍有多处手写弹窗壳

代码走查已经确认：

- `WorkbenchModal` 已被多个地方使用
- 仍然有多处组件直接手写 `workbench-modal-layer`
- 代表文件包括：
  - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
  - `apps/user-app/src/features/terminal/components/TerminalRuntimeFallbackModal.tsx`
  - `apps/user-app/src/settings/ParallelTaskDebugModal.tsx`

这说明现在的问题不是“没有组件”，而是“组件模型不够完整，所以业务还在绕开它”。

### 2.3 当前移动端 sheet 基本没有正式基础组件

代码走查已经确认：

- 多个页面仍在重复 `ios-action-sheet-overlay`
- 代表文件包括：
  - `apps/user-app/src/features/mobile-sessions/components/MobileCreateSessionSheet.tsx`
  - `apps/user-app/src/features/terminal/pages/TerminalPage.tsx`

这些 sheet 共享同一类结构：

- overlay
- bottom card
- header
- content
- cancel button

但现在没有一个正式的 `MobileSheet` 来承接它们。

### 2.4 当前样式有 token，但没有“组件级约束”

`apps/user-app/src/app/styles.css` 已经存在大量 modal 相关 token 和控件基线。

问题在于：

- token 已经不少
- 统一组件却不完整
- 业务还是可以绕开模板自己写结构

所以真正缺的是：

1. 有限的组件模型
2. 有限的尺寸和布局枚举
3. 有限的迁移入口

## 3. 总体方案

### 3.1 核心思路

把当前“样式散落 + 结构重复”的弹层体系，收成三层：

1. **基础壳层**
   - `DesktopModal`
   - `MobileSheet`
2. **结构原子层**
   - `ModalSection`
   - `ModalField`
   - `ModalActions`
   - `ModalList`
   - `ModalEmptyState`
   - `ModalTag`
3. **业务包装层**
   - 具体业务弹窗只负责内容和交互，不再负责壳层结构

### 3.2 关键原则

1. 先统一结构，再统一细节
2. 先保证兼容，再推动迁移
3. 特例允许存在，但必须建立在统一基础壳上
4. 不为少数特殊弹窗破坏整个体系

## 4. 组件设计

### 4.1 `DesktopModal`

#### 4.1.1 角色

桌面端统一模态框基础组件，负责：

- portal
- 遮罩
- 关闭规则
- 标题区
- 描述区
- 头部操作区
- 内容区
- 底部操作区
- 尺寸档位
- 布局类型

#### 4.1.2 建议接口

```ts
type DesktopModalSizePreset =
  | "narrow"
  | "compact"
  | "regular"
  | "wide"
  | "xwide"
  | "full";

type DesktopModalLayoutPreset =
  | "confirm"
  | "form"
  | "list"
  | "viewer";

interface DesktopModalProps {
  open: boolean;
  title: string;
  description?: string;
  size?: DesktopModalSizePreset;
  layout?: DesktopModalLayoutPreset;
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  headerActions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}
```

#### 4.1.3 尺寸档位

桌面端宽度不再让业务组件自己写百分比，统一收成六档：

| 档位 | 建议宽度比例 | 用途 |
| --- | --- | --- |
| `narrow` | `36%` | 简短确认和危险操作确认 |
| `compact` | `44%` | 小表单、小设置项 |
| `regular` | `56%` | 常规表单和标准弹窗 |
| `wide` | `68%` | 列表型、双区块内容 |
| `xwide` | `80%` | 管理型、矩阵型、大列表型 |
| `full` | `100% - 外边距` | 查看器、大型工作面板 |

实现上仍然要带 `min/max width` 限制，避免超宽屏和窄屏下比例失真。

#### 4.1.4 布局类型

| 类型 | 结构重点 | 典型场景 |
| --- | --- | --- |
| `confirm` | 说明区 + 底部按钮 | 删除、归档、危险确认 |
| `form` | 字段区 + 分组区 + 底部提交 | 设置、创建、编辑 |
| `list` | 列表区 + 可选空态 + 底部动作 | 归档列表、选择器、管理面板 |
| `viewer` | 大内容区 + 工具操作区 | 文件查看器、矩阵型预览 |

### 4.2 `MobileSheet`

#### 4.2.1 角色

移动端统一底部 sheet 基础组件，负责：

- overlay
- bottom sheet 容器
- 标题区 / 描述区
- 手柄
- 安全区
- 底部取消区
- 关闭规则
- 高度档位
- 布局类型

#### 4.2.2 建议接口

```ts
type MobileSheetHeightPreset =
  | "auto"
  | "half"
  | "threeQuarter"
  | "full";

type MobileSheetKind =
  | "action"
  | "form"
  | "picker";

interface MobileSheetProps {
  open: boolean;
  title: string;
  description?: string;
  height?: MobileSheetHeightPreset;
  kind?: MobileSheetKind;
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  showHandle?: boolean;
  footer?: ReactNode;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}
```

#### 4.2.3 高度档位

| 档位 | 建议高度 | 用途 |
| --- | --- | --- |
| `auto` | 内容自适应，有上限 | 简短动作列表 |
| `half` | 约半屏 | 小型表单、短列表 |
| `threeQuarter` | 约四分之三屏 | 复杂表单、长列表 |
| `full` | 近似全屏，保留系统安全区 | 查看器、深层编辑和选择 |

#### 4.2.4 布局类型

| 类型 | 结构重点 | 典型场景 |
| --- | --- | --- |
| `action` | 操作按钮列表 + 底部取消 | 更多操作、动作面板 |
| `form` | 标题 + 表单区 + 提交按钮 | 新建、编辑、设置 |
| `picker` | 选择列表 + 当前选中态 | 工作区选择、来源选择 |

### 4.3 结构原子块

为了避免业务弹窗继续自己拼字段和按钮区，本轮补这几类原子结构：

| 组件 | 用途 |
| --- | --- |
| `ModalSection` | 内容分组和标题说明 |
| `ModalField` | 标签 + 输入控件 |
| `ModalInlineField` | 单行输入 + 附加按钮 |
| `ModalActions` | 底部按钮区 |
| `ModalList` | 列表容器 |
| `ModalListItem` | 列表项骨架 |
| `ModalTag` | 状态标签、来源标签 |
| `ModalEmptyState` | 空态占位 |
| `ModalDangerZone` | 危险操作说明和操作区 |

这些原子块不需要重造现有按钮和输入框，只负责统一：

- 间距
- 对齐
- 分组标题
- 模态框内密度
- 行为位置

## 5. 样式与兼容策略

### 5.1 样式策略

本轮不重建另一套主题系统。

现有 modal token 继续保留，并做这三件事：

1. 给新组件补稳定的 `data-size`、`data-layout`、`data-kind`、`data-height` 属性
2. 把尺寸档位和布局差异下沉到统一 class / data attribute
3. 让桌面端和移动端共享 token，但各自使用不同容器结构

### 5.2 `WorkbenchModal` 的兼容路径

`WorkbenchModal` 不直接删除，先改成过渡包装层：

- 旧接口还能继续用
- 内部逐步代理到新的 `DesktopModal`
- 旧调用点先不强迫全部改接口

这样做的目的只有一个：

不打断现有主流程。

### 5.3 历史类名兼容

在迁移期内允许两种东西并存：

- 新组件的标准 data attribute / class
- 少量旧类名别名

但新增代码不再允许直接新写：

- `workbench-modal-layer`
- `ios-action-sheet-overlay`

除非明确记录偏离原因。

## 6. 首批迁移策略

### 6.1 迁移原则

首批迁移不追求覆盖最多，追求覆盖“类型最全”。

优先选这几类：

1. 桌面端确认型
2. 桌面端列表型
3. 桌面端表单型
4. 移动端动作型
5. 移动端表单型

### 6.2 建议首批迁移对象

| 组件 | 类型 | 目的 |
| --- | --- | --- |
| `ConversationArchiveConfirmModal` | 桌面确认型 | 验证简单确认流 |
| `ConversationArchiveFolderModal` | 桌面列表型 | 验证列表和空态 |
| `TerminalRuntimeFallbackModal` | 桌面说明 + 操作型 | 验证复杂说明区 |
| `MobileCreateSessionSheet` | 移动端表单型 | 验证表单和选择区 |
| `MobileTerminalActionSheet` | 移动端动作型 | 验证动作列表 |
| `TerminalCreateSheet` | 移动端复杂表单型 | 验证多分组和底部主按钮 |

### 6.3 对 `FileViewerModal` 的处理

`FileViewerModal` 已经在 `spec004.1` 中长出了自己的尺寸档位和查看器特性。

本轮对它的要求是：

- 不重写查看器业务逻辑
- 后续把它的尺寸语义对齐到统一桌面端尺寸模型
- 保留它作为大型特例查看器的增强能力

## 7. 交互与正确性约束

### 7.1 统一关闭规则

- 默认支持点击遮罩关闭
- 默认支持 `Escape` 关闭桌面端弹窗
- `busy` 或危险确认过程中允许显式禁用关闭
- 关闭规则由基础组件控制，不再每个业务弹窗自己抄一遍

### 7.2 滚动规则

- 头部和底部操作区尽量固定
- 中间内容区负责滚动
- 大型查看器允许自己的内部滚动，但不能把整个外层弹窗滚坏

### 7.3 可访问性基线

- 使用正式 `dialog` 语义
- 有明确 `aria-modal`
- 有标题和描述
- 打开后焦点进入弹窗
- 关闭后焦点尽量回到触发源

## 8. 测试与验收

### 8.1 组件测试

- `DesktopModal` 基础交互测试
- `MobileSheet` 基础交互测试
- 原子块结构测试

### 8.2 迁移回归测试

- 首批迁移弹窗逐个保留现有主流程测试
- 重点覆盖打开、关闭、确认、取消、禁用关闭、空态、滚动

### 8.3 验收结论标准

这次算完成，至少要满足：

1. 桌面端和移动端都有正式基础组件
2. 固定档位和固定布局已经落地
3. `WorkbenchModal` 已接入兼容层
4. 首批代表性弹窗迁移完成
5. 后续新增弹窗不能继续默认手写基础壳
