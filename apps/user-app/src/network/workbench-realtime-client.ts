import { getHostWebSocketUrl } from "../config/env";
import { authStore } from "../features/auth/store/auth-store";

import type { WorkbenchSnapshotDto } from "../features/conversation/api/conversation-api";

type WorkbenchConnectionState = "connected" | "reconnecting" | "reconnect_failed" | "closed";

interface SystemConnectedEvent {
  type: "system.connected";
}

interface WorkbenchSnapshotEvent {
  type: "workbench.snapshot";
  snapshot: WorkbenchSnapshotDto;
}

interface SessionErrorEvent {
  type: "session.error";
  error_code: string;
  detail: string;
}

type IncomingEvent = WorkbenchSnapshotEvent | SystemConnectedEvent | SessionErrorEvent;

export interface WorkbenchRealtimeClientOptions {
  onConnectionChange: (state: WorkbenchConnectionState) => void;
  onSnapshot: (snapshot: WorkbenchSnapshotDto) => void;
  onUnauthorized: () => void;
}

export class WorkbenchRealtimeClient {
  private socket: WebSocket | null = null;
  private disposed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pendingRefresh = false;

  constructor(private readonly options: WorkbenchRealtimeClientOptions) {}

  start(): void {
    this.connect(false);
  }

  requestRefresh(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.pendingRefresh = true;
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: "workbench.refresh"
      })
    );
    this.pendingRefresh = false;
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
          type: "workbench.subscribe"
        })
      );

      if (this.pendingRefresh) {
        this.requestRefresh();
      }
    });

    socket.addEventListener("message", (raw) => {
      const payload = JSON.parse(raw.data as string) as IncomingEvent;

      if (payload.type === "system.connected") {
        this.options.onConnectionChange("connected");
        return;
      }

      if (payload.type === "session.error") {
        if (payload.error_code === "UNAUTHORIZED") {
          this.options.onUnauthorized();
        }

        return;
      }

      if (payload.type !== "workbench.snapshot" || !isWorkbenchSnapshot(payload.snapshot)) {
        return;
      }

      this.options.onSnapshot(payload.snapshot);
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

function isWorkbenchSnapshot(payload: unknown): payload is WorkbenchSnapshotDto {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  return Array.isArray((payload as WorkbenchSnapshotDto).items);
}
