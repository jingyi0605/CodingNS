# 需求文档 - spec002.3 设置页会话清理工具与跨Provider级联删除

状态：Draft

## 简介

这个 Spec 解决的是一个已经影响性能和维护成本的真问题。

截至 **2026-06-17**，项目已经能同时接住多家 CLI provider 的会话，但系统还缺一条正式的“会话清理主链路”：

1. 会话越来越多，工作区 discovery 和状态刷新会持续背越来越重的扫描压力
2. 会话不只存在于 CodingNS 自己的索引里，还分散在 provider 的原始文件、SQLite 或 server 记录里
3. 用户想删除旧会话时，没有统一入口，也没有可靠的批量备份和选择性恢复能力
4. 只删一层会留下脏数据，后续扫描时又会重新长回来

一句人话：
现在不是“会话太多看着乱”，而是“没有正式生命周期治理，所以性能和数据一致性一起烂”。

## 术语表

- **System**：CodingNS。
- **Cleanup Candidate（清理候选）**：扫描出来、可以被备份、删除或恢复的单条会话记录。
- **Provider Source（Provider 来源）**：provider 侧承载会话的真实来源，例如 Codex transcript、Claude Code jsonl、OpenCode server/sqlite 记录。
- **Cascade Delete（级联删除）**：一次删除动作同时清理 CodingNS 本地索引、磁盘附件、provider 原始文件和 provider 结构化记录。
- **Backup Archive（备份包）**：把会话正文、元数据、来源定位和清单打进一个压缩文件后的产物。
- **Restore Manifest（恢复清单）**：备份包内记录每条会话 provider、时间、标题、原始来源和文件列表的结构化清单。

## 范围说明

### In Scope

- 设置页中的会话清理工具入口和主流程
- 扫描 Codex、Claude Code、OpenCode 会话
- 按 provider、时间范围、多选结果筛选候选会话
- 批量备份为压缩文件
- 从备份文件中浏览会话并选择性恢复
- 删除时同步清理 CodingNS 本地数据、磁盘文件、provider 数据库或原始记录
- 后台任务、失败汇总、进度反馈和操作观测

### Out of Scope

- 自动定时清理
- 其他 provider 的一并接入
- 会话内容全文检索
- 把备份包变成长期云同步产品
- 恢复后自动继续原 provider 运行中的实时会话

## 需求

### 需求 1：设置页必须提供正式的会话清理工具入口

**用户故事：** 作为用户，我希望在设置页里直接打开一个正式的会话清理工具，而不是去不同 provider 目录里手工删文件。

#### 验收标准

1. WHEN 用户进入设置页 THEN System SHALL 提供“会话清理工具”正式入口，而不是隐藏调试入口。
2. WHEN 用户打开会话清理工具 THEN System SHALL 展示扫描、筛选、备份、恢复、删除这几条主操作入口。
3. WHEN 当前平台或权限不支持某个子能力 THEN System SHALL 明确展示不可用原因，而不是静默消失。

### 需求 2：系统必须能扫描 Codex、Claude Code、OpenCode 会话，并支持多选和时间范围筛选

**用户故事：** 作为用户，我希望一次看见三家 provider 的会话候选，并按时间范围和多选结果决定后续操作。

#### 验收标准

1. WHEN 用户触发扫描 THEN System SHALL 返回 Codex、Claude Code、OpenCode 的候选会话，并标明 provider、标题、工作区、时间范围、大小估算和来源状态。
2. WHEN 用户设置开始时间、结束时间或 provider 过滤 THEN System SHALL 只保留命中的候选结果。
3. WHEN 用户多选候选会话 THEN System SHALL 在后续备份、删除、恢复步骤里复用同一批选择结果。
4. WHEN 某条会话来源缺失、索引脏或 provider 状态不完整 THEN System SHALL 仍展示候选条目，并明确标记“来源异常”而不是直接吞掉。

### 需求 3：系统必须支持把选中的会话备份成压缩文件

**用户故事：** 作为用户，我希望先把选中的会话打包备份，再决定是否删除，这样清理不会变成不可逆操作。

#### 验收标准

1. WHEN 用户对选中会话执行备份 THEN System SHALL 生成一个压缩备份文件，并包含可读的恢复清单。
2. WHEN 备份完成 THEN System SHALL 返回备份文件路径、包含的会话数量、provider 分布和失败条目摘要。
3. WHEN 某条会话正文缺失但元数据仍可读 THEN System SHALL 在清单里明确记录该条目的不完整状态，而不是伪装成完整备份。

### 需求 4：系统必须支持从备份文件中选择会话进行恢复

**用户故事：** 作为用户，我希望打开一个备份包，先看里面有哪些会话，再只恢复我想要的那几条。

#### 验收标准

1. WHEN 用户选择一个备份文件 THEN System SHALL 读取其中的恢复清单，并展示可恢复会话列表。
2. WHEN 用户只选择其中部分会话恢复 THEN System SHALL 只恢复被选中的条目，而不是整包全部恢复。
3. WHEN 恢复目标已存在同 provider 同 providerSessionId 或同 rawStoreRef 冲突 THEN System SHALL 明确给出冲突处理结果，不得静默覆盖。
4. WHEN 恢复完成 THEN System SHALL 让这些会话重新进入 CodingNS 可见链路，并触发必要的索引修复。

### 需求 5：删除会话时必须做跨层级联删除，而不是只删一层

**用户故事：** 作为维护者，我希望删掉一批会话后，不会留下 provider 残留、附件残留或 CodingNS 脏索引，让这些会话又被扫描回来。

#### 验收标准

1. WHEN 用户确认删除选中会话 THEN System SHALL 同步清理至少这三层：CodingNS 本地记录、磁盘文件、provider 侧原始记录或数据库记录。
2. WHEN 会话带有附件、子代理文件、派生记录或工作区临时引用 THEN System SHALL 一并清理归属于该会话的相关本地残留。
3. WHEN provider 级删除失败 THEN System SHALL 不把整批结果伪装成成功，必须返回每条会话的分层删除结果。
4. WHEN 删除完成 THEN System SHALL 让被删会话不再出现在正常扫描、工作台列表和设置页候选列表里。

### 需求 6：整个清理流程必须走正式后台任务，并且读写边界清楚

**用户故事：** 作为后续维护者，我希望扫描、备份、恢复、删除这些重活都走正式后台任务，不要再在设置页请求里现算。

#### 验收标准

1. WHEN 用户发起扫描、备份、恢复或删除 THEN System SHALL 通过 `TaskManager` 执行正式后台任务，并返回任务状态。
2. WHEN 前端轮询或订阅这些任务 THEN System SHALL 看到排队、运行、成功、部分成功、失败和取消这类明确状态。
3. WHEN 设置页只是读取最近扫描结果或任务结果 THEN System SHALL 只读缓存和结果，不得在读接口里偷偷再跑重活。

### 需求 7：系统必须对部分成功、冲突和不可恢复场景给出结构化结果

**用户故事：** 作为用户，我希望知道哪条真的删掉了、哪条只备份了没删、哪条恢复冲突了，而不是只看一个模糊 toast。

#### 验收标准

1. WHEN 一批会话里只有部分条目成功 THEN System SHALL 返回逐条结果，并按 `success / partial / failed / skipped / conflict` 归类。
2. WHEN 删除前需要先备份但用户未备份 THEN System SHALL 支持继续删除，但必须给出明确确认提示。
3. WHEN 备份包损坏、清单缺失或文件校验失败 THEN System SHALL 拒绝恢复，并给出结构化错误，不得写入半套脏数据。

### 需求 8：新能力不能破坏现有单条会话删除主链路

**用户故事：** 作为现有系统维护者，我希望新增批量清理工具后，原来工作台里的单条删除、归档、恢复和扫描链路不回归。

#### 验收标准

1. WHEN 用户继续走原有单条会话删除接口 THEN System SHALL 保持现有行为和权限边界不变。
2. WHEN 新增批量清理能力接入 THEN System SHALL 复用现有会话删除核心能力，而不是复制一套平行删除实现。
3. WHEN 批量清理任务失败 THEN System SHALL 将影响限制在该任务内，不影响其他会话读写链路。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 用户查看最近一次扫描结果 THEN System SHALL 优先返回最近结果，不要求每次打开弹窗都重新全量扫描。
2. WHEN 扫描、备份、删除大批量会话 THEN System SHALL 通过后台任务和分批处理避免长时间阻塞 Host 主线程。

### 非功能需求 2：可靠性

1. WHEN 删除、备份或恢复过程中出现单条失败 THEN System SHALL 保留已完成条目的真实结果，并继续汇总剩余条目结果。
2. WHEN Host 重启 THEN System SHALL 保留最近扫描结果摘要和后台任务状态，不要求用户完全从头猜当前进度。

### 非功能需求 3：可维护性

1. WHEN 后续新增其他 provider 清理能力 THEN System SHALL 只需要扩展 provider 适配策略，而不是重写整套设置页和任务框架。
2. WHEN 线上排查异常 THEN System SHALL 能快速看出是哪一层失败：扫描、备份、CodingNS 本地删除、磁盘删除还是 provider 删除。

## 成功定义

- 用户可以在设置页完成“扫描 -> 多选 -> 备份 -> 删除 -> 恢复”的完整主链路。
- 删除后的会话不会因为 provider 残留或本地脏索引再次回到正常列表。
- 备份包可以被重新打开，并支持选择性恢复。
- 新能力接入后，原有单条删除链路和正常会话读链路不回归。
