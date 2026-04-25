import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import { stageGitTargets, type GitChangeItemDto } from "../api/git-api";
import {
  buildSessionChangeSubtitle,
  buildSessionChangeTree,
  getFileName,
  isDeletedGitChange,
  loadSessionChangedGitFiles,
  type SessionChangeTreeNode
} from "./session-change-utils";
import {
  resolveFileTreeIconKind,
  resolveFileTreeIconLabel
} from "./file-tree-icon";
import { filterVisibleEntriesByName } from "./file-entry-visibility";
import { useTransientScrollbarVisibility } from "./useTransientScrollbarVisibility";

interface SessionChangedFilesPanelProps {
  sessionId: string;
  workspaceId: string;
  showSystemFiles: boolean;
  selectedPath: string | null;
  refreshVersion: number;
  onCountChange?: (count: number) => void;
  onSelectFile: (filePath: string) => Promise<void>;
  onOpenFile: (filePath: string) => Promise<void>;
}

type SessionViewMode = "tree" | "list";
type RecentFileActivation = {
  filePath: string;
  timestamp: number;
};

const FILE_REPEAT_ACTIVATION_MS = 450;
const SESSION_CHANGED_FILES_CACHE_MAX_AGE_MS = 60 * 1000;
const SIDEBAR_TREE_ROOT_PADDING_PX = 20;
const SIDEBAR_TREE_DEPTH_STEP_PX = 16;

export function SessionChangedFilesPanel({
  sessionId,
  workspaceId,
  showSystemFiles,
  selectedPath,
  refreshVersion,
  onCountChange,
  onSelectFile,
  onOpenFile
}: SessionChangedFilesPanelProps) {
  const [viewMode, setViewMode] = useState<SessionViewMode>("tree");
  const [changes, setChanges] = useState<GitChangeItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [staging, setStaging] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState<string[]>([]);
  const recentFileActivationRef = useRef<RecentFileActivation | null>(null);
  const fileTreeRef = useTransientScrollbarVisibility<HTMLDivElement>();
  const { showToast } = useToast();

  useEffect(() => {
    const cachedChanges = readViewSnapshot<GitChangeItemDto[]>(
      buildSessionChangedFilesSnapshotKey(workspaceId, sessionId),
      SESSION_CHANGED_FILES_CACHE_MAX_AGE_MS
    );

    setViewMode("tree");
    setChanges(cachedChanges ?? []);
    setLoading(cachedChanges === null);
    setStaging(false);
    setCollapsedPaths([]);
    recentFileActivationRef.current = null;
  }, [sessionId, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      try {
        const nextChanges = await loadSessionChangedGitFiles(sessionId, workspaceId);

        if (!cancelled) {
          setChanges(nextChanges);
          writeViewSnapshot(buildSessionChangedFilesSnapshotKey(workspaceId, sessionId), nextChanges);
        }
      } catch (error) {
        if (!cancelled) {
          showToast({
            title: readError(error, t("conversation.filePanelSessionLoadFailed")),
            tone: "error"
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [refreshVersion, sessionId, showToast, workspaceId]);

  async function handleRefresh() {
    setLoading(true);

    try {
      const nextChanges = await loadSessionChangedGitFiles(sessionId, workspaceId);
      setChanges(nextChanges);
      writeViewSnapshot(buildSessionChangedFilesSnapshotKey(workspaceId, sessionId), nextChanges);
    } catch (error) {
      showToast({
        title: readError(error, t("conversation.filePanelSessionLoadFailed")),
        tone: "error"
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleStageAll() {
    if (unstagedChanges.length === 0) {
      return;
    }

    setStaging(true);

    try {
      await stageGitTargets(
        workspaceId,
        unstagedChanges.map((item) => item.path)
      );
      const nextChanges = await loadSessionChangedGitFiles(sessionId, workspaceId);
      setChanges(nextChanges);
      writeViewSnapshot(buildSessionChangedFilesSnapshotKey(workspaceId, sessionId), nextChanges);
      showToast({
        title: t("conversation.filePanelSessionStageSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: readError(error, t("git.stageFailed")),
        tone: "error"
      });
    } finally {
      setStaging(false);
    }
  }

  function toggleTreePath(path: string) {
    setCollapsedPaths((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
    );
  }

  function shouldOpenViewerByRepeatClick(filePath: string): boolean {
    const now = Date.now();
    const recentActivation = recentFileActivationRef.current;
    recentFileActivationRef.current = {
      filePath,
      timestamp: now
    };

    return (
      recentActivation?.filePath === filePath &&
      now - recentActivation.timestamp <= FILE_REPEAT_ACTIVATION_MS
    );
  }

  async function handleFileClick(filePath: string, canOpenViewer: boolean) {
    if (canOpenViewer && shouldOpenViewerByRepeatClick(filePath)) {
      await onOpenFile(filePath);
      recentFileActivationRef.current = null;
      return;
    }

    if (!canOpenViewer) {
      recentFileActivationRef.current = null;
    }

    await onSelectFile(filePath);
  }

  const visibleChanges = useMemo(
    () =>
      filterVisibleEntriesByName(
        changes,
        (item) => getFileName(item.path),
        showSystemFiles
      ),
    [changes, showSystemFiles]
  );
  const unstagedChanges = visibleChanges.filter((item) => !item.staged);
  const tree = buildSessionChangeTree(visibleChanges);
  const collapsedPathSet = new Set(collapsedPaths);

  useEffect(() => {
    onCountChange?.(visibleChanges.length);
  }, [onCountChange, visibleChanges.length]);

  return (
    <>
      <div className="file-panel-session-toolbar">
        <div
          className="file-panel-view-modes"
          role="tablist"
          aria-label={t("conversation.filePanelSessionViewLabel")}
        >
          <button
            className={viewMode === "tree" ? "file-panel-view-button active" : "file-panel-view-button"}
            type="button"
            role="tab"
            aria-selected={viewMode === "tree"}
            onClick={() => setViewMode("tree")}
          >
            {t("conversation.filePanelSessionTreeView")}
          </button>
          <button
            className={viewMode === "list" ? "file-panel-view-button active" : "file-panel-view-button"}
            type="button"
            role="tab"
            aria-selected={viewMode === "list"}
            onClick={() => setViewMode("list")}
          >
            {t("conversation.filePanelSessionListView")}
          </button>
        </div>

        <div className="file-panel-session-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void handleRefresh()}
            disabled={loading || staging}
          >
            {t("conversation.filePanelRefresh")}
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleStageAll()}
            disabled={staging || unstagedChanges.length === 0}
          >
            {t("conversation.filePanelSessionStageAll")}
          </button>
        </div>
      </div>

      <div className="file-panel-session-summary">
        <span>{`${t("conversation.filePanelSessionSummary")} ${visibleChanges.length}`}</span>
        <span>{`${t("conversation.filePanelSessionUnstagedSummary")} ${unstagedChanges.length}`}</span>
      </div>

      <div ref={fileTreeRef} className="file-tree" data-scrollbar-autohide="true">
        {loading ? (
          <p className="file-tree-status status-text">{t("conversation.filePanelSessionLoading")}</p>
        ) : visibleChanges.length === 0 ? (
          <p className="file-tree-status status-text">{t("conversation.filePanelSessionEmpty")}</p>
        ) : viewMode === "tree" ? (
          renderTree({
            nodes: tree,
            depth: 0,
            collapsedPathSet,
            selectedPath,
            onToggleTreePath: toggleTreePath,
            onFileClick: handleFileClick
          })
        ) : (
          renderList({
            items: visibleChanges,
            selectedPath,
            onFileClick: handleFileClick
          })
        )}
      </div>
    </>
  );
}

function renderTree({
  nodes,
  depth,
  collapsedPathSet,
  selectedPath,
  onToggleTreePath,
  onFileClick
}: {
  nodes: SessionChangeTreeNode[];
  depth: number;
  collapsedPathSet: ReadonlySet<string>;
  selectedPath: string | null;
  onToggleTreePath: (path: string) => void;
  onFileClick: (filePath: string, canOpenViewer: boolean) => Promise<void>;
}): ReactNode {
  return nodes.map((node) => {
    if (node.kind === "directory") {
      const expanded = !collapsedPathSet.has(node.path);

      return (
        <div key={`session-directory:${node.path}`} className="file-tree-node">
          <button
            className="file-tree-item"
            type="button"
            data-kind="directory"
            aria-expanded={expanded}
            style={{
              paddingInlineStart: `${SIDEBAR_TREE_ROOT_PADDING_PX + depth * SIDEBAR_TREE_DEPTH_STEP_PX}px`
            }}
            onClick={() => onToggleTreePath(node.path)}
          >
            <span className="file-tree-chevron" aria-hidden="true">
              {expanded ? "v" : ">"}
            </span>
            <span className="file-tree-label">{node.name}</span>
          </button>

          {expanded ? (
            <div className="file-tree-children">
              {renderTree({
                nodes: node.children,
                depth: depth + 1,
                collapsedPathSet,
                selectedPath,
                onToggleTreePath,
                onFileClick
              })}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div key={`session-file:${node.path}`} className="file-tree-node">
        <button
          className="file-tree-item is-session-change"
          type="button"
          data-active={selectedPath === node.change.path}
          data-kind="file"
          style={{
            paddingInlineStart: `${SIDEBAR_TREE_ROOT_PADDING_PX + depth * SIDEBAR_TREE_DEPTH_STEP_PX}px`
          }}
          onClick={() => void onFileClick(node.change.path, !isDeletedGitChange(node.change))}
        >
          <span className="file-tree-chevron is-hidden" aria-hidden="true">
            &gt;
          </span>
          <span
            className="git-tree-file-icon"
            data-kind={resolveFileTreeIconKind(node.name)}
            aria-hidden="true"
          >
            {resolveFileTreeIconLabel(node.name)}
          </span>
          <span className="file-tree-label">
            <span className="file-tree-name">{node.name}</span>
            <span className="file-tree-path">
              {buildSessionChangeSubtitle(node.change, t("conversation.filePanelSessionDeleted"))}
            </span>
          </span>
          <span className="file-session-item-meta">
            <span className="file-session-badge" data-status={node.change.status}>
              {node.change.status}
            </span>
            <span className="file-session-badge subtle">
              {node.change.staged ? t("git.stagedLabel") : t("git.workingTreeLabel")}
            </span>
          </span>
        </button>
      </div>
    );
  });
}

function renderList({
  items,
  selectedPath,
  onFileClick
}: {
  items: GitChangeItemDto[];
  selectedPath: string | null;
  onFileClick: (filePath: string, canOpenViewer: boolean) => Promise<void>;
}) {
  return items.map((item) => (
    <div key={`session-list:${item.path}`} className="file-session-list-item">
      <button
        className="file-session-list-button"
        type="button"
        data-active={selectedPath === item.path}
        onClick={() => void onFileClick(item.path, !isDeletedGitChange(item))}
      >
        <span
          className="git-tree-file-icon"
          data-kind={resolveFileTreeIconKind(getFileName(item.path))}
          aria-hidden="true"
        >
          {resolveFileTreeIconLabel(getFileName(item.path))}
        </span>
        <span className="file-tree-label">
          <span className="file-tree-name">{getFileName(item.path)}</span>
          <span className="file-tree-path">
            {buildSessionChangeSubtitle(item, t("conversation.filePanelSessionDeleted"))}
          </span>
        </span>
        <span className="file-session-item-meta">
          <span className="file-session-badge" data-status={item.status}>
            {item.status}
          </span>
          <span className="file-session-badge subtle">
            {item.staged ? t("git.stagedLabel") : t("git.workingTreeLabel")}
          </span>
        </span>
      </button>
    </div>
  ));
}

function buildSessionChangedFilesSnapshotKey(workspaceId: string, sessionId: string) {
  return `file-panel.session-changes.${workspaceId}.${sessionId}`;
}

function readError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? fallback);
  }

  return fallback;
}
