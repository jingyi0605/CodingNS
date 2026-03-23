import { render, screen } from "@testing-library/react";
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
  it("按统一抽象层渲染工具调用和结果", async () => {
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
    expect(screen.getByText(/shell_command \/ /)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /shell_command \/ / }));

    expect(screen.getAllByText((content) => content.includes("M src/main.ts")).length).toBeGreaterThan(0);
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
});
