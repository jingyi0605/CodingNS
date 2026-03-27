import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { authStore } from "../../auth/store/auth-store";
import { writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { ToastProvider } from "../../../shared/toast";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";
import type { TerminalDto, TerminalShellOptionDto } from "../api/terminal-api";
import { persistSelectedWorkspaceId } from "../runtime/terminal-page-persistence";
import { TerminalPage } from "./TerminalPage";

const originalInnerWidth = window.innerWidth;

const {
  navigationGroups,
  mockCloseTerminal,
  mockCreateTerminal,
  mockDeleteTerminalRecord,
  mockListTerminalShellOptions,
  mockListWorkspaceTerminals,
  mockSubscribeTerminalManagerSnapshot,
  mockRequestTerminalManagerRefresh,
  terminalManagerSnapshotListeners,
  terminalManagerSnapshotByWorkspace
} = vi.hoisted(() => ({
  navigationGroups: [
    {
      workspace: {
        id: "workspace-1",
        name: "Demo Workspace",
        path: "/Users/jackson/Code/CodingNS",
        repoRoot: "/Users/jackson/Code/CodingNS"
      },
      sessions: []
    },
    {
      workspace: {
        id: "workspace-2",
        name: "Docs Workspace",
        path: "/Users/jackson/Code/Docs",
        repoRoot: "/Users/jackson/Code/Docs"
      },
      sessions: []
    }
  ] as WorkspaceSessionGroup[],
  mockCloseTerminal: vi.fn(),
  mockCreateTerminal: vi.fn(),
  mockDeleteTerminalRecord: vi.fn(),
  mockListTerminalShellOptions: vi.fn(),
  mockListWorkspaceTerminals: vi.fn(),
  mockSubscribeTerminalManagerSnapshot: vi.fn(),
  mockRequestTerminalManagerRefresh: vi.fn(),
  terminalManagerSnapshotListeners: new Set<
    (snapshot: {
      workspaceId: string;
      terminals: TerminalDto[];
      templates: unknown[];
      templateStatuses: Array<{ occupied: boolean }>;
    }) => void
  >(),
  terminalManagerSnapshotByWorkspace: new Map<
    string,
    {
      workspaceId: string;
      terminals: TerminalDto[];
      templates: unknown[];
      templateStatuses: Array<{ occupied: boolean }>;
    }
  >()
}));

function setTerminalManagerSnapshot(workspaceId: string, terminals: TerminalDto[]) {
  const snapshot = {
    workspaceId,
    terminals,
    templates: [],
    templateStatuses: []
  };

  terminalManagerSnapshotByWorkspace.set(workspaceId, snapshot);
  writeViewSnapshot(`terminal-manager.snapshot.${workspaceId}`, snapshot);
}

function emitTerminalManagerSnapshot(workspaceId: string) {
  const snapshot = terminalManagerSnapshotByWorkspace.get(workspaceId) ?? {
    workspaceId,
    terminals: [],
    templates: [],
    templateStatuses: []
  };

  terminalManagerSnapshotListeners.forEach((listener) => {
    listener(snapshot);
  });
}

const workbenchShell = {
  navigationGroups,
  subscribeTerminalManagerSnapshot: mockSubscribeTerminalManagerSnapshot,
  requestTerminalManagerRefresh: (workspaceId: string) => {
    mockRequestTerminalManagerRefresh(workspaceId);
    queueMicrotask(() => {
      emitTerminalManagerSnapshot(workspaceId);
    });
  },
  addTerminalManagerSnapshotListener: (listener: (snapshot: {
    workspaceId: string;
    terminals: TerminalDto[];
    templates: unknown[];
    templateStatuses: Array<{ occupied: boolean }>;
  }) => void) => {
    terminalManagerSnapshotListeners.add(listener);
    return () => {
      terminalManagerSnapshotListeners.delete(listener);
    };
  }
};

vi.mock("../../conversation/components/WorkbenchLayout", async () => {
  const actual = await vi.importActual("../../conversation/components/WorkbenchLayout");

  return {
    ...actual,
    useWorkbenchShell: () => workbenchShell
  };
});

vi.mock("../api/terminal-api", async () => {
  const actual = await vi.importActual("../api/terminal-api");

  return {
    ...actual,
    closeTerminal: mockCloseTerminal,
    createTerminal: mockCreateTerminal,
    deleteTerminalRecord: mockDeleteTerminalRecord,
    listTerminalShellOptions: mockListTerminalShellOptions,
    listWorkspaceTerminals: mockListWorkspaceTerminals
  };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    proposeDimensions() {
      return {
        cols: 120,
        rows: 30
      };
    }

    fit() {
      return undefined;
    }
  }
}));

vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: class {
    serialize() {
      return "";
    }
  }
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 120;
    rows = 30;
    options = {
      fontSize: 14
    };
    buffer = {
      active: {
        length: 0,
        viewportY: 0,
        getLine: () => null
      }
    };

    loadAddon() {
      return undefined;
    }

    onData() {
      return {
        dispose() {
          return undefined;
        }
      };
    }

    onResize() {
      return {
        dispose() {
          return undefined;
        }
      };
    }

    open(container: HTMLElement) {
      const marker = document.createElement("div");
      marker.setAttribute("data-testid", "mock-xterm");
      container.append(marker);
    }

    write(_content: string, callback?: () => void) {
      callback?.();
    }

    focus() {
      return undefined;
    }

    reset() {
      return undefined;
    }

    scrollToLine() {
      return undefined;
    }

    dispose() {
      return undefined;
    }
  }
}));

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];

  readyState = 1;
  sentPayloads: string[] = [];

  constructor(public readonly url: string) {
    super();
    MockWebSocket.instances.push(this);

    queueMicrotask(() => {
      this.dispatchEvent(new Event("open"));
      this.dispatchMessage({
        type: "system.connected"
      });
    });
  }

  send(payload: string) {
    this.sentPayloads.push(payload);
    const parsed = JSON.parse(payload) as { type: string; terminalId?: string };

    if (parsed.type === "terminal.subscribe" && parsed.terminalId) {
      queueMicrotask(() => {
        this.dispatchMessage({
          type: "terminal.subscribed",
          terminalId: parsed.terminalId
        });
      });
    }
  }

  close() {
    this.dispatchEvent(new Event("close"));
  }

  dispatchMessage(payload: Record<string, unknown>) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify(payload)
      })
    );
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject
  };
}

function buildShellOption(): { items: TerminalShellOptionDto[] } {
  return {
    items: [
      {
        id: "zsh",
        label: "zsh",
        shell: "/bin/zsh",
        available: true,
        unavailableReason: null
      }
    ]
  };
}

function buildTerminal(overrides: Partial<TerminalDto> = {}): TerminalDto {
  return {
    id: "terminal-1",
    workspaceId: "workspace-1",
    name: "工作终端",
    cwd: "/Users/jackson/Code/CodingNS",
    shell: "/bin/zsh",
    runtimeType: "tmux",
    runtimeSessionId: "session-1",
    attachTarget: "tmux://session-1",
    status: "running",
    processId: 3210,
    createdByUserId: "user-1",
    createdAt: "2026-03-26T08:00:00.000Z",
    lastActiveAt: "2026-03-26T08:00:00.000Z",
    closedAt: null,
    exitCode: null,
    statusDetail: null,
    ...overrides
  };
}

function renderPage(initialEntry = "/workspaces/workspace-1/terminals") {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/terminals" element={<TerminalPage />} />
          <Route path="/workspaces/:workspaceId/terminals" element={<TerminalPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

describe("TerminalPage", () => {
  const originalWebSocket = global.WebSocket;
  const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    MockWebSocket.instances = [];
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    authStore.hydrate({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    });
    mockCloseTerminal.mockReset();
    mockCreateTerminal.mockReset();
    mockDeleteTerminalRecord.mockReset();
    mockListTerminalShellOptions.mockReset();
    mockListWorkspaceTerminals.mockReset();
    mockSubscribeTerminalManagerSnapshot.mockReset();
    mockRequestTerminalManagerRefresh.mockReset();
    terminalManagerSnapshotListeners.clear();
    terminalManagerSnapshotByWorkspace.clear();
    mockListTerminalShellOptions.mockResolvedValue(buildShellOption());
    setTerminalManagerSnapshot("workspace-1", []);
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {
          return undefined;
        }

        disconnect() {
          return undefined;
        }
      }
    );
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: Promise.resolve()
      }
    });
  });

  afterEach(() => {
    authStore.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    global.WebSocket = originalWebSocket;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth
    });

    if (originalFonts) {
      Object.defineProperty(document, "fonts", originalFonts);
      return;
    }

    Reflect.deleteProperty(document, "fonts");
  });

  it("点击加号后会先显示创建中的窗口，并在创建完成后接入真实终端", async () => {
    const createTerminalDeferred = createDeferred<TerminalDto>();
    const createdTerminal = buildTerminal();

    mockListWorkspaceTerminals.mockResolvedValueOnce({
      items: [createdTerminal]
    });
    mockCreateTerminal.mockImplementationOnce(() => createTerminalDeferred.promise);

    renderPage();
    expect(mockListTerminalShellOptions).not.toHaveBeenCalled();

    const createButton = await screen.findByRole("button", { name: "新建终端" });

    await waitFor(() => {
      expect(createButton).toBeEnabled();
    });

    await userEvent.click(createButton);

    expect(await screen.findAllByText("正在创建终端…")).toHaveLength(2);
    expect(
      screen.getByText("Host 正在启动真实 PTY，连上以后这个窗口会立刻接管显示。")
    ).toBeInTheDocument();

    createTerminalDeferred.resolve(createdTerminal);

    await waitFor(() => {
      expect(mockListWorkspaceTerminals).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-xterm")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("工作终端")).toBeInTheDocument();
    });
  });

  it("分栏模式下的标签菜单会明确显示主副分栏绑定动作", async () => {
    setTerminalManagerSnapshot("workspace-1", [
      buildTerminal({
        id: "terminal-1",
        name: "前端"
      }),
      buildTerminal({
        id: "terminal-2",
        name: "后端",
        runtimeSessionId: "session-2",
        attachTarget: "tmux://session-2",
        processId: 4567
      })
    ]);

    renderPage();

    await screen.findByText("前端");

    await userEvent.click(
      screen.getByRole("button", {
        name: "展开终端工具栏"
      })
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "左右分栏"
      })
    );

    const actionButtons = screen.getAllByRole("button", { name: "终端操作" });
    await userEvent.click(actionButtons[0]);

    expect(screen.getByRole("menuitem", { name: "绑定到主分栏" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "绑定到副分栏" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "绑定到当前分栏" })).not.toBeInTheDocument();
  });

  it("运行中和异常终端的菜单只显示各自允许的生命周期动作", async () => {
    setTerminalManagerSnapshot("workspace-1", [
      buildTerminal({
        id: "terminal-running",
        name: "运行中终端"
      }),
      buildTerminal({
        id: "terminal-error",
        name: "异常终端",
        runtimeSessionId: "session-2",
        attachTarget: "tmux://session-2",
        status: "error",
        processId: null,
        statusDetail: "tmux exited"
      })
    ]);

    renderPage();

    await screen.findByText("运行中终端");

    const actionButtons = screen.getAllByRole("button", { name: "终端操作" });

    await userEvent.click(actionButtons[0]);
    expect(screen.getByRole("menuitem", { name: "关闭终端" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "删除" })).not.toBeInTheDocument();

    await userEvent.click(actionButtons[1]);
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "关闭终端" })).not.toBeInTheDocument();
  });

  it("关闭终端时会先显示关闭中状态，再在后台同步关闭结果", async () => {
    const closeDeferred = createDeferred<{ success: true }>();
    const runningTerminal = buildTerminal({
      id: "terminal-running",
      name: "运行中终端"
    });
    const closedTerminal = buildTerminal({
      id: "terminal-running",
      name: "运行中终端",
      status: "closed",
      processId: null,
      closedAt: "2026-03-26T08:10:00.000Z",
      exitCode: 0,
      statusDetail: "user_closed"
    });

    setTerminalManagerSnapshot("workspace-1", [runningTerminal]);
    mockListWorkspaceTerminals.mockResolvedValueOnce({
      items: [closedTerminal]
    });
    mockCloseTerminal.mockImplementationOnce(() => closeDeferred.promise);

    renderPage();

    await screen.findByText("运行中终端");
    await userEvent.click(screen.getByRole("button", { name: "终端操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "关闭终端" }));

    expect(mockCloseTerminal).toHaveBeenCalledWith("terminal-running");
    expect(await screen.findByText("关闭中")).toBeInTheDocument();

    closeDeferred.resolve({
      success: true
    });

    await waitFor(() => {
      expect(mockListWorkspaceTerminals).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByText("关闭中")).not.toBeInTheDocument();
    });
  });

  it("删除终端时会先显示删除中状态，再在后台同步列表移除", async () => {
    const deleteDeferred = createDeferred<{ success: true }>();
    const erroredTerminal = buildTerminal({
      id: "terminal-error",
      name: "异常终端",
      status: "error",
      processId: null,
      statusDetail: "tmux exited"
    });

    setTerminalManagerSnapshot("workspace-1", [erroredTerminal]);
    mockListWorkspaceTerminals.mockResolvedValueOnce({
      items: []
    });
    mockDeleteTerminalRecord.mockImplementationOnce(() => deleteDeferred.promise);

    renderPage();

    await screen.findByText("异常终端");
    await userEvent.click(screen.getByRole("button", { name: "终端操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "删除" }));

    expect(mockDeleteTerminalRecord).toHaveBeenCalledWith("terminal-error");
    expect(await screen.findByText("删除中")).toBeInTheDocument();

    deleteDeferred.resolve({
      success: true
    });

    await waitFor(() => {
      expect(mockListWorkspaceTerminals).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByText("异常终端")).not.toBeInTheDocument();
    });
  });

  it("移动端会隐藏分栏按钮，并支持左右滑动切换终端", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });

    setTerminalManagerSnapshot("workspace-1", [
      buildTerminal({
        id: "terminal-1",
        name: "前端",
        lastActiveAt: "2026-03-26T08:10:00.000Z"
      }),
      buildTerminal({
        id: "terminal-2",
        name: "后端",
        runtimeSessionId: "session-2",
        attachTarget: "tmux://session-2",
        processId: 4567,
        lastActiveAt: "2026-03-26T08:00:00.000Z"
      })
    ]);

    const user = userEvent.setup();
    const view = renderPage();

    expect(await screen.findByRole("heading", { name: "Demo Workspace" })).toBeInTheDocument();
    expect(screen.getByText("/Users/jackson/Code/CodingNS")).toBeInTheDocument();

    const frontTab = await screen.findByRole("tab", { name: /前端/i });
    const backTab = await screen.findByRole("tab", { name: /后端/i });

    expect(screen.getByText("左右滑动切换终端")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开终端工具栏" }));
    expect(screen.queryByRole("button", { name: "左右分栏" })).not.toBeInTheDocument();

    const pane = view.container.querySelector(".terminal-pane-card");

    if (!(pane instanceof HTMLElement)) {
      throw new Error("未找到终端舞台");
    }

    expect(frontTab).toHaveAttribute("aria-selected", "true");
    expect(backTab).toHaveAttribute("aria-selected", "false");

    fireEvent.touchStart(pane, {
      touches: [{ clientX: 260, clientY: 120 }]
    });
    fireEvent.touchEnd(pane, {
      changedTouches: [{ clientX: 90, clientY: 128 }]
    });

    await waitFor(() => {
      expect(backTab).toHaveAttribute("aria-selected", "true");
    });
  });

  it("带 workspaceId 的 scoped 路由会优先于持久化工作区选择", async () => {
    persistSelectedWorkspaceId("workspace-1");
    setTerminalManagerSnapshot(
      "workspace-2",
      [
        buildTerminal({
          id: "terminal-docs",
          workspaceId: "workspace-2",
          name: "Docs 终端",
          cwd: "/Users/jackson/Code/Docs"
        })
      ]
    );

    renderPage("/workspaces/workspace-2/terminals");

    await waitFor(() => {
      expect(screen.getByText("Docs 终端")).toBeInTheDocument();
    });
    expect(mockListWorkspaceTerminals).not.toHaveBeenCalled();
  });
});
