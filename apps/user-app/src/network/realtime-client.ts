import { getHostWebSocketUrl } from "../config/env";
import { authStore } from "../features/auth/store/auth-store";
import type {
  ProviderId,
  SessionPermissionRequestDto
} from "../features/conversation/api/conversation-api";
import { ConnectionManager } from "./connection-manager";

type RuntimeConnectionState = "connected" | "reconnecting" | "reconnect_failed" | "closed";

interface SessionSubscribedEvent {
  type: "session.subscribed";
  sessionId: string;
}

interface SessionEnvelopeEvent {
  type: "session.backfill" | "session.delta";
  sessionId: string;
  cursor: string | null;
  olderCursor?: string | null;
  messages: Array<{
    messageId: string;
    provider: ProviderId;
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

interface SessionOlderHistoryEvent {
  type: "session.history_older";
  sessionId: string;
  cursor: string | null;
  olderCursor: string | null;
  messages: SessionEnvelopeEvent["messages"];
}

export interface SessionRuntimeMessageEvent {
  type: "session.runtime_message";
  sessionId: string;
  message: SessionEnvelopeEvent["messages"][number];
  source: "runtime";
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

export interface SessionPermissionRequestEvent {
  type: "session.permission_request";
  sessionId: string;
  request: SessionPermissionRequestDto;
}

export interface SessionPermissionRequestResolvedEvent {
  type: "session.permission_request_resolved";
  sessionId: string;
  request: SessionPermissionRequestDto;
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
  | SessionOlderHistoryEvent
  | SessionRuntimeMessageEvent
  | SessionRuntimeStatusEvent
  | SessionRuntimeErrorEvent
  | SessionInterruptedEvent
  | SessionPermissionRequestEvent
  | SessionPermissionRequestResolvedEvent
  | SessionErrorEvent;

export interface RealtimeClientOptions {
  sessionId: string;
  cursor: string | null;
  limit: number;
  onConnectionChange: (state: RuntimeConnectionState) => void;
  onSubscribed: () => void;
  onEnvelope: (event: SessionEnvelopeEvent) => void;
  onOlderHistory: (event: SessionOlderHistoryEvent) => void;
  onRuntimeMessage: (event: SessionRuntimeMessageEvent) => void;
  onRuntimeStatus: (event: SessionRuntimeStatusEvent) => void;
  onRuntimeError: (event: SessionRuntimeErrorEvent) => void;
  onInterrupted: (event: SessionInterruptedEvent) => void;
  onPermissionRequest: (event: SessionPermissionRequestEvent) => void;
  onPermissionRequestResolved: (event: SessionPermissionRequestResolvedEvent) => void;
  onError: (event: SessionErrorEvent) => void;
  onUnauthorized: () => void;
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private disposed = false;
  private authRecoveryInFlight = false;
  private latestCursor: string | null;
  private readonly connectionManager: ConnectionManager;

  constructor(private readonly options: RealtimeClientOptions) {
    this.latestCursor = options.cursor;
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
    this.latestCursor = cursor;
  }

  reconnectNow(): void {
    this.connectionManager.reconnectNow();
  }

  requestOlderMessages(cursor: string | null, limit: number): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.socket.send(
      JSON.stringify({
        type: "session.load_older",
        sessionId: this.options.sessionId,
        cursor,
        limit
      })
    );
    return true;
  }

  close(): void {
    this.disposed = true;
    this.connectionManager.close();
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

    const socketUrl = `${getHostWebSocketUrl("/ws")}?access_token=${encodeURIComponent(accessToken)}`;
    const socket = new WebSocket(socketUrl);

    this.socket = socket;

    socket.addEventListener("open", () => {
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
        this.connectionManager.markConnected();
        return;
      }

      if (payload.type === "session.subscribed") {
        this.options.onSubscribed();
        return;
      }

      if (payload.type === "session.error") {
        if (payload.error_code === "UNAUTHORIZED") {
          this.handleUnauthorized();
          return;
        }

        this.options.onError(payload);
        return;
      }

      if (payload.type === "session.runtime_status") {
        this.options.onRuntimeStatus(payload);
        return;
      }

      if (payload.type === "session.history_older") {
        this.options.onOlderHistory(payload);
        return;
      }

      if (payload.type === "session.runtime_message") {
        this.options.onRuntimeMessage(payload);
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

      if (payload.type === "session.permission_request") {
        this.options.onPermissionRequest(payload);
        return;
      }

      if (payload.type === "session.permission_request_resolved") {
        this.options.onPermissionRequestResolved(payload);
        return;
      }

      this.latestCursor = payload.cursor;
      this.options.onEnvelope(payload);
    });

    socket.addEventListener("close", () => {
      if (this.disposed || this.socket !== socket) {
        return;
      }

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
    socket?.close();

    void authStore.refresh().then((result) => {
      this.authRecoveryInFlight = false;

      if (this.disposed) {
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
}
