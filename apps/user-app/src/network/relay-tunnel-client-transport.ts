import type {
  HostTransport,
  HostTransportFetchRequest,
  HostTransportSocket,
  HostTransportWebSocketRequest
} from "./host-transport";
import type {
  RelayTunnelErrorPacket,
  RelayTunnelGatewayPacket,
  RelayTunnelHttpResponseChunkPacket,
  RelayTunnelHttpResponseEndPacket,
  RelayTunnelHttpResponseStartPacket,
  RelayTunnelHttpRequestPacket,
  RelayTunnelHttpResponsePacket,
  RelayTunnelWsClosedPacket,
  RelayTunnelWsMessagePacket,
  RelayTunnelWsOpenPacket,
  RelayTunnelWsOpenedPacket
} from "./relay-tunnel-packets";

interface RelayTunnelPacketSession {
  send(packet: RelayTunnelGatewayPacket): void;
  subscribe(listener: (packet: RelayTunnelGatewayPacket) => void): () => void;
}

interface PendingHttpRequest {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  streamController: ReadableStreamDefaultController<Uint8Array> | null;
  responseStarted: boolean;
}

export class RelayTunnelClientTransport implements HostTransport {
  private nextStreamId = 0;
  private readonly pendingHttpRequests = new Map<string, PendingHttpRequest>();
  private readonly sockets = new Map<string, RelayTunnelTransportSocket>();
  private readonly unsubscribe: () => void;

  constructor(private readonly session: RelayTunnelPacketSession) {
    this.unsubscribe = session.subscribe((packet) => {
      this.handlePacket(packet);
    });
  }

  async fetch(request: HostTransportFetchRequest): Promise<Response> {
    const streamId = this.createStreamId("http");
    const packet: RelayTunnelHttpRequestPacket = {
      type: "http.request",
      streamId,
      method: normalizeMethod(request.init.method),
      path: buildTunnelPath(request.path, request.url),
      headers: flattenRequestHeaders(request.init.headers),
      bodyBase64Url: await encodeRequestBody(request.init.body)
    };

    return await new Promise<Response>((resolve, reject) => {
      this.pendingHttpRequests.set(streamId, {
        resolve,
        reject,
        streamController: null,
        responseStarted: false
      });
      this.session.send(packet);
    });
  }

  createWebSocket(request: HostTransportWebSocketRequest): HostTransportSocket {
    const streamId = this.createStreamId("ws");
    const socket = new RelayTunnelTransportSocket({
      streamId,
      path: buildTunnelPath(request.path, request.url),
      headers: {},
      protocols: normalizeRequestedProtocols(request.protocols)
    }, this.session, () => {
      this.sockets.delete(streamId);
    });

    this.sockets.set(streamId, socket);
    return socket;
  }

  close(): void {
    this.unsubscribe();

    for (const pending of this.pendingHttpRequests.values()) {
      const error = new Error("隧道会话已经关闭");

      if (pending.responseStarted) {
        pending.streamController?.error(error);
        continue;
      }

      pending.reject(error);
    }

    this.pendingHttpRequests.clear();

    for (const socket of this.sockets.values()) {
      socket.forceClose(1011, "隧道会话已经关闭");
    }

    this.sockets.clear();
  }

  private handlePacket(packet: RelayTunnelGatewayPacket): void {
    switch (packet.type) {
      case "http.response":
        this.handleHttpResponse(packet);
        return;
      case "http.response.start":
        this.handleHttpResponseStart(packet);
        return;
      case "http.response.chunk":
        this.handleHttpResponseChunk(packet);
        return;
      case "http.response.end":
        this.handleHttpResponseEnd(packet);
        return;
      case "ws.opened":
        this.sockets.get(packet.streamId)?.handleOpened(packet);
        return;
      case "ws.message":
        this.sockets.get(packet.streamId)?.handleMessage(packet);
        return;
      case "ws.closed":
        this.sockets.get(packet.streamId)?.handleClosed(packet);
        return;
      case "error":
        this.handleError(packet);
        return;
      default:
        return;
    }
  }

  private handleHttpResponse(packet: RelayTunnelHttpResponsePacket): void {
    const pending = this.pendingHttpRequests.get(packet.streamId);

    if (!pending) {
      return;
    }

    this.pendingHttpRequests.delete(packet.streamId);
    pending.resolve(
      new Response(createResponseBody(packet.bodyBase64Url), {
        status: packet.status,
        headers: packet.headers
      })
    );
  }

  private handleHttpResponseStart(packet: RelayTunnelHttpResponseStartPacket): void {
    const pending = this.pendingHttpRequests.get(packet.streamId);

    if (!pending || pending.responseStarted) {
      return;
    }

    pending.responseStarted = true;

    if (hasNullBodyStatus(packet.status)) {
      this.pendingHttpRequests.delete(packet.streamId);
      pending.resolve(
        new Response(null, {
          status: packet.status,
          headers: packet.headers
        })
      );
      return;
    }

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        pending.streamController = controller;
      },
      cancel: () => {
        pending.streamController = null;
      }
    });

    pending.resolve(
      new Response(stream, {
        status: packet.status,
        headers: packet.headers
      })
    );
  }

  private handleHttpResponseChunk(packet: RelayTunnelHttpResponseChunkPacket): void {
    const pending = this.pendingHttpRequests.get(packet.streamId);

    if (!pending?.responseStarted) {
      return;
    }

    const bytes = decodeBase64UrlBytes(packet.bodyChunkBase64Url);
    pending.streamController?.enqueue(bytes);
  }

  private handleHttpResponseEnd(packet: RelayTunnelHttpResponseEndPacket): void {
    const pending = this.pendingHttpRequests.get(packet.streamId);

    if (!pending) {
      return;
    }

    pending.streamController?.close();
    pending.streamController = null;
    this.pendingHttpRequests.delete(packet.streamId);
  }

  private handleError(packet: RelayTunnelErrorPacket): void {
    if (packet.streamId && this.pendingHttpRequests.has(packet.streamId)) {
      const pending = this.pendingHttpRequests.get(packet.streamId);
      const error = new Error(`${packet.errorCode}: ${packet.detail}`);

      this.pendingHttpRequests.delete(packet.streamId);
      if (pending?.responseStarted) {
        pending.streamController?.error(error);
      } else {
        pending?.reject(error);
      }
      return;
    }

    if (packet.streamId) {
      this.sockets.get(packet.streamId)?.handleError(packet);
    }
  }

  private createStreamId(prefix: "http" | "ws"): string {
    this.nextStreamId += 1;
    return `${prefix}-${this.nextStreamId}`;
  }
}

class RelayTunnelTransportSocket extends EventTarget implements HostTransportSocket {
  readonly streamId: string;
  private mutableReadyState = 0;
  private closed = false;

  constructor(
    private readonly options: {
      streamId: string;
      path: string;
      headers: Record<string, string>;
      protocols: string[];
    },
    private readonly session: RelayTunnelPacketSession,
    private readonly onClosed: () => void
  ) {
    super();
    this.streamId = options.streamId;
    this.open();
  }

  get readyState(): number {
    return this.mutableReadyState;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.mutableReadyState !== 1) {
      throw new Error("当前隧道 WebSocket 尚未打开");
    }

    const payload = normalizeSocketPayload(data);

    const packet: RelayTunnelWsMessagePacket = {
      type: "ws.message",
      streamId: this.streamId,
      binary: typeof payload !== "string",
      dataBase64Url: encodeSocketPayload(payload)
    };

    this.session.send(packet);
  }

  close(code?: number, reason?: string): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.mutableReadyState = 2;
    this.session.send({
      type: "ws.closed",
      streamId: this.streamId,
      code: code ?? 1000,
      reason: reason ?? null
    });
  }

  handleOpened(_packet: RelayTunnelWsOpenedPacket): void {
    if (this.closed) {
      return;
    }

    this.mutableReadyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  handleMessage(packet: RelayTunnelWsMessagePacket): void {
    if (this.closed) {
      return;
    }

    const payload = packet.binary
      ? decodeBase64Url(packet.dataBase64Url)
      : decodeBase64UrlToText(packet.dataBase64Url);

    this.dispatchEvent(new MessageEvent("message", { data: payload }));
  }

  handleClosed(packet: RelayTunnelWsClosedPacket): void {
    this.forceClose(packet.code, packet.reason ?? "");
  }

  handleError(packet: RelayTunnelErrorPacket): void {
    if (this.closed) {
      return;
    }

    this.dispatchEvent(new ErrorEvent("error", { message: `${packet.errorCode}: ${packet.detail}` }));
    this.forceClose(1011, packet.detail);
  }

  forceClose(code: number, reason: string): void {
    if (this.mutableReadyState === 3) {
      return;
    }

    this.closed = true;
    this.mutableReadyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
    this.onClosed();
  }

  private open(): void {
    const packet: RelayTunnelWsOpenPacket = {
      type: "ws.open",
      streamId: this.streamId,
      path: this.options.path,
      headers: this.options.headers,
      protocols: this.options.protocols.length > 0 ? this.options.protocols : undefined
    };

    this.session.send(packet);
  }
}

function normalizeRequestedProtocols(protocols: string | string[] | undefined): string[] {
  if (!protocols) {
    return [];
  }

  const values = Array.isArray(protocols) ? protocols : [protocols];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const protocol of values) {
    const trimmed = protocol.trim();

    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function normalizeMethod(method: string | undefined): string {
  return method?.trim().toUpperCase() || "GET";
}

function flattenRequestHeaders(headersInit: HeadersInit | undefined): Record<string, string> {
  const headers = new Headers(headersInit);
  const flattened: Record<string, string> = {};

  headers.forEach((value, key) => {
    flattened[key] = value;
  });

  return flattened;
}

async function encodeRequestBody(body: BodyInit | null | undefined): Promise<string | null> {
  if (body === null || body === undefined) {
    return null;
  }

  const bytes = await readBodyToBytes(body);
  return bytes.byteLength > 0 ? encodeBase64Url(bytes) : null;
}

async function readBodyToBytes(body: BodyInit): Promise<Uint8Array> {
  if (typeof body === "string") {
    return textEncoder.encode(body);
  }

  if (body instanceof URLSearchParams) {
    return textEncoder.encode(body.toString());
  }

  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }

  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }

  throw new Error("当前隧道 transport 不支持这种请求体类型");
}

function buildTunnelPath(path: string, url: string): string {
  const parsed = new URL(url);
  const trimmedPath = path.trim();

  if (!trimmedPath) {
    return `${parsed.pathname}${parsed.search}`;
  }

  if (trimmedPath.includes("?")) {
    return trimmedPath;
  }

  if (!parsed.search) {
    return trimmedPath;
  }

  return `${trimmedPath}${parsed.search}`;
}

function encodeSocketPayload(data: string | ArrayBufferLike | ArrayBufferView): string {
  if (typeof data === "string") {
    return encodeBase64Url(textEncoder.encode(data));
  }

  if (ArrayBuffer.isView(data)) {
    return encodeBase64Url(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  return encodeBase64Url(new Uint8Array(data));
}

function decodeBase64Url(value: string | null): Uint8Array | null {
  if (!value) {
    return null;
  }

  return decodeBase64UrlBytes(value);
}

function createResponseBody(value: string | null): BodyInit | null {
  const bytes = decodeBase64Url(value);

  if (!bytes) {
    return null;
  }

  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}

function hasNullBodyStatus(status: number): boolean {
  return status === 101 || status === 103 || status === 204 || status === 205 || status === 304;
}

function decodeBase64UrlToText(value: string | null): string {
  const bytes = decodeBase64Url(value);
  return bytes ? textDecoder.decode(bytes) : "";
}

function normalizeSocketPayload(
  data: string | ArrayBufferLike | Blob | ArrayBufferView
): string | ArrayBufferLike | ArrayBufferView {
  if (isBlobPayload(data)) {
    throw new Error("当前隧道 WebSocket 暂不支持直接发送 Blob");
  }

  return data;
}

function isBlobPayload(data: string | ArrayBufferLike | Blob | ArrayBufferView): data is Blob {
  return typeof Blob !== "undefined" && data instanceof Blob;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (let index = 0; index < bytes.length; index += BASE64URL_CHUNK_SIZE) {
    const chunk = bytes.subarray(index, index + BASE64URL_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const BASE64URL_CHUNK_SIZE = 0x8000;
