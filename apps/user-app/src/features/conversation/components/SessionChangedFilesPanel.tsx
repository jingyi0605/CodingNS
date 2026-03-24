import { useEffect, useState, type ReactNode } from "react";

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

interface SessionChangedFilesPanelProps {
  sessionId: string;
  workspaceId: string;
  selectedPath: string | null;
  refreshVersion: number;
  onCountChange?: (count: number) => void;
  onSelectFile: (filePath: string) => Promise<void>;
  onOpenFile: (filePath: string) => Promise<void>;
}

type SessionViewMode = "tree" | "list";

export function SessionChangedFilesPanel({
  sessionId,
  workspaceId,
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
  const { showToast } = useToast();

  useEffect(() => {
    setViewMode("tree");
    setChanges([]);
    setLoading(true);
    setStaging(false);
    setCollapsedPaths([]);
  }, [sessionId, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      try {
        const nextChanges = await loadSessionChangedGitFiles(sessionId, workspaceId);

        if (!cancelled) {
          setChanges(nextChanges);
          onCountChange?.(nextChanges.length);
        }
      } catch (error) {
        if (!cancelled) {
          onCountChange?.(0);
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
  }, [onCountChange, refreshVersion, sessionId, showToast, workspaceId]);

  const unstagedChanges = changes.filter((item) => !item.staged);
  const tree = buildSessionChangeTree(changes);
  const collapsedPathSet = new Set(collapsedPaths);

  async function handleRefresh() {
    setLoading(true);

    try {
      const nextChanges = await loadSessionChangedGitFiles(sessionId, workspaceId);
      setChanges(nextChanges);
      onCountChange?.(nextChanges.length);
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
      onCountChange?.(nextChanges.length);
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
        <span>{`${t("conversation.filePanelSessionSummary")} ${changes.length}`}</span>
        <span>{`${t("conversation.filePanelSessionUnstagedSummary")} ${unstagedChanges.length}`}</span>
      </div>

      <div className="file-tree">
        {loading ? (
          <p className="file-tree-status status-text">{t("conversation.filePanelSessionLoading")}</p>
        ) : changes.length === 0 ? (
          <p className="file-tree-status status-text">{t("conversation.filePanelSessionEmpty")}</p>
        ) : viewMode === "tree" ? (
          renderTree({
            nodes: tree,
            depth: 0,
            collapsedPathSet,
            selectedPath,
            onToggleTreePath: toggleTreePath,
            onSelectFile,
            onOpenFile
          })
        ) : (
          renderList({
            items: changes,
            selectedPath,
            onSelectFile,
            onOpenFile
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
  onSelectFile,
  onOpenFile
}: {
  nodes: SessionChangeTreeNode[];
  depth: number;
  collapsedPathSet: ReadonlySet<string>;
  selectedPath: string | null;
  onToggleTreePath: (path: string) => void;
  onSelectFile: (filePath: string) => Promise<void>;
  onOpenFile: (filePath: string) => Promise<void>;
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
            style={{ paddingInlineStart: `${12 + depth * 16}px` }}
            onClick={() => onToggleTreePath(node.path)}
          >
            <span className="file-tree-chevron" aria-hidden="true">
              {expanded ? "v" : ">"}
            </span>
            <span className="file-tree-icon is-directory" data-expanded={expanded} aria-hidden="true" />
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
                onSelectFile,
                onOpenFile
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
          style={{ paddingInlineStart: `${12 + depth * 16}px` }}
          onClick={() => void onSelectFile(node.change.path)}
          onDoubleClick={() => {
            if (isDeletedGitChange(node.change)) {
              return;
            }

            void onOpenFile(node.change.path);
          }}
        >
          <span className="file-tree-chevron is-hidden" aria-hidden="true">
            &gt;
          </span>
          <span className="file-tree-icon is-file" aria-hidden="true" />
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
  onSelectFile,
  onOpenFile
}: {
  items: GitChangeItemDto[];
  selectedPath: string | null;
  onSelectFile: (filePath: string) => Promise<void>;
  onOpenFile: (filePath: string) => Promise<void>;
}) {
  return items.map((item) => (
    <div key={`session-list:${item.path}`} className="file-session-list-item">
      <button
        className="file-session-list-button"
        type="button"
        data-active={selectedPath === item.path}
        onClick={() => void onSelectFile(item.path)}
        onDoubleClick={() => {
          if (isDeletedGitChange(item)) {
            return;
          }

          void onOpenFile(item.path);
        }}
      >
        <span className="file-tree-icon is-file" aria-hidden="true" />
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

function readError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? fallback);
  }

  return fallback;
}
