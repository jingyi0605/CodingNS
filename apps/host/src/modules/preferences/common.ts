import type { FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";

export function requireUserId(request: FastifyRequest): string {
  const userId = request.auth?.user.userId;

  if (!userId) {
    throw new AppError({
      statusCode: 401,
      errorCode: "UNAUTHORIZED",
      detail: "当前请求缺乏登录信息"
    });
  }

  return userId;
}
