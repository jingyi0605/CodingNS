import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { authStore } from "../../auth/store/auth-store";
import { clientConfigStore } from "../../../config/client-config-store";
import { localUiPreferenceStore } from "../../../preferences/local-ui-preference-store";
import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import {
  flattenVisibleSessionTree,
  getTreeNodeChildren,
  getVisibleSessionTreeNodes,
  reorderWorkspaceGroups
} from "./WorkbenchLayout";
import {
  ButlerAuxiliaryProbe,
  CurrentLocationProbe,
  MockWebSocket,
  NoSnapshotWebSocket,
  StartDraftSessionProbe,
  WORKBENCH_NAVIGATION_SNAPSHOT_KEY,
  clickOpenSessionToastActionByTitle,
  createAvailableCapabilities,
  createDragDataTransfer,
  createJsonResponse,
  createPermissionRequest,
  createSessionSummary,
  createSkillOverviewResponse,
  createUnavailableCapabilities,
  createWorkbenchSnapshot,
  createWorkbenchWorktreeNode,
  createWorkspace,
  createWorkspaceManagementSummary,
  findSessionCardByTitle,
  findWorkspaceGroupByName,
  getSessionCardByTitle,
  mockAffairsLibraryFetch,
  mockNavigator,
  openFilesExternalWindowMock,
  openGitExternalWindowMock,
  openProcessesExternalWindowMock,
  openSessionCardContextMenu,
  querySessionCardsByTitle,
  readWorkspaceGroupOrder,
  registerWorkbenchLayoutTestHooks,
  renderWorkbenchRoute,
  showDesktopContextMenuMock
} from "./WorkbenchLayout.test-support";

describe("WorkbenchLayout", () => {
  registerWorkbenchLayoutTestHooks();

  it("事务视图点击底部设置按钮后会切到设置路由，并保留事务侧栏态", async () => {
    mockAffairsLibraryFetch();
    MockWebSocket.workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话一",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);
    const user = userEvent.setup();
    const view = renderWorkbenchRoute("/workspaces/workspace-1/affairs");
    await screen.findByRole("tab", { name: t("shell.affairsLibraryNav") });
    const settingsButton = view.container.querySelector(".workbench-nav-settings-button");

    if (!(settingsButton instanceof HTMLElement)) {
      throw new Error("未找到设置按钮");
    }

    await user.click(settingsButton);

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/settings");
    });
    expect(screen.getByRole("tab", { name: t("shell.workbenchModeCode") })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: t("shell.workbenchModeAffairs") })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: t("shell.affairsLibraryNav") })).toBeInTheDocument();
  });

  it("顶层模式切到事务后会进入 affairs 路由，并保留切回代码能力", async () => {
    mockAffairsLibraryFetch();
    MockWebSocket.workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话一",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);
    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    await userEvent.click(await screen.findByRole("tab", { name: t("shell.workbenchModeAffairs") }));
    expect(await screen.findByRole("tab", { name: t("shell.workbenchModeAffairs") })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tab", { name: t("shell.affairsLibraryNav") })).toBeInTheDocument();
    expect(document.querySelector('.workbench-nav[data-collapsed="false"]')).not.toBeNull();
    expect(document.querySelector(".workbench-auxiliary")).not.toBeNull();
    expect(screen.queryByTestId("current-path")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: t("shell.workbenchModeCode") }));
    expect(await screen.findByTestId("current-path")).toHaveTextContent("/workspaces/workspace-1/sessions/session-1");
  });

  it("事务模式入口不会复用错误写入的设置页路径", async () => {
    writeViewSnapshot("workbench.mode.affairs.last-path.workspace-1", "/settings");
    writeViewSnapshot("workbench.affairs.state.workspace-1", {
      workspaceId: "workspace-1",
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex",
      selectedObjectId: null,
      toolbarExpanded: false,
      detailViewerCollapsed: false,
      auxiliaryTab: "detail",
      browseMode: "folder",
      viewMode: "grid",
      selectedFolderPath: null,
      selectedFolderEntryPath: null,
      selectedTagPath: null,
      selectedTagPaths: [],
      selectedDocumentId: null,
      selectedFavoriteId: null
    });
    mockAffairsLibraryFetch();
    MockWebSocket.workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话一",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    await userEvent.click(await screen.findByRole("tab", { name: t("shell.workbenchModeAffairs") }));
    expect(await screen.findByRole("tab", { name: t("shell.workbenchModeAffairs") })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tab", { name: t("shell.affairsLibraryNav") })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("shell.affairsConversationNav") })).toBeInTheDocument();
    expect(screen.queryByTestId("current-path")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: t("settings.title") })).not.toBeInTheDocument();
  });

  it("从事务设置页点击事务分区时会先回到 affairs 路由，再显示对应事务内容", async () => {
    mockAffairsLibraryFetch();
    MockWebSocket.workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话一",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);

    const user = userEvent.setup();
    const view = renderWorkbenchRoute("/workspaces/workspace-1/affairs");
    await screen.findByRole("tab", { name: t("shell.affairsLibraryNav") });
    const settingsButton = view.container.querySelector(".workbench-nav-settings-button");

    if (!(settingsButton instanceof HTMLElement)) {
      throw new Error("未找到设置按钮");
    }

    await user.click(settingsButton);
    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/settings");
    });

    await user.click(screen.getByRole("tab", { name: t("shell.affairsConversationNav") }));

    await waitFor(() => {
      expect(screen.queryByTestId("current-path")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: t("settings.title") })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("shell.workbenchModeAffairs") })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: t("shell.affairsConversationNav") })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector(".workbench-auxiliary")).toBeNull();
    expect(screen.queryByRole("button", { name: t("shell.showInfoSidebar") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.hideInfoSidebar") })).not.toBeInTheDocument();
  });

  it("打开 affairs 路由时会直接激活事务模式", async () => {
    mockAffairsLibraryFetch();
    MockWebSocket.workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话一",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);
    renderWorkbenchRoute("/workspaces/workspace-1/affairs");

    expect(await screen.findByRole("tab", { name: t("shell.workbenchModeAffairs") })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: t("shell.affairsLibraryNav") })).toBeInTheDocument();
    expect(document.querySelector('.workbench-nav[data-collapsed="false"]')).not.toBeNull();
    expect(document.querySelector(".workbench-auxiliary")).not.toBeNull();
    expect(screen.getByRole("button", { name: t("shell.hideInfoSidebar") })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("shell.affairsDetailTitle") })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: t("shell.showInfoSidebar") })).not.toBeInTheDocument();
    expect(screen.queryByTestId("current-path")).not.toBeInTheDocument();
  });

  it("事务工作台视图默认隐藏右栏，但保留展开入口", async () => {
    mockAffairsLibraryFetch();
    MockWebSocket.workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话一",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);

    const user = userEvent.setup();
    renderWorkbenchRoute("/workspaces/workspace-1/affairs");

    await user.click(await screen.findByRole("tab", { name: t("shell.affairsWorkbenchNav") }));

    expect(await screen.findByRole("tab", { name: t("shell.affairsWorkbenchNav") })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector(".workbench-auxiliary")).toBeNull();
    const expandButton = await screen.findByRole("button", { name: t("shell.showInfoSidebar") });
    expect(expandButton).toBeInTheDocument();

    await user.click(expandButton);

    expect(await screen.findByRole("button", { name: t("shell.hideInfoSidebar") })).toBeInTheDocument();
    expect(document.querySelector(".workbench-auxiliary")).not.toBeNull();
  });

  it("事务对话视图不会显示右栏，也不会显示展开入口", async () => {
    mockAffairsLibraryFetch();
    MockWebSocket.workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话一",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);

    const user = userEvent.setup();
    renderWorkbenchRoute("/workspaces/workspace-1/affairs");

    await user.click(await screen.findByRole("tab", { name: t("shell.affairsConversationNav") }));

    expect(await screen.findByRole("tab", { name: t("shell.affairsConversationNav") })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector(".workbench-auxiliary")).toBeNull();
    expect(screen.queryByRole("button", { name: t("shell.showInfoSidebar") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.hideInfoSidebar") })).not.toBeInTheDocument();
  });

});
