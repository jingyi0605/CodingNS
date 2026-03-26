import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { t } from "../../../shared/i18n";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import {
  closeTerminal,
  createTerminal,
  deleteTerminalRecord,
  listTerminalShellOptions,
  listWorkspaceTerminals,
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
  connectionState: TerminalConnectionState;
  onActivate: (paneId: PaneId) => void;
  onConnectionChange: (paneId: PaneId, state: TerminalConnectionState) => void;
  onTerminalStatus: (terminal: Pick<TerminalDto, "id" | "status" | "statusDetail" | "processId">) => void;
  onRequireReload: () => Promise<void> | void;
  onUnauthorized: () => void;
  registerApi: (paneId: PaneId, api: TerminalPaneApi | null) => void;
  notifyTerminal: (title: string, tone?: ToastTone) => void;
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
const TERMINAL_ACTION_MENU_WIDTH = 196;
const TERMINAL_ACTION_MENU_OFFSET = 6;
const TERMINAL_ACTION_MENU_VIEWPORT_GUTTER = 12;
const INITIAL_PANE_BINDINGS: TerminalPaneBindings = {
  primary: null,
  secondary: null
};
const INITIAL_CONNECTION_STATES: Record<PaneId, TerminalConnectionState> = {
  primary: "closed",
  secondary: "closed"
};

export function TerminalPage() {
  const navigate = useNavigate();
  const { navigationGroups } = useWorkbenchShell();
  const terminalActionMenuRef = useRef<HTMLDivElement | null>(null);
  const terminalActionMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const terminalTabbarScrollRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const toolbarToggleRef = useRef<HTMLButtonElement | null>(null);
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

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [shellOptions, setShellOptions] = useState<TerminalShellOptionDto[]>([]);
  const [selectedShellId, setSelectedShellId] = useState("");
  const [selectedRuntimeType, setSelectedRuntimeType] =
    useState<SelectableTerminalRuntimeType>("");
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
  const [zoomScale, setZoomScale] = useState(() => readPersistedTerminalZoomScale() ?? 1);

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
  const updateActionMenuPosition = useCallback(() => {
    const trigger = terminalActionMenuTriggerRef.current;

    if (!trigger || !trigger.isConnected) {
      setActionMenu(null);
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const maxLeft = Math.max(
      TERMINAL_ACTION_MENU_VIEWPORT_GUTTER,
      window.innerWidth - TERMINAL_ACTION_MENU_WIDTH - TERMINAL_ACTION_MENU_VIEWPORT_GUTTER
    );
    const left = clampNumber(
      triggerRect.right - TERMINAL_ACTION_MENU_WIDTH,
      TERMINAL_ACTION_MENU_VIEWPORT_GUTTER,
      maxLeft
    );
    const top = Math.max(TERMINAL_ACTION_MENU_VIEWPORT_GUTTER, triggerRect.bottom + TERMINAL_ACTION_MENU_OFFSET);

    setActionMenu((current) => {
      if (!current) {
        return current;
      }

      if (current.left === left && current.top === top) {
        return current;
      }

      return {
        ...current,
        left,
        top
      };
    });
  }, []);

  const pinnedTerminalIdSet = useMemo(() => new Set(pinnedTerminalIds), [pinnedTerminalIds]);
  const manuallyDisconnectedTerminalIdSet = useMemo(
    () => new Set(manuallyDisconnectedTerminalIds),
    [manuallyDisconnectedTerminalIds]
  );
  const orderedTerminals = useMemo(
    () => sortTerminals(terminals, pinnedTerminalIdSet),
    [pinnedTerminalIdSet, terminals]
  );
  const selectedShellOption = useMemo(
    () => shellOptions.find((option) => option.id === selectedShellId) ?? null,
    [selectedShellId, shellOptions]
  );
  const runtimeOptions = useMemo(() => listTerminalRuntimeOptions(), []);
  const activeTerminalId = paneBindings[activePaneId];
  const activeTerminal = useMemo(
    () => terminals.find((terminal) => terminal.id === activeTerminalId) ?? null,
    [activeTerminalId, terminals]
  );
  const visiblePaneIds =
    splitDirection === "single" ? (["primary"] as PaneId[]) : (["primary", "secondary"] as PaneId[]);

  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);

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

        if (requestId !== terminalReloadRequestIdRef.current) {
          return;
        }

        terminalsRef.current = terminalResponse.items;
        setTerminals(terminalResponse.items);
        setManuallyDisconnectedTerminalIds((current) => {
          const existingTerminalIdSet = new Set(terminalResponse.items.map((terminal) => terminal.id));
          return current.filter((terminalId) => existingTerminalIdSet.has(terminalId));
        });
        setPinnedTerminalIds((current) => {
          const existingTerminalIdSet = new Set(terminalResponse.items.map((terminal) => terminal.id));
          const nextPinnedIds = current.filter((terminalId) => existingTerminalIdSet.has(terminalId));

          if (nextPinnedIds.length !== current.length) {
            persistPinnedTerminalIds(workspaceId, nextPinnedIds);
          }

          return nextPinnedIds;
        });

        const persistedTerminalId = readPersistedActiveTerminalId(workspaceId);
        const nextActiveTerminalId =
          pickActiveTerminalAfterReload({
            terminals: terminalResponse.items,
            preferredTerminalId: options.preferredTerminalId,
            currentActiveTerminalId:
              paneBindingsRef.current[activePaneIdRef.current] ?? paneBindingsRef.current.primary,
            persistedTerminalId
          })?.id ?? null;

        updatePaneBindings((current) =>
          normalizePaneBindings({
            terminals: terminalResponse.items,
            currentBindings: current,
            splitDirection: splitDirectionRef.current,
            fallbackTerminalId: nextActiveTerminalId,
            preferredPaneId: options.preferredPaneId ?? activePaneIdRef.current
          })
        );
      } catch (error) {
        if (requestId !== terminalReloadRequestIdRef.current) {
          return;
        }

        const detail = error instanceof Error ? error.message : t("terminal.workspaceLoadFailed");
        notifyTerminal(detail, "error");
      }
    },
    [notifyTerminal]
  );
  const requestReload = useCallback(() => {
    if (!selectedWorkspaceId) {
      return Promise.resolve();
    }

    return reloadWorkspaceResources(selectedWorkspaceId);
  }, [reloadWorkspaceResources, selectedWorkspaceId]);

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
    void (async () => {
      const shellResponse = await listTerminalShellOptions();
      setShellOptions(shellResponse.items);
      setSelectedShellId(pickDefaultShellId(shellResponse.items));
    })().catch(() => {
      notifyTerminal(t("terminal.workspaceLoadFailed"), "error");
    });
  }, [notifyTerminal]);

  useEffect(() => {
    const persistedWorkspaceId = readPersistedTerminalPageState().selectedWorkspaceId;
    const restoredWorkspaceId =
      workspaces.find((workspace) => workspace.id === persistedWorkspaceId)?.id ??
      workspaces[0]?.id ??
      "";

    setSelectedWorkspaceId((current) => {
      if (current && workspaces.some((workspace) => workspace.id === current)) {
        return current;
      }

      return restoredWorkspaceId;
    });
  }, [workspaces]);

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
    if (!actionMenu) {
      terminalActionMenuTriggerRef.current = null;
    }
  }, [actionMenu]);

  useEffect(() => {
    if (!actionMenu?.terminalId) {
      return;
    }

    const tabbarScrollElement = terminalTabbarScrollRef.current;
    const frameId = window.requestAnimationFrame(() => {
      updateActionMenuPosition();
    });

    window.addEventListener("resize", updateActionMenuPosition);
    window.addEventListener("scroll", updateActionMenuPosition, true);
    tabbarScrollElement?.addEventListener("scroll", updateActionMenuPosition, { passive: true });

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateActionMenuPosition);
      window.removeEventListener("scroll", updateActionMenuPosition, true);
      tabbarScrollElement?.removeEventListener("scroll", updateActionMenuPosition);
    };
  }, [actionMenu?.terminalId, updateActionMenuPosition]);

  useEffect(() => {
    if (!actionMenu && !toolbarOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node;
      const insideActionMenu =
        (terminalActionMenuRef.current?.contains(target) ?? false) ||
        (terminalActionMenuTriggerRef.current?.contains(target) ?? false);
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
      terminalsRef.current = [];
      setTerminals([]);
      updatePaneBindings(() => INITIAL_PANE_BINDINGS);
      updateActivePane("primary");
      setPaneConnectionStates(INITIAL_CONNECTION_STATES);
      setPendingTerminalCreationPaneId(null);
      return;
    }

    void reloadWorkspaceResources(selectedWorkspaceId);
  }, [reloadWorkspaceResources, selectedWorkspaceId]);

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

      setTerminals((current) =>
        current.map((terminal) =>
          terminal.id === terminalPatch.id
            ? {
                ...terminal,
                status: terminalPatch.status,
                statusDetail: terminalPatch.statusDetail,
                processId: terminalPatch.processId ?? terminal.processId ?? null
              }
            : terminal
        )
      );
    },
    []
  );

  function activatePane(paneId: PaneId): void {
    updateActivePane(paneId);
  }

  function bindTerminalToActivePane(terminalId: string): void {
    updatePaneBindings((current) => ({
      ...current,
      [activePaneIdRef.current]: terminalId,
      ...(splitDirectionRef.current === "single" ? { primary: terminalId, secondary: null } : {})
    }));
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

  function clearPendingTerminalCreation(paneId: PaneId): void {
    setPendingTerminalCreationPaneId((current) => (current === paneId ? null : current));
  }

  function applyCreatedTerminalLocally(terminal: TerminalDto, paneId: PaneId): void {
    const nextTerminals = upsertTerminal(terminalsRef.current, terminal);
    terminalsRef.current = nextTerminals;
    setTerminals(nextTerminals);
    updatePaneBindings((current) =>
      normalizePaneBindings({
        terminals: nextTerminals,
        currentBindings: {
          ...current,
          [paneId]: terminal.id,
          ...(splitDirectionRef.current === "single"
            ? {
                primary: terminal.id,
                secondary: null
              }
            : {})
        },
        splitDirection: splitDirectionRef.current,
        fallbackTerminalId: terminal.id,
        preferredPaneId: paneId
      })
    );
    setPaneConnectionStates((current) => ({
      ...current,
      [paneId]: terminal.status === "running" ? "reconnecting" : "closed"
    }));
    setManuallyDisconnectedTerminalIds((current) =>
      current.filter((item) => item !== terminal.id)
    );
  }

  async function handleCreateTerminal(): Promise<void> {
    if (!selectedWorkspaceId) {
      return;
    }

    const targetPaneId = activePaneIdRef.current;
    setCreatingTerminal(true);
    setPendingTerminalCreationPaneId(targetPaneId);

    try {
      const terminal = await submitTerminalCreation({
        workspaceId: selectedWorkspaceId,
        shell: selectedShellOption?.available ? selectedShellOption.shell : undefined,
        runtimeType: selectedRuntimeType || undefined
      });

      if (!terminal) {
        clearPendingTerminalCreation(targetPaneId);
        return;
      }

      applyCreatedTerminalLocally(terminal, targetPaneId);
      clearPendingTerminalCreation(targetPaneId);
      await reloadWorkspaceResources(selectedWorkspaceId, {
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
    if (!selectedWorkspaceId) {
      return;
    }

    try {
      await closeTerminal(terminalId);
      await reloadWorkspaceResources(selectedWorkspaceId);
      notifyTerminal(t("terminal.closed"), "success");
    } catch (error) {
      notifyTerminal(error instanceof Error ? error.message : t("terminal.closeFailed"), "error");
    }
  }

  async function handleDeleteTerminal(terminalId: string): Promise<void> {
    if (!selectedWorkspaceId) {
      return;
    }

    try {
      await deleteTerminalRecord(terminalId);
      setActionMenu(null);
      updatePaneBindings((current) => ({
        primary: current.primary === terminalId ? null : current.primary,
        secondary: current.secondary === terminalId ? null : current.secondary
      }));
      setPinnedTerminalIds((current) => {
        const nextPinnedIds = current.filter((item) => item !== terminalId);
        persistPinnedTerminalIds(selectedWorkspaceId, nextPinnedIds);
        return nextPinnedIds;
      });
      await reloadWorkspaceResources(selectedWorkspaceId);
      notifyTerminal(t("terminal.deleted"), "success");
    } catch (error) {
      notifyTerminal(error instanceof Error ? error.message : t("terminal.deleteFailed"), "error");
    }
  }

  async function handleDuplicateTerminal(terminal: TerminalDto): Promise<void> {
    if (!selectedWorkspaceId) {
      return;
    }

    const targetPaneId = activePaneIdRef.current;

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

    const targetPaneId = activePaneIdRef.current;
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
    const paneId = findPaneIdByTerminalId(terminalId, paneBindings, splitDirection, activePaneId);

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
    const paneId = findPaneIdByTerminalId(terminalId, paneBindings, splitDirection, activePaneId);

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
        splitDirection,
        paneBindings,
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

  return (
    <main className="terminal-layout">
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
      <section className="terminal-shell">
        <header className="terminal-tabbar">
          <div className="terminal-tabbar-main">
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
                const indicatorStatus = resolveTerminalIndicatorStatus({
                  terminal,
                  paneBindings,
                  paneConnectionStates,
                  manuallyDisconnectedTerminalIdSet
                });

                return (
                  <div
                    key={terminal.id}
                    className="terminal-tab-shell"
                    data-active={isActive}
                    data-assigned={isTerminalAssigned(terminal.id, paneBindings, splitDirection)}
                  >
                    <button
                      className="terminal-tab"
                      data-active={isActive}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => {
                        bindTerminalToActivePane(terminal.id);
                      }}
                      onAuxClick={(event) => {
                        if (event.button !== 1) {
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
                    </span>
                  </button>
                    <button
                      className="terminal-tab-inline-action"
                      type="button"
                      data-open={menuOpen}
                      aria-haspopup="menu"
                      aria-label={t("terminal.moreActions")}
                      aria-expanded={menuOpen}
                      onClick={(event) => {
                        event.stopPropagation();

                        if (menuOpen) {
                          setActionMenu(null);
                          return;
                        }

                        terminalActionMenuTriggerRef.current = event.currentTarget;
                        setActionMenu({
                          terminalId: terminal.id,
                          top: 0,
                          left: 0
                        });
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
                disabled={
                  !selectedWorkspaceId ||
                  creatingTerminal ||
                  (selectedShellOption?.available === false && shellOptions.length > 0)
                }
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
          </div>
        </header>

        {actionMenu ? (
          <div
            ref={terminalActionMenuRef}
            className="terminal-tab-menu terminal-tab-menu-floating"
            role="menu"
            style={{
              top: `${actionMenu.top}px`,
              left: `${actionMenu.left}px`
            }}
          >
            {(() => {
              const terminal = terminals.find((item) => item.id === actionMenu.terminalId);

              if (!terminal) {
                return null;
              }

              const isPinned = pinnedTerminalIdSet.has(terminal.id);
              const canControlConnection = terminal.id === activeTerminalId && terminal.status === "running";
              const activeConnectionState = paneConnectionStates[activePaneId];

              return (
                <>
                  <button
                    type="button"
                    className="terminal-tab-menu-item"
                    role="menuitem"
                    onClick={() => {
                      bindTerminalToActivePane(terminal.id);
                      setActionMenu(null);
                    }}
                  >
                    {t("terminal.bindToPaneAction")}
                  </button>
                  <button
                    type="button"
                    className="terminal-tab-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setActionMenu(null);
                      void handleDuplicateTerminal(terminal);
                    }}
                  >
                    {t("terminal.duplicateAction")}
                  </button>
                  <div className="terminal-tab-menu-divider" role="separator" />
                  <button
                    type="button"
                    className="terminal-tab-menu-item"
                    role="menuitem"
                    disabled={!canControlConnection || activeConnectionState !== "connected"}
                    onClick={() => {
                      handleDisconnectTerminal(terminal.id);
                    }}
                  >
                    {t("terminal.disconnectAction")}
                  </button>
                  <button
                    type="button"
                    className="terminal-tab-menu-item"
                    role="menuitem"
                    disabled={!canControlConnection || activeConnectionState === "connected"}
                    onClick={() => {
                      handleReconnectTerminal(terminal.id);
                    }}
                  >
                    {t("terminal.reconnectAction")}
                  </button>
                  <div className="terminal-tab-menu-divider" role="separator" />
                  <button
                    type="button"
                    className="terminal-tab-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setActionMenu(null);
                      void handleCloseTerminal(terminal.id);
                    }}
                  >
                    {t("terminal.closeButton")}
                  </button>
                  <button
                    type="button"
                    className="terminal-tab-menu-item"
                    role="menuitem"
                    onClick={() => {
                      void handleDeleteTerminal(terminal.id);
                    }}
                  >
                    {t("terminal.deleteAction")}
                  </button>
                  <button
                    type="button"
                    className="terminal-tab-menu-item"
                    role="menuitem"
                    onClick={() => {
                      handleTogglePin(terminal.id);
                    }}
                  >
                    {isPinned ? t("terminal.unpinAction") : t("terminal.pinAction")}
                  </button>
                </>
              );
            })()}
          </div>
        ) : null}

        <div className="terminal-stage-surface">
          <div className="terminal-stage-grid" data-layout={splitDirection}>
            {visiblePaneIds.map((paneId) => {
              const terminalId = paneBindings[paneId];
              const terminal = terminals.find((item) => item.id === terminalId) ?? null;

              return (
                <TerminalWorkspacePane
                  key={`${paneId}-${terminal?.id ?? "empty"}`}
                  paneId={paneId}
                  paneLabel={paneId === "primary" ? t("terminal.panePrimary") : t("terminal.paneSecondary")}
                  terminal={terminal}
                  pendingCreation={!terminal && pendingTerminalCreationPaneId === paneId}
                  zoomScale={zoomScale}
                  active={activePaneId === paneId}
                  connectionState={paneConnectionStates[paneId]}
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
      </section>
    </main>
  );
}

function TerminalWorkspacePane({
  paneId,
  paneLabel,
  terminal,
  pendingCreation,
  zoomScale,
  active,
  connectionState,
  onActivate,
  onConnectionChange,
  onTerminalStatus,
  onRequireReload,
  onUnauthorized,
  registerApi,
  notifyTerminal
}: TerminalWorkspacePaneProps) {
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
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

  const displayedConnectionState: TerminalConnectionState =
    terminal?.status === "running" ? connectionState : "closed";

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
        <div className="terminal-empty-state terminal-empty-state-inline">
          <span className="terminal-pane-label">{paneLabel}</span>
          <h1>{t("terminal.stageEmptyTitle")}</h1>
          <p>{t("terminal.splitEmptySubtitle")}</p>
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
  const terminal = new Terminal({
    cols: input.restoredViewState?.cols ?? DEFAULT_TERMINAL_COLS,
    rows: input.restoredViewState?.rows ?? DEFAULT_TERMINAL_ROWS,
    cursorBlink: true,
    scrollback: 2000,
    allowTransparency: true,
    fontFamily: '"Cascadia Mono", "Cascadia Code", "Consolas", monospace',
    fontSize: input.fontSize,
    theme: {
      background: "#09121f",
      foreground: "#d6e6ff",
      cursor: "#f5f8ff",
      selectionBackground: "rgba(121, 169, 255, 0.28)"
    }
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

function pickDefaultShellId(options: TerminalShellOptionDto[]): string {
  return (
    options.find((option) => option.id === "cmd" && option.available)?.id ??
    options.find((option) => option.available)?.id ??
    options[0]?.id ??
    ""
  );
}

function hasUsableContainerSize(container: HTMLDivElement): boolean {
  return (
    container.clientWidth >= MIN_TERMINAL_PIXEL_WIDTH &&
    container.clientHeight >= MIN_TERMINAL_PIXEL_HEIGHT
  );
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
