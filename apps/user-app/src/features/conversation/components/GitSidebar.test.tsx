import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../../shared/toast";
import { GitSidebar } from "./GitSidebar";

const gitApiMock = vi.hoisted(() => ({
  getGitStatus: vi.fn(),
  getGitHistory: vi.fn(),
  getGitBranches: vi.fn(),
  stageGitTargets: vi.fn(),
  unstageGitTargets: vi.fn(),
  discardGitTargets: vi.fn(),
  createCommitDraft: vi.fn(),
  commitDraft: vi.fn(),
  switchGitBranch: vi.fn(),
  syncGitRemote: vi.fn(),
  undoLastCommit: vi.fn()
}));

vi.mock("../api/git-api", () => ({
  getGitStatus: gitApiMock.getGitStatus,
  getGitHistory: gitApiMock.getGitHistory,
  getGitBranches: gitApiMock.getGitBranches,
  stageGitTargets: gitApiMock.stageGitTargets,
  unstageGitTargets: gitApiMock.unstageGitTargets,
  discardGitTargets: gitApiMock.discardGitTargets,
  createCommitDraft: gitApiMock.createCommitDraft,
  commitDraft: gitApiMock.commitDraft,
  switchGitBranch: gitApiMock.switchGitBranch,
  syncGitRemote: gitApiMock.syncGitRemote,
  undoLastCommit: gitApiMock.undoLastCommit
}));

describe("GitSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setViewportWidth(430);

    gitApiMock.getGitStatus.mockResolvedValue(createStatus());
    gitApiMock.getGitHistory.mockResolvedValue({
      items: [],
      cursor: null,
      nextCursor: null,
      totalCount: 0
    });
    gitApiMock.getGitBranches.mockResolvedValue({
      currentBranch: "main",
      local: [{ name: "main", current: true, upstream: "origin/main", remote: false }],
      remote: []
    });
    gitApiMock.stageGitTargets.mockResolvedValue(createStatus([], [
      "apps/user-app/src/app/App.tsx",
      "apps/user-app/src/app/router.tsx"
    ]));
    gitApiMock.unstageGitTargets.mockResolvedValue(createStatus());
    gitApiMock.discardGitTargets.mockResolvedValue(createStatus());
    gitApiMock.createCommitDraft.mockResolvedValue({
      draft: { subject: "", body: null, footer: null, source: "ai" },
      ruleProfile: {
        id: "rule-1",
        workspaceId: "workspace-1",
        name: "default",
        subjectPattern: ".*",
        maxSubjectLength: 72,
        language: "zh",
        requireBody: false,
        requireIssue: false,
        issuePattern: null,
        updatedAt: "2026-03-25T00:00:00.000Z"
      },
      validation: {
        passed: true,
        errors: [],
        warnings: [],
        normalizedDraft: { subject: "", body: null, footer: null, source: "ai" }
      }
    });
    gitApiMock.commitDraft.mockResolvedValue({
      commitHash: "abc123",
      ruleProfile: {
        id: "rule-1",
        workspaceId: "workspace-1",
        name: "default",
        subjectPattern: ".*",
        maxSubjectLength: 72,
        language: "zh",
        requireBody: false,
        requireIssue: false,
        issuePattern: null,
        updatedAt: "2026-03-25T00:00:00.000Z"
      },
      validation: {
        passed: true,
        errors: [],
        warnings: [],
        normalizedDraft: { subject: "", body: null, footer: null, source: "manual" }
      }
    });
    gitApiMock.switchGitBranch.mockResolvedValue({
      currentBranch: "main",
      local: [{ name: "main", current: true, upstream: "origin/main", remote: false }],
      remote: []
    });
    gitApiMock.syncGitRemote.mockResolvedValue({
      action: "push",
      summary: "ok",
      stdout: "",
      stderr: ""
    });
    gitApiMock.undoLastCommit.mockResolvedValue({
      summary: "ok",
      commitHash: "abc123"
    });
  });

  it("移动端先勾选文件后才显示组级操作菜单，并支持多选暂存", async () => {
    renderSidebar();

    const unstagedGroup = await findGroup("当前变更");

    expect(
      within(unstagedGroup).queryByRole("button", { name: "操作菜单" })
    ).not.toBeInTheDocument();
    expect(within(unstagedGroup).queryByRole("button", { name: "暂存" })).not.toBeInTheDocument();

    await userEvent.click(
      within(unstagedGroup).getByRole("checkbox", { name: "选中文件 App.tsx" })
    );
    await userEvent.click(
      within(unstagedGroup).getByRole("checkbox", { name: "选中文件 router.tsx" })
    );

    const actionMenuButton = within(unstagedGroup).getByRole("button", { name: "操作菜单" });
    await userEvent.click(actionMenuButton);
    await userEvent.click(within(unstagedGroup).getByRole("button", { name: "暂存" }));

    await waitFor(() => {
      expect(gitApiMock.stageGitTargets).toHaveBeenCalledWith("workspace-1", [
        "apps/user-app/src/app/App.tsx",
        "apps/user-app/src/app/router.tsx"
      ]);
    });
  });
});

function renderSidebar() {
  render(
    <ToastProvider>
      <GitSidebar workspaceId="workspace-1" />
    </ToastProvider>
  );
}

async function findGroup(title: string) {
  const heading = await screen.findByRole("heading", { name: title });
  return heading.closest("section") as HTMLElement;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width
  });
}

function createStatus(unstagedPaths = [
  "apps/user-app/src/app/App.tsx",
  "apps/user-app/src/app/router.tsx"
], stagedPaths: string[] = []) {
  return {
    snapshot: {
      workspaceId: "workspace-1",
      repoRoot: "C:/Code/CodingNS",
      branch: "main",
      ahead: 0,
      behind: 0,
      hasRemote: true,
      isDirty: unstagedPaths.length + stagedPaths.length > 0,
      lastFetchedAt: null
    },
    changes: [
      ...stagedPaths.map((path) => createChange(path, true)),
      ...unstagedPaths.map((path) => createChange(path, false))
    ]
  };
}

function createChange(path: string, staged: boolean) {
  return {
    path,
    status: "M",
    staged,
    oldPath: null,
    binary: false,
    stagedStatus: staged ? "M" : null,
    worktreeStatus: staged ? null : "M"
  };
}
