import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import {
  buildConversationTimelineSourceItems,
  type ConversationTimelineSourceItem
} from "../timeline-source-items";
import { MessageTimeline as RawMessageTimeline } from "./MessageTimeline";

import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";

type LegacyMessageTimelineProps = Omit<ComponentProps<typeof RawMessageTimeline>, "items"> & {
  items?: ConversationTimelineSourceItem[];
  messages?: SessionMessageViewModel[];
  runtimeThinkingPlaceholder?: string | null;
  sessionRunningState?: Parameters<typeof buildConversationTimelineSourceItems>[0]["sessionRunningState"];
  sessionSyncStatus?: Parameters<typeof buildConversationTimelineSourceItems>[0]["sessionSyncStatus"];
  sessionLastErrorCode?: string | null;
  sessionLastErrorDetail?: string | null;
};

function MessageTimeline({
  items,
  messages = [],
  runtimeThinkingPlaceholder = null,
  sessionRunningState = null,
  sessionSyncStatus = null,
  sessionLastErrorCode = null,
  sessionLastErrorDetail = null,
  ...rest
}: LegacyMessageTimelineProps) {
  const normalizedItems = items ?? buildConversationTimelineSourceItems({
    messages,
    runtimeThinkingPlaceholder,
    sessionRunningState,
    sessionSyncStatus,
    sessionLastErrorCode,
    sessionLastErrorDetail
  });

  return <RawMessageTimeline {...rest} items={normalizedItems} />;
}

const revealWorkspaceFileMock = vi.hoisted(() => vi.fn(() => false));
const getButlerFollowUpTaskMock = vi.hoisted(() => vi.fn());
const getFilePreviewLinkMock = vi.hoisted(() => vi.fn());
const getOfficeArtifactPreviewLinkMock = vi.hoisted(() => vi.fn());
const getOfficeTaskFilePreviewLinkMock = vi.hoisted(() => vi.fn());
const getSessionAttachmentBlobMock = vi.hoisted(() => vi.fn());

vi.mock("./WorkbenchLayout", () => ({
  useWorkbenchShell: () => ({
    navigationGroups: [
      {
        workspace: {
          id: "workspace-1",
          name: "CodingNS",
          path: "/Users/jackson/Code/CodingNS",
          repoRoot: "/Users/jackson/Code/CodingNS"
        },
        sessions: [
          {
            sessionId: "session-1",
            title: "登录页开发"
          }
        ]
      }
    ],
    currentWorkspaceId: "workspace-1",
    revealWorkspaceFile: revealWorkspaceFileMock
  })
}));

vi.mock("../../butler/api/butler-api", () => ({
  getButlerFollowUpTask: getButlerFollowUpTaskMock
}));

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>("../api/conversation-api");
  return {
    ...actual,
    getSessionAttachmentBlob: getSessionAttachmentBlobMock
  };
});

vi.mock("../api/file-context-api", () => ({
  getFilePreviewLink: getFilePreviewLinkMock,
  getOfficeArtifactPreviewLink: getOfficeArtifactPreviewLinkMock,
  getOfficeTaskFilePreviewLink: getOfficeTaskFilePreviewLinkMock
}));

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

const SAMPLE_LOOSE_APPLY_PATCH_INPUT = `@@ -398,3 +398,2 @@
+// 先把基础记录建出来，再回放 runtime 缓存事件，避免超快启动时出现
+// “事件先到、索引还没落库”的竞态窗口。
-this.attachRuntimePersistence(handle, sessionId, workspace.id, input.userId);
+this.attachRuntimePersistence(handle, sessionId, workspace.id, input.userId);`;

const SAMPLE_LOOSE_APPLY_PATCH_OUTPUT = JSON.stringify({
  output:
    "Success. Updated the following files:\nM /Users/jackson/Code/CodingNS/apps/host/src/modules/sessions/session-live-runtime-service.ts\n",
  metadata: {
    exit_code: 0,
    duration_seconds: 0
  }
});

const SAMPLE_FILE_ONLY_APPLY_PATCH_INPUT = `*** Begin Patch
*** Update File: /Users/jackson/Code/CodingNS/apps/host/src/modules/sessions/butler-session-service.ts
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

function createButlerProxyTextMessage(content: string): SessionMessageViewModel {
  return {
    ...createTextMessage(content),
    id: "message-butler-1",
    clientRequestId: null,
    origin: "butler_proxy",
    originRef: "follow-up-1"
  };
}

function createAssistantProxyTextMessage(content: string): SessionMessageViewModel {
  return {
    ...createTextMessage(content),
    id: "message-butler-2",
    clientRequestId: null,
    origin: "butler_proxy",
    originRef: null
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

function createSystemMessage(content: string, id = "system-1"): SessionMessageViewModel {
  return {
    id,
    sessionId: "session-1",
    role: "system",
    kind: "text",
    content,
    toolCall: null,
    timestamp: "2026-04-08T10:00:00.000Z",
    sequence: 1,
    rawRef: `kimi://session/session-1/context#line=${id}`,
    deliveryState: "sent",
    clientRequestId: null
  };
}

function createToolMessage(input: {
  id: string;
  callId: string;
  name: string;
  kind: "tool_call" | "tool_result";
  content: string;
  toolInput?: string;
  toolOutput?: string | null;
  toolError?: string | null;
  status?: "running" | "completed" | "failed";
  sequence?: number;
  rawRef?: string;
  timestamp?: string;
}): SessionMessageViewModel {
  return {
    id: input.id,
    sessionId: "session-1",
    role: "tool",
    kind: input.kind,
    content: input.content,
    toolCall: {
      callId: input.callId,
      name: input.name,
      input: input.toolInput ?? (input.kind === "tool_call" ? input.content : ""),
      output: input.toolOutput ?? (input.kind === "tool_result" ? input.content : null),
      error: input.toolError ?? null,
      status: input.status ?? (input.kind === "tool_result" ? "completed" : "running")
    },
    timestamp: input.timestamp ?? "2026-04-13T10:00:00.000Z",
    sequence: input.sequence ?? 1,
    rawRef: input.rawRef ?? `codex://raw#line=${input.id}`,
    deliveryState: "sent",
    clientRequestId: null
  };
}

function createAssistantCapabilityReceiptMessage(input: {
  id: string;
  capability: string;
  payload: Record<string, unknown>;
  targetRef?: {
    kind: string;
    id: string | null;
  };
}): SessionMessageViewModel {
  const receipt = {
    ok: true,
    capability: input.capability,
    auditId: `${input.id}-audit`,
    timestamp: "2026-04-16T12:00:00.000Z",
    targetRef: input.targetRef ?? {
      kind: "none",
      id: null
    },
    payload: input.payload
  };

  return createToolMessage({
    id: input.id,
    callId: `${input.id}-call`,
    name: "assistant_capability",
    kind: "tool_result",
    content: JSON.stringify(receipt, null, 2),
    toolOutput: JSON.stringify(receipt, null, 2)
  });
}

function createAssistantCliToolMessage(input: {
  id: string;
  command: string;
  output?: string | null;
  kind?: "tool_call" | "tool_result";
}): SessionMessageViewModel {
  return createToolMessage({
    id: input.id,
    callId: `${input.id}-call`,
    name: "shell_command",
    kind: input.kind ?? "tool_call",
    content: JSON.stringify({
      command: input.command
    }),
    toolInput: JSON.stringify({
      command: input.command
    }),
    toolOutput: input.output ?? null,
    status: input.kind === "tool_result" ? "completed" : "running"
  });
}



describe("MessageTimeline apply patch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    revealWorkspaceFileMock.mockReset();
    revealWorkspaceFileMock.mockReturnValue(false);
    getButlerFollowUpTaskMock.mockReset();
    getButlerFollowUpTaskMock.mockResolvedValue({
      task: {
        id: "follow-up-1",
        projectId: "project-1",
        projectName: "项目甲",
        workspaceId: "workspace-1",
        butlerSessionId: "butler-session-1",
        sessionId: "session-1",
        sessionTitle: "登录页开发",
        objective: "完成当前 spec 的必做项",
        status: "waiting_user",
        checkIntervalSeconds: 300,
        lastCheckedAt: null,
        nextCheckAt: null,
        lastObservedRunningState: "completed",
        lastObservedMessageAt: null,
        lastObservedMessageCount: 12,
        lastAutomationSummary: "当前需要你确认验证码失败策略。",
        lastAutomationAt: null,
        autoContinueCount: 1,
        waitingReason: "需要你确认失败策略。",
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:05:00.000Z",
        completedAt: null
      }
    });
    getFilePreviewLinkMock.mockReset();
    getFilePreviewLinkMock.mockResolvedValue({
      previewPath: "/preview/files/preview-token/apps/user-app/src/assets/menu.png",
      previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/apps/user-app/src/assets/menu.png",
      expiresAt: "2026-04-13T10:05:00.000Z"
    });
    getOfficeArtifactPreviewLinkMock.mockReset();
    getOfficeArtifactPreviewLinkMock.mockResolvedValue({
      previewPath: "/preview/office/artifacts/office-token/12345678-1234-1234-1234-123456789abc",
      previewUrl: "http://localhost:3000/preview/office/artifacts/office-token/12345678-1234-1234-1234-123456789abc",
      expiresAt: "2026-04-13T10:05:00.000Z"
    });
    getOfficeTaskFilePreviewLinkMock.mockReset();
    getOfficeTaskFilePreviewLinkMock.mockResolvedValue({
      previewPath: "/preview/office/tasks/office-task-token/73c79787-1e73-41af-86fd-9896ea050176/zhihu-qr-crop.png",
      previewUrl: "http://localhost:3000/preview/office/tasks/office-task-token/73c79787-1e73-41af-86fd-9896ea050176/zhihu-qr-crop.png",
      expiresAt: "2026-04-13T10:05:00.000Z"
    });
    getSessionAttachmentBlobMock.mockReset();
    getSessionAttachmentBlobMock.mockResolvedValue(
      new Blob(["mock-session-attachment"], {
        type: "image/png"
      })
    );
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:mock-session-attachment")
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
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
    expect(document.querySelectorAll(".apply-patch-summary-row")).toHaveLength(1);
    expect(screen.getByText("styles.css")).toBeInTheDocument();
    expect(screen.getAllByText("+5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-2").length).toBeGreaterThan(0);
    expect(screen.queryByText("*** Begin Patch")).not.toBeInTheDocument();
    expect(document.querySelector(".apply-patch-header")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /styles\.css/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.querySelector(".message-list .apply-patch-modal")).toBeNull();
    expect(document.body.querySelector(".apply-patch-modal")).not.toBeNull();
    expect(screen.getByRole("heading", { name: t("conversation.applyPatchDialogTitle") })).toBeInTheDocument();
    expect(screen.getByText("C:/Code/CodingNS/apps/user-app/src/app/styles.css")).toBeInTheDocument();
    const diffViewText = document.querySelector(".apply-patch-diff-view")?.textContent ?? "";
    expect(diffViewText).toContain("+  gap: 8px;");
    expect(diffViewText).toContain("-  padding: 10px 14px;");
  });

  it("遇到裸 hunk 的 apply_patch 也会回退成编辑摘要", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "tool-result-loose-apply-patch",
            callId: "call-loose-apply-patch",
            name: "apply_patch",
            kind: "tool_result",
            content: SAMPLE_LOOSE_APPLY_PATCH_OUTPUT,
            toolInput: SAMPLE_LOOSE_APPLY_PATCH_INPUT,
            toolOutput: SAMPLE_LOOSE_APPLY_PATCH_OUTPUT,
            status: "completed"
          })
        ]}
      />
    );

    expect(screen.queryByText(/^apply_patch$/)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".apply-patch-summary-row")).toHaveLength(1);
    expect(screen.getByText("session-live-runtime-service.ts")).toBeInTheDocument();
    expect(screen.queryByText("@@ -398,3 +398,2 @@")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /session-live-runtime-service\.ts/i }));

    const diffViewText = document.querySelector(".apply-patch-diff-view")?.textContent ?? "";
    expect(diffViewText).toContain("+// 先把基础记录建出来，再回放 runtime 缓存事件");
    expect(diffViewText).toContain("-this.attachRuntimePersistence(handle, sessionId, workspace.id, input.userId);");
  });

  it("只有文件路径没有真实 diff 的 apply_patch 只显示已编辑", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "tool-result-file-only-apply-patch",
            callId: "call-file-only-apply-patch",
            name: "apply_patch",
            kind: "tool_result",
            content: SAMPLE_FILE_ONLY_APPLY_PATCH_INPUT,
            toolInput: SAMPLE_FILE_ONLY_APPLY_PATCH_INPUT,
            toolOutput: SAMPLE_FILE_ONLY_APPLY_PATCH_INPUT,
            status: "completed"
          })
        ]}
      />
    );

    expect(screen.getByText("butler-session-service.ts")).toBeInTheDocument();
    expect(screen.getAllByText(t("conversation.applyPatchEditedStat")).length).toBeGreaterThan(0);
    expect(screen.queryByText("+0")).not.toBeInTheDocument();
    expect(screen.queryByText("-0")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /butler-session-service\.ts/i }));

    expect(screen.getAllByText(t("conversation.applyPatchEditedStat")).length).toBeGreaterThan(1);
    expect(screen.queryByText("+0")).not.toBeInTheDocument();
    expect(screen.queryByText("-0")).not.toBeInTheDocument();
  });

  it("renders Claude Write tool with the same edit-style preview", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "tool-call-write-1",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_call",
            content: "{\"file_path\":\"C:/Code/CodingNS/novel.md\",\"content\":\"第一行\\n第二行\"}",
            toolCall: {
              callId: "call-write-1",
              name: "Write",
              input: "{\"file_path\":\"C:/Code/CodingNS/novel.md\",\"content\":\"第一行\\n第二行\"}",
              output: null,
              error: null,
              status: "running"
            },
            timestamp: "2026-03-23T10:00:00.000Z",
            sequence: 1,
            rawRef: "claude-code://raw#line=1",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    expect(screen.queryByText(/^Write$/)).not.toBeInTheDocument();
    expect(screen.getByText("novel.md")).toBeInTheDocument();
    expect(document.querySelectorAll(".apply-patch-summary-row")).toHaveLength(1);
  });

  it("renders OpenCode lowercase write tool with the same edit-style preview", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="opencode"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "tool-call-write-lowercase-1",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_call",
            content: "{\"path\":\"C:/Code/CodingNS/notes.md\",\"content\":\"第一行\\n第二行\\n第三行\"}",
            toolCall: {
              callId: "call-write-lowercase-1",
              name: "write",
              input: "{\"path\":\"C:/Code/CodingNS/notes.md\",\"content\":\"第一行\\n第二行\\n第三行\"}",
              output: null,
              error: null,
              status: "running"
            },
            timestamp: "2026-03-23T10:00:00.000Z",
            sequence: 1,
            rawRef: "opencode://session/thread-1/message/msg-1/part/tool-1",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    expect(screen.queryByText(/^write$/)).not.toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(document.querySelectorAll(".apply-patch-summary-row")).toHaveLength(1);
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
});
