import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { usePlatform } from "../../../platform/platform-provider";
import {
  readViewSnapshot,
  writeViewSnapshot
} from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { MobileWorkspaceSwitcherHeader } from "../../mobile-shell/components/MobileWorkspaceSwitcherHeader";
import {
  closeTerminal,
  createTerminal,
  deleteTerminalRecord,
  listWorkspaceTerminals,
  listTerminalShellOptions,
  type TerminalDto,
  type TerminalShellOptionDto
} from "../api/terminal-api";
import {
  persistActiveTerminalId,
  persistPinnedTerminalIds,
  persistSelectedWorkspaceId,
  persistTerminalCursor,
  persistTerminalViewState,
  persistTerminalZoomScale,
  readTerminalRecoveryState,
  readPersistedActiveTerminalId,
  readPersistedTerminalPageState,
  readPinnedTerminalIds,
  readPersistedTerminalZoomScale,
  type PersistedTerminalViewState
} from "../runtime/terminal-page-persistence";
import { pickActiveTerminalAfterReload } from "../runtime/terminal-active-selection";
import {
  TerminalRealtimeClient,
  type TerminalConnectionState,
  type TerminalOutputChunkDto
} from "../runtime/terminal-realtime-client";
import {
  getTerminalRuntimeLabel,
  getTerminalRuntimeShortLabel,
  listTerminalRuntimeOptions,
  type SelectableTerminalRuntimeType
} from "../runtime/terminal-runtime-meta";
import { isTmuxDependencyMissingError } from "../runtime/terminal-runtime-errors";
import { TerminalRuntimeFallbackModal } from "../components/TerminalRuntimeFallbackModal";

type PaneId = "primary" | "secondary";
type SplitDirection = "single" | "vertical" | "horizontal";

interface TerminalViewportRuntime {
  terminal: Terminal;
  restoredFromSnapshot: boolean;
  focus: () => void;
  reflow: () => void;
  readPlainText: () => string;
  setFontSize: (fontSize: number) => void;
  applyTheme: () => void;
  persistNow: () => void;
  schedulePersist: () => void;
  dispose: () => void;
}

interface TerminalActionMenuState {
  terminalId: string;
  top: number;
  left: number;
}

type TerminalNoticeTone = "info" | "success" | "warning" | "error";
type TerminalMutationType = "closing" | "deleting";

interface TerminalPaneBindings {
  primary: string | null;
  secondary: string | null;
}

interface TerminalCreationRequest {
  workspaceId: string;
  name?: string;
  cwd?: string;
  shell?: string;
  runtimeType?: string;
}

interface MobileTerminalShellChoice {
  id: string;
  label: string;
  value: string;
  description: string;
  available: boolean;
  unavailableReason: string | null;
}

type TerminalIndicatorStatus = TerminalDto["status"] | "disconnected";

interface TerminalPaneApi {
  focus: () => void;
  readPlainText: () => string;
  disconnect: () => void;
  reconnect: () => void;
}

interface TerminalWorkspacePaneProps {
  paneId: PaneId;
  paneLabel: string;
  terminal: TerminalDto | null;
  pendingCreation: boolean;
  zoomScale: number;
  active: boolean;
  isMobileLayout?: boolean;
  canCreateTerminal?: boolean;
  onActivate: (paneId: PaneId) => void;
  onSwipeGesture?: (direction: "left" | "right") => void;
  onConnectionChange: (paneId: PaneId, state: TerminalConnectionState) => void;
  onTerminalStatus: (terminal: Pick<TerminalDto, "id" | "status" | "statusDetail" | "processId">) => void;
  onRequireReload: () => Promise<void> | void;
  onUnauthorized: () => void;
  registerApi: (paneId: PaneId, api: TerminalPaneApi | null) => void;
  notifyTerminal: (title: string, tone?: TerminalNoticeTone) => void;
  onRequestCreateTerminal?: () => void;
  onRequestOpenTerminalDrawer?: () => void;
}

interface TerminalActionMenuProps {
  actionMenu: TerminalActionMenuState;
  terminal: TerminalDto;
  pendingMutation: TerminalMutationType | null;
  paneBindings: TerminalPaneBindings;
  splitDirection: SplitDirection;
  activePaneId: PaneId;
  paneConnectionStates: Record<PaneId, TerminalConnectionState>;
  pinnedTerminalIdSet: ReadonlySet<string>;
  manuallyDisconnectedTerminalIdSet: ReadonlySet<string>;
  onBindToActivePane: (terminalId: string) => void;
  onBindToPane: (terminalId: string, paneId: PaneId) => void;
  onDuplicate: (terminal: TerminalDto) => Promise<void>;
  onDisconnect: (terminalId: string) => void;
  onReconnect: (terminalId: string) => void;
  onClose: (terminalId: string) => Promise<void>;
  onDelete: (terminalId: string) => Promise<void>;
  onTogglePin: (terminalId: string) => void;
  onCloseMenu: () => void;
}

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 30;
const DEFAULT_TERMINAL_FONT_SIZE = 14;
const PERSISTED_TERMINAL_SCROLLBACK = 160;
const MAX_PERSISTED_TERMINAL_VIEW_CHARS = 120_000;
const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 5;
const MIN_TERMINAL_PIXEL_WIDTH = 320;
const MIN_TERMINAL_PIXEL_HEIGHT = 120;
const MIN_TERMINAL_ZOOM_SCALE = 0.8;
const MAX_TERMINAL_ZOOM_SCALE = 1.6;
const TERMINAL_ZOOM_STEP = 0.1;
const TERMINAL_MUTATION_POLL_INTERVAL_MS = 700;
const TERMINAL_MUTATION_POLL_ATTEMPTS = 10;
const TERMINAL_ACTION_MENU_WIDTH = 196;
const TERMINAL_ACTION_MENU_OFFSET = 6;
const TERMINAL_ACTION_MENU_EDGE_PADDING = 8;
const TERMINAL_MOBILE_SWIPE_THRESHOLD = 72;
const TERMINAL_MOBILE_SWIPE_OFF_AXIS_THRESHOLD = 48;
const TERMINAL_MANAGER_SNAPSHOT_CACHE_MAX_AGE_MS = 60 * 1000;
const INITIAL_PANE_BINDINGS: TerminalPaneBindings = {
  primary: null,
  secondary: null
};
const INITIAL_CONNECTION_STATES: Record<PaneId, TerminalConnectionState> = {
  primary: "closed",
  secondary: "closed"
};

export function TerminalPage() {
  const platform = usePlatform();
  const dragRegionProps = platform.isDesktop ? { "data-tauri-drag-region": true } : {};
  const navigate = useNavigate();
  const { workspaceId: routeWorkspaceIdParam } = useParams();
  const {
    navigationGroups,
    currentWorkspaceId: shellCurrentWorkspaceId,
    selectWorkspace,
    subscribeTerminalManagerSnapshot,
    requestTerminalManagerRefresh,
    addTerminalManagerSnapshotListener
  } = useWorkbenchShell();
  const terminalActionMenuRef = useRef<HTMLDivElement | null>(null);
  const terminalTabbarMainRef = useRef<HTMLDivElement | null>(null);
  const terminalTabbarScrollRef = useRef<HTMLDivElement | null>(null);
  const terminalActionMenuTriggerRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const toolbarToggleRef = useRef<HTMLButtonElement | null>(null);
  const mobileStageTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectedWorkspaceIdRef = useRef("");
  const terminalsRef = useRef<TerminalDto[]>([]);
  const terminalReloadRequestIdRef = useRef(0);
  const paneApiRef = useRef<Record<PaneId, TerminalPaneApi | null>>({
    primary: null,
    secondary: null
  });
  const paneBindingsRef = useRef<TerminalPaneBindings>(INITIAL_PANE_BINDINGS);
  const activePaneIdRef = useRef<PaneId>("primary");
  const splitDirectionRef = useRef<SplitDirection>("single");
  const workspaces = useMemo(
    () => navigationGroups.map((group) => group.workspace),
    [navigationGroups]
  );
  const routeWorkspaceId = routeWorkspaceIdParam?.trim() || null;

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedRuntimeType, setSelectedRuntimeType] =
    useState<SelectableTerminalRuntimeType>("");
  const [shellOptions, setShellOptions] = useState<TerminalShellOptionDto[]>([]);
  const [mobileSelectedShell, setMobileSelectedShell] = useState("");
  const [mobileQuickDrawerOpen, setMobileQuickDrawerOpen] = useState(false);
  const [mobileCreateSheetOpen, setMobileCreateSheetOpen] = useState(false);
  const [loadingShellOptions, setLoadingShellOptions] = useState(false);
  const [terminals, setTerminals] = useState<TerminalDto[]>([]);
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [pendingTerminalCreationPaneId, setPendingTerminalCreationPaneId] = useState<PaneId | null>(
    null
  );
  const [actionMenu, setActionMenu] = useState<TerminalActionMenuState | null>(null);
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [runtimeFallbackRequest, setRuntimeFallbackRequest] =
    useState<TerminalCreationRequest | null>(null);
  const [applyingRuntimeFallback, setApplyingRuntimeFallback] = useState(false);
  const [splitDirection, setSplitDirection] = useState<SplitDirection>("single");
  const [activePaneId, setActivePaneId] = useState<PaneId>("primary");
  const [paneBindings, setPaneBindings] = useState<TerminalPaneBindings>(INITIAL_PANE_BINDINGS);
  const [paneConnectionStates, setPaneConnectionStates] =
    useState<Record<PaneId, TerminalConnectionState>>(INITIAL_CONNECTION_STATES);
  const [pinnedTerminalIds, setPinnedTerminalIds] = useState<string[]>([]);
  const [manuallyDisconnectedTerminalIds, setManuallyDisconnectedTerminalIds] = useState<string[]>(
    []
  );
  const [terminalMutations, setTerminalMutations] = useState<Record<string, TerminalMutationType>>(
    {}
  );
  const [zoomScale, setZoomScale] = useState(() => readPersistedTerminalZoomScale() ?? 1);
  const shellCurrentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === shellCurrentWorkspaceId) ?? null,
    [shellCurrentWorkspaceId, workspaces]
  );
  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? shellCurrentWorkspace ?? null,
    [selectedWorkspaceId, shellCurrentWorkspace, workspaces]
  );
  const resolvedWorkspaceId = useMemo(
    () => {
      return (
        currentWorkspace?.id
        ?? shellCurrentWorkspace?.id
        ?? routeWorkspaceId
        ?? selectedWorkspaceId
        ?? workspaces[0]?.id
        ?? ""
      );
    },
    [currentWorkspace, routeWorkspaceId, selectedWorkspaceId, shellCurrentWorkspace, workspaces]
  );
  const mobileHeaderWorkspace = useMemo(
    () =>
      currentWorkspace ??
      workspaces[0] ?? {
        id: "__terminal-mobile-workspace-placeholder__",
        name: t("terminal.mobileWorkspaceSwitcherPlaceholder"),
        path: t("home.emptyWorkspaces")
      },
    [currentWorkspace, workspaces]
  );
  const { dismissToast, showToast } = useToast();

  // 终端页不再弹 toast，保留统一入口，避免把调用点改成一堆分散判断。
  const notifyTerminal = useCallback(
    (_title: string, _tone: TerminalNoticeTone = "info") => {
      return undefined;
    },
    []
  );
  const registerPaneApi = useCallback((paneId: PaneId, api: TerminalPaneApi | null) => {
    paneApiRef.current[paneId] = api;
  }, []);
  const handleUnauthorized = useCallback(() => {
    navigate("/login", { replace: true });
  }, [navigate]);
  const buildActionMenuState = useCallback(
    (terminalId: string, triggerOverride?: HTMLButtonElement | null): TerminalActionMenuState | null => {
      const tabbarMain = terminalTabbarMainRef.current;
      const trigger = triggerOverride ?? terminalActionMenuTriggerRef.current[terminalId];

      if (!tabbarMain || !trigger || !trigger.isConnected) {
        return null;
      }

      const tabbarRect = tabbarMain.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const maxLeft = Math.max(
        TERMINAL_ACTION_MENU_EDGE_PADDING,
        tabbarRect.width - TERMINAL_ACTION_MENU_WIDTH - TERMINAL_ACTION_MENU_EDGE_PADDING
      );
      const left = clampNumber(
        triggerRect.right - tabbarRect.left - TERMINAL_ACTION_MENU_WIDTH,
        TERMINAL_ACTION_MENU_EDGE_PADDING,
        maxLeft
      );
      const top = Math.max(0, triggerRect.bottom - tabbarRect.top + TERMINAL_ACTION_MENU_OFFSET);

      return {
        terminalId,
        top,
        left
      };
    },
    []
  );
  const updateActionMenuPosition = useCallback((terminalId: string) => {
    const nextState = buildActionMenuState(terminalId);

    if (!nextState) {
      setActionMenu(null);
      return;
    }

    setActionMenu((current) => {
      if (!current || current.terminalId !== terminalId) {
        return current;
      }

      if (current.top === nextState.top && current.left === nextState.left) {
        return current;
      }

      return nextState;
    });
  }, [buildActionMenuState]);

  const pinnedTerminalIdSet = useMemo(() => new Set(pinnedTerminalIds), [pinnedTerminalIds]);
  const manuallyDisconnectedTerminalIdSet = useMemo(
    () => new Set(manuallyDisconnectedTerminalIds),
    [manuallyDisconnectedTerminalIds]
  );
  const orderedTerminals = useMemo(
    () => sortTerminals(terminals, pinnedTerminalIdSet),
    [pinnedTerminalIdSet, terminals]
  );
  const runtimeOptions = useMemo(() => listTerminalRuntimeOptions(), []);
  const isMobileTerminalPage = !platform.isDesktop && !(platform.isWeb && platform.viewportClass === "expanded");
  const effectiveSplitDirection: SplitDirection = isMobileTerminalPage ? "single" : splitDirection;
  const effectiveActivePaneId: PaneId = isMobileTerminalPage ? "primary" : activePaneId;
  const effectivePaneBindings = useMemo<TerminalPaneBindings>(() => {
    if (!isMobileTerminalPage) {
      return paneBindings;
    }

    return {
      primary: paneBindings[activePaneId] ?? paneBindings.primary,
      secondary: null
    };
  }, [activePaneId, isMobileTerminalPage, paneBindings]);
  const effectivePaneConnectionStates = useMemo<Record<PaneId, TerminalConnectionState>>(() => {
    if (!isMobileTerminalPage) {
      return paneConnectionStates;
    }

    return {
      primary: paneConnectionStates[activePaneId] ?? paneConnectionStates.primary,
      secondary: "closed"
    };
  }, [activePaneId, isMobileTerminalPage, paneConnectionStates]);
  const activeTerminalId = effectivePaneBindings[effectiveActivePaneId];
  const activeTerminal = useMemo(
    () => terminals.find((terminal) => terminal.id === activeTerminalId) ?? null,
    [activeTerminalId, terminals]
  );
  const actionMenuTerminal = useMemo(
    () => (actionMenu ? terminals.find((terminal) => terminal.id === actionMenu.terminalId) ?? null : null),
    [actionMenu, terminals]
  );
  const visiblePaneIds =
    effectiveSplitDirection === "single"
      ? (["primary"] as PaneId[])
      : (["primary", "secondary"] as PaneId[]);
  const mobileShellChoices = useMemo(
    () => buildMobileTerminalShellChoices(shellOptions, platform.ui.osFamily),
    [platform.ui.osFamily, shellOptions]
  );
  const selectedMobileShellChoice = useMemo(
    () => mobileShellChoices.find((option) => option.value === mobileSelectedShell) ?? mobileShellChoices[0] ?? null,
    [mobileSelectedShell, mobileShellChoices]
  );

  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);

  useEffect(() => {
    setMobileSelectedShell((current) => {
      if (!mobileShellChoices.length) {
        return "";
      }

      if (current && mobileShellChoices.some((option) => option.value === current && option.available)) {
        return current;
      }

      return mobileShellChoices.find((option) => option.available)?.value ?? mobileShellChoices[0]?.value ?? "";
    });
  }, [mobileShellChoices]);

  function updatePaneBindings(updater: (current: TerminalPaneBindings) => TerminalPaneBindings): void {
    const nextBindings = updater(paneBindingsRef.current);
    paneBindingsRef.current = nextBindings;
    setPaneBindings(nextBindings);
  }

  function updateActivePane(nextPaneId: PaneId): void {
    activePaneIdRef.current = nextPaneId;
    setActivePaneId(nextPaneId);
  }

  function updateSplitDirection(nextDirection: SplitDirection): void {
    splitDirectionRef.current = nextDirection;
    setSplitDirection(nextDirection);
  }

  const applyWorkspaceTerminalCollection = useCallback(
    (
      workspaceId: string,
      nextTerminals: TerminalDto[],
      options: {
        preferredTerminalId?: string | null;
        preferredPaneId?: PaneId;
      } = {}
    ): void => {
      if (selectedWorkspaceIdRef.current !== workspaceId) {
        return;
      }

      terminalsRef.current = nextTerminals;
      setTerminals(nextTerminals);
      setManuallyDisconnectedTerminalIds((current) => {
        const existingTerminalIdSet = new Set(nextTerminals.map((terminal) => terminal.id));
        return current.filter((terminalId) => existingTerminalIdSet.has(terminalId));
      });
      setPinnedTerminalIds((current) => {
        const existingTerminalIdSet = new Set(nextTerminals.map((terminal) => terminal.id));
        const nextPinnedIds = current.filter((terminalId) => existingTerminalIdSet.has(terminalId));

        if (nextPinnedIds.length !== current.length) {
          persistPinnedTerminalIds(workspaceId, nextPinnedIds);
        }

        return nextPinnedIds;
      });

      const persistedTerminalId = readPersistedActiveTerminalId(workspaceId);
      const nextActiveTerminalId =
        pickActiveTerminalAfterReload({
          terminals: nextTerminals,
          preferredTerminalId: options.preferredTerminalId,
          currentActiveTerminalId:
            paneBindingsRef.current[activePaneIdRef.current] ?? paneBindingsRef.current.primary,
          persistedTerminalId
        })?.id ?? null;

      setPaneBindings((current) => {
        const nextBindings = normalizePaneBindings({
          terminals: nextTerminals,
          currentBindings: current,
          splitDirection: splitDirectionRef.current,
          fallbackTerminalId: nextActiveTerminalId,
          preferredPaneId: options.preferredPaneId ?? activePaneIdRef.current
        });

        paneBindingsRef.current = nextBindings;
        return nextBindings;
      });
    },
    []
  );

  const reloadWorkspaceResources = useCallback(
    async (
      workspaceId: string,
      options: {
        preferredTerminalId?: string | null;
        preferredPaneId?: PaneId;
      } = {}
    ): Promise<void> => {
      const requestId = terminalReloadRequestIdRef.current + 1;
      terminalReloadRequestIdRef.current = requestId;

      try {
        const terminalResponse = await listWorkspaceTerminals(workspaceId);

        if (
          requestId !== terminalReloadRequestIdRef.current ||
          selectedWorkspaceIdRef.current !== workspaceId
        ) {
          return;
        }

        applyWorkspaceTerminalCollection(workspaceId, terminalResponse.items, options);
      } catch (error) {
        if (
          requestId !== terminalReloadRequestIdRef.current ||
          selectedWorkspaceIdRef.current !== workspaceId
        ) {
          return;
        }

        const detail = error instanceof Error ? error.message : t("terminal.workspaceLoadFailed");
        notifyTerminal(detail, "error");
      }
    },
    [applyWorkspaceTerminalCollection, notifyTerminal]
  );
  const requestReload = useCallback(() => {
    if (!selectedWorkspaceId) {
      return Promise.resolve();
    }

    return reloadWorkspaceResources(selectedWorkspaceId);
  }, [reloadWorkspaceResources, selectedWorkspaceId]);

  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
  }, [selectedWorkspaceId]);

  useEffect(() => {
    paneBindingsRef.current = paneBindings;
  }, [paneBindings]);

  useEffect(() => {
    activePaneIdRef.current = activePaneId;
  }, [activePaneId]);

  useEffect(() => {
    splitDirectionRef.current = splitDirection;
  }, [splitDirection]);

  useEffect(() => {
    if (!isMobileTerminalPage) {
      return;
    }

    const focusedTerminalId = paneBindingsRef.current[activePaneIdRef.current] ?? paneBindingsRef.current.primary;
    const needsSinglePane = splitDirectionRef.current !== "single";
    const needsPrimaryFocus = activePaneIdRef.current !== "primary";
    const needsBindingReset =
      paneBindingsRef.current.secondary !== null || paneBindingsRef.current.primary !== focusedTerminalId;

    if (!needsSinglePane && !needsPrimaryFocus && !needsBindingReset) {
      return;
    }

    updatePaneBindings(() => ({
      primary: focusedTerminalId,
      secondary: null
    }));
    updateSplitDirection("single");
    updateActivePane("primary");
    setPaneConnectionStates((current) =>
      current.secondary === "closed"
        ? current
        : {
            ...current,
            secondary: "closed"
          }
    );
  }, [isMobileTerminalPage]);

  useEffect(() => {
    const persistedWorkspaceId = readPersistedTerminalPageState().selectedWorkspaceId;
    const routeSelectedWorkspaceId =
      routeWorkspaceId && workspaces.some((workspace) => workspace.id === routeWorkspaceId)
        ? routeWorkspaceId
        : null;
    const shellSelectedWorkspaceId =
      shellCurrentWorkspaceId && workspaces.some((workspace) => workspace.id === shellCurrentWorkspaceId)
        ? shellCurrentWorkspaceId
        : null;
    const restoredWorkspaceId =
      routeSelectedWorkspaceId ??
      shellSelectedWorkspaceId ??
      workspaces.find((workspace) => workspace.id === persistedWorkspaceId)?.id ??
      workspaces[0]?.id ??
      "";

    setSelectedWorkspaceId((current) => {
      if (routeSelectedWorkspaceId) {
        return routeSelectedWorkspaceId;
      }

      if (current && workspaces.some((workspace) => workspace.id === current)) {
        return current;
      }

      return restoredWorkspaceId;
    });
  }, [routeWorkspaceId, shellCurrentWorkspaceId, workspaces]);

  useEffect(() => {
    persistSelectedWorkspaceId(selectedWorkspaceId || null);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setPinnedTerminalIds([]);
      return;
    }

    setPinnedTerminalIds(readPinnedTerminalIds(selectedWorkspaceId));
  }, [selectedWorkspaceId]);

  useEffect(() => {
    persistTerminalZoomScale(zoomScale);
  }, [zoomScale]);

  useEffect(() => {
    setActionMenu(null);
  }, [activePaneId, paneBindings, selectedWorkspaceId]);

  useEffect(() => {
    if (!isMobileTerminalPage) {
      return;
    }

    setMobileQuickDrawerOpen(false);
  }, [activeTerminalId, isMobileTerminalPage, selectedWorkspaceId]);

  useEffect(() => {
    if (actionMenu && !terminals.some((terminal) => terminal.id === actionMenu.terminalId)) {
      setActionMenu(null);
    }
  }, [actionMenu, terminals]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }

    return addTerminalManagerSnapshotListener((snapshot) => {
      if (snapshot.workspaceId !== selectedWorkspaceId) {
        return;
      }

      writeViewSnapshot(buildTerminalManagerSnapshotKey(selectedWorkspaceId), {
        terminals: snapshot.terminals,
        templates: snapshot.templates,
        templateStatuses: snapshot.templateStatuses,
        shellOptions: snapshot.shellOptions
      });
      setShellOptions(snapshot.shellOptions ?? []);
      applyWorkspaceTerminalCollection(snapshot.workspaceId, snapshot.terminals);
    });
  }, [addTerminalManagerSnapshotListener, applyWorkspaceTerminalCollection, selectedWorkspaceId]);

  useEffect(() => {
    if (!actionMenu) {
      return;
    }

    const scrollElement = terminalTabbarScrollRef.current;
    const handlePositionUpdate = () => {
      updateActionMenuPosition(actionMenu.terminalId);
    };
    const frameId = window.requestAnimationFrame(handlePositionUpdate);

    window.addEventListener("resize", handlePositionUpdate);
    window.addEventListener("scroll", handlePositionUpdate, true);
    scrollElement?.addEventListener("scroll", handlePositionUpdate, { passive: true });

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handlePositionUpdate);
      window.removeEventListener("scroll", handlePositionUpdate, true);
      scrollElement?.removeEventListener("scroll", handlePositionUpdate);
    };
  }, [actionMenu, updateActionMenuPosition]);

  useEffect(() => {
    if (!actionMenu && !toolbarOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node;
      const insideActionMenu =
        (terminalActionMenuRef.current?.contains(target) ?? false) ||
        (!!actionMenu &&
          (terminalActionMenuTriggerRef.current[actionMenu.terminalId]?.contains(target) ?? false));
      const insideToolbar =
        (toolbarRef.current?.contains(target) ?? false) ||
        (toolbarToggleRef.current?.contains(target) ?? false);

      if (actionMenu && !insideActionMenu) {
        setActionMenu(null);
      }

      if (toolbarOpen && !insideToolbar) {
        setToolbarOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setActionMenu(null);
        setToolbarOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [actionMenu, toolbarOpen]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setShellOptions([]);
      setMobileQuickDrawerOpen(false);
      setMobileCreateSheetOpen(false);
      terminalsRef.current = [];
      setTerminals([]);
      updatePaneBindings(() => INITIAL_PANE_BINDINGS);
      updateActivePane("primary");
      setPaneConnectionStates(INITIAL_CONNECTION_STATES);
      setPendingTerminalCreationPaneId(null);
      return;
    }

    updateActivePane("primary");
    setPaneConnectionStates(INITIAL_CONNECTION_STATES);
    setPendingTerminalCreationPaneId(null);

    const cachedSnapshot = readViewSnapshot<{
      terminals: TerminalDto[];
      templates: unknown[];
      templateStatuses: Array<{ occupied: boolean }>;
      shellOptions?: unknown[];
    }>(
      buildTerminalManagerSnapshotKey(selectedWorkspaceId),
      TERMINAL_MANAGER_SNAPSHOT_CACHE_MAX_AGE_MS
    );

    if (cachedSnapshot) {
      setShellOptions(parseTerminalShellOptions(cachedSnapshot.shellOptions));
      applyWorkspaceTerminalCollection(selectedWorkspaceId, cachedSnapshot.terminals);
    } else {
      setShellOptions([]);
      terminalsRef.current = [];
      setTerminals([]);
      updatePaneBindings(() => INITIAL_PANE_BINDINGS);
      updateActivePane("primary");
      setPaneConnectionStates(INITIAL_CONNECTION_STATES);
      setPendingTerminalCreationPaneId(null);
    }

    subscribeTerminalManagerSnapshot(selectedWorkspaceId);

    if (cachedSnapshot) {
      const timer = window.setTimeout(() => {
        requestTerminalManagerRefresh(selectedWorkspaceId);
      }, 1500);

      return () => {
        window.clearTimeout(timer);
      };
    }

    requestTerminalManagerRefresh(selectedWorkspaceId);
  }, [
    applyWorkspaceTerminalCollection,
    requestTerminalManagerRefresh,
    selectedWorkspaceId,
    subscribeTerminalManagerSnapshot
  ]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }

    persistActiveTerminalId(selectedWorkspaceId, activeTerminalId ?? null);
  }, [activeTerminalId, selectedWorkspaceId]);

  const handlePaneConnectionChange = useCallback((paneId: PaneId, state: TerminalConnectionState) => {
    setPaneConnectionStates((current) => ({
      ...current,
      [paneId]: state
    }));
  }, []);

  const handleTerminalStatus = useCallback(
    (terminalPatch: Pick<TerminalDto, "id" | "status" | "statusDetail" | "processId">) => {
      if (terminalPatch.status !== "running") {
        setManuallyDisconnectedTerminalIds((current) =>
          current.filter((item) => item !== terminalPatch.id)
        );
      }

      setTerminals((current) => {
        const nextTerminals = current.map((terminal) =>
          terminal.id === terminalPatch.id
            ? {
                ...terminal,
                status: terminalPatch.status,
                statusDetail: terminalPatch.statusDetail,
                processId: terminalPatch.processId ?? terminal.processId ?? null
              }
            : terminal
        );
        terminalsRef.current = nextTerminals;
        return nextTerminals;
      });
    },
    []
  );

  function markTerminalMutation(terminalId: string, mutation: TerminalMutationType | null): void {
    setTerminalMutations((current) => {
      if (mutation === null) {
        if (!(terminalId in current)) {
          return current;
        }

        const next = { ...current };
        delete next[terminalId];
        return next;
      }

      if (current[terminalId] === mutation) {
        return current;
      }

      return {
        ...current,
        [terminalId]: mutation
      };
    });
  }

  function showTerminalMutationToast(terminalId: string, mutation: TerminalMutationType): void {
    showToast({
      id: buildTerminalMutationToastId(terminalId),
      title: mutation === "closing" ? t("terminal.closing") : t("terminal.deleting"),
      description:
        mutation === "closing"
          ? t("terminal.closePendingDescription")
          : t("terminal.deletePendingDescription"),
      tone: "info",
      durationMs: null
    });
  }

  async function waitForTerminalMutationSettlement(
    workspaceId: string,
    terminalId: string,
    mutation: TerminalMutationType
  ): Promise<"settled" | "timeout" | "workspace_changed"> {
    for (let attempt = 0; attempt < TERMINAL_MUTATION_POLL_ATTEMPTS; attempt += 1) {
      if (selectedWorkspaceIdRef.current !== workspaceId) {
        return "workspace_changed";
      }

      await reloadWorkspaceResources(workspaceId);
      const terminal = terminalsRef.current.find((item) => item.id === terminalId) ?? null;
      const settled =
        mutation === "deleting"
          ? terminal === null
          : terminal === null || terminal.status !== "running";

      if (settled) {
        return "settled";
      }

      if (attempt < TERMINAL_MUTATION_POLL_ATTEMPTS - 1) {
        await waitForNextMutationPoll();
      }
    }

    return "timeout";
  }

  function activatePane(paneId: PaneId): void {
    updateActivePane(paneId);
  }

  function bindTerminalToActivePane(terminalId: string): void {
    bindTerminalToPane(terminalId, activePaneIdRef.current);
  }

  function bindTerminalToPane(terminalId: string, paneId: PaneId): void {
    const targetPaneId: PaneId = isMobileTerminalPage ? "primary" : paneId;
    const nextSplitDirection: SplitDirection = isMobileTerminalPage ? "single" : splitDirectionRef.current;

    updatePaneBindings((current) => {
      const nextBindings: TerminalPaneBindings =
        nextSplitDirection === "single"
          ? {
              primary: terminalId,
              secondary: null
            }
          : {
              ...current,
              [targetPaneId]: terminalId
            };

      if (nextSplitDirection !== "single") {
        const siblingPaneId = targetPaneId === "primary" ? "secondary" : "primary";

        if (nextBindings[siblingPaneId] === terminalId) {
          nextBindings[siblingPaneId] = pickAnotherTerminalId(terminals, terminalId);
        }
      }

      return normalizePaneBindings({
        terminals,
        currentBindings: nextBindings,
        splitDirection: nextSplitDirection,
        fallbackTerminalId: terminalId,
        preferredPaneId: targetPaneId
      });
    });
    setManuallyDisconnectedTerminalIds((current) =>
      current.filter((item) => item !== terminalId)
    );
    setActionMenu(null);
  }

  async function submitTerminalCreation(
    request: TerminalCreationRequest,
    options: { allowFallbackPrompt?: boolean } = {}
  ): Promise<TerminalDto | null> {
    try {
      return await createTerminal(request);
    } catch (error) {
      if (
        options.allowFallbackPrompt !== false &&
        request.runtimeType !== "embedded-pty" &&
        isTmuxDependencyMissingError(error)
      ) {
        setRuntimeFallbackRequest(request);
        return null;
      }

      throw error;
    }
  }

  async function ensureShellOptionsLoaded(): Promise<TerminalShellOptionDto[]> {
    if (shellOptions.length > 0) {
      return shellOptions;
    }

    if (loadingShellOptions) {
      return shellOptions;
    }

    setLoadingShellOptions(true);

    try {
      const response = await listTerminalShellOptions();
      const nextOptions = response.items ?? [];
      setShellOptions(nextOptions);
      return nextOptions;
    } catch {
      return shellOptions;
    } finally {
      setLoadingShellOptions(false);
    }
  }

  async function openMobileCreateSheet(): Promise<void> {
    if (!isMobileTerminalPage || !resolvedWorkspaceId || creatingTerminal) {
      return;
    }

    await ensureShellOptionsLoaded();
    setMobileCreateSheetOpen(true);
  }

  function clearPendingTerminalCreation(paneId: PaneId): void {
    setPendingTerminalCreationPaneId((current) => (current === paneId ? null : current));
  }

  function applyCreatedTerminalLocally(terminal: TerminalDto, paneId: PaneId): void {
    const targetPaneId: PaneId = isMobileTerminalPage ? "primary" : paneId;
    const nextSplitDirection: SplitDirection = isMobileTerminalPage ? "single" : splitDirectionRef.current;
    const nextTerminals = upsertTerminal(terminalsRef.current, terminal);
    terminalsRef.current = nextTerminals;
    setTerminals(nextTerminals);
    updatePaneBindings((current) =>
      normalizePaneBindings({
        terminals: nextTerminals,
        currentBindings: {
          ...current,
          [targetPaneId]: terminal.id,
          ...(nextSplitDirection === "single"
            ? {
                primary: terminal.id,
                secondary: null
              }
            : {})
        },
        splitDirection: nextSplitDirection,
        fallbackTerminalId: terminal.id,
        preferredPaneId: targetPaneId
      })
    );
    setPaneConnectionStates((current) => ({
      ...current,
      [targetPaneId]: terminal.status === "running" ? "reconnecting" : "closed"
    }));
    setManuallyDisconnectedTerminalIds((current) =>
      current.filter((item) => item !== terminal.id)
    );
  }

  async function handleCreateTerminal(): Promise<void> {
    const workspaceId = resolvedWorkspaceId;

    if (!workspaceId) {
      return;
    }

    const targetPaneId: PaneId = isMobileTerminalPage ? "primary" : activePaneIdRef.current;
    setCreatingTerminal(true);
    setPendingTerminalCreationPaneId(targetPaneId);

    try {
      const terminal = await submitTerminalCreation({
        workspaceId,
        runtimeType: selectedRuntimeType || undefined
      });

      if (!terminal) {
        clearPendingTerminalCreation(targetPaneId);
        return;
      }

      applyCreatedTerminalLocally(terminal, targetPaneId);
      clearPendingTerminalCreation(targetPaneId);
      await reloadWorkspaceResources(workspaceId, {
        preferredTerminalId: terminal.id,
        preferredPaneId: targetPaneId
      });
      notifyTerminal(t("terminal.created"), "success");
    } catch (error) {
      clearPendingTerminalCreation(targetPaneId);
      notifyTerminal(error instanceof Error ? error.message : t("terminal.createFailed"), "error");
    } finally {
      setCreatingTerminal(false);
    }
  }

  async function handleCreateTerminalFromMobileSheet(): Promise<void> {
    const workspaceId = resolvedWorkspaceId;

    if (!workspaceId || creatingTerminal) {
      return;
    }

    const shellChoice = selectedMobileShellChoice;

    if (!shellChoice || !shellChoice.available) {
      return;
    }

    const targetPaneId: PaneId = "primary";
    setCreatingTerminal(true);
    setPendingTerminalCreationPaneId(targetPaneId);

    try {
      const terminal = await submitTerminalCreation({
        workspaceId,
        shell: shellChoice.value,
        runtimeType: selectedRuntimeType || "tmux"
      });

      if (!terminal) {
        clearPendingTerminalCreation(targetPaneId);
        return;
      }

      applyCreatedTerminalLocally(terminal, targetPaneId);
      clearPendingTerminalCreation(targetPaneId);
      setMobileCreateSheetOpen(false);
      setMobileQuickDrawerOpen(false);
      await reloadWorkspaceResources(workspaceId, {
        preferredTerminalId: terminal.id,
        preferredPaneId: targetPaneId
      });
      notifyTerminal(t("terminal.created"), "success");
    } catch (error) {
      clearPendingTerminalCreation(targetPaneId);
      notifyTerminal(error instanceof Error ? error.message : t("terminal.createFailed"), "error");
    } finally {
      setCreatingTerminal(false);
    }
  }

  async function handleCloseTerminal(terminalId: string): Promise<void> {
    if (!selectedWorkspaceId || terminalMutations[terminalId]) {
      return;
    }

    const workspaceId = selectedWorkspaceId;
    const toastId = buildTerminalMutationToastId(terminalId);
    setActionMenu(null);
    markTerminalMutation(terminalId, "closing");
    showTerminalMutationToast(terminalId, "closing");

    void (async () => {
      try {
        await closeTerminal(terminalId);
        showToast({
          id: toastId,
          title: t("terminal.closed"),
          description: t("terminal.closePendingDescription"),
          tone: "info",
          durationMs: null
        });

        const settlement = await waitForTerminalMutationSettlement(workspaceId, terminalId, "closing");

        if (settlement === "workspace_changed") {
          dismissToast(toastId);
          return;
        }

        if (settlement === "timeout") {
          showToast({
            id: toastId,
            title: t("terminal.closed"),
            description: t("terminal.closeSyncDelayed"),
            tone: "warning"
          });
          return;
        }

        showToast({
          id: toastId,
          title: t("terminal.closeCompleted"),
          tone: "success"
        });
      } catch (error) {
        showToast({
          id: toastId,
          title: error instanceof Error ? error.message : t("terminal.closeFailed"),
          tone: "error"
        });
      } finally {
        markTerminalMutation(terminalId, null);
      }
    })();
  }

  async function handleDeleteTerminal(terminalId: string): Promise<void> {
    if (!selectedWorkspaceId || terminalMutations[terminalId]) {
      return;
    }

    const workspaceId = selectedWorkspaceId;
    const toastId = buildTerminalMutationToastId(terminalId);
    setActionMenu(null);
    markTerminalMutation(terminalId, "deleting");
    showTerminalMutationToast(terminalId, "deleting");

    void (async () => {
      try {
        await deleteTerminalRecord(terminalId);
        const settlement = await waitForTerminalMutationSettlement(workspaceId, terminalId, "deleting");

        if (settlement === "workspace_changed") {
          dismissToast(toastId);
          return;
        }

        if (settlement === "timeout") {
          showToast({
            id: toastId,
            title: t("terminal.deleted"),
            description: t("terminal.deleteSyncDelayed"),
            tone: "warning"
          });
          return;
        }

        showToast({
          id: toastId,
          title: t("terminal.deleted"),
          tone: "success"
        });
      } catch (error) {
        showToast({
          id: toastId,
          title: error instanceof Error ? error.message : t("terminal.deleteFailed"),
          tone: "error"
        });
      } finally {
        markTerminalMutation(terminalId, null);
      }
    })();
  }

  async function handleDuplicateTerminal(terminal: TerminalDto): Promise<void> {
    if (!selectedWorkspaceId) {
      return;
    }

    const targetPaneId: PaneId = isMobileTerminalPage ? "primary" : activePaneIdRef.current;

    try {
      const duplicatedTerminal = await submitTerminalCreation({
        workspaceId: selectedWorkspaceId,
        cwd: terminal.cwd,
        shell: terminal.shell,
        runtimeType: terminal.runtimeType
      });

      if (!duplicatedTerminal) {
        return;
      }

      applyCreatedTerminalLocally(duplicatedTerminal, targetPaneId);
      setActionMenu(null);
      await reloadWorkspaceResources(selectedWorkspaceId, {
        preferredTerminalId: duplicatedTerminal.id,
        preferredPaneId: targetPaneId
      });
      notifyTerminal(t("terminal.duplicateSuccess"), "success");
    } catch (error) {
      notifyTerminal(
        error instanceof Error ? error.message : t("terminal.duplicateFailed"),
        "error"
      );
    }
  }

  async function handleConfirmRuntimeFallback(): Promise<void> {
    const request = runtimeFallbackRequest;

    if (!request) {
      return;
    }

    const targetPaneId: PaneId = isMobileTerminalPage ? "primary" : activePaneIdRef.current;
    setApplyingRuntimeFallback(true);
    setPendingTerminalCreationPaneId(targetPaneId);

    try {
      const terminal = await submitTerminalCreation(
        {
          ...request,
          runtimeType: "embedded-pty"
        },
        { allowFallbackPrompt: false }
      );

      if (!terminal) {
        clearPendingTerminalCreation(targetPaneId);
        return;
      }

      applyCreatedTerminalLocally(terminal, targetPaneId);
      setSelectedRuntimeType("embedded-pty");
      setRuntimeFallbackRequest(null);
      setMobileCreateSheetOpen(false);
      clearPendingTerminalCreation(targetPaneId);
      await reloadWorkspaceResources(request.workspaceId, {
        preferredTerminalId: terminal.id,
        preferredPaneId: targetPaneId
      });
      notifyTerminal(t("terminal.created"), "success");
    } catch (error) {
      clearPendingTerminalCreation(targetPaneId);
      notifyTerminal(error instanceof Error ? error.message : t("terminal.createFailed"), "error");
    } finally {
      setApplyingRuntimeFallback(false);
    }
  }

  function handleTogglePin(terminalId: string): void {
    if (!selectedWorkspaceId) {
      return;
    }

    setPinnedTerminalIds((current) => {
      const nextPinnedIds = current.includes(terminalId)
        ? current.filter((item) => item !== terminalId)
        : [terminalId, ...current];

      persistPinnedTerminalIds(selectedWorkspaceId, nextPinnedIds);
      return nextPinnedIds;
    });
    setActionMenu(null);
  }

  function handleDisconnectTerminal(terminalId: string): void {
    const paneId = findPaneIdByTerminalId(
      terminalId,
      effectivePaneBindings,
      effectiveSplitDirection,
      effectiveActivePaneId
    );

    if (!paneId) {
      return;
    }

    paneApiRef.current[paneId]?.disconnect();
    updatePaneBindings((current) => ({
      ...current,
      [paneId]: null
    }));
    setPaneConnectionStates((current) => ({
      ...current,
      [paneId]: "closed"
    }));
    setManuallyDisconnectedTerminalIds((current) =>
      current.includes(terminalId) ? current : [...current, terminalId]
    );
    setActionMenu(null);
    notifyTerminal(t("terminal.disconnected"), "warning");
  }

  function handleReconnectTerminal(terminalId: string): void {
    const paneId = findPaneIdByTerminalId(
      terminalId,
      effectivePaneBindings,
      effectiveSplitDirection,
      effectiveActivePaneId
    );

    if (!paneId) {
      return;
    }

    setManuallyDisconnectedTerminalIds((current) =>
      current.filter((item) => item !== terminalId)
    );
    setPaneConnectionStates((current) => ({
      ...current,
      [paneId]: "reconnecting"
    }));
    paneApiRef.current[paneId]?.reconnect();
    setActionMenu(null);
    notifyTerminal(t("terminal.reconnectRequested"));
  }

  function updateZoomScale(nextZoomScale: number): void {
    setZoomScale(clampZoomScale(nextZoomScale));
  }

  function applySplitLayout(nextDirection: SplitDirection): void {
    if (isMobileTerminalPage) {
      return;
    }

    if (nextDirection === "single") {
      updatePaneBindings((current) => {
        const focusedTerminalId =
          activePaneIdRef.current === "secondary" ? current.secondary ?? current.primary : current.primary;

        return {
          primary: focusedTerminalId,
          secondary: null
        };
      });
      updateSplitDirection("single");
      updateActivePane("primary");
      return;
    }

    updateSplitDirection(nextDirection);
    updatePaneBindings((current) =>
      normalizePaneBindings({
        terminals,
        currentBindings: current,
        splitDirection: nextDirection,
        fallbackTerminalId: current[activePaneIdRef.current] ?? current.primary,
        preferredPaneId: activePaneIdRef.current
      })
    );
  }

  async function handleSaveActivePaneLog(): Promise<void> {
    if (!activeTerminal) {
      return;
    }

    try {
      const content = readTerminalContent({
        terminalId: activeTerminal.id,
        splitDirection: effectiveSplitDirection,
        paneBindings: effectivePaneBindings,
        paneApiById: paneApiRef.current
      });

      if (!content.trim()) {
        notifyTerminal(t("terminal.logEmpty"), "warning");
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeName = sanitizeFileName(activeTerminal.name || "terminal");
      const fileName = `${safeName}-${timestamp}.log`;
      downloadTextFile(fileName, content);
      notifyTerminal(t("terminal.saveLogSuccess"), "success");
    } catch (error) {
      notifyTerminal(error instanceof Error ? error.message : t("terminal.saveLogFailed"), "error");
    }
  }

  function handleMobileStageSwipe(direction: "left" | "right"): void {
    if (!isMobileTerminalPage) {
      return;
    }

    if (direction === "right") {
      setMobileQuickDrawerOpen(true);
      return;
    }

    setMobileQuickDrawerOpen(false);
  }

  function handleMobileStageTouchStart(event: TouchEvent<HTMLDivElement>): void {
    if (!isMobileTerminalPage || mobileQuickDrawerOpen) {
      return;
    }

    const touch = event.touches[0];

    if (!touch) {
      return;
    }

    mobileStageTouchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY
    };
  }

  function handleMobileStageTouchEnd(event: TouchEvent<HTMLDivElement>): void {
    if (!isMobileTerminalPage || mobileQuickDrawerOpen) {
      mobileStageTouchStartRef.current = null;
      return;
    }

    const startPoint = mobileStageTouchStartRef.current;
    const touch = event.changedTouches[0];
    mobileStageTouchStartRef.current = null;

    if (!startPoint || !touch) {
      return;
    }

    const deltaX = touch.clientX - startPoint.x;
    const deltaY = touch.clientY - startPoint.y;

    if (
      Math.abs(deltaX) < TERMINAL_MOBILE_SWIPE_THRESHOLD ||
      Math.abs(deltaY) > TERMINAL_MOBILE_SWIPE_OFF_AXIS_THRESHOLD ||
      Math.abs(deltaX) <= Math.abs(deltaY) ||
      deltaX < 0
    ) {
      return;
    }

    handleMobileStageSwipe("right");
  }

  return (
    <main className="terminal-layout mobile-page-fixed-root">
      <TerminalRuntimeFallbackModal
        open={runtimeFallbackRequest !== null}
        busy={applyingRuntimeFallback}
        onClose={() => {
          if (applyingRuntimeFallback) {
            return;
          }

          setRuntimeFallbackRequest(null);
        }}
        onConfirmFallback={() => {
          void handleConfirmRuntimeFallback();
        }}
      />
      <section className="terminal-shell" data-mobile={isMobileTerminalPage}>
        {isMobileTerminalPage ? (
          <>
            <MobileWorkspaceSwitcherHeader
              className="terminal-mobile-page-header"
              currentWorkspace={mobileHeaderWorkspace}
              workspaces={workspaces}
              onSelectWorkspace={(workspaceId) => {
                selectWorkspace(workspaceId);
                setSelectedWorkspaceId(workspaceId);
              }}
              trailing={
                <div className="terminal-mobile-header-actions">
                  <button
                    type="button"
                    className="terminal-mobile-header-action"
                    aria-label={t("terminal.mobileCreateSheetTitle")}
                    disabled={!resolvedWorkspaceId || creatingTerminal}
                    onClick={() => {
                      void openMobileCreateSheet();
                    }}
                  >
                    <PlusIcon />
                  </button>
                  <button
                    type="button"
                    className="terminal-mobile-header-action"
                    aria-label={t("terminal.mobileDrawerAction")}
                    onClick={() => {
                      setMobileQuickDrawerOpen(true);
                    }}
                  >
                    <SessionDrawerIcon />
                  </button>
                </div>
              }
            />

            <div className="terminal-stage-surface terminal-stage-surface-mobile">
              <div
                className="terminal-mobile-edge-swipe-zone"
                aria-hidden="true"
                onTouchStart={handleMobileStageTouchStart}
                onTouchEnd={handleMobileStageTouchEnd}
                onTouchCancel={() => {
                  mobileStageTouchStartRef.current = null;
                }}
              />
              <div className="terminal-stage-grid" data-layout="single" data-mobile="true">
                <TerminalWorkspacePane
                  key={`mobile-${activeTerminal?.id ?? "empty"}`}
                  paneId="primary"
                  paneLabel={t("terminal.panePrimary")}
                  terminal={activeTerminal}
                  pendingCreation={!activeTerminal && pendingTerminalCreationPaneId === "primary"}
                  zoomScale={zoomScale}
                  active
                  isMobileLayout
                  onActivate={activatePane}
                  onSwipeGesture={handleMobileStageSwipe}
                  onConnectionChange={handlePaneConnectionChange}
                  onTerminalStatus={handleTerminalStatus}
                  onRequireReload={requestReload}
                  onUnauthorized={handleUnauthorized}
                  registerApi={registerPaneApi}
                  notifyTerminal={notifyTerminal}
                  canCreateTerminal={Boolean(resolvedWorkspaceId)}
                  onRequestCreateTerminal={() => {
                    void openMobileCreateSheet();
                  }}
                  onRequestOpenTerminalDrawer={() => {
                    setMobileQuickDrawerOpen(true);
                  }}
                />
              </div>
            </div>

            <MobileTerminalQuickDrawer
              open={mobileQuickDrawerOpen}
              terminals={orderedTerminals}
              pinnedTerminalIds={pinnedTerminalIdSet}
              activeTerminalId={activeTerminal?.id ?? null}
              creatingTerminal={creatingTerminal}
              onClose={() => {
                setMobileQuickDrawerOpen(false);
              }}
              onCreateTerminal={() => {
                setMobileQuickDrawerOpen(false);
                void openMobileCreateSheet();
              }}
              onSelectTerminal={(terminalId) => {
                bindTerminalToPane(terminalId, "primary");
                setMobileQuickDrawerOpen(false);
              }}
            />

            <MobileTerminalCreateSheet
              open={mobileCreateSheetOpen}
              loading={loadingShellOptions}
              creating={creatingTerminal}
              shellChoices={mobileShellChoices}
              selectedShell={mobileSelectedShell}
              runtimeType={selectedRuntimeType || "tmux"}
              onClose={() => {
                if (creatingTerminal) {
                  return;
                }

                setMobileCreateSheetOpen(false);
              }}
              onSelectShell={setMobileSelectedShell}
              onSelectRuntime={(runtimeType) => {
                setSelectedRuntimeType(runtimeType);
              }}
              onConfirm={() => {
                void handleCreateTerminalFromMobileSheet();
              }}
            />
          </>
        ) : (
          <>
            <header className="terminal-tabbar" {...dragRegionProps}>
              <div ref={terminalTabbarMainRef} className="terminal-tabbar-main" {...dragRegionProps}>
                <div
                  ref={terminalTabbarScrollRef}
                  className="terminal-tabbar-scroll"
                  role="tablist"
                  aria-label={t("terminal.title")}
                  {...dragRegionProps}
                >
                  {orderedTerminals.map((terminal) => {
                    const isActive = terminal.id === activeTerminalId;
                    const isPinned = pinnedTerminalIdSet.has(terminal.id);
                    const menuOpen = actionMenu?.terminalId === terminal.id;
                    const pendingMutation = terminalMutations[terminal.id] ?? null;
                    const indicatorStatus = pendingMutation
                      ? "creating"
                      : resolveTerminalIndicatorStatus({
                          terminal,
                          paneBindings: effectivePaneBindings,
                          paneConnectionStates: effectivePaneConnectionStates,
                          manuallyDisconnectedTerminalIdSet
                        });

                    return (
                      <div
                        key={terminal.id}
                        className="terminal-tab-shell"
                        data-active={isActive}
                        data-assigned={isTerminalAssigned(
                          terminal.id,
                          effectivePaneBindings,
                          effectiveSplitDirection
                        )}
                      >
                        <button
                          className="terminal-tab"
                          data-active={isActive}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          aria-busy={pendingMutation !== null}
                          onClick={() => {
                            bindTerminalToActivePane(terminal.id);
                          }}
                          onAuxClick={(event) => {
                            if (event.button !== 1 || pendingMutation !== null) {
                              return;
                            }

                            event.preventDefault();
                            void handleCloseTerminal(terminal.id);
                          }}
                        >
                          <span className="terminal-tab-name">
                            <span
                              className="terminal-tab-status-dot"
                              data-status={indicatorStatus}
                              aria-hidden="true"
                            />
                            {isPinned ? <span className="terminal-tab-pin-indicator">•</span> : null}
                            <span className="terminal-tab-name-text">{terminal.name}</span>
                            <span
                              className="terminal-tab-runtime"
                              title={getTerminalRuntimeLabel(terminal.runtimeType)}
                            >
                              {getTerminalRuntimeShortLabel(terminal.runtimeType)}
                            </span>
                            {pendingMutation ? (
                              <span
                                className="terminal-tab-operation"
                                data-operation={pendingMutation}
                              >
                                <span
                                  className="terminal-tab-operation-spinner"
                                  aria-hidden="true"
                                />
                                {pendingMutation === "closing"
                                  ? t("terminal.closePendingBadge")
                                  : t("terminal.deletePendingBadge")}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <button
                          ref={(node) => {
                            terminalActionMenuTriggerRef.current[terminal.id] = node;
                          }}
                          className="terminal-tab-inline-action"
                          type="button"
                          data-open={menuOpen}
                          disabled={pendingMutation !== null}
                          aria-haspopup="menu"
                          aria-label={t("terminal.moreActions")}
                          aria-expanded={menuOpen}
                          onClick={(event) => {
                            event.stopPropagation();

                            if (menuOpen) {
                              setActionMenu(null);
                              return;
                            }

                            setActionMenu(
                              buildActionMenuState(terminal.id, event.currentTarget) ?? {
                                terminalId: terminal.id,
                                top: 0,
                                left: 0
                              }
                            );
                          }}
                        >
                          ⋯
                        </button>
                      </div>
                    );
                  })}
                  {pendingTerminalCreationPaneId ? (
                    <div
                      className="terminal-tab-shell"
                      role="presentation"
                      data-active={activeTerminalId === null && activePaneId === pendingTerminalCreationPaneId}
                      data-assigned="false"
                      data-pending="true"
                    >
                      <div className="terminal-tab" aria-hidden="true">
                        <span className="terminal-tab-name">
                          <span
                            className="terminal-tab-status-dot"
                            data-status="creating"
                            aria-hidden="true"
                          />
                          <span className="terminal-tab-name-text">{t("terminal.creating")}</span>
                          <span
                            className="terminal-tab-runtime"
                            title={getTerminalRuntimeLabel(selectedRuntimeType || undefined)}
                          >
                            {getTerminalRuntimeShortLabel(selectedRuntimeType || undefined)}
                          </span>
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <button
                    className="terminal-tab-control"
                    type="button"
                    aria-label={t("terminal.createButton")}
                    title={t("terminal.createButton")}
                    disabled={!selectedWorkspaceId || creatingTerminal}
                    onClick={() => {
                      void handleCreateTerminal();
                    }}
                  >
                    <span className="terminal-toolbar-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" focusable="false">
                        <path d="M8 3.25a.75.75 0 0 1 .75.75v3.25H12a.75.75 0 0 1 0 1.5H8.75V12a.75.75 0 0 1-1.5 0V8.75H4A.75.75 0 0 1 4 7.25h3.25V4A.75.75 0 0 1 8 3.25Z" />
                      </svg>
                    </span>
                  </button>
                </div>

                <div className="terminal-tabbar-inline-actions">
                  <div className="terminal-toolbar-anchor">
                    <div
                      ref={toolbarRef}
                      className="terminal-toolbar-inline"
                      data-open={toolbarOpen}
                      aria-hidden={!toolbarOpen}
                    >
                      <div className="terminal-toolbar-cluster">
                        <div className="terminal-toolbar-section">
                          <span className="terminal-toolbar-label">{t("terminal.runtimeField")}</span>
                          <select
                            className="terminal-runtime-select"
                            value={selectedRuntimeType}
                            aria-label={t("terminal.runtimeField")}
                            title={
                              runtimeOptions.find((option) => option.value === selectedRuntimeType)
                                ?.description
                            }
                            onChange={(event) => {
                              setSelectedRuntimeType(event.target.value as SelectableTerminalRuntimeType);
                            }}
                          >
                            {runtimeOptions.map((option) => (
                              <option key={option.value || "auto"} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="terminal-toolbar-section">
                          <span className="terminal-toolbar-label">{t("terminal.zoomLabel")}</span>
                          <div className="terminal-zoom-group" aria-label={t("terminal.zoomLabel")}>
                            <button
                              type="button"
                              className="terminal-zoom-button"
                              aria-label={t("terminal.zoomOutAction")}
                              onClick={() => {
                                updateZoomScale(zoomScale - TERMINAL_ZOOM_STEP);
                              }}
                            >
                              -
                            </button>
                            <button
                              type="button"
                              className="terminal-zoom-value"
                              aria-label={t("terminal.zoomResetAction")}
                              onClick={() => {
                                updateZoomScale(1);
                              }}
                            >
                              {formatZoomPercent(zoomScale)}
                            </button>
                            <button
                              type="button"
                              className="terminal-zoom-button"
                              aria-label={t("terminal.zoomInAction")}
                              onClick={() => {
                                updateZoomScale(zoomScale + TERMINAL_ZOOM_STEP);
                              }}
                            >
                              +
                            </button>
                          </div>
                        </div>

                        <div className="terminal-toolbar-section">
                          <span className="terminal-toolbar-label">{t("terminal.layoutLabel")}</span>
                          <div className="terminal-layout-switcher">
                            <button
                              type="button"
                              className="terminal-layout-button"
                              data-active={splitDirection === "single"}
                              aria-label={t("terminal.layoutSingleAction")}
                              onClick={() => {
                                applySplitLayout("single");
                              }}
                            >
                              1
                            </button>
                            <button
                              type="button"
                              className="terminal-layout-button"
                              data-active={splitDirection === "vertical"}
                              aria-label={t("terminal.layoutVerticalAction")}
                              onClick={() => {
                                applySplitLayout("vertical");
                              }}
                            >
                              ||
                            </button>
                            <button
                              type="button"
                              className="terminal-layout-button"
                              data-active={splitDirection === "horizontal"}
                              aria-label={t("terminal.layoutHorizontalAction")}
                              onClick={() => {
                                applySplitLayout("horizontal");
                              }}
                            >
                              =
                            </button>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="terminal-toolbar-save"
                          disabled={!activeTerminal}
                          onClick={() => {
                            void handleSaveActivePaneLog();
                          }}
                        >
                          {t("terminal.saveLogAction")}
                        </button>
                      </div>
                    </div>

                    <button
                      ref={toolbarToggleRef}
                      type="button"
                      className="terminal-toolbar-toggle terminal-toolbar-toggle-tool"
                      data-open={toolbarOpen}
                      aria-label={t("terminal.toolbarToggleAction")}
                      aria-expanded={toolbarOpen}
                      onClick={() => {
                        setActionMenu(null);
                        setToolbarOpen((current) => !current);
                      }}
                    >
                      <span className="terminal-toolbar-icon terminal-toolbar-icon-tool" aria-hidden="true">
                        <svg viewBox="0 0 20 20" fill="none" focusable="false">
                          <path
                            d="M13.1 3.3a3.1 3.1 0 0 0-2.4 3.77L4.95 12.82a1.5 1.5 0 1 0 2.12 2.12l5.74-5.74a3.1 3.1 0 0 0 3.77-2.4l-1.76.5a1.06 1.06 0 0 1-1.04-.28l-1.3-1.3a1.06 1.06 0 0 1-.28-1.04l.9-1.38Z"
                            stroke="currentColor"
                            strokeWidth="1.35"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="m5.85 11.92 2.22 2.22"
                            stroke="currentColor"
                            strokeWidth="1.35"
                            strokeLinecap="round"
                          />
                        </svg>
                      </span>
                    </button>
                  </div>
                </div>
                {actionMenu && actionMenuTerminal ? (
                  <TerminalActionMenu
                    ref={terminalActionMenuRef}
                    actionMenu={actionMenu}
                    terminal={actionMenuTerminal}
                    paneBindings={effectivePaneBindings}
                    splitDirection={effectiveSplitDirection}
                    activePaneId={effectiveActivePaneId}
                    paneConnectionStates={effectivePaneConnectionStates}
                    pinnedTerminalIdSet={pinnedTerminalIdSet}
                    manuallyDisconnectedTerminalIdSet={manuallyDisconnectedTerminalIdSet}
                    pendingMutation={terminalMutations[actionMenuTerminal.id] ?? null}
                    onBindToActivePane={bindTerminalToActivePane}
                    onBindToPane={bindTerminalToPane}
                    onDuplicate={handleDuplicateTerminal}
                    onDisconnect={handleDisconnectTerminal}
                    onReconnect={handleReconnectTerminal}
                    onClose={handleCloseTerminal}
                    onDelete={handleDeleteTerminal}
                    onTogglePin={handleTogglePin}
                    onCloseMenu={() => {
                      setActionMenu(null);
                    }}
                  />
                ) : null}
              </div>
            </header>

            <div className="terminal-stage-surface">
              <div className="terminal-stage-grid" data-layout={effectiveSplitDirection} data-mobile="false">
                {visiblePaneIds.map((paneId) => {
                  const terminalId = effectivePaneBindings[paneId];
                  const terminal = terminals.find((item) => item.id === terminalId) ?? null;

                  return (
                    <TerminalWorkspacePane
                      key={`${paneId}-${terminal?.id ?? "empty"}`}
                      paneId={paneId}
                      paneLabel={paneId === "primary" ? t("terminal.panePrimary") : t("terminal.paneSecondary")}
                      terminal={terminal}
                      pendingCreation={!terminal && pendingTerminalCreationPaneId === paneId}
                      zoomScale={zoomScale}
                      active={effectiveActivePaneId === paneId}
                      onActivate={activatePane}
                      onConnectionChange={handlePaneConnectionChange}
                      onTerminalStatus={handleTerminalStatus}
                      onRequireReload={requestReload}
                      onUnauthorized={handleUnauthorized}
                      registerApi={registerPaneApi}
                      notifyTerminal={notifyTerminal}
                    />
                  );
                })}
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function MobileTerminalQuickDrawer({
  open,
  terminals,
  pinnedTerminalIds,
  activeTerminalId,
  creatingTerminal,
  onClose,
  onCreateTerminal,
  onSelectTerminal
}: {
  open: boolean;
  terminals: TerminalDto[];
  pinnedTerminalIds: ReadonlySet<string>;
  activeTerminalId: string | null;
  creatingTerminal: boolean;
  onClose: () => void;
  onCreateTerminal: () => void;
  onSelectTerminal: (terminalId: string) => void;
}) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const pinnedTerminals = terminals.filter((terminal) => pinnedTerminalIds.has(terminal.id));
  const otherTerminals = terminals.filter((terminal) => !pinnedTerminalIds.has(terminal.id));

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <div
        className="terminal-mobile-drawer-overlay"
        role="button"
        tabIndex={0}
        aria-label={t("common.back")}
        onClick={onClose}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
      />
      <section
        className="terminal-mobile-drawer-panel terminal-mobile-session-drawer"
        aria-label={t("terminal.mobileDrawerTitle")}
        onTouchStart={(event) => {
          const touch = event.touches[0];

          if (!touch) {
            return;
          }

          touchStartRef.current = {
            x: touch.clientX,
            y: touch.clientY
          };
        }}
        onTouchEnd={(event) => {
          const startPoint = touchStartRef.current;
          const touch = event.changedTouches[0];
          touchStartRef.current = null;

          if (!startPoint || !touch) {
            return;
          }

          const deltaX = touch.clientX - startPoint.x;
          const deltaY = touch.clientY - startPoint.y;

          if (
            Math.abs(deltaX) < TERMINAL_MOBILE_SWIPE_THRESHOLD ||
            Math.abs(deltaY) > TERMINAL_MOBILE_SWIPE_OFF_AXIS_THRESHOLD ||
            Math.abs(deltaX) <= Math.abs(deltaY) ||
            deltaX >= 0
          ) {
            return;
          }

          onClose();
        }}
        onTouchCancel={() => {
          touchStartRef.current = null;
        }}
      >
        <div className="workbench-nav-header terminal-mobile-session-drawer-header">
          <div className="workbench-nav-header-main">
            <h1>{t("terminal.mobileDrawerTitle")}</h1>
            <p>{t("terminal.mobileDrawerDescription")}</p>
          </div>
        </div>

        <div className="workbench-nav-body terminal-mobile-session-drawer-body">
          {pinnedTerminals.length > 0 ? (
            <section className="workbench-section-block">
              <div className="workbench-section-heading">
                <div className="workbench-section-heading-main">
                  <span>{t("terminal.mobilePinnedSectionTitle")}</span>
                </div>
                <span className="workbench-section-counter">{pinnedTerminals.length}</span>
              </div>
              <div className="workbench-session-list">
                {pinnedTerminals.map((terminal) => (
                  <TerminalMobileSessionEntry
                    key={terminal.id}
                    terminal={terminal}
                    active={terminal.id === activeTerminalId}
                    onOpen={onSelectTerminal}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="workbench-section-block">
            <div className="workbench-section-heading">
              <div className="workbench-section-heading-main">
                <span>{t("terminal.workspaceField")}</span>
              </div>
              <span className="workbench-section-counter">{otherTerminals.length}</span>
            </div>
            {otherTerminals.length > 0 ? (
              <div className="workbench-session-list">
                {otherTerminals.map((terminal) => (
                  <TerminalMobileSessionEntry
                    key={terminal.id}
                    terminal={terminal}
                    active={terminal.id === activeTerminalId}
                    onOpen={onSelectTerminal}
                  />
                ))}
              </div>
            ) : (
              <div className="workbench-session-empty">{t("terminal.mobileDrawerEmptyDescription")}</div>
            )}
          </section>
        </div>

        <div className="workbench-nav-footer minimal terminal-mobile-session-drawer-footer">
          <button
            type="button"
            className="workbench-import-toggle terminal-mobile-session-drawer-action"
            disabled={creatingTerminal}
            onClick={onCreateTerminal}
          >
            <span className="workbench-import-toggle-symbol">+</span>
            <span className="workbench-import-toggle-label">{t("terminal.createButton")}</span>
          </button>
        </div>
      </section>
    </>,
    document.body
  );
}

function TerminalMobileSessionEntry({
  terminal,
  active,
  onOpen
}: {
  terminal: TerminalDto;
  active: boolean;
  onOpen: (terminalId: string) => void;
}) {
  return (
    <button
      type="button"
      className="workbench-session-link terminal-mobile-session-link"
      data-active={active ? "true" : "false"}
      onClick={() => {
        onOpen(terminal.id);
      }}
    >
      <div className="session-title-row">
        <span className={buildTerminalSessionIndicatorClassName(terminal.status)} />
        <span className="session-title" title={terminal.name}>
          {terminal.name}
        </span>
      </div>
      <div className="session-meta-row">
        <span className="session-meta">{terminal.cwd}</span>
        <span className="terminal-mobile-session-runtime-badge">
          {getTerminalRuntimeShortLabel(terminal.runtimeType)}
        </span>
      </div>
    </button>
  );
}

function MobileTerminalCreateSheet({
  open,
  loading,
  creating,
  shellChoices,
  selectedShell,
  runtimeType,
  onClose,
  onSelectShell,
  onSelectRuntime,
  onConfirm
}: {
  open: boolean;
  loading: boolean;
  creating: boolean;
  shellChoices: MobileTerminalShellChoice[];
  selectedShell: string;
  runtimeType: SelectableTerminalRuntimeType;
  onClose: () => void;
  onSelectShell: (shell: string) => void;
  onSelectRuntime: (runtimeType: SelectableTerminalRuntimeType) => void;
  onConfirm: () => void;
}) {
  if (!open || typeof document === "undefined") {
    return null;
  }

  const selectedShellChoice =
    shellChoices.find((option) => option.value === selectedShell) ?? shellChoices[0] ?? null;
  const runtimeCards: Array<{
    value: SelectableTerminalRuntimeType;
    title: string;
    description: string;
  }> = [
    {
      value: "tmux",
      title: t("terminal.mobileRuntimePersistentTitle"),
      description: t("terminal.mobileRuntimePersistentDescription")
    },
    {
      value: "embedded-pty",
      title: t("terminal.mobileRuntimeSessionTitle"),
      description: t("terminal.mobileRuntimeSessionDescription")
    }
  ];
  const confirmDisabled =
    creating ||
    loading ||
    !selectedShellChoice ||
    !selectedShellChoice.available;

  return createPortal(
    <div className="ios-action-sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="mobile-workspace-home-sheet terminal-mobile-create-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("terminal.mobileCreateSheetTitle")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mobile-workspace-home-sheet-card terminal-mobile-create-sheet-card">
          <div className="mobile-workspace-home-sheet-header">
            <strong>{t("terminal.mobileCreateSheetTitle")}</strong>
          </div>

          <div className="terminal-mobile-create-sheet-body">
            <section className="terminal-mobile-create-section">
              <div className="terminal-mobile-create-section-copy">
                <strong>{t("terminal.mobileCreateShellLabel")}</strong>
                <p>{t("terminal.mobileCreateShellDescription")}</p>
              </div>
              {loading && shellChoices.length === 0 ? (
                <div className="terminal-mobile-create-loading">
                  <span className="terminal-pending-indicator" aria-hidden="true" />
                  <span>{t("terminal.mobileCreateLoadingShells")}</span>
                </div>
              ) : (
                <div className="terminal-mobile-choice-grid" role="list">
                  {shellChoices.map((option) => {
                    const selected = option.value === selectedShell;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        className="terminal-mobile-choice-card"
                        data-selected={selected ? "true" : "false"}
                        disabled={!option.available || creating}
                        onClick={() => {
                          onSelectShell(option.value);
                        }}
                      >
                        <span className="terminal-mobile-choice-copy">
                          <strong>{option.label}</strong>
                          <span>{option.description}</span>
                        </span>
                        {!option.available && option.unavailableReason ? (
                          <span className="terminal-mobile-choice-badge terminal-mobile-choice-badge-muted">
                            {option.unavailableReason}
                          </span>
                        ) : selected ? (
                          <span className="terminal-mobile-choice-badge">{t("settings.enabled")}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="terminal-mobile-create-section">
              <div className="terminal-mobile-create-section-copy">
                <strong>{t("terminal.mobileCreateRuntimeLabel")}</strong>
                <p>{t("terminal.mobileCreateRuntimeDescription")}</p>
              </div>
              <div className="terminal-mobile-choice-grid" role="list">
                {runtimeCards.map((option) => {
                  const selected = option.value === runtimeType;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className="terminal-mobile-choice-card"
                      data-selected={selected ? "true" : "false"}
                      disabled={creating}
                      onClick={() => {
                        onSelectRuntime(option.value);
                      }}
                    >
                      <span className="terminal-mobile-choice-copy">
                        <strong>{option.title}</strong>
                        <span>{option.description}</span>
                      </span>
                      {selected ? (
                        <span className="terminal-mobile-choice-badge">{t("settings.enabled")}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>

            <button
              type="button"
              className="terminal-mobile-primary-action terminal-mobile-create-confirm"
              disabled={confirmDisabled}
              onClick={onConfirm}
            >
              {creating ? t("terminal.creating") : t("terminal.mobileCreateConfirm")}
            </button>
          </div>
        </div>

        <button type="button" className="ios-action-sheet-cancel" disabled={creating} onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </div>,
    document.body
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 3.25v9.5M3.25 8h9.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function SessionDrawerIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M4 4.75h10M4 9h10M4 13.25h7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

const TerminalActionMenu = forwardRef<HTMLDivElement, TerminalActionMenuProps>(function TerminalActionMenu(
  {
    actionMenu,
    terminal,
    pendingMutation,
    paneBindings,
    splitDirection,
    activePaneId,
    paneConnectionStates,
    pinnedTerminalIdSet,
    manuallyDisconnectedTerminalIdSet,
    onBindToActivePane,
    onBindToPane,
    onDuplicate,
    onDisconnect,
    onReconnect,
    onClose,
    onDelete,
    onTogglePin,
    onCloseMenu
  },
  ref
) {
  const isPinned = pinnedTerminalIdSet.has(terminal.id);
  const assignedPaneId = findPaneIdByTerminalId(
    terminal.id,
    paneBindings,
    splitDirection,
    activePaneId
  );
  const activeConnectionState = assignedPaneId ? paneConnectionStates[assignedPaneId] : "closed";
  const indicatorStatus = resolveTerminalIndicatorStatus({
    terminal,
    paneBindings,
    paneConnectionStates,
    manuallyDisconnectedTerminalIdSet
  });
  const showCloseAction =
    pendingMutation === null && terminal.status === "running" && indicatorStatus !== "disconnected";
  const showDeleteAction = pendingMutation === null && !showCloseAction;
  const canControlConnection =
    pendingMutation === null && assignedPaneId !== null && terminal.status === "running";
  const showSplitPaneBindings = splitDirection !== "single";

  return (
    <div
      ref={ref}
      className="terminal-tab-menu"
      role="menu"
      style={{
        top: `${actionMenu.top}px`,
        left: `${actionMenu.left}px`
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      {showSplitPaneBindings ? (
        <>
          <button
            type="button"
            className="terminal-tab-menu-item"
            role="menuitem"
            disabled={pendingMutation !== null || paneBindings.primary === terminal.id}
            onClick={() => {
              onBindToPane(terminal.id, "primary");
            }}
          >
            {t("terminal.bindToPrimaryPaneAction")}
          </button>
          <button
            type="button"
            className="terminal-tab-menu-item"
            role="menuitem"
            disabled={pendingMutation !== null || paneBindings.secondary === terminal.id}
            onClick={() => {
              onBindToPane(terminal.id, "secondary");
            }}
          >
            {t("terminal.bindToSecondaryPaneAction")}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="terminal-tab-menu-item"
          role="menuitem"
          disabled={pendingMutation !== null || paneBindings.primary === terminal.id}
          onClick={() => {
            onBindToActivePane(terminal.id);
          }}
        >
          {t("terminal.bindToPaneAction")}
        </button>
      )}
      <button
        type="button"
        className="terminal-tab-menu-item"
        role="menuitem"
        disabled={pendingMutation !== null}
        onClick={() => {
          onCloseMenu();
          void onDuplicate(terminal);
        }}
      >
        {t("terminal.duplicateAction")}
      </button>
      {canControlConnection ? (
        <>
          <div className="terminal-tab-menu-divider" role="separator" />
          {activeConnectionState === "connected" ? (
            <button
              type="button"
              className="terminal-tab-menu-item"
              role="menuitem"
              disabled={pendingMutation !== null}
              onClick={() => {
                onDisconnect(terminal.id);
              }}
            >
              {t("terminal.disconnectAction")}
            </button>
          ) : (
            <button
              type="button"
              className="terminal-tab-menu-item"
              role="menuitem"
              disabled={pendingMutation !== null}
              onClick={() => {
                onReconnect(terminal.id);
              }}
            >
              {t("terminal.reconnectAction")}
            </button>
          )}
        </>
      ) : null}
      <div className="terminal-tab-menu-divider" role="separator" />
      {showCloseAction ? (
        <button
          type="button"
          className="terminal-tab-menu-item"
          role="menuitem"
          onClick={() => {
            onCloseMenu();
            void onClose(terminal.id);
          }}
        >
          {t("terminal.closeButton")}
        </button>
      ) : null}
      {showDeleteAction ? (
        <button
          type="button"
          className="terminal-tab-menu-item"
          role="menuitem"
          onClick={() => {
            void onDelete(terminal.id);
          }}
        >
          {t("terminal.deleteAction")}
        </button>
      ) : null}
      <button
        type="button"
        className="terminal-tab-menu-item"
        role="menuitem"
        disabled={pendingMutation !== null}
        onClick={() => {
          onTogglePin(terminal.id);
        }}
      >
        {isPinned ? t("terminal.unpinAction") : t("terminal.pinAction")}
      </button>
    </div>
  );
});

function TerminalWorkspacePane({
  paneId,
  paneLabel,
  terminal,
  pendingCreation,
  zoomScale,
  active,
  isMobileLayout = false,
  canCreateTerminal = true,
  onActivate,
  onSwipeGesture,
  onConnectionChange,
  onTerminalStatus,
  onRequireReload,
  onUnauthorized,
  registerApi,
  notifyTerminal,
  onRequestCreateTerminal,
  onRequestOpenTerminalDrawer
}: TerminalWorkspacePaneProps) {
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const realtimeClientRef = useRef<TerminalRealtimeClient | null>(null);
  const viewportRuntimeRef = useRef<TerminalViewportRuntime | null>(null);
  const activeCursorRef = useRef<string | null>(null);
  const activeRecoveryStateRef = useRef<"idle_closed" | null>(null);
  const activeTerminalStatusRef = useRef<TerminalDto["status"] | null>(terminal?.status ?? null);
  const activePaneRef = useRef(active);

  useEffect(() => {
    activeTerminalStatusRef.current = terminal?.status ?? null;
  }, [terminal?.status]);

  useEffect(() => {
    activePaneRef.current = active;
  }, [active]);

  useEffect(() => {
    if (active) {
      viewportRuntimeRef.current?.focus();
    }
  }, [active, terminal?.id]);

  useEffect(() => {
    viewportRuntimeRef.current?.setFontSize(buildTerminalFontSize(zoomScale));
    viewportRuntimeRef.current?.reflow();
  }, [zoomScale]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const applyTheme = () => {
      viewportRuntimeRef.current?.applyTheme();
    };

    applyTheme();

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "data-theme")) {
        applyTheme();
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    return () => {
      observer.disconnect();
    };
  }, [terminal?.id]);

  useEffect(() => {
    viewportRuntimeRef.current?.dispose();
    viewportRuntimeRef.current = null;
    registerApi(paneId, null);

    if (!terminal?.id || !terminalContainerRef.current) {
      return;
    }

    const persistedViewState = readTerminalRecoveryState(terminal.id).viewState;
    const runtime = createTerminalViewportRuntime({
      container: terminalContainerRef.current,
      restoredViewState: persistedViewState,
      fontSize: buildTerminalFontSize(zoomScale),
      getCursor: () => activeCursorRef.current,
      canResize: () => activeTerminalStatusRef.current === "running",
      onInput: (content) => {
        realtimeClientRef.current?.sendInput(content);
      },
      onResize: ({ cols, rows }) => {
        realtimeClientRef.current?.resize(cols, rows);
      },
      onViewStateChange: (viewState) => {
        persistTerminalViewState(terminal.id, viewState);
      }
    });

    viewportRuntimeRef.current = runtime;
    registerApi(paneId, {
      focus: () => {
        runtime.focus();
      },
      readPlainText: () => {
        return runtime.readPlainText();
      },
      disconnect: () => {
        realtimeClientRef.current?.disconnect();
      },
      reconnect: () => {
        realtimeClientRef.current?.reconnectNow();
      }
    });

    return () => {
      runtime.persistNow();
      runtime.dispose();
      if (viewportRuntimeRef.current === runtime) {
        viewportRuntimeRef.current = null;
      }
      registerApi(paneId, null);
    };
  }, [paneId, registerApi, terminal?.id, zoomScale]);

  useEffect(() => {
    realtimeClientRef.current?.close();
    realtimeClientRef.current = null;
    activeRecoveryStateRef.current = null;
    onConnectionChange(paneId, "closed");

    if (!terminal?.id) {
      activeCursorRef.current = null;
      return;
    }

    const recoveryState = readTerminalRecoveryState(terminal.id);
    const persistedViewState = recoveryState.viewState;
    const resumeCursor = recoveryState.resumeCursor;
    activeCursorRef.current = resumeCursor;

    const client = new TerminalRealtimeClient({
      terminalId: terminal.id,
      lastCursor: resumeCursor,
      onConnectionChange: (state: TerminalConnectionState) => {
        onConnectionChange(paneId, state);
      },
      onSubscribed: () => {
        const runtime = viewportRuntimeRef.current;

        if (runtime) {
          runtime.reflow();
          client.sendCurrentDimensions(runtime.terminal.cols, runtime.terminal.rows);
        }

        if (activePaneRef.current) {
          viewportRuntimeRef.current?.focus();
        }
      },
      onBackfill: (event) => {
        const runtime = viewportRuntimeRef.current;

        if (runtime) {
          if (event.cursorReset) {
            replaceTerminalChunks(runtime.terminal, event.chunks);
          } else if (runtime.restoredFromSnapshot) {
            appendTerminalChunks(runtime.terminal, event.chunks);
          } else {
            replaceTerminalChunks(runtime.terminal, event.chunks);
          }

          runtime.schedulePersist();
        }

        const nextCursor = event.latestCursor ?? activeCursorRef.current;
        activeCursorRef.current = nextCursor;
        persistTerminalCursor(terminal.id, nextCursor);

        if (activeRecoveryStateRef.current === "idle_closed") {
          notifyTerminal(t("terminal.recoveryIdleClosed"), "warning");
          return;
        }

        if (resumeCursor) {
          notifyTerminal(
            event.truncated ? t("terminal.recoveryTruncated") : t("terminal.recoveryComplete"),
            event.truncated ? "warning" : "success"
          );
          return;
        }

        if (!persistedViewState?.content) {
          notifyTerminal(t("terminal.connectedHint"));
        }
      },
      onOutput: (event) => {
        viewportRuntimeRef.current?.terminal.write(event.chunk.content);
        viewportRuntimeRef.current?.schedulePersist();
        activeCursorRef.current = event.chunk.cursor;
        persistTerminalCursor(terminal.id, event.chunk.cursor);
      },
      onStatus: (event) => {
        onTerminalStatus({
          id: event.terminal.id,
          status: event.terminal.status,
          statusDetail: event.terminal.statusDetail,
          processId: event.terminal.processId ?? null
        });

        if (event.terminal.id !== terminal.id) {
          return;
        }

        activeTerminalStatusRef.current = event.terminal.status;
        if (event.terminal.status !== "running") {
          onConnectionChange(paneId, "closed");
        }

        if (event.terminal.status === "closed" && event.terminal.statusDetail === "TERMINAL_IDLE_TIMEOUT") {
          activeRecoveryStateRef.current = "idle_closed";
          notifyTerminal(t("terminal.recoveryIdleClosed"), "warning");
          return;
        }

        if (event.terminal.status === "error" && event.terminal.statusDetail) {
          notifyTerminal(event.terminal.statusDetail, "error");
        }
      },
      onError: (event) => {
        if (event.terminalId !== terminal.id) {
          return;
        }

        if (event.error_code === "TERMINAL_NOT_RUNNING") {
          void onRequireReload();
          return;
        }

        if (event.error_code === "INVALID_TERMINAL_SIZE") {
          return;
        }

        notifyTerminal(event.detail, "error");
      },
      onUnauthorized
    });

    realtimeClientRef.current = client;
    client.start();

    return () => {
      client.close();
      onConnectionChange(paneId, "closed");
    };
  }, [
    notifyTerminal,
    onConnectionChange,
    onRequireReload,
    onTerminalStatus,
    onUnauthorized,
    paneId,
    terminal?.id
  ]);

  return (
    <article
      className="terminal-pane-card"
      data-active={active}
      data-empty={!terminal}
      onMouseDown={() => {
        onActivate(paneId);
      }}
      onClick={() => {
        viewportRuntimeRef.current?.focus();
      }}
      onTouchStart={(event) => {
        if (!isMobileLayout) {
          return;
        }

        const touch = event.touches[0];

        if (!touch) {
          return;
        }

        touchStartRef.current = {
          x: touch.clientX,
          y: touch.clientY
        };
      }}
      onTouchEnd={(event) => {
        if (!isMobileLayout || !onSwipeGesture) {
          touchStartRef.current = null;
          return;
        }

        const startPoint = touchStartRef.current;
        const touch = event.changedTouches[0];
        touchStartRef.current = null;

        if (!startPoint || !touch) {
          return;
        }

        const deltaX = touch.clientX - startPoint.x;
        const deltaY = touch.clientY - startPoint.y;

        if (
          Math.abs(deltaX) < TERMINAL_MOBILE_SWIPE_THRESHOLD ||
          Math.abs(deltaY) > TERMINAL_MOBILE_SWIPE_OFF_AXIS_THRESHOLD ||
          Math.abs(deltaX) <= Math.abs(deltaY)
        ) {
          return;
        }

        onSwipeGesture(deltaX < 0 ? "left" : "right");
      }}
      onTouchCancel={() => {
        touchStartRef.current = null;
      }}
    >
      {terminal ? (
        <div className="terminal-canvas">
          <div ref={terminalContainerRef} className="terminal-xterm" />
        </div>
      ) : pendingCreation ? (
        <div className="terminal-empty-state terminal-empty-state-inline terminal-pending-state">
          <span className="terminal-pane-label">{paneLabel}</span>
          <span className="terminal-pending-indicator" aria-hidden="true" />
          <h1>{t("terminal.creating")}</h1>
          <p>{t("terminal.creationPendingDescription")}</p>
        </div>
      ) : (
        <div
          className={
            isMobileLayout
              ? "terminal-empty-state terminal-empty-state-inline terminal-mobile-empty-state"
              : "terminal-empty-state terminal-empty-state-inline"
          }
        >
          <span className="terminal-pane-label">{paneLabel}</span>
          <h1>{isMobileLayout ? t("terminal.mobileEmptyTitle") : t("terminal.stageEmptyTitle")}</h1>
          <p>{isMobileLayout ? t("terminal.mobileEmptyDescription") : t("terminal.splitEmptySubtitle")}</p>
          {isMobileLayout ? (
            <div className="terminal-mobile-empty-actions">
              <button
                type="button"
                className="terminal-mobile-primary-action"
                disabled={!canCreateTerminal}
                onClick={() => {
                  onRequestCreateTerminal?.();
                }}
              >
                {t("terminal.createButton")}
              </button>
              <button
                type="button"
                className="terminal-mobile-secondary-action"
                onClick={() => {
                  onRequestOpenTerminalDrawer?.();
                }}
              >
                {t("terminal.mobileDrawerAction")}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

function createTerminalViewportRuntime(input: {
  container: HTMLDivElement;
  restoredViewState: PersistedTerminalViewState | null;
  fontSize: number;
  getCursor: () => string | null;
  canResize: () => boolean;
  onInput: (content: string) => void;
  onResize: (dimensions: { cols: number; rows: number }) => void;
  onViewStateChange: (viewState: PersistedTerminalViewState | null) => void;
}): TerminalViewportRuntime {
  const initialTheme = readTerminalVisualTheme();
  const terminal = new Terminal({
    cols: input.restoredViewState?.cols ?? DEFAULT_TERMINAL_COLS,
    rows: input.restoredViewState?.rows ?? DEFAULT_TERMINAL_ROWS,
    cursorBlink: true,
    scrollback: 2000,
    allowTransparency: false,
    fontFamily: '"Cascadia Mono", "Cascadia Code", "Consolas", monospace',
    fontSize: input.fontSize,
    theme: initialTheme
  });
  const fitAddon = new FitAddon();
  const serializeAddon = new SerializeAddon();
  let persistTimer: number | null = null;
  let disposed = false;
  let hasCommittedFit = false;
  let lastFittedCols = terminal.cols;
  let lastFittedRows = terminal.rows;

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(serializeAddon);
  terminal.onData((content) => {
    input.onInput(content);
  });
  terminal.onResize(({ cols, rows }) => {
    lastFittedCols = cols;
    lastFittedRows = rows;
    if (input.canResize()) {
      input.onResize({ cols, rows });
    }
    schedulePersist();
  });

  input.container.replaceChildren();
  terminal.open(input.container);
  input.container.style.background = initialTheme.background ?? "";

  if (input.restoredViewState?.content) {
    terminal.write(input.restoredViewState.content, () => {
      const restoredViewState = input.restoredViewState;

      if (restoredViewState && restoredViewState.viewportY > 0) {
        terminal.scrollToLine(restoredViewState.viewportY);
      }

      void waitForStableContainer().then(() => {
        fitToContainer();
      });
    });
  } else {
    void waitForStableContainer().then(() => {
      fitToContainer();
    });
  }

  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          window.requestAnimationFrame(() => {
            fitToContainer();
          });
        });

  resizeObserver?.observe(input.container);

  if (typeof document !== "undefined" && "fonts" in document) {
    void document.fonts.ready.then(() => {
      window.requestAnimationFrame(() => {
        fitToContainer();
      });
    });
  }

  async function waitForStableContainer(): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (hasUsableContainerSize(input.container)) {
        return;
      }

      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    }
  }

  function persistNow(): void {
    if (disposed) {
      return;
    }

    if (persistTimer !== null) {
      window.clearTimeout(persistTimer);
      persistTimer = null;
    }

    input.onViewStateChange(buildPersistedTerminalViewState(terminal, serializeAddon, input.getCursor()));
  }

  function schedulePersist(): void {
    if (disposed) {
      return;
    }

    if (persistTimer !== null) {
      window.clearTimeout(persistTimer);
    }

    persistTimer = window.setTimeout(() => {
      persistNow();
    }, 200);
  }

  function fitToContainer(): void {
    if (disposed || !hasUsableContainerSize(input.container)) {
      return;
    }

    const dimensions = fitAddon.proposeDimensions();

    if (
      !dimensions ||
      dimensions.cols < MIN_TERMINAL_COLS ||
      dimensions.rows < MIN_TERMINAL_ROWS ||
      (hasCommittedFit &&
        dimensions.cols === lastFittedCols &&
        dimensions.rows === lastFittedRows)
    ) {
      return;
    }

    fitAddon.fit();
    hasCommittedFit = true;
    lastFittedCols = terminal.cols;
    lastFittedRows = terminal.rows;
  }

  function applyTheme(): void {
    const nextTheme = readTerminalVisualTheme();
    terminal.options.theme = nextTheme;
    input.container.style.background = nextTheme.background ?? "";
  }

  return {
    terminal,
    restoredFromSnapshot: Boolean(input.restoredViewState),
    focus: () => {
      terminal.focus();
    },
    reflow: () => {
      fitToContainer();
    },
    readPlainText: () => {
      return readTerminalPlainText(terminal);
    },
    setFontSize: (fontSize: number) => {
      if (terminal.options.fontSize === fontSize) {
        return;
      }

      terminal.options.fontSize = fontSize;
      fitToContainer();
      schedulePersist();
    },
    applyTheme,
    persistNow,
    schedulePersist,
    dispose: () => {
      disposed = true;
      if (persistTimer !== null) {
        window.clearTimeout(persistTimer);
      }
      resizeObserver?.disconnect();
      terminal.dispose();
      input.container.replaceChildren();
    }
  };
}

function buildPersistedTerminalViewState(
  terminal: Terminal,
  serializeAddon: SerializeAddon,
  cursor: string | null
): PersistedTerminalViewState | null {
  const content = serializeAddon.serialize({
    scrollback: PERSISTED_TERMINAL_SCROLLBACK
  });

  if (!content || content.length > MAX_PERSISTED_TERMINAL_VIEW_CHARS) {
    return null;
  }

  return {
    content,
    cursor,
    cols: terminal.cols,
    rows: terminal.rows,
    viewportY: terminal.buffer.active.viewportY
  };
}

function appendTerminalChunks(terminal: Terminal, chunks: TerminalOutputChunkDto[]): void {
  if (chunks.length === 0) {
    return;
  }

  terminal.write(chunks.map((chunk) => chunk.content).join(""));
}

function replaceTerminalChunks(terminal: Terminal, chunks: TerminalOutputChunkDto[]): void {
  terminal.reset();

  if (chunks.length === 0) {
    return;
  }

  terminal.write(chunks.map((chunk) => chunk.content).join(""));
}

function hasUsableContainerSize(container: HTMLDivElement): boolean {
  return (
    container.clientWidth >= MIN_TERMINAL_PIXEL_WIDTH &&
    container.clientHeight >= MIN_TERMINAL_PIXEL_HEIGHT
  );
}

function readTerminalVisualTheme(): NonNullable<Terminal["options"]["theme"]> {
  if (typeof window === "undefined") {
    return {
      background: "#ffffff",
      foreground: "#1a1a1a",
      cursor: "#1a1a1a",
      cursorAccent: "#ffffff",
      selectionBackground: "rgba(0, 122, 255, 0.18)"
    };
  }

  const style = window.getComputedStyle(document.documentElement);
  const background = readCssVariable(style, "--terminal-theme-background", "#ffffff");
  const foreground = readCssVariable(style, "--terminal-theme-foreground", "#1a1a1a");
  const cursor = readCssVariable(style, "--terminal-theme-cursor", foreground);
  const cursorAccent = readCssVariable(style, "--terminal-theme-cursor-accent", background);
  const selectionBackground = readCssVariable(
    style,
    "--terminal-theme-selection",
    "rgba(0, 122, 255, 0.18)"
  );

  return {
    background,
    foreground,
    cursor,
    cursorAccent,
    selectionBackground
  };
}

function readCssVariable(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value || fallback;
}

function sortTerminals(
  terminals: TerminalDto[],
  pinnedTerminalIdSet: ReadonlySet<string>
): TerminalDto[] {
  return [...terminals].sort((left, right) => {
    const leftPinned = pinnedTerminalIdSet.has(left.id);
    const rightPinned = pinnedTerminalIdSet.has(right.id);

    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }

    return right.lastActiveAt.localeCompare(left.lastActiveAt);
  });
}

function parseTerminalShellOptions(input: unknown): TerminalShellOptionDto[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((item): item is TerminalShellOptionDto => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const candidate = item as Partial<TerminalShellOptionDto>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.label === "string" &&
      typeof candidate.shell === "string" &&
      typeof candidate.available === "boolean"
    );
  });
}

function buildMobileTerminalShellChoices(
  shellOptions: TerminalShellOptionDto[],
  osFamily: ReturnType<typeof usePlatform>["ui"]["osFamily"]
): MobileTerminalShellChoice[] {
  if (shellOptions.length > 0) {
    return shellOptions.map((option) => ({
      id: option.id,
      label: formatMobileShellLabel(option),
      value: option.shell,
      description: option.shell,
      available: option.available,
      unavailableReason: option.unavailableReason
    }));
  }

  if (osFamily === "windows") {
    return [
      {
        id: "cmd",
        label: "CMD",
        value: "cmd",
        description: "经典命令行",
        available: true,
        unavailableReason: null
      },
      {
        id: "powershell",
        label: "PowerShell",
        value: "powershell",
        description: "适合脚本与系统管理",
        available: true,
        unavailableReason: null
      },
      {
        id: "git-bash",
        label: "Git Bash",
        value: "git-bash",
        description: "更接近 Unix 命令体验",
        available: true,
        unavailableReason: null
      }
    ];
  }

  return [
    {
      id: osFamily === "linux" ? "bash" : "zsh",
      label: osFamily === "linux" ? "bash" : "zsh",
      value: osFamily === "linux" ? "bash" : "zsh",
      description: osFamily === "linux" ? "常见 Linux Shell" : "macOS 常见默认 Shell",
      available: true,
      unavailableReason: null
    }
  ];
}

function formatMobileShellLabel(option: TerminalShellOptionDto): string {
  if (option.id === "cmd") {
    return "CMD";
  }

  if (option.id === "powershell") {
    return "PowerShell";
  }

  if (option.id === "git-bash") {
    return "Git Bash";
  }

  if (option.id === "default") {
    const segments = option.shell.split(/[\\/]/);
    const shellName = segments[segments.length - 1] ?? option.shell;
    return shellName.replace(/\.exe$/i, "") || option.label;
  }

  return option.label;
}

function buildTerminalSessionIndicatorClassName(status: TerminalDto["status"]): string {
  if (status === "running") {
    return "session-state-indicator is-running";
  }

  if (status === "creating") {
    return "session-state-indicator is-running-inferred";
  }

  if (status === "error") {
    return "session-state-indicator is-subagent-running";
  }

  return "session-state-indicator is-idle";
}

function clampZoomScale(value: number): number {
  return Math.min(MAX_TERMINAL_ZOOM_SCALE, Math.max(MIN_TERMINAL_ZOOM_SCALE, value));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildTerminalFontSize(zoomScale: number): number {
  return Math.round(DEFAULT_TERMINAL_FONT_SIZE * clampZoomScale(zoomScale) * 10) / 10;
}

function formatZoomPercent(zoomScale: number): string {
  return `${Math.round(clampZoomScale(zoomScale) * 100)}%`;
}

function readTerminalContent(input: {
  terminalId: string;
  splitDirection: SplitDirection;
  paneBindings: TerminalPaneBindings;
  paneApiById: Record<PaneId, TerminalPaneApi | null>;
}): string {
  const paneId = findPaneIdByTerminalId(
    input.terminalId,
    input.paneBindings,
    input.splitDirection,
    "primary"
  );

  if (paneId) {
    const liveContent = input.paneApiById[paneId]?.readPlainText() ?? "";

    if (liveContent.trim()) {
      return liveContent;
    }
  }

  return extractPlainTextFromSnapshot(input.terminalId);
}

function extractPlainTextFromSnapshot(terminalId: string): string {
  const snapshot = readTerminalRecoveryState(terminalId).viewState;
  return snapshot ? stripAnsiContent(snapshot.content) : "";
}

function stripAnsiContent(content: string): string {
  return content
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001bP[\s\S]*?\u001b\\/g, "")
    .replace(/\r/g, "");
}

function readTerminalPlainText(terminal: Terminal): string {
  const lines: string[] = [];

  for (let lineIndex = 0; lineIndex < terminal.buffer.active.length; lineIndex += 1) {
    const line = terminal.buffer.active.getLine(lineIndex);

    if (!line) {
      continue;
    }

    lines.push(line.translateToString(true));
  }

  return lines.join("\n").trimEnd();
}

function normalizePaneBindings(input: {
  terminals: TerminalDto[];
  currentBindings: TerminalPaneBindings;
  splitDirection: SplitDirection;
  fallbackTerminalId: string | null;
  preferredPaneId: PaneId;
}): TerminalPaneBindings {
  const existingTerminalIdSet = new Set(input.terminals.map((terminal) => terminal.id));
  let primary =
    input.currentBindings.primary && existingTerminalIdSet.has(input.currentBindings.primary)
      ? input.currentBindings.primary
      : null;
  let secondary =
    input.splitDirection !== "single" &&
    input.currentBindings.secondary &&
    existingTerminalIdSet.has(input.currentBindings.secondary)
      ? input.currentBindings.secondary
      : null;

  if (input.fallbackTerminalId && existingTerminalIdSet.has(input.fallbackTerminalId)) {
    if (input.preferredPaneId === "secondary" && input.splitDirection !== "single") {
      secondary = input.fallbackTerminalId;
      primary = primary ?? pickAnotherTerminalId(input.terminals, secondary) ?? secondary;
    } else {
      primary = input.fallbackTerminalId;
    }
  }

  primary = primary ?? pickBestTerminalId(input.terminals);

  if (input.splitDirection === "single") {
    return {
      primary,
      secondary: null
    };
  }

  secondary = secondary ?? pickAnotherTerminalId(input.terminals, primary);
  return {
    primary,
    secondary
  };
}

function resolveTerminalIndicatorStatus(input: {
  terminal: TerminalDto;
  paneBindings: TerminalPaneBindings;
  paneConnectionStates: Record<PaneId, TerminalConnectionState>;
  manuallyDisconnectedTerminalIdSet: ReadonlySet<string>;
}): TerminalIndicatorStatus {
  if (input.terminal.status !== "running") {
    return input.terminal.status;
  }

  const assignedConnectionStates = getAssignedPaneConnectionStates(
    input.terminal.id,
    input.paneBindings,
    input.paneConnectionStates
  );

  if (assignedConnectionStates.includes("connected")) {
    return "running";
  }

  if (assignedConnectionStates.includes("reconnecting")) {
    return "creating";
  }

  if (
    assignedConnectionStates.length > 0 ||
    input.manuallyDisconnectedTerminalIdSet.has(input.terminal.id)
  ) {
    return "disconnected";
  }

  return "running";
}

function getAssignedPaneConnectionStates(
  terminalId: string,
  paneBindings: TerminalPaneBindings,
  paneConnectionStates: Record<PaneId, TerminalConnectionState>
): TerminalConnectionState[] {
  const states: TerminalConnectionState[] = [];

  if (paneBindings.primary === terminalId) {
    states.push(paneConnectionStates.primary);
  }

  if (paneBindings.secondary === terminalId) {
    states.push(paneConnectionStates.secondary);
  }

  return states;
}

function pickBestTerminalId(terminals: TerminalDto[]): string | null {
  return (
    terminals.find((terminal) => terminal.status === "running")?.id ??
    terminals[0]?.id ??
    null
  );
}

function pickAnotherTerminalId(
  terminals: TerminalDto[],
  excludedTerminalId: string | null
): string | null {
  return terminals.find((terminal) => terminal.id !== excludedTerminalId)?.id ?? null;
}

function isTerminalAssigned(
  terminalId: string,
  paneBindings: TerminalPaneBindings,
  splitDirection: SplitDirection
): boolean {
  if (paneBindings.primary === terminalId) {
    return true;
  }

  return splitDirection !== "single" && paneBindings.secondary === terminalId;
}

function findPaneIdByTerminalId(
  terminalId: string,
  paneBindings: TerminalPaneBindings,
  splitDirection: SplitDirection,
  preferredPaneId: PaneId
): PaneId | null {
  if (paneBindings[preferredPaneId] === terminalId) {
    return preferredPaneId;
  }

  if (paneBindings.primary === terminalId) {
    return "primary";
  }

  if (splitDirection !== "single" && paneBindings.secondary === terminalId) {
    return "secondary";
  }

  return null;
}

function buildTerminalMutationToastId(terminalId: string): string {
  return `terminal-mutation-${terminalId}`;
}

function buildTerminalManagerSnapshotKey(workspaceId: string) {
  return `terminal-manager.snapshot.${workspaceId}`;
}

function waitForNextMutationPoll(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, TERMINAL_MUTATION_POLL_INTERVAL_MS);
  });
}

function downloadTextFile(fileName: string, content: string): void {
  if (typeof document === "undefined") {
    throw new Error(t("terminal.saveLogFailed"));
  }

  const blob = new Blob([content], {
    type: "text/plain;charset=utf-8"
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function sanitizeFileName(input: string): string {
  const normalized = input.trim().replace(/[\\/:*?"<>|]+/g, "-");
  return normalized || "terminal";
}

function upsertTerminal(terminals: TerminalDto[], nextTerminal: TerminalDto): TerminalDto[] {
  const existingIndex = terminals.findIndex((terminal) => terminal.id === nextTerminal.id);

  if (existingIndex === -1) {
    return [nextTerminal, ...terminals];
  }

  const nextTerminals = [...terminals];
  nextTerminals[existingIndex] = nextTerminal;
  return nextTerminals;
}
