import { getHostWebSocketUrl } from "../../../config/env";
import { authStore } from "../../auth/store/auth-store";

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
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private disposed = false;
  private lastCursor: string | null;
  private isSubscribed = false;
  private pendingResize: { cols: number; rows: number } | null = null;

  constructor(private readonly options: TerminalRealtimeClientOptions) {
    this.lastCursor = options.lastCursor;
  }

  start(): void {
    this.connect(false);
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
    this.reconnectAttempts = 0;
    this.connect(true);
  }

  close(): void {
    this.disposed = true;

    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.options.onConnectionChange("closed");
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

    if (this.reconnectAttempts > 0) {
      this.options.onConnectionChange("reconnecting");
    }

    const socketUrl = `${getHostWebSocketUrl("/ws")}?access_token=${encodeURIComponent(accessToken)}`;
    const socket = new WebSocket(socketUrl);

    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
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
        this.options.onConnectionChange("connected");
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
      if (this.disposed) {
        return;
      }

      this.isSubscribed = false;
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.disposed) {
        return;
      }

      this.options.onConnectionChange("reconnecting");
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;

    if (this.reconnectAttempts > 4) {
      this.options.onConnectionChange("reconnect_failed");
      return;
    }

    this.options.onConnectionChange("reconnecting");
    const delay = 300 * this.reconnectAttempts;

    this.reconnectTimer = window.setTimeout(() => {
      this.connect(true);
    }, delay);
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
