import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../auth/store/auth-store";
import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import {
  WorkbenchLayout,
  flattenVisibleSessionTree,
  getTreeNodeChildren,
  getVisibleSessionTreeNodes
} from "./WorkbenchLayout";

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
    window.localStorage.clear();
    window.sessionStorage.clear();
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
      (leftRail as HTMLElement).querySelector(".workbench-window-drag-spacer.collapsed")
    ).toBeNull();
    expect(
      within(rightRail as HTMLElement).getByRole("button", { name: t("shell.showInfoSidebar") })
    ).toBeInTheDocument();
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
            <Route path="/sessions/:sessionId" element={<CurrentLocationProbe />} />
            <Route path="/terminals" element={<CurrentLocationProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>
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
  isSubagent?: boolean;
  subagentLabel?: string | null;
  runningState?: "idle" | "starting" | "running" | "completed" | "interrupted" | "failed";
  activitySource?: "none" | "runtime" | "inferred";
  activityState?: "idle" | "running" | "completed_unread";
  isFavorite?: boolean;
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
