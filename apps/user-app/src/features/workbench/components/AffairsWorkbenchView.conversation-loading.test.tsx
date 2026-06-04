import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { t } from "../../../shared/i18n";
import { writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import {
  butlerApiMock,
  conversationApiMock,
  createAgentSnapshotSession,
  createNavigationGroupsWithAgentSessions,
  createState,
  navigationGroups,
  renderWorkbenchWithCustomNavigationGroups,
  renderWorkbenchWithState
} from "./AffairsWorkbenchView.test-support";

describe("AffairsWorkbenchView conversation loading", () => {
  it("文档首页初次渲染时不会提前预热事务对话列表，切到对话后才开始加载", async () => {
    const user = userEvent.setup();
    renderWorkbenchWithState(createState());

    await screen.findByText("Exchange 分层通讯簿.txt");

    expect(conversationApiMock.listAffairsLightweightSessions).not.toHaveBeenCalled();
    expect(butlerApiMock.listButlerProjects).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "对话" }));

    await waitFor(() => {
      expect(conversationApiMock.listAffairsLightweightSessions).toHaveBeenCalledWith("workspace-1");
    });
    expect(butlerApiMock.listButlerProjects).not.toHaveBeenCalled();
  });

  it("事务对话侧栏已有轻量会话时，不会继续被助手会话加载占位挡住", async () => {
    conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({
      items: [
        {
          sessionId: "light-session-visible-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider://codex/light-session-visible-1",
          rawStoreRef: "raw://codex/light-session-visible-1",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: false,
          isFavorite: false,
          title: "事务轻量会话",
          messageCount: 3,
          lastMessageAt: "2026-06-03T12:48:00.000Z",
          createdAt: "2026-06-03T12:30:00.000Z",
          updatedAt: "2026-06-03T12:48:00.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-06-03T12:48:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "completed",
          activitySource: "runtime",
          lastEventAt: "2026-06-03T12:48:00.000Z",
          completedAt: "2026-06-03T12:48:00.000Z",
          lastSeenAt: null,
          activityState: "completed_unread"
        }
      ]
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroups);

    const sidebarHeading = await screen.findByRole("heading", { name: "对话" });
    const sidebarSection = sidebarHeading.closest(".affairs-sidebar-block");
    expect(sidebarSection).not.toBeNull();
    expect(await within(sidebarSection as HTMLElement).findByText("事务轻量会话")).toBeInTheDocument();
    expect(within(sidebarSection as HTMLElement).queryByText(t("common.loading"))).not.toBeInTheDocument();
    expect(within(sidebarSection as HTMLElement).queryByText(t("shell.affairsConversationSidebarLoadingAgent"))).not.toBeInTheDocument();
  });

  it("事务对话刷新时会先显示缓存的轻量会话标题，再后台刷新更新", async () => {
    writeViewSnapshot("affairs.conversation.lightweight.sessions.workspace-1", [
      {
        sessionId: "light-session-cached-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "provider://codex/light-session-cached-1",
        rawStoreRef: "raw://codex/light-session-cached-1",
        providerConfigMode: "global-default",
        providerPresetId: null,
        parentSessionId: null,
        isSubagent: false,
        subagentLabel: null,
        isArchived: false,
        isFavorite: false,
        title: "缓存轻量会话",
        messageCount: 2,
        lastMessageAt: "2026-06-03T12:40:00.000Z",
        createdAt: "2026-06-03T12:10:00.000Z",
        updatedAt: "2026-06-03T12:40:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: "2026-06-03T12:40:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "completed",
        activitySource: "runtime",
        lastEventAt: "2026-06-03T12:40:00.000Z",
        completedAt: "2026-06-03T12:40:00.000Z",
        lastSeenAt: null,
        activityState: "completed_unread"
      }
    ]);
    let resolveLightweightSessions: ((value: { items: Array<unknown> }) => void) | null = null;
    conversationApiMock.listAffairsLightweightSessions.mockImplementation(
      () => new Promise((resolve) => {
        resolveLightweightSessions = resolve;
      })
    );
    butlerApiMock.listButlerProjects.mockResolvedValue({ items: [] });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroups);

    const sidebarHeading = await screen.findByRole("heading", { name: "对话" });
    const sidebarSection = sidebarHeading.closest(".affairs-sidebar-block");
    expect(sidebarSection).not.toBeNull();
    expect(within(sidebarSection as HTMLElement).getByText("缓存轻量会话")).toBeInTheDocument();
    expect(within(sidebarSection as HTMLElement).getByText(t("shell.affairsConversationSidebarLoadingLightweight"))).toBeInTheDocument();

    resolveLightweightSessions?.({
      items: [
        {
          sessionId: "light-session-fresh-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider://codex/light-session-fresh-1",
          rawStoreRef: "raw://codex/light-session-fresh-1",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: false,
          isFavorite: false,
          title: "刷新后的轻量会话",
          messageCount: 3,
          lastMessageAt: "2026-06-03T12:58:00.000Z",
          createdAt: "2026-06-03T12:50:00.000Z",
          updatedAt: "2026-06-03T12:58:00.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-06-03T12:58:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "completed",
          activitySource: "runtime",
          lastEventAt: "2026-06-03T12:58:00.000Z",
          completedAt: "2026-06-03T12:58:00.000Z",
          lastSeenAt: null,
          activityState: "completed_unread"
        }
      ]
    });

    await waitFor(() => {
      expect(within(sidebarSection as HTMLElement).getByText("刷新后的轻量会话")).toBeInTheDocument();
    });
    expect(within(sidebarSection as HTMLElement).queryByText("缓存轻量会话")).not.toBeInTheDocument();
  });

  it("事务对话刷新时会先显示缓存的助手会话标题，不再等实时检索完成", async () => {
    conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({ items: [] });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:agent:codex"
    }, createNavigationGroupsWithAgentSessions([
      createAgentSnapshotSession({
        sessionId: "agent-session-cached-1",
        title: "缓存助手会话",
        rawStoreRef: "butler://agent-session-cached-1"
      })
    ]));

    const sidebarHeading = await screen.findByRole("heading", { name: "对话" });
    const sidebarSection = sidebarHeading.closest(".affairs-sidebar-block");
    expect(sidebarSection).not.toBeNull();
    expect(within(sidebarSection as HTMLElement).getByText("缓存助手会话")).toBeInTheDocument();
    expect(within(sidebarSection as HTMLElement).queryByText(t("shell.affairsConversationSidebarLoadingAgent"))).not.toBeInTheDocument();
    expect(within(sidebarSection as HTMLElement).queryByText(t("common.loading"))).not.toBeInTheDocument();
  });
});
