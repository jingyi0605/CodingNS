import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { PeerHostService } from "./peer-host-service.js";

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
  "content-length",
  "authorization",
]);

const ALLOWED_PROXY_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

const DENIED_PROXY_PATH_PREFIXES = [
  "/api/auth",
  "/api/public",
  "/api/peer-hosts",
  "/api/host-proxy",
] as const;

export class HostApiProxyService {
  constructor(
    private readonly peerHostService: PeerHostService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async proxy(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ownerUserId = request.auth?.user.userId;

    if (!ownerUserId) {
      throw new AppError({
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
        detail: "当前请求缺少有效登录态",
      });
    }

    const params = request.params as { peerHostId?: string; "*"?: string };
    const peerHostId =
      typeof params.peerHostId === "string" ? params.peerHostId : "";
    const targetPath = normalizeProxyPath(params["*"]);
    ensureAllowedProxyPath(request.method, targetPath);

    const peerHost = this.peerHostService.ensureProxyReady(
      ownerUserId,
      peerHostId,
    );
    const accessToken = await this.peerHostService.getAccessTokenForProxy(
      ownerUserId,
      peerHost,
    );
    const targetUrl = `${peerHost.baseUrl}${targetPath}${readQueryString(request.url)}`;
    const response = await this.fetchImpl(targetUrl, {
      method: request.method,
      headers: buildForwardHeaders(request, accessToken),
      body: shouldForwardBody(request.method)
        ? JSON.stringify(request.body ?? {})
        : undefined,
    }).catch((error: unknown) => {
      throw createPeerHostProxyFetchError(peerHostId, targetUrl, error);
    });

    if (response.status === 401) {
      this.peerHostService.clearSession(ownerUserId, peerHostId);
    }

    forwardResponseHeaders(response, reply);
    reply.status(response.status).send(await response.text());
  }
}

function normalizeProxyPath(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "HOST_PROXY_PATH_REQUIRED",
      detail: "缺少要代理的目标路径",
    });
  }

  const decoded = value.startsWith("/") ? value : `/${value}`;
  return decoded.replace(/\/{2,}/g, "/");
}

export function ensureAllowedProxyPath(method: string, pathname: string): void {
  const normalizedMethod = method.toUpperCase();

  if (!ALLOWED_PROXY_METHODS.has(normalizedMethod)) {
    throw new AppError({
      statusCode: 403,
      errorCode: "HOST_PROXY_METHOD_NOT_ALLOWED",
      detail: "这个请求方法不允许通过 Peer HOST 代理",
      data: { method: normalizedMethod, pathname },
    });
  }

  if (!pathname.startsWith("/api/")) {
    throw new AppError({
      statusCode: 403,
      errorCode: "HOST_PROXY_PATH_NOT_ALLOWED",
      detail: "只有正式 API 才允许通过 Peer HOST 代理",
      data: { method: normalizedMethod, pathname },
    });
  }

  const deniedPrefix = DENIED_PROXY_PATH_PREFIXES.find((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (deniedPrefix) {
    throw new AppError({
      statusCode: 403,
      errorCode: "HOST_PROXY_PATH_NOT_ALLOWED",
      detail: "这个 API 路径不允许通过 Peer HOST 代理",
      data: { method: normalizedMethod, pathname, deniedPrefix },
    });
  }
}

function readQueryString(url: string): string {
  const index = url.indexOf("?");
  return index >= 0 ? url.slice(index) : "";
}

function shouldForwardBody(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD";
}

function buildForwardHeaders(
  request: FastifyRequest,
  accessToken: string,
): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    const normalized = name.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(normalized)) {
      continue;
    }

    if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    } else if (typeof value === "string") {
      headers.set(name, value);
    }
  }

  headers.set("authorization", `Bearer ${accessToken}`);

  if (shouldForwardBody(request.method) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return headers;
}

function forwardResponseHeaders(response: Response, reply: FastifyReply): void {
  response.headers.forEach((value, name) => {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      return;
    }

    reply.header(name, value);
  });
}

function createPeerHostProxyFetchError(
  peerHostId: string,
  targetUrl: string,
  error: unknown,
): AppError {
  const cause = readErrorCause(error);
  const code = readErrorCode(cause) ?? readErrorCode(error);

  return new AppError({
    statusCode: 502,
    errorCode: "PEER_HOST_PROXY_UNREACHABLE",
    detail: "无法连接 Peer HOST，请确认目标 HOST 正在运行并且当前主机可以访问它",
    data: {
      peerHostId,
      targetUrl,
      causeCode: code,
      causeMessage: cause instanceof Error
        ? cause.message
        : error instanceof Error
          ? error.message
          : String(error),
    },
  });
}

function readErrorCause(error: unknown): unknown {
  return typeof error === "object" && error !== null && "cause" in error
    ? (error as { cause?: unknown }).cause
    : null;
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}
