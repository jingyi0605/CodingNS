import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

import { t } from "../../../shared/i18n";
import type {
  AssistantAutomationRunDto,
  AssistantAutomationTaskDto,
  ButlerFollowUpTaskDto,
  ButlerInboxItemDto
} from "../../butler/api/butler-api";
import {
  listAssistantAutomations,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listRecentAssistantAutomationRuns
} from "../../butler/api/butler-api";
import { ButlerRuntimeStore, useButlerRuntimeStore } from "../../butler/runtime/butler-runtime-store";
import { ComposerPanel } from "../../conversation/components/ComposerPanel";
import { FileViewerPanel } from "../../conversation/components/FileViewerModal";
import { MessageTimeline } from "../../conversation/components/MessageTimeline";
import { PermissionRequestList } from "../../conversation/components/PermissionRequestList";
import { buildConversationTimelineSourceItems } from "../../conversation/timeline-source-items";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";
import type {
  AffairsAuxiliaryTab,
  AffairsObjectContext,
  AffairsPrimarySection,
  AffairsViewState
} from "../types/workbench-mode";

interface AffairsWorkbenchProviderProps {
  workspaceId: string;
  workspaceName: string | null;
  navigationGroups: WorkspaceSessionGroup[];
  state: AffairsViewState;
  onStateChange: (nextState: AffairsViewState) => void;
  children: ReactNode;
}

interface AffairsWorkbenchViewProps {
  workspaceId: string;
}

interface AffairsAuxiliaryPanelProps {
  workspaceId: string;
  onToggleCollapse?: () => void;
}

type AffairsSidebarNode = {
  id: string;
  label: string;
  summary?: string;
  count?: number;
  tone?: "default" | "favorite" | "tag" | "source" | "automation";
  sectionLabel?: string;
};

type DocumentRecord = {
  id: string;
  title: string;
  filePath: string;
  fullPath: string | null;
  summary: string;
  isFavorite: boolean;
  tags: string[];
  updatedAt: string;
  sourceSessionId: string;
};

type TagRecord = {
  id: string;
  label: string;
  count: number;
};

type TodoRecord = {
  id: string;
  kind: "inbox" | "follow_up";
  title: string;
  summary: string;
  statusLabel: string;
  detail: string;
  sourceSessionId: string | null;
  updatedAt: string;
  sourceLabel: string;
  sourceDescription: string;
};

type AutomationRecord = {
  id: string;
  title: string;
  summary: string;
  statusLabel: string;
  triggerLabel: string;
  targetSessionLabel: string;
  updatedAt: string;
  lastRunSummary: string | null;
  lastRunStatusLabel: string | null;
};

type AffairsSelectedObject =
  | {
      section: "library";
      record: DocumentRecord | null;
    }
  | {
      section: "todo";
      record: TodoRecord | null;
    }
  | {
      section: "automation";
      record: AutomationRecord | null;
    };

interface AffairsWorkbenchContextValue {
  workspaceId: string;
  workspaceName: string | null;
  state: AffairsViewState;
  activeSection: AffairsPrimarySection;
  loading: boolean;
  error: string | null;
  documentRecords: DocumentRecord[];
  filteredDocuments: DocumentRecord[];
  favoriteDocuments: DocumentRecord[];
  tagRecords: TagRecord[];
  todoRecords: TodoRecord[];
  filteredTodoRecords: TodoRecord[];
  automationRecords: AutomationRecord[];
  selectedObject: AffairsSelectedObject;
  assistantContext: AffairsObjectContext | null;
  automationRuns: AssistantAutomationRunDto[];
  sidebarNodes: AffairsSidebarNode[];
  auxiliaryTab: AffairsAuxiliaryTab;
  toolbarExpanded: boolean;
  selectSection: (section: AffairsPrimarySection) => void;
  selectSidebarNode: (nodeId: string) => void;
  selectObject: (objectId: string | null) => void;
  selectAuxiliaryTab: (tab: AffairsAuxiliaryTab) => void;
  toggleToolbarExpanded: () => void;
}

const AffairsWorkbenchContext = createContext<AffairsWorkbenchContextValue | null>(null);

export function AffairsWorkbenchProvider({
  workspaceId,
  workspaceName,
  navigationGroups,
  state,
  onStateChange,
  children
}: AffairsWorkbenchProviderProps) {
  const workspaceGroup = useMemo(
    () => navigationGroups.find((item) => item.workspace.id === workspaceId) ?? null,
    [navigationGroups, workspaceId]
  );
  const workspaceSessions = workspaceGroup?.sessions ?? [];
  const workspaceSessionIdSet = useMemo(
    () => new Set(workspaceSessions.map((session) => session.sessionId)),
    [workspaceSessions]
  );
  const sessionTitleById = useMemo(
    () => Object.fromEntries(workspaceSessions.map((session) => [session.sessionId, session.title?.trim() || session.sessionId])),
    [workspaceSessions]
  );
  const documentRecords = useMemo(
    () => buildDocumentRecords(workspaceSessions, workspaceGroup?.workspace.path ?? null),
    [workspaceGroup?.workspace.path, workspaceSessions]
  );
  const favoriteDocuments = useMemo(
    () => documentRecords.filter((record) => record.isFavorite),
    [documentRecords]
  );
  const tagRecords = useMemo(() => buildTagRecords(documentRecords), [documentRecords]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inboxItems, setInboxItems] = useState<ButlerInboxItemDto[]>([]);
  const [followUpTasks, setFollowUpTasks] = useState<ButlerFollowUpTaskDto[]>([]);
  const [automations, setAutomations] = useState<AssistantAutomationTaskDto[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AssistantAutomationRunDto[]>([]);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);

    void Promise.all([
      listButlerInboxItems({ workspaceId }),
      listButlerFollowUpTasks(),
      listAssistantAutomations({ limit: 200 }),
      listRecentAssistantAutomationRuns({ limit: 200 })
    ])
      .then(([inboxResponse, followUpResponse, automationResponse, automationRunResponse]) => {
        if (disposed) {
          return;
        }

        setInboxItems(inboxResponse.items.filter((item) => item.workspaceId === workspaceId));
        setFollowUpTasks(followUpResponse.items.filter((item) => item.workspaceId === workspaceId));
        setAutomations(
          automationResponse.payload.items.filter((item) => {
            const targetSessionId = item.actionConfig.targetSessionId?.trim() ?? "";
            const controlSessionId = item.controlSession?.sessionId?.trim() ?? "";
            return (
              workspaceSessionIdSet.size === 0
              || workspaceSessionIdSet.has(targetSessionId)
              || workspaceSessionIdSet.has(controlSessionId)
            );
          })
        );
        setAutomationRuns(automationRunResponse.payload.items);
        setLoading(false);
      })
      .catch((requestError) => {
        if (disposed) {
          return;
        }

        setError(requestError instanceof Error ? requestError.message : t("shell.navigationLoadFailed"));
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [workspaceId, workspaceSessionIdSet]);

  const activeSection = normalizeSection(state.primarySection);
  const filteredDocuments = useMemo(() => {
    if (activeSection !== "library") {
      return [];
    }

    if (!state.selectedNodeId || state.selectedNodeId === "library:all") {
      return documentRecords;
    }

    if (state.selectedNodeId === "library:favorites") {
      return favoriteDocuments;
    }

    if (state.selectedNodeId?.startsWith("library:tag:")) {
      const tagId = state.selectedNodeId.slice("library:tag:".length);
      return documentRecords.filter((record) => record.tags.includes(tagId));
    }

    if (state.selectedNodeId?.startsWith("library:favorite:")) {
      const favoriteId = state.selectedNodeId.slice("library:favorite:".length);
      return documentRecords.filter((record) => record.id === favoriteId);
    }

    return documentRecords;
  }, [activeSection, documentRecords, favoriteDocuments, state.selectedNodeId]);
  const todoRecords = useMemo(() => buildTodoRecords(inboxItems, followUpTasks), [followUpTasks, inboxItems]);
  const filteredTodoRecords = useMemo(() => {
    if (activeSection !== "todo") {
      return [];
    }

    if (!state.selectedNodeId || state.selectedNodeId === "todo:all") {
      return todoRecords;
    }

    if (state.selectedNodeId === "todo:inbox") {
      return todoRecords.filter((item) => item.kind === "inbox");
    }

    if (state.selectedNodeId === "todo:follow_up") {
      return todoRecords.filter((item) => item.kind === "follow_up");
    }

    return todoRecords;
  }, [activeSection, state.selectedNodeId, todoRecords]);
  const automationRecords = useMemo(
    () => buildAutomationRecords(automations, sessionTitleById),
    [automations, sessionTitleById]
  );

  const selectedObject = useMemo<AffairsSelectedObject>(() => {
    if (activeSection === "library") {
      const record = filteredDocuments.find((item) => item.id === state.selectedObjectId) ?? filteredDocuments[0] ?? null;
      return {
        section: "library",
        record
      };
    }

    if (activeSection === "todo") {
      const record = filteredTodoRecords.find((item) => item.id === state.selectedObjectId) ?? filteredTodoRecords[0] ?? null;
      return {
        section: "todo",
        record
      };
    }

    const record = automationRecords.find((item) => item.id === state.selectedObjectId) ?? automationRecords[0] ?? null;
    return {
      section: "automation",
      record
    };
  }, [activeSection, automationRecords, filteredDocuments, filteredTodoRecords, state.selectedObjectId]);

  useEffect(() => {
    const selectedId = selectedObject.record?.id ?? null;
    const defaultNodeId = resolveDefaultNodeId(activeSection, favoriteDocuments, automationRecords);

    if (state.primarySection === activeSection && state.selectedObjectId === selectedId && state.selectedNodeId) {
      return;
    }

    onStateChange({
      ...state,
      primarySection: activeSection,
      selectedNodeId: state.selectedNodeId ?? defaultNodeId,
      selectedObjectId: selectedId
    });
  }, [activeSection, automationRecords, favoriteDocuments, onStateChange, selectedObject.record, state]);

  const assistantContext = useMemo<AffairsObjectContext | null>(() => {
    if (selectedObject.section === "library") {
      const record = selectedObject.record;
      return record
        ? {
            objectType: "document",
            objectId: record.id,
            title: record.title,
            summary: record.summary,
            sourceRef: record.filePath,
            assistantScope: `workspace:${workspaceId}:document:${record.id}`
          }
        : null;
    }

    if (selectedObject.section === "todo") {
      const record = selectedObject.record;
      return record
        ? {
            objectType: "todo",
            objectId: record.id,
            title: record.title,
            summary: `${record.statusLabel} · ${record.summary}`,
            sourceRef: record.sourceSessionId,
            assistantScope: `workspace:${workspaceId}:todo:${record.id}`
          }
        : null;
    }

    const record = selectedObject.record;
    return record
      ? {
          objectType: "automation",
          objectId: record.id,
          title: record.title,
          summary: `${record.statusLabel} · ${record.summary}`,
          sourceRef: record.targetSessionLabel,
          assistantScope: `workspace:${workspaceId}:automation:${record.id}`
        }
      : null;
  }, [selectedObject, workspaceId]);

  const sidebarNodes = useMemo<AffairsSidebarNode[]>(() => {
    if (activeSection === "library") {
      return [
        {
          id: "library:all",
          label: t("shell.affairsLibraryAllFilter"),
          count: documentRecords.length,
          summary: t("shell.affairsLibraryAllFilterSummary"),
          tone: "default"
        },
        {
          id: "library:favorites",
          label: t("shell.affairsLibraryFavoritesEntry"),
          count: favoriteDocuments.length,
          summary: t("shell.affairsLibraryFavoritesSummary"),
          tone: "favorite"
        },
        ...favoriteDocuments.slice(0, 8).map<AffairsSidebarNode>((record) => ({
          id: `library:favorite:${record.id}`,
          label: record.title,
          summary: record.filePath,
          tone: "favorite"
        })),
        ...tagRecords.map<AffairsSidebarNode>((tag) => ({
          id: `library:tag:${tag.id}`,
          label: tag.label,
          count: tag.count,
          summary: t("shell.affairsLibraryTagSummary"),
          tone: "tag"
        }))
      ];
    }

    if (activeSection === "todo") {
      return [
        {
          id: "todo:all",
          label: t("shell.affairsTodoAllFilter"),
          count: todoRecords.length,
          summary: t("shell.affairsTodoAllFilterSummary"),
          tone: "default"
        },
        {
          id: "todo:inbox",
          label: t("shell.affairsTodoInboxFilter"),
          count: todoRecords.filter((item) => item.kind === "inbox").length,
          summary: t("shell.affairsTodoInboxSummary"),
          tone: "source"
        },
        {
          id: "todo:follow_up",
          label: t("shell.affairsTodoFollowUpFilter"),
          count: todoRecords.filter((item) => item.kind === "follow_up").length,
          summary: t("shell.affairsTodoFollowUpSummary"),
          tone: "source"
        }
      ];
    }

    return automationRecords.map<AffairsSidebarNode>((record) => ({
      id: `automation:item:${record.id}`,
      label: record.title,
      summary: `${record.triggerLabel} · ${record.statusLabel}`,
      tone: "automation"
    }));
  }, [activeSection, automationRecords, documentRecords.length, favoriteDocuments, tagRecords, todoRecords]);

  const contextValue = useMemo<AffairsWorkbenchContextValue>(() => ({
    workspaceId,
    workspaceName,
    state,
    activeSection,
    loading,
    error,
    documentRecords,
    filteredDocuments,
    favoriteDocuments,
    tagRecords,
    todoRecords,
    filteredTodoRecords,
    automationRecords,
    selectedObject,
    assistantContext,
    automationRuns,
    sidebarNodes,
    auxiliaryTab: state.auxiliaryTab ?? "detail",
    toolbarExpanded: state.toolbarExpanded,
    selectSection: (section) => {
      onStateChange({
        ...state,
        primarySection: section,
        selectedNodeId: resolveDefaultNodeId(section, favoriteDocuments, automationRecords),
        selectedObjectId: null
      });
    },
    selectSidebarNode: (nodeId) => {
      onStateChange({
        ...state,
        selectedNodeId: nodeId,
        selectedObjectId: null
      });
    },
    selectObject: (objectId) => {
      onStateChange({
        ...state,
        selectedObjectId: objectId
      });
    },
    selectAuxiliaryTab: (tab) => {
      onStateChange({
        ...state,
        auxiliaryTab: tab
      });
    },
    toggleToolbarExpanded: () => {
      onStateChange({
        ...state,
        toolbarExpanded: !state.toolbarExpanded
      });
    }
  }), [
    activeSection,
    assistantContext,
    automationRecords,
    automationRuns,
    documentRecords,
    error,
    favoriteDocuments,
    filteredDocuments,
    filteredTodoRecords,
    loading,
    onStateChange,
    selectedObject,
    sidebarNodes,
    state,
    tagRecords,
    todoRecords,
    workspaceId,
    workspaceName
  ]);

  return <AffairsWorkbenchContext.Provider value={contextValue}>{children}</AffairsWorkbenchContext.Provider>;
}

export function AffairsSectionMenu() {
  const { activeSection, selectSection } = useAffairsWorkbenchInternal();

  return (
    <div className="workbench-nav-code-entries" role="tablist" aria-label={t("shell.affairsSidebarMenuLabel")}>
      <button
        type="button"
        className={activeSection === "library" ? "workbench-nav-segment-button active" : "workbench-nav-segment-button"}
        role="tab"
        aria-selected={activeSection === "library"}
        onClick={() => selectSection("library")}
      >
        <AffairsLibraryIcon />
        <span>{t("shell.affairsLibraryNav")}</span>
      </button>
      <button
        type="button"
        className={activeSection === "todo" ? "workbench-nav-segment-button active" : "workbench-nav-segment-button"}
        role="tab"
        aria-selected={activeSection === "todo"}
        onClick={() => selectSection("todo")}
      >
        <AffairsTodoIcon />
        <span>{t("shell.affairsTodoNav")}</span>
      </button>
      <button
        type="button"
        className={activeSection === "automation" ? "workbench-nav-segment-button active" : "workbench-nav-segment-button"}
        role="tab"
        aria-selected={activeSection === "automation"}
        onClick={() => selectSection("automation")}
      >
        <AffairsAutomationIcon />
        <span>{t("shell.affairsAutomationNav")}</span>
      </button>
    </div>
  );
}

export function AffairsSidebarPanel() {
  const {
    activeSection,
    documentRecords,
    favoriteDocuments,
    sidebarNodes,
    state,
    tagRecords,
    todoRecords,
    automationRecords,
    selectSidebarNode,
    loading,
    error
  } = useAffairsWorkbenchInternal();
  const groupedSidebarNodes = useMemo(() => groupSidebarNodes(activeSection, sidebarNodes), [activeSection, sidebarNodes]);

  return (
    <section className="workbench-section-block affairs-sidebar-block">
      {loading ? <div className="affairs-sidebar-empty">{t("common.loading")}</div> : null}
      {error ? <div className="affairs-sidebar-empty">{error}</div> : null}
      {!loading && !error ? (
        <div className="affairs-sidebar-groups" role="list">
          {sidebarNodes.length === 0 ? (
            <div className="affairs-sidebar-empty">{resolveSectionEmptyText(activeSection)}</div>
          ) : (
            groupedSidebarNodes.map((group) => (
              <section key={group.id} className="affairs-sidebar-group">
                <header className="affairs-sidebar-group-header">
                  <span>{group.label}</span>
                  <span>{group.items.length}</span>
                </header>
                <div className="affairs-sidebar-list" role="list">
                  {group.items.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className={node.id === state.selectedNodeId ? "affairs-sidebar-item active" : "affairs-sidebar-item"}
                      data-tone={node.tone ?? "default"}
                      onClick={() => selectSidebarNode(node.id)}
                    >
                      <div className="affairs-sidebar-item-row">
                        <span className="affairs-sidebar-item-title">{node.label}</span>
                        {typeof node.count === "number" ? <span className="affairs-sidebar-item-badge">{node.count}</span> : null}
                      </div>
                      {node.summary ? <span className="affairs-sidebar-item-summary">{node.summary}</span> : null}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

export function AffairsWorkbenchView({ workspaceId }: AffairsWorkbenchViewProps) {
  const {
    activeSection,
    filteredDocuments,
    filteredTodoRecords,
    automationRecords,
    loading,
    error,
    selectedObject,
    sidebarNodes,
    state,
    toggleToolbarExpanded,
    selectObject,
    workspaceName
  } = useAffairsWorkbenchInternal();

  const mainCount =
    activeSection === "library"
      ? filteredDocuments.length
      : activeSection === "todo"
        ? filteredTodoRecords.length
        : automationRecords.length;

  return (
    <div className="affairs-main-panel">
      <section className="surface-card affairs-toolbar-tray">
        <div className="affairs-toolbar-main">
          <div>
            <h1>{resolveAffairsSectionTitle(activeSection)}</h1>
            <p>{resolveAffairsSectionSummary(activeSection)}</p>
          </div>
          <div className="affairs-toolbar-actions">
            <span className="affairs-toolbar-count-pill">{t("shell.affairsToolbarCount", { count: mainCount })}</span>
            <button type="button" className="secondary-button" onClick={toggleToolbarExpanded}>
              {state.toolbarExpanded ? t("shell.affairsToolbarCollapse") : t("shell.affairsToolbarExpand")}
            </button>
          </div>
        </div>
        {state.toolbarExpanded ? (
          <div className="affairs-toolbar-secondary">
            <span>{t("shell.affairsToolbarSummary", {
              workspaceName: workspaceName ?? t("common.unknown"),
              count: mainCount
            })}</span>
          </div>
        ) : null}
      </section>

      <section className="surface-card affairs-stage-panel">
        <header className="affairs-stage-header">
          <div>
            <h2>{resolveStageTitle(activeSection)}</h2>
            <p>{resolveStageDescription(activeSection, sidebarNodes.length)}</p>
          </div>
          <span className="workbench-section-counter">{mainCount}</span>
        </header>

        {loading ? <div className="affairs-stage-empty">{t("common.loading")}</div> : null}
        {error ? <div className="affairs-stage-empty">{error}</div> : null}
        {!loading && !error ? (
          activeSection === "library" ? (
            filteredDocuments.length === 0 ? (
              <div className="affairs-stage-empty">{t("shell.affairsLibraryEmpty")}</div>
            ) : (
              <div className="affairs-stage-list">
                {filteredDocuments.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    className={selectedObject.section === "library" && selectedObject.record?.id === record.id ? "affairs-stage-item active" : "affairs-stage-item"}
                    onClick={() => selectObject(record.id)}
                  >
                    <div className="affairs-stage-item-row">
                      <span className="affairs-stage-item-title">{record.title}</span>
                      {record.isFavorite ? <span className="affairs-inline-pill">{t("shell.affairsFavoriteBadge")}</span> : null}
                    </div>
                    <span className="affairs-stage-item-summary">{record.summary}</span>
                    <span className="affairs-stage-item-meta">{record.filePath}</span>
                  </button>
                ))}
              </div>
            )
          ) : activeSection === "todo" ? (
            filteredTodoRecords.length === 0 ? (
              <div className="affairs-stage-empty">{t("shell.affairsTodoEmpty")}</div>
            ) : (
              <div className="affairs-stage-list">
                {filteredTodoRecords.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    className={selectedObject.section === "todo" && selectedObject.record?.id === record.id ? "affairs-stage-item active" : "affairs-stage-item"}
                    onClick={() => selectObject(record.id)}
                  >
                    <div className="affairs-stage-item-row">
                      <span className="affairs-stage-item-title">{record.title}</span>
                      <span className="affairs-inline-pill">{record.sourceLabel}</span>
                    </div>
                    <span className="affairs-stage-item-summary">{record.summary}</span>
                    <span className="affairs-stage-item-meta">{record.statusLabel} · {record.sourceDescription} · {formatRelativeMeta(record.updatedAt)}</span>
                  </button>
                ))}
              </div>
            )
          ) : automationRecords.length === 0 ? (
            <div className="affairs-stage-empty">{t("shell.affairsAutomationEmpty")}</div>
          ) : (
            <div className="affairs-stage-list">
              {automationRecords.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  className={selectedObject.section === "automation" && selectedObject.record?.id === record.id ? "affairs-stage-item active" : "affairs-stage-item"}
                  onClick={() => selectObject(record.id)}
                >
                  <div className="affairs-stage-item-row">
                    <span className="affairs-stage-item-title">{record.title}</span>
                    <span className="affairs-inline-pill">{record.statusLabel}</span>
                  </div>
                  <span className="affairs-stage-item-summary">{record.summary}</span>
                  <span className="affairs-stage-item-meta">{record.triggerLabel} · {record.targetSessionLabel}</span>
                  {record.lastRunSummary ? <span className="affairs-stage-item-meta subtle">{t("shell.affairsAutomationLastRunSummary", { summary: record.lastRunSummary })}</span> : null}
                </button>
              ))}
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}

export function AffairsAuxiliaryPanel({ workspaceId, onToggleCollapse }: AffairsAuxiliaryPanelProps) {
  const {
    activeSection,
    assistantContext,
    auxiliaryTab,
    automationRuns,
    filteredTodoRecords,
    selectAuxiliaryTab,
    selectedObject
  } = useAffairsWorkbenchInternal();

  const selectedAutomationRuns = useMemo(() => {
    if (selectedObject.section !== "automation" || !selectedObject.record) {
      return [];
    }

    return automationRuns
      .filter((run) => run.automationId === selectedObject.record?.id)
      .slice(0, 12);
  }, [automationRuns, selectedObject]);

  return (
    <div className="affairs-auxiliary-shell">
      <div className="workbench-auxiliary-header">
        {onToggleCollapse ? (
          <button
            type="button"
            className="workbench-nav-toolbar-button"
            aria-label={t("shell.hideInfoSidebar")}
            title={t("shell.hideInfoSidebar")}
            onClick={onToggleCollapse}
          >
            <span aria-hidden="true">→</span>
          </button>
        ) : null}
        <div className="workbench-info-tabs" role="tablist" aria-label={t("shell.affairsAuxiliaryTabsLabel")}>
          <button
            type="button"
            role="tab"
            aria-selected={auxiliaryTab === "detail"}
            className={auxiliaryTab === "detail" ? "workbench-info-tab active" : "workbench-info-tab"}
            onClick={() => selectAuxiliaryTab("detail")}
          >
            {t("shell.affairsDetailTitle")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={auxiliaryTab === "assistant"}
            className={auxiliaryTab === "assistant" ? "workbench-info-tab active" : "workbench-info-tab"}
            onClick={() => selectAuxiliaryTab("assistant")}
          >
            {t("shell.affairsAssistantTitle")}
          </button>
        </div>
      </div>

      <div className="workbench-auxiliary-body" data-scrollbar-autohide="true">
        {auxiliaryTab === "detail" ? (
          selectedObject.section === "library" ? (
            selectedObject.record ? (
              <div className="affairs-detail-panel">
                <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
                  <div className="affairs-detail-headline">
                    <div>
                      <h2>{selectedObject.record.title}</h2>
                      <p>{selectedObject.record.summary}</p>
                    </div>
                    <span className="affairs-inline-pill">{t("shell.affairsLibraryNav")}</span>
                  </div>
                  <dl className="affairs-detail-meta-list">
                    <div>
                      <dt>{t("shell.affairsDetailMetaPath")}</dt>
                      <dd>{selectedObject.record.filePath}</dd>
                    </div>
                    <div>
                      <dt>{t("shell.affairsDetailMetaTags")}</dt>
                      <dd>{selectedObject.record.tags.join(" · ") || t("common.none")}</dd>
                    </div>
                  </dl>
                </section>
                <div className="affairs-detail-viewer-shell">
                  <FileViewerPanel
                    workspaceId={workspaceId}
                    filePath={selectedObject.record.filePath}
                    open={true}
                    chrome="window"
                    windowTitle={selectedObject.record.title}
                    onClose={() => undefined}
                    onSaved={() => undefined}
                  />
                </div>
              </div>
            ) : (
              <div className="affairs-stage-empty">{t("shell.affairsDetailEmpty")}</div>
            )
          ) : selectedObject.section === "todo" ? (
            selectedObject.record ? (
              <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
                <div className="affairs-detail-headline">
                  <div>
                    <h2>{selectedObject.record.title}</h2>
                    <p>{selectedObject.record.summary}</p>
                  </div>
                  <span className="affairs-inline-pill">{selectedObject.record.sourceLabel}</span>
                </div>
                <dl className="affairs-detail-meta-list">
                  <div>
                    <dt>{t("shell.affairsTodoDetailStatus")}</dt>
                    <dd>{selectedObject.record.statusLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsTodoDetailSource")}</dt>
                    <dd>{selectedObject.record.sourceDescription}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsTodoDetailNotes")}</dt>
                    <dd>{selectedObject.record.detail}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsTodoDetailTotal")}</dt>
                    <dd>{t("shell.affairsTodoDetailTotalValue", { count: filteredTodoRecords.length })}</dd>
                  </div>
                </dl>
              </section>
            ) : (
              <div className="affairs-stage-empty">{t("shell.affairsTodoEmpty")}</div>
            )
          ) : selectedObject.record ? (
            <div className="affairs-detail-panel">
              <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
                <div className="affairs-detail-headline">
                  <div>
                    <h2>{selectedObject.record.title}</h2>
                    <p>{selectedObject.record.summary}</p>
                  </div>
                  <span className="affairs-inline-pill">{selectedObject.record.statusLabel}</span>
                </div>
                <dl className="affairs-detail-meta-list">
                  <div>
                    <dt>{t("shell.affairsAutomationDetailTrigger")}</dt>
                    <dd>{selectedObject.record.triggerLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsAutomationDetailTarget")}</dt>
                    <dd>{selectedObject.record.targetSessionLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsAutomationDetailStatus")}</dt>
                    <dd>{selectedObject.record.statusLabel}</dd>
                  </div>
                </dl>
              </section>
              <section className="workbench-section-block affairs-detail-block">
                <div className="affairs-detail-headline compact">
                  <h3>{t("shell.affairsAutomationRunsTitle")}</h3>
                  <p>{t("shell.affairsAutomationRunsDescription")}</p>
                </div>
                {selectedAutomationRuns.length === 0 ? (
                  <div className="affairs-stage-empty compact">{t("shell.affairsAutomationRunsEmpty")}</div>
                ) : (
                  <div className="affairs-run-list">
                    {selectedAutomationRuns.map((run) => (
                      <div key={run.id} className="affairs-run-item">
                        <div className="affairs-run-item-row">
                          <strong>{resolveAutomationRunStatusLabel(run.status)}</strong>
                          <span className="affairs-run-item-time">{formatRelativeMeta(run.finishedAt || run.startedAt || run.createdAt)}</span>
                        </div>
                        <span>{run.summary?.trim() || run.error?.trim() || t("shell.affairsAutomationRunsFallback")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="affairs-stage-empty">{t("shell.affairsAutomationEmpty")}</div>
          )
        ) : (
          <UniversalAssistantBridge workspaceId={workspaceId} context={assistantContext} />
        )}
      </div>
    </div>
  );
}

function UniversalAssistantBridge({
  workspaceId,
  context
}: {
  workspaceId: string;
  context: AffairsObjectContext | null;
}) {
  const [store] = useState(() => new ButlerRuntimeStore(workspaceId));
  const initialized = useButlerRuntimeStore(store, (value) => value.initialized);
  const loading = useButlerRuntimeStore(store, (value) => value.loading);
  const profile = useButlerRuntimeStore(store, (value) => value.profile);
  const activeProvider = useButlerRuntimeStore(store, (value) => value.activeProvider);
  const controlSession = useButlerRuntimeStore(store, (value) => value.controlSession);
  const capabilities = useButlerRuntimeStore(store, (value) => value.capabilities);
  const messages = useButlerRuntimeStore(store, (value) => value.messages);
  const historyState = useButlerRuntimeStore(store, (value) => value.historyState);
  const loadingOlderMessages = useButlerRuntimeStore(store, (value) => value.loadingOlderMessages);
  const hasOlderMessages = useButlerRuntimeStore(store, (value) => value.hasOlderMessages);
  const runtimeHasActiveRun = useButlerRuntimeStore(store, (value) => value.runtimeHasActiveRun);
  const runtimeCanInterrupt = useButlerRuntimeStore(store, (value) => value.runtimeCanInterrupt);
  const contextUsage = useButlerRuntimeStore(store, (value) => value.contextUsage);
  const permissionRequests = useButlerRuntimeStore(store, (value) => value.permissionRequests);
  const sending = useButlerRuntimeStore(store, (value) => value.sending);
  const [replyingPermissionRequestId, setReplyingPermissionRequestId] = useState<string | null>(null);

  useEffect(() => {
    void store.initialize();
  }, [store]);

  const placeholder = context
    ? t("shell.affairsAssistantPlaceholder", { title: context.title ?? t("common.unknown") })
    : t("shell.affairsAssistantPlaceholderEmpty");

  return (
    <section className="affairs-assistant-panel">
      {context ? (
        <section className="workbench-section-block affairs-detail-block affairs-assistant-context-block">
          <div className="affairs-detail-headline compact">
            <h3>{context.title}</h3>
            <p>{context.summary || t("shell.affairsAssistantContextFallback")}</p>
          </div>
        </section>
      ) : null}
      <PermissionRequestList
        requests={permissionRequests}
        replyingRequestId={replyingPermissionRequestId}
        onReply={async (requestId, payload) => {
          setReplyingPermissionRequestId(requestId);
          try {
            await store.replyPermissionRequest(requestId, payload);
          } finally {
            setReplyingPermissionRequestId(null);
          }
        }}
      />
      <div className="affairs-assistant-timeline">
        <MessageTimeline
          sessionId={controlSession?.session?.sessionId}
          items={buildConversationTimelineSourceItems({ messages })}
          historyState={historyState}
          loadingOlderMessages={loadingOlderMessages}
          hasOlderMessages={hasOlderMessages}
          provider={activeProvider}
          onLoadOlderMessages={() => {
            void store.loadOlderMessages();
          }}
          onRetryMessage={(clientRequestId) => {
            void store.retryMessage(clientRequestId);
          }}
        />
      </div>
      <div className="affairs-assistant-composer">
        <ComposerPanel
          capabilities={capabilities}
          draftStorageId={`affairs-assistant:${workspaceId}:${context?.objectId ?? "empty"}`}
          placeholder={placeholder}
          hasActiveRun={Boolean(runtimeHasActiveRun) || sending}
          canInterrupt={runtimeCanInterrupt ?? false}
          contextUsage={contextUsage}
          isSubmitting={sending || loading || !initialized}
          isRunning={Boolean(runtimeHasActiveRun) || sending}
          onInterrupt={async () => {
            await store.interrupt();
          }}
          onSend={async (content, options) => {
            await store.sendMessage(`${buildAffairsAssistantPrefix(context)}${content}`, {
              model: options?.model ?? null,
              reasoningLevel: options?.reasoningLevel ?? null,
              permissionMode: null
            });
          }}
        />
      </div>
      <div className="affairs-assistant-footer">{profile?.displayName?.trim() || t("shell.butlerEntry")}</div>
    </section>
  );
}

function AffairsLibraryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v8A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z" />
      <path d="M4 9h16" />
    </svg>
  );
}

function AffairsTodoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <path d="m8.5 11 2 2 5-5" />
    </svg>
  );
}

function AffairsAutomationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M4.93 4.93l2.83 2.83" />
      <path d="M16.24 16.24l2.83 2.83" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="M4.93 19.07l2.83-2.83" />
      <path d="M16.24 7.76l2.83-2.83" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

function useAffairsWorkbenchInternal() {
  const context = useContext(AffairsWorkbenchContext);

  if (!context) {
    throw new Error("AffairsWorkbench components must be used inside AffairsWorkbenchProvider");
  }

  return {
    ...context,
    automationRecords: context.automationRecords
  };
}

function buildDocumentRecords(
  sessions: WorkspaceSessionGroup["sessions"],
  workspacePath: string | null
): DocumentRecord[] {
  return [...sessions]
    .sort((left, right) => (right.lastMessageAt ?? right.updatedAt).localeCompare(left.lastMessageAt ?? left.updatedAt))
    .map((session) => {
      const trimmedTitle = session.title?.trim() || session.sessionId;
      const relativePath = `${trimmedTitle.replace(/\s+/g, "-").toLowerCase()}.md`;
      const tags = extractDocumentTags(trimmedTitle, workspacePath);
      return {
        id: session.sessionId,
        title: trimmedTitle,
        filePath: relativePath,
        fullPath: workspacePath ? `${workspacePath}/${relativePath}` : null,
        summary: t("shell.affairsDocumentSummaryTemplate", {
          sessionTitle: trimmedTitle
        }),
        isFavorite: session.isFavorite === true,
        tags,
        updatedAt: session.lastMessageAt ?? session.updatedAt,
        sourceSessionId: session.sessionId
      };
    });
}

function buildTagRecords(documents: DocumentRecord[]): TagRecord[] {
  const counter = new Map<string, number>();

  for (const document of documents) {
    for (const tag of document.tags) {
      counter.set(tag, (counter.get(tag) ?? 0) + 1);
    }
  }

  return [...counter.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .slice(0, 12)
    .map(([label, count]) => ({
      id: label,
      label,
      count
    }));
}

function buildTodoRecords(inboxItems: ButlerInboxItemDto[], followUpTasks: ButlerFollowUpTaskDto[]): TodoRecord[] {
  const inboxRecords = inboxItems
    .filter((item) => item.status !== "closed")
    .map<TodoRecord>((item) => ({
      id: `inbox:${item.id}`,
      kind: "inbox",
      title: item.title,
      summary: item.content,
      statusLabel: resolveInboxStatusLabel(item.status),
      detail:
        item.assistantState.analysisSummary?.trim()
        || item.assistantState.generatedPrompt?.trim()
        || item.assistantState.lastError?.trim()
        || item.content,
      sourceSessionId: item.assistantState.linkedSessionId,
      updatedAt: item.updatedAt,
      sourceLabel: t("shell.affairsTodoInboxFilter"),
      sourceDescription: item.projectName?.trim() || t("common.unknown")
    }));
  const followUpRecords = followUpTasks
    .filter((item) => item.status === "active" || item.status === "waiting_user")
    .map<TodoRecord>((item) => ({
      id: `follow-up:${item.id}`,
      kind: "follow_up",
      title: item.sessionTitle?.trim() || item.projectName,
      summary: item.objective,
      statusLabel: resolveFollowUpStatusLabel(item.status),
      detail: item.waitingReason?.trim() || item.lastAutomationSummary?.trim() || item.objective,
      sourceSessionId: item.sessionId,
      updatedAt: item.updatedAt,
      sourceLabel: t("shell.affairsTodoFollowUpFilter"),
      sourceDescription: item.sessionTitle?.trim() || item.projectName
    }));

  return [...inboxRecords, ...followUpRecords].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function buildAutomationRecords(
  automations: AssistantAutomationTaskDto[],
  sessionTitleById: Record<string, string>
): AutomationRecord[] {
  return [...automations]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((automation) => ({
      id: automation.id,
      title: automation.title?.trim() || t("shell.affairsAutomationUntitled"),
      summary: automation.actionConfig.content.trim() || t("shell.affairsAutomationPromptFallback"),
      statusLabel: resolveAutomationStatusLabel(automation.status),
      triggerLabel: resolveAutomationTriggerLabel(automation.triggerType),
      targetSessionLabel: resolveAutomationTargetLabel(automation, sessionTitleById),
      updatedAt: automation.updatedAt,
      lastRunSummary: automation.lastRunSummary?.trim() || null,
      lastRunStatusLabel: automation.lastError?.trim() ? t("shell.affairsAutomationRunsStatusFailed") : automation.lastRunAt ? t("shell.affairsAutomationRunsStatusFinished") : null
    }));
}

function extractDocumentTags(title: string, workspacePath: string | null) {
  const raw = `${title} ${workspacePath ?? ""}`
    .split(/[\s/_-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  const normalized = [...new Set(raw)]
    .filter((item) => !/^\d+$/.test(item))
    .filter((item) => !["users", "jackson", "code", "codingns"].includes(item.toLowerCase()));
  return normalized.slice(0, 4);
}

function buildAffairsAssistantPrefix(context: AffairsObjectContext | null) {
  if (!context) {
    return `${t("shell.affairsAssistantPromptPreambleEmpty")}\n\n`;
  }

  return `${t("shell.affairsAssistantPromptPreamble", {
    title: context.title ?? t("common.unknown"),
    summary: context.summary ?? t("shell.affairsAssistantContextFallback"),
    sourceRef: context.sourceRef ?? t("common.unknown")
  })}\n\n`;
}

function resolveAffairsSectionTitle(section: AffairsPrimarySection) {
  switch (section) {
    case "todo":
      return t("shell.affairsTodoNav");
    case "automation":
      return t("shell.affairsAutomationNav");
    case "library":
    default:
      return t("shell.affairsLibraryTitle");
  }
}

function resolveAffairsSectionSummary(section: AffairsPrimarySection) {
  switch (section) {
    case "todo":
      return t("shell.affairsTodoSummary");
    case "automation":
      return t("shell.affairsAutomationSummary");
    case "library":
    default:
      return t("shell.affairsLibrarySummary");
  }
}

function resolveStageTitle(section: AffairsPrimarySection) {
  switch (section) {
    case "todo":
      return t("shell.affairsTodoStageTitle");
    case "automation":
      return t("shell.affairsAutomationStageTitle");
    case "library":
    default:
      return t("shell.affairsLibraryResultTitle");
  }
}

function resolveStageDescription(section: AffairsPrimarySection, sidebarCount: number) {
  switch (section) {
    case "todo":
      return t("shell.affairsTodoStageDescription", { count: sidebarCount });
    case "automation":
      return t("shell.affairsAutomationStageDescription", { count: sidebarCount });
    case "library":
    default:
      return t("shell.affairsLibraryStageDescription", { count: sidebarCount });
  }
}

function resolveSectionSidebarTitle(section: AffairsPrimarySection) {
  switch (section) {
    case "todo":
      return t("shell.affairsTodoSidebarTitle");
    case "automation":
      return t("shell.affairsAutomationSidebarTitle");
    case "library":
    default:
      return t("shell.affairsLibrarySidebarTitle");
  }
}

function resolveSectionSidebarDescription(
  section: AffairsPrimarySection,
  counts: {
    documentCount: number;
    favoriteCount: number;
    tagCount: number;
    todoCount: number;
    automationCount: number;
  }
) {
  switch (section) {
    case "todo":
      return t("shell.affairsTodoSidebarDescription", { count: counts.todoCount });
    case "automation":
      return t("shell.affairsAutomationSidebarDescription", { count: counts.automationCount });
    case "library":
    default:
      return t("shell.affairsLibrarySidebarDescription", {
        favorites: counts.favoriteCount,
        tags: counts.tagCount,
        count: counts.documentCount
      });
  }
}

function resolveSectionEmptyText(section: AffairsPrimarySection) {
  switch (section) {
    case "todo":
      return t("shell.affairsTodoEmpty");
    case "automation":
      return t("shell.affairsAutomationEmpty");
    case "library":
    default:
      return t("shell.affairsLibraryEmpty");
  }
}

function resolveInboxStatusLabel(status: ButlerInboxItemDto["status"]) {
  switch (status) {
    case "in_progress":
      return t("shell.affairsTodoStatusInProgress");
    case "closed":
      return t("shell.affairsTodoStatusClosed");
    case "pending":
    default:
      return t("shell.affairsTodoStatusPending");
  }
}

function resolveFollowUpStatusLabel(status: ButlerFollowUpTaskDto["status"]) {
  switch (status) {
    case "waiting_user":
      return t("shell.affairsTodoStatusWaitingUser");
    case "completed":
      return t("shell.affairsTodoStatusCompleted");
    case "failed":
      return t("shell.affairsTodoStatusFailed");
    case "cancelled":
      return t("shell.affairsTodoStatusCancelled");
    case "active":
    default:
      return t("shell.affairsTodoStatusActive");
  }
}

function resolveAutomationStatusLabel(status: AssistantAutomationTaskDto["status"]) {
  switch (status) {
    case "paused":
      return t("shell.affairsAutomationStatusPaused");
    case "completed":
      return t("shell.affairsAutomationStatusCompleted");
    case "cancelled":
      return t("shell.affairsAutomationStatusCancelled");
    case "failed":
      return t("shell.affairsAutomationStatusFailed");
    case "active":
    default:
      return t("shell.affairsAutomationStatusActive");
  }
}

function resolveAutomationRunStatusLabel(status: AssistantAutomationRunDto["status"]) {
  switch (status) {
    case "queued":
      return t("shell.affairsAutomationRunsStatusQueued");
    case "running":
      return t("shell.affairsAutomationRunsStatusRunning");
    case "failed":
      return t("shell.affairsAutomationRunsStatusFailed");
    case "cancelled":
      return t("shell.affairsAutomationRunsStatusCancelled");
    case "skipped":
      return t("shell.affairsAutomationRunsStatusSkipped");
    case "succeeded":
    default:
      return t("shell.affairsAutomationRunsStatusFinished");
  }
}

function resolveAutomationTriggerLabel(triggerType: AssistantAutomationTaskDto["triggerType"]) {
  switch (triggerType) {
    case "interval":
      return t("shell.affairsAutomationTriggerInterval");
    case "cron":
      return t("shell.affairsAutomationTriggerCron");
    case "condition":
      return t("shell.affairsAutomationTriggerCondition");
    case "once":
    default:
      return t("shell.affairsAutomationTriggerOnce");
  }
}

function resolveAutomationTargetLabel(
  automation: AssistantAutomationTaskDto,
  sessionTitleById: Record<string, string>
) {
  const sessionId = automation.actionConfig.targetSessionId?.trim() || automation.controlSession?.sessionId?.trim() || "";
  return sessionTitleById[sessionId] ?? t("shell.affairsAutomationTargetFallback");
}

function resolveDefaultNodeId(section: AffairsPrimarySection, favoriteDocuments: DocumentRecord[], automationRecords: AutomationRecord[]) {
  switch (section) {
    case "todo":
      return "todo:all";
    case "automation":
      return automationRecords[0] ? `automation:item:${automationRecords[0].id}` : "automation:all";
    case "library":
    default:
      return favoriteDocuments.length > 0 ? "library:favorites" : "library:all";
  }
}

function groupSidebarNodes(section: AffairsPrimarySection, nodes: AffairsSidebarNode[]) {
  if (section === "library") {
    return [
      {
        id: "overview",
        label: t("shell.affairsSidebarGroupOverview"),
        items: nodes.filter((node) => node.id === "library:all")
      },
      {
        id: "favorites",
        label: t("shell.affairsSectionGroupFavorites"),
        items: nodes.filter((node) => node.id === "library:favorites" || node.id.startsWith("library:favorite:"))
      },
      {
        id: "tags",
        label: t("shell.affairsSidebarGroupTags"),
        items: nodes.filter((node) => node.id.startsWith("library:tag:"))
      }
    ].filter((group) => group.items.length > 0);
  }

  if (section === "todo") {
    return [
      {
        id: "sources",
        label: t("shell.affairsTodoSidebarGroupSources"),
        items: nodes
      }
    ];
  }

  return [
    {
      id: "automation",
      label: t("shell.affairsAutomationSidebarGroupTasks"),
      items: nodes
    }
  ];
}

function normalizeSection(section: AffairsPrimarySection): AffairsPrimarySection {
  if (section === "todo" || section === "automation") {
    return section;
  }

  return "library";
}

function formatRelativeMeta(value: string) {
  if (!value) {
    return t("common.unknown");
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}


