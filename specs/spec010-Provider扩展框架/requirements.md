# 需求文档 - spec010-Provider扩展框架

状态：Draft

## 简介

这个 Spec 解决的是第三个 provider 开始最容易爆炸的问题。

前两家 CLI 做透了不难，难的是后面继续加 provider 时，系统还能不能保持干净。
如果每加一个 provider 就去改前端主流程、改消息模型、补一堆特判，那这项目很快就会烂掉。

所以 `spec010` 要做的不是“多接几个 CLI”，而是先把新增 provider 的规矩写死：

- provider 接口怎么实现
- capability descriptor 怎么定义
- 原始消息怎么保留引用
- 样本和回归怎么做
- 新 provider 怎么接入，怎么验收，怎么降级

## 术语表

- **System**：`码不能停` 全系统
- **Provider**：针对某一个 AI CLI 的适配实现
- **Provider Contract（Provider 契约）**：新增 provider 必须遵守的接口、数据结构和边界约束
- **Capability Descriptor（能力描述符）**：provider 或具体会话对外声明的能力清单
- **Raw Reference（原始引用）**：指向 provider 原始消息的可追溯引用
- **Fixture（样本）**：用于回归测试的原始会话样本和期望输出
- **Compatibility Rule（兼容规则）**：新增 provider 时必须满足的向后兼容要求

## 范围说明

### In Scope

- 定义 provider 统一接口契约
- 定义 capability descriptor 结构和演进规则
- 定义原始消息引用、索引与状态边界
- 定义 provider 样本、回归测试与验收流程
- 定义新增 provider 的接入步骤、校验步骤和降级规则
- 定义新增 provider 时对前端和后端的禁止事项

### Out of Scope

- 直接实现某个新的第三方 provider
- 修改主界面交互流程去迁就单个 provider
- 重新设计会话消息公共模型
- 一次性接入大量 CLI

## 需求

### 需求 1：新增 provider 必须实现统一契约

**用户故事：** 作为系统维护者，我希望所有新增 provider 都遵守同一套接口和边界，以便后续扩展不会把系统拖成一团。

#### 验收标准

1. WHEN 新增 provider THEN System SHALL 要求其实现统一的 provider 接口契约。
2. WHEN provider 缺少必需接口或数据结构 THEN System SHALL 拒绝将其纳入可发布范围。
3. WHEN provider 试图绕过统一契约直接改主流程 THEN System SHALL 视为违反扩展规则。

### 需求 2：能力差异必须通过 capability descriptor 暴露

**用户故事：** 作为前端开发者，我希望不同 provider 的差异都通过能力描述返回，以便页面按能力门控，而不是写死 provider 名字判断。

#### 验收标准

1. WHEN provider 暴露能力 THEN System SHALL 返回统一结构的 capability descriptor。
2. WHEN 某项能力不支持 THEN System SHALL 在 descriptor 中明确标注，并提供 `limitations` 说明。
3. WHEN 新增 provider 能力字段 THEN System SHALL 保持旧字段兼容，不破坏既有消费方。

### 需求 3：原始消息必须继续保持唯一来源

**用户故事：** 作为平台开发者，我希望新增 provider 仍然遵守“原始消息唯一来源”原则，以便系统不会出现第二套消息真相。

#### 验收标准

1. WHEN 新增 provider 读取历史或实时消息 THEN System SHALL 从 provider 原生存储或原生事件流读取原始消息。
2. WHEN 系统持久化 provider 相关数据 THEN System SHALL 只保存索引、状态、映射和衍生字段，不保存完整原始消息副本。
3. WHEN 任意一条归一化消息被输出 THEN System SHALL 保留可追溯的 `rawRef` 或等价原始引用。

### 需求 4：新增 provider 必须有样本和回归测试

**用户故事：** 作为系统维护者，我希望每个 provider 在接入前就有固定样本和回归测试，以便上游格式一变就能及时发现。

#### 验收标准

1. WHEN 新增 provider THEN System SHALL 同时提交原始会话样本、期望归一化结果和能力样本。
2. WHEN provider 升级或修复兼容逻辑 THEN System SHALL 跑过样本回归测试后才能合入。
3. WHEN 样本覆盖不到关键消息类型 THEN System SHALL 不允许标记为完成接入。

### 需求 5：新增 provider 必须走固定接入流程

**用户故事：** 作为接入新 provider 的开发者，我希望有一条固定流程，以便知道先做什么、后做什么、怎样才算真的接完。

#### 验收标准

1. WHEN 启动新 provider 接入 THEN System SHALL 提供固定步骤，包括接口实现、样本补齐、能力声明、回归验证和验收记录。
2. WHEN provider 只实现了解析但没补能力声明或回归样本 THEN System SHALL 视为未完成接入。
3. WHEN provider 进入发布前检查 THEN System SHALL 能输出接入清单和验证结果。

### 需求 6：向后兼容和降级规则必须明确

**用户故事：** 作为前端和后端维护者，我希望新增 provider 或 provider 升级时，不会把现有客户端和现有 provider 一起打坏。

#### 验收标准

1. WHEN 新增 provider THEN System SHALL 不要求修改既有 UI 主流程才能工作。
2. WHEN provider 某能力不支持 THEN System SHALL 允许客户端按统一降级规则隐藏、置灰或提示，不引入单独特判页面。
3. WHEN provider 字段或消息类型扩展 THEN System SHALL 保持旧客户端至少能安全忽略未知字段。

### 需求 7：问题排查必须能定位到 provider 层

**用户故事：** 作为维护者，我希望新增 provider 出问题时能快速定位到底是上游存储、适配器逻辑还是公共模型问题，以便别所有锅都甩给前端。

#### 验收标准

1. WHEN provider 解析失败 THEN System SHALL 记录 provider 标识、session id、rawRef 和错误码。
2. WHEN 回归样本失败 THEN System SHALL 输出失败样本、差异点和对应能力字段。
3. WHEN 前端报告能力门控异常 THEN System SHALL 能追踪到具体 provider descriptor 输出版本。

## 非功能需求

### 非功能需求 1：可靠性

1. WHEN provider 原始存储格式变化 THEN System SHALL 通过样本回归尽快发现破坏性变更。
2. WHEN 单个 provider 发生兼容性问题 THEN System SHALL 不影响其他 provider 的主链路可用性。

### 非功能需求 2：可维护性

1. WHEN 新增 provider THEN System SHALL 把改动范围尽量收敛在 provider 目录、契约测试和样本目录内。
2. WHEN 前端新增能力入口 THEN System SHALL 仍然只依赖 capability descriptor，而不是新增 provider 名字判断分支。

### 非功能需求 3：可观测性

1. WHEN provider 运行异常 THEN System SHALL 输出可检索的 provider 级日志和错误码。
2. WHEN 回归测试执行 THEN System SHALL 输出结构化测试结果，能快速看出是契约失败、解析失败还是兼容失败。

## 成功定义

- 第三个 provider 接入时，不需要推翻 `spec001`、`spec002`、`spec003` 的主链路设计
- 新 provider 的改动范围主要留在 provider 目录、样本目录和契约测试目录
- 前端仍然依靠 capability descriptor 完成功能门控，不出现新一轮 provider 特判泛滥
- provider 兼容问题可以通过样本、日志和 rawRef 快速定位
