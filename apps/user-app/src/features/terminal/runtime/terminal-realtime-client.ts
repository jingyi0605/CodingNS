import { getHostWebSocketUrl } from "../../../config/env";
import { authStore } from "../../auth/store/auth-store";
import { ConnectionManager } from "../../../network/connection-manager";

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
  | { type: "terminal.input.accepted"; terminalId: string }
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
  private socket: WebSocket | null = null;
  private disposed = false;
  private authRecoveryInFlight = false;
  private manuallyDisconnected = false;
  private lastCursor: string | null;
  private isSubscribed = false;
  private pendingInput = "";
  private pendingResize: { cols: number; rows: number } | null = null;
  private lastSentResizeKey: string | null = null;
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

    if (!this.canSendRealtimePayload()) {
      this.pendingInput += content;
      return;
    }

    this.sendTerminalInput(content);
  }

  sendCurrentDimensions(cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
      return;
    }

    this.resize(cols, rows);
  }

  private sendTerminalInput(content: string): void {
    this.sendMessage({
      type: "terminal.input",
      terminalId: this.options.terminalId,
      content
    });
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

    const socketUrl = `${getHostWebSocketUrl("/ws")}?access_token=${encodeURIComponent(accessToken)}`;
    const socket = new WebSocket(socketUrl);

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
      const payload = JSON.parse(raw.data as string) as TerminalIncomingEvent;

      if (payload.type === "system.connected") {
        this.connectionManager.markConnected();
        return;
      }

      if (payload.type === "terminal.subscribed") {
        this.isSubscribed = true;
        this.options.onSubscribed();
        this.flushPendingResize();
        this.flushPendingInput();
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
        return;
      }

      if (payload.type === "terminal.backfill") {
        this.lastCursor = payload.latestCursor ?? this.lastCursor;
        this.options.onBackfill(payload);
        return;
      }

      if (payload.type === "terminal.output") {
        this.lastCursor = payload.chunk.cursor;
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

  private flushPendingInput(): void {
    if (!this.pendingInput || !this.canSendRealtimePayload()) {
      return;
    }

    const bufferedInput = this.pendingInput;
    this.pendingInput = "";
    this.sendTerminalInput(bufferedInput);
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
}
