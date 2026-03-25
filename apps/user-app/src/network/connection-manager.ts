import { clientConfigStore } from "../config/client-config-store";

export type ManagedConnectionState = "connected" | "reconnecting" | "reconnect_failed" | "closed";

interface ConnectionManagerOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  onReconnect: (forceReset: boolean) => void;
  onStateChange: (state: ManagedConnectionState) => void;
}

export class ConnectionManager {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private disposed = false;

  constructor(private readonly options: ConnectionManagerOptions) {
    this.maxAttempts = options.maxAttempts ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 300;
  }

  start(): void {
    this.options.onReconnect(false);
  }

  markConnected(): void {
    this.reconnectAttempts = 0;
    this.options.onStateChange("connected");
  }

  markTransientFailure(): void {
    if (this.disposed || this.reconnectAttempts > 0) {
      return;
    }

    this.options.onStateChange("reconnecting");
  }

  markDisconnected(): void {
    if (this.disposed) {
      return;
    }

    if (!clientConfigStore.getState().autoReconnect) {
      this.options.onStateChange("reconnect_failed");
      return;
    }

    this.reconnectAttempts += 1;

    if (this.reconnectAttempts > this.maxAttempts) {
      this.options.onStateChange("reconnect_failed");
      return;
    }

    this.options.onStateChange("reconnecting");
    const delay = this.baseDelayMs * this.reconnectAttempts;
    this.reconnectTimer = window.setTimeout(() => {
      this.options.onReconnect(true);
    }, delay);
  }

  reconnectNow(): void {
    this.reconnectAttempts = 0;

    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.options.onReconnect(true);
  }

  close(): void {
    this.disposed = true;

    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.options.onStateChange("closed");
  }
}
