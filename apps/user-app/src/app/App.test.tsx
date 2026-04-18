import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { clientConfigStore } from "../config/client-config-store";
import { getActiveHostBaseUrl } from "../config/client-config-types";
import { serverConfigStore } from "../config/server-config";
import { userPreferenceStore } from "../preferences/user-preference-store";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { authStore } from "../features/auth/store/auth-store";
import { ConversationPage } from "../features/conversation/pages/ConversationPage";
import { SettingsPage } from "../features/settings/pages/SettingsPage";
import { WorkbenchShellRoute } from "../features/workbench/components/WorkbenchShellRoute";
import { PlatformProvider } from "../platform/platform-provider";
import { t } from "../shared/i18n";
import { I18nProvider } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { ToastProvider } from "../shared/toast";
import { AppVersionProvider } from "../shared/version/app-version";

interface MockSocketMessage {
  type: string;
  [key: string]: unknown;
}

interface MockSessionRecord {
  detail: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  history: Record<string, unknown>;
  runtime?: Record<string, unknown>;
}

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];
  static workbenchSnapshot: Record<string, unknown> = { items: [] };

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

  static reset() {
    MockWebSocket.instances = [];
    MockWebSocket.workbenchSnapshot = { items: [] };
  }

  send(payload: string) {
    this.sentPayloads.push(payload);
    const parsed = JSON.parse(payload) as { type: string; sessionId?: string };

    if (parsed.type === "workbench.subscribe" || parsed.type === "workbench.refresh") {
      this.dispatchMessage({
        type: "workbench.snapshot",
        snapshot: MockWebSocket.workbenchSnapshot
      });
      return;
    }

    if (parsed.type === "session.subscribe" && parsed.sessionId) {
      this.dispatchMessage({
        type: "session.subscribed",
        sessionId: parsed.sessionId
      });
    }
  }

  close() {
    this.dispatchEvent(new Event("close"));
  }

  dispatchMessage(payload: MockSocketMessage) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify(payload)
      })
    );
  }
}

const originalFetch = global.fetch;
const originalWebSocket = global.WebSocket;
const originalInnerWidth = window.innerWidth;
const originalTauriInternals = window.__TAURI_INTERNALS__;
const MULTI_WINDOW_COMMANDS = [
  "create_window",
  "close_window",
  "focus_window",
  "list_windows",
  "get_window_descriptor",
  "sync_window_descriptor",
  "update_window_bounds"
] as const;

describe("app routes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    userPreferenceStore.hydrate(createPreferenceState());
    serverConfigStore.reset();
    authStore.clear();
    MockWebSocket.reset();
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth
    });

    if (originalTauriInternals) {
      window.__TAURI_INTERNALS__ = originalTauriInternals;
      return;
    }

    delete window.__TAURI_INTERNALS__;
  });

  it("未登录访问受保护页面时会回到登录页", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/api/public/bootstrap-status")) {
        return createJsonResponse({ initialized: true });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    window.history.pushState({}, "", "/workspaces/workspace-1/sessions/session-1");

    render(<App />);

    expect(await screen.findByText(t("auth.loginTitle"))).toBeInTheDocument();
  });

  it("登录页切换服务器后会把登录请求发到新地址", async () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/api/public/bootstrap-status")) {
        return createJsonResponse({ initialized: true });
      }

      if (url === "http://10.10.1.8:4100/api/auth/login" && init?.method === "POST") {
        return createJsonResponse(
          {
            accessToken: "access-token",
            refreshToken: "refresh-token",
            expiresIn: 3600,
            user: {
              userId: "user-1",
              username: "admin",
              role: "admin"
            }
          },
          201
        );
      }

      throw new Error(`未处理的请求: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText(t("auth.loginTitle"));
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(t("auth.serverSettings")) })
    );

    const dialog = await screen.findByRole("dialog");
    const addressInput = within(dialog).getByLabelText(t("auth.serverAddress"));

    await userEvent.clear(addressInput);
    await userEvent.type(addressInput, "10.10.1.8:4100");
    await userEvent.tab();
    await userEvent.click(within(dialog).getByRole("button", { name: t("auth.saveServerSettings") }));
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(t("auth.submitLogin")) })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://10.10.1.8:4100/api/auth/login",
        expect.objectContaining({
          method: "POST"
        })
      );
    });
  });

  it("移动端命中已移除的旧链接时，会兜底回工作区首页", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });

    hydrateAuth();
    installFetchMock({
      workbenchSnapshot: createWorkbenchSnapshot([]),
      sessions: {}
    });

    window.history.pushState({}, "", "/sessions/legacy-session");

    render(<App />);

    expect(await screen.findByRole("button", { name: t("shell.importWorkspaceTitle") })).toBeInTheDocument();
  });

  it("桌面端命中已移除的旧链接时，会兜底回桌面落地页", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1280
    });

    hydrateAuth();
    installFetchMock({
      workbenchSnapshot: createWorkbenchSnapshot([]),
      sessions: {}
    });

    window.history.pushState({}, "", "/tools/processes");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "先选一个会话" })).toBeInTheDocument();
  });

  it("桌面端主窗口默认流程不会主动触发多窗口命令", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1280
    });

    const invokeMock = vi.fn(async <T,>(command: string): Promise<T> => {
      if (command === "get_runtime_info") {
        return {
          version: "0.1.2",
          appDataDir: null,
          windowChrome: {
            macosTitlebar: null
          }
        } as T;
      }

      return undefined as T;
    });
    const invoke = invokeMock as NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"];

    window.__TAURI_INTERNALS__ = { invoke };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    hydrateAuth();
    installFetchMock({
      workbenchSnapshot: createWorkbenchSnapshot([]),
      sessions: {}
    });

    window.history.pushState({}, "", "/tools/processes");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "先选一个会话" })).toBeInTheDocument();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });

    const invokedCommands = invokeMock.mock.calls.map(([command]: [string, ...unknown[]]) => command);

    expect(invokedCommands).toContain("get_runtime_info");
    expect(invokedCommands).not.toEqual(expect.arrayContaining([...MULTI_WINDOW_COMMANDS]));
  });

  it("实时连接会跟着当前服务器地址切换", async () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    serverConfigStore.setBaseUrl("http://10.10.1.8:4100");
    await waitFor(() => {
      expect(getActiveHostBaseUrl(clientConfigStore.getState())).toBe("http://10.10.1.8:4100");
    });
    hydrateAuth();

    installFetchMock({
      workbenchSnapshot: createWorkbenchSnapshot([
        {
          workspace: createWorkspace(),
          sessions: [createSessionSummary({ sessionId: "session-1", title: "Spec003 主链路" })]
        }
      ]),
      sessions: {
        "session-1": {
          detail: createSessionSummary({ sessionId: "session-1", title: "Spec003 主链路" }),
          capabilities: createCapabilities(),
          history: createHistoryPage([])
        }
      }
    });

    const bootstrapHistoryMessage = createHistoryMessage({
      messageId: "history-bootstrap-1",
      role: "assistant",
      content: "历史消息已经到了。",
      sequence: 1
    });

    renderConversationRoute("session-1", {
      state: {
        bootstrap: {
          sessionId: "session-1",
          messages: [bootstrapHistoryMessage]
        }
      }
    });

    await waitFor(() => {
      expect(MockWebSocket.instances.some((socket) => socket.url.startsWith("ws://10.10.1.8:4100/ws?"))).toBe(true);
    });
  });

  it("设置页点击保存按钮后会更新服务器地址", async () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    renderSettingsPage();

    const addressInput = screen.getByRole("textbox", { name: t("settings.serverAddress") });
    const saveButton = screen.getByRole("button", { name: t("common.save") });

    expect(saveButton).toBeDisabled();

    await userEvent.clear(addressInput);
    await userEvent.type(addressInput, "10.10.1.8:4100");

    expect(saveButton).not.toBeDisabled();

    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(getActiveHostBaseUrl(clientConfigStore.getState())).toBe("http://10.10.1.8:4100");
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("common.save") })).toBeDisabled();
    });
  });

  it("设置页可以切换默认会话权限模式", async () => {
    renderSettingsPage();

    const select = screen.getByRole("combobox", { name: t("settings.defaultPermissionMode") });

    expect(select).toHaveValue("default");

    await userEvent.selectOptions(select, "bypassPermissions");

    await waitFor(() => {
      expect(userPreferenceStore.getState().profile.defaultPermissionMode).toBe("bypassPermissions");
    });
  });

  it("已登录时只拉一次工作台快照，并可以加载会话与发送消息", async () => {
    hydrateAuth();

    const workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace(),
        sessions: [createSessionSummary({ sessionId: "session-1", title: "Spec003 主链路" })]
      }
    ]);
    const fetchMock = installFetchMock({
      workbenchSnapshot,
      sessions: {
        "session-1": {
          detail: createSessionSummary({ sessionId: "session-1", title: "Spec003 主链路" }),
          capabilities: createCapabilities(),
          history: createHistoryPage([
            createHistoryMessage({
              messageId: "history-1",
              role: "assistant",
              content: "历史消息已经到了。",
              sequence: 1
            })
          ])
        }
      },
      extraHandler: (url, init) => {
        if (url.endsWith("/api/sessions/session-1/messages") && init?.method === "POST") {
          return createJsonResponse(
            {
              sessionId: "session-1",
              acceptedAt: "2026-03-23T10:01:00.000Z",
              clientRequestId: "client-send-1",
              message: createHistoryMessage({
                messageId: "sent-1",
                role: "user",
                content: "把 capability gate 接上去",
                sequence: 2,
                timestamp: "2026-03-23T10:01:00.000Z"
              })
            },
            201
          );
        }

        return null;
      }
    });

    renderConversationRoute("session-1");

    expect((await screen.findAllByRole("heading", { name: "Spec003 主链路" })).length).toBeGreaterThan(0);
    expect(await screen.findByText("历史消息已经到了。")).toBeInTheDocument();

    await waitFor(() => {
      expect(countFetchCalls(fetchMock, "/api/workbench")).toBe(0);
      expect(getWorkbenchSockets()).toHaveLength(1);
    });

    await userEvent.type(
      screen.getByPlaceholderText(t("conversation.composerPlaceholder")),
      "把 capability gate 接上去"
    );
    await userEvent.click(screen.getByRole("button", { name: t("conversation.sendButton") }));

    await waitFor(() => {
      expect(screen.getAllByText("把 capability gate 接上去").length).toBeGreaterThan(0);
    });
  });

  it("Claude Code 处于 inferred running 时，聊天页仍显示停止按钮", async () => {
    hydrateAuth();

    const runningClaudeSession = {
      ...createSessionSummary({
        sessionId: "session-claude-running",
        title: "Claude 推断运行中",
        provider: "claude-code"
      }),
      runningState: "running" as const,
      activitySource: "inferred" as const,
      activityState: "running" as const
    };

    installFetchMock({
      workbenchSnapshot: createWorkbenchSnapshot([
        {
          workspace: createWorkspace(),
          sessions: [runningClaudeSession]
        }
      ]),
      sessions: {
        "session-claude-running": {
          detail: runningClaudeSession,
          capabilities: createCapabilities({ provider: "claude-code" }),
          history: createHistoryPage([])
        }
      }
    });

    renderConversationRoute("session-claude-running");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("conversation.capabilityInterrupt") })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: t("conversation.queueGuidanceButton") })
    ).not.toBeInTheDocument();
  });

  it("Codex 运行中输入新草稿时，聊天页主按钮默认显示加入队列", async () => {
    hydrateAuth();

    const runningCodexSession = {
      ...createSessionSummary({
        sessionId: "session-codex-running",
        title: "Codex 运行中",
        provider: "codex"
      }),
      runningState: "running" as const,
      activitySource: "inferred" as const,
      activityState: "running" as const
    };

    installFetchMock({
      workbenchSnapshot: createWorkbenchSnapshot([
        {
          workspace: createWorkspace(),
          sessions: [runningCodexSession]
        }
      ]),
      sessions: {
        "session-codex-running": {
          detail: runningCodexSession,
          capabilities: createCapabilities({ provider: "codex" }),
          runtime: {
            ...createSessionRuntime(runningCodexSession),
            provider: "codex",
            canInterrupt: true,
            inRunInputMode: "streaming_guidance",
            hasActiveRun: true
          },
          history: createHistoryPage([])
        }
      }
    });

    renderConversationRoute("session-codex-running");

    const input = await screen.findByPlaceholderText(t("conversation.composerPlaceholder"));
    await userEvent.type(input, "这条先入队，等我手动点击引导");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("conversation.queueGuidanceButton") })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: t("conversation.sendGuidanceButton") })
    ).not.toBeInTheDocument();
  });

  it("Claude Code 运行中但不可中断时，聊天页显示运行中按钮而不是空闲发送按钮", async () => {
    hydrateAuth();

    const runningClaudeSession = {
      ...createSessionSummary({
        sessionId: "session-claude-busy",
        title: "Claude 忙碌中",
        provider: "claude-code"
      }),
      runningState: "running" as const,
      activitySource: "inferred" as const,
      activityState: "running" as const
    };

    installFetchMock({
      workbenchSnapshot: createWorkbenchSnapshot([
        {
          workspace: createWorkspace(),
          sessions: [runningClaudeSession]
        }
      ]),
      sessions: {
        "session-claude-busy": {
          detail: runningClaudeSession,
          capabilities: createCapabilities({
            provider: "claude-code",
            supportsInterrupt: false
          }),
          runtime: {
            ...createSessionRuntime(runningClaudeSession),
            provider: "claude-code",
            canInterrupt: false,
            inRunInputMode: "streaming_guidance"
          },
          history: createHistoryPage([])
        }
      }
    });

    renderConversationRoute("session-claude-busy");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("conversation.runtimeRunning") })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: t("conversation.sendButton") })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("conversation.queueGuidanceButton") })
    ).not.toBeInTheDocument();
  });

  it("OpenCode 超时类 runtime error 会延迟 15 秒再提示", async () => {
    hydrateAuth();

    const opencodeSession = createSessionSummary({
      sessionId: "session-opencode-timeout",
      title: "OpenCode 超时测试",
      provider: "opencode"
    });

    installFetchMock({
      workbenchSnapshot: createWorkbenchSnapshot([
        {
          workspace: createWorkspace(),
          sessions: [opencodeSession]
        }
      ]),
      sessions: {
        "session-opencode-timeout": {
          detail: opencodeSession,
          capabilities: createCapabilities({ provider: "opencode" }),
          history: createHistoryPage([])
        }
      }
    });

    renderConversationRoute("session-opencode-timeout");

    await waitFor(() => {
      expect(getSessionSockets()).toHaveLength(1);
    });

    vi.useFakeTimers();

    await act(async () => {
      getSessionSockets()[0]?.dispatchMessage({
        type: "session.runtime_error",
        sessionId: "session-opencode-timeout",
        error_code: "OPENCODE_REQUEST_TIMEOUT",
        detail: "SERVER_TIMEOUT",
        timestamp: "2026-03-27T10:00:00.000Z"
      });
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(14_000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("SERVER_TIMEOUT");
  });

  it("当前应用发起 Claude 新一轮运行后，会立刻切成可中断按钮", async () => {
    hydrateAuth();

    const claudeSession = {
      ...createSessionSummary({
        sessionId: "session-claude-send",
        title: "Claude 继续会话",
        provider: "claude-code"
      }),
      providerSessionId: "claude-session-1",
      rawStoreRef: "claude://session-1"
    };

    installFetchMock({
      workbenchSnapshot: createWorkbenchSnapshot([
        {
          workspace: createWorkspace(),
          sessions: [claudeSession]
        }
      ]),
      sessions: {
        "session-claude-send": {
          detail: claudeSession,
          capabilities: createCapabilities({
            provider: "claude-code",
            supportsInterrupt: false
          }),
          history: createHistoryPage([])
        }
      },
      extraHandler: (url, init) => {
        if (url.endsWith("/api/sessions/session-claude-send/messages/live") && init?.method === "POST") {
          return createJsonResponse(
            {
              sessionId: "session-claude-send",
              acceptedAt: "2026-03-26T13:48:00.000Z",
              clientRequestId: "client-claude-live-1",
              provider: "claude-code",
              providerSessionId: "claude-session-1",
              message: createHistoryMessage({
                messageId: "claude-live-user-1",
                role: "user",
                content: "列出目录下最近修改的20个文件",
                sequence: 2,
                timestamp: "2026-03-26T13:48:00.000Z"
              })
            },
            201
          );
        }

        return null;
      }
    });

    renderConversationRoute("session-claude-send");

    await userEvent.type(
      await screen.findByPlaceholderText(t("conversation.composerPlaceholder")),
      "列出目录下最近修改的20个文件"
    );
    await userEvent.click(screen.getByRole("button", { name: t("conversation.sendButton") }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: t("conversation.capabilityInterrupt") })
      ).toBeInTheDocument();
    });
  });

  it("会话 socket 断线后会按游标补齐缺失消息，工作台 socket 不会干扰重连", async () => {
    hydrateAuth();

    const workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace(),
        sessions: [createSessionSummary({ sessionId: "session-1", title: "Spec003 主链路" })]
      }
    ]);

    installFetchMock({
      workbenchSnapshot,
      sessions: {
        "session-1": {
          detail: createSessionSummary({ sessionId: "session-1", title: "Spec003 主链路" }),
          capabilities: createCapabilities(),
          history: createHistoryPage([
            createHistoryMessage({
              messageId: "history-1",
              role: "assistant",
              content: "历史消息已经到了。",
              sequence: 1
            })
          ])
        }
      }
    });

    const bootstrapHistoryMessage = createHistoryMessage({
      messageId: "history-bootstrap-1",
      role: "assistant",
      content: "历史消息已经到了。",
      sequence: 1
    });

    const view = renderConversationRoute("session-1", {
      state: {
        bootstrap: {
          sessionId: "session-1",
          messages: [bootstrapHistoryMessage]
        }
      }
    });

    expect((await screen.findAllByRole("heading", { name: "Spec003 主链路" })).length).toBeGreaterThan(0);
    expect(await screen.findByText("历史消息已经到了。")).toBeInTheDocument();

    await waitFor(() => {
      expect(getSessionSockets()).toHaveLength(1);
      expect(getWorkbenchSockets()).toHaveLength(1);
    });

    const firstSessionSocket = getSessionSockets()[0]!;
    firstSessionSocket.dispatchMessage({
      type: "session.delta",
      sessionId: "session-1",
      cursor: "cursor-2",
      messages: [
        createHistoryMessage({
          messageId: "live-2",
          role: "assistant",
          content: "第二条实时消息",
          sequence: 2,
          timestamp: "2026-03-23T10:00:02.000Z"
        })
      ]
    });

    expect(await screen.findByText("第二条实时消息")).toBeInTheDocument();

    firstSessionSocket.close();

    await waitFor(() => {
      expect(getSessionSockets()).toHaveLength(2);
      expect(getWorkbenchSockets()).toHaveLength(1);
    }, { timeout: 1500 });

    const secondSessionSocket = getSessionSockets()[1]!;

    await waitFor(() => {
      const subscribePayload = secondSessionSocket.sentPayloads
        .map((payload) => JSON.parse(payload) as { type: string; cursor?: string | null })
        .find((payload) => payload.type === "session.subscribe");

      expect(subscribePayload?.cursor).toBe("cursor-2");
    });

    secondSessionSocket.dispatchMessage({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-3",
      messages: [
        createHistoryMessage({
          messageId: "live-2",
          role: "assistant",
          content: "第二条实时消息",
          sequence: 2,
          timestamp: "2026-03-23T10:00:02.000Z"
        }),
        createHistoryMessage({
          messageId: "backfill-3",
          role: "assistant",
          content: "第三条缺口补偿消息",
          sequence: 3,
          timestamp: "2026-03-23T10:00:03.000Z"
        })
      ]
    });
    secondSessionSocket.dispatchMessage({
      type: "session.delta",
      sessionId: "session-1",
      cursor: "cursor-4",
      messages: [
        createHistoryMessage({
          messageId: "live-4",
          role: "assistant",
          content: "第四条恢复后消息",
          sequence: 4,
          timestamp: "2026-03-23T10:00:04.000Z"
        })
      ]
    });

    expect(await screen.findByText("第三条缺口补偿消息")).toBeInTheDocument();
    expect(await screen.findByText("第四条恢复后消息")).toBeInTheDocument();

    await waitFor(() => {
      const contents = Array.from(view.container.querySelectorAll(".message-content")).map((node) =>
        node.textContent?.trim()
      );

      expect(contents).toEqual([
        "历史消息已经到了。",
        "第二条实时消息",
        "第三条缺口补偿消息",
        "第四条恢复后消息"
      ]);
    });

    expect(screen.getAllByText("第二条实时消息")).toHaveLength(1);
    expect(screen.queryByText(t("conversation.connectionReconnectFailed"))).not.toBeInTheDocument();
  });

  it("右侧文件面板延后挂载后仍然可以展开目录、搜索并选中文件", async () => {
    hydrateAuth();

    const workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace(),
        sessions: [createSessionSummary({ sessionId: "session-1", title: "Spec004 文件管理" })]
      }
    ]);

    installFetchMock({
      workbenchSnapshot,
      sessions: {
        "session-1": {
          detail: createSessionSummary({ sessionId: "session-1", title: "Spec004 文件管理" }),
          capabilities: createCapabilities(),
          history: createHistoryPage([
            createHistoryMessage({
              messageId: "history-1",
              role: "assistant",
              content: "文件面板已经接进来了。",
              sequence: 1
            })
          ])
        }
      },
      extraHandler: (url, init) => {
        if (url.includes("/api/files/tree?")) {
          const requestUrl = new URL(url, "http://localhost");
          const filePath = requestUrl.searchParams.get("path");

          if (filePath === "src") {
            return createJsonResponse({
              items: [
                {
                  path: "src/app.ts",
                  name: "app.ts",
                  kind: "file",
                  size: 42,
                  updatedAt: "2026-03-23T10:00:00.000Z"
                }
              ]
            });
          }

          return createJsonResponse({
            items: [
              {
                path: "src",
                name: "src",
                kind: "directory",
                size: null,
                updatedAt: "2026-03-23T10:00:00.000Z"
              },
              {
                path: "README.md",
                name: "README.md",
                kind: "file",
                size: 24,
                updatedAt: "2026-03-23T10:00:00.000Z"
              }
            ]
          });
        }

        if (url.includes("/api/files/search?")) {
          return createJsonResponse({
            items: [
              {
                path: "src/app.ts",
                name: "app.ts",
                kind: "file",
                size: 42,
                updatedAt: "2026-03-23T10:00:00.000Z"
              }
            ],
            total: 1,
            page: 1,
            pageSize: 20
          });
        }

        if (url.includes("/api/git/status?")) {
          return createJsonResponse({
            snapshot: {
              workspaceId: "workspace-1",
              repoRoot: "C:/repo",
              branch: "main",
              ahead: 0,
              behind: 0,
              hasRemote: false,
              isDirty: false,
              lastFetchedAt: null
            },
            changes: []
          });
        }

        if (url.includes("/api/git/rules?")) {
          return createJsonResponse({
            id: "rule-1",
            workspaceId: "workspace-1",
            name: "默认提交规则",
            subjectPattern: ".*",
            maxSubjectLength: 72,
            language: "zh",
            requireBody: false,
            requireIssue: false,
            issuePattern: null,
            updatedAt: "2026-03-23T10:00:00.000Z"
          });
        }

        if (url.includes("/api/git/history?")) {
          return createJsonResponse({
            items: [],
            cursor: null,
            nextCursor: null
          });
        }

        if (url.includes("/api/git/branches?")) {
          return createJsonResponse({
            currentBranch: "main",
            local: [],
            remote: []
          });
        }

        return null;
      }
    });

    renderConversationRoute("session-1");

    const filePanel = await screen.findByTestId("file-context-panel");
    const workbenchSocket = getWorkbenchSockets()[0] ?? MockWebSocket.instances[0];

    workbenchSocket?.dispatchMessage({
      type: "fileTree.snapshot",
      snapshot: {
        workspaceId: "workspace-1",
        path: "",
        items: [
          {
            path: "src",
            name: "src",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-23T10:00:00.000Z"
          },
          {
            path: "README.md",
            name: "README.md",
            kind: "file",
            size: 64,
            updatedAt: "2026-03-23T10:00:00.000Z"
          }
        ]
      }
    });

    await userEvent.click(await within(filePanel).findByText("src"));
    workbenchSocket?.dispatchMessage({
      type: "fileTree.snapshot",
      snapshot: {
        workspaceId: "workspace-1",
        path: "src",
        items: [
          {
            path: "src/app.ts",
            name: "app.ts",
            kind: "file",
            size: 128,
            updatedAt: "2026-03-23T10:00:00.000Z"
          }
        ]
      }
    });
    expect(await within(filePanel).findByText("app.ts")).toBeInTheDocument();

    await userEvent.click(await within(filePanel).findByText("README.md"));
    expect(screen.queryByTestId("file-editor-textarea")).not.toBeInTheDocument();
    expect(within(filePanel).getByRole("button", { name: t("conversation.filePanelCollapseCurrent") })).toBeInTheDocument();
    expect(within(filePanel).getByRole("button", { name: t("conversation.filePanelRefresh") })).toBeInTheDocument();
    expect(within(filePanel).getByRole("button", { name: t("conversation.filePanelSearchButton") })).toBeInTheDocument();

    await userEvent.click(within(filePanel).getByRole("button", { name: t("conversation.filePanelSearchButton") }));
    await userEvent.type(
      within(filePanel).getByPlaceholderText(t("conversation.filePanelSearchPlaceholder")),
      "app"
    );
    await userEvent.click(within(filePanel).getAllByRole("button", { name: t("conversation.filePanelSearchButton") })[1]);

    expect(await within(filePanel).findByText("src/app.ts")).toBeInTheDocument();
  });
});

it("统一消息抽象会渲染 codex 工具调用", async () => {
  hydrateAuth();

  const workbenchSnapshot = createWorkbenchSnapshot([
    {
      workspace: createWorkspace(),
      sessions: [createSessionSummary({ sessionId: "session-tools", title: "工具链路" })]
    }
  ]);

  installFetchMock({
    workbenchSnapshot,
    sessions: {
      "session-tools": {
        detail: createSessionSummary({ sessionId: "session-tools", title: "工具链路" }),
        capabilities: createCapabilities(),
        history: createHistoryPage([
          createHistoryMessage({
            messageId: "tool-call-1",
            role: "tool",
            kind: "tool_call",
            content: "{\n  \"command\": \"git status --short\"\n}",
            sequence: 1,
            toolCall: {
              callId: "call-shell-1",
              name: "shell_command",
              input: "{\n  \"command\": \"git status --short\"\n}",
              output: null,
              error: null,
              status: "running"
            }
          }),
          createHistoryMessage({
            messageId: "tool-result-1",
            role: "tool",
            kind: "tool_result",
            content: "Exit code: 0\nOutput:\nerror_code: 0\n M src/main.ts",
            sequence: 2,
            timestamp: "2026-03-23T10:00:01.000Z",
            toolCall: {
              callId: "call-shell-1",
              name: "shell_command",
              input: "",
              output: "Exit code: 0\nOutput:\nerror_code: 0\n M src/main.ts",
              error: null,
              status: "completed"
            }
          })
        ])
      }
    }
  });

  renderConversationRoute("session-tools", {
    state: {
      bootstrap: {
        sessionId: "session-tools",
        messages: [
          createHistoryMessage({
            messageId: "tool-call-boot-1",
            role: "tool",
            kind: "tool_call",
            content: "{\n  \"command\": \"git status --short\"\n}",
            sequence: 1,
            toolCall: {
              callId: "call-shell-1",
              name: "shell_command",
              input: "{\n  \"command\": \"git status --short\"\n}",
              output: null,
              error: null,
              status: "running"
            }
          }),
          createHistoryMessage({
            messageId: "tool-result-boot-1",
            role: "tool",
            kind: "tool_result",
            content: "Exit code: 0\nOutput:\nerror_code: 0\n M src/main.ts",
            sequence: 2,
            timestamp: "2026-03-23T10:00:01.000Z",
            toolCall: {
              callId: "call-shell-1",
              name: "shell_command",
              input: "",
              output: "Exit code: 0\nOutput:\nerror_code: 0\n M src/main.ts",
              error: null,
              status: "completed"
            }
          })
        ]
      }
    }
  });

  expect(await screen.findByRole("button", { name: new RegExp(`^${t("conversation.roleTool")}`) })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${t("conversation.roleTool")}`) }));

  expect(
    (await screen.findAllByText((content) => content.includes("error_code: 0"))).length
  ).toBeGreaterThan(0);
});

function hydrateAuth() {
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
}

function createPreferenceState(overrides?: Partial<ReturnType<typeof userPreferenceStore.getState>["profile"]>) {
  return {
    initialized: true,
    profile: {
      language: overrides?.language ?? "zh-CN",
      theme: overrides?.theme ?? "light",
      autoTheme: overrides?.autoTheme ?? false,
      defaultPermissionMode: overrides?.defaultPermissionMode ?? "default"
    },
    providers: {
      "claude-code": {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      codex: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      opencode: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      gemini: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      kimi: {
        defaultModel: null,
        defaultReasoningLevel: null
      }
    },
    updatedAt: null,
    source: "default" as const
  };
}

function createWorkspace() {
  return {
    id: "workspace-1",
    name: "Workspace One",
    path: "C:/repo",
    repoRoot: "C:/repo"
  };
}

function createSessionSummary(input: {
  sessionId: string;
  title: string;
  workspaceId?: string;
  provider?: "codex" | "claude-code" | "opencode";
}) {
  return {
    sessionId: input.sessionId,
    workspaceId: input.workspaceId ?? "workspace-1",
    provider: input.provider ?? "codex",
    providerSessionId: `raw-${input.sessionId}`,
    rawStoreRef: `codex://${input.sessionId}`,
    title: input.title,
    messageCount: 1,
    lastMessageAt: "2026-03-23T10:00:00.000Z",
    createdAt: "2026-03-23T09:00:00.000Z",
    updatedAt: "2026-03-23T10:00:00.000Z",
    syncStatus: "idle",
    syncCursor: "cursor-1",
    lastSyncAt: "2026-03-23T10:00:00.000Z",
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "idle",
    activitySource: "none",
    lastEventAt: "2026-03-23T10:00:00.000Z",
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle"
  };
}

function createCapabilities(options?: {
  provider?: "codex" | "claude-code" | "opencode";
  inRunInputMode?: "none" | "streaming_guidance" | "queued_guidance";
  supportsInterrupt?: boolean;
}) {
  const provider = options?.provider ?? "codex";

  return {
    provider,
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    inRunInputMode:
      options?.inRunInputMode ?? (provider === "opencode" ? "none" : "streaming_guidance"),
    supportsSubagents: false,
    supportsInterrupt: options?.supportsInterrupt ?? true,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: false,
    supportsAttachments: false,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    supportsRunSteering: provider !== "opencode",
    supportsQueueWhileRunning: provider === "codex" ? true : undefined,
    limitations: []
  };
}

function createSessionRuntime(detail: Record<string, unknown>) {
  return {
    sessionId: detail.sessionId,
    runningState: detail.runningState ?? "idle",
    hasActiveRun: false,
    canAttach: true,
    canInterrupt: true,
    inRunInputMode: (detail.inRunInputMode as string | undefined) ?? "none",
    provider: detail.provider ?? "codex",
    providerSessionId: detail.providerSessionId ?? "raw-1",
    detail: null,
    updatedAt: detail.updatedAt ?? "2026-03-23T10:00:00.000Z",
    contextUsage: detail.contextUsage ?? null
  };
}

function createHistoryMessage(input: {
  messageId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  sequence: number;
  kind?: "text" | "thinking" | "tool_call" | "tool_result";
  timestamp?: string;
  toolCall?: Record<string, unknown> | null;
}) {
  return {
    messageId: input.messageId,
    provider: "codex",
    providerSessionId: "raw-1",
    role: input.role,
    kind: input.kind,
    content: input.content,
    toolCall: input.toolCall ?? null,
    timestamp: input.timestamp ?? "2026-03-23T10:00:00.000Z",
    sequence: input.sequence,
    rawRef: `codex://raw#line=${input.sequence}`
  };
}

function createHistoryPage(messages: Array<Record<string, unknown>>) {
  return {
    messages,
    cursor: "cursor-1",
    nextCursor: null,
    total: messages.length
  };
}

function createWorkbenchSnapshot(items: Array<Record<string, unknown>>) {
  return { items };
}

function installFetchMock(input: {
  workbenchSnapshot: Record<string, unknown>;
  sessions: Record<string, MockSessionRecord>;
  extraHandler?: (url: string, init?: RequestInit) => Response | null;
}) {
  MockWebSocket.workbenchSnapshot = input.workbenchSnapshot;

  const fetchMock = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

    if (url.endsWith("/api/workbench")) {
      return createJsonResponse(input.workbenchSnapshot);
    }

    const detailMatch = url.match(/\/api\/sessions\/([^/]+)$/);

    if (detailMatch && !url.endsWith("/capabilities")) {
      const sessionId = decodeURIComponent(detailMatch[1]!);
      const record = input.sessions[sessionId];

      if (record) {
        return createJsonResponse(record.detail);
      }
    }

    const capabilityMatch = url.match(/\/api\/sessions\/([^/]+)\/capabilities$/);

    if (capabilityMatch) {
      const sessionId = decodeURIComponent(capabilityMatch[1]!);
      const record = input.sessions[sessionId];

      if (record) {
        return createJsonResponse(record.capabilities);
      }
    }

    const runtimeMatch = url.match(/\/api\/sessions\/([^/]+)\/runtime$/);

    if (runtimeMatch) {
      const sessionId = decodeURIComponent(runtimeMatch[1]!);
      const record = input.sessions[sessionId];

      if (record) {
        return createJsonResponse(record.runtime ?? createSessionRuntime(record.detail));
      }
    }

    const historyMatch = url.match(/\/api\/sessions\/([^/]+)\/messages\?/);

    if (historyMatch && (!init?.method || init.method === "GET")) {
      const sessionId = decodeURIComponent(historyMatch[1]!);
      const record = input.sessions[sessionId];

      if (record) {
        return createJsonResponse(record.history);
      }
    }

    if (url.endsWith("/api/public/bootstrap-status")) {
      return createJsonResponse({ initialized: true });
    }

    const extraResponse = input.extraHandler?.(url, init);

    if (extraResponse) {
      return extraResponse;
    }

    throw new Error(`未处理的请求: ${url}`);
  });

  global.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

function renderConversationRoute(
  sessionId: string,
  options?: {
    state?: unknown;
  }
) {
  return render(
    <PlatformProvider>
      <AppVersionProvider>
        <I18nProvider language={userPreferenceStore.getState().profile.language}>
          <ThemeProvider>
            <ToastProvider>
              <MemoryRouter
                initialEntries={[
                  {
                    pathname: `/workspaces/workspace-1/sessions/${sessionId}`,
                    state: options?.state ?? null
                  }
                ]}
              >
                <Routes>
                  <Route element={<WorkbenchShellRoute />}>
                    <Route
                      path="/workspaces/:workspaceId/sessions/:sessionId"
                      element={<ConversationPage />}
                    />
                  </Route>
                </Routes>
              </MemoryRouter>
            </ToastProvider>
          </ThemeProvider>
        </I18nProvider>
      </AppVersionProvider>
    </PlatformProvider>
  );
}

function renderSettingsPage() {
  return render(
    <PlatformProvider>
      <I18nProvider language={clientConfigStore.getState().language}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/settings"]}>
            <Routes>
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </I18nProvider>
    </PlatformProvider>
  );
}

function getSessionSockets() {
  return MockWebSocket.instances.filter((socket) =>
    socket.sentPayloads.some((payload) => JSON.parse(payload).type === "session.subscribe")
  );
}

function getWorkbenchSockets() {
  return MockWebSocket.instances.filter((socket) =>
    socket.sentPayloads.some((payload) => JSON.parse(payload).type === "workbench.subscribe")
  );
}

function countFetchCalls(fetchMock: ReturnType<typeof vi.fn>, path: string) {
  return fetchMock.mock.calls.filter(([input]) => {
    const url = typeof input === "string" ? input : input.toString();
    return url.includes(path);
  }).length;
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
