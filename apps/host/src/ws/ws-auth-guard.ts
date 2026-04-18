import type { IncomingMessage } from "node:http";

import { AppError } from "../shared/errors/app-error.js";
import type { AuthContext, AuthService } from "../modules/auth/auth-service.js";

export class WsAuthGuard {
  constructor(private readonly authService: AuthService) {}

  authenticate(request: IncomingMessage): AuthContext {
    this.authService.ensureInitialized();

    const url = new URL(request.url ?? "/ws", "http://127.0.0.1");
    const headerToken = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice("Bearer ".length).trim()
      : null;
    const queryToken = url.searchParams.get("access_token");
    const accessToken = headerToken ?? queryToken;

    if (!accessToken) {
      throw new AppError({
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
        detail: "WebSocket 缺少 access token"
      });
    }

    return this.authService.authenticateAccessToken(accessToken);
  }
}
