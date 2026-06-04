import { render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { t } from "../../../shared/i18n";
import {
  butlerRuntimeCallsMock,
  butlerRuntimeStateMock,
  conversationApiMock,
  createAgentSnapshotSession,
  createConversationState,
  createNavigationGroupsWithAgentSessions,
  createState,
  navigationGroups,
  navigationGroupsWithBoundLibraryWorkspace,
  renderWorkbenchWithCustomNavigationGroups
} from "./AffairsWorkbenchView.test-support";
import {
  AffairsAuxiliaryPanel,
  AffairsSectionMenu,
  AffairsSidebarPanel,
  AffairsWorkbenchProvider,
  AffairsWorkbenchView
} from "./AffairsWorkbenchView";

describe("AffairsWorkbenchView assistant panel", () => {
  it("辅助面板从连接检查切回正常态时不会触发 hooks 顺序错误", async () => {
    butlerRuntimeStateMock.setState({
      initialized: false,
      loading: true,
      bootstrapErrorCode: null,
      error: null,
      profile: null,
      activeProvider: "codex"
    });

    function TestHarness(): ReactElement {
      const [state, setState] = useState(createState());

      return (
        <AffairsWorkbenchProvider
          workspaceId="workspace-1"
          workspaceName="事务工作区"
          navigationGroups={navigationGroups}
          state={state}
          onStateChange={setState}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <AffairsSectionMenu />
            <AffairsSidebarPanel />
            <AffairsWorkbenchView workspaceId="workspace-1" />
            <AffairsAuxiliaryPanel workspaceId="workspace-1" />
          </div>
        </AffairsWorkbenchProvider>
      );
    }

    const view = render(<TestHarness />);

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsConnectionCheckingTitle"))).not.toBeInTheDocument();

    butlerRuntimeStateMock.setState({
      initialized: true,
      loading: false,
      bootstrapErrorCode: null,
      error: null,
      profile: {
        displayName: "事务助手",
        providerId: "codex",
        persona: {
          tone: "direct"
        }
      },
      activeProvider: "codex"
    });

    view.rerender(<TestHarness />);

    expect(await screen.findByRole("tab", { name: t("shell.affairsDetailTitle") })).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsConnectionCheckingAuxiliaryEmpty"))).not.toBeInTheDocument();
  });

  it("右侧事务助手会补齐 provider 和 workspacePath 后再发送消息", async () => {
    const user = userEvent.setup();
    butlerRuntimeStateMock.setState({
      initialized: true,
      loading: false,
      bootstrapErrorCode: null,
      error: null,
      profile: {
        displayName: "事务助手",
        providerId: "codex",
        workspacePath: "/tmp/workspace-1",
        persona: {
          tone: "direct"
        }
      },
      activeProvider: null,
      capabilities: null
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      auxiliaryTab: "assistant"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    await user.click(card);
    expect(screen.queryByText("事务文档摘要")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("affairs-composer-send"));

    await waitFor(() => {
      expect(butlerRuntimeCallsMock.switchProvider).toHaveBeenCalledWith("codex");
      expect(butlerRuntimeCallsMock.updateProfile).toHaveBeenCalledWith({
        workspacePath: "/Users/jackson/SynologyDrive"
      });
      expect(butlerRuntimeCallsMock.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining("当前事务对象：Exchange 分层通讯簿.txt")
      );
    });
  });

  it("右侧事务助手头部只在助手页显示专属按钮，历史会话弹层带遮罩且只显示未归档会话", async () => {
    const user = userEvent.setup();
    conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({
      items: [
        {
          sessionId: "light-session-history-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider://codex/light-session-history-1",
          rawStoreRef: "raw://codex/light-session-history-1",
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
        },
        {
          sessionId: "light-session-archived-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider://codex/light-session-archived-1",
          rawStoreRef: "raw://codex/light-session-archived-1",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: true,
          isFavorite: false,
          title: "已归档轻量会话",
          messageCount: 2,
          lastMessageAt: "2026-06-02T09:30:00.000Z",
          createdAt: "2026-06-02T09:00:00.000Z",
          updatedAt: "2026-06-02T09:30:00.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-06-02T09:30:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "completed",
          activitySource: "runtime",
          lastEventAt: "2026-06-02T09:30:00.000Z",
          completedAt: "2026-06-02T09:30:00.000Z",
          lastSeenAt: null,
          activityState: "completed_unread"
        }
      ]
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      auxiliaryTab: "assistant"
    }, createNavigationGroupsWithAgentSessions([
      createAgentSnapshotSession({
        sessionId: "agent-session-history-1",
        title: "事务 Agent 会话"
      }),
      createAgentSnapshotSession({
        sessionId: "agent-session-archived-1",
        title: "已归档 Agent 会话",
        isArchived: true
      })
    ]));

    const assistantTab = await screen.findByRole("tab", { name: t("shell.affairsAssistantTitle") });
    const detailTab = screen.getByRole("tab", { name: t("shell.affairsDetailTitle") });
    expect(screen.getByRole("button", { name: t("shell.butlerHistoryAction") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.butlerNewSessionAction") })).toBeInTheDocument();
    expect(assistantTab).toHaveClass("workbench-info-tab", "active");
    expect(detailTab).toHaveClass("workbench-info-tab");

    await user.click(screen.getByRole("button", { name: t("shell.butlerHistoryAction") }));

    expect(document.querySelector(".affairs-assistant-history-backdrop")).not.toBeNull();
    expect(await screen.findByText("事务 Agent 会话")).toBeInTheDocument();
    expect(await screen.findByText("事务轻量会话")).toBeInTheDocument();
    expect(screen.queryByText("已归档轻量会话")).toBeNull();
    expect(screen.queryByText("已归档 Agent 会话")).toBeNull();
    expect(document.querySelector(".affairs-assistant-footer")).toBeNull();

    await user.click(screen.getByRole("button", { name: t("shell.butlerNewSessionAction") }));

    const createDialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    const createDialogScope = within(createDialog);
    expect(createDialogScope.getByText(/\/Users\/jackson\/WorkFile/)).toBeInTheDocument();
    expect(createDialogScope.queryByText(/当前文档库：事务工作区/)).toBeNull();
    expect(createDialogScope.queryByText("轻量模式")).toBeNull();
    expect(createDialogScope.getByText("助手模式")).toBeInTheDocument();
    expect(createDialogScope.getAllByRole("button", { name: "Codex" })).toHaveLength(1);
    expect(createDialogScope.getAllByRole("button", { name: "Claude Code" })).toHaveLength(1);

    await user.click(detailTab);

    expect(screen.queryByRole("button", { name: t("shell.butlerHistoryAction") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("shell.butlerNewSessionAction") })).toBeNull();
    expect(screen.getByRole("tab", { name: t("shell.affairsDetailTitle") })).toHaveClass("workbench-info-tab", "active");
    expect(screen.getByRole("tab", { name: t("shell.affairsAssistantTitle") })).toHaveClass("workbench-info-tab");
  });

  it("事务模式初始化完成后会自动切到文档库", async () => {
    const user = userEvent.setup();
    butlerRuntimeStateMock.setState({
      initialized: false,
      profile: null,
      activeProvider: "codex"
    });

    function TestHarness(): ReactElement {
      const [state, setState] = useState(createConversationState());

      return (
        <AffairsWorkbenchProvider
          workspaceId="workspace-1"
          workspaceName="事务工作区"
          navigationGroups={navigationGroups}
          state={state}
          onStateChange={setState}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <AffairsSectionMenu />
            <AffairsSidebarPanel />
            <AffairsWorkbenchView workspaceId="workspace-1" />
            <AffairsAuxiliaryPanel workspaceId="workspace-1" />
          </div>
        </AffairsWorkbenchProvider>
      );
    }

    const view = render(<TestHarness />);

    const submitButton = await screen.findByRole("button", { name: t("shell.affairsInitSubmit") });
    await user.type(screen.getByPlaceholderText(t("shell.butlerDisplayNamePlaceholder")), "哆哆");
    await user.click(submitButton);

    await waitFor(() => {
      expect(conversationApiMock.saveGlobalAffairsLibraryBinding).toHaveBeenCalledWith({
        rootDir: "/Users/jackson/WorkFile"
      });
    });
    await waitFor(() => {
      expect(conversationApiMock.setGlobalAffairsLibraryEnabled).toHaveBeenCalledWith({
        enabled: true
      });
    });

    view.rerender(<TestHarness />);

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("shell.affairsLibraryNav") })).toHaveAttribute("aria-selected", "true");
  });
});
