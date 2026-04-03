# Kimi Fixture 样本说明

这组样本用于 `spec010.3` 阶段 4 的回放测试，目标是把 Kimi 接入从“临时拼数据”升级到“固定脱敏样本”。

## 文件结构

- `session-basic/state.json`：会话元信息样本
- `session-basic/context.jsonl`：主历史样本
- `session-basic/wire.jsonl`：运行事件补充样本
- `runtime-wire-events.jsonl`：wire mode 运行时事件流样本

## 脱敏规则

1. 工作区路径统一使用占位符 `__WORKSPACE_PATH__`，测试回放时再替换。
2. 只保留消息结构和字段，不保留真实项目路径、用户名、密钥。
3. session id 使用固定演示值，不映射任何真实生产会话。
