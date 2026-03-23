import { getHostBaseUrl } from "../config/env";
import { authStore } from "../features/auth/store/auth-store";

type RuntimeConnectionState = "connected" | "reconnecting" | "reconnect_failed" | "closed";

interface SessionSubscribedEvent {
  type: "session.subscribed";
  sessionId: string;
}

interface SessionEnvelopeEvent {
  type: "session.backfill" | "session.delta";
  sessionId: string;
  cursor: string | null;
  messages: Array<{
    messageId: string;
    provider: "claude-code" | "codex";
    providerSessionId: string;
    role: "user" | "assistant" | "tool" | "system";
    content: string;
    timestamp: string;
    sequence: number;
    rawRef: string;
  }>;
}

interface SessionErrorEvent {
  type: "session.error";
  sessionId: string | null;
  error_code: string;
  detail: string;
}

type IncomingEvent = SessionSubscribedEvent | SessionEnvelopeEvent | SessionErrorEvent;

export interface RealtimeClientOptions {
  sessionId: string;
  cursor: string | null;
  limit: number;
  onConnectionChange: (state: RuntimeConnectionState) => void;
  onSubscribed: () => void;
  onEnvelope: (event: SessionEnvelopeEvent) => void;
  onError: (event: SessionErrorEvent) => void;
  onUnauthorized: () => void;
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private disposed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private latestCursor: string | null;

  constructor(private readonly options: RealtimeClientOptions) {
    this.latestCursor = options.cursor;
  }

  start(): void {
    this.connect(false);
  }

  updateCursor(cursor: string | null): void {
    this.latestCursor = cursor;
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

    const baseUrl = new URL(getHostBaseUrl());
    const protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    const socketUrl = `${protocol}//${baseUrl.host}/ws?access_token=${encodeURIComponent(accessToken)}`;
    const socket = new WebSocket(socketUrl);

    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      socket.send(
        JSON.stringify({
          type: "session.subscribe",
          sessionId: this.options.sessionId,
          cursor: this.latestCursor,
          limit: this.options.limit
        })
      );
    });

    socket.addEventListener("message", (raw) => {
      const payload = JSON.parse(raw.data as string) as IncomingEvent | { type: "system.connected" };

      if (payload.type === "system.connected") {
        this.options.onConnectionChange("connected");
        return;
      }

      if (payload.type === "session.subscribed") {
        this.options.onSubscribed();
        return;
      }

      if (payload.type === "session.error") {
        if (payload.error_code === "UNAUTHORIZED") {
          this.options.onUnauthorized();
          return;
        }

        this.options.onError(payload);
        return;
      }

      this.latestCursor = payload.cursor;
      this.options.onEnvelope(payload);
    });

    socket.addEventListener("close", () => {
      if (this.disposed) {
        return;
      }

      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.disposed) {
        return;
      }

      if (this.reconnectAttempts === 0) {
        this.options.onConnectionChange("reconnecting");
      }
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
}
