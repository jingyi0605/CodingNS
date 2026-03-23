import type { FastifyReply, FastifyRequest } from "fastify";

import type {
  AuthService,
  LoginInput,
  LogoutInput,
  RefreshInput
} from "./auth-service.js";

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  readonly login = async (
    request: FastifyRequest<{ Body: LoginInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.authService.login(request.body));
  };

  readonly refresh = async (
    request: FastifyRequest<{ Body: RefreshInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.authService.refresh(request.body));
  };

  readonly logout = async (
    request: FastifyRequest<{ Body: LogoutInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    const accessToken = request.auth?.accessToken;

    if (!accessToken) {
      throw new Error("缺少 access token 上下文");
    }

    reply.send(this.authService.logout(accessToken, request.body));
  };
}
