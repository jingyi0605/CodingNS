import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { MessageTimeline } from "./MessageTimeline";

import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";

const revealWorkspaceFileMock = vi.hoisted(() => vi.fn(() => false));
const getButlerFollowUpTaskMock = vi.hoisted(() => vi.fn());

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
        messages={[createAssistantTextMessage("已经收到你的请求。")]}
        historyState="ready"
        onRetryMessage={vi.fn()}
        provider="codex"
        sessionRunningState="failed"
        sessionSyncStatus="error"
        sessionLastErrorCode="CODEX_HTTP_429"
        sessionLastErrorDetail="429 Too Many Requests, request id: demo-request-id"
      />
    );

    expect(screen.getByText(t("conversation.runtimeErrorTitle"))).toBeInTheDocument();
    expect(document.querySelector(".session-runtime-error-panel__summary")?.textContent).toBe(
      "CODEX_HTTP_429 · 429 Too Many Requests, request id: demo-request-id"
    );
    expect(screen.getByText(t("conversation.runtimeErrorCodeLabel"))).toBeInTheDocument();
    expect(screen.getByText(t("conversation.runtimeErrorDetailLabel"))).toBeInTheDocument();
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

  it("会把 Claude TaskUpdate 渲染成任务卡片", async () => {
    render(
      <MessageTimeline
        historyState="ready"
        provider="claude-code"
        onRetryMessage={vi.fn()}
        messages={[
          createToolMessage({
            id: "task-update-1",
            callId: "task-update-1",
            name: "TaskUpdate",
            kind: "tool_result",
            content: JSON.stringify({
              tasks: [
                { id: "spec", title: "补 spec", status: "completed" },
                { id: "ui", title: "补时间线卡片", status: "in_progress", detail: "正在改 MessageTimeline" }
              ]
            }, null, 2),
            toolOutput: JSON.stringify({
              tasks: [
                { id: "spec", title: "补 spec", status: "completed" },
                { id: "ui", title: "补时间线卡片", status: "in_progress", detail: "正在改 MessageTimeline" }
              ]
            }, null, 2)
          })
        ]}
      />
    );

    expect(screen.getByText(t("conversation.taskCardTodoTitle"))).toBeInTheDocument();
    expect(screen.getByText("补 spec")).toBeInTheDocument();
    expect(screen.getByText("补时间线卡片")).toBeInTheDocument();
    expect(screen.getByText("正在改 MessageTimeline")).toBeInTheDocument();
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
    expect(screen.getByText("保留原始展开")).toBeInTheDocument();
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

  it("运行中的 thinking 占位只保留动态文字类名", () => {
    render(
      <MessageTimeline
        messages={[]}
        historyState="ready"
        provider="codex"
        runtimeThinkingPlaceholder="Codex 正在思考..."
        onRetryMessage={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Codex 正在思考...")).toHaveClass("thinking-status-text");
    expect(document.querySelector(".thinking-status-inline")).not.toBeNull();
    expect(document.querySelector(".thinking-status-dots")).not.toBeNull();
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
});
