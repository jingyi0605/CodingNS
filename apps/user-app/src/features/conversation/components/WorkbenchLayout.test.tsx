import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../auth/store/auth-store";
import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import { WorkbenchLayout } from "./WorkbenchLayout";

const WORKBENCH_NAVIGATION_SNAPSHOT_KEY = "workbench.navigation.snapshot";

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

class NoSnapshotWebSocket extends EventTarget {
  readyState = 1;

  constructor(public readonly url: string) {
    super();

    queueMicrotask(() => {
      this.dispatchEvent(new Event("open"));
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "system.connected" })
        })
      );
    });
  }

  send() {}

  close() {
    this.dispatchEvent(new Event("close"));
  }
}

const originalFetch = global.fetch;
const originalWebSocket = global.WebSocket;

describe("WorkbenchLayout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    clearViewSnapshot(WORKBENCH_NAVIGATION_SNAPSHOT_KEY);
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
    vi.useRealTimers();
    clearViewSnapshot(WORKBENCH_NAVIGATION_SNAPSHOT_KEY);
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket;
  });

  it("支持收藏、归档恢复，并在新建时进入 draft 会话路由", async () => {
    let currentSnapshot = createWorkbenchSnapshot([
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

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/sessions/session-2/archive")) {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { archived?: boolean };
        const archived = payload.archived === true;
        const nextSession = createSessionSummary({
          sessionId: "session-2",
          title: "会话 Beta",
          workspaceId: "workspace-1",
          isArchived: archived
        });

        currentSnapshot = createWorkbenchSnapshot([
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
              nextSession
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

        return createJsonResponse(nextSession);
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

  it("支持会话重命名，并立即更新左侧列表标题", async () => {
    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "旧标题",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/sessions/session-1/title") && init?.method === "PATCH") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { title?: string };
        const nextSession = createSessionSummary({
          sessionId: "session-1",
          title: payload.title ?? "未命名",
          workspaceId: "workspace-1"
        });

        currentSnapshot = createWorkbenchSnapshot([
          {
            workspace: createWorkspace("workspace-1", "项目一"),
            sessions: [nextSession]
          }
        ]);
        MockWebSocket.workbenchSnapshot = currentSnapshot;

        return createJsonResponse(nextSession);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/sessions/session-1");

    const sessionCard = (await screen.findByText("旧标题")).closest(".workbench-session-card") as HTMLElement | null;
    expect(sessionCard).not.toBeNull();

    await userEvent.click(within(sessionCard!).getByRole("button", { name: t("shell.sessionMoreAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.renameAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.renameModalTitle") });
    const input = within(dialog).getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "新标题");
    await userEvent.click(within(dialog).getByRole("button", { name: t("common.save") }));

    await waitFor(() => {
      expect(screen.getByText("新标题")).toBeInTheDocument();
    });
    expect(screen.queryByText("旧标题")).not.toBeInTheDocument();
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

  it("工作区根会话默认分段渲染，并保证当前激活会话不会被折叠掉", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "Project One"),
        sessions: Array.from({ length: 45 }, (_, index) => ({
          ...createSessionSummary({
            sessionId: `root-session-${index + 1}`,
            title: `Root Session ${index + 1}`,
            workspaceId: "workspace-1"
          }),
          lastMessageAt: `2026-03-24T10:${String(59 - index).padStart(2, "0")}:00.000Z`,
          updatedAt: `2026-03-24T10:${String(59 - index).padStart(2, "0")}:00.000Z`
        }))
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

    renderWorkbenchRoute("/sessions/root-session-41");

    const workspaceGroup = (await screen.findByText("Project One")).closest(
      ".workbench-workspace-group"
    ) as HTMLElement | null;
    expect(workspaceGroup).not.toBeNull();

    const workspaceScope = within(workspaceGroup!);
    expect(workspaceScope.getByText("Root Session 1")).toBeInTheDocument();
    expect(workspaceScope.getByText("Root Session 40")).toBeInTheDocument();
    expect(workspaceScope.getByText("Root Session 41")).toBeInTheDocument();
    expect(workspaceScope.queryByText("Root Session 42")).not.toBeInTheDocument();

    await userEvent.click(workspaceScope.getByRole("button", { name: t("shell.sessionExpandMore") }));

    expect(workspaceScope.getByText("Root Session 45")).toBeInTheDocument();
    expect(workspaceScope.queryByRole("button", { name: t("shell.sessionExpandMore") })).not.toBeInTheDocument();
  });

  it("收藏会话默认分段渲染，并支持按批展开", async () => {
    const sessions = Array.from({ length: 25 }, (_, index) => ({
      ...createSessionSummary({
        sessionId: `favorite-session-${index + 1}`,
        title: `Favorite Session ${index + 1}`,
        workspaceId: "workspace-1"
      }),
      lastMessageAt: `2026-03-24T11:${String(59 - index).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-03-24T11:${String(59 - index).padStart(2, "0")}:00.000Z`
    }));
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "Project One"),
        sessions
      }
    ]);

    window.localStorage.setItem(
      "workbench.session.favorite.ids",
      JSON.stringify(sessions.map((session) => session.sessionId))
    );
    MockWebSocket.workbenchSnapshot = currentSnapshot;

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/sessions/favorite-session-1");

    await screen.findByText("Favorite Session 1");

    const favoriteSection = screen.getByText(t("shell.favoriteSectionTitle")).closest(
      ".workbench-section-block"
    ) as HTMLElement | null;
    expect(favoriteSection).not.toBeNull();

    const favoriteScope = within(favoriteSection!);
    expect(favoriteScope.getByText("Favorite Session 1")).toBeInTheDocument();
    expect(favoriteScope.getByText("Favorite Session 20")).toBeInTheDocument();
    expect(favoriteScope.queryByText("Favorite Session 21")).not.toBeInTheDocument();

    await userEvent.click(favoriteScope.getByRole("button", { name: t("shell.favoriteExpandMore") }));

    expect(favoriteScope.getByText("Favorite Session 25")).toBeInTheDocument();
    expect(favoriteScope.queryByRole("button", { name: t("shell.favoriteExpandMore") })).not.toBeInTheDocument();
  });

  it("对推断中的外部会话显示黄色活动图标", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "Project One"),
        sessions: [
          createSessionSummary({
            sessionId: "session-inferred",
            title: "External Session",
            workspaceId: "workspace-1",
            runningState: "running",
            activitySource: "inferred",
            activityState: "running"
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

    renderWorkbenchRoute("/sessions/session-inferred");

    const sessionTitle = await screen.findByText("External Session");
    const sessionCard = sessionTitle.closest(".workbench-session-card") as HTMLElement | null;
    expect(sessionCard).not.toBeNull();
    expect(sessionCard?.querySelector(".session-state-indicator.is-running-inferred")).not.toBeNull();
  });

  it("归档成功后即使收到旧快照，也会再拉最新导航避免会话重新冒出来", async () => {
    const initialSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
          }),
          createSessionSummary({
            sessionId: "session-2",
            title: "会话 Beta",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);
    const archivedSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
          }),
          createSessionSummary({
            sessionId: "session-2",
            title: "会话 Beta",
            workspaceId: "workspace-1",
            isArchived: true
          })
        ]
      }
    ]);
    let currentSnapshot = initialSnapshot;
    let releaseRefresh: (() => void) | null = null;
    let refreshRequestedAfterArchive = false;

    MockWebSocket.workbenchSnapshot = currentSnapshot;

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        if (refreshRequestedAfterArchive) {
          await new Promise<void>((resolve) => {
            releaseRefresh = resolve;
          });
        }

        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/sessions/session-2/archive")) {
        refreshRequestedAfterArchive = true;
        currentSnapshot = archivedSnapshot;
        MockWebSocket.workbenchSnapshot = archivedSnapshot;

        return createJsonResponse(
          createSessionSummary({
            sessionId: "session-2",
            title: "会话 Beta",
            workspaceId: "workspace-1",
            isArchived: true
          })
        );
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute();

    const betaCard = (await screen.findByText("会话 Beta")).closest(".workbench-session-card") as HTMLElement | null;
    expect(betaCard).not.toBeNull();

    await userEvent.click(within(betaCard!).getByRole("button", { name: t("shell.sessionMoreAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.archiveAction") }));

    await waitFor(() => {
      expect(screen.queryAllByText("会话 Beta")).toHaveLength(0);
    });

    MockWebSocket.instances[0]?.dispatchMessage({
      type: "workbench.snapshot",
      snapshot: initialSnapshot
    });

    const pendingReleaseRefresh = releaseRefresh as (() => void) | null;

    if (pendingReleaseRefresh !== null) {
      pendingReleaseRefresh();
    }

    await waitFor(() => {
      expect(screen.queryAllByText("会话 Beta")).toHaveLength(0);
    });
  });
  it("右侧信息栏不会被导航加载状态阻塞", async () => {
    vi.useFakeTimers();
    global.WebSocket = NoSnapshotWebSocket as unknown as typeof WebSocket;
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined)) as typeof fetch;

    const view = renderWorkbenchRoute("/sessions/session-1");
    const shell = view.container.querySelector(".workbench-shell");

    expect(shell?.getAttribute("data-nav-loading")).toBe("true");
    expect(shell?.getAttribute("data-info-ready")).toBe("false");

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(shell?.getAttribute("data-nav-loading")).toBe("true");
    expect(shell?.getAttribute("data-info-ready")).toBe("true");
  });

  it("导航栏会优先显示缓存快照", async () => {
    const cachedSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "缓存会话",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);

    writeViewSnapshot(WORKBENCH_NAVIGATION_SNAPSHOT_KEY, cachedSnapshot);
    MockWebSocket.workbenchSnapshot = cachedSnapshot;
    global.fetch = vi.fn(() => {
      throw new Error("不应该在缓存首屏阶段主动请求 /api/workbench");
    }) as typeof fetch;

    const view = renderWorkbenchRoute("/sessions/session-1");
    const shell = view.container.querySelector(".workbench-shell");

    expect(shell?.getAttribute("data-nav-loading")).toBe("false");
    expect(screen.getByText("缓存会话")).toBeInTheDocument();
    expect(screen.getByText("项目一")).toBeInTheDocument();
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
  isArchived?: boolean;
  parentSessionId?: string | null;
  isSubagent?: boolean;
  subagentLabel?: string | null;
  runningState?: "idle" | "starting" | "running" | "completed" | "interrupted" | "failed";
  activitySource?: "none" | "runtime" | "inferred";
  activityState?: "idle" | "running" | "completed_unread";
}) {
  return {
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    provider: input.provider ?? "codex",
    providerSessionId: `raw-${input.sessionId}`,
    rawStoreRef: `codex://${input.sessionId}`,
    isArchived: input.isArchived ?? false,
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
    runningState: input.runningState ?? "idle",
    activitySource: input.activitySource ?? "none",
    lastEventAt: "2026-03-24T10:00:00.000Z",
    completedAt: null,
    lastSeenAt: null,
    activityState: input.activityState ?? "idle"
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
