import WebSocket from "ws";

import type {
  RelayTunnelErrorPacket,
  RelayTunnelGatewayPacket,
  RelayTunnelHttpRequestPacket,
  RelayTunnelHttpResponsePacket,
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

export class RelayTunnelGatewayService {
  private readonly localHttpBaseUrl: URL;
  private readonly localWsBaseUrl: URL;
  private readonly wsSockets = new Map<string, WebSocket>();

  constructor(options: {
    localTargetBaseUrl: string;
    onPacket: (packet: RelayTunnelGatewayPacket) => void | Promise<void>;
  }) {
    this.localHttpBaseUrl = new URL(options.localTargetBaseUrl);
    this.localWsBaseUrl = new URL(options.localTargetBaseUrl);
    this.localWsBaseUrl.protocol = this.localWsBaseUrl.protocol === "https:" ? "wss:" : "ws:";
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

    try {
      const response = await fetch(requestUrl, {
        method: packet.method,
        headers,
        body: packet.bodyBase64Url ? Buffer.from(packet.bodyBase64Url, "base64url") : undefined
      });
      const responseBody = Buffer.from(await response.arrayBuffer());
      const responsePacket: RelayTunnelHttpResponsePacket = {
        type: "http.response",
        streamId: packet.streamId,
        status: response.status,
        headers: flattenResponseHeaders(response.headers),
        bodyBase64Url: responseBody.byteLength > 0 ? responseBody.toString("base64url") : null
      };

      await this.onPacket(responsePacket);
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
        headers: filterRequestHeaders(packet.headers)
      })
      : new WebSocket(socketUrl, {
        headers: filterRequestHeaders(packet.headers)
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
}

function flattenResponseHeaders(headers: Headers): Record<string, string> {
  const flattened: Record<string, string> = {};

  for (const [headerName, headerValue] of headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(headerName.toLowerCase())) {
      continue;
    }

    flattened[headerName] = headerValue;
  }

  return flattened;
}

function filterRequestHeaders(headers: Record<string, string>): Record<string, string> {
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
