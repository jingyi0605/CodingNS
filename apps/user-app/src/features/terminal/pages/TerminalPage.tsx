import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { t } from "../../../shared/i18n";
import { useToast, type ToastTone } from "../../../shared/toast";
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

export function TerminalPage() {
  const navigate = useNavigate();
  const { navigationGroups } = useWorkbenchShell();
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalActionMenuRef = useRef<HTMLDivElement | null>(null);
  const realtimeClientRef = useRef<TerminalRealtimeClient | null>(null);
  const viewportRuntimeRef = useRef<TerminalViewportRuntime | null>(null);
  const activeCursorRef = useRef<string | null>(null);
  const activeRecoveryStateRef = useRef<"idle_closed" | null>(null);
  const activeTerminalStatusRef = useRef<TerminalDto["status"] | null>(null);
  const workspaces = useMemo(
    () => navigationGroups.map((group) => group.workspace),
    [navigationGroups]
  );

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [shellOptions, setShellOptions] = useState<TerminalShellOptionDto[]>([]);
  const [selectedShellId, setSelectedShellId] = useState("");
  const [terminals, setTerminals] = useState<TerminalDto[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [actionMenu, setActionMenu] = useState<TerminalActionMenuState | null>(null);
  const [activeConnectionState, setActiveConnectionState] = useState<TerminalConnectionState>("closed");
  const [pinnedTerminalIds, setPinnedTerminalIds] = useState<string[]>([]);
  const [zoomScale, setZoomScale] = useState(() => readPersistedTerminalZoomScale() ?? 1);
  const { showToast } = useToast();

  const notifyTerminal = useCallback(
    (title: string, tone: ToastTone = "info") => {
      showToast({ title, tone });
    },
    [showToast]
  );

  const activeTerminal = useMemo(
    () => terminals.find((terminal) => terminal.id === activeTerminalId) ?? null,
    [activeTerminalId, terminals]
  );
  const pinnedTerminalIdSet = useMemo(() => new Set(pinnedTerminalIds), [pinnedTerminalIds]);
  const orderedTerminals = useMemo(
    () => sortTerminals(terminals, pinnedTerminalIdSet),
    [pinnedTerminalIdSet, terminals]
  );
  const selectedShellOption = useMemo(
    () => shellOptions.find((option) => option.id === selectedShellId) ?? null,
    [selectedShellId, shellOptions]
  );
  const displayedConnectionState: TerminalConnectionState =
    activeTerminal?.status === "running" ? activeConnectionState : "closed";

  useEffect(() => {
    activeTerminalStatusRef.current = activeTerminal?.status ?? null;
  }, [activeTerminal]);

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
  }, [activeTerminalId, selectedWorkspaceId]);

  useEffect(() => {
    if (!actionMenu) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (!terminalActionMenuRef.current?.contains(event.target as Node)) {
        setActionMenu(null);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setActionMenu(null);
      }
    }

    function handleViewportShift(): void {
      setActionMenu(null);
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleViewportShift);
    window.addEventListener("scroll", handleViewportShift, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleViewportShift);
      window.removeEventListener("scroll", handleViewportShift, true);
    };
  }, [actionMenu]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setTerminals([]);
      setActiveTerminalId(null);
      return;
    }

    void reloadWorkspaceResources(selectedWorkspaceId);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }

    persistActiveTerminalId(selectedWorkspaceId, activeTerminalId);
  }, [activeTerminalId, selectedWorkspaceId]);

  useEffect(() => {
    viewportRuntimeRef.current?.dispose();
    viewportRuntimeRef.current = null;

    if (!activeTerminalId || !terminalContainerRef.current) {
      return;
    }

    const persistedViewState = readTerminalRecoveryState(activeTerminalId).viewState;
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
        persistTerminalViewState(activeTerminalId, viewState);
      }
    });

    viewportRuntimeRef.current = runtime;

    return () => {
      runtime.persistNow();
      runtime.dispose();
      if (viewportRuntimeRef.current === runtime) {
        viewportRuntimeRef.current = null;
      }
    };
  }, [activeTerminalId, zoomScale]);

  useEffect(() => {
    viewportRuntimeRef.current?.setFontSize(buildTerminalFontSize(zoomScale));
    viewportRuntimeRef.current?.reflow();
  }, [zoomScale]);

  useEffect(() => {
    realtimeClientRef.current?.close();
    realtimeClientRef.current = null;
    activeRecoveryStateRef.current = null;
    setActiveConnectionState("closed");

    if (!activeTerminalId) {
      activeCursorRef.current = null;
      return;
    }

    const recoveryState = readTerminalRecoveryState(activeTerminalId);
    const persistedViewState = recoveryState.viewState;
    const resumeCursor = recoveryState.resumeCursor;
    activeCursorRef.current = resumeCursor;

    const client = new TerminalRealtimeClient({
      terminalId: activeTerminalId,
      lastCursor: resumeCursor,
      onConnectionChange: (state: TerminalConnectionState) => {
        setActiveConnectionState(state);
      },
      onSubscribed: () => {
        viewportRuntimeRef.current?.focus();
      },
      onBackfill: (event) => {
        const runtime = viewportRuntimeRef.current;

        if (runtime) {
          if (runtime.restoredFromSnapshot) {
            appendTerminalChunks(runtime.terminal, event.chunks);
          } else {
            replaceTerminalChunks(runtime.terminal, event.chunks);
          }

          runtime.schedulePersist();
        }

        const nextCursor = event.latestCursor ?? activeCursorRef.current;
        activeCursorRef.current = nextCursor;
        persistTerminalCursor(activeTerminalId, nextCursor);

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
        persistTerminalCursor(activeTerminalId, event.chunk.cursor);
      },
      onStatus: (event) => {
        setTerminals((current) =>
          current.map((terminal) =>
            terminal.id === event.terminal.id
              ? {
                  ...terminal,
                  status: event.terminal.status,
                  statusDetail: event.terminal.statusDetail
                }
              : terminal
          )
        );

        if (event.terminal.id !== activeTerminalId) {
          return;
        }

        activeTerminalStatusRef.current = event.terminal.status;
        if (event.terminal.status !== "running") {
          setActiveConnectionState("closed");
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
        if (event.terminalId !== activeTerminalId) {
          return;
        }

        if (event.error_code === "TERMINAL_NOT_RUNNING") {
          if (selectedWorkspaceId) {
            void reloadWorkspaceResources(selectedWorkspaceId);
          }
          return;
        }

        if (event.error_code === "INVALID_TERMINAL_SIZE") {
          return;
        }

        notifyTerminal(event.detail, "error");
      },
      onUnauthorized: () => {
        navigate("/login", { replace: true });
      }
    });

    realtimeClientRef.current = client;
    client.start();

    return () => {
      client.close();
    };
  }, [activeTerminalId, navigate, notifyTerminal, selectedWorkspaceId]);

  function activateTerminal(terminalId: string | null, workspaceId = selectedWorkspaceId): void {
    setActiveTerminalId(terminalId);

    if (!workspaceId) {
      return;
    }

    persistActiveTerminalId(workspaceId, terminalId);
  }

  async function reloadWorkspaceResources(
    workspaceId: string,
    options: {
      preferredTerminalId?: string | null;
    } = {}
  ): Promise<void> {
    try {
      const terminalResponse = await listWorkspaceTerminals(workspaceId);
      setTerminals(terminalResponse.items);
      setPinnedTerminalIds((current) => {
        const existingTerminalIdSet = new Set(terminalResponse.items.map((terminal) => terminal.id));
        const nextPinnedIds = current.filter((terminalId) => existingTerminalIdSet.has(terminalId));

        if (nextPinnedIds.length !== current.length) {
          persistPinnedTerminalIds(workspaceId, nextPinnedIds);
        }

        return nextPinnedIds;
      });

      const persistedTerminalId = readPersistedActiveTerminalId(workspaceId);
      const nextActiveTerminal = pickActiveTerminalAfterReload({
        terminals: terminalResponse.items,
        preferredTerminalId: options.preferredTerminalId,
        currentActiveTerminalId: activeTerminalId,
        persistedTerminalId
      });

      activateTerminal(nextActiveTerminal?.id ?? null, workspaceId);

      const restoredMessage = nextActiveTerminal ? readTerminalRestoreMessage(nextActiveTerminal) : null;

      if (restoredMessage) {
        notifyTerminal(restoredMessage, "warning");
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : t("terminal.workspaceLoadFailed");
      notifyTerminal(detail, "error");
    }
  }

  async function handleCreateTerminal(): Promise<void> {
    if (!selectedWorkspaceId) {
      return;
    }

    setCreatingTerminal(true);

    try {
      const terminal = await createTerminal({
        workspaceId: selectedWorkspaceId,
        name: buildTerminalName(terminals.length),
        shell: selectedShellOption?.available ? selectedShellOption.shell : undefined
      });

      persistActiveTerminalId(selectedWorkspaceId, terminal.id);
      await reloadWorkspaceResources(selectedWorkspaceId, {
        preferredTerminalId: terminal.id
      });
    } catch (error) {
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
    } catch (error) {
      notifyTerminal(error instanceof Error ? error.message : t("terminal.closeFailed"), "error");
    }
  }

  async function handleDeleteTerminal(terminalId: string): Promise<void> {
    if (!selectedWorkspaceId) {
      return;
    }

    try {
      if (terminalId === activeTerminalId) {
        realtimeClientRef.current?.close();
      }

      await deleteTerminalRecord(terminalId);
      setActionMenu(null);
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

  async function handleCopyTerminal(terminal: TerminalDto): Promise<void> {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error(t("terminal.copyFailed"));
      }

      const content =
        terminal.id === activeTerminalId
          ? viewportRuntimeRef.current?.readPlainText() ?? ""
          : extractPlainTextFromSnapshot(terminal.id);

      if (!content.trim()) {
        notifyTerminal(t("terminal.copyEmpty"), "warning");
        return;
      }

      await navigator.clipboard.writeText(content);
      setActionMenu(null);
      notifyTerminal(t("terminal.copySuccess"), "success");
    } catch (error) {
      notifyTerminal(error instanceof Error ? error.message : t("terminal.copyFailed"), "error");
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
    if (terminalId !== activeTerminalId) {
      return;
    }

    realtimeClientRef.current?.disconnect();
    setActionMenu(null);
    notifyTerminal(t("terminal.disconnected"), "warning");
  }

  function handleReconnectTerminal(terminalId: string): void {
    if (terminalId !== activeTerminalId) {
      return;
    }

    setActiveConnectionState("reconnecting");
    realtimeClientRef.current?.reconnectNow();
    setActionMenu(null);
    notifyTerminal(t("terminal.reconnectRequested"));
  }

  function updateZoomScale(nextZoomScale: number): void {
    setZoomScale(clampZoomScale(nextZoomScale));
  }

  return (
    <main className="terminal-layout">
      <section className="terminal-shell">
        <header className="terminal-tabbar">
          <div className="terminal-tabbar-scroll" role="tablist" aria-label={t("terminal.title")}>
            {orderedTerminals.map((terminal) => {
              const isActive = terminal.id === activeTerminalId;
              const isPinned = pinnedTerminalIdSet.has(terminal.id);
              const canControlConnection = isActive && terminal.status === "running";
              const menuOpen = actionMenu?.terminalId === terminal.id;

              return (
                <div
                  key={terminal.id}
                  className="terminal-tab-shell"
                  data-active={isActive}
                >
                  <button
                    className="terminal-tab"
                    data-active={isActive}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => {
                      activateTerminal(terminal.id);
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
                      {isPinned ? <span className="terminal-tab-pin-indicator">•</span> : null}
                      {terminal.name}
                    </span>
                    <span className="terminal-tab-meta" data-status={terminal.status}>
                      {terminal.status}
                    </span>
                  </button>
                  <button
                    className="terminal-tab-more"
                    type="button"
                    aria-label={t("terminal.moreActions")}
                    aria-expanded={menuOpen}
                    onClick={(event) => {
                      event.stopPropagation();
                      const triggerRect = event.currentTarget.getBoundingClientRect();

                      setActionMenu((current) =>
                        current?.terminalId === terminal.id
                          ? null
                          : {
                              terminalId: terminal.id,
                              top: triggerRect.bottom + 10,
                              left: Math.max(12, triggerRect.right - 160)
                            }
                      );
                    }}
                  >
                    ⋯
                  </button>
                </div>
              );
            })}
            <button
              className="terminal-tab terminal-tab-create"
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
              +
            </button>
          </div>

          <div className="terminal-tabbar-actions">
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
              const canControlConnection =
                terminal.id === activeTerminalId && terminal.status === "running";

              return (
                <>
                  <button
                    type="button"
                    className="terminal-tab-menu-item"
                    role="menuitem"
                    onClick={() => {
                      void handleCopyTerminal(terminal);
                    }}
                  >
                    {t("terminal.copyAction")}
                  </button>
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

        <div
          className="terminal-stage-surface"
          onClick={() => {
            viewportRuntimeRef.current?.focus();
          }}
        >
          <div className="terminal-stage-panel">
            {activeTerminal ? (
              <>
                <div className="terminal-stage-toolbar">
                  <div className="terminal-stage-context">
                    <strong>{activeTerminal.name}</strong>
                    <span>{activeTerminal.cwd}</span>
                  </div>
                  <span
                    className="terminal-stage-connection"
                    data-state={displayedConnectionState}
                  >
                    {t(`terminal.connection.${displayedConnectionState}`)}
                  </span>
                </div>
                <div className="terminal-canvas">
                  <div ref={terminalContainerRef} className="terminal-xterm" />
                </div>
              </>
            ) : (
              <div className="terminal-empty-state">
                <h1>{t("terminal.stageEmptyTitle")}</h1>
                <p>
                  {selectedWorkspaceId
                    ? t("terminal.stageEmptySubtitle")
                    : t("terminal.workspaceLoadFailed")}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
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
      (dimensions.cols === lastFittedCols && dimensions.rows === lastFittedRows)
    ) {
      return;
    }

    fitAddon.fit();
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

function readTerminalRestoreMessage(terminal: TerminalDto): string | null {
  if (terminal.status === "closed" && terminal.statusDetail === "TERMINAL_IDLE_TIMEOUT") {
    return t("terminal.recoveryIdleClosed");
  }

  return null;
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

function buildTerminalName(existingCount: number): string {
  return `${t("terminal.defaultTerminalName")} ${existingCount + 1}`;
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

function buildTerminalFontSize(zoomScale: number): number {
  return Math.round(DEFAULT_TERMINAL_FONT_SIZE * clampZoomScale(zoomScale) * 10) / 10;
}

function formatZoomPercent(zoomScale: number): string {
  return `${Math.round(clampZoomScale(zoomScale) * 100)}%`;
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
