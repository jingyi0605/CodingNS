import type {
  HostTransport,
  HostTransportFetchRequest,
  HostTransportWebSocketRequest
} from "./host-transport";

class DirectHostTransport implements HostTransport {
  async fetch(request: HostTransportFetchRequest): Promise<Response> {
    return fetch(request.url, request.init);
  }

  createWebSocket(request: HostTransportWebSocketRequest): WebSocket {
    return new WebSocket(request.url, request.protocols);
  }
}

export const directHostTransport = new DirectHostTransport();
