# 设计文档 - spec010.4-CLI提供商启用控制与能力矩阵

状态：Draft

## 1. 概述

### 1.1 目标

- 给 provider 启用态建立单一真源
- 禁用 provider 后，从后端动作到前端入口一起收口
- 在设置页提供一张正式、可维护的 provider 能力矩阵
- 借这次改动继续消灭仓库里散落的 provider 可见性硬编码

### 1.2 覆盖需求

- `requirements.md` 需求 1：系统必须提供统一的 provider 启用态真源
- `requirements.md` 需求 2：禁用 provider 后，系统必须把它从所有正常入口隐藏
- `requirements.md` 需求 3：禁用 provider 后，后端必须停止新发现和新动作
- `requirements.md` 需求 4：禁用 provider 后，旧会话必须隐藏但不得删除
- `requirements.md` 需求 5：Skill 和助手相关链路必须遵守 provider 启用态
- `requirements.md` 需求 6：设置页必须提供 provider 启用控制和能力矩阵
- `requirements.md` 需求 7：能力矩阵必须区分原生能力和产品能力
- `requirements.md` 需求 8：禁用 provider 不得破坏现有可用 provider 和旧客户端基本行为

### 1.3 技术约束

- 当前后端 provider 能力定义主要来自 `packages/session-sync-core` 的 `ProviderCapabilities`
- 当前前端 provider 可见性大量依赖静态数组和 provider metadata
- 当前会话发现任务按 `workspaceId` 去重和缓存，不适合把 provider 启用态做成用户级输入
- Skill、Butler、会话创建、Fork、并行会话都已各自长出 provider 列表或白名单
- 后端任务链路必须遵守 `TaskManager` 规范，不能另起一套私有调度逻辑

## 2. 核心判断

### 2.1 启用态归属必须是 Host 全局，而不是账户级偏好

这次最关键的决策只有一个：

provider 启用态默认落在 **Host 全局配置**，不复用账户偏好。

原因：

1. 会话发现、后台刷新、工作台广播这些链路都是 Host 级行为，不是“某个用户自己的私人视图”。
2. 当前工作区发现任务按 `workspaceId` 去重。如果把启用态做成用户级，任务输入就变成 `workspaceId + userId + enabledProviders`，复杂度会直接翻倍。
3. 用户的默认模型、默认推理等级属于偏好；“这个 Host 现在允不允许暴露某个 provider”属于系统配置，不是一回事。

一句人话：

别把“我喜欢什么模型”和“这台 Host 现在允不允许用这个 provider”混成一锅。

### 2.2 禁用的语义是“停止新动作并隐藏旧入口”，不是“删除数据”

禁用 provider 后：

- 不再继续发现它的新会话
- 不再允许新建、继续、发送、Fork、助手跟进、Skill 新同步这些动作
- 旧会话从正常列表里隐藏
- 旧 binding、索引、原始引用仍然保留

这避免了两个蠢问题：

1. 重新启用后，旧会话还能回来，不需要重扫一遍才能补历史。
2. 禁用不会变成一种破坏性数据操作。

### 2.3 能力矩阵不能直接拿 `ProviderCapabilities` 生拼

用户要看的不是一坨原始字段，而是一张“这个 provider 在产品里能干什么”的表。

所以这里拆成两层：

1. **原生能力**：仍然来自 `ProviderCapabilities`
2. **产品能力矩阵**：在 Host 层根据原生能力和产品规则推导出来

例如：

- `工具调用`：来自 `supportsStructuredToolCalls`
- `会话 Fork`：来自 `supportsSessionFork`，再补一个当前项目是否允许跨 provider 重建 Fork
- `助手服务`：不是 provider 原生字段，而是本项目当前是否把它纳入 Butler/跟进正式支持范围
- `Skill 使用`：不是 provider 原生字段，而是当前是否存在对应 `SkillTargetCli` 适配器并允许作为目标

## 3. 架构

### 3.1 目标结构

这次收口拆成五块：

1. `provider-control-store`
2. `provider-catalog-service`
3. `backend-provider-gates`
4. `frontend-provider-visibility`
5. `settings-provider-panel`

### 3.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `provider-control-store` | 保存 Host 全局 provider 启用态 | provider id、enabled | 持久化配置 |
| `provider-catalog-service` | 组合启用态、原生能力、产品能力矩阵 | control store、capability service、产品规则 | provider 总览 DTO |
| `backend-provider-gates` | 在发现、启动、继续、Fork、助手、Skill 等入口统一做硬门禁 | provider id、catalog/control state | 允许/拒绝结果 |
| `frontend-provider-visibility` | 统一过滤前端 provider 列表与入口 | provider catalog | 可见 provider 列表 |
| `settings-provider-panel` | 展示启用开关与能力矩阵 | provider catalog、更新接口 | 设置页 UI |

## 4. 数据与接口设计

### 4.1 启用态存储模型

建议新增独立表，而不是继续往账户偏好 JSON 里塞：

`provider_control_profiles`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `provider_id` | TEXT PRIMARY KEY | provider 唯一标识 |
| `enabled` | INTEGER NOT NULL | `1 = 启用`，`0 = 禁用` |
| `updated_at` | TEXT NOT NULL | 最近修改时间 |

规则：

- 未配置记录的 provider 默认视为启用
- 只存“和默认值不同”也可以，但第一版建议直接显式写全，逻辑更笨更清楚

### 4.2 Provider Catalog DTO

新增正式总览接口，不再让设置页自己拼：

- `GET /api/providers/catalog`
- `PUT /api/providers/catalog/:provider`

建议 DTO：

```ts
interface ProviderCatalogEntryDto {
  provider: ProviderId;
  displayName: string;
  enabled: boolean;
  installState: "ready" | "missing" | "unknown";
  disableImpact: {
    hidesSessions: boolean;
    blocksSessionStart: boolean;
    blocksFork: boolean;
    blocksAssistant: boolean;
    blocksSkillTargets: boolean;
  };
  capabilities: ProviderCapabilitiesDto;
  productCapabilities: {
    streamingOutput: boolean;
    toolCalls: boolean;
    assistantService: boolean;
    sessionFork: boolean;
    skillUsage: boolean;
  };
}
```

这里 `capabilities` 表示 provider 在当前 Host 上的原生能力快照。  
`productCapabilities` 表示本项目会不会把它作为正式产品入口暴露。

### 4.3 错误码

新增统一错误：

- `PROVIDER_DISABLED`

典型场景：

- 已禁用 provider 发起新会话
- 已禁用 provider 继续旧会话
- 已禁用 provider 作为 Fork 目标
- 已禁用 provider 作为 Skill 新目标

返回语义必须统一，别这里叫 unavailable，那里叫 hidden，最后没人知道是不是被关掉了。

## 5. 后端门禁设计

### 5.1 SessionHistoryService 门禁

这里是主链路，必须先收口。

至少要覆盖这些方法：

- `discoverWorkspaceSessions`
- `requestWorkspaceDiscovery`
- `listWorkspaceSessions`
- `getProviderCapabilitiesSnapshot`
- `getProviderCapabilities`
- `getSessionCapabilities`
- `startSession`
- `resumeSession`
- `forkSession`

规则：

1. **发现阶段过滤 provider**
   - disabled provider 不进入发现扫描列表
2. **列表阶段隐藏旧会话**
   - disabled provider 的 `session_indices` 记录不删除，只在 `listWorkspaceSessions` 结果中过滤
3. **动作阶段硬拒绝**
   - 对 disabled provider 的 start/resume/send/fork 统一抛 `PROVIDER_DISABLED`

### 5.2 后台任务与缓存

因为启用态是 Host 全局，所以不需要把 `userId` 再塞进 provider 门禁缓存键里。

需要调整的地方：

- 工作区发现任务运行时，按当前 enabled provider 列表决定扫描范围
- provider capability refresh 不再为 disabled provider 排队
- 若 provider 从 enabled 变为 disabled，应清理对应 capability cache 和前端 capability cache

注意：

- 这次不能重新长私有 `inflight` 或 timer
- 统一走现有 `TaskManager`

### 5.3 Skill 门禁

Skill 管理需要区分两件事：

1. **旧绑定是否保留**：保留
2. **新目标是否可选**：禁用后不可选

所以：

- `SkillManagerService` 扫描旧目录时，仍能识别旧绑定和现状
- `add/sync/import` 这类新动作不能再把 disabled provider 作为目标
- 设置页展示 Skill 目标状态时，要能说清是“provider 被禁用”还是“目录不可用”

### 5.4 Butler / 助手门禁

当前 Butler 只正式支持 `codex` 和 `claude-code`。

这次不扩家族，只收口现有行为：

- 如果 `codex` 或 `claude-code` 被禁用，对应 Butler provider 选择器和跟进入口必须同步收口
- 若某项目默认 provider 指向已禁用项，项目仍保留原记录，但新动作必须要求用户改到可用 provider

### 5.5 ProviderController 与 Catalog Controller

现有单 provider capability 接口继续保留：

- `GET /api/providers/:provider/capabilities`

但需要补两条规则：

1. 若 provider disabled，则返回“有效能力已关闭”的结果或明确错误
2. 设置页不直接靠这条接口拼表，而是走新的 `catalog` 接口

这样老入口不必一次性推翻，新设置页也不用自己扫六次接口。

## 6. 前端设计

### 6.1 可见 provider 单一来源

前端现在最脏的地方，是很多组件自己维护 provider 数组。

至少这些位置要收口到统一 selector / hook：

- 会话创建 provider picker
- 并行会话创建
- Fork 目标 provider
- Butler 跟进 provider
- Skill 目标选项

做法：

1. 保留静态 metadata 只负责图标、名字、排序
2. 动态可见性一律由 `provider catalog` 决定
3. 如果 catalog 还没回来，UI 才允许用静态 metadata 做 loading skeleton，不允许直接当正式列表

### 6.2 设置页面板

设置页新增正式 provider 管理分组，建议放在模型管理附近，但语义独立。

面板结构：

1. 摘要区
   - 当前启用数量
   - 当前禁用数量
2. provider 列表
   - 名称
   - 当前状态
   - 启用开关
   - 能力矩阵

矩阵至少展示：

- 流式输出
- 工具调用
- 助手服务
- 会话 Fork
- Skill 使用

文案要求：

- 不直接把“provider abstract capability descriptor”这种工程话端给用户
- 用“能做什么 / 不能做什么”说人话

### 6.3 能力矩阵映射规则

建议映射如下：

| 矩阵项 | 来源 |
| --- | --- |
| 流式输出 | `capabilities.canSendMessage` + provider 运行时支持流式事件；第一版由 Host 显式映射，不让前端猜 `inRunInputMode` |
| 工具调用 | `capabilities.supportsStructuredToolCalls` |
| 助手服务 | provider 属于 Butler 正式支持范围且 enabled |
| 会话 Fork | `capabilities.supportsSessionFork` 或当前允许重建式 Fork |
| Skill 使用 | provider 存在 `SkillTargetCli` 适配器且 enabled |

这里故意不用前端自行推导。  
原因很简单：有些是协议能力，有些是产品能力，前端猜一次就会猜歪。

### 6.4 旧 capability 缓存失效

前端已经有 provider capability cache。

切换 enabled 状态后，必须一起失效：

- session provider picker capability cache
- Fork provider capability cache
- 任何基于 provider id 的本地可用性缓存

否则用户刚关掉 provider，旧页面还能继续看到它，体验会很蠢。

## 7. 兼容与迁移

### 7.1 默认兼容

升级后：

- 所有现有 provider 默认启用
- 历史会话默认继续可见
- 未打开新设置页的旧使用路径保持现状

### 7.2 禁用后的旧会话处理

不做数据删除，不做 schema 迁移。

处理策略只有一条：

- 查询结果层隐藏

这样重新启用即可恢复，不需要补数或重建 binding。

### 7.3 暂不做的破坏性行为

第一版明确不做：

- 禁用时强制中止正在运行的 provider 进程
- 自动修改 Butler 项目默认 provider
- 自动移除旧 Skill 目录副本

这些都属于额外“治理动作”，不是这次基础门禁该干的事。

## 8. 验证策略

### 8.1 后端验证

- `ProviderControlRepository` 仓储测试
- `ProviderCatalogService` 组合测试
- `SessionHistoryService`：
  - disabled provider 不参与发现
  - disabled provider 的旧会话不出现在列表
  - disabled provider 的 start/resume/fork 被拒绝
- `SkillManagerService`：
  - disabled provider 不能作为新目标
- Butler / assistant 跟进相关门禁测试

### 8.2 前端验证

- 设置页 provider 管理面板测试
- provider picker / Fork / 并行会话 / Butler 跟进入口过滤测试
- capability cache 失效测试

### 8.3 人工验收

至少验这几步：

1. 关闭某个 provider 后，设置页矩阵仍可见，但业务入口消失
2. 关闭某个 provider 后，旧会话从正常列表消失
3. 再重新启用，旧会话重新出现
4. 关闭 `codex` 或 `claude-code` 后，Butler 跟进入口同步变化
5. 关闭支持 Skill 的 provider 后，Skill 新建目标不再可选

## 9. 风险与对策

### 9.1 最大风险

前后端现在都有散落的 provider 列表，只改一两个地方一定会漏。

### 9.2 对策

- 先用 catalog 做单一来源
- 先补现状盘点清单，再按清单回归
- 关键入口一律加测试，不靠肉眼保证

### 9.3 次级风险

Butler、Skill、会话主链路里都各有 provider 白名单，稍不注意就会出现“设置页关掉了，但某个角落还能用”。

### 9.4 对策

- 统一把“是否允许当前动作”收敛到后端门禁服务
- 前端只负责隐藏入口，后端负责真正拒绝
