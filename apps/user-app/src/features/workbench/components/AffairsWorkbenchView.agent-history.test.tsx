import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  butlerApiMock,
  butlerControlSessionsCatalogMock,
  butlerRuntimeCallsMock,
  createAgentSnapshotSession,
  createNavigationGroupsWithAgentSessions,
  createState,
  renderWorkbenchWithCustomNavigationGroups
} from "./AffairsWorkbenchView.test-support";

function createButlerControlSession(overrides: Record<string, unknown> = {}) {
  const base = {
    id: "control-session-1",
    providerId: "codex",
    sessionId: "agent-session-1",
    purpose: "chat",
    title: "Agent 对话",
    sourceItemId: null,
    status: "idle",
    lastContextVersion: null,
    lastSummary: null,
    createdAt: "2026-06-03T12:00:00.000Z",
    updatedAt: "2026-06-03T12:00:05.000Z",
    session: {
      sessionId: "agent-session-1",
      workspaceId: "workspace-2",
      provider: "codex",
      providerSessionId: "provider://codex/agent-session-1",
      rawStoreRef: "raw://codex/agent-session-1",
      providerConfigMode: "global-default",
      providerPresetId: null,
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title: "Agent 对话",
      messageCount: 2,
      lastMessageAt: "2026-06-03T12:00:05.000Z",
      createdAt: "2026-06-03T12:00:00.000Z",
      updatedAt: "2026-06-03T12:00:05.000Z",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-06-03T12:00:05.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "completed",
      activitySource: "runtime",
      lastEventAt: "2026-06-03T12:00:05.000Z",
      completedAt: "2026-06-03T12:00:05.000Z",
      lastSeenAt: null,
      activityState: "completed_unread"
    }
  };

  return {
    ...base,
    ...overrides,
    session: {
      ...base.session,
      ...((overrides as { session?: Record<string, unknown> }).session ?? {})
    }
  };
}

describe("AffairsWorkbenchView agent history", () => {
  it("事务对话页切回历史 Agent 会话时会自动恢复对应的 Butler 会话", async () => {
    butlerApiMock.resumeButlerProjectSession.mockResolvedValue({
      resumed: {
        session: {
          id: "butler-session-history-1",
          projectId: "project-2",
          sessionId: "agent-history-1",
          provider: "claude-code",
          title: "历史 Agent 会话",
          isArchived: false,
          role: "adhoc",
          ownershipMode: "managed",
          status: "idle",
          runningState: "completed",
          lastSummary: null,
          lastCheckpointAt: null,
          createdAt: "2026-06-03T11:00:00.000Z",
          updatedAt: "2026-06-03T11:05:00.000Z"
        },
        resumedAt: "2026-06-03T11:05:00.000Z",
        provider: "claude-code",
        providerSessionId: "provider://claude-code/agent-history-1"
      }
    });
    butlerControlSessionsCatalogMock.items = [
      createButlerControlSession({
        id: "control-session-history-1",
        providerId: "claude-code",
        sessionId: "agent-history-1",
        title: "历史 Agent 会话",
        session: {
          sessionId: "agent-history-1",
          workspaceId: "workspace-2",
          provider: "claude-code",
          providerSessionId: "provider://claude-code/agent-history-1",
          rawStoreRef: "raw://claude-code/agent-history-1",
          title: "历史 Agent 会话",
          messageCount: 2,
          lastMessageAt: "2026-06-03T11:05:00.000Z",
          createdAt: "2026-06-03T11:00:00.000Z",
          updatedAt: "2026-06-03T11:05:00.000Z",
          lastSyncAt: "2026-06-03T11:05:00.000Z",
          lastEventAt: "2026-06-03T11:05:00.000Z",
          completedAt: "2026-06-03T11:05:00.000Z"
        }
      })
    ];

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:agent:session:agent-history-1"
    }, createNavigationGroupsWithAgentSessions([
      createAgentSnapshotSession({
        sessionId: "agent-history-1",
        provider: "claude-code",
        title: "历史 Agent 会话",
        rawStoreRef: "butler://butler-session-history-1",
        createdAt: "2026-06-03T11:00:00.000Z",
        updatedAt: "2026-06-03T11:05:00.000Z",
        lastMessageAt: "2026-06-03T11:05:00.000Z",
        lastSyncAt: "2026-06-03T11:05:00.000Z",
        lastEventAt: "2026-06-03T11:05:00.000Z",
        completedAt: "2026-06-03T11:05:00.000Z"
      })
    ]));

    await waitFor(() => {
      expect(butlerApiMock.resumeButlerProjectSession).toHaveBeenCalledWith("project-2", "butler-session-history-1");
    });
    await waitFor(() => {
      expect(butlerRuntimeCallsMock.openControlSession).toHaveBeenCalledWith("control-session-history-1");
    });
    expect(butlerRuntimeCallsMock.initialize).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "历史 Agent 会话" })).toBeInTheDocument();
  });

  it("事务对话页恢复历史 Agent 会话后，不会再把侧边栏会话标题回滚成旧快照", async () => {
    butlerApiMock.resumeButlerProjectSession.mockResolvedValue({
      resumed: {
        session: {
          id: "butler-session-history-2",
          projectId: "project-2",
          sessionId: "agent-history-2",
          provider: "codex",
          title: "恢复后的 Agent 会话",
          isArchived: false,
          role: "adhoc",
          ownershipMode: "managed",
          status: "idle",
          runningState: "completed",
          lastSummary: null,
          lastCheckpointAt: null,
          createdAt: "2026-06-03T12:00:00.000Z",
          updatedAt: "2026-06-03T12:08:00.000Z"
        },
        resumedAt: "2026-06-03T12:08:00.000Z",
        provider: "codex",
        providerSessionId: "provider://codex/agent-history-2"
      }
    });
    butlerControlSessionsCatalogMock.items = [
      createButlerControlSession({
        id: "control-session-history-2",
        providerId: "codex",
        sessionId: "agent-history-2",
        title: "恢复后的 Agent 会话"
      })
    ];

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:agent:session:agent-history-2"
    }, createNavigationGroupsWithAgentSessions([
      createAgentSnapshotSession({
        sessionId: "agent-history-2",
        title: "旧快照标题",
        rawStoreRef: "butler://butler-session-history-2",
        createdAt: "2026-06-03T12:00:00.000Z",
        updatedAt: "2026-06-03T12:05:00.000Z",
        lastMessageAt: "2026-06-03T12:05:00.000Z",
        lastSyncAt: "2026-06-03T12:05:00.000Z",
        lastEventAt: "2026-06-03T12:05:00.000Z",
        completedAt: "2026-06-03T12:05:00.000Z"
      })
    ]));

    await waitFor(() => {
      expect(butlerApiMock.resumeButlerProjectSession).toHaveBeenCalledWith("project-2", "butler-session-history-2");
    });

    await waitFor(() => {
      expect(screen.getAllByText("恢复后的 Agent 会话").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("旧快照标题")).not.toBeInTheDocument();
  });

  it("事务对话页选中了已经不在当前快照里的 Agent 会话时，不会继续尝试恢复", async () => {
    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:agent:session:agent-missing-1"
    }, createNavigationGroupsWithAgentSessions([]));

    await act(async () => {
      await Promise.resolve();
    });

    expect(butlerApiMock.resumeButlerProjectSession).not.toHaveBeenCalled();
  });
});
