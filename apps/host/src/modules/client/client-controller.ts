import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { ClientService } from "./client-service.js";

export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  readonly getRuntimeConfig = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    if (!request.auth?.user.userId) {
      throw new AppError({
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
        detail: "当前请求缺少有效登录态"
      });
    }

    const platform = normalizePlatform(request.query);
    reply.send(await this.clientService.getRuntimeConfig(platform, {
      protocol: readRequestProtocol(request),
      host: request.headers.host ?? null
    }));
  };

  readonly getReleaseManifest = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    if (!request.auth?.user.userId) {
      throw new AppError({
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
        detail: "当前请求缺少有效登录态"
      });
    }

    const query = request.query as {
      channel?: "stable" | "beta";
      platform?: string;
    };

    if (!query.platform) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_PLATFORM",
        detail: "缺少发布平台标识",
        field: "platform"
      });
    }

    const channel = query.channel === "beta" ? "beta" : "stable";
    reply.send(this.clientService.getReleaseManifest(channel, query.platform));
  };

  readonly getServiceUpdate = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    ensureAuthenticated(request);

    const query = request.query as {
      channel?: "stable" | "beta";
    };

    const channel = query.channel === "beta" ? "beta" : "stable";
    reply.send(await this.clientService.getServiceUpdate(channel));
  };

  readonly installServiceUpdate = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    ensureAuthenticated(request);

    const body = request.body as {
      packageName?: string;
      channel?: "stable" | "beta";
    } | undefined;

    if (!body?.packageName) {
      throw new AppError({
        statusCode: 400,
        errorCode: "SERVICE_UPDATE_PACKAGE_REQUIRED",
        detail: "缺少需要升级的 npm 包名",
        field: "packageName"
      });
    }

    const channel = body.channel === "beta" ? "beta" : "stable";
    reply.send(await this.clientService.installServiceUpdate(channel, body.packageName));
  };

  readonly getServiceUpdateTask = async (
    request: FastifyRequest<{ Params: { taskId: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    ensureAuthenticated(request);
    reply.send(this.clientService.getServiceUpdateTask(request.params.taskId));
  };
}

function readRequestProtocol(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-proto"];

  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]?.trim() || "http";
  }

  return request.protocol;
}

function normalizePlatform(query: unknown): "desktop" | "web" {
  const platform = (query as { platform?: string } | undefined)?.platform;
  return platform === "desktop" ? "desktop" : "web";
}

function ensureAuthenticated(request: FastifyRequest): void {
  if (request.auth?.user.userId) {
    return;
  }

  throw new AppError({
    statusCode: 401,
    errorCode: "UNAUTHORIZED",
    detail: "当前请求缺少有效登录态"
  });
}
