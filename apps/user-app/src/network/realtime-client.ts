import { getHostWebSocketUrl } from "../config/env";
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
    kind: "text" | "thinking" | "tool_call" | "tool_result";
    content: string;
    toolCall: {
      callId: string;
      name: string;
      input: string;
      output: string | null;
      error: string | null;
      status: "running" | "completed" | "failed";
    } | null;
    timestamp: string;
    sequence: number;
    rawRef: string;
  }>;
}

export interface SessionRuntimeStatusEvent {
  type: "session.runtime_status";
  sessionId: string;
  status: "idle" | "starting" | "running" | "reconnecting" | "completed" | "interrupted" | "failed";
  detail: string | null;
  timestamp: string;
}

export interface SessionRuntimeErrorEvent {
  type: "session.runtime_error";
  sessionId: string;
  error_code: string;
  detail: string;
  timestamp: string;
}

export interface SessionInterruptedEvent {
  type: "session.interrupted";
  sessionId: string;
  detail: string | null;
  timestamp: string;
}

interface SessionErrorEvent {
  type: "session.error";
  sessionId: string | null;
  error_code: string;
  detail: string;
}

type IncomingEvent =
  | SessionSubscribedEvent
  | SessionEnvelopeEvent
  | SessionRuntimeStatusEvent
  | SessionRuntimeErrorEvent
  | SessionInterruptedEvent
  | SessionErrorEvent;

export interface RealtimeClientOptions {
  sessionId: string;
  cursor: string | null;
  limit: number;
  onConnectionChange: (state: RuntimeConnectionState) => void;
  onSubscribed: () => void;
  onEnvelope: (event: SessionEnvelopeEvent) => void;
  onRuntimeStatus: (event: SessionRuntimeStatusEvent) => void;
  onRuntimeError: (event: SessionRuntimeErrorEvent) => void;
  onInterrupted: (event: SessionInterruptedEvent) => void;
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

    const socketUrl = `${getHostWebSocketUrl("/ws")}?access_token=${encodeURIComponent(accessToken)}`;
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

      if (payload.type === "session.runtime_status") {
        this.options.onRuntimeStatus(payload);
        return;
      }

      if (payload.type === "session.runtime_error") {
        this.options.onRuntimeError(payload);
        return;
      }

      if (payload.type === "session.interrupted") {
        this.options.onInterrupted(payload);
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
