import { describe, expect, it } from "vitest";

import {
  createPendingMessage,
  markPendingAsFailed,
  mergeAuthoritativeMessages,
  reconcileMessage
} from "./session-runtime-machine";

describe("session runtime machine", () => {
  it("去重并保持权威消息顺序", () => {
    const merged = mergeAuthoritativeMessages(
      [],
      "session-1",
      [
        {
          messageId: "m-2",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "第二条",
          timestamp: "2026-03-23T10:00:02.000Z",
          sequence: 2,
          rawRef: "codex://demo#2"
        },
        {
          messageId: "m-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "user",
          content: "第一条",
          timestamp: "2026-03-23T10:00:01.000Z",
          sequence: 1,
          rawRef: "codex://demo#1"
        },
        {
          messageId: "m-2",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "第二条",
          timestamp: "2026-03-23T10:00:02.000Z",
          sequence: 2,
          rawRef: "codex://demo#2"
        }
      ]
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.id)).toEqual(["m-1", "m-2"]);
  });

  it("发送成功后会用正式消息替换本地暂态消息", () => {
    const pending = createPendingMessage("session-1", "先发出去", "client-1");
    const reconciled = reconcileMessage(
      [pending],
      "session-1",
      {
        messageId: "server-1",
        provider: "claude-code",
        providerSessionId: "raw-2",
        role: "user",
        content: "先发出去",
        timestamp: "2026-03-23T10:00:05.000Z",
        sequence: 3,
        rawRef: "claude-code://demo#3&part=0"
      },
      "client-1"
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe("server-1");
    expect(reconciled[0].deliveryState).toBe("sent");
  });

  it("发送失败后只标记失败，不制造第二份消息", () => {
    const pending = createPendingMessage("session-1", "失败消息", "client-2");
    const failed = markPendingAsFailed([pending], "client-2");

    expect(failed).toHaveLength(1);
    expect(failed[0].deliveryState).toBe("failed");
    expect(failed[0].clientRequestId).toBe("client-2");
  });
});
