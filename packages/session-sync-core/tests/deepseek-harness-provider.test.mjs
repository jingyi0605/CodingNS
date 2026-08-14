import { describe, expect, it } from "vitest";
import { DeepSeekHarnessAdapter, mapHarnessEntries, mapHarnessEntry } from "../dist/index.js";

function transport() {
  const calls = [];
  return {
    calls,
    call: async (method, payload) => {
      calls.push({ method, payload });
      if (method === "session.create") return { sessionId: "h1" };
      if (method === "session.list") return { items: [{ sessionId: "h1", cwd: "C:/work", title: "测试", messageCount: 2 }] };
      if (method === "session.history") return { events: [
        { event: { type: "user/message", seq: 1, time: Date.now(), data: { text: "你好" } } },
        { event: { type: "assistant/message", seq: 2, time: Date.now(), data: { text: "你好，我在。" } } },
        { event: { type: "tool/call", seq: 3, data: { callId: "c1", name: "read", input: { path: "a.txt" } } } },
        { event: { type: "tool/result", seq: 4, data: { callId: "c1", name: "read", output: "ok" } } }
      ] };
      if (method === "session.fork") return { sessionId: "h2" };
      return { accepted: true };
    },
    subscribe: () => ({ close() {} })
  };
}

describe("DeepSeekHarnessAdapter", () => {
  it("只发现当前 workspace，并暴露受限能力矩阵", async () => {
    const t = transport();
    const adapter = new DeepSeekHarnessAdapter({ transport: t, harnessVersion: "0.1.0-rc.5" });
    await expect(adapter.detectSessions("C:/work")).resolves.toHaveLength(1);
    const capabilities = adapter.getProviderCapabilities();
    expect(capabilities.provider).toBe("deepseek-harness");
    expect(capabilities.canResumeSession).toBe(false);
    expect(capabilities.supportsSessionDelete).toBe(false);
    expect(capabilities.supportsSessionDiff).toBe(false);
    await expect(adapter.readSessionTitle("h1")).resolves.toBe("测试");
  });

  it("把消息、工具调用和工具结果转换成标准消息", () => {
    const message = mapHarnessEntry("h1", "harness://v/h1", { event: { type: "tool/result", seq: 4, data: { callId: "c1", name: "read", output: "ok" } } }, 0);
    expect(message).toMatchObject({ role: "tool", kind: "tool_result", sequence: 4, toolCall: { callId: "c1", status: "completed" } });
  });

  it("把最终 assistant message 的思考和正文拆成稳定消息", () => {
    const messages = mapHarnessEntries("h1", "harness://v/h1", {
      event: {
        type: "assistant/message",
        seq: 9,
        data: {
          turn: 3,
          step: 2,
          message: {
            content: [
              { type: "reasoning", text: "先分析需求。" },
              { type: "text", text: "这是正式回复。" }
            ]
          }
        }
      }
    }, 0);

    expect(messages).toEqual([
      expect.objectContaining({ role: "assistant", kind: "thinking", content: "先分析需求。", sequence: 9, rawRef: "harness://v/h1/message/turn-3-step-2/part/thinking-0?part=0" }),
      expect.objectContaining({ role: "assistant", kind: "text", content: "这是正式回复。", sequence: 9, rawRef: "harness://v/h1/message/turn-3-step-2/part/text-1?part=1" })
    ]);
    expect(messages[0]?.messageId).not.toBe(messages[1]?.messageId);
  });
});
