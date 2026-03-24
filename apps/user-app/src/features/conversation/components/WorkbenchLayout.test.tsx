import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../auth/store/auth-store";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import { WorkbenchLayout } from "./WorkbenchLayout";

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
      this.dispatchMessage({ type: "system.connected" });
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

  dispatchMessage(payload: Record<string, unknown>) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify(payload)
      })
    );
  }
}

const originalFetch = global.fetch;
const originalWebSocket = global.WebSocket;

describe("WorkbenchLayout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    authStore.clear();
    MockWebSocket.reset();
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket;
  });

  it("支持收藏、归档恢复和按类型新建会话", async () => {
    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({ sessionId: "session-1", title: "会话 Alpha", workspaceId: "workspace-1" }),
          createSessionSummary({ sessionId: "session-2", title: "会话 Beta", workspaceId: "workspace-1" })
        ]
      },
      {
        workspace: createWorkspace("workspace-2", "项目二"),
        sessions: [createSessionSummary({ sessionId: "session-3", title: "会话 Gamma", workspaceId: "workspace-2" })]
      }
    ]);
    const startSessionPayloads: Array<{ workspaceId: string; provider: string }> = [];

    MockWebSocket.workbenchSnapshot = currentSnapshot;

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/sessions/start") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body)) as { workspaceId: string; provider: "codex" | "claude-code" };
        startSessionPayloads.push(payload);

        const newSession = createSessionSummary({
          sessionId: "session-new",
          title: payload.provider === "codex" ? "新 Codex 会话" : "新 Claude 会话",
          workspaceId: payload.workspaceId,
          provider: payload.provider
        });

        currentSnapshot = createWorkbenchSnapshot([
          {
            workspace: createWorkspace("workspace-1", "项目一"),
            sessions: [
              createSessionSummary({ sessionId: "session-1", title: "会话 Alpha", workspaceId: "workspace-1" }),
              createSessionSummary({ sessionId: "session-2", title: "会话 Beta", workspaceId: "workspace-1" }),
              newSession
            ]
          },
          {
            workspace: createWorkspace("workspace-2", "项目二"),
            sessions: [createSessionSummary({ sessionId: "session-3", title: "会话 Gamma", workspaceId: "workspace-2" })]
          }
        ]);
        MockWebSocket.workbenchSnapshot = currentSnapshot;

        return createJsonResponse(newSession, 201);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    const firstView = renderWorkbenchRoute();

    expect(await screen.findByText("会话 Alpha")).toBeInTheDocument();
    expect(screen.getByText(t("shell.favoriteSectionTitle"))).toBeInTheDocument();

    const betaCard = screen
      .getAllByText("会话 Beta")[0]
      ?.closest(".workbench-session-card") as HTMLElement | null;
    expect(betaCard).not.toBeNull();

    await userEvent.click(within(betaCard!).getByRole("button", { name: t("shell.sessionMoreAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.favoriteAction") }));

    const favoriteSection = screen
      .getByText(t("shell.favoriteSectionTitle"))
      .closest(".workbench-section-block") as HTMLElement | null;
    expect(favoriteSection).not.toBeNull();
    expect(within(favoriteSection!).getByText("会话 Beta")).toBeInTheDocument();
    await waitFor(() => {
      expect(window.localStorage.getItem("workbench.session.favorite.ids")).toContain("session-2");
    });

    firstView.unmount();

    renderWorkbenchRoute();

    const favoriteSectionAfterReload = screen
      .getByText(t("shell.favoriteSectionTitle"))
      .closest(".workbench-section-block") as HTMLElement | null;
    expect(favoriteSectionAfterReload).not.toBeNull();
    await waitFor(() => {
      expect(within(favoriteSectionAfterReload!).getByText("会话 Beta")).toBeInTheDocument();
    });

    const betaCardAfterReload = screen
      .getAllByText("会话 Beta")[0]
      ?.closest(".workbench-session-card") as HTMLElement | null;
    expect(betaCardAfterReload).not.toBeNull();

    await userEvent.click(within(betaCardAfterReload!).getByRole("button", { name: t("shell.sessionMoreAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.archiveAction") }));

    await waitFor(() => {
      expect(screen.queryAllByText("会话 Beta")).toHaveLength(0);
    });

    const archiveFolders = screen.getAllByRole("button", { name: /归档文件夹/ });
    await userEvent.click(archiveFolders[0]!);

    expect(await screen.findByRole("dialog", { name: t("shell.archiveModalTitle") })).toBeInTheDocument();
    expect(screen.getByText("会话 Beta")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("shell.unarchiveAction") }));

    await waitFor(() => {
      expect(screen.queryAllByText("会话 Beta").length).toBeGreaterThan(0);
    });

    const createButtons = screen.getAllByRole("button", { name: t("shell.createSession") });
    await userEvent.click(createButtons[0]!);

    expect(await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") })).toBeInTheDocument();
    const providerButton = screen
      .getAllByText(t("shell.providerClaudeCode"))[0]
      ?.closest("button");
    expect(providerButton).not.toBeNull();
    await userEvent.click(providerButton as HTMLElement);

    await waitFor(() => {
      expect(startSessionPayloads).toEqual([{ workspaceId: "workspace-1", provider: "claude-code" }]);
    });

    expect(await screen.findByText("新 Claude 会话")).toBeInTheDocument();
  });
});

function renderWorkbenchRoute() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/sessions/session-1"]}>
        <Routes>
          <Route element={<WorkbenchLayout />}>
            <Route path="/sessions/:sessionId" element={<div>会话页面</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

function createWorkspace(id: string, name: string) {
  return {
    id,
    name,
    path: `C:/repo/${id}`,
    repoRoot: `C:/repo/${id}`
  };
}

function createSessionSummary(input: {
  sessionId: string;
  title: string;
  workspaceId: string;
  provider?: "codex" | "claude-code";
}) {
  return {
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    provider: input.provider ?? "codex",
    providerSessionId: `raw-${input.sessionId}`,
    rawStoreRef: `codex://${input.sessionId}`,
    title: input.title,
    messageCount: 1,
    lastMessageAt: "2026-03-24T10:00:00.000Z",
    createdAt: "2026-03-24T09:00:00.000Z",
    updatedAt: "2026-03-24T10:00:00.000Z",
    syncStatus: "idle",
    syncCursor: "cursor-1",
    lastSyncAt: "2026-03-24T10:00:00.000Z",
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "idle",
    lastEventAt: "2026-03-24T10:00:00.000Z",
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle"
  };
}

function createWorkbenchSnapshot(items: Array<Record<string, unknown>>) {
  return { items };
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
