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
import { TerminalPage, translateKeyboardEventToTerminalInput } from "./TerminalPage";

const originalInnerWidth = window.innerWidth;
const originalNavigatorPlatform = Object.getOwnPropertyDescriptor(window.navigator, "platform");

const {
  navigationGroups,
  mockCloseTerminal,
  mockCreateTerminal,
  mockDeleteTerminalRecord,
  mockListTerminalShellOptions,
  mockListWorkspaceTerminals,
  mockXtermInstances,
  mockTerminalWheelHandlers,
  mockReadTerminalHistory,
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
  mockXtermInstances: [] as Array<{
    buffer: {
      active: {
        length: number;
        viewportY: number;
        baseY: number;
        getLine: () => null;
      };
    };
    triggerScroll: (viewportY: number) => void;
    triggerWheel: (deltaY: number, deltaMode?: number) => boolean;
  }>,
  mockTerminalWheelHandlers: [] as Array<((event: WheelEvent) => boolean) | null>,
  mockReadTerminalHistory: vi.fn(),
  mockSubscribeTerminalManagerSnapshot: vi.fn(),
  mockRequestTerminalManagerRefresh: vi.fn(),
  terminalManagerSnapshotListeners: new Set<
    (snapshot: {
      workspaceId: string;
      terminals: TerminalDto[];
      templates: unknown[];
      templateStatuses: Array<{ occupied: boolean }>;
      shellOptions?: TerminalShellOptionDto[];
    }) => void
  >(),
  terminalManagerSnapshotByWorkspace: new Map<
    string,
    {
      workspaceId: string;
      terminals: TerminalDto[];
      templates: unknown[];
      templateStatuses: Array<{ occupied: boolean }>;
      shellOptions?: TerminalShellOptionDto[];
    }
  >()
}));

function setTerminalManagerSnapshot(
  workspaceId: string,
  terminals: TerminalDto[],
  shellOptions: TerminalShellOptionDto[] = []
) {
  const snapshot = {
    workspaceId,
    terminals,
    templates: [],
    templateStatuses: [],
    shellOptions
  };

  terminalManagerSnapshotByWorkspace.set(workspaceId, snapshot);
  writeViewSnapshot(`terminal-manager.snapshot.${workspaceId}`, snapshot);
}

function emitTerminalManagerSnapshot(workspaceId: string) {
  const snapshot = terminalManagerSnapshotByWorkspace.get(workspaceId) ?? {
    workspaceId,
    terminals: [],
    templates: [],
    templateStatuses: [],
    shellOptions: []
  };

  terminalManagerSnapshotListeners.forEach((listener) => {
    listener(snapshot);
  });
}

const workbenchShell = {
  navigationGroups,
  currentWorkspaceId: "workspace-1",
  selectWorkspace: vi.fn(),
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
    shellOptions?: TerminalShellOptionDto[];
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
    listWorkspaceTerminals: mockListWorkspaceTerminals,
    readTerminalHistory: mockReadTerminalHistory
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
  Terminal: class MockTerminal {
    cols = 120;
    rows = 30;
    options = {
      fontSize: 14
    };
    private scrollHandler: ((viewportY: number) => void) | null = null;
    private wheelHandler: ((viewportY: WheelEvent) => boolean) | null = null;
    buffer = {
      active: {
        length: 0,
        viewportY: 0,
        baseY: 0,
        getLine: () => null
      }
    };

    constructor() {
      mockXtermInstances.push(this);
      mockTerminalWheelHandlers.push(null);
    }

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

    onScroll(handler: (viewportY: number) => void) {
      this.scrollHandler = handler;
      return {
        dispose: () => {
          if (this.scrollHandler === handler) {
            this.scrollHandler = null;
          }
        }
      };
    }

    attachCustomWheelEventHandler(handler: (event: WheelEvent) => boolean) {
      this.wheelHandler = handler;
      mockTerminalWheelHandlers[mockTerminalWheelHandlers.length - 1] = handler;
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

    scrollLines(lines: number) {
      const nextViewportY = Math.max(
        0,
        Math.min(this.buffer.active.baseY, this.buffer.active.viewportY + lines)
      );
      this.buffer.active.viewportY = nextViewportY;
      this.scrollHandler?.(this.buffer.active.viewportY);
    }

    triggerScroll(viewportY: number) {
      this.buffer.active.viewportY = viewportY;
      this.scrollHandler?.(viewportY);
    }

    triggerWheel(deltaY: number, deltaMode = 0) {
      return this.wheelHandler?.({
        deltaY,
        deltaMode
      } as WheelEvent) ?? true;
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
    mockXtermInstances.length = 0;
    mockTerminalWheelHandlers.length = 0;
    mockReadTerminalHistory.mockReset();
    mockSubscribeTerminalManagerSnapshot.mockReset();
    mockRequestTerminalManagerRefresh.mockReset();
    terminalManagerSnapshotListeners.clear();
    terminalManagerSnapshotByWorkspace.clear();
    mockListTerminalShellOptions.mockResolvedValue(buildShellOption());
    mockReadTerminalHistory.mockResolvedValue({
      terminalId: "terminal-1",
      content: "",
      lineCount: 0,
      anchorLine: 0,
      hasMore: false,
      nextBeforeSeq: null
    });
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
    delete window.__TAURI_INTERNALS__;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth
    });
    if (originalNavigatorPlatform) {
      Object.defineProperty(window.navigator, "platform", originalNavigatorPlatform);
    } else {
      Reflect.deleteProperty(window.navigator, "platform");
    }

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

  it("Windows 下点击新建终端会先弹出 shell 选择，再按确认创建", async () => {
    const createdTerminal = buildTerminal({
      id: "terminal-windows-created",
      name: "Windows 终端",
      shell: "C:\\Program Files\\Git\\bin\\bash.exe"
    });
    const windowsShellOptions: TerminalShellOptionDto[] = [
      {
        id: "cmd",
        label: "命令提示符 (CMD)",
        shell: "C:\\Windows\\System32\\cmd.exe",
        available: true,
        unavailableReason: null
      },
      {
        id: "powershell",
        label: "PowerShell",
        shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        available: true,
        unavailableReason: null
      },
      {
        id: "git-bash",
        label: "Git Bash",
        shell: "C:\\Program Files\\Git\\bin\\bash.exe",
        available: true,
        unavailableReason: null
      }
    ];

    setTerminalManagerSnapshot("workspace-1", [], windowsShellOptions);
    mockCreateTerminal.mockResolvedValueOnce(createdTerminal);
    mockListWorkspaceTerminals.mockResolvedValueOnce({
      items: [createdTerminal]
    });
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "Win32"
    });

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "新建终端" }));

    expect(mockCreateTerminal).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "新建终端" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Git Bash/ }));
    await userEvent.click(screen.getByRole("button", { name: "创建终端" }));

    await waitFor(() => {
      expect(mockCreateTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          shell: "C:\\Program Files\\Git\\bin\\bash.exe"
        })
      );
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

  it("关闭终端时会在关闭成功后自动删除终端记录", async () => {
    const closeDeferred = createDeferred<{ success: true }>();
    const deleteDeferred = createDeferred<{ success: true }>();
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
    mockListWorkspaceTerminals.mockResolvedValueOnce({
      items: []
    });
    mockDeleteTerminalRecord.mockImplementationOnce(() => deleteDeferred.promise);

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
      expect(mockDeleteTerminalRecord).toHaveBeenCalledWith("terminal-running");
    });
    expect(await screen.findByText("删除中")).toBeInTheDocument();

    deleteDeferred.resolve({
      success: true
    });

    await waitFor(() => {
      expect(mockListWorkspaceTerminals).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByText("删除中")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText("运行中终端")).not.toBeInTheDocument();
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

  it("移动端会改成右滑呼出侧边终端列表，并从列表里切换终端", async () => {
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

    expect(screen.queryByText("还没有选中终端")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /前端/i })).not.toBeInTheDocument();

    const swipeZone = view.container.querySelector(".terminal-mobile-edge-swipe-zone");

    if (!(swipeZone instanceof HTMLElement)) {
      throw new Error("未找到移动端侧滑手势区");
    }

    fireEvent.touchStart(swipeZone, {
      touches: [{ clientX: 10, clientY: 120 }]
    });
    fireEvent.touchEnd(swipeZone, {
      changedTouches: [{ clientX: 140, clientY: 128 }]
    });

    expect(await screen.findByLabelText("快捷终端")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /后端/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /后端/ }));

    await waitFor(() => {
      expect(screen.queryByLabelText("快捷终端")).not.toBeInTheDocument();
    });

  });

  it("移动端终端列表项会提供操作按钮，并弹出操作菜单", async () => {
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
      })
    ]);

    const user = userEvent.setup();
    const view = renderPage();
    const swipeZone = view.container.querySelector(".terminal-mobile-edge-swipe-zone");

    if (!(swipeZone instanceof HTMLElement)) {
      throw new Error("未找到移动端侧滑手势区");
    }

    fireEvent.touchStart(swipeZone, {
      touches: [{ clientX: 10, clientY: 120 }]
    });
    fireEvent.touchEnd(swipeZone, {
      changedTouches: [{ clientX: 140, clientY: 128 }]
    });

    const actionButtons = await screen.findAllByRole("button", { name: "终端操作" });
    await user.click(actionButtons[0]!);

    expect(await screen.findByRole("dialog", { name: "终端操作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制标签" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭终端" })).toBeInTheDocument();
  });

  it("移动端空状态会先选择终端类型和会话方式，再创建终端", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });

    const createdTerminal = buildTerminal({
      id: "terminal-mobile-created",
      name: "移动端终端"
    });
    mockCreateTerminal.mockResolvedValueOnce(createdTerminal);
    mockListWorkspaceTerminals.mockResolvedValueOnce({
      items: [createdTerminal]
    });
    setTerminalManagerSnapshot("workspace-1", [], [
      {
        id: "zsh",
        label: "zsh",
        shell: "/bin/zsh",
        available: true,
        unavailableReason: null
      }
    ]);

    renderPage();

    const createButtons = await screen.findAllByRole("button", { name: "新建终端" });
    await userEvent.click(createButtons[0]!);

    expect(await screen.findByRole("dialog", { name: "新建终端" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /^持久会话 使用基于 ConPTY 的 Windows 持久化会话，让终端在 Host 重启后仍可继续保留。$/
      })
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /runtime（当前会话）/ }));
    await userEvent.click(screen.getByRole("button", { name: "创建这个终端" }));

    await waitFor(() => {
      expect(mockCreateTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          shell: "/bin/zsh",
          runtimeType: "embedded-pty"
        })
      );
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

  it("滚到终端顶部时会继续加载更早历史", async () => {
    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    await screen.findByText("工作终端");
    await waitFor(() => {
      expect(screen.getByTestId("mock-xterm")).toBeInTheDocument();
    });

    const socket = MockWebSocket.instances[0];

    if (!socket) {
      throw new Error("未建立终端 WebSocket 连接");
    }

    socket.dispatchMessage({
      type: "terminal.backfill",
      terminalId: "terminal-1",
      truncated: false,
      cursorReset: false,
      latestCursor: "4",
      chunks: [
        {
          terminalId: "terminal-1",
          cursor: "3",
          stream: "stdout",
          content: "old line\r\n",
          timestamp: "2026-03-26T08:00:00.000Z"
        },
        {
          terminalId: "terminal-1",
          cursor: "4",
          stream: "stdout",
          content: "new line\r\n",
          timestamp: "2026-03-26T08:00:01.000Z"
        }
      ]
    });

    const terminal = mockXtermInstances.at(-1);

    if (!terminal) {
      throw new Error("未创建 xterm 实例");
    }

    terminal.triggerScroll(0);

    await waitFor(() => {
      expect(mockReadTerminalHistory).toHaveBeenCalledWith("terminal-1", {
        beforeSeq: 3,
        limit: 20
      });
    });
  });

  it("终端没有发生原生视口滚动时，不会因为滚轮事件就主动拉取更早历史", async () => {
    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    await screen.findByText("工作终端");
    await waitFor(() => {
      expect(screen.getByTestId("mock-xterm")).toBeInTheDocument();
    });

    const socket = MockWebSocket.instances[0];

    if (!socket) {
      throw new Error("未建立终端 WebSocket 连接");
    }

    socket.dispatchMessage({
      type: "terminal.backfill",
      terminalId: "terminal-1",
      truncated: false,
      cursorReset: false,
      latestCursor: "2",
      chunks: [
        {
          terminalId: "terminal-1",
          cursor: "2",
          stream: "stdout",
          content: "single page\r\n",
          timestamp: "2026-03-26T08:00:00.000Z"
        }
      ]
    });

    const terminal = mockXtermInstances.at(-1);

    if (!terminal) {
      throw new Error("未创建 xterm 实例");
    }

    const handled = terminal.triggerWheel(-120);

    expect(handled).toBe(false);
    await waitFor(() => {
      expect(mockReadTerminalHistory).toHaveBeenCalledWith("terminal-1", {
        beforeSeq: 2,
        limit: 20
      });
    });
  });

  it("触摸滑动会推动终端原生视口，而不是只更新调试计数", async () => {
    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    const terminalMarker = await screen.findByTestId("mock-xterm");
    const viewportHost = terminalMarker.parentElement;
    const terminal = mockXtermInstances.at(-1);

    if (!(viewportHost instanceof HTMLElement) || !terminal) {
      throw new Error("未找到终端视口");
    }

    terminal.buffer.active.baseY = 40;
    terminal.buffer.active.viewportY = 10;

    fireEvent.touchStart(viewportHost, {
      touches: [{ clientX: 24, clientY: 160 }]
    });
    fireEvent.touchMove(viewportHost, {
      touches: [{ clientX: 26, clientY: 118 }]
    });

    expect(terminal.buffer.active.viewportY).toBeGreaterThan(10);
  });

  it("移动端触摸结束后会继续惯性滑动一小段", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });

    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    const terminalMarker = await screen.findByTestId("mock-xterm");
    const viewportHost = terminalMarker.parentElement;
    const terminal = mockXtermInstances.at(-1);

    if (!(viewportHost instanceof HTMLElement) || !terminal) {
      throw new Error("未找到终端视口");
    }

    terminal.buffer.active.baseY = 80;
    terminal.buffer.active.viewportY = 10;

    let perfNow = 0;
    vi.spyOn(performance, "now").mockImplementation(() => perfNow);

    let nextRafId = 0;
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal(
      "requestAnimationFrame",
      ((callback: FrameRequestCallback) => {
        nextRafId += 1;
        rafCallbacks.set(nextRafId, callback);
        return nextRafId;
      }) as typeof requestAnimationFrame
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      ((id: number) => {
        rafCallbacks.delete(id);
      }) as typeof cancelAnimationFrame
    );

    fireEvent.touchStart(viewportHost, {
      touches: [{ clientX: 24, clientY: 180 }]
    });
    perfNow = 20;
    fireEvent.touchMove(viewportHost, {
      touches: [{ clientX: 26, clientY: 124 }]
    });

    const viewportAfterTouchMove = terminal.buffer.active.viewportY;

    fireEvent.touchEnd(viewportHost, {
      changedTouches: [{ clientX: 26, clientY: 124 }]
    });

    let frameAt = 36;

    for (let index = 0; index < 4; index += 1) {
      const callbacks = [...rafCallbacks.values()];
      rafCallbacks.clear();

      callbacks.forEach((callback) => {
        callback(frameAt);
      });
      perfNow = frameAt;
      frameAt += 16;
    }

    expect(viewportAfterTouchMove).toBeGreaterThan(10);
    expect(terminal.buffer.active.viewportY).toBeGreaterThan(viewportAfterTouchMove);
  });

  it("键盘输入兜底会把常见按键翻译成终端序列", () => {
    expect(
      translateKeyboardEventToTerminalInput(new KeyboardEvent("keydown", { key: "d" }))
    ).toBe("d");
    expect(
      translateKeyboardEventToTerminalInput(new KeyboardEvent("keydown", { key: "Enter" }))
    ).toBe("\r");
    expect(
      translateKeyboardEventToTerminalInput(
        new KeyboardEvent("keydown", { key: "c", ctrlKey: true })
      )
    ).toBe("\u0003");
    expect(
      translateKeyboardEventToTerminalInput(new KeyboardEvent("keydown", { key: "ArrowUp" }))
    ).toBe("\u001b[A");
  });
});
