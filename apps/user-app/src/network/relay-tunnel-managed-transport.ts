import type {
  HostTransport,
  HostTransportFetchRequest,
  HostTransportSocket,
  HostTransportWebSocketRequest
} from "./host-transport";
import { RelayTunnelClientTransport } from "./relay-tunnel-client-transport";
import { connectRelayTunnelClientSessionViaEdge } from "./relay-tunnel-edge-client";
import type { RelayTunnelPacketSession } from "./relay-tunnel-client-session";
import { recordRelaySessionWireBytes } from "./relay-session-traffic-store";

interface RelayTunnelClientTransportLike {
  fetch(request: HostTransportFetchRequest): Promise<Response>;
  createWebSocket(request: HostTransportWebSocketRequest): HostTransportSocket;
  close?(): void;
}

interface RelayTunnelClientSessionLike extends RelayTunnelPacketSession {
  close(code?: number, reason?: string): void;
}

interface RelayTunnelManagedTransportDependencies {
  connectSession?: typeof connectRelayTunnelClientSessionViaEdge;
  createTransport?: (session: RelayTunnelClientSessionLike) => RelayTunnelClientTransportLike;
  fallbackTransport?: HostTransport;
}

interface ActiveHostTransport {
  transport: HostTransport;
  close(): void;
}

export class ManagedRelayTunnelHostTransport implements HostTransport {
  private connectPromise: Promise<ActiveHostTransport> | null = null;
  private fallbackTransport: HostTransport | null = null;

  constructor(
    private readonly options: {
      controlBaseUrl: string;
      tunnelDomain: string;
      hostId: string;
    },
    private readonly dependencies: RelayTunnelManagedTransportDependencies = {}
  ) {}

  async fetch(request: HostTransportFetchRequest): Promise<Response> {
    const active = await this.getActiveTransport();
    return await active.transport.fetch(request);
  }

  createWebSocket(request: HostTransportWebSocketRequest): HostTransportSocket {
    return new DeferredRelayTunnelSocket(
      this.getActiveTransport(),
      request
    );
  }

  close(): void {
    const connectPromise = this.connectPromise;
    this.connectPromise = null;
    this.fallbackTransport = null;

    if (!connectPromise) {
      return;
    }

    void connectPromise.then((active) => {
      active.close();
    }).catch(() => {
      // 连接失败时不需要额外处理。
    });
  }

  private async getActiveTransport(): Promise<ActiveHostTransport> {
    if (this.fallbackTransport) {
      return {
        transport: this.fallbackTransport,
        close: () => undefined
      };
    }

    if (!this.connectPromise) {
      this.connectPromise = this.createActiveTransport();
    }

    return await this.connectPromise;
  }

  private async createActiveTransport(): Promise<ActiveHostTransport> {
    const connectSession = this.dependencies.connectSession ?? connectRelayTunnelClientSessionViaEdge;
    const createTransport = this.dependencies.createTransport
      ?? ((clientSession: RelayTunnelClientSessionLike) => new RelayTunnelClientTransport(clientSession));

    try {
      const connected = await connectSession({
        controlBaseUrl: this.options.controlBaseUrl,
        tunnelDomain: this.options.tunnelDomain,
        onWireBytes: (direction, bytes) => {
          recordRelaySessionWireBytes(this.options.hostId, direction, bytes);
        }
      });
      const relayTransport = createTransport(connected.clientSession);

      return {
        transport: relayTransport,
        close: () => {
          relayTransport.close?.();
          connected.clientSession.close(1000, "host_transport_closed");
        }
      };
    } catch (error) {
      const fallbackTransport = this.dependencies.fallbackTransport;

      if (!fallbackTransport) {
        throw error;
      }

      // 旧 Host 或本地直连场景下，隧道握手失败后退回直连，避免新客户端把旧服务误判成不可用。
      this.fallbackTransport = fallbackTransport;
      this.connectPromise = null;

      return {
        transport: fallbackTransport,
        close: () => undefined
      };
    }
  }
}

class DeferredRelayTunnelSocket extends EventTarget implements HostTransportSocket {
  private innerSocket: HostTransportSocket | null = null;
  private mutableReadyState = 0;
  private closed = false;

  constructor(
    activeTransportPromise: Promise<ActiveHostTransport>,
    request: HostTransportWebSocketRequest
  ) {
    super();

    void activeTransportPromise.then((active) => {
      if (this.closed) {
        return;
      }

      const socket = active.transport.createWebSocket(request);
      this.innerSocket = socket;
      this.mutableReadyState = socket.readyState;

      socket.addEventListener("open", () => {
        this.mutableReadyState = 1;
        this.dispatchEvent(new Event("open"));
      });
      socket.addEventListener("message", (event) => {
        const messageEvent = event as MessageEvent<unknown>;

        this.dispatchEvent(
          new MessageEvent("message", {
            data: messageEvent.data
          })
        );
      });
      socket.addEventListener("error", (event) => {
        const errorEvent = event as ErrorEvent;

        this.dispatchEvent(
          new ErrorEvent("error", {
            message: errorEvent.message
          })
        );
      });
      socket.addEventListener("close", (event) => {
        const closeEvent = event as CloseEvent;

        this.mutableReadyState = 3;
        this.closed = true;
        this.dispatchEvent(
          new CloseEvent("close", {
            code: closeEvent.code,
            reason: closeEvent.reason,
            wasClean: closeEvent.wasClean
          })
        );
      });
    }).catch((error) => {
      if (this.closed) {
        return;
      }

      this.mutableReadyState = 3;
      this.closed = true;
      this.dispatchEvent(
        new ErrorEvent("error", {
          message: error instanceof Error ? error.message : String(error)
        })
      );
      this.dispatchEvent(
        new CloseEvent("close", {
          code: 1011,
          reason: error instanceof Error ? error.message : String(error)
        })
      );
    });
  }

  get readyState(): number {
    return this.innerSocket?.readyState ?? this.mutableReadyState;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (!this.innerSocket) {
      throw new Error("当前公共隧道 WebSocket 尚未建立完成");
    }

    this.innerSocket.send(data);
  }

  close(code?: number, reason?: string): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.mutableReadyState = 2;

    if (this.innerSocket) {
      this.innerSocket.close(code, reason);
      return;
    }

    this.mutableReadyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code: code ?? 1000, reason: reason ?? "" }));
  }
}
