import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { t } from "../../../shared/i18n";
import { listWorkspaces, type WorkspaceDto } from "../../conversation/api/conversation-api";
import {
  closeTerminal,
  createTerminal,
  createTerminalTemplate,
  listTerminalShellOptions,
  listWorkspaceTemplates,
  listWorkspaceTerminals,
  runTerminalTemplate,
  sendTerminalInput,
  type TerminalDto,
  type TerminalShellOptionDto,
  type TerminalTemplateDto
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

interface TemplateDraftState {
  name: string;
  command: string;
  args: string;
}

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

export function TerminalPage() {
  const navigate = useNavigate();
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const realtimeClientRef = useRef<TerminalRealtimeClient | null>(null);
  const viewportRuntimeRef = useRef<TerminalViewportRuntime | null>(null);
  const activeCursorRef = useRef<string | null>(null);
  const activeRecoveryStateRef = useRef<"idle_closed" | null>(null);

  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [shellOptions, setShellOptions] = useState<TerminalShellOptionDto[]>([]);
  const [selectedShellId, setSelectedShellId] = useState("");
  const [terminals, setTerminals] = useState<TerminalDto[]>([]);
  const [templates, setTemplates] = useState<TerminalTemplateDto[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<TerminalConnectionState>("closed");
  const [pageMessage, setPageMessage] = useState("");
  const [terminalInput, setTerminalInput] = useState("");
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraftState>({
    name: "",
    command: "",
    args: ""
  });

  useEffect(() => {
    void (async () => {
      const [workspaceResponse, shellResponse] = await Promise.all([
        listWorkspaces(),
        listTerminalShellOptions()
      ]);
      setWorkspaces(workspaceResponse.items);
      setShellOptions(shellResponse.items);

      const defaultShellId = pickDefaultShellId(shellResponse.items);
      setSelectedShellId(defaultShellId);

      const persistedWorkspaceId = readPersistedTerminalPageState().selectedWorkspaceId;
      const restoredWorkspaceId =
        workspaceResponse.items.find((workspace) => workspace.id === persistedWorkspaceId)?.id ??
        workspaceResponse.items[0]?.id ??
        "";

      setSelectedWorkspaceId(restoredWorkspaceId);
    })().catch(() => {
      setPageMessage(t("terminal.workspaceLoadFailed"));
    });
  }, []);

  useEffect(() => {
    persistSelectedWorkspaceId(selectedWorkspaceId || null);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setTerminals([]);
      setTemplates([]);
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
    setSubscribed(false);
    activeRecoveryStateRef.current = null;

    if (!activeTerminalId) {
      activeCursorRef.current = null;
      setConnectionState("closed");
      return;
    }

    const recoveryState = readTerminalRecoveryState(activeTerminalId);
    const persistedViewState = recoveryState.viewState;
    const resumeCursor = recoveryState.resumeCursor;
    activeCursorRef.current = resumeCursor;
    setConnectionState("reconnecting");

    const client = new TerminalRealtimeClient({
      terminalId: activeTerminalId,
      lastCursor: resumeCursor,
      onConnectionChange: setConnectionState,
      onSubscribed: () => {
        setSubscribed(true);
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
          setPageMessage(t("terminal.recoveryIdleClosed"));
          return;
        }

        if (resumeCursor) {
          setPageMessage(
            event.truncated ? t("terminal.recoveryTruncated") : t("terminal.recoveryComplete")
          );
          return;
        }

        setPageMessage(t("terminal.connectedHint"));
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

        if (event.terminal.status === "closed" && event.terminal.statusDetail === "TERMINAL_IDLE_TIMEOUT") {
          activeRecoveryStateRef.current = "idle_closed";
          setPageMessage(t("terminal.recoveryIdleClosed"));
          return;
        }

        if (event.terminal.status === "error" && event.terminal.statusDetail) {
          setPageMessage(event.terminal.statusDetail);
        }
      },
      onError: (event) => {
        setPageMessage(event.detail);
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
  }, [activeTerminalId, navigate]);

  const activeTerminal = useMemo(
    () => terminals.find((terminal) => terminal.id === activeTerminalId) ?? null,
    [activeTerminalId, terminals]
  );
  const selectedShellOption = useMemo(
    () => shellOptions.find((option) => option.id === selectedShellId) ?? null,
    [selectedShellId, shellOptions]
  );

  async function reloadWorkspaceResources(workspaceId: string): Promise<void> {
    try {
      const [terminalResponse, templateResponse] = await Promise.all([
        listWorkspaceTerminals(workspaceId),
        listWorkspaceTemplates(workspaceId)
      ]);

      setTerminals(terminalResponse.items);
      setTemplates(templateResponse.items);

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
          setPageMessage(restoredMessage);
          return;
        }
      }

      setPageMessage("");
    } catch (error) {
      const detail = error instanceof Error ? error.message : t("terminal.workspaceLoadFailed");
      setPageMessage(detail);
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
        name: t("terminal.defaultTerminalName"),
        shell: selectedShellOption?.available ? selectedShellOption.shell : undefined
      });

      await reloadWorkspaceResources(selectedWorkspaceId);
      setActiveTerminalId(terminal.id);
      setPageMessage(t("terminal.created"));
    } catch (error) {
      setPageMessage(error instanceof Error ? error.message : t("terminal.createFailed"));
    } finally {
      setCreatingTerminal(false);
    }
  }

  async function handleSendInput(): Promise<void> {
    if (!activeTerminalId || !terminalInput.trim()) {
      return;
    }

    try {
      if (realtimeClientRef.current) {
        realtimeClientRef.current.sendInput(`${terminalInput}\r`);
      } else {
        await sendTerminalInput(activeTerminalId, `${terminalInput}\r`);
      }

      setTerminalInput("");
      viewportRuntimeRef.current?.focus();
    } catch (error) {
      setPageMessage(error instanceof Error ? error.message : t("terminal.inputFailed"));
    }
  }

  async function handleCloseTerminal(): Promise<void> {
    if (!activeTerminalId || !selectedWorkspaceId) {
      return;
    }

    try {
      await closeTerminal(activeTerminalId);
      await reloadWorkspaceResources(selectedWorkspaceId);
      setPageMessage(t("terminal.closed"));
    } catch (error) {
      setPageMessage(error instanceof Error ? error.message : t("terminal.closeFailed"));
    }
  }

  async function handleCreateTemplate(): Promise<void> {
    if (!selectedWorkspaceId) {
      return;
    }

    try {
      await createTerminalTemplate({
        workspaceId: selectedWorkspaceId,
        name: templateDraft.name,
        command: templateDraft.command,
        args: splitArgs(templateDraft.args)
      });

      setTemplateDraft({
        name: "",
        command: "",
        args: ""
      });
      await reloadWorkspaceResources(selectedWorkspaceId);
      setPageMessage(t("terminal.templateCreated"));
    } catch (error) {
      setPageMessage(error instanceof Error ? error.message : t("terminal.templateCreateFailed"));
    }
  }

  async function handleRunTemplate(templateId: string): Promise<void> {
    try {
      const result = await runTerminalTemplate(templateId, {
        terminalId: activeTerminalId ?? undefined,
        shell:
          !activeTerminalId && selectedShellOption?.available
            ? selectedShellOption.shell
            : undefined
      });

      if (selectedWorkspaceId) {
        await reloadWorkspaceResources(selectedWorkspaceId);
      }

      setActiveTerminalId(result.terminalId);
      setPageMessage(
        result.createdTerminal
          ? t("terminal.templateRunCreatedTerminal")
          : t("terminal.templateRunSent")
      );
    } catch (error) {
      setPageMessage(error instanceof Error ? error.message : t("terminal.templateRunFailed"));
    }
  }

  return (
    <main className="terminal-layout">
      <div className="terminal-layout-inner">
        <section className="terminal-hero surface-card">
          <div className="badge-row">
            <span className="badge">{t("terminal.title")}</span>
            <span className="badge" data-tone={mapConnectionTone(connectionState)}>
              {t(`terminal.connection.${connectionState}`)}
            </span>
            {subscribed ? <span className="badge">{t("terminal.liveConnected")}</span> : null}
          </div>
          <h1>{t("terminal.heroTitle")}</h1>
          <p className="status-text">{t("terminal.heroSubtitle")}</p>
          <div className="badge-row">
            <button
              className="ghost-button"
              type="button"
              onClick={() => realtimeClientRef.current?.reconnectNow()}
            >
              {t("terminal.reconnect")}
            </button>
          </div>
        </section>

        <section className="terminal-grid">
          <aside className="terminal-side">
            <section className="terminal-panel surface-card">
              <h2>{t("terminal.workspaceSection")}</h2>
              <div className="field-group">
                <label htmlFor="terminal-workspace">{t("terminal.workspaceField")}</label>
                <select
                  id="terminal-workspace"
                  className="terminal-select"
                  value={selectedWorkspaceId}
                  onChange={(event) => {
                    setSelectedWorkspaceId(event.target.value);
                  }}
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="terminal-shell">{t("terminal.shellField")}</label>
                <select
                  id="terminal-shell"
                  className="terminal-select"
                  value={selectedShellId}
                  onChange={(event) => {
                    setSelectedShellId(event.target.value);
                  }}
                >
                  {shellOptions.map((option) => (
                    <option key={option.id} value={option.id} disabled={!option.available}>
                      {option.available
                        ? option.label
                        : `${option.label} - ${t("terminal.shellUnavailable")}`}
                    </option>
                  ))}
                </select>
                {selectedShellOption?.available === false && selectedShellOption.unavailableReason ? (
                  <p className="status-text">{selectedShellOption.unavailableReason}</p>
                ) : null}
              </div>
              <button
                className="primary-button"
                type="button"
                disabled={
                  !selectedWorkspaceId ||
                  creatingTerminal ||
                  (selectedShellOption?.available === false && shellOptions.length > 0)
                }
                onClick={() => {
                  void handleCreateTerminal();
                }}
              >
                {creatingTerminal ? t("terminal.creating") : t("terminal.createButton")}
              </button>
            </section>

            <section className="terminal-panel surface-card">
              <h2>{t("terminal.terminalSection")}</h2>
              <div className="terminal-list">
                {terminals.map((terminal) => (
                  <button
                    key={terminal.id}
                    className="terminal-card"
                    data-active={terminal.id === activeTerminalId}
                    type="button"
                    onClick={() => {
                      setActiveTerminalId(terminal.id);
                    }}
                  >
                    <strong>{terminal.name}</strong>
                    <small>{terminal.status}</small>
                    <small>{terminal.shell}</small>
                    <small>{terminal.cwd}</small>
                  </button>
                ))}
                {terminals.length === 0 ? (
                  <p className="status-text">{t("terminal.emptyTerminals")}</p>
                ) : null}
              </div>
            </section>

            <section className="terminal-panel surface-card">
              <h2>{t("terminal.templateSection")}</h2>
              <div className="terminal-template-list">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    className="terminal-template-card"
                    type="button"
                    onClick={() => {
                      void handleRunTemplate(template.id);
                    }}
                  >
                    <strong>{template.name}</strong>
                    <small>{template.command}</small>
                    <small>{template.args.join(" ")}</small>
                  </button>
                ))}
                {templates.length === 0 ? (
                  <p className="status-text">{t("terminal.emptyTemplates")}</p>
                ) : null}
              </div>
              <div className="field-group">
                <label htmlFor="template-name">{t("terminal.templateName")}</label>
                <input
                  id="template-name"
                  value={templateDraft.name}
                  onChange={(event) => {
                    setTemplateDraft((current) => ({ ...current, name: event.target.value }));
                  }}
                />
              </div>
              <div className="field-group">
                <label htmlFor="template-command">{t("terminal.templateCommand")}</label>
                <input
                  id="template-command"
                  value={templateDraft.command}
                  onChange={(event) => {
                    setTemplateDraft((current) => ({ ...current, command: event.target.value }));
                  }}
                />
              </div>
              <div className="field-group">
                <label htmlFor="template-args">{t("terminal.templateArgs")}</label>
                <input
                  id="template-args"
                  value={templateDraft.args}
                  onChange={(event) => {
                    setTemplateDraft((current) => ({ ...current, args: event.target.value }));
                  }}
                />
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={!selectedWorkspaceId}
                onClick={() => {
                  void handleCreateTemplate();
                }}
              >
                {t("terminal.templateCreateButton")}
              </button>
            </section>
          </aside>

          <section className="terminal-stage">
            <section className="terminal-panel terminal-panel-large surface-card">
              <div className="terminal-stage-header">
                <div>
                  <h2>{activeTerminal?.name ?? t("terminal.stageEmptyTitle")}</h2>
                  <p className="status-text">
                    {activeTerminal?.cwd ?? t("terminal.stageEmptySubtitle")}
                  </p>
                </div>
                <div className="badge-row">
                  {activeTerminal ? (
                    <span
                      className="badge"
                      data-tone={activeTerminal.status === "error" ? "error" : "connected"}
                    >
                      {activeTerminal.status}
                    </span>
                  ) : null}
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={!activeTerminal}
                    onClick={() => {
                      void handleCloseTerminal();
                    }}
                  >
                    {t("terminal.closeButton")}
                  </button>
                </div>
              </div>
              <div
                className="terminal-output"
                onClick={() => {
                  viewportRuntimeRef.current?.focus();
                }}
              >
                {activeTerminal ? (
                  <div ref={terminalContainerRef} className="terminal-xterm" />
                ) : (
                  <p className="status-text">{t("terminal.outputEmpty")}</p>
                )}
              </div>
              <div className="terminal-composer">
                <div className="field-group">
                  <label htmlFor="terminal-input">{t("terminal.inputLabel")}</label>
                  <input
                    id="terminal-input"
                    value={terminalInput}
                    placeholder={t("terminal.inputPlaceholder")}
                    onChange={(event) => {
                      setTerminalInput(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleSendInput();
                      }
                    }}
                  />
                </div>
                <div className="terminal-composer-actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!activeTerminal || !terminalInput.trim()}
                    onClick={() => {
                      void handleSendInput();
                    }}
                  >
                    {t("terminal.sendButton")}
                  </button>
                </div>
              </div>
              {pageMessage ? <p className="status-text">{pageMessage}</p> : null}
            </section>
          </section>
        </section>
      </div>
    </main>
  );
}

function createTerminalViewportRuntime(input: {
  container: HTMLDivElement;
  restoredViewState: PersistedTerminalViewState | null;
  getCursor: () => string | null;
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

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(serializeAddon);
  terminal.onData((content) => {
    input.onInput(content);
  });
  terminal.onResize(({ cols, rows }) => {
    input.onResize({ cols, rows });
    schedulePersist();
  });

  input.container.replaceChildren();
  terminal.open(input.container);

  if (input.restoredViewState?.content) {
    terminal.write(input.restoredViewState.content, () => {
      if (input.restoredViewState && input.restoredViewState.viewportY > 0) {
        terminal.scrollToLine(input.restoredViewState.viewportY);
      }

      window.requestAnimationFrame(() => {
        fitToContainer();
      });
    });
  } else {
    window.requestAnimationFrame(() => {
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
    if (disposed) {
      return;
    }

    const dimensions = fitAddon.proposeDimensions();

    if (!dimensions || dimensions.cols < 20 || dimensions.rows < 5) {
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

function splitArgs(input: string): string[] {
  return input
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapConnectionTone(connectionState: TerminalConnectionState) {
  if (connectionState === "connected") {
    return "connected";
  }

  if (connectionState === "reconnecting") {
    return "reconnecting";
  }

  if (connectionState === "reconnect_failed") {
    return "reconnect_failed";
  }

  return "failed";
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
