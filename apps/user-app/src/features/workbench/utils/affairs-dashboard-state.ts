import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import type {
  AffairsWorkbenchDashboardState,
  DashboardHtmlWidgetVariant,
  DashboardTabState,
  DashboardWidgetLayout,
  DashboardWidgetSourceRef,
  DashboardWidgetState,
  DashboardWidgetType,
  ShortcutAppSourceKind,
  ShortcutAppState
} from "../types/workbench-mode";

const AFFAIRS_DASHBOARD_STATE_KEY_PREFIX = "workbench.affairs.dashboard.";
const AFFAIRS_DASHBOARD_STATE_VERSION = 7;
const AFFAIRS_DASHBOARD_STATE_CACHE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const WORKSPACE_HTML_PATH_PATTERN = /\.(html?|HTML?)$/;

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

function resolvePathLeafName(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

export function isWorkspaceHtmlEntryPath(path: string | null | undefined): boolean {
  const normalizedPath = path?.trim() ?? "";
  return normalizedPath.length > 0 && WORKSPACE_HTML_PATH_PATTERN.test(normalizedPath);
}

function resolveDefaultWidgetTitle(
  type: DashboardWidgetType,
  sourceId?: string,
  variant: DashboardHtmlWidgetVariant = "embed"
): string {
  if (type === "todo") {
    return t("shell.affairsTodoAllFilter");
  }

  if (type === "automation") {
    return t("shell.affairsAutomationStageTitle");
  }

  if (type === "teable") {
    return t("shell.teableRuntimeDefaultBlockTitle");
  }


  if (sourceId?.trim()) {
    return resolvePathLeafName(sourceId);
  }

  return resolveDefaultDashboardHtmlWidgetTitle(variant);
}

function resolveDefaultDashboardHtmlWidgetTitle(variant: DashboardHtmlWidgetVariant): string {
  if (variant === "app") {
    return t("shell.affairsWorkbenchHtmlAppDefaultTitle");
  }

  if (variant === "stat") {
    return t("shell.affairsWorkbenchHtmlStatDefaultTitle");
  }

  return t("shell.affairsWorkbenchHtmlEmbedDefaultTitle");
}

export function createAffairsDashboardWidgetState(
  input: {
    type: DashboardWidgetType;
    variant?: DashboardHtmlWidgetVariant;
    title?: string;
    sourceRef?: DashboardWidgetSourceRef;
    config?: Record<string, unknown>;
  },
  timestamp = new Date().toISOString()
): DashboardWidgetState {
  const variant = input.type === "html" ? normalizeDashboardHtmlWidgetVariant(input.variant) ?? "embed" : undefined;

  return {
    id: createDashboardEntityId("dashboard-widget"),
    type: input.type,
    variant,
    title: input.title?.trim() || resolveDefaultWidgetTitle(input.type, input.sourceRef?.sourceId, variant),
    sourceRef: input.sourceRef
      ? {
          ...input.sourceRef,
          workspaceId: input.sourceRef.workspaceId?.trim() || undefined
        }
      : undefined,
    config: isRecord(input.config) ? input.config : {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function createDefaultTodoWidget(timestamp: string): DashboardWidgetState {
  return createAffairsDashboardWidgetState(
    {
      type: "todo",
      title: t("shell.affairsTodoAllFilter"),
      config: {
        filter: "all",
        view: "compact"
      }
    },
    timestamp
  );
}

function createDefaultAutomationWidget(timestamp: string): DashboardWidgetState {
  return createAffairsDashboardWidgetState(
    {
      type: "automation",
      title: t("shell.affairsAutomationStageTitle"),
      config: {
        scope: "all",
        view: "list"
      }
    },
    timestamp
  );
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

export function createAffairsShortcutAppState(
  input: {
    title?: string;
    sourceKind?: ShortcutAppSourceKind;
    workspaceId: string;
    sourceId?: string;
    entryPath: string;
  },
  timestamp = new Date().toISOString()
): ShortcutAppState {
  const entryPath = input.entryPath.trim();
  const workspaceId = input.workspaceId.trim();
  const sourceId = input.sourceId?.trim() || entryPath;
  const sourceKind = input.sourceKind === "affairs_library" ? "affairs_library" : "workspace";

  return {
    id: createDashboardEntityId("shortcut-app"),
    title: input.title?.trim() || resolvePathLeafName(entryPath),
    sourceKind,
    workspaceId,
    sourceId,
    entryPath,
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
    layoutLocked: true,
    activeTabId: defaultTab.id,
    tabs: [defaultTab],
    shortcutApps: [],
    updatedAt: timestamp
  };
}

function normalizeDashboardWidgetState(
  rawWidget: unknown,
  timestampFallback: string
): DashboardWidgetState | null {
  if (!isRecord(rawWidget)) {
    return null;
  }

  const normalizedType = normalizeDashboardWidgetType(
    rawWidget.type,
    isRecord(rawWidget.config) ? rawWidget.config.variant : undefined,
    rawWidget.variant
  );
  if (!normalizedType) {
    return null;
  }

  const sourceRef = isRecord(rawWidget.sourceRef)
    ? {
        kind: rawWidget.sourceRef.kind === "html_shortcut"
          ? "html_shortcut" as const
          : rawWidget.sourceRef.kind === "affairs_library_html"
            ? "affairs_library_html" as const
            : "plugin_runtime" as const,
        workspaceId: typeof rawWidget.sourceRef.workspaceId === "string" && rawWidget.sourceRef.workspaceId.trim()
          ? rawWidget.sourceRef.workspaceId.trim()
          : undefined,
        sourceId: typeof rawWidget.sourceRef.sourceId === "string" ? rawWidget.sourceRef.sourceId.trim() : "",
        entryId: typeof rawWidget.sourceRef.entryId === "string" && rawWidget.sourceRef.entryId.trim()
          ? rawWidget.sourceRef.entryId.trim()
          : undefined
      }
    : undefined;

  if (normalizedType.type === "html" && !sourceRef?.sourceId) {
    return null;
  }

  if (normalizedType.type === "teable" && !isRecord(rawWidget.config)) {
    return null;
  }

  const id = typeof rawWidget.id === "string" && rawWidget.id.trim()
    ? rawWidget.id.trim()
    : createDashboardEntityId("dashboard-widget");

  return {
    id,
    type: normalizedType.type,
    variant: normalizedType.variant,
    title: typeof rawWidget.title === "string" && rawWidget.title.trim()
      ? rawWidget.title.trim()
      : resolveDefaultWidgetTitle(normalizedType.type, sourceRef?.sourceId, normalizedType.variant ?? "embed"),
    sourceRef,
    config: stripDashboardWidgetLegacyConfig(isRecord(rawWidget.config) ? rawWidget.config : {}),
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

function normalizeShortcutAppState(rawShortcut: unknown, timestampFallback: string): ShortcutAppState | null {
  if (!isRecord(rawShortcut)) {
    return null;
  }

  const sourceKind = rawShortcut.sourceKind === "affairs_library" ? "affairs_library" : "workspace";
  const workspaceId = typeof rawShortcut.workspaceId === "string" ? rawShortcut.workspaceId.trim() : "";
  const entryPath = typeof rawShortcut.entryPath === "string" ? rawShortcut.entryPath.trim() : "";
  if (!workspaceId || !entryPath) {
    return null;
  }

  const sourceId = typeof rawShortcut.sourceId === "string" && rawShortcut.sourceId.trim()
    ? rawShortcut.sourceId.trim()
    : entryPath;

  return {
    id: typeof rawShortcut.id === "string" && rawShortcut.id.trim()
      ? rawShortcut.id.trim()
      : createDashboardEntityId("shortcut-app"),
    title: typeof rawShortcut.title === "string" && rawShortcut.title.trim()
      ? rawShortcut.title.trim()
      : resolvePathLeafName(entryPath),
    sourceKind,
    workspaceId,
    sourceId,
    entryPath,
    createdAt: typeof rawShortcut.createdAt === "string" && rawShortcut.createdAt.trim()
      ? rawShortcut.createdAt
      : timestampFallback,
    updatedAt: typeof rawShortcut.updatedAt === "string" && rawShortcut.updatedAt.trim()
      ? rawShortcut.updatedAt
      : timestampFallback
  };
}

function normalizeDashboardTabState(rawTab: unknown, timestampFallback: string): DashboardTabState | null {
  if (!isRecord(rawTab)) {
    return null;
  }

  const normalizedWidgets = (Array.isArray(rawTab.widgets) ? rawTab.widgets : [])
    .map((widget) => normalizeDashboardWidgetState(widget, timestampFallback))
    .filter((widget): widget is DashboardWidgetState => widget !== null);

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

export function normalizeAffairsDashboardState(
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
  const shortcutApps = (Array.isArray(snapshot.shortcutApps) ? snapshot.shortcutApps : [])
    .map((item) => normalizeShortcutAppState(item, timestampFallback))
    .filter((item): item is ShortcutAppState => item !== null);

  if (tabs.length === 0) {
    return {
      ...createDefaultAffairsDashboardState(workspaceId, timestampFallback),
      shortcutApps
    };
  }

  const activeTabIdCandidate = typeof snapshot.activeTabId === "string" ? snapshot.activeTabId.trim() : "";
  const activeTabId = tabs.some((tab) => tab.id === activeTabIdCandidate)
    ? activeTabIdCandidate
    : tabs[0].id;

  return {
    workspaceId,
    version: AFFAIRS_DASHBOARD_STATE_VERSION,
    layoutLocked: typeof snapshot.layoutLocked === "boolean" ? snapshot.layoutLocked : true,
    activeTabId,
    tabs,
    shortcutApps,
    updatedAt: typeof snapshot.updatedAt === "string" && snapshot.updatedAt.trim()
      ? snapshot.updatedAt
      : timestampFallback
  };
}

function normalizeDashboardHtmlWidgetVariant(value: unknown): DashboardHtmlWidgetVariant | null {
  return value === "app" || value === "stat" || value === "embed"
    ? value
    : null;
}

function resolveLegacyDashboardHtmlWidgetVariant(value: unknown): DashboardHtmlWidgetVariant | null {
  if (value === "html_app") {
    return "app";
  }
  if (value === "html_stat") {
    return "stat";
  }
  if (value === "html_embed") {
    return "embed";
  }
  return null;
}

function normalizeDashboardWidgetType(
  value: unknown,
  configVariant: unknown,
  rawVariant: unknown
): { type: DashboardWidgetType; variant?: DashboardHtmlWidgetVariant } | null {
  if (value === "todo" || value === "automation" || value === "teable") {
    return {
      type: value
    };
  }

  if (value === "html") {
    return {
      type: "html",
      variant: normalizeDashboardHtmlWidgetVariant(rawVariant)
        ?? normalizeDashboardHtmlWidgetVariant(configVariant)
        ?? "embed"
    };
  }

  const legacyVariant = resolveLegacyDashboardHtmlWidgetVariant(value);
  if (legacyVariant) {
    return {
      type: "html",
      variant: legacyVariant
    };
  }

  return null;
}

function stripDashboardWidgetLegacyConfig(config: Record<string, unknown>): Record<string, unknown> {
  if (!("variant" in config)) {
    return config;
  }

  const { variant: _variant, ...restConfig } = config;
  return restConfig;
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
