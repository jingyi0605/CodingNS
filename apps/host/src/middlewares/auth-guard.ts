import type { FastifyReply, FastifyRequest } from "fastify";

import { sendError } from "../shared/http/error-handler.js";
import type { AuthCallerKind, AuthService } from "../modules/auth/auth-service.js";

const PUBLIC_ROUTE_RULES = new Set([
  "GET:/api/public/bootstrap-status",
  "POST:/api/public/setup",
  "POST:/api/auth/login",
  "POST:/api/auth/refresh",
  "POST:/api/providers/claude-code/hook-bridge/events"
]);

export const ASSISTANT_REQUEST_SOURCE_HEADER = "x-codingns-assistant-source";
export const ASSISTANT_CALLER_KIND_HEADER = "x-codingns-assistant-caller-kind";
export const ASSISTANT_CLI_REQUEST_SOURCE = "assistant-cli";
export const BUTLER_UI_REQUEST_SOURCE = "butler-ui";

export function isPublicRoute(method: string, routePath: string): boolean {
  return PUBLIC_ROUTE_RULES.has(`${method.toUpperCase()}:${routePath}`);
}

function isAssistantRoute(routePath: string): boolean {
  return routePath.startsWith("/api/assistant/");
}

function readAssistantRequestSource(request: FastifyRequest): string | null {
  const header = request.headers[ASSISTANT_REQUEST_SOURCE_HEADER];
  const value = Array.isArray(header) ? header[0] : header;

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isReadOnlyAssistantMethod(method: string): boolean {
  const normalizedMethod = method.trim().toUpperCase();
  return normalizedMethod === "GET" || normalizedMethod === "HEAD";
}

function isAllowedAssistantCaller(
  callerKind: AuthCallerKind,
  requestSource: string | null,
  method: string
): boolean {
  if (callerKind === "assistant_runtime") {
    return true;
  }

  if (callerKind === "interactive_user" && isReadOnlyAssistantMethod(method)) {
    return true;
  }

  return requestSource === BUTLER_UI_REQUEST_SOURCE;
}

export function createAuthGuard(authService: AuthService) {
  return async function authGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const routePath = request.url.split("?")[0] ?? request.url;

    // 页面壳、静态资源和前端路由必须允许匿名访问，真正受保护的是 API。
    if (!routePath.startsWith("/api/")) {
      return;
    }

    if (isPublicRoute(request.method, routePath)) {
      return;
    }

    authService.ensureInitialized();

    const authorization = request.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      sendError(reply, 401, "UNAUTHORIZED", "缺少有效的 Bearer token", "authorization");
      return;
    }

    const accessToken = authorization.slice("Bearer ".length).trim();
    const authContext = authService.authenticateAccessToken(accessToken);

    if (isAssistantRoute(routePath)) {
      const requestSource = readAssistantRequestSource(request);

      if (!isAllowedAssistantCaller(authContext.callerKind, requestSource, request.method)) {
        sendError(
          reply,
          403,
          "ASSISTANT_CALLER_NOT_ALLOWED",
          "当前调用者没有访问助手能力面的权限",
          undefined,
          {
            callerKind: authContext.callerKind,
            requestSource
          }
        );
        return;
      }

      reply.header(ASSISTANT_CALLER_KIND_HEADER, authContext.callerKind);
    }

    request.auth = authContext;
  };
}
