import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopWindowPage } from "./DesktopWindowPage";

const getScopedWorkbenchSnapshotMock = vi.hoisted(() => vi.fn());
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
    isWindowOpen: vi.fn(),
    setWindowState: vi.fn()
  },
  windows: {
    registerDescriptor: registerDescriptorMock,
    markWindowOpen: markWindowOpenMock,
    getDescriptor: getRegistryDescriptorMock
  }
}));
const fileContextPanelMock = vi.hoisted(() => vi.fn());
const fileViewerPanelMock = vi.hoisted(() => vi.fn());
const gitSidebarMock = vi.hoisted(() => vi.fn());
const terminalManagerPanelMock = vi.hoisted(() => vi.fn());
const terminalPageMock = vi.hoisted(() => vi.fn());
const setTitleMock = vi.hoisted(() => vi.fn(async () => undefined));
const realtimeStartMock = vi.hoisted(() => vi.fn());
const realtimeCloseMock = vi.hoisted(() => vi.fn());

vi.mock("../conversation/api/conversation-api", () => ({
  getScopedWorkbenchSnapshot: getScopedWorkbenchSnapshotMock
}));

vi.mock("../../platform/platform-provider", () => ({
  usePlatform: () => platformMock
}));

vi.mock("../conversation/components/FileContextPanel", () => ({
  FileContextPanel: (props: {
    workspaceId: string | null | undefined;
    requestWorkspaceId?: string | null | undefined;
    sessionId: string | null | undefined;
    externalWindowMode?: boolean;
    workbenchShellOverrides?: {
      navigationGroups?: Array<{ workspace: { id: string } }>;
      currentTargetHostId?: string | null;
      currentRequestWorkspaceId?: string | null;
      currentWorkspacePath?: string | null;
    };
  }) => {
    fileContextPanelMock(props);
    return (
      <div data-testid="desktop-file-window">
        {props.workspaceId}:{props.sessionId ?? "null"}:
        {props.externalWindowMode ? "external" : "embedded"}:
        {props.requestWorkspaceId ?? "null"}:
        {props.workbenchShellOverrides?.currentTargetHostId ?? "null"}:
        {props.workbenchShellOverrides?.currentRequestWorkspaceId ?? "null"}:
        {props.workbenchShellOverrides?.currentWorkspacePath ?? "null"}:
        {props.workbenchShellOverrides?.navigationGroups?.length ?? 0}
      </div>
    );
  }
}));

vi.mock("../conversation/components/FileViewerModal", () => ({
  FileViewerPanel: (props: {
    workspaceId: string | null | undefined;
    filePath: string | null;
    targetHostId?: string | null;
    chrome?: string;
    windowTitle?: string | null;
  }) => {
    fileViewerPanelMock(props);
    return (
      <div data-testid="desktop-file-preview-window">
        {props.workspaceId}:{props.filePath}:{props.targetHostId ?? "null"}:{props.chrome}:{props.windowTitle ?? "null"}
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
    workbenchShellOverrides?: {
      navigationGroups?: Array<{ workspace: { id: string } }>;
      currentTargetHostId?: string | null;
      currentWorkspaceRef?: { hostId: string; workspaceId: string } | null;
    };
  }) => {
    terminalPageMock(props);
    return (
      <div data-testid="desktop-terminal-window">
        {props.externalWindowWorkspaceId ?? "null"}:
        {props.externalWindowMode ? "external" : "embedded"}:
        {props.workbenchShellOverrides?.currentTargetHostId ?? "null"}:
        {props.workbenchShellOverrides?.currentWorkspaceRef?.workspaceId ?? "null"}:
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

function CurrentPathProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

describe("DesktopWindowPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getScopedWorkbenchSnapshotMock.mockResolvedValue({
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
          <Route path="/workbench" element={<CurrentPathProbe />} />
          <Route path="/workspaces/:workspaceId/sessions/:sessionId" element={<CurrentPathProbe />} />
          <Route path="/workspaces/:workspaceId/sessions" element={<CurrentPathProbe />} />
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
        focusOwner: "file-context-panel",
        payload: { filePath: null, targetHostId: null, requestWorkspaceId: null, routePath: null }
      }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("desktop-file-window")).toHaveTextContent(
        "workspace-1:session-1:external:null:null:null:/Users/jackson/Documents/Code/CodingNS:1"
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

  it("PeerHost 文件外部窗口会把 requestWorkspaceId 对应的工作区路径传给文件面板", async () => {
    getScopedWorkbenchSnapshotMock.mockResolvedValue({
      items: [
        {
          workspace: {
            id: "workspace-1",
            name: "本地项目",
            path: "/Users/jackson/Documents/Code/CodingNS",
            repoRoot: "/Users/jackson/Documents/Code/CodingNS"
          },
          sessions: []
        },
        {
          workspace: {
            id: "remote-workspace-1",
            name: "远端项目",
            path: "/Users/jackson/PeerHost/CodingNS",
            repoRoot: "/Users/jackson/PeerHost/CodingNS"
          },
          sessions: []
        }
      ]
    });
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
        focusOwner: "file-context-panel",
        payload: {
          filePath: null,
          targetHostId: "peer-host-1",
          requestWorkspaceId: "remote-workspace-1",
          routePath: null
        }
      }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("desktop-file-window")).toHaveTextContent(
        "workspace-1:session-1:external:remote-workspace-1:peer-host-1:remote-workspace-1:/Users/jackson/PeerHost/CodingNS:2"
      );
    });
    expect(fileContextPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestWorkspaceId: "remote-workspace-1",
        workbenchShellOverrides: expect.objectContaining({
          currentTargetHostId: "peer-host-1",
          currentRequestWorkspaceId: "remote-workspace-1",
          currentWorkspacePath: "/Users/jackson/PeerHost/CodingNS"
        })
      })
    );
  });

  it("会根据 descriptor 渲染单文件预览外部窗口", async () => {
    getWindowDescriptorMock.mockResolvedValue({
      ok: true,
      value: {
        windowId: "file-preview-workspace-1-docs_2Freadme_md",
        kind: "file-preview",
        workspaceId: "workspace-1",
        workspaceName: "项目一",
        sessionId: "session-1",
        mode: "external",
        bounds: {
          x: null,
          y: null,
          width: 1120,
          height: 760,
          minWidth: 720,
          minHeight: 480
        },
        focusOwner: "file-preview-window",
        payload: {
          filePath: "docs/readme.md",
          targetHostId: "peer-host-1",
          requestWorkspaceId: "remote-workspace-1",
          routePath: null
        }
      }
    });

    renderPage("/desktop-window/file-preview-workspace-1-docs_2Freadme_md");

    await waitFor(() => {
      expect(screen.getByTestId("desktop-file-preview-window")).toHaveTextContent(
        "workspace-1:docs/readme.md:peer-host-1:window:readme.md"
      );
    });
    expect(fileViewerPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        filePath: "docs/readme.md",
        targetHostId: "peer-host-1",
        chrome: "window",
        windowTitle: "readme.md"
      })
    );
    expect(setTitleMock).toHaveBeenLastCalledWith(
      "readme.md（项目一）"
    );
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
        focusOwner: null,
        payload: { filePath: null, targetHostId: null, requestWorkspaceId: null, routePath: null }
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
        focusOwner: "terminal-manager-panel",
        payload: { filePath: null, targetHostId: null, requestWorkspaceId: null, routePath: null }
      }
    });

    renderPage("/desktop-window/processes-workspace-1");

    await waitFor(() => {
      expect(screen.getByTestId("desktop-process-window")).toHaveTextContent(
        "workspace-1:external:1"
      );
    });
    const dragHeader = screen.getByRole("banner", { name: "Debug" });
    expect(within(dragHeader).getByText("CodingNS")).toBeInTheDocument();
    expect(dragHeader).toHaveAttribute("data-tauri-drag-region", "");
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
        focusOwner: "terminal-page",
        payload: { filePath: null, targetHostId: null, requestWorkspaceId: null, routePath: null }
      }
    });

    renderPage("/desktop-window/terminals-workspace-1");

    await waitFor(() => {
      expect(screen.getByTestId("desktop-terminal-window")).toHaveTextContent(
        "workspace-1:external:null:null:1"
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


  it("旧事务外部窗口会跳转到工作台独立路由", async () => {
    getWindowDescriptorMock.mockResolvedValue({
      ok: true,
      value: {
        windowId: "affairs-workspace-1",
        kind: "affairs",
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
        focusOwner: "affairs-workbench",
        payload: { filePath: null, routePath: "/workspaces/workspace-1/affairs" }
      }
    });

    renderPage("/desktop-window/affairs-workspace-1");

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/workbench");
    });
  });

  it("代码外部窗口会跳转到 descriptor 指定路由", async () => {
    getWindowDescriptorMock.mockResolvedValue({
      ok: true,
      value: {
        windowId: "code-workspace-1",
        kind: "code",
        workspaceId: "workspace-1",
        workspaceName: "项目一",
        sessionId: "session-1",
        mode: "external",
        bounds: { x: null, y: null, width: 1200, height: 780, minWidth: 720, minHeight: 480 },
        focusOwner: "code-workbench",
        payload: { filePath: null, targetHostId: null, requestWorkspaceId: null, routePath: "/workspaces/workspace-1/sessions/session-1" }
      }
    });

    renderPage("/desktop-window/code-workspace-1");

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/workspaces/workspace-1/sessions/session-1");
    });
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
        focusOwner: null,
        payload: { filePath: null, targetHostId: null, requestWorkspaceId: null, routePath: null }
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
      focusOwner: null,
      payload: { filePath: null, targetHostId: null, requestWorkspaceId: null, routePath: null }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("desktop-file-window")).toHaveTextContent(
        "workspace-1:null:external:null:null:null:/Users/jackson/Documents/Code/CodingNS:1"
      );
    });
  });

  it("PeerHost 终端外部窗口会保留 targetHostId 和 requestWorkspaceId", async () => {
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
        focusOwner: "terminal-page",
        payload: {
          filePath: null,
          targetHostId: "peer-host-1",
          requestWorkspaceId: "remote-workspace-1",
          routePath: null
        }
      }
    });

    renderPage("/desktop-window/terminals-workspace-1");

    await waitFor(() => {
      expect(screen.getByTestId("desktop-terminal-window")).toHaveTextContent(
        "workspace-1:external:peer-host-1:remote-workspace-1:1"
      );
    });
    expect(terminalPageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workbenchShellOverrides: expect.objectContaining({
          currentTargetHostId: "peer-host-1",
          currentWorkspaceRef: {
            hostId: "peer-host-1",
            workspaceId: "remote-workspace-1"
          }
        })
      })
    );
  });
});
