import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type { TailscaleConfigUpdateInput } from "./tailscale-service.js";
import { TailscaleService } from "./tailscale-service.js";

export class TailscaleController {
  constructor(private readonly tailscaleService: TailscaleService) {}

  readonly getStatus = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // 这里显式要求登录态，避免未来系统路由被复用时绕过受保护边界。
    requireUserId(request);
    reply.send(await this.tailscaleService.getStatus());
  };

  readonly updateConfig = async (
    request: FastifyRequest<{ Body: TailscaleConfigUpdateInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(await this.tailscaleService.updateConfig(request.body ?? {}));
  };

  readonly enable = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    requireUserId(request);
    reply.send(await this.tailscaleService.enable());
  };

  readonly disable = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    requireUserId(request);
    reply.send(await this.tailscaleService.disable());
  };

  readonly login = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    requireUserId(request);
    reply.send(await this.tailscaleService.login());
  };

  readonly logout = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    requireUserId(request);
    reply.send(await this.tailscaleService.logout());
  };
}
