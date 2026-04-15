import {
  type ClipboardEvent as ReactClipboardEvent,
  forwardRef,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent
} from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import {
  canStartDesktopWindowDragFromTarget,
  startDesktopWindowDrag
} from "../../../platform/desktop/window-drag";
import { usePlatform } from "../../../platform/platform-provider";
import {
  readViewSnapshot,
  writeViewSnapshot
} from "../../../shared/cache/view-snapshot-cache";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { MobileWorkspaceSwitcherHeader } from "../../mobile-shell/components/MobileWorkspaceSwitcherHeader";
import {
  closeTerminal,
  createTerminal,
  deleteTerminalRecord,
  readTerminalHistory,
  listWorkspaceTerminals,
  listTerminalShellOptions,
  type TerminalDto,
  type TerminalHistoryPageDto,
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
import { createTerminalAttachInputGate } from "../runtime/terminal-attach-input-gate";
import { isTerminalDebugEnabled, logTerminalDebug, terminalDebugNowMs } from "../runtime/terminal-debug-log";
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
const TMUX_ATTACH_INPUT_RELEASE_DELAY_MS = 120;

interface TerminalViewportRuntime {
  terminal: Terminal;
  restoredFromSnapshot: boolean;
  focus: () => void;
  reflow: () => void;
  revealLatest: () => void;
  shouldAutoRevealLatest: () => boolean;
  prependHistory: (
    content: string,
    anchorLine?: number,
    options?: { replaceContent?: boolean }
  ) => Promise<void>;
  readPlainText: () => string;
  setFontSize: (fontSize: number) => void;
  applyTheme: () => void;
  persistNow: () => void;
  scheduleCursorPersist: (cursor: string | null) => void;
  schedulePersist: (mode?: "interaction" | "output") => void;
  suspendInputForwarding: () => void;
  resumeInputForwarding: (delayMs?: number) => void;
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
const TERMINAL_CURSOR_PERSIST_DELAY_MS = 300;
const TERMINAL_INTERACTION_PERSIST_DELAY_MS = 250;
const TERMINAL_ACTION_MENU_WIDTH = 196;
const TERMINAL_ACTION_MENU_OFFSET = 6;
const TERMINAL_ACTION_MENU_EDGE_PADDING = 8;
const TERMINAL_MOBILE_SWIPE_THRESHOLD = 72;
const TERMINAL_MOBILE_SWIPE_OFF_AXIS_THRESHOLD = 48;
const TERMINAL_MANAGER_SNAPSHOT_CACHE_MAX_AGE_MS = 60 * 1000;
const TERMINAL_HISTORY_PAGE_LIMIT = 20;
const TERMINAL_HISTORY_AUTO_PREFETCH_MAX_PAGES = 6;
const TERMINAL_TOUCH_LINE_HEIGHT_PX = 14;
const TERMINAL_TOUCH_MOMENTUM_GAIN = 2;
const TERMINAL_TOUCH_MOMENTUM_MIN_LINES_PER_MS = 0.06;
const TERMINAL_TOUCH_MOMENTUM_MAX_LINES_PER_MS = 0.9;
const TERMINAL_TOUCH_MOMENTUM_FRICTION = 0.97;
const TERMINAL_TOUCH_MOMENTUM_MAX_DURATION_MS = 3600;
const TERMINAL_TOUCH_MOMENTUM_MAX_IDLE_FRAMES = 3;
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
  const haptics = useHaptics();
  const handleTabbarMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!platform.isDesktop || platform.ui.osFamily !== "macos") {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (!canStartDesktopWindowDragFromTarget(event.target)) {
      return;
    }

    void startDesktopWindowDrag();
  }, [platform.isDesktop, platform.ui.osFamily]);
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
  const terminalShellRef = useRef<HTMLElement | null>(null);
  const terminalTabbarMainRef = useRef<HTMLDivElement | null>(null);
  const terminalTabbarScrollRef = useRef<HTMLDivElement | null>(null);
  const terminalActionMenuTriggerRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const mobileHeaderRef = useRef<HTMLDivElement | null>(null);
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
  const [selectedShell, setSelectedShell] = useState("");
  const [mobileSelectedShell, setMobileSelectedShell] = useState("");
  const [mobileQuickDrawerOpen, setMobileQuickDrawerOpen] = useState(false);
  const [mobileCreateSheetOpen, setMobileCreateSheetOpen] = useState(false);
  const [desktopCreateSheetOpen, setDesktopCreateSheetOpen] = useState(false);
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
    [
      currentWorkspace,
      routeWorkspaceId,
      selectedWorkspaceId,
      shellCurrentWorkspace,
      workspaces
    ]
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
  const runtimeOptions = useMemo(
    () => listTerminalRuntimeOptions(platform.ui.osFamily),
    [platform.ui.osFamily]
  );
  // 终端页要和工作台壳保持同一套判定，避免 iPad 横屏还挂着手机单栏逻辑。
  const isMobileTerminalPage = !platform.isDesktop && platform.isMobile;
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
  const terminalShellStyle = {
    "--terminal-mobile-list-width": isMobileTerminalPage && mobileQuickDrawerOpen ? "60vw" : "0px"
  } as CSSProperties;

  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);

  useTerminalMobileHeaderHeightVar(
    terminalShellRef,
    mobileHeaderRef,
    isMobileTerminalPage,
    selectedWorkspaceId || resolvedWorkspaceId
  );

  useEffect(() => {
    setSelectedShell((current) => {
      const nextShell = resolvePreferredTerminalShell(shellOptions, current);
      return nextShell ?? "";
    });
  }, [shellOptions]);

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
    if (activeTerminalId || terminals.length === 0) {
      return;
    }

    const fallbackTerminalId = pickBestTerminalId(terminals);

    if (!fallbackTerminalId) {
      return;
    }

    bindTerminalToPane(fallbackTerminalId, "primary");
  }, [activeTerminalId, terminals]);

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
      setSelectedShell("");
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

  async function executeTerminalCreation(
    request: TerminalCreationRequest,
    targetPaneId: PaneId,
    options: {
      onCreated?: () => void;
    } = {}
  ): Promise<void> {
    setCreatingTerminal(true);
    setPendingTerminalCreationPaneId(targetPaneId);

    try {
      const terminal = await submitTerminalCreation(request);

      if (!terminal) {
        clearPendingTerminalCreation(targetPaneId);
        return;
      }

      applyCreatedTerminalLocally(terminal, targetPaneId);
      clearPendingTerminalCreation(targetPaneId);
      options.onCreated?.();
      await reloadWorkspaceResources(request.workspaceId, {
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

    if (!workspaceId || creatingTerminal) {
      return;
    }

    const targetPaneId: PaneId = isMobileTerminalPage ? "primary" : activePaneIdRef.current;
    const availableShellOptions = await ensureShellOptionsLoaded();
    const nextShell = resolvePreferredTerminalShell(
      availableShellOptions.length > 0 ? availableShellOptions : shellOptions,
      selectedShell
    );

    await executeTerminalCreation(
      {
        workspaceId,
        shell: nextShell ?? undefined,
        runtimeType: selectedRuntimeType || undefined
      },
      targetPaneId
    );
  }

  async function handleCreateTerminalEntry(): Promise<void> {
    const workspaceId = resolvedWorkspaceId;

    if (!workspaceId || creatingTerminal) {
      return;
    }

    const availableShellOptions = await ensureShellOptionsLoaded();
    const effectiveShellOptions = availableShellOptions.length > 0 ? availableShellOptions : shellOptions;
    const nextShell = resolvePreferredTerminalShell(effectiveShellOptions, selectedShell);

    if (
      shouldPromptForTerminalShellSelection(
        effectiveShellOptions,
        isMobileTerminalPage,
        platform.ui.osFamily
      )
    ) {
      setSelectedShell(nextShell ?? "");
      setDesktopCreateSheetOpen(true);
      return;
    }

    await handleCreateTerminal();
  }

  async function handleCreateTerminalFromDesktopSheet(): Promise<void> {
    const workspaceId = resolvedWorkspaceId;

    if (!workspaceId || creatingTerminal) {
      return;
    }

    const availableShellOptions = shellOptions.length > 0 ? shellOptions : await ensureShellOptionsLoaded();
    const nextShell = resolvePreferredTerminalShell(
      availableShellOptions.length > 0 ? availableShellOptions : shellOptions,
      selectedShell
    );

    await executeTerminalCreation(
      {
        workspaceId,
        shell: nextShell ?? undefined,
        runtimeType: resolveDefaultTerminalCreationRuntime(selectedRuntimeType, platform.ui.osFamily)
      },
      activePaneIdRef.current,
      {
        onCreated: () => {
          setDesktopCreateSheetOpen(false);
        }
      }
    );
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

    await executeTerminalCreation(
      {
        workspaceId,
        shell: shellChoice.value,
        runtimeType: resolveDefaultTerminalCreationRuntime(selectedRuntimeType, platform.ui.osFamily)
      },
      "primary",
      {
        onCreated: () => {
          setMobileCreateSheetOpen(false);
          setMobileQuickDrawerOpen(false);
        }
      }
    );
  }

  async function executeTerminalDeleteMutation(
    workspaceId: string,
    terminalId: string
  ): Promise<"settled" | "timeout" | "workspace_changed"> {
    markTerminalMutation(terminalId, "deleting");
    showTerminalMutationToast(terminalId, "deleting");
    await deleteTerminalRecord(terminalId);
    return waitForTerminalMutationSettlement(workspaceId, terminalId, "deleting");
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
        const closeSettlement = await waitForTerminalMutationSettlement(
          workspaceId,
          terminalId,
          "closing"
        );

        if (closeSettlement === "workspace_changed") {
          dismissToast(toastId);
          return;
        }

        if (closeSettlement === "timeout") {
          showToast({
            id: toastId,
            title: t("terminal.closed"),
            description: t("terminal.closeSyncDelayed"),
            tone: "warning"
          });
          return;
        }

        if (!terminalsRef.current.some((terminal) => terminal.id === terminalId)) {
          showToast({
            id: toastId,
            title: t("terminal.deleted"),
            tone: "success"
          });
          return;
        }

        const deleteSettlement = await executeTerminalDeleteMutation(workspaceId, terminalId);

        if (deleteSettlement === "workspace_changed") {
          dismissToast(toastId);
          return;
        }

        if (deleteSettlement === "timeout") {
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
        const settlement = await executeTerminalDeleteMutation(workspaceId, terminalId);

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
      setDesktopCreateSheetOpen(false);
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
      void haptics.trigger("gesture");
      setMobileQuickDrawerOpen(true);
      return;
    }

    void haptics.trigger("gesture");
    setMobileQuickDrawerOpen(false);
  }

  function handleMobileStageTouchStart(event: ReactTouchEvent<HTMLDivElement>): void {
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

  function handleMobileStageTouchEnd(event: ReactTouchEvent<HTMLDivElement>): void {
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
      <section
        ref={terminalShellRef}
        className="terminal-shell"
        data-mobile={isMobileTerminalPage}
        data-mobile-list-open={isMobileTerminalPage ? mobileQuickDrawerOpen : undefined}
        style={isMobileTerminalPage ? terminalShellStyle : undefined}
      >
        {isMobileTerminalPage ? (
          <>
            <MobileWorkspaceSwitcherHeader
              containerRef={mobileHeaderRef}
              currentWorkspace={mobileHeaderWorkspace}
              workspaces={workspaces}
              onSelectWorkspace={(workspaceId) => {
                selectWorkspace(workspaceId);
                setSelectedWorkspaceId(workspaceId);
              }}
              trailing={
                <button
                  type="button"
                  className="secondary-button mobile-tools-more-button"
                  aria-label={t("terminal.mobileDrawerAction")}
                  title={t("terminal.mobileDrawerAction")}
                  aria-expanded={mobileQuickDrawerOpen}
                  onClick={() => {
                    setMobileQuickDrawerOpen((current) => !current);
                  }}
                >
                  <MoreIcon />
                </button>
              }
            />

            <MobileTerminalQuickDrawer
              open={mobileQuickDrawerOpen}
              terminals={orderedTerminals}
              pinnedTerminalIds={pinnedTerminalIdSet}
              activeTerminalId={activeTerminal?.id ?? null}
              creatingTerminal={creatingTerminal}
              paneBindings={effectivePaneBindings}
              splitDirection={effectiveSplitDirection}
              activePaneId={effectiveActivePaneId}
              paneConnectionStates={effectivePaneConnectionStates}
              terminalMutations={terminalMutations}
              manuallyDisconnectedTerminalIdSet={manuallyDisconnectedTerminalIdSet}
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
              onBindToActivePane={(terminalId) => {
                bindTerminalToActivePane(terminalId);
                setMobileQuickDrawerOpen(false);
              }}
              onBindToPane={bindTerminalToPane}
              onDuplicate={handleDuplicateTerminal}
              onDisconnect={handleDisconnectTerminal}
              onReconnect={handleReconnectTerminal}
              onCloseTerminal={handleCloseTerminal}
              onDeleteTerminal={handleDeleteTerminal}
              onTogglePin={handleTogglePin}
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

            <TerminalCreateSheet
              open={mobileCreateSheetOpen}
              loading={loadingShellOptions}
              creating={creatingTerminal}
              shellChoices={mobileShellChoices}
              osFamily={platform.ui.osFamily}
              selectedShell={mobileSelectedShell}
              runtimeType={resolveDefaultTerminalCreationRuntime(selectedRuntimeType, platform.ui.osFamily)}
              title={t("terminal.mobileCreateSheetTitle")}
              shellLabel={t("terminal.mobileCreateShellLabel")}
              shellDescription={t("terminal.mobileCreateShellDescription")}
              runtimeLabel={t("terminal.mobileCreateRuntimeLabel")}
              runtimeDescription={t("terminal.mobileCreateRuntimeDescription")}
              confirmLabel={t("terminal.mobileCreateConfirm")}
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
            <header
              className="terminal-tabbar"
              data-window-drag-handle="terminal-tabbar"
              onMouseDownCapture={handleTabbarMouseDownCapture}
            >
              <div ref={terminalTabbarMainRef} className="terminal-tabbar-main">
                <div
                  ref={terminalTabbarScrollRef}
                  className="terminal-tabbar-scroll"
                  role="tablist"
                  aria-label={t("terminal.title")}
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
                            if (!isActive) {
                              void haptics.trigger("selection");
                            }
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
                            <>
                              <span
                                className="terminal-tab-status-dot"
                                data-status={indicatorStatus}
                                aria-hidden="true"
                              />
                              {isPinned ? <span className="terminal-tab-pin-indicator">•</span> : null}
                              <span className="terminal-tab-name-text">{terminal.name}</span>
                              <span
                                className="terminal-tab-runtime"
                                title={getTerminalRuntimeLabel(terminal.runtimeType, platform.ui.osFamily)}
                              >
                                {getTerminalRuntimeShortLabel(terminal.runtimeType, platform.ui.osFamily)}
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
                            </>
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
                      title={getTerminalRuntimeLabel(
                        selectedRuntimeType || undefined,
                        platform.ui.osFamily
                      )}
                          >
                      {getTerminalRuntimeShortLabel(
                        selectedRuntimeType || undefined,
                        platform.ui.osFamily
                      )}
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
                      void handleCreateTerminalEntry();
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
                          <span className="terminal-toolbar-label">{t("terminal.shellField")}</span>
                          <select
                            className="terminal-runtime-select"
                            value={selectedShell}
                            aria-label={t("terminal.shellField")}
                            onChange={(event) => {
                              setSelectedShell(event.target.value);
                            }}
                          >
                            {shellOptions.length > 0 ? (
                              shellOptions.map((option) => (
                                <option
                                  key={option.id}
                                  value={option.shell}
                                  disabled={!option.available}
                                >
                                  {option.available
                                    ? option.label
                                    : `${option.label} - ${t("terminal.shellUnavailable")}`}
                                </option>
                              ))
                            ) : (
                              <option value="">{t("common.loading")}</option>
                            )}
                          </select>
                        </div>

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
      <TerminalCreateSheet
        open={desktopCreateSheetOpen}
        loading={loadingShellOptions}
        creating={creatingTerminal}
        shellChoices={mobileShellChoices}
        osFamily={platform.ui.osFamily}
        selectedShell={selectedShell}
        runtimeType={resolveDefaultTerminalCreationRuntime(selectedRuntimeType, platform.ui.osFamily)}
        title={t("terminal.createDialogTitle")}
        shellLabel={t("terminal.mobileCreateShellLabel")}
        shellDescription={t("terminal.createDialogShellDescription")}
        runtimeLabel={t("terminal.mobileCreateRuntimeLabel")}
        runtimeDescription={t("terminal.createDialogRuntimeDescription")}
        confirmLabel={t("terminal.createDialogConfirm")}
        onClose={() => {
          if (creatingTerminal) {
            return;
          }

          setDesktopCreateSheetOpen(false);
        }}
        onSelectShell={setSelectedShell}
        onSelectRuntime={(runtimeType) => {
          setSelectedRuntimeType(runtimeType);
        }}
        onConfirm={() => {
          void handleCreateTerminalFromDesktopSheet();
        }}
      />
    </main>
  );
}

function MobileTerminalQuickDrawer({
  open,
  terminals,
  pinnedTerminalIds,
  activeTerminalId,
  creatingTerminal,
  paneBindings,
  splitDirection,
  activePaneId,
  paneConnectionStates,
  terminalMutations,
  manuallyDisconnectedTerminalIdSet,
  onClose,
  onCreateTerminal,
  onSelectTerminal,
  onBindToActivePane,
  onBindToPane,
  onDuplicate,
  onDisconnect,
  onReconnect,
  onCloseTerminal,
  onDeleteTerminal,
  onTogglePin
}: {
  open: boolean;
  terminals: TerminalDto[];
  pinnedTerminalIds: ReadonlySet<string>;
  activeTerminalId: string | null;
  creatingTerminal: boolean;
  paneBindings: TerminalPaneBindings;
  splitDirection: SplitDirection;
  activePaneId: PaneId;
  paneConnectionStates: Record<PaneId, TerminalConnectionState>;
  terminalMutations: Record<string, TerminalMutationType>;
  manuallyDisconnectedTerminalIdSet: ReadonlySet<string>;
  onClose: () => void;
  onCreateTerminal: () => void;
  onSelectTerminal: (terminalId: string) => void;
  onBindToActivePane: (terminalId: string) => void;
  onBindToPane: (terminalId: string, paneId: PaneId) => void;
  onDuplicate: (terminal: TerminalDto) => Promise<void>;
  onDisconnect: (terminalId: string) => void;
  onReconnect: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => Promise<void>;
  onDeleteTerminal: (terminalId: string) => Promise<void>;
  onTogglePin: (terminalId: string) => void;
}) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [actionTerminalId, setActionTerminalId] = useState<string | null>(null);
  const pinnedTerminals = terminals.filter((terminal) => pinnedTerminalIds.has(terminal.id));
  const otherTerminals = terminals.filter((terminal) => !pinnedTerminalIds.has(terminal.id));
  const actionTerminal = terminals.find((terminal) => terminal.id === actionTerminalId) ?? null;

  useEffect(() => {
    if (!open) {
      setActionTerminalId(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <>
      <section
        className="terminal-mobile-list-rail surface-card"
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
        <div className="terminal-mobile-list-heading">
          <strong>{t("terminal.mobileDrawerTitle")}</strong>
          <p>{t("terminal.mobileDrawerDescription")}</p>
        </div>

        <div className="terminal-mobile-list-body">
          {pinnedTerminals.length > 0 ? (
            <section className="terminal-mobile-list-group terminal-mobile-list-group-pinned">
              <div className="terminal-mobile-list-group-heading">
                <span>{t("terminal.mobilePinnedSectionTitle")}</span>
                <span className="workbench-section-counter">{pinnedTerminals.length}</span>
              </div>
              <div className="terminal-mobile-session-list">
                {pinnedTerminals.map((terminal) => (
                  <TerminalMobileSessionEntry
                    key={terminal.id}
                    terminal={terminal}
                    active={terminal.id === activeTerminalId}
                    pendingMutation={terminalMutations[terminal.id] ?? null}
                    onOpen={onSelectTerminal}
                    onOpenMenu={(terminalId) => {
                      setActionTerminalId((current) => (current === terminalId ? null : terminalId));
                    }}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="terminal-mobile-list-group terminal-mobile-list-group-workspace">
            <div className="terminal-mobile-list-group-heading">
              <span>{t("terminal.workspaceField")}</span>
              <span className="workbench-section-counter">{otherTerminals.length}</span>
            </div>
            {otherTerminals.length > 0 ? (
              <div className="terminal-mobile-session-list">
                {otherTerminals.map((terminal) => (
                  <TerminalMobileSessionEntry
                    key={terminal.id}
                    terminal={terminal}
                    active={terminal.id === activeTerminalId}
                    pendingMutation={terminalMutations[terminal.id] ?? null}
                    onOpen={onSelectTerminal}
                    onOpenMenu={(terminalId) => {
                      setActionTerminalId((current) => (current === terminalId ? null : terminalId));
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="workbench-session-empty">{t("terminal.mobileDrawerEmptyDescription")}</div>
            )}
          </section>
        </div>

        <div className="terminal-mobile-list-footer">
          <button
            type="button"
            className="workbench-import-toggle terminal-mobile-list-create"
            disabled={creatingTerminal}
            onClick={onCreateTerminal}
          >
            <span className="workbench-import-toggle-symbol">+</span>
            <span className="workbench-import-toggle-label">{t("terminal.createButton")}</span>
          </button>
        </div>
      </section>

      <MobileTerminalActionSheet
        terminal={actionTerminal}
        pendingMutation={actionTerminal ? terminalMutations[actionTerminal.id] ?? null : null}
        paneBindings={paneBindings}
        splitDirection={splitDirection}
        activePaneId={activePaneId}
        paneConnectionStates={paneConnectionStates}
        pinnedTerminalIdSet={pinnedTerminalIds}
        manuallyDisconnectedTerminalIdSet={manuallyDisconnectedTerminalIdSet}
        onClose={() => {
          setActionTerminalId(null);
        }}
        onBindToActivePane={(terminalId) => {
          setActionTerminalId(null);
          onBindToActivePane(terminalId);
        }}
        onBindToPane={(terminalId, paneId) => {
          setActionTerminalId(null);
          onBindToPane(terminalId, paneId);
        }}
        onDuplicate={async (terminal) => {
          setActionTerminalId(null);
          await onDuplicate(terminal);
        }}
        onDisconnect={(terminalId) => {
          setActionTerminalId(null);
          onDisconnect(terminalId);
        }}
        onReconnect={(terminalId) => {
          setActionTerminalId(null);
          onReconnect(terminalId);
        }}
        onCloseTerminal={async (terminalId) => {
          setActionTerminalId(null);
          await onCloseTerminal(terminalId);
        }}
        onDeleteTerminal={async (terminalId) => {
          setActionTerminalId(null);
          await onDeleteTerminal(terminalId);
        }}
        onTogglePin={(terminalId) => {
          setActionTerminalId(null);
          onTogglePin(terminalId);
        }}
      />
    </>
  );
}

function TerminalMobileSessionEntry({
  terminal,
  active,
  pendingMutation,
  onOpen,
  onOpenMenu
}: {
  terminal: TerminalDto;
  active: boolean;
  pendingMutation: TerminalMutationType | null;
  onOpen: (terminalId: string) => void;
  onOpenMenu: (terminalId: string) => void;
}) {
  return (
    <article className="terminal-mobile-session-card" data-active={active}>
      <button
        type="button"
        className="terminal-mobile-session-primary"
        data-active={active ? "true" : "false"}
        onClick={() => {
          onOpen(terminal.id);
        }}
      >
        <div className="terminal-mobile-session-title-row">
          <span className={buildTerminalSessionIndicatorClassName(terminal.status)} />
          <span className="terminal-mobile-session-title" title={terminal.name}>
            {terminal.name}
          </span>
          <span className="terminal-mobile-session-runtime-badge">
            {getTerminalRuntimeShortLabel(terminal.runtimeType)}
          </span>
        </div>
        <div className="terminal-mobile-session-path" title={terminal.cwd}>{terminal.cwd}</div>
        {pendingMutation ? (
          <div className="terminal-mobile-session-operation">
            <span className="terminal-tab-operation-spinner" aria-hidden="true" />
            <span>
              {pendingMutation === "closing"
                ? t("terminal.closePendingBadge")
                : t("terminal.deletePendingBadge")}
            </span>
          </div>
        ) : null}
      </button>
      <button
        type="button"
        className="terminal-mobile-session-action"
        aria-label={t("terminal.moreActions")}
        title={t("terminal.moreActions")}
        onClick={(event) => {
          event.stopPropagation();
          onOpenMenu(terminal.id);
        }}
      >
        <MoreIcon />
      </button>
    </article>
  );
}

function MobileTerminalActionSheet({
  terminal,
  pendingMutation,
  paneBindings,
  splitDirection,
  activePaneId,
  paneConnectionStates,
  pinnedTerminalIdSet,
  manuallyDisconnectedTerminalIdSet,
  onClose,
  onBindToActivePane,
  onBindToPane,
  onDuplicate,
  onDisconnect,
  onReconnect,
  onCloseTerminal,
  onDeleteTerminal,
  onTogglePin
}: {
  terminal: TerminalDto | null;
  pendingMutation: TerminalMutationType | null;
  paneBindings: TerminalPaneBindings;
  splitDirection: SplitDirection;
  activePaneId: PaneId;
  paneConnectionStates: Record<PaneId, TerminalConnectionState>;
  pinnedTerminalIdSet: ReadonlySet<string>;
  manuallyDisconnectedTerminalIdSet: ReadonlySet<string>;
  onClose: () => void;
  onBindToActivePane: (terminalId: string) => void;
  onBindToPane: (terminalId: string, paneId: PaneId) => void;
  onDuplicate: (terminal: TerminalDto) => Promise<void>;
  onDisconnect: (terminalId: string) => void;
  onReconnect: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => Promise<void>;
  onDeleteTerminal: (terminalId: string) => Promise<void>;
  onTogglePin: (terminalId: string) => void;
}) {
  if (!terminal || typeof document === "undefined") {
    return null;
  }

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

  return createPortal(
    <div className="ios-action-sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="mobile-workspace-home-sheet terminal-mobile-action-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("terminal.moreActions")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mobile-workspace-home-sheet-card terminal-mobile-action-sheet-card">
          <div className="mobile-workspace-home-sheet-header">
            <strong>{terminal.name}</strong>
          </div>
          <div className="terminal-mobile-action-list">
            {splitDirection !== "single" ? (
              <>
                <button
                  type="button"
                  className="terminal-mobile-action-item"
                  disabled={pendingMutation !== null || paneBindings.primary === terminal.id}
                  onClick={() => {
                    onBindToPane(terminal.id, "primary");
                  }}
                >
                  {t("terminal.bindToPrimaryPaneAction")}
                </button>
                <button
                  type="button"
                  className="terminal-mobile-action-item"
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
                className="terminal-mobile-action-item"
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
              className="terminal-mobile-action-item"
              disabled={pendingMutation !== null}
              onClick={() => {
                void onDuplicate(terminal);
              }}
            >
              {t("terminal.duplicateAction")}
            </button>
            {canControlConnection ? (
              activeConnectionState === "connected" ? (
                <button
                  type="button"
                  className="terminal-mobile-action-item"
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
                  className="terminal-mobile-action-item"
                  disabled={pendingMutation !== null}
                  onClick={() => {
                    onReconnect(terminal.id);
                  }}
                >
                  {t("terminal.reconnectAction")}
                </button>
              )
            ) : null}
            {showCloseAction ? (
              <button
                type="button"
                className="terminal-mobile-action-item"
                onClick={() => {
                  void onCloseTerminal(terminal.id);
                }}
              >
                {t("terminal.closeButton")}
              </button>
            ) : null}
            {showDeleteAction ? (
              <button
                type="button"
                className="terminal-mobile-action-item danger"
                onClick={() => {
                  void onDeleteTerminal(terminal.id);
                }}
              >
                {t("terminal.deleteAction")}
              </button>
            ) : null}
            <button
              type="button"
              className="terminal-mobile-action-item"
              disabled={pendingMutation !== null}
              onClick={() => {
                onTogglePin(terminal.id);
              }}
            >
              {isPinned ? t("terminal.unpinAction") : t("terminal.pinAction")}
            </button>
          </div>
        </div>
        <button type="button" className="ios-action-sheet-cancel" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </div>,
    document.body
  );
}

function useTerminalMobileHeaderHeightVar(
  rootRef: RefObject<HTMLElement | null>,
  headerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  resetKey: string
) {
  useEffect(() => {
    const rootElement = rootRef.current;
    const headerElement = headerRef.current;

    if (!enabled || !rootElement) {
      if (rootElement) {
        rootElement.style.removeProperty("--terminal-mobile-header-height");
      }
      return;
    }

    if (!headerElement) {
      rootElement.style.removeProperty("--terminal-mobile-header-height");
      return;
    }

    const stableRootElement = rootElement;
    const stableHeaderElement = headerElement;

    function syncHeaderHeight() {
      if (!rootRef.current || !stableHeaderElement.isConnected) {
        return;
      }

      stableRootElement.style.setProperty(
        "--terminal-mobile-header-height",
        `${stableHeaderElement.offsetHeight}px`
      );
    }

    syncHeaderHeight();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncHeaderHeight) : null;

    resizeObserver?.observe(stableHeaderElement);
    window.addEventListener("resize", syncHeaderHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncHeaderHeight);
      rootElement.style.removeProperty("--terminal-mobile-header-height");
    };
  }, [enabled, headerRef, resetKey, rootRef]);
}

function TerminalCreateSheet({
  open,
  loading,
  creating,
  shellChoices,
  osFamily,
  selectedShell,
  runtimeType,
  title,
  shellLabel,
  shellDescription,
  runtimeLabel,
  runtimeDescription,
  confirmLabel,
  onClose,
  onSelectShell,
  onSelectRuntime,
  onConfirm
}: {
  open: boolean;
  loading: boolean;
  creating: boolean;
  shellChoices: MobileTerminalShellChoice[];
  osFamily: ReturnType<typeof usePlatform>["ui"]["osFamily"];
  selectedShell: string;
  runtimeType: SelectableTerminalRuntimeType;
  title: string;
  shellLabel: string;
  shellDescription: string;
  runtimeLabel: string;
  runtimeDescription: string;
  confirmLabel: string;
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
  const persistentRuntimeOption =
    listTerminalRuntimeOptions(osFamily).find((option) => option.value === "tmux") ?? null;
  const runtimeCards: Array<{
    value: SelectableTerminalRuntimeType;
    title: string;
    description: string;
  }> = [
    {
      value: "tmux",
      title: persistentRuntimeOption?.label ?? t("terminal.mobileRuntimePersistentTitle"),
      description:
        persistentRuntimeOption?.description ?? t("terminal.mobileRuntimePersistentDescription")
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
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mobile-workspace-home-sheet-card terminal-mobile-create-sheet-card">
          <div className="mobile-workspace-home-sheet-header">
            <strong>{title}</strong>
          </div>

          <div className="terminal-mobile-create-sheet-body">
            <section className="terminal-mobile-create-section">
              <div className="terminal-mobile-create-section-copy">
                <strong>{shellLabel}</strong>
                <p>{shellDescription}</p>
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
                <strong>{runtimeLabel}</strong>
                <p>{runtimeDescription}</p>
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
              {creating ? t("terminal.creating") : confirmLabel}
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

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
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
  const oldestLoadedSeqRef = useRef<number | null>(null);
  const nextHistoryBeforeSeqRef = useRef<number | null>(null);
  const hasOlderHistoryRef = useRef(true);
  const loadingOlderHistoryRef = useRef(false);
  const activeRecoveryStateRef = useRef<"idle_closed" | null>(null);
  const activeTerminalStatusRef = useRef<TerminalDto["status"] | null>(terminal?.status ?? null);
  const initialBackfillAppliedRef = useRef(false);
  const pendingLiveOutputRef = useRef<TerminalOutputChunkDto[]>([]);
  const activePaneRef = useRef(active);
  const useKeyboardFallback = !isMobileLayout;

  const forwardTerminalInput = useCallback((content: string) => {
    if (!content) {
      return;
    }

    realtimeClientRef.current?.sendInput(content);
  }, []);

  const updateOldestLoadedSeq = useCallback((cursor: string | null | undefined) => {
    const value = Number(cursor);

    if (!Number.isInteger(value) || value <= 0) {
      return;
    }

    oldestLoadedSeqRef.current =
      oldestLoadedSeqRef.current === null
        ? value
        : Math.min(oldestLoadedSeqRef.current, value);
    nextHistoryBeforeSeqRef.current = oldestLoadedSeqRef.current;
  }, []);

  const handleOlderHistoryPage = useCallback(
    async (payload: TerminalHistoryPageDto): Promise<void> => {
      const runtime = viewportRuntimeRef.current;

      if (!runtime) {
        return;
      }

      if (!payload.content) {
        hasOlderHistoryRef.current = payload.hasMore;
        nextHistoryBeforeSeqRef.current = payload.nextBeforeSeq;
        return;
      }

      const currentLineCount = countTerminalPlainTextLines(runtime.readPlainText());
      const anchorLine = payload.replaceContent
        ? Math.max(0, payload.lineCount - currentLineCount)
        : payload.anchorLine;

      await runtime.prependHistory(payload.content, anchorLine, {
        replaceContent: payload.replaceContent === true
      });
      oldestLoadedSeqRef.current = payload.nextBeforeSeq ?? oldestLoadedSeqRef.current;
      nextHistoryBeforeSeqRef.current = payload.nextBeforeSeq;
      hasOlderHistoryRef.current = payload.hasMore;
      runtime.schedulePersist();
    },
    []
  );

  const shouldAutoPrefetchHistory = useCallback((): boolean => {
    const runtime = viewportRuntimeRef.current;

    if (!runtime) {
      return false;
    }

    return runtime.terminal.buffer.active.baseY === 0;
  }, []);

  const loadOlderHistory = useCallback(async () => {
    if (!terminal?.id || loadingOlderHistoryRef.current || !hasOlderHistoryRef.current) {
      return;
    }

    const beforeSeq = nextHistoryBeforeSeqRef.current;

    if (beforeSeq === null) {
      return;
    }

    loadingOlderHistoryRef.current = true;

    try {
      let nextBeforeSeq: number | null = beforeSeq;
      let remainingPages = TERMINAL_HISTORY_AUTO_PREFETCH_MAX_PAGES;

      while (nextBeforeSeq !== null && remainingPages > 0) {
        const payload = await readTerminalHistory(terminal.id, {
          beforeSeq: nextBeforeSeq,
          limit: TERMINAL_HISTORY_PAGE_LIMIT
        });

        await handleOlderHistoryPage(payload);
        remainingPages -= 1;

        if (!payload.hasMore || !shouldAutoPrefetchHistory()) {
          break;
        }

        nextBeforeSeq = payload.nextBeforeSeq;
      }
    } catch (error) {
      notifyTerminal(
        error instanceof Error ? error.message : t("conversation.historyLoadFailed"),
        "error"
      );
    } finally {
      loadingOlderHistoryRef.current = false;
    }
  }, [
    handleOlderHistoryPage,
    notifyTerminal,
    shouldAutoPrefetchHistory,
    terminal?.id
  ]);

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
      enableTouchMomentum: isMobileLayout,
      getCursor: () => activeCursorRef.current,
      getHistoryPaging: () => ({
        beforeSeq: nextHistoryBeforeSeqRef.current,
        hasOlder: hasOlderHistoryRef.current
      }),
      canResize: () => activeTerminalStatusRef.current === "running",
      onInput: forwardTerminalInput,
      onResize: ({ cols, rows }) => {
        realtimeClientRef.current?.resize(cols, rows);
      },
      onViewportTop: () => {
        void loadOlderHistory();
      },
      onCursorChange: (cursor) => {
        persistTerminalCursor(terminal.id, cursor);
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
  }, [forwardTerminalInput, loadOlderHistory, paneId, registerApi, terminal?.id, zoomScale]);

  useEffect(() => {
    realtimeClientRef.current?.close();
    realtimeClientRef.current = null;
    activeRecoveryStateRef.current = null;
    viewportRuntimeRef.current?.suspendInputForwarding();
    onConnectionChange(paneId, "closed");

    if (!terminal?.id) {
      activeCursorRef.current = null;
      oldestLoadedSeqRef.current = null;
      nextHistoryBeforeSeqRef.current = null;
      hasOlderHistoryRef.current = true;
      loadingOlderHistoryRef.current = false;
      initialBackfillAppliedRef.current = false;
      pendingLiveOutputRef.current = [];
      return;
    }

    const recoveryState = readTerminalRecoveryState(terminal.id);
    const persistedViewState = recoveryState.viewState;
    const resumeCursor = recoveryState.resumeCursor;
    activeCursorRef.current = resumeCursor;
    oldestLoadedSeqRef.current = persistedViewState?.historyBeforeSeq ?? null;
    nextHistoryBeforeSeqRef.current = persistedViewState?.historyBeforeSeq ?? null;
    hasOlderHistoryRef.current =
      persistedViewState?.historyHasOlder === false && terminal.runtimeType === "tmux"
        ? true
        : (persistedViewState?.historyHasOlder ?? true);
    loadingOlderHistoryRef.current = false;
    initialBackfillAppliedRef.current = false;
    pendingLiveOutputRef.current = [];

    const client = new TerminalRealtimeClient({
      terminalId: terminal.id,
      lastCursor: resumeCursor,
      onConnectionChange: (state: TerminalConnectionState) => {
        if (state !== "connected") {
          viewportRuntimeRef.current?.suspendInputForwarding();
        }
        onConnectionChange(paneId, state);
      },
      onSubscribed: () => {
        const runtime = viewportRuntimeRef.current;

        if (runtime) {
          runtime.suspendInputForwarding();
          runtime.reflow();
          client.sendCurrentDimensions(runtime.terminal.cols, runtime.terminal.rows);
          runtime.resumeInputForwarding(
            terminal.runtimeType === "tmux" ? TMUX_ATTACH_INPUT_RELEASE_DELAY_MS : 0
          );
        }

        if (activePaneRef.current) {
          viewportRuntimeRef.current?.focus();
        }
      },
      onBackfill: (event) => {
        const runtime = viewportRuntimeRef.current;
        const orderedChunks = sortTerminalChunksByCursor(event.chunks);
        const shouldRevealLatest = runtime?.shouldAutoRevealLatest();

        if (runtime) {
          if (event.cursorReset) {
            replaceTerminalChunks(runtime.terminal, orderedChunks);
            oldestLoadedSeqRef.current = null;
          } else if (runtime.restoredFromSnapshot) {
            appendTerminalChunks(runtime.terminal, orderedChunks);
          } else {
            replaceTerminalChunks(runtime.terminal, orderedChunks);
            oldestLoadedSeqRef.current = null;
          }

          if (shouldRevealLatest) {
            runtime.revealLatest();
          }

        }

        initialBackfillAppliedRef.current = true;

        if (orderedChunks.length > 0) {
          updateOldestLoadedSeq(orderedChunks[0]?.cursor);
        }

        const nextCursor = event.latestCursor ?? activeCursorRef.current;
        activeCursorRef.current = nextCursor;
        runtime?.scheduleCursorPersist(nextCursor);

        if (runtime && pendingLiveOutputRef.current.length > 0) {
          const bufferedChunks = filterTerminalChunksAfterCursor(
            pendingLiveOutputRef.current,
            event.latestCursor
          );
          pendingLiveOutputRef.current = [];

          if (bufferedChunks.length > 0) {
            appendTerminalChunks(runtime.terminal, bufferedChunks);
            const latestBufferedCursor = bufferedChunks.at(-1)?.cursor ?? nextCursor;
            activeCursorRef.current = latestBufferedCursor;
            runtime.scheduleCursorPersist(latestBufferedCursor);
          }
        }

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
        const runtime = viewportRuntimeRef.current;
        const shouldBufferOutputBeforeInitialBackfill = !initialBackfillAppliedRef.current;
        const shouldRevealLatest = runtime?.shouldAutoRevealLatest();

        if (shouldBufferOutputBeforeInitialBackfill) {
          pendingLiveOutputRef.current = [...pendingLiveOutputRef.current, event.chunk];
          activeCursorRef.current = event.chunk.cursor;
          runtime?.scheduleCursorPersist(event.chunk.cursor);
          return;
        }

        if (runtime && isTerminalDebugEnabled()) {
          const renderStartedAtMs = terminalDebugNowMs();
          runtime.terminal.write(event.chunk.content, () => {
            logTerminalDebug("terminal.output.rendered", {
              terminalId: terminal.id,
              cursor: event.chunk.cursor,
              charCount: event.chunk.content.length,
              renderMs: terminalDebugNowMs() - renderStartedAtMs
            });
          });
        } else {
          runtime?.terminal.write(event.chunk.content);
        }

        if (shouldRevealLatest) {
          runtime?.revealLatest();
        }
        activeCursorRef.current = event.chunk.cursor;
        updateOldestLoadedSeq(event.chunk.cursor);
        runtime?.scheduleCursorPersist(event.chunk.cursor);
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
      initialBackfillAppliedRef.current = false;
      pendingLiveOutputRef.current = [];
      onConnectionChange(paneId, "closed");
    };
  }, [
    loadOlderHistory,
    notifyTerminal,
    onConnectionChange,
    onRequireReload,
    onTerminalStatus,
    onUnauthorized,
    paneId,
    terminal?.id,
    terminal?.runtimeType,
    updateOldestLoadedSeq
  ]);

  const handleKeyboardFallback = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!useKeyboardFallback || !active || !terminal?.id) {
        return;
      }

      if (shouldBypassTerminalKeyboardFallback(event)) {
        return;
      }

      const sequence = translateKeyboardEventToTerminalInput(event.nativeEvent);

      if (!sequence) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      forwardTerminalInput(sequence);
      viewportRuntimeRef.current?.focus();
    },
    [active, forwardTerminalInput, terminal?.id, useKeyboardFallback]
  );

  const handlePasteFallback = useCallback(
    (event: ReactClipboardEvent<HTMLElement>) => {
      if (!useKeyboardFallback || !active || !terminal?.id) {
        return;
      }

      if (isTerminalManagedInputTarget(event.target)) {
        return;
      }

      const text = event.clipboardData.getData("text");

      if (!text) {
        return;
      }

      event.preventDefault();
      forwardTerminalInput(text);
      viewportRuntimeRef.current?.focus();
    },
    [active, forwardTerminalInput, terminal?.id, useKeyboardFallback]
  );

  return (
    <article
      className="terminal-pane-card"
      data-active={active}
      data-empty={!terminal}
      tabIndex={terminal ? 0 : -1}
      onMouseDown={(event) => {
        onActivate(paneId);
        event.currentTarget.focus({ preventScroll: true });
      }}
      onClick={() => {
        viewportRuntimeRef.current?.focus();
      }}
      onKeyDown={handleKeyboardFallback}
      onPaste={handlePasteFallback}
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
  enableTouchMomentum?: boolean;
  getCursor: () => string | null;
  onCursorChange: (cursor: string | null) => void;
  getHistoryPaging: () => {
    beforeSeq: number | null;
    hasOlder: boolean;
  };
  canResize: () => boolean;
  onInput: (content: string) => void;
  onResize: (dimensions: { cols: number; rows: number }) => void;
  onViewportTop?: () => void;
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
  const inputGate = createTerminalAttachInputGate((content) => {
    input.onInput(content);
  });
  let persistTimer: number | null = null;
  let cursorPersistTimer: number | null = null;
  let pendingCursor: string | null = null;
  let hasPendingCursor = false;
  let disposed = false;
  let hasCommittedFit = false;
  let lastFittedCols = terminal.cols;
  let lastFittedRows = terminal.rows;
  let touchPoint: { x: number; y: number } | null = null;
  let pendingTouchLines = 0;
  let touchVelocityLinesPerMs = 0;
  let lastTouchMoveAt = 0;
  let touchMomentumFrameId: number | null = null;
  let touchMomentumRemainder = 0;
  let touchMomentumEligible = false;
  const handleInteractionFocus = () => {
    terminal.focus();
  };

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(serializeAddon);
  terminal.onData((content) => {
    inputGate.enqueue(content);
  });
  const scrollSubscription =
    typeof terminal.onScroll === "function"
      ? terminal.onScroll((viewportY: number) => {
          if (viewportY === 0) {
            input.onViewportTop?.();
          }
          schedulePersist();
        })
      : null;
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
  const xtermRootElement = input.container.querySelector(".xterm");
  const viewportElement = input.container.querySelector(".xterm-viewport");
  const scrollTarget =
    viewportElement instanceof HTMLElement
      ? viewportElement
      : xtermRootElement instanceof HTMLElement
        ? xtermRootElement
        : input.container;
  const interactionTarget =
    xtermRootElement instanceof HTMLElement ? xtermRootElement : input.container;

  interactionTarget.addEventListener("mousedown", handleInteractionFocus, { passive: true });
  interactionTarget.addEventListener("pointerdown", handleInteractionFocus, { passive: true });

  // 默认交给 xterm 原生视口处理滚动，这里只做诊断采样，不再自己模拟滚动。
  scrollTarget.style.touchAction = "pan-y";
  scrollTarget.style.overscrollBehavior = "contain";
  if ("webkitOverflowScrolling" in scrollTarget.style) {
    scrollTarget.style.webkitOverflowScrolling = "touch";
  }

  const handleWheelIntent = (event: WheelEvent): boolean => {
    if (disposed || event.deltaY === 0) {
      return false;
    }

    const isAtTop = terminal.buffer.active.viewportY === 0;
    const hasScrollback = terminal.buffer.active.baseY > 0;

    // 没有 scrollback 时，禁止 xterm 把滚轮转成上下键发给 PTY。
    if (!hasScrollback) {
      if (event.deltaY < 0 && isAtTop) {
        input.onViewportTop?.();
      }
      return false;
    }

    return true;
  };

  const hasTerminalScrollback = (): boolean => {
    return terminal.buffer.active.baseY > 0 || terminal.buffer.active.viewportY > 0;
  };

  const stopTouchMomentum = (): void => {
    if (touchMomentumFrameId !== null) {
      window.cancelAnimationFrame(touchMomentumFrameId);
      touchMomentumFrameId = null;
    }
    touchMomentumRemainder = 0;
  };

  const handleTouchScrollIntent = (lines: number): boolean => {
    if (disposed || lines === 0) {
      return false;
    }

    const isAtTop = terminal.buffer.active.viewportY === 0;
    const previousViewportY = terminal.buffer.active.viewportY;
    const hasScrollback = hasTerminalScrollback();

    if (hasScrollback) {
      terminal.scrollLines(lines);
      const didScroll = terminal.buffer.active.viewportY !== previousViewportY;
      schedulePersist();
      return didScroll;
    }

    if (lines < 0 && isAtTop) {
      input.onViewportTop?.();
    }

    return false;
  };

  const startTouchMomentum = (): void => {
    if (!input.enableTouchMomentum) {
      touchVelocityLinesPerMs = 0;
      return;
    }

    stopTouchMomentum();

    if (
      !touchMomentumEligible ||
      !hasTerminalScrollback() ||
      Math.abs(touchVelocityLinesPerMs) < TERMINAL_TOUCH_MOMENTUM_MIN_LINES_PER_MS
    ) {
      touchVelocityLinesPerMs = 0;
      return;
    }

    let lastFrameAt = performance.now();
    let elapsedTotalMs = 0;
    let idleFrameCount = 0;

    const step = (frameAt: number) => {
      if (disposed) {
        stopTouchMomentum();
        return;
      }

      const elapsedMs = Math.max(1, frameAt - lastFrameAt);
      lastFrameAt = frameAt;
      elapsedTotalMs += elapsedMs;
      touchMomentumRemainder += touchVelocityLinesPerMs * elapsedMs;
      const lines = truncateTowardZero(touchMomentumRemainder);

      if (lines !== 0) {
        idleFrameCount = 0;
        touchMomentumRemainder -= lines;
        const didScroll = handleTouchScrollIntent(lines);

        if (!didScroll) {
          touchVelocityLinesPerMs = 0;
          stopTouchMomentum();
          return;
        }
      } else {
        idleFrameCount += 1;
      }

      touchVelocityLinesPerMs *= Math.pow(
        TERMINAL_TOUCH_MOMENTUM_FRICTION,
        elapsedMs / 16
      );

      if (
        idleFrameCount >= TERMINAL_TOUCH_MOMENTUM_MAX_IDLE_FRAMES ||
        elapsedTotalMs >= TERMINAL_TOUCH_MOMENTUM_MAX_DURATION_MS ||
        Math.abs(touchVelocityLinesPerMs) < TERMINAL_TOUCH_MOMENTUM_MIN_LINES_PER_MS
      ) {
        touchVelocityLinesPerMs = 0;
        stopTouchMomentum();
        return;
      }

      touchMomentumFrameId = window.requestAnimationFrame(step);
    };

    touchMomentumFrameId = window.requestAnimationFrame(step);
  };

  const handleTouchStart = (event: globalThis.TouchEvent) => {
    const touch = event.touches[0];

    stopTouchMomentum();
    touchVelocityLinesPerMs = 0;
    touchMomentumEligible = false;
    lastTouchMoveAt = performance.now();

    if (!touch) {
      touchPoint = null;
      return;
    }

    touchPoint = {
      x: touch.clientX,
      y: touch.clientY
    };
  };

  const handleTouchMove = (event: globalThis.TouchEvent) => {
    if (!touchPoint) {
      return;
    }

    const touch = event.touches[0];

    if (!touch) {
      return;
    }

    const deltaX = touch.clientX - touchPoint.x;
    const deltaY = touch.clientY - touchPoint.y;

    if (Math.abs(deltaY) <= Math.abs(deltaX)) {
      touchPoint = {
        x: touch.clientX,
        y: touch.clientY
      };
      return;
    }

    event.preventDefault();

    const now = performance.now();
    const elapsedMs = Math.max(1, now - lastTouchMoveAt);
    lastTouchMoveAt = now;
    const linesDelta = -deltaY / TERMINAL_TOUCH_LINE_HEIGHT_PX;
    pendingTouchLines += linesDelta;
    const lines = truncateTowardZero(pendingTouchLines);

    if (lines !== 0) {
      pendingTouchLines -= lines;
      const didScroll = handleTouchScrollIntent(lines);

      if (input.enableTouchMomentum && didScroll) {
        const nextVelocity = clampNumber(
          (lines / elapsedMs) * TERMINAL_TOUCH_MOMENTUM_GAIN,
          -TERMINAL_TOUCH_MOMENTUM_MAX_LINES_PER_MS,
          TERMINAL_TOUCH_MOMENTUM_MAX_LINES_PER_MS
        );
        touchVelocityLinesPerMs =
          touchVelocityLinesPerMs === 0
            ? nextVelocity
            : touchVelocityLinesPerMs * 0.35 + nextVelocity * 0.65;
        touchMomentumEligible = true;
      } else if (!didScroll) {
        touchVelocityLinesPerMs = 0;
        touchMomentumEligible = false;
      }
    }

    touchPoint = {
      x: touch.clientX,
      y: touch.clientY
    };
  };

  const handleTouchEnd = () => {
    touchPoint = null;
    pendingTouchLines = 0;
    startTouchMomentum();
  };

  const clearTouchScrollState = () => {
    touchPoint = null;
    pendingTouchLines = 0;
    touchVelocityLinesPerMs = 0;
    touchMomentumEligible = false;
    stopTouchMomentum();
  };

  if (typeof terminal.attachCustomWheelEventHandler === "function") {
    terminal.attachCustomWheelEventHandler(handleWheelIntent);
  }
  interactionTarget.addEventListener("touchstart", handleTouchStart, { passive: true });
  interactionTarget.addEventListener("touchmove", handleTouchMove, { passive: false });
  interactionTarget.addEventListener("touchend", handleTouchEnd, { passive: true });
  interactionTarget.addEventListener("touchcancel", clearTouchScrollState, { passive: true });

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

  const handlePageHide = () => {
    logTerminalDebug("terminal.persist.pagehide", {
      cursor: input.getCursor()
    });
    persistNow();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      logTerminalDebug("terminal.persist.visibility_hidden", {
        cursor: input.getCursor()
      });
      persistNow();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", handlePageHide);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
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

    const persistStartedAtMs = isTerminalDebugEnabled() ? terminalDebugNowMs() : 0;

    if (persistTimer !== null) {
      window.clearTimeout(persistTimer);
      persistTimer = null;
    }

    const viewState = buildPersistedTerminalViewState(
      terminal,
      serializeAddon,
      input.getCursor(),
      input.getHistoryPaging()
    );

    if (viewState) {
      if (cursorPersistTimer !== null) {
        window.clearTimeout(cursorPersistTimer);
        cursorPersistTimer = null;
      }
      hasPendingCursor = false;
    } else {
      persistCursorNow(input.getCursor());
    }

    input.onViewStateChange(viewState);

    if (isTerminalDebugEnabled()) {
      logTerminalDebug("terminal.persist.completed", {
        cursor: input.getCursor(),
        hasViewState: Boolean(viewState),
        contentLength: viewState?.content.length ?? 0,
        historyBeforeSeq: viewState?.historyBeforeSeq ?? null,
        durationMs: terminalDebugNowMs() - persistStartedAtMs
      });
    }
  }

  function persistCursorNow(cursor?: string | null): void {
    if (disposed) {
      return;
    }

    if (cursorPersistTimer !== null) {
      window.clearTimeout(cursorPersistTimer);
      cursorPersistTimer = null;
    }

    if (cursor !== undefined) {
      pendingCursor = cursor;
      hasPendingCursor = true;
    }

    if (!hasPendingCursor) {
      return;
    }

    input.onCursorChange(pendingCursor);
    hasPendingCursor = false;
  }

  function scheduleCursorPersist(cursor: string | null): void {
    if (disposed) {
      return;
    }

    pendingCursor = cursor;
    hasPendingCursor = true;

    if (cursorPersistTimer !== null) {
      window.clearTimeout(cursorPersistTimer);
    }

    cursorPersistTimer = window.setTimeout(() => {
      persistCursorNow();
    }, TERMINAL_CURSOR_PERSIST_DELAY_MS);
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
    }, TERMINAL_INTERACTION_PERSIST_DELAY_MS);
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

  function revealLatest(): void {
    scrollTerminalToBottom(terminal);
  }

  function shouldAutoRevealLatest(): boolean {
    return isTerminalViewportNearBottom(terminal);
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
    revealLatest,
    shouldAutoRevealLatest,
    prependHistory: async (
      content: string,
      anchorLine = countTerminalPlainTextLines(content),
      options: { replaceContent?: boolean } = {}
    ) => {
      if (!content) {
        return;
      }

      const previousViewportY = terminal.buffer.active.viewportY;
      const currentText = readTerminalPlainText(terminal);
      const nextText = options.replaceContent
        ? normalizeTerminalPlainTextBlock(content)
        : mergeTerminalPlainText(content, currentText);

      await new Promise<void>((resolve) => {
        terminal.reset();
        terminal.write(formatPlainTextForTerminalWrite(nextText), () => {
          const targetViewportY = Math.max(0, previousViewportY + Math.max(anchorLine, 0));

          if (targetViewportY > 0) {
            terminal.scrollToLine(targetViewportY);
          }

          resolve();
        });
      });
      schedulePersist();
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
    scheduleCursorPersist,
    schedulePersist,
    suspendInputForwarding: () => {
      inputGate.suspend();
    },
    resumeInputForwarding: (delayMs = 0) => {
      inputGate.resume(delayMs);
    },
    dispose: () => {
      disposed = true;
      inputGate.dispose();
      if (persistTimer !== null) {
        window.clearTimeout(persistTimer);
      }
      if (cursorPersistTimer !== null) {
        window.clearTimeout(cursorPersistTimer);
      }
      interactionTarget.removeEventListener("mousedown", handleInteractionFocus);
      interactionTarget.removeEventListener("pointerdown", handleInteractionFocus);
      interactionTarget.removeEventListener("touchstart", handleTouchStart);
      interactionTarget.removeEventListener("touchmove", handleTouchMove);
      interactionTarget.removeEventListener("touchend", handleTouchEnd);
      interactionTarget.removeEventListener("touchcancel", clearTouchScrollState);
      stopTouchMomentum();
      scrollSubscription?.dispose();
      resizeObserver?.disconnect();
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", handlePageHide);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      terminal.dispose();
      input.container.replaceChildren();
    }
  };
}

function truncateTowardZero(value: number): number {
  return value < 0 ? Math.ceil(value) : Math.floor(value);
}

function buildPersistedTerminalViewState(
  terminal: Terminal,
  serializeAddon: SerializeAddon,
  cursor: string | null,
  historyPaging: {
    beforeSeq: number | null;
    hasOlder: boolean;
  }
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
    viewportY: terminal.buffer.active.viewportY,
    historyBeforeSeq: historyPaging.beforeSeq,
    historyHasOlder: historyPaging.hasOlder
  };
}

function appendTerminalChunks(terminal: Terminal, chunks: TerminalOutputChunkDto[]): void {
  const orderedChunks = sortTerminalChunksByCursor(chunks);

  if (orderedChunks.length === 0) {
    return;
  }

  terminal.write(orderedChunks.map((chunk) => chunk.content).join(""));
}

function replaceTerminalChunks(terminal: Terminal, chunks: TerminalOutputChunkDto[]): void {
  terminal.reset();

  const orderedChunks = sortTerminalChunksByCursor(chunks);

  if (orderedChunks.length === 0) {
    return;
  }

  terminal.write(orderedChunks.map((chunk) => chunk.content).join(""));
}

function sortTerminalChunksByCursor(chunks: TerminalOutputChunkDto[]): TerminalOutputChunkDto[] {
  if (chunks.length < 2) {
    return chunks;
  }

  const indexedChunks = chunks.map((chunk, index) => ({
    chunk,
    index,
    cursor: Number(chunk.cursor)
  }));

  if (indexedChunks.some((item) => !Number.isFinite(item.cursor))) {
    return chunks;
  }

  return [...indexedChunks]
    .sort((left, right) => {
      if (left.cursor === right.cursor) {
        return left.index - right.index;
      }

      return left.cursor - right.cursor;
    })
    .map((item) => item.chunk);
}

function filterTerminalChunksAfterCursor(
  chunks: TerminalOutputChunkDto[],
  cursor: string | null
): TerminalOutputChunkDto[] {
  const orderedChunks = sortTerminalChunksByCursor(chunks);

  if (!cursor) {
    return orderedChunks;
  }

  const numericCursor = Number(cursor);

  if (!Number.isFinite(numericCursor)) {
    return orderedChunks;
  }

  return orderedChunks.filter((chunk) => {
    const chunkCursor = Number(chunk.cursor);
    return !Number.isFinite(chunkCursor) || chunkCursor > numericCursor;
  });
}

function scrollTerminalToBottom(terminal: Terminal): void {
  const terminalWithOptionalScrollToBottom = terminal as Terminal & {
    scrollToBottom?: () => void;
  };

  if (typeof terminalWithOptionalScrollToBottom.scrollToBottom === "function") {
    terminalWithOptionalScrollToBottom.scrollToBottom();
    return;
  }

  terminal.scrollToLine(terminal.buffer.active.baseY);
}

function isTerminalViewportNearBottom(terminal: Terminal, slackLines = 1): boolean {
  return terminal.buffer.active.baseY - terminal.buffer.active.viewportY <= slackLines;
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

function resolvePreferredTerminalShell(
  shellOptions: TerminalShellOptionDto[],
  selectedShell: string
): string | null {
  const normalizedSelectedShell = selectedShell.trim();

  if (normalizedSelectedShell) {
    const matched = shellOptions.find(
      (option) => option.available && option.shell === normalizedSelectedShell
    );

    if (matched) {
      return matched.shell;
    }
  }

  return shellOptions.find((option) => option.available)?.shell ?? null;
}

function resolveDefaultTerminalCreationRuntime(
  runtimeType: SelectableTerminalRuntimeType,
  osFamily: ReturnType<typeof usePlatform>["ui"]["osFamily"]
): SelectableTerminalRuntimeType {
  if (runtimeType) {
    return runtimeType;
  }

  return osFamily === "windows" ? "embedded-pty" : "tmux";
}

function shouldPromptForTerminalShellSelection(
  shellOptions: TerminalShellOptionDto[],
  isMobileLayout: boolean,
  osFamily: ReturnType<typeof usePlatform>["ui"]["osFamily"]
): boolean {
  if (isMobileLayout || osFamily !== "windows") {
    return false;
  }

  return shellOptions.filter((option) => option.available).length > 1;
}

function shouldBypassTerminalKeyboardFallback(
  event: ReactKeyboardEvent<HTMLElement>
): boolean {
  if (event.nativeEvent.isComposing || isTerminalManagedInputTarget(event.target)) {
    return true;
  }

  if (event.metaKey || event.altKey) {
    return true;
  }

  const currentTarget = event.currentTarget;

  if (currentTarget instanceof HTMLElement && currentTarget.dataset.empty === "true") {
    return true;
  }

  return false;
}

function isTerminalManagedInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();

  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  return target.isContentEditable;
}

export function translateKeyboardEventToTerminalInput(event: KeyboardEvent): string | null {
  const key = event.key;

  if (!key || key === "Process" || key === "Dead" || key === "Unidentified") {
    return null;
  }

  if (event.ctrlKey) {
    return translateCtrlKeyboardEvent(key);
  }

  if (key.length === 1) {
    return key;
  }

  switch (key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return "\u007f";
    case "Tab":
      return "\t";
    case "Escape":
      return "\u001b";
    case "ArrowUp":
      return "\u001b[A";
    case "ArrowDown":
      return "\u001b[B";
    case "ArrowRight":
      return "\u001b[C";
    case "ArrowLeft":
      return "\u001b[D";
    case "Home":
      return "\u001b[H";
    case "End":
      return "\u001b[F";
    case "Delete":
      return "\u001b[3~";
    case "Insert":
      return "\u001b[2~";
    case "PageUp":
      return "\u001b[5~";
    case "PageDown":
      return "\u001b[6~";
    default:
      return null;
  }
}

function translateCtrlKeyboardEvent(key: string): string | null {
  if (key.length === 1) {
    const normalizedKey = key.toUpperCase();

    if (normalizedKey >= "A" && normalizedKey <= "Z") {
      return String.fromCharCode(normalizedKey.charCodeAt(0) - 64);
    }

    switch (normalizedKey) {
      case "@":
      case " ":
        return "\u0000";
      case "[":
        return "\u001b";
      case "\\":
        return "\u001c";
      case "]":
        return "\u001d";
      case "^":
        return "\u001e";
      case "_":
        return "\u001f";
      default:
        return null;
    }
  }

  switch (key) {
    case "Enter":
      return "\n";
    case "Backspace":
      return "\b";
    case "Tab":
      return "\t";
    default:
      return null;
  }
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

function mergeTerminalPlainText(olderContent: string, currentContent: string): string {
  const normalizedOlder = normalizeTerminalPlainTextBlock(olderContent);
  const normalizedCurrent = normalizeTerminalPlainTextBlock(currentContent);

  if (!normalizedOlder) {
    return normalizedCurrent;
  }

  if (!normalizedCurrent) {
    return normalizedOlder;
  }

  return `${normalizedOlder}\n${normalizedCurrent}`;
}

function normalizeTerminalPlainTextBlock(content: string): string {
  return content.replace(/\r/g, "").replace(/\n+$/g, "").trimEnd();
}

function formatPlainTextForTerminalWrite(content: string): string {
  return content.replace(/\r?\n/g, "\r\n");
}

function countTerminalPlainTextLines(content: string): number {
  const normalized = normalizeTerminalPlainTextBlock(content);

  if (!normalized) {
    return 0;
  }

  return normalized.split("\n").length;
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
