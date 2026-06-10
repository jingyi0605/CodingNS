import { getHostBaseUrl, getHostWebSocketUrl } from "../config/env";
import { authStore } from "../features/auth/store/auth-store";
import type {
  ProviderId,
  SessionActivityConfidence,
  SessionActivityResolutionSource,
  SessionInterruptSource,
  SessionPermissionRequestDto
} from "../features/conversation/api/conversation-api";
import { logPerfDebug } from "../shared/debug/perf-debug";
import { ConnectionManager } from "./connection-manager";
import type { HostTransportSocket } from "./host-transport";
import { resolveHostTransportTarget } from "./host-transport-registry";
import { buildHostWsPath } from "./host-ws-path";

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
    origin?: "butler_proxy" | "system" | null;
    originRef?: string | null;
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
  interruptSource: SessionInterruptSource | null;
  timestamp: string;
}

export interface SessionActivityEvent {
  type: "session.activity";
  sessionId: string;
  runningState:
    | "idle"
    | "starting"
    | "running"
    | "reconnecting"
    | "stale"
    | "unknown"
    | "completed"
    | "interrupted"
    | "failed";
  activityResolutionSource: SessionActivityResolutionSource;
  activityConfidence: SessionActivityConfidence;
  runId: string | null;
  detail: string | null;
  interruptSource: SessionInterruptSource | null;
  errorCode: string | null;
  errorDetail: string | null;
  hasActiveRun: boolean;
  canInterrupt: boolean;
  updatedAt: string;
  watchdogTriggeredAt: string | null;
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
  interruptSource: SessionInterruptSource | null;
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
  | SessionActivityEvent
  | SessionRuntimeStatusEvent
  | SessionRuntimeErrorEvent
  | SessionInterruptedEvent
  | SessionPermissionRequestEvent
  | SessionPermissionRequestResolvedEvent
  | SessionErrorEvent;

export interface RealtimeClientOptions {
  targetHostId?: string | null;
  sessionId: string;
  cursor: string | null;
  limit: number;
  onConnectionChange: (state: RuntimeConnectionState) => void;
  onSubscribed: () => void;
  onEnvelope: (event: SessionEnvelopeEvent) => void;
  onOlderHistory: (event: SessionOlderHistoryEvent) => void;
  onRuntimeMessage: (event: SessionRuntimeMessageEvent) => void;
  onActivity: (event: SessionActivityEvent) => void;
  onRuntimeStatus: (event: SessionRuntimeStatusEvent) => void;
  onRuntimeError: (event: SessionRuntimeErrorEvent) => void;
  onInterrupted: (event: SessionInterruptedEvent) => void;
  onPermissionRequest: (event: SessionPermissionRequestEvent) => void;
  onPermissionRequestResolved: (event: SessionPermissionRequestResolvedEvent) => void;
  onError: (event: SessionErrorEvent) => void;
  onUnauthorized: () => void;
}

export class RealtimeClient {
  private socket: HostTransportSocket | null = null;
  private disposed = false;
  private authRecoveryInFlight = false;
  private latestCursor: string | null;
  private subscribed = false;
  private pendingOlderRequest: { cursor: string | null; limit: number } | null = null;
  private inFlightOlderRequest: { cursor: string | null; limit: number } | null = null;
  private subscribeStartedAtMs: number | null = null;
  private firstBackfillLogged = false;
  private olderRequestStartedAtMs: number | null = null;
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
    if (!isSocketOpen(this.socket)) {
      return false;
    }

    if (!this.subscribed) {
      this.pendingOlderRequest = { cursor, limit };
      return true;
    }

    this.sendOlderMessagesRequest(cursor, limit);
    return true;
  }

  close(): void {
    this.disposed = true;
    this.subscribed = false;
    this.pendingOlderRequest = null;
    this.inFlightOlderRequest = null;
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

    this.subscribed = false;
    this.firstBackfillLogged = false;
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.subscribeStartedAtMs = performance.now();
      socket.send(
        JSON.stringify({
          type: "session.subscribe",
          sessionId: this.options.sessionId,
          cursor: this.latestCursor,
          limit: this.options.limit
        })
      );
      logPerfDebug("session.subscribe.sent", {
        sessionId: this.options.sessionId,
        hasCursor: this.latestCursor !== null,
        limit: this.options.limit,
        baseUrl
      });
    });

    socket.addEventListener("message", (raw) => {
      const data = readSocketMessageData(raw);

      if (typeof data !== "string") {
        return;
      }

      const payload = JSON.parse(data) as IncomingEvent | { type: "system.connected" };

      if (payload.type === "system.connected") {
        this.connectionManager.markConnected();
        return;
      }

      if (payload.type === "session.subscribed") {
        this.subscribed = true;
        logPerfDebug("session.subscribe.ack", {
          sessionId: payload.sessionId,
          durationMs: measureElapsedMs(this.subscribeStartedAtMs)
        });
        this.options.onSubscribed();
        this.flushPendingOlderRequest();
        return;
      }

      if (payload.type === "session.error") {
        this.clearOlderMessagesRequest();

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

      if (payload.type === "session.activity") {
        this.options.onActivity(payload);
        return;
      }

      if (payload.type === "session.history_older") {
        logPerfDebug("session.history_older.received", {
          sessionId: payload.sessionId,
          messageCount: payload.messages.length,
          olderCursor: payload.olderCursor,
          durationMs: measureElapsedMs(this.olderRequestStartedAtMs)
        });
        this.olderRequestStartedAtMs = null;
        this.clearOlderMessagesRequest();
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

      if (!this.firstBackfillLogged) {
        this.firstBackfillLogged = true;
        logPerfDebug("session.initial_messages.received", {
          sessionId: payload.sessionId,
          eventType: payload.type,
          messageCount: payload.messages.length,
          olderCursor: payload.olderCursor ?? null,
          durationMs: measureElapsedMs(this.subscribeStartedAtMs)
        });
      }

      this.options.onEnvelope(payload);
    });

    socket.addEventListener("close", () => {
      if (this.disposed || this.socket !== socket) {
        return;
      }

      this.subscribed = false;
      this.requeueInFlightOlderRequest();
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
    this.subscribed = false;
    this.requeueInFlightOlderRequest();
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

  private sendOlderMessagesRequest(cursor: string | null, limit: number): void {
    this.inFlightOlderRequest = { cursor, limit };
    this.olderRequestStartedAtMs = performance.now();
    this.socket?.send(
      JSON.stringify({
        type: "session.load_older",
        sessionId: this.options.sessionId,
        cursor,
        limit
      })
    );
    logPerfDebug("session.load_older.sent", {
      sessionId: this.options.sessionId,
      hasCursor: cursor !== null,
      limit
    });
  }

  private flushPendingOlderRequest(): void {
    if (!this.pendingOlderRequest) {
      return;
    }

    const pending = this.pendingOlderRequest;
    this.pendingOlderRequest = null;
    this.sendOlderMessagesRequest(pending.cursor, pending.limit);
  }

  private clearOlderMessagesRequest(): void {
    this.pendingOlderRequest = null;
    this.inFlightOlderRequest = null;
  }

  private requeueInFlightOlderRequest(): void {
    if (!this.inFlightOlderRequest) {
      return;
    }

    this.pendingOlderRequest = this.inFlightOlderRequest;
    this.inFlightOlderRequest = null;
    this.olderRequestStartedAtMs = null;
  }
}


function readSocketMessageData(raw: Event): unknown {
  if (typeof MessageEvent !== "undefined" && raw instanceof MessageEvent) {
    return raw.data;
  }

  return (raw as { data?: unknown }).data;
}

function measureElapsedMs(startedAtMs: number | null): number | null {
  if (startedAtMs === null || typeof performance === "undefined") {
    return null;
  }

  return Math.round(performance.now() - startedAtMs);
}

function isSocketOpen(socket: HostTransportSocket | null): socket is HostTransportSocket {
  return socket !== null && socket.readyState === 1;
}
