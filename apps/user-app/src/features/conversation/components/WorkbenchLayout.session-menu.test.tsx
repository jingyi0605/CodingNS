import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { authStore } from "../../auth/store/auth-store";
import { clientConfigStore } from "../../../config/client-config-store";
import { localUiPreferenceStore } from "../../../preferences/local-ui-preference-store";
import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import {
  flattenVisibleSessionTree,
  getTreeNodeChildren,
  getVisibleSessionTreeNodes,
  reorderWorkspaceGroups
} from "./WorkbenchLayout";
import {
  ButlerAuxiliaryProbe,
  CurrentLocationProbe,
  MockWebSocket,
  NoSnapshotWebSocket,
  StartDraftSessionProbe,
  WORKBENCH_NAVIGATION_SNAPSHOT_KEY,
  clickOpenSessionToastActionByTitle,
  createAvailableCapabilities,
  createDragDataTransfer,
  createJsonResponse,
  createPermissionRequest,
  createSessionSummary,
  createSkillOverviewResponse,
  createUnavailableCapabilities,
  createWorkbenchSnapshot,
  createWorkbenchWorktreeNode,
  createWorkspace,
  createWorkspaceManagementSummary,
  findSessionCardByTitle,
  findWorkspaceGroupByName,
  getSessionCardByTitle,
  mockAffairsLibraryFetch,
  mockNavigator,
  openFilesExternalWindowMock,
  openGitExternalWindowMock,
  openProcessesExternalWindowMock,
  openSessionCardContextMenu,
  querySessionCardsByTitle,
  readWorkspaceGroupOrder,
  registerWorkbenchLayoutTestHooks,
  renderWorkbenchRoute,
  showDesktopContextMenuMock
} from "./WorkbenchLayout.test-support";

describe("WorkbenchLayout", () => {
  registerWorkbenchLayoutTestHooks();

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
    const subagentCard = getSessionCardByTitle("子代理探索");
    await userEvent.click(within(subagentCard).getByRole("button", { name: t("shell.subagentExpand") }));
    const nestedSubagentTitle = screen.getByText("子代理深挖");
    expect(nestedSubagentTitle).toBeInTheDocument();
    expect(nestedSubagentTitle.closest(".workbench-subsession-list")).not.toBeNull();
    expect(screen.getByText("explorer · Turing")).toBeInTheDocument();

    const betaCard = await findSessionCardByTitle("会话 Beta");

    openSessionCardContextMenu(betaCard);
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

    openSessionCardContextMenu(betaCardAfterReload);
    await userEvent.click(screen.getByRole("button", { name: t("shell.archiveAction") }));

    await waitFor(() => {
      expect(screen.queryAllByText("会话 Beta")).toHaveLength(0);
    });

    const archiveFolders = screen.getAllByRole("button", {
      name: new RegExp(`^${t("shell.archiveFolderLabel")}(?:\\s+\\d+)?$`)
    });
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

  it("归档会话列表会显示子会话，并给子会话加类型标签", async () => {
    const snapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "parent-session",
            title: "已归档父会话",
            workspaceId: "workspace-1",
            isArchived: true
          }),
          createSessionSummary({
            sessionId: "child-subagent",
            title: "已归档子代理",
            workspaceId: "workspace-1",
            parentSessionId: "parent-session",
            isArchived: true,
            isSubagent: true,
            subagentLabel: "worker · Banach"
          }),
          createSessionSummary({
            sessionId: "child-fork",
            title: "已归档消息分叉",
            workspaceId: "workspace-1",
            parentSessionId: "parent-session",
            isArchived: true,
            forkMethod: "native_message_fork",
            forkSourceType: "message"
          })
        ]
      }
    ]);
    MockWebSocket.workbenchSnapshot = snapshot;

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(snapshot);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("codex"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute();

    const archiveFolder = await screen.findByRole("button", {
      name: new RegExp(`^${t("shell.archiveFolderLabel")}(?:\\s+3)?$`)
    });
    await userEvent.click(archiveFolder);

    const dialog = await screen.findByRole("dialog", { name: t("shell.archiveModalTitle") });
    expect(within(dialog).getByText("已归档父会话")).toBeInTheDocument();
    expect(within(dialog).getByText("已归档子代理")).toBeInTheDocument();
    expect(within(dialog).getByText("已归档消息分叉")).toBeInTheDocument();
    expect(within(dialog).getByText("worker · Banach")).toBeInTheDocument();
    expect(within(dialog).getByText(t("shell.sessionForkMessage"))).toBeInTheDocument();
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

    const alphaCard = await findSessionCardByTitle("会话 Alpha");
    openSessionCardContextMenu(alphaCard);
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

  it("会话菜单会跟随右键位置并保持在视口范围内", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "Win32"
    });
    delete window.__TAURI_INTERNALS__;
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

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 720
    });

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    const sessionCard = await findSessionCardByTitle("会话 Alpha");
    openSessionCardContextMenu(sessionCard, {
      x: 1016,
      y: 646
    });
    await screen.findByRole("button", { name: t("shell.renameAction") });

    const menu = await waitForSessionMenu();

    if (!(menu instanceof HTMLElement)) {
      throw new Error("未找到会话操作菜单");
    }

    Object.defineProperty(menu, "offsetWidth", {
      configurable: true,
      get: () => 180
    });
    Object.defineProperty(menu, "offsetHeight", {
      configurable: true,
      get: () => 168
    });

    fireEvent(window, new Event("resize"));

    expect(menu).toHaveStyle({
      position: "fixed"
    });
    expect(menu.style.width).toBe("180px");

    const top = Number.parseFloat(menu.style.top);
    const left = Number.parseFloat(menu.style.left);

    expect(Number.isFinite(top)).toBe(true);
    expect(Number.isFinite(left)).toBe(true);
    expect(top).toBeGreaterThanOrEqual(12);
    expect(left).toBeGreaterThanOrEqual(12);
    expect(top).toBeLessThan(646);
    expect(left).toBeLessThan(1016);
  });

  it("macOS 桌面端会话右键菜单改走原生菜单", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "MacIntel"
    });
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };
    showDesktopContextMenuMock.mockResolvedValue(undefined);

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

    const sessionCard = await findSessionCardByTitle("会话 Alpha");
    openSessionCardContextMenu(sessionCard);

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    expect(showDesktopContextMenuMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: t("shell.renameAction") }),
        expect.objectContaining({
          label: t("conversation.exportAction"),
          items: [
            expect.objectContaining({ label: t("conversation.exportMarkdownAction") }),
            expect.objectContaining({ label: t("conversation.exportPdfAction") }),
            expect.objectContaining({ label: t("conversation.exportHtmlAction") })
          ]
        }),
        expect.objectContaining({ label: t("shell.favoriteAction") }),
        expect.objectContaining({ label: t("shell.archiveAction") }),
        expect.objectContaining({ label: t("shell.deleteSessionAction") })
      ])
    );
    expect(document.querySelector(".workbench-session-menu")).toBeNull();
  });

  it("非移动端自定义会话菜单会显示导出二级菜单", async () => {
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

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900
    });

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    const sessionCard = await findSessionCardByTitle("会话 Alpha");
    openSessionCardContextMenu(sessionCard, { x: 260, y: 220 });

    const exportButton = await screen.findByRole("button", { name: t("conversation.exportAction") });
    await userEvent.click(exportButton);

    expect(screen.getByRole("menuitem", { name: t("conversation.exportMarkdownAction") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("conversation.exportPdfAction") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("conversation.exportHtmlAction") })).toBeInTheDocument();
  });

  it("删除当前工作区会话后会调用真实删除接口并回到会话列表", async () => {
    showDesktopContextMenuMock.mockResolvedValue(undefined);
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "MacIntel"
    });
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };

    const alphaSession = createSessionSummary({
      sessionId: "session-1",
      title: "会话 Alpha",
      workspaceId: "workspace-1"
    });
    const betaSession = createSessionSummary({
      sessionId: "session-2",
      title: "会话 Beta",
      workspaceId: "workspace-1"
    });
    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [alphaSession, betaSession]
      }
    ]);
    const deletedSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [alphaSession]
      }
    ]);
    let deleteRequested = false;

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/sessions/session-2") && init?.method === "DELETE") {
        deleteRequested = true;
        currentSnapshot = deletedSnapshot;
        MockWebSocket.workbenchSnapshot = deletedSnapshot;
        return createJsonResponse({});
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-2");

    const sessionCard = await findSessionCardByTitle("会话 Beta");
    openSessionCardContextMenu(sessionCard);

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] as Array<{
      label: string;
      onSelect: () => void | Promise<void>;
    }>;
    const deleteItem = items.find((item) => item.label === t("shell.deleteSessionAction"));

    expect(deleteItem).toBeTruthy();

    await act(async () => {
      await deleteItem?.onSelect();
    });

    const dialog = await screen.findByRole("dialog", {
      name: t("shell.deleteSessionConfirmTitle")
    });

    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.deleteSessionAction") }));

    await waitFor(() => {
      expect(deleteRequested).toBe(true);
      expect(screen.getByTestId("current-path")).toHaveTextContent("/workspaces/workspace-1/sessions");
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

    openSessionCardContextMenu(sessionCard);
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
});

async function waitForSessionMenu() {
  await waitFor(() => {
    expect(document.querySelector(".workbench-session-menu")).toBeTruthy();
  });

  return document.querySelector(".workbench-session-menu");
}
