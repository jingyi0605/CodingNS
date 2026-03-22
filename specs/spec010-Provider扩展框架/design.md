# 设计文档 - spec010-Provider扩展框架

状态：Draft

## 1. 概述

### 1.1 目标

- 把新增 provider 的接入规则写成硬约束，而不是口头约定
- 保证 capability descriptor、原始消息引用和公共消息模型长期稳定
- 把 provider 兼容性风险收敛在样本、契约和回归测试里
- 保证新增 provider 时不污染主界面和既有 provider

### 1.2 覆盖需求

- `requirements.md` 需求 1：新增 provider 必须实现统一契约
- `requirements.md` 需求 2：能力差异必须通过 capability descriptor 暴露
- `requirements.md` 需求 3：原始消息必须继续保持唯一来源
- `requirements.md` 需求 4：新增 provider 必须有样本和回归测试
- `requirements.md` 需求 5：新增 provider 必须走固定接入流程
- `requirements.md` 需求 6：向后兼容和降级规则必须明确
- `requirements.md` 需求 7：问题排查必须能定位到 provider 层

### 1.3 技术约束

- 后端：`Node.js 22 + TypeScript + Fastify + ws`
- 存储：沿用 `spec001` 的 SQLite 索引与状态边界，不新增原始消息仓库
- 会话同步：沿用 `spec002` 的统一消息模型和 session-sync-core
- 前端门控：沿用 `spec003` 的 capability gate，不允许散落 provider 特判
- 第一阶段默认 provider：`Claude Code`、`Codex`

## 2. 架构

### 2.1 系统结构

provider 扩展框架由五块组成：

1. `provider-contract`：定义 provider 必须实现的接口和数据结构
2. `provider-registry`：负责注册、校验、加载 provider
3. `fixture-runner`：执行原始样本回归测试
4. `compatibility-checker`：检查能力字段、消息模型和向后兼容规则
5. `provider-onboarding-checklist`：把接入流程变成固定步骤和验收清单

关键思路很简单：

- 公共协议先定死
- provider 自己适配自己的脏活
- 样本和回归兜底
- 前端只认 capability，不认 provider 名字

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `provider-contract` | 定义统一接口、能力结构、错误边界 | TypeScript 类型与约束 | Provider 契约 |
| `provider-validator` | 校验 provider 是否满足必需能力 | provider 实现、样本配置 | 校验结果 |
| `provider-registry` | 注册与加载 provider | provider manifest | 可用 provider 列表 |
| `fixture-runner` | 执行样本回放和归一化断言 | 原始样本、期望输出 | 测试报告 |
| `compatibility-checker` | 校验字段演进和兼容规则 | descriptor 版本、消息模型 | 兼容性报告 |
| `onboarding-checklist` | 固化接入步骤和发布前检查 | 接入任务状态 | 接入清单与验收记录 |

### 2.3 关键流程

#### 2.3.1 新增 provider 接入流程

1. 创建 provider 目录和 manifest
2. 实现统一 provider 契约
3. 补齐 capability descriptor
4. 准备原始样本、期望归一化结果和能力样本
5. 跑 provider 校验和样本回归
6. 通过后进入验收与发布检查

#### 2.3.2 provider 启动校验流程

1. `provider-registry` 扫描 provider manifest
2. `provider-validator` 检查必需接口和能力字段
3. 契约不完整的 provider 直接拒绝注册
4. 注册成功的 provider 才能进入运行期

#### 2.3.3 provider 升级回归流程

1. provider 代码变更后触发 fixture-runner
2. 比对归一化消息、rawRef、能力字段和错误码
3. 若差异超出兼容规则，则阻断合并
4. 输出结构化报告供开发和评审查看

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7

- `ProviderAdapter`：新增 provider 必须实现的统一接口
- `ProviderManifest`：描述 provider 元信息、版本、支持能力和样本位置
- `CapabilityContract`：定义 capability descriptor 的公共字段和演进规则
- `FixtureRunner`：对样本做解析和归一化回放
- `CompatibilityChecker`：检查向后兼容和降级规则
- `OnboardingChecklistService`：输出接入步骤和发布前验收项

### 3.2 数据结构

覆盖需求：1、2、3、4、6、7

#### 3.2.1 `ProviderManifest`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `providerId` | string | 是 | provider 标识 | 全局唯一 |
| `displayName` | string | 是 | 对外显示名 | 不可为空 |
| `version` | string | 是 | provider 版本 | 语义化版本 |
| `entry` | string | 是 | 实现入口 | 必须存在 |
| `fixturesPath` | string | 是 | 样本目录 | 必须存在 |
| `supports` | string[] | 是 | 支持能力摘要 | 只做摘要，不替代 descriptor |
| `status` | string | 是 | provider 状态 | `experimental/stable/deprecated` |

#### 3.2.2 `ProviderCapabilities`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `provider` | string | 是 | provider 标识 | 必须与 manifest 一致 |
| `canStartSession` | boolean | 是 | 是否可新建会话 | 布尔值 |
| `canResumeSession` | boolean | 是 | 是否可续接 | 布尔值 |
| `supportsSubagents` | boolean | 是 | 是否支持 subagent | 布尔值 |
| `supportsInterrupt` | boolean | 是 | 是否支持中断 | 布尔值 |
| `supportsStructuredToolCalls` | boolean | 是 | 是否支持结构化工具调用 | 布尔值 |
| `supportsTokenUsage` | boolean | 是 | 是否支持 token 使用统计 | 布尔值 |
| `supportsAttachments` | boolean | 是 | 是否支持附件 | 布尔值 |
| `supportsPermissionPrompt` | boolean | 是 | 是否支持权限确认 | 布尔值 |
| `supportsCheckpoint` | boolean | 是 | 是否支持检查点 | 布尔值 |
| `limitations` | string[] | 否 | 限制说明 | 可空数组 |

#### 3.2.3 `RawMessageRef`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `provider` | string | 是 | provider 标识 | 必填 |
| `providerSessionId` | string | 是 | 原生会话 ID | 必填 |
| `providerMessageId` | string | 否 | 原生消息 ID | 可空 |
| `storageLocator` | string | 是 | 原始存储定位信息 | 必须可追溯 |
| `sequenceHint` | string | 否 | 序列提示 | 可空 |

#### 3.2.4 `ProviderFixture`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `fixtureId` | string | 是 | 样本 ID | 全局唯一 |
| `provider` | string | 是 | 归属 provider | 必填 |
| `scenario` | string | 是 | 场景说明 | 不可为空 |
| `rawInputPath` | string | 是 | 原始输入样本路径 | 必须存在 |
| `expectedOutputPath` | string | 是 | 期望归一化输出 | 必须存在 |
| `expectedCapabilitiesPath` | string | 否 | 期望能力样本 | 可空 |
| `tags` | string[] | 否 | 场景标签 | 可空数组 |

#### 3.2.5 `CompatibilityRule`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `ruleId` | string | 是 | 规则 ID | 全局唯一 |
| `scope` | string | 是 | 作用范围 | `capabilities/message-model/api` |
| `description` | string | 是 | 规则说明 | 不可为空 |
| `breaking` | boolean | 是 | 是否为破坏性规则 | 布尔值 |
| `fallbackStrategy` | string | 否 | 降级策略 | 非破坏性时可空 |

### 3.3 接口契约

覆盖需求：1、2、4、5、6

#### 3.3.1 `ProviderAdapter`

- 类型：TypeScript Interface
- 标识：`ProviderAdapter`
- 输入：`workspacePath`、`sessionId`、分页参数、运行参数
- 输出：会话发现结果、历史消息、实时事件、续接结果、新建结果、能力描述
- 校验：必须实现契约规定的全部必需方法
- 错误：`PROVIDER_CONTRACT_INVALID`、`PROVIDER_IO_ERROR`、`PROVIDER_DATA_INVALID`

#### 3.3.2 `validateProviderContract(providerId)`

- 类型：Function / CLI
- 标识：`provider-validator`
- 输入：provider 实现与 manifest
- 输出：契约校验报告
- 校验：缺字段、缺方法、descriptor 不完整时失败
- 错误：`CONTRACT_METHOD_MISSING`、`CAPABILITY_FIELD_MISSING`

#### 3.3.3 `runProviderFixtures(providerId)`

- 类型：Function / CLI
- 标识：`fixture-runner`
- 输入：providerId、fixtures 目录
- 输出：样本测试结果与差异报告
- 校验：样本文件必须齐全
- 错误：`FIXTURE_MISSING`、`FIXTURE_ASSERTION_FAILED`

#### 3.3.4 `GET /api/providers`

- 类型：HTTP
- 路径：`/api/providers`
- 输入：登录态令牌
- 输出：provider 列表、版本、状态、能力摘要
- 校验：必须鉴权
- 错误：`UNAUTHORIZED`

#### 3.3.5 `GET /api/providers/{provider}/capabilities`

- 类型：HTTP
- 路径：`/api/providers/{provider}/capabilities`
- 输入：provider 标识、可选 sessionId、登录态令牌
- 输出：`ProviderCapabilities`
- 校验：provider 必须存在
- 错误：`UNAUTHORIZED`、`PROVIDER_NOT_SUPPORTED`

## 4. 数据与状态模型

### 4.1 数据关系

- `ProviderManifest` 描述 provider 的静态元信息和样本位置
- `ProviderAdapter` 负责运行时接入和消息读取
- `ProviderCapabilities` 通过 HTTP / 内部服务暴露给前端和其他模块
- `RawMessageRef` 贯穿消息归一化结果，确保能追到原始来源
- `ProviderFixture` 和 `CompatibilityRule` 共同约束接入质量

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `DRAFT` | provider 仍在开发 | 新 provider 创建 | 契约完成 |
| `CONTRACT_READY` | 契约已满足 | 接口与 descriptor 完成 | 样本补齐 |
| `FIXTURE_READY` | 样本已齐 | 原始样本和期望输出齐全 | 回归通过 |
| `VERIFIED` | 回归与兼容性通过 | fixture-runner 与 compatibility-checker 通过 | 发布或回退 |
| `STABLE` | 可稳定发布 | 发布验收通过 | 被废弃或降级 |
| `DEPRECATED` | 准备下线 | 明确废弃 | 完成移除 |

## 5. 错误处理

### 5.1 错误类型

- `契约错误`：provider 缺接口、缺字段、实现签名不符
- `样本错误`：fixture 缺失、期望输出不完整、样本无法解析
- `兼容错误`：字段破坏性变更、descriptor 缺字段、消息模型不兼容
- `运行错误`：provider 原始存储读取失败、实时订阅异常

### 5.2 错误响应格式

```json
{
  "detail": "provider capability descriptor 缺少必填字段 supportsInterrupt",
  "error_code": "CAPABILITY_FIELD_MISSING",
  "field": "supportsInterrupt",
  "timestamp": "2026-03-22T00:00:00Z"
}
```

### 5.3 处理策略

1. 契约错误：阻止 provider 注册，不允许进入运行期
2. 样本错误：阻止合并，不允许标记为接入完成
3. 兼容错误：阻止发布，要求补兼容处理或更新降级规则
4. 运行错误：隔离在单个 provider 内，不影响其他 provider

## 6. 正确性属性

### 6.1 属性 1：原始消息唯一来源

*对于任何* 新增 provider，系统都应该满足：原始消息只能从 provider 原生存储或原生事件流读取，系统不额外持久化完整消息副本。

**验证需求：** 需求 3

### 6.2 属性 2：能力门控统一出口

*对于任何* provider 能力差异，系统都应该满足：前端和上层模块只能通过 capability descriptor 感知差异，不能依赖 provider 名字散落特判。

**验证需求：** 需求 2、需求 6

### 6.3 属性 3：新增 provider 不污染既有主流程

*对于任何* 新 provider 接入，系统都应该满足：改动范围主要收敛在 provider 目录、样本目录和契约测试目录，既有 provider 与 UI 主流程不需要被强制改写。

**验证需求：** 需求 1、需求 5、需求 6

## 7. 测试策略

### 7.1 单元测试

- `ProviderAdapter` 契约测试
- capability descriptor 字段完整性测试
- compatibility checker 规则测试

### 7.2 集成测试

- provider 注册与加载测试
- 样本回放与归一化结果测试
- provider 级错误隔离测试

### 7.3 端到端测试

- 新 provider 接入清单走查
- 前端 capability gate 对未知 provider 的安全降级验证

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.2、§3.3.1 | 契约测试 + 注册校验 |
| `requirements.md` 需求 2 | `design.md` §3.2.2、§3.3.5、§6.2 | descriptor 契约测试 + 前端联调验证 |
| `requirements.md` 需求 3 | `design.md` §3.2.3、§4.1、§6.1 | 存储边界检查 + 样本回放 |
| `requirements.md` 需求 4 | `design.md` §2.3.3、§3.3.3、§7.2 | fixture-runner 回归测试 |
| `requirements.md` 需求 5 | `design.md` §2.3.1、§2.3.3、§5.3 | 接入清单走查 |
| `requirements.md` 需求 6 | `design.md` §3.2.5、§5.3、§6.3 | 兼容性测试 + 降级验证 |
| `requirements.md` 需求 7 | `design.md` §5.1、§5.3 | 日志与错误报告检查 |

## 8. 风险与待确认项

### 8.1 风险

- provider 原始存储变化过快，样本覆盖不及时
- capability 字段无纪律扩张，导致前后端契约抖动
- 新 provider 开发者为了省事，试图直接改 UI 主流程

### 8.2 待确认项

- fixture 样本中是否需要脱敏规则和共享格式模板
- provider deprecate 流程是否需要单独文档和迁移提示
