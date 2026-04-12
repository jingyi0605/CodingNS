import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../auth/store/auth-store";
import { localUiPreferenceStore } from "../../../preferences/local-ui-preference-store";
import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import {
  createButlerInboxItem,
  deleteButlerInboxItem,
  getButlerOverview,
  getButlerProfile,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listButlerNotificationArchives,
  listButlerProjects,
  updateButlerNotificationArchive,
  updateButlerInboxItem
} from "../../butler/api/butler-api";
import {
  WorkbenchLayout,
  flattenVisibleSessionTree,
  getTreeNodeChildren,
  getVisibleSessionTreeNodes,
  reorderWorkspaceGroups,
  useWorkbenchShell
} from "./WorkbenchLayout";

const openFilesExternalWindowMock = vi.hoisted(() => vi.fn());
const openGitExternalWindowMock = vi.hoisted(() => vi.fn());
const openProcessesExternalWindowMock = vi.hoisted(() => vi.fn());

vi.mock("../../../platform/desktop/window-openers", () => ({
  openFilesExternalWindow: openFilesExternalWindowMock,
  openGitExternalWindow: openGitExternalWindowMock,
  openProcessesExternalWindow: openProcessesExternalWindowMock
}));

vi.mock("../../butler/api/butler-api", () => ({
  createButlerInboxItem: vi.fn(),
  deleteButlerInboxItem: vi.fn(),
  getButlerProfile: vi.fn(),
  getButlerOverview: vi.fn(),
  listButlerFollowUpTasks: vi.fn(),
  listButlerInboxItems: vi.fn(),
  listButlerNotificationArchives: vi.fn(),
  listButlerProjects: vi.fn(),
  updateButlerNotificationArchive: vi.fn(),
  updateButlerInboxItem: vi.fn()
}));

const mockedCreateButlerInboxItem = vi.mocked(createButlerInboxItem);
const mockedDeleteButlerInboxItem = vi.mocked(deleteButlerInboxItem);
const mockedGetButlerProfile = vi.mocked(getButlerProfile);
const mockedGetButlerOverview = vi.mocked(getButlerOverview);
const mockedListButlerFollowUpTasks = vi.mocked(listButlerFollowUpTasks);
const mockedListButlerInboxItems = vi.mocked(listButlerInboxItems);
const mockedListButlerNotificationArchives = vi.mocked(listButlerNotificationArchives);
const mockedListButlerProjects = vi.mocked(listButlerProjects);
const mockedUpdateButlerNotificationArchive = vi.mocked(updateButlerNotificationArchive);
const mockedUpdateButlerInboxItem = vi.mocked(updateButlerInboxItem);

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
const originalInnerWidth = window.innerWidth;
const originalTauriInternals = window.__TAURI_INTERNALS__;
const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "platform");
const maxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "maxTouchPoints");

function mockNavigator({
  userAgent,
  platform,
  maxTouchPoints = 0
}: {
  userAgent: string;
  platform: string;
  maxTouchPoints?: number;
}) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent
  });
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: platform
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: maxTouchPoints
  });
}

describe("WorkbenchLayout", () => {
  beforeEach(() => {
    openFilesExternalWindowMock.mockReset();
    openGitExternalWindowMock.mockReset();
    openProcessesExternalWindowMock.mockReset();
    mockedCreateButlerInboxItem.mockReset();
    mockedDeleteButlerInboxItem.mockReset();
    mockedGetButlerProfile.mockReset();
    mockedGetButlerOverview.mockReset();
    mockedListButlerFollowUpTasks.mockReset();
    mockedListButlerInboxItems.mockReset();
    mockedListButlerNotificationArchives.mockReset();
    mockedListButlerProjects.mockReset();
    mockedUpdateButlerNotificationArchive.mockReset();
    mockedUpdateButlerInboxItem.mockReset();
    openFilesExternalWindowMock.mockResolvedValue({
      ok: true,
      value: {
        windowId: "files-workspace-1"
      }
    });
    openGitExternalWindowMock.mockResolvedValue({
      ok: true,
      value: {
        windowId: "git-workspace-1"
      }
    });
    openProcessesExternalWindowMock.mockResolvedValue({
      ok: true,
      value: {
        windowId: "processes-workspace-1"
      }
    });
    window.localStorage.clear();
    window.sessionStorage.clear();
    localUiPreferenceStore.setNotificationPreferences({
      notifyOnPermissionRequest: true,
      notifyOnSessionCompleted: true,
      notifyOnSessionFailed: true
    });
    mockedGetButlerProfile.mockResolvedValue({
      initialized: false,
      profile: null
    } as never);
    mockedGetButlerOverview.mockResolvedValue({
      overview: {
        version: "v1",
        generatedAt: "2026-04-07T00:00:00.000Z",
        global: {
          projectCount: 0,
          activeProjectCount: 0,
          blockedProjectCount: 0,
          highRiskProjectCount: 0,
          topRisks: [],
          nextActions: []
        },
        projects: [],
        sessions: [],
        patrols: [],
        verifications: []
      }
    } as never);
    mockedListButlerFollowUpTasks.mockResolvedValue({ items: [] } as never);
    mockedListButlerNotificationArchives.mockResolvedValue({ items: [] } as never);
    mockedUpdateButlerNotificationArchive.mockResolvedValue({ item: null } as never);
    clearViewSnapshot(WORKBENCH_NAVIGATION_SNAPSHOT_KEY);
    clearViewSnapshot("workspace-management.summary.workspace-1");
    clearViewSnapshot("git-sidebar.snapshot.workspace-1");
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
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth
    });

    if (userAgentDescriptor) {
      Object.defineProperty(window.navigator, "userAgent", userAgentDescriptor);
    }

    if (platformDescriptor) {
      Object.defineProperty(window.navigator, "platform", platformDescriptor);
    }

    if (maxTouchPointsDescriptor) {
      Object.defineProperty(window.navigator, "maxTouchPoints", maxTouchPointsDescriptor);
    }

    if (originalTauriInternals) {
      window.__TAURI_INTERNALS__ = originalTauriInternals;
      return;
    }

    delete window.__TAURI_INTERNALS__;
  });

  it("会把缺失 children 的侧栏树节点当作空数组处理", () => {
    const session = createSessionSummary({
      sessionId: "session-1",
      title: "根会话",
      workspaceId: "workspace-1"
    });
    const malformedNode = {
      session,
      children: undefined
    } as unknown as Parameters<typeof flattenVisibleSessionTree>[0][number];

    expect(getTreeNodeChildren(malformedNode)).toEqual([]);
    expect(flattenVisibleSessionTree([malformedNode])).toEqual([session]);
    expect(
      getVisibleSessionTreeNodes({
        visibleSessionTree: [malformedNode, undefined] as never
      })
    ).toHaveLength(1);
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

      if (url.endsWith("/api/sessions/session-2/favorite") && init?.method === "PATCH") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { favorite?: boolean };
        const favorite = payload.favorite === true;
        const nextSession = createSessionSummary({
          sessionId: "session-2",
          title: "会话 Beta",
          workspaceId: "workspace-1",
          isFavorite: favorite
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

      if (url.includes("/api/sessions/session-2/archive")) {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { archived?: boolean };
        const archived = payload.archived === true;
        const nextSession = createSessionSummary({
          sessionId: "session-2",
          title: "会话 Beta",
          workspaceId: "workspace-1",
          isArchived: archived,
          isFavorite: true
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

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("claude-code"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    const firstView = renderWorkbenchRoute();

    expect(await findSessionCardByTitle("会话 Alpha")).toBeInTheDocument();
    expect(screen.queryByText("子代理探索")).not.toBeInTheDocument();
    expect(screen.queryByText("子代理深挖")).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.favoriteSectionTitle"))).not.toBeInTheDocument();

    const alphaCard = await findSessionCardByTitle("会话 Alpha");
    await userEvent.click(within(alphaCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const subagentTitle = screen.getByText("子代理探索");
    expect(subagentTitle).toBeInTheDocument();
    expect(subagentTitle.closest(".workbench-subsession-list")).not.toBeNull();
    expect(screen.getByText("worker · Banach")).toBeInTheDocument();
    const nestedSubagentTitle = screen.getByText("子代理深挖");
    expect(nestedSubagentTitle).toBeInTheDocument();
    expect(nestedSubagentTitle.closest(".workbench-subsession-list")).not.toBeNull();
    expect(screen.getByText("explorer · Turing")).toBeInTheDocument();

    const betaCard = await findSessionCardByTitle("会话 Beta");

    await userEvent.click(within(betaCard).getByRole("button", { name: t("shell.sessionMoreAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.favoriteAction") }));

    const favoriteSection = screen
      .getByText(t("shell.favoriteSectionTitle"))
      .closest(".workbench-section-block") as HTMLElement | null;
    expect(favoriteSection).not.toBeNull();
    expect(within(favoriteSection!).getByText("会话 Beta")).toBeInTheDocument();

    firstView.unmount();

    renderWorkbenchRoute();

    const favoriteSectionAfterReload = screen
      .getByText(t("shell.favoriteSectionTitle"))
      .closest(".workbench-section-block") as HTMLElement | null;
    expect(favoriteSectionAfterReload).not.toBeNull();
    await waitFor(() => {
      expect(within(favoriteSectionAfterReload!).getByText("会话 Beta")).toBeInTheDocument();
    });
    const workspaceGroupAfterReload = await findWorkspaceGroupByName("项目一");
    expect(within(workspaceGroupAfterReload).queryByText("会话 Beta")).not.toBeInTheDocument();

    const betaCardAfterReload = await findSessionCardByTitle("会话 Beta");

    await userEvent.click(
      within(betaCardAfterReload).getByRole("button", { name: t("shell.sessionMoreAction") })
    );
    await userEvent.click(screen.getByRole("button", { name: t("shell.archiveAction") }));

    await waitFor(() => {
      expect(screen.queryAllByText("会话 Beta")).toHaveLength(0);
    });

    const archiveFolders = screen.getAllByRole("button", { name: /归档会话/ });
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
      expect(screen.getByTestId("current-path").textContent).toMatch(
        /^\/workspaces\/workspace-1\/sessions\/draft-/
      );
      expect(screen.getByTestId("current-search").textContent).toBe("?provider=claude-code");
    });
  });

  it("startDraftSession 在 provider 不可用时不会进入 draft 路由", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
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

      if (url.includes("/api/providers/gemini/capabilities")) {
        return createJsonResponse(createUnavailableCapabilities("gemini", "未检测到 Gemini CLI"), 200);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions"]}>
          <Routes>
            <Route element={<WorkbenchLayout shellMode="desktop" />}>
              <Route
                path="/workspaces/:workspaceId/sessions"
                element={<StartDraftSessionProbe workspaceId="workspace-1" provider="gemini" />}
              />
              <Route
                path="/workspaces/:workspaceId/sessions/:sessionId"
                element={<CurrentLocationProbe />}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await screen.findByText("触发草稿会话");
    await userEvent.click(screen.getByRole("button", { name: "触发草稿会话" }));

    expect(await screen.findByText("未检测到 Gemini CLI")).toBeInTheDocument();
    expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-1/sessions");
    expect(screen.getByTestId("current-search").textContent).toBe("");
  });

  it("收藏会话在快照短暂缺失后恢复时，不会被前端错误清掉", async () => {
    const favoriteSession = createSessionSummary({
      sessionId: "session-2",
      title: "会话 Beta",
      workspaceId: "workspace-1",
      provider: "opencode",
      isFavorite: true
    });
    const fullSnapshot = createWorkbenchSnapshot([
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
            provider: "opencode"
          })
        ]
      }
    ]);
    let currentSnapshot = fullSnapshot;
    const favoriteSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
          }),
          favoriteSession
        ]
      }
    ]);
    const missingFavoriteSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
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

      if (url.endsWith("/api/sessions/session-2/favorite") && init?.method === "PATCH") {
        currentSnapshot = favoriteSnapshot;
        MockWebSocket.workbenchSnapshot = favoriteSnapshot;
        return createJsonResponse(favoriteSession);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute();

    const betaCard = await findSessionCardByTitle("会话 Beta");
    await userEvent.click(within(betaCard).getByRole("button", { name: t("shell.sessionMoreAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.favoriteAction") }));

    MockWebSocket.instances[0]?.dispatchMessage({
      type: "workbench.snapshot",
      snapshot: missingFavoriteSnapshot
    });

    await waitFor(() => {
      expect(screen.queryByText("会话 Beta")).not.toBeInTheDocument();
    });

    MockWebSocket.instances[0]?.dispatchMessage({
      type: "workbench.snapshot",
      snapshot: favoriteSnapshot
    });

    await waitFor(() => {
      expect(screen.getByText(t("shell.favoriteSectionTitle"))).toBeInTheDocument();
      expect(screen.getAllByText("会话 Beta").length).toBeGreaterThan(0);
    });
  });

  it("会话菜单吸附在按钮右侧并与按钮底部对齐", async () => {
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
            sessionId: "session-2",
            title: "会话 Beta",
            workspaceId: "workspace-1"
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

    renderWorkbenchRoute();

    const betaCard = await findSessionCardByTitle("会话 Beta");
    const menuTrigger = within(betaCard).getByRole("button", { name: t("shell.sessionMoreAction") });
    Object.defineProperty(menuTrigger, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(() => ({
        top: 120,
        right: 248,
        bottom: 150,
        left: 218,
        width: 30,
        height: 30,
        x: 218,
        y: 120,
        toJSON: () => null
      }))
    });

    await userEvent.click(menuTrigger);

    const menu = document.querySelector(".workbench-session-menu");

    if (!(menu instanceof HTMLElement)) {
      throw new Error("未找到会话操作菜单");
    }

    expect(menu).not.toHaveAttribute("data-placement");
    expect(menu).toHaveStyle({
      top: "150px",
      left: "248px"
    });
  });

  it("macOS 桌面端只保留原三栏顶部作为拖拽区，不再额外插入统一顶栏", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "MacIntel"
    });
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };

    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    await screen.findByRole("button", { name: t("shell.hideSessionSidebar") });

    const navHeader = document.querySelector(".workbench-nav-header");
    const navToolbar = document.querySelector(".workbench-nav-toolbar");
    const navBody = document.querySelector(".workbench-nav-body");
    const navSegment = document.querySelector(".workbench-nav-segment");
    const auxiliaryHeader = document.querySelector(".workbench-auxiliary-header");
    const infoTabs = document.querySelector(".workbench-info-tabs");

    expect(document.querySelector(".workbench-desktop-titlebar")).toBeNull();
    expect(navHeader).toHaveAttribute("data-window-drag-handle", "workbench-nav-header");
    expect(auxiliaryHeader).toHaveAttribute("data-window-drag-handle", "workbench-auxiliary-header");
    expect(navHeader).not.toHaveAttribute("data-tauri-drag-region");
    expect(navToolbar).not.toHaveAttribute("data-tauri-drag-region");
    expect(navBody).not.toHaveAttribute("data-tauri-drag-region");
    expect(navSegment).not.toHaveAttribute("data-tauri-drag-region");
    expect(auxiliaryHeader).not.toHaveAttribute("data-tauri-drag-region");
    expect(infoTabs).not.toHaveAttribute("data-tauri-drag-region");
    expect(
      screen.getByRole("button", { name: t("shell.hideSessionSidebar") })
    ).not.toHaveAttribute("data-tauri-drag-region");
  });

  it("拖拽文件管理标签会触发独立窗口开窗命令", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "MacIntel"
    });
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };

    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    await screen.findByRole("button", { name: t("shell.hideInfoSidebar") });
    const infoTabs = document.querySelector(".workbench-info-tabs");

    expect(infoTabs).not.toBeNull();
    const filesTab = within(infoTabs as HTMLElement).getByRole("tab", { name: t("shell.filesEntry") });
    fireEvent.mouseDown(filesTab, {
      button: 0,
      clientX: 24,
      clientY: 24
    });
    fireEvent.mouseMove(window, {
      clientX: 56,
      clientY: 25
    });
    expect(openFilesExternalWindowMock).not.toHaveBeenCalled();
    fireEvent.mouseUp(window, {
      clientX: 56,
      clientY: 25
    });

    await waitFor(() => {
      expect(openFilesExternalWindowMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workspaceId: "workspace-1",
          sessionId: "session-1",
          focusOwner: "file-context-panel"
        })
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    const sessionCard = await findSessionCardByTitle("旧标题");

    await userEvent.click(within(sessionCard).getByRole("button", { name: t("shell.sessionMoreAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.renameAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.renameModalTitle") });
    const input = within(dialog).getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "新标题");
    await userEvent.click(within(dialog).getByRole("button", { name: t("common.save") }));

    await waitFor(() => {
      expect(getSessionCardByTitle("新标题")).toBeInTheDocument();
    });
    expect(querySessionCardsByTitle("旧标题")).toHaveLength(0);
  });

  it("主会话默认收起子代理，并支持展开、分页和再次收起", async () => {
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/root-session");

    const rootSession = await findSessionCardByTitle("Root Session");
    const rootTreeNode = rootSession.closest(".workbench-session-tree-node") as HTMLElement | null;
    expect(rootTreeNode).not.toBeNull();

    const rootTreeScope = within(rootTreeNode!);

    expect(rootTreeScope.queryByText("Subagent 1")).not.toBeInTheDocument();
    expect(rootTreeScope.queryByText("Subagent 5")).not.toBeInTheDocument();
    expect(rootTreeScope.queryByText("Nested Subagent 7")).not.toBeInTheDocument();

    await userEvent.click(rootTreeScope.getByRole("button", { name: t("shell.subagentExpand") }));

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

    await userEvent.click(rootTreeScope.getByRole("button", { name: t("shell.subagentCollapse") }));

    expect(rootTreeScope.queryByText("Subagent 1")).not.toBeInTheDocument();
    expect(rootTreeScope.queryByText("Subagent 6")).not.toBeInTheDocument();
  });

  it("嵌套子代理分页时只保留一个展开更多按钮", async () => {
    const nestedSubagentSessions = [
      {
        ...createSessionSummary({
          sessionId: "branch-root",
          title: "Branch Root",
          workspaceId: "workspace-1",
          parentSessionId: "root-session",
          isSubagent: true,
          subagentLabel: "worker · branch-root"
        }),
        lastMessageAt: "2026-03-24T10:09:00.000Z",
        updatedAt: "2026-03-24T10:09:00.000Z"
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        ...createSessionSummary({
          sessionId: `branch-nested-${index + 1}`,
          title: `Branch Nested ${index + 1}`,
          workspaceId: "workspace-1",
          parentSessionId: "branch-root",
          isSubagent: true,
          subagentLabel: `worker · nested-${index + 1}`
        }),
        lastMessageAt: `2026-03-24T10:0${8 - index}:00.000Z`,
        updatedAt: `2026-03-24T10:0${8 - index}:00.000Z`
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        ...createSessionSummary({
          sessionId: `root-sibling-${index + 1}`,
          title: `Root Sibling ${index + 1}`,
          workspaceId: "workspace-1",
          parentSessionId: "root-session",
          isSubagent: true,
          subagentLabel: `worker · sibling-${index + 1}`
        }),
        lastMessageAt: `2026-03-24T09:5${9 - index}:00.000Z`,
        updatedAt: `2026-03-24T09:5${9 - index}:00.000Z`
      }))
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
          ...nestedSubagentSessions
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/root-session");

    const rootSession = await findSessionCardByTitle("Root Session");
    const rootTreeNode = rootSession.closest(".workbench-session-tree-node") as HTMLElement | null;
    expect(rootTreeNode).not.toBeNull();

    const rootTreeScope = within(rootTreeNode!);

    await userEvent.click(rootTreeScope.getByRole("button", { name: t("shell.subagentExpand") }));
    await userEvent.click(rootTreeScope.getByRole("button", { name: t("shell.subagentExpandMore") }));

    expect(rootTreeScope.getByText("Branch Nested 6")).toBeInTheDocument();
    expect(rootTreeScope.getByText("Root Sibling 3")).toBeInTheDocument();
    expect(rootTreeScope.getAllByRole("button", { name: t("shell.subagentExpandMore") })).toHaveLength(1);

    MockWebSocket.instances[0]?.dispatchMessage({
      type: "workbench.snapshot",
      snapshot: currentSnapshot
    });

    await waitFor(() => {
      expect(rootTreeScope.getByText("Branch Nested 6")).toBeInTheDocument();
      expect(rootTreeScope.getByText("Root Sibling 3")).toBeInTheDocument();
    });
    expect(rootTreeScope.getAllByRole("button", { name: t("shell.subagentExpandMore") })).toHaveLength(1);
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/root-session-41");

    const workspaceGroup = await findWorkspaceGroupByName("Project One");

    const workspaceScope = within(workspaceGroup);
    expect(workspaceScope.getByText("Root Session 1")).toBeInTheDocument();
    expect(workspaceScope.getByText("Root Session 40")).toBeInTheDocument();
    expect(workspaceScope.getByText("Root Session 41")).toBeInTheDocument();
    expect(workspaceScope.queryByText("Root Session 42")).not.toBeInTheDocument();

    await userEvent.click(workspaceScope.getByRole("button", { name: t("shell.sessionExpandMore") }));

    expect(workspaceScope.getByText("Root Session 45")).toBeInTheDocument();
    expect(workspaceScope.queryByRole("button", { name: t("shell.sessionExpandMore") })).not.toBeInTheDocument();
  });

  it("会在会话树节点上显示 fork 来源标签", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "Project One"),
        sessions: [
          createSessionSummary({
            sessionId: "root-session",
            title: "Root Session",
            workspaceId: "workspace-1"
          }),
          createSessionSummary({
            sessionId: "fork-session-1",
            title: "Session Fork Child",
            workspaceId: "workspace-1",
            parentSessionId: "root-session",
            forkMethod: "native_session_fork",
            forkSourceType: "session"
          }),
          createSessionSummary({
            sessionId: "fork-message-1",
            title: "Message Fork Child",
            workspaceId: "workspace-1",
            parentSessionId: "root-session",
            forkMethod: "native_message_fork",
            forkSourceType: "message",
            isSubagent: true,
            subagentLabel: "dirty-subagent-label"
          }),
          createSessionSummary({
            sessionId: "fork-reconstructed-1",
            title: "Reconstructed Fork Child",
            workspaceId: "workspace-1",
            parentSessionId: "root-session",
            forkMethod: "reconstructed_message_fork",
            forkSourceType: "message"
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/root-session");

    const rootSession = await findSessionCardByTitle("Root Session");
    const rootTreeNode = rootSession.closest(".workbench-session-tree-node") as HTMLElement | null;
    expect(rootTreeNode).not.toBeNull();

    const rootTreeScope = within(rootTreeNode!);

    await userEvent.click(rootTreeScope.getByRole("button", { name: t("shell.subagentExpand") }));

    expect(
      within(getSessionCardByTitle("Session Fork Child")).getByText(t("shell.sessionForkSession"))
    ).toBeInTheDocument();
    expect(
      within(getSessionCardByTitle("Message Fork Child")).getByText(t("shell.sessionForkMessage"))
    ).toBeInTheDocument();
    expect(
      within(getSessionCardByTitle("Message Fork Child")).queryByText(t("shell.subagentBadge"))
    ).not.toBeInTheDocument();
    expect(
      within(getSessionCardByTitle("Message Fork Child")).queryByText("dirty-subagent-label")
    ).not.toBeInTheDocument();
    expect(
      within(getSessionCardByTitle("Reconstructed Fork Child")).getByText(t("shell.sessionForkReconstructed"))
    ).toBeInTheDocument();
    expect(
      within(getSessionCardByTitle("Root Session")).queryByText(t("shell.sessionForkSession"))
    ).not.toBeInTheDocument();
  });

  it("收藏会话默认分段渲染，并支持按批展开", async () => {
    const sessions = Array.from({ length: 25 }, (_, index) => ({
      ...createSessionSummary({
        sessionId: `favorite-session-${index + 1}`,
        title: `Favorite Session ${index + 1}`,
        workspaceId: "workspace-1",
        isFavorite: true
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

    MockWebSocket.workbenchSnapshot = currentSnapshot;

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/favorite-session-1");

    await findSessionCardByTitle("Favorite Session 1");

    const favoriteTitle = await screen.findByText(t("shell.favoriteSectionTitle"));
    const favoriteSection = favoriteTitle.closest(
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

  it("收藏区里的主会话如果带子代理，也能展开查看子代理", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "Project One"),
        sessions: [
          {
            ...createSessionSummary({
              sessionId: "favorite-root",
              title: "Favorite Root",
              workspaceId: "workspace-1",
              isFavorite: true
            }),
            lastMessageAt: "2026-03-24T11:00:00.000Z",
            updatedAt: "2026-03-24T11:00:00.000Z"
          },
          {
            ...createSessionSummary({
              sessionId: "favorite-root-sub",
              title: "Favorite Root Subagent",
              workspaceId: "workspace-1",
              parentSessionId: "favorite-root",
              isSubagent: true,
              subagentLabel: "worker · fav"
            }),
            lastMessageAt: "2026-03-24T10:50:00.000Z",
            updatedAt: "2026-03-24T10:50:00.000Z"
          }
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/favorite-root");

    const favoriteTitle = await screen.findByText(t("shell.favoriteSectionTitle"));
    const favoriteSection = favoriteTitle.closest(
      ".workbench-section-block"
    ) as HTMLElement | null;
    expect(favoriteSection).not.toBeNull();

    const favoriteScope = within(favoriteSection!);
    await userEvent.click(favoriteScope.getByRole("button", { name: t("shell.subagentExpand") }));

    expect(favoriteScope.getByText("Favorite Root Subagent")).toBeInTheDocument();
  });

  it("归档文件夹里只显示主会话，不单独列出子代理", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "archived-root",
            title: "归档主会话",
            workspaceId: "workspace-1",
            isArchived: true
          }),
          createSessionSummary({
            sessionId: "archived-root-sub",
            title: "归档子代理",
            workspaceId: "workspace-1",
            parentSessionId: "archived-root",
            isSubagent: true,
            subagentLabel: "worker · archived",
            isArchived: true
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/archived-root");

    const archiveFolder = await screen.findByRole("button", { name: /归档会话/ });
    await userEvent.click(archiveFolder);

    const archiveDialog = await screen.findByRole("dialog", { name: t("shell.archiveModalTitle") });
    expect(within(archiveDialog).getByText("归档主会话")).toBeInTheDocument();
    expect(within(archiveDialog).queryByText("归档子代理")).not.toBeInTheDocument();
  });

  it("对话页侧边会话列表不会显示父会话已归档的孤儿子会话", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "Project One"),
        sessions: [
          createSessionSummary({
            sessionId: "favorite-root",
            title: "Favorite Root",
            workspaceId: "workspace-1",
            isFavorite: true,
            isArchived: false
          }),
          createSessionSummary({
            sessionId: "archived-root",
            title: "已归档父会话",
            workspaceId: "workspace-1",
            isArchived: true
          }),
          createSessionSummary({
            sessionId: "orphan-subagent",
            title: "孤儿子会话",
            workspaceId: "workspace-1",
            parentSessionId: "archived-root",
            isSubagent: true,
            subagentLabel: "worker · orphan",
            isArchived: false
          }),
          createSessionSummary({
            sessionId: "visible-root",
            title: "可见主会话",
            workspaceId: "workspace-1",
            isArchived: false
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/visible-root");

    await screen.findByText("可见主会话");

    expect(screen.queryByText("孤儿子会话")).not.toBeInTheDocument();
    expect(screen.getByText("Favorite Root")).toBeInTheDocument();
  });

  it("搜索按钮不会抢占页面焦点，并支持会话与代码搜索", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "终端调试",
            workspaceId: "workspace-1"
          })
        ]
      },
      {
        workspace: createWorkspace("workspace-2", "项目二"),
        sessions: [
          createSessionSummary({
            sessionId: "session-2",
            title: "搜索目标会话",
            workspaceId: "workspace-2",
            provider: "claude-code"
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

      if (url.includes("/api/files/search?")) {
        return createJsonResponse({
          items: [
            {
              path: "src/components/SearchPanel.tsx",
              name: "SearchPanel.tsx",
              kind: "file",
              size: 1234,
              updatedAt: "2026-03-24T10:00:00.000Z"
            }
          ],
          total: 1,
          page: 1,
          pageSize: 20
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    const conversationTab = await screen.findByRole("tab", { name: t("shell.conversationEntry") });
    const terminalTab = screen.getByRole("tab", { name: t("shell.terminalsEntry") });
    const [searchButton] = screen.getAllByRole("button", { name: t("shell.searchEntry") });

    expect(conversationTab.className).toContain("active");
    expect(terminalTab.className).not.toContain("active");
    expect(searchButton).toHaveAttribute("data-open", "false");

    await userEvent.click(searchButton);

    const searchDialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    expect(searchDialog).toBeInTheDocument();
    expect(conversationTab.className).toContain("active");
    expect(searchButton).toHaveAttribute("data-open", "true");

    const sessionInput = within(searchDialog).getByRole("textbox");
    await userEvent.type(sessionInput, "搜索目标");
    await userEvent.click(within(searchDialog).getByRole("button", { name: /搜索目标会话/ }));

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe(
        "/workspaces/workspace-2/sessions/session-2"
      );
    });

    await userEvent.click(screen.getAllByRole("button", { name: t("shell.searchEntry") })[0]);
    const reopenedDialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    await userEvent.click(within(reopenedDialog).getByRole("tab", { name: t("shell.searchModeCode") }));

    const codeInput = within(reopenedDialog).getByRole("textbox");
    await userEvent.type(codeInput, "SearchPanel");
    await userEvent.click(within(reopenedDialog).getByRole("button", { name: t("shell.searchSubmit") }));

    expect(await screen.findByText("SearchPanel.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/components/SearchPanel.tsx")).toBeInTheDocument();
  });

  it("桌面侧栏会在终端和搜索之间显示助手入口，并支持跳转", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
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

    const user = userEvent.setup();
    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    await screen.findByText("会话 Alpha");

    const navSegment = document.querySelector(".workbench-nav-segment");
    expect(navSegment).not.toBeNull();

    const navLabels = Array.from(navSegment?.querySelectorAll("button") ?? []).map((button) =>
      button.textContent?.trim()
    );
    expect(navLabels).toEqual([
      t("shell.conversationEntry"),
      t("shell.terminalsEntry"),
      t("shell.butlerEntry"),
      t("shell.searchEntry")
    ]);

    await user.click(screen.getByRole("tab", { name: t("shell.butlerEntry") }));

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-1/butler");
    });
  });

  it("助手路由下不会再显示默认信息侧栏", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
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

    const view = renderWorkbenchRoute("/workspaces/workspace-1/butler");

    await screen.findByText("项目一");

    expect(view.container.querySelector(".workbench-auxiliary")).toBeNull();
    expect(screen.queryByRole("button", { name: t("shell.showInfoSidebar") })).not.toBeInTheDocument();
  });

  it("助手路由注册自定义侧栏后，会在右侧信息栏展示 Butler 内容", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: []
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

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/workspaces/workspace-1/butler"]}>
          <Routes>
            <Route element={<WorkbenchLayout />}>
              <Route path="/workspaces/:workspaceId/butler" element={<ButlerAuxiliaryProbe />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Butler Right Panel")).toBeInTheDocument();
    });
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-inferred");

    const sessionCard = await findSessionCardByTitle("External Session");
    expect(sessionCard.querySelector(".session-state-indicator.is-running-inferred")).not.toBeNull();
    expect(within(sessionCard).queryByText(t("shell.sessionStateInferred"))).not.toBeInTheDocument();
  });

  it("对 stale 会话显示待确认状态徽标", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "Project One"),
        sessions: [
          createSessionSummary({
            sessionId: "session-stale",
            title: "Host Run",
            workspaceId: "workspace-1",
            runningState: "stale",
            activitySource: "runtime",
            activityResolutionSource: "authoritative_runtime",
            activityState: "idle"
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-stale");

    const sessionCard = await findSessionCardByTitle("Host Run");
    expect(sessionCard.querySelector(".session-state-indicator.is-stale")).not.toBeNull();
    expect(within(sessionCard).getByText(t("conversation.runtimeStale"))).toBeInTheDocument();
  });

  it("归档请求未完成时收到旧快照，也不会把会话重新抬出来", async () => {
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
    let archiveRequestStarted = false;
    let releaseArchiveRequest!: (response: Response) => void;

    MockWebSocket.workbenchSnapshot = currentSnapshot;

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/sessions/session-2/archive")) {
        archiveRequestStarted = true;

        return await new Promise<Response>((resolve) => {
          releaseArchiveRequest = resolve;
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute();

    const betaCard = await findSessionCardByTitle("会话 Beta");

    await userEvent.click(within(betaCard).getByRole("button", { name: t("shell.sessionMoreAction") }));
    const archiveActionPromise = userEvent.click(screen.getByRole("button", { name: t("shell.archiveAction") }));

    await waitFor(() => {
      expect(archiveRequestStarted).toBe(true);
    });

    await waitFor(() => {
      expect(screen.queryAllByText("会话 Beta")).toHaveLength(0);
    });

    MockWebSocket.instances[0]?.dispatchMessage({
      type: "workbench.snapshot",
      snapshot: initialSnapshot
    });

    await waitFor(() => {
      expect(screen.queryAllByText("会话 Beta")).toHaveLength(0);
    });

    currentSnapshot = archivedSnapshot;
    MockWebSocket.workbenchSnapshot = archivedSnapshot;
    expect(archiveRequestStarted).toBe(true);
    releaseArchiveRequest(
      createJsonResponse(
        createSessionSummary({
          sessionId: "session-2",
          title: "会话 Beta",
          workspaceId: "workspace-1",
          isArchived: true
        })
      )
    );

    await archiveActionPromise;

    await waitFor(() => {
      expect(screen.queryAllByText("会话 Beta")).toHaveLength(0);
    });
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

    const betaCard = await findSessionCardByTitle("会话 Beta");

    await userEvent.click(within(betaCard).getByRole("button", { name: t("shell.sessionMoreAction") }));
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

    const view = renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
    const shell = view.container.querySelector(".workbench-shell");

    expect(shell?.getAttribute("data-nav-loading")).toBe("true");
    expect(shell?.getAttribute("data-info-ready")).toBe("false");

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(shell?.getAttribute("data-nav-loading")).toBe("true");
    expect(shell?.getAttribute("data-info-ready")).toBe("true");
  });

  it("桌面端收起两侧边栏后保留顶部展开控件而不是退化成汉堡按钮", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "MacIntel"
    });
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };

    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
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

    const view = renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    await findSessionCardByTitle("会话 Alpha");

    const hideSessionSidebarButtons = await screen.findAllByRole("button", {
      name: t("shell.hideSessionSidebar")
    });
    const hideInfoSidebarButtons = await screen.findAllByRole("button", {
      name: t("shell.hideInfoSidebar")
    });

    await userEvent.click(hideSessionSidebarButtons[0]);
    await userEvent.click(hideInfoSidebarButtons[0]);

    const shell = view.container.querySelector(".workbench-shell");
    const leftRail = view.container.querySelector(
      '.workbench-collapsed-controls.left[data-visible="true"]'
    );
    const rightRail = view.container.querySelector(
      '.workbench-collapsed-controls.right[data-visible="true"]'
    );

    expect(shell?.getAttribute("data-left-collapsed")).toBe("true");
    expect(shell?.getAttribute("data-right-collapsed")).toBe("true");
    expect(view.container.querySelector(".workbench-edge-toggle")).toBeNull();
    expect(view.container.querySelector('.workbench-nav[data-collapsed="true"]')).not.toBeNull();
    expect(view.container.querySelector('.workbench-auxiliary[data-collapsed="true"]')).not.toBeNull();
    expect(leftRail).not.toBeNull();
    expect(rightRail).not.toBeNull();
    expect(
      within(leftRail as HTMLElement).getByRole("button", { name: t("shell.showSessionSidebar") })
    ).toBeInTheDocument();
    expect(
      within(leftRail as HTMLElement).getByRole("button", { name: t("shell.goBack") })
    ).toBeInTheDocument();
    expect(
      within(leftRail as HTMLElement).getByRole("button", { name: t("shell.goForward") })
    ).toBeInTheDocument();
    expect(
      within(leftRail as HTMLElement).getByRole("button", { name: t("shell.globalNotificationsAction") })
    ).toBeInTheDocument();
    expect(
      (leftRail as HTMLElement).querySelector(".workbench-window-drag-spacer.collapsed")
    ).toBeNull();
    expect(
      within(rightRail as HTMLElement).getByRole("button", { name: t("shell.showInfoSidebar") })
    ).toBeInTheDocument();
  });

  it("会在左侧头部显示全局通知按钮，并用气泡展示未读数量", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "哆哆"
      }
    } as never);
    mockedGetButlerOverview.mockResolvedValueOnce({
      overview: {
        version: "v1",
        generatedAt: "2026-04-07T00:00:00.000Z",
        global: {
          projectCount: 1,
          activeProjectCount: 1,
          blockedProjectCount: 0,
          highRiskProjectCount: 0,
          topRisks: [],
          nextActions: []
        },
        projects: [
          {
            id: "project-1",
            workspaceId: "workspace-1",
            name: "项目一",
            repoRoot: "/repo/project-1",
            lifecycleStatus: "active",
            riskLevel: "medium",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 1,
            latestSessionSummary: null,
            latestPatrolSummary: null,
            latestVerificationSummary: "登录验证失败",
            topRisks: [],
            nextActions: [],
            lastActivityAt: "2026-04-07T00:00:00.000Z",
            updatedAt: "2026-04-07T00:00:00.000Z"
          }
        ],
        sessions: [],
        patrols: [],
        verifications: [
          {
            id: "verification-1",
            projectId: "project-1",
            verificationType: "browser",
            status: "failed",
            targetRef: "登录流程",
            summary: "验证码输入后仍然无法登录。",
            startedAt: "2026-04-07T00:01:00.000Z",
            finishedAt: "2026-04-07T00:02:00.000Z",
            createdAt: "2026-04-07T00:00:30.000Z"
          }
        ]
      }
    } as never);
    mockedListButlerFollowUpTasks.mockResolvedValueOnce({
      items: [
        {
          id: "follow-up-1",
          projectId: "project-1",
          projectName: "项目一",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "session-2",
          sessionTitle: "登录页开发",
          objective: "补完验证码流程",
          status: "waiting_user",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-07T00:03:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-07T00:03:00.000Z",
          lastObservedMessageCount: 12,
          lastAutomationSummary: "需要你确认验证码失败后的处理策略。",
          lastAutomationAt: "2026-04-07T00:03:00.000Z",
          autoContinueCount: 1,
          waitingReason: "要不要在失败三次后锁定账号？",
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:03:00.000Z",
          completedAt: null
        }
      ]
    } as never);
    mockedListButlerProjects.mockResolvedValueOnce({
      items: [
        {
          id: "project-1",
          workspaceId: "workspace-1",
          name: "项目一",
          repoRoot: "/repo/project-1",
          lifecycleStatus: "active"
        }
      ]
    } as never);
    mockedListButlerInboxItems.mockResolvedValueOnce({
      items: []
    } as never);

    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
    await findSessionCardByTitle("会话 Alpha");
    expect(screen.queryByRole("button", { name: t("shell.butlerInboxAction") })).toBeNull();

    const notificationButton = await screen.findByRole("button", {
      name: t("shell.globalNotificationsAction")
    });
    expect(notificationButton).toBeInTheDocument();
    expect(
      within(notificationButton).getByLabelText(
        t("shell.globalNotificationsUnreadAria", { count: "2" })
      )
    ).toBeInTheDocument();

    await userEvent.click(notificationButton);

    const notificationDialog = await screen.findByRole("dialog", {
      name: t("shell.globalNotificationsPanelTitle")
    });
    expect(within(notificationDialog).getByText("需要你决定：登录页开发")).toBeInTheDocument();
    expect(within(notificationDialog).getByText("要不要在失败三次后锁定账号？")).toBeInTheDocument();
    expect(within(notificationDialog).getByText("验证失败：登录流程")).toBeInTheDocument();
    expect(within(notificationDialog).getByText("验证码输入后仍然无法登录。")).toBeInTheDocument();

    await userEvent.click(
      within(notificationDialog).getByRole("tab", { name: t("shell.butlerInboxAction") })
    );

    expect(
      within(notificationDialog).getByRole("heading", { name: t("shell.butlerInboxCreateTitle") })
    ).toBeInTheDocument();
    expect(
      within(notificationDialog).getByRole("heading", { name: t("shell.butlerInboxListTitle") })
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: t("shell.butlerInboxModalTitle") })).toBeNull();
  });

  it("会为已完成的会话跟进生成完成通知", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "哆哆"
      }
    } as never);
    mockedGetButlerOverview.mockResolvedValueOnce({
      overview: {
        version: "v1",
        generatedAt: "2026-04-07T00:00:00.000Z",
        global: {
          projectCount: 1,
          activeProjectCount: 1,
          blockedProjectCount: 0,
          highRiskProjectCount: 0,
          topRisks: [],
          nextActions: []
        },
        projects: [
          {
            id: "project-1",
            workspaceId: "workspace-1",
            name: "项目一",
            repoRoot: "/repo/project-1",
            lifecycleStatus: "active",
            riskLevel: "medium",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: null,
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: [],
            nextActions: [],
            lastActivityAt: "2026-04-07T00:00:00.000Z",
            updatedAt: "2026-04-07T00:00:00.000Z"
          }
        ],
        sessions: [],
        patrols: [],
        verifications: []
      }
    } as never);
    mockedListButlerFollowUpTasks.mockResolvedValueOnce({
      items: [
        {
          id: "follow-up-completed-1",
          projectId: "project-1",
          projectName: "项目一",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "session-2",
          sessionTitle: "登录页开发",
          objective: "补完验证码流程",
          status: "completed",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-07T00:03:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-07T00:03:00.000Z",
          lastObservedMessageCount: 12,
          lastAutomationSummary: "登录页目标已完成，跟进自动结束。",
          lastAutomationAt: "2026-04-07T00:03:00.000Z",
          autoContinueCount: 2,
          waitingReason: null,
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:03:00.000Z",
          completedAt: "2026-04-07T00:03:00.000Z"
        }
      ]
    } as never);
    mockedListButlerProjects.mockResolvedValueOnce({
      items: [
        {
          id: "project-1",
          workspaceId: "workspace-1",
          name: "项目一",
          repoRoot: "/repo/project-1",
          lifecycleStatus: "active"
        }
      ]
    } as never);
    mockedListButlerInboxItems.mockResolvedValueOnce({
      items: []
    } as never);

    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
    await findSessionCardByTitle("会话 Alpha");

    const notificationButton = await screen.findByRole("button", {
      name: t("shell.globalNotificationsAction")
    });
    expect(
      within(notificationButton).getByLabelText(
        t("shell.globalNotificationsUnreadAria", { count: "1" })
      )
    ).toBeInTheDocument();

    await userEvent.click(notificationButton);

    const notificationDialog = await screen.findByRole("dialog", {
      name: t("shell.globalNotificationsPanelTitle")
    });
    expect(within(notificationDialog).getByText("跟进完成：登录页开发")).toBeInTheDocument();
    expect(within(notificationDialog).getByText("登录页目标已完成，跟进自动结束。")).toBeInTheDocument();
    expect(within(notificationDialog).getByText(t("shell.globalNotificationKindFollowUpCompleted"))).toBeInTheDocument();
  });

  it("通知归档会走服务端持久化并支持显示已归档通知", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "哆哆"
      }
    } as never);
    mockedGetButlerOverview.mockResolvedValueOnce({
      overview: {
        version: "v1",
        generatedAt: "2026-04-07T00:00:00.000Z",
        global: {
          projectCount: 1,
          activeProjectCount: 1,
          blockedProjectCount: 0,
          highRiskProjectCount: 0,
          topRisks: [],
          nextActions: []
        },
        projects: [
          {
            id: "project-1",
            workspaceId: "workspace-1",
            name: "项目一",
            repoRoot: "/repo/project-1",
            lifecycleStatus: "active",
            riskLevel: "medium",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 1,
            latestSessionSummary: null,
            latestPatrolSummary: null,
            latestVerificationSummary: "登录验证失败",
            topRisks: [],
            nextActions: [],
            lastActivityAt: "2026-04-07T00:00:00.000Z",
            updatedAt: "2026-04-07T00:00:00.000Z"
          }
        ],
        sessions: [],
        patrols: [],
        verifications: [
          {
            id: "verification-1",
            projectId: "project-1",
            verificationType: "browser",
            status: "failed",
            targetRef: "登录流程",
            summary: "验证码输入后仍然无法登录。",
            startedAt: "2026-04-07T00:01:00.000Z",
            finishedAt: "2026-04-07T00:02:00.000Z",
            createdAt: "2026-04-07T00:00:30.000Z"
          }
        ]
      }
    } as never);
    mockedListButlerFollowUpTasks.mockResolvedValueOnce({
      items: [
        {
          id: "follow-up-1",
          projectId: "project-1",
          projectName: "项目一",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "session-2",
          sessionTitle: "登录页开发",
          objective: "补完验证码流程",
          status: "waiting_user",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-07T00:03:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-07T00:03:00.000Z",
          lastObservedMessageCount: 12,
          lastAutomationSummary: "需要你确认验证码失败后的处理策略。",
          lastAutomationAt: "2026-04-07T00:03:00.000Z",
          autoContinueCount: 1,
          waitingReason: "要不要在失败三次后锁定账号？",
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:03:00.000Z",
          completedAt: null
        }
      ]
    } as never);
    mockedListButlerNotificationArchives.mockResolvedValueOnce({
      items: []
    } as never);
    mockedUpdateButlerNotificationArchive
      .mockResolvedValueOnce({
        item: {
          notificationId: "follow-up-waiting:follow-up-1",
          archivedAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z"
        }
      } as never)
      .mockResolvedValueOnce({
        item: null
      } as never);

    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
    await findSessionCardByTitle("会话 Alpha");

    await userEvent.click(
      await screen.findByRole("button", {
        name: t("shell.globalNotificationsAction")
      })
    );

    const notificationDialog = await screen.findByRole("dialog", {
      name: t("shell.globalNotificationsPanelTitle")
    });
    const notificationTitle = "需要你决定：登录页开发";

    expect(within(notificationDialog).getByText(notificationTitle)).toBeInTheDocument();

    const notificationItem = within(notificationDialog)
      .getByText(notificationTitle)
      .closest(".workbench-notification-item");

    expect(notificationItem).not.toBeNull();

    await userEvent.click(
      within(notificationItem as HTMLElement).getByRole("button", {
        name: t("shell.globalNotificationsArchiveAction")
      })
    );

    await waitFor(() => {
      expect(mockedUpdateButlerNotificationArchive).toHaveBeenCalledWith("follow-up-waiting:follow-up-1", true);
      expect(within(notificationDialog).queryByText(notificationTitle)).toBeNull();
    });

    await userEvent.click(
      within(notificationDialog).getByRole("checkbox", {
        name: t("shell.globalNotificationsShowArchived")
      })
    );

    expect(within(notificationDialog).getByText(notificationTitle)).toBeInTheDocument();

    const archivedNotificationItem = within(notificationDialog)
      .getByText(notificationTitle)
      .closest(".workbench-notification-item");

    expect(archivedNotificationItem).not.toBeNull();

    await userEvent.click(
      within(archivedNotificationItem as HTMLElement).getByRole("button", {
        name: t("shell.globalNotificationsRemoveArchiveAction")
      })
    );

    await waitFor(() => {
      expect(mockedUpdateButlerNotificationArchive).toHaveBeenCalledWith("follow-up-waiting:follow-up-1", false);
      expect(
        within(archivedNotificationItem as HTMLElement).getByRole("button", {
          name: t("shell.globalNotificationsArchiveAction")
        })
      ).toBeInTheDocument();
    });
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

    const view = renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
    const shell = view.container.querySelector(".workbench-shell");

    expect(shell?.getAttribute("data-nav-loading")).toBe("false");
    expect(getSessionCardByTitle("缓存会话")).toBeInTheDocument();
    expect(await findWorkspaceGroupByName("项目一")).toBeInTheDocument();
  });
  it("添加项目会打开服务器目录选择器并导入当前目录", async () => {
    let currentSnapshot = createWorkbenchSnapshot([]);

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/workspaces/browse")) {
        const requestUrl = new URL(url);
        const targetPath = requestUrl.searchParams.get("path");

        if (targetPath === "C:/srv/projects/server-app") {
          return createJsonResponse({
            currentPath: "C:/srv/projects/server-app",
            parentPath: "C:/srv/projects",
            roots: [{ path: "C:/", name: "C:\\" }],
            items: []
          });
        }

        return createJsonResponse({
          currentPath: "C:/srv/projects",
          parentPath: "C:/srv",
          roots: [{ path: "C:/", name: "C:\\" }],
          items: []
        });
      }

      if (url.endsWith("/api/workspaces/directories") && init?.method === "POST") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as {
          parentPath?: string;
          directoryName?: string;
        };

        expect(payload).toEqual({
          parentPath: "C:/srv/projects",
          directoryName: "server-app"
        });

        return createJsonResponse(
          {
            path: "C:/srv/projects/server-app",
            name: "server-app"
          },
          201
        );
      }

      if (url.endsWith("/api/workspaces/import") && init?.method === "POST") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { path?: string };
        expect(payload.path).toBe("C:/srv/projects/server-app");

        currentSnapshot = createWorkbenchSnapshot([
          {
            workspace: {
              id: "workspace-imported",
              name: "Server App",
              path: "C:/srv/projects/server-app",
              repoRoot: "C:/srv/projects/server-app"
            },
            sessions: []
          }
        ]);

        return createJsonResponse(
          {
            id: "workspace-imported",
            name: "Server App",
            path: "C:/srv/projects/server-app",
            repoRoot: "C:/srv/projects/server-app"
          },
          201
        );
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute();

    await userEvent.click(await screen.findByRole("button", { name: /添加项目/i }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.importBrowserTitle") });
    expect(within(dialog).getByDisplayValue("C:/srv/projects")).toBeInTheDocument();

    await userEvent.click(
      within(dialog).getByRole("button", { name: t("shell.importBrowserCreateDirectory") })
    );

    const createDialog = await screen.findByRole("dialog", {
      name: t("shell.importBrowserCreateDirectoryTitle")
    });
    await userEvent.type(
      within(createDialog).getByRole("textbox", {
        name: t("shell.importBrowserCreateDirectoryLabel")
      }),
      "server-app"
    );
    await userEvent.click(
      within(createDialog).getByRole("button", {
        name: t("shell.importBrowserCreateDirectorySubmit")
      })
    );

    await waitFor(() => {
      expect(within(dialog).getByDisplayValue("C:/srv/projects/server-app")).toBeInTheDocument();
      expect(within(dialog).getByText("C:/srv/projects/server-app")).toBeInTheDocument();
    });

    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.importBrowserSubmit") }));

    await waitFor(() => {
      expect(screen.getAllByText("Server App").length).toBeGreaterThan(0);
    });
  });
  it("Clone 项目会收集仓库地址、父目录和认证信息后提交给后端", async () => {
    let currentSnapshot = createWorkbenchSnapshot([]);

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/workspaces/browse")) {
        return createJsonResponse({
          currentPath: "C:/srv/projects",
          parentPath: "C:/srv",
          roots: [{ path: "C:/", name: "C:\\" }],
          items: [{ path: "C:/srv/projects/private-app", name: "private-app" }]
        });
      }

      if (url.endsWith("/api/workspaces/clone") && init?.method === "POST") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as {
          repositoryUrl?: string;
          parentPath?: string;
          directoryName?: string;
          auth?: {
            mode?: string;
            username?: string;
            token?: string;
          };
        };

        expect(payload).toMatchObject({
          repositoryUrl: "https://example.com/team/private-app.git",
          parentPath: "C:/srv/projects",
          directoryName: "private-app",
          auth: {
            mode: "token",
            username: "oauth2",
            token: "secret-token"
          }
        });

        currentSnapshot = createWorkbenchSnapshot([
          {
            workspace: {
              id: "workspace-cloned",
              name: "Private App",
              path: "C:/srv/projects/private-app",
              repoRoot: "C:/srv/projects/private-app"
            },
            sessions: []
          }
        ]);

        return createJsonResponse(
          {
            id: "workspace-cloned",
            name: "Private App",
            path: "C:/srv/projects/private-app",
            repoRoot: "C:/srv/projects/private-app"
          },
          201
        );
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute();

    await userEvent.click(await screen.findByRole("button", { name: /Clone项目/i }));

    const cloneDialog = await screen.findByRole("dialog", { name: t("shell.cloneWorkspaceTitle") });

    await userEvent.type(
      within(cloneDialog).getByPlaceholderText("例如：https://github.com/org/repo.git"),
      "https://example.com/team/private-app.git"
    );

    await userEvent.click(within(cloneDialog).getByRole("button", { name: t("shell.clonePickDirectory") }));

    const browserDialog = await screen.findByRole("dialog", { name: t("shell.cloneBrowserTitle") });
    expect(within(browserDialog).getByDisplayValue("C:/srv/projects")).toBeInTheDocument();

    await userEvent.click(within(browserDialog).getByRole("button", { name: t("shell.cloneBrowserSubmit") }));

    await userEvent.type(
      within(cloneDialog).getByPlaceholderText("留空时默认使用仓库名"),
      "private-app"
    );
    await userEvent.selectOptions(within(cloneDialog).getByRole("combobox"), "token");
    await userEvent.type(
      within(cloneDialog).getByPlaceholderText("可选，留空时默认使用 git"),
      "oauth2"
    );
    await userEvent.type(within(cloneDialog).getByPlaceholderText("输入 access token"), "secret-token");

    await userEvent.click(within(cloneDialog).getByRole("button", { name: t("shell.cloneSubmit") }));

    await waitFor(() => {
      expect(screen.getAllByText("Private App").length).toBeGreaterThan(0);
    });
  });

  it("支持展开项目管理详情，并从当前列表软移除项目", async () => {
    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
          })
        ]
      },
      {
        workspace: createWorkspace("workspace-2", "项目二"),
        sessions: []
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    writeViewSnapshot("workspace-management.summary.workspace-1", {
      workspaceId: "workspace-1",
      name: "项目一",
      path: "C:/repo/workspace-1",
      git: {
        isRepository: true,
        repoRoot: "C:/repo/workspace-1",
        currentBranch: "main",
        commitCount: 42,
        remotes: [
          {
            name: "origin",
            url: "https://example.com/team/workspace-1.git"
          }
        ],
        error: null
      },
      codeComposition: {
        scannedFileCount: 18,
        truncated: false,
        error: null,
        items: [
          {
            type: "TypeScript",
            count: 7,
            ratio: 7 / 18
          },
          {
            type: "Markdown",
            count: 3,
            ratio: 3 / 18
          },
          {
            type: "JSON",
            count: 3,
            ratio: 3 / 18
          },
          {
            type: "YAML",
            count: 2,
            ratio: 2 / 18
          },
          {
            type: "CSS",
            count: 2,
            ratio: 2 / 18
          },
          {
            type: "Python",
            count: 1,
            ratio: 1 / 18
          }
        ]
      }
    });

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/workspaces/workspace-1") && init?.method === "DELETE") {
        currentSnapshot = createWorkbenchSnapshot([
          {
            workspace: createWorkspace("workspace-2", "项目二"),
            sessions: []
          }
        ]);
        MockWebSocket.workbenchSnapshot = currentSnapshot;

        return createJsonResponse({
          ...createWorkspace("workspace-1", "项目一"),
          removedAt: "2026-03-26T12:00:00.000Z"
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.manageWorkspaceAction") }));

    const managerDialog = await screen.findByRole("dialog", {
      name: t("shell.manageWorkspaceTitle")
    });

    await userEvent.click(within(managerDialog).getByRole("button", { name: /项目一/ }));

    expect((await within(managerDialog).findAllByText("C:/repo/workspace-1")).length).toBeGreaterThan(0);
    expect(within(managerDialog).getByText("main")).toBeInTheDocument();
    expect(
      within(managerDialog).getByText("origin: https://example.com/team/workspace-1.git")
    ).toBeInTheDocument();
    expect(within(managerDialog).getByText("TypeScript")).toBeInTheDocument();
    expect(within(managerDialog).getByText("Markdown")).toBeInTheDocument();
    expect(within(managerDialog).getByText("JSON")).toBeInTheDocument();
    expect(within(managerDialog).getByText("YAML")).toBeInTheDocument();
    expect(within(managerDialog).getByText("CSS")).toBeInTheDocument();
    expect(within(managerDialog).getByText(t("shell.manageWorkspaceCodeCompositionOther"))).toBeInTheDocument();
    expect(within(managerDialog).queryByText("Python")).not.toBeInTheDocument();
    expect(managerDialog.querySelector(".workbench-manage-type-chart-ring")).not.toBeNull();

    await userEvent.click(
      within(managerDialog).getByRole("button", { name: t("shell.manageWorkspaceRemoveAction") })
    );

    const confirmDialog = await screen.findByRole("dialog", {
      name: t("shell.manageWorkspaceRemoveConfirmTitle")
    });
    expect(within(confirmDialog).getByText(/项目一/)).toBeInTheDocument();

    await userEvent.click(
      within(confirmDialog).getByRole("button", {
        name: t("shell.manageWorkspaceRemoveConfirmAction")
      })
    );

    await waitFor(() => {
      expect(
        within(screen.getByRole("dialog", { name: t("shell.manageWorkspaceTitle") })).queryByText("项目一")
      ).not.toBeInTheDocument();
    });

    expect(screen.getAllByText("项目二").length).toBeGreaterThan(0);
  });

  it("收到空 git 快照并写入缓存后，重新挂载工作台也不会崩溃", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
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

    expect(await findSessionCardByTitle("会话 Alpha")).toBeInTheDocument();

    MockWebSocket.instances[0]?.dispatchMessage({
      type: "git.snapshot",
      snapshot: {
        workspaceId: "workspace-1",
        status: null,
        history: [],
        historyTotalCount: 0,
        historyNextCursor: null,
        branches: null
      }
    });

    await userEvent.click(await screen.findByRole("button", { name: t("shell.manageWorkspaceAction") }));

    const firstManagerDialog = await screen.findByRole("dialog", {
      name: t("shell.manageWorkspaceTitle")
    });

    await userEvent.click(within(firstManagerDialog).getByRole("button", { name: /项目一/ }));

    expect((await within(firstManagerDialog).findAllByText("C:/repo/workspace-1")).length).toBeGreaterThan(0);

    firstView.unmount();

    renderWorkbenchRoute();

    expect(await findSessionCardByTitle("会话 Alpha")).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.manageWorkspaceAction") }));

    const secondManagerDialog = await screen.findByRole("dialog", {
      name: t("shell.manageWorkspaceTitle")
    });

    await userEvent.click(within(secondManagerDialog).getByRole("button", { name: /项目一/ }));

    expect((await within(secondManagerDialog).findAllByText("C:/repo/workspace-1")).length).toBeGreaterThan(0);
  });

  it("支持直接切换到没有会话的项目，并回到空白工作台保留该项目上下文", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
          })
        ]
      },
      {
        workspace: createWorkspace("workspace-2", "这是一个名字很长但暂时没有会话的项目"),
        sessions: []
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    const emptyWorkspaceGroup = await findWorkspaceGroupByName("这是一个名字很长但暂时没有会话的项目");
    const emptyWorkspaceScope = within(emptyWorkspaceGroup);

    await userEvent.click(
      emptyWorkspaceScope.getByRole("button", { name: t("shell.switchWorkspace") })
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/landing");
    });

    expect(window.localStorage.getItem("workbench.workspace.selected.id")).toBe("workspace-2");
    expect(
      emptyWorkspaceScope.getByRole("button", { name: t("shell.switchWorkspace") })
    ).toHaveAttribute("aria-pressed", "true");
    expect(emptyWorkspaceScope.getByText(t("shell.emptyWorkspaceSessions"))).toBeInTheDocument();

    const sourceWorkspaceGroup = await findWorkspaceGroupByName("项目一");
    expect(
      within(sourceWorkspaceGroup).getByRole("button", { name: t("shell.switchWorkspace") })
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("支持工作区会话批量选择，并可部分选择或全选后批量归档", async () => {
    const sessionTitles: Record<string, string> = {
      "session-1": "Session Alpha",
      "session-2": "Session Beta",
      "session-3": "Session Gamma"
    };
    let workbenchFetchCount = 0;
    let archivedSessionIds = new Set<string>();
    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "Project One"),
        sessions: Object.entries(sessionTitles).map(([sessionId, title]) =>
          createSessionSummary({
            sessionId,
            title,
            workspaceId: "workspace-1",
            isArchived: archivedSessionIds.has(sessionId)
          })
        )
      }
    ]);

    function rebuildSnapshot() {
      currentSnapshot = createWorkbenchSnapshot([
        {
          workspace: createWorkspace("workspace-1", "Project One"),
          sessions: Object.entries(sessionTitles).map(([sessionId, title]) =>
            createSessionSummary({
              sessionId,
              title,
              workspaceId: "workspace-1",
              isArchived: archivedSessionIds.has(sessionId)
            })
          )
        }
      ]);
      MockWebSocket.workbenchSnapshot = currentSnapshot;
    }

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        workbenchFetchCount += 1;
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/sessions/") && url.endsWith("/archive")) {
        const sessionId = url.split("/api/sessions/")[1]?.split("/archive")[0];
        const payload = JSON.parse(String(init?.body ?? "{}")) as { archived?: boolean };

        if (!sessionId || !(sessionId in sessionTitles)) {
          throw new Error(`未处理的归档会话: ${url}`);
        }

        if (payload.archived) {
          archivedSessionIds = new Set([...archivedSessionIds, sessionId]);
        } else {
          const nextArchivedSessionIds = new Set(archivedSessionIds);
          nextArchivedSessionIds.delete(sessionId);
          archivedSessionIds = nextArchivedSessionIds;
        }

        rebuildSnapshot();

        return createJsonResponse(
          createSessionSummary({
            sessionId,
            title: sessionTitles[sessionId],
            workspaceId: "workspace-1",
            isArchived: payload.archived === true
          })
        );
      }

      throw new Error(`鏈鐞嗙殑璇锋眰: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    const workspaceGroup = await findWorkspaceGroupByName("Project One");
    const workspaceScope = within(workspaceGroup);

    expect(workspaceScope.getByRole("button", { name: t("shell.createSession") })).toBeInTheDocument();
    expect(workspaceScope.queryByText(t("shell.createSession"))).not.toBeInTheDocument();

    await userEvent.click(workspaceScope.getByRole("button", { name: t("shell.batchSelectSessions") }));

    const alphaCard = await findSessionCardByTitle("Session Alpha");
    await userEvent.click(within(alphaCard).getByText("Session Alpha"));

    expect(workspaceScope.getByText("1/3")).toBeInTheDocument();

    await userEvent.click(workspaceScope.getByRole("button", { name: t("shell.batchArchiveAction") }));

    await waitFor(() => {
      expect(querySessionCardsByTitle("Session Alpha")).toHaveLength(0);
    });
    expect(getSessionCardByTitle("Session Beta")).toBeInTheDocument();
    expect(workspaceScope.getByRole("button", { name: t("shell.selectAllSessions") })).toBeInTheDocument();

    await userEvent.click(workspaceScope.getByRole("button", { name: t("shell.selectAllSessions") }));

    expect(workspaceScope.getByText("2/2")).toBeInTheDocument();

    await userEvent.click(workspaceScope.getByRole("button", { name: t("shell.batchArchiveAction") }));

    await waitFor(() => {
      expect(querySessionCardsByTitle("Session Beta")).toHaveLength(0);
      expect(querySessionCardsByTitle("Session Gamma")).toHaveLength(0);
    });

    expect(archivedSessionIds).toEqual(new Set(Object.keys(sessionTitles)));
    expect(workbenchFetchCount).toBeGreaterThanOrEqual(1);
  });

  it("移动壳不再渲染边缘手柄，会话沉浸态改走底部一级导航", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });

    MockWebSocket.workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "这是一个非常非常长的会话标题",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);

    const view = renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1", {
      shellMode: "mobile"
    });

    expect(await screen.findByRole("button", { name: t("shell.mobileSessionsEntry") })).toBeInTheDocument();
    expect(view.container.querySelector(".mobile-workbench-header")).not.toBeInTheDocument();
    expect(view.container.querySelector(".mobile-sidebar-handle")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.showSessionSidebar") })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.mobileWorkspacesEntry") })).toBeInTheDocument();
    expect(view.container.querySelector(".mobile-nav-drawer.left.open")).not.toBeInTheDocument();
  });

  it("medium 宽度移动壳会把导航面板常驻到主内容旁边", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 820
    });

    MockWebSocket.workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);

    const view = renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1", {
      shellMode: "mobile"
    });

    expect(await screen.findByText("会话 Alpha")).toBeInTheDocument();
    expect(view.container.querySelector(".mobile-adaptive-pane-panel-navigation")).toBeInTheDocument();
    expect(view.container.querySelector(".mobile-nav-drawer.left.open")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.showSessionSidebar") })).not.toBeInTheDocument();
    expect(view.container.querySelector(".mobile-workbench-header")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.mobileSessionsEntry") })).toBeInTheDocument();
  });

  it("移动端从其他页面回到对话入口时，会优先恢复上一次已进入的会话", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });

    MockWebSocket.workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话 Alpha",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);

    window.localStorage.setItem(
      WORKBENCH_NAVIGATION_SNAPSHOT_KEY,
      JSON.stringify({
        value: MockWebSocket.workbenchSnapshot,
        createdAt: Date.now()
      })
    );
    window.localStorage.setItem(
      "workbench.last.session.path",
      "/workspaces/workspace-1/sessions/session-1"
    );

    renderWorkbenchRoute("/workspaces/workspace-1/terminals", {
      shellMode: "mobile"
    });

    await userEvent.click(await screen.findByRole("button", { name: t("shell.mobileSessionsEntry") }));

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe(
        "/workspaces/workspace-1/sessions/session-1"
      );
    });
  });

  it("移动端在失去工作区选中状态后，会退回工作区首页", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });

    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: []
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

    renderWorkbenchRoute("/terminals", {
      shellMode: "mobile"
    });

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/workspaces");
    });
  });

  it("子代理展开按钮保持在会话主按钮上层，避免点击被整行会话按钮吞掉", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "Project One"),
        sessions: [
          createSessionSummary({
            sessionId: "root-session",
            title: "Root Session",
            workspaceId: "workspace-1"
          }),
          createSessionSummary({
            sessionId: "root-subagent-1",
            title: "Subagent 1",
            workspaceId: "workspace-1",
            parentSessionId: "root-session",
            isSubagent: true,
            subagentLabel: "worker · one"
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/root-session");

    const rootSession = await findSessionCardByTitle("Root Session");
    const toggle = within(rootSession).getByRole("button", { name: t("shell.subagentExpand") });
    const link = rootSession.querySelector(".workbench-session-link");

    expect(link).not.toBeNull();
    expect(toggle).toHaveStyle({
      zIndex: "1"
    });
    expect(link as Element).toHaveStyle({
      position: "relative",
      zIndex: "0"
    });

    await userEvent.click(toggle);

    expect(screen.getByText("Subagent 1")).toBeInTheDocument();
  });

  it("后台会话变为 completed_unread 时会立即推送系统通知", async () => {
    const originalNotification = window.Notification;
    const invokeSpy = vi.fn(async (_command?: string, _args?: Record<string, unknown>) => undefined);
    const deniedNotification = class {
      static permission: NotificationPermission = "denied";

      static async requestPermission() {
        return "denied" as const;
      }
    };
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: deniedNotification
    });
    window.__TAURI_INTERNALS__ = {
      invoke: ((command: string, args?: Record<string, unknown>) =>
        invokeSpy(command, args)) as <T>(
        command: string,
        args?: Record<string, unknown>
      ) => Promise<T>
    };

    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "当前会话",
            workspaceId: "workspace-1",
            runningState: "running",
            activityState: "running"
          }),
          createSessionSummary({
            sessionId: "session-2",
            title: "后台会话",
            workspaceId: "workspace-1",
            runningState: "running",
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

      if (url.includes("/permission-requests")) {
        return createJsonResponse({ items: [] });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    try {
      renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
      await findSessionCardByTitle("后台会话");

      currentSnapshot = createWorkbenchSnapshot([
        {
          workspace: createWorkspace("workspace-1", "项目一"),
          sessions: [
            createSessionSummary({
              sessionId: "session-1",
              title: "当前会话",
              workspaceId: "workspace-1",
              runningState: "running",
              activityState: "running"
            }),
            {
              ...createSessionSummary({
                sessionId: "session-2",
                title: "后台会话",
                workspaceId: "workspace-1",
                runningState: "completed",
                activityState: "completed_unread"
              }),
              completedAt: "2026-04-01T08:10:00.000Z"
            }
          ]
        }
      ]);

      MockWebSocket.instances[0]?.dispatchMessage({
        type: "workbench.snapshot",
        snapshot: currentSnapshot
      });

      await waitFor(() => {
        expect(invokeSpy).toHaveBeenCalledWith(
          "show_notification",
          expect.objectContaining({
            title: t("conversation.backgroundCompletionToastTitle"),
            body: t("conversation.backgroundCompletionToastDescription", {
              title: "后台会话"
            })
          })
        );
      });

      await clickOpenSessionToastActionByTitle(t("conversation.backgroundCompletionToastTitle"));
      await waitFor(() => {
        expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-1/sessions/session-2");
      });
    } finally {
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: originalNotification
      });
    }
  });

  it("后台运行会话收到新的权限申请时会推送系统通知", async () => {
    const originalNotification = window.Notification;
    const invokeSpy = vi.fn(async (_command?: string, _args?: Record<string, unknown>) => undefined);
    const deniedNotification = class {
      static permission: NotificationPermission = "denied";

      static async requestPermission() {
        return "denied" as const;
      }
    };
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: deniedNotification
    });
    window.__TAURI_INTERNALS__ = {
      invoke: ((command: string, args?: Record<string, unknown>) =>
        invokeSpy(command, args)) as <T>(
        command: string,
        args?: Record<string, unknown>
      ) => Promise<T>
    };

    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "当前会话",
            workspaceId: "workspace-1",
            runningState: "running",
            activityState: "running"
          }),
          createSessionSummary({
            sessionId: "session-2",
            title: "后台会话",
            workspaceId: "workspace-1",
            runningState: "running",
            activityState: "running"
          })
        ]
      }
    ]);

    let permissionPollCount = 0;
    MockWebSocket.workbenchSnapshot = currentSnapshot;
    writeViewSnapshot(WORKBENCH_NAVIGATION_SNAPSHOT_KEY, currentSnapshot);
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/sessions/session-2/permission-requests")) {
        permissionPollCount += 1;

        if (permissionPollCount === 1) {
          return createJsonResponse({ items: [] });
        }

        return createJsonResponse({
          items: [
            createPermissionRequest({
              id: "permission-1",
              sessionId: "session-2",
              title: "Codex 请求执行命令"
            })
          ]
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    try {
      renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
      await findSessionCardByTitle("后台会话");

      await new Promise((resolve) => {
        window.setTimeout(resolve, 9_000);
      });

      await waitFor(() => {
        expect(invokeSpy).toHaveBeenCalledWith(
          "show_notification",
          expect.objectContaining({
            title: t("conversation.permissionRequestToastTitle"),
            body: t("conversation.backgroundPermissionToastDescription", {
              title: "后台会话",
              requestTitle: "Codex 请求执行命令"
            })
          })
        );
      });

      await clickOpenSessionToastActionByTitle(t("conversation.permissionRequestToastTitle"));
      await waitFor(() => {
        expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-1/sessions/session-2");
      });
    } finally {
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: originalNotification
      });
    }
  }, 20_000);

  it("后台会话从运行中转为失败时会推送系统通知", async () => {
    const originalNotification = window.Notification;
    const invokeSpy = vi.fn(async (_command?: string, _args?: Record<string, unknown>) => undefined);
    const deniedNotification = class {
      static permission: NotificationPermission = "denied";

      static async requestPermission() {
        return "denied" as const;
      }
    };
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: deniedNotification
    });
    window.__TAURI_INTERNALS__ = {
      invoke: ((command: string, args?: Record<string, unknown>) =>
        invokeSpy(command, args)) as <T>(
        command: string,
        args?: Record<string, unknown>
      ) => Promise<T>
    };

    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "当前会话",
            workspaceId: "workspace-1",
            runningState: "running",
            activityState: "running"
          }),
          createSessionSummary({
            sessionId: "session-2",
            title: "后台会话",
            workspaceId: "workspace-1",
            runningState: "running",
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

      if (url.includes("/permission-requests")) {
        return createJsonResponse({ items: [] });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    try {
      renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
      await findSessionCardByTitle("后台会话");

      currentSnapshot = createWorkbenchSnapshot([
        {
          workspace: createWorkspace("workspace-1", "项目一"),
          sessions: [
            createSessionSummary({
              sessionId: "session-1",
              title: "当前会话",
              workspaceId: "workspace-1",
              runningState: "running",
              activityState: "running"
            }),
            createSessionSummary({
              sessionId: "session-2",
              title: "后台会话",
              workspaceId: "workspace-1",
              runningState: "failed",
              activityState: "idle",
              syncStatus: "error",
              lastErrorCode: "CODEX_HTTP_502",
              lastErrorDetail: "unexpected status 502 Bad Gateway"
            })
          ]
        }
      ]);

      MockWebSocket.instances[0]?.dispatchMessage({
        type: "workbench.snapshot",
        snapshot: currentSnapshot
      });

      await waitFor(() => {
        expect(invokeSpy).toHaveBeenCalledWith(
          "show_notification",
          expect.objectContaining({
            title: t("conversation.backgroundFailureToastTitle"),
            body: t("conversation.backgroundFailureToastDescription", {
              title: "后台会话",
              detail: "CODEX_HTTP_502 · unexpected status 502 Bad Gateway"
            })
          })
        );
      });

      await clickOpenSessionToastActionByTitle(t("conversation.backgroundFailureToastTitle"));
      await waitFor(() => {
        expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-1/sessions/session-2");
      });
    } finally {
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: originalNotification
      });
    }
  });

  it("会在侧栏会话列表里直接显示失败错误摘要", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-error",
            title: "失败会话",
            workspaceId: "workspace-1",
            runningState: "failed",
            syncStatus: "error",
            lastErrorCode: "CODEX_HTTP_502",
            lastErrorDetail:
              "unexpected status 502 Bad Gateway: Upstream request failed, request id: demo-request-id"
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-error");

    const sessionCard = await findSessionCardByTitle("失败会话");

    expect(
      within(sessionCard).getByText(
        /CODEX_HTTP_502 · unexpected status 502 Bad Gateway: Upstream request failed/
      )
    ).toBeInTheDocument();
    expect(sessionCard.querySelector(".session-state-indicator.is-error")).not.toBeNull();
  });

  it("支持保存工作区折叠状态，并显示工作区重排入口", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [createSessionSummary({ sessionId: "session-1", title: "会话一", workspaceId: "workspace-1" })],
        collapsed: false
      },
      {
        workspace: createWorkspace("workspace-2", "项目二"),
        sessions: [createSessionSummary({ sessionId: "session-2", title: "会话二", workspaceId: "workspace-2" })],
        collapsed: false
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    const navigationStateBodies: unknown[] = [];
    const reorderBodies: unknown[] = [];
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workspaces/workspace-1/navigation-state") && init?.method === "PUT") {
        navigationStateBodies.push(JSON.parse(String(init.body)));
        return createJsonResponse({
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: true,
          updatedAt: "2026-04-12T10:00:00.000Z"
        });
      }

      if (url.endsWith("/api/workspaces/reorder") && init?.method === "PUT") {
        reorderBodies.push(JSON.parse(String(init.body)));
        return createJsonResponse({
          items: [
            createWorkspace("workspace-2", "项目二"),
            createWorkspace("workspace-1", "项目一")
          ]
        });
      }

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    const view = renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
    const workspaceOneGroup = await findWorkspaceGroupByName("项目一");
    const workspaceTwoGroup = await findWorkspaceGroupByName("项目二");

    await userEvent.click(
      within(workspaceOneGroup).getByRole("button", {
        name: t("shell.workspaceCollapse")
      })
    );

    await waitFor(() => {
      expect(navigationStateBodies).toEqual([
        {
          collapsed: true
        }
      ]);
    });

    expect(
      within(workspaceTwoGroup).getByRole("button", {
        name: t("shell.workspaceCollapse")
      })
    ).toBeInTheDocument();
    expect(reorderBodies).toEqual([]);
    expect(view.container.querySelectorAll(".workbench-workspace-reorder-handle")).toHaveLength(0);
    expect(view.container.querySelectorAll('.workbench-workspace-toggle[draggable="true"]')).toHaveLength(2);
  });

  it("拖拽工作区标题时会临时收起并在松手后保存新的顺序", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [createSessionSummary({ sessionId: "session-1", title: "会话一", workspaceId: "workspace-1" })],
        collapsed: false
      },
      {
        workspace: createWorkspace("workspace-2", "项目二"),
        sessions: [createSessionSummary({ sessionId: "session-2", title: "会话二", workspaceId: "workspace-2" })],
        collapsed: false
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    const reorderBodies: unknown[] = [];
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workspaces/reorder") && init?.method === "PUT") {
        reorderBodies.push(JSON.parse(String(init.body)));
        return createJsonResponse({
          items: [
            createWorkspace("workspace-2", "项目二"),
            createWorkspace("workspace-1", "项目一")
          ]
        });
      }

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    const view = renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
    const workspaceOneGroup = await findWorkspaceGroupByName("项目一");
    const workspaceTwoGroup = await findWorkspaceGroupByName("项目二");
    const workspaceOneToggle = within(workspaceOneGroup).getByRole("button", {
      name: t("shell.workspaceCollapse")
    });
    const dataTransfer = createDragDataTransfer();

    fireEvent.dragStart(workspaceOneToggle, {
      dataTransfer
    });

    await waitFor(() => {
      expect(within(workspaceOneGroup).queryByText("会话一")).toBeNull();
    });

    fireEvent.dragOver(workspaceTwoGroup, {
      dataTransfer,
      clientY: 1
    });

    await waitFor(() => {
      expect(readWorkspaceGroupOrder(view.container)).toEqual(["项目二", "项目一"]);
    });

    fireEvent.drop(workspaceTwoGroup, {
      dataTransfer
    });
    fireEvent.dragEnd(workspaceOneToggle, {
      dataTransfer
    });

    await waitFor(() => {
      expect(reorderBodies).toEqual([
        {
          workspaceIds: ["workspace-2", "workspace-1"]
        }
      ]);
    });

    expect(readWorkspaceGroupOrder(view.container)).toEqual(["项目二", "项目一"]);
  });

  it("拖拽结束时会提交最后一次预览后的工作区顺序", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [],
        collapsed: false
      },
      {
        workspace: createWorkspace("workspace-2", "项目二"),
        sessions: [],
        collapsed: false
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    const reorderBodies: unknown[] = [];
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workspaces/reorder") && init?.method === "PUT") {
        reorderBodies.push(JSON.parse(String(init.body)));
        return createJsonResponse({
          items: [
            createWorkspace("workspace-2", "项目二"),
            createWorkspace("workspace-1", "项目一")
          ]
        });
      }

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
    const workspaceOneGroup = await findWorkspaceGroupByName("项目一");
    const workspaceTwoGroup = await findWorkspaceGroupByName("项目二");
    const workspaceOneToggle = within(workspaceOneGroup).getByRole("button", {
      name: t("shell.workspaceCollapse")
    });
    const dataTransfer = createDragDataTransfer();

    fireEvent.dragStart(workspaceOneToggle, {
      dataTransfer
    });
    fireEvent.dragOver(workspaceTwoGroup, {
      dataTransfer,
      clientY: 1
    });
    fireEvent.dragEnd(workspaceOneToggle, {
      dataTransfer
    });

    await waitFor(() => {
      expect(reorderBodies).toEqual([
        {
          workspaceIds: ["workspace-2", "workspace-1"]
        }
      ]);
    });
  });

  it("重排工作区时会按目标位置生成新的顺序", () => {
    const groups = [
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: []
      },
      {
        workspace: createWorkspace("workspace-2", "项目二"),
        sessions: []
      },
      {
        workspace: createWorkspace("workspace-3", "项目三"),
        sessions: []
      }
    ];

    expect(
      reorderWorkspaceGroups(groups, "workspace-3", "workspace-1", "before").map(
        (group) => group.workspace.id
      )
    ).toEqual(["workspace-3", "workspace-1", "workspace-2"]);
    expect(
      reorderWorkspaceGroups(groups, "workspace-1", "workspace-2", "after").map(
        (group) => group.workspace.id
      )
    ).toEqual(["workspace-2", "workspace-1", "workspace-3"]);
  });
});

function renderWorkbenchRoute(
  initialEntry = "/workspaces/workspace-1/sessions/session-1",
  options?: {
    shellMode?: "desktop" | "mobile";
  }
) {
  const shellMode = options?.shellMode ?? "desktop";

  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<WorkbenchLayout shellMode={shellMode} />}>
            <Route index element={<CurrentLocationProbe />} />
            <Route path="/landing" element={<CurrentLocationProbe />} />
            <Route path="/workspaces" element={<CurrentLocationProbe />} />
            <Route path="/workspaces/:workspaceId" element={<CurrentLocationProbe />} />
            <Route path="/workspaces/:workspaceId/sessions" element={<CurrentLocationProbe />} />
            <Route
              path="/workspaces/:workspaceId/sessions/:sessionId"
              element={<CurrentLocationProbe />}
            />
            <Route path="/workspaces/:workspaceId/terminals" element={<CurrentLocationProbe />} />
            <Route path="/workspaces/:workspaceId/butler" element={<CurrentLocationProbe />} />
            <Route path="/sessions/:sessionId" element={<CurrentLocationProbe />} />
            <Route path="/terminals" element={<CurrentLocationProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

function ButlerAuxiliaryProbe() {
  const { setAuxiliaryPanel } = useWorkbenchShell();

  useEffect(() => {
    setAuxiliaryPanel(
      <div data-testid="butler-right-panel">
        Butler Right Panel
      </div>
    );

    return () => {
      setAuxiliaryPanel(null);
    };
  }, [setAuxiliaryPanel]);

  return <CurrentLocationProbe />;
}

function StartDraftSessionProbe({
  workspaceId,
  provider
}: {
  workspaceId: string;
  provider: "codex" | "claude-code" | "opencode" | "gemini" | "kimi";
}) {
  const { startDraftSession } = useWorkbenchShell();

  return (
    <div>
      <button type="button" onClick={() => startDraftSession(workspaceId, provider)}>
        触发草稿会话
      </button>
      <CurrentLocationProbe />
    </div>
  );
}

async function findSessionCardByTitle(title: string) {
  const titleElements = await screen.findAllByText(title);
  const card = titleElements.find((element) => element.closest(".workbench-session-card"))?.closest(
    ".workbench-session-card"
  );

  if (!(card instanceof HTMLElement)) {
    throw new Error(`未找到会话卡片: ${title}`);
  }

  return card;
}

function getSessionCardByTitle(title: string) {
  const card = screen
    .queryAllByText(title)
    .find((element) => element.closest(".workbench-session-card"))
    ?.closest(".workbench-session-card");

  if (!(card instanceof HTMLElement)) {
    throw new Error(`未找到会话卡片: ${title}`);
  }

  return card;
}

function querySessionCardsByTitle(title: string) {
  return screen
    .queryAllByText(title)
    .map((element) => element.closest(".workbench-session-card"))
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
}

async function findWorkspaceGroupByName(name: string) {
  const matches = await screen.findAllByText(name);
  const group = matches.find((element) => element.closest(".workbench-workspace-group"))?.closest(
    ".workbench-workspace-group"
  );

  if (!(group instanceof HTMLElement)) {
    throw new Error(`未找到工作区分组: ${name}`);
  }

  return group;
}

function readWorkspaceGroupOrder(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".workbench-workspace-group .workbench-workspace-toggle strong"))
    .map((element) => element.textContent?.trim() ?? "")
    .filter((value) => value.length > 0);
}

function createDragDataTransfer() {
  const store = new Map<string, string>();

  return {
    effectAllowed: "move",
    dropEffect: "move",
    setData(type: string, value: string) {
      store.set(type, value);
    },
    getData(type: string) {
      return store.get(type) ?? "";
    }
  };
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
  provider?: "codex" | "claude-code" | "opencode";
  isArchived?: boolean;
  parentSessionId?: string | null;
  forkMethod?:
    | "native_session_fork"
    | "native_message_fork"
    | "reconstructed_session_fork"
    | "reconstructed_message_fork"
    | null;
  forkSourceType?: "session" | "message" | null;
  isSubagent?: boolean;
  subagentLabel?: string | null;
  runningState?: "idle" | "starting" | "running" | "stale" | "unknown" | "completed" | "interrupted" | "failed";
  activitySource?: "none" | "runtime" | "inferred";
  activityResolutionSource?: "authoritative_runtime" | "authoritative_provider_event" | "inferred_log" | "unknown";
  activityState?: "idle" | "running" | "completed_unread";
  isFavorite?: boolean;
  syncStatus?: "idle" | "syncing" | "error";
  lastErrorCode?: string | null;
  lastErrorDetail?: string | null;
}) {
  const provider = input.provider ?? "codex";

  return {
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    provider,
    providerSessionId: `raw-${input.sessionId}`,
    rawStoreRef: `${provider}://${input.sessionId}`,
    isArchived: input.isArchived ?? false,
    isFavorite: input.isFavorite ?? false,
    parentSessionId: input.parentSessionId ?? null,
    forkMethod: input.forkMethod ?? null,
    forkSourceType: input.forkSourceType ?? null,
    forkSourceSessionId: null,
    forkSourceMessageId: null,
    isSubagent: input.isSubagent ?? false,
    subagentLabel: input.subagentLabel ?? null,
    title: input.title,
    messageCount: 1,
    lastMessageAt: "2026-03-24T10:00:00.000Z",
    createdAt: "2026-03-24T09:00:00.000Z",
    updatedAt: "2026-03-24T10:00:00.000Z",
    syncStatus: input.syncStatus ?? "idle",
    syncCursor: "cursor-1",
    lastSyncAt: "2026-03-24T10:00:00.000Z",
    lastErrorCode: input.lastErrorCode ?? null,
    lastErrorDetail: input.lastErrorDetail ?? null,
    resumedAt: null,
    runningState: input.runningState ?? "idle",
    activitySource: input.activitySource ?? "none",
    activityResolutionSource: input.activityResolutionSource,
    lastEventAt: "2026-03-24T10:00:00.000Z",
    completedAt: null,
    lastSeenAt: null,
    activityState: input.activityState ?? "idle"
  };
}

function createWorkbenchSnapshot(items: Array<Record<string, unknown>>) {
  return { items };
}

async function clickOpenSessionToastActionByTitle(title: string) {
  const titleElement = await screen.findByText(title);
  const toastCard = titleElement.closest(".toast-card");

  if (!(toastCard instanceof HTMLElement)) {
    throw new Error(`未找到 toast 卡片: ${title}`);
  }

  const openSessionAction = within(toastCard).getByRole("button", {
    name: t("shell.contextOpenSession")
  });
  await userEvent.click(openSessionAction);
}

function createPermissionRequest(input: {
  id: string;
  sessionId: string;
  title: string;
}) {
  return {
    id: input.id,
    sessionId: input.sessionId,
    provider: "codex",
    providerSessionId: `provider-${input.sessionId}`,
    requestKey: `request-${input.id}`,
    kind: "command",
    status: "pending",
    title: input.title,
    summary: input.title,
    detail: null,
    reason: null,
    toolName: null,
    command: "echo test",
    cwd: "/tmp",
    paths: [],
    permissionProfile: null,
    questions: [],
    actions: [],
    rawPayload: null,
    createdAt: "2026-04-01T08:00:00.000Z",
    updatedAt: "2026-04-01T08:00:00.000Z",
    resolvedAt: null
  };
}

function createUnavailableCapabilities(
  provider: "codex" | "claude-code" | "opencode" | "gemini" | "kimi",
  limitation: string
) {
  return {
    provider,
    canStartSession: false,
    canResumeSession: false,
    canSendMessage: false,
    inRunInputMode: "none",
    supportsSubagents: false,
    supportsInterrupt: false,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: true,
    supportsAttachments: false,
    supportsPermissionPrompt: false,
    supportsCheckpoint: false,
    limitations: [limitation]
  };
}

function createAvailableCapabilities(
  provider: "codex" | "claude-code" | "opencode" | "gemini" | "kimi"
) {
  return {
    provider,
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    inRunInputMode: "none",
    supportsSubagents: false,
    supportsInterrupt: false,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: true,
    supportsAttachments: true,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    limitations: []
  };
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
