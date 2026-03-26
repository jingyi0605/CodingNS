import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { authStore } from "../../auth/store/auth-store";
import { ToastProvider } from "../../../shared/toast";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";
import type { TerminalDto, TerminalShellOptionDto } from "../api/terminal-api";
import { TerminalPage } from "./TerminalPage";

const {
  navigationGroups,
  mockCreateTerminal,
  mockListTerminalShellOptions,
  mockListWorkspaceTerminals
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
    }
  ] as WorkspaceSessionGroup[],
  mockCreateTerminal: vi.fn(),
  mockListTerminalShellOptions: vi.fn(),
  mockListWorkspaceTerminals: vi.fn()
}));

vi.mock("../../conversation/components/WorkbenchLayout", async () => {
  const actual = await vi.importActual("../../conversation/components/WorkbenchLayout");

  return {
    ...actual,
    useWorkbenchShell: () => ({
      navigationGroups
    })
  };
});

vi.mock("../api/terminal-api", async () => {
  const actual = await vi.importActual("../api/terminal-api");

  return {
    ...actual,
    createTerminal: mockCreateTerminal,
    listTerminalShellOptions: mockListTerminalShellOptions,
    listWorkspaceTerminals: mockListWorkspaceTerminals,
    closeTerminal: vi.fn(),
    deleteTerminalRecord: vi.fn()
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

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/terminals"]}>
        <TerminalPage />
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
    mockCreateTerminal.mockReset();
    mockListTerminalShellOptions.mockReset();
    mockListWorkspaceTerminals.mockReset();
    mockListTerminalShellOptions.mockResolvedValue(buildShellOption());
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

    if (originalFonts) {
      Object.defineProperty(document, "fonts", originalFonts);
      return;
    }

    Reflect.deleteProperty(document, "fonts");
  });

  it("点击加号后会先显示创建中的窗口，并且旧列表请求不会冲掉新终端", async () => {
    const initialListDeferred = createDeferred<{ items: TerminalDto[] }>();
    const postCreateListDeferred = createDeferred<{ items: TerminalDto[] }>();
    const createTerminalDeferred = createDeferred<TerminalDto>();
    const createdTerminal = buildTerminal();

    mockListWorkspaceTerminals
      .mockImplementationOnce(() => initialListDeferred.promise)
      .mockImplementationOnce(() => postCreateListDeferred.promise);
    mockCreateTerminal.mockImplementationOnce(() => createTerminalDeferred.promise);

    renderPage();

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
      expect(mockListWorkspaceTerminals).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-xterm")).toBeInTheDocument();
    });

    initialListDeferred.resolve({
      items: []
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-xterm")).toBeInTheDocument();
    });

    postCreateListDeferred.resolve({
      items: [createdTerminal]
    });

    await waitFor(() => {
      expect(screen.getByText("工作终端")).toBeInTheDocument();
    });
  });
});
