import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import {
  buildConversationTimelineSourceItems,
  type ConversationTimelineSourceItem
} from "../timeline-source-items";
import type { HistoryMessageDto } from "../api/conversation-api";
import { toViewMessage } from "../runtime/session-runtime-machine";
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

describe("MessageTimeline", () => {
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

  it("点击行内蓝色代码会直接复制内容", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText
      },
      configurable: true
    });

    render(
      <MessageTimeline
        messages={[createAssistantTextMessage("把 `inline-flex` 改成可收缩布局。")]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    await userEvent.click(screen.getByText("inline-flex"));

    expect(writeText).toHaveBeenCalledWith("inline-flex");
    expect(revealWorkspaceFileMock).not.toHaveBeenCalled();
  });

  it("不渲染没有正文或附件的助手文本消息", () => {
    render(
      <MessageTimeline
        messages={[
          createTextMessage("对话测试"),
          createAssistantTextMessage("", "assistant-empty"),
          createAssistantTextMessage("正常回复", "assistant-response")
        ]}
        historyState="ready"
        provider="deepseek-harness"
        onRetryMessage={vi.fn()}
      />
    );

    expect(document.querySelector('[data-message-id="assistant-empty"]')).toBeNull();
    expect(document.querySelector('[data-message-id="assistant-response"]')?.textContent).toContain("正常回复");
  });

  it("会把 office-artifacts 本地图片路径映射成受控预览地址", async () => {
    render(
      <MessageTimeline
        messages={[
          createAssistantTextMessage(
            "![知乎扫码二维码](/Users/jackson/.codingns/office-artifacts/browser-task-1/12345678-1234-1234-1234-123456789abc-zhihu-qr.png)"
          )
        ]}
        historyState="ready"
        onRetryMessage={vi.fn()}
        provider="codex"
      />
    );

    const image = await screen.findByAltText("知乎扫码二维码");
    await waitFor(() => {
      expect(screen.getByAltText("知乎扫码二维码").getAttribute("src")).toBe(
        "http://localhost:3000/preview/office/artifacts/office-token/12345678-1234-1234-1234-123456789abc"
      );
    });
    expect(getOfficeArtifactPreviewLinkMock).toHaveBeenCalledWith("12345678-1234-1234-1234-123456789abc");
    expect(getFilePreviewLinkMock).not.toHaveBeenCalled();
  });

  it("会把 office-artifacts 目录里的手工裁图文件映射成任务文件受控地址", async () => {
    render(
      <MessageTimeline
        messages={[
          createAssistantTextMessage(
            "![知乎扫码二维码](/Users/jackson/Code/CodingNS/apps/host/data/host/office-artifacts/73c79787-1e73-41af-86fd-9896ea050176/zhihu-qr-crop.png)"
          )
        ]}
        historyState="ready"
        onRetryMessage={vi.fn()}
        provider="codex"
      />
    );

    const image = await screen.findByAltText("知乎扫码二维码");
    await waitFor(() => {
      expect(screen.getByAltText("知乎扫码二维码").getAttribute("src")).toBe(
        "http://localhost:3000/preview/office/tasks/office-task-token/73c79787-1e73-41af-86fd-9896ea050176/zhihu-qr-crop.png"
      );
    });
    expect(getOfficeTaskFilePreviewLinkMock).toHaveBeenCalledWith(
      "73c79787-1e73-41af-86fd-9896ea050176",
      "zhihu-qr-crop.png"
    );
    expect(getFilePreviewLinkMock).not.toHaveBeenCalled();
  });

  it("会把 turn_aborted 控制标记渲染成手动终止的助手消息", () => {
    render(
      <MessageTimeline
        messages={[createAssistantTextMessage("<turn_aborted>previous turn aborted</turn_aborted>")]}
        historyState="ready"
        onRetryMessage={vi.fn()}
        provider="codex"
        interruptedSource="user"
      />
    );

    expect(screen.getByText(t("conversation.turnAbortedUser"))).toBeInTheDocument();
    expect(screen.queryByText("<turn_aborted>previous turn aborted</turn_aborted>")).not.toBeInTheDocument();
    expect(screen.queryByText("previous turn aborted")).not.toBeInTheDocument();
  });

  it("会把 turn_aborted 控制标记渲染成意外中断的助手消息", () => {
    render(
      <MessageTimeline
        messages={[createAssistantTextMessage("<turn_aborted>previous turn aborted</turn_aborted>")]}
        historyState="ready"
        onRetryMessage={vi.fn()}
        provider="codex"
        interruptedSource="runtime"
      />
    );

    expect(screen.getByText(t("conversation.turnAbortedUnexpected"))).toBeInTheDocument();
    expect(screen.queryByText("<turn_aborted>previous turn aborted</turn_aborted>")).not.toBeInTheDocument();
  });

  it("会在消息列表底部格式化显示会话错误，而不是把错误混进消息正文", () => {
    render(
      <MessageTimeline
        items={buildConversationTimelineSourceItems({
          messages: [createAssistantTextMessage("已经收到你的请求。")],
          sessionRunningState: "failed",
          sessionSyncStatus: "error",
          sessionLastErrorCode: "CODEX_HTTP_429",
          sessionLastErrorDetail: "429 Too Many Requests, request id: demo-request-id"
        })}
        historyState="ready"
        onRetryMessage={vi.fn()}
        provider="codex"
      />
    );

    expect(screen.getByText(t("conversation.runtimeErrorTitle"))).toBeInTheDocument();
    expect(document.querySelector(".session-runtime-error-row.message-item.assistant-message")).not.toBeNull();
    expect(document.querySelector(".session-runtime-error-panel__summary")?.textContent).toBe(
      "429 Too Many Requests, request id: demo-request-id"
    );
    expect(screen.getByText("CODEX_HTTP_429")).toHaveClass("session-runtime-error-panel__code");
    expect(screen.queryByText(t("conversation.runtimeErrorCodeLabel"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("conversation.runtimeErrorDetailLabel"))).not.toBeInTheDocument();
    expect(screen.getByText("429 Too Many Requests")).toHaveClass(
      "session-runtime-error-panel__summary-token--status_code"
    );
    expect(screen.getByText("request id: demo-request-id")).toHaveClass(
      "session-runtime-error-panel__summary-token--request_id"
    );
  });

  it("会把 Codex 历史里的 user turn_aborted 控制标记也渲染成助手消息", () => {
    render(
      <MessageTimeline
        messages={[createTextMessage("<turn_aborted>previous turn aborted</turn_aborted>")]}
        historyState="ready"
        onRetryMessage={vi.fn()}
        provider="codex"
        interruptedSource="user"
      />
    );

    expect(screen.getByText(t("conversation.turnAbortedUser"))).toBeInTheDocument();
    expect(screen.queryByText("<turn_aborted>previous turn aborted</turn_aborted>")).not.toBeInTheDocument();
    expect(screen.queryByText("previous turn aborted")).not.toBeInTheDocument();
  });

  it("用户已经继续发送下一条后，不再重复渲染旧的 turn_aborted 提示", () => {
    render(
      <MessageTimeline
        messages={[
          createTextMessage("3个吧"),
          createAssistantTextMessage("<turn_aborted>previous turn aborted</turn_aborted>")
        ]}
        historyState="ready"
        onRetryMessage={vi.fn()}
        provider="codex"
        interruptedSource="user"
      />
    );

    expect(screen.getByText("3个吧")).toBeInTheDocument();
    expect(screen.queryByText(t("conversation.turnAbortedUser"))).not.toBeInTheDocument();
    expect(screen.queryByText("previous turn aborted")).not.toBeInTheDocument();
  });

  it("fork 子会话的可见时间线只在组件内部按继承边界裁剪一次", () => {
    render(
      <MessageTimeline
        sessionSummary={{
          sessionId: "session-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "raw-1",
          rawStoreRef: "codex://raw-1",
          title: "fork 子会话",
          messageCount: 4,
          lastMessageAt: "2026-05-06T10:00:03.000Z",
          createdAt: "2026-05-06T10:00:02.000Z",
          updatedAt: "2026-05-06T10:00:03.000Z",
          syncStatus: "idle",
          syncCursor: "cursor-1",
          lastSyncAt: "2026-05-06T10:00:03.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "idle",
          activitySource: "none",
          lastEventAt: "2026-05-06T10:00:03.000Z",
          completedAt: null,
          lastSeenAt: null,
          activityState: "idle",
          forkSourceType: "message",
          inheritedPrefixMessageCount: 2
        }}
        messages={[
          {
            ...createTextMessage("继承的用户前缀"),
            id: "fork-user-prefix-1",
            sequence: 1,
            timestamp: "2026-05-06T10:00:00.000Z",
            rawRef: "codex://raw#line=1"
          },
          {
            ...createAssistantTextMessage("继承的助手前缀", "fork-assistant-prefix-1"),
            sequence: 2,
            timestamp: "2026-05-06T10:00:01.000Z",
            rawRef: "codex://raw#line=2"
          },
          {
            ...createAssistantTextMessage("不该留在子会话里的旧尾巴", "fork-stale-tail-1"),
            sequence: 3,
            timestamp: "2026-05-06T10:00:01.500Z",
            rawRef: "codex://raw#line=3"
          },
          {
            ...createTextMessage("子会话里的新用户消息"),
            id: "fork-user-child-1",
            sequence: 4,
            timestamp: "2026-05-06T10:00:03.000Z",
            rawRef: "codex://raw#line=4"
          }
        ]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    const timelineItems = Array.from(document.querySelectorAll(".message-item[data-message-id]"));
    expect(timelineItems.map((item) => item.getAttribute("data-message-id"))).toEqual([
      "fork-user-prefix-1",
      "fork-assistant-prefix-1",
      "fork-user-child-1"
    ]);
    expect(screen.queryByText("不该留在子会话里的旧尾巴")).not.toBeInTheDocument();
  });

  it("用户消息下方只显示复制按钮并复制正文", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText
      },
      configurable: true
    });

    render(
      <MessageTimeline
        messages={[createAssistantTextMessage("把登录按钮改成次要操作。", "assistant-copy-1")]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: t("conversation.copyAction") }));

    expect(writeText).toHaveBeenCalledWith("把登录按钮改成次要操作。");
    expect(screen.queryByRole("button", { name: t("conversation.forkFromHereAction") })).not.toBeInTheDocument();
  });

  it("AI 消息只在当前回复结尾显示一组复制和 fork 按钮", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText
      },
      configurable: true
    });
    const onForkMessage = vi.fn().mockResolvedValue(undefined);

    render(
      <MessageTimeline
        messages={[
          createAssistantThinkingMessage("先整理一下分叉点。", "assistant-thinking-1"),
          createAssistantTextMessage("从这里继续拆分实现。", "assistant-fork-1")
        ]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        onForkMessage={onForkMessage}
      />
    );

    expect(screen.getAllByRole("button", { name: t("conversation.copyAction") })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: t("conversation.forkFromHereAction") })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: t("conversation.copyAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.forkFromHereAction") }));

    expect(writeText).toHaveBeenCalledWith("从这里继续拆分实现。");
    expect(onForkMessage).toHaveBeenCalledTimes(1);
    expect(onForkMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "assistant-fork-1",
        content: "从这里继续拆分实现。"
      })
    );
  });

  it("会给 Butler 代理发送的用户消息显示来源标签", () => {
    render(
      <MessageTimeline
        messages={[createButlerProxyTextMessage("继续完成当前 spec 的剩余工作。")]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByText(t("conversation.butlerProxyMessageBadge"))).toBeInTheDocument();
  });

  it("点击代理发送标签时会显示对应的 Butler 跟进详情", async () => {
    render(
      <MessageTimeline
        messages={[createButlerProxyTextMessage("继续完成当前 spec 的剩余工作。")]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: t("conversation.butlerProxyMessageBadge") }));

    expect(getButlerFollowUpTaskMock).toHaveBeenCalledWith("follow-up-1");
    expect(await screen.findByText(t("conversation.butlerOriginDetailTitle"))).toBeInTheDocument();
    expect(screen.getByText(/完成当前 spec 的必做项/)).toBeInTheDocument();
  });

  it("旧消息仍兼容 clientRequestId 前缀识别代理发送", () => {
    render(
      <MessageTimeline
        messages={[{
          ...createTextMessage("继续完成当前 spec 的剩余工作。"),
          id: "message-butler-legacy-1",
          clientRequestId: "butler-follow-up:task-1:123"
        }]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByText(t("conversation.butlerProxyMessageBadge"))).toBeInTheDocument();
  });

  it("没有来源详情的代理发送消息只显示标签，不会请求 Butler 跟进详情", () => {
    render(
      <MessageTimeline
        messages={[createAssistantProxyTextMessage("继续跟进这个真实会话。")]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByText(t("conversation.butlerProxyMessageBadge"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.butlerProxyMessageBadge") })).not.toBeInTheDocument();
    expect(getButlerFollowUpTaskMock).not.toHaveBeenCalled();
  });

  it("点击文件路径链接会切到文件面板并定位文件", async () => {
    revealWorkspaceFileMock.mockReturnValue(true);
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
          createAssistantTextMessage(
            "[App.tsx](/Users/jackson/Code/CodingNS/apps/user-app/src/app/App.tsx#L12)"
          )
        ]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    await userEvent.click(screen.getByText("App.tsx"));

    expect(revealWorkspaceFileMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      filePath: "apps/user-app/src/app/App.tsx",
      openViewer: false
    });
    expect(writeText).not.toHaveBeenCalled();
  });

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
    expect(screen.getByText(`${t("conversation.toolPreviewCommand")}：git status --short`)).toBeInTheDocument();
    expect(document.querySelectorAll(".tool-message-row")).toHaveLength(1);
    expect(screen.queryByText(t("conversation.toolStatusCompleted"))).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${t("conversation.roleTool")}`) }));

    expect(screen.getByText(t("conversation.toolInputLabel"))).toBeInTheDocument();
    expect(screen.getAllByText(t("conversation.toolResultLabel")).length).toBeGreaterThan(0);
    expect(screen.getAllByText((content) => content.includes("M src/main.ts")).length).toBeGreaterThan(0);
  });

  it("会把联网搜索结果渲染成来源列表", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "tool-call-web-search-1",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_call",
            content: "{\n  \"query\": \"今天的热点新闻\"\n}",
            toolCall: {
              callId: "call-web-search-1",
              name: "web_search",
              input: "{\n  \"query\": \"今天的热点新闻\"\n}",
              output: null,
              error: null,
              status: "running"
            },
            timestamp: "2026-06-03T10:00:00.000Z",
            sequence: 1,
            rawRef: "lightweight://raw#line=1",
            deliveryState: "sent",
            clientRequestId: null
          },
          {
            id: "tool-result-web-search-1",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_result",
            content: "联网搜索完成",
            toolCall: {
              callId: "call-web-search-1",
              name: "web_search",
              input: "",
              output: JSON.stringify({
                detail: "联网搜索完成，找到 2 个来源",
                query: "今天的热点新闻",
                sources: [
                  {
                    title: "示例新闻一",
                    url: "https://example.com/news-1"
                  },
                  {
                    title: "示例新闻二",
                    url: "https://example.com/news-2"
                  }
                ]
              }, null, 2),
              error: null,
              status: "completed"
            },
            timestamp: "2026-06-03T10:00:01.000Z",
            sequence: 2,
            rawRef: "lightweight://raw#line=2",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    expect(screen.getByText(t("conversation.toolWebSearch"))).toBeInTheDocument();
    expect(screen.getByText("搜索：今天的热点新闻")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("conversation.toolWebSearch"), "i") }));

    expect(screen.getByText("联网搜索完成，找到 2 个来源")).toBeInTheDocument();
    expect(screen.getByText(t("conversation.toolWebSearchQueryLabel"))).toBeInTheDocument();
    expect(screen.getByText("今天的热点新闻")).toBeInTheDocument();
    expect(screen.getByText(t("conversation.toolWebSearchSourcesLabel"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "示例新闻一" })).toHaveAttribute("href", "https://example.com/news-1");
    expect(screen.getByRole("link", { name: "示例新闻二" })).toHaveAttribute("href", "https://example.com/news-2");
  });

  it("不会在工具分组阶段重排已经线性的时间线顺序", () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "tool-call-first",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_call",
            content: "{\n  \"command\": \"echo first\"\n}",
            toolCall: {
              callId: "call-first",
              name: "shell_command",
              input: "{\n  \"command\": \"echo first\"\n}",
              output: null,
              error: null,
              status: "running"
            },
            timestamp: "2026-03-23T10:00:00.000Z",
            sequence: 10,
            rawRef: "codex://raw#line=100",
            deliveryState: "sent",
            clientRequestId: null
          },
          {
            id: "tool-call-second",
            sessionId: "session-1",
            role: "tool",
            kind: "tool_call",
            content: "{\n  \"command\": \"echo second\"\n}",
            toolCall: {
              callId: "call-second",
              name: "shell_command",
              input: "{\n  \"command\": \"echo second\"\n}",
              output: null,
              error: null,
              status: "running"
            },
            timestamp: "2026-03-23T10:00:01.000Z",
            sequence: 9,
            rawRef: "codex://raw#line=101",
            deliveryState: "sent",
            clientRequestId: null
          }
        ]}
      />
    );

    const previews = Array.from(document.querySelectorAll(".tool-message-row")).map(
      (node) => node.textContent?.replace(/\s+/g, " ").trim() ?? ""
    );

    expect(previews[0]).toContain("echo first");
    expect(previews[1]).toContain("echo second");
  });

  it("不会把被其他工具消息隔开的同 callId 片段重新合并到前面", () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "tool-call-a",
            callId: "call-a",
            name: "shell_command",
            kind: "tool_call",
            content: "{\"command\":\"echo A\"}",
            toolInput: "{\"command\":\"echo A\"}",
            sequence: 10,
            rawRef: "codex://raw#line=10"
          }),
          createToolMessage({
            id: "tool-call-b",
            callId: "call-b",
            name: "shell_command",
            kind: "tool_call",
            content: "{\"command\":\"echo B\"}",
            toolInput: "{\"command\":\"echo B\"}",
            sequence: 11,
            rawRef: "codex://raw#line=11"
          }),
          createToolMessage({
            id: "tool-result-a",
            callId: "call-a",
            name: "shell_command",
            kind: "tool_result",
            content: "A done",
            toolInput: "{\"command\":\"echo A\"}",
            toolOutput: "A done",
            sequence: 12,
            rawRef: "codex://raw#line=12"
          })
        ]}
      />
    );

    const previews = Array.from(document.querySelectorAll(".tool-message-row")).map(
      (node) => node.textContent?.replace(/\s+/g, " ").trim() ?? ""
    );

    expect(previews).toHaveLength(3);
    expect(previews[0]).toContain("echo A");
    expect(previews[1]).toContain("echo B");
    expect(previews[2]).toContain("echo A");
  });

  it("会把 update_plan 渲染成任务卡片，并保留原始展开入口", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "plan-call-1",
            callId: "plan-call-1",
            name: "update_plan",
            kind: "tool_call",
            content: JSON.stringify({
              explanation: "先处理结构，再补测试。",
              plan: [
                { step: "梳理现有时间线", status: "completed" },
                { step: "补任务卡片", status: "in_progress" }
              ]
            }, null, 2)
          })
        ]}
      />
    );

    expect(screen.getByText(t("conversation.taskCardPlanTitle"))).toBeInTheDocument();
    expect(screen.getByText("梳理现有时间线")).toBeInTheDocument();
    expect(screen.getByText("补任务卡片")).toBeInTheDocument();
    expect(
      screen.getByText(`${t("conversation.taskCardSummaryTotal", { count: 2 })} / ${t("conversation.taskCardSummaryInProgress", { count: 1 })} / ${t("conversation.taskCardSummaryCompleted", { count: 1 })}`)
    ).toBeInTheDocument();
    expect(screen.queryByText("先处理结构，再补测试。")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("conversation.taskCardRawExpand") }));

    expect(screen.getByText(t("conversation.toolInputLabel"))).toBeInTheDocument();
    expect(screen.getByText(/"plan":/)).toBeInTheDocument();
  });

  it("会把 Claude 的 ExitPlanMode 渲染成计划卡片，并展示后续执行提示", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "exit-plan-call-1",
            callId: "exit-plan-call-1",
            name: "ExitPlanMode",
            kind: "tool_call",
            content: JSON.stringify({
              allowedPrompts: [
                {
                  tool: "Bash",
                  prompt: "run tests"
                }
              ]
            }, null, 2),
            toolInput: JSON.stringify({
              allowedPrompts: [
                {
                  tool: "Bash",
                  prompt: "run tests"
                }
              ]
            }, null, 2),
            toolOutput: JSON.stringify({
              plan: [
                { step: "检查现有 Hook 设置", status: "completed" },
                { step: "补 Host 计划审批", status: "in_progress" }
              ],
              explanation: "先把计划审批主链路打通，再补前端展示。"
            }, null, 2)
          })
        ]}
      />
    );

    expect(screen.getByText(t("conversation.taskCardPlanTitle"))).toBeInTheDocument();
    expect(screen.getByText("检查现有 Hook 设置")).toBeInTheDocument();
    expect(screen.getByText("补 Host 计划审批")).toBeInTheDocument();
    expect(screen.getByText(t("conversation.taskProgressExplanationTitle"))).toBeInTheDocument();
    expect(screen.getByText("先把计划审批主链路打通，再补前端展示。")).toBeInTheDocument();
    expect(screen.getByText(t("conversation.taskCardAllowedPromptsTitle"))).toBeInTheDocument();
    expect(screen.getByText("run tests")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("conversation.taskCardRawExpand") }));

    expect(screen.getByText(t("conversation.toolInputLabel"))).toBeInTheDocument();
    expect(screen.getByText(/"allowedPrompts":/)).toBeInTheDocument();
  });

  it("Claude 的 ExitPlanMode 长文本计划说明会按 markdown 渲染", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "exit-plan-markdown-raw-1",
            callId: "exit-plan-markdown-raw-1",
            name: "ExitPlanMode",
            kind: "tool_call",
            content: JSON.stringify({
              allowedPrompts: []
            }, null, 2),
            toolInput: JSON.stringify({
              allowedPrompts: []
            }, null, 2),
            toolOutput: JSON.stringify({
              plan: `## 济南 3 日游\n\n> 先定节奏，再拆每天安排\n\n- Day 1：老城泉水\n- Day 2：千佛山与博物馆`,
              allowedPrompts: []
            }, null, 2)
          })
        ]}
      />
    );

    expect(screen.getByRole("heading", { name: "济南 3 日游" })).toBeInTheDocument();
    expect(screen.getByText("先定节奏，再拆每天安排")).toBeInTheDocument();
    expect(screen.getByText("Day 1：老城泉水")).toBeInTheDocument();
    expect(screen.getByText("Day 2：千佛山与博物馆")).toBeInTheDocument();
  });

  it("Claude 的 ExitPlanMode 任务项标题会按 markdown 渲染加粗", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "exit-plan-bold-list-1",
            callId: "exit-plan-bold-list-1",
            name: "ExitPlanMode",
            kind: "tool_call",
            content: JSON.stringify({
              allowedPrompts: []
            }, null, 2),
            toolInput: JSON.stringify({
              allowedPrompts: []
            }, null, 2),
            toolOutput: JSON.stringify({
              plan: [
                "**一日一主题**，每天景点地理集中，减少跨城奔波；",
                "**热在中午、人在室内**——把山东省博物馆固定在最热时段；"
              ],
              allowedPrompts: []
            }, null, 2)
          })
        ]}
      />
    );

    const firstStrong = screen.getByText("一日一主题", { selector: "strong" });
    const secondStrong = screen.getByText("热在中午、人在室内", { selector: "strong" });

    expect(firstStrong).toBeInTheDocument();
    expect(secondStrong).toBeInTheDocument();
    expect(screen.queryByText(/\*\*一日一主题\*\*/)).not.toBeInTheDocument();
  });

  it("Claude 的 ExitPlanMode 在顶部有待处理审批时，不再重复显示底部计划说明", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        replyingPermissionRequestId={null}
        permissionRequests={[
          {
            id: "permission-plan-1",
            sessionId: "session-1",
            provider: "claude-code",
            providerSessionId: "provider-session-1",
            requestKey: "exit-plan-1",
            kind: "plan_approval",
            status: "pending",
            title: "Claude 请求确认执行计划",
            summary: "先确认方案，再继续改代码。",
            detail: JSON.stringify({
              allowedPrompts: [
                {
                  tool: "Bash",
                  prompt: "run tests"
                }
              ]
            }, null, 2),
            reason: null,
            toolName: "ExitPlanMode",
            command: null,
            cwd: "/tmp/workspace",
            paths: [],
            permissionProfile: null,
            questions: [],
            actions: [
              {
                value: "allow",
                label: "批准计划",
                tone: "primary",
                description: "允许 Claude 按当前计划继续执行"
              },
              {
                value: "deny",
                label: "退回计划",
                tone: "danger",
                description: "拒绝这次计划，要求 Claude 停在计划阶段"
              }
            ],
            rawPayload: null,
            createdAt: "2026-06-14T09:00:00.000Z",
            updatedAt: "2026-06-14T09:00:00.000Z",
            resolvedAt: null
          }
        ]}
        messages={[
          createToolMessage({
            id: "exit-plan-call-2",
            callId: "exit-plan-call-2",
            name: "ExitPlanMode",
            kind: "tool_call",
            content: JSON.stringify({
              allowedPrompts: [
                {
                  tool: "Bash",
                  prompt: "run tests"
                }
              ]
            }, null, 2),
            toolInput: JSON.stringify({
              allowedPrompts: [
                {
                  tool: "Bash",
                  prompt: "run tests"
                }
              ]
            }, null, 2),
            toolOutput: JSON.stringify({
              plan: [
                { step: "写清楚剩余 Hook", status: "completed" },
                { step: "补 plan 审批 UI", status: "in_progress" }
              ],
              explanation: "## 本轮更新\n\n- 先把审批卡片贴到计划下面\n- 再补 markdown 展示"
            }, null, 2)
          })
        ]}
      />
    );

    expect(screen.queryByRole("heading", { name: "本轮更新" })).not.toBeInTheDocument();
    expect(screen.queryByText("先把审批卡片贴到计划下面")).not.toBeInTheDocument();
    expect(screen.queryByText("再补 markdown 展示")).not.toBeInTheDocument();
  });

  it("Claude TaskUpdate 只有 taskId 时也会渲染成任务卡片", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "task-create-1",
            callId: "task-create-1",
            name: "TaskCreate",
            kind: "tool_call",
            content: JSON.stringify({
              title: "补时间线卡片"
            }, null, 2),
            toolInput: JSON.stringify({
              title: "补时间线卡片"
            }, null, 2),
            toolOutput: JSON.stringify("1")
          }),
          createToolMessage({
            id: "task-update-1",
            callId: "task-update-1",
            name: "TaskUpdate",
            kind: "tool_result",
            content: JSON.stringify({
              status: "in_progress",
              taskId: 1,
              activeForm: "正在改 MessageTimeline"
            }, null, 2),
            toolInput: JSON.stringify({
              status: "in_progress",
              taskId: 1,
              activeForm: "正在改 MessageTimeline"
            }, null, 2),
            toolOutput: "Updated task #1 status"
          })
        ]}
      />
    );

    expect(screen.getAllByText(t("conversation.taskCardTodoTitle"))).toHaveLength(2);
    expect(screen.getByText("补时间线卡片")).toBeInTheDocument();
    expect(screen.getByText("Task #1")).toBeInTheDocument();
    expect(screen.getByText(t("conversation.taskProgressStatusInProgress"))).toBeInTheDocument();
  });

  it("会把 Claude 纯文本 TaskCreate 输出渲染成任务卡片", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "task-create-text-1",
            callId: "task-create-text-1",
            name: "TaskCreate",
            kind: "tool_result",
            content: "Task #1 created successfully: 调研目标工具的文档结构",
            toolInput: "",
            toolOutput: "Task #1 created successfully: 调研目标工具的文档结构"
          })
        ]}
      />
    );

    expect(screen.getByText(t("conversation.taskCardTodoTitle"))).toBeInTheDocument();
    expect(screen.getByText("调研目标工具的文档结构")).toBeInTheDocument();
  });

  it("会把 Claude TaskCreate 的调用和结果按任务语义合并，避免同一任务显示两次", async () => {
    const taskTitles = [
      "调研目标工具的文档结构",
      "初始化 Docusaurus 中文站点脚手架",
      "翻译核心章节并校对术语",
      "配置中文搜索与部署流程"
    ];
    const messages = taskTitles.flatMap((title, index) => {
      const taskNo = index + 1;

      return [
        createToolMessage({
          id: `task-create-call-${taskNo}`,
          callId: `task-create-call-${taskNo}`,
          name: "TaskCreate",
          kind: "tool_call",
          content: JSON.stringify({
            title
          }),
          toolInput: JSON.stringify({
            title
          }),
          sequence: taskNo * 2 - 1
        }),
        createToolMessage({
          id: `task-create-result-${taskNo}`,
          callId: `task-create-result-${taskNo}`,
          name: "TaskCreate",
          kind: "tool_result",
          content: `Task #${taskNo} created successfully: ${title}`,
          toolInput: "",
          toolOutput: `Task #${taskNo} created successfully: ${title}`,
          sequence: taskNo * 2
        })
      ];
    });

    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={messages}
      />
    );

    expect(document.querySelectorAll(".tool-message-row")).toHaveLength(4);
    expect(screen.getAllByText(t("conversation.taskCardTodoTitle"))).toHaveLength(4);
    expect(screen.getAllByText("调研目标工具的文档结构")).toHaveLength(1);
    expect(screen.getAllByText("配置中文搜索与部署流程")).toHaveLength(1);
  });

  it("会把 Claude TaskUpdate 的调用和结果按 taskId 合并", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "task-update-call-1",
            callId: "task-update-call-1",
            name: "TaskUpdate",
            kind: "tool_call",
            content: JSON.stringify({
              status: "completed",
              taskId: "1"
            }),
            toolInput: JSON.stringify({
              status: "completed",
              taskId: "1"
            }),
            sequence: 1
          }),
          createToolMessage({
            id: "task-update-result-1",
            callId: "task-update-result-1",
            name: "TaskUpdate",
            kind: "tool_result",
            content: "Updated task #1 status",
            toolOutput: "Updated task #1 status",
            sequence: 2
          }),
          createToolMessage({
            id: "task-update-call-2",
            callId: "task-update-call-2",
            name: "TaskUpdate",
            kind: "tool_call",
            content: JSON.stringify({
              status: "in_progress",
              taskId: "2"
            }),
            toolInput: JSON.stringify({
              status: "in_progress",
              taskId: "2"
            }),
            sequence: 3
          }),
          createToolMessage({
            id: "task-update-result-2",
            callId: "task-update-result-2",
            name: "TaskUpdate",
            kind: "tool_result",
            content: "Updated task #2 status",
            toolOutput: "Updated task #2 status",
            sequence: 4
          })
        ]}
      />
    );

    const previews = Array.from(document.querySelectorAll(".tool-message-row")).map(
      (node) => node.textContent?.replace(/\s+/g, " ").trim() ?? ""
    );

    expect(previews).toHaveLength(2);
    expect(previews[0]).toContain(t("conversation.taskCardTodoTitle"));
    expect(previews[0]).toContain("Task #1");
    expect(previews[0]).toContain(t("conversation.taskProgressStatusCompleted"));
    expect(previews[1]).toContain(t("conversation.taskCardTodoTitle"));
    expect(previews[1]).toContain("Task #2");
    expect(previews[1]).toContain(t("conversation.taskProgressStatusInProgress"));
  });

  it("会把 Claude TaskList 的调用和结果合并成一张任务卡片", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "task-list-call-1",
            callId: "task-list-call-1",
            name: "TaskList",
            kind: "tool_call",
            content: "{}",
            toolInput: "{}",
            sequence: 1
          }),
          createToolMessage({
            id: "task-list-result-1",
            callId: "task-list-result-1",
            name: "TaskList",
            kind: "tool_result",
            content: [
              "#1 [completed] 调研目标工具的文档结构",
              "#2 [completed] 初始化 Docusaurus 中文站点脚手架",
              "#3 [in_progress] 翻译核心章节并校对术语",
              "#4 [pending] 配置中文搜索与部署流程"
            ].join("\n"),
            toolOutput: [
              "#1 [completed] 调研目标工具的文档结构",
              "#2 [completed] 初始化 Docusaurus 中文站点脚手架",
              "#3 [in_progress] 翻译核心章节并校对术语",
              "#4 [pending] 配置中文搜索与部署流程"
            ].join("\n"),
            sequence: 2
          })
        ]}
      />
    );

    expect(document.querySelectorAll(".tool-message-row")).toHaveLength(1);
    expect(screen.getByText(t("conversation.taskCardTodoTitle"))).toBeInTheDocument();
    expect(screen.getByText("调研目标工具的文档结构")).toBeInTheDocument();
    expect(screen.getByText("配置中文搜索与部署流程")).toBeInTheDocument();
  });

  it("会把 Claude 纯文本 TaskList 输出渲染成完整任务卡片", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "task-list-result-1",
            callId: "task-list-result-1",
            name: "TaskList",
            kind: "tool_result",
            content: [
              "#1 [completed] 调研目标工具的文档结构",
              "#2 [completed] 初始化 Docusaurus 中文站点脚手架",
              "#3 [in_progress] 翻译核心章节并校对术语",
              "#4 [pending] 配置中文搜索与部署流程"
            ].join("\n"),
            toolInput: "{}",
            toolOutput: [
              "#1 [completed] 调研目标工具的文档结构",
              "#2 [completed] 初始化 Docusaurus 中文站点脚手架",
              "#3 [in_progress] 翻译核心章节并校对术语",
              "#4 [pending] 配置中文搜索与部署流程"
            ].join("\n")
          })
        ]}
      />
    );

    expect(screen.getByText(t("conversation.taskCardTodoTitle"))).toBeInTheDocument();
    expect(screen.getByText("调研目标工具的文档结构")).toBeInTheDocument();
    expect(screen.getByText("翻译核心章节并校对术语")).toBeInTheDocument();
    expect(screen.getByText("配置中文搜索与部署流程")).toBeInTheDocument();
  });

  it("会把 Claude TodoWrite 渲染成任务卡片", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "todo-write-1",
            callId: "todo-write-1",
            name: "TodoWrite",
            kind: "tool_call",
            content: JSON.stringify({
              todos: [
                { id: "a", content: "设计任务卡片", status: "completed" },
                { id: "b", content: "补时间线测试", status: "pending" }
              ]
            }, null, 2)
          })
        ]}
      />
    );

    expect(screen.getByText("设计任务卡片")).toBeInTheDocument();
    expect(screen.getByText("补时间线测试")).toBeInTheDocument();
  });

  it("会把 assistant 会话发送回执渲染成专门的助手动作卡片", () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          createAssistantCapabilityReceiptMessage({
            id: "assistant-send-1",
            capability: "sessions.message.send",
            targetRef: {
              kind: "session",
              id: "session-1"
            },
            payload: {
              result: {
                acceptedAt: "2026-04-16T12:10:00.000Z"
              }
            }
          })
        ]}
      />
    );

    expect(screen.getByText(t("conversation.assistantCapabilityBadgeSession"))).toBeInTheDocument();
    expect(screen.getByText(t("conversation.assistantCapabilitySessionSendTitle"))).toBeInTheDocument();
    expect(screen.getByText("登录页开发")).toBeInTheDocument();
    expect(screen.getByText(t("conversation.assistantCapabilitySummarySessionSend"))).toBeInTheDocument();
  });

  it("会把 codingns assistant help 命令渲染成助手帮助卡片", () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          createAssistantCliToolMessage({
            id: "assistant-help-1",
            command: "codingns assistant help sessions"
          })
        ]}
      />
    );

    expect(screen.getByText(t("conversation.assistantCapabilityBadgeSession"))).toBeInTheDocument();
    expect(screen.getByText(t("conversation.assistantCliHelpSessionsTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("conversation.assistantCliSummaryHelp"))).toBeInTheDocument();
  });

  it("会把 codingns assistant sessions send 命令渲染成助手会话卡片", () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          createAssistantCliToolMessage({
            id: "assistant-send-command-1",
            command: "codingns assistant sessions send session-1 --message \"继续推进登录页收尾\""
          })
        ]}
      />
    );

    expect(screen.getByText(t("conversation.assistantCapabilitySessionSendTitle"))).toBeInTheDocument();
    expect(screen.getByText("登录页开发")).toBeInTheDocument();
    expect(screen.getByText("继续推进登录页收尾")).toBeInTheDocument();
  });

  it("会把 Codex 子 agent 工具调用渲染成专门的会话动作卡片", () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "agent-create-1",
            callId: "agent-create-1",
            name: "spawn_agent",
            kind: "tool_result",
            content: JSON.stringify({
              id: "agent-explorer-1",
              nickname: "探索者"
            }),
            toolInput: JSON.stringify({
              agent_type: "explorer",
              message: "请检查消息渲染入口",
              model: "gpt-5.5"
            }),
            toolOutput: JSON.stringify({
              id: "agent-explorer-1",
              nickname: "探索者"
            }),
            sequence: 1
          }),
          createToolMessage({
            id: "agent-read-1",
            callId: "agent-read-1",
            name: "wait_agent",
            kind: "tool_call",
            content: JSON.stringify({
              targets: ["agent-explorer-1"],
              timeout_ms: 30000
            }),
            sequence: 2
          }),
          createToolMessage({
            id: "agent-reply-1",
            callId: "agent-reply-1",
            name: "send_input",
            kind: "tool_call",
            content: JSON.stringify({
              target: "agent-explorer-1",
              message: "继续看样式文件"
            }),
            sequence: 3
          }),
          createToolMessage({
            id: "agent-update-1",
            callId: "agent-update-1",
            name: "send_input",
            kind: "tool_call",
            content: JSON.stringify({
              target: "agent-explorer-1",
              interrupt: true,
              message: "先停止，改查测试覆盖"
            }),
            sequence: 4
          }),
          createToolMessage({
            id: "agent-close-1",
            callId: "agent-close-1",
            name: "close_agent",
            kind: "tool_result",
            content: JSON.stringify({
              status: "closed"
            }),
            toolInput: JSON.stringify({
              target: "agent-explorer-1"
            }),
            toolOutput: JSON.stringify({
              status: "closed"
            }),
            sequence: 5
          })
        ]}
      />
    );

    expect(screen.getAllByText(t("conversation.assistantCapabilityBadgeSubAgent"))).toHaveLength(5);
    expect(screen.getByText(t("conversation.codexAgentToolCreateTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("conversation.codexAgentToolReadTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("conversation.codexAgentToolReplyTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("conversation.codexAgentToolUpdateTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("conversation.codexAgentToolCloseTitle"))).toBeInTheDocument();
    expect(screen.getAllByText("agent-explorer-1").length).toBeGreaterThan(0);
    expect(screen.getByText("探索者")).toBeInTheDocument();
    expect(screen.getByText("继续看样式文件")).toBeInTheDocument();
    expect(screen.getByText("先停止，改查测试覆盖")).toBeInTheDocument();
    expect(screen.getByText("closed")).toBeInTheDocument();
  });

  it("会用真实历史消息形态显示 Codex 子 agent 创建和查看工具", () => {
    const historyMessages: HistoryMessageDto[] = [
      {
        messageId: "history-agent-create-call",
        provider: "codex",
        providerSessionId: "provider-session-1",
        role: "tool",
        kind: "tool_call",
        content: JSON.stringify({
          agent_type: "explorer",
          message: "请在当前仓库做只读检索"
        }),
        toolCall: {
          callId: "call-spawn-agent-1",
          name: "functions.spawn_agent",
          input: JSON.stringify({
            agent_type: "explorer",
            message: "请在当前仓库做只读检索"
          }),
          output: null,
          error: null,
          status: "running"
        },
        timestamp: "2026-06-09T07:24:02.000Z",
        sequence: 4,
        rawRef: "codex://rollout#line=15"
      },
      {
        messageId: "history-agent-create-result",
        provider: "codex",
        providerSessionId: "provider-session-1",
        role: "tool",
        kind: "tool_result",
        content: JSON.stringify({
          agent_id: "019eab45-eea2-7353-8d6f-963be33a5c45",
          nickname: "Erdos"
        }),
        toolCall: {
          callId: "call-spawn-agent-1",
          name: "functions.spawn_agent",
          input: JSON.stringify({
            agent_type: "explorer",
            message: "请在当前仓库做只读检索"
          }),
          output: JSON.stringify({
            agent_id: "019eab45-eea2-7353-8d6f-963be33a5c45",
            nickname: "Erdos"
          }),
          error: null,
          status: "completed"
        },
        timestamp: "2026-06-09T07:24:03.000Z",
        sequence: 5,
        rawRef: "codex://rollout#line=16"
      },
      {
        messageId: "history-agent-read-call",
        provider: "codex",
        providerSessionId: "provider-session-1",
        role: "tool",
        kind: "tool_call",
        content: JSON.stringify({
          targets: ["019eab45-eea2-7353-8d6f-963be33a5c45"],
          timeout_ms: 120000
        }),
        toolCall: {
          callId: "call-wait-agent-1",
          name: "multi_tool_use.wait_agent",
          input: JSON.stringify({
            targets: ["019eab45-eea2-7353-8d6f-963be33a5c45"],
            timeout_ms: 120000
          }),
          output: null,
          error: null,
          status: "running"
        },
        timestamp: "2026-06-09T07:24:04.000Z",
        sequence: 6,
        rawRef: "codex://rollout#line=17"
      }
    ];

    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={historyMessages.map((message) => toViewMessage("session-1", message))}
      />
    );

    expect(screen.getAllByText(t("conversation.assistantCapabilityBadgeSubAgent"))).toHaveLength(2);
    expect(screen.getByText(t("conversation.codexAgentToolCreateTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("conversation.codexAgentToolReadTitle"))).toBeInTheDocument();
    expect(screen.getAllByText("019eab45-eea2-7353-8d6f-963be33a5c45").length).toBeGreaterThan(0);
    expect(screen.getByText("Erdos")).toBeInTheDocument();
  });

  it("会把子 agent 通知用户消息渲染成结果汇报卡片", () => {
    const notification = {
      agent_path: "019eab8c-12af-7550-a640-41076f763450",
      status: {
        completed: [
          "已完成 Spec 014 前端控制台和前端契约修复。",
          "",
          "## 改动文件",
          "",
          "- `web/src/api/modules/gateways.api.ts`",
          "- `web/src/views/gateways/GatewaysView.vue`",
          "",
          "## 测试结果",
          "",
          "Test Files 2 passed",
          "Tests 9 passed"
        ].join("\n")
      }
    };

    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          createTextMessage(`<subagent_notification>\n${JSON.stringify(notification)}\n</subagent_notification>`)
        ]}
      />
    );

    expect(screen.getByText(t("conversation.subagentNotificationTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("conversation.assistantCapabilityBadgeSubAgent"))).toBeInTheDocument();
    expect(screen.getByText("019eab8c-12af-7550-a640-41076f763450")).toBeInTheDocument();
    expect(screen.getAllByText("已完成 Spec 014 前端控制台和前端契约修复。").length).toBeGreaterThan(0);
    expect(screen.getByText("web/src/api/modules/gateways.api.ts")).toBeInTheDocument();
    expect(screen.queryByText(/<subagent_notification>/)).not.toBeInTheDocument();
  });

  it("会把 codingns assistant timers create 命令渲染成助手自动化卡片", () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          createAssistantCliToolMessage({
            id: "assistant-timer-command-1",
            command: "codingns assistant timers create --after-seconds 300 --session-id session-1 --message \"5分钟后检查真实会话回复\""
          })
        ]}
      />
    );

    expect(screen.getByText(t("conversation.assistantCapabilityTimerCreateTitle"))).toBeInTheDocument();
    expect(screen.getByText("登录页开发")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
  });

  it("会把 assistant 工作区回执渲染成专门的助手动作卡片", () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          createAssistantCapabilityReceiptMessage({
            id: "assistant-workspace-1",
            capability: "workspaces.clone",
            targetRef: {
              kind: "workspace",
              id: "workspace-1"
            },
            payload: {
              workspace: {
                id: "workspace-1",
                name: "CodingNS 副本",
                path: "/Users/jackson/Code/CodingNS-copy"
              }
            }
          })
        ]}
      />
    );

    expect(screen.getByText(t("conversation.assistantCapabilityBadgeWorkspace"))).toBeInTheDocument();
    expect(screen.getByText(t("conversation.assistantCapabilityWorkspaceCloneTitle"))).toBeInTheDocument();
    expect(screen.getByText("CodingNS 副本")).toBeInTheDocument();
    expect(screen.getByText("/Users/jackson/Code/CodingNS-copy")).toBeInTheDocument();
  });

  it("会把 OpenCode 的 todowrite 调用与结果合并成任务卡片", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="opencode"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "opencode-todo-call-1",
            callId: "oc-todo-1",
            name: "todowrite",
            kind: "tool_call",
            content: JSON.stringify({
              todos: [
                { id: "1", content: "接时间线卡片", status: "in_progress" }
              ]
            }, null, 2),
            rawRef: "opencode://session-1/message-1/part-1",
            sequence: 1
          }),
          createToolMessage({
            id: "opencode-todo-result-1",
            callId: "oc-todo-1",
            name: "todowrite",
            kind: "tool_result",
            content: JSON.stringify({
              todos: [
                { id: "1", content: "接时间线卡片", status: "completed" },
                { id: "2", content: "保留原始展开", status: "in_progress" }
              ]
            }, null, 2),
            toolOutput: JSON.stringify({
              todos: [
                { id: "1", content: "接时间线卡片", status: "completed" },
                { id: "2", content: "保留原始展开", status: "in_progress" }
              ]
            }, null, 2),
            rawRef: "opencode://session-1/message-1/part-2",
            sequence: 2
          })
        ]}
      />
    );

    expect(document.querySelectorAll(".tool-message-row")).toHaveLength(1);
    expect(screen.getByText("接时间线卡片")).toBeInTheDocument();
    expect(screen.queryByText("保留原始展开")).not.toBeInTheDocument();
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

  it("会把工作区内 markdown 本地图片路径转换成受控预览链接", async () => {
    render(
      <MessageTimeline
        messages={[
          createAssistantTextMessage(
            "直接扫这张：\n\n![知乎扫码二维码](/Users/jackson/Code/CodingNS/apps/user-app/src/assets/menu.png)"
          )
        ]}
        historyState="ready"
        provider="codex"
        workspaceId="workspace-1"
        onRetryMessage={vi.fn()}
      />
    );

    expect(getFilePreviewLinkMock).toHaveBeenCalledWith("workspace-1", "apps/user-app/src/assets/menu.png");

    await screen.findByAltText("知乎扫码二维码");
    await waitFor(() => {
      expect(screen.getByAltText("知乎扫码二维码").getAttribute("src")).toContain(
        "/preview/files/preview-token/apps/user-app/src/assets/menu.png"
      );
    });
  });

  it("会保留外部 markdown 图片链接，不走工作区预览转换", async () => {
    render(
      <MessageTimeline
        messages={[createAssistantTextMessage("![外部图片](https://example.com/demo.png)")]}
        historyState="ready"
        provider="codex"
        workspaceId="workspace-1"
        onRetryMessage={vi.fn()}
      />
    );

    const image = await screen.findByAltText("外部图片");
    expect(image.getAttribute("src")).toBe("https://example.com/demo.png");
    expect(getFilePreviewLinkMock).not.toHaveBeenCalledWith("workspace-1", "demo.png");
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
    expect(screen.getByRole("button", { name: new RegExp(t("conversation.rulesMessageExpand")) })).toBeInTheDocument();
    expect(screen.queryByText("不要主动启动开发服务器")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("conversation.rulesMessageExpand")) }));

    expect(screen.getByRole("button", { name: new RegExp(t("conversation.rulesMessageCollapse")) })).toBeInTheDocument();
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
    expect(document.querySelector(".thinking-message-wrapper")).toBeNull();
    expect(document.querySelector(".thinking-message-content")).not.toBeNull();
    expect(document.querySelectorAll(".thinking-message-row")).toHaveLength(1);
  });

  it("DeepSeek Harness 的思考和正式回复会按消息类型分开渲染", () => {
    const thinking = {
      ...createAssistantThinkingMessage("先分析用户的请求。", "harness-thinking-1"),
      sequence: 9,
      rawRef: "harness://session-1/message/turn-1-step-1/part/thinking-0?part=0"
    };
    const reply = {
      ...createAssistantTextMessage("这是正式回复。", "harness-reply-1"),
      sequence: 9,
      rawRef: "harness://session-1/message/turn-1-step-1/part/text-1?part=1"
    };

    render(
      <MessageTimeline
        messages={[thinking, reply]}
        historyState="ready"
        provider="deepseek-harness"
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByText(t("conversation.thinkingLabel"))).toBeInTheDocument();
    expect(screen.getByText("先分析用户的请求。").closest(".thinking-message-text")).not.toBeNull();
    expect(screen.getByText("这是正式回复。").closest(".thinking-message-text")).toBeNull();
  });

  it("运行中的 thinking 占位只保留动态文字类名", () => {
    render(
      <MessageTimeline
        items={buildConversationTimelineSourceItems({
          messages: [],
          runtimeThinkingPlaceholder: "Codex 正在思考..."
        })}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Codex 正在思考...")).toHaveClass("thinking-status-text");
    expect(document.querySelector(".thinking-status-inline")).not.toBeNull();
    expect(document.querySelector(".thinking-status-dots")).not.toBeNull();
  });

  it("消息、thinking 占位和错误尾项会按同一条时间线顺序渲染", () => {
    render(
      <MessageTimeline
        items={buildConversationTimelineSourceItems({
          messages: [createAssistantTextMessage("上一条助手回复", "assistant-tail-order-1")],
          runtimeThinkingPlaceholder: "Codex 正在思考...",
          sessionRunningState: "failed",
          sessionSyncStatus: "error",
          sessionLastErrorCode: "CODEX_HTTP_429",
          sessionLastErrorDetail: "429 Too Many Requests, request id: demo-request-id"
        })}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    const children = Array.from(document.querySelectorAll(".message-list > *"));
    const orderedMarkers = children.map((element) => {
      if (element instanceof HTMLElement && element.dataset.runtimeThinkingPlaceholder === "true") {
        return "runtime-thinking";
      }

      if (element instanceof HTMLElement && element.classList.contains("session-runtime-error-row")) {
        return "session-error";
      }

      if (element instanceof HTMLElement && element.dataset.messageId) {
        return element.dataset.messageId;
      }

      return null;
    }).filter(Boolean);

    expect(orderedMarkers).toEqual([
      "assistant-tail-order-1",
      "runtime-thinking",
      "session-error"
    ]);
  });

  it("主要 Claude 运行态会按 Ask Question 同款只读卡片展示", () => {
    render(
      <MessageTimeline
        items={buildConversationTimelineSourceItems({
          messages: [createAssistantTextMessage("我先继续处理这一轮。", "assistant-runtime-notice-1")],
          sessionDetail: "Claude 正在执行初始化：/tmp/workspace"
        })}
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByText("Claude 正在处理当前任务")).toBeInTheDocument();
    expect(screen.getByText(t("conversation.runtimeNoticeDescription"))).toBeInTheDocument();
    expect(screen.getByText("运行状态")).toBeInTheDocument();
    expect(screen.getByText("Claude 正在执行初始化：/tmp/workspace")).toBeInTheDocument();
    expect(document.querySelector(".runtime-notice-card")).not.toBeNull();
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

    const copyButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".code-copy-button")
    );
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
    expect(document.querySelectorAll(".code-copy-button")).toHaveLength(0);
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

  it("不会把 Claude 会话里的 AGENTS 规则文本误判成折叠消息", () => {
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
    expect(screen.queryByRole("button", { name: new RegExp(t("conversation.rulesMessageExpand")) })).not.toBeInTheDocument();
  });

  it("会默认折叠 Claude Code 会话里的 Skill 上下文，并允许手动展开", async () => {
    render(
      <MessageTimeline
        messages={[
          createTextMessage(`Base directory for this skill: /tmp/claude-home/skills/codingns-assistant

# CodingNS Assistant

## 概述

用这套 Skill 时，永远把 \`codingns assistant ...\` 当成唯一正式入口。

ARGUMENTS: capabilities list`)
        ]}
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByText("CodingNS Assistant")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(t("conversation.skillContextExpand")) })).toBeInTheDocument();
    expect(screen.queryByText((content) => content.includes("永远把"))).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("conversation.skillContextExpand")) }));

    expect(screen.getByRole("button", { name: new RegExp(t("conversation.skillContextCollapse")) })).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("永远把"))).toBeInTheDocument();
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

  it("首屏不会自动加载更早消息，只有滚到顶部时才触发", () => {
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
    expect(handleLoadOlderMessages).not.toHaveBeenCalled();

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

  it("已经顶到最上面时，继续向上滚轮也会触发更早消息加载", () => {
    const handleLoadOlderMessages = vi.fn();

    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        hasOlderMessages
        onLoadOlderMessages={handleLoadOlderMessages}
        onRetryMessage={vi.fn()}
        messages={Array.from({ length: 5 }, (_, index) => ({
          id: `wheel-message-${index + 1}`,
          sessionId: "session-wheel-1",
          role: "assistant",
          kind: "text",
          content: `wheel-message-${index + 1}`,
          toolCall: null,
          timestamp: `2026-03-23T10:1${index}:00.000Z`,
          sequence: index + 1,
          rawRef: `codex://raw#line=wheel-${index + 1}`,
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
    Object.defineProperty(messageList, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true
    });

    fireEvent.wheel(messageList!, {
      deltaY: -120
    });

    expect(handleLoadOlderMessages).toHaveBeenCalledTimes(1);
  });

  it("加载更早消息期间收到实时新消息时，不会提前消费历史滚动恢复偏移", () => {
    const handleLoadOlderMessages = vi.fn();
    const baseMessages = [
      {
        ...createAssistantTextMessage("第一条消息", "assistant-base-1"),
        sessionId: "session-scroll-1"
      },
      {
        ...createAssistantTextMessage("第二条消息", "assistant-base-2"),
        sessionId: "session-scroll-1",
        sequence: 2,
        rawRef: "codex://raw#line=assistant-base-2"
      }
    ];
    const runtimeTailMessage = {
      ...createAssistantTextMessage("最新实时消息", "assistant-tail-1"),
      sessionId: "session-scroll-1",
      sequence: 3,
      rawRef: "codex://raw#line=assistant-tail-1"
    };
    const olderMessages = [
      {
        ...createAssistantTextMessage("更早的第一条", "assistant-older-1"),
        sessionId: "session-scroll-1",
        sequence: -1,
        rawRef: "codex://raw#line=assistant-older-1",
        timestamp: "2026-03-23T09:58:00.000Z"
      },
      {
        ...createAssistantTextMessage("更早的第二条", "assistant-older-2"),
        sessionId: "session-scroll-1",
        sequence: 0,
        rawRef: "codex://raw#line=assistant-older-2",
        timestamp: "2026-03-23T09:59:00.000Z"
      }
    ];
    const { rerender } = render(
      <MessageTimeline
        sessionId="session-scroll-1"
        historyState="ready"
        provider="codex"
        hasOlderMessages
        loadingOlderMessages={false}
        onLoadOlderMessages={handleLoadOlderMessages}
        onRetryMessage={vi.fn()}
        messages={baseMessages}
      />
    );

    const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(messageList).not.toBeNull();

    let scrollHeight = 1200;
    Object.defineProperty(messageList, "scrollHeight", {
      get: () => scrollHeight,
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
    expect(messageList!.scrollTop).toBe(0);

    rerender(
      <MessageTimeline
        sessionId="session-scroll-1"
        historyState="ready"
        provider="codex"
        hasOlderMessages
        loadingOlderMessages
        onLoadOlderMessages={handleLoadOlderMessages}
        onRetryMessage={vi.fn()}
        messages={baseMessages}
      />
    );

    scrollHeight = 1300;
    rerender(
      <MessageTimeline
        sessionId="session-scroll-1"
        historyState="ready"
        provider="codex"
        hasOlderMessages
        loadingOlderMessages
        onLoadOlderMessages={handleLoadOlderMessages}
        onRetryMessage={vi.fn()}
        messages={[...baseMessages, runtimeTailMessage]}
      />
    );

    expect(messageList!.scrollTop).toBe(0);

    scrollHeight = 1900;
    rerender(
      <MessageTimeline
        sessionId="session-scroll-1"
        historyState="ready"
        provider="codex"
        hasOlderMessages={false}
        loadingOlderMessages={false}
        onLoadOlderMessages={handleLoadOlderMessages}
        onRetryMessage={vi.fn()}
        messages={[...olderMessages, ...baseMessages, runtimeTailMessage]}
      />
    );

    expect(messageList!.scrollTop).toBe(700);
  });

  it("加载更早消息失败时，即使期间收到实时新消息，也不会误下移视口且允许再次触发加载", () => {
    const handleLoadOlderMessages = vi.fn();
    const baseMessages = [
      {
        ...createAssistantTextMessage("第一条消息", "assistant-failed-base-1"),
        sessionId: "session-scroll-failed"
      },
      {
        ...createAssistantTextMessage("第二条消息", "assistant-failed-base-2"),
        sessionId: "session-scroll-failed",
        sequence: 2,
        rawRef: "codex://raw#line=assistant-failed-base-2"
      }
    ];
    const runtimeTailMessage = {
      ...createAssistantTextMessage("最新实时消息", "assistant-failed-tail-1"),
      sessionId: "session-scroll-failed",
      sequence: 3,
      rawRef: "codex://raw#line=assistant-failed-tail-1"
    };
    const { rerender } = render(
      <MessageTimeline
        sessionId="session-scroll-failed"
        historyState="ready"
        provider="codex"
        hasOlderMessages
        loadingOlderMessages={false}
        onLoadOlderMessages={handleLoadOlderMessages}
        onRetryMessage={vi.fn()}
        messages={baseMessages}
      />
    );

    const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(messageList).not.toBeNull();

    let scrollHeight = 1200;
    Object.defineProperty(messageList, "scrollHeight", {
      get: () => scrollHeight,
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

    rerender(
      <MessageTimeline
        sessionId="session-scroll-failed"
        historyState="ready"
        provider="codex"
        hasOlderMessages
        loadingOlderMessages
        onLoadOlderMessages={handleLoadOlderMessages}
        onRetryMessage={vi.fn()}
        messages={baseMessages}
      />
    );

    scrollHeight = 1300;
    rerender(
      <MessageTimeline
        sessionId="session-scroll-failed"
        historyState="ready"
        provider="codex"
        hasOlderMessages
        loadingOlderMessages
        onLoadOlderMessages={handleLoadOlderMessages}
        onRetryMessage={vi.fn()}
        messages={[...baseMessages, runtimeTailMessage]}
      />
    );

    rerender(
      <MessageTimeline
        sessionId="session-scroll-failed"
        historyState="ready"
        provider="codex"
        hasOlderMessages
        loadingOlderMessages={false}
        onLoadOlderMessages={handleLoadOlderMessages}
        onRetryMessage={vi.fn()}
        messages={[...baseMessages, runtimeTailMessage]}
      />
    );

    expect(messageList!.scrollTop).toBe(0);

    fireEvent.scroll(messageList!, {
      target: {
        scrollTop: 0
      }
    });

    expect(handleLoadOlderMessages).toHaveBeenCalledTimes(2);
  });

  it("交错返回的工具调用和结果会保持线性顺序，不跨位置强行按 callId 配对", async () => {
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

    expect(document.querySelectorAll(".tool-message-row")).toHaveLength(4);

    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(`${t("conversation.toolPreviewCommand")}：git status --short`) })
    );
    expect(screen.getAllByText((content) => content.includes("git status --short")).length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole("button", { name: /read_thread_terminal/ })[1]!);
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

  it("切到别的会话再回来时会恢复之前的阅读进度", () => {
    const sessionOneMessages = [
      {
        ...createAssistantTextMessage("第一条消息", "assistant-restore-1"),
        sessionId: "session-1"
      },
      {
        ...createAssistantTextMessage("第二条消息", "assistant-restore-2"),
        sessionId: "session-1",
        sequence: 2,
        rawRef: "codex://raw#line=restore-2"
      }
    ];
    const sessionTwoMessages = [
      {
        ...createAssistantTextMessage("另一条会话消息", "assistant-restore-3"),
        sessionId: "session-2"
      }
    ];
    const { rerender } = render(
      <MessageTimeline
        sessionId="session-1"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={sessionOneMessages}
      />
    );

    const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(messageList).not.toBeNull();

    Object.defineProperty(messageList, "scrollHeight", {
      value: 2000,
      configurable: true
    });
    Object.defineProperty(messageList, "clientHeight", {
      value: 600,
      configurable: true
    });

    fireEvent.scroll(messageList!, {
      target: {
        scrollTop: 420
      }
    });

    expect(messageList!.scrollTop).toBe(420);

    rerender(
      <MessageTimeline
        sessionId="session-2"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={sessionTwoMessages}
      />
    );

    rerender(
      <MessageTimeline
        sessionId="session-1"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={sessionOneMessages}
      />
    );

    const restoredMessageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(restoredMessageList).not.toBeNull();
    expect(restoredMessageList!.scrollTop).toBe(420);
  });

  it("如果离开后会话尾部已经变化，仍恢复原阅读位置，并在回底按钮上提示 NEW", () => {
    const oldMessages = [
      {
        ...createAssistantTextMessage("第一条消息", "assistant-stale-1"),
        sessionId: "session-stale"
      },
      {
        ...createAssistantTextMessage("第二条消息", "assistant-stale-2"),
        sessionId: "session-stale",
        sequence: 2,
        rawRef: "codex://raw#line=stale-2"
      }
    ];
    const updatedMessages = [
      ...oldMessages,
      {
        ...createAssistantTextMessage("第三条最新消息", "assistant-stale-3"),
        sessionId: "session-stale",
        sequence: 3,
        rawRef: "codex://raw#line=stale-3"
      }
    ];
    const { rerender } = render(
      <MessageTimeline
        sessionId="session-stale"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={oldMessages}
      />
    );

    const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(messageList).not.toBeNull();

    Object.defineProperty(messageList, "scrollHeight", {
      value: 2000,
      configurable: true
    });
    Object.defineProperty(messageList, "clientHeight", {
      value: 600,
      configurable: true
    });

    fireEvent.scroll(messageList!, {
      target: {
        scrollTop: 420
      }
    });

    rerender(
      <MessageTimeline
        sessionId="session-other"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            ...createAssistantTextMessage("其他会话", "assistant-other-stale"),
            sessionId: "session-other"
          }
        ]}
      />
    );

    rerender(
      <MessageTimeline
        sessionId="session-stale"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={updatedMessages}
      />
    );

    const restoredMessageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(restoredMessageList).not.toBeNull();
    expect(restoredMessageList!.scrollTop).toBe(420);
    expect(
      screen.getByRole("button", { name: t("conversation.scrollToBottomAction") })
    ).toHaveTextContent("NEW");
  });

  it("runtime_thinking 和 runtime_notice 变化时，仍按最后一条真实消息恢复阅读位置", () => {
    const baseMessages = [
      {
        ...createAssistantTextMessage("第一条消息", "assistant-runtime-anchor-1"),
        sessionId: "session-runtime-anchor"
      },
      {
        ...createAssistantTextMessage("第二条消息", "assistant-runtime-anchor-2"),
        sessionId: "session-runtime-anchor",
        sequence: 2,
        rawRef: "codex://raw#line=runtime-anchor-2"
      }
    ];
    const initialItems = buildConversationTimelineSourceItems({
      messages: baseMessages,
      runtimeThinkingPlaceholder: "Claude 正在执行初始化",
      sessionDetail: "Claude 正在展开用户指令：/tmp/old"
    });
    const updatedItems = buildConversationTimelineSourceItems({
      messages: baseMessages,
      runtimeThinkingPlaceholder: "Claude 正在创建工作树",
      sessionDetail: "Claude 正在展开用户指令：/tmp/new"
    });
    const { rerender } = render(
      <MessageTimeline
        sessionId="session-runtime-anchor"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        items={initialItems}
      />
    );

    const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(messageList).not.toBeNull();

    Object.defineProperty(messageList, "scrollHeight", {
      value: 2000,
      configurable: true
    });
    Object.defineProperty(messageList, "clientHeight", {
      value: 600,
      configurable: true
    });

    fireEvent.scroll(messageList!, {
      target: {
        scrollTop: 420
      }
    });

    rerender(
      <MessageTimeline
        sessionId="session-runtime-anchor-other"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            ...createAssistantTextMessage("其他会话", "assistant-runtime-anchor-other"),
            sessionId: "session-runtime-anchor-other"
          }
        ]}
      />
    );

    rerender(
      <MessageTimeline
        sessionId="session-runtime-anchor"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        items={updatedItems}
      />
    );

    const restoredMessageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(restoredMessageList).not.toBeNull();
    expect(restoredMessageList!.scrollTop).toBe(420);
    const jumpButton = screen.queryByRole("button", {
      name: t("conversation.scrollToBottomAction")
    });

    expect(jumpButton?.getAttribute("data-has-new")).toBe("false");
    expect(screen.queryByText("NEW")).not.toBeInTheDocument();
  });

  it("恢复阅读位置后用户一旦滚动，就不会再被手动恢复逻辑拉回旧位置", () => {
    vi.useFakeTimers();

    try {
      const sessionOneMessages = [
        {
          ...createAssistantTextMessage("第一条消息", "assistant-interrupt-1"),
          sessionId: "session-interrupt"
        },
        {
          ...createAssistantTextMessage("第二条消息", "assistant-interrupt-2"),
          sessionId: "session-interrupt",
          sequence: 2,
          rawRef: "codex://raw#line=interrupt-2"
        }
      ];
      const { rerender } = render(
        <MessageTimeline
          sessionId="session-interrupt"
          historyState="ready"
          provider="codex"
          onRetryMessage={vi.fn()}
          messages={sessionOneMessages}
        />
      );

      const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

      expect(messageList).not.toBeNull();

      Object.defineProperty(messageList, "scrollHeight", {
        value: 2000,
        configurable: true
      });
      Object.defineProperty(messageList, "clientHeight", {
        value: 600,
        configurable: true
      });
      Object.defineProperty(messageList, "scrollTop", {
        value: 0,
        writable: true,
        configurable: true
      });

      fireEvent.scroll(messageList!, {
        target: {
          scrollTop: 420
        }
      });

      rerender(
        <MessageTimeline
          sessionId="session-interrupt-other"
          historyState="ready"
          provider="codex"
          onRetryMessage={vi.fn()}
          messages={[
            {
              ...createAssistantTextMessage("其他会话", "assistant-interrupt-other"),
              sessionId: "session-interrupt-other"
            }
          ]}
        />
      );

      rerender(
        <MessageTimeline
          sessionId="session-interrupt"
          historyState="ready"
          provider="codex"
          onRetryMessage={vi.fn()}
          messages={sessionOneMessages}
        />
      );

      expect(messageList!.scrollTop).toBe(420);

      fireEvent.wheel(messageList!, {
        deltaY: 120
      });
      fireEvent.scroll(messageList!, {
        target: {
          scrollTop: 560
        }
      });

      expect(messageList!.scrollTop).toBe(560);

      vi.advanceTimersByTime(4000);

      expect(messageList!.scrollTop).toBe(560);
    } finally {
      vi.useRealTimers();
    }
  });

  it("恢复阅读位置后用户直接拖动滚动位置，也不会再被手动恢复逻辑拉回旧位置", () => {
    vi.useFakeTimers();

    try {
      const sessionMessages = [
        {
          ...createAssistantTextMessage("第一条消息", "assistant-pointer-interrupt-1"),
          sessionId: "session-pointer-interrupt"
        },
        {
          ...createAssistantTextMessage("第二条消息", "assistant-pointer-interrupt-2"),
          sessionId: "session-pointer-interrupt",
          sequence: 2,
          rawRef: "codex://raw#line=pointer-interrupt-2"
        }
      ];
      const { rerender } = render(
        <MessageTimeline
          sessionId="session-pointer-interrupt"
          historyState="ready"
          provider="codex"
          onRetryMessage={vi.fn()}
          messages={sessionMessages}
        />
      );

      const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

      expect(messageList).not.toBeNull();

      Object.defineProperty(messageList, "scrollHeight", {
        value: 2000,
        configurable: true
      });
      Object.defineProperty(messageList, "clientHeight", {
        value: 600,
        configurable: true
      });
      Object.defineProperty(messageList, "scrollTop", {
        value: 0,
        writable: true,
        configurable: true
      });

      fireEvent.scroll(messageList!, {
        target: {
          scrollTop: 420
        }
      });

      rerender(
        <MessageTimeline
          sessionId="session-pointer-interrupt-other"
          historyState="ready"
          provider="codex"
          onRetryMessage={vi.fn()}
          messages={[
            {
              ...createAssistantTextMessage("其他会话", "assistant-pointer-interrupt-other"),
              sessionId: "session-pointer-interrupt-other"
            }
          ]}
        />
      );

      rerender(
        <MessageTimeline
          sessionId="session-pointer-interrupt"
          historyState="ready"
          provider="codex"
          onRetryMessage={vi.fn()}
          messages={sessionMessages}
        />
      );

      expect(messageList!.scrollTop).toBe(420);

      fireEvent.scroll(messageList!, {
        target: {
          scrollTop: 560
        }
      });

      expect(messageList!.scrollTop).toBe(560);

      vi.advanceTimersByTime(4000);

      expect(messageList!.scrollTop).toBe(560);
    } finally {
      vi.useRealTimers();
    }
  });

  it("移动端恢复阅读位置时不会持续 3.5 秒强制锁定滚动", () => {
    vi.useFakeTimers();
    const originalInnerWidth = window.innerWidth;

    try {
      Object.defineProperty(window, "innerWidth", {
        value: 390,
        configurable: true,
        writable: true
      });

      const sessionMessages = [
        {
          ...createAssistantTextMessage("第一条消息", "assistant-mobile-restore-1"),
          sessionId: "session-mobile-restore"
        },
        {
          ...createAssistantTextMessage("第二条消息", "assistant-mobile-restore-2"),
          sessionId: "session-mobile-restore",
          sequence: 2,
          rawRef: "codex://raw#line=mobile-restore-2"
        }
      ];
      const { rerender } = render(
        <MessageTimeline
          sessionId="session-mobile-restore"
          historyState="ready"
          provider="codex"
          onRetryMessage={vi.fn()}
          messages={sessionMessages}
        />
      );

      const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

      expect(messageList).not.toBeNull();

      Object.defineProperty(messageList, "scrollHeight", {
        value: 2000,
        configurable: true
      });
      Object.defineProperty(messageList, "clientHeight", {
        value: 600,
        configurable: true
      });
      Object.defineProperty(messageList, "scrollTop", {
        value: 0,
        writable: true,
        configurable: true
      });

      fireEvent.scroll(messageList!, {
        target: {
          scrollTop: 420
        }
      });

      rerender(
        <MessageTimeline
          sessionId="session-mobile-restore-other"
          historyState="ready"
          provider="codex"
          onRetryMessage={vi.fn()}
          messages={[
            {
              ...createAssistantTextMessage("其他会话", "assistant-mobile-restore-other"),
              sessionId: "session-mobile-restore-other"
            }
          ]}
        />
      );

      rerender(
        <MessageTimeline
          sessionId="session-mobile-restore"
          historyState="ready"
          provider="codex"
          onRetryMessage={vi.fn()}
          messages={sessionMessages}
        />
      );

      expect(messageList!.scrollTop).toBe(420);

      messageList!.scrollTop = 560;
      vi.advanceTimersByTime(4000);

      expect(messageList!.scrollTop).toBe(560);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        value: originalInnerWidth,
        configurable: true,
        writable: true
      });
      vi.useRealTimers();
    }
  });

  it("离底部较远时会显示回到底部按钮，点击后直接跳到底部", async () => {
    render(
      <MessageTimeline
        sessionId="session-bottom-button"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            ...createAssistantTextMessage("第一条", "assistant-bottom-1"),
            sessionId: "session-bottom-button"
          },
          {
            ...createAssistantTextMessage("第二条", "assistant-bottom-2"),
            sessionId: "session-bottom-button",
            sequence: 2,
            rawRef: "codex://raw#line=bottom-2"
          }
        ]}
      />
    );

    const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(messageList).not.toBeNull();

    Object.defineProperty(messageList, "scrollHeight", {
      value: 2400,
      configurable: true
    });
    Object.defineProperty(messageList, "clientHeight", {
      value: 600,
      configurable: true
    });

    fireEvent.scroll(messageList!, {
      target: {
        scrollTop: 800
      }
    });

    const jumpButton = screen.getByRole("button", {
      name: t("conversation.scrollToBottomAction")
    });

    await userEvent.click(jumpButton);

    expect(messageList!.scrollTop).toBe(2400);
    expect(
      screen.queryByRole("button", { name: t("conversation.scrollToBottomAction") })
    ).not.toBeInTheDocument();
  });

  it("有新消息提示时，点击回底按钮会清除 NEW 标记", async () => {
    const oldMessages = [
      {
        ...createAssistantTextMessage("第一条消息", "assistant-new-1"),
        sessionId: "session-new"
      },
      {
        ...createAssistantTextMessage("第二条消息", "assistant-new-2"),
        sessionId: "session-new",
        sequence: 2,
        rawRef: "codex://raw#line=new-2"
      }
    ];
    const updatedMessages = [
      ...oldMessages,
      {
        ...createAssistantTextMessage("第三条最新消息", "assistant-new-3"),
        sessionId: "session-new",
        sequence: 3,
        rawRef: "codex://raw#line=new-3"
      }
    ];
    const { rerender } = render(
      <MessageTimeline
        sessionId="session-new"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={oldMessages}
      />
    );

    const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(messageList).not.toBeNull();

    Object.defineProperty(messageList, "scrollHeight", {
      value: 2000,
      configurable: true
    });
    Object.defineProperty(messageList, "clientHeight", {
      value: 600,
      configurable: true
    });

    fireEvent.scroll(messageList!, {
      target: {
        scrollTop: 420
      }
    });

    rerender(
      <MessageTimeline
        sessionId="session-other-new"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            ...createAssistantTextMessage("其他会话", "assistant-other-new"),
            sessionId: "session-other-new"
          }
        ]}
      />
    );

    rerender(
      <MessageTimeline
        sessionId="session-new"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={updatedMessages}
      />
    );

    const jumpButton = screen.getByRole("button", {
      name: t("conversation.scrollToBottomAction")
    });

    expect(jumpButton).toHaveTextContent("NEW");

    await userEvent.click(jumpButton);

    expect(messageList!.scrollTop).toBe(2000);
    expect(
      screen.queryByRole("button", { name: t("conversation.scrollToBottomAction") })
    ).not.toBeInTheDocument();
  });

  it("启用尾部跟随后，即使当前不在底部，收到新消息也会自动贴底", () => {
    const oldMessages = [
      {
        ...createAssistantTextMessage("第一条消息", "assistant-follow-1"),
        sessionId: "session-follow"
      },
      {
        ...createAssistantTextMessage("第二条消息", "assistant-follow-2"),
        sessionId: "session-follow",
        sequence: 2,
        rawRef: "codex://raw#line=follow-2"
      }
    ];
    const updatedMessages = [
      ...oldMessages,
      {
        ...createAssistantTextMessage("第三条最新消息", "assistant-follow-3"),
        sessionId: "session-follow",
        sequence: 3,
        rawRef: "codex://raw#line=follow-3"
      }
    ];
    const { rerender } = render(
      <MessageTimeline
        sessionId="session-follow"
        historyState="ready"
        provider="codex"
        followTailUpdates
        onRetryMessage={vi.fn()}
        messages={oldMessages}
      />
    );

    const messageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(messageList).not.toBeNull();

    let scrollHeight = 2000;
    Object.defineProperty(messageList, "scrollHeight", {
      get: () => scrollHeight,
      configurable: true
    });
    Object.defineProperty(messageList, "clientHeight", {
      value: 600,
      configurable: true
    });

    fireEvent.scroll(messageList!, {
      target: {
        scrollTop: 420
      }
    });

    expect(messageList!.scrollTop).toBe(420);

    scrollHeight = 2400;
    rerender(
      <MessageTimeline
        sessionId="session-follow"
        historyState="ready"
        provider="codex"
        followTailUpdates
        onRetryMessage={vi.fn()}
        messages={updatedMessages}
      />
    );

    expect(messageList!.scrollTop).toBe(2400);
    expect(
      screen.queryByRole("button", { name: t("conversation.scrollToBottomAction") })
    ).not.toBeInTheDocument();
  });

  it("尾部跟随模式不会覆盖普通会话为同一 sessionId 记录的阅读位置", () => {
    const sessionMessages = [
      {
        ...createAssistantTextMessage("第一条消息", "assistant-shared-scroll-1"),
        sessionId: "session-shared-scroll"
      },
      {
        ...createAssistantTextMessage("第二条消息", "assistant-shared-scroll-2"),
        sessionId: "session-shared-scroll",
        sequence: 2,
        rawRef: "codex://raw#line=shared-scroll-2"
      }
    ];
    const updatedMessages = [
      ...sessionMessages,
      {
        ...createAssistantTextMessage("第三条最新消息", "assistant-shared-scroll-3"),
        sessionId: "session-shared-scroll",
        sequence: 3,
        rawRef: "codex://raw#line=shared-scroll-3"
      }
    ];
    const { rerender } = render(
      <MessageTimeline
        sessionId="session-shared-scroll"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={sessionMessages}
      />
    );

    const initialMessageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(initialMessageList).not.toBeNull();

    let scrollHeight = 2000;
    Object.defineProperty(initialMessageList, "scrollHeight", {
      get: () => scrollHeight,
      configurable: true
    });
    Object.defineProperty(initialMessageList, "clientHeight", {
      value: 600,
      configurable: true
    });

    fireEvent.scroll(initialMessageList!, {
      target: {
        scrollTop: 420
      }
    });

    expect(initialMessageList!.scrollTop).toBe(420);

    rerender(
      <MessageTimeline
        sessionId="session-other-scroll"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            ...createAssistantTextMessage("其他会话消息", "assistant-other-scroll"),
            sessionId: "session-other-scroll"
          }
        ]}
      />
    );

    scrollHeight = 2400;
    rerender(
      <MessageTimeline
        sessionId="session-shared-scroll"
        historyState="ready"
        provider="codex"
        followTailUpdates
        onRetryMessage={vi.fn()}
        messages={updatedMessages}
      />
    );

    rerender(
      <MessageTimeline
        sessionId="session-follow-tail-other"
        historyState="ready"
        provider="codex"
        followTailUpdates
        onRetryMessage={vi.fn()}
        messages={[
          {
            ...createAssistantTextMessage("观察模式其他会话", "assistant-follow-tail-other"),
            sessionId: "session-follow-tail-other"
          }
        ]}
      />
    );

    rerender(
      <MessageTimeline
        sessionId="session-shared-scroll"
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={updatedMessages}
      />
    );

    const restoredMessageList = document.querySelector(".message-list") as HTMLDivElement | null;

    expect(restoredMessageList).not.toBeNull();
    expect(restoredMessageList!.scrollTop).toBe(420);
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
                kind: "image",
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

  it("renders generic file cards for non-image attachments", () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
        messages={[
          {
            id: "pending-file-message",
            sessionId: "session-1",
            role: "user",
            kind: "text",
            content: "check file",
            toolCall: null,
            attachments: [
              {
                id: "attachment-file-1",
                kind: "file",
                fileName: "notes.md",
                mimeType: "text/markdown",
                fileSize: 256
              }
            ],
            attachmentPayloads: null,
            timestamp: "2026-03-23T10:00:02.000Z",
            sequence: 3,
            rawRef: "pending://file-1",
            deliveryState: "sending",
            clientRequestId: "file-1"
          }
        ]}
      />
    );

    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.getByText("256 B")).toBeInTheDocument();
    expect(document.querySelectorAll(".message-attachment-file-card")).toHaveLength(1);
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
  it("会默认折叠 Kimi 会话开头的系统提示词", async () => {
    render(
      <MessageTimeline
        messages={[
          createSystemMessage(`你是 Kimi Code CLI。

请先阅读工作区规则，再继续执行。`),
          {
            ...createTextMessage("继续分析当前任务"),
            id: "message-2",
            sequence: 2
          }
        ]}
        historyState="ready"
        provider="kimi"
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByText("你是 Kimi Code CLI。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(t("conversation.systemPromptExpand")) })).toBeInTheDocument();
    expect(screen.queryByText("请先阅读工作区规则，再继续执行。")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("conversation.systemPromptExpand")) }));

    expect(screen.getByRole("button", { name: new RegExp(t("conversation.systemPromptCollapse")) })).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("请先阅读工作区规则，再继续执行。"))).toBeInTheDocument();
  });
  it("代理发送标签和时间会放进同一个用户气泡 footer", () => {
    const view = render(
      <MessageTimeline
        messages={[createButlerProxyTextMessage("continue follow-up")]}
        historyState="ready"
        provider="codex"
        onRetryMessage={vi.fn()}
      />
    );

    const meta = view.container.querySelector(".user-message-footer");
    const badge = screen.getByText(t("conversation.butlerProxyMessageBadge"));
    const time = view.container.querySelector(".message-time");

    expect(meta).not.toBeNull();
    expect(time).not.toBeNull();
    expect(meta?.contains(badge)).toBe(true);
    expect(meta?.contains(time!)).toBe(true);
  });


});
