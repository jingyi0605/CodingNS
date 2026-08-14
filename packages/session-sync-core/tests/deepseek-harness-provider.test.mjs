import { describe, expect, it } from "vitest";
import { DeepSeekHarnessAdapter, mapHarnessEntry } from "../dist/index.js";

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
  });

  it("把消息、工具调用和工具结果转换成标准消息", () => {
    const message = mapHarnessEntry("h1", "harness://v/h1", { event: { type: "tool/result", seq: 4, data: { callId: "c1", name: "read", output: "ok" } } }, 0);
    expect(message).toMatchObject({ role: "tool", kind: "tool_result", sequence: 4, toolCall: { callId: "c1", status: "completed" } });
  });
});
