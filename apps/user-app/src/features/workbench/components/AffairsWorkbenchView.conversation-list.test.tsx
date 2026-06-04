import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { t } from "../../../shared/i18n";
import {
  butlerApiMock,
  butlerRuntimeStateMock,
  conversationApiMock,
  createAgentSnapshotSession,
  createNavigationGroupsWithAgentSessions,
  createState,
  mockAffairsConversationSidebarSessions,
  navigationGroupsWithBoundLibraryWorkspace,
  platformStateMock,
  renderWorkbenchWithCustomNavigationGroups,
  showDesktopContextMenuMock
} from "./AffairsWorkbenchView.test-support";

describe("AffairsWorkbenchView conversation list", () => {
  it("历史 Agent 会话列表只显示当前文档库绑定工作区的 CLI 会话", async () => {
    butlerRuntimeStateMock.setState({
      controlSession: {
        id: "control-session-other",
        providerId: "claude-code",
        sessionId: "agent-live-other",
        purpose: "chat",
        title: "其他工作区当前会话",
        sourceItemId: null,
        status: "idle",
        lastContextVersion: null,
        lastSummary: null,
        createdAt: "2026-06-03T12:00:00.000Z",
        updatedAt: "2026-06-03T12:00:05.000Z",
        session: {
          sessionId: "agent-live-other",
          workspaceId: "workspace-1",
          provider: "claude-code",
          providerSessionId: "provider://claude-code/agent-live-other",
          rawStoreRef: "raw://claude-code/agent-live-other",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: false,
          isFavorite: false,
          title: "其他工作区当前会话",
          messageCount: 1,
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
      }
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:agent:codex"
    }, createNavigationGroupsWithAgentSessions([
      createAgentSnapshotSession({
        sessionId: "agent-current-1",
        title: "当前工作区 Agent 会话",
        rawStoreRef: "butler://butler-session-current-1",
        createdAt: "2026-06-03T11:00:00.000Z",
        updatedAt: "2026-06-03T11:05:00.000Z",
        lastMessageAt: "2026-06-03T11:05:00.000Z",
        lastSyncAt: "2026-06-03T11:05:00.000Z",
        lastEventAt: "2026-06-03T11:05:00.000Z",
        completedAt: "2026-06-03T11:05:00.000Z"
      })
    ]));

    const conversationSidebar = await screen.findByRole("heading", { name: "对话" });
    const sidebarSection = conversationSidebar.closest(".affairs-sidebar-block");
    expect(sidebarSection).not.toBeNull();
    await waitFor(() => {
      expect(within(sidebarSection as HTMLElement).getByText("当前工作区 Agent 会话")).toBeInTheDocument();
    });
    expect(within(sidebarSection as HTMLElement).queryByText("其他工作区 Agent 会话")).not.toBeInTheDocument();
    expect(within(sidebarSection as HTMLElement).queryByText("其他工作区当前会话")).not.toBeInTheDocument();
  });

  it("事务对话侧栏会把轻量会话和 Agent 会话合并到同一份列表里", async () => {
    conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({
      items: [
        {
          sessionId: "light-session-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider://codex/light-session-1",
          rawStoreRef: "raw://codex/light-session-1",
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
    }, createNavigationGroupsWithAgentSessions([
      createAgentSnapshotSession({
        sessionId: "agent-session-merged-1",
        provider: "claude-code",
        title: "事务 Agent 会话",
        rawStoreRef: "butler://butler-session-merged-1",
        createdAt: "2026-06-03T09:00:00.000Z",
        updatedAt: "2026-06-03T09:16:00.000Z",
        lastMessageAt: "2026-06-03T09:16:00.000Z",
        lastSyncAt: "2026-06-03T09:16:00.000Z",
        lastEventAt: "2026-06-03T09:16:00.000Z",
        completedAt: "2026-06-03T09:16:00.000Z"
      })
    ]));

    expect(await screen.findByText("事务轻量会话")).toBeInTheDocument();
    expect(await screen.findByText("事务 Agent 会话")).toBeInTheDocument();

    const sidebar = document.querySelector(".affairs-sidebar-block");
    expect(sidebar).not.toBeNull();

    expect(sidebar?.querySelectorAll(".affairs-sidebar-group")).toHaveLength(1);
    expect(within(sidebar as HTMLElement).queryByText("当前准备创建的会话")).not.toBeInTheDocument();
    expect(within(sidebar as HTMLElement).queryByText("轻量会话")).not.toBeInTheDocument();
    expect(within(sidebar as HTMLElement).queryByText("Agent 会话")).not.toBeInTheDocument();
    expect(sidebar?.querySelectorAll(".affairs-conversation-session-card")).toHaveLength(2);
  });

  it("事务会话列表在网页端右键菜单会包含完整操作", async () => {
    mockAffairsConversationSidebarSessions();
    platformStateMock.platform = "web";
    platformStateMock.isDesktop = false;
    platformStateMock.isWeb = true;

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    const menu = await screen.findByRole("menu", { name: t("shell.sessionMoreAction") });
    expect(within(menu).getByRole("button", { name: t("shell.renameAction") })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: t("conversation.exportAction") })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: t("shell.favoriteAction") })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: t("shell.archiveAction") })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: t("shell.deleteSessionAction") })).toBeInTheDocument();
  });

  it("事务会话列表桌面端右键菜单会包含完整操作", async () => {
    mockAffairsConversationSidebarSessions();

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: t("shell.renameAction") }),
      expect.objectContaining({ label: t("conversation.exportAction") }),
      expect.objectContaining({ label: t("shell.favoriteAction") }),
      expect.objectContaining({ label: t("shell.archiveAction") }),
      expect.objectContaining({ label: t("shell.deleteSessionAction") })
    ]));
    const exportItem = items.find((entry: { label?: string }) => entry.label === t("conversation.exportAction"));
    expect(exportItem).toEqual(expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({ label: t("conversation.exportMarkdownAction") }),
        expect.objectContaining({ label: t("conversation.exportPdfAction") }),
        expect.objectContaining({ label: t("conversation.exportHtmlAction") })
      ])
    }));
  });

  it("事务会话列表收藏操作会更新卡片标记", async () => {
    const { lightweightSession } = mockAffairsConversationSidebarSessions();
    conversationApiMock.updateAffairsLightweightSessionFavoriteState.mockResolvedValue({
      ...lightweightSession,
      isFavorite: true
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const favoriteItem = items.find((entry: { label?: string }) => entry.label === t("shell.favoriteAction"));
    expect(favoriteItem).toBeTruthy();
    if (!favoriteItem || !("onSelect" in favoriteItem)) {
      throw new Error("未找到收藏菜单项");
    }

    await act(async () => {
      await favoriteItem.onSelect();
    });

    expect(conversationApiMock.updateAffairsLightweightSessionFavoriteState).toHaveBeenCalledWith("workspace-1", "light-session-1", true);
    await waitFor(() => {
      expect((sessionCard as HTMLElement).querySelector(".affairs-conversation-favorite-badge")).not.toBeNull();
    });
  });

  it("事务会话列表归档操作后会从主列表移除会话", async () => {
    const { lightweightSession } = mockAffairsConversationSidebarSessions();
    conversationApiMock.updateAffairsLightweightSessionArchiveState.mockResolvedValue({
      ...lightweightSession,
      isArchived: true
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const archiveItem = items.find((entry: { label?: string }) => entry.label === t("shell.archiveAction"));
    expect(archiveItem).toBeTruthy();
    if (!archiveItem || !("onSelect" in archiveItem)) {
      throw new Error("未找到归档菜单项");
    }

    await act(async () => {
      await archiveItem.onSelect();
    });

    expect(conversationApiMock.updateAffairsLightweightSessionArchiveState).toHaveBeenCalledWith("workspace-1", "light-session-1", true);
    await waitFor(() => {
      expect(screen.queryByText("事务轻量会话")).not.toBeInTheDocument();
    });
  });

  it("事务会话侧栏存在归档会话时会显示归档会话按钮", async () => {
    conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({
      items: [
        {
          sessionId: "archived-light-session-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider://codex/archived-light-session-1",
          rawStoreRef: "raw://codex/archived-light-session-1",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: true,
          isFavorite: false,
          title: "已归档轻量会话",
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
    }, navigationGroupsWithBoundLibraryWorkspace);

    const archiveButton = await screen.findByRole("button", { name: /归档会话/i });
    expect(archiveButton).toBeInTheDocument();
    expect(within(archiveButton).getByText("1")).toBeInTheDocument();
  });

  it("事务会话侧栏可以打开归档会话列表并取消归档", async () => {
    conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({
      items: [
        {
          sessionId: "archived-light-session-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider://codex/archived-light-session-1",
          rawStoreRef: "raw://codex/archived-light-session-1",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: true,
          isFavorite: false,
          title: "已归档轻量会话",
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
    conversationApiMock.updateAffairsLightweightSessionArchiveState.mockResolvedValue({
      sessionId: "archived-light-session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider://codex/archived-light-session-1",
      rawStoreRef: "raw://codex/archived-light-session-1",
      providerConfigMode: "global-default",
      providerPresetId: null,
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title: "已归档轻量会话",
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
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    await userEvent.click(await screen.findByRole("button", { name: /归档会话/i }));
    expect(await screen.findByRole("dialog", { name: "归档会话" })).toBeInTheDocument();
    expect(screen.getByText("已归档轻量会话")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "取消归档" }));

    await waitFor(() => {
      expect(conversationApiMock.updateAffairsLightweightSessionArchiveState).toHaveBeenCalledWith(
        "workspace-1",
        "archived-light-session-1",
        false
      );
    });
    await waitFor(() => {
      expect(screen.getByText("已归档轻量会话")).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog", { name: "归档会话" })).not.toBeInTheDocument();
  });

  it("事务会话列表重命名操作会调用重命名接口", async () => {
    const { lightweightSession } = mockAffairsConversationSidebarSessions();
    conversationApiMock.renameAffairsLightweightSessionTitle.mockResolvedValue({
      ...lightweightSession,
      title: "已重命名会话"
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const renameItem = items.find((entry: { label?: string }) => entry.label === t("shell.renameAction"));
    expect(renameItem).toBeTruthy();
    if (!renameItem || !("onSelect" in renameItem)) {
      throw new Error("未找到重命名菜单项");
    }

    await act(async () => {
      await renameItem.onSelect();
    });

    const input = await screen.findByLabelText(t("shell.renameInputLabel"));
    await userEvent.clear(input);
    await userEvent.type(input, "已重命名会话");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));

    await waitFor(() => {
      expect(conversationApiMock.renameAffairsLightweightSessionTitle).toHaveBeenCalledWith("workspace-1", "light-session-1", "已重命名会话");
    });
    expect(await screen.findByText("已重命名会话")).toBeInTheDocument();
  });

  it("事务会话列表删除操作会调用删除接口", async () => {
    mockAffairsConversationSidebarSessions();
    conversationApiMock.deleteAffairsLightweightSession.mockResolvedValue(undefined);

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const deleteItem = items.find((entry: { label?: string }) => entry.label === t("shell.deleteSessionAction"));
    expect(deleteItem).toBeTruthy();
    if (!deleteItem || !("onSelect" in deleteItem)) {
      throw new Error("未找到删除菜单项");
    }

    await act(async () => {
      await deleteItem.onSelect();
    });

    expect(await screen.findByText(t("shell.deleteSessionConfirmDescription"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("shell.deleteSessionAction") }));

    await waitFor(() => {
      expect(conversationApiMock.deleteAffairsLightweightSession).toHaveBeenCalledWith("workspace-1", "light-session-1");
    });
    await waitFor(() => {
      expect(screen.queryByText("事务轻量会话")).not.toBeInTheDocument();
    });
  });

  it("事务会话列表导出操作会调用消息加载接口", async () => {
    mockAffairsConversationSidebarSessions();
    conversationApiMock.getAffairsLightweightSessionMessages.mockResolvedValue({ messages: [], cursor: null, nextCursor: null, total: 0 });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const exportItem = items.find((entry: { label?: string; items?: Array<{ label?: string; onSelect?: () => void | Promise<void> }> }) => entry.label === t("conversation.exportAction"));
    expect(exportItem).toBeTruthy();
    const markdownItem = exportItem?.items?.find((entry) => entry.label === t("conversation.exportMarkdownAction"));
    expect(markdownItem).toBeTruthy();
    if (!markdownItem || !("onSelect" in markdownItem)) {
      throw new Error("未找到导出 markdown 菜单项");
    }

    await act(async () => {
      await markdownItem.onSelect?.();
    });

    await waitFor(() => {
      expect(conversationApiMock.getAffairsLightweightSessionMessages).toHaveBeenCalledWith("workspace-1", "light-session-1");
    });
  });
});
