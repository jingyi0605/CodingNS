# 设计文档 - spec015.1-opencli浏览器桥接接入office-browser

状态：Draft

## 1. 概述

### 1.1 目标

- 保留 `office.browser` 现有无头浏览器执行链
- 在不破坏现有 Profile / 实例 / 任务模型的前提下，接入 `opencli` 真实浏览器桥接执行链
- 让同一个浏览器任务模型支持多个执行后端
- 把“真实浏览器调试”明确做成一条受控支线，而不是偷偷替换默认执行方式

### 1.2 覆盖需求

- `requirements.md` 需求 1：双执行分支
- `requirements.md` 需求 2：保留现有无头能力
- `requirements.md` 需求 3：复用 `opencli` Browser Bridge
- `requirements.md` 需求 4：保留现有 Profile / 实例模型
- `requirements.md` 需求 5：桥接健康检查
- `requirements.md` 需求 6：执行后端记录
- `requirements.md` 需求 7：限制第一阶段桥接动作范围
- `requirements.md` 需求 8：继续遵守后台任务和零破坏接入规则

### 1.3 与前置 Spec 的关系

- `spec001.5.1`：已经把 `opencli` provider、运行时和健康检查接进系统
- `spec015`：已经定义 `office.browser`、`BrowserProfile`、`browser-bridge-service`、`browser-runtime-service`
- `spec001.2` / `spec001.2.1`：要求新增后台链路不能长私有队列和私有状态机

一句话：

这份 Spec 不是重写浏览器平台，而是把 `spec015` 里原本只写了“桥接”但还没真正落到执行模型里的那一条支线补完整。

## 2. 先把核心判断说死

### 2.1 为什么不能直接把 `opencli` 替掉 `Playwright`

因为两者不是同一个层级的问题。

`Playwright` 当前在 `office.browser` 里承担的是：

- 平台自管浏览器
- 无头执行
- 受控 `Profile`
- 标准动作执行器

`opencli Browser Bridge` 当前更像：

- 真实浏览器桥接
- 复用用户已经打开和已登录的浏览器
- 适合调试、接管和真实页面操作

如果直接替换：

- 现有 `persistent` Profile 语义会变味
- 现有实例和任务行为会被带偏
- 现有 Playwright 风格动作会失去底层保障

所以不能替，只能并存。

### 2.2 为什么不能再长第二套插件

这不是技术炫耀问题，而是维护成本问题。

如果 `office.browser` 再装一套同类扩展，后面会出现：

- 用户分不清该装哪个扩展
- 两套扩展争真实浏览器上下文
- 健康检查和故障排查链路裂开

所以第一阶段优先复用 `opencli` 这套 Browser Bridge，是对的。

### 2.3 为什么应该只扩执行层，不改对象层

当前仓库已经有这些对象：

- `BrowserProfile`
- 浏览器任务
- 浏览器任务步骤
- 浏览器产物
- 浏览器实例入口

这些对象解决的是“平台怎么看浏览器任务”。

这次新增桥接分支，解决的是“同一个浏览器任务到底怎么执行”。

所以正确做法是：

- 对象层少动
- 执行层抽象出来
- 新后端往里挂

## 3. 总体结构

### 3.1 现状结构

当前主链大致是：

1. `BrowserRuntimeService` 创建浏览器任务
2. 任务固定写 `connectorId = "browser.playwright"`
3. `PlaywrightBrowserExecutor` 直接执行动作

这导致当前系统实际上只有一种执行后端。

### 3.2 目标结构

改成下面这种结构：

1. `BrowserRuntimeService` 创建浏览器任务
2. 任务记录 `executionBackend`
3. `BrowserExecutorRegistry` 或等价调度层按后端选执行器
4. 执行器分为：
   - `PlaywrightBrowserExecutor`
   - `OpenCliBridgeBrowserExecutor`
5. 执行完成后继续回写同一套任务、步骤、产物、回执

### 3.3 模块分层

| 层级 | 模块 | 职责 |
| --- | --- | --- |
| 任务入口层 | `browser-runtime-service` | 仍然负责 Profile、任务创建、执行入口 |
| 执行选择层 | `browser-executor-registry` | 按 `executionBackend` 选择执行器 |
| 无头执行层 | `playwright-browser-executor` | 保留现有无头浏览器 / 自管浏览器执行 |
| 真实桥接执行层 | `opencli-bridge-browser-executor` | 通过 `opencli Browser Bridge` 执行真实浏览器调试动作 |
| 桥接状态层 | `opencli-browser-bridge-service` | 读取 `opencli` 健康状态并向 `office.browser` 暴露桥接状态 |
| 暴露层 | `/api/office/browser/*` 与 CLI | 暴露后端选择和桥接状态 |

## 4. 数据结构

### 4.1 浏览器任务输入新增执行后端

现有浏览器任务 `inputJson` 继续保留原字段，在此基础上新增：

```ts
type BrowserExecutionBackend =
  | "playwright"
  | "opencli_bridge";

interface BrowserTaskPayload {
  profileId?: string;
  startUrl?: string;
  actions?: BrowserTaskAction[];
  executionBackend?: BrowserExecutionBackend;
}
```

规则：

- 不写时默认 `playwright`
- 显式选择真实浏览器调试时写 `opencli_bridge`

### 4.2 浏览器 Profile 不强制重写

第一阶段不新增新的主 Profile 类型。

保留：

- `persistent`
- `cdp_attached`

新增的是“任务执行后端”，不是“Profile 模式全集重写”。

如果后续需要，可以在 Profile 元数据或任务输入里补“推荐执行后端”，但第一阶段不把这个写死成强绑定关系。

### 4.3 桥接健康状态视图

新增一个供 `office.browser` 使用的桥接状态 DTO：

```ts
type OpenCliBridgeAvailability =
  | "ready"
  | "daemon_missing"
  | "extension_missing"
  | "unavailable";

interface BrowserBridgeStatusDto {
  provider: "opencli";
  availability: OpenCliBridgeAvailability;
  detail: string | null;
  checkedAt: string;
}
```

这层职责很简单：

- 给 `office.browser` 看
- 不要求前端再去理解完整 `opencli provider` 领域模型

## 5. 执行链设计

### 5.1 `BrowserRuntimeService` 改造

现状问题：

- 创建任务时写死 `connectorId: "browser.playwright"`
- 执行时写死注入 `PlaywrightBrowserExecutor`

目标改造：

1. 创建任务时允许传入 `executionBackend`
2. `connectorId` 改成稳定但不误导的浏览器能力标识
3. 执行时先解析后端，再路由到具体执行器

建议：

- `connectorId` 改成 `browser.runtime`
- 后端信息放进 `inputJson`

这样做的好处是：

- 连接器表示“浏览器任务能力”
- 后端表示“这次到底怎么跑”

### 5.2 执行器抽象

新增统一执行器接口：

```ts
interface BrowserTaskExecutor {
  readonly backend: "playwright" | "opencli_bridge";

  execute(input: ExecuteBrowserTaskInput): Promise<BrowserExecutionResult>;
}
```

然后：

- `PlaywrightBrowserExecutor` 实现这个接口
- 新增 `OpenCliBridgeBrowserExecutor` 也实现这个接口

### 5.3 `OpenCliBridgeBrowserExecutor` 设计

它做的事不是调用 `opencli` 站点命令。

它应该直接复用 `opencli` 导出的低层桥接对象：

- `BrowserBridge`
- `Page`
- 必要时 `CDPBridge`

执行流程：

1. 检查 `opencli` bridge 健康状态
2. 创建或连接 `BrowserBridge`
3. 拿到 `Page`
4. 按浏览器任务动作顺序执行
5. 写回任务步骤、产物、回执

### 5.4 第一阶段动作映射

第一阶段明确支持：

| 任务动作 | `opencli_bridge` 映射 |
| --- | --- |
| `goto` | `page.goto()` |
| `click` | `page.click()` |
| `fill` | `page.typeText()` 或 `evaluate` 填充 |
| `press` | `page.pressKey()` |
| `read_dom` | `page.snapshot()` 或 `page.evaluate()` |
| `extract_text` | `page.evaluate('document.body.innerText')` |
| `screenshot` | `page.screenshot()` |
| `wait` | `page.wait()` |
| `upload` | `page.setFileInput()` |

第一阶段先不承诺完全等价支持：

| 动作 | 原因 |
| --- | --- |
| `download` | 现有 Playwright 依赖下载事件模型，桥接侧要单独补文件产物链 |
| `select` | 需要明确 `opencli` 低层是否已有稳定 helper，第一阶段可以先通过 `evaluate` 兼容或暂不开放 |
| 多标签复杂联动 | 先保留最小能力，不把范围炸开 |

### 5.5 失败处理

桥接执行常见失败分三类：

1. daemon 没起来
2. 扩展没连上
3. 动作本身执行失败

规则：

- daemon / 扩展错误要明确映射成桥接不可用
- 动作失败要继续落到现有任务失败记录
- 不允许桥接失败后自动悄悄切回 `playwright`

因为那会掩盖真实问题。

## 6. 健康检查与状态暴露

### 6.1 后端服务

新增 `opencli-browser-bridge-service`，职责：

- 读取 `opencli` 现有健康状态
- 映射成 `office.browser` 看得懂的桥接状态
- 暴露给 `office.browser` 前端和 CLI

它不负责：

- 管理 `opencli` 命令目录
- 管理 `opencli` provider 开关

### 6.2 Host API

第一阶段建议新增：

- `GET /api/office/browser/bridge-status`

返回：

- 当前桥接是否可用
- 不可用时的原因
- 最近检查时间

## 7. 前端与交互

### 7.1 目标

不是大改设置页，而是让用户在已有 `office.browser` 入口里看明白两件事：

1. 这是无头浏览器任务还是现实浏览器调试任务
2. 真实浏览器桥接当前能不能用

### 7.2 最小交互

第一阶段建议：

- 在新建浏览器任务时增加一个执行方式选项
  - `无头浏览器`
  - `真实浏览器调试`
- 如果选真实浏览器调试：
  - 显示桥接状态
  - 不可用时直接提示原因

### 7.3 现有 Profile / 实例视图

第一阶段只做最小增强：

- 允许在任务详情或执行回执里看到本次执行后端
- 不强制重写 Profile 卡片和实例主视图

## 8. CLI 与助手入口

### 8.1 CLI

现有 `codingns assistant office browser-*` 命令需要支持：

- 传入执行后端
- 查询桥接状态

例如：

- `codingns assistant office browser-bridge-status`
- `codingns assistant office browser-task-create --execution-backend opencli_bridge`

### 8.2 助手能力面

助手侧提示词或能力入口要收死：

- 默认浏览器自动化继续走无头分支
- 用户明确要“真实浏览器调试”“复用当前浏览器”“复用现有登录态”时，才建议选 `opencli_bridge`

## 9. 风险与取舍

### 9.1 最大风险

最大风险不是技术连不上，而是概念做乱：

- 用户看不懂“Profile 模式”和“执行后端”的区别
- 代码里把桥接和无头逻辑揉成一坨

所以第一阶段要宁可多一层抽象，也别偷懒硬塞。

### 9.2 为什么不自动回退

很多人会想：

- `opencli_bridge` 失败了，自动切到 `playwright` 不就好了？

这是坏主意。

因为用户选择真实浏览器调试，通常就是为了：

- 复用登录态
- 复用真实上下文
- 复用当前浏览器

这时自动切无头执行，语义已经变了。

### 9.3 为什么第一阶段不追求动作全兼容

因为“先把动作名字对齐”毫无意义，关键是：

- 结果对不对
- 失败能不能解释
- 现有链路会不会被打坏

第一阶段先收在最常用调试动作，是正确的。

## 10. 验证策略

### 10.1 后端验证

- `playwright` 原有用例必须继续通过
- 新增 `opencli_bridge` 执行器最小动作链测试
- 新增桥接不可用错误映射测试
- 新增任务后端记录测试

### 10.2 端到端验证

至少验证：

1. 默认无头浏览器任务继续成功
2. 真实浏览器调试任务在 bridge ready 时可执行
3. 扩展未连接时返回明确错误
4. 旧 Profile / 实例列表不受影响

## 11. 落地顺序

1. 先抽执行器接口
2. 再接 `opencli_bridge` 健康状态
3. 再实现 `OpenCliBridgeBrowserExecutor`
4. 最后补前端和 CLI 选项

不要反过来。

先改 UI 再补底层，只会制造半成品。
