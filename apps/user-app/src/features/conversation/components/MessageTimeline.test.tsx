import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { MessageTimeline } from "./MessageTimeline";

import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";

function createTextMessage(content: string): SessionMessageViewModel {
  return {
    id: "message-1",
    sessionId: "session-1",
    role: "user",
    kind: "text",
    content,
    toolCall: null,
    timestamp: "2026-03-23T10:00:00.000Z",
    sequence: 1,
    rawRef: "codex://raw#line=1",
    deliveryState: "sent",
    clientRequestId: null
  };
}

describe("MessageTimeline", () => {
  it("会把同一次工具调用和结果合并渲染", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "tool-call-1",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_call",
            content: "{\n  \"command\": \"git status --short\"\n}",
            toolCall: {
              callId: "call-shell-1",
              name: "shell_command",
              input: "{\n  \"command\": \"git status --short\"\n}",
              output: null,
              error: null,
              status: "running"
            },
            timestamp: "2026-03-23T10:00:00.000Z",
            sequence: 1,
            rawRef: "codex://raw#line=1",
            deliveryState: "sent",
            clientRequestId: null
          },
          {
            id: "tool-result-1",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_result",
            content: " M src/main.ts",
            toolCall: {
              callId: "call-shell-1",
              name: "shell_command",
              input: "",
              output: " M src/main.ts",
              error: null,
              status: "completed"
            },
            timestamp: "2026-03-23T10:00:01.000Z",
            sequence: 2,
            rawRef: "codex://raw#line=2",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    expect(screen.getByText("shell_command")).toBeInTheDocument();
    expect(document.querySelectorAll(".tool-message-row")).toHaveLength(1);
    expect(screen.queryByText(t("conversation.toolStatusCompleted"))).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /shell_command/ }));

    expect(screen.getByText(t("conversation.toolInputLabel"))).toBeInTheDocument();
    expect(screen.getAllByText(t("conversation.toolResultLabel")).length).toBeGreaterThan(0);
    expect(screen.getAllByText((content) => content.includes("M src/main.ts")).length).toBeGreaterThan(0);
  });

  it("不依赖 provider，也会合并相邻的 claude 工具消息", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "tool-call-claude-1",
            sessionId: "session-1",
            role: "assistant",
            kind: "tool_call",
            content: "{\"command\":\"pwd\"}",
            toolCall: {
              callId: "call-claude-1",
              name: "shell_command",
              input: "{\"command\":\"pwd\"}",
              output: null,
              error: null,
              status: "running"
            },
            timestamp: "2026-03-23T10:00:00.000Z",
            sequence: 1,
            rawRef: "claude-code://raw#line=1",
            deliveryState: "sent",
            clientRequestId: null
          },
          {
            id: "tool-result-claude-1",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_result",
            content: "C:/Code/FamilyClaw",
            toolCall: {
              callId: "call-claude-1",
              name: "shell_command",
              input: "",
              output: "C:/Code/FamilyClaw",
              error: null,
              status: "completed"
            },
            timestamp: "2026-03-23T10:00:01.000Z",
            sequence: 2,
            rawRef: "claude-code://raw#line=2",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    expect(document.querySelectorAll(".tool-message-row")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: /shell_command/ }));

    expect(screen.getByText("C:/Code/FamilyClaw")).toBeInTheDocument();
  });

  it("会默认折叠 codex 会话里的规则消息，并允许手动展开", async () => {
    render(
      <MessageTimeline
        messages={[
          createTextMessage(`# AGENTS.md instructions for C:\\Code\\FamilyClaw

<INSTRUCTIONS>
不要主动启动开发服务器
</INSTRUCTIONS>`)
        ]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByText("AGENTS.md instructions for C:\\Code\\FamilyClaw")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /展开规则/ })).toBeInTheDocument();
    expect(screen.queryByText("不要主动启动开发服务器")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /展开规则/ }));

    expect(screen.getByRole("button", { name: /收起规则/ })).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("不要主动启动开发服务器"))).toBeInTheDocument();
  });

  it("不会折叠非 codex 会话里的同类文本", () => {
    render(
      <MessageTimeline
        messages={[
          createTextMessage(`# AGENTS.md instructions for C:\\Code\\FamilyClaw

<INSTRUCTIONS>
不要主动启动开发服务器
</INSTRUCTIONS>`)
        ]}
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByText((content) => content.includes("不要主动启动开发服务器"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /展开规则/ })).not.toBeInTheDocument();
  });

  it("会为缺失 toolCall 的工具消息做通用兜底", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "tool-result-legacy",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_result",
            content: "legacy tool output",
            toolCall: null,
            timestamp: "2026-03-23T10:00:02.000Z",
            sequence: 2,
            rawRef: "claude-code://raw#line=2",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    expect(screen.getByText("tool")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /tool/ }));

    expect(screen.getAllByText("legacy tool output").length).toBeGreaterThan(0);
  });

  it("滚到顶部时会触发加载更早消息", () => {
    const handleLoadOlderMessages = vi.fn();

    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        hasOlderMessages
        onLoadOlderMessages={handleLoadOlderMessages}
        onRetryMessage={vi.fn()}
        messages={Array.from({ length: 5 }, (_, index) => ({
          id: `message-${index + 1}`,
          sessionId: "session-1",
          role: "assistant",
          kind: "text",
          content: `message-${index + 1}`,
          toolCall: null,
          timestamp: `2026-03-23T10:0${index}:00.000Z`,
          sequence: index + 1,
          rawRef: `codex://raw#line=${index + 1}`,
          deliveryState: "sent",
          clientRequestId: null
        }))}
      />
    );

    const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(messageList).not.toBeNull();

    Object.defineProperty(messageList, "scrollHeight", {
      value: 1200,
      configurable: true
    });
    Object.defineProperty(messageList, "clientHeight", {
      value: 600,
      configurable: true
    });

    fireEvent.scroll(messageList!, {
      target: {
        scrollTop: 0
      }
    });

    expect(handleLoadOlderMessages).toHaveBeenCalledTimes(1);
  });

  it("会把交错返回的工具调用和结果按 callId 成对合并显示", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "tool-call-shell",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_call",
            content: "{\"command\":\"git status --short\"}",
            toolCall: {
              callId: "call-shell",
              name: "shell_command",
              input: "{\"command\":\"git status --short\"}",
              output: null,
              error: null,
              status: "running"
            },
            timestamp: "2026-03-23T10:00:00.000Z",
            sequence: 1,
            rawRef: "codex://raw#line=1",
            deliveryState: "sent",
            clientRequestId: null
          },
          {
            id: "tool-call-terminal",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_call",
            content: "{}",
            toolCall: {
              callId: "call-terminal",
              name: "read_thread_terminal",
              input: "{}",
              output: null,
              error: null,
              status: "running"
            },
            timestamp: "2026-03-23T10:00:01.000Z",
            sequence: 2,
            rawRef: "codex://raw#line=2",
            deliveryState: "sent",
            clientRequestId: null
          },
          {
            id: "tool-result-shell",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_result",
            content: " M src/main.ts",
            toolCall: {
              callId: "call-shell",
              name: "shell_command",
              input: "",
              output: " M src/main.ts",
              error: null,
              status: "completed"
            },
            timestamp: "2026-03-23T10:00:02.000Z",
            sequence: 3,
            rawRef: "codex://raw#line=3",
            deliveryState: "sent",
            clientRequestId: null
          },
          {
            id: "tool-result-terminal",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_result",
            content: "PS C:\\Code\\CodingNS>",
            toolCall: {
              callId: "call-terminal",
              name: "read_thread_terminal",
              input: "",
              output: "PS C:\\Code\\CodingNS>",
              error: null,
              status: "completed"
            },
            timestamp: "2026-03-23T10:00:03.000Z",
            sequence: 4,
            rawRef: "codex://raw#line=4",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    expect(document.querySelectorAll(".tool-message-row")).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: /shell_command/ }));
    expect(screen.getByText((content) => content.includes("M src/main.ts"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /read_thread_terminal/ }));
    expect(screen.getByText("PS C:\\Code\\CodingNS>")).toBeInTheDocument();
  });

  it("最后一条消息内容流式变化时会继续滚动到底部", () => {
    const { rerender } = render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "assistant-1",
            sessionId: "session-1",
            role: "assistant",
            kind: "text",
            content: "第一段",
            toolCall: null,
            timestamp: "2026-03-24T10:00:00.000Z",
            sequence: 1,
            rawRef: "codex://raw#line=1",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(messageList).not.toBeNull();

    Object.defineProperty(messageList, "scrollHeight", {
      value: 1200,
      configurable: true
    });
    Object.defineProperty(messageList, "clientHeight", {
      value: 600,
      configurable: true
    });

    messageList!.scrollTop = 1200;

    rerender(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "assistant-1",
            sessionId: "session-1",
            role: "assistant",
            kind: "text",
            content: "第一段\n第二段",
            toolCall: null,
            timestamp: "2026-03-24T10:00:00.000Z",
            sequence: 1,
            rawRef: "codex://raw#line=1",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    expect(messageList!.scrollTop).toBe(1200);
  });
  it("renders image thumbnail preview for pending image attachments", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "pending-image-message",
            sessionId: "session-1",
            role: "user",
            kind: "text",
            content: "check image",
            toolCall: null,
            attachments: [
              {
                id: "attachment-1",
                kind: "image",
                fileName: "sample.png",
                mimeType: "image/png",
                fileSize: 128
              }
            ],
            attachmentPayloads: [
              {
                fileName: "sample.png",
                mimeType: "image/png",
                fileSize: 128,
                contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII="
              }
            ],
            timestamp: "2026-03-23T10:00:02.000Z",
            sequence: 2,
            rawRef: "pending://image-1",
            deliveryState: "sending",
            clientRequestId: "image-1"
          }
        ]}
      />
    );

    const thumbnail = screen.getByAltText("sample.png");

    expect(thumbnail).toHaveAttribute("src", expect.stringContaining("data:image/png;base64,"));

    await userEvent.click(screen.getByRole("button", { name: /sample\.png/ }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("conversation.imagePreviewTitle") })).toBeInTheDocument();
    expect(screen.getAllByAltText("sample.png")).toHaveLength(2);
  });
});
