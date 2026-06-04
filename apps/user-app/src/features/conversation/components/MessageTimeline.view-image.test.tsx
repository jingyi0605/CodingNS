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



describe("MessageTimeline view_image", () => {
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

  it("会把 codex 的 view_image 工具调用渲染成图片预览", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        workspaceId="workspace-1"
        workspacePath="/Users/jackson/Code/CodingNS"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "tool-call-view-image-1",
            callId: "call-view-image-1",
            name: "view_image",
            kind: "tool_call",
            content: JSON.stringify({
              path: "/Users/jackson/Code/CodingNS/apps/user-app/src/assets/menu.png"
            }),
            status: "running"
          })
        ]}
      />
    );

    expect(screen.getByText(t("conversation.toolViewImageActiveLabel"))).toBeInTheDocument();
    expect(screen.getByText("apps/user-app/src/assets/menu.png")).toBeInTheDocument();
    expect(getFilePreviewLinkMock).toHaveBeenCalledWith("workspace-1", "apps/user-app/src/assets/menu.png");

    const image = await screen.findByAltText("menu.png");
    expect(image.getAttribute("src")).toContain(
      "/preview/files/preview-token/apps/user-app/src/assets/menu.png"
    );
    expect(screen.queryByText(/^view_image$/)).not.toBeInTheDocument();
  });

  it("会把 view_image 的 office artifact 绝对路径转换成办公预览链接", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        workspaceId="workspace-1"
        workspacePath="/Users/jackson/Code/CodingNS"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "tool-call-view-image-office-artifact",
            callId: "call-view-image-office-artifact",
            name: "view_image",
            kind: "tool_call",
            content: JSON.stringify({
              path: "/Users/jackson/.codingns/office-artifacts/browser-task-1/12345678-1234-1234-1234-123456789abc-zhihu-qr.png"
            }),
            status: "running"
          })
        ]}
      />
    );

    expect(getOfficeArtifactPreviewLinkMock).toHaveBeenCalledWith("12345678-1234-1234-1234-123456789abc");
    expect(getFilePreviewLinkMock).not.toHaveBeenCalled();

    const image = await screen.findByAltText("12345678-1234-1234-1234-123456789abc-zhihu-qr.png");
    expect(image.getAttribute("src")).toContain(
      "/preview/office/artifacts/office-token/12345678-1234-1234-1234-123456789abc"
    );
  });

  it("会把 view_image 的 office task file 绝对路径转换成任务文件预览链接", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        workspaceId="workspace-1"
        workspacePath="/Users/jackson/Code/CodingNS"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "tool-call-view-image-office-task-file",
            callId: "call-view-image-office-task-file",
            name: "view_image",
            kind: "tool_call",
            content: JSON.stringify({
              path: "/Users/jackson/Code/CodingNS/apps/host/data/host/office-artifacts/73c79787-1e73-41af-86fd-9896ea050176/zhihu-qr-crop.png"
            }),
            status: "running"
          })
        ]}
      />
    );

    expect(getOfficeTaskFilePreviewLinkMock).toHaveBeenCalledWith(
      "73c79787-1e73-41af-86fd-9896ea050176",
      "zhihu-qr-crop.png"
    );
    expect(getFilePreviewLinkMock).not.toHaveBeenCalled();

    const image = await screen.findByAltText("zhihu-qr-crop.png");
    expect(image.getAttribute("src")).toContain(
      "/preview/office/tasks/office-task-token/73c79787-1e73-41af-86fd-9896ea050176/zhihu-qr-crop.png"
    );
  });

  it("遇到工作区外的 view_image 绝对路径时不会再请求普通文件预览接口", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        workspaceId="workspace-1"
        workspacePath="/Users/jackson/Code/CodingNS"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "tool-call-view-image-outside-workspace",
            callId: "call-view-image-outside-workspace",
            name: "view_image",
            kind: "tool_call",
            content: JSON.stringify({
              path: "/tmp/outside-workspace-preview.png"
            }),
            status: "running"
          })
        ]}
      />
    );

    expect(screen.getByText(t("conversation.toolViewImageActiveLabel"))).toBeInTheDocument();
    expect(screen.getByText("/tmp/outside-workspace-preview.png")).toBeInTheDocument();
    await waitFor(() => {
      expect(getFilePreviewLinkMock).not.toHaveBeenCalled();
      expect(getOfficeArtifactPreviewLinkMock).not.toHaveBeenCalled();
      expect(getOfficeTaskFilePreviewLinkMock).not.toHaveBeenCalled();
    });
  });

  it("会把 view_image 的会话附件绝对路径转换成附件内容预览", async () => {
    render(
      <MessageTimeline
        sessionId="session-1"
        historyState="ready"
        provider="codex"
        workspaceId="workspace-1"
        workspacePath="/Users/jackson/Code/CodingNS"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "tool-call-view-image-session-attachment",
            callId: "call-view-image-session-attachment",
            name: "view_image",
            kind: "tool_call",
            content: JSON.stringify({
              path: "/Users/jackson/.codingns/session-attachments/session-1/client-request-1/12345678-1234-1234-1234-123456789abc-image.png"
            }),
            status: "running"
          })
        ]}
      />
    );

    expect(getSessionAttachmentBlobMock).toHaveBeenCalledWith(
      "session-1",
      "12345678-1234-1234-1234-123456789abc"
    );
    expect(getFilePreviewLinkMock).not.toHaveBeenCalled();
    expect(getOfficeArtifactPreviewLinkMock).not.toHaveBeenCalled();
    expect(getOfficeTaskFilePreviewLinkMock).not.toHaveBeenCalled();

    const image = await screen.findByAltText("12345678-1234-1234-1234-123456789abc-image.png");
    expect(image.getAttribute("src")).toBe("blob:mock-session-attachment");
  });

  it("历史 view_image 指向旧会话附件时，优先使用路径里的真实 sessionId", async () => {
    render(
      <MessageTimeline
        sessionId="current-session"
        historyState="ready"
        provider="codex"
        workspaceId="workspace-1"
        workspacePath="/Users/jackson/Code/CodingNS"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "tool-call-view-image-history-session-attachment",
            callId: "call-view-image-history-session-attachment",
            name: "view_image",
            kind: "tool_call",
            content: JSON.stringify({
              path: "/Users/jackson/.codingns/session-attachments/ff44e87f-ee74-49ad-8270-68e242c5cd27/client-request-2/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-image.png"
            }),
            status: "running"
          })
        ]}
      />
    );

    expect(getSessionAttachmentBlobMock).toHaveBeenCalledWith(
      "ff44e87f-ee74-49ad-8270-68e242c5cd27",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    );
  });

  it("view_image 的 tool_result 里带内联图片时，直接显示 data url", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        workspaceId="workspace-1"
        workspacePath="/Users/jackson/Code/CodingNS"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "tool-result-view-image-inline",
            callId: "call-view-image-inline",
            name: "view_image",
            kind: "tool_result",
            content: JSON.stringify({
              type: "input_image",
              image_url: SAMPLE_IMAGE_DATA_URL
            }),
            toolInput: JSON.stringify({
              path: "/Users/jackson/.codingns/session-attachments/session-1/client-request-3/bbbbbbbb-cccc-4ddd-8eee-ffffffffffff-image.png"
            })
          })
        ]}
      />
    );

    const image = await screen.findByAltText("bbbbbbbb-cccc-4ddd-8eee-ffffffffffff-image.png");
    expect(image.getAttribute("src")).toBe(SAMPLE_IMAGE_DATA_URL);
    expect(getSessionAttachmentBlobMock).not.toHaveBeenCalled();
    expect(getFilePreviewLinkMock).not.toHaveBeenCalled();
    expect(getOfficeArtifactPreviewLinkMock).not.toHaveBeenCalled();
    expect(getOfficeTaskFilePreviewLinkMock).not.toHaveBeenCalled();
  });

  it("同一个 view_image 调用同时有 path 和 tool_result 内联图片时，优先显示内联图片", async () => {
    render(
      <MessageTimeline
        sessionId="current-session"
        historyState="ready"
        provider="codex"
        workspaceId="workspace-1"
        workspacePath="/Users/jackson/Code/CodingNS"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "tool-call-view-image-inline-priority",
            callId: "call-view-image-inline-priority",
            name: "view_image",
            kind: "tool_call",
            content: JSON.stringify({
              path: "/Users/jackson/.codingns/session-attachments/ff44e87f-ee74-49ad-8270-68e242c5cd27/client-request-2/cccccccc-dddd-4eee-8fff-111111111111-image.png"
            }),
            status: "running",
            sequence: 1
          }),
          createToolMessage({
            id: "tool-result-view-image-inline-priority",
            callId: "call-view-image-inline-priority",
            name: "view_image",
            kind: "tool_result",
            content: JSON.stringify({
              output: [
                {
                  type: "input_image",
                  image_url: SAMPLE_IMAGE_DATA_URL
                }
              ]
            }),
            toolInput: JSON.stringify({
              path: "/Users/jackson/.codingns/session-attachments/ff44e87f-ee74-49ad-8270-68e242c5cd27/client-request-2/cccccccc-dddd-4eee-8fff-111111111111-image.png"
            }),
            sequence: 2
          })
        ]}
      />
    );

    const image = await screen.findByAltText("cccccccc-dddd-4eee-8fff-111111111111-image.png");
    expect(image.getAttribute("src")).toBe(SAMPLE_IMAGE_DATA_URL);
    expect(getSessionAttachmentBlobMock).not.toHaveBeenCalled();
    expect(getFilePreviewLinkMock).not.toHaveBeenCalled();
  });

  it("历史 view_image 被其他工具消息打断时，也会回填同 callId 的最终图片结果", async () => {
    render(
      <MessageTimeline
        sessionId="31302177-e632-4155-a13d-f0a3367d2498"
        historyState="ready"
        provider="codex"
        workspaceId="workspace-1"
        workspacePath="/Users/jackson/Code/CodingNS"
        onRetryMessage={vi.fn()}
        messages={[
          createAssistantCliToolMessage({
            id: "shell-between-1",
            command: "rg -n \"host switch\" apps/user-app"
          }),
          createToolMessage({
            id: "view-image-call-separated",
            callId: "call-history-view-image-separated",
            name: "view_image",
            kind: "tool_call",
            content: JSON.stringify({
              path: "/Users/jackson/.codingns/session-attachments/31302177-e632-4155-a13d-f0a3367d2498/c068243d-1dc1-4ce3-bf73-60412fd5ddd9/0fec62fd-6f04-438c-8da5-065c56ab0426-image.png",
              detail: "original"
            }),
            status: "running",
            sequence: 2
          }),
          createAssistantCliToolMessage({
            id: "shell-between-2",
            command: "sed -n '1,220p' docs/开发设计规范/20260419-前端页面与样式设计规范.md"
          }),
          createToolMessage({
            id: "view-image-result-separated",
            callId: "call-history-view-image-separated",
            name: "view_image",
            kind: "tool_result",
            content: JSON.stringify({
              type: "input_image",
              image_url: SAMPLE_IMAGE_DATA_URL,
              detail: "original"
            }),
            toolInput: JSON.stringify({
              path: "/Users/jackson/.codingns/session-attachments/31302177-e632-4155-a13d-f0a3367d2498/c068243d-1dc1-4ce3-bf73-60412fd5ddd9/0fec62fd-6f04-438c-8da5-065c56ab0426-image.png",
              detail: "original"
            }),
            sequence: 4
          })
        ]}
      />
    );

    const images = await screen.findAllByAltText("0fec62fd-6f04-438c-8da5-065c56ab0426-image.png");
    expect(images[0]?.getAttribute("src")).toBe(SAMPLE_IMAGE_DATA_URL);
    expect(images[1]?.getAttribute("src")).toBe(SAMPLE_IMAGE_DATA_URL);
    expect(getSessionAttachmentBlobMock).not.toHaveBeenCalled();
  });
});
