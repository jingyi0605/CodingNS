# spec002.1-工作区会话扫描性能优化

## 当前定位

这个 Spec 只解决一个真问题：

- Host 端为了发现工作区会话，反复扫大量来源文件
- 其中还混进了已经 removed 的旧工作区
- 很多扫描只是为了再次证明“这个 jsonl 还是老样子”，纯属白干

结果就是 CPU 被 `workspace.discovery` 和 `workspace.discovery_scan` 长时间吃掉。

这不是“感觉可能有点慢”，而是已经有实锤：

- 3009 正式端观测里，CPU 高占用主因就是 `workspace.discovery` / `workspace.discovery_scan`
- 触发源明确包含 `session_history.request_workspace_discovery` 和 `session_history.workspace_discovery.scan`
- 观测里出现了大量 removed 的旧临时工作区也在参与 discovery
- 当前实现虽然已经把部分重活下沉到 helper，但 discovery 仍会频繁重复做无意义扫描

## 这次要解决什么

这次不重写整套会话系统，也不搞“所有 provider 一律改成 SQLite-first”这种假大空方案。

这次只做下面几件事：

1. 先把 removed 工作区挡在 discovery 入口外面
2. 给会话来源建一层真正可复用的源索引，扫过一次就记住
3. 把“归属扫描”“归档状态对齐”“活动状态刷新”拆开，不再每次全量混着跑
4. 按 provider 真实情况决定读什么：能读结构化索引/SQLite 的就优先读，不能读的别硬装能读
5. 给 discovery 加预算、优先级和持久化观测，别让后台任务无上限空转

## 计划覆盖

- `workspace.discovery` / `workspace.discovery_scan` 的触发门禁
- 工作区会话来源索引、指纹缓存和增量扫描策略
- Codex / OpenCode / Claude Code 等 provider 的归档状态对齐策略
- 工作台触发 discovery 的优先级、冷却时间和扫描预算
- 观测指标、修复任务和验收口径

## 依赖关系

- 前置依赖：`spec001.2`、`spec001.2.1`、`spec002`、`spec010`、`spec010.1`、`spec010.2`、`spec010.3`
- 后续依赖：Host 端实现、provider 适配器增量改造、性能回归验证

## 本阶段明确不做

- 不重做会话页面 UI
- 不重写所有 provider 的历史读取实现
- 不要求所有 provider 都接 SQLite
- 不把原始 transcript 全量复制进 Host 数据库
- 不在这个 Spec 里直接承诺“所有 discovery 变成 0 成本”这种鬼话

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
