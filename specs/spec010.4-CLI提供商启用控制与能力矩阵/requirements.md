# 需求文档 - spec010.4-CLI提供商启用控制与能力矩阵

状态：Draft

## 简介

当前系统已经把多个 CLI provider 接进来了，也已经有 `ProviderCapabilities`、provider 图标、会话发现、Fork、Skill 管理这些东西。

但问题也已经很明显：

1. provider 能做什么，系统大体知道；但 provider 到底应不应该出现在产品里，没有统一真源。
2. 关闭一个 provider 不是“一个地方不显示”这么简单，而是会牵扯会话发现、创建、继续、Fork、助手跟进、Skill 目标、设置页、工作台入口一整串链路。
3. 前端很多地方还在各自维护 provider 列表，后端也有按 provider 名字硬写的行为边界；这意味着只要缺一个门禁，禁用就会失效。

真正的问题不是 UI 少了一个开关，而是“provider 可见性”和“provider 产品能力”还没有被建模成正式系统规则。

这次 Spec 的目标很明确：

- 给 provider 启用态建立统一真源
- 让禁用 provider 成为真正的后端硬门禁，而不是只改前端显示
- 在设置页提供一张正式的 provider 能力矩阵
- 明确哪些能力属于 provider 原生能力，哪些是本项目映射出来的产品能力

## 术语表

- **Provider Enabled State**：provider 是否在当前 Host 上被正式启用。关闭后，系统不再把它当成可用 provider 对外暴露。
- **Host 全局配置**：保存在当前 Host 数据库中的单一配置，对所有登录用户和所有工作区统一生效。
- **Provider 能力矩阵**：在设置页展示的一张能力总表，用来说明每个 provider 当前支持哪些项目能力。
- **原生能力**：provider 自己通过统一契约暴露的能力，例如工具调用、中断、会话 Fork。
- **产品能力**：本项目在 provider 原生能力基础上做的正式入口能力，例如助手服务、Skill 使用。
- **硬门禁**：后端直接拒绝执行动作，而不是只在前端隐藏按钮。
- **隐藏旧会话**：禁用 provider 后，历史会话记录仍保留，但不会继续在正常列表和入口中显示。

## 范围说明

### In Scope

- 新增 provider 启用态的正式存储、读取、更新接口
- 新增 provider 总览/目录接口，返回启用态与能力矩阵
- 会话发现、会话列表、会话发起、继续、发送、Fork 等链路按启用态收口
- 设置页中的 provider 启用管理和能力矩阵展示
- Skill 管理、Butler/助手跟进、provider 选择器等入口按启用态隐藏或拒绝
- 禁用后旧会话的隐藏策略和重新启用后的恢复策略

### Out of Scope

- 动态安装或卸载 provider CLI
- 把 provider 启用态做成账号级配置
- provider capability 主契约的大改版
- 关闭 provider 时强制终止正在运行的本地会话进程
- 在本 Spec 中新增新的 Butler provider 家族

## 需求

### 需求 1：系统必须提供统一的 provider 启用态真源

**用户故事：** 作为维护者，我希望系统里对“某个 provider 是否启用”只有一个正式答案，这样前后端不会各自判断、各自打补丁。

#### 验收标准

1. WHEN 读取 provider 启用状态 THEN System SHALL 从单一的 Host 全局配置中返回结果，而不是从多个前端本地状态拼装。
2. WHEN 新增一个受支持 provider 但还没有显式配置记录 THEN System SHALL 默认将其视为启用，而不是因为缺记录直接消失。
3. WHEN 用户修改 provider 启用状态 THEN System SHALL 持久化该状态，并供所有需要 provider 可见性的链路复用。

### 需求 2：禁用 provider 后，系统必须把它从所有正常入口隐藏

**用户故事：** 作为普通用户，我希望关掉某个 provider 后，不会在项目里到处还能看到它的入口，这样界面才算真的干净。

#### 验收标准

1. WHEN provider 被禁用 THEN System SHALL 在会话创建、草稿会话、并行会话、Fork 目标、Butler 跟进等 provider 选择入口中移除它。
2. WHEN provider 被禁用 THEN System SHALL 在设置页以外的正常业务页面中不再显示该 provider 的创建或操作入口。
3. WHEN provider 被重新启用 THEN System SHALL 允许这些入口重新显示，而不要求手工修复历史数据。

### 需求 3：禁用 provider 后，后端必须停止新发现和新动作

**用户故事：** 作为系统维护者，我希望禁用 provider 后，后端不要继续偷偷扫描、创建、继续或 Fork 它的会话，否则前端隐藏只是自欺欺人。

#### 验收标准

1. WHEN provider 被禁用 THEN System SHALL 停止该 provider 的工作区会话发现、能力刷新和相关后台刷新任务。
2. WHEN 客户端尝试对禁用 provider 发起新会话、继续会话、发送消息、Fork 会话或读取可操作 capability THEN System SHALL 直接返回明确的禁用错误。
3. WHEN 后端处理 provider 相关请求 THEN System SHALL 统一复用同一套启用态判定，而不是每个控制器各写一份特殊逻辑。

### 需求 4：禁用 provider 后，旧会话必须隐藏但不得删除

**用户故事：** 作为用户，我希望关掉一个 provider 只是先不用它，而不是把我之前的历史会话直接删掉。

#### 验收标准

1. WHEN provider 被禁用 THEN System SHALL 隐藏该 provider 的历史会话、派生会话和相关正常列表项。
2. WHEN provider 被重新启用 THEN System SHALL 允许此前被隐藏的会话重新出现在正常列表中。
3. WHEN provider 被禁用 THEN System SHALL NOT 删除既有 session binding、索引记录和原始存储引用。

### 需求 5：Skill 和助手相关链路必须遵守 provider 启用态

**用户故事：** 作为维护者，我希望 provider 一旦被禁用，Skill 目标和助手相关功能也一起收口，而不是其他模块继续把它当成可用目标。

#### 验收标准

1. WHEN provider 被禁用 THEN System SHALL 在 Skill 管理里不再允许把新的工作区 Skill 同步到该 provider 目标。
2. WHEN provider 被禁用且它属于助手支持范围 THEN System SHALL 在 Butler/助手的 provider 选择和跟进入口中移除它。
3. WHEN provider 被禁用 THEN System SHALL 保留已有 Skill/助手记录，但不得继续把它作为新的可操作目标。

### 需求 6：设置页必须提供 provider 启用控制和能力矩阵

**用户故事：** 作为用户，我希望在一个固定位置既能开关 provider，也能一眼看到它们各自支持什么能力，而不是点进不同页面猜。

#### 验收标准

1. WHEN 用户进入设置页 provider 管理区域 THEN System SHALL 展示所有受支持 provider，包括当前被禁用的 provider。
2. WHEN 用户查看 provider 管理区域 THEN System SHALL 同时看到启用状态和能力矩阵，而不是拆成多个分散入口。
3. WHEN 用户切换启用状态 THEN System SHALL 给出明确结果反馈，并在后续入口中反映新的可见性。

### 需求 7：能力矩阵必须区分原生能力和产品能力

**用户故事：** 作为维护者，我希望能力矩阵不是一堆模糊名词，而是能看清某项能力到底来自 provider 自己，还是本项目额外支持的产品链路。

#### 验收标准

1. WHEN 设置页展示能力矩阵 THEN System SHALL 至少覆盖这些项目：流式输出、工具调用、助手服务、会话 Fork、Skill 使用。
2. WHEN 某项能力是项目映射能力而非 provider 原生协议字段 THEN System SHALL 在设计与接口层明确该能力的计算来源。
3. WHEN provider 当前不支持某项能力 THEN System SHALL 用明确的不可用状态展示，而不是空白或靠用户猜。

### 需求 8：禁用 provider 不得破坏现有可用 provider 和旧客户端基本行为

**用户故事：** 作为维护者，我希望新增 provider 启用控制后，不会把现在已经可用的 provider 主链路顺手搞坏。

#### 验收标准

1. WHEN 某个 provider 被禁用 THEN System SHALL 不影响其他仍启用 provider 的会话发现、实时运行和设置页行为。
2. WHEN 旧前端代码还只调用单 provider capability 接口 THEN System SHALL 返回可解释的禁用结果，而不是崩溃或返回非法结构。
3. WHEN provider 启用控制尚未配置 THEN System SHALL 保持现有默认行为，避免升级后全量 provider 意外消失。

## 非功能需求

### 非功能需求 1：可靠性

1. WHEN 用户切换 provider 启用状态 THEN System SHALL 在一次保存后让前后端入口读取到一致状态。
2. WHEN provider 被禁用 THEN System SHALL 以“停止新动作、隐藏旧入口”为主，不依赖刷新多次才能生效。

### 非功能需求 2：可维护性

1. WHEN 后续新增 provider THEN System SHALL 只要求补 provider 元数据和能力映射，不要求再新增一轮散落的可见性判断。
2. WHEN 排查“为什么某个 provider 看不见” THEN System SHALL 能区分“未安装”“被禁用”“能力受限”三类状态。

### 非功能需求 3：向后兼容

1. WHEN 历史会话属于已禁用 provider THEN System SHALL 保留底层记录，重新启用后仍可恢复显示。
2. WHEN 旧接口或旧测试未感知 provider 启用态 THEN System SHALL 通过默认启用和明确错误码维持兼容。

## 成功定义

- provider 启用态有统一真源，不再散落在各处本地状态和静态数组里
- 禁用 provider 后，会话发现、会话发起、Fork、助手跟进、Skill 目标等入口和后端动作都真正收口
- 设置页里能直接看到所有 provider 的启用状态和能力矩阵
- 旧会话不会被删除，只会在禁用期间隐藏，重新启用后可恢复
- 新接入 provider 时，不需要再手工去前后端一堆位置补“这个 provider 该不该显示”的垃圾判断
