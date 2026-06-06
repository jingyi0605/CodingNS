import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { authStore } from "../../auth/store/auth-store";
import { clientConfigStore } from "../../../config/client-config-store";
import { localUiPreferenceStore } from "../../../preferences/local-ui-preference-store";
import { clearViewSnapshot, readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
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
  mockedGetButlerOverview,
  mockedGetButlerProfile,
  mockedListButlerFollowUpTasks,
  mockedListButlerInboxItems,
  mockedListButlerNotificationArchives,
  mockedListButlerProjects,
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

  it("在桌面端工具栏里把 HOST 切换器放在收起按钮和通知按钮之间", async () => {
    renderWorkbenchRoute();

    const collapseButton = await screen.findByRole("button", { name: t("shell.hideSessionSidebar") });
    const toolbarRoot = collapseButton.closest(".workbench-nav-toolbar");

    if (!(toolbarRoot instanceof HTMLElement)) {
      throw new Error("未找到工作台工具栏");
    }

    const orderedLabels = Array.from(toolbarRoot.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label") ?? ""
    );

    expect(orderedLabels.slice(0, 4)).toEqual([
      t("shell.hideSessionSidebar"),
      t("shell.hostSwitcherAriaLabel"),
      t("shell.globalNotificationsAction"),
      t("shell.searchEntry")
    ]);
  });

  it("左侧收起后仍然把 HOST 切换器放在展开按钮和通知按钮之间", async () => {
    const user = userEvent.setup();

    renderWorkbenchRoute();
    await user.click(await screen.findByRole("button", { name: t("shell.hideSessionSidebar") }));

    const collapsedControls = document.querySelector(".workbench-collapsed-controls.left[data-visible='true']");

    if (!(collapsedControls instanceof HTMLElement)) {
      throw new Error("未找到收起态左侧工具栏");
    }

    const orderedLabels = Array.from(collapsedControls.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label") ?? ""
    );

    expect(orderedLabels.slice(0, 4)).toEqual([
      t("shell.showSessionSidebar"),
      t("shell.hostSwitcherAriaLabel"),
      t("shell.globalNotificationsAction"),
      t("shell.searchEntry")
    ]);
  });

  it("macOS 桌面端顶栏区域改回原生 drag region，避免 JS 双击切窗打架", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "MacIntel"
    });
    window.__TAURI_INTERNALS__ = { invoke };

    renderWorkbenchRoute();
    await screen.findByRole("button", { name: t("shell.hideSessionSidebar") });

    const header = document.querySelector(".workbench-nav-header");

    if (!(header instanceof HTMLElement)) {
      throw new Error("未找到左侧标题栏");
    }

    fireEvent.doubleClick(header);

    expect(header).toHaveAttribute("data-tauri-drag-region", "");
    expect(invoke).not.toHaveBeenCalledWith("set_window_state", {
      state: "toggle-zoom"
    });
  });

  it("存在多个 HOST 时会在设置按钮里显示当前 HOST 名称标签", async () => {
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-2",
      hosts: [
        {
          id: "host-1",
          name: "本地 Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin"
        },
        {
          id: "host-2",
          name: "办公室 Host",
          baseUrl: "http://10.10.1.8:3002",
          kind: "lan",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-15T00:00:00.000Z",
          lastUserId: null,
          lastUsername: null
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
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

    const view = renderWorkbenchRoute();
    const settingsButton = view.container.querySelector(".workbench-nav-settings-button");

    if (!(settingsButton instanceof HTMLElement)) {
      throw new Error("未找到设置按钮");
    }

    expect(within(settingsButton).getByText(t("settings.title"))).toBeInTheDocument();
    expect(within(settingsButton).getByText("办公室 Host")).toBeInTheDocument();
  });

  it("旧 HOST 的工作区路由切到新 HOST 后会自动收敛到当前 Host 的可用会话", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-2", "项目二"),
        sessions: [
          createSessionSummary({
            sessionId: "session-2",
            title: "会话 Beta",
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-2/sessions/session-2");
    });
  });

  it("当前工作区存在但路由里的会话不存在时会自动切到该工作区的可用会话", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-1/sessions/session-2");
    });
  });

  it("只有一个 HOST 时设置按钮不显示 HOST 名称标签", async () => {
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "本地 Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin"
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
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

    const view = renderWorkbenchRoute();
    const settingsButton = view.container.querySelector(".workbench-nav-settings-button");

    if (!(settingsButton instanceof HTMLElement)) {
      throw new Error("未找到设置按钮");
    }

    expect(within(settingsButton).getByText(t("settings.title"))).toBeInTheDocument();
    expect(within(settingsButton).queryByText("本地 Host")).not.toBeInTheDocument();
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

  it("会按照本地设置的会话名称顺序显示工作区会话", async () => {
    localUiPreferenceStore.setSessionDisplaySortMode("title");

    const snapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          {
            ...createSessionSummary({
              sessionId: "session-z",
              title: "Zebra",
              workspaceId: "workspace-1"
            }),
            createdAt: "2026-04-12T10:00:00.000Z",
            updatedAt: "2026-04-12T10:00:00.000Z"
          },
          {
            ...createSessionSummary({
              sessionId: "session-a",
              title: "Alpha",
              workspaceId: "workspace-1"
            }),
            createdAt: "2026-04-10T10:00:00.000Z",
            updatedAt: "2026-04-15T10:00:00.000Z"
          },
          {
            ...createSessionSummary({
              sessionId: "session-m",
              title: "Monkey",
              workspaceId: "workspace-1"
            }),
            createdAt: "2026-04-11T10:00:00.000Z",
            updatedAt: "2026-04-11T10:00:00.000Z"
          }
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = snapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(snapshot);
      }

      return createJsonResponse({});
    });

    renderWorkbenchRoute("/workspaces/workspace-1/sessions");

    const workspaceGroup = await findWorkspaceGroupByName("项目一");
    const sessionTitles = Array.from(
      workspaceGroup.querySelectorAll(".workbench-session-card .session-title")
    )
      .map((element) => element.textContent?.trim() ?? "")
      .filter(Boolean);

    expect(sessionTitles.slice(0, 3)).toEqual(["Alpha", "Monkey", "Zebra"]);
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

  it("新建会话弹窗支持先创建子工作区，再选择供应商", async () => {
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
      }
    ]);
    const worktreeBodies: Array<Record<string, unknown>> = [];

    MockWebSocket.workbenchSnapshot = currentSnapshot;

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/git/branches?workspaceId=workspace-1")) {
        return createJsonResponse({
          currentBranch: "main",
          local: [
            { name: "main", current: true, upstream: "origin/main", remote: false },
            { name: "develop", current: false, upstream: "origin/develop", remote: false }
          ],
          remote: [
            { name: "origin/main", current: false, upstream: null, remote: true },
            { name: "origin/release/1.0", current: false, upstream: null, remote: true }
          ]
        });
      }

      if (url.includes("/api/git/tags?workspaceId=workspace-1")) {
        return createJsonResponse([{ name: "v1.0.0" }, { name: "v0.9.0" }]);
      }

      if (url.endsWith("/api/worktrees") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        worktreeBodies.push(payload);

        const childWorkspace = createWorkspace("workspace-1-child", "feat/login-codex");
        currentSnapshot = createWorkbenchSnapshot([
          {
            workspace: createWorkspace("workspace-1", "项目一"),
            sessions: [
              createSessionSummary({
                sessionId: "session-1",
                title: "会话 Alpha",
                workspaceId: "workspace-1"
              })
            ],
            childWorktrees: [
              createWorkbenchWorktreeNode({
                workspace: childWorkspace,
                displayName: "feat/login-codex",
                branchName: "feat/login-codex",
                sessions: []
              })
            ]
          }
        ]);
        MockWebSocket.workbenchSnapshot = currentSnapshot;

        return createJsonResponse({
          workspace: childWorkspace,
          meta: {
            workspaceId: childWorkspace.id,
            rootWorkspaceId: "workspace-1",
            parentWorkspaceId: "workspace-1",
            sourceWorkspaceId: "workspace-1",
            mergeTargetWorkspaceId: "workspace-1",
            branchName: "feat/login-codex",
            baseRef: "main",
            baseCommit: "commit-base",
            headCommit: "commit-head",
            displayName: "feat/login-codex",
            depth: 1,
            lifecycleStatus: "active",
            mergedAt: null,
            removedAt: null,
            createdAt: "2026-04-12T08:00:00.000Z",
            updatedAt: "2026-04-12T08:00:00.000Z"
          }
        }, 201);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("claude-code"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    const workspaceGroup = await findWorkspaceGroupByName("项目一");
    await userEvent.click(within(workspaceGroup).getByRole("button", { name: t("shell.createSession") }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    expect(within(dialog).getByText(t("shell.createSessionProviderLabel"))).toBeInTheDocument();
    expect(within(dialog).queryByText(t("shell.createWorktreeSectionTitle"))).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.createWorktreeAction") }));
    const worktreeDialog = await screen.findByRole("dialog", { name: t("shell.createWorktreeAction") });
    expect(
      within(worktreeDialog).getByText(
        t("shell.createWorktreeBaseRefHint", {
          localCount: 2,
          remoteCount: 2,
          tagCount: 2
        })
      )
    ).toBeInTheDocument();
    await userEvent.click(within(worktreeDialog).getByRole("button", { name: t("shell.createWorktreeHelpAction") }));
    expect(within(worktreeDialog).getByText(t("shell.createWorktreeHelpTitle"))).toBeInTheDocument();
    expect(within(worktreeDialog).getByText(t("shell.createWorktreeHelpBranchBody"))).toBeInTheDocument();
    const baseRefInput = within(worktreeDialog).getByRole("combobox", {
      name: new RegExp(`^${t("shell.createWorktreeBaseRefLabel")}`)
    });
    await userEvent.click(within(worktreeDialog).getByRole("button", { name: t("shell.createWorktreeBaseRefToggle") }));
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText(t("shell.createWorktreeBaseRefLocalGroup"))).toBeInTheDocument();
    expect(within(listbox).getByText(t("shell.createWorktreeBaseRefRemoteGroup"))).toBeInTheDocument();
    expect(within(listbox).getByText(t("shell.createWorktreeBaseRefTagGroup"))).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /^main/ })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "develop" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "origin/main" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "origin/release/1.0" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "v1.0.0" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "v0.9.0" })).toBeInTheDocument();
    expect(within(listbox).getAllByText(t("shell.createWorktreeBaseRefCurrentBadge")).length).toBeGreaterThan(0);
    expect(within(listbox).getAllByText(t("shell.createWorktreeBaseRefRecommendedBadge")).length).toBeGreaterThan(0);
    await userEvent.click(within(listbox).getByRole("option", { name: "origin/main" }));
    expect(await screen.findByRole("dialog", { name: t("shell.createWorktreeAction") })).toBeInTheDocument();
    expect(baseRefInput).toHaveValue("origin/main");
    await userEvent.clear(baseRefInput);
    await userEvent.type(baseRefInput, "v1");
    expect(screen.getByRole("option", { name: "v1.0.0" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^main/ })).not.toBeInTheDocument();
    await userEvent.clear(baseRefInput);
    await userEvent.type(
      within(worktreeDialog).getByRole("textbox", { name: t("shell.createWorktreeBranchLabel") }),
      "feat/login-codex"
    );
    await userEvent.click(
      within(worktreeDialog).getByRole("button", { name: t("shell.createWorktreeSubmit") })
    );

    await waitFor(() => {
      expect(worktreeBodies).toEqual([
        {
          sourceWorkspaceId: "workspace-1",
          branchName: "feat/login-codex"
        }
      ]);
    });

    await waitFor(() => {
      expect(screen.getByText(`${t("shell.createSessionTarget")} · feat/login-codex`)).toBeInTheDocument();
    });
  });

  it("会把并行会话入口放进加号弹窗头部，并排在新增子工作区左侧", async () => {
    const snapshot = createWorkbenchSnapshot([
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

    await renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    const workspaceGroup = await findWorkspaceGroupByName("项目一");
    await userEvent.click(within(workspaceGroup).getByRole("button", { name: t("shell.createSession") }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    const headerActions = dialog.querySelector(".workbench-modal-header-actions");

    if (!(headerActions instanceof HTMLElement)) {
      throw new Error("未找到新建会话弹窗头部操作区");
    }

    const actionButtons = within(headerActions).getAllByRole("button");
    expect(actionButtons[0]).toHaveTextContent(t("shell.parallelCreateAction"));
    expect(actionButtons[1]).toHaveTextContent(t("shell.createWorktreeAction"));

    await userEvent.click(within(headerActions).getByRole("button", { name: t("shell.parallelCreateAction") }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.createSessionModalTitle") })).not.toBeInTheDocument();
    });
    expect(await screen.findByRole("dialog", { name: t("shell.parallelCreateModalTitle") })).toBeInTheDocument();
  });

  it("新增子工作区时会拦截不符合推荐格式的分支名", async () => {
    const worktreeBodies: Array<Record<string, unknown>> = [];
    const snapshot = createWorkbenchSnapshot([
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

    MockWebSocket.workbenchSnapshot = snapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(snapshot);
      }

      if (url.includes("/api/git/branches?workspaceId=workspace-1")) {
        return createJsonResponse({
          currentBranch: "main",
          local: [{ name: "main", current: true, upstream: "origin/main", remote: false }],
          remote: [{ name: "origin/main", current: false, upstream: null, remote: true }]
        });
      }

      if (url.includes("/api/git/tags?workspaceId=workspace-1")) {
        return createJsonResponse([{ name: "v1.0.0" }]);
      }

      if (url.endsWith("/api/worktrees") && init?.method === "POST") {
        worktreeBodies.push(JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>);
        return createJsonResponse({}, 201);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("claude-code"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    const workspaceGroup = await findWorkspaceGroupByName("项目一");
    await userEvent.click(within(workspaceGroup).getByRole("button", { name: t("shell.createSession") }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.createWorktreeAction") }));

    const worktreeDialog = await screen.findByRole("dialog", { name: t("shell.createWorktreeAction") });
    const branchInput = within(worktreeDialog).getByRole("textbox", {
      name: t("shell.createWorktreeBranchLabel")
    });

    await userEvent.type(branchInput, "feat/登录");
    expect(branchInput).toHaveValue("feat/");

    await userEvent.click(
      within(worktreeDialog).getByRole("button", { name: t("shell.createWorktreeSubmit") })
    );

    expect(worktreeBodies).toEqual([]);
    expect(await screen.findByText(t("shell.createWorktreeBranchInvalid"))).toBeInTheDocument();
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
    expect(navHeader).toHaveAttribute("data-tauri-drag-region", "");
    expect(navToolbar).toHaveAttribute("data-tauri-drag-region", "");
    expect(navBody).not.toHaveAttribute("data-tauri-drag-region");
    expect(navSegment).not.toHaveAttribute("data-tauri-drag-region");
    expect(auxiliaryHeader).toHaveAttribute("data-tauri-drag-region", "");
    expect(infoTabs).toHaveAttribute("data-tauri-drag-region", "");
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

  it("活动工作区短暂丢失时，文件面板继续保留上一次有效工作区", async () => {
    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "会话一",
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

    await user.click(await screen.findByRole("tab", { name: t("shell.filesEntry") }));

    await waitFor(() => {
      expect(screen.getByTestId("file-context-panel")).toBeInTheDocument();
    });

    currentSnapshot = createWorkbenchSnapshot([]);
    MockWebSocket.instances[0]?.dispatchMessage({
      type: "workbench.snapshot",
      snapshot: currentSnapshot
    });

    await waitFor(() => {
      expect(screen.getByTestId("file-context-panel")).toBeInTheDocument();
    });

    expect(screen.queryByText(t("shell.filesPanelEmpty"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("conversation.filePanelNoWorkspace"))).not.toBeInTheDocument();
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

    const archiveFolder = await screen.findByRole("button", { name: t("shell.archiveFolderLabel") });
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

  it("对话页侧边会显示父会话已归档的普通分支会话", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "Project One"),
        sessions: [
          createSessionSummary({
            sessionId: "archived-root",
            title: "已归档父会话",
            workspaceId: "workspace-1",
            isArchived: true
          }),
          createSessionSummary({
            sessionId: "orphan-fork",
            title: "普通分支会话",
            workspaceId: "workspace-1",
            parentSessionId: "archived-root",
            isSubagent: false,
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

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/orphan-fork");

    await screen.findByText("普通分支会话");

    expect(screen.getByText("普通分支会话")).toBeInTheDocument();
  });

  it("搜索按钮不会抢占页面焦点，并支持统一搜索分组展示会话和代码结果", async () => {
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

      if (url.includes("/api/files/search?workspaceId=workspace-1")) {
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

      if (url.includes("/api/files/search?workspaceId=workspace-2")) {
        return createJsonResponse({
          items: [],
          total: 0,
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
    await userEvent.click(within(searchDialog).getByRole("button", { name: t("shell.searchActionCode") }));
    const sessionButton = await waitFor(() => {
      const buttons = within(searchDialog).getAllByRole("button");
      const matched = buttons.find((button) => button.textContent?.includes("搜索目标会话"));
      expect(matched).toBeDefined();
      return matched as HTMLElement;
    });
    await userEvent.click(sessionButton);

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe(
        "/workspaces/workspace-2/sessions/session-2"
      );
    });

    await userEvent.click(screen.getAllByRole("button", { name: t("shell.searchEntry") })[0]);
    const reopenedDialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    expect(within(reopenedDialog).getByRole("textbox")).toHaveValue("搜索目标");
    const preservedSessionButton = within(reopenedDialog)
      .getAllByRole("button")
      .find((button) => button.textContent?.includes("搜索目标会话"));
    expect(preservedSessionButton).toBeDefined();
    await userEvent.click(within(reopenedDialog).getByRole("button", { name: t("shell.searchClearAction") }));
    const codeInput = within(reopenedDialog).getByRole("textbox");
    expect(codeInput).toHaveValue("");
    await userEvent.type(codeInput, "SearchPanel components");
    await userEvent.click(within(reopenedDialog).getByRole("button", { name: t("shell.searchActionCode") }));

    expect((await within(reopenedDialog).findAllByText(t("shell.searchCodeGroup"))).length).toBeGreaterThan(0);
    const codeButtons = await waitFor(() =>
      within(reopenedDialog).getAllByRole("button").filter((button) =>
        button.textContent?.includes("SearchPanel.tsx")
      )
    );
    expect(codeButtons[0]?.textContent).toContain("SearchPanel.tsx");
    expect(codeButtons[0]?.textContent).toContain("项目一 · src/components/SearchPanel.tsx");
  });

  it("统一搜索遇到卡住的接口时不会一直停在正在搜索", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "中电投会话",
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

      if (
        url.includes("/api/files/search?")
        || url.includes("/affairs/library-snapshot")
        || url.includes("/affairs/library-documents")
        || url.includes("/affairs/lightweight-sessions")
        || url.includes("/affairs/assistant-sessions")
        || url.includes("/api/butler/inbox")
        || url.includes("/api/butler/follow-up-tasks")
      ) {
        return new Promise<Response>(() => {});
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    const searchButton = await screen.findByRole("button", { name: t("shell.searchEntry") });
    fireEvent.click(searchButton);

    const dialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "中电投" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("shell.searchActionCode") }));

    expect(await within(dialog).findByText(t("shell.searchLoading"))).toBeInTheDocument();
    await waitFor(() => {
      const buttons = within(dialog).getAllByRole("button");
      expect(buttons.some((button) => button.textContent?.includes("中电投会话"))).toBe(true);
    });

    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 6500);
      });
    });

    await waitFor(() => {
      expect(within(dialog).queryByText(t("shell.searchLoading"))).toBeNull();
    });

    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.some((button) => button.textContent?.includes("中电投会话"))).toBe(true);
  }, 15000);

  it("事务模式会默认打开事务搜索，并支持跳到文档、标签、对话和代办", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue(undefined)
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "本地 Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin"
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
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
    mockedGetButlerProfile.mockResolvedValue({
      initialized: true,
      affairsSetupCompleted: true,
      profile: {
        id: "butler-profile-1",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/workspace-1",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: {
          tone: "direct",
          language: "zh-CN",
          summaryStyle: "brief"
        },
        focus: {
          projectIds: [],
          riskPreference: "conservative",
          reportPriority: [],
          summaryDebounceSeconds: 300
        },
        setupCompleted: true,
        initializedAt: "2026-06-05T08:00:00.000Z",
        updatedAt: "2026-06-05T08:00:00.000Z"
      }
    } as never);
    mockedGetButlerOverview.mockResolvedValue({
      overview: {
        version: "v1",
        generatedAt: "2026-06-05T08:00:00.000Z",
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
    mockAffairsLibraryFetch();
    mockedListButlerInboxItems.mockResolvedValue({
      items: [
        {
          id: "todo-1",
          projectId: "project-1",
          workspaceId: "workspace-1",
          projectName: "项目一",
          projectLifecycleStatus: "active",
          itemType: "task",
          title: "补齐合同回访",
          content: "今天继续整理合同回访记录。",
          priority: "medium",
          status: "pending",
          assistantState: {
            lifecycleStage: "pending",
            analysisSummary: null,
            generatedPrompt: null,
            analysisControlSessionId: null,
            analysisSessionId: null,
            linkedButlerSessionId: null,
            linkedSessionId: null,
            linkedFollowUpTaskId: null,
            lastError: null,
            lastAnalyzedAt: null,
            lastSessionCreatedAt: null,
            lastFollowUpAt: null
          },
          createdAt: "2026-06-05T08:00:00.000Z",
          updatedAt: "2026-06-05T08:00:00.000Z",
          closedAt: null
        }
      ]
    } as never);
    mockedListButlerFollowUpTasks.mockResolvedValue({
      items: [
        {
          id: "follow-up-1",
          projectId: "project-1",
          projectName: "项目一",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "agent-session-1",
          sessionTitle: "事务 Agent 对话",
          objective: "继续跟进客户回访",
          status: "waiting_user",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-06-05T08:00:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-06-05T08:00:00.000Z",
          lastObservedMessageCount: 5,
          lastAutomationSummary: "等待你确认下一步回访时间。",
          lastAutomationAt: "2026-06-05T08:00:00.000Z",
          autoContinueCount: 1,
          waitingReason: "要不要改成下周一回访？",
          createdAt: "2026-06-05T08:00:00.000Z",
          updatedAt: "2026-06-05T08:00:00.000Z",
          completedAt: null
        }
      ]
    } as never);

    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "代码会话",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);
    MockWebSocket.workbenchSnapshot = currentSnapshot;
    const affairsFetch = global.fetch;
    const butlerProfileResponse = {
      initialized: true,
      affairsSetupCompleted: true,
      profile: {
        id: "butler-profile-1",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/workspace-1",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: {
          tone: "direct",
          language: "zh-CN",
          summaryStyle: "brief"
        },
        focus: {
          projectIds: [],
          riskPreference: "conservative",
          reportPriority: [],
          summaryDebounceSeconds: 300
        },
        setupCompleted: true,
        initializedAt: "2026-06-05T08:00:00.000Z",
        updatedAt: "2026-06-05T08:00:00.000Z"
      }
    };
    const butlerOverviewResponse = {
      overview: {
        version: "v1",
        generatedAt: "2026-06-05T08:00:00.000Z",
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
    };
    const butlerInboxResponse = {
      items: [
        {
          id: "todo-1",
          projectId: "project-1",
          workspaceId: "workspace-1",
          projectName: "项目一",
          projectLifecycleStatus: "active",
          itemType: "task",
          title: "补齐合同回访",
          content: "今天继续整理合同回访记录。",
          priority: "medium",
          status: "pending",
          assistantState: {
            lifecycleStage: "pending",
            analysisSummary: null,
            generatedPrompt: null,
            analysisControlSessionId: null,
            analysisSessionId: null,
            linkedButlerSessionId: null,
            linkedSessionId: null,
            linkedFollowUpTaskId: null,
            lastError: null,
            lastAnalyzedAt: null,
            lastSessionCreatedAt: null,
            lastFollowUpAt: null
          },
          createdAt: "2026-06-05T08:00:00.000Z",
          updatedAt: "2026-06-05T08:00:00.000Z",
          closedAt: null
        }
      ]
    };
    const butlerFollowUpResponse = {
      items: [
        {
          id: "follow-up-1",
          projectId: "project-1",
          projectName: "项目一",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "agent-session-1",
          sessionTitle: "事务 Agent 对话",
          objective: "继续跟进客户回访",
          status: "waiting_user",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-06-05T08:00:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-06-05T08:00:00.000Z",
          lastObservedMessageCount: 5,
          lastAutomationSummary: "等待你确认下一步回访时间。",
          lastAutomationAt: "2026-06-05T08:00:00.000Z",
          autoContinueCount: 1,
          waitingReason: "要不要改成下周一回访？",
          createdAt: "2026-06-05T08:00:00.000Z",
          updatedAt: "2026-06-05T08:00:00.000Z",
          completedAt: null
        }
      ]
    };
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/butler/profile")) {
        return createJsonResponse(butlerProfileResponse);
      }

      if (url.endsWith("/api/butler/overview")) {
        return createJsonResponse(butlerOverviewResponse);
      }

      if (url.includes("/api/butler/inbox")) {
        return createJsonResponse(butlerInboxResponse);
      }

      if (url.includes("/api/butler/follow-up-tasks")) {
        return createJsonResponse(butlerFollowUpResponse);
      }

      if (url.endsWith("/api/butler/notifications/archives")) {
        return createJsonResponse({ items: [] });
      }

      return affairsFetch(rawInput);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/affairs");
    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-1/affairs");
    });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    const dialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });

    const input = within(dialog).getByRole("textbox");
    await user.type(input, "跟进");
    await user.click(within(dialog).getByRole("button", { name: t("shell.searchActionAffairs") }));

    const documentButton = await waitFor(() => {
      const buttons = within(dialog).getAllByRole("button");
      const matched = buttons.find((button) => button.textContent?.includes("跟进记录"));
      expect(matched).toBeDefined();
      return matched as HTMLElement;
    });
    expect(documentButton.textContent).toContain("跟进记录");

    await user.click(documentButton);
    const previewDialog = await screen.findByRole("dialog", { name: /跟进记录/ });
    expect(previewDialog).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: t("shell.searchModalTitle") })).toBeInTheDocument();
    await user.click(within(previewDialog).getByRole("button", { name: t("common.close") }));

    const locateDialog = screen.getByRole("dialog", { name: t("shell.searchModalTitle") });
    const locateButton = await within(locateDialog).findByRole("button", { name: t("shell.searchResultLocateDocumentTitle") });
    await user.click(locateButton);
    await waitFor(() => {
      const documentState = readViewSnapshot<any>("workbench.affairs.state.workspace-1");
      expect(documentState.selectedDocumentId).toBe("doc-1");
      expect(documentState.selectedFolderPath).toBe("客户资料");
      expect(documentState.pendingLibraryPreview).toBeNull();
    });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const tagDialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    await user.click(within(tagDialog).getByRole("button", { name: t("shell.searchClearAction") }));
    await user.type(within(tagDialog).getByRole("textbox"), "重要");
    await user.click(within(tagDialog).getByRole("button", { name: t("shell.searchActionAffairs") }));
    const tagButton = await waitFor(() => {
      const buttons = within(tagDialog).getAllByRole("button");
      const matched = buttons.find((button) => button.textContent?.includes("重要"));
      expect(matched).toBeDefined();
      return matched as HTMLElement;
    });
    expect(tagButton.textContent).toContain("重要");
    await user.click(tagButton);
    await waitFor(() => {
      const tagState = readViewSnapshot<any>("workbench.affairs.state.workspace-1");
      expect(tagState.selectedTagPath).toBe("客户/重要");
      expect(tagState.selectedNodeId).toBe("library:tag:客户/重要");
    });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const conversationDialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    await user.click(within(conversationDialog).getByRole("button", { name: t("shell.searchClearAction") }));
    await user.type(within(conversationDialog).getByRole("textbox"), "Agent");
    await user.click(within(conversationDialog).getByRole("button", { name: t("shell.searchActionAffairs") }));
    const conversationGroupTitle = await within(conversationDialog).findByText(t("shell.searchAffairsConversationsGroup"));
    const conversationGroup = conversationGroupTitle.closest(".workbench-search-result-group");
    if (!(conversationGroup instanceof HTMLElement)) {
      throw new Error("未找到事务搜索的对话结果分组");
    }
    const conversationButton = await waitFor(() => {
      const buttons = within(conversationGroup).getAllByRole("button");
      const matched = buttons.find((button) => button.textContent?.includes("事务 Agent 对话"));
      expect(matched).toBeDefined();
      return matched as HTMLElement;
    });
    expect(conversationButton.textContent).toContain("事务 Agent 对话");
    await user.click(conversationButton);
    await waitFor(() => {
      const conversationState = readViewSnapshot<any>("workbench.affairs.state.workspace-1");
      expect(conversationState.primarySection).toBe("conversation");
      expect(conversationState.selectedNodeId).toBe("conversation:agent:session:agent-session-1");
    });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const todoDialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    await user.click(within(todoDialog).getByRole("button", { name: t("shell.searchClearAction") }));
    await user.type(within(todoDialog).getByRole("textbox"), "合同");
    await user.click(within(todoDialog).getByRole("button", { name: t("shell.searchActionAffairs") }));
    const todoButton = await waitFor(() => {
      const buttons = within(todoDialog).getAllByRole("button");
      const matched = buttons.find((button) => button.textContent?.includes("补齐合同回访"));
      expect(matched).toBeDefined();
      return matched as HTMLElement;
    });
    expect(todoButton.textContent).toContain("补齐合同回访");
    await user.click(todoButton);
    await waitFor(() => {
      const todoState = readViewSnapshot<any>("workbench.affairs.state.workspace-1");
      expect(todoState.primarySection).toBe("workbench");
      expect(todoState.selectedNodeId).toBe("workbench:todo:inbox");
      expect(todoState.selectedObjectId).toBe("inbox:todo-1");
    });
  });

  it("事务模式全局搜索会覆盖所有事务工作区文档，并且不会触发代码搜索", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue(undefined)
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "本地 Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin"
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
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

    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "事务入口会话",
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

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/workspaces")) {
        return createJsonResponse({
          items: [
            createWorkspace("workspace-1", "项目一"),
            createWorkspace("workspace-2", "项目二")
          ]
        });
      }

      if (url.includes("/api/files/search?")) {
        throw new Error(`事务模式不应该触发代码搜索: ${url}`);
      }

      if (url.includes("/api/workspaces/workspace-1/affairs/library-snapshot")) {
        return createJsonResponse({
          binding: null,
          status: {
            state: "idle",
            dirtyReasons: [],
            lastRequestedAt: null,
            lastStartedAt: null,
            lastCompletedAt: null,
            lastFailedAt: null,
            nextAllowedAt: null,
            runningTaskId: null,
            errorSummary: null
          },
          tags: [],
          favorites: [],
          folders: [],
          documentCount: 0,
          lastError: null
        });
      }

      if (url.includes("/api/workspaces/workspace-2/affairs/library-snapshot")) {
        return createJsonResponse({
          binding: {
            workspaceId: "workspace-2",
            rootDir: "/Users/jackson/WorkFile/affairs-2",
            enabled: true,
            configRelativePath: ".ai-index/doc-semantic-index.config.json",
            exportMode: "v2",
            updatedAt: "2026-06-05T08:00:00.000Z"
          },
          status: {
            state: "fresh",
            dirtyReasons: [],
            lastRequestedAt: null,
            lastStartedAt: null,
            lastCompletedAt: "2026-06-05T08:00:00.000Z",
            lastFailedAt: null,
            nextAllowedAt: null,
            runningTaskId: null,
            errorSummary: null
          },
          tags: [],
          favorites: [],
          folders: [],
          documentCount: 1,
          lastError: null
        });
      }

      if (url.includes("/api/workspaces/workspace-1/affairs/library-documents")) {
        return createJsonResponse({
          total: 0,
          offset: 0,
          limit: 12,
          items: []
        });
      }

      if (url.includes("/api/workspaces/workspace-2/affairs/library-documents")) {
        const parsedUrl = new URL(url, "https://codingns.local");
        const keyword = parsedUrl.searchParams.get("keyword");
        const matched = keyword?.includes("预算");

        return createJsonResponse({
          total: matched ? 1 : 0,
          offset: 0,
          limit: 12,
          items: matched
            ? [
              {
                documentId: "doc-2",
                path: "客户资料/预算汇总.md",
                title: "预算汇总",
                summary: "事务预算汇总",
                updatedAt: "2026-06-05T08:00:00.000Z",
                tags: [],
                derivedTags: [],
                isFavorite: false
              }
            ]
            : []
        });
      }

      if (url.includes("/affairs/lightweight-sessions")) {
        return createJsonResponse({ items: [] });
      }

      if (url.includes("/affairs/assistant-sessions")) {
        return createJsonResponse({
          item: {
            projectId: "project-2",
            projectWorkspaceId: "workspace-1",
            agentWorkspacePath: "/tmp/workspace-1",
            sessions: [
              createSessionSummary({
                sessionId: "agent-session-1",
                title: "事务 Agent 对话",
                workspaceId: "workspace-1"
              })
            ],
            updatedAt: "2026-06-05T08:00:00.000Z"
          }
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/affairs");
    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-1/affairs");
    });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    await user.type(within(dialog).getByRole("textbox"), "预算");
    await user.click(within(dialog).getByRole("button", { name: t("shell.searchActionAffairs") }));

    const documentButton = await waitFor(() => {
      const buttons = within(dialog).getAllByRole("button");
      const matched = buttons.find((button) => button.textContent?.includes("预算汇总"));
      expect(matched).toBeDefined();
      return matched as HTMLElement;
    });
    expect(documentButton.textContent).toContain("预算汇总");
    expect(documentButton.textContent).toContain("affairs-2 · 客户资料/预算汇总.md");
    expect(documentButton.textContent).not.toContain("项目二 ·");
    expect(within(dialog).queryByText(t("shell.searchCodeFailed"))).toBeNull();
  });

  it("事务模式搜索同一文档库时不会按工作区重复展示同一份文档", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue(undefined)
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "本地 Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin"
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
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

    const currentSnapshot = createWorkbenchSnapshot([
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
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/workspaces")) {
        return createJsonResponse({
          items: [
            createWorkspace("workspace-1", "项目一"),
            createWorkspace("workspace-2", "项目二"),
            createWorkspace("workspace-3", "项目三")
          ]
        });
      }

      if (url.includes("/api/workspaces/") && url.includes("/affairs/library-snapshot")) {
        return createJsonResponse({
          binding: {
            workspaceId: "workspace-1",
            rootDir: "/Users/jackson/WorkFile/售前文档",
            enabled: true,
            configRelativePath: ".ai-index/doc-semantic-index.config.json",
            exportMode: "v2",
            updatedAt: "2026-06-05T08:00:00.000Z"
          },
          status: {
            state: "fresh",
            dirtyReasons: [],
            lastRequestedAt: null,
            lastStartedAt: null,
            lastCompletedAt: "2026-06-05T08:00:00.000Z",
            lastFailedAt: null,
            nextAllowedAt: null,
            runningTaskId: null,
            errorSummary: null
          },
          tags: [],
          favorites: [],
          folders: [],
          documentCount: 1,
          lastError: null
        });
      }

      if (url.includes("/api/workspaces/") && url.includes("/affairs/library-documents")) {
        const workspaceMatch = url.match(/\/api\/workspaces\/([^/]+)\/affairs\/library-documents/);
        const workspaceSuffix = workspaceMatch?.[1] ?? "workspace";
        return createJsonResponse({
          total: 1,
          offset: 0,
          limit: 12,
          items: [
            {
              documentId: `doc-${workspaceSuffix}`,
              path: "S-上海能科/工程进度款申请-质保金（5%）.pdf",
              title: "工程进度款申请-质保金（5%）",
              summary: "付款条件为上海能科项目本期工程进度款，本页用于说明质保金扣留规则。",
              updatedAt: "2026-06-05T08:00:00.000Z",
              tags: [],
              derivedTags: [],
              isFavorite: false
            }
          ]
        });
      }

      if (url.includes("/affairs/lightweight-sessions")) {
        return createJsonResponse({ items: [] });
      }

      if (url.includes("/affairs/assistant-sessions")) {
        return createJsonResponse({
          item: {
            projectId: null,
            projectWorkspaceId: null,
            agentWorkspacePath: null,
            sessions: [],
            updatedAt: "2026-06-05T08:00:00.000Z"
          }
        });
      }

      if (url.includes("/api/butler/inbox")) {
        return createJsonResponse({ items: [] });
      }

      if (url.includes("/api/butler/follow-up-tasks")) {
        return createJsonResponse({ items: [] });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/affairs");
    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-1/affairs");
    });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    await user.type(within(dialog).getByRole("textbox"), "上海能科");
    await user.click(within(dialog).getByRole("button", { name: t("shell.searchActionAffairs") }));

    const buttons = await waitFor(() =>
      within(dialog).getAllByRole("button").filter((button) =>
        button.textContent?.includes("工程进度款申请-质保金（5%）")
      )
    );

    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain("售前文档 · S-上海能科/工程进度款申请-质保金（5%）.pdf");
    expect(buttons[0]?.textContent).not.toContain("项目一 ·");
    expect(buttons[0]?.textContent).not.toContain("项目二 ·");
    expect(buttons[0]?.textContent).not.toContain("项目三 ·");
  });

  it("事务模式搜索会显示当前排序方式，并支持切换文档排序", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue(undefined)
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "本地 Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin"
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
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

      if (url.endsWith("/api/workspaces")) {
        return createJsonResponse({
          items: [createWorkspace("workspace-1", "项目一")]
        });
      }

      if (url.includes("/api/workspaces/workspace-1/affairs/library-snapshot")) {
        return createJsonResponse({
          binding: {
            workspaceId: "workspace-1",
            rootDir: "/Users/jackson/WorkFile/售前文档",
            enabled: true,
            configRelativePath: ".ai-index/doc-semantic-index.config.json",
            exportMode: "v2",
            updatedAt: "2026-06-05T08:00:00.000Z"
          },
          status: {
            state: "fresh",
            dirtyReasons: [],
            lastRequestedAt: null,
            lastStartedAt: null,
            lastCompletedAt: "2026-06-05T08:00:00.000Z",
            lastFailedAt: null,
            nextAllowedAt: null,
            runningTaskId: null,
            errorSummary: null
          },
          tags: [],
          favorites: [],
          folders: [],
          documentCount: 2,
          lastError: null
        });
      }

      if (url.includes("/api/workspaces/workspace-1/affairs/library-documents")) {
        return createJsonResponse({
          total: 2,
          offset: 0,
          limit: 12,
          items: [
            {
              documentId: "doc-relevance-first",
              path: "S-上海能科/上海能科云桌面运维服务合同谈判记录表.docx",
              title: "上海能科云桌面运维服务合同谈判记录表",
              summary: "这里记录上海能科云桌面运维服务合同的谈判过程和关键条款。",
              updatedAt: "2026-06-01T08:00:00.000Z",
              tags: [],
              derivedTags: [],
              isFavorite: false
            },
            {
              documentId: "doc-updated-first",
              path: "S-上海能科/合同纪要.docx",
              title: "合同纪要",
              summary: "上海能科合同纪要的最新版本，包含近期更新内容。",
              updatedAt: "2026-06-09T08:00:00.000Z",
              tags: [],
              derivedTags: [],
              isFavorite: false
            }
          ]
        });
      }

      if (url.includes("/affairs/lightweight-sessions")) {
        return createJsonResponse({ items: [] });
      }

      if (url.includes("/affairs/assistant-sessions")) {
        return createJsonResponse({
          item: {
            projectId: null,
            projectWorkspaceId: null,
            agentWorkspacePath: null,
            sessions: [],
            updatedAt: "2026-06-05T08:00:00.000Z"
          }
        });
      }

      if (url.includes("/api/butler/inbox")) {
        return createJsonResponse({ items: [] });
      }

      if (url.includes("/api/butler/follow-up-tasks")) {
        return createJsonResponse({ items: [] });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/affairs");
    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-1/affairs");
    });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    await user.type(within(dialog).getByRole("textbox"), "上海能科");
    await user.click(within(dialog).getByRole("button", { name: t("shell.searchActionAffairs") }));

    const sortSelect = within(dialog).getByRole("combobox", { name: t("shell.searchSortLabel") });
    expect(sortSelect).toHaveValue("relevance");

    await waitFor(() => {
      const resultButtons = within(dialog).getAllByRole("button").filter((button) =>
        button.textContent?.includes("上海能科云桌面运维服务合同谈判记录表")
        || button.textContent?.includes("合同纪要")
      );
      expect(resultButtons[0]?.textContent).toContain("上海能科云桌面运维服务合同谈判记录表");
    });

    await user.selectOptions(sortSelect, "updated_desc");

    await waitFor(() => {
      const resultButtons = within(dialog).getAllByRole("button").filter((button) =>
        button.textContent?.includes("上海能科云桌面运维服务合同谈判记录表")
        || button.textContent?.includes("合同纪要")
      );
      expect(resultButtons[0]?.textContent).toContain("合同纪要");
    });
  });

  it("事务模式的标签、对话、代办会按相关度优先排序", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue(undefined)
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "本地 Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin"
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
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

    mockAffairsLibraryFetch();
    const affairsFetch = global.fetch;
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "事务入口会话",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);
    MockWebSocket.workbenchSnapshot = currentSnapshot;

    const butlerProfileResponse = {
      initialized: true,
      affairsSetupCompleted: true,
      profile: {
        id: "butler-profile-1",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/workspace-1",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: {
          tone: "direct",
          language: "zh-CN",
          summaryStyle: "brief"
        },
        focus: {
          projectIds: [],
          riskPreference: "conservative",
          reportPriority: [],
          summaryDebounceSeconds: 300
        },
        setupCompleted: true,
        initializedAt: "2026-06-05T08:00:00.000Z",
        updatedAt: "2026-06-05T08:00:00.000Z"
      }
    };
    const butlerOverviewResponse = {
      overview: {
        version: "v1",
        generatedAt: "2026-06-05T08:00:00.000Z",
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
    };
    const butlerInboxResponse = {
      items: [
        {
          id: "todo-exact",
          projectId: "project-1",
          workspaceId: "workspace-1",
          projectName: "项目一",
          projectLifecycleStatus: "active",
          itemType: "task",
          title: "合同",
          content: "今天继续处理合同审批。",
          priority: "medium",
          status: "pending",
          assistantState: {
            lifecycleStage: "pending",
            analysisSummary: null,
            generatedPrompt: null,
            analysisControlSessionId: null,
            analysisSessionId: null,
            linkedButlerSessionId: null,
            linkedSessionId: null,
            linkedFollowUpTaskId: null,
            lastError: null,
            lastAnalyzedAt: null,
            lastSessionCreatedAt: null,
            lastFollowUpAt: null
          },
          createdAt: "2026-06-05T08:00:00.000Z",
          updatedAt: "2026-06-05T08:00:00.000Z",
          closedAt: null
        },
        {
          id: "todo-prefix",
          projectId: "project-1",
          workspaceId: "workspace-1",
          projectName: "项目一",
          projectLifecycleStatus: "active",
          itemType: "task",
          title: "合同回访安排",
          content: "需要尽快整理客户反馈。",
          priority: "medium",
          status: "pending",
          assistantState: {
            lifecycleStage: "pending",
            analysisSummary: null,
            generatedPrompt: null,
            analysisControlSessionId: null,
            analysisSessionId: null,
            linkedButlerSessionId: null,
            linkedSessionId: null,
            linkedFollowUpTaskId: null,
            lastError: null,
            lastAnalyzedAt: null,
            lastSessionCreatedAt: null,
            lastFollowUpAt: null
          },
          createdAt: "2026-06-05T09:00:00.000Z",
          updatedAt: "2026-06-05T09:00:00.000Z",
          closedAt: null
        }
      ]
    };
    const butlerFollowUpResponse = {
      items: []
    };

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/butler/profile")) {
        return createJsonResponse(butlerProfileResponse);
      }

      if (url.endsWith("/api/butler/overview")) {
        return createJsonResponse(butlerOverviewResponse);
      }

      if (url.includes("/api/butler/inbox")) {
        return createJsonResponse(butlerInboxResponse);
      }

      if (url.includes("/api/butler/follow-up-tasks")) {
        return createJsonResponse(butlerFollowUpResponse);
      }

      if (url.endsWith("/api/butler/notifications/archives")) {
        return createJsonResponse({ items: [] });
      }

      if (url.includes("/api/workspaces/workspace-1/affairs/library-snapshot")) {
        return createJsonResponse({
          binding: {
            workspaceId: "workspace-1",
            rootDir: "/Users/jackson/WorkFile",
            enabled: true,
            configRelativePath: ".ai-index/doc-semantic-index.config.json",
            exportMode: "v2",
            updatedAt: "2026-05-31T08:00:00.000Z"
          },
          status: {
            state: "fresh",
            dirtyReasons: [],
            lastRequestedAt: null,
            lastStartedAt: null,
            lastCompletedAt: "2026-05-31T08:00:00.000Z",
            lastFailedAt: null,
            nextAllowedAt: null,
            runningTaskId: null,
            errorSummary: null
          },
          tags: [
            {
              path: "客户/合同",
              name: "合同",
              rootType: "manual",
              parentPath: "客户",
              depth: 1,
              documentCount: 2
            },
            {
              path: "客户/合同审批",
              name: "合同审批",
              rootType: "manual",
              parentPath: "客户",
              depth: 1,
              documentCount: 2
            }
          ],
          favorites: [],
          folders: [],
          documentCount: 0,
          lastError: null
        });
      }

      if (url.includes("/api/workspaces/workspace-1/affairs/library-documents")) {
        return createJsonResponse({
          total: 0,
          offset: 0,
          limit: 200,
          items: []
        });
      }

      if (url.includes("/api/workspaces/workspace-1/affairs/lightweight-sessions")) {
        return createJsonResponse({
          items: [
            createSessionSummary({
              sessionId: "lightweight-exact",
              title: "回访",
              workspaceId: "workspace-1",
              updatedAt: "2026-06-05T08:00:00.000Z",
              lastMessageAt: "2026-06-05T08:00:00.000Z"
            }),
            createSessionSummary({
              sessionId: "lightweight-prefix",
              title: "回访计划",
              workspaceId: "workspace-1",
              updatedAt: "2026-06-05T10:00:00.000Z",
              lastMessageAt: "2026-06-05T10:00:00.000Z"
            })
          ]
        });
      }

      if (url.includes("/api/workspaces/workspace-1/affairs/assistant-sessions")) {
        return createJsonResponse({
          item: {
            projectId: null,
            projectWorkspaceId: null,
            agentWorkspacePath: null,
            sessions: [],
            updatedAt: "2026-06-05T08:00:00.000Z"
          }
        });
      }

      return affairsFetch(rawInput);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/affairs");
    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-1/affairs");
    });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const tagDialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    fireEvent.change(within(tagDialog).getByRole("textbox"), {
      target: { value: "合同" }
    });
    fireEvent.click(within(tagDialog).getByRole("button", { name: t("shell.searchActionAffairs") }));
    const tagGroupTitle = await within(tagDialog).findByText(t("shell.searchAffairsTagsGroup"));
    const tagGroup = tagGroupTitle.closest(".workbench-search-result-group");
    if (!(tagGroup instanceof HTMLElement)) {
      throw new Error("未找到事务搜索的标签分组");
    }
    const tagButtons = within(tagGroup).getAllByRole("button");
    expect(tagButtons[0]?.textContent).toContain("合同");
    expect(tagButtons[1]?.textContent).toContain("合同审批");

    await user.click(within(tagDialog).getByRole("button", { name: /关闭|close/i }));

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const conversationDialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    fireEvent.change(within(conversationDialog).getByRole("textbox"), {
      target: { value: "回访" }
    });
    fireEvent.click(within(conversationDialog).getByRole("button", { name: t("shell.searchActionAffairs") }));
    const conversationGroupTitle = await within(conversationDialog).findByText(t("shell.searchAffairsConversationsGroup"));
    const conversationGroup = conversationGroupTitle.closest(".workbench-search-result-group");
    if (!(conversationGroup instanceof HTMLElement)) {
      throw new Error("未找到事务搜索的对话分组");
    }
    const conversationButtons = within(conversationGroup).getAllByRole("button");
    expect(conversationButtons[0]?.textContent).toContain("回访");
    expect(conversationButtons[1]?.textContent).toContain("回访计划");

    await user.click(within(conversationDialog).getByRole("button", { name: /关闭|close/i }));

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const todoDialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    fireEvent.change(within(todoDialog).getByRole("textbox"), {
      target: { value: "合同" }
    });
    fireEvent.click(within(todoDialog).getByRole("button", { name: t("shell.searchActionAffairs") }));
    const todoGroupTitle = await within(todoDialog).findByText(t("shell.searchAffairsTodosGroup"));
    const todoGroup = todoGroupTitle.closest(".workbench-search-result-group");
    if (!(todoGroup instanceof HTMLElement)) {
      throw new Error("未找到事务搜索的代办分组");
    }
    const todoButtons = within(todoGroup).getAllByRole("button");
    expect(todoButtons[0]?.textContent).toContain("合同");
    expect(todoButtons[1]?.textContent).toContain("合同回访安排");
  });

  it("事务模式搜索支持空格分隔的多关键词，并展示命中摘要和高亮", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue(undefined)
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "本地 Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin"
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
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

    mockAffairsLibraryFetch();
    const affairsFetch = global.fetch;
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "事务入口会话",
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

      if (url.endsWith("/api/workspaces")) {
        return createJsonResponse({
          items: [createWorkspace("workspace-1", "项目一")]
        });
      }

      if (url.includes("/api/workspaces/workspace-1/affairs/library-documents")) {
        return createJsonResponse({
          total: 1,
          offset: 0,
          limit: 200,
          items: [
            {
              documentId: "doc-1",
              path: "客户资料/客户跟进.md",
              title: "索引第一句不该当标题",
              summary: "上海办公室预算已确认\n第二行继续跟进审批节奏",
              updatedAt: "2026-06-05T08:00:00.000Z",
              tags: [],
              derivedTags: [],
              isFavorite: false
            }
          ]
        });
      }

      return affairsFetch(rawInput);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/affairs");
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    const dialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    await user.type(within(dialog).getByRole("textbox"), "上海 预算");
    await user.click(within(dialog).getByRole("button", { name: t("shell.searchActionAffairs") }));

    const button = await within(dialog).findByRole("button", { name: /客户跟进/ });
    const title = button.querySelector(".workbench-search-result-title");
    expect(title?.textContent).toBe("客户跟进.md");
    expect(title?.textContent).not.toBe("索引第一句不该当标题");
    expect(button.textContent).toContain("上海办公室预算已确认");
    expect(button.textContent).toContain("第二行继续跟进审批节奏");
    const highlights = button.querySelectorAll("mark.workbench-search-highlight");
    expect(Array.from(highlights).some((node) => node.textContent === "上海")).toBe(true);
    expect(Array.from(highlights).some((node) => node.textContent === "预算")).toBe(true);
  });

  it("事务模式文档搜索不会只停在首批结果", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue(undefined)
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "本地 Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin"
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
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

    mockAffairsLibraryFetch();
    const affairsFetch = global.fetch;
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "事务入口会话",
            workspaceId: "workspace-1"
          })
        ]
      }
    ]);
    MockWebSocket.workbenchSnapshot = currentSnapshot;

    const documents = Array.from({ length: 205 }, (_, index) => ({
      documentId: `doc-${index}`,
      path: `客户资料/上海结果-${index}.md`,
      title: `上海结果-${index}`,
      summary: `第 ${index} 条上海结果摘要`,
      updatedAt: "2026-06-05T08:00:00.000Z",
      tags: [],
      derivedTags: [],
      isFavorite: false
    }));

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/workspaces")) {
        return createJsonResponse({
          items: [createWorkspace("workspace-1", "项目一")]
        });
      }

      if (url.includes("/api/workspaces/workspace-1/affairs/library-documents")) {
        const parsedUrl = new URL(url, "https://codingns.local");
        const offset = Number(parsedUrl.searchParams.get("offset") ?? "0");
        const limit = Number(parsedUrl.searchParams.get("limit") ?? "200");
        return createJsonResponse({
          total: documents.length,
          offset,
          limit,
          items: documents.slice(offset, offset + limit)
        });
      }

      return affairsFetch(rawInput);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/affairs");
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    const dialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    await user.type(within(dialog).getByRole("textbox"), "上海");
    await user.click(within(dialog).getByRole("button", { name: t("shell.searchActionAffairs") }));

    await waitFor(() => {
      expect(dialog.textContent).toContain("上海结果-0");
      expect(dialog.textContent).toContain("上海结果-204");
    });

    const fetchMock = vi.mocked(global.fetch);
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("offset=200"))
    ).toBe(true);
  });

  it("代码模式全局搜索会覆盖所有工作区代码结果，并且不会触发事务搜索", async () => {
    const user = userEvent.setup();
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "代码入口会话",
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

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/workspaces")) {
        return createJsonResponse({
          items: [
            createWorkspace("workspace-1", "项目一"),
            createWorkspace("workspace-2", "项目二")
          ]
        });
      }

      if (url.includes("/api/files/search?workspaceId=workspace-1")) {
        return createJsonResponse({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20
        });
      }

      if (url.includes("/api/files/search?workspaceId=workspace-2")) {
        return createJsonResponse({
          items: [
            {
              path: "src/services/BudgetService.ts",
              name: "BudgetService.ts",
              kind: "file",
              size: 3456,
              updatedAt: "2026-06-05T08:00:00.000Z",
              matchSource: "content",
              snippet: "const city = 'Shanghai';\nreturn buildBudgetService(city);",
              matchScore: 16
            }
          ],
          total: 1,
          page: 1,
          pageSize: 20
        });
      }

      if (url.includes("/affairs/") || url.includes("/api/butler/")) {
        throw new Error(`代码模式不应该触发事务搜索: ${url}`);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
    const searchButton = await screen.findByRole("button", { name: t("shell.searchEntry") });
    await user.click(searchButton);

    const dialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    await user.type(within(dialog).getByRole("textbox"), "Shanghai");
    await user.click(within(dialog).getByRole("button", { name: t("shell.searchActionCode") }));

    const resultButton = await within(dialog).findByRole("button", { name: /BudgetService/ });
    expect(resultButton.textContent).toContain("BudgetService.ts");
    expect(resultButton.textContent).toContain("项目二 · src/services/BudgetService.ts");
    expect(resultButton.textContent).toContain("const city = 'Shanghai';");
    expect(
      Array.from(resultButton.querySelectorAll("mark.workbench-search-highlight")).some(
        (node) => node.textContent?.toLowerCase() === "shanghai"
      )
    ).toBe(true);
    expect(within(dialog).queryByText(t("shell.searchAffairsFailed"))).toBeNull();

    await user.click(resultButton);
    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-2/sessions");
    });
  });

  it("代码模式文件搜索不会只停在首批结果，并会展示内容命中摘要", async () => {
    const user = userEvent.setup();
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "代码入口会话",
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

      if (url.endsWith("/api/workspaces")) {
        return createJsonResponse({
          items: [createWorkspace("workspace-1", "项目一")]
        });
      }

      if (url.includes("/api/files/search?workspaceId=workspace-1")) {
        const parsedUrl = new URL(url, "https://codingns.local");
        const page = Number(parsedUrl.searchParams.get("page") ?? "1");
        const pageSize = Number(parsedUrl.searchParams.get("pageSize") ?? "100");
        const allItems = Array.from({ length: 205 }, (_, index) => ({
          path: `src/services/shanghai-${index}.ts`,
          name: `shanghai-${index}.ts`,
          kind: "file" as const,
          size: 1024,
          updatedAt: "2026-06-05T08:00:00.000Z",
          matchSource: "content" as const,
          snippet: `const cityName = "Shanghai-${index}";\nreturn cityName;`,
          matchScore: 12
        }));
        const offset = (page - 1) * pageSize;

        return createJsonResponse({
          items: allItems.slice(offset, offset + pageSize),
          total: allItems.length,
          page,
          pageSize
        });
      }

      if (url.includes("/affairs/") || url.includes("/api/butler/")) {
        throw new Error(`代码模式不应该触发事务搜索: ${url}`);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
    const searchButton = await screen.findByRole("button", { name: t("shell.searchEntry") });
    await user.click(searchButton);

    const dialog = await screen.findByRole("dialog", { name: t("shell.searchModalTitle") });
    await user.type(within(dialog).getByRole("textbox"), "shanghai");
    await user.click(within(dialog).getByRole("button", { name: t("shell.searchActionCode") }));

    await waitFor(() => {
      expect(dialog.textContent).toContain("shanghai-0.ts");
      expect(dialog.textContent).toContain("shanghai-204.ts");
      expect(dialog.textContent).toContain("const cityName = \"Shanghai-204\";");
    });

    const fetchMock = vi.mocked(global.fetch);
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("page=3"))
    ).toBe(true);
  });

  it("桌面端支持 Ctrl+F 或 Command+F 打开搜索框", async () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue(undefined)
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "本地 Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin"
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
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
    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
    await screen.findByRole("button", { name: t("shell.searchEntry") });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: t("shell.searchModalTitle") })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.searchModalTitle") })).toBeNull();
    });

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(await screen.findByRole("dialog", { name: t("shell.searchModalTitle") })).toBeInTheDocument();
  });

  it("桌面侧栏会按代码、事务、对话、终端、技能顺序显示顶部入口，并支持跳转", async () => {
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
    expect(navSegment?.querySelectorAll(".workbench-nav-segment-pair .workbench-nav-segment-button")).toHaveLength(2);

    const navLabels = Array.from(navSegment?.querySelectorAll("button") ?? []).map((button) =>
      button.textContent?.trim()
    );
    expect(navLabels).toEqual([
      t("shell.workbenchModeCode"),
      t("shell.workbenchModeAffairs"),
      t("shell.conversationEntry"),
      t("shell.terminalsEntry"),
      t("shell.skillsEntry")
    ]);

    await user.click(screen.getByRole("tab", { name: t("shell.terminalsEntry") }));

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-1/terminals");
    });
  });

  it("桌面侧栏的技能按钮会打开 Skill 模态框", async () => {
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

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/skills/overview") && method === "GET") {
        return createJsonResponse(createSkillOverviewResponse());
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    await screen.findByText("会话 Alpha");
    await userEvent.click(screen.getByRole("button", { name: t("shell.skillsEntry") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.skillConfigModalTitle") });

    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.skillSummaryManagedSkills"))).toBeInTheDocument();
    expect(within(dialog).getByText("codingns-assistant")).toBeInTheDocument();
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

    openSessionCardContextMenu(betaCard);
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

    openSessionCardContextMenu(betaCard);
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
    expect(
      within(notificationDialog).getByText(
        t("shell.globalNotificationFollowUpCompletedTitle", { title: "登录页开发" })
      )
    ).toBeInTheDocument();
    expect(within(notificationDialog).getByText("登录页目标已完成，跟进自动结束。")).toBeInTheDocument();
    expect(within(notificationDialog).getByText(t("shell.globalNotificationKindFollowUpCompleted"))).toBeInTheDocument();
  });

  it("会为代办分析完成生成通知", async () => {
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
            activeSessionCount: 0,
            sessionCount: 0,
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
      items: []
    } as never);
    mockedListButlerInboxItems.mockResolvedValueOnce({
      items: [
        {
          id: "todo-1",
          projectId: "project-1",
          workspaceId: "workspace-1",
          projectName: "项目一",
          projectLifecycleStatus: "active",
          itemType: "task",
          title: "补齐登录验证码",
          content: "继续收尾登录验证码流程。",
          priority: "medium",
          status: "pending",
          assistantState: {
            lifecycleStage: "analyzed",
            analysisSummary: "仓库定位完成，登录验证码流程还差接口联调。",
            generatedPrompt: "请先检查登录验证码相关页面、接口和错误处理。",
            analysisControlSessionId: null,
            analysisSessionId: null,
            linkedButlerSessionId: null,
            linkedSessionId: null,
            linkedFollowUpTaskId: null,
            lastError: null,
            lastAnalyzedAt: "2026-04-07T00:02:00.000Z",
            lastSessionCreatedAt: null,
            lastFollowUpAt: null
          },
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:02:00.000Z",
          closedAt: null
        }
      ]
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
    expect(
      within(notificationDialog).getByText(
        t("shell.globalNotificationTodoAnalyzedTitle", { title: "补齐登录验证码" })
      )
    ).toBeInTheDocument();
    expect(
      within(notificationDialog).getByText("仓库定位完成，登录验证码流程还差接口联调。")
    ).toBeInTheDocument();
    expect(within(notificationDialog).getByText(t("shell.globalNotificationKindTodoAnalyzed"))).toBeInTheDocument();
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

      if (url.endsWith("/api/debug-targets/analyze") && init?.method === "POST") {
        return createJsonResponse({
          target: {
            id: "debug-target-1",
            workspaceId: "workspace-1",
            rootPath: "C:/repo/workspace-1",
            displayName: "workspace-1",
            sourceType: "repo",
            createdAt: "2026-03-26T12:00:00.000Z",
            updatedAt: "2026-03-26T12:00:00.000Z"
          },
          services: [
            {
              id: "service-1",
              targetId: "debug-target-1",
              role: "frontend",
              name: "web",
              cwd: "C:/repo/workspace-1/apps/web",
              command: "pnpm",
              args: ["dev"],
              env: {},
              defaultPortHint: 5173,
              protocol: "http",
              healthPath: null,
              adapterKind: "cli",
              frameworkAnalysisId: "analysis-1",
              createdAt: "2026-03-26T12:00:00.000Z",
              updatedAt: "2026-03-26T12:00:00.000Z"
            },
            {
              id: "service-2",
              targetId: "debug-target-1",
              role: "backend",
              name: "host",
              cwd: "C:/repo/workspace-1/apps/host",
              command: "pnpm",
              args: ["dev"],
              env: {},
              defaultPortHint: 3000,
              protocol: "http",
              healthPath: null,
              adapterKind: "env",
              frameworkAnalysisId: "analysis-2",
              createdAt: "2026-03-26T12:00:00.000Z",
              updatedAt: "2026-03-26T12:00:00.000Z"
            },
            {
              id: "service-3",
              targetId: "debug-target-1",
              role: "frontend",
              name: "desktop",
              cwd: "C:/repo/workspace-1/apps/desktop",
              command: "pnpm",
              args: ["dev"],
              env: {},
              defaultPortHint: null,
              protocol: "http",
              healthPath: null,
              adapterKind: "cli",
              frameworkAnalysisId: "analysis-3",
              createdAt: "2026-03-26T12:00:00.000Z",
              updatedAt: "2026-03-26T12:00:00.000Z"
            }
          ],
          analyses: [
            {
              id: "analysis-1",
              targetId: "debug-target-1",
              serviceId: "service-1",
              primaryFramework: "vite",
              confidence: "high",
              compatibilityLevel: "supported",
              recommendedInjectionMode: "cli",
              requiresServiceDiscoveryHandling: true,
              requiresHmrHandling: true,
              requiresCallbackHandling: false,
              aiFallbackPolicy: "conditional",
              reasons: ["检测到 vite.config.ts"],
              detectedFiles: ["package.json", "vite.config.ts"],
              createdAt: "2026-03-26T12:00:00.000Z"
            },
            {
              id: "analysis-2",
              targetId: "debug-target-1",
              serviceId: "service-2",
              primaryFramework: "node-custom",
              confidence: "medium",
              compatibilityLevel: "conditional",
              recommendedInjectionMode: "env",
              requiresServiceDiscoveryHandling: false,
              requiresHmrHandling: false,
              requiresCallbackHandling: false,
              aiFallbackPolicy: "conditional",
              reasons: ["检测到 package.json"],
              detectedFiles: ["package.json", "src/main.ts"],
              createdAt: "2026-03-26T12:00:00.000Z"
            },
            {
              id: "analysis-3",
              targetId: "debug-target-1",
              serviceId: "service-3",
              primaryFramework: "tauri",
              confidence: "high",
              compatibilityLevel: "conditional",
              recommendedInjectionMode: "none",
              requiresServiceDiscoveryHandling: false,
              requiresHmrHandling: false,
              requiresCallbackHandling: false,
              aiFallbackPolicy: "forbidden",
              reasons: ["检测到 src-tauri/tauri.conf.json"],
              detectedFiles: ["package.json", "src-tauri/tauri.conf.json"],
              createdAt: "2026-03-26T12:00:00.000Z"
            }
          ],
          autoInjectionEligible: true
        });
      }

      if (url.includes("/api/debug-targets/debug-target-1/runtimes?")) {
        return createJsonResponse({
          targetId: "debug-target-1",
          items: [{
          runtimeSession: {
            id: "runtime-1",
            targetId: "debug-target-1",
            status: "FAILED",
            failureStage: "service_discovery",
            startedAt: "2026-03-26T12:00:00.000Z",
            stoppedAt: "2026-03-26T12:01:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            updatedAt: "2026-03-26T12:01:00.000Z"
          },
          target: {
            id: "debug-target-1",
            workspaceId: "workspace-1",
            rootPath: "C:/repo/workspace-1",
            displayName: "workspace-1",
            sourceType: "repo",
            createdAt: "2026-03-26T12:00:00.000Z",
            updatedAt: "2026-03-26T12:00:00.000Z"
          },
          services: [
            {
              service: {
                id: "service-1",
                targetId: "debug-target-1",
                role: "frontend",
                name: "web",
                cwd: "C:/repo/workspace-1",
                command: "pnpm",
                args: ["dev"],
                env: {},
                defaultPortHint: 5173,
                protocol: "http",
                healthPath: null,
                adapterKind: "cli",
                frameworkAnalysisId: "analysis-1",
                createdAt: "2026-03-26T12:00:00.000Z",
                updatedAt: "2026-03-26T12:00:00.000Z"
              },
              analysis: null,
              binding: {
                id: "binding-1",
                runtimeId: "runtime-1",
                serviceId: "service-1",
                processInstanceId: "terminal-1",
                expectedPort: 5173,
                leasedPort: 43000,
                observedPort: null,
                proxyPath: null,
                status: "FAILED",
                updatedAt: "2026-03-26T12:01:00.000Z"
              },
              portLease: {
                id: "lease-1",
                runtimeId: "runtime-1",
                serviceId: "service-1",
                port: 43000,
                protocol: "tcp",
                status: "RELEASED",
                leasedAt: "2026-03-26T12:00:00.000Z",
                expiresAt: null,
                releasedAt: "2026-03-26T12:01:00.000Z"
              },
              processInstance: {
                id: "terminal-1",
                workspaceId: "workspace-1",
                name: "web",
                cwd: "C:/repo/workspace-1",
                shell: "pwsh",
                runtimeType: "embedded-pty",
                runtimeSessionId: "terminal-runtime-1",
                attachTarget: "terminal-1",
                status: "error",
                processId: 123,
                createdByUserId: "user-1",
                createdAt: "2026-03-26T12:00:00.000Z",
                lastActiveAt: "2026-03-26T12:00:30.000Z",
                closedAt: "2026-03-26T12:01:00.000Z",
                exitCode: 1,
                statusDetail: "boom",
                debugRuntimeSessionId: "runtime-1",
                debugTargetId: "debug-target-1",
                debugServiceId: "service-1",
                frameworkAnalysisId: "analysis-1",
                launcherSourceType: "debug_service",
                launchStage: "command_dispatched",
                failureStage: "process_runtime_error",
                adapterKind: "cli",
                envPatchSummary: {},
                artifactRef: null
              },
              aiFallbackEdits: []
            }
          ]
          }]
        });
      }

      if (url.endsWith("/api/framework-compatibility-matrix")) {
        return createJsonResponse({
          version: "2026-04-13",
          items: [
            {
              framework: "vite",
              compatibilityLevel: "supported",
              recommendedInjectionMode: "cli",
              requiresServiceDiscoveryHandling: true,
              requiresHmrHandling: true,
              requiresCallbackHandling: false,
              aiFallbackPolicy: "conditional",
              notes: "Vite 端口入口清楚，第一阶段默认支持"
            }
          ]
        });
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

    expect(managerDialog).toHaveClass("workbench-manage-workspaces-modal");
    expect(
      within(managerDialog).getByRole("button", { name: t("shell.manageWorkspaceImportAction") })
    ).toBeInTheDocument();
    expect(
      within(managerDialog).getByRole("button", { name: t("shell.manageWorkspaceCloneAction") })
    ).toBeInTheDocument();

    await userEvent.click(
      within(managerDialog).getByRole("button", { name: t("shell.manageWorkspaceImportAction") })
    );

    const importDialog = await screen.findByRole("dialog", {
      name: t("shell.importBrowserTitle")
    });
    expect(importDialog).toBeInTheDocument();

    await userEvent.click(within(importDialog).getByRole("button", { name: t("common.close") }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.importBrowserTitle") })).toBeNull();
    });

    await userEvent.click(
      within(managerDialog).getByRole("button", { name: t("shell.manageWorkspaceCloneAction") })
    );

    const cloneDialog = await screen.findByRole("dialog", { name: t("shell.cloneWorkspaceTitle") });
    expect(cloneDialog).toBeInTheDocument();

    await userEvent.click(within(cloneDialog).getByRole("button", { name: t("common.close") }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.cloneWorkspaceTitle") })).toBeNull();
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

  it("工作区管理中的调试入口可以跳到桌面端完整调试详情页", async () => {
    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: []
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/debug-targets/analyze") && init?.method === "POST") {
        return createJsonResponse({
          target: {
            id: "debug-target-1",
            workspaceId: "workspace-1",
            rootPath: "C:/repo/workspace-1",
            displayName: "workspace-1",
            sourceType: "repo",
            createdAt: "2026-03-26T12:00:00.000Z",
            updatedAt: "2026-03-26T12:00:00.000Z"
          },
          services: [
            {
              id: "service-1",
              targetId: "debug-target-1",
              role: "frontend",
              name: "web",
              cwd: "C:/repo/workspace-1/apps/web",
              command: "pnpm",
              args: ["dev"],
              env: {},
              defaultPortHint: 5173,
              protocol: "http",
              healthPath: null,
              adapterKind: "cli",
              frameworkAnalysisId: "analysis-1",
              createdAt: "2026-03-26T12:00:00.000Z",
              updatedAt: "2026-03-26T12:00:00.000Z"
            }
          ],
          analyses: [
            {
              id: "analysis-1",
              targetId: "debug-target-1",
              serviceId: "service-1",
              primaryFramework: "vite",
              confidence: "high",
              compatibilityLevel: "supported",
              recommendedInjectionMode: "cli",
              requiresServiceDiscoveryHandling: true,
              requiresHmrHandling: true,
              requiresCallbackHandling: false,
              aiFallbackPolicy: "conditional",
              reasons: ["检测到 vite.config.ts"],
              detectedFiles: ["package.json", "vite.config.ts"],
              createdAt: "2026-03-26T12:00:00.000Z"
            }
          ],
          autoInjectionEligible: true
        });
      }

      if (url.endsWith("/api/framework-compatibility-matrix")) {
        return createJsonResponse({
          version: "2026-04-13",
          items: [
            {
              framework: "vite",
              compatibilityLevel: "supported",
              recommendedInjectionMode: "cli",
              requiresServiceDiscoveryHandling: true,
              requiresHmrHandling: true,
              requiresCallbackHandling: false,
              aiFallbackPolicy: "conditional",
              notes: "Vite 端口入口清楚，第一阶段默认支持"
            }
          ]
        });
      }

      if (url.includes("/api/terminals/templates?workspaceId=workspace-1")) {
        return createJsonResponse({
          items: [
            {
              id: "template-1",
              workspaceId: "workspace-1",
              name: "web",
              cwd: "C:/repo/workspace-1/apps/web",
              command: "pnpm",
              args: ["dev"],
              env: {},
              port: 43000,
              proxyEnabled: true,
              proxySlug: "web",
              runtimeType: "node",
              createdAt: "2026-03-26T12:00:00.000Z",
              updatedAt: "2026-03-26T12:00:00.000Z"
            },
            {
              id: "template-2",
              workspaceId: "workspace-1",
              name: "host",
              cwd: "C:/repo/workspace-1/apps/host",
              command: "pnpm",
              args: ["dev"],
              env: {},
              port: 44000,
              proxyEnabled: false,
              proxySlug: null,
              runtimeType: "node",
              createdAt: "2026-03-26T12:00:00.000Z",
              updatedAt: "2026-03-26T12:00:00.000Z"
            },
            {
              id: "template-3",
              workspaceId: "workspace-1",
              name: "desktop",
              cwd: "C:/repo/workspace-1/apps/desktop",
              command: "pnpm",
              args: ["tauri", "dev"],
              env: {},
              port: null,
              proxyEnabled: false,
              proxySlug: null,
              runtimeType: "node",
              createdAt: "2026-03-26T12:00:00.000Z",
              updatedAt: "2026-03-26T12:00:00.000Z"
            }
          ]
        });
      }

      if (url.includes("/api/terminals/templates/runtime-status?workspaceId=workspace-1")) {
        return createJsonResponse({
          items: [
            {
              templateId: "template-1",
              port: 43000,
              occupied: false,
              processId: null,
              processName: null,
              processCommandLine: null
            },
            {
              templateId: "template-2",
              port: 44000,
              occupied: false,
              processId: null,
              processName: null,
              processCommandLine: null
            }
          ]
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
    await userEvent.click(
      within(managerDialog).getByRole("button", { name: t("shell.workspaceDetailDebugOpenPageAction") })
    );

    expect(await screen.findByText(t("shell.workspaceDetailDebugPageTitle"))).toBeInTheDocument();
    expect(
      await screen.findByText(
        t("shell.workspaceDetailRegisteredDebugOverallSummary", { runnable: 2, orchestrated: 0, blocked: 1 })
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("shell.workspaceDetailRegisteredDebugOpenProcessManagerAction") })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.workspaceDetailDebugMatrixOpenAction") })).not.toBeInTheDocument();
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

  it("在终端管理页点击项目切换按钮时跳到对应项目的终端管理页", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: []
      },
      {
        workspace: createWorkspace("workspace-2", "项目二"),
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

    renderWorkbenchRoute("/workspaces/workspace-1/terminals");

    const targetWorkspaceGroup = await findWorkspaceGroupByName("项目二");
    const targetWorkspaceScope = within(targetWorkspaceGroup);

    await userEvent.click(
      targetWorkspaceScope.getByRole("button", { name: t("shell.switchWorkspace") })
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/workspaces/workspace-2/terminals");
    });

    expect(window.localStorage.getItem("workbench.workspace.selected.id")).toBe("workspace-2");
    expect(
      targetWorkspaceScope.getByRole("button", { name: t("shell.switchWorkspace") })
    ).toHaveAttribute("aria-pressed", "true");
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

  it("支持工作区会话批量删除，并在删掉当前会话后回到会话列表", async () => {
    const sessionTitles: Record<string, string> = {
      "session-1": "Session Alpha",
      "session-2": "Session Beta",
      "session-3": "Session Gamma"
    };
    const deletedSessionIds = new Set<string>();
    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "Project One"),
        sessions: Object.entries(sessionTitles).map(([sessionId, title]) =>
          createSessionSummary({
            sessionId,
            title,
            workspaceId: "workspace-1"
          })
        )
      }
    ]);

    function rebuildSnapshot() {
      currentSnapshot = createWorkbenchSnapshot([
        {
          workspace: createWorkspace("workspace-1", "Project One"),
          sessions: Object.entries(sessionTitles)
            .filter(([sessionId]) => !deletedSessionIds.has(sessionId))
            .map(([sessionId, title]) =>
              createSessionSummary({
                sessionId,
                title,
                workspaceId: "workspace-1"
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
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/sessions/") && init?.method === "DELETE") {
        const sessionId = url.split("/api/sessions/")[1];

        if (!sessionId || !(sessionId in sessionTitles)) {
          throw new Error(`未处理的删除会话: ${url}`);
        }

        deletedSessionIds.add(sessionId);
        rebuildSnapshot();
        return createJsonResponse({});
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    const workspaceGroup = await findWorkspaceGroupByName("Project One");
    const workspaceScope = within(workspaceGroup);

    await userEvent.click(workspaceScope.getByRole("button", { name: t("shell.batchSelectSessions") }));

    const alphaCard = await findSessionCardByTitle("Session Alpha");
    const betaCard = await findSessionCardByTitle("Session Beta");
    await userEvent.click(within(alphaCard).getByText("Session Alpha"));
    await userEvent.click(within(betaCard).getByText("Session Beta"));

    expect(workspaceScope.getByText("2/3")).toBeInTheDocument();

    await userEvent.click(workspaceScope.getByRole("button", { name: t("shell.batchDeleteAction") }));

    const dialog = await screen.findByRole("dialog", {
      name: t("shell.batchDeleteConfirmTitle")
    });
    expect(
      within(dialog).getByText(
        t("shell.batchDeleteSelectionSummary", {
          count: "2"
        })
      )
    ).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.batchDeleteAction") }));

    await waitFor(() => {
      expect(querySessionCardsByTitle("Session Alpha")).toHaveLength(0);
      expect(querySessionCardsByTitle("Session Beta")).toHaveLength(0);
      expect(screen.getByTestId("current-path")).toHaveTextContent("/workspaces/workspace-1/sessions");
    });

    expect(getSessionCardByTitle("Session Gamma")).toBeInTheDocument();
    expect(deletedSessionIds).toEqual(new Set(["session-1", "session-2"]));
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

  it("会在侧栏会话列表里只显示失败状态，不显示错误摘要", async () => {
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
      within(sessionCard).queryByText(
        /CODEX_HTTP_502 · unexpected status 502 Bad Gateway: Upstream request failed/
      )
    ).not.toBeInTheDocument();
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
      expect(navigationStateBodies).toEqual([{ collapsed: true }]);
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

  it("拖拽工作区标题时会临时收起所有工作区并在松手后恢复原有折叠状态后保存新的顺序", async () => {
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
    expect(within(workspaceOneGroup).getByText("会话一")).toBeInTheDocument();
    expect(within(workspaceTwoGroup).getByText("会话二")).toBeInTheDocument();
    const dataTransfer = createDragDataTransfer();

    fireEvent.dragStart(workspaceOneToggle, {
      dataTransfer
    });

    await waitFor(() => {
      expect(within(workspaceOneGroup).queryByText("会话一")).toBeNull();
      expect(within(workspaceTwoGroup).queryByText("会话二")).toBeNull();
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
    expect(within(await findWorkspaceGroupByName("项目一")).getByText("会话一")).toBeInTheDocument();
    expect(within(await findWorkspaceGroupByName("项目二")).getByText("会话二")).toBeInTheDocument();
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

  it("macOS 桌面端工作区标题改用指针排序，不再依赖原生 draggable", async () => {
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
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    const view = renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");

    await findWorkspaceGroupByName("项目一");
    await findWorkspaceGroupByName("项目二");

    const workspaceToggles = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>(".workbench-workspace-toggle")
    );

    expect(workspaceToggles).toHaveLength(2);
    expect(workspaceToggles.every((toggle) => toggle.dataset.reorderEnabled === "true")).toBe(true);
    expect(workspaceToggles.every((toggle) => toggle.getAttribute("draggable") !== "true")).toBe(true);
  });

  it("重排工作区时会按目标位置生成新的顺序", () => {
    const groups = [
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [],
        childWorktrees: []
      },
      {
        workspace: createWorkspace("workspace-2", "项目二"),
        sessions: [],
        childWorktrees: []
      },
      {
        workspace: createWorkspace("workspace-3", "项目三"),
        sessions: [],
        childWorktrees: []
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

  it("会直接显示子工作区并递归展示子节点", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-root",
            title: "根会话",
            workspaceId: "workspace-1"
          })
        ],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "登录分支"),
            displayName: "feat/login-codex",
            branchName: "feat/login-codex",
            sessions: [
              createSessionSummary({
                sessionId: "session-child",
                title: "工作树会话",
                workspaceId: "workspace-1-child"
              })
            ],
            children: [
              createWorkbenchWorktreeNode({
                workspace: createWorkspace("workspace-1-child-v2", "登录分支 V2"),
                displayName: "feat/login-codex-v2",
                branchName: "feat/login-codex-v2",
                depth: 2,
                parentWorkspaceId: "workspace-1-child",
                sessions: [
                  createSessionSummary({
                    sessionId: "session-child-v2",
                    title: "二级工作树会话",
                    workspaceId: "workspace-1-child-v2"
                  })
                ]
              })
            ]
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

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("claude-code"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-root");

    const rootGroup = await findWorkspaceGroupByName("项目一");
    expect(within(rootGroup).getByText("根会话")).toBeInTheDocument();
    expect(within(rootGroup).getByText(t("shell.archiveFolderLabel"))).toBeInTheDocument();
    expect(within(rootGroup).getAllByText("feat/login-codex").length).toBeGreaterThan(0);

    const childGroup = await findWorkspaceGroupByName("feat/login-codex");
    expect(childGroup).toBeInTheDocument();
    await userEvent.click(within(childGroup).getByRole("button", { name: t("shell.worktreeExpand") }));
    expect(within(childGroup).getByText("工作树会话")).toBeInTheDocument();

    const nestedGroup = await findWorkspaceGroupByName("feat/login-codex-v2");
    await userEvent.click(within(nestedGroup).getByRole("button", { name: t("shell.worktreeExpand") }));
    expect(within(nestedGroup).getByText("二级工作树会话")).toBeInTheDocument();
  });

  it("子工作区头部保留切换、多选、新建会话三个按钮，并支持对子工作区批量归档", async () => {
    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "登录分支"),
            displayName: "feat/login-codex",
            branchName: "feat/login-codex",
            sessions: [
              createSessionSummary({
                sessionId: "session-child",
                title: "工作树会话",
                workspaceId: "workspace-1-child"
              })
            ]
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

      if (url.endsWith("/api/sessions/session-child/archive")) {
        const archivedSession = createSessionSummary({
          sessionId: "session-child",
          title: "工作树会话",
          workspaceId: "workspace-1-child",
          isArchived: true
        });

        currentSnapshot = createWorkbenchSnapshot([
          {
            workspace: createWorkspace("workspace-1", "项目一"),
            sessions: [],
            childWorktrees: [
              createWorkbenchWorktreeNode({
                workspace: createWorkspace("workspace-1-child", "登录分支"),
                displayName: "feat/login-codex",
                branchName: "feat/login-codex",
                sessions: [archivedSession]
              })
            ]
          }
        ]);
        MockWebSocket.workbenchSnapshot = currentSnapshot;

        return createJsonResponse(archivedSession);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1-child/sessions/session-child");

    const childGroup = await findWorkspaceGroupByName("feat/login-codex");
    const childScope = within(childGroup);

    expect(childScope.getByRole("button", { name: t("shell.switchWorkspace") })).toBeInTheDocument();
    expect(childScope.getByRole("button", { name: t("shell.batchSelectSessions") })).toBeInTheDocument();
    expect(childScope.getByRole("button", { name: t("shell.createSession") })).toBeInTheDocument();

    await userEvent.click(childScope.getByRole("button", { name: t("shell.batchSelectSessions") }));

    const sessionCard = await findSessionCardByTitle("工作树会话");
    await userEvent.click(within(sessionCard).getByText("工作树会话"));

    expect(childScope.getByText("1/1")).toBeInTheDocument();

    await userEvent.click(childScope.getByRole("button", { name: t("shell.batchArchiveAction") }));

    await waitFor(() => {
      expect(querySessionCardsByTitle("工作树会话")).toHaveLength(0);
    });
  });

  it("管理工作区弹窗会树状显示子工作区，并持久化子工作区颜色配置", async () => {
    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "登录分支"),
            displayName: "feat/login-codex",
            branchName: "feat/login-codex",
            sessions: []
          })
        ]
      }
    ]);
    const navigationStateBodies: Array<Record<string, unknown>> = [];

    MockWebSocket.workbenchSnapshot = currentSnapshot;

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const request = rawInput instanceof Request ? rawInput : null;
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();
      const method = request?.method ?? init?.method;
      const body = request ? await request.clone().text() : String(init?.body ?? "");

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/workspaces/workspace-1/management")) {
        return createJsonResponse(createWorkspaceManagementSummary("workspace-1", "项目一"));
      }

      if (url.endsWith("/api/workspaces/workspace-1-child/management")) {
        return createJsonResponse(createWorkspaceManagementSummary("workspace-1-child", "登录分支"));
      }

      if (url.endsWith("/api/workspaces/workspace-1-child/navigation-state") && method === "PUT") {
        navigationStateBodies.push(JSON.parse(body));
        currentSnapshot = createWorkbenchSnapshot([
          {
            workspace: createWorkspace("workspace-1", "项目一"),
            sessions: [],
            childWorktrees: [
              createWorkbenchWorktreeNode({
                workspace: createWorkspace("workspace-1-child", "登录分支", "#0EA5E9"),
                displayName: "feat/login-codex",
                branchName: "feat/login-codex",
                sessions: []
              })
            ]
          }
        ]);
        MockWebSocket.workbenchSnapshot = currentSnapshot;

        return createJsonResponse({
          workspaceId: "workspace-1-child",
          userId: "user-1",
          collapsed: false,
          backgroundColor: "#0EA5E9",
          updatedAt: "2026-04-12T12:00:00.000Z"
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1/sessions");

    await userEvent.click(await screen.findByRole("button", { name: t("shell.manageWorkspaceAction") }));
    const managerDialog = await screen.findByRole("dialog", {
      name: t("shell.manageWorkspaceTitle")
    });

    const childToggle = await within(managerDialog).findByRole("button", { name: /feat\/login-codex/ });
    expect(childToggle).toBeInTheDocument();

    await userEvent.click(childToggle);

    const childItem = childToggle.closest(".workbench-manage-item");
    expect(childItem).not.toBeNull();
    const swatchButton = within(childItem as HTMLElement).getByRole("button", {
      name: t("shell.manageWorkspaceColorSelectSwatch", {
        color: "#0EA5E9"
      })
    });
    await userEvent.click(swatchButton);

    await waitFor(() => {
      expect(navigationStateBodies).toEqual([{ backgroundColor: "#0EA5E9" }]);
    });

    const childGroup = await findWorkspaceGroupByName("feat/login-codex");
    expect(childGroup).toHaveStyle("--workspace-tone-color: #0EA5E9");
    expect(within(childItem as HTMLElement).getByText("#0EA5E9")).toBeInTheDocument();
  });

  it("当前会话属于子工作树时，会给会话卡片和右侧信息栏打上工作树视觉标记", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "登录分支"),
            displayName: "feat/login-codex",
            branchName: "feat/login-codex",
            sessions: [
              createSessionSummary({
                sessionId: "session-child",
                title: "工作树会话",
                workspaceId: "workspace-1-child"
              })
            ]
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

    await renderWorkbenchRoute("/workspaces/workspace-1-child/sessions/session-child");
    const childGroup = await findWorkspaceGroupByName("feat/login-codex");
    expect(childGroup).toHaveAttribute("data-workspace-tone", "worktree");

    const childSessionCard = querySessionCardsByTitle("工作树会话")[0];
    expect(childSessionCard).toHaveAttribute("data-workspace-tone", "worktree");

    await waitFor(() => {
      expect(document.querySelector(".workbench-auxiliary")).toHaveAttribute("data-workspace-tone", "worktree");
    });
  });

  it("当前选中的工作区也允许手动折叠会话", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-1",
            title: "当前会话",
            workspaceId: "workspace-1"
          })
        ],
        collapsed: false
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    const navigationStateBodies: unknown[] = [];
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, init?: RequestInit) => {
      const request = rawInput instanceof Request ? rawInput : null;
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();
      const method = request?.method ?? init?.method;
      const body = request ? await request.clone().text() : String(init?.body ?? "");

      if (url.endsWith("/api/workspaces/workspace-1/navigation-state") && method === "PUT") {
        navigationStateBodies.push(JSON.parse(body));
        return createJsonResponse({
          workspaceId: "workspace-1",
          collapsed: true
        });
      }

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    const view = renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-1");
    const workspaceGroup = await findWorkspaceGroupByName("项目一");

    expect(within(workspaceGroup).getByText("当前会话")).toBeInTheDocument();

    await userEvent.click(
      within(workspaceGroup).getByRole("button", {
        name: t("shell.workspaceCollapse")
      })
    );

    await waitFor(() => {
      expect(navigationStateBodies).toEqual([{ collapsed: true }]);
      expect(within(workspaceGroup).queryByText("当前会话")).toBeNull();
    });

    expect(view.container).toBeInTheDocument();
  });

  it("并行组页会自动隐藏右侧信息栏，不再挤压主内容区", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      role: "member" as const,
      memberCount: 2,
      sourceType: "new" as const,
      sourceSessionId: null,
      anchorSessionId: "session-anchor",
      colorToken: "parallel-group-1"
    };
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-parallel",
            title: "并行成员",
            workspaceId: "workspace-1",
            parallelGroup
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

    const view = renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-parallel");

    await findSessionCardByTitle("并行成员");

    const shell = view.container.querySelector(".workbench-shell");
    const rightResizer = view.container.querySelector('.workbench-side-resizer[data-side="right"]');

    expect(shell).toHaveAttribute("data-parallel-conversation-active", "true");
    expect(shell).toHaveAttribute("data-right-collapsed", "true");
    expect(view.container.querySelector('.workbench-auxiliary[data-collapsed="true"]')).not.toBeNull();
    expect(rightResizer).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByRole("button", { name: t("shell.hideInfoSidebar") })).toBeNull();
    expect(view.container.querySelector('.workbench-collapsed-controls.right[data-visible="true"]')).toBeNull();
  });
});
