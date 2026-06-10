import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { userPreferenceStore } from "../../../preferences/user-preference-store";
import { ToastProvider } from "../../../shared/toast";
import { GitSidebar, resolveGitOperationsMenuPosition } from "./GitSidebar";

const gitApiMock = vi.hoisted(() => ({
  getGitStatus: vi.fn(),
  initializeGitRepository: vi.fn(),
  getGitHistory: vi.fn(),
  getGitCommitDetail: vi.fn(),
  getGitBranches: vi.fn(),
  getGitRemotes: vi.fn(),
  stageGitTargets: vi.fn(),
  unstageGitTargets: vi.fn(),
  discardGitTargets: vi.fn(),
  createCommitDraft: vi.fn(),
  commitDraft: vi.fn(),
  switchGitBranch: vi.fn(),
  syncGitRemote: vi.fn(),
  undoLastCommit: vi.fn()
}));

const conversationApiMock = vi.hoisted(() => ({
  startLiveSession: vi.fn(),
  getSessionDetail: vi.fn(),
  listProviderCatalog: vi.fn(),
  listProviderCapabilities: vi.fn()
}));

const workbenchShellMock = vi.hoisted(() => ({
  subscribeGitSnapshot: vi.fn(),
  requestGitRefresh: vi.fn(),
  addGitSnapshotListener: vi.fn(),
  requestNavigationRefresh: vi.fn(),
  selectWorkspace: vi.fn(),
  upsertNavigationSession: vi.fn(),
  currentTargetHostId: null,
  currentWorkspaceRef: null
}));
const hapticsMock = vi.hoisted(() => ({
  trigger: vi.fn()
}));
const showDesktopContextMenuMock = vi.hoisted(() => vi.fn());
const platformMock = vi.hoisted(() => ({
  isDesktop: true,
  isMobile: false,
  bridge: {
    supported: true,
    writeClipboardText: vi.fn()
  }
}));
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const GIT_SIDEBAR_SNAPSHOT_KEY = "git-sidebar.snapshot.workspace-1";
let gitSnapshotListener: ((snapshot: ReturnType<typeof createGitSnapshot>) => void) | null = null;
const initialPreferenceState = userPreferenceStore.getState();

function createPreferenceState(language: "zh-CN" | "en-US") {
  return {
    initialized: true,
    profile: {
      language,
      theme: "light" as const,
      autoTheme: false,
      defaultPermissionMode: "default" as const
    },
    providers: {
      "claude-code": {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      codex: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      opencode: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      gemini: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      kimi: {
        defaultModel: null,
        defaultReasoningLevel: null
      }
    },
    updatedAt: null,
    source: "default" as const
  };
}

vi.mock("../api/git-api", () => ({
  getGitStatus: gitApiMock.getGitStatus,
  initializeGitRepository: gitApiMock.initializeGitRepository,
  getGitHistory: gitApiMock.getGitHistory,
  getGitCommitDetail: gitApiMock.getGitCommitDetail,
  getGitBranches: gitApiMock.getGitBranches,
  getGitRemotes: gitApiMock.getGitRemotes,
  stageGitTargets: gitApiMock.stageGitTargets,
  unstageGitTargets: gitApiMock.unstageGitTargets,
  discardGitTargets: gitApiMock.discardGitTargets,
  createCommitDraft: gitApiMock.createCommitDraft,
  commitDraft: gitApiMock.commitDraft,
  switchGitBranch: gitApiMock.switchGitBranch,
  syncGitRemote: gitApiMock.syncGitRemote,
  undoLastCommit: gitApiMock.undoLastCommit
}));

vi.mock("../api/conversation-api", () => ({
  startLiveSession: conversationApiMock.startLiveSession,
  getSessionDetail: conversationApiMock.getSessionDetail,
  listProviderCatalog: conversationApiMock.listProviderCatalog,
  listProviderCapabilities: conversationApiMock.listProviderCapabilities
}));

vi.mock("./WorkbenchLayout", () => ({
  useWorkbenchShell: () => workbenchShellMock
}));

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => platformMock
}));

vi.mock("../../../platform/desktop/desktop-context-menu", () => ({
  showDesktopContextMenu: showDesktopContextMenuMock
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock
}));

vi.mock("../../../shared/haptics", () => ({
  useHaptics: () => hapticsMock
}));

vi.mock("../../../shared/haptics", () => ({
  useHaptics: () => ({
    trigger: vi.fn()
  })
}));

describe("GitSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workbenchShellMock.currentTargetHostId = null;
    workbenchShellMock.currentWorkspaceRef = null;
    userPreferenceStore.hydrate(createPreferenceState("zh-CN"));
    setViewportWidth(430);
    hapticsMock.trigger.mockReset();
    showDesktopContextMenuMock.mockReset();
    gitSnapshotListener = null;
    window.sessionStorage.clear();
    clearViewSnapshot(GIT_SIDEBAR_SNAPSHOT_KEY);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    });
    platformMock.bridge.writeClipboardText.mockResolvedValue({
      ok: false,
      errorCode: "SHELL_BRIDGE_ERROR",
      detail: "clipboard unavailable"
    });

    gitApiMock.getGitStatus.mockResolvedValue(createStatus());
    gitApiMock.initializeGitRepository.mockResolvedValue(createStatus([], []));
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
    gitApiMock.getGitCommitDetail.mockResolvedValue(createCommitDetail());
    gitApiMock.getGitRemotes.mockResolvedValue([
      {
        name: "origin",
        fetchUrl: "https://example.com/repo.git",
        pushUrl: "https://example.com/repo.git",
        credentialConfigured: false
      }
    ]);
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
    conversationApiMock.startLiveSession.mockResolvedValue({
      sessionId: "session-commit-explain",
      acceptedAt: "2026-04-14T12:00:00.000Z",
      clientRequestId: "req-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      message: {
        messageId: "message-1",
        role: "user",
        kind: "text",
        content: "分析提交",
        createdAt: "2026-04-14T12:00:00.000Z"
      },
      session: {
        sessionId: "session-commit-explain",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "provider-session-1",
        rawStoreRef: "store-ref",
        title: "解释提交",
        messageCount: 1,
        lastMessageAt: "2026-04-14T12:00:00.000Z",
        createdAt: "2026-04-14T12:00:00.000Z",
        updatedAt: "2026-04-14T12:00:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "starting",
        activitySource: "runtime",
        lastEventAt: "2026-04-14T12:00:00.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "running"
      }
    });
    conversationApiMock.getSessionDetail.mockResolvedValue(null);
    conversationApiMock.listProviderCatalog.mockResolvedValue([
      { provider: "codex", enabled: true, available: true, status: "ready", displayName: "Codex" },
      { provider: "claude-code", enabled: true, available: true, status: "ready", displayName: "Claude Code" },
      { provider: "gemini", enabled: true, available: true, status: "ready", displayName: "Gemini" },
      { provider: "kimi", enabled: true, available: true, status: "ready", displayName: "Kimi" },
      { provider: "opencode", enabled: true, available: true, status: "ready", displayName: "OpenCode" }
    ]);
    conversationApiMock.listProviderCapabilities.mockResolvedValue({
      codex: {
        provider: "codex",
        canStartSession: true,
        canResumeSession: true,
        canSendMessage: true,
        inRunInputMode: "none",
        supportsSubagents: true,
        supportsInterrupt: true,
        supportsStructuredToolCalls: true,
        supportsTokenUsage: true,
        supportsAttachments: true,
        supportsPermissionPrompt: true,
        supportsCheckpoint: true,
        limitations: []
      }
    });
    workbenchShellMock.subscribeGitSnapshot.mockImplementation(() => undefined);
    workbenchShellMock.requestGitRefresh.mockImplementation(() => {
      gitSnapshotListener?.(createGitSnapshot());
    });
    workbenchShellMock.addGitSnapshotListener.mockImplementation((listener: (snapshot: ReturnType<typeof createGitSnapshot>) => void) => {
      gitSnapshotListener = listener;
      listener(createGitSnapshot());
      return () => {
        if (gitSnapshotListener === listener) {
          gitSnapshotListener = null;
        }
      };
    });
  });

  afterEach(() => {
    userPreferenceStore.hydrate(initialPreferenceState);
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
      ], { targetHostId: null });
    });

    await waitFor(() => {
      expect(within(unstagedGroup).queryByText(/已选文件\s*2/)).not.toBeInTheDocument();
    });
  });

  it("命中新鲜缓存时挂载阶段会先展示缓存并主动刷新", async () => {
    seedGitSidebarSnapshot();

    renderSidebar();

    expect(await screen.findByText("App.tsx")).toBeInTheDocument();
    expect(workbenchShellMock.subscribeGitSnapshot).toHaveBeenCalledWith("workspace-1", {
      knownRevision: "git-rev-1",
      targetHostId: null
    });
    expect(workbenchShellMock.requestGitRefresh).toHaveBeenCalledWith("workspace-1", {
      knownRevision: null,
      targetHostId: null
    });
  });

  it("面板从隐藏切回可见时会再次主动刷新", async () => {
    seedGitSidebarSnapshot();

    const { rerender } = render(
      <ToastProvider>
        <GitSidebar workspaceId="workspace-1" panelActive={false} />
      </ToastProvider>
    );

    expect(await screen.findByText("App.tsx")).toBeInTheDocument();
    expect(workbenchShellMock.requestGitRefresh).not.toHaveBeenCalled();

    rerender(
      <ToastProvider>
        <GitSidebar workspaceId="workspace-1" panelActive />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(workbenchShellMock.requestGitRefresh).toHaveBeenCalledTimes(1);
    });
    expect(workbenchShellMock.requestGitRefresh).toHaveBeenNthCalledWith(1, "workspace-1", {
      knownRevision: null,
      targetHostId: null
    });
  });

  it("撤销上次提交后会把提交标题回填到输入框", async () => {
    setViewportWidth(1280);
    renderSidebar();

    await userEvent.click(await screen.findByRole("button", { name: "操作菜单" }));
    await userEvent.click(await screen.findByRole("button", { name: "撤销上次提交" }));

    await waitFor(() => {
      expect(gitApiMock.undoLastCommit).toHaveBeenCalledWith("workspace-1", {
        targetHostId: null
      });
    });

    expect(await screen.findByDisplayValue("feat: restore message")).toBeInTheDocument();
  });

  it("提交输入框使用自增长 textarea，并保持单行提交标题语义", async () => {
    renderSidebar();

    const editor = await screen.findByRole("textbox");

    expect(editor.tagName).toBe("TEXTAREA");
    expect(screen.queryByRole("heading", { name: "提交信息" })).not.toBeInTheDocument();
    expect(editor).toHaveAttribute("placeholder", "在这里输入提交信息");

    await userEvent.type(editor, "feat: first line{enter}second line");

    expect(editor).toHaveValue("feat: first linesecond line");
  });

  it("未启用 Git 时只显示初始化入口，并支持初始化当前目录", async () => {
    const disabledStatus = createStatus([], []);
    disabledStatus.snapshot.enabled = false;
    disabledStatus.snapshot.branch = "";
    disabledStatus.snapshot.hasRemote = false;

    workbenchShellMock.requestGitRefresh.mockImplementation(() => {
      gitSnapshotListener?.(createGitSnapshot(disabledStatus));
    });
    workbenchShellMock.addGitSnapshotListener.mockImplementation((listener: (snapshot: ReturnType<typeof createGitSnapshot>) => void) => {
      gitSnapshotListener = listener;
      listener(createGitSnapshot(disabledStatus));
      return () => {
        if (gitSnapshotListener === listener) {
          gitSnapshotListener = null;
        }
      };
    });

    renderSidebar();

    expect(await screen.findByText("当前目录还没有启用 Git")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "立即刷新" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "初始化 Git 工作区" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "初始化 Git 工作区" }));

    await waitFor(() => {
      expect(gitApiMock.initializeGitRepository).toHaveBeenCalledWith("workspace-1", {
        targetHostId: null
      });
    });
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
    workbenchShellMock.requestGitRefresh.mockImplementation(() => undefined);

    const refreshButton = await screen.findByRole("button", { name: "刷新" });

    expect(refreshButton).not.toBeDisabled();
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(gitApiMock.getGitStatus).toHaveBeenCalledWith("workspace-1", {
        targetHostId: null
      });
      expect(gitApiMock.getGitHistory).toHaveBeenCalledWith("workspace-1", 20, null, {
        targetHostId: null
      });
      expect(gitApiMock.getGitBranches).toHaveBeenCalledWith("workspace-1", {
        targetHostId: null
      });
    });

    await waitFor(() => {
      expect(refreshButton).not.toBeDisabled();
    });

    expect(await screen.findByText("refresh-target.md")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /最近版本/ }));
    expect(await screen.findByText("feat: refreshed snapshot")).toBeInTheDocument();
    expect(workbenchShellMock.requestGitRefresh).toHaveBeenCalledWith("workspace-1", {
      targetHostId: null
    });
  });

  it("移动端未提交记录的放弃改动操作会二次确认", async () => {
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSidebar();

    const { swipeRow, swipeContent } = findMobileSwipeRow(await findGroup("当前变更"), "App.tsx");

    swipeMobileRow(swipeContent, 120, 56);

    fireEvent.click(within(swipeRow as HTMLElement).getByRole("button", { name: "放弃改动" }));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith("确认放弃这些改动吗？apps/user-app/src/app/App.tsx");
      expect(gitApiMock.discardGitTargets).toHaveBeenCalledWith("workspace-1", [
        "apps/user-app/src/app/App.tsx"
      ], { targetHostId: null });
    });

    confirmMock.mockRestore();
  });

  it("移动端文件项只保留左滑菜单，并把预览、暂存、放弃改动收进同一侧", async () => {
    renderSidebar();

    const { swipeRow, swipeContent } = findMobileSwipeRow(await findGroup("当前变更"), "App.tsx");

    expect(swipeRow.querySelectorAll(".git-mobile-swipe-action.leading")).toHaveLength(0);
    expect(readSwipeActionLabels(swipeRow)).toEqual(["预览", "暂存", "放弃改动"]);

    swipeMobileRow(swipeContent, 120, 196);
    expect(swipeRow).toHaveAttribute("data-open-state", "closed");
  });

  it("移动端文件夹项也只保留左滑菜单", async () => {
    renderSidebar();

    const { swipeRow, swipeContent } = findMobileSwipeRow(
      await findGroup("当前变更"),
      "apps/user-app/src/app",
      ".git-mobile-record-directory"
    );

    expect(swipeRow.querySelectorAll(".git-mobile-swipe-action.leading")).toHaveLength(0);
    expect(readSwipeActionLabels(swipeRow)).toEqual(["暂存", "放弃改动"]);

    swipeMobileRow(swipeContent, 120, 196);
    expect(swipeRow).toHaveAttribute("data-open-state", "closed");
  });

  it("移动端暂存区文件项也改成只保留左滑菜单", async () => {
    const stagedPath = "apps/user-app/src/app/App.tsx";
    gitApiMock.getGitStatus.mockResolvedValue(createStatus([], [stagedPath]));
    workbenchShellMock.addGitSnapshotListener.mockImplementation((listener: (snapshot: ReturnType<typeof createGitSnapshot>) => void) => {
      listener(createGitSnapshot(createStatus([], [stagedPath])));
      return () => undefined;
    });
    renderSidebar();

    const stagedToggle = await screen.findByRole("button", { name: /暂存的更改/ });
    if (stagedToggle.getAttribute("aria-expanded") === "false") {
      await userEvent.click(stagedToggle);
    }

    const { swipeRow, swipeContent } = findMobileSwipeRow(await findGroup("暂存的更改"), "App.tsx");

    expect(swipeRow.querySelectorAll(".git-mobile-swipe-action.leading")).toHaveLength(0);
    expect(readSwipeActionLabels(swipeRow)).toEqual(["预览", "取消暂存"]);

    swipeMobileRow(swipeContent, 120, 196);
    expect(swipeRow).toHaveAttribute("data-open-state", "closed");
  });

  it("移动端最近版本条目提供操作菜单，并支持复制 Commit Hash", async () => {
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: /最近版本|Recent Versions/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /版本操作|History Item Menu|Commit Actions/ })[0]);

    expect(screen.getByRole("button", { name: /复制 Commit Hash|Copy Commit Hash/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /复制提交信息|Copy Commit Message/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /复制 Git 版本号|Copy Git Version/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /解释更改|Explain Change/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /撤销上次提交|Undo Last Commit/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /复制 Commit Hash|Copy Commit Hash/ }));

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith("33333333");
    });
  });

  it("桌面端最近版本复制优先走原生剪贴板桥接", async () => {
    platformMock.bridge.writeClipboardText.mockResolvedValue({
      ok: true
    });
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: /最近版本|Recent Versions/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /版本操作|History Item Menu|Commit Actions/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /复制 Commit Hash|Copy Commit Hash/ }));

    await waitFor(() => {
      expect(platformMock.bridge.writeClipboardText).toHaveBeenCalledWith("33333333");
    });
    expect(clipboardWriteTextMock).not.toHaveBeenCalled();
  });

  it("最近版本支持打开提交详情模态框并展示文件与 diff", async () => {
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: /最近版本|Recent Versions/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /版本操作|History Item Menu|Commit Actions/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /查看更改文件与 DIFF|View Changed Files and DIFF/ }));

    expect(await screen.findByText(/版本详情|Commit Detail/)).toBeInTheDocument();
    expect(
      await screen.findByText("apps/user-app/src/features/conversation/components/GitSidebar.tsx")
    ).toBeInTheDocument();
    expect(screen.getByText(/提交 DIFF|Commit DIFF/)).toBeInTheDocument();
    expect(gitApiMock.getGitCommitDetail).toHaveBeenCalledWith("workspace-1", "33333333", {
      targetHostId: null
    });
  });

  it("解释更改会先弹供应商选择，再新建会话", async () => {
    workbenchShellMock.currentTargetHostId = "peer-host-1";
    workbenchShellMock.currentWorkspaceRef = {
      hostId: "peer-host-1",
      workspaceId: "remote-workspace-1"
    };
    workbenchShellMock.requestGitRefresh.mockImplementation(() => {
      gitSnapshotListener?.({
        ...createGitSnapshot(),
        targetHostId: "peer-host-1"
      });
    });
    workbenchShellMock.addGitSnapshotListener.mockImplementation((listener: (snapshot: ReturnType<typeof createGitSnapshot>) => void) => {
      gitSnapshotListener = listener;
      listener({
        ...createGitSnapshot(),
        targetHostId: "peer-host-1"
      });
      return () => {
        if (gitSnapshotListener === listener) {
          gitSnapshotListener = null;
        }
      };
    });
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: /最近版本|Recent Versions/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /版本操作|History Item Menu|Commit Actions/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /解释更改|Explain Change/ }));

    expect(await screen.findByText(/解释版本更改|Explain Commit Change/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Codex/i }));
    await userEvent.click(screen.getByRole("button", { name: /开始解释|Start Explaining/ }));

    await waitFor(() => {
      expect(conversationApiMock.startLiveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          provider: "codex"
        }),
        { targetHostId: "peer-host-1" }
      );
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        "/workspaces/workspace-1/sessions/session-commit-explain?targetHostId=peer-host-1"
      );
    });
  });

  it("移动端最近版本标题右侧提供 Git 操作菜单，并复用桌面端菜单内容", async () => {
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: /最近版本|Recent Versions/ }));
    fireEvent.click(screen.getByRole("button", { name: /^(操作菜单|Actions)$/ }));

    const operationsShell = document.querySelector(".git-mobile-operations-shell") as HTMLElement;

    expect(operationsShell).not.toBeNull();
    expect(within(operationsShell).getByRole("button", { name: /查看所有版本|View All Versions/ })).toBeInTheDocument();
    expect(within(operationsShell).getByRole("button", { name: "Fetch" })).toBeInTheDocument();
    expect(within(operationsShell).getByRole("button", { name: "Pull" })).toBeInTheDocument();
    expect(within(operationsShell).getByRole("button", { name: "Push" })).toBeInTheDocument();
    expect(within(operationsShell).getByRole("button", { name: /撤销上次提交|Undo Last Commit/ })).toBeInTheDocument();
    expect(within(operationsShell).getByRole("button", { name: /刷新|Refresh/ })).toBeInTheDocument();
  });

  it("保存远程认证后，推送会携带认证参数", async () => {
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: /最近版本/ }));
    fireEvent.click(screen.getByRole("button", { name: "操作菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "远程认证" }));

    const authModeCombobox = await screen.findByRole("combobox");

    await userEvent.selectOptions(authModeCombobox, "token");
    await userEvent.type(screen.getByPlaceholderText("可选，留空时默认使用 git"), "git");
    await userEvent.type(screen.getByPlaceholderText("输入 access token"), "secret-token");
    await userEvent.click(screen.getByRole("checkbox", { name: "记住账号密码到 Host" }));
    await userEvent.click(screen.getByRole("button", { name: "保存认证" }));

    await userEvent.click(screen.getByRole("button", { name: "Push" }));

    await waitFor(() => {
      expect(gitApiMock.syncGitRemote).toHaveBeenCalledWith(
        "workspace-1",
        "push",
        "origin",
        {
          mode: "token",
          username: "git",
          token: "secret-token"
        },
        true,
        { targetHostId: null }
      );
    });
  });

  it("多远端推送弹窗会按仓库显示各自的凭据状态", async () => {
    gitApiMock.getGitRemotes.mockResolvedValue([
      {
        name: "github",
        fetchUrl: "https://github.com/example/repo.git",
        pushUrl: "https://github.com/example/repo.git",
        credentialConfigured: true
      },
      {
        name: "origin",
        fetchUrl: "https://git.example.com/repo.git",
        pushUrl: "https://git.example.com/repo.git",
        credentialConfigured: false
      }
    ]);
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: /最近版本/ }));
    fireEvent.click(screen.getByRole("button", { name: "操作菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "Push" }));

    expect(await screen.findByText("Host 已配置")).toBeInTheDocument();
    expect(await screen.findByText("未配置")).toBeInTheDocument();

    const githubRow = screen.getByText("github").closest(".git-remote-item");

    if (!(githubRow instanceof HTMLElement)) {
      throw new Error("未找到 github 远端行");
    }

    await userEvent.click(within(githubRow).getByRole("button", { name: "远程认证" }));
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
  });

  it("多远端场景会按仓库分别保存当前页面认证并在推送时使用对应凭据", async () => {
    gitApiMock.getGitRemotes.mockResolvedValue([
      {
        name: "github",
        fetchUrl: "https://github.com/example/repo.git",
        pushUrl: "https://github.com/example/repo.git",
        credentialConfigured: false
      },
      {
        name: "origin",
        fetchUrl: "https://git.example.com/repo.git",
        pushUrl: "https://git.example.com/repo.git",
        credentialConfigured: false
      }
    ]);
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: /最近版本/ }));
    fireEvent.click(screen.getByRole("button", { name: "操作菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "Push" }));

    const githubRow = await screen.findByText("github");
    const githubRemoteItem = githubRow.closest(".git-remote-item");

    if (!(githubRemoteItem instanceof HTMLElement)) {
      throw new Error("未找到 github 远端行");
    }

    await userEvent.click(within(githubRemoteItem).getByRole("button", { name: "远程认证" }));
    await userEvent.selectOptions(screen.getByRole("combobox"), "token");
    await userEvent.type(screen.getByPlaceholderText("可选，留空时默认使用 git"), "git");
    await userEvent.type(screen.getByPlaceholderText("输入 access token"), "github-secret-token");
    await userEvent.click(screen.getByRole("button", { name: "保存认证" }));

    expect(await within(githubRemoteItem).findByText("当前页面已配置")).toBeInTheDocument();

    await userEvent.click(within(githubRemoteItem).getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "推送 (1)" }));

    await waitFor(() => {
      expect(gitApiMock.syncGitRemote).toHaveBeenCalledWith(
        "workspace-1",
        "push",
        "github",
        {
          mode: "token",
          username: "git",
          token: "github-secret-token"
        },
        false,
        { targetHostId: null }
      );
    });
  });

  it("GitHub 远程认证弹窗会提示使用 PAT", async () => {
    gitApiMock.getGitRemotes.mockResolvedValue([
      {
        name: "origin",
        fetchUrl: "https://github.com/example/repo.git",
        pushUrl: "https://github.com/example/repo.git",
        credentialConfigured: false
      }
    ]);
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: /最近版本/ }));
    fireEvent.click(screen.getByRole("button", { name: "操作菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "远程认证" }));

    expect(
      await screen.findByText(
        "检测到当前远程仓库来自 GitHub。GitHub 的 HTTPS Git 操作请使用 Personal Access Token (PAT)，不要填写 GitHub 登录密码。"
      )
    ).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox"), "basic");

    expect(await screen.findByText("Personal Access Token (PAT)")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入 GitHub PAT")).toBeInTheDocument();
    expect(
      screen.getByText(
        "GitHub 不支持用账号密码做 Git HTTPS 认证。basic 模式请填写 GitHub 用户名 + PAT；token 模式可以直接填写 PAT。"
      )
    ).toBeInTheDocument();
  });

  it("非 GitHub 远程认证弹窗保持通用用户名密码提示", async () => {
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: /最近版本/ }));
    fireEvent.click(screen.getByRole("button", { name: "操作菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "远程认证" }));

    expect(
      await screen.findByText("需要认证的远程仓库，在这里填写本次页面会话使用的用户名、密码或 token。")
    ).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox"), "basic");

    expect(await screen.findByText("密码")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入 Git 密码")).toBeInTheDocument();
  });

  it("桌面端 Git 操作菜单会在右侧贴边时向内收敛", () => {
    const position = resolveGitOperationsMenuPosition(
      createRect({
        top: 80,
        right: 430,
        bottom: 112,
        left: 398
      }),
      { width: 260, height: 280 },
      { width: 440, height: 900 }
    );

    expect(position.left).toBe(168);
    expect(position.top).toBe(120);
    expect(position.transformOrigin).toBe("top right");
  });

  it("桌面端 Git 操作菜单在底部空间不足时会翻到按钮上方", () => {
    const position = resolveGitOperationsMenuPosition(
      createRect({
        top: 620,
        right: 380,
        bottom: 652,
        left: 348
      }),
      { width: 260, height: 320 },
      { width: 1280, height: 720 }
    );

    expect(position.top).toBe(292);
    expect(position.left).toBe(120);
    expect(position.maxHeight).toBe(600);
    expect(position.transformOrigin).toBe("bottom right");
  });

  it("桌面端最近版本支持鼠标右键弹出原生菜单", async () => {
    setViewportWidth(1280);
    showDesktopContextMenuMock.mockResolvedValue(undefined);
    renderSidebar();

    const entryTitle = await screen.findByText("feat: local only");
    const entry = entryTitle.closest(".git-history-entry");

    if (!(entry instanceof HTMLElement)) {
      throw new Error("未找到最近版本条目");
    }

    fireEvent.contextMenu(entry, {
      clientX: 420,
      clientY: 260
    });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    expect(showDesktopContextMenuMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: expect.stringMatching(/查看更改文件与 DIFF|View Changed Files and DIFF/) }),
        expect.objectContaining({ label: expect.stringMatching(/复制 Commit Hash|Copy Commit Hash/) }),
        expect.objectContaining({ label: expect.stringMatching(/复制提交信息|Copy Commit Message/) }),
        expect.objectContaining({ label: expect.stringMatching(/复制 Git 版本号|Copy Git Version/) }),
        expect.objectContaining({ label: expect.stringMatching(/解释更改|Explain Change/) }),
        expect.objectContaining({ label: expect.stringMatching(/撤销上次提交|Undo Last Commit/) })
      ])
    );
    expect(document.querySelector(".git-history-entry-menu")).toBeNull();
  });

  it("桌面端最近版本条目不再显示重复的操作按钮", async () => {
    setViewportWidth(1280);
    renderSidebar();

    const entryTitle = await screen.findByText("feat: local only");
    const entry = entryTitle.closest(".git-history-entry");

    if (!(entry instanceof HTMLElement)) {
      throw new Error("未找到最近版本条目");
    }

    expect(entry.querySelector(".git-history-more")).toBeNull();
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
      expect(gitApiMock.stageGitTargets).toHaveBeenCalledWith("workspace-1", allPaths, {
        targetHostId: null
      });
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
      expect(gitApiMock.discardGitTargets).toHaveBeenCalledWith("workspace-1", appPaths, {
        targetHostId: null
      });
    });
  });
  it("不再显示按钮式开新窗口入口", () => {
    renderSidebar({ externalWindowMode: true });

    expect(screen.queryByRole("button", { name: "在新窗口打开 Git" })).toBeNull();
  });
});

function createRect({
  top,
  right,
  bottom,
  left
}: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}): DOMRect {
  return {
    top,
    right,
    bottom,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect;
}

function renderSidebar(options?: { workspaceId?: string; panelActive?: boolean; externalWindowMode?: boolean }) {
  render(
    <ToastProvider>
      <GitSidebar
        workspaceId={options?.workspaceId ?? "workspace-1"}
        panelActive={options?.panelActive ?? true}
        externalWindowMode={options?.externalWindowMode}
      />
    </ToastProvider>
  );
}

async function findGroup(title: string) {
  const heading = await screen.findByRole("heading", { name: title });
  return heading.closest("section") as HTMLElement;
}

function findMobileSwipeRow(scope: HTMLElement, text: string, rowSelector?: string) {
  const target = within(scope).getAllByText(text).find((node) =>
    rowSelector ? Boolean(node.closest(rowSelector)) : Boolean(node.closest(".git-mobile-swipe-row"))
  );

  if (!target) {
    throw new Error(`找不到移动端滑动行：${text}`);
  }

  const swipeRow = target.closest(".git-mobile-swipe-row") as HTMLElement | null;
  const swipeContent = swipeRow?.querySelector(".git-mobile-swipe-content") as HTMLElement | null;

  if (!swipeRow || !swipeContent) {
    throw new Error(`滑动行结构不完整：${text}`);
  }

  return {
    swipeRow,
    swipeContent
  };
}

function swipeMobileRow(swipeContent: HTMLElement, startX: number, endX: number) {
  fireEvent.pointerDown(swipeContent, {
    button: 0,
    pointerId: 1,
    clientX: startX
  });
  fireEvent.pointerMove(swipeContent, {
    pointerId: 1,
    clientX: endX
  });
  fireEvent.pointerUp(swipeContent, {
    pointerId: 1,
    clientX: endX
  });
}

function readSwipeActionLabels(swipeRow: HTMLElement) {
  return Array.from(swipeRow.querySelectorAll(".git-mobile-swipe-action.trailing")).map((node) =>
    node.textContent?.trim() ?? ""
  );
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
    revision: "git-rev-1",
    status: snapshot.status,
    history: snapshot.history,
    historyTotalCount: snapshot.historyTotalCount,
    historyNextCursor: snapshot.historyNextCursor,
    branches: snapshot.branches
  });
}

function enableRealtimeRefresh(snapshot = createGitSnapshot()) {
  workbenchShellMock.requestGitRefresh.mockImplementation(() => {
    gitSnapshotListener?.(snapshot);
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
      enabled: true,
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

function createCommitDetail() {
  return {
    workspaceId: "workspace-1",
    commitHash: "33333333",
    shortHash: "33333333",
    versionLabel: "v1.2.3-4-g33333333",
    authorName: "Linus",
    authorEmail: "linus@example.com",
    authoredAt: "2026-03-26T00:00:00.000Z",
    committerName: "Linus",
    committerEmail: "linus@example.com",
    committedAt: "2026-03-26T00:00:00.000Z",
    subject: "feat: local only",
    body: "补充最近版本菜单",
    changedFiles: [
      {
        path: "apps/user-app/src/features/conversation/components/GitSidebar.tsx",
        oldPath: null,
        status: "M",
        binary: false
      }
    ],
    diffTruncated: false,
    diffContent:
      "diff --git a/apps/user-app/src/features/conversation/components/GitSidebar.tsx b/apps/user-app/src/features/conversation/components/GitSidebar.tsx"
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
