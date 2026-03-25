import { getHostWebSocketUrl } from "../config/env";
import { authStore } from "../features/auth/store/auth-store";
import { ConnectionManager } from "./connection-manager";

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
  private pendingRefresh = false;
  private readonly connectionManager: ConnectionManager;

  constructor(private readonly options: WorkbenchRealtimeClientOptions) {
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
        this.connectionManager.markConnected();
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
}

function isWorkbenchSnapshot(payload: unknown): payload is WorkbenchSnapshotDto {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  return Array.isArray((payload as WorkbenchSnapshotDto).items);
}
