import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type UIEvent
} from "react";

import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import {
  commitDraft,
  createCommitDraft,
  discardGitTargets,
  getGitBranches,
  getGitHistory,
  getGitStatus,
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

interface GitSidebarProps {
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
}

type GitTreeNode = GitTreeDirectoryNode | GitTreeFileNode;

interface MutableGitTreeDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  children: Map<string, MutableGitTreeDirectoryNode | GitTreeFileNode>;
}

const DEFAULT_TREE_PANEL_RATIO = 56;
const MIN_TREE_PANEL_RATIO = 28;
const MAX_TREE_PANEL_RATIO = 72;
const PANEL_RESIZER_HEIGHT = 8;

export function GitSidebar({ workspaceId }: GitSidebarProps) {
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
  const [treePanelRatio, setTreePanelRatio] = useState(DEFAULT_TREE_PANEL_RATIO);
  const [panelResizeActive, setPanelResizeActive] = useState(false);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const treePanelBodyRef = useRef<HTMLDivElement | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    setCollapsedTreePaths([]);
    setHistoryExpanded(true);
    setHistoryTotalCount(0);
    setHistoryNextCursor(null);
    setHistoryLoadingMore(false);
    setSelectedPath(null);
    setCommitSubject("");
    setMenuOpen(false);
    setPanelResizeActive(false);
    setTreePanelRatio(DEFAULT_TREE_PANEL_RATIO);
  }, [workspaceId]);

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
    let cancelled = false;

    async function loadAll() {
      if (!workspaceId) {
        setStatus(null);
        setHistory([]);
        setHistoryTotalCount(0);
        setHistoryNextCursor(null);
        setBranches(null);
        return;
      }

      setLoading(true);

      try {
        const [nextStatus, nextHistory, nextBranches] = await Promise.all([
          getGitStatus(workspaceId),
          getGitHistory(workspaceId, 20),
          getGitBranches(workspaceId)
        ]);

        if (cancelled) {
          return;
        }

        setStatus(nextStatus);
        setHistory(nextHistory.items);
        setHistoryTotalCount(nextHistory.totalCount);
        setHistoryNextCursor(nextHistory.nextCursor);
        setBranches(nextBranches);
      } catch (error) {
        if (!cancelled) {
          showToast({
            title: readError(error, t("git.panelLoadFailed")),
            tone: "error"
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, [showToast, workspaceId]);

  useEffect(() => {
    if (!status || !selectedPath) {
      return;
    }

    const activeItem = status.changes.find((item) => item.path === selectedPath);

    if (!activeItem) {
      setSelectedPath(null);
    }
  }, [selectedPath, status]);

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

  async function refreshContext(options?: { resetTreeScroll?: boolean }) {
    if (!workspaceId) {
      return;
    }

    try {
      const [nextStatus, nextHistory, nextBranches] = await Promise.all([
        getGitStatus(workspaceId),
        getGitHistory(workspaceId, 20, null),
        getGitBranches(workspaceId)
      ]);

      setStatus(nextStatus);
      setHistory(nextHistory.items);
      setHistoryTotalCount(nextHistory.totalCount);
      setHistoryNextCursor(nextHistory.nextCursor);
      setBranches(nextBranches);

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
    }
  }

  async function loadMoreHistory() {
    if (!workspaceId || !historyNextCursor || historyLoadingMore) {
      return;
    }

    setHistoryLoadingMore(true);

    try {
      const nextHistory = await getGitHistory(workspaceId, 20, historyNextCursor);

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

  async function handleStageToggle(filePath: string, staged: boolean) {
    if (!workspaceId) {
      return;
    }

    setActioning(true);

    try {
      const nextStatus = staged
        ? await unstageGitTargets(workspaceId, [filePath])
        : await stageGitTargets(workspaceId, [filePath]);

      setStatus(nextStatus);
      setSelectedPath(filePath);
    } catch (error) {
      showToast({
        title: readError(error, t("git.stageFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handleDiscard(filePath: string) {
    if (!workspaceId) {
      return;
    }

    setActioning(true);

    try {
      const nextStatus = await discardGitTargets(workspaceId, [filePath]);
      setStatus(nextStatus);

      if (selectedPath === filePath) {
        setSelectedPath(null);
      }
    } catch (error) {
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
      await refreshContext();
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
      await refreshContext();
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
      await refreshContext();
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
      showToast({
        title: result.summary || t("git.undoLastCommitSuccess"),
        tone: "success"
      });
      setMenuOpen(false);
      await refreshContext();
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
      await refreshContext();
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
  const stagedChanges = allChanges.filter((item) => item.staged);
  const unstagedChanges = allChanges.filter((item) => !item.staged);
  const stagedTree = buildChangeTree(stagedChanges);
  const unstagedTree = buildChangeTree(unstagedChanges);
  const collapsedTreePathSet = new Set(collapsedTreePaths);
  const canPush = allChanges.length === 0 && (status?.snapshot.ahead ?? 0) > 0;
  const canCommit = stagedChanges.length > 0 && commitSubject.trim().length > 0;
  const currentBranch = branches?.currentBranch ?? status?.snapshot.branch ?? t("common.unknown");
  const safeTreePanelRatio = Number.isFinite(treePanelRatio)
    ? treePanelRatio
    : DEFAULT_TREE_PANEL_RATIO;
  const splitRows = historyExpanded
    ? `minmax(120px, ${safeTreePanelRatio}fr) ${PANEL_RESIZER_HEIGHT}px minmax(140px, ${100 - safeTreePanelRatio}fr)`
    : `minmax(120px, 1fr) ${PANEL_RESIZER_HEIGHT}px auto`;

  return (
    <section className="conversation-panel surface-card git-sidebar" data-testid="git-sidebar">
      <section className="git-card git-scaffold-section">
        <div className="git-section-header">
          <h3>{t("git.commitMessageTitle")}</h3>
        </div>

        <div className="git-editor-row">
          <input
            value={commitSubject}
            onChange={(event) => setCommitSubject(event.target.value)}
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
            onClick={() => void refreshContext({ resetTreeScroll: true })}
            disabled={actioning || !workspaceId}
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
                onStageToggle={handleStageToggle}
                onDiscard={handleDiscard}
                actioning={actioning}
                variant="staged"
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
              onStageToggle={handleStageToggle}
              onDiscard={handleDiscard}
              actioning={actioning}
              variant="unstaged"
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

              {menuOpen ? (
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
                          <span>{item.current ? `${t("git.switchBranch")} ${item.name}` : `${t("git.switchBranchTo")} ${item.name}`}</span>
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
                      disabled={actioning}
                      onClick={() => void refreshContext({ resetTreeScroll: true })}
                    >
                      <span>{t("git.refresh")}</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {historyExpanded ? (
            <div className="git-history-list" onScroll={handleHistoryScroll}>
              {history.length ? (
                <>
                  {history.map((item) => (
                    <article key={item.commitHash} className="git-history-entry">
                      <span className="git-history-marker" aria-hidden="true" />
                      <div className="git-history-body">
                        <strong>{item.subject}</strong>
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
  onStageToggle,
  onDiscard,
  actioning,
  variant
}: {
  title: string;
  count: number;
  nodes: GitTreeNode[];
  selectedPath: string | null;
  collapsedTreePathSet: ReadonlySet<string>;
  onToggleTreePath: (path: string) => void;
  onSelectFile: (filePath: string) => void;
  onStageToggle: (filePath: string, staged: boolean) => Promise<void>;
  onDiscard: (filePath: string) => Promise<void>;
  actioning: boolean;
  variant: "staged" | "unstaged";
}) {
  return (
    <section className="git-tree-group" data-variant={variant}>
      <div className="git-section-header">
        <h3>{title}</h3>
        <span className="workbench-section-counter">{count}</span>
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
            onStageToggle,
            onDiscard,
            actioning,
            variant
          })
        ) : (
          <p className="git-tree-status">{t("git.noChanges")}</p>
        )}
      </div>
    </section>
  );
}

function renderTreeNodes({
  nodes,
  depth,
  collapsedTreePathSet,
  selectedPath,
  onToggleTreePath,
  onSelectFile,
  onStageToggle,
  onDiscard,
  actioning,
  variant
}: {
  nodes: GitTreeNode[];
  depth: number;
  collapsedTreePathSet: ReadonlySet<string>;
  selectedPath: string | null;
  onToggleTreePath: (path: string) => void;
  onSelectFile: (filePath: string) => void;
  onStageToggle: (filePath: string, staged: boolean) => Promise<void>;
  onDiscard: (filePath: string) => Promise<void>;
  actioning: boolean;
  variant: "staged" | "unstaged";
}) {
  return nodes.map((node) => {
    if (node.kind === "directory") {
      const expanded = !collapsedTreePathSet.has(node.path);

      return (
        <div key={`directory:${node.path}`} className="git-tree-node" role="treeitem" aria-expanded={expanded}>
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

          {expanded ? (
            <div className="git-tree-children" role="group">
              {renderTreeNodes({
                nodes: node.children,
                depth: depth + 1,
                collapsedTreePathSet,
                selectedPath,
                onToggleTreePath,
                onSelectFile,
                onStageToggle,
                onDiscard,
                actioning,
                variant
              })}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div
        key={`file:${node.path}`}
        className="git-tree-row"
        role="treeitem"
        data-active={selectedPath === node.path}
      >
        <button
          className="git-tree-file-button"
          type="button"
          data-active={selectedPath === node.path}
          style={{ paddingInlineStart: `${18 + depth * 8}px` }}
          onClick={() => onSelectFile(node.change.path)}
        >
          <span
            className="git-tree-file-icon"
            data-kind={resolveFileIconKind(node.name)}
            aria-hidden="true"
          >
            {resolveFileIconLabel(node.name)}
          </span>
          <span className="git-tree-label-wrap">
            <span className="git-tree-label">{node.name}</span>
          </span>
          <span className="git-tree-file-meta">
            <span className="git-status-badge" data-status={node.change.status}>
              {node.change.status}
            </span>
          </span>
        </button>

        <div className="git-row-actions">
          <button
            className="git-icon-button"
            type="button"
            aria-label={node.change.staged ? t("git.unstage") : t("git.stage")}
            title={node.change.staged ? t("git.unstage") : t("git.stage")}
            onClick={() => void onStageToggle(node.change.path, node.change.staged)}
            disabled={actioning}
          >
            <StageIcon staged={node.change.staged} />
          </button>
          {variant === "unstaged" ? (
            <button
              className="git-icon-button danger"
              type="button"
              aria-label={t("git.discard")}
              title={t("git.discard")}
              onClick={() => void onDiscard(node.change.path)}
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

function buildChangeTree(changes: GitChangeItemDto[]): GitTreeNode[] {
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
          change
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

function buildCommitDraft(subject: string): CommitDraftDto {
  return {
    subject: subject.trim(),
    body: null,
    footer: null,
    source: "manual"
  };
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
      <path d="M9 10L5 14l4 4" />
      <path d="M5 14h8a6 6 0 1 0 0 12h-1" />
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

function resolveFileIconLabel(fileName: string) {
  const normalizedName = fileName.toLowerCase();

  if (normalizedName === ".env" || normalizedName.startsWith(".env.")) {
    return "ENV";
  }

  if (normalizedName.endsWith(".d.ts")) {
    return "DTS";
  }

  const extension = normalizedName.includes(".")
    ? normalizedName.slice(normalizedName.lastIndexOf(".") + 1)
    : "";

  switch (extension) {
    case "ts":
      return "TS";
    case "tsx":
      return "TSX";
    case "js":
      return "JS";
    case "jsx":
      return "JSX";
    case "json":
      return "{}";
    case "md":
      return "MD";
    case "css":
      return "CSS";
    case "scss":
      return "SASS";
    case "html":
      return "HTML";
    case "yml":
    case "yaml":
      return "YAML";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
      return "IMG";
    case "txt":
      return "TXT";
    default:
      return "FILE";
  }
}

function resolveFileIconKind(fileName: string) {
  const normalizedName = fileName.toLowerCase();

  if (normalizedName === ".env" || normalizedName.startsWith(".env.")) {
    return "env";
  }

  if (normalizedName.endsWith(".md")) {
    return "md";
  }

  if (normalizedName.endsWith(".css") || normalizedName.endsWith(".scss")) {
    return "style";
  }

  if (
    normalizedName.endsWith(".png") ||
    normalizedName.endsWith(".jpg") ||
    normalizedName.endsWith(".jpeg") ||
    normalizedName.endsWith(".gif") ||
    normalizedName.endsWith(".svg") ||
    normalizedName.endsWith(".webp")
  ) {
    return "image";
  }

  if (
    normalizedName.endsWith(".ts") ||
    normalizedName.endsWith(".tsx") ||
    normalizedName.endsWith(".js") ||
    normalizedName.endsWith(".jsx")
  ) {
    return "code";
  }

  if (normalizedName.endsWith(".json") || normalizedName.endsWith(".yml") || normalizedName.endsWith(".yaml")) {
    return "data";
  }

  return "default";
}
