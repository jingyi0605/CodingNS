import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopWindowPage } from "./DesktopWindowPage";

const getWorkbenchSnapshotMock = vi.hoisted(() => vi.fn());
const getWindowDescriptorMock = vi.hoisted(() => vi.fn());
const registerDescriptorMock = vi.hoisted(() => vi.fn());
const markWindowOpenMock = vi.hoisted(() => vi.fn());
const getRegistryDescriptorMock = vi.hoisted(() => vi.fn());
const platformMock = vi.hoisted(() => ({
  platform: "desktop",
  isDesktop: true,
  isWeb: false,
  isMobile: false,
  isNativeMobile: false,
  viewportClass: "expanded",
  ui: {
    osFamily: "macos",
    windowControlsStyle: "traffic-lights",
    prefersDesktopChrome: true,
    prefersOverlayTitlebar: true,
    prefersSystemFontStack: true
  },
  bridge: {
    supported: true,
    getWindowDescriptor: getWindowDescriptorMock,
    isWindowOpen: vi.fn()
  },
  windows: {
    registerDescriptor: registerDescriptorMock,
    markWindowOpen: markWindowOpenMock,
    getDescriptor: getRegistryDescriptorMock
  }
}));
const fileContextPanelMock = vi.hoisted(() => vi.fn());
const gitSidebarMock = vi.hoisted(() => vi.fn());
const terminalManagerPanelMock = vi.hoisted(() => vi.fn());
const terminalPageMock = vi.hoisted(() => vi.fn());
const setTitleMock = vi.hoisted(() => vi.fn(async () => undefined));
const realtimeStartMock = vi.hoisted(() => vi.fn());
const realtimeCloseMock = vi.hoisted(() => vi.fn());

vi.mock("../conversation/api/conversation-api", () => ({
  getWorkbenchSnapshot: getWorkbenchSnapshotMock
}));

vi.mock("../../platform/platform-provider", () => ({
  usePlatform: () => platformMock
}));

vi.mock("../conversation/components/FileContextPanel", () => ({
  FileContextPanel: (props: {
    workspaceId: string | null | undefined;
    sessionId: string | null | undefined;
    externalWindowMode?: boolean;
    workbenchShellOverrides?: { navigationGroups?: Array<{ workspace: { id: string } }> };
  }) => {
    fileContextPanelMock(props);
    return (
      <div data-testid="desktop-file-window">
        {props.workspaceId}:{props.sessionId ?? "null"}:
        {props.externalWindowMode ? "external" : "embedded"}:
        {props.workbenchShellOverrides?.navigationGroups?.length ?? 0}
      </div>
    );
  }
}));

vi.mock("../conversation/components/GitSidebar", () => ({
  GitSidebar: (props: {
    workspaceId: string | null | undefined;
    externalWindowMode?: boolean;
  }) => {
    gitSidebarMock(props);
    return (
      <div data-testid="desktop-git-window">
        {props.workspaceId}:{props.externalWindowMode ? "external" : "embedded"}
      </div>
    );
  }
}));

vi.mock("../workbench/components/TerminalManagerPanel", () => ({
  TerminalManagerPanel: (props: {
    currentWorkspaceId: string | null;
    navigationGroups: Array<{ workspace: { id: string } }>;
    externalWindowMode?: boolean;
  }) => {
    terminalManagerPanelMock(props);
    return (
      <div data-testid="desktop-process-window">
        {props.currentWorkspaceId}:{props.externalWindowMode ? "external" : "embedded"}:
        {props.navigationGroups.length}
      </div>
    );
  }
}));

vi.mock("../terminal/pages/TerminalPage", () => ({
  TerminalPage: (props: {
    externalWindowMode?: boolean;
    externalWindowWorkspaceId?: string | null;
    workbenchShellOverrides?: { navigationGroups?: Array<{ workspace: { id: string } }> };
  }) => {
    terminalPageMock(props);
    return (
      <div data-testid="desktop-terminal-window">
        {props.externalWindowWorkspaceId ?? "null"}:
        {props.externalWindowMode ? "external" : "embedded"}:
        {props.workbenchShellOverrides?.navigationGroups?.length ?? 0}
      </div>
    );
  }
}));

vi.mock("../../network/workbench-realtime-client", () => ({
  WorkbenchRealtimeClient: class {
    subscribeFileTree = vi.fn();
    requestFileTreeRefresh = vi.fn();
    addFileTreeSnapshotListener = vi.fn(() => () => undefined);
    subscribeGit = vi.fn();
    requestGitRefresh = vi.fn();
    addGitSnapshotListener = vi.fn(() => () => undefined);
    subscribeTerminalManager = vi.fn();
    requestTerminalManagerRefresh = vi.fn();
    addTerminalManagerSnapshotListener = vi.fn(() => () => undefined);

    start() {
      realtimeStartMock();
    }

    close() {
      realtimeCloseMock();
    }
  }
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTitle: setTitleMock
  })
}));

describe("DesktopWindowPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkbenchSnapshotMock.mockResolvedValue({
      items: [
        {
          workspace: {
            id: "workspace-1",
            name: "CodingNS",
            path: "/Users/jackson/Documents/Code/CodingNS",
            repoRoot: "/Users/jackson/Documents/Code/CodingNS"
          },
          sessions: [
            {
              sessionId: "session-2",
              workspaceId: "workspace-1",
              provider: "codex",
              providerSessionId: "provider-2",
              rawStoreRef: "raw-2",
              title: "B",
              messageCount: 1,
              lastMessageAt: "2026-04-02T10:00:00.000Z",
              createdAt: "2026-04-02T10:00:00.000Z",
              updatedAt: "2026-04-02T10:00:00.000Z",
              syncStatus: null,
              syncCursor: null,
              lastSyncAt: null,
              lastErrorCode: null,
              lastErrorDetail: null,
              resumedAt: null,
              runningState: null,
              activitySource: "none",
              activityState: "idle",
              lastEventAt: null,
              completedAt: null,
              lastSeenAt: null
            }
          ]
        }
      ]
    });
    getRegistryDescriptorMock.mockReturnValue(null);
  });

  function renderPage(initialEntry = "/desktop-window/files-workspace-1") {
    render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/desktop-window/:windowId" element={<DesktopWindowPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("会根据 descriptor 渲染文件外部窗口壳", async () => {
    getWindowDescriptorMock.mockResolvedValue({
      ok: true,
      value: {
        windowId: "files-workspace-1",
        kind: "files",
        workspaceId: "workspace-1",
        sessionId: "session-1",
        mode: "external",
        bounds: {
          x: null,
          y: null,
          width: 1200,
          height: 780,
          minWidth: 720,
          minHeight: 480
        },
        focusOwner: "file-context-panel"
      }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("desktop-file-window")).toHaveTextContent(
        "workspace-1:session-1:external:1"
      );
    });
    expect(registerDescriptorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "files-workspace-1",
        kind: "files"
      })
    );
    expect(markWindowOpenMock).toHaveBeenCalledWith("files-workspace-1");
    expect(realtimeStartMock).toHaveBeenCalledTimes(1);
  });

  it("会根据 descriptor 渲染 Git 外部窗口壳", async () => {
    getWindowDescriptorMock.mockResolvedValue({
      ok: true,
      value: {
        windowId: "git-workspace-1",
        kind: "git",
        workspaceId: "workspace-1",
        sessionId: null,
        mode: "external",
        bounds: {
          x: null,
          y: null,
          width: 1200,
          height: 780,
          minWidth: 720,
          minHeight: 480
        },
        focusOwner: null
      }
    });

    renderPage("/desktop-window/git-workspace-1");

    await waitFor(() => {
      expect(screen.getByTestId("desktop-git-window")).toHaveTextContent("workspace-1:external");
    });
    expect(gitSidebarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        externalWindowMode: true
      })
    );
  });

  it("会根据 descriptor 渲染进程管理外部窗口壳", async () => {
    getWindowDescriptorMock.mockResolvedValue({
      ok: true,
      value: {
        windowId: "processes-workspace-1",
        kind: "processes",
        workspaceId: "workspace-1",
        sessionId: null,
        mode: "external",
        bounds: {
          x: null,
          y: null,
          width: 1200,
          height: 780,
          minWidth: 720,
          minHeight: 480
        },
        focusOwner: "terminal-manager-panel"
      }
    });

    renderPage("/desktop-window/processes-workspace-1");

    await waitFor(() => {
      expect(screen.getByTestId("desktop-process-window")).toHaveTextContent(
        "workspace-1:external:1"
      );
    });
    expect(terminalManagerPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentWorkspaceId: "workspace-1",
        externalWindowMode: true
      })
    );
  });

  it("会根据 descriptor 渲染终端页外部窗口壳", async () => {
    getWindowDescriptorMock.mockResolvedValue({
      ok: true,
      value: {
        windowId: "terminals-workspace-1",
        kind: "terminals",
        workspaceId: "workspace-1",
        workspaceName: "项目一",
        sessionId: null,
        mode: "external",
        bounds: {
          x: null,
          y: null,
          width: 1200,
          height: 780,
          minWidth: 720,
          minHeight: 480
        },
        focusOwner: "terminal-page"
      }
    });

    renderPage("/desktop-window/terminals-workspace-1");

    await waitFor(() => {
      expect(screen.getByTestId("desktop-terminal-window")).toHaveTextContent(
        "workspace-1:external:1"
      );
    });
    expect(terminalPageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalWindowWorkspaceId: "workspace-1",
        externalWindowMode: true
      })
    );
    expect(setTitleMock).toHaveBeenLastCalledWith("CodingNS - Terminal（项目一）");
  });

  it("descriptor 类型不在第一批范围内时会显示占位错误", async () => {
    getWindowDescriptorMock.mockResolvedValue({
      ok: true,
      value: {
        windowId: "chat-workspace-1",
        kind: "chat",
        workspaceId: "workspace-1",
        sessionId: null,
        mode: "external",
        bounds: {
          x: null,
          y: null,
          width: 1200,
          height: 780,
          minWidth: 720,
          minHeight: 480
        },
        focusOwner: null
      }
    });

    renderPage("/desktop-window/chat-workspace-1");

    await waitFor(() => {
      expect(screen.getByText("Rendering the chat window is not supported yet.")).toBeInTheDocument();
    });
  });

  it("bridge 读取失败时会回退到前端注册表 descriptor", async () => {
    getWindowDescriptorMock.mockResolvedValue({
      ok: false,
      errorCode: "WINDOW_DESCRIPTOR_NOT_FOUND",
      detail: "not found"
    });
    getRegistryDescriptorMock.mockReturnValue({
      windowId: "files-workspace-1",
      kind: "files",
      workspaceId: "workspace-1",
      sessionId: null,
      mode: "external",
      bounds: {
        x: null,
        y: null,
        width: 1200,
        height: 780,
        minWidth: 720,
        minHeight: 480
      },
      focusOwner: null
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("desktop-file-window")).toHaveTextContent(
        "workspace-1:null:external:1"
      );
    });
  });
});
