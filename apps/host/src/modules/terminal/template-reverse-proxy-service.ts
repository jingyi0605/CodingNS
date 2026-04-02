import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { CommandTemplateService } from "./command-template-service.js";

const UPSTREAM_HOST = "127.0.0.1";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade"
]);

interface ParsedProxyUrl {
  proxySlug: string;
  upstreamPath: string;
}

export class TemplateReverseProxyService {
  constructor(private readonly commandTemplateService: CommandTemplateService) {}

  async handleHttpProxy(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parsed = parseProxyUrl(request.raw.url);

    if (!parsed) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PROXY_NOT_FOUND",
        detail: "代理路径不存在"
      });
    }

    const template = this.commandTemplateService.getTemplateByProxySlug(parsed.proxySlug);

    if (!template) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PROXY_NOT_FOUND",
        detail: "代理地址不存在或未开启"
      });
    }

    if (template.port === null) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PROXY_TARGET_INVALID",
        detail: "代理目标未配置端口"
      });
    }

    // 这里使用 hijack 直接接管底层响应流，避免 Fastify 再次包装导致流式返回失真。
    reply.hijack();
    const upstreamRequest = http.request(
      {
        host: UPSTREAM_HOST,
        port: template.port,
        method: request.method,
        path: parsed.upstreamPath,
        headers: buildUpstreamHeaders(request.raw.headers, template.port, false)
      },
      (upstreamResponse) => {
        const statusCode = upstreamResponse.statusCode ?? 502;
        reply.raw.writeHead(statusCode, stripHopByHopHeaders(upstreamResponse.headers));
        upstreamResponse.pipe(reply.raw);
      }
    );

    upstreamRequest.on("error", () => {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(502, {
          "content-type": "application/json; charset=utf-8"
        });
      }

      reply.raw.end(
        JSON.stringify({
          error_code: "UPSTREAM_PROXY_FAILED",
          detail: "代理上游服务失败",
          timestamp: new Date().toISOString()
        })
      );
    });

    // 客户端提前断开时，主动取消上游请求，避免悬挂连接。
    reply.raw.on("close", () => {
      upstreamRequest.destroy();
    });

    writeRequestBody(request, upstreamRequest);
  }

  handleWebSocketUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const parsed = parseProxyUrl(request.url);

    if (!parsed) {
      return false;
    }

    const template = this.commandTemplateService.getTemplateByProxySlug(parsed.proxySlug);

    if (!template || template.port === null) {
      writeErrorResponse(socket, 404, "Proxy Not Found");
      return true;
    }

    // WebSocket 升级不走 Fastify 路由，直接透传握手与后续双向字节流。
    const upstreamRequest = http.request({
      host: UPSTREAM_HOST,
      port: template.port,
      method: "GET",
      path: parsed.upstreamPath,
      headers: buildUpstreamHeaders(request.headers, template.port, true)
    });

    upstreamRequest.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      writeUpgradeResponse(socket, upstreamResponse);

      if (upstreamHead.length > 0) {
        socket.write(upstreamHead);
      }

      if (head.length > 0) {
        upstreamSocket.write(head);
      }

      socket.pipe(upstreamSocket).pipe(socket);

      upstreamSocket.on("error", () => {
        socket.destroy();
      });
      socket.on("error", () => {
        upstreamSocket.destroy();
      });
    });

    upstreamRequest.on("response", (upstreamResponse) => {
      const statusCode = upstreamResponse.statusCode ?? 502;
      writeHttpResponse(socket, statusCode, upstreamResponse.statusMessage ?? "Bad Gateway", upstreamResponse.headers);
      upstreamResponse.pipe(socket);
    });

    upstreamRequest.on("error", () => {
      writeErrorResponse(socket, 502, "Bad Gateway");
    });

    upstreamRequest.end();
    return true;
  }
}

function parseProxyUrl(rawUrl: string | undefined): ParsedProxyUrl | null {
  const parsedUrl = new URL(rawUrl ?? "/", "http://127.0.0.1");
  const match = parsedUrl.pathname.match(/^\/proxy\/([^/]+)(?:\/(.*))?$/);

  if (!match) {
    return null;
  }

  // 代理码仅允许字母数字，避免路径穿透与奇怪编码边界。
  const proxySlug = match[1]?.trim().toLowerCase() ?? "";

  if (!/^[a-z0-9]+$/.test(proxySlug)) {
    return null;
  }

  const remainder = match[2] ?? "";
  const upstreamPath = `/${remainder}${parsedUrl.search}`;

  return {
    proxySlug,
    upstreamPath
  };
}

function buildUpstreamHeaders(
  requestHeaders: IncomingHttpHeaders,
  port: number,
  includeUpgradeHeaders: boolean
): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {};

  for (const [key, value] of Object.entries(requestHeaders)) {
    if (!key || value === undefined || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }

    headers[key] = value;
  }

  headers.host = `${UPSTREAM_HOST}:${port}`;

  if (includeUpgradeHeaders) {
    const connection = requestHeaders.connection;
    const upgrade = requestHeaders.upgrade;

    if (connection) {
      headers.connection = connection;
    }

    if (upgrade) {
      headers.upgrade = upgrade;
    }
  }

  return headers;
}

function stripHopByHopHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const nextHeaders: IncomingHttpHeaders = {};

  for (const [key, value] of Object.entries(headers)) {
    if (!key || value === undefined || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }

    nextHeaders[key] = value;
  }

  return nextHeaders;
}

function writeRequestBody(request: FastifyRequest, upstreamRequest: http.ClientRequest): void {
  const method = request.method.toUpperCase();

  if (method === "GET" || method === "HEAD") {
    upstreamRequest.end();
    return;
  }

  // 代理作用域会把 body 作为原始流挂在 request.body，这里优先按流透传。
  if (isReadableStream(request.body)) {
    request.body.pipe(upstreamRequest);
    return;
  }

  if (request.body === undefined || request.body === null) {
    request.raw.pipe(upstreamRequest);
    return;
  }

  if (Buffer.isBuffer(request.body) || typeof request.body === "string") {
    upstreamRequest.end(request.body);
    return;
  }

  upstreamRequest.end(JSON.stringify(request.body));
}

function isReadableStream(value: unknown): value is NodeJS.ReadableStream {
  return typeof value === "object" && value !== null && typeof (value as { pipe?: unknown }).pipe === "function";
}

function writeUpgradeResponse(socket: Duplex, response: IncomingMessage): void {
  const statusCode = response.statusCode ?? 101;
  const statusMessage = response.statusMessage ?? "Switching Protocols";

  socket.write(`HTTP/1.1 ${statusCode} ${statusMessage}\r\n`);

  for (const [key, value] of Object.entries(stripHopByHopHeaders(response.headers))) {
    writeHeader(socket, key, value);
  }

  // WebSocket 升级响应必须保留 Upgrade 和 Connection 头。
  writeHeader(socket, "upgrade", response.headers.upgrade ?? "websocket");
  writeHeader(socket, "connection", "Upgrade");
  socket.write("\r\n");
}

function writeHttpResponse(
  socket: Duplex,
  statusCode: number,
  statusMessage: string,
  headers: IncomingHttpHeaders
): void {
  socket.write(`HTTP/1.1 ${statusCode} ${statusMessage}\r\n`);

  for (const [key, value] of Object.entries(stripHopByHopHeaders(headers))) {
    writeHeader(socket, key, value);
  }

  socket.write("\r\n");
}

function writeHeader(
  socket: Duplex,
  key: string,
  value: string | string[] | number | undefined
): void {
  if (value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      socket.write(`${key}: ${item}\r\n`);
    }
    return;
  }

  socket.write(`${key}: ${value}\r\n`);
}

function writeErrorResponse(socket: Duplex, statusCode: number, message: string): void {
  if (socket.destroyed) {
    return;
  }

  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
