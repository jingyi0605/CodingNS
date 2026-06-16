import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import {
  createWindowDescriptor
} from "../../../platform/desktop/window-descriptor";
import {
  buildTerminalsExternalWindowId
} from "../../../platform/desktop/window-openers";
import { getSharedWindowRegistryStore } from "../../../platform/desktop/window-registry";
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
  mockFitDimensions,
  mockTerminalCellDimensions,
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
      sessions: [],
      childWorktrees: []
    },
    {
      workspace: {
        id: "workspace-2",
        name: "Docs Workspace",
        path: "/Users/jackson/Code/Docs",
        repoRoot: "/Users/jackson/Code/Docs"
      },
      sessions: [],
      childWorktrees: []
    }
  ] as WorkspaceSessionGroup[],
  mockFitDimensions: {
    cols: 120,
    rows: 30
  },
  mockTerminalCellDimensions: {
    width: 9,
    height: 18
  },
  mockCloseTerminal: vi.fn(),
  mockCreateTerminal: vi.fn(),
  mockDeleteTerminalRecord: vi.fn(),
  mockListTerminalShellOptions: vi.fn(),
  mockListWorkspaceTerminals: vi.fn(),
  mockXtermInstances: [] as Array<{
    rows: number;
    buffer: {
      active: {
        length: number;
        viewportY: number;
        baseY: number;
        getLine: () => null;
      };
    };
    renderedContent: string;
    selectionText: string;
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
  shellOptions: TerminalShellOptionDto[] = [],
  options: {
    targetHostId?: string | null;
  } = {}
) {
  const snapshot = {
    workspaceId,
    terminals,
    templates: [],
    templateStatuses: [],
    shellOptions,
    targetHostId: options.targetHostId ?? null
  };

  terminalManagerSnapshotByWorkspace.set(workspaceId, snapshot);
  const hostPart = options.targetHostId?.trim()
    ? `host.${encodeURIComponent(options.targetHostId.trim())}.`
    : "";
  writeViewSnapshot(`terminal-manager.snapshot.${hostPart}${workspaceId}`, snapshot);
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
    private terminal:
      | {
          cols: number;
          rows: number;
          triggerResize?: (dimensions: { cols: number; rows: number }) => void;
        }
      | null = null;

    bindTerminal(
      terminal: {
        cols: number;
        rows: number;
        triggerResize?: (dimensions: { cols: number; rows: number }) => void;
      }
    ) {
      this.terminal = terminal;
    }

    proposeDimensions() {
      return {
        cols: mockFitDimensions.cols,
        rows: mockFitDimensions.rows
      };
    }

    fit() {
      if (this.terminal) {
        this.terminal.cols = mockFitDimensions.cols;
        this.terminal.rows = mockFitDimensions.rows;
        this.terminal.triggerResize?.({
          cols: mockFitDimensions.cols,
          rows: mockFitDimensions.rows
        });
      }
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
    renderedContent = "";
    selectionText = "";
    element: HTMLElement | null = null;
    _core = {
      _renderService: {
        clear: vi.fn(),
        dimensions: {
          css: {
            cell: mockTerminalCellDimensions
          }
        }
      }
    };
    options = {
      fontSize: 14
    };
    private resizeHandler: ((dimensions: { cols: number; rows: number }) => void) | null = null;
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

    loadAddon(addon?: { bindTerminal?: (terminal: MockTerminal) => void }) {
      addon?.bindTerminal?.(this);
      return undefined;
    }

    onData() {
      return {
        dispose() {
          return undefined;
        }
      };
    }

    onResize(handler: (dimensions: { cols: number; rows: number }) => void) {
      this.resizeHandler = handler;
      return {
        dispose: () => {
          if (this.resizeHandler === handler) {
            this.resizeHandler = null;
          }
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
      const xtermRoot = document.createElement("div");
      xtermRoot.className = "xterm";
      xtermRoot.style.padding = "5px";
      const viewport = document.createElement("div");
      viewport.className = "xterm-viewport";
      const screen = document.createElement("div");
      screen.className = "xterm-screen";
      const scrollableElement = document.createElement("div");
      scrollableElement.className = "xterm-scrollable-element";
      const scrollArea = document.createElement("div");
      scrollArea.className = "xterm-scroll-area";
      const marker = document.createElement("div");
      marker.setAttribute("data-testid", "mock-xterm");
      screen.append(marker);
      scrollableElement.append(screen);
      xtermRoot.append(viewport, scrollableElement, scrollArea);
      container.append(xtermRoot);
      this.element = xtermRoot;
    }

    write(_content: string, callback?: () => void) {
      this.renderedContent += _content;
      this.buffer.active.baseY = Math.max(0, this.renderedContent.split("\r\n").length - 2);
      callback?.();
    }

    getSelection() {
      return this.selectionText;
    }

    focus() {
      return undefined;
    }

    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
      this.resizeHandler?.({ cols, rows });
      return undefined;
    }

    reset() {
      this.renderedContent = "";
      return undefined;
    }

    scrollToLine(line: number) {
      this.buffer.active.viewportY = Math.max(
        0,
        Math.min(this.buffer.active.baseY, line)
      );
      return undefined;
    }

    scrollToBottom() {
      this.buffer.active.viewportY = this.buffer.active.baseY;
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

    triggerResize(dimensions: { cols: number; rows: number }) {
      this.resizeHandler?.(dimensions);
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
  static OPEN = 1;

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

function renderPage(
  initialEntry = "/workspaces/workspace-1/terminals",
  props?: {
    externalWindowMode?: boolean;
    externalWindowWorkspaceId?: string | null;
    embeddedMode?: boolean;
    embeddedDockControls?: {
      orientation: "vertical" | "horizontal";
      onChangeOrientation: (orientation: "vertical" | "horizontal") => void;
      onClose: () => void;
    };
    workbenchShellOverrides?: Record<string, unknown>;
  }
) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/terminals" element={<TerminalPage {...props} />} />
          <Route path="/workspaces/:workspaceId/terminals" element={<TerminalPage {...props} />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

function WorkspaceRouteNavigator() {
  const navigate = useNavigate();

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          navigate("/workspaces/workspace-1/terminals");
        }}
      >
        切到工作区1终端
      </button>
      <button
        type="button"
        onClick={() => {
          navigate("/workspaces/workspace-2/terminals");
        }}
      >
        切到工作区2终端
      </button>
    </div>
  );
}

function renderPageWithWorkspaceNavigator(initialEntry = "/workspaces/workspace-1/terminals") {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <WorkspaceRouteNavigator />
        <Routes>
          <Route path="/terminals" element={<TerminalPage />} />
          <Route path="/workspaces/:workspaceId/terminals" element={<TerminalPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

function enableDesktopRuntime(
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> =
    vi.fn(async () => undefined) as unknown as <T>(
      command: string,
      args?: Record<string, unknown>
    ) => Promise<T>
): typeof invoke {
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: "MacIntel"
  });
  window.__TAURI_INTERNALS__ = {
    invoke
  };
  return invoke;
}

describe("TerminalPage", () => {
  const originalWebSocket = global.WebSocket;
  const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
  const windowRegistry = getSharedWindowRegistryStore();

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    MockWebSocket.instances = [];
    windowRegistry.clear();
    vi.spyOn(authStore, "refresh").mockResolvedValue({
      status: "deferred",
      session: null,
      error: new Error("mocked refresh")
    });
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
    mockFitDimensions.cols = 120;
    mockFitDimensions.rows = 30;
    mockTerminalCellDimensions.width = 9;
    mockTerminalCellDimensions.height = 18;
    MockWebSocket.instances.length = 0;
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
    windowRegistry.clear();
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
    setTerminalManagerSnapshot("workspace-1", [createdTerminal]);
    emitTerminalManagerSnapshot("workspace-1");

    await expect(createTerminalDeferred.promise).resolves.toMatchObject({
      id: createdTerminal.id,
      name: createdTerminal.name
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

    setTerminalManagerSnapshot("workspace-1", [], windowsShellOptions, {
      targetHostId: "peer-host-windows"
    });
    mockListTerminalShellOptions.mockResolvedValueOnce({
      items: windowsShellOptions
    });
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
          shell: "C:\\Program Files\\Git\\bin\\bash.exe",
          runtimeType: "tmux"
        }),
        expect.objectContaining({
          targetHostId: undefined
        })
      );
    });
  });

  it("PeerHost 指向 Windows 时，即使当前前端不在 Windows 也会先弹 shell 选择并默认走持久会话", async () => {
    const createdTerminal = buildTerminal({
      id: "terminal-peer-windows-created",
      name: "Peer Windows 终端",
      shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
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

    renderPage(undefined, {
      workbenchShellOverrides: {
        currentTargetHostId: "peer-host-windows"
      }
    });

    await userEvent.click(screen.getByRole("button", { name: "新建终端" }));

    expect(mockCreateTerminal).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "新建终端" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /^持久会话 使用基于 ConPTY 的 Windows 持久化会话，让终端在 Host 重启后仍可继续保留。 已启用$/
      })
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /PowerShell/ }));
    await userEvent.click(screen.getByRole("button", { name: "创建终端" }));

    await waitFor(() => {
      expect(mockCreateTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
          runtimeType: "tmux"
        }),
        expect.objectContaining({
          targetHostId: "peer-host-windows"
        })
      );
    });
  });

  it("命中缓存后进入终端页也会立刻请求刷新，而不是等延迟定时器", async () => {
    const cachedTerminal = buildTerminal({
      id: "terminal-cached",
      name: "缓存终端"
    });
    setTerminalManagerSnapshot("workspace-1", [cachedTerminal]);

    renderPage();

    await screen.findByRole("tab", { name: /缓存终端/ });
    await waitFor(() => {
      expect(mockSubscribeTerminalManagerSnapshot).toHaveBeenCalledWith(
        "workspace-1",
        expect.objectContaining({
          knownRevision: null,
          targetHostId: undefined
        })
      );
    });
    await waitFor(() => {
      expect(mockRequestTerminalManagerRefresh).toHaveBeenCalledWith("workspace-1");
    });
  });

  it("targetHostId 变更后会按新的 host 重新订阅并刷新终端快照", async () => {
    const subscribeTerminalManagerSnapshot = vi.fn();
    const requestTerminalManagerRefresh = vi.fn();
    const addTerminalManagerSnapshotListener = vi.fn(() => () => undefined);

    const { rerender } = renderPage("/workspaces/workspace-1/terminals", {
      workbenchShellOverrides: {
        navigationGroups,
        currentWorkspaceId: "workspace-1",
        currentTargetHostId: null,
        selectWorkspace: vi.fn(),
        subscribeTerminalManagerSnapshot,
        requestTerminalManagerRefresh,
        addTerminalManagerSnapshotListener
      } as never
    });

    await screen.findByRole("button", { name: "新建终端" });

    await waitFor(() => {
      expect(subscribeTerminalManagerSnapshot).toHaveBeenCalledWith(
        "workspace-1",
        expect.objectContaining({
          knownRevision: null,
          targetHostId: undefined
        })
      );
    });
    await waitFor(() => {
      expect(requestTerminalManagerRefresh).toHaveBeenCalledWith(
        "workspace-1",
        expect.objectContaining({
          knownRevision: null,
          targetHostId: undefined
        })
      );
    });

    subscribeTerminalManagerSnapshot.mockClear();
    requestTerminalManagerRefresh.mockClear();

    rerender(
      <ToastProvider>
        <MemoryRouter initialEntries={["/workspaces/workspace-1/terminals"]}>
          <Routes>
            <Route
              path="/workspaces/:workspaceId/terminals"
              element={(
                <TerminalPage
                  workbenchShellOverrides={{
                    navigationGroups,
                    currentWorkspaceId: "workspace-1",
                    currentTargetHostId: "peer-host-1",
                    selectWorkspace: vi.fn(),
                    subscribeTerminalManagerSnapshot,
                    requestTerminalManagerRefresh,
                    addTerminalManagerSnapshotListener
                  } as never}
                />
              )}
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(subscribeTerminalManagerSnapshot).toHaveBeenCalledWith(
        "workspace-1",
        expect.objectContaining({ targetHostId: "peer-host-1" })
      );
    });
    await waitFor(() => {
      expect(requestTerminalManagerRefresh).toHaveBeenCalledWith(
        "workspace-1",
        expect.objectContaining({ targetHostId: "peer-host-1" })
      );
    });
  });

  it("显式传入不在导航列表里的工作区时，仍然使用该工作区加载终端", async () => {
    renderPage("/terminals", {
      externalWindowWorkspaceId: "workspace-isolated-1"
    });

    await screen.findByRole("button", { name: "新建终端" });

    await waitFor(() => {
      expect(mockSubscribeTerminalManagerSnapshot).toHaveBeenCalledWith(
        "workspace-isolated-1",
        expect.any(Object)
      );
    });
  });

  it("嵌入到父会话路由时，会优先使用显式传入的工作区，而不是父路由 workspaceId", async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-1"]}>
          <Routes>
            <Route
              path="/workspaces/:workspaceId/sessions/:sessionId"
              element={
                <TerminalPage
                  embeddedMode
                  externalWindowWorkspaceId="workspace-isolated-1"
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await screen.findByRole("button", { name: "新建终端" });

    await waitFor(() => {
      expect(mockSubscribeTerminalManagerSnapshot).toHaveBeenCalledWith(
        "workspace-isolated-1",
        expect.any(Object)
      );
    });
  });

  it("嵌入到父会话路由时，新建终端会落到显式传入的隔离工作区", async () => {
    const createdTerminal = buildTerminal({
      id: "terminal-isolated-1",
      workspaceId: "workspace-isolated-1",
      cwd: "/Users/jackson/Code/TEST.worktrees/parallel-member-a"
    });

    mockCreateTerminal.mockResolvedValueOnce(createdTerminal);
    mockListWorkspaceTerminals.mockResolvedValueOnce({
      items: [createdTerminal]
    });

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-1"]}>
          <Routes>
            <Route
              path="/workspaces/:workspaceId/sessions/:sessionId"
              element={
                <TerminalPage
                  embeddedMode
                  externalWindowWorkspaceId="workspace-isolated-1"
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await userEvent.click(await screen.findByRole("button", { name: "新建终端" }));

    await waitFor(() => {
      expect(mockCreateTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-isolated-1"
        }),
        expect.objectContaining({
          targetHostId: undefined
        })
      );
    });
  });

  it("嵌入工作台时只在左右停靠下把终端标签栏放到顶部", async () => {
    const onChangeOrientation = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/workspaces/workspace-1/terminals"]}>
          <Routes>
            <Route
              path="/workspaces/:workspaceId/terminals"
              element={(
                <TerminalPage
                  embeddedMode
                  externalWindowWorkspaceId="workspace-1"
                  embeddedDockControls={{
                    orientation: "horizontal",
                    onChangeOrientation,
                    onClose
                  }}
                />
              )}
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await screen.findByRole("button", { name: "新建终端" });

    let desktopShell = document.querySelector(".terminal-desktop-shell");
    expect(desktopShell).not.toBeNull();
    expect(desktopShell).toHaveAttribute("data-top-tabstrip", "true");
    expect(desktopShell?.querySelector(".terminal-desktop-tabstrip")).toBeVisible();
    expect(desktopShell?.querySelector(".terminal-desktop-rail")).toBeNull();

    rerender(
      <ToastProvider>
        <MemoryRouter initialEntries={["/workspaces/workspace-1/terminals"]}>
          <Routes>
            <Route
              path="/workspaces/:workspaceId/terminals"
              element={(
                <TerminalPage
                  embeddedMode
                  externalWindowWorkspaceId="workspace-1"
                  embeddedDockControls={{
                    orientation: "vertical",
                    onChangeOrientation,
                    onClose
                  }}
                />
              )}
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    desktopShell = document.querySelector(".terminal-desktop-shell");
    await waitFor(() => {
      expect(desktopShell).toHaveAttribute("data-top-tabstrip", "false");
    });
    expect(desktopShell?.querySelector(".terminal-desktop-tabstrip")).toBeNull();
    expect(desktopShell?.querySelector(".terminal-desktop-rail")).not.toBeNull();
  });

  it("嵌入模式会把工作台终端布局和关闭按钮并到终端标签栏", async () => {
    const onChangeOrientation = vi.fn();
    const onClose = vi.fn();

    renderPage("/workspaces/workspace-1/terminals", {
      embeddedMode: true,
      externalWindowWorkspaceId: "workspace-1",
      embeddedDockControls: {
        orientation: "vertical",
        onChangeOrientation,
        onClose
      }
    });

    await screen.findByRole("button", { name: "新建终端" });

    fireEvent.click(screen.getByRole("button", { name: "切换到左右布局" }));
    expect(onChangeOrientation).toHaveBeenCalledWith("horizontal");

    fireEvent.click(screen.getByRole("button", { name: "关闭终端面板" }));
    expect(onClose).toHaveBeenCalledTimes(1);
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

    fireEvent.click(
      screen.getByRole("button", {
        name: "展开终端工具菜单"
      })
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "左右分栏"
      })
    );

    const actionButtons = await screen.findAllByRole("button", { name: "终端操作" });
    fireEvent.click(actionButtons[0]);

    expect(screen.getByRole("menuitem", { name: "绑定到主分栏" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "绑定到副分栏" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "绑定到当前分栏" })).not.toBeInTheDocument();
  });

  it("桌面端工具菜单会提供独立窗口入口，并恢复标签栏原生拖动区域", async () => {
    const invokeMock = enableDesktopRuntime();

    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    await screen.findByText("工作终端");
    expect(document.querySelector(".terminal-tabbar")).toHaveAttribute("data-tauri-drag-region", "");
    expect(document.querySelector(".terminal-tabbar-scroll")).toHaveAttribute("data-window-drag", "ignore");
    expect(document.querySelector(".terminal-toolbar-anchor")).toHaveAttribute("data-window-drag", "ignore");

    await userEvent.click(
      screen.getByRole("button", {
        name: "展开终端工具菜单"
      })
    );

    expect(screen.queryByText("新终端使用的 Shell")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Runtime")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", {
        name: "独立窗口"
      })
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "create_window",
        expect.objectContaining({
          descriptor: expect.objectContaining({
            kind: "terminals",
            windowId: "terminals-workspace-1",
            workspaceId: "workspace-1",
            workspaceName: "Demo Workspace",
            focusOwner: "terminal-page"
          })
        })
      );
    });
  });

  it("独立终端窗口在窗口尺寸变化后会重新上报终端大小，不会沿用主窗口旧高度", async () => {
    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage(undefined, {
      externalWindowMode: true,
      externalWindowWorkspaceId: "workspace-1"
    });

    await screen.findByText("工作终端");
    const terminalMarker = await screen.findByTestId("mock-xterm");
    const viewportHost = terminalMarker.closest(".terminal-xterm") as HTMLElement | null;

    if (!viewportHost) {
      throw new Error("未找到终端视口容器");
    }

    Object.defineProperty(viewportHost, "clientWidth", {
      configurable: true,
      value: 900
    });
    Object.defineProperty(viewportHost, "clientHeight", {
      configurable: true,
      value: 600
    });

    const socket = MockWebSocket.instances.at(-1);

    if (!socket) {
      throw new Error("未建立终端 WebSocket 连接");
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), 180);
    });

    socket.sentPayloads.length = 0;
    mockFitDimensions.cols = 88;
    mockFitDimensions.rows = 22;

    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      const resizePayload = socket.sentPayloads
        .map((payload) => JSON.parse(payload) as { type: string; cols?: number; rows?: number })
        .find((payload) => payload.type === "terminal.resize" && payload.cols === 88 && payload.rows === 22);

      expect(resizePayload).toBeDefined();
    });
  });

  it("终端重排会按真实 viewport 高度收敛行数，不会固定多算到底部外", async () => {
    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage(undefined, {
      externalWindowMode: true,
      externalWindowWorkspaceId: "workspace-1"
    });

    await screen.findByText("工作终端");
    const terminalMarker = await screen.findByTestId("mock-xterm");
    const viewportHost = terminalMarker.closest(".terminal-xterm") as HTMLElement | null;
    const xtermRoot = terminalMarker.closest(".xterm") as HTMLElement | null;

    if (!viewportHost || !xtermRoot) {
      throw new Error("未找到终端视口元素");
    }

    Object.defineProperty(viewportHost, "clientWidth", {
      configurable: true,
      value: 960
    });
    Object.defineProperty(viewportHost, "clientHeight", {
      configurable: true,
      value: 640
    });
    mockTerminalCellDimensions.width = 9;
    mockTerminalCellDimensions.height = 18;

    const socket = MockWebSocket.instances.at(-1);

    if (!socket) {
      throw new Error("未建立终端 WebSocket 连接");
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), 180);
    });

    socket.sentPayloads.length = 0;
    Object.defineProperty(xtermRoot, "clientWidth", {
      configurable: true,
      value: 892
    });
    Object.defineProperty(xtermRoot, "clientHeight", {
      configurable: true,
      value: 352
    });
    mockFitDimensions.cols = 120;
    mockFitDimensions.rows = 21;

    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      const resizePayload = socket.sentPayloads
        .map((payload) => JSON.parse(payload) as { type: string; cols?: number; rows?: number })
        .find((payload) => payload.type === "terminal.resize");

      expect(resizePayload).toMatchObject({
        cols: 98,
        rows: 19
      });
    });
  });

  it("桌面端终端选中文本后右键会出现复制，并写入系统剪贴板", async () => {
    const invokeMock = enableDesktopRuntime(
      vi.fn(async (command: string) => {
        if (command === "copy_text") {
          return {
            ok: true
          };
        }

        return undefined;
      }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>
    );

    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    await screen.findByText("工作终端");
    const terminalMarker = await screen.findByTestId("mock-xterm");
    const paneCard = terminalMarker.closest(".terminal-pane-card");

    if (!paneCard) {
      throw new Error("未找到终端容器");
    }

    mockXtermInstances[0]!.selectionText = "ts error line";

    fireEvent.contextMenu(paneCard, {
      clientX: 80,
      clientY: 96
    });

    const copyMenuItem = await screen.findByRole("menuitem", { name: "复制" });
    await userEvent.click(copyMenuItem);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("copy_text", {
        text: "ts error line"
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "复制" })).not.toBeInTheDocument();
    });
  });

  it("独立终端窗口打开后，主窗口不会再用自己的尺寸覆盖同一工作区终端", async () => {
    const detachedWindowId = buildTerminalsExternalWindowId("workspace-1");
    windowRegistry.registerDescriptor(
      createWindowDescriptor({
        windowId: detachedWindowId,
        kind: "terminals",
        workspaceId: "workspace-1",
        workspaceName: "Demo Workspace",
        mode: "external",
        focusOwner: "terminal-page"
      })
    );
    windowRegistry.markWindowOpen(detachedWindowId);
    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    await screen.findByText("工作终端");
    const terminalMarker = await screen.findByTestId("mock-xterm");
    const viewportHost = terminalMarker.closest(".terminal-xterm") as HTMLElement | null;

    if (!viewportHost) {
      throw new Error("未找到终端视口容器");
    }

    Object.defineProperty(viewportHost, "clientWidth", {
      configurable: true,
      value: 640
    });
    Object.defineProperty(viewportHost, "clientHeight", {
      configurable: true,
      value: 420
    });

    const socket = MockWebSocket.instances.at(-1);

    if (!socket) {
      throw new Error("未建立终端 WebSocket 连接");
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), 180);
    });

    socket.sentPayloads.length = 0;
    mockFitDimensions.cols = 66;
    mockFitDimensions.rows = 18;

    fireEvent(window, new Event("resize"));

    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), 80);
    });

    const resizePayload = socket.sentPayloads
      .map((payload) => JSON.parse(payload) as { type: string; cols?: number; rows?: number })
      .find((payload) => payload.type === "terminal.resize");

    expect(resizePayload).toBeUndefined();
  });

  it("终端标签顺序按创建时间稳定显示，不会因为最近活跃时间变化自动重排", async () => {
    setTerminalManagerSnapshot("workspace-1", [
      buildTerminal({
        id: "terminal-1",
        name: "CodingNS 1",
        createdAt: "2026-03-26T08:00:00.000Z",
        lastActiveAt: "2026-03-26T08:30:00.000Z"
      }),
      buildTerminal({
        id: "terminal-2",
        name: "CodingNS 2",
        runtimeSessionId: "session-2",
        attachTarget: "tmux://session-2",
        processId: 4567,
        createdAt: "2026-03-26T08:01:00.000Z",
        lastActiveAt: "2026-03-26T10:30:00.000Z"
      }),
      buildTerminal({
        id: "terminal-3",
        name: "CodingNS 3",
        runtimeSessionId: "session-3",
        attachTarget: "tmux://session-3",
        processId: 5678,
        createdAt: "2026-03-26T08:02:00.000Z",
        lastActiveAt: "2026-03-26T09:30:00.000Z"
      })
    ]);

    renderPage();

    await screen.findByText("CodingNS 1");

    await waitFor(() => {
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.includes("CodingNS 1"))).toContain(true);
    });

    const orderedTabLabels = screen
      .getAllByRole("tab")
      .map((tab) => tab.querySelector(".terminal-tab-name-text")?.textContent?.trim() ?? "");

    expect(orderedTabLabels).toEqual(["CodingNS 1", "CodingNS 2", "CodingNS 3"]);
  });

  it("运行中和异常终端的菜单只显示各自允许的生命周期动作", async () => {
    setTerminalManagerSnapshot("workspace-1", [
      buildTerminal({
        id: "terminal-running",
        name: "运行中终端",
        createdAt: "2026-03-26T08:00:00.000Z"
      }),
      buildTerminal({
        id: "terminal-error",
        name: "异常终端",
        runtimeSessionId: "session-2",
        attachTarget: "tmux://session-2",
        status: "error",
        processId: null,
        statusDetail: "tmux exited",
        createdAt: "2026-03-26T08:01:00.000Z"
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

    expect(mockCloseTerminal).toHaveBeenCalledWith(
      "terminal-running",
      expect.objectContaining({ targetHostId: undefined })
    );
    expect(await screen.findByText("关闭中")).toBeInTheDocument();

    closeDeferred.resolve({
      success: true
    });

    await waitFor(() => {
      expect(mockListWorkspaceTerminals).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockDeleteTerminalRecord).toHaveBeenCalledWith(
        "terminal-running",
        expect.objectContaining({ targetHostId: undefined })
      );
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

    expect(mockDeleteTerminalRecord).toHaveBeenCalledWith(
      "terminal-error",
      expect.objectContaining({ targetHostId: undefined })
    );
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
        name: /^持久会话 使用基于 ConPTY 的 Windows 持久化会话，让终端在 Host 重启后仍可继续保留。 已启用$/
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
        }),
        expect.objectContaining({
          targetHostId: undefined
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

  it("切换工作区后再回来时，会恢复该工作区上次最后使用的终端标签", async () => {
    let now = Date.parse("2026-04-26T08:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);

    setTerminalManagerSnapshot("workspace-1", [
      buildTerminal({
        id: "workspace-1-terminal-1",
        name: "工作区1-终端-1"
      }),
      buildTerminal({
        id: "workspace-1-terminal-2",
        name: "工作区1-终端-2",
        runtimeSessionId: "session-2",
        attachTarget: "tmux://session-2",
        processId: 4567,
        createdAt: "2026-03-26T08:01:00.000Z",
        lastActiveAt: "2026-03-26T08:01:00.000Z"
      })
    ]);
    setTerminalManagerSnapshot("workspace-2", [
      buildTerminal({
        id: "workspace-2-terminal-1",
        workspaceId: "workspace-2",
        name: "工作区2-终端-1",
        cwd: "/Users/jackson/Code/Docs"
      })
    ]);

    renderPageWithWorkspaceNavigator();

    const workspaceOneSecondTab = await screen.findByRole("tab", { name: /工作区1-终端-2/ });
    await userEvent.click(workspaceOneSecondTab);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /工作区1-终端-2/ })).toHaveAttribute("aria-selected", "true");
    });

    now += 61_000;
    await userEvent.click(screen.getByRole("button", { name: "切到工作区2终端" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /工作区2-终端-1/ })).toHaveAttribute("aria-selected", "true");
    });

    now += 61_000;
    await userEvent.click(screen.getByRole("button", { name: "切到工作区1终端" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /工作区1-终端-2/ })).toHaveAttribute("aria-selected", "true");
    });
  });

  it("滚到终端顶部时会继续加载更早历史", async () => {
    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    await screen.findByText("工作终端");
    await waitFor(() => {
      expect(screen.getByTestId("mock-xterm")).toBeInTheDocument();
    });

    const socket = MockWebSocket.instances.at(-1);

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

  it("终端视口容器会设置底部安全区变量，给最新输入留出可视空白", async () => {
    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    await screen.findByText("工作终端");
    await waitFor(() => {
      const terminalMarker = screen.getByTestId("mock-xterm");
      const viewportHost = terminalMarker.closest(".terminal-xterm") as HTMLElement | null;
      expect(viewportHost).not.toBeNull();
      expect(viewportHost?.style.getPropertyValue("--terminal-bottom-gap")).toBe("5px");
    });
  });

  it("终端视口容器会同步终端主题变量，避免边距回退成默认白底", async () => {
    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    await screen.findByText("工作终端");
    await waitFor(() => {
      const terminalMarker = screen.getByTestId("mock-xterm");
      const viewportHost = terminalMarker.closest(".terminal-xterm") as HTMLElement | null;
      expect(viewportHost).not.toBeNull();
      expect(viewportHost?.style.getPropertyValue("--terminal-theme-background")).not.toBe("");
      expect(viewportHost?.style.background).not.toBe("");
    });
  });

  it("自动贴底时会保持跟随最新输出，不会把最新内容滚到视口外面", async () => {
    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    await screen.findByText("工作终端");
    await screen.findByTestId("mock-xterm");

    const terminal = mockXtermInstances.at(-1);

    if (!terminal) {
      throw new Error("未创建 xterm 实例");
    }

    terminal.rows = 20;
    terminal.buffer.active.baseY = 10;
    terminal.buffer.active.viewportY = 10;

    const socket = MockWebSocket.instances.at(-1);

    if (!socket) {
      throw new Error("未建立终端 WebSocket 连接");
    }

    socket.dispatchMessage({
      type: "terminal.backfill",
      terminalId: "terminal-1",
      truncated: false,
      cursorReset: false,
      latestCursor: "12",
      chunks: [
        {
          terminalId: "terminal-1",
          cursor: "12",
          stream: "stdout",
          content: Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\r\n") + "\r\n",
          timestamp: "2026-03-26T08:00:00.000Z"
        }
      ]
    });

    await waitFor(() => {
      expect(terminal.buffer.active.baseY).toBe(11);
      expect(terminal.buffer.active.viewportY).toBe(11);
    });
  });

  it("终端输出会在 write 完成后再贴底，避免输入时光标先掉到视口外", async () => {
    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    await screen.findByText("工作终端");
    const terminal = mockXtermInstances.at(-1);
    const socket = MockWebSocket.instances.at(-1);

    if (!terminal || !socket) {
      throw new Error("未建立终端运行时");
    }

    terminal.rows = 20;

    const originalWrite = terminal.write.bind(terminal);
    terminal.write = (content: string, callback?: () => void) => {
      queueMicrotask(() => {
        originalWrite(content, callback);
      });
    };

    socket.dispatchMessage({
      type: "terminal.backfill",
      terminalId: "terminal-1",
      truncated: false,
      cursorReset: false,
      latestCursor: "10",
      chunks: [
        {
          terminalId: "terminal-1",
          cursor: "10",
          stream: "stdout",
          content: Array.from({ length: 11 }, (_, index) => `seed ${index + 1}`).join("\r\n") + "\r\n",
          timestamp: "2026-03-26T08:00:01.000Z"
        }
      ]
    });

    await waitFor(() => {
      expect(terminal.buffer.active.baseY).toBe(10);
      expect(terminal.buffer.active.viewportY).toBe(10);
    });

    socket.dispatchMessage({
      type: "terminal.output",
      terminalId: "terminal-1",
      chunk: {
        terminalId: "terminal-1",
        cursor: "11",
        stream: "stdout",
        content: "next line\r\n",
        timestamp: "2026-03-26T08:00:02.000Z"
      }
    });

    expect(terminal.buffer.active.viewportY).toBe(10);

    await waitFor(() => {
      expect(terminal.buffer.active.baseY).toBe(11);
      expect(terminal.buffer.active.viewportY).toBe(11);
    });
  });

  it("终端没有发生原生视口滚动时，不会因为滚轮事件就主动拉取更早历史", async () => {
    setTerminalManagerSnapshot("workspace-1", [buildTerminal()]);

    renderPage();

    await screen.findByText("工作终端");
    await waitFor(() => {
      expect(screen.getByTestId("mock-xterm")).toBeInTheDocument();
    });

    const socket = MockWebSocket.instances.at(-1);

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
