import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import WebSocket, { WebSocketServer } from "ws";

import { AppError } from "../../shared/errors/app-error.js";
import type { AuthContext } from "../auth/auth-service.js";
import type { WsAuthGuard } from "../../ws/ws-auth-guard.js";
import type { PeerHostService } from "./peer-host-service.js";

const PROXY_WS_PATH_PATTERN = /^\/api\/host-proxy\/hosts\/([^/]+)\/ws$/;

const ALLOWED_CLIENT_MESSAGE_TYPES = new Set([
  "workbench.subscribe",
  "workbench.refresh",
  "fileTree.subscribe",
  "fileTree.refresh",
  "git.subscribe",
  "git.refresh",
  "workspaceManagement.subscribe",
  "workspaceManagement.refresh",
  "terminalManager.subscribe",
  "terminalManager.refresh",
  "terminal.subscribe",
  "terminal.input",
  "terminal.resize",
  "session.subscribe",
  "session.load_older",
]);

const ALLOWED_REMOTE_MESSAGE_TYPES = new Set([
  "system.connected",
  "workbench.snapshot",
  "workbench.delta",
  "fileTree.snapshot",
  "git.snapshot",
  "workspaceManagement.snapshot",
  "terminalManager.snapshot",
  "terminal.subscribed",
  "terminal.backfill",
  "terminal.output",
  "terminal.status",
  "terminal.exit",
  "terminal.error",
  "terminal.input.accepted",
  "terminal.resize.accepted",
  "session.subscribed",
  "session.backfill",
  "session.delta",
  "session.history_older",
  "session.runtime_message",
  "session.runtime_status",
  "session.activity",
  "session.runtime_error",
  "session.interrupted",
  "session.permission_request",
  "session.permission_request_resolved",
  "session.error",
]);

export class HostWsProxyService {
  private readonly clientWss = new WebSocketServer({ noServer: true });

  constructor(
    private readonly wsAuthGuard: WsAuthGuard,
    private readonly peerHostService: PeerHostService,
  ) {}

  canHandleUpgrade(request: IncomingMessage): boolean {
    return Boolean(parseProxyWsRequest(request));
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    const parsed = parseProxyWsRequest(request);

    if (!parsed) {
      return false;
    }

    void this.openProxy(request, socket, head, parsed.peerHostId);
    return true;
  }

  private async openProxy(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    peerHostId: string,
  ): Promise<void> {
    let authContext: AuthContext;
    let remoteSocket: WebSocket | null = null;

    try {
      authContext = this.wsAuthGuard.authenticate(request);
      const peerHost = this.peerHostService.ensureProxyReady(
        authContext.user.userId,
        peerHostId,
      );
      const accessToken = await this.peerHostService.getAccessTokenForProxy(
        authContext.user.userId,
        peerHost,
      );
      remoteSocket = await connectRemoteWorkbenchSocket(
        peerHost.baseUrl,
        accessToken,
      );
    } catch (error) {
      writeUpgradeError(socket, error);
      return;
    }

    this.clientWss.handleUpgrade(request, socket, head, (client) => {
      this.bindSockets(client, remoteSocket, peerHostId, authContext);
      this.clientWss.emit("connection", client, request);
    });
  }

  private bindSockets(
    client: WebSocket,
    remoteSocket: WebSocket,
    peerHostId: string,
    authContext: AuthContext,
  ): void {
    let closed = false;
    const closeBoth = (code?: number, reason?: string) => {
      if (closed) {
        return;
      }

      closed = true;
      if (remoteSocket.readyState === WebSocket.OPEN || remoteSocket.readyState === WebSocket.CONNECTING) {
        closeSocketSafely(remoteSocket, code, reason);
      }
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        closeSocketSafely(client, code, reason);
      }
    };

    client.on("message", (data, isBinary) => {
      if (isBinary) {
        sendWsError(client, "HOST_PROXY_WS_BINARY_NOT_ALLOWED", "Peer HOST 代理不支持二进制 WebSocket 消息");
        return;
      }

      const raw = data.toString("utf8");
      const messageType = readMessageType(raw);

      if (!messageType || !ALLOWED_CLIENT_MESSAGE_TYPES.has(messageType)) {
        sendWsError(client, "HOST_PROXY_WS_MESSAGE_NOT_ALLOWED", "这个 WebSocket 消息没有加入 Peer HOST 代理白名单");
        return;
      }

      if (remoteSocket.readyState !== WebSocket.OPEN) {
        sendWsError(client, "HOST_PROXY_WS_UPSTREAM_CLOSED", "目标 HOST 实时连接已经断开");
        return;
      }

      remoteSocket.send(raw);
    });

    remoteSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        return;
      }

      const raw = data.toString("utf8");
      const messageType = readMessageType(raw);

      if (!messageType || !ALLOWED_REMOTE_MESSAGE_TYPES.has(messageType)) {
        return;
      }

      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    });

    remoteSocket.on("close", (code, reason) => {
      if (code === 1008 || code === 4001 || code === 4401) {
        this.peerHostService.clearSession(authContext.user.userId, peerHostId);
      }

      closeBoth(code, reason.length > 0 ? reason.toString("utf8") : undefined);
    });
    remoteSocket.on("error", () => {
      sendWsError(client, "HOST_PROXY_WS_UPSTREAM_FAILED", "目标 HOST 实时连接失败");
      closeBoth(1011, "upstream failed");
    });
    client.on("close", () => closeBoth());
    client.on("error", () => closeBoth(1011, "client failed"));
  }
}

function parseProxyWsRequest(request: IncomingMessage): { peerHostId: string } | null {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const match = PROXY_WS_PATH_PATTERN.exec(pathname);

  if (!match?.[1]) {
    return null;
  }

  return { peerHostId: decodeURIComponent(match[1]) };
}

function buildRemoteWsUrl(baseUrl: string, accessToken: string): string {
  const url = new URL("/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("access_token", accessToken);
  return url.toString();
}

function connectRemoteWorkbenchSocket(
  baseUrl: string,
  accessToken: string,
): Promise<WebSocket> {
  const remoteSocket = new WebSocket(buildRemoteWsUrl(baseUrl, accessToken));

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;

    const rejectOnce = (error: AppError) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      timedOut = true;
      remoteSocket.terminate();
    }, 5_000);

    const cleanup = () => {
      clearTimeout(timer);
      remoteSocket.off("open", handleOpen);
      remoteSocket.off("error", handleError);
      remoteSocket.off("close", handleClose);
    };
    const handleOpen = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(remoteSocket);
    };
    const handleError = (error: Error) => {
      if (timedOut) {
        rejectOnce(
          new AppError({
            statusCode: 504,
            errorCode: "HOST_PROXY_WS_CONNECT_TIMEOUT",
            detail: "连接目标 HOST 实时通道超时",
          }),
        );
        return;
      }

      rejectOnce(
        new AppError({
          statusCode: 502,
          errorCode: "HOST_PROXY_WS_UPSTREAM_FAILED",
          detail: error.message || "目标 HOST 实时通道连接失败",
        }),
      );
    };
    const handleClose = () => {
      if (timedOut) {
        rejectOnce(
          new AppError({
            statusCode: 504,
            errorCode: "HOST_PROXY_WS_CONNECT_TIMEOUT",
            detail: "连接目标 HOST 实时通道超时",
          }),
        );
        return;
      }

      rejectOnce(
        new AppError({
          statusCode: 502,
          errorCode: "HOST_PROXY_WS_UPSTREAM_CLOSED",
          detail: "目标 HOST 实时通道已关闭",
        }),
      );
    };

    remoteSocket.once("open", handleOpen);
    remoteSocket.once("error", handleError);
    remoteSocket.once("close", handleClose);
  });
}

function readMessageType(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    return typeof parsed.type === "string" ? parsed.type : null;
  } catch {
    return null;
  }
}

function sendWsError(client: WebSocket, errorCode: string, detail: string): void {
  if (client.readyState !== WebSocket.OPEN) {
    return;
  }

  client.send(
    JSON.stringify({
      type: "session.error",
      sessionId: null,
      error_code: errorCode,
      detail,
      timestamp: new Date().toISOString(),
    }),
  );
}

function closeSocketSafely(
  socket: WebSocket,
  code?: number,
  reason?: string,
): void {
  const sanitizedCode = sanitizeCloseCode(code);
  const sanitizedReason = sanitizeCloseReason(reason);

  if (sanitizedCode === undefined) {
    socket.close();
    return;
  }

  socket.close(sanitizedCode, sanitizedReason);
}

function sanitizeCloseCode(code?: number): number | undefined {
  if (typeof code !== "number" || !Number.isInteger(code)) {
    return undefined;
  }

  if (!isValidWsCloseCode(code)) {
    return undefined;
  }

  return code;
}

function sanitizeCloseReason(reason?: string): string | undefined {
  if (!reason) {
    return undefined;
  }

  const bytes = Buffer.byteLength(reason);
  if (bytes <= 123) {
    return reason;
  }

  return Buffer.from(reason, "utf8").subarray(0, 123).toString("utf8");
}

function isValidWsCloseCode(code: number): boolean {
  return (
    ((code >= 1000 && code <= 1014) &&
      code !== 1004 &&
      code !== 1005 &&
      code !== 1006) ||
    (code >= 3000 && code <= 4999)
  );
}

function writeUpgradeError(socket: Duplex, error: unknown): void {
  const appError =
    error instanceof AppError
      ? error
      : new AppError({
          statusCode: 500,
          errorCode: "HOST_PROXY_WS_FAILED",
          detail: error instanceof Error ? error.message : "Peer HOST 实时代理失败",
        });
  const statusCode =
    appError.statusCode === 401
      ? 401
      : appError.statusCode === 403
        ? 403
        : appError.statusCode === 409
          ? 409
          : 502;

  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText(statusCode)}\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({
      detail: appError.message,
      error_code: appError.errorCode,
    })}`,
  );
  socket.destroy();
}

function statusText(statusCode: number): string {
  switch (statusCode) {
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 409:
      return "Conflict";
    default:
      return "Bad Gateway";
  }
}
