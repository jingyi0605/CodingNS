export interface HostTransportFetchRequest {
  path: string;
  baseUrl: string;
  url: string;
  init: RequestInit;
}

export interface HostTransportWebSocketRequest {
  path: string;
  baseUrl: string;
  url: string;
  protocols?: string | string[];
}

export interface HostTransportSocket {
  readonly readyState: number;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void;
}

export interface HostTransport {
  fetch(request: HostTransportFetchRequest): Promise<Response>;
  createWebSocket(request: HostTransportWebSocketRequest): HostTransportSocket;
  close?(): void;
}

export type HostTransportResolver = (input: { baseUrl: string }) => HostTransport;
