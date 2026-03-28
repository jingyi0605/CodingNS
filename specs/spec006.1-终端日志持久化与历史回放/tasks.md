# 任务清单 - spec006.1-终端日志持久化与历史回放（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单只做一件事：把“终端日志正式持久化”拆成真能落地的步骤。

它优先回答这些问题：

1. 先建什么，不建就没法开始
2. 做完以后，用户到底能看到什么变化
3. 哪一步已经落锤，哪一步还只是嘴上说过
4. 怎么验证不是又写出一套只会在本机凑合跑的破方案

---

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：实现已有结果，待复核
- `DONE`：已经完成，并且已经回写结果
- `CANCELLED`：取消，不做了，但必须写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻更新本文件
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因和后续处理

---

## 阶段 0：先把事情说清楚，不准边写边猜

- [x] 0.1 建立 spec006.1 初稿并锁定日志持久化路线
  - 状态：DONE
  - 这一步到底做什么：把终端日志的保留语义、清理语义、存储结构和前端回放方向写成正式 Spec。
  - 做完你能看到什么：`spec006.1` 已建立 `README.md`、`requirements.md`、`design.md`、`tasks.md`，方向不再停留在口头讨论。
  - 先依赖什么：`spec006` 已完成终端核心能力主链路。
  - 开始前先看：
    - `spec006`
    - 当前 `TerminalService`、`TerminalOutputBuffer`
    - 本轮关于 `tmux` 滚动、Windows 历史、日志保留语义的讨论
  - 主要改哪里：
    - `specs/spec006.1-终端日志持久化与历史回放/*`
  - 这一步先不做什么：不开始写 Host 和前端代码。
  - 怎么算完成：
    1. 子 Spec 主文档齐全
    2. 已明确选择“内存热缓存 + 本地文件日志 + SQLite 索引”路线
    3. 已明确“关闭/删除时清理日志”的语义
  - 怎么验证：
    - 文档自检
    - 与 `spec006` 范围对照，不冲突不重复
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

---

## 阶段 1：先把日志存储骨架立住

- [x] 1.1 新增终端日志索引表和仓储
  - 状态：DONE
  - 这一步到底做什么：新增 `terminal_log_files`、`terminal_log_segments` 两张表及仓储，记录文件路径、序号范围和偏移。
  - 做完你能看到什么：系统知道“日志正文在哪个文件、哪一段”，不再只靠内存 buffer。
  - 先依赖什么：0.1
  - 开始前先看：
    - `design.md` §3.2、§3.3
    - 现有 `terminal_instances`、`terminal_runtime_sessions` 建表和仓储写法
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/client.ts`
    - `apps/host/src/storage/repositories/*terminal-log*`
    - `apps/host/src/types/domain.ts`
  - 这一步先不做什么：先不接前端历史回放。
  - 怎么算完成：
    1. 新表可建可迁移
    2. 可按 `terminalId` 查询文件和分段
    3. 删除终端时能级联或显式清理索引
  - 怎么验证：
    - SQLite 迁移测试
    - 仓储单元测试
  - 验证结果：已在 `schema.sql` 和 SQLite 启动迁移中补齐 `terminal_log_files`、`terminal_log_segments` 两张表与索引；已新增 `TerminalLogFileRepository`、`TerminalLogSegmentRepository`，支持按 `terminalId` 查询活动日志文件、最近分段和向前分页读取；并补充集成测试覆盖旧库升级和基础仓储读写。
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §3.2、§3.3

- [x] 1.2 新增本地日志文件存储和 spooler
  - 状态：DONE
  - 这一步到底做什么：实现日志目录管理、活动文件追加写入、按阈值 flush 和基础滚动。
  - 做完你能看到什么：终端输出不再只待在内存里，已经能批量落盘。
  - 先依赖什么：1.1
  - 开始前先看：
    - `design.md` §2.2、§2.3.2
  - 主要改哪里：
    - `apps/host/src/modules/terminal/runtime/*terminal-log*`
    - `apps/host/src/modules/terminal/terminal-service.ts`
  - 这一步先不做什么：先不做历史分页接口。
  - 怎么算完成：
    1. 输出先进入热缓存，再进入待刷队列
    2. 满足阈值后可批量写入文件
    3. flush 成功后落索引
  - 怎么验证：
    - 单元测试：flush 条件、偏移计算、失败重试
    - 集成测试：实际产生日志文件
  - 验证结果：已新增 `TerminalLogFileStore` 和 `TerminalLogSpooler`，支持把 `TerminalService` 输出批量刷入 `terminal-logs/<terminalId>/active.log`，并同步写入 `terminal_log_files`、`terminal_log_segments`；`create-server` 已为正式 Host 注入日志根目录与索引仓储，且已补充 `TerminalLogSpooler` 集成测试验证文件落盘与索引生成。
  - 对应需求：`requirements.md` 需求 1、需求 3、需求 4
  - 对应设计：`design.md` §2.1、§2.2、§2.3.2

- [x] 1.3 阶段检查：日志主真相从内存切到“文件 + 索引”
  - 状态：DONE
  - 这一步到底做什么：确认系统已经不再把热缓存误当成长期日志。
  - 做完你能看到什么：Host 重启后仍然有地方可读，不再只有易失内存。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3
    - `design.md` §2.1、§4.1
  - 主要改哪里：本阶段相关代码和测试
  - 这一步先不做什么：不扩展 UI。
  - 怎么算完成：
    1. 热缓存职责清晰收口
    2. 文件和索引能形成完整历史链
  - 怎么验证：
    - Host 重启恢复测试
    - 代码走查
  - 验证结果：当前日志正文已经落在 `terminal-logs/<terminalId>/active.log`，SQLite 只保留文件和分段索引；`TerminalService.readTerminalHistory()` 直接走文件 + 索引读取，不依赖热缓存。已补 Host 重启后读取历史的集成测试，确认日志主真相已经切到“文件 + 索引”。
  - 对应需求：`requirements.md` 需求 1、需求 3
  - 对应设计：`design.md` §2.1、§4.1

---

## 阶段 2：把关闭、删除和异常收尾做扎实

- [x] 2.1 在 close/delete 链路中接入强制 flush 和日志清理
  - 状态：DONE
  - 这一步到底做什么：让终端关闭和删除都先 flush 再清理文件、索引和热缓存。
  - 做完你能看到什么：最后几行不会悄悄丢，日志生命周期和终端实例一致。
  - 先依赖什么：1.3
  - 开始前先看：
    - `design.md` §2.3.4、§5.3
    - 当前 `closeTerminal` / `deleteTerminal` 链路
  - 主要改哪里：
    - `apps/host/src/modules/terminal/terminal-service.ts`
    - `apps/host/src/modules/terminal/runtime/*terminal-log*`
  - 这一步先不做什么：先不补前端分页。
  - 怎么算完成：
    1. close/delete 都会强制 flush
    2. 清理顺序固定且可追踪
    3. 清理失败时返回明确错误
  - 怎么验证：
    - 集成测试：close/delete 后文件和索引状态
    - 边界测试：flush 失败路径
  - 验证结果：`TerminalService` 已在 `closeTerminal`、`deleteTerminal` 和 runtime exit 收尾中接入日志强制 flush；终端真正关闭或删除后会同步清理 `terminal_log_files`、`terminal_log_segments`、`terminal-logs/<terminalId>/` 目录和热缓存。已补充 `terminal-service-delete.test.ts` 覆盖“关闭清理日志”和“删除且没有 exit 回调时也清理日志”两条路径。
  - 对应需求：`requirements.md` 需求 2、需求 4
  - 对应设计：`design.md` §2.3.4、§5.3

- [x] 2.2 补 Host 重启后的日志恢复和坏状态诊断
  - 状态：DONE
  - 这一步到底做什么：让 Host 启动后能重新读取已落盘日志，并在文件缺失或索引失配时给出可排查错误。
  - 做完你能看到什么：历史回放不再怕 Host 重启，坏数据也不是静默吞掉。
  - 先依赖什么：2.1
  - 开始前先看：
    - `design.md` §5、§6.4
  - 主要改哪里：
    - `apps/host/src/modules/terminal/*`
    - `apps/host/src/storage/repositories/*terminal-log*`
  - 这一步先不做什么：先不做全文检索。
  - 怎么算完成：
    1. Host 重启后仍可读取落盘历史
    2. 文件缺失、偏移非法等错误可见
  - 怎么验证：
    - 集成测试：重启恢复
    - 人工验证：制造坏文件后错误提示
  - 验证结果：已在 `terminal-history-routes.test.ts` 增加三条集成测试，分别验证 Host 重启后仍可读回日志、日志文件缺失时返回 `TERMINAL_LOG_FILE_MISSING`、索引失配时返回 `TERMINAL_LOG_INDEX_INVALID`。坏状态现在会明确暴露，不再静默吞掉。
  - 对应需求：`requirements.md` 需求 1、需求 3
  - 对应设计：`design.md` §5、§6.4

---

## 阶段 3：把历史回放真正交到用户手里

- [x] 3.1 新增历史分页读取接口
  - 状态：DONE
  - 这一步到底做什么：提供“向前读更早日志”的 API，而不是把全部历史挤进首次 backfill。
  - 做完你能看到什么：前端有了正式的旧日志入口。
  - 先依赖什么：2.2
  - 开始前先看：
    - `design.md` §3.4.2
  - 主要改哪里：
    - `apps/host/src/routes/terminals.ts`
    - `apps/host/src/modules/terminal/terminal-controller.ts`
    - `apps/host/src/modules/terminal/*history*`
  - 这一步先不做什么：不改终端创建和输入输出协议。
  - 怎么算完成：
    1. 能按 `beforeSeq` 分页读取历史
    2. 返回 `hasMore` 和下一页边界
  - 怎么验证：
    - HTTP 集成测试
    - 边界测试：无历史、已到头、非法参数
  - 验证结果：已新增 `GET /api/terminals/:terminalId/history`，支持 `beforeSeq` 和 `limit` 参数；Host 会按 `terminal_log_segments`、`terminal_log_files` 索引定位正文，再从 `terminal-logs/<terminalId>/active.log` 读取并返回“可直接渲染的历史视图块”，而不是裸历史分段。返回体已包含 `content`、`lineCount`、`anchorLine`、`hasMore`、`nextBeforeSeq`，前端不再自己拼 ANSI 分段。
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §3.4.2

- [x] 3.2 前端终端页接入“滚到顶部继续加载”
  - 状态：DONE
  - 这一步到底做什么：在继续使用 `xterm` 的前提下，让用户滚到顶部时能加载更早日志。
  - 做完你能看到什么：PC 端和移动端都能继续往上看，而不是只看最近窗口。
  - 先依赖什么：3.1
  - 开始前先看：
    - `design.md` §2.3.3
    - 当前 `TerminalPage` 的 `xterm` 视口实现
  - 主要改哪里：
    - `apps/user-app/src/features/terminal/pages/TerminalPage.tsx`
    - `apps/user-app/src/features/terminal/api/terminal-api.ts`
  - 这一步先不做什么：不把 `tmux copy-mode` 做成默认入口。
  - 怎么算完成：
    1. 顶部触发历史加载
    2. 旧日志插入顺序正确
    3. 到头后有明确提示
  - 怎么验证：
    - 前端单元/交互测试
    - 人工验证：长输出滚动回放
  - 验证结果：`TerminalPage` 已在 `xterm` 视口滚到顶部时调用 `readTerminalHistory`，前端只消费 Host 返回的 `content + anchorLine` 历史视图块，不再自己拼接原始历史分段；加载更早历史时会按锚点恢复滚动位置，并把 `historyBeforeSeq`、`historyHasOlder` 一并持久化，刷新后仍能继续向前翻。后续为移动端补惯性滑动时，已确认不能用一层额外的 `requestAnimationFrame` 动量去接管整条滚动链路；现已改成“仅移动端、仅触摸结束后、仅有 scrollback 时”的受控惯性补滚，并补 `TerminalPage.test.tsx` 覆盖顶部加载、滚轮兜底、触摸推动原生视口、移动端惯性和刷新恢复。
  - 对应需求：`requirements.md` 需求 5、需求 6
  - 对应设计：`design.md` §2.3.3、§3.4.2

- [x] 3.3 最终检查：日志持久化主链路验收
  - 状态：DONE
  - 这一步到底做什么：对照需求确认“实时输出、落盘、重启恢复、历史回放、关闭清理”全部成立。
  - 做完你能看到什么：`spec006.1` 达到可实施、可回归、可交付状态。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：spec 文档和相关测试记录
  - 这一步先不做什么：不新增范围，不顺手塞日志搜索。
  - 怎么算完成：
    1. 需求与实现可追踪
    2. 关键场景都有验证证据
    3. `tmux` 和 Windows 行为语义一致
  - 怎么验证：
    - 自动化测试清单
    - 人工回归清单
  - 验证结果：已完成 Host 侧关键集成测试清单：`sqlite-bootstrap.test.ts`、`terminal-log-repositories.test.ts`、`terminal-log-spooler.test.ts`、`terminal-service-delete.test.ts`、`terminal-history-routes.test.ts`；前端已完成 `TerminalPage.test.tsx`、`terminal-page-persistence.test.ts`，验证顶部滚动继续加载历史、滚轮无 scrollback 兜底，以及刷新后历史分页状态恢复；Host 与 user-app 的 `tsc --noEmit` 也已通过。当前主链已覆盖“实时输出、文件落盘、关闭清理、重启恢复、前端历史回放”。
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
