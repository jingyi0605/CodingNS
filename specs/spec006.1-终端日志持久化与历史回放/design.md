# 设计文档 - spec006.1-终端日志持久化与历史回放

状态：Draft

## 1. 概述

### 1.1 目标

- 把终端输出从“临时补回缓存”升级成“正式持久化日志”
- 保持当前 `xterm` 作为前端滚动视口，不把 `tmux copy-mode` 绑成默认交互
- 用“内存热缓存 + 本地日志文件 + SQLite 索引”三层结构解决长历史查看问题
- 让 `tmux`、Windows `embedded-pty`、未来 runtime 都走同一套日志链路

### 1.2 覆盖需求

- `requirements.md` 需求 1：终端日志默认保留
- `requirements.md` 需求 2：仅在关闭或删除时清理
- `requirements.md` 需求 3：文件正文 + SQLite 索引
- `requirements.md` 需求 4：热缓存 + 批量 flush
- `requirements.md` 需求 5：前端历史回放
- `requirements.md` 需求 6：不同 runtime 统一日志语义

### 1.3 技术约束

- 后端继续使用 `Node.js + TypeScript + SQLite`
- 不在本轮把大块日志正文塞进 SQLite
- 不启动新的外部日志服务
- 不改变现有 `TerminalService` 的终端实例真相来源
- 前端继续使用 `xterm.js` 做显示和滚动，日志系统只补“历史真相”

## 2. 架构

### 2.1 系统结构

终端日志拆成三层：

1. **热缓存层**：内存 ring buffer，负责实时流和短时重连。
2. **正文层**：本地 append-only 日志文件，负责真正持久化。
3. **索引层**：SQLite 记录文件、分段、偏移、序号范围和状态。

一句人话：
最近几秒的数据放内存里，真正的正文落文件里，要找哪一段去 SQLite 查路标。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `terminal-output-buffer` | 维护最近输出热缓存和实时 cursor | 运行时输出片段 | 热缓存窗口 |
| `terminal-log-spooler` | 聚合输出、按阈值 flush 到文件 | 终端输出片段 | 已落盘 segment |
| `terminal-log-file-store` | 管理日志文件创建、追加、滚动和删除 | flush 批次、终端生命周期事件 | 文件路径、偏移、大小 |
| `terminal-log-index-repository` | 在 SQLite 中保存日志索引 | segment 元数据 | 分页查询结果 |
| `terminal-history-service` | 统一对外提供“读最近 / 读更早历史”能力 | terminalId、cursor、page 参数 | 历史片段 |
| `terminal-cleanup-service` | 在 close/delete 时完成 flush 与清理 | 终端关闭、删除事件 | 干净的文件与索引状态 |

### 2.3 关键流程

#### 2.3.1 实时输出与热缓存

1. 运行时输出进入 `TerminalService.handleRuntimeOutput`。
2. 输出先进入 `terminal-output-buffer`，继续服务现有实时推送。
3. 同一批输出同时进入 `terminal-log-spooler` 的待刷队列。
4. 前端实时流继续按现在的 `terminal.output` 事件消费，不等待刷盘完成。

#### 2.3.2 定期 flush 到日志文件

1. `terminal-log-spooler` 按时间阈值或大小阈值聚合某个 `terminalId` 的待刷内容。
2. 聚合后的正文追加写入当前活动日志文件。
3. 写入成功后创建一个 `log segment` 索引，记录本次写入的：
   - `startSeq`
   - `endSeq`
   - `startOffset`
   - `endOffset`
   - `byteLength`
   - `fileId`
4. flush 完成后清空已刷盘队列。

#### 2.3.3 前端历史回放

1. 前端终端页先显示当前 `xterm` 已有缓冲和热缓存补回内容。
2. 用户滚到顶部时，请求 `terminal history before <某个序号/segment>`。
3. `terminal-history-service` 先查 SQLite 索引，再按文件偏移读取正文。
4. 前端把返回的旧内容插到 `xterm` 当前内容前面，同时保留实时输出链路。

#### 2.3.4 关闭或删除时清理

1. 收到 close/delete 请求后，先阻止新的 flush 批次继续累积。
2. 强制 flush 当前内存待刷内容。
3. close：
   - 标记终端关闭
   - 删除该终端日志文件、日志索引、热缓存
4. delete：
   - 删除终端记录前先完成 close 同等级清理
   - 再删除终端元数据和 runtime session

设计决定：
这里按用户当前要求执行，“关闭”和“删除”都清日志，不保留历史终端归档。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6

- `TerminalService`：继续作为终端主入口，新增日志写入和历史读取协作
- `TerminalOutputBuffer`：继续保留热缓存职责，不再假装自己是长期历史
- `TerminalLogSpooler`：新增，负责聚合与 flush 调度
- `TerminalLogFileStore`：新增，负责日志文件 I/O
- `TerminalLogIndexRepository`：新增，负责 SQLite 索引表
- `TerminalHistoryService`：新增，负责分页回放与旧日志读取

### 3.2 数据结构

覆盖需求：1、2、3、4、5

#### 3.2.1 `TerminalLogFile`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 日志文件记录 ID | 全局唯一 |
| `terminalId` | string | 是 | 所属终端 | 外键 |
| `relativePath` | string | 是 | 相对日志根目录路径 | 不允许空 |
| `status` | string | 是 | `active/sealed/deleting` | 枚举 |
| `startSeq` | number | 是 | 文件内起始序号 | >= 1 |
| `endSeq` | number | 否 | 当前文件最新序号 | 可空，active 时持续更新 |
| `sizeBytes` | number | 是 | 当前文件大小 | >= 0 |
| `createdAt` | string | 是 | 创建时间 | ISO8601 |
| `updatedAt` | string | 是 | 更新时间 | ISO8601 |

#### 3.2.2 `TerminalLogSegment`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 分段 ID | 全局唯一 |
| `terminalId` | string | 是 | 所属终端 | 外键 |
| `fileId` | string | 是 | 所属日志文件 | 外键 |
| `startSeq` | number | 是 | 本段起始序号 | 单调递增 |
| `endSeq` | number | 是 | 本段结束序号 | `>= startSeq` |
| `startOffset` | number | 是 | 文件起始偏移 | >= 0 |
| `endOffset` | number | 是 | 文件结束偏移 | `> startOffset` |
| `byteLength` | number | 是 | 字节长度 | `endOffset - startOffset` |
| `createdAt` | string | 是 | 创建时间 | ISO8601 |

#### 3.2.3 `TerminalHistoryPage`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `terminalId` | string | 是 | 终端 ID | 必填 |
| `segments` | array | 是 | 本次返回的历史段 | 可空数组 |
| `hasMore` | boolean | 是 | 是否还有更早历史 | 必填 |
| `oldestSeq` | number | 否 | 当前页最早序号 | 可空 |
| `nextBeforeSeq` | number | 否 | 下次继续向前翻的边界 | 可空 |

### 3.3 存储布局

覆盖需求：1、2、3、4

#### 3.3.1 文件布局

建议使用 Host 数据目录下的终端日志根目录，例如：

```text
terminal-logs/
  <terminalId>/
    active.log
    000001.log
    000002.log
```

第一版约束：

- 默认每个终端一个目录
- 先支持单 active 文件追加
- 文件超过阈值后再滚动为 sealed 文件

#### 3.3.2 SQLite 索引表

建议新增两张表：

1. `terminal_log_files`
2. `terminal_log_segments`

推荐索引：

- `idx_terminal_log_files_terminal_id`
- `idx_terminal_log_segments_terminal_id_start_seq`
- `idx_terminal_log_segments_file_id`

设计原则：

- SQLite 不保存大块正文
- 一次 flush 只写一条 segment 记录，不给每个小 chunk 单独建行

### 3.4 接口契约

覆盖需求：4、5、6

#### 3.4.1 终端订阅时的热缓存补回

- 类型：WebSocket
- 现有事件：`terminal.backfill`
- 调整点：仍然优先返回热缓存窗口，不把长历史塞进首次订阅

#### 3.4.2 读取更早历史

- 类型：HTTP
- 路径建议：`GET /api/terminals/{terminalId}/history`
- 输入：
  - `beforeSeq`：向前翻的边界
  - `limit`：返回 segment 或字节窗口上限
- 输出：
  - `segments`
  - `hasMore`
  - `nextBeforeSeq`
- 校验：必须登录；终端存在；用户有工作区权限

#### 3.4.3 关闭和删除时的清理接口

沿用现有 close/delete 接口，不新增用户侧动作。

实现调整：

- `closeTerminal` 和 `deleteTerminal` 内部必须先做强制 flush 和日志清理
- 对用户来说，动作不变；对系统来说，清理顺序更严格

## 4. 数据与状态模型

### 4.1 数据关系

- 一个 `TerminalInstance` 可以有一个活动日志文件和多个 sealed 日志文件。
- 一个活动日志文件可以对应多个 `TerminalLogSegment`。
- `TerminalOutputBuffer` 只保存最近热窗口，不与日志文件形成竞争真相。
- `TerminalLogSegment` 按 `terminalId + startSeq/endSeq` 形成单调递增历史链。

### 4.2 状态流转

#### 4.2.1 日志文件状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `active` | 当前仍在追加写入 | 终端首次写日志 | 文件滚动或终端清理 |
| `sealed` | 已封口，只读 | active 文件滚动 | 删除时清理 |
| `deleting` | 正在删除 | close/delete 清理开始 | 删除完成 |

#### 4.2.2 flush 批次状态

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `queued` | 已入待刷队列 | 收到终端输出 | 被 flush 或丢弃 |
| `flushing` | 正在写文件 | 调度器选中批次 | 写成功或失败 |
| `persisted` | 已落文件并入索引 | 文件和索引写成功 | 结束 |
| `failed` | 文件或索引写失败 | flush 失败 | 重试或报错 |

## 5. 错误处理

### 5.1 错误类型

- `日志写入错误`：文件创建失败、追加失败、fsync 失败
- `索引错误`：SQLite 写入失败、索引缺失、索引范围不连续
- `读取错误`：日志文件不存在、偏移非法、分页参数非法
- `清理错误`：close/delete 时 flush 或删文件失败

### 5.2 错误响应格式

```json
{
  "detail": "终端日志文件不存在，无法回放历史",
  "error_code": "TERMINAL_LOG_FILE_MISSING",
  "field": "terminalId",
  "timestamp": "2026-03-28T00:00:00Z"
}
```

### 5.3 处理策略

1. **实时流优先**：写日志失败不应立刻阻断终端实时显示，但必须记录错误并暴露状态。
2. **强制 flush 优先级更高**：close/delete 时如果 flush 失败，应明确报错并停止脏清理。
3. **读历史失败要明示**：不能静默返回空数组让用户误以为“没有历史”。
4. **索引和文件必须一起维护**：只写文件不写索引，或只写索引不写文件，都是坏状态，必须可诊断。

## 6. 实现切片

### 6.1 切片 1：先把日志存储骨架立住

- 新增日志文件目录约定
- 新增 `terminal_log_files` / `terminal_log_segments`
- 新增日志索引仓储和文件存储服务

### 6.2 切片 2：接入输出写盘主链路

- `TerminalService.handleRuntimeOutput` 同时投递热缓存和 spooler
- 按阈值 flush
- close/delete 时强制 flush

### 6.3 切片 3：提供历史回放接口

- 新增历史分页读取 API
- 前端终端页滚到顶部时请求更早历史
- 保持 `xterm` 为唯一视口

### 6.4 切片 4：补异常恢复和诊断

- Host 重启后读取已落盘历史
- 清理失败或文件缺失时给出明确错误
- 为后续 Windows agent / `tmux capture-pane` 补强留扩展点

## 7. 验证策略

### 7.1 自动化验证

- 单元测试：
  - flush 分段边界
  - 文件偏移与索引一致性
  - close/delete 强制 flush
- 集成测试：
  - 终端输出后 Host 重启仍可读历史
  - Windows `embedded-pty` 下可回放长历史
  - `tmux` 下历史回放不依赖 copy-mode

### 7.2 人工验证

1. 在终端中打印长输出，向上翻看能继续加载旧内容。
2. 刷新页面后仍能看到已写盘历史。
3. 重启 Host 后重新进入终端页，旧日志仍可读取。
4. 关闭终端后，对应历史应被清理。
5. 删除终端后，不应残留索引和日志文件。
