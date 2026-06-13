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



describe("MessageTimeline structured question", () => {
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

  it("会把结构化问题渲染成可选择卡片并提交答案", async () => {
    const onSubmitStructuredQuestion = vi.fn().mockResolvedValue(undefined);

    render(
      <MessageTimeline
        messages={[
          createAssistantTextMessage(
            JSON.stringify({
              questions: [
                {
                  id: "file_name",
                  header: "文件名",
                  question: "你想把笑话保存到哪个文件名？",
                  options: [
                    {
                      label: "jokes.md",
                      description: "保存为 jokes.md"
                    },
                    {
                      label: "10-jokes.md",
                      description: "保存为 10-jokes.md"
                    }
                  ]
                }
              ]
            })
          )
        ]}
        historyState="ready"
        provider="opencode"
        onRetryMessage={vi.fn()}
        onSubmitStructuredQuestion={onSubmitStructuredQuestion}
      />
    );

    expect(screen.getByText("你想把笑话保存到哪个文件名？")).toBeInTheDocument();
    expect(screen.queryByText(/"questions"/)).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("radio")[0]!);
    await userEvent.click(screen.getByRole("button", { name: /confirm|确认|common\.confirm/i }));

    expect(onSubmitStructuredQuestion).toHaveBeenCalledWith({
      messageId: "assistant-1",
      answers: {
        file_name: ["jokes.md"]
      }
    });
  });

  it("会识别正文后面的 question 代码块并渲染成问题卡片", async () => {
    const onSubmitStructuredQuestion = vi.fn().mockResolvedValue(undefined);

    render(
      <MessageTimeline
        messages={[
          createAssistantTextMessage(`我有两个问题需要确认：

\`\`\`question
{
  "questions": [
    {
      "id": "spec_status",
      "question": "spec 目录下的 requirements.md 是否存在？",
      "header": "Spec 文件存在",
      "options": [
        {
          "label": "帮我创建",
          "description": "按模板先补齐"
        },
        {
          "label": "我有别的位置",
          "description": "告诉你路径"
        }
      ]
    }
  ]
}
\`\`\``)
        ]}
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        onSubmitStructuredQuestion={onSubmitStructuredQuestion}
      />
    );

    expect(screen.getByText("我有两个问题需要确认：")).toBeInTheDocument();
    expect(screen.getByText("spec 目录下的 requirements.md 是否存在？")).toBeInTheDocument();
    expect(screen.queryByText(/```question/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/"questions"/)).not.toBeInTheDocument();
  });

  it("会把 Claude AskUserQuestion 工具输入渲染成可选择的问题卡片", async () => {
    const onSubmitStructuredQuestion = vi.fn().mockResolvedValue(undefined);

    render(
      <MessageTimeline
        messages={[
          createToolMessage({
            id: "tool-ask-1",
            callId: "toolu-ask-1",
            name: "AskUserQuestion",
            kind: "tool_call",
            content: JSON.stringify({
              questions: [
                {
                  id: "language",
                  header: "编程语言",
                  question: "如果让你今天开始学习一门新的编程语言，你会选择哪一个？",
                  multiSelect: false,
                  options: [
                    {
                      label: "Python",
                      description: "简洁优雅，适合数据科学、AI 和自动化脚本"
                    },
                    {
                      label: "JavaScript/TypeScript",
                      description: "适合 Web 开发"
                    }
                  ]
                }
              ]
            }),
            toolInput: JSON.stringify({
              questions: [
                {
                  id: "language",
                  header: "编程语言",
                  question: "如果让你今天开始学习一门新的编程语言，你会选择哪一个？",
                  multiSelect: false,
                  options: [
                    {
                      label: "Python",
                      description: "简洁优雅，适合数据科学、AI 和自动化脚本"
                    },
                    {
                      label: "JavaScript/TypeScript",
                      description: "适合 Web 开发"
                    }
                  ]
                }
              ]
            })
          })
        ]}
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        onSubmitStructuredQuestion={onSubmitStructuredQuestion}
      />
    );

    expect(screen.getByText("如果让你今天开始学习一门新的编程语言，你会选择哪一个？")).toBeInTheDocument();
    expect(screen.queryByText(/"questions"/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: /Python/ }));
    await userEvent.click(screen.getByRole("button", { name: /confirm|确认|common\.confirm/i }));

    expect(onSubmitStructuredQuestion).toHaveBeenCalledWith({
      messageId: "tool-ask-1",
      answers: {
        language: ["Python"]
      }
    });
  });
});
