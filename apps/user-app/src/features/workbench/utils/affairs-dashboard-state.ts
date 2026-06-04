import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import type {
  AffairsWorkbenchDashboardState,
  DashboardTabState,
  DashboardWidgetLayout,
  DashboardWidgetState,
  DashboardWidgetType
} from "../types/workbench-mode";

const AFFAIRS_DASHBOARD_STATE_KEY_PREFIX = "workbench.affairs.dashboard.";
const AFFAIRS_DASHBOARD_STATE_VERSION = 1;
const AFFAIRS_DASHBOARD_STATE_CACHE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function buildAffairsDashboardStateKey(workspaceId: string) {
  return `${AFFAIRS_DASHBOARD_STATE_KEY_PREFIX}${workspaceId}`;
}

function createDashboardEntityId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isDashboardWidgetType(value: unknown): value is DashboardWidgetType {
  return (
    value === "todo"
    || value === "automation"
    || value === "html_app"
    || value === "html_stat"
    || value === "html_embed"
  );
}

function createDefaultTodoWidget(timestamp: string): DashboardWidgetState {
  return {
    id: createDashboardEntityId("dashboard-widget"),
    type: "todo",
    title: t("shell.affairsTodoAllFilter"),
    config: {
      filter: "all",
      view: "compact"
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function createDefaultAutomationWidget(timestamp: string): DashboardWidgetState {
  return {
    id: createDashboardEntityId("dashboard-widget"),
    type: "automation",
    title: t("shell.affairsAutomationStageTitle"),
    config: {
      scope: "all",
      view: "list"
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function createDefaultLayoutForWidgets(widgets: DashboardWidgetState[]): DashboardWidgetLayout[] {
  return widgets.map((widget, index) => ({
    widgetId: widget.id,
    x: index === 0 ? 0 : 6,
    y: 0,
    w: 6,
    h: 5,
    minW: 4,
    minH: 3
  }));
}

export function createEmptyAffairsDashboardTabState(
  title: string,
  timestamp = new Date().toISOString()
): DashboardTabState {
  return {
    id: createDashboardEntityId("dashboard-tab"),
    title: title.trim() || t("shell.affairsWorkbenchDefaultTabTitle"),
    widgets: [],
    layout: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createDefaultAffairsDashboardTabState(timestamp = new Date().toISOString()): DashboardTabState {
  const widgets = [
    createDefaultTodoWidget(timestamp),
    createDefaultAutomationWidget(timestamp)
  ];

  return {
    id: createDashboardEntityId("dashboard-tab"),
    title: t("shell.affairsWorkbenchDefaultTabTitle"),
    widgets,
    layout: createDefaultLayoutForWidgets(widgets),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createDefaultAffairsDashboardState(
  workspaceId: string,
  timestamp = new Date().toISOString()
): AffairsWorkbenchDashboardState {
  const defaultTab = createDefaultAffairsDashboardTabState(timestamp);

  return {
    workspaceId,
    version: AFFAIRS_DASHBOARD_STATE_VERSION,
    activeTabId: defaultTab.id,
    tabs: [defaultTab],
    updatedAt: timestamp
  };
}

function normalizeDashboardWidgetState(
  rawWidget: unknown,
  timestampFallback: string
): DashboardWidgetState | null {
  if (!isRecord(rawWidget) || !isDashboardWidgetType(rawWidget.type)) {
    return null;
  }

  const id = typeof rawWidget.id === "string" && rawWidget.id.trim()
    ? rawWidget.id.trim()
    : createDashboardEntityId("dashboard-widget");
  const title = typeof rawWidget.title === "string" && rawWidget.title.trim()
    ? rawWidget.title.trim()
    : (rawWidget.type === "todo" ? t("shell.affairsTodoAllFilter") : t("shell.affairsAutomationStageTitle"));

  const sourceRef = isRecord(rawWidget.sourceRef)
    ? {
        kind: rawWidget.sourceRef.kind === "html_shortcut" ? "html_shortcut" as const : "plugin_runtime" as const,
        sourceId: typeof rawWidget.sourceRef.sourceId === "string" ? rawWidget.sourceRef.sourceId : "",
        entryId: typeof rawWidget.sourceRef.entryId === "string" ? rawWidget.sourceRef.entryId : undefined
      }
    : undefined;

  return {
    id,
    type: rawWidget.type,
    title,
    sourceRef,
    config: isRecord(rawWidget.config) ? rawWidget.config : {},
    createdAt: typeof rawWidget.createdAt === "string" && rawWidget.createdAt.trim() ? rawWidget.createdAt : timestampFallback,
    updatedAt: typeof rawWidget.updatedAt === "string" && rawWidget.updatedAt.trim() ? rawWidget.updatedAt : timestampFallback
  };
}

function normalizeDashboardWidgetLayout(
  rawLayout: unknown
): DashboardWidgetLayout | null {
  if (!isRecord(rawLayout) || typeof rawLayout.widgetId !== "string" || !rawLayout.widgetId.trim()) {
    return null;
  }

  if (
    !isNonNegativeInteger(rawLayout.x)
    || !isNonNegativeInteger(rawLayout.y)
    || !isPositiveInteger(rawLayout.w)
    || !isPositiveInteger(rawLayout.h)
  ) {
    return null;
  }

  return {
    widgetId: rawLayout.widgetId.trim(),
    x: rawLayout.x,
    y: rawLayout.y,
    w: rawLayout.w,
    h: rawLayout.h,
    minW: isPositiveInteger(rawLayout.minW) ? rawLayout.minW : undefined,
    minH: isPositiveInteger(rawLayout.minH) ? rawLayout.minH : undefined
  };
}

function normalizeDashboardTabState(rawTab: unknown, timestampFallback: string): DashboardTabState | null {
  if (!isRecord(rawTab)) {
    return null;
  }

  const normalizedWidgets = (Array.isArray(rawTab.widgets) ? rawTab.widgets : [])
    .map((widget) => normalizeDashboardWidgetState(widget, timestampFallback))
    .filter((widget): widget is DashboardWidgetState => widget !== null)
    .filter((widget) => {
      if (widget.type === "html_app" || widget.type === "html_stat" || widget.type === "html_embed") {
        return Boolean(widget.sourceRef?.sourceId?.trim());
      }
      return true;
    });

  const layoutByWidgetId = new Map(
    (Array.isArray(rawTab.layout) ? rawTab.layout : [])
      .map((layout) => normalizeDashboardWidgetLayout(layout))
      .filter((layout): layout is DashboardWidgetLayout => layout !== null)
      .map((layout) => [layout.widgetId, layout])
  );
  const defaultLayout = createDefaultLayoutForWidgets(normalizedWidgets);

  return {
    id: typeof rawTab.id === "string" && rawTab.id.trim() ? rawTab.id.trim() : createDashboardEntityId("dashboard-tab"),
    title: typeof rawTab.title === "string" && rawTab.title.trim() ? rawTab.title.trim() : t("shell.affairsWorkbenchDefaultTabTitle"),
    widgets: normalizedWidgets,
    layout: normalizedWidgets.map((widget, index) => layoutByWidgetId.get(widget.id) ?? defaultLayout[index]),
    createdAt: typeof rawTab.createdAt === "string" && rawTab.createdAt.trim() ? rawTab.createdAt : timestampFallback,
    updatedAt: typeof rawTab.updatedAt === "string" && rawTab.updatedAt.trim() ? rawTab.updatedAt : timestampFallback
  };
}

function normalizeAffairsDashboardState(
  workspaceId: string,
  snapshot: unknown
): AffairsWorkbenchDashboardState | null {
  if (!isRecord(snapshot)) {
    return null;
  }

  const timestampFallback = new Date().toISOString();
  const tabs = (Array.isArray(snapshot.tabs) ? snapshot.tabs : [])
    .map((tab) => normalizeDashboardTabState(tab, timestampFallback))
    .filter((tab): tab is DashboardTabState => tab !== null);

  if (tabs.length === 0) {
    return createDefaultAffairsDashboardState(workspaceId, timestampFallback);
  }

  const activeTabIdCandidate = typeof snapshot.activeTabId === "string" ? snapshot.activeTabId.trim() : "";
  const activeTabId = tabs.some((tab) => tab.id === activeTabIdCandidate)
    ? activeTabIdCandidate
    : tabs[0].id;

  return {
    workspaceId,
    version: Number.isInteger(snapshot.version) && Number(snapshot.version) > 0
      ? Number(snapshot.version)
      : AFFAIRS_DASHBOARD_STATE_VERSION,
    activeTabId,
    tabs,
    updatedAt: typeof snapshot.updatedAt === "string" && snapshot.updatedAt.trim()
      ? snapshot.updatedAt
      : timestampFallback
  };
}

export function readAffairsDashboardState(workspaceId: string | null | undefined): AffairsWorkbenchDashboardState | null {
  const normalizedWorkspaceId = workspaceId?.trim();

  if (!normalizedWorkspaceId) {
    return null;
  }

  const snapshot = readViewSnapshot<unknown>(
    buildAffairsDashboardStateKey(normalizedWorkspaceId),
    AFFAIRS_DASHBOARD_STATE_CACHE_MAX_AGE_MS
  );

  if (!snapshot) {
    return null;
  }

  return normalizeAffairsDashboardState(normalizedWorkspaceId, snapshot);
}

export function ensureAffairsDashboardState(workspaceId: string): AffairsWorkbenchDashboardState {
  const snapshot = readAffairsDashboardState(workspaceId);

  if (snapshot) {
    writeAffairsDashboardState(snapshot);
    return snapshot;
  }

  const defaultState = createDefaultAffairsDashboardState(workspaceId);
  writeAffairsDashboardState(defaultState);
  return defaultState;
}

export function writeAffairsDashboardState(state: AffairsWorkbenchDashboardState): void {
  writeViewSnapshot<AffairsWorkbenchDashboardState>(buildAffairsDashboardStateKey(state.workspaceId), state);
}
