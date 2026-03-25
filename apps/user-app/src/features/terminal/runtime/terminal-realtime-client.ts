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
  | { type: "terminal.resize.accepted"; terminalId: string; cols: number; rows: number }
  | {
      type: "terminal.backfill";
      terminalId: string;
      truncated: boolean;
      latestCursor: string | null;
      chunks: TerminalOutputChunkDto[];
    }
  | { type: "terminal.output"; terminalId: string; chunk: TerminalOutputChunkDto }
  | {
      type: "terminal.status";
      terminal: {
        id: string;
        status: "creating" | "running" | "closed" | "error";
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
  private lastCursor: string | null;
  private isSubscribed = false;
  private pendingResize: { cols: number; rows: number } | null = null;
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

  reconnectNow(): void {
    this.connectionManager.reconnectNow();
  }

  close(): void {
    this.disposed = true;
    this.connectionManager.close();
    this.socket?.close();
    this.socket = null;
    this.isSubscribed = false;
  }

  private connect(forceReset: boolean): void {
    if (this.disposed) {
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
        return;
      }

      if (payload.type === "terminal.error") {
        if (payload.error_code === "UNAUTHORIZED") {
          this.options.onUnauthorized();
          return;
        }

        this.options.onError(payload);
        return;
      }

      if (payload.type === "terminal.resize.accepted") {
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

      this.options.onStatus(payload);
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

  private sendMessage(payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(payload));
  }

  private flushPendingResize(): void {
    if (!this.pendingResize) {
      return;
    }

    this.sendMessage({
      type: "terminal.resize",
      terminalId: this.options.terminalId,
      cols: this.pendingResize.cols,
      rows: this.pendingResize.rows
    });
  }
}
