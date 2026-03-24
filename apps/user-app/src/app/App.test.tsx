import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { serverConfigStore } from "../config/server-config";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { authStore } from "../features/auth/store/auth-store";
import { WorkbenchLayout } from "../features/conversation/components/WorkbenchLayout";
import { ConversationPage } from "../features/conversation/pages/ConversationPage";
import { t } from "../shared/i18n";
import { ToastProvider } from "../shared/toast";

interface MockSocketMessage {
  type: string;
  [key: string]: unknown;
}

interface MockSessionRecord {
  detail: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  history: Record<string, unknown>;
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

describe("app routes", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
  });

  it("未登录访问受保护页面时会回到登录页", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/api/public/bootstrap-status")) {
        return createJsonResponse({ initialized: true });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    window.history.pushState({}, "", "/sessions/session-1");

    render(<App />);

    expect(await screen.findByText(t("auth.loginTitle"))).toBeInTheDocument();
  });

  it("登录页切换服务器后会把登录请求发到新地址", async () => {
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
    await userEvent.clear(screen.getByLabelText(t("auth.serverAddress")));
    await userEvent.type(screen.getByLabelText(t("auth.serverAddress")), "10.10.1.8:4100");
    await userEvent.tab();
    await userEvent.click(screen.getByRole("button", { name: t("auth.submitLogin") }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://10.10.1.8:4100/api/auth/login",
        expect.objectContaining({
          method: "POST"
        })
      );
    });
  });

  it("实时连接会跟着当前服务器地址切换", async () => {
    serverConfigStore.setBaseUrl("http://10.10.1.8:4100");
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

    renderConversationRoute("session-1");

    await waitFor(() => {
      expect(MockWebSocket.instances.some((socket) => socket.url.startsWith("ws://10.10.1.8:4100/ws?"))).toBe(true);
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

    expect(await screen.findByRole("heading", { name: "Spec003 主链路" })).toBeInTheDocument();
    expect(await screen.findByText("历史消息已经到了。")).toBeInTheDocument();

    await waitFor(() => {
      expect(countFetchCalls(fetchMock, "/api/workbench")).toBe(1);
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

    const view = renderConversationRoute("session-1");

    expect(await screen.findByRole("heading", { name: "Spec003 主链路" })).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "Spec004 文件管理" })).toBeInTheDocument();

    await userEvent.click(await screen.findByText("src"));
    expect(await screen.findByText("app.ts")).toBeInTheDocument();

    await userEvent.click(await screen.findByText("README.md"));
    expect(screen.queryByTestId("file-editor-textarea")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("conversation.filePanelCollapseCurrent") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("conversation.filePanelRefresh") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("conversation.filePanelSearchButton") })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelSearchButton") }));
    await userEvent.type(
      screen.getByPlaceholderText(t("conversation.filePanelSearchPlaceholder")),
      "app"
    );
    await userEvent.click(screen.getAllByRole("button", { name: t("conversation.filePanelSearchButton") })[1]);

    expect(await screen.findByText("src/app.ts")).toBeInTheDocument();
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

  renderConversationRoute("session-tools");

  expect(await screen.findByRole("heading", { name: "工具链路" })).toBeInTheDocument();
  expect(await screen.findByText("shell_command")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /shell_command/ }));

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
  provider?: "codex" | "claude-code";
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

function createCapabilities() {
  return {
    provider: "codex",
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    supportsSubagents: false,
    supportsInterrupt: true,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: false,
    supportsAttachments: false,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    limitations: []
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

function renderConversationRoute(sessionId: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/sessions/${sessionId}`]}>
        <Routes>
          <Route element={<WorkbenchLayout />}>
            <Route path="/sessions/:sessionId" element={<ConversationPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>
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
