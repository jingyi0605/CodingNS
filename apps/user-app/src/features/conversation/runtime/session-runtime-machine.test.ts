import { describe, expect, it } from "vitest";

import type { ProviderId } from "../api/conversation-api";
import {
  createPendingMessage,
  markPendingAsFailed,
  mergeAuthoritativeMessages,
  reconcileMessage,
  removeRuntimeThinkingPlaceholder,
  toViewMessage,
  upsertRuntimeThinkingPlaceholder,
  type SessionMessageViewModel
} from "./session-runtime-machine";
import type { ToolCallDto } from "../api/conversation-api";

const SAMPLE_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=";

function buildInternalAttachmentDebugBlock(path = "/tmp/demo/image.png"): string {
  return [
    "[[CODINGNS_IMAGE_ATTACHMENTS]]",
    "",
    "下面这些图片是用户随消息附带的本地附件。请先读取并理解它们，再继续处理这条请求。",
    "",
    `1. ${path}`,
    "",
    "[[/CODINGNS_IMAGE_ATTACHMENTS]]"
  ].join("\n");
}

function createHistoryMessage(overrides: {
  messageId: string;
  provider: ProviderId;
  providerSessionId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  timestamp: string;
  sequence: number;
  rawRef: string;
  kind?: "text" | "thinking" | "tool_call" | "tool_result";
  toolCall?: ToolCallDto | null;
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

function createSyntheticBootstrapMessage(overrides?: Partial<ReturnType<typeof createHistoryMessage>>) {
  return createHistoryMessage({
    messageId: "synthetic-bootstrap-1",
    provider: "opencode",
    providerSessionId: "thread-1",
    role: "user",
    content: "你好",
    timestamp: "2026-03-24T10:00:00.100Z",
    sequence: 1,
    rawRef: "synthetic://opencode/thread-1/bootstrap-1",
    ...overrides
  });
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

  it("Codex 消息在 sequence 和 timestamp 相同时仍按 rawRef 行号稳定排序", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "m-2",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "第二条",
        timestamp: "2026-03-23T10:00:02.000Z",
        sequence: 2,
        rawRef: "codex://demo#line=7"
      }),
      createHistoryMessage({
        messageId: "m-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "user",
        content: "第一条",
        timestamp: "2026-03-23T10:00:02.000Z",
        sequence: 2,
        rawRef: "codex://demo#line=6"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual(["m-1", "m-2"]);
  });

  it("Codex 增量合并时相同 sequence 的用户消息不会被助手消息压到后面", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "assistant-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "收到",
        timestamp: "2026-03-23T10:00:06.000Z",
        sequence: 4,
        rawRef: "codex://demo#line=9"
      }),
      createHistoryMessage({
        messageId: "user-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "user",
        content: "继续",
        timestamp: "2026-03-23T10:00:06.000Z",
        sequence: 4,
        rawRef: "codex://demo#line=8"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual(["user-1", "assistant-1"]);
    expect(merged.map((item) => item.role)).toEqual(["user", "assistant"]);
  });

  it("OpenCode 相同 sequence 冲突时会优先按 message/part 结构顺序，而不是按较晚 timestamp 排序", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "assistant-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        content: "第一轮回复",
        timestamp: "2026-03-23T10:00:06.000Z",
        sequence: 3,
        rawRef: "opencode://thread-1/message/assistant-1/part/text-1"
      }),
      createHistoryMessage({
        messageId: "user-2",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "user",
        content: "继续第二轮",
        timestamp: "2026-03-23T10:00:05.000Z",
        sequence: 3,
        rawRef: "opencode://thread-1/message/user-2/part/text-1"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual(["assistant-1", "user-2"]);
    expect(merged.map((item) => item.role)).toEqual(["assistant", "user"]);
  });

  it("Claude stable rawRef 在同一条消息内会把 thinking 排在 text 前面", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "claude-text-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        role: "assistant",
        content: "最终回复",
        timestamp: "2026-03-23T10:00:02.000Z",
        sequence: 2,
        rawRef:
          "claude-code://message/message%3Aassistant%3Amsg-1%3Atype%3Atext"
      }),
      createHistoryMessage({
        messageId: "claude-thinking-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        role: "assistant",
        kind: "thinking",
        content: "先思考",
        timestamp: "2026-03-23T10:00:02.000Z",
        sequence: 2,
        rawRef:
          "claude-code://message/message%3Aassistant%3Amsg-1%3Atype%3Athinking"
      })
    ]);

    expect(merged.map((item) => item.kind)).toEqual(["thinking", "text"]);
    expect(merged.map((item) => item.id)).toEqual(["claude-thinking-1", "claude-text-1"]);
  });

  it("同一 messageId 内容增长时会保留更新后的版本", () => {
    const merged = mergeAuthoritativeMessages(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "runtime-1",
            provider: "opencode",
            providerSessionId: "thread-1",
            role: "assistant",
            content: "第一段",
            timestamp: "2026-03-28T10:00:00.000Z",
            sequence: 10,
            rawRef: "opencode://session/thread-1/message/assistant-1/part/text-1"
          })
        )
      ],
      "session-1",
      [
        createHistoryMessage({
          messageId: "runtime-1",
          provider: "opencode",
          providerSessionId: "thread-1",
          role: "assistant",
          content: "第一段\n第二段",
          timestamp: "2026-03-28T10:00:01.000Z",
          sequence: 10,
          rawRef: "opencode://session/thread-1/message/assistant-1/part/text-1"
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("runtime-1");
    expect(merged[0].content).toBe("第一段\n第二段");
  });

  it("同一条权威 assistant 消息重复回流时不会把排序锚点推到时间线底部", () => {
    const merged = mergeAuthoritativeMessages(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "assistant-1",
            provider: "claude-code",
            providerSessionId: "thread-1",
            role: "assistant",
            content: "第一轮回复",
            timestamp: "2026-03-28T10:00:02.000Z",
            sequence: 2,
            rawRef: "claude://raw#line=2"
          })
        ),
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "user-2",
            provider: "claude-code",
            providerSessionId: "thread-1",
            role: "user",
            content: "继续",
            timestamp: "2026-03-28T10:00:03.000Z",
            sequence: 3,
            rawRef: "claude://raw#line=3"
          })
        ),
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "assistant-2",
            provider: "claude-code",
            providerSessionId: "thread-1",
            role: "assistant",
            content: "第二轮回复",
            timestamp: "2026-03-28T10:00:04.000Z",
            sequence: 4,
            rawRef: "claude://raw#line=4"
          })
        )
      ],
      "session-1",
      [
        createHistoryMessage({
          messageId: "assistant-1",
          provider: "claude-code",
          providerSessionId: "thread-1",
          role: "assistant",
          content: "第一轮回复\n补全后的正文",
          timestamp: "2026-03-28T10:00:09.000Z",
          sequence: 9,
          rawRef: "claude://raw#line=2"
        })
      ]
    );

    expect(merged.map((item) => item.id)).toEqual([
      "assistant-1",
      "user-2",
      "assistant-2"
    ]);
    expect(merged[0]).toMatchObject({
      id: "assistant-1",
      timestamp: "2026-03-28T10:00:02.000Z",
      sequence: 2,
      content: "第一轮回复\n补全后的正文"
    });
  });

  it("同一条 thinking 在 runtime 与 history 的 rawRef 不同时，仍会回到正确时间线位置", () => {
    const merged = mergeAuthoritativeMessages(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "assistant-old-1",
            provider: "codex",
            providerSessionId: "thread-1",
            role: "assistant",
            content: "上一轮回复",
            timestamp: "2026-03-28T10:00:02.000Z",
            sequence: 2,
            rawRef: "codex://thread-1#line=2"
          })
        ),
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "user-latest-1",
            provider: "codex",
            providerSessionId: "thread-1",
            role: "user",
            content: "忽略聊天记录，再次查看你是什么模型？",
            timestamp: "2026-03-28T10:00:03.000Z",
            sequence: 3,
            rawRef: "codex://thread-1#line=3"
          })
        ),
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "assistant-latest-1",
            provider: "codex",
            providerSessionId: "thread-1",
            role: "assistant",
            content: "我的实际模型是 deepseek-v4-flash。",
            timestamp: "2026-03-28T10:00:05.000Z",
            sequence: 5,
            rawRef: "codex://thread-1#line=5"
          })
        ),
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "thinking-latest-1",
            provider: "codex",
            providerSessionId: "thread-1",
            role: "assistant",
            kind: "thinking",
            content: "The user is asking me to ignore chat history and again state what model I am.",
            timestamp: "2026-03-28T10:00:09.000Z",
            sequence: 9,
            rawRef: "codex://thread-1#line=9"
          })
        )
      ],
      "session-1",
      [
        createHistoryMessage({
          messageId: "thinking-latest-1",
          provider: "codex",
          providerSessionId: "thread-1",
          role: "assistant",
          kind: "thinking",
          content: "The user is asking me to ignore chat history and again state what model I am.",
          timestamp: "2026-03-28T10:00:04.000Z",
          sequence: 4,
          rawRef: "codex://thread-1#line=4"
        })
      ]
    );

    expect(merged.map((item) => item.id)).toEqual([
      "assistant-old-1",
      "user-latest-1",
      "thinking-latest-1",
      "assistant-latest-1"
    ]);
    expect(merged[2]).toMatchObject({
      id: "thinking-latest-1",
      timestamp: "2026-03-28T10:00:04.000Z",
      sequence: 4,
      rawRef: "codex://thread-1#line=4"
    });
  });

  it("同一工具消息收到完成结果后会覆盖 running 状态", () => {
    const merged = mergeAuthoritativeMessages(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "tool-1",
            provider: "opencode",
            providerSessionId: "thread-1",
            role: "tool",
            kind: "tool_result",
            content: "",
            timestamp: "2026-03-28T10:00:00.000Z",
            sequence: 11,
            rawRef: "opencode://session/thread-1/message/assistant-1/part/tool-1",
            toolCall: {
              callId: "tool-1",
              name: "shell_command",
              input: "{\"command\":\"pwd\"}",
              output: null,
              error: null,
              status: "running"
            }
          })
        )
      ],
      "session-1",
      [
        createHistoryMessage({
          messageId: "tool-1",
          provider: "opencode",
          providerSessionId: "thread-1",
          role: "tool",
          kind: "tool_result",
          content: "/tmp/workspace",
          timestamp: "2026-03-28T10:00:01.000Z",
          sequence: 11,
          rawRef: "opencode://session/thread-1/message/assistant-1/part/tool-1",
          toolCall: {
            callId: "tool-1",
            name: "shell_command",
            input: "{\"command\":\"pwd\"}",
            output: "/tmp/workspace",
            error: null,
            status: "completed"
          }
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].toolCall?.status).toBe("completed");
    expect(merged[0].toolCall?.output).toBe("/tmp/workspace");
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

  it("会在最新 user 消息之后插入运行中占位，并在 assistant 到达后移除", () => {
    const withPlaceholder = upsertRuntimeThinkingPlaceholder(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "user-1",
            provider: "codex",
            providerSessionId: "raw-1",
            role: "user",
            content: "继续",
            timestamp: "2026-03-24T01:05:29.100Z",
            sequence: 1,
            rawRef: "codex://demo#line=1"
          })
        )
      ],
      "session-1",
      "Codex 正在思考..."
    );

    expect(withPlaceholder).toHaveLength(2);
    expect(withPlaceholder.at(-1)).toMatchObject({
      role: "system",
      kind: "text",
      content: "Codex 正在思考..."
    });

    const withoutPlaceholder = removeRuntimeThinkingPlaceholder(withPlaceholder, "session-1");

    expect(withoutPlaceholder).toHaveLength(1);
    expect(withoutPlaceholder[0]?.role).toBe("user");
  });

  it("会折叠短时间内重复回流的 codex assistant 正文", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "codex-runtime-message",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "同一条回复",
        timestamp: "2026-03-24T01:05:29.100Z",
        sequence: 2,
        rawRef: "codex://demo#line=6"
      }),
      createHistoryMessage({
        messageId: "codex-history-message",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "同一条回复",
        timestamp: "2026-03-24T01:05:31.100Z",
        sequence: 3,
        rawRef: "codex://demo#line=7"
      })
    ]);

    expect(merged).toHaveLength(1);
  });

  it("不会把被 codex 工具消息隔开的相同 assistant 正文误当成重复消息", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "codex-assistant-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "继续跑回归。现在主要看 preview 异步返回后，按钮状态是不是按预期切换。",
        timestamp: "2026-04-13T10:00:00.000Z",
        sequence: 2,
        rawRef: "codex://demo#line=6"
      }),
      createHistoryMessage({
        messageId: "codex-tool-call-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "tool",
        kind: "tool_call",
        content: "{\"command\":\"pnpm --filter user-app exec vitest run\"}",
        timestamp: "2026-04-13T10:00:01.000Z",
        sequence: 3,
        rawRef: "codex://demo#line=7",
        toolCall: {
          callId: "tool-1",
          name: "shell_command",
          input: "{\"command\":\"pnpm --filter user-app exec vitest run\"}",
          output: null,
          error: null,
          status: "running"
        }
      }),
      createHistoryMessage({
        messageId: "codex-tool-result-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "tool",
        kind: "tool_result",
        content: "Exit code: 0",
        timestamp: "2026-04-13T10:00:05.000Z",
        sequence: 4,
        rawRef: "codex://demo#line=8",
        toolCall: {
          callId: "tool-1",
          name: "shell_command",
          input: "{\"command\":\"pnpm --filter user-app exec vitest run\"}",
          output: "Exit code: 0",
          error: null,
          status: "completed"
        }
      }),
      createHistoryMessage({
        messageId: "codex-assistant-2",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "继续跑回归。现在主要看 preview 异步返回后，按钮状态是不是按预期切换。",
        timestamp: "2026-04-13T10:00:08.000Z",
        sequence: 5,
        rawRef: "codex://demo#line=9"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual([
      "codex-assistant-1",
      "codex-tool-call-1",
      "codex-tool-result-1",
      "codex-assistant-2"
    ]);
  });

  it("不会把相隔较久但内容相同的 codex assistant 历史消息误折叠", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "codex-assistant-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "处理完成",
        timestamp: "2026-04-13T10:00:00.000Z",
        sequence: 2,
        rawRef: "codex://demo#line=6"
      }),
      createHistoryMessage({
        messageId: "codex-assistant-2",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "处理完成",
        timestamp: "2026-04-13T10:00:20.000Z",
        sequence: 3,
        rawRef: "codex://demo#line=7"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual([
      "codex-assistant-1",
      "codex-assistant-2"
    ]);
  });

  it("不会误折叠中间已经插入另一条 assistant 正文的 codex 重复文案", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "codex-assistant-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "同一条提示语",
        timestamp: "2026-04-13T10:00:00.000Z",
        sequence: 2,
        rawRef: "codex://demo#line=6"
      }),
      createHistoryMessage({
        messageId: "codex-tool-result-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "tool",
        kind: "tool_result",
        content: "Exit code: 0",
        timestamp: "2026-04-13T10:00:01.000Z",
        sequence: 3,
        rawRef: "codex://demo#line=7",
        toolCall: {
          callId: "tool-1",
          name: "shell_command",
          input: "{\"command\":\"pwd\"}",
          output: "Exit code: 0",
          error: null,
          status: "completed"
        }
      }),
      createHistoryMessage({
        messageId: "codex-assistant-2",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "这是中间插进来的另一条正文",
        timestamp: "2026-04-13T10:00:03.000Z",
        sequence: 4,
        rawRef: "codex://demo#line=8"
      }),
      createHistoryMessage({
        messageId: "codex-tool-result-2",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "tool",
        kind: "tool_result",
        content: "Exit code: 0",
        timestamp: "2026-04-13T10:00:05.000Z",
        sequence: 5,
        rawRef: "codex://demo#line=9",
        toolCall: {
          callId: "tool-2",
          name: "shell_command",
          input: "{\"command\":\"git status --short\"}",
          output: "Exit code: 0",
          error: null,
          status: "completed"
        }
      }),
      createHistoryMessage({
        messageId: "codex-assistant-3",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        content: "同一条提示语",
        timestamp: "2026-04-13T10:00:08.000Z",
        sequence: 6,
        rawRef: "codex://demo#line=10"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual([
      "codex-assistant-1",
      "codex-tool-result-1",
      "codex-assistant-2",
      "codex-tool-result-2",
      "codex-assistant-3"
    ]);
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

  it("会折叠只差内部附件调试块的 codex 重复用户消息", () => {
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
          content: `same message\n\n${buildInternalAttachmentDebugBlock()}`,
          timestamp: "2026-03-24T01:05:29.900Z",
          sequence: 2,
          rawRef: "codex://demo#line=7"
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("codex-response-item");
    expect(merged[0].content).toBe("same message");
  });

  it("会用后续权威 codex assistant 消息替换运行时阶段的漂移 messageId", () => {
    const merged = mergeAuthoritativeMessages(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "codex-runtime-message",
            provider: "codex",
            providerSessionId: "raw-1",
            role: "assistant",
            content: "代码已经改完了，接下来补回归测试。",
            timestamp: "2026-04-13T10:00:00.000Z",
            sequence: 8,
            rawRef: "codex://demo#line=18"
          })
        )
      ],
      "session-1",
      [
        createHistoryMessage({
          messageId: "codex-history-message",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "代码已经改完了，接下来补回归测试。",
          timestamp: "2026-04-13T10:00:35.000Z",
          sequence: 10,
          rawRef: "codex://demo#line=32"
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "codex-history-message",
      content: "代码已经改完了，接下来补回归测试。"
    });
  });

  it("会用后续权威 codex tool_result 消息替换运行时阶段的漂移 messageId", () => {
    const merged = mergeAuthoritativeMessages(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "codex-runtime-tool-result",
            provider: "codex",
            providerSessionId: "raw-1",
            role: "tool",
            kind: "tool_result",
            content: "Exit code: 0",
            timestamp: "2026-04-13T10:00:01.000Z",
            sequence: 9,
            rawRef: "codex://demo#line=19",
            toolCall: {
              callId: "tool-call-1",
              name: "shell_command",
              input: "{\"command\":\"pnpm --filter user-app exec vitest run\"}",
              output: "Exit code: 0",
              error: null,
              status: "completed"
            }
          })
        )
      ],
      "session-1",
      [
        createHistoryMessage({
          messageId: "codex-history-tool-result",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "tool",
          kind: "tool_result",
          content: "Exit code: 0",
          timestamp: "2026-04-13T10:00:38.000Z",
          sequence: 11,
          rawRef: "codex://demo#line=33",
          toolCall: {
            callId: "tool-call-1",
            name: "shell_command",
            input: "{\"command\":\"pnpm --filter user-app exec vitest run\"}",
            output: "Exit code: 0",
            error: null,
            status: "completed"
          }
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "codex-history-tool-result",
      kind: "tool_result"
    });
    expect(merged[0].toolCall?.callId).toBe("tool-call-1");
  });

  it("不会把相隔太久的相同 codex assistant 文案误替换成同一条消息", () => {
    const merged = mergeAuthoritativeMessages(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "codex-runtime-message",
            provider: "codex",
            providerSessionId: "raw-1",
            role: "assistant",
            content: "处理完成",
            timestamp: "2026-04-13T10:00:00.000Z",
            sequence: 8,
            rawRef: "codex://demo#line=18"
          })
        )
      ],
      "session-1",
      [
        createHistoryMessage({
          messageId: "codex-history-message",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "处理完成",
          timestamp: "2026-04-13T10:05:00.000Z",
          sequence: 30,
          rawRef: "codex://demo#line=80"
        })
      ]
    );

    expect(merged.map((item) => item.id)).toEqual([
      "codex-runtime-message",
      "codex-history-message"
    ]);
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

  it("发送成功后会回到权威时间线顺序，避免后续 assistant 插到 user 前面", () => {
    const historical = toViewMessage(
      "session-1",
      createHistoryMessage({
        messageId: "history-1",
        provider: "claude-code",
        providerSessionId: "raw-2",
        role: "assistant",
        content: "上一条",
        timestamp: "2026-03-23T10:00:01.000Z",
        sequence: 1,
        rawRef: "claude-code://demo#1&part=0"
      })
    );
    const pending = createPendingMessage("session-1", "先发出去", "client-1");
    const reconciled = reconcileMessage(
      [historical, pending],
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
    const merged = mergeAuthoritativeMessages(reconciled, "session-1", [
      createHistoryMessage({
        messageId: "assistant-2",
        provider: "claude-code",
        providerSessionId: "raw-2",
        role: "assistant",
        content: "收到",
        timestamp: "2026-03-23T10:00:06.000Z",
        sequence: 4,
        rawRef: "claude-code://demo#4&part=0"
      })
    ]);

    expect(merged).toHaveLength(3);
    expect(merged.map((message) => message.id)).toEqual([
      "history-1",
      "server-1",
      "assistant-2"
    ]);
    expect(merged.map((message) => message.role)).toEqual([
      "assistant",
      "user",
      "assistant"
    ]);
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
          sequence: 3,
          rawRef: "codex://demo#line=1"
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("server-user-1");
    expect(merged[0].rawRef).toBe("codex://demo#line=1");
  });

  it("会把带内部附件调试块的 codex 首条权威 user 消息与 synthetic 首条消息合并", () => {
    const merged = mergeAuthoritativeMessages(
      [createSyntheticUserMessage()],
      "session-1",
      [
        createHistoryMessage({
          messageId: "server-user-1",
          provider: "codex",
          providerSessionId: "thread-1",
          role: "user",
          content: `你好\n\n${buildInternalAttachmentDebugBlock()}`,
          timestamp: "2026-03-24T10:00:00.400Z",
          sequence: 3,
          rawRef: "codex://demo#line=1"
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("server-user-1");
    expect(merged[0].content).toBe("你好");
  });

  it("缓存里已有正式 user 消息时，不会再注入重复的 bootstrap synthetic 消息", () => {
    const merged = mergeAuthoritativeMessages(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "server-user-1",
            provider: "opencode",
            providerSessionId: "thread-1",
            role: "user",
            content: "你好",
            timestamp: "2026-03-24T10:00:00.000Z",
            sequence: 3,
            rawRef: "opencode://thread-1#line=1"
          })
        )
      ],
      "session-1",
      [createSyntheticBootstrapMessage()]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("server-user-1");
  });

  it("会把 OpenCode 的 #synthetic accepted 消息当成 optimistic，并在历史回流后替换掉", () => {
    const merged = mergeAuthoritativeMessages(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "opencode-accepted-1",
            provider: "opencode",
            providerSessionId: "thread-1",
            role: "user",
            content: "继续执行",
            timestamp: "2026-03-24T10:00:02.000Z",
            sequence: 61,
            rawRef: "opencode://thread-1/message/accepted-1#synthetic"
          })
        )
      ],
      "session-1",
      [
        createHistoryMessage({
          messageId: "server-user-61",
          provider: "opencode",
            providerSessionId: "thread-1",
            role: "user",
            content: "继续执行",
            timestamp: "2026-03-24T10:00:02.200Z",
            sequence: 64,
            rawRef: "opencode://thread-1#line=61"
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("server-user-61");
    expect(merged[0].rawRef).toBe("opencode://thread-1#line=61");
  });

  it("会折叠 OpenCode 在工具链中插入的重复 user turn", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "user-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "user",
        content: "请分析 git 改动",
        timestamp: "2026-03-24T10:00:00.000Z",
        sequence: 1,
        rawRef: "opencode://thread-1/message/user-1/part/text-1"
      }),
      createHistoryMessage({
        messageId: "thinking-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        kind: "thinking",
        content: "先看看 git 变更",
        timestamp: "2026-03-24T10:00:03.000Z",
        sequence: 2,
        rawRef: "opencode://thread-1/message/assistant-1/part/reasoning-1"
      }),
      createHistoryMessage({
        messageId: "tool-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "tool",
        kind: "tool_result",
        content: "git status --short",
        timestamp: "2026-03-24T10:00:05.000Z",
        sequence: 3,
        rawRef: "opencode://thread-1/message/assistant-1/part/tool-1"
      }),
      createHistoryMessage({
        messageId: "user-2",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "user",
        content: "请分析 git 改动",
        timestamp: "2026-03-24T10:00:12.000Z",
        sequence: 4,
        rawRef: "opencode://thread-1/message/user-2/part/text-1"
      }),
      createHistoryMessage({
        messageId: "assistant-2",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        content: "我看完了，下面开始总结。",
        timestamp: "2026-03-24T10:00:20.000Z",
        sequence: 5,
        rawRef: "opencode://thread-1/message/assistant-2/part/text-1"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual([
      "user-1",
      "thinking-1",
      "tool-1",
      "assistant-2"
    ]);
  });

  it("如果两次相同 user turn 之间已经有 assistant 正文，就保留两次用户消息", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "user-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "user",
        content: "请分析 git 改动",
        timestamp: "2026-03-24T10:00:00.000Z",
        sequence: 1,
        rawRef: "opencode://thread-1/message/user-1/part/text-1"
      }),
      createHistoryMessage({
        messageId: "assistant-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        content: "第一轮总结",
        timestamp: "2026-03-24T10:00:08.000Z",
        sequence: 2,
        rawRef: "opencode://thread-1/message/assistant-1/part/text-1"
      }),
      createHistoryMessage({
        messageId: "user-2",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "user",
        content: "请分析 git 改动",
        timestamp: "2026-03-24T10:00:12.000Z",
        sequence: 3,
        rawRef: "opencode://thread-1/message/user-2/part/text-1"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual([
      "user-1",
      "assistant-1",
      "user-2"
    ]);
  });

  it("会折叠 OpenCode 新建会话首轮里重复回流的整组问答", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "user-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "user",
        content: "请回复我1234",
        timestamp: "2026-03-29T01:37:05.000Z",
        sequence: 1,
        rawRef: "opencode://thread-1/message/user-1/part/text-1"
      }),
      createHistoryMessage({
        messageId: "assistant-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        content: "1234",
        timestamp: "2026-03-29T01:37:15.000Z",
        sequence: 2,
        rawRef: "opencode://thread-1/message/assistant-1/part/text-1"
      }),
      createHistoryMessage({
        messageId: "user-2",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "user",
        content: "请回复我1234",
        timestamp: "2026-03-29T01:37:16.000Z",
        sequence: 3,
        rawRef: "opencode://thread-1/message/user-2/part/text-1"
      }),
      createHistoryMessage({
        messageId: "assistant-2",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        content: "1234",
        timestamp: "2026-03-29T01:37:18.000Z",
        sequence: 4,
        rawRef: "opencode://thread-1/message/assistant-2/part/text-1"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual([
      "user-1",
      "assistant-2"
    ]);
    expect(merged[1]?.content).toBe("1234");
  });

  it("不会误折叠 OpenCode 连续两轮内容不同的 assistant 正文", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "user-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "user",
        content: "请回复我1234",
        timestamp: "2026-03-29T01:37:05.000Z",
        sequence: 1,
        rawRef: "opencode://thread-1/message/user-1/part/text-1"
      }),
      createHistoryMessage({
        messageId: "assistant-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        content: "1234",
        timestamp: "2026-03-29T01:37:15.000Z",
        sequence: 2,
        rawRef: "opencode://thread-1/message/assistant-1/part/text-1"
      }),
      createHistoryMessage({
        messageId: "user-2",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "user",
        content: "请回复我1234",
        timestamp: "2026-03-29T01:37:16.000Z",
        sequence: 3,
        rawRef: "opencode://thread-1/message/user-2/part/text-1"
      }),
      createHistoryMessage({
        messageId: "assistant-2",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        content: "12345",
        timestamp: "2026-03-29T01:37:18.000Z",
        sequence: 4,
        rawRef: "opencode://thread-1/message/assistant-2/part/text-1"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual([
      "user-1",
      "assistant-1",
      "user-2",
      "assistant-2"
    ]);
  });

  it("会折叠 OpenCode 连续重复回放的 thinking 消息", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "thinking-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        kind: "thinking",
        content: "The user is saying \"回复567\" which means \"reply 567\". I'll just reply with 567.",
        timestamp: "2026-03-29T01:37:15.000Z",
        sequence: 2,
        rawRef: "opencode://thread-1/message/assistant-1/part/reasoning-1"
      }),
      createHistoryMessage({
        messageId: "thinking-2",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        kind: "thinking",
        content: "The user is saying \"回复567\" which means \"reply 567\". I'll just reply with 567.",
        timestamp: "2026-03-29T01:37:16.000Z",
        sequence: 3,
        rawRef: "opencode://thread-1/message/assistant-2/part/reasoning-1"
      }),
      createHistoryMessage({
        messageId: "assistant-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        content: "567",
        timestamp: "2026-03-29T01:37:18.000Z",
        sequence: 4,
        rawRef: "opencode://thread-1/message/assistant-2/part/text-1"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual([
      "thinking-2",
      "assistant-1"
    ]);
    expect(merged[0]?.kind).toBe("thinking");
    expect(merged[0]?.content).toContain("reply 567");
  });

  it("会合并 OpenCode runtime 与 history 回流的同一条消息 part", () => {
    const merged = mergeAuthoritativeMessages(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "runtime-user-345",
            provider: "opencode",
            providerSessionId: "thread-1",
            role: "user",
            content: "回复345",
            timestamp: "2026-04-25T13:09:14.153Z",
            sequence: 17,
            rawRef:
              "opencode://session/thread-1/message/msg-user-345/part/prt-user-345?part=2001"
          })
        ),
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "runtime-thinking-345",
            provider: "opencode",
            providerSessionId: "thread-1",
            role: "assistant",
            kind: "thinking",
            content: "The user is saying \"回复345\" which means \"reply 345\".",
            timestamp: "2026-04-25T13:09:14.165Z",
            sequence: 18,
            rawRef:
              "opencode://session/thread-1/message/msg-assistant-345/part/prt-thinking-345?part=1001"
          })
        ),
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "runtime-text-345",
            provider: "opencode",
            providerSessionId: "thread-1",
            role: "assistant",
            content: "345",
            timestamp: "2026-04-25T13:09:14.165Z",
            sequence: 18,
            rawRef:
              "opencode://session/thread-1/message/msg-assistant-345/part/prt-text-345?part=2001"
          })
        )
      ],
      "session-1",
      [
        createHistoryMessage({
          messageId: "history-user-345",
          provider: "opencode",
          providerSessionId: "thread-1",
          role: "user",
          content: "回复345",
          timestamp: "2026-04-25T13:09:14.153Z",
          sequence: 10,
          rawRef:
            "opencode://session/thread-1/message/msg-user-345/part/prt-user-345"
        }),
        createHistoryMessage({
          messageId: "history-thinking-345",
          provider: "opencode",
          providerSessionId: "thread-1",
          role: "assistant",
          kind: "thinking",
          content: "The user is saying \"回复345\" which means \"reply 345\".",
          timestamp: "2026-04-25T13:09:14.165Z",
          sequence: 11,
          rawRef:
            "opencode://session/thread-1/message/msg-assistant-345/part/prt-thinking-345"
        }),
        createHistoryMessage({
          messageId: "history-text-345",
          provider: "opencode",
          providerSessionId: "thread-1",
          role: "assistant",
          content: "345",
          timestamp: "2026-04-25T13:09:14.165Z",
          sequence: 12,
          rawRef:
            "opencode://session/thread-1/message/msg-assistant-345/part/prt-text-345"
        })
      ]
    );

    expect(merged.map((item) => item.id)).toEqual([
      "runtime-user-345",
      "runtime-thinking-345",
      "runtime-text-345"
    ]);
    expect(merged.map((item) => item.sequence)).toEqual([10, 11, 12]);
    expect(merged.map((item) => item.rawRef)).toEqual([
      "opencode://session/thread-1/message/msg-user-345/part/prt-user-345",
      "opencode://session/thread-1/message/msg-assistant-345/part/prt-thinking-345",
      "opencode://session/thread-1/message/msg-assistant-345/part/prt-text-345"
    ]);
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
  it("Gemini runtime 和历史回流的重复 user/assistant 正文会被折叠", () => {
    const merged = mergeAuthoritativeMessages(
      [
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "runtime-user-1",
            provider: "gemini",
            providerSessionId: "gemini-session-1",
            role: "user",
            content: "对话测试",
            timestamp: "2026-04-08T12:46:13.036Z",
            sequence: 2,
            rawRef: "gemini://session/gemini-session-1/message/user-1"
          })
        ),
        toViewMessage(
          "session-1",
          createHistoryMessage({
            messageId: "runtime-assistant-1",
            provider: "gemini",
            providerSessionId: "gemini-session-1",
            role: "assistant",
            content: "对话测试收到。系统运行正常，随时可以开始。",
            timestamp: "2026-04-08T12:46:27.603Z",
            sequence: 3,
            rawRef: "gemini://session/gemini-session-1/message/assistant-1"
          })
        )
      ],
      "session-1",
      [
        createHistoryMessage({
          messageId: "history-user-1",
          provider: "gemini",
          providerSessionId: "gemini-session-1",
          role: "user",
          content: "对话测试",
          timestamp: "2026-04-08T12:46:13.036Z",
          sequence: 1,
          rawRef: "gemini://session/gemini-session-1#file=chat.json&index=0&part=0"
        }),
        createHistoryMessage({
          messageId: "history-thinking-1",
          provider: "gemini",
          providerSessionId: "gemini-session-1",
          role: "assistant",
          kind: "thinking",
          content: "Assessing Responsiveness",
          timestamp: "2026-04-08T12:46:24.088Z",
          sequence: 2,
          rawRef: "gemini://session/gemini-session-1#file=chat.json&index=1&part=0"
        }),
        createHistoryMessage({
          messageId: "history-assistant-1",
          provider: "gemini",
          providerSessionId: "gemini-session-1",
          role: "assistant",
          content: "对话测试收到。系统运行正常，随时可以开始。",
          timestamp: "2026-04-08T12:46:27.603Z",
          sequence: 3,
          rawRef: "gemini://session/gemini-session-1#file=chat.json&index=1&part=1"
        })
      ]
    );

    expect(merged.map((item) => item.id)).toEqual([
      "history-user-1",
      "history-thinking-1",
      "history-assistant-1"
    ]);
  });

  it("Gemini 连续但内容不同的消息不会被误折叠", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "gemini-assistant-1",
        provider: "gemini",
        providerSessionId: "gemini-session-1",
        role: "assistant",
        content: "第一段回复",
        timestamp: "2026-04-08T13:09:56.000Z",
        sequence: 1,
        rawRef: "gemini://session/gemini-session-1/message/assistant-1"
      }),
      createHistoryMessage({
        messageId: "gemini-assistant-2",
        provider: "gemini",
        providerSessionId: "gemini-session-1",
        role: "assistant",
        content: "第二段回复",
        timestamp: "2026-04-08T13:09:57.000Z",
        sequence: 2,
        rawRef: "gemini://session/gemini-session-1#file=chat.json&index=2&part=0"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual([
      "gemini-assistant-1",
      "gemini-assistant-2"
    ]);
  });

  it("Kimi runtime 与历史回流的重复 assistant 正文会被折叠", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "kimi-runtime-assistant-1",
        provider: "kimi",
        providerSessionId: "kimi-session-1",
        role: "assistant",
        content: "好的，给你讲个程序员笑话。",
        timestamp: "2026-04-09T00:10:00.000Z",
        sequence: 3,
        rawRef: "kimi://session/kimi-session-1/wire#line=3"
      }),
      createHistoryMessage({
        messageId: "kimi-history-assistant-1",
        provider: "kimi",
        providerSessionId: "kimi-session-1",
        role: "assistant",
        content: "好的，给你讲个程序员笑话。",
        timestamp: "2026-04-09T00:10:01.000Z",
        sequence: 4,
        rawRef: "kimi://session/kimi-session-1/context#line=6"
      })
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("kimi-history-assistant-1");
    expect(merged[0].rawRef).toContain("/context#");
  });

  it("Kimi 连续但内容不同的正文不会被误折叠", () => {
    const merged = mergeAuthoritativeMessages([], "session-1", [
      createHistoryMessage({
        messageId: "kimi-assistant-1",
        provider: "kimi",
        providerSessionId: "kimi-session-1",
        role: "assistant",
        content: "第一条回复",
        timestamp: "2026-04-09T00:10:00.000Z",
        sequence: 3,
        rawRef: "kimi://session/kimi-session-1/wire#line=3"
      }),
      createHistoryMessage({
        messageId: "kimi-assistant-2",
        provider: "kimi",
        providerSessionId: "kimi-session-1",
        role: "assistant",
        content: "第二条回复",
        timestamp: "2026-04-09T00:10:01.000Z",
        sequence: 4,
        rawRef: "kimi://session/kimi-session-1/context#line=6"
      })
    ]);

    expect(merged.map((item) => item.id)).toEqual([
      "kimi-assistant-1",
      "kimi-assistant-2"
    ]);
  });
});
