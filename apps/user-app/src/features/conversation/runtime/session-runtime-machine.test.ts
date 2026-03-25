import { describe, expect, it } from "vitest";

import {
  createPendingMessage,
  markPendingAsFailed,
  mergeAuthoritativeMessages,
  reconcileMessage,
  toViewMessage,
  type SessionMessageViewModel
} from "./session-runtime-machine";

const SAMPLE_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=";

function createHistoryMessage(overrides: {
  messageId: string;
  provider: "claude-code" | "codex";
  providerSessionId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  timestamp: string;
  sequence: number;
  rawRef: string;
  kind?: "text" | "thinking" | "tool_call" | "tool_result";
  attachments?: Array<{
    id: string;
    kind: "image";
    fileName: string;
    mimeType: string;
    fileSize: number;
  }>;
}) {
  return {
    kind: "text" as const,
    toolCall: null,
    ...overrides
  };
}

function createSyntheticUserMessage(): SessionMessageViewModel {
  return {
    id: "synthetic-1",
    sessionId: "session-1",
    role: "user",
    kind: "text",
    content: "你好",
    toolCall: null,
    timestamp: "2026-03-24T10:00:00.000Z",
    sequence: Number.MAX_SAFE_INTEGER - 1,
    rawRef: "synthetic://codex/thread-1/synthetic-1",
    deliveryState: "sent",
    clientRequestId: null
  };
}

describe("session runtime machine", () => {
  it("按 messageId 去重并保持消息顺序", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "m-2",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "第二条",
        timestamp: "2026-03-23T10:00:02.000Z",
        sequence: 2,
        rawRef: "codex://demo#2"
      }),
      createHistoryMessage({
        messageId: "m-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "user",
        content: "第一条",
        timestamp: "2026-03-23T10:00:01.000Z",
        sequence: 1,
        rawRef: "codex://demo#1"
      }),
      createHistoryMessage({
        messageId: "m-2",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "第二条",
        timestamp: "2026-03-23T10:00:02.000Z",
        sequence: 2,
        rawRef: "codex://demo#2"
      })
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.id)).toEqual(["m-1", "m-2"]);
  });

  it("会折叠 codex 历史里只差末尾换行的重复文本消息", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "codex-response-item",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "user",
        content: "same message",
        timestamp: "2026-03-24T01:05:29.473Z",
        sequence: 2,
        rawRef: "codex://demo#line=6"
      }),
      createHistoryMessage({
        messageId: "codex-event-msg",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "user",
        content: "same message\n",
        timestamp: "2026-03-24T01:05:29.473Z",
        sequence: 3,
        rawRef: "codex://demo#line=7"
      })
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("codex-response-item");
    expect(merged[0].content).toBe("same message");
  });

  it("prefers the richer codex message when the duplicate only differs by an inline base64 image", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "codex-plain-message",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "请看这张图",
        timestamp: "2026-03-24T01:05:29.100Z",
        sequence: 2,
        rawRef: "codex://demo#line=6"
      }),
      createHistoryMessage({
        messageId: "codex-rich-message",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: `请看这张图\n\n![预览图](${SAMPLE_IMAGE_DATA_URL})`,
        timestamp: "2026-03-24T01:05:29.900Z",
        sequence: 3,
        rawRef: "codex://demo#line=7"
      })
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("codex-rich-message");
    expect(merged[0].content).toContain(SAMPLE_IMAGE_DATA_URL);
  });

  it("prefers the codex message that keeps attachments when the visible text is the same", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "codex-plain-message",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "确保主题按钮横向铺满",
        timestamp: "2026-03-24T01:05:29.100Z",
        sequence: 2,
        rawRef: "codex://demo#line=6"
      }),
      createHistoryMessage({
        messageId: "codex-attachment-message",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content:
          '<image name=[Image #1]> { "type": "input_image", "image_url": "" } </image>\n确保主题按钮横向铺满',
        timestamp: "2026-03-24T01:05:29.900Z",
        sequence: 3,
        rawRef: "codex://demo#line=7",
        attachments: [
          {
            id: "attachment-1",
            kind: "image",
            fileName: "图片附件 1",
            mimeType: "image/png",
            fileSize: 114100
          }
        ]
      })
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("codex-attachment-message");
    expect(merged[0].attachments).toHaveLength(1);
  });

  it("会折叠 codex 过时 event_msg 和后续 response_item 的重复用户消息", () => {
    const merged = mergeAuthoritativeMessages(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "codex-event-msg",
            provider: "codex",
            providerSessionId: "raw-1",
            role: "user",
            content: "same message",
            timestamp: "2026-03-24T01:05:29.100Z",
            sequence: 2,
            rawRef: "codex://demo#line=6"
          })
        )
      ],
      "session-1",
      [
        createHistoryMessage({
          messageId: "codex-response-item",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "user",
          content: "same message",
          timestamp: "2026-03-24T01:05:29.900Z",
          sequence: 2,
          rawRef: "codex://demo#line=7"
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("codex-response-item");
  });

  it("发送成功后会用正式消息替换本地 pending 消息", () => {
    const pending = createPendingMessage("session-1", "先发出去", "client-1");
    const reconciled = reconcileMessage(
      [pending],
      "session-1",
      createHistoryMessage({
        messageId: "server-1",
        provider: "claude-code",
        providerSessionId: "raw-2",
        role: "user",
        content: "先发出去",
        timestamp: "2026-03-23T10:00:05.000Z",
        sequence: 3,
        rawRef: "claude-code://demo#3&part=0"
      }),
      "client-1"
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe("server-1");
    expect(reconciled[0].deliveryState).toBe("sent");
  });

  it("会用权威 user 消息替换 synthetic 首条消息，避免重复显示", () => {
    const merged = mergeAuthoritativeMessages(
      [createSyntheticUserMessage()],
      "session-1",
      [
        createHistoryMessage({
          messageId: "server-user-1",
          provider: "codex",
          providerSessionId: "thread-1",
          role: "user",
          content: "你好",
          timestamp: "2026-03-24T10:00:00.400Z",
          sequence: 1,
          rawRef: "codex://demo#line=1"
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("server-user-1");
    expect(merged[0].rawRef).toBe("codex://demo#line=1");
  });

  it("发送失败后只标记失败，不制造第二份消息", () => {
    const pending = createPendingMessage("session-1", "失败消息", "client-2");
    const failed = markPendingAsFailed([pending], "client-2");

    expect(failed).toHaveLength(1);
    expect(failed[0].deliveryState).toBe("failed");
    expect(failed[0].clientRequestId).toBe("client-2");
  });

  it("缺少 toolCall 时会补一个通用工具抽象", () => {
    const view = toViewMessage("session-1", {
      messageId: "legacy-tool-1",
      provider: "claude-code",
      providerSessionId: "raw-legacy",
      role: "tool",
      content: "legacy tool output",
      timestamp: "2026-03-23T10:00:06.000Z",
      sequence: 4,
      rawRef: "claude-code://demo#4",
      toolCall: null
    });

    expect(view.kind).toBe("tool_result");
    expect(view.toolCall).toEqual({
      callId: "claude-code://demo#4",
      name: "tool",
      input: "",
      output: "legacy tool output",
      error: null,
      status: "completed"
    });
  });
});
