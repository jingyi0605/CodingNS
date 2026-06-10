import { getHostBaseUrl, getHostWebSocketUrl } from "../../../config/env";
import { authStore } from "../../auth/store/auth-store";
import { ConnectionManager } from "../../../network/connection-manager";
import { resolveHostTransportTarget } from "../../../network/host-transport-registry";
import { buildHostWsPath } from "../../../network/host-ws-path";
import type { HostTransportSocket } from "../../../network/host-transport";
import {
  createTerminalDebugTraceId,
  isTerminalDebugEnabled,
  logTerminalDebug,
  terminalDebugNowMs
} from "./terminal-debug-log";

const TERMINAL_INPUT_FLUSH_DELAY_MS = 8;
const TERMINAL_INPUT_TRACE_MAX_AGE_MS = 10_000;

export type TerminalConnectionState =
  | "connected"
  | "reconnecting"
  | "reconnect_failed"
  | "closed";

export interface TerminalOutputChunkDto {
  terminalId: string;
  cursor: string;
  stream: "stdout";
  content: string;
  timestamp: string;
}

type TerminalIncomingEvent =
  | { type: "system.connected" }
  | { type: "terminal.subscribed"; terminalId: string }
  | { type: "terminal.input.accepted"; terminalId: string; clientTraceId?: string }
  | { type: "terminal.resize.accepted"; terminalId: string; cols: number; rows: number }
  | {
      type: "terminal.backfill";
      terminalId: string;
      truncated: boolean;
      cursorReset: boolean;
      latestCursor: string | null;
      chunks: TerminalOutputChunkDto[];
    }
  | { type: "terminal.output"; terminalId: string; chunk: TerminalOutputChunkDto }
  | {
      type: "terminal.status";
      terminal: {
        id: string;
        status: "creating" | "running" | "closed" | "error";
        processId?: number | null;
        statusDetail: string | null;
      };
    }
  | {
      type: "terminal.exit";
      terminalId: string;
      requestedClose: boolean;
      terminal: {
        id: string;
        status: "creating" | "running" | "closed" | "error";
        processId?: number | null;
        statusDetail: string | null;
      };
    }
  | { type: "terminal.error"; terminalId: string; error_code: string; detail: string };

export interface TerminalRealtimeClientOptions {
  targetHostId?: string | null;
  terminalId: string;
  lastCursor: string | null;
  onConnectionChange: (state: TerminalConnectionState) => void;
  onSubscribed: () => void;
  onBackfill: (event: Extract<TerminalIncomingEvent, { type: "terminal.backfill" }>) => void;
  onOutput: (event: Extract<TerminalIncomingEvent, { type: "terminal.output" }>) => void;
  onStatus: (event: Extract<TerminalIncomingEvent, { type: "terminal.status" }>) => void;
  onError: (event: Extract<TerminalIncomingEvent, { type: "terminal.error" }>) => void;
  onUnauthorized: () => void;
}

export class TerminalRealtimeClient {
  private socket: HostTransportSocket | null = null;
  private disposed = false;
  private authRecoveryInFlight = false;
  private manuallyDisconnected = false;
  private lastCursor: string | null;
  private isSubscribed = false;
  private pendingInput = "";
  private inputFlushTimer: number | null = null;
  private pendingInputQueuedAtMs: number | null = null;
  private pendingResize: { cols: number; rows: number } | null = null;
  private lastSentResizeKey: string | null = null;
  private readonly inputDebugTraces = new Map<
    string,
    {
      traceId: string;
      queuedAtMs: number;
      sentAtMs: number;
      ackedAtMs: number | null;
      charCount: number;
      preview: string;
    }
  >();
  private readonly connectionManager: ConnectionManager;

  constructor(private readonly options: TerminalRealtimeClientOptions) {
    this.lastCursor = options.lastCursor;
    this.connectionManager = new ConnectionManager({
      onReconnect: (forceReset) => {
        this.connect(forceReset);
      },
      onStateChange: options.onConnectionChange
    });
  }

  start(): void {
    this.connectionManager.start();
  }

  updateCursor(cursor: string | null): void {
    this.lastCursor = cursor;
  }

  sendInput(content: string): void {
    if (!content) {
      return;
    }

    if (this.pendingInputQueuedAtMs === null) {
      this.pendingInputQueuedAtMs = terminalDebugNowMs();
    }

    this.pendingInput += content;
    this.logDebug("input.queued", {
      charCount: content.length,
      pendingCharCount: this.pendingInput.length,
      preview: summarizeTerminalDebugContent(content)
    });

    if (!this.canSendRealtimePayload()) {
      return;
    }

    this.pruneStaleInputDebugTraces();
    this.scheduleInputFlush();
  }

  sendCurrentDimensions(cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
      return;
    }

    this.resize(cols, rows);
  }

  private sendTerminalInput(content: string): void {
    const queuedAtMs = this.pendingInputQueuedAtMs ?? terminalDebugNowMs();
    const sentAtMs = terminalDebugNowMs();
    const debugEnabled = isTerminalDebugEnabled();
    const clientTraceId = debugEnabled
      ? createTerminalDebugTraceId(this.options.terminalId)
      : undefined;

    if (clientTraceId) {
      this.inputDebugTraces.set(clientTraceId, {
        traceId: clientTraceId,
        queuedAtMs,
        sentAtMs,
        ackedAtMs: null,
        charCount: content.length,
        preview: summarizeTerminalDebugContent(content)
      });
    }

    this.logDebug("input.sent", {
      traceId: clientTraceId ?? null,
      charCount: content.length,
      queuedForMs: sentAtMs - queuedAtMs,
      preview: summarizeTerminalDebugContent(content)
    });

    this.sendMessage({
      type: "terminal.input",
      terminalId: this.options.terminalId,
      content,
      ...(clientTraceId
        ? {
            clientTraceId,
            clientSentAtMs: sentAtMs
          }
        : {})
    });
    this.pendingInputQueuedAtMs = null;
  }

  resize(cols: number, rows: number): void {
    this.pendingResize = { cols, rows };

    if (!this.isSubscribed) {
      return;
    }

    this.flushPendingResize();
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    this.isSubscribed = false;
    this.inputDebugTraces.clear();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.options.onConnectionChange("closed");
  }

  reconnectNow(): void {
    this.manuallyDisconnected = false;
    this.connectionManager.reconnectNow();
  }

  close(): void {
    this.disposed = true;
    this.manuallyDisconnected = true;
    this.connectionManager.close();
    this.clearInputFlushTimer();
    this.inputDebugTraces.clear();
    this.socket?.close();
    this.socket = null;
    this.isSubscribed = false;
  }

  private connect(forceReset: boolean): void {
    if (this.disposed) {
      return;
    }

    if (this.manuallyDisconnected) {
      return;
    }

    if (forceReset && this.socket) {
      this.socket.close();
      this.socket = null;
    }

    const accessToken = authStore.getState().session?.accessToken;

    if (!accessToken) {
      this.options.onUnauthorized();
      return;
    }

    const requestedBaseUrl = getHostBaseUrl();
    const transportTarget = resolveHostTransportTarget(requestedBaseUrl);
    const baseUrl = transportTarget.baseUrl;
    const wsPath = buildHostWsPath(this.options.targetHostId);
    const socketUrl = `${getHostWebSocketUrl(wsPath, baseUrl)}?access_token=${encodeURIComponent(accessToken)}`;
    const socket = transportTarget.transport.createWebSocket({
      path: wsPath,
      baseUrl,
      url: socketUrl
    });

    this.socket = socket;

    socket.addEventListener("open", () => {
      this.isSubscribed = false;
      socket.send(
        JSON.stringify({
          type: "terminal.subscribe",
          terminalId: this.options.terminalId,
          lastCursor: this.lastCursor
        })
      );
    });

    socket.addEventListener("message", (raw) => {
      const data = readSocketMessageData(raw);

      if (typeof data !== "string") {
        return;
      }

      const payload = JSON.parse(data) as TerminalIncomingEvent;

      if (payload.type === "system.connected") {
        this.connectionManager.markConnected();
        return;
      }

      if (payload.type === "terminal.subscribed") {
        this.isSubscribed = true;
        this.options.onSubscribed();
        this.flushPendingResize();
        this.flushPendingInput(true);
        return;
      }

      if (payload.type === "terminal.error") {
        if (payload.error_code === "UNAUTHORIZED") {
          this.handleUnauthorized();
          return;
        }

        this.options.onError(payload);
        return;
      }

      if (payload.type === "terminal.resize.accepted") {
        return;
      }

      if (payload.type === "terminal.input.accepted") {
        this.pruneStaleInputDebugTraces();
        if (payload.clientTraceId) {
          const trace = this.inputDebugTraces.get(payload.clientTraceId);

          if (trace) {
            trace.ackedAtMs = terminalDebugNowMs();
            this.logDebug("input.acknowledged", {
              traceId: trace.traceId,
              charCount: trace.charCount,
              sendToAckMs: trace.ackedAtMs - trace.sentAtMs,
              preview: trace.preview
            });
          }
        }
        return;
      }

      if (payload.type === "terminal.backfill") {
        this.lastCursor = payload.latestCursor ?? this.lastCursor;
        this.options.onBackfill(payload);
        return;
      }

      if (payload.type === "terminal.output") {
        this.lastCursor = payload.chunk.cursor;
        this.pruneStaleInputDebugTraces();
        this.handleDebugOutput(payload.chunk.content, payload.chunk.cursor);
        this.options.onOutput(payload);
        return;
      }

      if (payload.type === "terminal.status") {
        this.options.onStatus(payload);
        return;
      }

      if (payload.type === "terminal.exit") {
        return;
      }
    });

    socket.addEventListener("close", () => {
      if (this.disposed || this.socket !== socket) {
        return;
      }

      this.isSubscribed = false;
      this.connectionManager.markDisconnected();
    });

    socket.addEventListener("error", () => {
      if (this.disposed || this.socket !== socket) {
        return;
      }

      this.connectionManager.markTransientFailure();
    });
  }

  private handleUnauthorized(): void {
    if (this.authRecoveryInFlight || this.disposed) {
      return;
    }

    this.authRecoveryInFlight = true;
    const socket = this.socket;
    this.socket = null;
    this.isSubscribed = false;
    socket?.close();

    void authStore.refresh().then((result) => {
      this.authRecoveryInFlight = false;

      if (this.disposed || this.manuallyDisconnected) {
        return;
      }

      if (result.status === "refreshed") {
        this.connectionManager.reconnectNow();
        return;
      }

      if (result.status === "deferred") {
        this.connectionManager.markDisconnected();
        return;
      }

      this.options.onUnauthorized();
    });
  }

  private sendMessage(payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(payload));
  }

  private canSendRealtimePayload(): boolean {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN && this.isSubscribed);
  }

  private flushPendingInput(forceImmediate = false): void {
    if (!this.pendingInput || !this.canSendRealtimePayload()) {
      return;
    }

    if (!forceImmediate) {
      this.clearInputFlushTimer();
    }

    const bufferedInput = this.pendingInput;
    this.pendingInput = "";
    this.sendTerminalInput(bufferedInput);
  }

  private scheduleInputFlush(): void {
    if (this.inputFlushTimer !== null) {
      return;
    }

    this.inputFlushTimer = window.setTimeout(() => {
      this.inputFlushTimer = null;
      this.flushPendingInput(true);
    }, TERMINAL_INPUT_FLUSH_DELAY_MS);
  }

  private clearInputFlushTimer(): void {
    if (this.inputFlushTimer === null) {
      return;
    }

    window.clearTimeout(this.inputFlushTimer);
    this.inputFlushTimer = null;
  }

  private flushPendingResize(): void {
    if (!this.pendingResize || !this.canSendRealtimePayload()) {
      return;
    }

    const nextResize = this.pendingResize;
    const nextResizeKey = `${nextResize.cols}x${nextResize.rows}`;

    if (this.lastSentResizeKey === nextResizeKey) {
      this.pendingResize = null;
      return;
    }

    this.sendMessage({
      type: "terminal.resize",
      terminalId: this.options.terminalId,
      cols: nextResize.cols,
      rows: nextResize.rows
    });

    this.lastSentResizeKey = nextResizeKey;
    this.pendingResize = null;
  }

  private handleDebugOutput(content: string, cursor: string): void {
    if (!isTerminalDebugEnabled()) {
      return;
    }

    const firstTrace = this.inputDebugTraces.values().next().value as
      | {
          traceId: string;
          queuedAtMs: number;
          sentAtMs: number;
          ackedAtMs: number | null;
          charCount: number;
          preview: string;
        }
      | undefined;

    if (!firstTrace) {
      return;
    }

    const receivedAtMs = terminalDebugNowMs();
    this.inputDebugTraces.delete(firstTrace.traceId);
    this.logDebug("output.received_after_input", {
      traceId: firstTrace.traceId,
      cursor,
      charCount: content.length,
      sendToOutputMs: receivedAtMs - firstTrace.sentAtMs,
      ackToOutputMs:
        firstTrace.ackedAtMs === null ? null : receivedAtMs - firstTrace.ackedAtMs,
      preview: summarizeTerminalDebugContent(content)
    });
  }

  private logDebug(scope: string, detail: Record<string, unknown>): void {
    logTerminalDebug(`terminal.${scope}`, {
      terminalId: this.options.terminalId,
      ...detail
    });
  }

  private pruneStaleInputDebugTraces(): void {
    if (!isTerminalDebugEnabled() || this.inputDebugTraces.size === 0) {
      return;
    }

    const nowMs = terminalDebugNowMs();

    for (const [traceId, trace] of this.inputDebugTraces.entries()) {
      const ageMs = nowMs - trace.sentAtMs;

      if (ageMs < TERMINAL_INPUT_TRACE_MAX_AGE_MS) {
        continue;
      }

      this.inputDebugTraces.delete(traceId);
      this.logDebug("input.trace_expired", {
        traceId,
        ageMs,
        charCount: trace.charCount,
        preview: trace.preview
      });
    }
  }
}

function readSocketMessageData(raw: Event): unknown {
  if (typeof MessageEvent !== "undefined" && raw instanceof MessageEvent) {
    return raw.data;
  }

  return (raw as { data?: unknown }).data;
}

function summarizeTerminalDebugContent(content: string): string {
  return content
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .slice(0, 60);
}
