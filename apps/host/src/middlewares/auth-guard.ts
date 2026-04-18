import type { FastifyReply, FastifyRequest } from "fastify";

import { sendError } from "../shared/http/error-handler.js";
import type { AuthService } from "../modules/auth/auth-service.js";

const PUBLIC_ROUTE_RULES = new Set([
  "GET:/api/public/bootstrap-status",
  "POST:/api/public/setup",
  "POST:/api/auth/login",
  "POST:/api/auth/refresh",
  "POST:/api/providers/claude-code/hook-bridge/events"
]);

export function isPublicRoute(method: string, routePath: string): boolean {
  return PUBLIC_ROUTE_RULES.has(`${method.toUpperCase()}:${routePath}`);
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
    request.auth = authService.authenticateAccessToken(accessToken);
  };
}
