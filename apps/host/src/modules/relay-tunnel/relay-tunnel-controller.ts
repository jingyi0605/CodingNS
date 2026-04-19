import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type {
  RelayTunnelBindInput,
  RelayTunnelConfigUpdateInput
} from "./relay-tunnel-service.js";
import { RelayTunnelService } from "./relay-tunnel-service.js";

export class RelayTunnelController {
  constructor(private readonly relayTunnelService: RelayTunnelService) {}

  readonly getStatus = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    requireUserId(request);
    reply.send(await this.relayTunnelService.getStatus());
  };

  readonly ensureIdentity = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(await this.relayTunnelService.ensureIdentity());
  };

  readonly updateConfig = async (
    request: FastifyRequest<{ Body: RelayTunnelConfigUpdateInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(await this.relayTunnelService.updateConfig(request.body ?? {}));
  };

  readonly bind = async (
    request: FastifyRequest<{ Body: RelayTunnelBindInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(await this.relayTunnelService.bind(request.body ?? {}));
  };

  readonly unbind = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    requireUserId(request);
    reply.send(await this.relayTunnelService.unbind());
  };

  readonly enable = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    requireUserId(request);
    reply.send(await this.relayTunnelService.enable());
  };

  readonly disable = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    requireUserId(request);
    reply.send(await this.relayTunnelService.disable());
  };
}
