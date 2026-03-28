import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type UIEvent
} from "react";

import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import {
  commitDraft,
  createCommitDraft,
  discardGitTargets,
  getGitBranches,
  getGitStatus,
  getGitHistory,
  stageGitTargets,
  switchGitBranch,
  syncGitRemote,
  undoLastCommit,
  unstageGitTargets,
  type CommitDraftDto,
  type GitBranchSnapshotDto,
  type GitChangeItemDto,
  type GitHistoryItemDto,
  type GitStatusDto
} from "../api/git-api";
import {
  resolveFileTreeIconKind,
  resolveFileTreeIconLabel
} from "./file-tree-icon";
import { useWorkbenchShell } from "./WorkbenchLayout";

interface GitSidebarProps {
  className?: string;
  workspaceId: string | null | undefined;
}

interface GitTreeDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  children: GitTreeNode[];
}

interface GitTreeFileNode {
  kind: "file";
  name: string;
  path: string;
  change: GitChangeItemDto;
  status: string;
  variant: "staged" | "unstaged";
}

type GitTreeNode = GitTreeDirectoryNode | GitTreeFileNode;

interface MutableGitTreeDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  children: Map<string, MutableGitTreeDirectoryNode | GitTreeFileNode>;
}

type MobileGitSectionKey = "staged" | "unstaged" | "history";
type MobileSwipeDirection = "leading" | "trailing";

const DEFAULT_TREE_PANEL_RATIO = 56;
const MIN_TREE_PANEL_RATIO = 28;
const MAX_TREE_PANEL_RATIO = 72;
const PANEL_RESIZER_HEIGHT = 8;
const GIT_MOBILE_BREAKPOINT_PX = 960;
const GIT_SNAPSHOT_CACHE_MAX_AGE_MS = 60 * 1000;
const GIT_HISTORY_PAGE_SIZE = 20;
const MOBILE_GIT_RECORD_BASE_INSET_PX = 9;
const MOBILE_GIT_RECORD_DEPTH_STEP_PX = 9;

interface GitSidebarSnapshot {
  status: GitStatusDto | null;
  history: GitHistoryItemDto[];
  historyTotalCount: number;
  historyNextCursor: string | null;
  branches: GitBranchSnapshotDto | null;
}

export function GitSidebar({ className, workspaceId }: GitSidebarProps) {
  const { subscribeGitSnapshot, requestGitRefresh, addGitSnapshotListener } = useWorkbenchShell();
  const [status, setStatus] = useState<GitStatusDto | null>(null);
  const [history, setHistory] = useState<GitHistoryItemDto[]>([]);
  const [historyTotalCount, setHistoryTotalCount] = useState(0);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [branches, setBranches] = useState<GitBranchSnapshotDto | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [commitSubject, setCommitSubject] = useState("");
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [collapsedTreePaths, setCollapsedTreePaths] = useState<string[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= GIT_MOBILE_BREAKPOINT_PX : false
  );
  const [selectedMobilePaths, setSelectedMobilePaths] = useState<string[]>([]);
  const [mobileActionMenuVariant, setMobileActionMenuVariant] = useState<"staged" | "unstaged" | null>(null);
  const [mobileExpandedSection, setMobileExpandedSection] = useState<MobileGitSectionKey>("unstaged");
  const [mobileHistoryMenuCommitHash, setMobileHistoryMenuCommitHash] = useState<string | null>(null);
  const [mobileSwipeRowState, setMobileSwipeRowState] = useState<{
    path: string;
    direction: MobileSwipeDirection;
  } | null>(null);
  const [treePanelRatio, setTreePanelRatio] = useState(DEFAULT_TREE_PANEL_RATIO);
  const [panelResizeActive, setPanelResizeActive] = useState(false);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const treePanelBodyRef = useRef<HTMLDivElement | null>(null);
  const commitEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    logPerfDebug("git_sidebar.props", {
      workspaceId
    });
  }, [workspaceId]);

  useEffect(() => {
    setCollapsedTreePaths([]);
    setHistoryExpanded(true);
    setHistoryTotalCount(0);
    setHistoryNextCursor(null);
    setHistoryLoadingMore(false);
    setSelectedPath(null);
    setCommitSubject("");
    setMenuOpen(false);
    setSelectedMobilePaths([]);
    setMobileActionMenuVariant(null);
    setMobileExpandedSection("unstaged");
    setMobileHistoryMenuCommitHash(null);
    setMobileSwipeRowState(null);
    setPanelResizeActive(false);
    setTreePanelRatio(DEFAULT_TREE_PANEL_RATIO);
  }, [workspaceId]);

  useEffect(() => {
    function handleResize() {
      setIsMobileViewport(window.innerWidth <= GIT_MOBILE_BREAKPOINT_PX);
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!panelResizeActive) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(event: PointerEvent) {
      updateTreePanelRatio(event.clientY);
    }

    function handlePointerUp() {
      setPanelResizeActive(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [panelResizeActive]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      setStatus(null);
      setHistory([]);
      setHistoryTotalCount(0);
      setHistoryNextCursor(null);
      setBranches(null);
      setLoading(false);
      return;
    }

    const currentWorkspaceId = workspaceId.trim();
    const cachedSnapshot = readViewSnapshot<GitSidebarSnapshot>(
      buildGitSidebarSnapshotKey(currentWorkspaceId),
      GIT_SNAPSHOT_CACHE_MAX_AGE_MS
    );

    logPerfDebug("git_sidebar.snapshot", {
      workspaceId: currentWorkspaceId,
      cached: Boolean(cachedSnapshot),
      cachedHistoryCount: cachedSnapshot?.history?.length ?? 0,
      cachedChangedCount: cachedSnapshot?.status?.changes.length ?? 0
    });

    if (cachedSnapshot) {
      applyGitSnapshot(cachedSnapshot);
      setLoading(false);
      return;
    }

    setStatus(null);
    setHistory([]);
    setHistoryTotalCount(0);
    setHistoryNextCursor(null);
    setBranches(null);
    setLoading(true);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }

    return addGitSnapshotListener((snapshot) => {
      if (snapshot.workspaceId !== workspaceId.trim()) {
        return;
      }

      logPerfDebug("git_sidebar.snapshot_received", {
        workspaceId: snapshot.workspaceId,
        changedCount: snapshot.status?.changes.length ?? 0,
        historyCount: snapshot.history.length,
        branchCount: (snapshot.branches?.local.length ?? 0) + (snapshot.branches?.remote.length ?? 0)
      });
      applyGitSnapshot(snapshot);
      setLoading(false);
    });
  }, [addGitSnapshotListener, workspaceId]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }

    const currentWorkspaceId = workspaceId.trim();
    const hasCachedSnapshot =
      readViewSnapshot<GitSidebarSnapshot>(
        buildGitSidebarSnapshotKey(currentWorkspaceId),
        GIT_SNAPSHOT_CACHE_MAX_AGE_MS
      ) !== null;

    subscribeGitSnapshot(currentWorkspaceId);

    if (hasCachedSnapshot) {
      return;
    }

    requestGitSnapshotRefresh();
  }, [requestGitRefresh, subscribeGitSnapshot, workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    writeViewSnapshot<GitSidebarSnapshot>(buildGitSidebarSnapshotKey(workspaceId), {
      status,
      history,
      historyTotalCount,
      historyNextCursor,
      branches
    });
  }, [branches, history, historyNextCursor, historyTotalCount, status, workspaceId]);

  useEffect(() => {
    if (!status || !selectedPath) {
      return;
    }

    const activeItem = status.changes.find((item) => item.path === selectedPath);

    if (!activeItem) {
      setSelectedPath(null);
    }
  }, [selectedPath, status]);

  useEffect(() => {
    resizeCommitEditor(commitEditorRef.current);
  }, [commitSubject]);

  useEffect(() => {
    if (isMobileViewport) {
      return;
    }

    setSelectedMobilePaths([]);
    setMobileActionMenuVariant(null);
    setMobileHistoryMenuCommitHash(null);
    setMobileSwipeRowState(null);
  }, [isMobileViewport]);

  useEffect(() => {
    if (!status) {
      setSelectedMobilePaths([]);
      return;
    }

    const availablePaths = new Set(status.changes.map((item) => item.path));

    setSelectedMobilePaths((current) => current.filter((path) => availablePaths.has(path)));
  }, [status]);

  function resetTreePanelScroll() {
    const treePanelBody = treePanelBodyRef.current;

    if (!treePanelBody) {
      return;
    }

    const treeShells = treePanelBody.querySelectorAll<HTMLElement>(".git-tree-shell");

    treeShells.forEach((treeShell) => {
      treeShell.scrollTop = 0;
    });
  }

  function applyGitSnapshot(snapshot: GitSidebarSnapshot) {
    setStatus(snapshot.status);
    setHistory(Array.isArray(snapshot.history) ? snapshot.history : []);
    setHistoryTotalCount(typeof snapshot.historyTotalCount === "number" ? snapshot.historyTotalCount : 0);
    setHistoryNextCursor(typeof snapshot.historyNextCursor === "string" ? snapshot.historyNextCursor : null);
    setBranches(snapshot.branches ?? null);
  }

  function requestGitSnapshotRefresh(options?: { resetTreeScroll?: boolean }) {
    if (!workspaceId?.trim()) {
      return;
    }

    setLoading(true);
    logPerfDebug("git_sidebar.refresh_requested", {
      workspaceId: workspaceId.trim(),
      resetTreeScroll: options?.resetTreeScroll ?? false
    });
    requestGitRefresh(workspaceId.trim());

    if (options?.resetTreeScroll) {
      requestAnimationFrame(() => {
        resetTreePanelScroll();
      });
    }
  }

  async function handleManualRefresh(options?: { resetTreeScroll?: boolean }) {
    if (!workspaceId?.trim()) {
      return;
    }

    const currentWorkspaceId = workspaceId.trim();
    setLoading(true);

    try {
      const [nextStatus, nextHistoryPage, nextBranches] = await Promise.all([
        getGitStatus(currentWorkspaceId),
        getGitHistory(currentWorkspaceId, GIT_HISTORY_PAGE_SIZE, null),
        getGitBranches(currentWorkspaceId)
      ]);

      applyGitSnapshot({
        status: nextStatus,
        history: nextHistoryPage.items,
        historyTotalCount: nextHistoryPage.totalCount,
        historyNextCursor: nextHistoryPage.nextCursor,
        branches: nextBranches
      });
      requestGitRefresh(currentWorkspaceId);

      if (options?.resetTreeScroll) {
        requestAnimationFrame(() => {
          resetTreePanelScroll();
        });
      }
    } catch (error) {
      showToast({
        title: readError(error, t("git.panelLoadFailed")),
        tone: "error"
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreHistory() {
    if (!workspaceId || !historyNextCursor || historyLoadingMore) {
      return;
    }

    setHistoryLoadingMore(true);

    try {
      const nextHistory = await getGitHistory(workspaceId, GIT_HISTORY_PAGE_SIZE, historyNextCursor);

      setHistory((current) => {
        const existingHashes = new Set(current.map((item) => item.commitHash));
        const appendedItems = nextHistory.items.filter((item) => !existingHashes.has(item.commitHash));

        return [...current, ...appendedItems];
      });
      setHistoryTotalCount(nextHistory.totalCount);
      setHistoryNextCursor(nextHistory.nextCursor);
    } catch (error) {
      showToast({
        title: readError(error, t("git.panelLoadFailed")),
        tone: "error"
      });
    } finally {
      setHistoryLoadingMore(false);
    }
  }

  function handleHistoryScroll(event: UIEvent<HTMLDivElement>) {
    if (!historyExpanded || historyLoadingMore || !historyNextCursor) {
      return;
    }

    const target = event.currentTarget;
    const remainingHeight = target.scrollHeight - target.scrollTop - target.clientHeight;

    if (remainingHeight <= 40) {
      void loadMoreHistory();
    }
  }

  async function handleDraft() {
    if (!workspaceId) {
      return;
    }

    setActioning(true);

    try {
      const response = await createCommitDraft(workspaceId, "ai");
      setCommitSubject(response.validation.normalizedDraft.subject || response.draft.subject);
    } catch (error) {
      showToast({
        title: readError(error, t("git.draftFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handleStageToggle(targets: string[], staged: boolean) {
    if (!workspaceId) {
      return;
    }

    if (!targets.length) {
      return;
    }

    setActioning(true);

    try {
      const nextStatus = staged
        ? await unstageGitTargets(workspaceId, targets)
        : await stageGitTargets(workspaceId, targets);

      setStatus(nextStatus);
      setSelectedPath(targets[targets.length - 1] ?? null);
      setSelectedMobilePaths((current) => current.filter((path) => !targets.includes(path)));
      setMobileActionMenuVariant(null);
      requestGitSnapshotRefresh();
    } catch (error) {
      setLoading(false);
      showToast({
        title: readError(error, t("git.stageFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handleDiscard(targets: string[]) {
    if (!workspaceId) {
      return;
    }

    if (!targets.length) {
      return;
    }

    setActioning(true);

    try {
      const nextStatus = await discardGitTargets(workspaceId, targets);
      setStatus(nextStatus);

      if (targets.includes(selectedPath ?? "")) {
        setSelectedPath(null);
      }

      setSelectedMobilePaths((current) => current.filter((path) => !targets.includes(path)));
      setMobileActionMenuVariant(null);
      requestGitSnapshotRefresh();
    } catch (error) {
      setLoading(false);
      showToast({
        title: readError(error, t("git.discardFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handleCommit() {
    if (!workspaceId || !commitSubject.trim()) {
      return;
    }

    setActioning(true);

    try {
      await commitDraft(workspaceId, buildCommitDraft(commitSubject));
      showToast({
        title: t("git.commitSuccess"),
        tone: "success"
      });
      setCommitSubject("");
      setSelectedPath(null);
      requestGitSnapshotRefresh();
    } catch (error) {
      showToast({
        title: readError(error, t("git.commitFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handlePush() {
    if (!workspaceId) {
      return;
    }

    setActioning(true);

    try {
      const result = await syncGitRemote(workspaceId, "push");
      showToast({
        title: result.summary,
        tone: "success"
      });
      requestGitSnapshotRefresh();
    } catch (error) {
      showToast({
        title: readError(error, t("git.remoteFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handleRemoteAction(action: "fetch" | "pull" | "push") {
    if (!workspaceId) {
      return;
    }

    setActioning(true);

    try {
      const result = await syncGitRemote(workspaceId, action);
      showToast({
        title: result.summary,
        tone: "success"
      });
      setMenuOpen(false);
      requestGitSnapshotRefresh();
    } catch (error) {
      showToast({
        title: readError(error, t("git.remoteFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handleUndoLastCommit() {
    if (!workspaceId) {
      return;
    }

    setActioning(true);

    try {
      const result = await undoLastCommit(workspaceId);
      setCommitSubject(result.commitSubject ?? "");
      showToast({
        title: result.summary || t("git.undoLastCommitSuccess"),
        tone: "success"
      });
      setMenuOpen(false);
      requestGitSnapshotRefresh();
    } catch (error) {
      showToast({
        title: readError(error, t("git.undoLastCommitFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handleSwitchBranch(branchName: string) {
    if (!workspaceId) {
      return;
    }

    setActioning(true);

    try {
      const nextBranches = await switchGitBranch(workspaceId, branchName, false);
      setBranches(nextBranches);
      setMenuOpen(false);
      requestGitSnapshotRefresh();
    } catch (error) {
      showToast({
        title: readError(error, t("git.branchFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  function toggleTreePath(path: string) {
    setCollapsedTreePaths((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
    );
  }

  function toggleMobileSelection(filePath: string) {
    setSelectedPath(filePath);
    setMobileActionMenuVariant(null);
    setSelectedMobilePaths((current) =>
      current.includes(filePath) ? current.filter((item) => item !== filePath) : [...current, filePath]
    );
  }

  function updateTreePanelRatio(clientY: number) {
    const layout = splitLayoutRef.current;

    if (!layout || !Number.isFinite(clientY)) {
      return;
    }

    const bounds = layout.getBoundingClientRect();
    const availableHeight = bounds.height - PANEL_RESIZER_HEIGHT;

    if (!Number.isFinite(bounds.top) || !Number.isFinite(bounds.height) || availableHeight <= 0) {
      return;
    }

    // 让拖拽手柄中心对齐鼠标，避免拖到边缘时出现明显跳变。
    const rawRatio = ((clientY - bounds.top - PANEL_RESIZER_HEIGHT / 2) / availableHeight) * 100;

    if (!Number.isFinite(rawRatio)) {
      return;
    }

    const nextRatio = Math.max(MIN_TREE_PANEL_RATIO, Math.min(MAX_TREE_PANEL_RATIO, Math.round(rawRatio)));

    setTreePanelRatio(nextRatio);
  }

  function handlePanelResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    updateTreePanelRatio(event.clientY);
    setPanelResizeActive(true);
  }

  const allChanges = status?.changes ?? [];
  const stagedChanges = allChanges.filter((item) => hasVariantChanges(item, "staged"));
  const unstagedChanges = allChanges.filter((item) => hasVariantChanges(item, "unstaged"));
  const stagedTree = buildChangeTree(stagedChanges, "staged");
  const unstagedTree = buildChangeTree(unstagedChanges, "unstaged");
  const collapsedTreePathSet = new Set(collapsedTreePaths);
  const selectedMobilePathSet = new Set(selectedMobilePaths);
  const mobileSelectedStagedTargets = collectSelectionTargets(selectedMobilePaths, allChanges, "staged");
  const mobileSelectedUnstagedTargets = collectSelectionTargets(selectedMobilePaths, allChanges, "unstaged");
  const canPush = allChanges.length === 0 && (status?.snapshot.ahead ?? 0) > 0;
  const canCommit = stagedChanges.length > 0 && commitSubject.trim().length > 0;
  const currentBranch = branches?.currentBranch ?? status?.snapshot.branch ?? t("common.unknown");
  const safeTreePanelRatio = Number.isFinite(treePanelRatio)
    ? treePanelRatio
    : DEFAULT_TREE_PANEL_RATIO;
  const splitRows = historyExpanded
    ? `minmax(120px, ${safeTreePanelRatio}fr) ${PANEL_RESIZER_HEIGHT}px minmax(140px, ${100 - safeTreePanelRatio}fr)`
    : `minmax(120px, 1fr) ${PANEL_RESIZER_HEIGHT}px auto`;

  useEffect(() => {
    if (mobileActionMenuVariant === "staged" && mobileSelectedStagedTargets.length === 0) {
      setMobileActionMenuVariant(null);
    }

    if (mobileActionMenuVariant === "unstaged" && mobileSelectedUnstagedTargets.length === 0) {
      setMobileActionMenuVariant(null);
    }
  }, [
    mobileActionMenuVariant,
    mobileSelectedStagedTargets.length,
    mobileSelectedUnstagedTargets.length
  ]);

  useEffect(() => {
    if (!isMobileViewport) {
      return;
    }

    const nextDefaultSection: MobileGitSectionKey =
      unstagedChanges.length > 0 ? "unstaged" : stagedChanges.length > 0 ? "staged" : "history";

    setMobileExpandedSection((current) => {
      if (current === "unstaged" && unstagedChanges.length > 0) {
        return current;
      }

      if (current === "staged" && stagedChanges.length > 0) {
        return current;
      }

      return nextDefaultSection;
    });
  }, [isMobileViewport, stagedChanges.length, unstagedChanges.length]);

  useEffect(() => {
    if (!mobileHistoryMenuCommitHash) {
      return;
    }

    if (!history.some((item) => item.commitHash === mobileHistoryMenuCommitHash)) {
      setMobileHistoryMenuCommitHash(null);
    }
  }, [history, mobileHistoryMenuCommitHash]);

  useEffect(() => {
    if (!isMobileViewport) {
      return;
    }

    if (mobileExpandedSection !== "history" && menuOpen) {
      setMenuOpen(false);
    }
  }, [isMobileViewport, menuOpen, mobileExpandedSection]);

  async function copyText(value: string, successMessage: string) {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }

      await navigator.clipboard.writeText(value);
      showToast({
        title: successMessage,
        tone: "success"
      });
    } catch {
      showToast({
        title: t("common.copyContentFailed"),
        tone: "error"
      });
    }
  }

  async function handleDiscardWithConfirm(targets: string[], label: string) {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        t("git.discardConfirm", {
          path: label
        })
      );

      if (!confirmed) {
        return;
      }
    }

    await handleDiscard(targets);
  }

  function renderGitOperationsMenu() {
    return (
      <div className="git-operations-menu">
        <div className="git-menu-section">
          <span className="git-menu-caption">{t("git.currentBranch")}</span>
          <strong className="git-menu-branch">{currentBranch}</strong>
        </div>

        <div className="git-menu-section">
          <span className="git-menu-caption">{t("git.branchTitle")}</span>
          <div className="git-menu-branch-list">
            {branches?.local.map((item) => (
              <button
                key={item.name}
                className="git-menu-item"
                type="button"
                disabled={actioning || item.current}
                onClick={() => void handleSwitchBranch(item.name)}
              >
                <span>
                  {item.current
                    ? `${t("git.switchBranch")} ${item.name}`
                    : `${t("git.switchBranchTo")} ${item.name}`}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="git-menu-section">
          <button className="git-menu-item" type="button" disabled={actioning} onClick={() => void handleRemoteAction("fetch")}>
            <span>{t("git.fetch")}</span>
          </button>
          <button className="git-menu-item" type="button" disabled={actioning} onClick={() => void handleRemoteAction("pull")}>
            <span>{t("git.pull")}</span>
          </button>
          <button className="git-menu-item" type="button" disabled={actioning} onClick={() => void handleRemoteAction("push")}>
            <span>{t("git.push")}</span>
          </button>
          <button className="git-menu-item" type="button" disabled={actioning} onClick={() => void handleUndoLastCommit()}>
            <span>{t("git.undoLastCommit")}</span>
          </button>
          <button
            className="git-menu-item"
            type="button"
            disabled={actioning || loading}
            onClick={() => void handleManualRefresh({ resetTreeScroll: true })}
          >
            <span>{t("git.refresh")}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <section
      className={["conversation-panel", "surface-card", "git-sidebar", className].filter(Boolean).join(" ")}
      data-testid="git-sidebar"
    >
      <section className="git-card git-scaffold-section">
        <div className="git-editor-row">
          <textarea
            ref={commitEditorRef}
            rows={1}
            value={commitSubject}
            onChange={(event) => setCommitSubject(normalizeCommitSubject(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
              }
            }}
            placeholder={t("git.commitSubjectPlaceholder")}
          />
          <button
            className="git-icon-button"
            type="button"
            aria-label={t("git.generateDraft")}
            title={t("git.generateDraft")}
            onClick={() => void handleDraft()}
            disabled={actioning || loading}
          >
            <DraftIcon />
          </button>
        </div>

        <div className="git-primary-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void handleManualRefresh({ resetTreeScroll: true })}
            disabled={actioning || loading || !workspaceId}
          >
            {t("git.refreshNow")}
          </button>
          <button
            className="primary-button git-primary-submit"
            type="button"
            onClick={() => {
              if (canPush) {
                void handlePush();
                return;
              }

              void handleCommit();
            }}
            disabled={actioning || (!canPush && !canCommit)}
          >
            {canPush ? t("git.pushNow") : t("git.commitNow")}
          </button>
        </div>
      </section>

      {isMobileViewport ? (
        <div className="git-mobile-sections">
          <MobileGitAccordionSection
            title={t("git.stagedChangesTitle")}
            count={stagedChanges.length}
            expanded={mobileExpandedSection === "staged"}
            onToggle={() => setMobileExpandedSection("staged")}
          >
            <MobileGitChangeSection
              title={t("git.stagedChangesTitle")}
              nodes={stagedTree}
              collapsedTreePathSet={collapsedTreePathSet}
              onToggleTreePath={toggleTreePath}
              onToggleMobileSelection={toggleMobileSelection}
              selectedMobilePathSet={selectedMobilePathSet}
              selectedTargets={mobileSelectedStagedTargets}
              actioning={actioning}
              variant="staged"
              swipeRowState={mobileSwipeRowState}
              onSwipeRowChange={setMobileSwipeRowState}
              onStageToggle={handleStageToggle}
              onDiscardWithConfirm={handleDiscardWithConfirm}
              onClearSelectedTargets={() =>
                setSelectedMobilePaths((current) =>
                  current.filter((path) => !mobileSelectedStagedTargets.includes(path))
                )
              }
            />
          </MobileGitAccordionSection>

          <MobileGitAccordionSection
            title={t("git.changesTitle")}
            count={unstagedChanges.length}
            expanded={mobileExpandedSection === "unstaged"}
            onToggle={() => setMobileExpandedSection("unstaged")}
          >
            <MobileGitChangeSection
              title={t("git.changesTitle")}
              nodes={unstagedTree}
              collapsedTreePathSet={collapsedTreePathSet}
              onToggleTreePath={toggleTreePath}
              onToggleMobileSelection={toggleMobileSelection}
              selectedMobilePathSet={selectedMobilePathSet}
              selectedTargets={mobileSelectedUnstagedTargets}
              actioning={actioning}
              variant="unstaged"
              swipeRowState={mobileSwipeRowState}
              onSwipeRowChange={setMobileSwipeRowState}
              onStageToggle={handleStageToggle}
              onDiscardWithConfirm={handleDiscardWithConfirm}
              onClearSelectedTargets={() =>
                setSelectedMobilePaths((current) =>
                  current.filter((path) => !mobileSelectedUnstagedTargets.includes(path))
                )
              }
            />
          </MobileGitAccordionSection>

          <MobileGitAccordionSection
            title={t("git.recentVersionsTitle")}
            count={historyTotalCount}
            expanded={mobileExpandedSection === "history"}
            onToggle={() => setMobileExpandedSection("history")}
            trailingContent={<span className="badge">{currentBranch}</span>}
            headerAction={
              <button
                className="git-icon-button git-mobile-section-action"
                type="button"
                aria-label={t("git.operationMenu")}
                title={t("git.operationMenu")}
                aria-expanded={menuOpen}
                onClick={() => {
                  setMobileExpandedSection("history");
                  setMenuOpen((current) => !current);
                }}
                disabled={actioning}
              >
                <MoreIcon />
              </button>
            }
          >
            {menuOpen ? <div className="git-mobile-operations-shell">{renderGitOperationsMenu()}</div> : null}
            <MobileGitHistoryList
              history={history}
              historyLoadingMore={historyLoadingMore}
              hasMore={Boolean(historyNextCursor)}
              actioning={actioning}
              openCommitHash={mobileHistoryMenuCommitHash}
              onToggleMenu={(commitHash) =>
                setMobileHistoryMenuCommitHash((current) =>
                  current === commitHash ? null : commitHash
                )
              }
              onCopyCommitHash={(commitHash) =>
                void copyText(commitHash, t("git.copyCommitHashSuccess"))
              }
              onCopyCommitSubject={(subject) =>
                void copyText(subject, t("git.copyCommitSubjectSuccess"))
              }
              onUndoLastCommit={() => void handleUndoLastCommit()}
              onLoadMore={() => void loadMoreHistory()}
            />
          </MobileGitAccordionSection>
        </div>
      ) : (
        <div
          ref={splitLayoutRef}
          className="git-content-split"
          style={{ gridTemplateRows: splitRows }}
        >
          <section className="git-card git-tree-panel">
            <div ref={treePanelBodyRef} className="git-tree-panel-body">
              {stagedChanges.length > 0 ? (
                <GitChangeGroup
                  title={t("git.stagedChangesTitle")}
                  count={stagedChanges.length}
                  nodes={stagedTree}
                  selectedPath={selectedPath}
                  collapsedTreePathSet={collapsedTreePathSet}
                  onToggleTreePath={toggleTreePath}
                  onSelectFile={setSelectedPath}
                  onToggleMobileSelection={toggleMobileSelection}
                  onStageToggle={handleStageToggle}
                  onDiscard={handleDiscard}
                  actioning={actioning}
                  variant="staged"
                  isMobileViewport={isMobileViewport}
                  selectedMobilePathSet={selectedMobilePathSet}
                  selectedTargets={mobileSelectedStagedTargets}
                  mobileActionMenuOpen={mobileActionMenuVariant === "staged"}
                  onToggleMobileActionMenu={() =>
                    setMobileActionMenuVariant((current) => (current === "staged" ? null : "staged"))
                  }
                  onClearSelectedTargets={() =>
                    setSelectedMobilePaths((current) =>
                      current.filter((path) => !mobileSelectedStagedTargets.includes(path))
                    )
                  }
                />
              ) : null}

              <GitChangeGroup
                title={t("git.changesTitle")}
                count={unstagedChanges.length}
                nodes={unstagedTree}
                selectedPath={selectedPath}
                collapsedTreePathSet={collapsedTreePathSet}
                onToggleTreePath={toggleTreePath}
                onSelectFile={setSelectedPath}
                onToggleMobileSelection={toggleMobileSelection}
                onStageToggle={handleStageToggle}
                onDiscard={handleDiscard}
                actioning={actioning}
                variant="unstaged"
                isMobileViewport={isMobileViewport}
                selectedMobilePathSet={selectedMobilePathSet}
                selectedTargets={mobileSelectedUnstagedTargets}
                mobileActionMenuOpen={mobileActionMenuVariant === "unstaged"}
                onToggleMobileActionMenu={() =>
                  setMobileActionMenuVariant((current) => (current === "unstaged" ? null : "unstaged"))
                }
                onClearSelectedTargets={() =>
                  setSelectedMobilePaths((current) =>
                    current.filter((path) => !mobileSelectedUnstagedTargets.includes(path))
                  )
                }
              />
            </div>
          </section>

          <button
            className="git-panel-divider"
            type="button"
            role="separator"
            aria-label={t("git.resizePanels")}
            aria-orientation="horizontal"
            aria-valuemin={MIN_TREE_PANEL_RATIO}
            aria-valuemax={MAX_TREE_PANEL_RATIO}
            aria-valuenow={historyExpanded ? safeTreePanelRatio : MAX_TREE_PANEL_RATIO}
            data-dragging={panelResizeActive}
            onPointerDown={handlePanelResizeStart}
          >
            <span className="git-panel-divider-handle" aria-hidden="true" />
          </button>

          <section className="git-card git-history-section">
            <div className="git-history-topbar">
              <button
                className="git-section-toggle"
                type="button"
                aria-expanded={historyExpanded}
                aria-label={historyExpanded ? t("git.collapseRecentVersions") : t("git.expandRecentVersions")}
                onClick={() => setHistoryExpanded((current) => !current)}
              >
                <span className="git-section-toggle-main">
                  <TreeChevron expanded={historyExpanded} />
                  <span>{t("git.recentVersionsTitle")}</span>
                </span>
                <span className="workbench-section-counter">{historyTotalCount}</span>
              </button>

              <div className="git-history-actions">
                <span className="badge">{currentBranch}</span>
                <button
                  className="git-icon-button"
                  type="button"
                  aria-label={t("git.operationMenu")}
                  title={t("git.operationMenu")}
                  onClick={() => setMenuOpen((current) => !current)}
                  disabled={actioning}
                >
                  <MoreIcon />
                </button>

                {menuOpen ? renderGitOperationsMenu() : null}
              </div>
            </div>

            {historyExpanded ? (
              <div className="git-history-list" onScroll={handleHistoryScroll}>
                {history.length ? (
                  <>
                    {history.map((item) => (
                      <article
                        key={item.commitHash}
                        className="git-history-entry"
                        data-kind={item.commitKind}
                      >
                        <span
                          className="git-history-marker"
                          data-kind={item.commitKind}
                          aria-hidden="true"
                        />
                        <div className="git-history-body">
                          <div className="git-history-title-row">
                            <strong title={item.subject}>{item.subject}</strong>
                            <span className="git-history-kind-badge" data-kind={item.commitKind}>
                              {formatHistoryCommitKind(item.commitKind)}
                            </span>
                          </div>
                          {item.refs.length > 0 ? (
                            <div className="git-history-ref-list">
                              {item.refs.map((ref) => (
                                <span
                                  key={`${item.commitHash}:${ref.kind}:${ref.name}`}
                                  className="git-history-ref-pill"
                                  data-kind={ref.kind}
                                  data-remote-index={String(resolveRemotePaletteIndex(ref.remoteName))}
                                >
                                  {ref.name}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="git-history-meta">
                            <span className="git-history-hash">{item.commitHash.slice(0, 8)}</span>
                            <span>{item.authorName}</span>
                            <time dateTime={item.authoredAt}>{formatCommitTime(item.authoredAt)}</time>
                          </div>
                        </div>
                      </article>
                    ))}
                    {historyLoadingMore ? <p className="git-history-loading">{t("git.refreshNow")}...</p> : null}
                  </>
                ) : (
                  <p className="status-text">{t("git.noHistory")}</p>
                )}
              </div>
            ) : null}
          </section>
        </div>
      )}
    </section>
  );
}

function GitChangeGroup({
  title,
  count,
  nodes,
  selectedPath,
  collapsedTreePathSet,
  onToggleTreePath,
  onSelectFile,
  onToggleMobileSelection,
  onStageToggle,
  onDiscard,
  actioning,
  variant,
  isMobileViewport,
  selectedMobilePathSet,
  selectedTargets,
  mobileActionMenuOpen,
  onToggleMobileActionMenu,
  onClearSelectedTargets
}: {
  title: string;
  count: number;
  nodes: GitTreeNode[];
  selectedPath: string | null;
  collapsedTreePathSet: ReadonlySet<string>;
  onToggleTreePath: (path: string) => void;
  onSelectFile: (filePath: string) => void;
  onToggleMobileSelection: (filePath: string) => void;
  onStageToggle: (targets: string[], staged: boolean) => Promise<void>;
  onDiscard: (targets: string[]) => Promise<void>;
  actioning: boolean;
  variant: "staged" | "unstaged";
  isMobileViewport: boolean;
  selectedMobilePathSet: ReadonlySet<string>;
  selectedTargets: string[];
  mobileActionMenuOpen: boolean;
  onToggleMobileActionMenu: () => void;
  onClearSelectedTargets: () => void;
}) {
  const groupTargets = collectTreeTargets(nodes);
  const stageActionLabel = variant === "staged" ? t("git.unstageAll") : t("git.stageAll");

  return (
    <section className="git-tree-group" data-variant={variant}>
      <div className="git-section-header git-tree-group-header">
        <h3>{title}</h3>

        <div className="git-tree-group-actions">
          <span className="workbench-section-counter">{count}</span>
          {!isMobileViewport && groupTargets.length > 0 ? (
            <>
              <button
                className="git-icon-button"
                type="button"
                aria-label={stageActionLabel}
                title={stageActionLabel}
                onClick={() => void onStageToggle(groupTargets, variant === "staged")}
                disabled={actioning}
              >
                <StageIcon staged={variant === "staged"} />
              </button>
              {variant === "unstaged" ? (
                <button
                  className="git-icon-button danger"
                  type="button"
                  aria-label={t("git.discardAll")}
                  title={t("git.discardAll")}
                  onClick={() => void onDiscard(groupTargets)}
                  disabled={actioning}
                >
                  <DiscardIcon />
                </button>
              ) : null}
            </>
          ) : null}
          {isMobileViewport && selectedTargets.length > 0 ? (
            <button
              className="git-icon-button"
              type="button"
              aria-label={t("git.operationMenu")}
              title={t("git.operationMenu")}
              onClick={onToggleMobileActionMenu}
              disabled={actioning}
            >
              <MoreIcon />
            </button>
          ) : null}
        </div>

        {isMobileViewport && mobileActionMenuOpen ? (
          <div className="git-selection-menu">
            <div className="git-menu-section">
              <span className="git-menu-caption">{t("git.selectedFiles")}</span>
              <strong className="git-menu-branch">{selectedTargets.length}</strong>
            </div>

            <div className="git-menu-section">
              <button
                className="git-menu-item"
                type="button"
                disabled={actioning}
                onClick={() => void onStageToggle(selectedTargets, variant === "staged")}
              >
                <span>{variant === "staged" ? t("git.unstage") : t("git.stage")}</span>
              </button>

              {variant === "unstaged" ? (
                <button
                  className="git-menu-item"
                  type="button"
                  disabled={actioning}
                  onClick={() => void onDiscard(selectedTargets)}
                >
                  <span>{t("git.discard")}</span>
                </button>
              ) : null}

              <button
                className="git-menu-item"
                type="button"
                disabled={actioning}
                onClick={onClearSelectedTargets}
              >
                <span>{t("git.clearSelection")}</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="git-tree-shell" role="tree" aria-label={title}>
        {nodes.length ? (
          renderTreeNodes({
            nodes,
            depth: 0,
            collapsedTreePathSet,
            selectedPath,
            onToggleTreePath,
            onSelectFile,
            onToggleMobileSelection,
            onStageToggle,
            onDiscard,
            actioning,
            variant,
            isMobileViewport,
            selectedMobilePathSet
          })
        ) : (
          <p className="git-tree-status">{t("git.noChanges")}</p>
        )}
      </div>
    </section>
  );
}

function MobileGitAccordionSection({
  title,
  count,
  expanded,
  onToggle,
  trailingContent,
  headerAction,
  children
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  trailingContent?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="git-mobile-section" data-expanded={expanded}>
      <div className="git-mobile-section-header">
        <button
          className="git-mobile-section-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="git-mobile-section-toggle-main">
            <TreeChevron expanded={expanded} />
            <h3>{title}</h3>
          </span>
          <span className="git-mobile-section-toggle-meta">
            {trailingContent}
            <span className="workbench-section-counter">{count}</span>
          </span>
        </button>
        {headerAction ? <div className="git-mobile-section-header-action">{headerAction}</div> : null}
      </div>

      {expanded ? <div className="git-mobile-section-body">{children}</div> : null}
    </section>
  );
}

function MobileGitChangeSection({
  title,
  nodes,
  collapsedTreePathSet,
  onToggleTreePath,
  onToggleMobileSelection,
  selectedMobilePathSet,
  selectedTargets,
  actioning,
  variant,
  swipeRowState,
  onSwipeRowChange,
  onStageToggle,
  onDiscardWithConfirm,
  onClearSelectedTargets
}: {
  title: string;
  nodes: GitTreeNode[];
  collapsedTreePathSet: ReadonlySet<string>;
  onToggleTreePath: (path: string) => void;
  onToggleMobileSelection: (filePath: string) => void;
  selectedMobilePathSet: ReadonlySet<string>;
  selectedTargets: string[];
  actioning: boolean;
  variant: "staged" | "unstaged";
  swipeRowState: { path: string; direction: MobileSwipeDirection } | null;
  onSwipeRowChange: (state: { path: string; direction: MobileSwipeDirection } | null) => void;
  onStageToggle: (targets: string[], staged: boolean) => Promise<void>;
  onDiscardWithConfirm: (targets: string[], label: string) => Promise<void>;
  onClearSelectedTargets: () => void;
}) {
  return (
    <div className="git-mobile-record-shell">
      {selectedTargets.length > 0 ? (
        <div className="git-mobile-selection-toolbar">
          <span className="git-mobile-selection-count">
            {t("git.selectedFiles")} {selectedTargets.length}
          </span>
          <div className="git-mobile-selection-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={actioning}
              onClick={() => void onStageToggle(selectedTargets, variant === "staged")}
            >
              {variant === "staged" ? t("git.unstage") : t("git.stage")}
            </button>
            {variant === "unstaged" ? (
              <button
                type="button"
                className="secondary-button workbench-danger-button"
                disabled={actioning}
                onClick={() => void onDiscardWithConfirm(selectedTargets, `${selectedTargets.length}`)}
              >
                {t("git.discard")}
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              disabled={actioning}
              onClick={onClearSelectedTargets}
            >
              {t("git.clearSelection")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="git-mobile-record-list" role="tree" aria-label={title}>
        {nodes.length ? (
          renderMobileTreeNodes({
            nodes,
            depth: 0,
            collapsedTreePathSet,
            onToggleTreePath,
            onToggleMobileSelection,
            selectedMobilePathSet,
            actioning,
            variant,
            swipeRowState,
            onSwipeRowChange,
            onStageToggle,
            onDiscardWithConfirm
          })
        ) : (
          <p className="git-tree-status">{t("git.noChanges")}</p>
        )}
      </div>
    </div>
  );
}

function renderMobileTreeNodes({
  nodes,
  depth,
  collapsedTreePathSet,
  onToggleTreePath,
  onToggleMobileSelection,
  selectedMobilePathSet,
  actioning,
  variant,
  swipeRowState,
  onSwipeRowChange,
  onStageToggle,
  onDiscardWithConfirm
}: {
  nodes: GitTreeNode[];
  depth: number;
  collapsedTreePathSet: ReadonlySet<string>;
  onToggleTreePath: (path: string) => void;
  onToggleMobileSelection: (filePath: string) => void;
  selectedMobilePathSet: ReadonlySet<string>;
  actioning: boolean;
  variant: "staged" | "unstaged";
  swipeRowState: { path: string; direction: MobileSwipeDirection } | null;
  onSwipeRowChange: (state: { path: string; direction: MobileSwipeDirection } | null) => void;
  onStageToggle: (targets: string[], staged: boolean) => Promise<void>;
  onDiscardWithConfirm: (targets: string[], label: string) => Promise<void>;
}) {
  return nodes.map((node) => {
    if (node.kind === "directory") {
      const expanded = !collapsedTreePathSet.has(node.path);
      const directoryTargets = collectTreeTargets(node.children);
      const rowKey = `directory:${node.path}`;

      return (
        <div key={rowKey} className="git-mobile-record-branch">
          <MobileSwipeRow
            rowKey={rowKey}
            openState={swipeRowState?.path === rowKey ? swipeRowState.direction : null}
            onOpenStateChange={(direction) =>
              onSwipeRowChange(direction ? { path: rowKey, direction } : null)
            }
            leadingAction={
              directoryTargets.length > 0
                ? {
                    label: variant === "staged" ? t("git.unstage") : t("git.stage"),
                    tone: "accent",
                    onPress: () => void onStageToggle(directoryTargets, variant === "staged")
                  }
                : null
            }
            trailingAction={
              variant === "unstaged" && directoryTargets.length > 0
                ? {
                    label: t("git.discard"),
                    tone: "danger",
                    onPress: () => void onDiscardWithConfirm(directoryTargets, node.path)
                  }
                : null
            }
          >
            <button
              className="git-mobile-record git-mobile-record-directory"
              type="button"
              style={{
                paddingInlineStart: `${MOBILE_GIT_RECORD_BASE_INSET_PX + depth * MOBILE_GIT_RECORD_DEPTH_STEP_PX}px`
              }}
              onClick={() => onToggleTreePath(node.path)}
            >
              <span className="git-mobile-record-leading">
                <span className="git-tree-chevron" data-expanded={expanded}>
                  <TreeChevron expanded={expanded} />
                </span>
                <span className="git-mobile-record-title">{node.name}</span>
              </span>
              <span className="git-mobile-record-meta">{directoryTargets.length}</span>
            </button>
          </MobileSwipeRow>

          {expanded ? (
            <div className="git-mobile-record-children" role="group">
              {renderMobileTreeNodes({
                nodes: node.children,
                depth: depth + 1,
                collapsedTreePathSet,
                onToggleTreePath,
                onToggleMobileSelection,
                selectedMobilePathSet,
                actioning,
                variant,
                swipeRowState,
                onSwipeRowChange,
                onStageToggle,
                onDiscardWithConfirm
              })}
            </div>
          ) : null}
        </div>
      );
    }

    const rowKey = `file:${node.path}`;
    const mobileSelected = selectedMobilePathSet.has(node.path);

    return (
      <MobileSwipeRow
        key={rowKey}
        rowKey={rowKey}
        openState={swipeRowState?.path === rowKey ? swipeRowState.direction : null}
        onOpenStateChange={(direction) =>
          onSwipeRowChange(direction ? { path: rowKey, direction } : null)
        }
        leadingAction={{
          label: variant === "staged" ? t("git.unstage") : t("git.stage"),
          tone: "accent",
          onPress: () => void onStageToggle([node.change.path], variant === "staged")
        }}
        trailingAction={
          variant === "unstaged"
            ? {
                label: t("git.discard"),
                tone: "danger",
                onPress: () => void onDiscardWithConfirm([node.change.path], node.path)
              }
            : null
        }
      >
        <div
          className="git-mobile-record git-mobile-record-file"
          data-active={mobileSelected}
          style={{
            paddingInlineStart: `${MOBILE_GIT_RECORD_BASE_INSET_PX + depth * MOBILE_GIT_RECORD_DEPTH_STEP_PX}px`
          }}
        >
          <input
            className="git-tree-select-checkbox"
            type="checkbox"
            checked={mobileSelected}
            aria-label={`${t("git.selectFile")} ${node.name}`}
            onChange={() => onToggleMobileSelection(node.change.path)}
          />
          <button
            className="git-mobile-record-file-main"
            type="button"
            onClick={() => onToggleMobileSelection(node.change.path)}
          >
            <span
              className="git-tree-file-icon"
              data-kind={resolveFileTreeIconKind(node.name)}
              aria-hidden="true"
            >
              {resolveFileTreeIconLabel(node.name)}
            </span>
            <span className="git-mobile-record-copy">
              <span className="git-mobile-record-title">{node.name}</span>
              <span className="git-mobile-record-path">{node.path}</span>
            </span>
            <span className="git-status-badge" data-status={node.status}>
              {node.status}
            </span>
          </button>
        </div>
      </MobileSwipeRow>
    );
  });
}

function MobileSwipeRow({
  rowKey,
  openState,
  onOpenStateChange,
  leadingAction,
  trailingAction,
  children
}: {
  rowKey: string;
  openState: MobileSwipeDirection | null;
  onOpenStateChange: (direction: MobileSwipeDirection | null) => void;
  leadingAction: { label: string; tone: "accent" | "danger"; onPress: () => void } | null;
  trailingAction: { label: string; tone: "accent" | "danger"; onPress: () => void } | null;
  children: ReactNode;
}) {
  const haptics = useHaptics();
  const pointerStateRef = useRef<{ pointerId: number; startX: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    if (!openState) {
      setDragOffset(0);
    }
  }, [openState, rowKey]);

  const resolvedOffset =
    dragOffset !== 0
      ? dragOffset
      : openState === "leading"
        ? 78
        : openState === "trailing"
          ? -78
          : 0;

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    pointerStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pointerState = pointerStateRef.current;

    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      return;
    }

    const maxLeading = leadingAction ? 88 : 0;
    const maxTrailing = trailingAction ? 88 : 0;
    const nextOffset = Math.max(-maxTrailing, Math.min(maxLeading, event.clientX - pointerState.startX));
    setDragOffset(nextOffset);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const pointerState = pointerStateRef.current;

    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    pointerStateRef.current = null;

    if (dragOffset >= 44 && leadingAction) {
      void haptics.trigger("gesture");
      onOpenStateChange("leading");
      setDragOffset(0);
      return;
    }

    if (dragOffset <= -44 && trailingAction) {
      void haptics.trigger("gesture");
      onOpenStateChange("trailing");
      setDragOffset(0);
      return;
    }

    onOpenStateChange(null);
    setDragOffset(0);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const pointerState = pointerStateRef.current;

    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    pointerStateRef.current = null;
    setDragOffset(0);
  }

  return (
    <div
      className="git-mobile-swipe-row"
      data-open-state={openState ?? "closed"}
      data-dragging={dragOffset !== 0}
    >
      {leadingAction ? (
        <button
          type="button"
          className="git-mobile-swipe-action leading"
          data-tone={leadingAction.tone}
          onClick={() => {
            void haptics.trigger("action");
            onOpenStateChange(null);
            leadingAction.onPress();
          }}
        >
          {leadingAction.label}
        </button>
      ) : null}

      {trailingAction ? (
        <button
          type="button"
          className="git-mobile-swipe-action trailing"
          data-tone={trailingAction.tone}
          onClick={() => {
            void haptics.trigger(trailingAction.tone === "danger" ? "warning" : "action");
            onOpenStateChange(null);
            trailingAction.onPress();
          }}
        >
          {trailingAction.label}
        </button>
      ) : null}

      <div
        className="git-mobile-swipe-content"
        style={{ transform: `translateX(${resolvedOffset}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {children}
      </div>
    </div>
  );
}

function MobileGitHistoryList({
  history,
  historyLoadingMore,
  hasMore,
  actioning,
  openCommitHash,
  onToggleMenu,
  onCopyCommitHash,
  onCopyCommitSubject,
  onUndoLastCommit,
  onLoadMore
}: {
  history: GitHistoryItemDto[];
  historyLoadingMore: boolean;
  hasMore: boolean;
  actioning: boolean;
  openCommitHash: string | null;
  onToggleMenu: (commitHash: string) => void;
  onCopyCommitHash: (commitHash: string) => void;
  onCopyCommitSubject: (subject: string) => void;
  onUndoLastCommit: () => void;
  onLoadMore: () => void;
}) {
  if (!history.length) {
    return <p className="git-tree-status">{t("git.noHistory")}</p>;
  }

  return (
    <div className="git-mobile-history-list">
      {history.map((item, index) => {
        const menuOpen = openCommitHash === item.commitHash;
        const canUndo = index === 0 && item.commitKind === "local";

        return (
          <article key={item.commitHash} className="git-mobile-history-entry" data-kind={item.commitKind}>
            <div className="git-mobile-history-entry-main">
              <span className="git-history-marker" data-kind={item.commitKind} aria-hidden="true" />
              <div className="git-mobile-history-copy">
                <div className="git-history-title-row">
                  <strong title={item.subject}>{item.subject}</strong>
                  <span className="git-history-kind-badge" data-kind={item.commitKind}>
                    {formatHistoryCommitKind(item.commitKind)}
                  </span>
                </div>
                {item.refs.length > 0 ? (
                  <div className="git-history-ref-list">
                    {item.refs.map((ref) => (
                      <span
                        key={`${item.commitHash}:${ref.kind}:${ref.name}`}
                        className="git-history-ref-pill"
                        data-kind={ref.kind}
                        data-remote-index={String(resolveRemotePaletteIndex(ref.remoteName))}
                      >
                        {ref.name}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="git-history-meta">
                  <span className="git-history-hash">{item.commitHash.slice(0, 8)}</span>
                  <span>{item.authorName}</span>
                  <time dateTime={item.authoredAt}>{formatCommitTime(item.authoredAt)}</time>
                </div>
              </div>
              <button
                type="button"
                className="git-icon-button"
                aria-label={t("git.historyItemMenu")}
                onClick={() => onToggleMenu(item.commitHash)}
              >
                <MoreIcon />
              </button>
            </div>

            {menuOpen ? (
              <div className="git-mobile-history-menu">
                <button type="button" className="git-menu-item" onClick={() => onCopyCommitHash(item.commitHash)}>
                  <span>{t("git.copyCommitHash")}</span>
                </button>
                <button type="button" className="git-menu-item" onClick={() => onCopyCommitSubject(item.subject)}>
                  <span>{t("git.copyCommitSubject")}</span>
                </button>
                {canUndo ? (
                  <button
                    type="button"
                    className="git-menu-item"
                    disabled={actioning}
                    onClick={onUndoLastCommit}
                  >
                    <span>{t("git.undoLastCommit")}</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}

      {hasMore ? (
        <button
          type="button"
          className="secondary-button git-mobile-history-more"
          disabled={historyLoadingMore}
          onClick={onLoadMore}
        >
          {historyLoadingMore ? `${t("git.refreshNow")}...` : t("common.loadMore")}
        </button>
      ) : null}
    </div>
  );
}

function renderTreeNodes({
  nodes,
  depth,
  collapsedTreePathSet,
  selectedPath,
  onToggleTreePath,
  onSelectFile,
  onToggleMobileSelection,
  onStageToggle,
  onDiscard,
  actioning,
  variant,
  isMobileViewport,
  selectedMobilePathSet
}: {
  nodes: GitTreeNode[];
  depth: number;
  collapsedTreePathSet: ReadonlySet<string>;
  selectedPath: string | null;
  onToggleTreePath: (path: string) => void;
  onSelectFile: (filePath: string) => void;
  onToggleMobileSelection: (filePath: string) => void;
  onStageToggle: (targets: string[], staged: boolean) => Promise<void>;
  onDiscard: (targets: string[]) => Promise<void>;
  actioning: boolean;
  variant: "staged" | "unstaged";
  isMobileViewport: boolean;
  selectedMobilePathSet: ReadonlySet<string>;
}) {
  return nodes.map((node) => {
    if (node.kind === "directory") {
      const expanded = !collapsedTreePathSet.has(node.path);
      const directoryTargets = collectTreeTargets(node.children);
      const stageDirectoryLabel = `${variant === "staged" ? t("git.unstage") : t("git.stage")} ${node.path}`;
      const discardDirectoryLabel = `${t("git.discard")} ${node.path}`;

      return (
        <div key={`directory:${node.path}`} className="git-tree-node">
          <div className="git-tree-row" role="treeitem" aria-expanded={expanded}>
            <button
              className="git-tree-trigger"
              type="button"
              style={{ paddingInlineStart: `${6 + depth * 8}px` }}
              onClick={() => onToggleTreePath(node.path)}
            >
              <span className="git-tree-chevron" data-expanded={expanded}>
                <TreeChevron expanded={expanded} />
              </span>
              <span className="git-tree-label git-tree-label-directory">{node.name}</span>
            </button>

            {!isMobileViewport && directoryTargets.length > 0 ? (
              <div className="git-row-actions">
                <button
                  className="git-icon-button"
                  type="button"
                  aria-label={stageDirectoryLabel}
                  title={stageDirectoryLabel}
                  onClick={() => void onStageToggle(directoryTargets, variant === "staged")}
                  disabled={actioning}
                >
                  <StageIcon staged={variant === "staged"} />
                </button>
                {variant === "unstaged" ? (
                  <button
                    className="git-icon-button danger"
                    type="button"
                    aria-label={discardDirectoryLabel}
                    title={discardDirectoryLabel}
                    onClick={() => void onDiscard(directoryTargets)}
                    disabled={actioning}
                  >
                    <DiscardIcon />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {expanded ? (
            <div className="git-tree-children" role="group">
              {renderTreeNodes({
                nodes: node.children,
                depth: depth + 1,
                collapsedTreePathSet,
                selectedPath,
                onToggleTreePath,
                onSelectFile,
                onToggleMobileSelection,
                onStageToggle,
                onDiscard,
                actioning,
                variant,
                isMobileViewport,
                selectedMobilePathSet
              })}
            </div>
          ) : null}
        </div>
      );
    }

    const mobileSelected = selectedMobilePathSet.has(node.path);
    const active = isMobileViewport ? mobileSelected : selectedPath === node.path;

    if (isMobileViewport) {
      return (
        <div
          key={`file:${node.path}`}
          className="git-tree-row"
          role="treeitem"
          data-active={active}
          data-mobile="true"
        >
          <input
            className="git-tree-select-checkbox"
            type="checkbox"
            checked={mobileSelected}
            aria-label={`${t("git.selectFile")} ${node.name}`}
            onChange={() => onToggleMobileSelection(node.change.path)}
          />

          <button
            className="git-tree-file-button"
            type="button"
            data-active={active}
            data-mobile="true"
            style={{ paddingInlineStart: `${18 + depth * 8}px` }}
            onClick={() => onToggleMobileSelection(node.change.path)}
          >
            <span
              className="git-tree-file-icon"
              data-kind={resolveFileTreeIconKind(node.name)}
              aria-hidden="true"
            >
              {resolveFileTreeIconLabel(node.name)}
            </span>
            <span className="git-tree-label-wrap">
              <span className="git-tree-label">{node.name}</span>
            </span>
            <span className="git-tree-file-meta">
              <span className="git-status-badge" data-status={node.status}>
                {node.status}
              </span>
            </span>
          </button>
        </div>
      );
    }

    return (
      <div
        key={`file:${node.path}`}
        className="git-tree-row"
        role="treeitem"
        data-active={active}
      >
        <button
          className="git-tree-file-button"
          type="button"
          data-active={active}
          style={{ paddingInlineStart: `${18 + depth * 8}px` }}
          onClick={() => onSelectFile(node.change.path)}
        >
          <span
            className="git-tree-file-icon"
            data-kind={resolveFileTreeIconKind(node.name)}
            aria-hidden="true"
          >
            {resolveFileTreeIconLabel(node.name)}
          </span>
          <span className="git-tree-label-wrap">
            <span className="git-tree-label">{node.name}</span>
          </span>
            <span className="git-tree-file-meta">
              <span className="git-status-badge" data-status={node.status}>
                {node.status}
              </span>
            </span>
          </button>

        <div className="git-row-actions">
          <button
            className="git-icon-button"
            type="button"
            aria-label={node.variant === "staged" ? t("git.unstage") : t("git.stage")}
            title={node.variant === "staged" ? t("git.unstage") : t("git.stage")}
            onClick={() => void onStageToggle([node.change.path], node.variant === "staged")}
            disabled={actioning}
          >
            <StageIcon staged={node.variant === "staged"} />
          </button>
          {variant === "unstaged" ? (
            <button
              className="git-icon-button danger"
              type="button"
              aria-label={t("git.discard")}
              title={t("git.discard")}
              onClick={() => void onDiscard([node.change.path])}
              disabled={actioning}
            >
              <DiscardIcon />
            </button>
          ) : null}
        </div>
      </div>
    );
  });
}

function createMutableDirectory(name: string, path: string): MutableGitTreeDirectoryNode {
  return {
    kind: "directory",
    name,
    path,
    children: new Map()
  };
}

function buildChangeTree(changes: GitChangeItemDto[], variant: "staged" | "unstaged"): GitTreeNode[] {
  const root = createMutableDirectory("", "");

  for (const change of changes) {
    const normalizedPath = change.path.replace(/\\/g, "/");
    const segments = normalizedPath.split("/").filter(Boolean);
    let currentDirectory = root;

    segments.forEach((segment, index) => {
      const currentPath = segments.slice(0, index + 1).join("/");

      if (index === segments.length - 1) {
        currentDirectory.children.set(`file:${currentPath}`, {
          kind: "file",
          name: segment,
          path: normalizedPath,
          change,
          status: getChangeStatusForVariant(change, variant),
          variant
        });
        return;
      }

      const directoryKey = `directory:${currentPath}`;
      const existingDirectory = currentDirectory.children.get(directoryKey);

      if (existingDirectory && existingDirectory.kind === "directory") {
        currentDirectory = existingDirectory;
        return;
      }

      const nextDirectory = createMutableDirectory(segment, currentPath);
      currentDirectory.children.set(directoryKey, nextDirectory);
      currentDirectory = nextDirectory;
    });
  }

  return compactTreeNodes(finalizeTreeNodes([...root.children.values()]));
}

function finalizeTreeNodes(nodes: Array<MutableGitTreeDirectoryNode | GitTreeFileNode>): GitTreeNode[] {
  return [...nodes]
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name, "zh-CN");
    })
    .map((node) =>
      node.kind === "directory"
        ? {
            kind: "directory",
            name: node.name,
            path: node.path,
            children: finalizeTreeNodes([...node.children.values()])
          }
        : node
    );
}

function compactTreeNodes(nodes: GitTreeNode[]): GitTreeNode[] {
  return nodes.map((node) => {
    if (node.kind !== "directory") {
      return node;
    }

    const compactedChildren = compactTreeNodes(node.children);
    let nextName = node.name;
    let nextPath = node.path;
    let nextChildren = compactedChildren;

    while (nextChildren.length === 1 && nextChildren[0]?.kind === "directory") {
      const child = nextChildren[0];

      nextName = `${nextName}/${child.name}`;
      nextPath = child.path;
      nextChildren = child.children;
    }

    return {
      kind: "directory",
      name: nextName,
      path: nextPath,
      children: nextChildren
    };
  });
}

function collectSelectionTargets(
  selectedPaths: string[],
  changes: GitChangeItemDto[],
  variant: "staged" | "unstaged"
) {
  const selectedSet = new Set(selectedPaths);

  return changes
    .filter((item) => hasVariantChanges(item, variant) && selectedSet.has(item.path))
    .map((item) => item.path);
}

function collectTreeTargets(nodes: GitTreeNode[]) {
  const targets: string[] = [];
  const seen = new Set<string>();

  function visit(node: GitTreeNode) {
    if (node.kind === "file") {
      if (!seen.has(node.path)) {
        seen.add(node.path);
        targets.push(node.path);
      }
      return;
    }

    node.children.forEach(visit);
  }

  nodes.forEach(visit);

  return targets;
}

function hasVariantChanges(change: GitChangeItemDto, variant: "staged" | "unstaged") {
  return variant === "staged" ? Boolean(change.stagedStatus) : Boolean(change.worktreeStatus);
}

function getChangeStatusForVariant(change: GitChangeItemDto, variant: "staged" | "unstaged") {
  return variant === "staged"
    ? change.stagedStatus ?? change.status
    : change.worktreeStatus ?? change.status;
}

function buildCommitDraft(subject: string): CommitDraftDto {
  return {
    subject: normalizeCommitSubject(subject).trim(),
    body: null,
    footer: null,
    source: "manual"
  };
}

function normalizeCommitSubject(subject: string) {
  return subject.replace(/[\r\n]+/g, " ");
}

function resizeCommitEditor(editor: HTMLTextAreaElement | null) {
  if (!editor) {
    return;
  }

  editor.style.height = "0px";
  const nextHeight = Math.min(Math.max(editor.scrollHeight, 34), 120);
  editor.style.height = `${nextHeight}px`;
  editor.style.overflowY = editor.scrollHeight > 120 ? "auto" : "hidden";
}

function formatHistoryCommitKind(kind: GitHistoryItemDto["commitKind"]) {
  switch (kind) {
    case "local":
      return t("git.historyKindLocal");
    case "remote":
      return t("git.historyKindRemote");
    default:
      return t("git.historyKindShared");
  }
}

function resolveRemotePaletteIndex(remoteName: string | null) {
  if (!remoteName) {
    return 0;
  }

  let hash = 0;

  for (const character of remoteName) {
    hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
  }

  return hash % 6;
}

function readError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return mapGitError(error) ?? error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return (error as Error).message;
  }

  return fallback;
}

function buildGitSidebarSnapshotKey(workspaceId: string) {
  return `git-sidebar.snapshot.${workspaceId}`;
}

function mapGitError(error: ApiError): string | null {
  switch (error.errorCode) {
    case "UNAUTHORIZED":
      return t("git.errors.unauthorized");
    case "WORKSPACE_NOT_FOUND":
      return t("git.errors.workspaceNotFound");
    case "INVALID_WORKSPACE":
      return t("git.errors.invalidWorkspace");
    case "NOT_GIT_REPOSITORY":
      return t("git.errors.notGitRepository");
    case "GIT_REPO_NOT_FOUND":
      return t("git.errors.repoNotFound");
    case "PATH_OUT_OF_WORKSPACE":
      return t("git.errors.pathOutOfWorkspace");
    case "INVALID_TARGET":
      return t("git.errors.invalidTarget");
    case "NOT_STAGED":
      return t("git.errors.notStaged");
    case "EMPTY_STAGED_CHANGES":
      return t("git.errors.emptyStagedChanges");
    case "BRANCH_CONFLICT":
      return t("git.errors.branchConflict");
    case "BRANCH_NOT_FOUND":
      return t("git.errors.branchNotFound");
    case "REMOTE_NOT_FOUND":
      return t("git.errors.remoteNotFound");
    case "GIT_REMOTE_AUTH_FAILED":
      return t("git.errors.remoteAuthFailed");
    case "GIT_PUSH_FAILED":
      return t("git.errors.pushFailed");
    case "GIT_PULL_FAILED":
      return t("git.errors.pullFailed");
    case "GIT_REMOTE_FAILED":
      return t("git.errors.remoteFailed");
    case "GIT_COMMAND_TIMEOUT":
      return t("git.errors.commandTimeout");
    case "GIT_DISCARD_FAILED":
      return t("git.discardFailed");
    case "GIT_UNDO_FAILED":
      return t("git.undoLastCommitFailed");
    default:
      return null;
  }
}

function TreeChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className="git-chevron-icon"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function StageIcon({ staged }: { staged: boolean }) {
  if (staged) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M5 12h14" />
      </svg>
    );
  }

  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function DiscardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M10 7L6 11l4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M7 11h7c3.87 0 7 3.13 7 7 0 1.9-.76 3.63-2 4.89"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DraftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function formatCommitTime(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}
