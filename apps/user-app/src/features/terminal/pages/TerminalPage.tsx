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
  listTerminalShellOptions,
  listWorkspaceTerminals,
  type TerminalDto,
  type TerminalShellOptionDto
} from "../api/terminal-api";
import {
  persistActiveTerminalId,
  persistSelectedWorkspaceId,
  persistTerminalCursor,
  persistTerminalViewState,
  readTerminalRecoveryState,
  readPersistedActiveTerminalId,
  readPersistedTerminalPageState,
  type PersistedTerminalViewState
} from "../runtime/terminal-page-persistence";
import {
  TerminalRealtimeClient,
  type TerminalConnectionState,
  type TerminalOutputChunkDto
} from "../runtime/terminal-realtime-client";

interface TerminalViewportRuntime {
  terminal: Terminal;
  restoredFromSnapshot: boolean;
  focus: () => void;
  persistNow: () => void;
  schedulePersist: () => void;
  dispose: () => void;
}

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 30;
const PERSISTED_TERMINAL_SCROLLBACK = 160;
const MAX_PERSISTED_TERMINAL_VIEW_CHARS = 120_000;
const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 5;
const MIN_TERMINAL_PIXEL_WIDTH = 320;
const MIN_TERMINAL_PIXEL_HEIGHT = 120;

export function TerminalPage() {
  const navigate = useNavigate();
  const { navigationGroups } = useWorkbenchShell();
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
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
  const selectedShellOption = useMemo(
    () => shellOptions.find((option) => option.id === selectedShellId) ?? null,
    [selectedShellId, shellOptions]
  );

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
  }, [activeTerminalId]);

  useEffect(() => {
    realtimeClientRef.current?.close();
    realtimeClientRef.current = null;
    activeRecoveryStateRef.current = null;

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
      onConnectionChange: (_state: TerminalConnectionState) => {},
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

  async function reloadWorkspaceResources(workspaceId: string): Promise<void> {
    try {
      const terminalResponse = await listWorkspaceTerminals(workspaceId);
      setTerminals(terminalResponse.items);

      const persistedTerminalId = readPersistedActiveTerminalId(workspaceId);
      const nextActiveTerminal =
        terminalResponse.items.find((terminal) => terminal.id === persistedTerminalId) ??
        terminalResponse.items.find((terminal) => terminal.id === activeTerminalId) ??
        terminalResponse.items[0] ??
        null;

      setActiveTerminalId(nextActiveTerminal?.id ?? null);

      if (persistedTerminalId) {
        const restoredTerminal = terminalResponse.items.find(
          (terminal) => terminal.id === persistedTerminalId
        );
        const restoredMessage = restoredTerminal ? readTerminalRestoreMessage(restoredTerminal) : null;

        if (restoredMessage) {
          notifyTerminal(restoredMessage, "warning");
        }
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

      await reloadWorkspaceResources(selectedWorkspaceId);
      setActiveTerminalId(terminal.id);
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

  return (
    <main className="terminal-layout">
      <section className="terminal-shell">
        <header className="terminal-tabbar" role="tablist" aria-label={t("terminal.title")}>
          {terminals.map((terminal) => (
            <button
              key={terminal.id}
              className="terminal-tab"
              data-active={terminal.id === activeTerminalId}
              type="button"
              role="tab"
              aria-selected={terminal.id === activeTerminalId}
              onClick={() => {
                setActiveTerminalId(terminal.id);
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) {
                  return;
                }

                event.preventDefault();
                void handleCloseTerminal(terminal.id);
              }}
            >
              <span className="terminal-tab-name">{terminal.name}</span>
              <span className="terminal-tab-meta" data-status={terminal.status}>
                {terminal.status}
              </span>
            </button>
          ))}
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
        </header>

        <div
          className="terminal-stage-surface"
          onClick={() => {
            viewportRuntimeRef.current?.focus();
          }}
        >
          {activeTerminal ? (
            <div className="terminal-canvas">
              <div ref={terminalContainerRef} className="terminal-xterm" />
            </div>
          ) : (
            <div className="terminal-empty-state">
              <h1>{t("terminal.stageEmptyTitle")}</h1>
              <p>{selectedWorkspaceId ? t("terminal.stageEmptySubtitle") : t("terminal.workspaceLoadFailed")}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function createTerminalViewportRuntime(input: {
  container: HTMLDivElement;
  restoredViewState: PersistedTerminalViewState | null;
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
    fontSize: 14,
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
