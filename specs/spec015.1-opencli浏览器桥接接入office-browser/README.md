# spec015.1-opencli浏览器桥接接入office-browser

## 这份 Spec 现在解决什么问题

`spec015` 已经把 `office.browser` 定义成平台级浏览器执行内核，但当前落地实现基本只有一条执行路：

- `Playwright`
- 平台自管浏览器
- 独立 `Profile`
- 适合无头自动化和受控任务执行

这条路没有错，但它解决的是“平台自己拉起浏览器跑任务”。

现在的新问题是：

- 机器上已经接入了 `opencli`
- `opencli` 已经要求安装 Browser Bridge 扩展
- `office.browser` 后面也要做真实浏览器调试和接管
- 如果两边各装一套类似扩展，最后一定烂

一句人话：

这份 Spec 要把 `office.browser` 正式拆成两条并存支线，而不是继续假装所有浏览器任务都应该走同一种执行方式。

## 这次计划覆盖什么

- 明确 `office.browser` 现有 `Playwright` 执行链继续保留，作为无头浏览器选项
- 把 `opencli Browser Bridge` 接进 `office.browser`，作为真实浏览器调试选项
- 保留现有浏览器 `Profile`、浏览器实例、任务和产物模型，不推翻重来
- 给浏览器任务增加“执行后端”选择，不再写死只能走 `browser.playwright`
- 增加 `opencli` 桥接执行器、桥接健康检查和失败提示
- 明确哪些动作第一阶段支持桥接执行，哪些动作先不承诺

## 这次明确不做什么

- 不用 `opencli` 替换掉现有 `Playwright` 内核
- 不把 `opencli` 浏览器桥接做成默认执行方式
- 不修改现有 `BrowserProfile`、浏览器实例、浏览器任务的主语义
- 不要求用户放弃当前的无头浏览器自动化链路
- 不把 `opencli` 站点命令目录和 `office.browser` 任务动作混成一个模型

## 为什么现在就要立这个 Spec

因为这件事最容易做烂的地方有三个：

1. 把 `opencli` 当成 `office.browser` 的直接替代品
2. 把真实浏览器桥接和无头执行混成一个看不懂的黑盒
3. 为了复用扩展，偷偷改掉现有 Profile / 实例行为

这三种做法都会破坏现有用户空间。

这次正确方向只有一个：

- `office.browser` 继续是统一入口
- 下面允许有两种执行后端
- 默认还是走现有 `Playwright`
- 用户显式选择时才走 `opencli` 真实浏览器桥接

## 依赖关系

- 前置依赖：
  - `spec001.2-后端任务调度与主线程压力治理`
  - `spec001.2.1-读写刷新与后台任务统一规则`
  - `spec001.5.1-OpenCLI接入与适配器裁剪运行时`
  - `spec015-通用办公能力平台与统一任务执行内核`
- 直接影响：
  - `apps/host`
  - `apps/user-app`
  - `packages/codingns`

## 硬边界先写死

### 浏览器执行分支

- `office.browser` 至少保留两条执行分支：
  - `playwright`：无头浏览器 / 平台自管浏览器
  - `opencli_bridge`：真实浏览器桥接 / 调试 / 接管

### 默认行为

- 默认执行分支仍然是 `playwright`
- `opencli_bridge` 只能显式选择，不允许偷偷替换默认值

### 配置与实例

- 现有浏览器 `Profile`
- 现有浏览器实例
- 现有浏览器任务与产物

这些对象继续保留，不因为新增桥接分支而整体重做。

### 扩展策略

- `office.browser` 第一阶段优先复用 `opencli` 已安装的 Browser Bridge 扩展
- 不再额外要求用户安装第二套同类扩展

## 主要文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
