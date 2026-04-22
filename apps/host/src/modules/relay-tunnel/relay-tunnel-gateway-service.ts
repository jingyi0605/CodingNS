import WebSocket from "ws";
import type { RelaySessionClientContext } from "@codingns-proxy/shared-contracts";

import type {
  RelayTunnelErrorPacket,
  RelayTunnelGatewayPacket,
  RelayTunnelHttpResponseChunkPacket,
  RelayTunnelHttpResponseEndPacket,
  RelayTunnelHttpResponseStartPacket,
  RelayTunnelHttpRequestPacket,
  RelayTunnelWsClosedPacket,
  RelayTunnelWsMessagePacket,
  RelayTunnelWsOpenPacket,
  RelayTunnelWsOpenedPacket
} from "./crypto/relay-tunnel-packets.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length"
]);
const WS_PROTOCOL_HEADER = "sec-websocket-protocol";
const HTTP_RESPONSE_CHUNK_BYTES = 24 * 1024;

export class RelayTunnelGatewayService {
  private readonly localHttpBaseUrl: URL;
  private readonly localWsBaseUrl: URL;
  private readonly wsSockets = new Map<string, WebSocket>();
  private readonly sessionId: string | null;
  private readonly clientContext: RelaySessionClientContext | null;

  constructor(options: {
    localTargetBaseUrl: string;
    sessionId?: string | null;
    clientContext?: RelaySessionClientContext | null;
    onPacket: (packet: RelayTunnelGatewayPacket) => void | Promise<void>;
  }) {
    this.localHttpBaseUrl = new URL(options.localTargetBaseUrl);
    this.localWsBaseUrl = new URL(options.localTargetBaseUrl);
    this.localWsBaseUrl.protocol = this.localWsBaseUrl.protocol === "https:" ? "wss:" : "ws:";
    this.sessionId = normalizeNullableText(options.sessionId ?? null);
    this.clientContext = normalizeRelaySessionClientContext(options.clientContext);
    this.onPacket = options.onPacket;
  }

  private readonly onPacket: (packet: RelayTunnelGatewayPacket) => void | Promise<void>;

  async handlePacket(packet: RelayTunnelGatewayPacket): Promise<void> {
    switch (packet.type) {
      case "http.request":
        await this.handleHttpRequest(packet);
        return;
      case "ws.open":
        this.handleWsOpen(packet);
        return;
      case "ws.message":
        await this.handleWsMessage(packet);
        return;
      case "ws.closed":
        this.handleWsClosed(packet);
        return;
      default:
        await this.emitError({
          type: "error",
          streamId: "streamId" in packet ? packet.streamId : null,
          errorCode: "UNSUPPORTED_PACKET",
          detail: `Host 网关不支持处理 ${packet.type} 包`
        });
    }
  }

  close(): void {
    for (const socket of this.wsSockets.values()) {
      socket.close();
    }

    this.wsSockets.clear();
  }

  private async handleHttpRequest(packet: RelayTunnelHttpRequestPacket): Promise<void> {
    const requestUrl = new URL(packet.path, this.localHttpBaseUrl);
    const headers = new Headers();

    for (const [headerName, headerValue] of Object.entries(packet.headers)) {
      if (!headerName || HOP_BY_HOP_HEADERS.has(headerName.toLowerCase())) {
        continue;
      }

      headers.set(headerName, headerValue);
    }

    applyRelaySessionHeaders(headers, this.sessionId, this.clientContext);

    try {
      const response = await fetch(requestUrl, {
        method: packet.method,
        headers,
        body: packet.bodyBase64Url ? Buffer.from(packet.bodyBase64Url, "base64url") : undefined
      });

      const responseStartPacket: RelayTunnelHttpResponseStartPacket = {
        type: "http.response.start",
        streamId: packet.streamId,
        status: response.status,
        headers: flattenResponseHeaders(response.headers, this.sessionId)
      };

      await this.onPacket(responseStartPacket);

      if (!response.body) {
        const endPacket: RelayTunnelHttpResponseEndPacket = {
          type: "http.response.end",
          streamId: packet.streamId
        };
        await this.onPacket(endPacket);
        return;
      }

      const reader = response.body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          if (!value || value.byteLength === 0) {
            continue;
          }

          await this.emitHttpResponseChunks(packet.streamId, value);
        }
      } finally {
        reader.releaseLock();
      }

      const endPacket: RelayTunnelHttpResponseEndPacket = {
        type: "http.response.end",
        streamId: packet.streamId
      };
      await this.onPacket(endPacket);
    } catch (error) {
      await this.emitError({
        type: "error",
        streamId: packet.streamId,
        errorCode: "HTTP_TUNNEL_REQUEST_FAILED",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private handleWsOpen(packet: RelayTunnelWsOpenPacket): void {
    if (this.wsSockets.has(packet.streamId)) {
      void this.emitError({
        type: "error",
        streamId: packet.streamId,
        errorCode: "WS_STREAM_EXISTS",
        detail: "当前 WebSocket 流已经存在"
      });
      return;
    }

    const socketUrl = new URL(packet.path, this.localWsBaseUrl);
    const requestedProtocols = resolveRequestedProtocols(packet);
    const socket = requestedProtocols.length > 0
      ? new WebSocket(socketUrl, requestedProtocols, {
        headers: buildWebSocketRequestHeaders(packet.headers, this.sessionId, this.clientContext)
      })
      : new WebSocket(socketUrl, {
        headers: buildWebSocketRequestHeaders(packet.headers, this.sessionId, this.clientContext)
      });

    this.wsSockets.set(packet.streamId, socket);

    socket.on("open", () => {
      const openedPacket: RelayTunnelWsOpenedPacket = {
        type: "ws.opened",
        streamId: packet.streamId,
        selectedProtocol: socket.protocol || null
      };
      void this.onPacket(openedPacket);
    });

    socket.on("message", (data, isBinary) => {
      const messagePacket: RelayTunnelWsMessagePacket = {
        type: "ws.message",
        streamId: packet.streamId,
        binary: isBinary,
        dataBase64Url: toBuffer(data).toString("base64url")
      };
      void this.onPacket(messagePacket);
    });

    socket.on("close", (code, reason) => {
      this.wsSockets.delete(packet.streamId);
      const closePacket: RelayTunnelWsClosedPacket = {
        type: "ws.closed",
        streamId: packet.streamId,
        code,
        reason: reason.length > 0 ? reason.toString("utf8") : null
      };
      void this.onPacket(closePacket);
    });

    socket.on("error", (error) => {
      void this.emitError({
        type: "error",
        streamId: packet.streamId,
        errorCode: "WS_TUNNEL_UPSTREAM_FAILED",
        detail: error.message
      });
    });
  }

  private async handleWsMessage(packet: RelayTunnelWsMessagePacket): Promise<void> {
    const socket = this.wsSockets.get(packet.streamId);

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      await this.emitError({
        type: "error",
        streamId: packet.streamId,
        errorCode: "WS_STREAM_NOT_OPEN",
        detail: "当前 WebSocket 流还没有建立完成"
      });
      return;
    }

    socket.send(Buffer.from(packet.dataBase64Url, "base64url"), {
      binary: packet.binary
    });
  }

  private handleWsClosed(packet: RelayTunnelWsClosedPacket): void {
    const socket = this.wsSockets.get(packet.streamId);

    if (!socket) {
      return;
    }

    this.wsSockets.delete(packet.streamId);
    socket.close(packet.code, packet.reason ?? undefined);
  }

  private async emitError(packet: RelayTunnelErrorPacket): Promise<void> {
    await this.onPacket(packet);
  }

  private async emitHttpResponseChunks(streamId: string, bytes: Uint8Array): Promise<void> {
    for (let offset = 0; offset < bytes.byteLength; offset += HTTP_RESPONSE_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + HTTP_RESPONSE_CHUNK_BYTES);
      const packet: RelayTunnelHttpResponseChunkPacket = {
        type: "http.response.chunk",
        streamId,
        bodyChunkBase64Url: Buffer.from(chunk).toString("base64url")
      };
      await this.onPacket(packet);
    }
  }
}

function flattenResponseHeaders(headers: Headers, sessionId: string | null): Record<string, string> {
  const flattened: Record<string, string> = {};

  for (const [headerName, headerValue] of headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(headerName.toLowerCase())) {
      continue;
    }

    flattened[headerName] = headerValue;
  }

  if (sessionId) {
    flattened["x-codingns-relay-session-id"] = sessionId;
  }

  return flattened;
}

function buildWebSocketRequestHeaders(
  headers: Record<string, string>,
  sessionId: string | null,
  clientContext: RelaySessionClientContext | null
): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const [headerName, headerValue] of Object.entries(headers)) {
    const normalizedHeaderName = headerName.toLowerCase();

    if (
      !headerName
      || HOP_BY_HOP_HEADERS.has(normalizedHeaderName)
      || normalizedHeaderName === WS_PROTOCOL_HEADER
    ) {
      continue;
    }

    filtered[headerName] = headerValue;
  }

  applyRelaySessionHeaders(filtered, sessionId, clientContext);

  return filtered;
}

function resolveRequestedProtocols(packet: RelayTunnelWsOpenPacket): string[] {
  if (Array.isArray(packet.protocols) && packet.protocols.length > 0) {
    return sanitizeProtocols(packet.protocols);
  }

  const headerEntry = Object.entries(packet.headers).find(([headerName]) =>
    headerName.toLowerCase() === WS_PROTOCOL_HEADER
  );

  if (!headerEntry) {
    return [];
  }

  return sanitizeProtocols(headerEntry[1].split(","));
}

function applyRelaySessionHeaders(
  target: Headers | Record<string, string>,
  sessionId: string | null,
  clientContext: RelaySessionClientContext | null
): void {
  const entries = new Map<string, string>();

  if (sessionId) {
    entries.set("x-codingns-relay-session-id", sessionId);
  }

  if (clientContext?.sourceIp) {
    entries.set("x-codingns-relay-client-ip", clientContext.sourceIp);
  }

  if (clientContext?.forwardedFor) {
    entries.set("x-codingns-relay-client-forwarded-for", clientContext.forwardedFor);
  }

  if (clientContext?.userAgent) {
    entries.set("x-codingns-relay-client-user-agent", clientContext.userAgent);
  }

  if (clientContext?.runtimePlatform) {
    entries.set("x-codingns-relay-client-runtime", clientContext.runtimePlatform);
  }

  if (clientContext?.systemPlatform) {
    entries.set("x-codingns-relay-client-system", clientContext.systemPlatform);
  }

  if (clientContext?.language) {
    entries.set("x-codingns-relay-client-language", clientContext.language);
  }

  if (clientContext?.timezone) {
    entries.set("x-codingns-relay-client-timezone", clientContext.timezone);
  }

  for (const [headerName, headerValue] of entries) {
    if (target instanceof Headers) {
      target.set(headerName, headerValue);
      continue;
    }

    target[headerName] = headerValue;
  }
}

function normalizeRelaySessionClientContext(
  value: RelaySessionClientContext | null | undefined
): RelaySessionClientContext | null {
  if (!value) {
    return null;
  }

  return {
    sourceIp: normalizeNullableText(value.sourceIp),
    forwardedFor: normalizeNullableText(value.forwardedFor),
    userAgent: normalizeNullableText(value.userAgent),
    runtimePlatform: normalizeNullableText(value.runtimePlatform),
    systemPlatform: normalizeNullableText(value.systemPlatform),
    language: normalizeNullableText(value.language),
    timezone: normalizeNullableText(value.timezone)
  };
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function sanitizeProtocols(protocols: string[]): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];

  for (const protocol of protocols) {
    const normalized = protocol.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    sanitized.push(normalized);
  }

  return sanitized;
}

function toBuffer(value: WebSocket.RawData): Buffer {
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }

  if (Array.isArray(value)) {
    return Buffer.concat(value.map((item) => Buffer.from(item)));
  }

  return Buffer.from(value);
}
