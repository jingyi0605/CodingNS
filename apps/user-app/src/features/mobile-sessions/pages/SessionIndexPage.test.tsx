import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import type {
  SessionSummaryDto,
  WorkbenchWorktreeNodeDto,
  WorkspaceDto
} from "../../conversation/api/conversation-api";
import type { WorkbenchNavigationGroup } from "../../workbench/utils/workbench-navigation";
import { SessionIndexPage } from "./SessionIndexPage";

function createNavigationGroups(): WorkbenchNavigationGroup[] {
  return [
    {
      workspace: createWorkspace("workspace-1", "项目一"),
      sessions: [
        createSessionSummary({
          sessionId: "session-1",
          title: "会话 Alpha",
          provider: "codex",
          workspaceId: "workspace-1",
          lastMessageAt: "2026-03-27T10:00:00Z",
        }),
        createSessionSummary({
          sessionId: "session-2",
          title: "会话 Beta",
          provider: "claude-code",
          workspaceId: "workspace-1",
          isFavorite: true,
          lastMessageAt: "2026-03-27T09:00:00Z",
        }),
        createSessionSummary({
          sessionId: "session-2-sub",
          title: "子代理 Beta-1",
          provider: "codex",
          workspaceId: "workspace-1",
          parentSessionId: "session-2",
          isSubagent: true,
          subagentLabel: "worker · Beta",
          lastMessageAt: "2026-03-27T08:30:00Z",
        })
      ]
    },
    {
      workspace: createWorkspace("workspace-2", "Project Two"),
      sessions: [
        createSessionSummary({
          sessionId: "session-3",
          title: "会话 Gamma",
          provider: "codex",
          workspaceId: "workspace-2",
          lastMessageAt: "2026-03-26T12:00:00Z"
        })
      ]
    }
  ];
}

function createWorkspace(id: string, name: string): WorkspaceDto {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    repoRoot: `/tmp/${id}`
  };
}

function createWorktreeNode(input: {
  workspace: WorkspaceDto;
  displayName: string;
  branchName: string;
  sessions: SessionSummaryDto[];
}): WorkbenchWorktreeNodeDto {
  return {
    workspace: input.workspace,
    meta: {
      workspaceId: input.workspace.id,
      rootWorkspaceId: "workspace-1",
      parentWorkspaceId: "workspace-1",
      sourceWorkspaceId: "workspace-1",
      mergeTargetWorkspaceId: "workspace-1",
      branchName: input.branchName,
      baseRef: "main",
      baseCommit: "commit-base",
      headCommit: "commit-head",
      displayName: input.displayName,
      depth: 1,
      lifecycleStatus: "active",
      mergedAt: null,
      removedAt: null,
      createdAt: "2026-04-12T08:00:00.000Z",
      updatedAt: "2026-04-12T08:00:00.000Z"
    },
    sessions: input.sessions,
    children: []
  };
}

function createSessionSummary(
  overrides: Partial<SessionSummaryDto> &
    Pick<SessionSummaryDto, "sessionId" | "title" | "provider" | "workspaceId">
): SessionSummaryDto {
  return {
    sessionId: overrides.sessionId,
    workspaceId: overrides.workspaceId,
    provider: overrides.provider,
    providerSessionId: overrides.providerSessionId ?? `provider-${overrides.sessionId}`,
    rawStoreRef: overrides.rawStoreRef ?? `codex://${overrides.sessionId}`,
    parentSessionId: overrides.parentSessionId ?? null,
    forkMethod: overrides.forkMethod ?? null,
    forkSourceType: overrides.forkSourceType ?? null,
    forkSourceSessionId: overrides.forkSourceSessionId ?? null,
    forkSourceMessageId: overrides.forkSourceMessageId ?? null,
    isSubagent: overrides.isSubagent ?? false,
    subagentLabel: overrides.subagentLabel ?? null,
    isArchived: overrides.isArchived ?? false,
    isFavorite: overrides.isFavorite ?? false,
    title: overrides.title,
    messageCount: overrides.messageCount ?? 1,
    lastMessageAt: overrides.lastMessageAt ?? "2026-03-27T10:00:00Z",
    createdAt: overrides.createdAt ?? "2026-03-27T09:00:00Z",
    updatedAt: overrides.updatedAt ?? (overrides.lastMessageAt ?? "2026-03-27T10:00:00Z"),
    syncStatus: overrides.syncStatus ?? null,
    syncCursor: overrides.syncCursor ?? null,
    lastSyncAt: overrides.lastSyncAt ?? null,
    lastErrorCode: overrides.lastErrorCode ?? null,
    lastErrorDetail: overrides.lastErrorDetail ?? null,
    resumedAt: overrides.resumedAt ?? null,
    runningState: overrides.runningState ?? null,
    activitySource: overrides.activitySource ?? "none",
    lastEventAt: overrides.lastEventAt ?? null,
    completedAt: overrides.completedAt ?? null,
    lastSeenAt: overrides.lastSeenAt ?? null,
    activityState: overrides.activityState ?? "idle",
    ...(overrides.parallelGroup !== undefined ? { parallelGroup: overrides.parallelGroup } : {}),
    ...(overrides.displayParentSessionId !== undefined
      ? { displayParentSessionId: overrides.displayParentSessionId }
      : {}),
    ...(overrides.sessionIsolatedWorkspace !== undefined
      ? { sessionIsolatedWorkspace: overrides.sessionIsolatedWorkspace }
      : {}),
    ...(overrides.activityResolutionSource
      ? { activityResolutionSource: overrides.activityResolutionSource }
      : {}),
    ...(overrides.activityConfidence ? { activityConfidence: overrides.activityConfidence } : {}),
    ...(overrides.runId !== undefined ? { runId: overrides.runId } : {}),
    ...(overrides.watchdogTriggeredAt !== undefined
      ? { watchdogTriggeredAt: overrides.watchdogTriggeredAt }
      : {}),
    ...(overrides.sessionKind !== undefined ? { sessionKind: overrides.sessionKind } : {}),
    ...(overrides.annotationSourceMessageId !== undefined
      ? { annotationSourceMessageId: overrides.annotationSourceMessageId }
      : {}),
    ...(overrides.annotationSourceText !== undefined
      ? { annotationSourceText: overrides.annotationSourceText }
      : {}),
    ...(overrides.inheritedPrefixMessageCount !== undefined
      ? { inheritedPrefixMessageCount: overrides.inheritedPrefixMessageCount }
      : {})
  };
}

const contextValue = {
  navigationGroups: createNavigationGroups(),
  currentWorkspaceId: "workspace-1",
  currentSessionId: "session-1",
  favoriteSessionIds: ["session-2"],
  navigationLoading: false,
  selectWorkspace: vi.fn(),
  toggleFavoriteSession: vi.fn(async () => undefined),
  archiveSession: vi.fn(async () => undefined),
  unarchiveSession: vi.fn(async () => undefined),
  renameSession: vi.fn(),
  startDraftSession: vi.fn()
};

vi.mock("../../conversation/components/WorkbenchLayout", async () => {
  const actual = await vi.importActual("../../conversation/components/WorkbenchLayout");
  return {
    ...actual,
    useWorkbenchShell: () => contextValue
  };
});

function renderPage(options?: { withRouteProbe?: boolean; initialEntry?: string }) {
  const withRouteProbe = options?.withRouteProbe ?? false;
  const initialEntry = options?.initialEntry ?? "/workspaces/workspace-1/sessions";

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/sessions"
          element={
            <>
              <SessionIndexPage />
              {withRouteProbe ? <RouteProbe /> : null}
            </>
          }
        />
        <Route
          path="/workspaces/:workspaceId/sessions/:sessionId"
          element={withRouteProbe ? <RouteProbe /> : null}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("SessionIndexPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    contextValue.navigationGroups = createNavigationGroups();
    contextValue.currentWorkspaceId = "workspace-1";
    contextValue.currentSessionId = "session-1";
    contextValue.favoriteSessionIds = ["session-2"];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("渲染当前工作区的对话列表", () => {
    renderPage();

    expect(screen.queryByText("对话")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "项目一" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^(当前工作区|Current Workspace)$/ })).toBeInTheDocument();
  });

  it("当前工作区列表会保留收藏会话，但不会混入其他工作区会话", () => {
    renderPage({
      initialEntry: "/workspaces/workspace-1-child/sessions"
    });

    const workspaceSection = screen.getByRole("heading", { level: 2, name: /^(当前工作区|Current Workspace)$/ }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到目标区块");
    }

    expect(within(workspaceSection).getByText("会话 Alpha")).toBeInTheDocument();
    expect(within(workspaceSection).getByText("会话 Beta")).toBeInTheDocument();
    expect(within(workspaceSection).queryByText("会话 Gamma")).not.toBeInTheDocument();
  });

  it("会单独渲染收藏会话区块", () => {
    renderPage();

    const favoriteSection = screen.getByRole("heading", { level: 2, name: /^(收藏会话|Pinned Sessions)$/ }).closest("section");

    if (!favoriteSection) {
      throw new Error("未找到收藏会话区块");
    }

    expect(within(favoriteSection).getByText("会话 Beta")).toBeInTheDocument();
    expect(within(favoriteSection).getByText("1")).toBeInTheDocument();
  });

  it("没有收藏会话时不显示收藏区块", () => {
    contextValue.favoriteSessionIds = [];
    contextValue.navigationGroups = createNavigationGroups().map((group) => ({
      ...group,
      sessions: group.sessions.map((session) => ({
        ...session,
        isFavorite: false
      }))
    }));

    renderPage();

    expect(
      screen.queryByRole("heading", { level: 2, name: /^(收藏会话|Pinned Sessions)$/ })
    ).not.toBeInTheDocument();
  });

  it("移动端会把并行会话当普通工作区会话平铺展示", () => {
    contextValue.navigationGroups = [
      {
        workspace: createWorkspace("workspace-parallel", "并行项目"),
        sessions: [
          createSessionSummary({
            sessionId: "parallel-anchor",
            title: "并行锚点",
            provider: "codex",
            workspaceId: "workspace-parallel",
            parallelGroup: {
              groupId: "group-1",
              role: "anchor",
              memberCount: 2,
              sourceType: "new",
              sourceSessionId: null,
              anchorSessionId: "parallel-anchor",
              colorToken: "parallel-group-1"
            }
          }),
          createSessionSummary({
            sessionId: "parallel-member",
            title: "并行成员",
            provider: "gemini",
            workspaceId: "workspace-parallel",
            parentSessionId: null,
            displayParentSessionId: "parallel-anchor",
            parallelGroup: {
              groupId: "group-1",
              role: "member",
              memberCount: 2,
              sourceType: "new",
              sourceSessionId: null,
              anchorSessionId: "parallel-anchor",
              colorToken: "parallel-group-1"
            },
            sessionIsolatedWorkspace: {
              id: "isolated-1",
              workspaceId: "workspace-parallel-member",
              sourceWorkspaceId: "workspace-parallel",
              branchName: "parallel/member",
              lifecycleStatus: "active",
              promotedAt: null,
              createdAt: "2026-04-23T08:00:00Z",
              updatedAt: "2026-04-23T08:00:00Z"
            }
          })
        ]
      }
    ];
    contextValue.currentWorkspaceId = "workspace-parallel";
    contextValue.currentSessionId = "parallel-anchor";
    contextValue.favoriteSessionIds = [];

    renderPage({
      initialEntry: "/workspaces/workspace-parallel/sessions"
    });

    expect(
      screen.queryByRole("button", { name: /^(展开子代理列表|Expand Sub-agent List)$/ })
    ).not.toBeInTheDocument();

    const memberCard = screen.getByText("并行成员").closest(".session-list-item");

    if (!memberCard) {
      throw new Error("未找到并行成员卡片");
    }

    expect(memberCard).toHaveAttribute("data-depth", "0");
    expect(within(memberCard).queryByText(t("shell.parallelGroupBadge", { count: 2 }))).not.toBeInTheDocument();
    expect(within(memberCard).queryByText(t("shell.parallelGroupMemberBadge"))).not.toBeInTheDocument();
  });

  it("当前工作区切到子工作树后，只显示子工作树自己的会话", () => {
    contextValue.navigationGroups = [
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: createNavigationGroups()[0].sessions,
        childWorktrees: [
          createWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "登录分支"),
            displayName: "feat/login-codex",
            branchName: "feat/login-codex",
            sessions: [
              createSessionSummary({
                sessionId: "session-child",
                title: "工作树会话",
                provider: "codex",
                workspaceId: "workspace-1-child",
                lastMessageAt: "2026-03-27T11:00:00Z"
              })
            ]
          })
        ]
      },
      createNavigationGroups()[1]
    ];
    contextValue.currentWorkspaceId = "workspace-1-child";
    contextValue.currentSessionId = "session-child";

    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "feat/login-codex" })).toBeInTheDocument();

    const workspaceSection = screen.getByRole("heading", { level: 2, name: /^(当前工作区|Current Workspace)$/ }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到目标区块");
    }

    expect(within(workspaceSection).getByText("工作树会话")).toBeInTheDocument();
    expect(within(workspaceSection).queryByText("会话 Alpha")).not.toBeInTheDocument();
  });

  it("新建会话按钮会先选择工作区和供应商再调用 startDraftSession", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: t("shell.createSession") }));
    await user.click(screen.getByRole("button", { name: /^(选择工作区|Choose Workspace) 项目一$/ }));
    await user.click(screen.getByRole("button", { name: /Project Two/ }));
    await user.click(screen.getByRole("button", { name: "OpenCode" }));

    expect(contextValue.startDraftSession).toHaveBeenCalledWith("workspace-2", "opencode");
  }, 10000);

  it("列表操作按钮会调用上下文函数", async () => {
    const user = userEvent.setup();
    renderPage();

    const workspaceSection = screen.getByRole("heading", { level: 2, name: /^(当前工作区|Current Workspace)$/ }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到会话区块");
    }

    const alphaEntry = within(workspaceSection).getByText("会话 Alpha").closest("article");
    const betaEntry = within(workspaceSection).getByText("会话 Beta").closest("article");

    if (!alphaEntry || !betaEntry) {
      throw new Error("未找到会话列表项");
    }

    openSessionItemContextMenu(alphaEntry);
    const archiveButton = await screen.findByRole("menuitem", { name: /^(归档会话|Archive Session)$/ });
    await user.click(archiveButton);
    expect(contextValue.archiveSession).toHaveBeenCalledWith("session-1");

    openSessionItemContextMenu(betaEntry);
    const unfavoriteButton = await screen.findByRole("menuitem", { name: /^(取消收藏|Unpin Session|Unpin)$/ });
    await user.click(unfavoriteButton);
    expect(contextValue.toggleFavoriteSession).toHaveBeenCalledWith("session-2");

    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("New Title");
    openSessionItemContextMenu(alphaEntry);
    const renameButton = await screen.findByRole("menuitem", { name: /^(重命名|Rename)$/ });
    await user.click(renameButton);
    expect(contextValue.renameSession).toHaveBeenCalledWith("session-1", "New Title");
    promptSpy.mockRestore();
  }, 10000);

  it("查看归档会话按钮会打开归档弹窗并支持恢复", async () => {
    const user = userEvent.setup();
    contextValue.navigationGroups[0].sessions = [
      ...contextValue.navigationGroups[0].sessions,
      createSessionSummary({
        sessionId: "session-archived",
        title: "已归档会话",
        provider: "codex",
        workspaceId: "workspace-1",
        isArchived: true,
        lastMessageAt: "2026-03-27T07:00:00Z"
      })
    ];

    renderPage();

    const archiveButton = screen.getByRole("button", { name: new RegExp(t("shell.archiveViewAction")) });

    expect(archiveButton).toHaveClass("primary-button", "mobile-session-index-create-button");

    await user.click(archiveButton);

    const dialog = await screen.findByRole("dialog", { name: /^(归档会话|Archived Sessions)$/ });
    expect(within(dialog).getByText("已归档会话")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /^(取消归档|Restore from Archive)$/ }));

    expect(contextValue.unarchiveSession).toHaveBeenCalledWith("session-archived");
  }, 10000);

  it("更多操作菜单会挂到视口层并保持在屏幕范围内", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 720
    });

    renderPage();

    const workspaceSection = screen.getByRole("heading", { level: 2, name: /^(当前工作区|Current Workspace)$/ }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到会话区块");
    }

    const alphaEntry = within(workspaceSection).getByText("会话 Alpha").closest("article");

    if (!alphaEntry) {
      throw new Error("未找到 Alpha 会话");
    }

    openSessionItemContextMenu(alphaEntry, {
      x: 398,
      y: 652
    });

    const menu = screen.getByRole("menu", { name: /^(更多操作|More Actions)$/ });
    Object.defineProperty(menu, "offsetWidth", {
      configurable: true,
      get: () => 180
    });
    Object.defineProperty(menu, "offsetHeight", {
      configurable: true,
      get: () => 160
    });

    fireEvent(window, new Event("resize"));

    expect(document.body.contains(menu)).toBe(true);
    expect(menu).toHaveStyle({
      position: "fixed",
      left: "198px",
      top: "484px",
      width: "180px"
    });
  });

  it("主会话点击状态指示器后会展开和收起子会话列表", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByText("子代理 Beta-1")).not.toBeInTheDocument();

    const workspaceSection = screen.getByRole("heading", { level: 2, name: /^(当前工作区|Current Workspace)$/ }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到当前工作区会话区块");
    }

    const betaEntry = within(workspaceSection).getByText("会话 Beta").closest("article");

    if (!betaEntry) {
      throw new Error("未找到 Beta 会话");
    }

    await user.click(within(betaEntry).getByRole("button", { name: t("shell.subagentExpand") }));

    expect(within(workspaceSection).getByText("子代理 Beta-1")).toBeInTheDocument();
    expect(within(betaEntry).getByRole("button", { name: t("shell.subagentCollapse") })).toBeInTheDocument();

    await user.click(within(betaEntry).getByRole("button", { name: t("shell.subagentCollapse") }));

    expect(within(workspaceSection).queryByText("子代理 Beta-1")).not.toBeInTheDocument();
  });

  it("不会显示父会话已归档的子会话孤儿节点", () => {
    contextValue.navigationGroups[0].sessions = [
      createSessionSummary({
        sessionId: "archived-root",
        title: "已归档父会话",
        provider: "codex",
        workspaceId: "workspace-1",
        isArchived: true,
        lastMessageAt: "2026-03-27T09:30:00Z"
      }),
      createSessionSummary({
        sessionId: "orphan-subagent",
        title: "孤儿子会话",
        provider: "codex",
        workspaceId: "workspace-1",
        parentSessionId: "archived-root",
        isSubagent: true,
        subagentLabel: "worker · orphan",
        lastMessageAt: "2026-03-27T09:20:00Z"
      }),
      ...createNavigationGroups()[0].sessions
    ];

    renderPage();

    const workspaceSection = screen.getByRole("heading", { level: 2, name: /^(当前工作区|Current Workspace)$/ }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到当前工作区会话区块");
    }

    expect(within(workspaceSection).queryByText("孤儿子会话")).not.toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("子会话过多时会按页展开，避免一次性摊出整棵树", async () => {
    const user = userEvent.setup();
    contextValue.navigationGroups[0].sessions = [
      contextValue.navigationGroups[0].sessions[0],
      createSessionSummary({
        sessionId: "session-root",
        title: "主会话 Root",
        provider: "codex",
        workspaceId: "workspace-1",
        lastMessageAt: "2026-03-27T09:00:00Z"
      }),
      ...Array.from({ length: 6 }, (_, index) =>
        createSessionSummary({
          sessionId: `session-root-sub-${index + 1}`,
          title: `子代理 ${index + 1}`,
          provider: "codex",
          workspaceId: "workspace-1",
          parentSessionId: "session-root",
          isSubagent: true,
          subagentLabel: `worker · ${index + 1}`,
          lastMessageAt: `2026-03-27T0${8 - index}:00:00Z`
        })
      )
    ];

    renderPage();

    const workspaceSection = screen.getByRole("heading", { level: 2, name: /^(当前工作区|Current Workspace)$/ }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到当前工作区会话区块");
    }

    const rootEntry = within(workspaceSection).getByText("主会话 Root").closest("article");

    if (!rootEntry) {
      throw new Error("未找到 Root 会话");
    }

    await user.click(within(rootEntry).getByRole("button", { name: t("shell.subagentExpand") }));

    expect(within(workspaceSection).getByText("子代理 1")).toBeInTheDocument();
    expect(within(workspaceSection).getByText("子代理 5")).toBeInTheDocument();
    expect(within(workspaceSection).queryByText("子代理 6")).not.toBeInTheDocument();
    expect(within(workspaceSection).getByRole("button", { name: t("shell.subagentExpandMore") })).toBeInTheDocument();

    await user.click(within(workspaceSection).getByRole("button", { name: t("shell.subagentExpandMore") }));

    expect(within(workspaceSection).getByText("子代理 6")).toBeInTheDocument();
    expect(within(workspaceSection).queryByRole("button", { name: t("shell.subagentExpandMore") })).not.toBeInTheDocument();
  });

  it("移动端列表失败时只保留错误状态指示器，不显示错误摘要", () => {
    contextValue.navigationGroups[0].sessions[0] = {
      ...contextValue.navigationGroups[0].sessions[0],
      runningState: "failed",
      syncStatus: "error",
      lastErrorCode: "CODEX_HTTP_429",
      lastErrorDetail: "unexpected status 429 Too Many Requests"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    renderPage();

    expect(
      screen.queryByText(/CODEX_HTTP_429 · unexpected status 429 Too Many Requests/)
    ).not.toBeInTheDocument();
    expect(document.querySelector(".session-list-indicator.is-error")).not.toBeNull();
  });

  it("从全部会话页进入会话时，会写入沉浸模式并且不自动展开侧边会话栏", async () => {
    const user = userEvent.setup();
    renderPage({ withRouteProbe: true });

    const workspaceSection = screen.getByRole("heading", { level: 2, name: /^(当前工作区|Current Workspace)$/ }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到当前工作区会话区块");
    }

    const alphaEntry = within(workspaceSection).getByText("会话 Alpha").closest("article");

    if (!alphaEntry) {
      throw new Error("未找到 Alpha 会话");
    }

    await user.click(within(alphaEntry).getByRole("button", { name: /会话 Alpha/ }));

    expect(window.localStorage.getItem("mobile.conversation.preview.mode")).toBe("immersive");
    expect(screen.getByTestId("route-probe")).toHaveTextContent("/workspaces/workspace-1/sessions/session-1");
  });
});

function RouteProbe() {
  const location = useLocation();

  return <div data-testid="route-probe">{location.pathname}</div>;
}

function openSessionItemContextMenu(entry: HTMLElement, position: { x: number; y: number } = { x: 220, y: 220 }) {
  fireEvent.contextMenu(entry, {
    clientX: position.x,
    clientY: position.y
  });
}
