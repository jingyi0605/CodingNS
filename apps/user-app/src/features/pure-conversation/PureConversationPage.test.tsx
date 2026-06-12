import "../workbench/components/AffairsWorkbenchView.test-support";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { conversationApiMock } from "../workbench/components/AffairsWorkbenchView.test-support";
import { PureConversationPage } from "./PureConversationPage";

describe("PureConversationPage", () => {
  it("新建轻量会话切到真实 chatId 后，列表未刷新前仍保留流式状态", async () => {
    const user = userEvent.setup();
    let releaseCompletion: (() => void) | null = null;

    conversationApiMock.listAffairsLightweightSessions.mockImplementation(
      async () => await new Promise((resolve) => {
        window.setTimeout(() => resolve({ items: [] }), 50);
      })
    );
    conversationApiMock.getAffairsLightweightSession.mockResolvedValue({
      sessionId: "session-light-live",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "affairs-lightweight:codex:session-light-live",
      rawStoreRef: "session-light-live.json",
      providerConfigMode: "global-default",
      providerPresetId: null,
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title: "实时轻量对话",
      messageCount: 2,
      lastMessageAt: "2026-06-12T10:00:05.000Z",
      createdAt: "2026-06-12T10:00:00.000Z",
      updatedAt: "2026-06-12T10:00:05.000Z",
      syncStatus: "syncing",
      syncCursor: null,
      lastSyncAt: "2026-06-12T10:00:05.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "running",
      activitySource: "runtime",
      lastEventAt: "2026-06-12T10:00:05.000Z",
      completedAt: null,
      lastSeenAt: null,
      activityState: "running"
    });
    conversationApiMock.getAffairsLightweightSessionMessages.mockResolvedValue({
      messages: [],
      cursor: null,
      nextCursor: null,
      total: 0
    });
    conversationApiMock.startAffairsLightweightSessionStream.mockImplementation(async (_workspaceId, _payload, onEvent) => {
      const completedResult = {
        session: {
          sessionId: "session-light-live",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-live",
          rawStoreRef: "session-light-live.json",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: false,
          isFavorite: false,
          title: "实时轻量对话",
          messageCount: 2,
          lastMessageAt: "2026-06-12T10:00:05.000Z",
          createdAt: "2026-06-12T10:00:00.000Z",
          updatedAt: "2026-06-12T10:00:05.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-06-12T10:00:05.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "completed",
          activitySource: "runtime",
          lastEventAt: "2026-06-12T10:00:05.000Z",
          completedAt: "2026-06-12T10:00:05.000Z",
          lastSeenAt: null,
          activityState: "completed_unread"
        },
        acceptedAt: "2026-06-12T10:00:00.000Z",
        clientRequestId: "client-request-live",
        userMessage: {
          messageId: "user-live-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-live",
          role: "user",
          kind: "text",
          content: "请帮我查一下今天的事务重点",
          timestamp: "2026-06-12T10:00:00.000Z",
          rawRef: "pending://client-request-live",
          sequence: 1,
          toolCall: null,
          attachments: []
        },
        assistantMessage: {
          messageId: "assistant-live-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-live",
          role: "assistant",
          kind: "text",
          content: "正在搜索",
          timestamp: "2026-06-12T10:00:05.000Z",
          rawRef: "assistant://assistant-live-1",
          sequence: 2,
          toolCall: null,
          attachments: []
        },
        messages: [
          {
            messageId: "user-live-1",
            provider: "codex",
            providerSessionId: "affairs-lightweight:codex:session-light-live",
            role: "user",
            kind: "text",
            content: "请帮我查一下今天的事务重点",
            timestamp: "2026-06-12T10:00:00.000Z",
            rawRef: "pending://client-request-live",
            sequence: 1,
            toolCall: null,
            attachments: []
          },
          {
            messageId: "assistant-live-1",
            provider: "codex",
            providerSessionId: "affairs-lightweight:codex:session-light-live",
            role: "assistant",
            kind: "text",
            content: "正在搜索",
            timestamp: "2026-06-12T10:00:05.000Z",
            rawRef: "assistant://assistant-live-1",
            sequence: 2,
            toolCall: null,
            attachments: []
          }
        ]
      };
      await onEvent({
        type: "started",
        session: {
          sessionId: "session-light-live",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-live",
          rawStoreRef: "session-light-live.json",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: false,
          isFavorite: false,
          title: "实时轻量对话",
          messageCount: 1,
          lastMessageAt: "2026-06-12T10:00:00.000Z",
          createdAt: "2026-06-12T10:00:00.000Z",
          updatedAt: "2026-06-12T10:00:00.000Z",
          syncStatus: "syncing",
          syncCursor: null,
          lastSyncAt: "2026-06-12T10:00:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "running",
          activitySource: "runtime",
          lastEventAt: "2026-06-12T10:00:00.000Z",
          completedAt: null,
          lastSeenAt: null,
          activityState: "running"
        },
        acceptedAt: "2026-06-12T10:00:00.000Z",
        clientRequestId: "client-request-live",
        userMessage: {
          messageId: "user-live-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-live",
          role: "user",
          kind: "text",
          content: "请帮我查一下今天的事务重点",
          timestamp: "2026-06-12T10:00:00.000Z",
          rawRef: "pending://client-request-live",
          sequence: 1,
          toolCall: null,
          attachments: []
        }
      });
      await onEvent({
        type: "tool",
        toolCallId: "tool-call-live",
        toolName: "web_search",
        status: "running",
        detail: "正在联网搜索",
        input: null,
        output: null
      });
      await onEvent({ type: "delta", delta: "正在搜索" });
      await new Promise<void>((resolve) => {
        releaseCompletion = resolve;
      });
      await onEvent({
        type: "completed",
        result: completedResult
      });
      return completedResult;
    });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/chats/new?provider=codex"]}>
        <Routes>
          <Route path="/workspaces/:workspaceId/chats/new" element={<PureConversationPage />} />
          <Route path="/workspaces/:workspaceId/chats/:chatId" element={<PureConversationPage />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(await screen.findByTestId("affairs-composer-send"));

    await waitFor(() => {
      expect(conversationApiMock.startAffairsLightweightSessionStream).toHaveBeenCalledWith(
        "workspace-1",
        expect.objectContaining({
          provider: "codex",
          content: "请帮我查一下今天的事务重点"
        }),
        expect.any(Function)
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("affairs-timeline")).toHaveTextContent("session-light-live:0");
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("正在联网搜索");
    });

    releaseCompletion?.();

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
