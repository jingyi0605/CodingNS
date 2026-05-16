# 需求文档 - spec015.1-opencli浏览器桥接接入office-browser

状态：Draft

## 简介

当前 `office.browser` 已经有正式浏览器任务模型，但实现上主要围绕 `Playwright` 和平台自管浏览器。

这次新增需求不是“推翻现有浏览器能力”，而是把执行方式拆成两条：

1. `office.browser` 当前能力继续作为无头浏览器选项
2. `opencli Browser Bridge` 接入 `office.browser`，作为真实浏览器调试选项

这里最关键的一句边界是：

**真实浏览器桥接是 `office.browser` 的新增执行后端，不是对现有无头执行链的替换。**

## 可实现性结论

### 结论

这件事 **值得做，而且应该做成增量支线，不应该改成大替换**。

### 原因

1. 当前仓库已经有 `office.browser` 的 Profile、任务、执行和产物模型。
2. 当前机器已经接入 `opencli`，并且 Browser Bridge 扩展可用。
3. `opencli` 已公开导出低层浏览器桥接能力，不只是站点命令壳子。
4. 复用已安装扩展可以减少用户额外安装和维护成本。

### 当前已确认事实

1. `opencli` 当前扩展与 daemon 已可用，`opencli doctor` 可返回 `ready`。
2. `opencli` 提供 `BrowserBridge`、`Page`、`CDPBridge` 这类低层浏览器对象。
3. `office.browser` 当前执行器强依赖 Playwright `Page` 语义，不能直接替换。
4. `office.browser` 现有 `BrowserProfile` 已支持 `persistent` 与 `cdp_attached` 两种模式。

## 术语表

- **System**：`CodingNS`
- **无头浏览器分支**：当前 `office.browser` 基于 `Playwright` 的浏览器执行链
- **真实浏览器桥接分支**：基于 `opencli Browser Bridge` 的浏览器调试与接管执行链
- **执行后端**：浏览器任务实际使用的底层执行器，例如 `playwright` 或 `opencli_bridge`
- **桥接健康状态**：`opencli` daemon、扩展和桥接执行可用性的综合状态

## 范围说明

### In Scope

- `office.browser` 多执行后端模型
- `opencli_bridge` 执行后端接入
- 真实浏览器桥接状态检查与错误提示
- 浏览器任务按后端选择执行
- 前端和 CLI 暴露“无头 / 真实浏览器调试”选项

### Out of Scope

- 重写现有 `BrowserProfile` 存储模型
- 重写现有浏览器实例模型
- 把 `opencli` 站点命令目录并入 `office.browser` 动作模型
- 第一阶段支持所有 Playwright 动作等价迁移
- 强制所有浏览器任务改走 `opencli`

## 技术边界

### 边界 1：现有无头分支必须保留

- 现有 `playwright` 执行分支继续可用
- 现有任务、接口、Profile 语义不能因为新增桥接分支而被打断

### 边界 2：真实浏览器桥接只能作为显式选项

- `opencli_bridge` 不能偷偷变成默认执行方式
- 用户必须明确选择真实浏览器调试模式

### 边界 3：复用扩展，不重复造插件

- 第一阶段优先复用已安装的 `opencli Browser Bridge`
- 不再为 `office.browser` 单独要求第二套类似扩展

### 边界 4：任务模型不重写，只扩展执行层

- 浏览器任务、产物、步骤、Profile、实例对象继续沿用现有模型
- 变化重点放在“怎么执行”，不是“对象叫什么”

### 边界 5：第一阶段动作范围必须收敛

- 第一阶段只承诺桥接执行最常用调试动作
- 对下载、多页复杂流程、深层文件事件这类高耦合动作，必须明确支持边界

## 需求

### 需求 1：系统必须为 `office.browser` 提供双执行分支

**用户故事：** 作为使用者，我希望在同一个 `office.browser` 入口下，既能跑无头自动化，也能选择真实浏览器调试，而不是去记两套完全不同的入口。

#### 验收标准

1. WHEN 用户创建浏览器任务 THEN System SHALL 支持至少两种执行后端：`playwright` 和 `opencli_bridge`。
2. WHEN 用户未显式指定执行后端 THEN System SHALL 默认继续使用 `playwright`。
3. WHEN 用户显式选择真实浏览器调试 THEN System SHALL 让该任务走 `opencli_bridge`。

### 需求 2：系统必须保留现有 `office.browser` 无头浏览器能力

**用户故事：** 作为当前使用者，我希望新增真实浏览器桥接后，现有无头浏览器自动化任务不被破坏。

#### 验收标准

1. WHEN 系统接入 `opencli_bridge` THEN System SHALL 保持现有 `playwright` 执行链仍可用。
2. WHEN 用户继续使用原来的无头任务 THEN System SHALL 不要求用户安装或启用真实浏览器桥接。
3. WHEN `opencli` 不可用或桥接失败 THEN System SHALL 不影响 `playwright` 任务执行。

### 需求 3：系统必须复用 `opencli` Browser Bridge 作为真实浏览器调试底座

**用户故事：** 作为维护者，我希望 `office.browser` 复用已经接入的 `opencli` 浏览器扩展，而不是再造一套同类插件。

#### 验收标准

1. WHEN 用户选择真实浏览器调试 THEN System SHALL 优先通过 `opencli` Browser Bridge 执行。
2. WHEN `opencli` daemon 或扩展未连接 THEN System SHALL 返回明确桥接错误，而不是静默失败。
3. WHEN `opencli` 桥接状态恢复正常 THEN System SHALL 允许重新执行真实浏览器调试任务。

### 需求 4：系统必须保留现有浏览器 Profile 和实例模型

**用户故事：** 作为使用者，我希望新增桥接支线后，当前浏览器配置文件、实例和任务入口还保持原来的结构，不要被一把推翻。

#### 验收标准

1. WHEN 系统新增 `opencli_bridge` THEN System SHALL 继续保留现有 `BrowserProfile` 模型。
2. WHEN 系统新增 `opencli_bridge` THEN System SHALL 不改变现有浏览器实例列表和实例生命周期基本语义。
3. WHEN 用户查看现有 Profile 和实例 THEN System SHALL 能区分无头执行和真实浏览器桥接，但不要求迁移旧数据。

### 需求 5：系统必须为真实浏览器桥接提供正式健康检查与状态提示

**用户故事：** 作为使用者，我希望知道真实浏览器桥接到底能不能用，而不是点了执行以后才发现扩展没连上。

#### 验收标准

1. WHEN 用户查看真实浏览器调试选项 THEN System SHALL 提供桥接健康状态。
2. WHEN daemon 未启动、扩展未连接或版本不兼容 THEN System SHALL 提供明确错误信息。
3. WHEN 真实浏览器桥接可用 THEN System SHALL 明确显示当前可以执行真实浏览器调试任务。

### 需求 6：系统必须让浏览器任务按执行后端记录和回放

**用户故事：** 作为维护者，我希望同一类浏览器任务即使走不同后端，也能在任务记录里看清到底是无头执行还是桥接执行。

#### 验收标准

1. WHEN 浏览器任务创建 THEN System SHALL 记录所选执行后端。
2. WHEN 浏览器任务执行 THEN System SHALL 在步骤、回执或任务输出中保留执行后端信息。
3. WHEN 任务失败 THEN System SHALL 能明确区分是 `playwright` 失败还是 `opencli_bridge` 失败。

### 需求 7：系统必须限制第一阶段桥接动作范围

**用户故事：** 作为维护者，我希望第一阶段只承诺真正能稳定支持的桥接动作，避免一开始就把范围吹爆。

#### 验收标准

1. WHEN 第一阶段接入 `opencli_bridge` THEN System SHALL 至少支持 `goto`、`click`、`fill`、`press`、`read_dom`、`extract_text`、`screenshot`、`wait`。
2. WHEN 动作当前不支持桥接执行 THEN System SHALL 返回明确“不支持该后端”的错误。
3. WHEN 用户选择复杂动作组合 THEN System SHALL 不伪装成功，不得用模糊结果掩盖能力缺口。

### 需求 8：系统必须继续遵守后台任务和零破坏接入规则

**用户故事：** 作为维护者，我希望新增桥接分支后，不会重新长出私有队列、私有状态机，也不会把现有浏览器主链路打断。

#### 验收标准

1. WHEN 新增真实浏览器桥接任务执行 THEN System SHALL 继续走正式后台任务体系。
2. WHEN 新增桥接健康检查和执行器 THEN System SHALL 不引入新的私有 `inflight`、私有 `timer` 和私有重试队列。
3. WHEN 用户完全不使用真实浏览器调试 THEN System SHALL 保持现有浏览器主链路不变。

## 非功能需求

### 非功能需求 1：可靠性

1. WHEN `opencli_bridge` 不可用 THEN System SHALL 快速失败并给出明确原因。
2. WHEN `playwright` 与 `opencli_bridge` 并存 THEN System SHALL 避免一条分支异常拖垮另一条分支。

### 非功能需求 2：可观测性

1. WHEN 浏览器任务执行 THEN System SHALL 记录执行后端、桥接状态和失败原因。
2. WHEN 维护者排查桥接问题 THEN System SHALL 能关联到 `opencli` 健康状态或桥接错误。

### 非功能需求 3：可扩展性

1. WHEN 后续继续接入别的真实浏览器桥接方式 THEN System SHALL 复用执行后端抽象，而不是重新改任务模型。

## 成功定义

- `office.browser` 可以明确区分无头浏览器和真实浏览器调试两条执行支线
- `opencli` 扩展被复用为真实浏览器桥接底座
- 当前浏览器 Profile、实例、任务模型保持可用
- 新增桥接能力后，现有无头执行链不被破坏
