import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { authStore } from "../features/auth/store/auth-store";
import { ConversationPage } from "../features/conversation/pages/ConversationPage";
import { t } from "../shared/i18n";

interface MockSocketMessage {
  type: string;
  [key: string]: unknown;
}

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
    const parsed = JSON.parse(payload) as { type: string; sessionId: string };

    if (parsed.type === "session.subscribe") {
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
    authStore.clear();
    MockWebSocket.instances = [];
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket;
  });

  it("未登录访问受保护会话页时会回到登录页", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/api/public/bootstrap-status")) {
        return createJsonResponse({ initialized: true });
      }

      if (url.endsWith("/api/workspaces")) {
        return createJsonResponse({ items: [] });
      }

      if (url.includes("/api/files/tree?")) {
        return createJsonResponse({ items: [] });
      }

      if (url.includes("/api/files/recent?")) {
        return createJsonResponse({ items: [] });
      }

      if (url.endsWith("/api/sessions/session-1/contexts/files")) {
        return createJsonResponse({ items: [] });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    window.history.pushState({}, "", "/sessions/session-1");

    render(<App />);

    expect(await screen.findByText("继续你的编码会话")).toBeInTheDocument();
  });

  it("已登录时可以加载会话、显示历史并完成发送", async () => {
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

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/api/sessions/session-1")) {
        return createJsonResponse({
          sessionId: "session-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "raw-1",
          rawStoreRef: "codex://raw",
          title: "Spec003 主链路",
          messageCount: 1,
          lastMessageAt: "2026-03-23T10:00:00.000Z",
          createdAt: "2026-03-23T09:00:00.000Z",
          updatedAt: "2026-03-23T10:00:00.000Z",
          syncStatus: "idle",
          syncCursor: "cursor-1",
          lastSyncAt: "2026-03-23T10:00:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null
        });
      }

      if (url.endsWith("/api/sessions/session-1/capabilities")) {
        return createJsonResponse({
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
        });
      }

      if (url.includes("/api/sessions/session-1/messages?")) {
        return createJsonResponse({
          messages: [
            {
              messageId: "history-1",
              provider: "codex",
              providerSessionId: "raw-1",
              role: "assistant",
              content: "历史消息已经到了。",
              timestamp: "2026-03-23T10:00:00.000Z",
              sequence: 1,
              rawRef: "codex://raw#line=1"
            }
          ],
          cursor: "cursor-1",
          nextCursor: null,
          total: 1
        });
      }

      if (url.endsWith("/api/sessions/session-1/messages") && init?.method === "POST") {
        return createJsonResponse(
          {
            sessionId: "session-1",
            acceptedAt: "2026-03-23T10:01:00.000Z",
            clientRequestId: "client-send-1",
            message: {
              messageId: "sent-1",
              provider: "codex",
              providerSessionId: "raw-1",
              role: "user",
              content: "把 capability gate 接上去",
              timestamp: "2026-03-23T10:01:00.000Z",
              sequence: 2,
              rawRef: "codex://raw#line=2"
            }
          },
          201
        );
      }

      if (url.endsWith("/api/workspaces")) {
        return createJsonResponse({ items: [] });
      }

      if (url.includes("/api/files/tree?")) {
        return createJsonResponse({ items: [] });
      }

      if (url.includes("/api/files/recent?")) {
        return createJsonResponse({ items: [] });
      }

      if (url.endsWith("/api/sessions/session-1/contexts/files")) {
        return createJsonResponse({ items: [] });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    render(
      <MemoryRouter initialEntries={["/sessions/session-1"]}>
        <Routes>
          <Route path="/sessions/:sessionId" element={<ConversationPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Spec003 主链路")).toBeInTheDocument();
    expect(await screen.findByText("历史消息已经到了。")).toBeInTheDocument();

    await userEvent.type(
      screen.getByPlaceholderText("把下一步交代清楚，剩下的交给这条会话继续跑。"),
      "把 capability gate 接上去"
    );
    await userEvent.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => {
      expect(screen.getByText("把 capability gate 接上去")).toBeInTheDocument();
    });
  });

  it("断线重连后会按游标补齐缺失消息并保持顺序", async () => {
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

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/api/sessions/session-1")) {
        return createJsonResponse({
          sessionId: "session-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "raw-1",
          rawStoreRef: "codex://raw",
          title: "Spec003 主链路",
          messageCount: 1,
          lastMessageAt: "2026-03-23T10:00:00.000Z",
          createdAt: "2026-03-23T09:00:00.000Z",
          updatedAt: "2026-03-23T10:00:00.000Z",
          syncStatus: "idle",
          syncCursor: "cursor-1",
          lastSyncAt: "2026-03-23T10:00:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null
        });
      }

      if (url.endsWith("/api/sessions/session-1/capabilities")) {
        return createJsonResponse({
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
        });
      }

      if (url.includes("/api/sessions/session-1/messages?")) {
        return createJsonResponse({
          messages: [
            {
              messageId: "history-1",
              provider: "codex",
              providerSessionId: "raw-1",
              role: "assistant",
              content: "历史消息已经到了。",
              timestamp: "2026-03-23T10:00:00.000Z",
              sequence: 1,
              rawRef: "codex://raw#line=1"
            }
          ],
          cursor: "cursor-1",
          nextCursor: null,
          total: 1
        });
      }

      if (url.endsWith("/api/workspaces")) {
        return createJsonResponse({ items: [] });
      }

      if (url.includes("/api/files/tree?")) {
        return createJsonResponse({ items: [] });
      }

      if (url.includes("/api/files/recent?")) {
        return createJsonResponse({ items: [] });
      }

      if (url.endsWith("/api/sessions/session-1/contexts/files")) {
        return createJsonResponse({ items: [] });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    const view = render(
      <MemoryRouter initialEntries={["/sessions/session-1"]}>
        <Routes>
          <Route path="/sessions/:sessionId" element={<ConversationPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Spec003 主链路")).toBeInTheDocument();
    expect(await screen.findByText("历史消息已经到了。")).toBeInTheDocument();

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    const firstSocket = MockWebSocket.instances[0]!;
    firstSocket.dispatchMessage({
      type: "session.delta",
      sessionId: "session-1",
      cursor: "cursor-2",
      messages: [
        {
          messageId: "live-2",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "第二条实时消息",
          timestamp: "2026-03-23T10:00:02.000Z",
          sequence: 2,
          rawRef: "codex://raw#line=2"
        }
      ]
    });

    expect(await screen.findByText("第二条实时消息")).toBeInTheDocument();

    firstSocket.close();

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    const secondSocket = MockWebSocket.instances[1]!;

    await waitFor(() => {
      const subscribePayload = secondSocket.sentPayloads
        .map((payload) => JSON.parse(payload) as { type: string; cursor: string | null })
        .find((payload) => payload.type === "session.subscribe");
      expect(subscribePayload?.cursor).toBe("cursor-2");
    });

    secondSocket.dispatchMessage({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-3",
      messages: [
        {
          messageId: "live-2",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "第二条实时消息",
          timestamp: "2026-03-23T10:00:02.000Z",
          sequence: 2,
          rawRef: "codex://raw#line=2"
        },
        {
          messageId: "backfill-3",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "第三条缺口补偿消息",
          timestamp: "2026-03-23T10:00:03.000Z",
          sequence: 3,
          rawRef: "codex://raw#line=3"
        }
      ]
    });

    secondSocket.dispatchMessage({
      type: "session.delta",
      sessionId: "session-1",
      cursor: "cursor-4",
      messages: [
        {
          messageId: "live-4",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "第四条恢复后消息",
          timestamp: "2026-03-23T10:00:04.000Z",
          sequence: 4,
          rawRef: "codex://raw#line=4"
        }
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

  it("会话侧栏可以打开文件、保存文本并挂载到当前会话", async () => {
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

    let currentContent = "初始文件内容";
    let currentVersion = "version-1";
    let bindingItems: Array<{
      id: string;
      sessionId: string;
      workspaceId: string;
      path: string;
      displayName: string;
      selected: boolean;
      pinned: boolean;
      rangeStart: number | null;
      rangeEnd: number | null;
      contentHash: string;
      fileVersion: string;
      attachedBy: string;
      attachedAt: string;
    }> = [];
    let recentItems: Array<{
      id: string;
      workspaceId: string;
      userId: string;
      path: string;
      lastOpenedAt: string;
      pinned: boolean;
    }> = [];

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/api/sessions/session-1")) {
        return createJsonResponse({
          sessionId: "session-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "raw-1",
          rawStoreRef: "codex://raw",
          title: "Spec004 文件上下文",
          messageCount: 1,
          lastMessageAt: "2026-03-23T10:00:00.000Z",
          createdAt: "2026-03-23T09:00:00.000Z",
          updatedAt: "2026-03-23T10:00:00.000Z",
          syncStatus: "idle",
          syncCursor: "cursor-1",
          lastSyncAt: "2026-03-23T10:00:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null
        });
      }

      if (url.endsWith("/api/sessions/session-1/capabilities")) {
        return createJsonResponse({
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
        });
      }

      if (url.includes("/api/sessions/session-1/messages?")) {
        return createJsonResponse({
          messages: [
            {
              messageId: "history-1",
              provider: "codex",
              providerSessionId: "raw-1",
              role: "assistant",
              content: "文件面板已经接进来了。",
              timestamp: "2026-03-23T10:00:00.000Z",
              sequence: 1,
              rawRef: "codex://raw#line=1"
            }
          ],
          cursor: "cursor-1",
          nextCursor: null,
          total: 1
        });
      }

      if (url.includes("/api/files/tree?")) {
        return createJsonResponse({
          items: [
            {
              path: "README.md",
              name: "README.md",
              kind: "file",
              size: currentContent.length,
              updatedAt: "2026-03-23T10:00:00.000Z"
            }
          ]
        });
      }

      if (url.includes("/api/files/recent?")) {
        return createJsonResponse({ items: recentItems });
      }

      if (url.endsWith("/api/sessions/session-1/contexts/files") && !init?.method) {
        return createJsonResponse({ items: bindingItems });
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

      if (url.includes("/api/files/preview?")) {
        recentItems = [
          {
            id: "recent-1",
            workspaceId: "workspace-1",
            userId: "user-1",
            path: "README.md",
            lastOpenedAt: "2026-03-23T10:02:00.000Z",
            pinned: false
          }
        ];

        return createJsonResponse({
          workspaceId: "workspace-1",
          path: "README.md",
          supported: true,
          kind: "text",
          reason: null,
          content: currentContent,
          version: currentVersion,
          size: currentContent.length,
          updatedAt: "2026-03-23T10:02:00.000Z"
        });
      }

      if (url.endsWith("/api/files/content") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as {
          content: string;
          expectedVersion: string;
        };

        expect(body.expectedVersion).toBe(currentVersion);
        currentContent = body.content;
        currentVersion = "version-2";

        return createJsonResponse({
          version: currentVersion,
          updatedAt: "2026-03-23T10:03:00.000Z"
        });
      }

      if (url.endsWith("/api/sessions/session-1/contexts/files") && init?.method === "POST") {
        bindingItems = [
          {
            id: "binding-1",
            sessionId: "session-1",
            workspaceId: "workspace-1",
            path: "README.md",
            displayName: "README.md",
            selected: true,
            pinned: false,
            rangeStart: null,
            rangeEnd: null,
            contentHash: "hash-1",
            fileVersion: currentVersion,
            attachedBy: "user-1",
            attachedAt: "2026-03-23T10:04:00.000Z"
          }
        ];

        return createJsonResponse(bindingItems[0], 201);
      }

      if (url.endsWith("/api/sessions/session-1/contexts/files/binding-1") && init?.method === "DELETE") {
        bindingItems = [];
        return createJsonResponse({ success: true });
      }

      if (url.endsWith("/api/workspaces")) {
        return createJsonResponse({ items: [] });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    render(
      <MemoryRouter initialEntries={["/sessions/session-1"]}>
        <Routes>
          <Route path="/sessions/:sessionId" element={<ConversationPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("文件上下文")).toBeInTheDocument();

    await userEvent.click(await screen.findByText("README.md"));

    await waitFor(() => {
      expect(screen.getByTestId("file-editor-textarea")).toHaveValue("初始文件内容");
    });

    await userEvent.clear(screen.getByTestId("file-editor-textarea"));
    await userEvent.type(screen.getByTestId("file-editor-textarea"), "更新后的文件内容");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("文件已经保存。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "挂到会话" }));

    expect(await screen.findByText("文件已经挂到当前会话。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已挂载" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "解绑" }));

    expect(await screen.findByText("文件已经从当前会话解绑。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "挂到会话" })).toBeInTheDocument();
  });
});

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
