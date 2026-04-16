# 设计文档 - spec007.1-外部仓库调试进程端口编排与启动适配

状态：Draft

## 1. 概述

### 1.1 目标

- 在 `spec007` 的进程管理底座上，加一层“外部仓库调试运行时编排”
- 先以进程管理里已登记的启动项为真相源，再用框架分析决定端口注入和服务联动方式
- 让平台能用统一方式描述外部仓库里的多个调试服务
- 先用跨平台可落地的端口注入方式解决冲突
- 明确 AI 编辑只做兜底，并且全程可审计、可回滚

### 1.2 覆盖需求

- `requirements.md` 需求 1：项目框架分析与自动注入准入
- `requirements.md` 需求 2：外部仓库调试服务统一数据模型
- `requirements.md` 需求 3：启动适配分层设计
- `requirements.md` 需求 4：端口租约机制
- `requirements.md` 需求 5：AI 兜底编辑约束
- `requirements.md` 需求 6：第一阶段最小落地边界

### 1.3 技术约束

- 不依赖 Docker、Kubernetes、Dev Container
- 必须兼容 `macOS/Linux/Windows`
- 主链路不依赖 Linux 专属网络能力
- 默认不改受管仓库里的 tracked 文件
- 优先复用 `spec007` 的进程、日志、端口、启动器能力

## 2. 核心思路

### 2.1 这个问题真正要管理的不是“端口”，而是“服务”

端口冲突只是结果，不是对象。

真正要被平台理解的是：

- 这是哪个外部仓库
- 它里面有哪些调试服务
- 每个服务扮演什么角色
- 每个服务怎么启动
- 它默认想监听哪个端口
- 平台最后把它改成了哪个真实端口

一句人话：
先把服务对象建对，端口分配才不会变成满地补丁。

### 2.2 不要把“改端口”理解成“改源码”

同样是把 `5173` 改成 `43101`，有五种完全不同的方式：

1. CLI 参数
2. 环境变量
3. 运行时覆盖文件
4. 临时启动脚本
5. AI 修改仓库配置

正确顺序必须是从最少破坏到最大破坏：

`CLI 参数 -> 环境变量 -> 覆盖产物 -> AI 兜底编辑`

### 2.3 先做框架分析，再谈自动注入

不是所有项目都值得自动注入。

平台必须先回答四个问题：

1. 这是什么框架或启动形态
2. 这个框架有没有正式的端口覆盖入口
3. 它是否还需要额外处理前后端发现、HMR、回调地址
4. 它是 `supported`、`conditional`、`unsupported` 还是 `unknown`

只有 `supported/conditional` 才能自动进入端口注入链路。

### 2.4 第一阶段不做万能识别器

第一阶段只做最常见、最有价值的一批：

- Vite / Next / CRA 这类前端开发服务
- Node 常见后端服务
- Spring Boot 单服务
- Uvicorn / Django / Flask 这类单服务 Python 项目

不承诺：

- 一次识别任意 monorepo 的全部服务
- 自动修复项目本身的构建错误
- 完整支持每种框架的所有边角参数

## 3. 架构

### 3.1 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `debug-target-service` | 管理受管仓库的调试目标与服务清单 | 仓库路径、工作树信息、用户配置 | `DebugTargetProfile` |
| `framework-analysis-service` | 识别项目框架、兼容等级和额外处理项 | 仓库特征、配置文件、命令模板 | `FrameworkAnalysisResult` |
| `launch-adapter-registry` | 按技术栈选择启动适配器 | 仓库特征、命令模板、文件探测结果 | `LaunchAdapter` |
| `launch-plan-resolver` | 决定本次启动的注入方式与端口需求 | 调试目标、服务角色、适配器结果 | `LaunchPlan` |
| `port-lease-service` | 分配、续租、回收端口租约 | 服务角色、运行时 ID | `PortLeaseRecord` |
| `runtime-binding-service` | 记录实际监听端口和访问入口 | 进程实例、租约、探测结果 | `RuntimeBinding` |
| `override-artifact-service` | 生成临时覆盖产物 | 注入方案、工作目录、端口 | `OverrideArtifact` |
| `ai-fallback-orchestrator` | 管理 AI 兜底编辑的准入、补丁和回滚 | 失败上下文、允许编辑范围 | `AiFallbackEditRecord` |

### 3.2 与现有 spec007 的关系

- `LauncherProfile` 继续表示底层“怎么执行命令”
- `ProcessInstance` 继续表示底层“某次进程运行记录”
- `spec007.1` 新增的是：
  - 外部仓库调试目标
  - 服务角色
  - 启动适配决策
  - 端口租约
  - AI 兜底编辑记录

原则只有一句：
**`spec007` 管进程，`spec007.1` 管外部仓库调试运行时。**

### 3.3 前端调试页的真相源必须单一

前端这里最容易长歪。

如果一边展示“仓库分析出来的服务”，一边又拿这些分析结果去猜启动命令、猜框架入口、猜端口覆盖方式，最后一定会和进程管理里已经登记的启动项打架。

所以前端必须拆成两条明确的数据线：

1. **分析展示线**
   - 数据源：`analyzeDebugTarget`、兼容矩阵
   - 作用：只读展示仓库分析、框架识别、兼容等级、说明、参考文件
   - 明确不做：不参与启动决策，不生成前端侧启动方案
2. **启动执行线**
   - 数据源：进程管理里的 `TerminalCommandTemplate`、端口池配置、工作区类型和编排结果
   - 作用：决定复制到子工作区的启动模板如何重新分配端口、前端如何联动后端地址、哪些启动项可以实际执行
   - 明确不做：不猜框架命令，不补全未登记启动项，不在前端本地拼接假启动方案

一句人话：
**分析结果负责“告诉你这仓库像什么”，已注册启动项负责“告诉你现在到底启动什么”，端口池负责“告诉你子工作区应该用哪个新端口”。**

### 3.4 当前已经落地的主链路

这一轮实现后，主链路明确变成下面四步：

1. 主工作区在进程管理里登记真实启动项
2. 创建子工作区时自动复制这些启动模板
3. 调试页点击“检查启动方案”时，Host 根据工作区类型、端口池、框架分析和当前端口占用生成真实编排结果
4. 执行启动时按编排后的参数、环境变量和端口运行，而不是继续拿登记端口硬顶

现在前端不会再因为“登记端口占用”就直接判死，而是会先进入编排。

## 4. 数据结构

### 4.1 `DebugTargetProfile`

表示一个受管仓库或某个工作树下的调试目标。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 调试目标 ID |
| `workspaceId` | string | 是 | 对应工作区 |
| `rootPath` | string | 是 | 仓库根目录 |
| `displayName` | string | 是 | 展示名称 |
| `stackHint` | string | 否 | 技术栈提示，例如 `vite`、`next`、`spring-boot` |
| `sourceType` | string | 是 | `repo/worktree` |
| `createdAt` | string | 是 | 创建时间 |
| `updatedAt` | string | 是 | 更新时间 |

### 4.2 `FrameworkAnalysisResult`

表示平台对当前仓库或服务做出的框架分析结论。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 分析记录 ID |
| `targetId` | string | 是 | 归属调试目标 |
| `serviceId` | string | 否 | 可选，针对单服务分析时使用 |
| `primaryFramework` | string | 否 | 主判断结果，例如 `vite`、`nextjs`、`spring-boot` |
| `confidence` | string | 是 | `high/medium/low` |
| `compatibilityLevel` | string | 是 | `supported/conditional/unsupported/unknown` |
| `recommendedInjectionMode` | string | 否 | `cli/env/override/none` |
| `requiresServiceDiscoveryHandling` | boolean | 是 | 是否需要额外处理前后端发现 |
| `requiresHmrHandling` | boolean | 是 | 是否需要额外处理 HMR/WS |
| `requiresCallbackHandling` | boolean | 是 | 是否需要额外处理 redirect/webhook/callback |
| `aiFallbackPolicy` | string | 是 | `never/conditional/allowed` |
| `reasons` | json | 是 | 命中规则和结论原因 |
| `detectedFiles` | json | 否 | 参与判断的配置文件 |
| `createdAt` | string | 是 | 创建时间 |

### 4.3 `DebugServiceSpec`

描述调试目标下一个服务该怎么被识别和启动。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 服务 ID |
| `targetId` | string | 是 | 归属调试目标 |
| `role` | string | 是 | `frontend/backend/worker/mock/custom` |
| `name` | string | 是 | 服务显示名 |
| `cwd` | string | 是 | 启动目录 |
| `command` | string | 是 | 启动命令 |
| `args` | json | 否 | 启动参数 |
| `env` | json | 否 | 基础环境变量 |
| `defaultPortHint` | number | 否 | 框架默认端口提示 |
| `protocol` | string | 否 | `http/ws/tcp` |
| `healthPath` | string | 否 | 可选健康检查路径 |
| `adapterKind` | string | 否 | 当前建议适配器 |
| `frameworkAnalysisId` | string | 否 | 对应框架分析结果 |

### 4.4 `DebugRuntimeSession`

表示一次完整的调试启动尝试。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 运行时 ID |
| `targetId` | string | 是 | 归属调试目标 |
| `status` | string | 是 | `PREPARING/RUNNING/FAILED/STOPPED` |
| `startedAt` | string | 否 | 启动时间 |
| `stoppedAt` | string | 否 | 停止时间 |
| `failureStage` | string | 否 | 失败发生在哪层适配链路 |
| `createdAt` | string | 是 | 创建时间 |
| `updatedAt` | string | 是 | 更新时间 |

### 4.5 `RuntimeBinding`

记录某个服务在某次运行里最终绑定到了什么地址。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 绑定记录 ID |
| `runtimeId` | string | 是 | 归属运行时 |
| `serviceId` | string | 是 | 归属服务 |
| `processInstanceId` | string | 否 | 对应 `spec007` 进程实例 |
| `expectedPort` | number | 否 | 原始端口提示 |
| `leasedPort` | number | 否 | 分配的租约端口 |
| `observedPort` | number | 否 | 实际监听端口 |
| `proxyPath` | string | 否 | 稳定访问路径，第一阶段可为空 |
| `status` | string | 是 | `ALLOCATED/LISTENING/FAILED/RELEASED` |
| `updatedAt` | string | 是 | 更新时间 |

### 4.6 `PortLeaseRecord`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 租约 ID |
| `runtimeId` | string | 是 | 归属运行时 |
| `serviceId` | string | 是 | 归属服务 |
| `port` | number | 是 | 租约端口 |
| `protocol` | string | 是 | `tcp/udp` |
| `status` | string | 是 | `LEASED/RELEASING/RELEASED/STALE` |
| `leasedAt` | string | 是 | 分配时间 |
| `expiresAt` | string | 否 | 过期时间 |
| `releasedAt` | string | 否 | 释放时间 |

### 4.7 `AiFallbackEditRecord`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 记录 ID |
| `runtimeId` | string | 是 | 归属运行时 |
| `serviceId` | string | 是 | 归属服务 |
| `reason` | string | 是 | 进入 AI 兜底的原因 |
| `allowedFiles` | json | 是 | 允许编辑文件清单 |
| `targetPort` | number | 是 | 目标端口 |
| `patchRef` | string | 否 | 补丁引用 |
| `rollbackRef` | string | 否 | 回滚引用 |
| `status` | string | 是 | `PENDING/APPLIED/ROLLED_BACK/REJECTED` |
| `createdAt` | string | 是 | 创建时间 |

## 5. 启动适配器分层

### 5.0 准入前提

自动端口注入前必须先有 `FrameworkAnalysisResult`。

规则如下：

1. `supported`
   - 允许自动注入
2. `conditional`
   - 只有满足额外处理项时才允许自动注入
3. `unsupported`
   - 不允许自动注入，默认转人工或直接停止
4. `unknown`
   - 不允许自动注入，除非用户显式确认进入受限兜底流程

### 5.1 适配器分层规则

同一个服务启动前，平台按固定顺序尝试：

1. `CliPortAdapter`
   - 适用于 `vite --port`、`next dev -p` 这类可以直接带端口参数的项目
2. `EnvPortAdapter`
   - 适用于 `PORT`、`SERVER_PORT`、`WDS_SOCKET_PORT` 这类环境变量覆盖
3. `RuntimeOverrideAdapter`
   - 适用于生成临时配置文件、临时脚本或附加 JVM 参数的项目
4. `AiFallbackAdapter`
   - 前三层都失败时才允许进入

### 5.2 适配器接口

```ts
interface LaunchAdapter {
  kind: "cli" | "env" | "override" | "ai_fallback";
  canHandle(input: DebugServiceSpec, context: LaunchProbeContext): Promise<AdapterMatchResult>;
  buildPlan(input: DebugServiceSpec, context: LaunchPlanContext): Promise<LaunchPlan>;
  verify?(input: LaunchVerificationContext): Promise<LaunchVerificationResult>;
}
```

### 5.3 `LaunchPlan`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `serviceId` | string | 是 | 归属服务 |
| `adapterKind` | string | 是 | 实际选用适配器 |
| `injectionMode` | string | 是 | `cli/env/override/ai_fallback` |
| `leasedPorts` | json | 是 | 本次申请的端口 |
| `command` | string | 是 | 最终执行命令 |
| `args` | json | 否 | 最终参数 |
| `envPatch` | json | 否 | 环境变量补丁 |
| `artifactRef` | string | 否 | 临时覆盖产物引用 |

### 5.4 前后端发现与 HMR 的额外处理

不是所有框架只改监听端口就够了。

平台必须在框架分析阶段决定是否补以下处理：

- `serviceDiscovery`
  - 前端是否需要注入 `API_BASE_URL`
  - 是否推荐改走同源 `/api`
- `hmr`
  - 是否需要额外注入 HMR WebSocket 端口、Host、Path
- `callback`
  - 是否需要提醒 redirect URI、webhook、OAuth callback 跟着调整

如果框架兼容矩阵要求额外处理，而当前启动计划没有补齐，就不能自动进入运行态。

## 6. 端口分配与回收规则

### 6.1 分配规则

1. 按服务角色申请端口，不按“仓库整体”一次性乱分
2. 同一运行时内，不同服务角色必须拿到不同端口
3. 优先从平台管理的租约池分配，不直接相信“默认端口空着”
4. 分配前检查：
   - 是否被其他受管运行时持有
   - 是否已被宿主机其他进程占用

### 6.2 回收规则

1. 进程正常退出后立即释放
2. 启动失败但未真正监听时立即释放
3. 平台异常退出后，Host 恢复阶段扫描 `RUNNING` 运行时：
   - 对已不存在的进程，标记租约为 `STALE`
   - 对 `STALE` 租约执行回收

### 6.3 冲突处理

- 若租约已存在：直接拒绝重复绑定
- 若宿主机被外部未知进程占用：
  - 当前租约分配失败
  - 返回明确冲突信息
  - 重新申请下一可用端口

## 7. AI 兜底编辑协议

### 7.1 进入条件

只有下面条件同时成立，才允许进 AI 兜底：

- `FrameworkAnalysisResult.aiFallbackPolicy !== "never"`
- `CliPortAdapter` 失败
- `EnvPortAdapter` 失败
- `RuntimeOverrideAdapter` 失败
- 服务属于第一阶段支持范围
- 平台能把候选配置文件收敛到有限列表

### 7.2 编辑约束

- 只允许修改：
  - 端口配置文件
  - 启动脚本入口
  - 开发环境专用配置
- 不允许修改：
  - 业务源码
  - 数据库迁移
  - 依赖清单
  - 正式发布配置
- 必须记录：
  - 修改前后端口值
  - 修改文件列表
  - 补丁内容
  - 回滚方法

### 7.3 退出规则

- 启动成功且用户确认保留：允许继续使用临时补丁
- 用户取消或准备提交代码：必须支持一键回滚
- 无法安全回滚：直接阻止进入默认提交流程

## 8. 第一阶段最小实现边界

### 8.1 第一阶段支持

- 单仓库或单工作树下的 1 到 3 个调试服务
- 常见角色：
  - `frontend`
  - `backend`
  - `worker`
- 常见技术栈：
  - Vite
  - Next.js
  - CRA
  - Astro
  - Nuxt
  - Node 原生 / Express / Nest 常见 dev 命令
  - Spring Boot 单服务
  - Uvicorn / Flask / Django 单服务

第一阶段的具体兼容矩阵、推荐注入方式、HMR/服务发现补充要求和 AI 兜底判定，统一维护在：

- `docs/20260413-框架兼容矩阵.md`

### 8.2 第一阶段明确不做

- 自动拆解复杂 monorepo 的全部服务图
- 多代理入口统一发布
- 自动处理数据库、Redis、MQ 这类外部依赖
- 自动修复项目构建脚本本身的错误

### 8.3 第一阶段完成标志

- 平台能用统一模型登记调试目标和服务
- 启动时能按适配器分层为服务分配端口
- 启动失败时能明确告诉用户失败在哪一层
- AI 兜底编辑具备最小约束和回滚记录

第一阶段的表、API、前端展示和 `LauncherProfile / ProcessInstance` 扩展建议，统一维护在：

- `docs/20260413-实现清单.md`

## 9. 测试策略

### 9.1 单元测试

- 框架分析规则与兼容等级判定
- 适配器匹配规则
- 端口租约状态流转
- AI 编辑准入判断

### 9.2 集成测试

- 兼容框架识别后自动开启注入
- 不兼容框架识别后拒绝自动注入
- 单服务项目启动并注入非默认端口
- 前后端双服务项目并行分配端口
- 端口冲突后重新分配
- AI 兜底路径只在前三层失败后触发

### 9.3 端到端验证

- 用户导入外部仓库
- 平台识别服务
- 分配端口并启动
- 查看最终绑定端口和失败原因
- 停止后租约被释放
