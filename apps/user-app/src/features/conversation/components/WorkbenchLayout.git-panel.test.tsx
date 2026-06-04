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

async function openGitTab() {
  await userEvent.click(await screen.findByRole("tab", { name: t("shell.gitEntry") }));
}

async function openWorktreeMergeDetails() {
  await openGitTab();
  const collapseMatcher = new RegExp(t("shell.worktreeMergeCollapseDetails"));
  const expandMatcher = new RegExp(t("shell.worktreeMergeExpandDetails"));

  if (screen.queryByRole("button", { name: collapseMatcher })) {
    return;
  }

  const expandButton = screen.queryByRole("button", { name: expandMatcher });

  if (expandButton) {
    await userEvent.click(expandButton);
    return;
  }

  const panelLabel = await screen.findByText(t("shell.worktreeMergePanelLabel"));
  const summaryButton = panelLabel.closest("button");

  if (!(summaryButton instanceof HTMLButtonElement)) {
    throw new Error("未找到工作树合并摘要按钮");
  }

  await userEvent.click(summaryButton);
  await screen.findByRole("button", { name: collapseMatcher });
}

describe("WorkbenchLayout", () => {
  registerWorkbenchLayoutTestHooks();

  it("当前工作区是子工作树时，右侧信息栏会显示合并回父节点预检卡片", async () => {
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

      if (url.endsWith("/api/worktrees/workspace-1-child/merge-preview")) {
        return createJsonResponse({
          workspaceId: "workspace-1-child",
          sourceWorkspace: createWorkspace("workspace-1-child", "登录分支"),
          targetWorkspace: createWorkspace("workspace-1", "项目一"),
          meta: {
            workspaceId: "workspace-1-child",
            rootWorkspaceId: "workspace-1",
            parentWorkspaceId: "workspace-1",
            sourceWorkspaceId: "workspace-1",
            mergeTargetWorkspaceId: "workspace-1",
            branchName: "feat/login-codex",
            baseRef: "main",
            baseCommit: "abc12345",
            headCommit: "def67890",
            displayName: "feat/login-codex",
            depth: 1,
            lifecycleStatus: "active",
            mergedAt: null,
            removedAt: null,
            createdAt: "2026-04-12T12:00:00.000Z",
            updatedAt: "2026-04-12T12:00:00.000Z"
          },
          sourceBranchName: "feat/login-codex",
          targetBranchName: "main",
          sourceHeadCommit: "def67890",
          targetHeadCommit: "abc12345",
          mergeBaseCommit: "abc12345",
          ahead: 2,
          behind: 0,
          hasConflicts: false,
          conflictPaths: [],
          alreadyMerged: false,
          canMerge: true,
          blockers: []
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1-child/sessions/session-child");
    await userEvent.click(screen.getByRole("tab", { name: t("shell.gitEntry") }));

    expect(await screen.findByText(t("shell.worktreeMergeCompactPending"))).toBeInTheDocument();
    expect(
      screen.queryByText(t("shell.worktreeMergePanelSummary", { source: "feat/login-codex", target: "项目一" }))
    ).toBeNull();

    const detailToggle = screen.getByRole("button", {
      name: new RegExp(t("shell.worktreeMergeExpandDetails"))
    });
    expect(detailToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: t("shell.worktreeMergeApplyAction") })).not.toBeInTheDocument();

    await userEvent.click(detailToggle);

    expect(
      screen.getByRole("button", { name: new RegExp(t("shell.worktreeMergeCollapseDetails")) })
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.queryByText(t("shell.worktreeMergePanelSummary", { source: "feat/login-codex", target: "项目一" }))
    ).toBeNull();
    expect(screen.queryByLabelText(t("shell.worktreeMergeChecklistTitle"))).toBeNull();
    expect(screen.getByText(t("shell.worktreeMergeCurrentBranch", { branch: "feat/login-codex" }))).toBeInTheDocument();
    expect(screen.getByText(t("shell.worktreeMergeParentBranch", { branch: "main" }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.worktreeMergePreviewAction") })).toBeEnabled();
    expect(screen.getByRole("button", { name: t("shell.worktreeMergeApplyAction") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("shell.worktreeCleanupAction") })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: t("shell.worktreeMergePreviewAction") }));

    expect(await screen.findByLabelText(t("shell.worktreeMergeChecklistTitle"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.worktreeMergeApplyAction") })).toBeEnabled();
  });

  it("工作树合并状态只在 GIT 管理页签显示", async () => {
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

      if (url.endsWith("/api/worktrees/workspace-1-child/merge-preview")) {
        return createJsonResponse({
          workspaceId: "workspace-1-child",
          sourceWorkspace: createWorkspace("workspace-1-child", "登录分支"),
          targetWorkspace: createWorkspace("workspace-1", "项目一"),
          meta: {
            workspaceId: "workspace-1-child",
            rootWorkspaceId: "workspace-1",
            parentWorkspaceId: "workspace-1",
            sourceWorkspaceId: "workspace-1",
            mergeTargetWorkspaceId: "workspace-1",
            branchName: "feat/login-codex",
            baseRef: "main",
            baseCommit: "abc12345",
            headCommit: "def67890",
            displayName: "feat/login-codex",
            depth: 1,
            lifecycleStatus: "active",
            mergedAt: null,
            removedAt: null,
            createdAt: "2026-04-12T12:00:00.000Z",
            updatedAt: "2026-04-12T12:00:00.000Z"
          },
          sourceBranchName: "feat/login-codex",
          targetBranchName: "main",
          sourceHeadCommit: "def67890",
          targetHeadCommit: "abc12345",
          mergeBaseCommit: "abc12345",
          ahead: 2,
          behind: 0,
          hasConflicts: false,
          conflictPaths: [],
          alreadyMerged: false,
          canMerge: true,
          blockers: []
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1-child/sessions/session-child");

    expect(screen.queryByText(t("shell.worktreeMergePanelLabel"))).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: t("shell.gitEntry") }));

    expect(await screen.findByText(t("shell.worktreeMergePanelLabel"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: t("shell.terminalManagerEntry") }));

    await waitFor(() => {
      expect(screen.queryByText(t("shell.worktreeMergePanelLabel"))).toBeNull();
    });
  });

  it("并行会话升级成子工作区后，右侧辅助栏会切到子工作区上下文，并在并行态自动隐藏", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      role: "member" as const,
      memberCount: 2,
      sourceType: "new" as const,
      sourceSessionId: null,
      anchorSessionId: "session-anchor",
      colorToken: "parallel-group-1"
    };
    const promotedWorkspace = {
      id: "isolated-1",
      workspaceId: "workspace-1-child",
      sourceWorkspaceId: "workspace-1",
      branchName: "parallel/member-1",
      lifecycleStatus: "promoted" as const,
      promotedAt: "2026-04-24T08:30:00.000Z",
      createdAt: "2026-04-24T08:00:00.000Z",
      updatedAt: "2026-04-24T08:30:00.000Z"
    };
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-parallel",
            title: "并行成员",
            workspaceId: "workspace-1",
            parallelGroup,
            sessionIsolatedWorkspace: promotedWorkspace
          })
        ],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "并行成员工作区"),
            displayName: "parallel/member-1",
            branchName: "parallel/member-1",
            sessions: []
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

    await renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-parallel");
    await openGitTab();

    const auxiliary = document.querySelector(".workbench-auxiliary");
    expect(auxiliary).toHaveAttribute("data-workspace-tone", "worktree");
    expect(auxiliary).toHaveAttribute("data-auto-hidden", "true");
    expect(auxiliary).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByText(t("shell.worktreeMergePanelLabel"))).toBeNull();
  });

  it("不会仅凭工作树生命周期状态就误判已经合回父工作区", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "登录分支"),
            displayName: "test-mdg",
            branchName: "test-mdg",
            lifecycleStatus: "merged",
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

      if (url.endsWith("/api/worktrees/workspace-1-child/merge-preview")) {
        return createJsonResponse({
          workspaceId: "workspace-1-child",
          sourceWorkspace: createWorkspace("workspace-1-child", "登录分支"),
          targetWorkspace: createWorkspace("workspace-1", "项目一"),
          meta: {
            workspaceId: "workspace-1-child",
            rootWorkspaceId: "workspace-1",
            parentWorkspaceId: "workspace-1",
            sourceWorkspaceId: "workspace-1",
            mergeTargetWorkspaceId: "workspace-1",
            branchName: "test-mdg",
            baseRef: "main",
            baseCommit: "abc12345",
            headCommit: "def67890",
            displayName: "test-mdg",
            depth: 1,
            lifecycleStatus: "merged",
            mergedAt: null,
            removedAt: null,
            createdAt: "2026-04-12T12:00:00.000Z",
            updatedAt: "2026-04-12T12:00:00.000Z"
          },
          sourceBranchName: "test-mdg",
          targetBranchName: "main",
          sourceHeadCommit: "def67890",
          targetHeadCommit: "abc12345",
          mergeBaseCommit: "abc12345",
          ahead: 2,
          behind: 0,
          hasConflicts: false,
          conflictPaths: [],
          alreadyMerged: false,
          canMerge: true,
          blockers: []
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1-child/sessions/session-child");
    await openWorktreeMergeDetails();
    await userEvent.click(screen.getByRole("button", { name: t("shell.worktreeMergePreviewAction") }));

    expect(await screen.findByText(t("shell.worktreeMergeCompactReady"))).toBeInTheDocument();
    expect(screen.queryByText(t("shell.worktreeMergeAlreadyMerged"))).toBeNull();
  });

  it("已进入父分支但子工作区仍有未提交改动时，摘要优先显示阻塞状态而不是已合并", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "登录分支"),
            displayName: "test-mdg",
            branchName: "mdg/test",
            lifecycleStatus: "merged",
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

      if (url.endsWith("/api/worktrees/workspace-1-child/merge-preview")) {
        return createJsonResponse({
          workspaceId: "workspace-1-child",
          sourceWorkspace: createWorkspace("workspace-1-child", "登录分支"),
          targetWorkspace: createWorkspace("workspace-1", "项目一"),
          meta: {
            workspaceId: "workspace-1-child",
            rootWorkspaceId: "workspace-1",
            parentWorkspaceId: "workspace-1",
            sourceWorkspaceId: "workspace-1",
            mergeTargetWorkspaceId: "workspace-1",
            branchName: "mdg/test",
            baseRef: "main",
            baseCommit: "abc12345",
            headCommit: "def67890",
            displayName: "test-mdg",
            depth: 1,
            lifecycleStatus: "merged",
            mergedAt: "2026-04-13T10:00:00.000Z",
            removedAt: null,
            createdAt: "2026-04-12T12:00:00.000Z",
            updatedAt: "2026-04-13T10:00:00.000Z"
          },
          sourceBranchName: "mdg/test",
          targetBranchName: "main",
          sourceHeadCommit: "def67890",
          targetHeadCommit: "def67890",
          mergeBaseCommit: "def67890",
          ahead: 0,
          behind: 0,
          hasConflicts: false,
          conflictPaths: [],
          alreadyMerged: true,
          canMerge: false,
          blockers: [
            {
              code: "SOURCE_DIRTY",
              detail: "当前子工作树存在未提交改动，先提交或清理后再合并"
            }
          ]
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1-child/sessions/session-child");
    await openWorktreeMergeDetails();
    await userEvent.click(screen.getByRole("button", { name: t("shell.worktreeMergePreviewAction") }));

    expect(await screen.findByText(t("shell.worktreeMergeCompactDirty"))).toBeInTheDocument();
    expect(screen.queryByText(t("shell.worktreeMergeCompactMerged"))).toBeNull();

    expect(screen.getByText(t("shell.worktreeMergeBlocked"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.worktreeMergeCurrentBranch", { branch: "mdg/test" }))).toBeInTheDocument();
    expect(screen.getByText(t("shell.worktreeMergeParentBranch", { branch: "main" }))).toBeInTheDocument();
    expect(screen.getByText(t("shell.worktreeMergeChecklistSourceClean"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.worktreeMergeChecklistSourceCleanBlocked"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.worktreeMergeChecklistResultBlocked"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.worktreeMergeChecklistResultBlockedDetail"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.worktreeMergePreviewAction") })).toBeEnabled();
    expect(screen.getByRole("button", { name: t("shell.worktreeMergeApplyAction") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("shell.worktreeCleanupAction") })).toBeDisabled();
  });

  it("没有领先父分支提交时，不能把待合并提交错误显示为已满足", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "登录分支"),
            displayName: "test-mdg",
            branchName: "mdg/test",
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

      if (url.endsWith("/api/worktrees/workspace-1-child/merge-preview")) {
        return createJsonResponse({
          workspaceId: "workspace-1-child",
          sourceWorkspace: createWorkspace("workspace-1-child", "登录分支"),
          targetWorkspace: createWorkspace("workspace-1", "项目一"),
          meta: {
            workspaceId: "workspace-1-child",
            rootWorkspaceId: "workspace-1",
            parentWorkspaceId: "workspace-1",
            sourceWorkspaceId: "workspace-1",
            mergeTargetWorkspaceId: "workspace-1",
            branchName: "mdg/test",
            baseRef: "main",
            baseCommit: "abc12345",
            headCommit: "def67890",
            displayName: "test-mdg",
            depth: 1,
            lifecycleStatus: "active",
            mergedAt: null,
            removedAt: null,
            createdAt: "2026-04-12T12:00:00.000Z",
            updatedAt: "2026-04-13T10:00:00.000Z"
          },
          sourceBranchName: "mdg/test",
          targetBranchName: "main",
          sourceHeadCommit: "def67890",
          targetHeadCommit: "9876abcd",
          mergeBaseCommit: "d6d8eb49",
          ahead: 0,
          behind: 1,
          hasConflicts: false,
          conflictPaths: [],
          alreadyMerged: false,
          canMerge: false,
          blockers: []
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1-child/sessions/session-child");
    expect(await screen.findByRole("tab", { name: t("shell.gitEntry") })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: t("shell.gitEntry") }));
    await userEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("shell.worktreeMergeExpandDetails"))
      })
    );
    await userEvent.click(screen.getByRole("button", { name: t("shell.worktreeMergePreviewAction") }));

    expect(screen.getByText(t("shell.worktreeMergeBlocked"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.worktreeMergeChecklistCommits"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.worktreeMergeChecklistCommitsBlocked"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.worktreeMergeChecklistResultBlocked"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.worktreeMergeApplyAction") })).toBeDisabled();
  });

  it("后端返回 SOURCE_NOT_ACTIVE 时，会明确展示工作树状态异常", async () => {
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "登录分支"),
            displayName: "test-mdg",
            branchName: "mdg/test",
            lifecycleStatus: "merged",
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

      if (url.endsWith("/api/worktrees/workspace-1-child/merge-preview")) {
        return createJsonResponse({
          workspaceId: "workspace-1-child",
          sourceWorkspace: createWorkspace("workspace-1-child", "登录分支"),
          targetWorkspace: createWorkspace("workspace-1", "项目一"),
          meta: {
            workspaceId: "workspace-1-child",
            rootWorkspaceId: "workspace-1",
            parentWorkspaceId: "workspace-1",
            sourceWorkspaceId: "workspace-1",
            mergeTargetWorkspaceId: "workspace-1",
            branchName: "mdg/test",
            baseRef: "main",
            baseCommit: "abc12345",
            headCommit: "def67890",
            displayName: "test-mdg",
            depth: 1,
            lifecycleStatus: "merged",
            mergedAt: "2026-04-13T10:00:00.000Z",
            removedAt: null,
            createdAt: "2026-04-12T12:00:00.000Z",
            updatedAt: "2026-04-13T10:00:00.000Z"
          },
          sourceBranchName: "mdg/test",
          targetBranchName: "main",
          sourceHeadCommit: "def67890",
          targetHeadCommit: "abc12345",
          mergeBaseCommit: "abc12345",
          ahead: 1,
          behind: 0,
          hasConflicts: false,
          conflictPaths: [],
          alreadyMerged: false,
          canMerge: false,
          blockers: [
            {
              code: "SOURCE_NOT_ACTIVE",
              detail: "当前子工作树不是活跃状态，不能继续合并"
            }
          ]
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1-child/sessions/session-child");
    expect(await screen.findByRole("tab", { name: t("shell.gitEntry") })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: t("shell.gitEntry") }));
    await userEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("shell.worktreeMergeExpandDetails"))
      })
    );
    await userEvent.click(screen.getByRole("button", { name: t("shell.worktreeMergePreviewAction") }));

    expect(await screen.findByText(t("shell.worktreeMergeCompactInactive"))).toBeInTheDocument();

    expect(screen.getByText(t("shell.worktreeMergeChecklistSourceState"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.worktreeMergeChecklistSourceStateBlocked"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.worktreeMergeChecklistResultBlocked"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.worktreeMergeApplyAction") })).toBeDisabled();
  });

  it("清理工作树前会先打开内置确认模态框，再执行 cleanup 接口", async () => {
    let currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "登录分支"),
            displayName: "test-mdg",
            branchName: "mdg/test",
            lifecycleStatus: "merged",
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
    const cleanupCalls: string[] = [];

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.endsWith("/api/worktrees/workspace-1-child/merge-preview")) {
        return createJsonResponse({
          workspaceId: "workspace-1-child",
          sourceWorkspace: createWorkspace("workspace-1-child", "登录分支"),
          targetWorkspace: createWorkspace("workspace-1", "项目一"),
          meta: {
            workspaceId: "workspace-1-child",
            rootWorkspaceId: "workspace-1",
            parentWorkspaceId: "workspace-1",
            sourceWorkspaceId: "workspace-1",
            mergeTargetWorkspaceId: "workspace-1",
            branchName: "mdg/test",
            baseRef: "main",
            baseCommit: "abc12345",
            headCommit: "def67890",
            displayName: "test-mdg",
            depth: 1,
            lifecycleStatus: "merged",
            mergedAt: "2026-04-13T12:27:38.000Z",
            removedAt: null,
            createdAt: "2026-04-12T12:00:00.000Z",
            updatedAt: "2026-04-13T12:27:38.000Z"
          },
          sourceBranchName: "mdg/test",
          targetBranchName: "main",
          sourceHeadCommit: "d6d8eb49",
          targetHeadCommit: "1a6a680e",
          mergeBaseCommit: "d6d8eb49",
          ahead: 0,
          behind: 1,
          hasConflicts: false,
          conflictPaths: [],
          alreadyMerged: true,
          canMerge: false,
          blockers: []
        });
      }

      if (url.endsWith("/api/worktrees/workspace-1-child/cleanup")) {
        cleanupCalls.push(url);
        currentSnapshot = createWorkbenchSnapshot([
          {
            workspace: createWorkspace("workspace-1", "项目一"),
            sessions: []
          }
        ]);
        MockWebSocket.workbenchSnapshot = currentSnapshot;

        return createJsonResponse({
          workspaceId: "workspace-1-child",
          removed: true,
          meta: {
            workspaceId: "workspace-1-child",
            rootWorkspaceId: "workspace-1",
            parentWorkspaceId: "workspace-1",
            sourceWorkspaceId: "workspace-1",
            mergeTargetWorkspaceId: "workspace-1",
            branchName: "mdg/test",
            baseRef: "main",
            baseCommit: "abc12345",
            headCommit: "d6d8eb49",
            displayName: "test-mdg",
            depth: 1,
            lifecycleStatus: "removed",
            mergedAt: "2026-04-13T12:27:38.000Z",
            removedAt: "2026-04-13T12:28:00.000Z",
            createdAt: "2026-04-12T12:00:00.000Z",
            updatedAt: "2026-04-13T12:28:00.000Z"
          }
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    await renderWorkbenchRoute("/workspaces/workspace-1-child/sessions/session-child");
    await openWorktreeMergeDetails();
    await userEvent.click(screen.getByRole("button", { name: t("shell.worktreeMergePreviewAction") }));

    const cleanupButton = screen.getByRole("button", { name: t("shell.worktreeCleanupAction") });
    expect(cleanupButton).toBeEnabled();

    await userEvent.click(cleanupButton);

    expect(
      screen.getByRole("dialog", {
        name: t("shell.worktreeCleanupModalTitle")
      })
    ).toBeInTheDocument();
    expect(cleanupCalls).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: t("common.cancel") }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", {
          name: t("shell.worktreeCleanupModalTitle")
        })
      ).toBeNull();
    });
    expect(cleanupCalls).toHaveLength(0);

    await userEvent.click(screen.getAllByRole("button", { name: t("shell.worktreeCleanupAction") })[0]);
    const cleanupDialog = screen.getByRole("dialog", {
      name: t("shell.worktreeCleanupModalTitle")
    });
    await userEvent.click(within(cleanupDialog).getByRole("button", { name: t("shell.worktreeCleanupAction") }));

    await waitFor(() => {
      expect(cleanupCalls).toHaveLength(1);
      expect(
        screen.queryByRole("dialog", {
          name: t("shell.worktreeCleanupModalTitle")
        })
      ).toBeNull();
    });
  });

});
