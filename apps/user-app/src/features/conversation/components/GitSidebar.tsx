import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type UIEvent
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import {
  showDesktopContextMenu,
  type DesktopContextMenuItem
} from "../../../platform/desktop/desktop-context-menu";
import { usePlatform } from "../../../platform/platform-provider";
import { getDefaultSessionPermissionMode } from "../../../preferences/default-session-permission-mode";
import {
  clearViewSnapshot,
  readViewSnapshot,
  writeViewSnapshot
} from "../../../shared/cache/view-snapshot-cache";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import type { GitRealtimeSnapshotDto } from "../../../network/workbench-realtime-client";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import {
  commitDraft,
  createCommitDraft,
  addGitIgnoreTargets,
  discardGitTargets,
  getGitBranches,
  getGitCommitDetail,
  getGitDiff,
  getGitRemotes,
  getGitStatus,
  getGitHistory,
  initializeGitRepository,
  stageGitTargets,
  switchGitBranch,
  syncGitRemote,
  undoLastCommit,
  unstageGitTargets,
  type CommitDraftDto,
  type GitCommitChangedFileDto,
  type GitCommitDetailDto,
  type GitBranchSnapshotDto,
  type GitChangeItemDto,
  type GitHistoryItemDto,
  type GitRemoteAuthDto,
  type GitRemoteItemDto,
  type GitStatusDto
} from "../api/git-api";
import {
  getSessionDetail,
  startLiveSession,
  type ProviderId
} from "../api/conversation-api";
import { useTransientScrollbarVisibility } from "./useTransientScrollbarVisibility";
import {
  resolveFileTreeIconKind,
  resolveFileTreeIconLabel
} from "./file-tree-icon";
import { FileViewerModal } from "./FileViewerModal";
import { SessionProviderPicker } from "./SessionProviderPicker";
import { useWorkbenchShell } from "./WorkbenchLayout";
import { WorkbenchModal } from "./WorkbenchModal";
import { buildWorkspaceSessionPath } from "../../workbench/utils/workbench-navigation";
import {
  buildScopedSnapshotKey,
  isSameTargetHostId,
  readSnapshotTargetHostId
} from "../../workbench/utils/resource-scope";

interface GitSidebarProps {
  className?: string;
  workspaceId: string | null | undefined;
  panelActive?: boolean;
  externalWindowMode?: boolean;
  workbenchShellOverrides?: GitSidebarWorkbenchShellOverrides;
}

export interface GitSidebarWorkbenchShellOverrides {
  currentTargetHostId?: string | null;
  subscribeGitSnapshot?: (workspaceId: string, options?: { knownRevision?: string | null; targetHostId?: string | null }) => void;
  requestGitRefresh?: (workspaceId: string, options?: { knownRevision?: string | null; targetHostId?: string | null }) => void;
  addGitSnapshotListener?: (
    listener: (snapshot: GitRealtimeSnapshotDto) => void
  ) => () => void;
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
type MobileSwipeDirection = "trailing";

const DEFAULT_TREE_PANEL_RATIO = 56;
const MIN_TREE_PANEL_RATIO = 28;
const MAX_TREE_PANEL_RATIO = 72;
const PANEL_RESIZER_HEIGHT = 8;
const GIT_MOBILE_BREAKPOINT_PX = 960;
const GIT_SNAPSHOT_CACHE_MAX_AGE_MS = 60 * 1000;
const GIT_HISTORY_PAGE_SIZE = 20;
const MOBILE_GIT_RECORD_BASE_INSET_PX = 9;
const MOBILE_GIT_RECORD_DEPTH_STEP_PX = 9;
const SWIPE_ACTION_WIDTH = 68;
const GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX = 12;
const GIT_OPERATIONS_MENU_GAP_PX = 8;
const GIT_OPERATIONS_MENU_DEFAULT_WIDTH_PX = 260;
const GIT_OPERATIONS_MENU_MIN_HEIGHT_PX = 120;
const GIT_COMMIT_EXPLAIN_DIFF_LIMIT = 60_000;

interface GitSidebarSnapshot {
  revision?: string | null;
  status: GitStatusDto | null;
  history: GitHistoryItemDto[];
  historyTotalCount: number;
  historyNextCursor: string | null;
  branches: GitBranchSnapshotDto | null;
}

interface RemoteAuthFormState {
  authMode: "none" | "basic" | "token";
  username: string;
  password: string;
  token: string;
  rememberOnHost: boolean;
}

interface RemoteSessionAuthState {
  auth: GitRemoteAuthDto | null;
  rememberOnHost: boolean;
}

type GitRemoteAuthProvider = "generic" | "github";
type PushRemoteModalMode = "push" | "auth";
type GitRemoteCredentialState = "session" | "host" | "missing";

interface GitOperationsMenuPosition {
  top: number;
  left: number;
  maxHeight: number;
  transformOrigin: string;
}

const INITIAL_REMOTE_AUTH_FORM: RemoteAuthFormState = {
  authMode: "none",
  username: "",
  password: "",
  token: "",
  rememberOnHost: false
};

export function GitSidebar({
  className,
  workspaceId,
  panelActive = true,
  externalWindowMode = false,
  workbenchShellOverrides
}: GitSidebarProps) {
  const navigate = useNavigate();
  const platform = usePlatform();
  const workbenchShell = useWorkbenchShell();
  const {
    subscribeGitSnapshot,
    requestGitRefresh,
    addGitSnapshotListener,
    requestNavigationRefresh,
    selectWorkspace,
    upsertNavigationSession,
    currentTargetHostId,
    currentWorkspaceRef
  } = {
    ...workbenchShell,
    ...workbenchShellOverrides
  };
  const [status, setStatus] = useState<GitStatusDto | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
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
  const [desktopHistoryMenuCommitHash, setDesktopHistoryMenuCommitHash] = useState<string | null>(null);
  const [allHistoryModalOpen, setAllHistoryModalOpen] = useState(false);
  const [commitDetailModalCommitHash, setCommitDetailModalCommitHash] = useState<string | null>(null);
  const [commitDetailModalLoading, setCommitDetailModalLoading] = useState(false);
  const [commitDetailModalError, setCommitDetailModalError] = useState<string | null>(null);
  const [commitDetailModalData, setCommitDetailModalData] = useState<GitCommitDetailDto | null>(null);
  const [explainCommitHash, setExplainCommitHash] = useState<string | null>(null);
  const [explainProviderModalOpen, setExplainProviderModalOpen] = useState(false);
  const [explainProvider, setExplainProvider] = useState<ProviderId | null>(null);
  const [explainingChange, setExplainingChange] = useState(false);
  const [pushRemoteModalOpen, setPushRemoteModalOpen] = useState(false);
  const [pushRemoteModalMode, setPushRemoteModalMode] = useState<PushRemoteModalMode>("push");
  const [pushRemotes, setPushRemotes] = useState<GitRemoteItemDto[]>([]);
  const [pushRemotesLoading, setPushRemotesLoading] = useState(false);
  const [pushSelectedRemotes, setPushSelectedRemotes] = useState<Set<string>>(new Set());
  const [pushResults, setPushResults] = useState<Map<string, { ok: boolean; summary: string }>>(new Map());
  const [remoteSessionAuthStates, setRemoteSessionAuthStates] = useState<Record<string, RemoteSessionAuthState>>({});
  const [remoteAuthModalOpen, setRemoteAuthModalOpen] = useState(false);
  const [remoteAuthTargetRemoteName, setRemoteAuthTargetRemoteName] = useState<string | null>(null);
  const [remoteAuthForm, setRemoteAuthForm] = useState<RemoteAuthFormState>(INITIAL_REMOTE_AUTH_FORM);
  const [remoteAuthProvider, setRemoteAuthProvider] = useState<GitRemoteAuthProvider>("generic");
  const [mobileSwipeRowState, setMobileSwipeRowState] = useState<{
    path: string;
    direction: MobileSwipeDirection;
  } | null>(null);
  const [desktopOperationsMenuPosition, setDesktopOperationsMenuPosition] =
    useState<GitOperationsMenuPosition | null>(null);
  const [historyActionsMenuPosition, setHistoryActionsMenuPosition] =
    useState<GitOperationsMenuPosition | null>(null);
  const [treePanelRatio, setTreePanelRatio] = useState(DEFAULT_TREE_PANEL_RATIO);
  const [panelResizeActive, setPanelResizeActive] = useState(false);
  const [viewerFilePath, setViewerFilePath] = useState<string | null>(null);
  const [viewerDiffContent, setViewerDiffContent] = useState<string | null>(null);
  const recentFileActivationRef = useRef<{ filePath: string; timestamp: number } | null>(null);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const treePanelBodyRef = useRef<HTMLDivElement | null>(null);
  const commitEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const desktopOperationsMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const desktopOperationsMenuRef = useRef<HTMLDivElement | null>(null);
  const historyActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const historyMenuTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const commitDetailCacheRef = useRef(new Map<string, GitCommitDetailDto>());
  const commitDetailRequestIdRef = useRef(0);
  const wasPanelActiveRef = useRef(panelActive);
  const panelActiveRef = useRef(panelActive);
  const snapshotWorkspaceIdRef = useRef<string | null>(null);
  const { showToast } = useToast();
  const useNativeDesktopHistoryMenu = platform.isDesktop && !isMobileViewport;
  useEffect(() => {
    logPerfDebug("git_sidebar.props", {
      workspaceId,
      externalWindowMode
    });
  }, [externalWindowMode, workspaceId]);

  useEffect(() => {
    panelActiveRef.current = panelActive;
  }, [panelActive]);

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
    setDesktopHistoryMenuCommitHash(null);
    setAllHistoryModalOpen(false);
    setCommitDetailModalCommitHash(null);
    setCommitDetailModalLoading(false);
    setCommitDetailModalError(null);
    setCommitDetailModalData(null);
    setExplainCommitHash(null);
    setExplainProviderModalOpen(false);
    setExplainProvider(null);
    setExplainingChange(false);
    setPushRemoteModalOpen(false);
    setPushRemoteModalMode("push");
    setPushRemotes([]);
    setPushSelectedRemotes(new Set());
    setPushResults(new Map());
    setRemoteSessionAuthStates({});
    setRemoteAuthModalOpen(false);
    setRemoteAuthTargetRemoteName(null);
    setRemoteAuthForm(INITIAL_REMOTE_AUTH_FORM);
    setRemoteAuthProvider("generic");
    setMobileSwipeRowState(null);
    setDesktopOperationsMenuPosition(null);
    setHistoryActionsMenuPosition(null);
    setPanelResizeActive(false);
    setTreePanelRatio(DEFAULT_TREE_PANEL_RATIO);
    setViewerFilePath(null);
    setViewerDiffContent(null);
    commitDetailCacheRef.current.clear();
    historyMenuTriggerRefs.current.clear();
  }, [currentTargetHostId, workspaceId]);

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
      snapshotWorkspaceIdRef.current = null;
      setStatus(null);
      setRevision(null);
      setHistory([]);
      setHistoryTotalCount(0);
      setHistoryNextCursor(null);
      setBranches(null);
      setLoading(false);
      return;
    }

    const currentWorkspaceId = workspaceId.trim();
    const cachedSnapshot = readViewSnapshot<GitSidebarSnapshot>(
      buildGitSidebarSnapshotKey(currentWorkspaceId, currentTargetHostId),
      GIT_SNAPSHOT_CACHE_MAX_AGE_MS
    );
    const hasCachedSnapshot = hasGitSidebarSnapshotData(cachedSnapshot);

    logPerfDebug("git_sidebar.snapshot", {
      workspaceId: currentWorkspaceId,
      cached: hasCachedSnapshot,
      cachedHistoryCount: cachedSnapshot?.history?.length ?? 0,
      cachedChangedCount: cachedSnapshot?.status?.changes.length ?? 0
    });

    if (hasCachedSnapshot && cachedSnapshot) {
      applyGitSnapshot(cachedSnapshot, currentWorkspaceId);
      setLoading(false);
      return;
    }

    snapshotWorkspaceIdRef.current = null;
    clearViewSnapshot(buildGitSidebarSnapshotKey(currentWorkspaceId, currentTargetHostId));
    setStatus(null);
    setRevision(null);
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
      if (snapshot.workspaceId !== workspaceId.trim() || !isSameTargetHostId(readSnapshotTargetHostId(snapshot), currentTargetHostId)) {
        return;
      }

      logPerfDebug("git_sidebar.snapshot_received", {
        workspaceId: snapshot.workspaceId,
        changedCount: snapshot.status?.changes.length ?? 0,
        historyCount: snapshot.history.length,
        branchCount: (snapshot.branches?.local.length ?? 0) + (snapshot.branches?.remote.length ?? 0)
      });
      applyGitSnapshot(snapshot, snapshot.workspaceId);
      setLoading(false);
    });
  }, [addGitSnapshotListener, currentTargetHostId, workspaceId]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }

    const currentWorkspaceId = workspaceId.trim();
    const cachedSnapshot = readViewSnapshot<GitSidebarSnapshot>(
      buildGitSidebarSnapshotKey(currentWorkspaceId, currentTargetHostId),
      GIT_SNAPSHOT_CACHE_MAX_AGE_MS
    );
    const knownRevision = hasGitSidebarSnapshotData(cachedSnapshot)
      ? cachedSnapshot?.revision ?? null
      : null;

    subscribeGitSnapshot(currentWorkspaceId, {
      knownRevision,
      targetHostId: currentTargetHostId
    });

    if (panelActiveRef.current) {
      requestGitSnapshotRefresh();
    }
  }, [currentTargetHostId, requestGitRefresh, subscribeGitSnapshot, workspaceId]);

  useEffect(() => {
    const wasPanelActive = wasPanelActiveRef.current;
    wasPanelActiveRef.current = panelActive;

    if (!workspaceId?.trim()) {
      return;
    }

    // 移动端 Git 面板可能常驻但处于隐藏状态；每次重新切回可见时主动刷新一次。
    if (!wasPanelActive && panelActive) {
      requestGitRefresh(workspaceId.trim(), {
        knownRevision: revision,
        targetHostId: currentTargetHostId
      });
    }
  }, [currentTargetHostId, panelActive, requestGitRefresh, revision, workspaceId]);

  useEffect(() => {
    const currentWorkspaceId = workspaceId?.trim();

    if (!currentWorkspaceId) {
      return;
    }

    if (snapshotWorkspaceIdRef.current !== currentWorkspaceId) {
      return;
    }

    const snapshotToCache: GitSidebarSnapshot = {
      revision,
      status,
      history,
      historyTotalCount,
      historyNextCursor,
      branches
    };

    if (!hasGitSidebarSnapshotData(snapshotToCache)) {
      clearViewSnapshot(buildGitSidebarSnapshotKey(currentWorkspaceId, currentTargetHostId));
      return;
    }

    writeViewSnapshot<GitSidebarSnapshot>(buildGitSidebarSnapshotKey(currentWorkspaceId, currentTargetHostId), snapshotToCache);
  }, [branches, currentTargetHostId, history, historyNextCursor, historyTotalCount, revision, status, workspaceId]);

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

  function applyGitSnapshot(snapshot: GitSidebarSnapshot, snapshotWorkspaceId?: string | null) {
    snapshotWorkspaceIdRef.current = snapshotWorkspaceId?.trim() ?? workspaceId?.trim() ?? null;
    setRevision(typeof snapshot.revision === "string" ? snapshot.revision : null);
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
    requestGitRefresh(workspaceId.trim(), {
      knownRevision: revision,
      targetHostId: currentTargetHostId
    });

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
        getGitStatus(currentWorkspaceId, { targetHostId: currentTargetHostId }),
        getGitHistory(currentWorkspaceId, GIT_HISTORY_PAGE_SIZE, null, { targetHostId: currentTargetHostId }),
        getGitBranches(currentWorkspaceId, { targetHostId: currentTargetHostId })
      ]);

      applyGitSnapshot({
        status: nextStatus,
        history: nextHistoryPage.items,
        historyTotalCount: nextHistoryPage.totalCount,
        historyNextCursor: nextHistoryPage.nextCursor,
        branches: nextBranches
      });
      requestGitRefresh(currentWorkspaceId, { targetHostId: currentTargetHostId });

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
      const nextHistory = await getGitHistory(workspaceId, GIT_HISTORY_PAGE_SIZE, historyNextCursor, {
        targetHostId: currentTargetHostId
      });

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
      const response = await createCommitDraft(workspaceId, "ai", { targetHostId: currentTargetHostId });
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
        ? await unstageGitTargets(workspaceId, targets, { targetHostId: currentTargetHostId })
        : await stageGitTargets(workspaceId, targets, { targetHostId: currentTargetHostId });

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
      const nextStatus = await discardGitTargets(workspaceId, targets, { targetHostId: currentTargetHostId });
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

  async function handleAddToGitIgnore(targets: string[]) {
    if (!workspaceId || targets.length === 0) {
      return;
    }

    setActioning(true);

    try {
      const nextStatus = await addGitIgnoreTargets(workspaceId, targets, { targetHostId: currentTargetHostId });
      setStatus(nextStatus);
      requestGitSnapshotRefresh();
      showToast({
        title: targets.length === 1 ? t("git.addToIgnoreSuccess") : t("git.addSelectionToIgnoreSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: readError(error, t("git.addToIgnoreFailed")),
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
      await commitDraft(workspaceId, buildCommitDraft(commitSubject), { targetHostId: currentTargetHostId });
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

  async function handleInitializeRepository() {
    if (!workspaceId?.trim()) {
      return;
    }

    setActioning(true);
    setLoading(true);

    try {
      const nextStatus = await initializeGitRepository(workspaceId.trim(), { targetHostId: currentTargetHostId });
      setStatus(nextStatus);
      setHistory([]);
      setHistoryTotalCount(0);
      setHistoryNextCursor(null);
      setBranches(null);
      showToast({
        title: t("git.initSuccess"),
        tone: "success"
      });
      requestGitSnapshotRefresh();
    } catch (error) {
      showToast({
        title: readError(error, t("git.initFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
      setLoading(false);
    }
  }

  async function ensurePushRemotesLoaded() {
    const currentWorkspaceId = workspaceId?.trim();

    if (!currentWorkspaceId) {
      return [] as GitRemoteItemDto[];
    }

    const remotes = await getGitRemotes(currentWorkspaceId, { targetHostId: currentTargetHostId });

    if (workspaceId?.trim() !== currentWorkspaceId) {
      return [] as GitRemoteItemDto[];
    }

    setPushRemotes(remotes);
    return remotes;
  }

  async function openRemoteAuthModal(preferredRemoteName?: string) {
    const remotes = await ensurePushRemotesLoaded();
    const targetRemote = resolvePreferredRemote(remotes, preferredRemoteName);

    if (!targetRemote) {
      showToast({ title: t("git.noRemotes"), tone: "error" });
      return;
    }

    const existingState = remoteSessionAuthStates[targetRemote.name] ?? null;

    setRemoteAuthTargetRemoteName(targetRemote.name);
    setRemoteAuthProvider(resolveRemoteAuthProvider(remotes, targetRemote.name));
    setRemoteAuthForm(
      toRemoteAuthFormState(existingState?.auth ?? null, existingState?.rememberOnHost ?? false)
    );
    setRemoteAuthModalOpen(true);
  }

  async function openRemoteAuthManager() {
    if (!workspaceId?.trim()) {
      return;
    }

    setPushRemotesLoading(true);

    try {
      const remotes = await ensurePushRemotesLoaded();

      if (remotes.length === 0) {
        showToast({ title: t("git.noRemotes"), tone: "error" });
        return;
      }

      if (remotes.length === 1) {
        await openRemoteAuthModal(remotes[0].name);
        return;
      }

      setPushRemoteModalMode("auth");
      setPushSelectedRemotes(new Set());
      setPushResults(new Map());
      setPushRemoteModalOpen(true);
    } catch (error) {
      showToast({ title: readError(error, t("git.remoteFailed")), tone: "error" });
    } finally {
      setPushRemotesLoading(false);
    }
  }

  function handleSaveRemoteAuth() {
    const targetRemoteName = remoteAuthTargetRemoteName?.trim();

    if (!targetRemoteName) {
      setRemoteAuthModalOpen(false);
      return;
    }

    const nextAuth = toRemoteAuthPayload(remoteAuthForm);
    const basicSecretPlaceholder = remoteAuthProvider === "github"
      ? t("git.remoteAuthGithubPatPlaceholder")
      : t("shell.clonePasswordPlaceholder");

    if (remoteAuthForm.authMode === "basic") {
      if (!remoteAuthForm.username.trim()) {
        showToast({ title: t("shell.cloneUsernamePlaceholder"), tone: "error" });
        return;
      }

      if (!remoteAuthForm.password) {
        showToast({ title: basicSecretPlaceholder, tone: "error" });
        return;
      }
    }

    if (remoteAuthForm.authMode === "token" && !remoteAuthForm.token) {
      showToast({ title: t("shell.cloneTokenPlaceholder"), tone: "error" });
      return;
    }

    setRemoteSessionAuthStates((current) => {
      if (!nextAuth) {
        const { [targetRemoteName]: _ignored, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [targetRemoteName]: {
          auth: nextAuth,
          rememberOnHost: remoteAuthForm.rememberOnHost
        }
      };
    });
    setRemoteAuthModalOpen(false);
    showToast({
      title: nextAuth ? t("git.remoteAuthSaved") : t("git.remoteAuthCleared"),
      description:
        nextAuth && remoteAuthForm.rememberOnHost
          ? t("git.remoteAuthRememberHint")
          : undefined,
      tone: "success"
    });
  }

  async function handlePush() {
    if (!workspaceId) {
      return;
    }

    setPushRemotesLoading(true);
    try {
      const remotes = await ensurePushRemotesLoaded();
      if (remotes.length === 0) {
        showToast({ title: t("git.noRemotes"), tone: "error" });
        return;
      }
      if (remotes.length === 1) {
        void handlePushToRemotes([remotes[0].name]);
        return;
      }
      setPushRemoteModalMode("push");
      setPushSelectedRemotes(new Set());
      setPushResults(new Map());
      setPushRemoteModalOpen(true);
    } catch (error) {
      showToast({ title: readError(error, t("git.remoteFailed")), tone: "error" });
    } finally {
      setPushRemotesLoading(false);
    }
  }

  async function handlePushToRemotes(remoteNames: string[]) {
    if (!workspaceId || remoteNames.length === 0) {
      return;
    }

    setActioning(true);
    setPushResults(new Map());

    const results = new Map<string, { ok: boolean; summary: string }>();
    let hasError = false;

    try {
      // 这里故意不用并发。远程仓库通常就 1 到 2 个，顺序执行才能在认证失败时立刻停下。
      for (const remoteName of remoteNames) {
        const remoteAuthState = remoteSessionAuthStates[remoteName] ?? null;

        try {
          const result = await syncGitRemote(
            workspaceId,
            "push",
            remoteName,
            remoteAuthState?.auth,
            remoteAuthState?.rememberOnHost ?? false,
            { targetHostId: currentTargetHostId }
          );
          results.set(remoteName, { ok: true, summary: result.summary });
          if (remoteAuthState?.rememberOnHost && remoteAuthState.auth) {
            setPushRemotes((current) =>
              current.map((item) =>
                item.name === remoteName ? { ...item, credentialConfigured: true } : item
              )
            );
          }
        } catch (error) {
          hasError = true;
          results.set(remoteName, {
            ok: false,
            summary: readError(error, t("git.remoteFailed"))
          });
          setPushResults(new Map(results));

          if (isRemoteAuthError(error)) {
            openRemoteAuthModal(remoteName);
            return;
          }
        }
      }

      setPushResults(results);
      requestGitSnapshotRefresh();

      if (!hasError) {
        showToast({
          title: t("git.pushAllSuccess", { count: String(remoteNames.length) }),
          tone: "success"
        });
        setPushRemoteModalOpen(false);
      }
    } finally {
      setActioning(false);
    }
  }

  async function handleRemoteAction(action: "fetch" | "pull" | "push") {
    if (!workspaceId) {
      return;
    }

    // Push 操作走仓库选择流程
    if (action === "push") {
      setMenuOpen(false);
      void handlePush();
      return;
    }

    setActioning(true);

    try {
      const preferredRemoteName = resolvePreferredRemoteName(pushRemotes);
      const remoteAuthState = preferredRemoteName
        ? remoteSessionAuthStates[preferredRemoteName] ?? null
        : null;
      const result = await syncGitRemote(
        workspaceId,
        action,
        undefined,
        remoteAuthState?.auth,
        remoteAuthState?.rememberOnHost ?? false,
        { targetHostId: currentTargetHostId }
      );
      showToast({
        title: result.summary,
        tone: "success"
      });
      if (preferredRemoteName && remoteAuthState?.rememberOnHost && remoteAuthState.auth) {
        setPushRemotes((current) =>
          current.map((item) =>
            item.name === preferredRemoteName ? { ...item, credentialConfigured: true } : item
          )
        );
      }
      setMenuOpen(false);
      requestGitSnapshotRefresh();
    } catch (error) {
      if (isRemoteAuthError(error)) {
        void openRemoteAuthModal(resolvePreferredRemoteName(pushRemotes));
        return;
      }

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
      const result = await undoLastCommit(workspaceId, { targetHostId: currentTargetHostId });
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
      const nextBranches = await switchGitBranch(workspaceId, branchName, false, {
        targetHostId: currentTargetHostId
      });
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

  async function ensureCommitDetail(commitHash: string): Promise<GitCommitDetailDto> {
    const normalizedWorkspaceId = workspaceId?.trim();

    if (!normalizedWorkspaceId) {
      throw new Error(t("git.panelLoadFailed"));
    }

    const cachedDetail = commitDetailCacheRef.current.get(commitHash);

    if (cachedDetail) {
      return cachedDetail;
    }

    const detail = await getGitCommitDetail(normalizedWorkspaceId, commitHash, {
      targetHostId: currentTargetHostId
    });
    commitDetailCacheRef.current.set(commitHash, detail);
    return detail;
  }

  async function openCommitDetailModal(commitHash: string) {
    setDesktopHistoryMenuCommitHash(null);
    setMobileHistoryMenuCommitHash(null);
    setCommitDetailModalCommitHash(commitHash);
    setCommitDetailModalError(null);

    const cachedDetail = commitDetailCacheRef.current.get(commitHash) ?? null;
    setCommitDetailModalData(cachedDetail);
    setCommitDetailModalLoading(!cachedDetail);

    if (cachedDetail) {
      return;
    }

    const requestId = commitDetailRequestIdRef.current + 1;
    commitDetailRequestIdRef.current = requestId;

    try {
      const detail = await ensureCommitDetail(commitHash);

      if (commitDetailRequestIdRef.current !== requestId) {
        return;
      }

      setCommitDetailModalData(detail);
    } catch (error) {
      if (commitDetailRequestIdRef.current !== requestId) {
        return;
      }

      setCommitDetailModalError(readError(error, t("git.commitDetailLoadFailed")));
      setCommitDetailModalData(null);
    } finally {
      if (commitDetailRequestIdRef.current === requestId) {
        setCommitDetailModalLoading(false);
      }
    }
  }

  function closeCommitDetailModal() {
    setCommitDetailModalCommitHash(null);
    setCommitDetailModalLoading(false);
    setCommitDetailModalError(null);
    setCommitDetailModalData(null);
  }

  async function handleCopyCommitVersion(commitHash: string) {
    try {
      const detail = await ensureCommitDetail(commitHash);
      await copyText(detail.versionLabel, t("git.copyCommitVersionSuccess"));
    } catch (error) {
      showToast({
        title: readError(error, t("git.commitDetailLoadFailed")),
        tone: "error"
      });
    }
  }

  function openExplainProviderModal(commitHash: string) {
    setDesktopHistoryMenuCommitHash(null);
    setMobileHistoryMenuCommitHash(null);
    setExplainCommitHash(commitHash);
    setExplainProvider(null);
    setExplainProviderModalOpen(true);
  }

  function buildHistoryContextMenuItems(item: GitHistoryItemDto): DesktopContextMenuItem[] {
    const canUndo = history[0]?.commitHash === item.commitHash && item.commitKind === "local";

    return [
      {
        id: `view-changes:${item.commitHash}`,
        label: t("git.viewCommitChanges"),
        onSelect: () => void openCommitDetailModal(item.commitHash)
      },
      {
        id: `copy-hash:${item.commitHash}`,
        label: t("git.copyCommitHash"),
        onSelect: () => void copyText(item.commitHash, t("git.copyCommitHashSuccess"))
      },
      {
        id: `copy-message:${item.commitHash}`,
        label: t("git.copyCommitMessage"),
        onSelect: () => void copyText(buildCommitMessageText(item), t("git.copyCommitMessageSuccess"))
      },
      {
        id: `copy-version:${item.commitHash}`,
        label: t("git.copyCommitVersion"),
        onSelect: () => void handleCopyCommitVersion(item.commitHash)
      },
      {
        id: `explain:${item.commitHash}`,
        label: t("git.explainCommitAction"),
        onSelect: () => openExplainProviderModal(item.commitHash)
      },
      ...(canUndo
        ? [
            {
              id: `undo:${item.commitHash}`,
              label: t("git.undoLastCommit"),
              disabled: actioning,
              onSelect: () => void handleUndoLastCommit()
            } satisfies DesktopContextMenuItem
          ]
        : [])
    ];
  }

  async function openDesktopHistoryContextMenu(item: GitHistoryItemDto) {
    setDesktopHistoryMenuCommitHash(null);
    setMobileHistoryMenuCommitHash(null);
    await showDesktopContextMenu(buildHistoryContextMenuItems(item));
  }

  function buildTreeContextMenuItems(input: {
    path: string;
    targets: string[];
    variant: "staged" | "unstaged";
    isDirectory: boolean;
  }): DesktopContextMenuItem[] {
    const { path: itemPath, targets, variant, isDirectory } = input;
    const canDiscard = variant === "unstaged";

    return [
      {
        id: `git-ignore:${itemPath}`,
        label: t("git.addToIgnore"),
        disabled: actioning || targets.length === 0,
        onSelect: () => void handleAddToGitIgnore(targets)
      },
      {
        id: `stage-toggle:${itemPath}`,
        label: variant === "staged" ? t("git.unstage") : t("git.stage"),
        disabled: actioning || targets.length === 0,
        onSelect: () => void handleStageToggle(targets, variant === "staged")
      },
      ...(canDiscard
        ? [
            {
              id: `discard:${itemPath}`,
              label: t("git.discard"),
              disabled: actioning || targets.length === 0,
              onSelect: () => void handleDiscard(targets)
            } satisfies DesktopContextMenuItem
          ]
        : []),
      ...(!isDirectory && targets.length === 1
        ? [
            {
              id: `preview:${itemPath}`,
              label: t("git.preview"),
              onSelect: () => {
                const change = status?.changes.find((item) => item.path === targets[0]);

                if (!change) {
                  return;
                }

                setSelectedPath(targets[0] ?? null);
                void handleOpenFile(targets[0], change);
              }
            } satisfies DesktopContextMenuItem
          ]
        : [])
    ];
  }

  async function openDesktopTreeContextMenu(input: {
    path: string;
    targets: string[];
    variant: "staged" | "unstaged";
    isDirectory: boolean;
  }) {
    await showDesktopContextMenu(buildTreeContextMenuItems(input));
  }

  async function handleExplainCommit() {
    if (!workspaceId || !explainCommitHash || !explainProvider || explainingChange) {
      return;
    }

    setExplainingChange(true);

    try {
      const detail = await ensureCommitDetail(explainCommitHash);
      const response = await startLiveSession({
        workspaceId,
        provider: explainProvider,
        content: buildCommitExplainPrompt(detail),
        clientRequestId:
          globalThis.crypto?.randomUUID?.()
          ?? `git-explain-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        permissionMode: getDefaultSessionPermissionMode()
      }, {
        targetHostId: currentTargetHostId
      });
      const nextSession = response.session ?? await getSessionDetail(response.sessionId, {
        targetHostId: currentTargetHostId
      });

      upsertNavigationSession(nextSession);
      requestNavigationRefresh();
      const nextWorkspaceRef =
        currentTargetHostId && currentWorkspaceRef
          ? {
            hostId: currentTargetHostId,
            workspaceId: currentWorkspaceRef.workspaceId
          }
          : currentWorkspaceRef;
      selectWorkspace(nextSession.workspaceId, nextWorkspaceRef);
      navigate(buildWorkspaceSessionPath(nextSession.workspaceId, nextSession.sessionId, nextWorkspaceRef));
      setExplainProviderModalOpen(false);
      setExplainCommitHash(null);
      setExplainProvider(null);
      showToast({
        title: t("git.explainCommitStarted"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: readError(error, t("git.explainCommitFailed")),
        tone: "error"
      });
    } finally {
      setExplainingChange(false);
    }
  }

  function toggleTreePath(path: string) {
    setCollapsedTreePaths((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
    );
  }

  const FILE_REPEAT_ACTIVATION_MS = 450;

  function shouldOpenViewerByRepeatClick(filePath: string): boolean {
    const now = Date.now();
    const recent = recentFileActivationRef.current;
    recentFileActivationRef.current = { filePath, timestamp: now };
    return recent?.filePath === filePath && now - recent.timestamp <= FILE_REPEAT_ACTIVATION_MS;
  }

  async function handleFilePreview(filePath: string, change: GitChangeItemDto) {
    if (change.binary) {
      showToast({ title: t("git.binaryDiff"), tone: "info" });
      return;
    }

    // 新增文件（A/?）直接预览内容，其他获取 diff
    if (change.status === "A" || change.status === "?") {
      setViewerDiffContent(null);
      setViewerFilePath(filePath);
    } else if (workspaceId) {
      try {
        const diffResult = await getGitDiff(workspaceId, filePath, change.staged, {
          targetHostId: currentTargetHostId
        });
        setViewerDiffContent(diffResult.content);
        setViewerFilePath(filePath);
      } catch {
        // diff 获取失败时仍然打开文件预览
        setViewerDiffContent(null);
        setViewerFilePath(filePath);
      }
    }
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
  const remoteAuthTargetRemote = resolvePreferredRemote(pushRemotes, remoteAuthTargetRemoteName);
  const githubRemoteDetected = remoteAuthProvider === "github";
  const remoteAuthDescription = githubRemoteDetected
    ? t("git.remoteAuthDescriptionGithub")
    : t("git.remoteAuthDescription");
  const basicSecretLabel = githubRemoteDetected
    ? t("git.remoteAuthGithubPatLabel")
    : t("shell.clonePasswordLabel");
  const basicSecretPlaceholder = githubRemoteDetected
    ? t("git.remoteAuthGithubPatPlaceholder")
    : t("shell.clonePasswordPlaceholder");
  const basicUsernamePlaceholder = githubRemoteDetected
    ? t("git.remoteAuthGithubUsernamePlaceholder")
    : t("shell.cloneUsernamePlaceholder");
  const safeTreePanelRatio = Number.isFinite(treePanelRatio)
    ? treePanelRatio
    : DEFAULT_TREE_PANEL_RATIO;
  const splitRows = historyExpanded
    ? `minmax(120px, ${safeTreePanelRatio}fr) ${PANEL_RESIZER_HEIGHT}px minmax(140px, ${100 - safeTreePanelRatio}fr)`
    : `minmax(120px, 1fr) ${PANEL_RESIZER_HEIGHT}px auto`;
  const gitRepositoryEnabled = isGitRepositoryEnabled(status);

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
    if (!desktopHistoryMenuCommitHash) {
      return;
    }

    if (!history.some((item) => item.commitHash === desktopHistoryMenuCommitHash)) {
      setDesktopHistoryMenuCommitHash(null);
    }
  }, [desktopHistoryMenuCommitHash, history]);

  useEffect(() => {
    if (!isMobileViewport) {
      return;
    }

    if (mobileExpandedSection !== "history" && menuOpen) {
      setMenuOpen(false);
    }
  }, [isMobileViewport, menuOpen, mobileExpandedSection]);

  useLayoutEffect(() => {
    if (isMobileViewport || !menuOpen) {
      setDesktopOperationsMenuPosition(null);
      return;
    }

    function updateDesktopOperationsMenuPosition() {
      const trigger = desktopOperationsMenuTriggerRef.current;
      const menu = desktopOperationsMenuRef.current;

      if (!trigger || !menu || typeof window === "undefined") {
        return;
      }

      setDesktopOperationsMenuPosition(
        resolveGitOperationsMenuPosition(trigger.getBoundingClientRect(), {
          width: menu.getBoundingClientRect().width || GIT_OPERATIONS_MENU_DEFAULT_WIDTH_PX,
          height: menu.getBoundingClientRect().height || menu.scrollHeight || 0
        }, {
          width: window.innerWidth,
          height: window.innerHeight
        })
      );
    }

    updateDesktopOperationsMenuPosition();
    const animationFrameId = window.requestAnimationFrame(updateDesktopOperationsMenuPosition);

    window.addEventListener("resize", updateDesktopOperationsMenuPosition);
    window.addEventListener("scroll", updateDesktopOperationsMenuPosition, true);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", updateDesktopOperationsMenuPosition);
      window.removeEventListener("scroll", updateDesktopOperationsMenuPosition, true);
    };
  }, [actioning, branches?.local.length, currentBranch, isMobileViewport, menuOpen]);

  const activeHistoryMenuCommitHash = mobileHistoryMenuCommitHash ?? desktopHistoryMenuCommitHash;

  useLayoutEffect(() => {
    if (!activeHistoryMenuCommitHash) {
      setHistoryActionsMenuPosition(null);
      return;
    }

    const commitHash = activeHistoryMenuCommitHash;

    function updateHistoryActionsMenuPosition() {
      const trigger = historyMenuTriggerRefs.current.get(commitHash) ?? null;
      const menu = historyActionsMenuRef.current;

      if (!trigger || !menu || typeof window === "undefined") {
        return;
      }

      setHistoryActionsMenuPosition(
        resolveGitOperationsMenuPosition(
          trigger.getBoundingClientRect(),
          {
            width: menu.getBoundingClientRect().width || GIT_OPERATIONS_MENU_DEFAULT_WIDTH_PX,
            height: menu.getBoundingClientRect().height || menu.scrollHeight || 0
          },
          {
            width: window.innerWidth,
            height: window.innerHeight
          }
        )
      );
    }

    updateHistoryActionsMenuPosition();
    const animationFrameId = window.requestAnimationFrame(updateHistoryActionsMenuPosition);

    window.addEventListener("resize", updateHistoryActionsMenuPosition);
    window.addEventListener("scroll", updateHistoryActionsMenuPosition, true);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", updateHistoryActionsMenuPosition);
      window.removeEventListener("scroll", updateHistoryActionsMenuPosition, true);
    };
  }, [activeHistoryMenuCommitHash, history.length]);

  useEffect(() => {
    if (!activeHistoryMenuCommitHash || typeof document === "undefined") {
      return;
    }

    const commitHash = activeHistoryMenuCommitHash;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      const trigger = historyMenuTriggerRefs.current.get(commitHash) ?? null;
      const menu = historyActionsMenuRef.current;

      if (trigger?.contains(target) || menu?.contains(target)) {
        return;
      }

      setMobileHistoryMenuCommitHash(null);
      setDesktopHistoryMenuCommitHash(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [activeHistoryMenuCommitHash]);

  async function copyText(value: string, successMessage: string) {
    try {
      if (platform.isDesktop) {
        const desktopResult = await platform.bridge.writeClipboardText(value);

        if (desktopResult.ok) {
          showToast({
            title: successMessage,
            tone: "success"
          });
          return;
        }
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        showToast({
          title: successMessage,
          tone: "success"
        });
        return;
      }

      if (copyTextWithExecCommand(value)) {
        showToast({
          title: successMessage,
          tone: "success"
        });
        return;
      }
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

  function renderGitOperationsMenu(options?: { desktopFloating?: boolean }) {
    const desktopFloating = options?.desktopFloating === true && !isMobileViewport;
    const menuStyle: CSSProperties | undefined = desktopFloating
      ? {
          top: desktopOperationsMenuPosition?.top ?? GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX,
          left: desktopOperationsMenuPosition?.left ?? GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX,
          maxHeight: desktopOperationsMenuPosition?.maxHeight,
          transformOrigin: desktopOperationsMenuPosition?.transformOrigin ?? "top right"
        }
      : undefined;

    const menu = (
      <div
        ref={desktopFloating ? desktopOperationsMenuRef : undefined}
        className="git-operations-menu"
        data-floating={desktopFloating ? "true" : "false"}
        style={menuStyle}
      >
        <div className="git-menu-section">
          <span className="git-menu-caption">{t("git.currentBranch")}</span>
          <strong className="git-menu-branch">{currentBranch}</strong>
        </div>

        <div className="git-menu-section">
          <span className="git-menu-caption">{t("git.remoteAuthStatusLabel")}</span>
          <div className="git-menu-branch-list">
            <strong className="git-menu-branch">{t("git.remoteAuthManageHint")}</strong>
            <button
              className="git-menu-item"
              type="button"
              disabled={actioning || pushRemotesLoading}
              onClick={() => void openRemoteAuthManager()}
            >
              <span>{t("git.remoteAuthAction")}</span>
            </button>
          </div>
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
          <button
            className="git-menu-item"
            type="button"
            disabled={actioning}
            onClick={() => {
              setMenuOpen(false);
              setAllHistoryModalOpen(true);
            }}
          >
            <span>{t("git.viewAllVersions")}</span>
          </button>
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

    if (!desktopFloating) {
      return menu;
    }

    if (typeof document === "undefined") {
      return null;
    }

    return createPortal(menu, document.body);
  }

  function setHistoryMenuTriggerRef(commitHash: string, node: HTMLButtonElement | null) {
    if (node) {
      historyMenuTriggerRefs.current.set(commitHash, node);
      return;
    }

    historyMenuTriggerRefs.current.delete(commitHash);
  }

  function renderHistoryActionsMenu() {
    if (!activeHistoryMenuCommitHash || typeof document === "undefined") {
      return null;
    }

    const item = history.find((entry) => entry.commitHash === activeHistoryMenuCommitHash);

    if (!item) {
      return null;
    }

    const canUndo = history[0]?.commitHash === item.commitHash && item.commitKind === "local";

    return createPortal(
      <div
        ref={historyActionsMenuRef}
        className="git-history-entry-menu"
        data-floating="true"
        style={{
          top: historyActionsMenuPosition?.top ?? GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX,
          left: historyActionsMenuPosition?.left ?? GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX,
          maxHeight: historyActionsMenuPosition?.maxHeight,
          transformOrigin: historyActionsMenuPosition?.transformOrigin ?? "top right"
        }}
      >
        <GitHistoryActionsMenu
          item={item}
          canUndo={canUndo}
          actioning={actioning}
          onViewCommitChanges={(commitHash) => void openCommitDetailModal(commitHash)}
          onCopyCommitHash={(commitHash) =>
            void copyText(commitHash, t("git.copyCommitHashSuccess"))
          }
          onCopyCommitMessage={(entry) =>
            void copyText(buildCommitMessageText(entry), t("git.copyCommitMessageSuccess"))
          }
          onCopyCommitVersion={(commitHash) => void handleCopyCommitVersion(commitHash)}
          onExplainCommitChange={(commitHash) => void openExplainProviderModal(commitHash)}
          onUndoLastCommit={() => void handleUndoLastCommit()}
        />
      </div>,
      document.body
    );
  }

  if (status && !gitRepositoryEnabled) {
    return (
      <section
        className={["conversation-panel", "surface-card", "git-sidebar", className].filter(Boolean).join(" ")}
        data-testid="git-sidebar"
      >
        <section className="git-card git-scaffold-section git-disabled-state">
          <div className="git-disabled-copy">
            <h3>{t("git.uninitializedTitle")}</h3>
            <p>{t("git.uninitializedDescription")}</p>
          </div>
          <div className="git-primary-actions">
            <button
              className="primary-button git-primary-submit"
              type="button"
              onClick={() => void handleInitializeRepository()}
              disabled={actioning || loading || !workspaceId}
            >
              {actioning ? t("git.initInProgress") : t("git.initRepository")}
            </button>
          </div>
        </section>
      </section>
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
              onPreviewFile={handleFilePreview}
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
              onPreviewFile={handleFilePreview}
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
              onMenuTriggerRef={setHistoryMenuTriggerRef}
              onToggleMenu={(commitHash) =>
                setMobileHistoryMenuCommitHash((current) =>
                  current === commitHash ? null : commitHash
                )
              }
              onViewCommitChanges={(commitHash) => void openCommitDetailModal(commitHash)}
              onCopyCommitHash={(commitHash) =>
                void copyText(commitHash, t("git.copyCommitHashSuccess"))
              }
              onCopyCommitMessage={(item) =>
                void copyText(buildCommitMessageText(item), t("git.copyCommitMessageSuccess"))
              }
              onCopyCommitVersion={(commitHash) => void handleCopyCommitVersion(commitHash)}
              onExplainCommitChange={(commitHash) => void openExplainProviderModal(commitHash)}
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
                  onPreviewFile={(filePath, change) => {
                    if (shouldOpenViewerByRepeatClick(filePath)) {
                      void handleFilePreview(filePath, change);
                    }
                  }}
                  onToggleMobileSelection={toggleMobileSelection}
                  onStageToggle={handleStageToggle}
                  onDiscard={handleDiscard}
                  onOpenDesktopContextMenu={openDesktopTreeContextMenu}
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
                onPreviewFile={(filePath, change) => {
                  if (shouldOpenViewerByRepeatClick(filePath)) {
                    void handleFilePreview(filePath, change);
                  }
                }}
                onToggleMobileSelection={toggleMobileSelection}
                onStageToggle={handleStageToggle}
                onDiscard={handleDiscard}
                onOpenDesktopContextMenu={openDesktopTreeContextMenu}
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
                  ref={desktopOperationsMenuTriggerRef}
                  aria-label={t("git.operationMenu")}
                  title={t("git.operationMenu")}
                  onClick={() => setMenuOpen((current) => !current)}
                  disabled={actioning}
                >
                  <MoreIcon />
                </button>

                {menuOpen ? renderGitOperationsMenu({ desktopFloating: true }) : null}
              </div>
            </div>

            {historyExpanded ? (
              <GitDesktopHistoryList
                history={history}
                historyLoadingMore={historyLoadingMore}
                hasMore={Boolean(historyNextCursor)}
                actioning={actioning}
                openCommitHash={desktopHistoryMenuCommitHash}
                useNativeContextMenu={useNativeDesktopHistoryMenu}
                onMenuTriggerRef={setHistoryMenuTriggerRef}
                onScroll={handleHistoryScroll}
                onToggleMenu={(commitHash) => {
                  if (useNativeDesktopHistoryMenu) {
                    const targetItem = history.find((item) => item.commitHash === commitHash);

                    if (targetItem) {
                      void openDesktopHistoryContextMenu(targetItem);
                    }

                    return;
                  }

                  setDesktopHistoryMenuCommitHash((current) =>
                    current === commitHash ? null : commitHash
                  );
                }}
                onOpenContextMenu={(item) => void openDesktopHistoryContextMenu(item)}
                onViewCommitChanges={(commitHash) => void openCommitDetailModal(commitHash)}
                onCopyCommitHash={(commitHash) =>
                  void copyText(commitHash, t("git.copyCommitHashSuccess"))
                }
                onCopyCommitMessage={(item) =>
                  void copyText(buildCommitMessageText(item), t("git.copyCommitMessageSuccess"))
                }
                onCopyCommitVersion={(commitHash) => void handleCopyCommitVersion(commitHash)}
                onExplainCommitChange={(commitHash) => void openExplainProviderModal(commitHash)}
                onUndoLastCommit={() => void handleUndoLastCommit()}
                onLoadMore={() => void loadMoreHistory()}
              />
            ) : null}
          </section>
        </div>
      )}

      <WorkbenchModal
        open={pushRemoteModalOpen}
        title={pushRemoteModalMode === "push" ? t("git.selectRemoteTitle") : t("git.remoteAuthManageTitle")}
        description={
          pushRemoteModalMode === "push"
            ? t("git.selectRemoteDesc")
            : t("git.remoteAuthManageDescription")
        }
        onClose={() => { if (!actioning) setPushRemoteModalOpen(false); }}
      >
        <div className="git-remote-select-list">
          {pushRemotes.map((remote) => {
            const checked = pushSelectedRemotes.has(remote.name);
            const result = pushResults.get(remote.name);
            const credentialStatus = resolveRemoteCredentialState(
              remote,
              remoteSessionAuthStates[remote.name] ?? null
            );

            return (
              <div key={remote.name} className="git-remote-item">
                {pushRemoteModalMode === "push" ? (
                  <label className="git-remote-item-selector">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={actioning}
                      onChange={() => {
                        setPushSelectedRemotes((prev) => {
                          const next = new Set(prev);
                          if (next.has(remote.name)) {
                            next.delete(remote.name);
                          } else {
                            next.add(remote.name);
                          }
                          return next;
                        });
                      }}
                    />
                    <span className="git-remote-item-body">
                      <span className="git-remote-name">{remote.name}</span>
                      <span className="git-remote-url">{remote.pushUrl}</span>
                      {result && (
                        <span className={`git-remote-result ${result.ok ? "ok" : "err"}`}>
                          {result.summary}
                        </span>
                      )}
                    </span>
                  </label>
                ) : (
                  <div className="git-remote-item-selector git-remote-item-selector-static">
                    <span className="git-remote-item-body">
                      <span className="git-remote-name">{remote.name}</span>
                      <span className="git-remote-url">{remote.pushUrl}</span>
                      {result && (
                        <span className={`git-remote-result ${result.ok ? "ok" : "err"}`}>
                          {result.summary}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                <div className="git-remote-item-meta">
                  <span className={`git-remote-credential-badge ${credentialStatus.kind}`}>
                    {credentialStatus.label}
                  </span>
                  <button
                    className="secondary-button git-remote-inline-action"
                    type="button"
                    disabled={actioning}
                    onClick={() => void openRemoteAuthModal(remote.name)}
                  >
                    {t("git.remoteAuthAction")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="git-remote-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={actioning}
            onClick={() => setPushRemoteModalOpen(false)}
          >
            {t("common.close")}
          </button>
          {pushRemoteModalMode === "push" ? (
            <button
              className="primary-button"
              type="button"
              disabled={actioning || pushSelectedRemotes.size === 0}
              onClick={() => void handlePushToRemotes(Array.from(pushSelectedRemotes))}
            >
              {actioning
                ? t("git.pushing")
                : t("git.pushSelected", { count: String(pushSelectedRemotes.size) })}
            </button>
          ) : null}
        </div>
      </WorkbenchModal>

      <WorkbenchModal
        open={remoteAuthModalOpen}
        title={t("git.remoteAuthTitle")}
        description={remoteAuthDescription}
        onClose={() => {
          if (!actioning) {
            setRemoteAuthModalOpen(false);
          }
        }}
      >
        {remoteAuthTargetRemote ? (
          <div className="git-remote-auth-target">
            <strong>{remoteAuthTargetRemote.name}</strong>
            <span>{remoteAuthTargetRemote.pushUrl || remoteAuthTargetRemote.fetchUrl}</span>
          </div>
        ) : null}
        <div className="workbench-clone-form">
          <label className="workbench-modal-field">
            <span>{t("shell.cloneAuthModeLabel")}</span>
            <select
              value={remoteAuthForm.authMode}
              disabled={actioning}
              onChange={(event) =>
                setRemoteAuthForm((current) => ({
                  ...current,
                  authMode: event.target.value as RemoteAuthFormState["authMode"]
                }))
              }
            >
              <option value="none">{t("shell.cloneAuthModeNone")}</option>
              <option value="basic">{t("shell.cloneAuthModeBasic")}</option>
              <option value="token">{t("shell.cloneAuthModeToken")}</option>
            </select>
          </label>

          {remoteAuthForm.authMode === "basic" ? (
            <>
              <label className="workbench-modal-field">
                <span>{t("shell.cloneUsernameLabel")}</span>
                <input
                  type="text"
                  value={remoteAuthForm.username}
                  placeholder={basicUsernamePlaceholder}
                  autoComplete="username"
                  onChange={(event) =>
                    setRemoteAuthForm((current) => ({
                      ...current,
                      username: event.target.value
                    }))
                  }
                />
              </label>
              <label className="workbench-modal-field">
                <span>{basicSecretLabel}</span>
                <input
                  type="password"
                  value={remoteAuthForm.password}
                  placeholder={basicSecretPlaceholder}
                  autoComplete="current-password"
                  onChange={(event) =>
                    setRemoteAuthForm((current) => ({
                      ...current,
                      password: event.target.value
                    }))
                  }
                />
              </label>
            </>
          ) : null}

          {remoteAuthForm.authMode === "token" ? (
            <>
              <label className="workbench-modal-field">
                <span>{t("shell.cloneUsernameLabel")}</span>
                <input
                  type="text"
                  value={remoteAuthForm.username}
                  placeholder={t("shell.cloneTokenUsernamePlaceholder")}
                  autoComplete="username"
                  onChange={(event) =>
                    setRemoteAuthForm((current) => ({
                      ...current,
                      username: event.target.value
                    }))
                  }
                />
              </label>
              <label className="workbench-modal-field">
                <span>{t("shell.cloneTokenLabel")}</span>
                <input
                  type="password"
                  value={remoteAuthForm.token}
                  placeholder={t("shell.cloneTokenPlaceholder")}
                  autoComplete="current-password"
                  onChange={(event) =>
                    setRemoteAuthForm((current) => ({
                      ...current,
                      token: event.target.value
                    }))
                  }
                />
              </label>
            </>
          ) : null}

          {githubRemoteDetected ? (
            <p className="git-remote-auth-hint">{t("git.remoteAuthGithubPatHint")}</p>
          ) : null}

          {remoteAuthForm.authMode !== "none" ? (
            <label className="settings-checkbox git-remote-auth-remember-toggle">
              <input
                type="checkbox"
                checked={remoteAuthForm.rememberOnHost}
                onChange={(event) =>
                  setRemoteAuthForm((current) => ({
                    ...current,
                    rememberOnHost: event.target.checked
                  }))
                }
              />
              <span>{t("git.remoteAuthRemember")}</span>
            </label>
          ) : null}

          <p className="git-remote-auth-hint">{t("git.remoteAuthSessionHint")}</p>
        </div>
        <div className="git-remote-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={actioning}
            onClick={() => setRemoteAuthModalOpen(false)}
          >
            {t("common.close")}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={actioning}
            onClick={handleSaveRemoteAuth}
          >
            {t("git.remoteAuthSave")}
          </button>
        </div>
      </WorkbenchModal>

      <WorkbenchModal
        open={allHistoryModalOpen}
        title={t("git.viewAllVersions")}
        description={t("git.viewAllVersionsDescription", { count: String(historyTotalCount) })}
        onClose={() => setAllHistoryModalOpen(false)}
      >
        <GitDesktopHistoryList
          history={history}
          historyLoadingMore={historyLoadingMore}
          hasMore={Boolean(historyNextCursor)}
          actioning={actioning}
          openCommitHash={desktopHistoryMenuCommitHash}
          className="git-history-modal-list"
          onMenuTriggerRef={setHistoryMenuTriggerRef}
          onToggleMenu={(commitHash) =>
            setDesktopHistoryMenuCommitHash((current) => (current === commitHash ? null : commitHash))
          }
          onViewCommitChanges={(commitHash) => void openCommitDetailModal(commitHash)}
          onCopyCommitHash={(commitHash) =>
            void copyText(commitHash, t("git.copyCommitHashSuccess"))
          }
          onCopyCommitMessage={(item) =>
            void copyText(buildCommitMessageText(item), t("git.copyCommitMessageSuccess"))
          }
          onCopyCommitVersion={(commitHash) => void handleCopyCommitVersion(commitHash)}
          onExplainCommitChange={(commitHash) => void openExplainProviderModal(commitHash)}
          onUndoLastCommit={() => void handleUndoLastCommit()}
          onLoadMore={() => void loadMoreHistory()}
        />
      </WorkbenchModal>

      <WorkbenchModal
        open={commitDetailModalCommitHash !== null}
        className="git-commit-detail-modal"
        title={commitDetailModalData?.subject || t("git.commitDetailTitle")}
        description={
          commitDetailModalData
            ? t("git.commitDetailDescription", { hash: commitDetailModalData.shortHash })
            : t("git.commitDetailLoading")
        }
        onClose={closeCommitDetailModal}
      >
        {commitDetailModalLoading ? (
          <div className="git-commit-detail-state">
            <p>{t("git.commitDetailLoading")}</p>
          </div>
        ) : commitDetailModalError ? (
          <div className="git-commit-detail-state is-error">
            <p>{commitDetailModalError}</p>
          </div>
        ) : commitDetailModalData ? (
          <div className="git-commit-detail-shell">
            <div className="git-commit-detail-meta-grid">
              <div className="git-commit-detail-meta-card">
                <span>{t("git.commitVersionLabel")}</span>
                <strong>{commitDetailModalData.versionLabel}</strong>
              </div>
              <div className="git-commit-detail-meta-card">
                <span>{t("git.commitHashLabel")}</span>
                <strong>{commitDetailModalData.commitHash}</strong>
              </div>
              <div className="git-commit-detail-meta-card">
                <span>{t("git.commitAuthorLabel")}</span>
                <strong>{commitDetailModalData.authorName}</strong>
              </div>
              <div className="git-commit-detail-meta-card">
                <span>{t("git.commitTimeLabel")}</span>
                <strong>{formatCommitDateTime(commitDetailModalData.authoredAt)}</strong>
              </div>
            </div>

            <section className="git-commit-detail-section">
              <div className="git-commit-detail-section-header">
                <h3>{t("git.commitMessageLabel")}</h3>
              </div>
              <pre className="git-commit-detail-message">{buildCommitMessageText(commitDetailModalData)}</pre>
            </section>

            <section className="git-commit-detail-section">
              <div className="git-commit-detail-section-header">
                <h3>{t("git.changedFilesTitle")}</h3>
                <span className="workbench-section-counter">{commitDetailModalData.changedFiles.length}</span>
              </div>
              <div className="git-commit-detail-file-list">
                {commitDetailModalData.changedFiles.map((file) => (
                  <div key={`${file.status}:${file.oldPath ?? ""}:${file.path}`} className="git-commit-detail-file-item">
                    <span className="git-commit-detail-file-status" data-status={file.status}>{file.status}</span>
                    <div className="git-commit-detail-file-copy">
                      <strong>{file.path}</strong>
                      {file.oldPath ? (
                        <span>{t("git.renamedFromLabel", { path: file.oldPath })}</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="git-commit-detail-section">
              <div className="git-commit-detail-section-header">
                <h3>{t("git.commitDiffLabel")}</h3>
                {commitDetailModalData.diffTruncated ? (
                  <span className="git-commit-detail-truncated">{t("git.diffTruncated")}</span>
                ) : null}
              </div>
              <pre className="git-commit-detail-diff">{commitDetailModalData.diffContent || t("git.emptyDiff")}</pre>
            </section>
          </div>
        ) : (
          <div className="git-commit-detail-state">
            <p>{t("git.commitDetailEmpty")}</p>
          </div>
        )}
      </WorkbenchModal>

      <WorkbenchModal
        open={explainProviderModalOpen}
        className="git-explain-provider-modal"
        title={t("git.explainCommitTitle")}
        description={t("git.explainCommitDescription")}
        onClose={() => {
          if (explainingChange) {
            return;
          }

          setExplainProviderModalOpen(false);
          setExplainCommitHash(null);
          setExplainProvider(null);
        }}
      >
        <div className="git-explain-provider-shell">
          <SessionProviderPicker
            workspaceId={workspaceId}
            selectedProvider={explainProvider}
            pendingProvider={explainingChange ? explainProvider : null}
            disabled={explainingChange}
            onSelect={(provider) => setExplainProvider(provider)}
          />
          <div className="git-explain-provider-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={explainingChange}
              onClick={() => {
                setExplainProviderModalOpen(false);
                setExplainCommitHash(null);
                setExplainProvider(null);
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!explainProvider || explainingChange}
              onClick={() => void handleExplainCommit()}
            >
              {explainingChange ? t("conversation.sendingState") : t("git.startExplainCommit")}
            </button>
          </div>
        </div>
      </WorkbenchModal>

      <FileViewerModal
        workspaceId={workspaceId}
        filePath={viewerFilePath}
        open={viewerFilePath !== null}
        onClose={() => {
          setViewerFilePath(null);
          setViewerDiffContent(null);
        }}
        onSaved={async () => {
          await handleManualRefresh({ resetTreeScroll: true });
        }}
        diffContent={viewerDiffContent}
      />
      {renderHistoryActionsMenu()}
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
  onPreviewFile,
  onToggleMobileSelection,
  onStageToggle,
  onDiscard,
  onOpenDesktopContextMenu,
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
  onPreviewFile: (filePath: string, change: GitChangeItemDto) => void;
  onToggleMobileSelection: (filePath: string) => void;
  onStageToggle: (targets: string[], staged: boolean) => Promise<void>;
  onDiscard: (targets: string[]) => Promise<void>;
  onOpenDesktopContextMenu?: (input: {
    path: string;
    targets: string[];
    variant: "staged" | "unstaged";
    isDirectory: boolean;
  }) => Promise<void>;
  actioning: boolean;
  variant: "staged" | "unstaged";
  isMobileViewport: boolean;
  selectedMobilePathSet: ReadonlySet<string>;
  selectedTargets: string[];
  mobileActionMenuOpen: boolean;
  onToggleMobileActionMenu: () => void;
  onClearSelectedTargets: () => void;
}) {
  const treeShellRef = useTransientScrollbarVisibility<HTMLDivElement>();
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

      <div
        ref={treeShellRef}
        className="git-tree-shell"
        role="tree"
        aria-label={title}
        data-scrollbar-autohide="true"
      >
        {nodes.length ? (
          renderTreeNodes({
            nodes,
            depth: 0,
            collapsedTreePathSet,
            selectedPath,
            onToggleTreePath,
            onSelectFile,
            onPreviewFile,
            onToggleMobileSelection,
            onStageToggle,
            onDiscard,
            onOpenDesktopContextMenu,
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
  onClearSelectedTargets,
  onPreviewFile
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
  onPreviewFile: (filePath: string, change: GitChangeItemDto) => void;
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
            onDiscardWithConfirm,
            onPreviewFile
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
  onDiscardWithConfirm,
  onPreviewFile
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
  onPreviewFile: (filePath: string, change: GitChangeItemDto) => void;
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
            trailingActions={
              directoryTargets.length > 0
                ? [
                    {
                      label: variant === "staged" ? t("git.unstage") : t("git.stage"),
                      tone: "accent" as const,
                      onPress: () => void onStageToggle(directoryTargets, variant === "staged")
                    },
                    ...(variant === "unstaged"
                      ? [{
                          label: t("git.discard"),
                          tone: "danger" as const,
                          onPress: () => void onDiscardWithConfirm(directoryTargets, node.path)
                        }]
                      : [])
                  ]
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
                onDiscardWithConfirm,
                onPreviewFile
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
        trailingActions={[
          {
            label: t("git.preview"),
            tone: "neutral",
            onPress: () => onPreviewFile(node.change.path, node.change)
          },
          {
            label: variant === "staged" ? t("git.unstage") : t("git.stage"),
            tone: "accent",
            onPress: () => void onStageToggle([node.change.path], variant === "staged")
          },
          ...(variant === "unstaged"
            ? [{
                label: t("git.discard"),
                tone: "danger" as const,
                onPress: () => void onDiscardWithConfirm([node.change.path], node.path)
              }]
            : [])
        ]}
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
  trailingActions,
  children
}: {
  rowKey: string;
  openState: MobileSwipeDirection | null;
  onOpenStateChange: (direction: MobileSwipeDirection | null) => void;
  trailingActions: { label: string; tone: "accent" | "danger" | "neutral"; onPress: () => void }[] | null;
  children: ReactNode;
}) {
  const haptics = useHaptics();
  const pointerStateRef = useRef<{ pointerId: number; startX: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const trailingWidth = (trailingActions?.length ?? 0) * SWIPE_ACTION_WIDTH;

  useEffect(() => {
    if (!openState) {
      setDragOffset(0);
    }
  }, [openState, rowKey]);

  const resolvedOffset =
    dragOffset !== 0
      ? dragOffset
      : openState === "trailing"
        ? -trailingWidth
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

    const maxTrailing = trailingWidth > 0 ? trailingWidth + 10 : 0;
    // 只保留左滑菜单，让右滑交给页面级文件/Git 切换手势。
    const nextOffset = Math.max(-maxTrailing, Math.min(0, event.clientX - pointerState.startX));
    setDragOffset(nextOffset);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const pointerState = pointerStateRef.current;

    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    pointerStateRef.current = null;

    if (dragOffset <= -44 && trailingActions?.length) {
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
      {trailingActions?.map((action, index) => (
        <button
          key={`trailing-${index}`}
          type="button"
          className="git-mobile-swipe-action trailing"
          data-tone={action.tone}
          style={{ right: index * SWIPE_ACTION_WIDTH, width: SWIPE_ACTION_WIDTH }}
          onClick={() => {
            void haptics.trigger(action.tone === "danger" ? "warning" : "action");
            onOpenStateChange(null);
            action.onPress();
          }}
        >
          {action.label}
        </button>
      ))}

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
  onMenuTriggerRef,
  onToggleMenu,
  onViewCommitChanges,
  onCopyCommitHash,
  onCopyCommitMessage,
  onCopyCommitVersion,
  onExplainCommitChange,
  onUndoLastCommit,
  onLoadMore
}: {
  history: GitHistoryItemDto[];
  historyLoadingMore: boolean;
  hasMore: boolean;
  actioning: boolean;
  openCommitHash: string | null;
  onMenuTriggerRef: (commitHash: string, node: HTMLButtonElement | null) => void;
  onToggleMenu: (commitHash: string) => void;
  onViewCommitChanges: (commitHash: string) => void;
  onCopyCommitHash: (commitHash: string) => void;
  onCopyCommitMessage: (item: GitHistoryItemDto) => void;
  onCopyCommitVersion: (commitHash: string) => void;
  onExplainCommitChange: (commitHash: string) => void;
  onUndoLastCommit: () => void;
  onLoadMore: () => void;
}) {
  if (!history.length) {
    return <p className="git-tree-status">{t("git.noHistory")}</p>;
  }

  return (
    <div className="git-mobile-history-list">
      {history.map((item) => {
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
                ref={(node) => onMenuTriggerRef(item.commitHash, node)}
                aria-label={t("git.historyItemMenu")}
                onClick={() => onToggleMenu(item.commitHash)}
              >
                <MoreIcon />
              </button>
            </div>
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

function GitDesktopHistoryList({
  history,
  historyLoadingMore,
  hasMore,
  actioning,
  openCommitHash,
  className,
  useNativeContextMenu = false,
  onMenuTriggerRef,
  onScroll,
  onToggleMenu,
  onOpenContextMenu,
  onViewCommitChanges,
  onCopyCommitHash,
  onCopyCommitMessage,
  onCopyCommitVersion,
  onExplainCommitChange,
  onUndoLastCommit,
  onLoadMore
}: {
  history: GitHistoryItemDto[];
  historyLoadingMore: boolean;
  hasMore: boolean;
  actioning: boolean;
  openCommitHash: string | null;
  className?: string;
  useNativeContextMenu?: boolean;
  onMenuTriggerRef: (commitHash: string, node: HTMLButtonElement | null) => void;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  onToggleMenu: (commitHash: string) => void;
  onOpenContextMenu?: (item: GitHistoryItemDto) => void;
  onViewCommitChanges: (commitHash: string) => void;
  onCopyCommitHash: (commitHash: string) => void;
  onCopyCommitMessage: (item: GitHistoryItemDto) => void;
  onCopyCommitVersion: (commitHash: string) => void;
  onExplainCommitChange: (commitHash: string) => void;
  onUndoLastCommit: () => void;
  onLoadMore: () => void;
}) {
  const historyListRef = useTransientScrollbarVisibility<HTMLDivElement>();

  if (!history.length) {
    return <p className="status-text">{t("git.noHistory")}</p>;
  }

  return (
    <div
      ref={historyListRef}
      className={["git-history-list", className].filter(Boolean).join(" ")}
      onScroll={onScroll}
      data-scrollbar-autohide="true"
    >
      {history.map((item) => {
        const menuOpen = openCommitHash === item.commitHash;

        return (
          <article
            key={item.commitHash}
            className="git-history-entry"
            data-kind={item.commitKind}
            data-menu-open={menuOpen ? "true" : "false"}
            onContextMenu={(event) => {
              if (!useNativeContextMenu || !onOpenContextMenu) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              onOpenContextMenu(item);
            }}
          >
            <span
              className="git-history-marker"
              data-kind={item.commitKind}
              aria-hidden="true"
            />
            <div className="git-history-body">
              <div className="git-history-title-row">
                <strong title={item.subject}>{item.subject}</strong>
                <div className="git-history-title-actions">
                  <span className="git-history-kind-badge" data-kind={item.commitKind}>
                    {formatHistoryCommitKind(item.commitKind)}
                  </span>
                  {useNativeContextMenu ? null : (
                    <button
                      type="button"
                      className="git-icon-button git-history-more"
                      ref={(node) => onMenuTriggerRef(item.commitHash, node)}
                      aria-label={t("git.historyItemMenu")}
                      onClick={() => {
                        onToggleMenu(item.commitHash);
                      }}
                    >
                      <MoreIcon />
                    </button>
                  )}
                </div>
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
        );
      })}

      {historyLoadingMore ? <p className="git-history-loading">{t("git.refreshNow")}...</p> : null}

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

function GitHistoryActionsMenu({
  item,
  canUndo,
  actioning,
  onViewCommitChanges,
  onCopyCommitHash,
  onCopyCommitMessage,
  onCopyCommitVersion,
  onExplainCommitChange,
  onUndoLastCommit
}: {
  item: GitHistoryItemDto;
  canUndo: boolean;
  actioning: boolean;
  onViewCommitChanges: (commitHash: string) => void;
  onCopyCommitHash: (commitHash: string) => void;
  onCopyCommitMessage: (item: GitHistoryItemDto) => void;
  onCopyCommitVersion: (commitHash: string) => void;
  onExplainCommitChange: (commitHash: string) => void;
  onUndoLastCommit: () => void;
}) {
  return (
    <>
      <button type="button" className="git-menu-item" onClick={() => onViewCommitChanges(item.commitHash)}>
        <span>{t("git.viewCommitChanges")}</span>
      </button>
      <button type="button" className="git-menu-item" onClick={() => onCopyCommitHash(item.commitHash)}>
        <span>{t("git.copyCommitHash")}</span>
      </button>
      <button type="button" className="git-menu-item" onClick={() => onCopyCommitMessage(item)}>
        <span>{t("git.copyCommitMessage")}</span>
      </button>
      <button type="button" className="git-menu-item" onClick={() => onCopyCommitVersion(item.commitHash)}>
        <span>{t("git.copyCommitVersion")}</span>
      </button>
      <button type="button" className="git-menu-item" onClick={() => onExplainCommitChange(item.commitHash)}>
        <span>{t("git.explainCommitAction")}</span>
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
    </>
  );
}

function renderTreeNodes({
  nodes,
  depth,
  collapsedTreePathSet,
  selectedPath,
  onToggleTreePath,
  onSelectFile,
  onPreviewFile,
  onToggleMobileSelection,
  onStageToggle,
  onDiscard,
  onOpenDesktopContextMenu,
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
  onPreviewFile: (filePath: string, change: GitChangeItemDto) => void;
  onToggleMobileSelection: (filePath: string) => void;
  onStageToggle: (targets: string[], staged: boolean) => Promise<void>;
  onDiscard: (targets: string[]) => Promise<void>;
  onOpenDesktopContextMenu?: (input: {
    path: string;
    targets: string[];
    variant: "staged" | "unstaged";
    isDirectory: boolean;
  }) => Promise<void>;
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
              onContextMenu={(event) => {
                if (isMobileViewport || !onOpenDesktopContextMenu) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
                void onOpenDesktopContextMenu({
                  path: node.path,
                  targets: directoryTargets,
                  variant,
                  isDirectory: true
                });
              }}
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
                onPreviewFile,
                onToggleMobileSelection,
                onStageToggle,
                onDiscard,
                onOpenDesktopContextMenu,
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
          onClick={() => {
            onSelectFile(node.change.path);
            if (onPreviewFile) {
              onPreviewFile(node.change.path, node.change);
            }
          }}
          onContextMenu={(event) => {
            if (isMobileViewport || !onOpenDesktopContextMenu) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            onSelectFile(node.change.path);
            void onOpenDesktopContextMenu({
              path: node.path,
              targets: [node.change.path],
              variant,
              isDirectory: false
            });
          }}
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

function copyTextWithExecCommand(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function buildCommitMessageText(input: Pick<GitHistoryItemDto, "subject" | "body">): string;
function buildCommitMessageText(input: Pick<GitCommitDetailDto, "subject" | "body">): string;
function buildCommitMessageText(
  input: Pick<GitHistoryItemDto, "subject" | "body"> | Pick<GitCommitDetailDto, "subject" | "body">
): string {
  const subject = input.subject.trim();
  const body = input.body.trim();

  return body ? `${subject}\n\n${body}` : subject;
}

function buildCommitExplainPrompt(detail: GitCommitDetailDto): string {
  const summarizedFiles = detail.changedFiles
    .map((file) => `- [${file.status}] ${file.path}${file.oldPath ? ` (from ${file.oldPath})` : ""}`)
    .join("\n");
  const trimmedDiff = detail.diffContent.length > GIT_COMMIT_EXPLAIN_DIFF_LIMIT
    ? detail.diffContent.slice(0, GIT_COMMIT_EXPLAIN_DIFF_LIMIT)
    : detail.diffContent;
  const diffNotice = detail.diffContent.length > GIT_COMMIT_EXPLAIN_DIFF_LIMIT || detail.diffTruncated
    ? "\n注意：diff 内容过长，下面已经截断，只分析可见部分，同时明确指出可能遗漏的区域。"
    : "";

  return [
    "请你分析下面这个 Git 提交。",
    "输出要求：",
    "1. 先用 3 到 5 句话说明这次改动的核心目的。",
    "2. 按文件说明关键改动点，不要泛泛而谈。",
    "3. 指出潜在风险、边界情况和可能的回归点。",
    "4. 如果提交信息写得差，给出一条更合适的中文提交说明。",
    "",
    `版本号：${detail.versionLabel}`,
    `Commit Hash：${detail.commitHash}`,
    `提交标题：${detail.subject}`,
    `提交作者：${detail.authorName} <${detail.authorEmail}>`,
    `提交时间：${detail.authoredAt}`,
    "",
    "变更文件：",
    summarizedFiles || "- 无",
    diffNotice,
    "",
    "Diff：",
    trimmedDiff || "(empty diff)"
  ].join("\n");
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

function formatCommitDateTime(value: string) {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(timestamp);
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

function buildGitSidebarSnapshotKey(workspaceId: string, targetHostId?: string | null) {
  return buildScopedSnapshotKey("git-sidebar.snapshot", { workspaceId, targetHostId });
}

function hasGitSidebarSnapshotData(snapshot: GitSidebarSnapshot | null | undefined): boolean {
  if (!snapshot) {
    return false;
  }

  return Boolean(
    snapshot.status
    || snapshot.branches
    || snapshot.history.length > 0
    || snapshot.historyTotalCount > 0
    || snapshot.historyNextCursor
    || snapshot.revision
  );
}

function isGitRepositoryEnabled(status: GitStatusDto | null | undefined): boolean {
  if (!status) {
    return true;
  }

  return status.snapshot.enabled !== false;
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
    case "GIT_INIT_FAILED":
      return t("git.errors.initFailed");
    case "GIT_DISCARD_FAILED":
      return t("git.discardFailed");
    case "GIT_UNDO_FAILED":
      return t("git.undoLastCommitFailed");
    default:
      return null;
  }
}

function isRemoteAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.errorCode === "GIT_REMOTE_AUTH_FAILED";
}

function toRemoteAuthFormState(
  auth: GitRemoteAuthDto | null,
  rememberOnHost = false
): RemoteAuthFormState {
  if (!auth || !auth.mode || auth.mode === "none") {
    return INITIAL_REMOTE_AUTH_FORM;
  }

  if (auth.mode === "basic") {
    return {
      authMode: "basic",
      username: auth.username ?? "",
      password: auth.password ?? "",
      token: "",
      rememberOnHost
    };
  }

  if (auth.mode === "token") {
    return {
      authMode: "token",
      username: auth.username ?? "",
      password: "",
      token: auth.token ?? "",
      rememberOnHost
    };
  }

  return INITIAL_REMOTE_AUTH_FORM;
}

function toRemoteAuthPayload(form: RemoteAuthFormState): GitRemoteAuthDto | null {
  if (form.authMode === "none") {
    return null;
  }

  if (form.authMode === "basic") {
    return {
      mode: "basic",
      username: form.username.trim(),
      password: form.password
    };
  }

  return {
    mode: "token",
    username: form.username.trim() || undefined,
    token: form.token
  };
}

function resolveRemoteAuthProvider(
  remotes: GitRemoteItemDto[],
  preferredRemoteName?: string
): GitRemoteAuthProvider {
  const preferredRemote = resolvePreferredRemote(remotes, preferredRemoteName);

  if (!preferredRemote) {
    return "generic";
  }

  const remoteUrl = preferredRemote.pushUrl || preferredRemote.fetchUrl;

  return isGitHubRemoteUrl(remoteUrl) ? "github" : "generic";
}

function resolvePreferredRemote(
  remotes: GitRemoteItemDto[],
  preferredRemoteName?: string | null
): GitRemoteItemDto | null {
  return (
    remotes.find((item) => item.name === preferredRemoteName)
    ?? remotes.find((item) => item.name === "origin")
    ?? remotes[0]
    ?? null
  );
}

function resolvePreferredRemoteName(remotes: GitRemoteItemDto[]): string | undefined {
  return resolvePreferredRemote(remotes)?.name;
}

function resolveRemoteCredentialState(
  remote: GitRemoteItemDto,
  sessionAuthState: RemoteSessionAuthState | null
): { kind: GitRemoteCredentialState; label: string } {
  if (sessionAuthState?.auth) {
    return {
      kind: "session",
      label: t("git.remoteAuthConfiguredInSession")
    };
  }

  if (remote.credentialConfigured) {
    return {
      kind: "host",
      label: t("git.remoteAuthConfiguredOnHost")
    };
  }

  return {
    kind: "missing",
    label: t("git.remoteAuthNotConfigured")
  };
}

function isGitHubRemoteUrl(remoteUrl: string | null | undefined): boolean {
  const normalized = remoteUrl?.trim().toLowerCase() ?? "";

  return (
    normalized.startsWith("https://github.com/")
    || normalized.startsWith("http://github.com/")
    || normalized.startsWith("ssh://git@github.com/")
    || normalized.startsWith("git@github.com:")
  );
}

export function resolveGitOperationsMenuPosition(
  anchorRect: Pick<DOMRect, "top" | "right" | "bottom" | "left">,
  menuSize: { width: number; height: number },
  viewport: { width: number; height: number }
): GitOperationsMenuPosition {
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);
  const viewportMaxHeight = Math.max(
    0,
    viewportHeight - GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX * 2
  );
  const maxMenuWidth = Math.max(
    0,
    viewportWidth - GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX * 2
  );
  const safeMenuWidth = Math.min(
    Math.max(menuSize.width || GIT_OPERATIONS_MENU_DEFAULT_WIDTH_PX, 0),
    maxMenuWidth
  );
  const spaceBelow = Math.max(
    0,
    viewportHeight - anchorRect.bottom - GIT_OPERATIONS_MENU_GAP_PX - GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX
  );
  const spaceAbove = Math.max(
    0,
    anchorRect.top - GIT_OPERATIONS_MENU_GAP_PX - GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX
  );
  const shouldOpenUpward = spaceBelow < menuSize.height && spaceAbove > spaceBelow;
  const availableHeight = shouldOpenUpward ? spaceAbove : spaceBelow;
  const safeMaxHeight = clampNumber(
    Math.max(availableHeight, GIT_OPERATIONS_MENU_MIN_HEIGHT_PX),
    0,
    viewportMaxHeight
  );
  const visibleMenuHeight = Math.min(
    Math.max(menuSize.height, 0),
    safeMaxHeight
  );
  const unclampedTop = shouldOpenUpward
    ? anchorRect.top - GIT_OPERATIONS_MENU_GAP_PX - visibleMenuHeight
    : anchorRect.bottom + GIT_OPERATIONS_MENU_GAP_PX;
  const maxTop = Math.max(
    GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX,
    viewportHeight - GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX - visibleMenuHeight
  );
  const maxLeft = Math.max(
    GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX,
    viewportWidth - GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX - safeMenuWidth
  );

  return {
    top: clampNumber(
      unclampedTop,
      GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX,
      maxTop
    ),
    left: clampNumber(
      anchorRect.right - safeMenuWidth,
      GIT_OPERATIONS_MENU_VIEWPORT_MARGIN_PX,
      maxLeft
    ),
    maxHeight: Math.max(
      0,
      safeMaxHeight
    ),
    transformOrigin: `${shouldOpenUpward ? "bottom" : "top"} right`
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
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
