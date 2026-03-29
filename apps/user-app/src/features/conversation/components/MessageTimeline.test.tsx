import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { MessageTimeline } from "./MessageTimeline";

import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";

const SAMPLE_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=";
const SAMPLE_APPLY_PATCH_INPUT = `*** Begin Patch
*** Update File: C:/Code/CodingNS/apps/user-app/src/app/styles.css
@@
 .message-item {
   border: none;
   padding: 0;
   background: transparent;
   width: 100%;
+  gap: 8px;
 }
@@
 .user-message .message-content-wrapper {
   margin-left: auto;
+  width: fit-content;
   max-width: min(720px, calc(100vw - 220px));
-  padding: 10px 14px;
-  border-radius: 15px;
+  min-width: min(180px, 100%);
+  padding: 8px 12px;
+  border-radius: 14px;
   background:
     linear-gradient(180deg, color-mix(in srgb, var(--accent) 10%, var(--bg-surface)), color-mix(in srgb, var(--bg-primary) 96%, transparent));
   border-color: color-mix(in srgb, var(--accent) 16%, var(--border-primary));
 }
*** End Patch`;

const SAMPLE_DUPLICATE_APPLY_PATCH_INPUT = `*** Begin Patch
*** Update File: /Users/jackson/Code/CodingNS/apps/user-app/src/app/styles.css
@@
 .message-item {
+  gap: 8px;
 }
*** Update File: /Users/jackson/Code/CodingNS/apps/user-app/src/app/styles.css
@@
 .user-message {
+  width: 100%;
 }
*** End Patch`;

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

function createAssistantTextMessage(content: string, id = "assistant-1"): SessionMessageViewModel {
  return {
    id,
    sessionId: "session-1",
    role: "assistant",
    kind: "text",
    content,
    toolCall: null,
    timestamp: "2026-03-23T10:00:00.000Z",
    sequence: 1,
    rawRef: `codex://raw#line=${id}`,
    deliveryState: "sent",
    clientRequestId: null
  };
}

function createAssistantThinkingMessage(content: string, id = "thinking-1"): SessionMessageViewModel {
  return {
    id,
    sessionId: "session-1",
    role: "assistant",
    kind: "thinking",
    content,
    toolCall: null,
    timestamp: "2026-03-23T10:00:00.000Z",
    sequence: 1,
    rawRef: `codex://raw#line=${id}`,
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

    expect(screen.getByText(t("conversation.roleTool"))).toBeInTheDocument();
    expect(screen.getByText("命令：git status --short")).toBeInTheDocument();
    expect(document.querySelectorAll(".tool-message-row")).toHaveLength(1);
    expect(screen.queryByText(t("conversation.toolStatusCompleted"))).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${t("conversation.roleTool")}`) }));

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

    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${t("conversation.roleTool")}`) }));

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

  it("会把 thinking 消息和正式回复分开渲染", () => {
    render(
      <MessageTimeline
        messages={[
          createAssistantThinkingMessage("先把现有消息流和渲染层级看清楚。"),
          createAssistantTextMessage("我已经看完了，下面开始调整样式。", "assistant-2")
        ]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByText(t("conversation.thinkingLabel"))).toHaveClass("thinking-message-label");
    expect(screen.getByText("先把现有消息流和渲染层级看清楚。").closest(".thinking-message-text")).not.toBeNull();
    expect(screen.getByText("我已经看完了，下面开始调整样式。").closest(".thinking-message-text")).toBeNull();
    expect(document.querySelectorAll(".thinking-message-row")).toHaveLength(1);
  });

  it("会给代码块和 text 文本块渲染复制按钮", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText
      },
      configurable: true
    });

    render(
      <MessageTimeline
        messages={[
          createAssistantTextMessage("```ts\nconst answer = 42;\n```"),
          createAssistantTextMessage("```text\n优化工作区切换交互并补齐文件面板项目级联动\n```", "assistant-2")
        ]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    const copyButtons = screen.getAllByRole("button", { name: t("conversation.copyAction") });
    expect(copyButtons).toHaveLength(2);
    expect(document.querySelector(".text-code-block")).not.toBeNull();

    await userEvent.click(copyButtons[0]!);
    await userEvent.click(copyButtons[1]!);

    expect(writeText).toHaveBeenNthCalledWith(1, "const answer = 42;");
    expect(writeText).toHaveBeenNthCalledWith(2, "优化工作区切换交互并补齐文件面板项目级联动");
  });

  it("不会把行内反引号内容误判成代码块", () => {
    render(
      <MessageTimeline
        messages={[createAssistantTextMessage("在 `styles.css` 里，我把 `text` 类型块收紧了。")]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByText("styles.css")).toBeInTheDocument();
    expect(screen.getByText("text")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.copyAction") })).not.toBeInTheDocument();
    expect(document.querySelector(".code-block")).toBeNull();
  });

  it("用户消息和 AI 消息共用 markdown 内容样式类", () => {
    const { container } = render(
      <MessageTimeline
        messages={[
          createTextMessage("用户消息"),
          {
            ...createAssistantTextMessage("AI 消息", "assistant-2"),
            sequence: 2
          }
        ]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    const userContent = container.querySelector(".user-message .message-content");
    const assistantContent = container.querySelector(".assistant-message .message-content");

    expect(userContent?.classList.contains("markdown-content")).toBe(true);
    expect(assistantContent?.classList.contains("markdown-content")).toBe(true);
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

    expect(screen.getByText(t("conversation.roleTool"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${t("conversation.roleTool")}`) }));

    expect(screen.getAllByText("legacy tool output").length).toBeGreaterThan(0);
  });

  it("renders apply_patch as file summaries and opens a diff modal", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "tool-call-apply-patch",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_call",
            content: SAMPLE_APPLY_PATCH_INPUT,
            toolCall: {
              callId: "call-apply-patch",
              name: "apply_patch",
              input: SAMPLE_APPLY_PATCH_INPUT,
              output: null,
              error: null,
              status: "running"
            },
            timestamp: "2026-03-23T10:00:02.000Z",
            sequence: 2,
            rawRef: "codex://raw#line=2",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    expect(screen.queryByText(/^apply_patch$/)).not.toBeInTheDocument();
    expect(screen.getByText("已编辑")).toBeInTheDocument();
    expect(screen.getByText("styles.css")).toBeInTheDocument();
    expect(screen.getAllByText("+5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-2").length).toBeGreaterThan(0);
    expect(screen.queryByText("*** Begin Patch")).not.toBeInTheDocument();
    expect(document.querySelector(".apply-patch-header")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /styles\.css/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.querySelector(".message-list .apply-patch-modal")).toBeNull();
    expect(document.body.querySelector(".apply-patch-modal")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Patch 变更预览" })).toBeInTheDocument();
    expect(screen.getByText("C:/Code/CodingNS/apps/user-app/src/app/styles.css")).toBeInTheDocument();
    const diffViewText = document.querySelector(".apply-patch-diff-view")?.textContent ?? "";
    expect(diffViewText).toContain("+  gap: 8px;");
    expect(diffViewText).toContain("-  padding: 10px 14px;");
  });

  it("同一文件出现多个 patch 段时不会因为重复 key 报警", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <MessageTimeline
          historyState="ready"
          provider="codex"
          onRetryMessage={vi.fn()}
          messages={[
            {
              id: "tool-call-duplicate-apply-patch",
              sessionId: "session-1",
              role: "tool",
              kind: "tool_call",
              content: SAMPLE_DUPLICATE_APPLY_PATCH_INPUT,
              toolCall: {
                callId: "call-duplicate-apply-patch",
                name: "apply_patch",
                input: SAMPLE_DUPLICATE_APPLY_PATCH_INPUT,
                output: null,
                error: null,
                status: "running"
              },
              timestamp: "2026-03-23T10:00:02.000Z",
              sequence: 2,
              rawRef: "codex://raw#line=duplicate-apply-patch",
              deliveryState: "sent",
              clientRequestId: null
            }
          ]}
        />
      );

      const duplicateKeyCalls = consoleErrorSpy.mock.calls.filter(
        ([firstArg]) =>
          typeof firstArg === "string" && firstArg.includes("Encountered two children with the same key")
      );

      expect(screen.getAllByRole("button", { name: /styles\.css/i })).toHaveLength(2);
      expect(duplicateKeyCalls).toHaveLength(0);
    } finally {
      consoleErrorSpy.mockRestore();
    }
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

    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${t("conversation.roleTool")}`) }));
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

  it("renders inline base64 images in content as thumbnails instead of raw text", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "assistant-inline-image",
            sessionId: "session-1",
            role: "assistant",
            kind: "text",
            content: JSON.stringify([
              {
                type: "output_text",
                text: "请看这张图"
              },
              {
                type: "output_image",
                image_url: SAMPLE_IMAGE_DATA_URL
              }
            ]),
            toolCall: null,
            timestamp: "2026-03-23T10:00:03.000Z",
            sequence: 3,
            rawRef: "codex://raw#line=3",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    expect(screen.getByText("请看这张图")).toBeInTheDocument();
    expect(screen.queryByText(/data:image\/png;base64/i)).not.toBeInTheDocument();
    expect(screen.queryByText("图片附件 1")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".message-attachment-thumbnail")).toHaveLength(1);

    const attachmentButton = document.querySelector(".message-attachment-button") as HTMLButtonElement | null;
    expect(attachmentButton).not.toBeNull();

    await userEvent.click(attachmentButton!);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("conversation.imagePreviewTitle") })).toBeInTheDocument();
  });

  it("renders claude structured base64 images as thumbnails instead of raw metadata text", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "assistant-claude-inline-image",
            sessionId: "session-1",
            role: "assistant",
            kind: "text",
            content: JSON.stringify([
              {
                type: "text",
                text: "请看这张图"
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: SAMPLE_IMAGE_DATA_URL.replace(/^data:image\/png;base64,/, "")
                }
              }
            ]),
            toolCall: null,
            timestamp: "2026-03-23T10:00:04.000Z",
            sequence: 4,
            rawRef: "claude-code://raw#line=4",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    expect(screen.getByText("请看这张图")).toBeInTheDocument();
    expect(screen.queryByText(/^image$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^base64$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^image\/png$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/iVBORw0KGgo/i)).not.toBeInTheDocument();
    expect(screen.queryByText("图片附件 1")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".message-attachment-thumbnail")).toHaveLength(1);

    const attachmentButton = document.querySelector(".message-attachment-button") as HTMLButtonElement | null;
    expect(attachmentButton).not.toBeNull();

    await userEvent.click(attachmentButton!);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("conversation.imagePreviewTitle") })).toBeInTheDocument();
  });

  it("removes custom image metadata blocks from visible text", () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "assistant-image-metadata",
            sessionId: "session-1",
            role: "assistant",
            kind: "text",
            content:
              '<image name=[Image #1]> { "type": "input_image", "image_url": "" } </image>\n确保主题切换容器里面的主题按钮横向铺满，不要出现仅在左侧出现导致换行的情况',
            toolCall: null,
            attachments: [
              {
                id: "attachment-1",
                kind: "image",
                fileName: "图片附件 1",
                mimeType: "image/png",
                fileSize: 114100
              }
            ],
            timestamp: "2026-03-23T10:00:03.000Z",
            sequence: 3,
            rawRef: "codex://raw#line=3",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    expect(screen.getByText("确保主题切换容器里面的主题按钮横向铺满，不要出现仅在左侧出现导致换行的情况")).toBeInTheDocument();
    expect(screen.queryByText(/<image name=\[Image #1\]>/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/"type": "input_image"/i)).not.toBeInTheDocument();
    expect(screen.queryByText("图片附件 1")).not.toBeInTheDocument();
  });
});
