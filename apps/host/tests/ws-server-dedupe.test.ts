import { describe, expect, it } from "vitest";

import type { NormalizedMessage } from "@codingns/session-sync-core";

import { __internal__ } from "../src/ws/ws-server.js";

function createMessage(
  messageId: string,
  overrides: Partial<NormalizedMessage> = {}
): NormalizedMessage {
  return {
    messageId,
    provider: "codex",
    providerSessionId: "provider-session-1",
    role: "assistant",
    kind: "text",
    content: "default message",
    toolCall: null,
    attachments: [],
    timestamp: "2026-04-01T10:00:00.000Z",
    sequence: 1,
    rawRef: `raw://${messageId}`,
    ...overrides
  };
}

describe("ws-server 会话去重", () => {
  it("只缓存截断预览，不保留整段超大文本", () => {
    const hugeContent = "A".repeat(__internal__.MAX_STORED_MESSAGE_PREVIEW_CHARS + 512);
    const entry = __internal__.buildSeenMessageEntry(
      createMessage("message-1", {
        content: hugeContent,
        toolCall: {
          callId: "tool-1",
          name: "read_file",
          input: hugeContent,
          output: hugeContent,
          error: null,
          status: "completed"
        }
      }),
      "runtime"
    );

    expect(entry.contentLength).toBe(hugeContent.length);
    expect(entry.contentPreview).toHaveLength(__internal__.MAX_STORED_MESSAGE_PREVIEW_CHARS);
    expect(entry.contentPreview).toBe(hugeContent.slice(0, __internal__.MAX_STORED_MESSAGE_PREVIEW_CHARS));
    expect(entry.signature).not.toContain(hugeContent.slice(0, 64));
  });

  it("会拦住 runtime 之后回来的旧版 history 消息", () => {
    const seenMessages = new Map<string, ReturnType<typeof __internal__.buildSeenMessageEntry>>();
    const runtimeMessage = createMessage("message-1", {
      content: "第一段\n第二段\n第三段",
      timestamp: "2026-04-01T10:00:10.000Z"
    });
    const olderHistoryMessage = createMessage("message-1", {
      content: "第一段\n第二段",
      timestamp: "2026-04-01T10:00:09.000Z"
    });

    expect(__internal__.shouldForwardMessage(runtimeMessage, "runtime", seenMessages)).toBe(true);
    expect(__internal__.shouldForwardMessage(olderHistoryMessage, "history", seenMessages)).toBe(false);
  });

  it("会裁剪订阅级 seenMessages，避免无限增长", () => {
    const seenMessages = new Map<string, ReturnType<typeof __internal__.buildSeenMessageEntry>>();

    for (let index = 0; index < __internal__.MAX_TRACKED_MESSAGES_PER_SUBSCRIPTION + 1; index += 1) {
      const message = createMessage(`message-${index}`, {
        content: `content-${index}`,
        rawRef: `raw://${index}`,
        sequence: index
      });

      expect(__internal__.shouldForwardMessage(message, "history", seenMessages)).toBe(true);
    }

    expect(seenMessages.size).toBe(__internal__.MAX_TRACKED_MESSAGES_PER_SUBSCRIPTION);
    expect(seenMessages.has("message-0")).toBe(false);
    expect(seenMessages.has(`message-${__internal__.MAX_TRACKED_MESSAGES_PER_SUBSCRIPTION}`)).toBe(true);
  });
});
