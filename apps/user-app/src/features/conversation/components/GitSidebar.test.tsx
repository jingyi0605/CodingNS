import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
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

const workbenchShellMock = vi.hoisted(() => ({
  subscribeGitSnapshot: vi.fn(),
  requestGitRefresh: vi.fn(),
  addGitSnapshotListener: vi.fn()
}));
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());
const GIT_SIDEBAR_SNAPSHOT_KEY = "git-sidebar.snapshot.workspace-1";

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

vi.mock("./WorkbenchLayout", () => ({
  useWorkbenchShell: () => workbenchShellMock
}));

describe("GitSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setViewportWidth(430);
    window.sessionStorage.clear();
    clearViewSnapshot(GIT_SIDEBAR_SNAPSHOT_KEY);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    });

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
      commitHash: "abc123",
      commitSubject: "feat: restore message"
    });
    workbenchShellMock.subscribeGitSnapshot.mockImplementation(() => undefined);
    workbenchShellMock.requestGitRefresh.mockImplementation(() => undefined);
    workbenchShellMock.addGitSnapshotListener.mockImplementation((listener: (snapshot: ReturnType<typeof createGitSnapshot>) => void) => {
      listener(createGitSnapshot());
      return () => undefined;
    });
  });

  it("移动端多选文件后会显示选择工具条，并支持批量暂存", async () => {
    renderSidebar();

    const unstagedGroup = await findGroup("当前变更");

    expect(within(unstagedGroup).queryByText(/已选文件\s*2/)).not.toBeInTheDocument();

    await userEvent.click(
      within(unstagedGroup).getByRole("checkbox", { name: "选中文件 App.tsx" })
    );
    await userEvent.click(
      within(unstagedGroup).getByRole("checkbox", { name: "选中文件 router.tsx" })
    );

    const selectionToolbar = unstagedGroup.querySelector(".git-mobile-selection-toolbar") as HTMLElement | null;

    expect(selectionToolbar).not.toBeNull();
    expect(within(selectionToolbar as HTMLElement).getByText(/已选文件\s*2/)).toBeInTheDocument();

    await userEvent.click(
      within(selectionToolbar as HTMLElement).getByRole("button", { name: "暂存" })
    );

    await waitFor(() => {
      expect(gitApiMock.stageGitTargets).toHaveBeenCalledWith("workspace-1", [
        "apps/user-app/src/app/App.tsx",
        "apps/user-app/src/app/router.tsx"
      ]);
    });

    await waitFor(() => {
      expect(within(unstagedGroup).queryByText(/已选文件\s*2/)).not.toBeInTheDocument();
    });
  });

  it("命中新鲜缓存时不会在挂载后立刻主动刷新", async () => {
    seedGitSidebarSnapshot();

    renderSidebar();

    expect(await screen.findByText("App.tsx")).toBeInTheDocument();
    expect(workbenchShellMock.subscribeGitSnapshot).toHaveBeenCalledWith("workspace-1");
    expect(workbenchShellMock.requestGitRefresh).not.toHaveBeenCalled();
  });

  it("撤销上次提交后会把提交标题回填到输入框", async () => {
    setViewportWidth(1280);
    renderSidebar();

    await userEvent.click(await screen.findByRole("button", { name: "操作菜单" }));
    await userEvent.click(await screen.findByRole("button", { name: "撤销上次提交" }));

    await waitFor(() => {
      expect(gitApiMock.undoLastCommit).toHaveBeenCalledWith("workspace-1");
    });

    expect(await screen.findByDisplayValue("feat: restore message")).toBeInTheDocument();
  });

  it("提交输入框使用自增长 textarea，并保持单行提交标题语义", async () => {
    renderSidebar();

    const editor = await screen.findByRole("textbox");

    expect(editor.tagName).toBe("TEXTAREA");

    await userEvent.type(editor, "feat: first line{enter}second line");

    expect(editor).toHaveValue("feat: first linesecond line");
  });

  it("最近版本列表会渲染本地远程状态和远程标签", async () => {
    renderSidebar();

    const changesToggle = await screen.findByRole("button", { name: /当前变更/ });
    const stagedToggle = await screen.findByRole("button", { name: /暂存的更改/ });
    const historyToggle = await screen.findByRole("button", { name: /最近版本/ });

    expect(changesToggle).toHaveAttribute("aria-expanded", "true");
    expect(stagedToggle).toHaveAttribute("aria-expanded", "false");
    expect(historyToggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(historyToggle);

    expect(historyToggle).toHaveAttribute("aria-expanded", "true");
    expect(changesToggle).toHaveAttribute("aria-expanded", "false");
    expect(stagedToggle).toHaveAttribute("aria-expanded", "false");
    expect(await screen.findByText("feat: local only")).toBeInTheDocument();
    expect(screen.getByText("本地")).toBeInTheDocument();
    expect(screen.getByText("远程")).toBeInTheDocument();
    expect(screen.getByText("已同步")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("upstream/release")).toBeInTheDocument();
  });

  it("移动端三区块标题始终可见，并且只允许展开一个区块", async () => {
    renderSidebar();

    const stagedToggle = await screen.findByRole("button", { name: /暂存的更改/ });
    const changesToggle = await screen.findByRole("button", { name: /当前变更/ });
    const historyToggle = await screen.findByRole("button", { name: /最近版本/ });

    expect(stagedToggle).toBeVisible();
    expect(changesToggle).toBeVisible();
    expect(historyToggle).toBeVisible();

    await userEvent.click(stagedToggle);

    expect(stagedToggle).toHaveAttribute("aria-expanded", "true");
    expect(changesToggle).toHaveAttribute("aria-expanded", "false");
    expect(historyToggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(historyToggle);

    expect(stagedToggle).toHaveAttribute("aria-expanded", "false");
    expect(changesToggle).toHaveAttribute("aria-expanded", "false");
    expect(historyToggle).toHaveAttribute("aria-expanded", "true");
  });

  it("点击刷新会直接重新拉取 Git 快照并同步实时订阅", async () => {
    gitApiMock.getGitStatus.mockResolvedValueOnce(createStatus(["docs/refresh-target.md"]));
    gitApiMock.getGitHistory.mockResolvedValueOnce({
      items: [
        {
          commitHash: "44444444",
          authorName: "Linus",
          authoredAt: "2026-03-26T08:00:00.000Z",
          subject: "feat: refreshed snapshot",
          body: "",
          commitKind: "local",
          refs: [{ name: "feature/refresh", kind: "head", remoteName: null }]
        }
      ],
      cursor: "0",
      nextCursor: null,
      totalCount: 1
    });
    gitApiMock.getGitBranches.mockResolvedValueOnce({
      currentBranch: "feature/refresh",
      local: [{ name: "feature/refresh", current: true, upstream: null, remote: false }],
      remote: []
    });
    seedGitSidebarSnapshot();

    renderSidebar();

    expect(await screen.findByText("App.tsx")).toBeInTheDocument();

    const refreshButton = await screen.findByRole("button", { name: "刷新" });

    expect(refreshButton).not.toBeDisabled();
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(gitApiMock.getGitStatus).toHaveBeenCalledWith("workspace-1");
      expect(gitApiMock.getGitHistory).toHaveBeenCalledWith("workspace-1", 20, null);
      expect(gitApiMock.getGitBranches).toHaveBeenCalledWith("workspace-1");
    });

    await waitFor(() => {
      expect(refreshButton).not.toBeDisabled();
    });

    expect(screen.getByText("refresh-target.md")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /最近版本/ }));
    expect(await screen.findByText("feat: refreshed snapshot")).toBeInTheDocument();
    expect(workbenchShellMock.requestGitRefresh).toHaveBeenCalledWith("workspace-1");
  });

  it("移动端未提交记录的放弃改动操作会二次确认", async () => {
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSidebar();

    const title = await screen.findByText("App.tsx");
    const swipeRow = title.closest(".git-mobile-swipe-row") as HTMLElement | null;
    const swipeContent = swipeRow?.querySelector(".git-mobile-swipe-content") as HTMLElement | null;

    expect(swipeRow).not.toBeNull();
    expect(swipeContent).not.toBeNull();

    fireEvent.pointerDown(swipeContent as HTMLElement, {
      button: 0,
      pointerId: 1,
      clientX: 120
    });
    fireEvent.pointerMove(swipeContent as HTMLElement, {
      pointerId: 1,
      clientX: 56
    });
    fireEvent.pointerUp(swipeContent as HTMLElement, {
      pointerId: 1,
      clientX: 56
    });

    fireEvent.click(within(swipeRow as HTMLElement).getByRole("button", { name: "放弃改动" }));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith("确认放弃这些改动吗？apps/user-app/src/app/App.tsx");
      expect(gitApiMock.discardGitTargets).toHaveBeenCalledWith("workspace-1", [
        "apps/user-app/src/app/App.tsx"
      ]);
    });

    confirmMock.mockRestore();
  });

  it("移动端最近版本条目提供操作菜单，并支持复制 Commit Hash", async () => {
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: /最近版本/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "版本操作" })[0]);

    expect(screen.getByRole("button", { name: "复制 Commit Hash" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制提交标题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤销上次提交" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制 Commit Hash" }));

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith("33333333");
    });
  });

  it("移动端最近版本标题右侧提供 Git 操作菜单，并复用桌面端菜单内容", async () => {
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: /最近版本/ }));
    fireEvent.click(screen.getByRole("button", { name: "操作菜单" }));

    const operationsShell = document.querySelector(".git-mobile-operations-shell") as HTMLElement;

    expect(operationsShell).not.toBeNull();
    expect(within(operationsShell).getByRole("button", { name: "Fetch" })).toBeInTheDocument();
    expect(within(operationsShell).getByRole("button", { name: "Pull" })).toBeInTheDocument();
    expect(within(operationsShell).getByRole("button", { name: "Push" })).toBeInTheDocument();
    expect(within(operationsShell).getByRole("button", { name: "撤销上次提交" })).toBeInTheDocument();
    expect(within(operationsShell).getByRole("button", { name: "刷新" })).toBeInTheDocument();
  });

  it("已暂存后再次编辑的文件会同时出现在暂存区和当前变更", async () => {
    setViewportWidth(1280);
    workbenchShellMock.addGitSnapshotListener.mockImplementation((listener: (snapshot: ReturnType<typeof createGitSnapshot>) => void) => {
      listener(
        createGitSnapshot(
          createStatus([], [], [
            "apps/user-app/src/app/App.tsx"
          ])
        )
      );
      return () => undefined;
    });

    renderSidebar();

    const stagedGroup = await findGroup("暂存的更改");
    const unstagedGroup = await findGroup("当前变更");

    expect(within(stagedGroup).getByText("App.tsx")).toBeInTheDocument();
    expect(within(unstagedGroup).getByText("App.tsx")).toBeInTheDocument();
  });

  it("桌面端支持一键暂存全部当前变更", async () => {
    setViewportWidth(1280);
    const allPaths = [
      "apps/user-app/src/app/App.tsx",
      "apps/user-app/src/app/router.tsx",
      "docs/guide.md"
    ];

    workbenchShellMock.addGitSnapshotListener.mockImplementation((listener: (snapshot: ReturnType<typeof createGitSnapshot>) => void) => {
      listener(createGitSnapshot(createStatus(allPaths)));
      return () => undefined;
    });

    renderSidebar();

    const unstagedGroup = await findGroup("当前变更");
    await userEvent.click(within(unstagedGroup).getByRole("button", { name: "暂存全部" }));

    await waitFor(() => {
      expect(gitApiMock.stageGitTargets).toHaveBeenCalledWith("workspace-1", allPaths);
    });
  });

  it("桌面端支持按文件夹一键放弃改动", async () => {
    setViewportWidth(1280);
    const appPaths = [
      "apps/user-app/src/app/App.tsx",
      "apps/user-app/src/app/router.tsx"
    ];
    const allPaths = [...appPaths, "docs/guide.md"];

    workbenchShellMock.addGitSnapshotListener.mockImplementation((listener: (snapshot: ReturnType<typeof createGitSnapshot>) => void) => {
      listener(createGitSnapshot(createStatus(allPaths)));
      return () => undefined;
    });

    renderSidebar();

    const unstagedGroup = await findGroup("当前变更");
    await userEvent.click(
      within(unstagedGroup).getByRole("button", { name: "放弃改动 apps/user-app/src/app" })
    );

    await waitFor(() => {
      expect(gitApiMock.discardGitTargets).toHaveBeenCalledWith("workspace-1", appPaths);
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

function seedGitSidebarSnapshot() {
  const snapshot = createGitSnapshot();

  writeViewSnapshot(GIT_SIDEBAR_SNAPSHOT_KEY, {
    status: snapshot.status,
    history: snapshot.history,
    historyTotalCount: snapshot.historyTotalCount,
    historyNextCursor: snapshot.historyNextCursor,
    branches: snapshot.branches
  });
}

function createStatus(unstagedPaths = [
  "apps/user-app/src/app/App.tsx",
  "apps/user-app/src/app/router.tsx"
], stagedPaths: string[] = [], mixedPaths: string[] = []) {
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
      ...mixedPaths.map((path) => createMixedChange(path)),
      ...unstagedPaths.map((path) => createChange(path, false))
    ]
  };
}

function createGitSnapshot(status = createStatus()) {
  return {
    workspaceId: "workspace-1",
    status,
    history: [
      {
        commitHash: "33333333",
        authorName: "Linus",
        authoredAt: "2026-03-26T00:00:00.000Z",
        subject: "feat: local only",
        body: "",
        commitKind: "local",
        refs: [{ name: "main", kind: "head", remoteName: null }]
      },
      {
        commitHash: "22222222",
        authorName: "Linus",
        authoredAt: "2026-03-25T00:00:00.000Z",
        subject: "fix: remote release",
        body: "",
        commitKind: "remote",
        refs: [{ name: "upstream/release", kind: "remote", remoteName: "upstream" }]
      },
      {
        commitHash: "11111111",
        authorName: "Linus",
        authoredAt: "2026-03-24T00:00:00.000Z",
        subject: "chore: synced main",
        body: "",
        commitKind: "shared",
        refs: [
          { name: "main", kind: "local", remoteName: null },
          { name: "origin/main", kind: "remote", remoteName: "origin" }
        ]
      }
    ],
    historyTotalCount: 3,
    historyNextCursor: null,
    branches: {
      currentBranch: "main",
      local: [{ name: "main", current: true, upstream: "origin/main", remote: false }],
      remote: []
    }
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

function createMixedChange(path: string) {
  return {
    path,
    status: "M",
    staged: true,
    oldPath: null,
    binary: false,
    stagedStatus: "M",
    worktreeStatus: "M"
  };
}
