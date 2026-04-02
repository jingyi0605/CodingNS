# 设计文档 - spec008.1 桌面端多窗口管理

状态：Draft

## 1. 概述

### 1.1 目标

- 只在 `Desktop` 端建立多窗口能力，不碰 `H5`
- 先把窗口数据结构和桌面壳命令做对，再谈窗口体验
- 第一批只拆 `files / git / processes` 三类外部窗口
- 现有单窗口工作台保持默认入口和主流程不变
- 终端先锁定交互所有权，不开放多窗同时交互

### 1.2 覆盖需求

- `requirements.md` 需求 1：统一窗口描述模型
- `requirements.md` 需求 2：桌面壳最小多窗口命令
- `requirements.md` 需求 3：第一批只拆文件 / Git / 进程管理
- `requirements.md` 需求 4：现有单窗口工作台零破坏
- `requirements.md` 需求 5：窗口元数据最小持久化
- `requirements.md` 需求 6：终端交互所有权
- `requirements.md` 需求 7：只做 Desktop

### 1.3 技术约束

- 前端仍然是 `apps/user-app` 这一套共享 UI 运行时
- 桌面壳仍然是 `apps/desktop/src-tauri`
- 不把窗口业务真相迁入 `Rust`，但窗口元数据和原生窗口生命周期属于壳层职责
- 不改现有主路由语义，不要求用户必须走多窗口

### 1.4 与父 Spec 的边界

- `spec008` 负责桌面交付壳、连接、更新、配置等“大交付问题”
- `spec008.1` 只负责桌面端工作台多窗口
- 本子 Spec 不重写 `spec008` 的交付模型，只在其桌面壳能力之上增加多窗口

## 2. 架构

### 2.1 总体结构

这次多窗口分四层：

1. `WindowRegistryStore`
   - 前端窗口注册表，负责维护当前已知窗口描述、窗口打开状态和窗口动作请求
2. `DesktopWindowBridge`
   - 前端桌面桥接层，负责把窗口动作转换成 Tauri 命令
3. `Tauri Window Manager`
   - Rust 壳层窗口管理器，负责创建、关闭、聚焦、同步和恢复原生窗口
4. `Window Content Shell`
   - 外部窗口的最小页面壳，只负责按 `WindowDescriptor` 渲染具体视图

核心原则：

- 业务数据仍来自 Host 和共享前端状态模型
- 壳层只管理“窗口是什么”和“窗口怎么开关”，不管理业务真相
- 主窗口工作台继续存在，多窗口只是附加视图展开方式

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `WindowRegistryStore` | 管理窗口描述、打开状态、恢复状态 | 用户动作、壳层回调 | 统一窗口状态 |
| `DesktopWindowBridge` | 调用桌面壳窗口命令 | `WindowDescriptor`、窗口动作 | 标准执行结果 |
| `Tauri Window Manager` | 原生窗口创建、聚焦、关闭、尺寸同步 | 前端命令 | 原生窗口生命周期结果 |
| `ExternalWindowRoute` | 根据窗口描述加载具体视图 | `windowId` | 文件 / Git / 进程管理页面 |
| `TerminalWindowPolicy` | 约束终端窗口交互所有权 | `terminalId`、`windowId` | 交互权限结果 |

### 2.3 为什么不用现有页面直接乱弹

现有 `WorkbenchLayout` 把导航、文件树、Git、工作区管理、终端管理订阅都装在一个上下文里。这个结构适合单窗口工作台，不适合直接把局部组件拽到新窗口里乱跑。

所以这次做法不是：

- 先 `window.open` 一个页面
- 再想办法从主窗口偷 React 状态过去

而是：

- 先建立统一的窗口描述和窗口注册表
- 让外部窗口自己启动一份最小工作台壳
- 通过同一套 Host API / WebSocket 重新订阅自己需要的数据

这样虽然笨一点，但清楚，而且不会把主窗口状态和外部窗口耦死。

## 3. 数据结构

### 3.1 WindowDescriptor

```ts
export type WindowKind = "chat" | "terminal" | "files" | "git" | "processes";

export type WindowMode = "docked" | "floating" | "external";

export interface WindowBounds {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface WindowDescriptor {
  windowId: string;
  kind: WindowKind;
  workspaceId: string | null;
  sessionId: string | null;
  terminalId: string | null;
  mode: WindowMode;
  bounds: WindowBounds;
  focusOwner: string | null;
}
```

### 3.2 字段解释

| 字段 | 说明 | 备注 |
| --- | --- | --- |
| `windowId` | 窗口唯一 ID，同时作为 Tauri label | 不允许重复 |
| `kind` | 窗口显示什么 | 第一批只允许 `files`、`git`、`processes` 打开外部窗口 |
| `workspaceId` | 所属工作区 | 文件 / Git / 进程管理都必须有 |
| `sessionId` | 聊天会话 ID | 第一批预留，不投入使用 |
| `terminalId` | 终端 ID | 第一批预留，用于终端规则 |
| `mode` | 停靠 / 悬浮 / 外部 | 第一批真正落地的是 `external` |
| `bounds` | 尺寸和位置 | 只保存元数据，不保存业务状态 |
| `focusOwner` | 当前拥有资源焦点的窗口 ID | 第一批主要服务于终端交互规则 |

### 3.3 WindowRegistryState

```ts
export interface WindowRegistryState {
  descriptors: Record<string, WindowDescriptor>;
  openWindowIds: string[];
  lastActiveWindowId: string | null;
}
```

说明：

- `descriptors` 是统一窗口真相
- `openWindowIds` 只表示当前已打开的原生窗口
- `lastActiveWindowId` 用于恢复和聚焦兜底，不等于业务焦点

## 4. 桌面壳接口

### 4.1 需要新增的最小命令

第一批只补这几个，别做花活：

| 命令 | 输入 | 输出 | 作用 |
| --- | --- | --- | --- |
| `create_window` | `WindowDescriptor` | `{ ok }` | 创建原生窗口 |
| `close_window` | `windowId` | `{ ok }` | 关闭指定窗口 |
| `focus_window` | `windowId` | `{ ok }` | 聚焦指定窗口 |
| `list_windows` | 无 | `WindowDescriptor[]` | 读取当前已知窗口 |
| `get_window_descriptor` | `windowId` | `WindowDescriptor` | 外部窗口启动时读取自身描述 |
| `sync_window_descriptor` | `WindowDescriptor` | `{ ok }` | 同步窗口元数据 |
| `update_window_bounds` | `windowId + bounds` | `{ ok }` | 保存窗口尺寸和位置 |

### 4.2 壳层保存什么，不保存什么

壳层保存：

- 窗口描述
- 原生窗口 label
- 窗口尺寸和位置
- 当前窗口是否已打开

壳层不保存：

- 文件树快照
- Git 状态快照
- 进程列表快照
- 会话业务消息
- 终端输出正文

这条边界必须守住。不然 Tauri 又会开始长业务脑子。

## 5. 前端渲染策略

### 5.1 主窗口保持不变

现有主窗口继续使用现在的工作台路由和主流程：

- 聊天仍在主工作台里
- 终端仍在主工作台里
- 文件 / Git / 进程管理仍然能在主工作台侧栏或页面里使用

多窗口只是增加一个动作：

- “在新窗口打开”

### 5.2 外部窗口页面壳

新增一个桌面外部窗口路由壳，例如：

- `/desktop-window/:windowId`

这个壳启动后只做三件事：

1. 读取 `windowId`
2. 通过桌面桥接读取 `WindowDescriptor`
3. 根据 `kind` 渲染对应页面

第一批外部窗口映射：

| `kind` | 渲染内容 |
| --- | --- |
| `files` | 文件管理视图 |
| `git` | Git 视图 |
| `processes` | 进程管理视图 |

### 5.3 为什么第一批不拆聊天

聊天页有会话运行时、消息流、权限请求、草稿状态、底部输入、会话跳转等复杂状态。

它不是不能拆，而是现在拆它只会把复杂度提早放大。

所以第一批明确不做聊天独立窗。

## 6. 终端规则

### 6.1 交互规则

同一个 `terminalId` 在多个窗口中出现时：

- 只能有一个主交互窗
- 只有主交互窗可以发送输入
- 只有主交互窗可以发送 `resize`
- 其他窗口只能看输出，属于只读镜像窗

### 6.2 为什么必须这样

现在终端尺寸变更直接打到真实 PTY 会话上。两个窗口同时交互，结果一定是：

- 互相覆盖终端尺寸
- 输入来源难以追踪
- 焦点和选中状态混乱

所以这不是“以后再优化”的问题，而是必须先立规矩。

### 6.3 第一批怎么处理终端

第一批不交付终端外部窗口，但要把规则和接口预留好：

- `WindowDescriptor` 里保留 `terminalId`
- `focusOwner` 定义保留
- `TerminalWindowPolicy` 设计先写清楚

等文件 / Git / 进程管理窗口稳定后，再进入终端外部窗口实现。

## 7. 状态与生命周期

### 7.1 外部窗口打开流程

1. 主窗口构造 `WindowDescriptor`
2. `WindowRegistryStore` 先登记窗口
3. 前端调用 `create_window`
4. Tauri 创建原生窗口并加载 `/desktop-window/:windowId`
5. 外部窗口启动后读取自身 descriptor
6. 外部窗口按 `kind` 独立订阅所需数据

### 7.2 外部窗口关闭流程

1. 用户关闭窗口或主窗口请求关闭
2. Tauri 回收原生窗口
3. 壳层通知前端窗口已关闭
4. `WindowRegistryStore` 更新 `openWindowIds`
5. 保留 descriptor 的最小持久化信息，用于下次恢复

### 7.3 恢复策略

恢复只处理这几件事：

- 上次窗口类型
- 上次窗口尺寸和位置
- 上次关联工作区

恢复明确不处理：

- 恢复到某个精确滚动位置
- 恢复到某个文件展开树状态
- 恢复某次临时 UI hover 状态

别把恢复机制做成垃圾回收站。

## 8. 错误处理

### 8.1 错误类型

- `WINDOW_DESCRIPTOR_NOT_FOUND`
- `WINDOW_ALREADY_EXISTS`
- `WINDOW_CREATE_FAILED`
- `WINDOW_NOT_FOUND`
- `WINDOW_SYNC_FAILED`
- `WINDOW_KIND_NOT_SUPPORTED`
- `TERMINAL_INTERACTION_DENIED`

### 8.2 处理原则

1. 外部窗口 descriptor 丢失
   - 显示明确错误页
   - 允许用户关闭窗口
   - 不影响主窗口继续工作
2. 壳层创建失败
   - 主窗口提示失败
   - 不清空主窗口当前面板状态
3. 窗口恢复失败
   - 回退默认尺寸
   - 保持主流程可继续

## 9. 正确性属性

### 9.1 属性 1：单窗口默认流程不被破坏

*对于任何* 没有主动打开外部窗口的用户路径，系统都应该满足：行为与当前单窗口工作台一致。

**验证需求：** 需求 4

### 9.2 属性 2：窗口元数据统一收口

*对于任何* 新增外部窗口行为，系统都应该满足：窗口类型、尺寸、模式、关联对象都能在 `WindowDescriptor` 找到，而不是散落在组件局部状态里。

**验证需求：** 需求 1、需求 5

### 9.3 属性 3：终端不会出现多窗抢交互

*对于任何* 同 `terminalId` 的多窗口场景，系统都应该满足：同时最多只有一个窗口可以输入和改尺寸。

**验证需求：** 需求 6

## 10. 验证策略

### 10.1 文档与接口验证

- `WindowDescriptor` 类型审查
- Tauri 命令签名审查
- 父 Spec 与子 Spec 范围走查

### 10.2 前端验证

- 单窗口默认路径回归测试
- 文件 / Git / 进程管理外部窗口打开与关闭测试
- 外部窗口 descriptor 读取和错误页测试

### 10.3 桌面壳验证

- 原生窗口创建 / 关闭 / 聚焦测试
- 窗口尺寸和位置同步测试
- 异常窗口关闭后的状态回收测试
