import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

  it("支持收藏、归档恢复，并在新建时进入 draft 会话路由", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
          }),
          createSessionSummary({
            sessionId: "session-1-sub",
            title: "子代理探索",
            workspaceId: "workspace-1",
            parentSessionId: "session-1",
            isSubagent: true,
            subagentLabel: "worker · Banach"
          }),
          createSessionSummary({
            sessionId: "session-1-sub-nested",
            title: "子代理深挖",
            workspaceId: "workspace-1",
            parentSessionId: "session-1-sub",
            isSubagent: true,
            subagentLabel: "explorer · Turing"
          }),
          createSessionSummary({
            sessionId: "session-2",
            title: "会话 Beta",
            workspaceId: "workspace-1"
          })
        ]
      },
      {
        workspace: createWorkspace("workspace-2", "项目二"),
        sessions: [
          createSessionSummary({
            sessionId: "session-3",
            title: "会话 Gamma",
            workspaceId: "workspace-2"
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    const firstView = renderWorkbenchRoute();

    expect(await screen.findByText("会话 Alpha")).toBeInTheDocument();
    const subagentTitle = screen.getByText("子代理探索");
    expect(subagentTitle).toBeInTheDocument();
    expect(subagentTitle.closest(".workbench-subsession-list")).not.toBeNull();
    expect(screen.getByText("worker · Banach")).toBeInTheDocument();
    const nestedSubagentTitle = screen.getByText("子代理深挖");
    expect(nestedSubagentTitle).toBeInTheDocument();
    expect(nestedSubagentTitle.closest(".workbench-subsession-list")).not.toBeNull();
    expect(screen.getByText("explorer · Turing")).toBeInTheDocument();
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

    await userEvent.click(
      within(betaCardAfterReload!).getByRole("button", { name: t("shell.sessionMoreAction") })
    );
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
    const providerButton = screen.getAllByText(t("shell.providerClaudeCode"))[0]?.closest("button");
    expect(providerButton).not.toBeNull();
    await userEvent.click(providerButton as HTMLElement);

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toMatch(/^\/sessions\/draft-/);
      expect(screen.getByTestId("current-search").textContent).toBe(
        "?workspaceId=workspace-1&provider=claude-code"
      );
    });
  });

  it("主会话默认只显示最近 5 个子代理，并支持按批展开", async () => {
    const subagentSessions = [
      {
        ...createSessionSummary({
          sessionId: "root-subagent-1",
          title: "Subagent 1",
          workspaceId: "workspace-1",
          parentSessionId: "root-session",
          isSubagent: true,
          subagentLabel: "worker · one"
        }),
        lastMessageAt: "2026-03-24T10:09:00.000Z",
        updatedAt: "2026-03-24T10:09:00.000Z"
      },
      {
        ...createSessionSummary({
          sessionId: "root-subagent-2",
          title: "Subagent 2",
          workspaceId: "workspace-1",
          parentSessionId: "root-session",
          isSubagent: true,
          subagentLabel: "worker · two"
        }),
        lastMessageAt: "2026-03-24T10:08:00.000Z",
        updatedAt: "2026-03-24T10:08:00.000Z"
      },
      {
        ...createSessionSummary({
          sessionId: "root-subagent-3",
          title: "Subagent 3",
          workspaceId: "workspace-1",
          parentSessionId: "root-session",
          isSubagent: true,
          subagentLabel: "worker · three"
        }),
        lastMessageAt: "2026-03-24T10:07:00.000Z",
        updatedAt: "2026-03-24T10:07:00.000Z"
      },
      {
        ...createSessionSummary({
          sessionId: "root-subagent-4",
          title: "Subagent 4",
          workspaceId: "workspace-1",
          parentSessionId: "root-session",
          isSubagent: true,
          subagentLabel: "worker · four"
        }),
        lastMessageAt: "2026-03-24T10:06:00.000Z",
        updatedAt: "2026-03-24T10:06:00.000Z"
      },
      {
        ...createSessionSummary({
          sessionId: "root-subagent-5",
          title: "Subagent 5",
          workspaceId: "workspace-1",
          parentSessionId: "root-session",
          isSubagent: true,
          subagentLabel: "worker · five"
        }),
        lastMessageAt: "2026-03-24T10:05:00.000Z",
        updatedAt: "2026-03-24T10:05:00.000Z"
      },
      {
        ...createSessionSummary({
          sessionId: "root-subagent-6",
          title: "Subagent 6",
          workspaceId: "workspace-1",
          parentSessionId: "root-session",
          isSubagent: true,
          subagentLabel: "worker · six"
        }),
        lastMessageAt: "2026-03-24T10:04:00.000Z",
        updatedAt: "2026-03-24T10:04:00.000Z"
      },
      {
        ...createSessionSummary({
          sessionId: "root-subagent-7-nested",
          title: "Nested Subagent 7",
          workspaceId: "workspace-1",
          parentSessionId: "root-subagent-1",
          isSubagent: true,
          subagentLabel: "explorer · seven"
        }),
        lastMessageAt: "2026-03-24T10:03:00.000Z",
        updatedAt: "2026-03-24T10:03:00.000Z"
      }
    ];

    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "Project One"),
        sessions: [
          {
            ...createSessionSummary({
              sessionId: "root-session",
              title: "Root Session",
              workspaceId: "workspace-1"
            }),
            lastMessageAt: "2026-03-24T10:10:00.000Z",
            updatedAt: "2026-03-24T10:10:00.000Z"
          },
          ...subagentSessions
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/sessions/root-session");

    const rootSession = await screen.findByText("Root Session");
    const rootTreeNode = rootSession.closest(".workbench-session-tree-node") as HTMLElement | null;
    expect(rootTreeNode).not.toBeNull();

    const rootTreeScope = within(rootTreeNode!);

    expect(rootTreeScope.getByText("Subagent 1")).toBeInTheDocument();
    expect(rootTreeScope.getByText("Subagent 2")).toBeInTheDocument();
    expect(rootTreeScope.getByText("Subagent 3")).toBeInTheDocument();
    expect(rootTreeScope.getByText("Subagent 4")).toBeInTheDocument();
    expect(rootTreeScope.getByText("Subagent 5")).toBeInTheDocument();
    expect(rootTreeScope.queryByText("Subagent 6")).not.toBeInTheDocument();
    expect(rootTreeScope.queryByText("Nested Subagent 7")).not.toBeInTheDocument();

    await userEvent.click(rootTreeScope.getByRole("button", { name: t("shell.subagentExpandMore") }));

    expect(rootTreeScope.getByText("Subagent 6")).toBeInTheDocument();
    const nestedSubagent = rootTreeScope.getByText("Nested Subagent 7");
    expect(nestedSubagent).toBeInTheDocument();
    expect(nestedSubagent.closest(".workbench-subsession-list")).not.toBeNull();
    expect(rootTreeScope.queryByRole("button", { name: t("shell.subagentExpandMore") })).not.toBeInTheDocument();
  });
});

function renderWorkbenchRoute(initialEntry = "/sessions/session-1") {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<WorkbenchLayout />}>
            <Route path="/sessions/:sessionId" element={<CurrentLocationProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

function CurrentLocationProbe() {
  const location = useLocation();

  return (
    <div>
      <div data-testid="current-path">{location.pathname}</div>
      <div data-testid="current-search">{location.search}</div>
    </div>
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
  parentSessionId?: string | null;
  isSubagent?: boolean;
  subagentLabel?: string | null;
}) {
  return {
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    provider: input.provider ?? "codex",
    providerSessionId: `raw-${input.sessionId}`,
    rawStoreRef: `codex://${input.sessionId}`,
    parentSessionId: input.parentSessionId ?? null,
    isSubagent: input.isSubagent ?? false,
    subagentLabel: input.subagentLabel ?? null,
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
