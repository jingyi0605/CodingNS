# 20260403-KimiFixture脱敏规则

## 这份文档解决什么问题

这份文档用来约束 Kimi fixture 样本怎么脱敏，避免我们把真实工作区路径、真实会话内容或本机环境信息直接带进仓库。

## 当前样本范围

当前阶段已经沉淀的样本位于：

- `packages/session-sync-core/tests/fixtures/kimi/session-basic/state.json`
- `packages/session-sync-core/tests/fixtures/kimi/session-basic/context.jsonl`
- `packages/session-sync-core/tests/fixtures/kimi/session-basic/wire.jsonl`
- `packages/session-sync-core/tests/fixtures/kimi/runtime-wire-events.jsonl`

这些样本覆盖了：

- 本地会话发现
- 历史读取
- thinking/tool_call/tool_result 归一化
- wire mode 运行时事件回放

## 脱敏规则

1. 工作区路径统一替换为 `__WORKSPACE_PATH__`，测试执行时再落到临时目录。
2. session id 使用固定演示值，不直接复用真实本机会话 id。
3. 消息文本只保留结构语义，不保留真实业务内容、密钥、用户名、远端地址。
4. tool 输入输出只保留最小必要字段，例如 `read_file`、`README.md`、演示输出文本。
5. state/context/wire 三类样本都必须保持字段形状稳定，不能为了脱敏破坏协议结构。

## 当前结论

- 这套脱敏方案足够支撑 Kimi provider/runtime 的核心回归。
- 后续如果加入 permission/request 类样本，继续沿用“保形状、去环境、去敏感内容”的原则。
