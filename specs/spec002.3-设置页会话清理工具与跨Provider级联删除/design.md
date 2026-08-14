# 设计文档 - spec002.3 设置页会话清理工具与跨Provider级联删除

状态：Draft

## 1. 概述

### 1.1 目标

- 给设置页补一个正式的会话清理工具，而不是让用户手工删 provider 文件。
- 把扫描、备份、恢复、删除变成清晰的后台任务链路。
- 删除时真正做到跨层级联删除，避免只删一层留下脏数据。
- 保持现有单条删除接口和会话主链路兼容，不搞平行实现。

### 1.2 覆盖需求

- `requirements.md` 需求 1：设置页必须提供正式的会话清理工具入口
- `requirements.md` 需求 2：系统必须能扫描 Codex、Claude Code、OpenCode 会话，并支持多选和时间范围筛选
- `requirements.md` 需求 3：系统必须支持把选中的会话备份成压缩文件
- `requirements.md` 需求 4：系统必须支持从备份文件中选择会话进行恢复
- `requirements.md` 需求 5：删除会话时必须做跨层级联删除，而不是只删一层
- `requirements.md` 需求 6：整个清理流程必须走正式后台任务，并且读写边界清楚
- `requirements.md` 需求 7：系统必须对部分成功、冲突和不可恢复场景给出结构化结果
- `requirements.md` 需求 8：新能力不能破坏现有单条会话删除主链路

### 1.3 技术约束

- 后台任务必须继续走现有 `TaskManager`，不能新长私有队列。
- 设置页新增 UI 必须遵守现有前端设计规范和 i18n 规则。
- Host 正式 SQLite 链路必须继续使用 `better-sqlite3` 封装，不能引入 `node:sqlite`。
- 删除主链路必须尽量复用 `SessionHistoryService.deleteSession()` 和现有 provider 删除 CLI，不允许复制一套平行删除逻辑。
- 备份和恢复涉及大量磁盘读写，必须离开请求主线程。

## 2. 架构

### 2.1 系统结构

整体结构分成六块：

1. 设置页清理工具面板：负责展示候选结果、筛选、任务状态和确认操作。
2. 清理工具 API：提供扫描请求、读取最近结果、发起备份、读取备份清单、发起恢复、发起删除。
3. 后台任务编排层：把扫描、备份、恢复、删除挂到 `TaskManager`。
4. 会话清理服务：负责候选装配、分层删除、备份清单生成、恢复落地和结果汇总。
5. provider 清理策略：按 Codex / Claude Code / OpenCode 各自存储特点执行扫描、备份和删除。
6. 观测与结果存储：保存最近扫描结果、后台任务结果、逐条失败原因和备份清单元数据。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `SessionCleanupController` | 设置页清理工具的 HTTP 入口 | 请求参数、用户上下文 | 最近结果、任务句柄、备份清单 |
| `SessionCleanupService` | 候选扫描、备份、恢复、删除总编排 | 任务输入、provider 策略、仓储 | 结构化结果 |
| `SessionCleanupTaskRegistry` | 注册清理相关后台任务 | 任务类型、执行位点、超时 | `TaskManager` 任务 |
| `SessionCleanupRepository` | 保存扫描结果摘要、操作结果、备份记录 | 扫描/操作结果 | 持久化记录 |
| `SessionCleanupProviderStrategy` | provider 侧扫描、备份材料收集、级联删除、恢复 | provider 会话定位信息 | provider 结果 |
| `SessionHistoryService` | 复用现有单条删除主链路 | `sessionId`、`userId` | 本地删除结果 |

### 2.3 关键流程

#### 2.3.1 扫描候选会话

1. 用户在设置页点击“扫描会话”。
2. 前端调用 `POST /api/settings/session-cleanup/scans`。
3. Host 创建 `session_cleanup.scan` 后台任务。
4. 任务按 provider 扫描候选：
   - 先读取 CodingNS 已知会话索引
   - 再读取 provider 可见来源
   - 合并成候选列表
5. 每条候选计算统一视图：
   - `provider`
   - `sessionId`
   - `providerSessionId`
   - `rawStoreRef`
   - `workspaceId/workspacePath`
   - 时间范围
   - 文件大小估算
   - 来源健康状态
6. 保存最近扫描结果摘要，前端读取并支持本地筛选、多选。

#### 2.3.2 备份选中会话

1. 用户选择若干候选后点击“备份”。
2. 前端调用 `POST /api/settings/session-cleanup/backups`，提交选中的候选键和目标文件名。
3. Host 创建 `session_cleanup.backup` 后台任务。
4. 任务对每条会话收集可备份材料：
   - CodingNS 已知元数据
   - provider 原始会话文件或结构化导出
   - 本地附件和子代理材料
5. 任务生成 `manifest.json`，然后把正文、附件、清单打包到一个压缩文件。
6. 任务返回备份文件路径、会话数量、失败摘要。

#### 2.3.3 从备份包选择性恢复

1. 用户选择一个备份包。
2. 前端调用 `POST /api/settings/session-cleanup/backup-inspections` 读取清单。
3. Host 返回备份包里的会话列表和冲突预检结果。
4. 用户勾选要恢复的条目，调用 `POST /api/settings/session-cleanup/restores`。
5. Host 创建 `session_cleanup.restore` 后台任务。
6. 恢复流程：
   - 解压到临时目录
   - 校验清单和文件完整性
   - 逐 provider 恢复原始来源或等价落地点
   - 回写 CodingNS 自己的绑定、索引、附件记录
   - 触发必要的 source index 修复或 discovery
7. 返回逐条恢复结果和冲突处理结果。

#### 2.3.4 级联删除选中会话

1. 用户勾选候选后点击“删除”。
2. 前端弹出确认层，明确显示：
   - 是否已备份
   - 影响的 provider 数量
   - 是否包含来源异常条目
3. 用户确认后，前端调用 `POST /api/settings/session-cleanup/deletions`。
4. Host 创建 `session_cleanup.delete` 后台任务。
5. 每条会话按固定顺序删除：
   - 先做 provider 删除预检
   - 再执行 provider 侧删除
   - 再清 CodingNS 本地索引、绑定、附件和衍生文件
   - 最后做来源修复和结果复核
6. 返回逐条、分层的删除结果，而不是一个总成功标记。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7、8

- `SessionCleanupPanel`：设置页入口和主面板。
- `SessionCleanupService`：会话清理总编排服务。
- `SessionCleanupProviderStrategy`：provider 分层策略接口。
- `SessionCleanupRepository`：最近扫描和操作结果持久化。
- `SessionCleanupArchiveService`：备份包写入、读取、校验、解压。

### 3.2 数据结构

覆盖需求：2、3、4、5、7

#### 3.2.1 `SessionCleanupCandidate`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `candidateId` | string | 是 | 候选唯一键 | 稳定，可用于多选 |
| `provider` | string | 是 | `codex \| claude-code \| opencode` | 固定枚举 |
| `sessionId` | string | 否 | CodingNS 本地会话 ID | 可空 |
| `providerSessionId` | string | 否 | provider 会话 ID | 可空 |
| `rawStoreRef` | string | 否 | provider 原始来源定位 | 可空 |
| `workspaceId` | string | 否 | 本地工作区 ID | 可空 |
| `workspacePath` | string | 否 | 工作区路径 | 可空 |
| `title` | string | 否 | 展示标题 | 可空 |
| `startedAt` | string | 否 | 会话开始时间 | ISO8601 |
| `lastMessageAt` | string | 否 | 最近消息时间 | ISO8601 |
| `estimatedBytes` | number | 否 | 大小估算 | 非负整数 |
| `sourceHealth` | string | 是 | `healthy \| partial \| missing \| conflict` | 固定枚举 |
| `deletable` | number | 是 | 是否允许删除 | `0/1` |
| `backupable` | number | 是 | 是否允许备份 | `0/1` |
| `restorable` | number | 是 | 仅用于备份清单视图 | `0/1` |

#### 3.2.2 `SessionCleanupBackupManifest`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `version` | string | 是 | 备份格式版本 | 固定值起步 |
| `createdAt` | string | 是 | 备份时间 | ISO8601 |
| `createdBy` | string | 否 | 触发用户 | 可空 |
| `entries` | array | 是 | 会话条目列表 | 至少 1 条 |
| `summary` | object | 是 | provider 数量、成功失败数量 | 结构化对象 |

#### 3.2.3 `SessionCleanupOperationItemResult`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `candidateId` | string | 是 | 对应候选键 | 必须回显 |
| `provider` | string | 是 | provider 标识 | 固定枚举 |
| `status` | string | 是 | `success \| partial \| failed \| skipped \| conflict` | 固定枚举 |
| `backupStatus` | string | 否 | 备份结果 | 可空 |
| `providerDeleteStatus` | string | 否 | provider 删除结果 | 可空 |
| `localDeleteStatus` | string | 否 | CodingNS 本地删除结果 | 可空 |
| `restoreStatus` | string | 否 | 恢复结果 | 可空 |
| `detail` | string | 否 | 简短说明 | 可空 |

### 3.3 接口契约

覆盖需求：1、2、3、4、5、6、7

#### 3.3.1 读取最近扫描结果

- 类型：HTTP
- 路径或标识：`GET /api/settings/session-cleanup/scans/latest`
- 输入：可选 `provider`、`startAt`、`endAt`
- 输出：最近一次扫描摘要、候选列表、最近任务状态
- 校验：时间范围必须合法
- 错误：无扫描记录时返回空结果，不报错

#### 3.3.2 发起扫描

- 类型：HTTP
- 路径或标识：`POST /api/settings/session-cleanup/scans`
- 输入：provider 过滤、时间范围、是否强制重扫
- 输出：后台任务句柄
- 校验：provider 仅允许三家枚举
- 错误：任务创建失败、参数非法

#### 3.3.3 发起备份

- 类型：HTTP
- 路径或标识：`POST /api/settings/session-cleanup/backups`
- 输入：候选键数组、目标文件名
- 输出：后台任务句柄
- 校验：候选不能为空
- 错误：目标路径非法、候选不可备份

#### 3.3.4 读取备份包清单

- 类型：HTTP
- 路径或标识：`POST /api/settings/session-cleanup/backup-inspections`
- 输入：备份文件路径
- 输出：清单、可恢复条目、冲突预检结果
- 校验：仅允许读取支持格式
- 错误：文件不存在、清单损坏、校验失败

#### 3.3.5 发起恢复

- 类型：HTTP
- 路径或标识：`POST /api/settings/session-cleanup/restores`
- 输入：备份文件路径、条目键数组、冲突策略
- 输出：后台任务句柄
- 校验：条目必须存在于清单中
- 错误：清单损坏、冲突不可恢复、provider 不支持恢复

#### 3.3.6 发起删除

- 类型：HTTP
- 路径或标识：`POST /api/settings/session-cleanup/deletions`
- 输入：候选键数组、是否跳过备份提示确认
- 输出：后台任务句柄
- 校验：候选不能为空
- 错误：候选不可删除、会话正在运行、provider 删除前置条件不满足

## 4. 数据与状态模型

### 4.1 数据关系

- 候选会话是一个聚合视图，不是新的权威主表。
- 权威数据仍分散在：
  - `session_bindings`
  - `session_indices`
  - `session_source_index`
  - 本地附件目录
  - provider 原始来源
- 备份包只保存“恢复所需最小闭包”，不试图复制整个运行时世界。
- 删除结果和恢复结果需要单独持久化，方便设置页重新打开后查看。

### 4.2 状态流转

#### 4.2.1 清理任务状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `queued` | 已入队 | 创建后台任务 | 进入 `running/cancelled` |
| `running` | 执行中 | 任务开始执行 | 进入 `succeeded/partial/failed/cancelled` |
| `succeeded` | 全部成功 | 所有条目成功 | 结束 |
| `partial` | 部分成功 | 至少一条成功，至少一条失败/冲突 | 结束 |
| `failed` | 全部失败 | 所有条目失败 | 结束 |
| `cancelled` | 已取消 | 用户或系统取消 | 结束 |

#### 4.2.2 单条条目状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `ready` | 可操作 | 扫描或读取清单后生成 | 进入 `processing/skipped` |
| `processing` | 正在处理 | 被后台任务取走 | 进入结果态 |
| `success` | 成功 | 当前动作完成 | 结束 |
| `partial` | 部分成功 | 分层结果不一致 | 结束 |
| `failed` | 失败 | 当前动作失败 | 结束 |
| `conflict` | 冲突 | 恢复或删除前置冲突 | 结束 |
| `skipped` | 跳过 | 用户未选择或系统判定不应处理 | 结束 |

## 5. 错误处理

### 5.1 错误类型

- `cleanup_invalid_input`：参数缺失、时间范围非法、候选为空。
- `cleanup_backup_manifest_invalid`：备份清单损坏或版本不支持。
- `cleanup_restore_conflict`：恢复目标冲突，且无法自动处理。
- `cleanup_provider_delete_failed`：provider 侧删除失败。
- `cleanup_local_delete_failed`：CodingNS 本地删除失败。

### 5.2 错误响应格式

```json
{
  "detail": "会话恢复失败：备份清单损坏",
  "error_code": "cleanup_backup_manifest_invalid",
  "field": "archivePath",
  "timestamp": "2026-06-17T00:00:00Z"
}
```

### 5.3 处理策略

1. 输入验证错误：直接拒绝创建任务。
2. 业务规则错误：返回结构化错误和不可用原因。
3. 外部依赖错误：逐条记录 provider 失败，不伪装成整体成功。
4. 重试、降级或补偿：
   - 扫描失败可重扫
   - 备份失败不写入半包
   - 恢复失败只保留已确认成功条目，并触发索引修复
   - 删除失败时保留逐条分层结果，不自动反向“补写回来”

## 6. 正确性属性

### 6.1 属性 1：删除后不回流

*对于任何* 通过清理工具成功删除的会话，系统都应该满足：该会话不会因为 provider 残留或本地脏索引重新进入正常会话列表。

**验证需求：** 需求 5、需求 8

### 6.2 属性 2：恢复是显式选择，不是整包覆写

*对于任何* 备份恢复操作，系统都应该满足：只恢复用户选中的条目，且冲突时不会静默覆盖现有数据。

**验证需求：** 需求 4、需求 7

## 7. 测试策略

### 7.1 单元测试

- 备份清单生成和解析
- 候选筛选逻辑
- 逐条结果汇总逻辑
- provider 策略的输入输出契约

### 7.2 集成测试

- 扫描任务、备份任务、恢复任务、删除任务
- 与 `SessionHistoryService.deleteSession()` 的复用关系
- Codex / Claude Code / OpenCode 的级联删除结果
- 备份包冲突恢复和清单损坏处理

### 7.3 端到端测试

- 设置页打开清理工具
- 扫描后多选、备份、删除、恢复主链路
- 删除后正常列表不回流

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1、需求 2 | `design.md` §2.3.1、§3.3 | 设置页交互测试 + Host 扫描集成测试 |
| `requirements.md` 需求 3 | `design.md` §2.3.2、§3.2 | 备份包生成测试 + 清单解析测试 |
| `requirements.md` 需求 4 | `design.md` §2.3.3、§6.2 | 选择性恢复测试 + 冲突恢复测试 |
| `requirements.md` 需求 5、需求 8 | `design.md` §2.3.4、§6.1 | 级联删除集成测试 + 单条删除回归测试 |
| `requirements.md` 需求 6、需求 7 | `design.md` §4.2、§5 | 后台任务状态测试 + 逐条结果汇总测试 |

## 8. 风险与待确认项

### 8.1 风险

- 不同 provider 的“删除成功”定义不完全一致，容易出现部分成功。
- 恢复到 provider 原始来源时，部分 provider 可能只能做到“可再次发现”，做不到完全原位还原。
- 大批量备份和删除会放大磁盘 I/O 压力，需要严格放在后台任务里。

### 8.2 待确认项

- OpenCode 的恢复是否优先回写 server，还是先落 sqlite/本地等价来源。
- 是否允许对“运行中会话”直接删除，还是必须先阻止。
- 备份包默认落盘目录是否统一放到用户指定位置，还是由 Host 提供默认导出目录。
