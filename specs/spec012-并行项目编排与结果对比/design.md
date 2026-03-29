# 设计文档 - spec012-并行项目编排与结果对比

状态：Draft

## 1. 概述

### 1.1 目标

- 把“同一个问题下的多条并行尝试”做成正式领域模型
- 基于 `git worktree` 管理独立代码目录，而不是只记分支名
- 为每个尝试分配独立运行时边界，避免端口、数据库、缓存互相污染
- 复用现有进程管理能力启动和调试尝试
- 产出统一结果快照，支撑多尝试对比和最终 merge 决策

### 1.2 覆盖需求

- `requirements.md` 需求 1：并行案例与并行尝试模型
- `requirements.md` 需求 2：`git worktree` 生命周期管理
- `requirements.md` 需求 3：运行时隔离
- `requirements.md` 需求 4：启动与调试复用
- `requirements.md` 需求 5：多 provider 编排
- `requirements.md` 需求 6：结果快照与对比
- `requirements.md` 需求 7：合并建议
- `requirements.md` 需求 8：清理与回收
- `requirements.md` 需求 9：兼容现有主链路

### 1.3 技术约束

- Git 基础能力沿用 `spec005`
- 进程启动、日志、端口识别沿用 `spec007`
- provider 元数据与编排入口沿用 `spec010`
- 工作区、鉴权、存储边界沿用 `spec001`
- 第一阶段不引入容器编排，也不要求跨机器调度

## 2. 核心思路

### 2.1 为什么核心对象不是 branch

分支只是 Git 指针，不是可运行的尝试。

一个真正可管理的尝试，至少要同时回答下面几个问题：

1. 代码在哪个目录
2. 基于哪个分支或提交创建
3. 由哪个 provider 负责
4. 用什么命令启动
5. 占用哪些端口
6. 用哪个数据目录和缓存目录
7. 最后跑出来的结果怎么样

所以系统里的一等对象必须是 `ParallelAttempt`，而不是 branch。

### 2.2 总体结构

系统围绕一个 `ParallelCase` 编排多个 `ParallelAttempt`。

每个 `ParallelAttempt` 会绑定：

- 一个 Git worktree
- 一个独立运行时目录
- 一个 `RunProfile`
- 零到多个进程实例
- 一个最新的 `AttemptResult`

整条主链路如下：

1. 用户创建 `ParallelCase`
2. 系统按 provider 列表生成多个 `ParallelAttempt`
3. `WorktreeManager` 为每个尝试创建分支和 worktree
4. `RuntimeIsolationManager` 为每个尝试分配端口块和目录
5. `AttemptRunner` 复用 `spec007` 启动尝试
6. `ResultCollector` 采集 diff、测试、健康检查和日志摘要
7. `CompareService` 输出对比视图
8. `MergeAdvisor` 输出合并建议
9. `CleanupService` 负责停止进程、清理目录、回收资源

## 3. 架构

### 3.1 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `parallel-case-service` | 管理案例和尝试的主编排 | 创建案例、创建尝试、查询请求 | `ParallelCase`、`ParallelAttempt` |
| `worktree-manager` | 创建、列出、删除 worktree | `repoPath`、`baseRef`、`branchName` | `worktreePath`、同步状态 |
| `runtime-isolation-manager` | 分配端口块和运行目录 | `attemptId`、模板参数 | `RuntimeAllocation` |
| `run-profile-service` | 管理启动、测试、健康检查配置 | 配置请求 | `RunProfile` |
| `attempt-runner` | 启动、停止、重启尝试进程 | `attemptId`、`RunProfile` | 进程实例、运行状态 |
| `result-collector` | 采集尝试结果快照 | `attemptId`、采集动作 | `AttemptResult` |
| `compare-service` | 组织对比视图和排序建议 | `caseId` | `AttemptComparisonView` |
| `merge-advisor` | 生成 merge / cherry-pick 建议 | `caseId`、候选尝试 | `MergeRecommendation` |
| `cleanup-service` | 回收 worktree 与运行时资源 | `attemptId`、`caseId` | 清理结果 |

### 3.2 与现有能力的关系

- Git 命令执行、分支查询、diff 读取复用 `spec005`
- 进程实例、日志、端口识别复用 `spec007`
- provider 信息和后续 provider 扩展复用 `spec010`
- 工作区边界、仓库边界、鉴权复用 `spec001`

这里的原则很死：**不复制现有能力，只在上层做编排。**

## 4. 数据结构

### 4.1 `ParallelCase`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 案例 ID | 全局唯一 |
| `workspaceId` | string | 是 | 归属工作区 | 必须存在 |
| `title` | string | 是 | 案例标题 | 长度 1-120 |
| `slug` | string | 是 | 机器可用标识 | 同工作区唯一 |
| `problemStatement` | string | 否 | 问题说明 | 可为空 |
| `repoPath` | string | 是 | 仓库路径 | 必须在工作区边界内 |
| `baseRef` | string | 是 | 基准分支或提交 | 非空 |
| `status` | string | 是 | 案例状态 | `DRAFT/RUNNING/COMPARING/ARCHIVED` |
| `createdAt` | string | 是 | 创建时间 | ISO8601 |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

### 4.2 `ParallelAttempt`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 尝试 ID | 全局唯一 |
| `caseId` | string | 是 | 所属案例 | 外键 |
| `providerId` | string | 是 | provider 标识 | 非空 |
| `label` | string | 是 | 展示名 | 默认取 provider 名 |
| `branchName` | string | 是 | 尝试分支名 | 在仓库内唯一 |
| `baseRef` | string | 是 | 创建尝试时使用的基准 | 非空 |
| `worktreePath` | string | 是 | 独立代码目录 | 必须存在于允许边界 |
| `runtimeDir` | string | 是 | 运行时目录 | 必须存在于允许边界 |
| `runProfileId` | string | 否 | 绑定的运行配置 | 可为空 |
| `portBlockStart` | number | 否 | 分配端口块起点 | 可为空 |
| `status` | string | 是 | 尝试状态 | `READY/RUNNING/PASSED/FAILED/STOPPED/DELETED` |
| `latestProcessId` | string | 否 | 最近进程实例 | 可为空 |
| `latestResultId` | string | 否 | 最近结果快照 | 可为空 |
| `createdAt` | string | 是 | 创建时间 | ISO8601 |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

### 4.3 `RuntimeAllocation`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `attemptId` | string | 是 | 尝试 ID | 外键 |
| `portBlockStart` | number | 是 | 端口块起点 | 必须可用 |
| `portBlockSize` | number | 是 | 端口块大小 | 默认固定值 |
| `envFilePath` | string | 是 | 环境文件路径 | 允许生成 |
| `dataDir` | string | 是 | 数据目录 | 独立 |
| `logDir` | string | 是 | 日志目录 | 独立 |
| `cacheDir` | string | 是 | 缓存目录 | 独立 |
| `tmpDir` | string | 是 | 临时目录 | 独立 |
| `userDataDir` | string | 否 | 桌面端用户数据目录 | 需要时可分配 |

### 4.4 `RunProfile`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 配置 ID | 全局唯一 |
| `attemptId` | string | 是 | 归属尝试 | 外键 |
| `name` | string | 是 | 配置名称 | 非空 |
| `cwd` | string | 是 | 启动目录 | 必须位于 worktree 内 |
| `command` | string | 是 | 启动命令 | 非空 |
| `args` | json | 否 | 参数数组 | 默认空数组 |
| `env` | json | 否 | 环境变量覆盖 | 默认空对象 |
| `expectedPorts` | json | 否 | 预期端口映射 | 默认空对象 |
| `healthCheckUrl` | string | 否 | 验活地址 | 可为空 |
| `testCommand` | string | 否 | 测试命令 | 可为空 |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

### 4.5 `AttemptResult`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 结果 ID | 全局唯一 |
| `attemptId` | string | 是 | 对应尝试 | 外键 |
| `headCommit` | string | 否 | 当前提交 | 可为空 |
| `diffSummary` | json | 是 | diff 摘要 | 默认空对象 |
| `testStatus` | string | 是 | 测试状态 | `NOT_RUN/PASSED/FAILED` |
| `healthStatus` | string | 是 | 健康检查状态 | `NOT_RUN/PASSED/FAILED` |
| `logSummary` | string | 否 | 日志摘要 | 可为空 |
| `manualVerdict` | string | 否 | 人工结论 | 可为空 |
| `capturedAt` | string | 是 | 采集时间 | ISO8601 |

## 5. 关键流程

### 5.1 创建案例与尝试

1. 客户端调用 `POST /api/parallel-cases`
2. `parallel-case-service` 校验工作区、仓库边界和 `baseRef`
3. 系统创建 `ParallelCase`
4. 若请求包含 provider 列表，则循环创建 `ParallelAttempt`
5. `worktree-manager` 为每个尝试创建分支和 worktree
6. `runtime-isolation-manager` 为每个尝试分配目录和端口块
7. 返回案例详情和全部尝试

### 5.2 启动尝试

1. 客户端调用 `POST /api/parallel-attempts/{attemptId}/run`
2. 系统读取 `RunProfile` 与 `RuntimeAllocation`
3. `attempt-runner` 生成最终命令、环境变量和启动目录
4. 复用 `spec007` 的进程启动链路创建 `ProcessInstance`
5. 回写 `latestProcessId` 和 `status=RUNNING`
6. 通过 WebSocket 推送尝试状态变化

### 5.3 采集结果

1. 客户端调用 `POST /api/parallel-attempts/{attemptId}/capture`
2. `result-collector` 读取当前 Git HEAD、diff 摘要、测试结果、健康检查结果、日志摘要
3. 生成新的 `AttemptResult`
4. 更新尝试上的 `latestResultId`
5. 若案例下全部尝试都已有结果，则案例状态可进入 `COMPARING`

### 5.4 对比和建议

1. 客户端调用 `GET /api/parallel-cases/{caseId}/comparison`
2. `compare-service` 汇总全部 `AttemptResult`
3. 输出统一对比结构，包括：
   - provider
   - 分支
   - diff 规模
   - 测试状态
   - 健康检查状态
   - 人工结论
4. `merge-advisor` 输出建议，但不执行 merge

### 5.5 清理

1. 客户端调用 `POST /api/parallel-attempts/{attemptId}/cleanup` 或 `POST /api/parallel-cases/{caseId}/cleanup`
2. `cleanup-service` 停止相关进程
3. 回收端口块和运行时目录
4. 删除 worktree
5. 保留结果记录和关键日志索引

## 6. 接口契约

### 6.1 `POST /api/parallel-cases`

- 输入：`workspaceId/title/problemStatement/repoPath/baseRef/providers?`
- 输出：`ParallelCaseDetail`
- 说明：支持一次性创建案例和默认尝试

### 6.2 `GET /api/parallel-cases`

- 输入：`workspaceId/status?`
- 输出：`ParallelCaseSummary[]`

### 6.3 `GET /api/parallel-cases/{caseId}`

- 输入：`caseId`
- 输出：案例详情 + 尝试列表 + 最近结果摘要

### 6.4 `POST /api/parallel-cases/{caseId}/attempts`

- 输入：`providerId[]` 或单个尝试创建参数
- 输出：创建后的 `ParallelAttempt[]`

### 6.5 `POST /api/parallel-attempts/{attemptId}/run`

- 输入：`attemptId` + 可选运行覆盖参数
- 输出：启动后的尝试状态与进程信息

### 6.6 `POST /api/parallel-attempts/{attemptId}/stop`

- 输入：`attemptId`
- 输出：停止结果

### 6.7 `POST /api/parallel-attempts/{attemptId}/capture`

- 输入：`attemptId`
- 输出：新的 `AttemptResult`

### 6.8 `GET /api/parallel-cases/{caseId}/comparison`

- 输入：`caseId`
- 输出：`AttemptComparisonView`

### 6.9 `POST /api/parallel-attempts/{attemptId}/cleanup`

- 输入：`attemptId`
- 输出：清理结果

## 7. 状态模型

### 7.1 `ParallelCase.status`

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `DRAFT` | 案例已创建，尝试尚未开始 | 刚创建 | 有尝试进入运行 |
| `RUNNING` | 至少有一个尝试在运行 | 任一尝试启动 | 全部停止且开始比对 |
| `COMPARING` | 已有结果，正在比较 | 至少一条结果可用 | 归档或继续运行 |
| `ARCHIVED` | 案例已完成或已清理 | 用户归档 | 不可逆 |

### 7.2 `ParallelAttempt.status`

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `READY` | 目录和资源已准备好 | 尝试创建完成 | 启动或删除 |
| `RUNNING` | 正在运行 | 启动成功 | 停止、失败 |
| `PASSED` | 结果采集显示通过 | 测试/健康检查通过 | 继续运行、删除 |
| `FAILED` | 启动或验证失败 | 进程失败、测试失败、验活失败 | 重试、删除 |
| `STOPPED` | 已停止但保留资源 | 手动停止 | 再次启动或删除 |
| `DELETED` | 尝试已清理 | 删除或清理完成 | 终态 |

## 8. 错误处理

### 8.1 错误类型

- `边界错误`：worktree 或运行目录越出允许路径
- `Git 错误`：`baseRef` 不存在、分支冲突、worktree 创建失败
- `资源错误`：端口块无可用资源、目录创建失败
- `执行错误`：启动命令失败、健康检查失败、测试失败
- `清理错误`：进程未停止、目录不可删除、资源回收失败

### 8.2 关键原则

1. 失败要限制在尝试范围内，不能拖垮整个工作区
2. 错误必须能定位到 `caseId`、`attemptId`、`branchName`、`worktreePath`
3. 清理失败不能假装成功，必须保留残留资源信息

## 9. 兼容性与迁移

### 9.1 向后兼容

- 不使用并行案例功能的用户，不应感知到行为变化
- Git、进程、provider 现有接口保持可用
- 并行能力优先作为上层编排模块接入，不改坏底层主链路

### 9.2 分阶段实施建议

第一阶段：

- 建模型
- 建 worktree 管理
- 建运行时隔离
- 打通启动与结果采集

第二阶段：

- 做对比视图
- 做合并建议
- 做批量清理

第三阶段：

- 做模板化案例创建
- 做更多 provider 策略扩展
- 做更细的结果评分规则
