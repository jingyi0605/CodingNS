# 需求文档 - spec006.1-终端日志持久化与历史回放

状态：Draft

## 简介

`spec006` 已经把终端主链路打通了，但现在的输出恢复本质上还是“内存滚动缓存 + 前端快照”。

这东西拿来挡一挡刷新和短时断线还行，拿来当正式日志就是不够用。真正的问题有三个：

- Host 一重启，终端历史没有正式持久化真相
- Windows 不用 `tmux` 时，没有稳定的长历史查看能力
- 前端滚动和后端缓存窗口混在一起，用户以为自己能翻历史，实际上翻到头就没了

这个子 Spec 只做终端日志持久化与历史回放，不改终端核心运行时的基本边界。

## 术语表

- **System**：`码不能停` 的 Host + 客户端终端日志能力整体
- **Terminal Log（终端日志）**：终端输出的正式持久化记录，不等于前端画面快照
- **Hot Buffer（热缓存）**：Host 内存中的最近输出缓存，用于实时推送和短时重连
- **Log File（日志文件）**：Host 本地按终端写入的追加型日志正文文件
- **Log Segment（日志分段）**：一次 flush 形成的一段连续日志范围
- **Log Index（日志索引）**：SQLite 中记录日志文件、偏移、序号范围的元数据
- **History Replay（历史回放）**：用户在终端页向上查看更早输出时，System 按顺序返回旧日志内容

## 范围说明

### In Scope

- 终端日志默认保留，直到终端被关闭或删除
- 输出先进入内存热缓存，再定期刷入本地日志文件
- SQLite 只保存日志索引和元数据，不保存大块正文
- Host 重启后仍可读取已落盘的终端历史
- 前端支持继续使用 `xterm` 滚动，并在需要时拉取更早日志
- `tmux` 和 Windows `embedded-pty` 统一走日志持久化链路

### Out of Scope

- Windows 持久会话常驻 agent 完整设计
- `tmux copy-mode` / shell 内置滚动作为默认 UI
- 日志全文检索、关键词索引和跨终端聚合搜索
- 云端同步和多设备共享日志
- 历史终端会话归档中心

## 需求

### 需求 1：终端日志必须默认持久化保留

**用户故事：** 作为开发者，我希望终端输出不会因为页面刷新、短时断线或 Host 重启就丢失，这样我才能继续排查问题。

#### 验收标准

1. WHEN 终端处于 `creating` 或 `running` 状态且持续产生输出 THEN System SHALL 将输出纳入终端日志持久化链路。
2. WHEN 用户刷新终端页、切换设备视图或 WebSocket 短时断开 THEN System SHALL 保留已有终端日志，不因连接中断清理日志。
3. WHEN Host 重启后重新加载终端列表 THEN System SHALL 能读取已落盘的历史日志，即使内存热缓存已经丢失。

### 需求 2：终端日志只在关闭或删除时清理

**用户故事：** 作为用户，我希望终端日志的生命周期和终端实例一致，不要因为普通断开连接就把日志删了。

#### 验收标准

1. WHEN 终端仅发生断线、重连、页面关闭或 Host 重启 THEN System SHALL 不删除对应终端日志文件和索引。
2. WHEN 用户主动关闭终端 THEN System SHALL 先完成最后一次 flush，再清理该终端日志文件和索引。
3. WHEN 用户删除终端记录 THEN System SHALL 清理该终端所有日志文件、索引和热缓存，不留下孤儿数据。

### 需求 3：日志正文必须落本地文件，SQLite 只保留索引

**用户故事：** 作为系统维护者，我希望海量终端输出放在更适合顺序追加的地方，而不是把 SQLite 当文件系统乱用。

#### 验收标准

1. WHEN 终端输出需要持久化 THEN System SHALL 先写入本地日志文件正文，而不是把大块正文直接写入 SQLite。
2. WHEN 需要查询日志位置 THEN System SHALL 通过 SQLite 索引定位文件、分段、偏移和序号范围。
3. WHEN 日志文件损坏、缺失或索引失配 THEN System SHALL 返回明确错误，并允许诊断和修复，而不是静默回空。

### 需求 4：输出写入必须采用内存热缓存加批量 flush

**用户故事：** 作为系统维护者，我希望终端高频输出时既不卡实时流，也不会把磁盘打爆。

#### 验收标准

1. WHEN 终端输出到达 Host THEN System SHALL 先进入内存热缓存，再按时间阈值或大小阈值批量刷盘。
2. WHEN 热缓存尚未达到 flush 条件 THEN System SHALL 仍然能够向前端实时推送输出。
3. WHEN 终端关闭、删除、Host 正常退出或运行时明确要求收尾 THEN System SHALL 强制 flush 剩余缓存后再结束流程。

### 需求 5：前端必须能查看更早日志，而不是只看缓存窗口

**用户故事：** 作为 PC 端和移动端用户，我希望在终端页继续往上翻，看到更早的输出，而不是突然断头。

#### 验收标准

1. WHEN 用户在终端页滚动到当前已加载内容顶部 THEN System SHALL 支持按页加载更早日志。
2. WHEN 历史日志仍然存在 THEN System SHALL 将更早日志按正确顺序插入当前终端视图，不破坏实时输出。
3. WHEN 已经没有更早日志 THEN System SHALL 明确告知已经到头，而不是假装还能继续加载。

### 需求 6：不同运行时的日志语义必须一致

**用户故事：** 作为产品和开发维护者，我希望 `tmux` 和 Windows `embedded-pty` 在“日志能否看见、何时清理”上是同一套规则，而不是每个 runtime 一套歪逻辑。

#### 验收标准

1. WHEN 终端运行时为 `tmux` THEN System SHALL 仍以 Host 持久化日志为主，不依赖 `tmux copy-mode` 作为默认查看历史方式。
2. WHEN 终端运行时为 Windows `embedded-pty` 或 ConPTY THEN System SHALL 通过同一套日志文件 + 索引机制提供历史回放。
3. WHEN 某运行时额外提供历史抓取能力（例如 `tmux capture-pane`） THEN System SHALL 只把它作为补历史或诊断手段，不改变默认日志真相来源。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 终端持续高频输出 THEN System SHALL 优先保证实时流畅性，不因每条输出都立刻写盘导致明显卡顿。
2. WHEN 用户请求加载更早日志 THEN System SHALL 以分页方式返回，避免一次性把整段历史全塞进前端。

### 非功能需求 2：可靠性

1. WHEN Host 发生异常退出 THEN System SHALL 至少保证已完成 flush 的日志可以恢复读取。
2. WHEN 正常关闭终端或删除终端 THEN System SHALL 在清理前完成最后一次强制 flush，避免最后几行无声丢失。

### 非功能需求 3：可维护性

1. WHEN 扩展新的终端运行时 THEN System SHALL 复用同一套日志持久化服务，而不是每个 runtime 自己重写一份日志系统。
2. WHEN 排查日志问题 THEN System SHALL 提供 `workspaceId + terminalId + fileId/segmentId` 级别的诊断信息。

## 成功定义

- 用户在 PC 端和移动端都能稳定查看终端长历史
- Host 重启后仍可回看终端已落盘输出
- Windows 不依赖 `tmux` 也能看终端历史
- 终端日志只在关闭或删除时清理，不因普通断线误删
- 终端正文进入本地文件，SQLite 只承担索引职责
