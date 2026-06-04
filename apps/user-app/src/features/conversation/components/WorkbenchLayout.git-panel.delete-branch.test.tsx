import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import {
  MockWebSocket,
  createJsonResponse,
  createSessionSummary,
  createWorkbenchSnapshot,
  createWorkbenchWorktreeNode,
  createWorkspace,
  registerWorkbenchLayoutTestHooks,
  renderWorkbenchRoute
} from "./WorkbenchLayout.test-support";

async function openGitTab() {
  await userEvent.click(await screen.findByRole("tab", { name: t("shell.gitEntry") }));
}

async function openWorktreeMergeDetails() {
  await openGitTab();
  const summaryButton = await screen.findByRole("button", {
    name: /展开详情|收起详情/
  });

  if (summaryButton.getAttribute("aria-expanded") === "true") {
    return;
  }

  await userEvent.click(summaryButton);

  await waitFor(() => {
    expect(summaryButton).toHaveAttribute("aria-expanded", "true");
  });
}

describe("WorkbenchLayout deleteBranch cleanup", () => {
  registerWorkbenchLayoutTestHooks();

  it("已合并时勾选删除分支，会把 deleteBranch=true 传给 cleanup 接口", async () => {
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
    const cleanupPayloads: Array<{ deleteBranch?: boolean }> = [];

    global.fetch = vi.fn(async (rawInput: RequestInfo | URL, rawInit?: RequestInit) => {
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
        cleanupPayloads.push(
          rawInit?.body ? (JSON.parse(String(rawInit.body)) as { deleteBranch?: boolean }) : {}
        );
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
          branchDeleteRequested: true,
          branchDeleted: true,
          deletedBranchName: "mdg/test",
          branchDeleteError: null,
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

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("shell.worktreeCleanupAction") })).toBeEnabled();
    });

    await userEvent.click(screen.getByRole("button", { name: t("shell.worktreeCleanupAction") }));

    const cleanupDialog = screen.getByRole("dialog", {
      name: t("shell.worktreeCleanupModalTitle")
    });
    const deleteBranchCheckbox = within(cleanupDialog).getByRole("checkbox", {
      name: t("shell.worktreeCleanupDeleteBranchLabel", { branch: "mdg/test" })
    });

    expect(deleteBranchCheckbox).toBeEnabled();

    await userEvent.click(deleteBranchCheckbox);
    await userEvent.click(
      within(cleanupDialog).getByRole("button", {
        name: t("shell.worktreeCleanupDeleteBranchAction")
      })
    );

    await waitFor(() => {
      expect(cleanupPayloads).toEqual([{ deleteBranch: true }]);
    });
  });
});
