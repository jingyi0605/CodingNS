import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type {
  RelayTunnelControlLoginInput,
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

  readonly loginControl = async (
    request: FastifyRequest<{ Body: RelayTunnelControlLoginInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(await this.relayTunnelService.loginControl(request.body ?? {}));
  };

  readonly logoutControl = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    requireUserId(request);
    reply.send(await this.relayTunnelService.logoutControl());
  };

  readonly checkHostLabelAvailability = async (
    request: FastifyRequest<{ Querystring: { hostLabel?: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(
      await this.relayTunnelService.checkHostLabelAvailability(request.query.hostLabel ?? "")
    );
  };

  readonly bindControlHost = async (
    request: FastifyRequest<{ Body: { hostLabel?: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(await this.relayTunnelService.bindControlHost(request.body?.hostLabel ?? ""));
  };

  readonly getTrafficWallet = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    requireUserId(request);
    const wallet = await this.relayTunnelService.getTrafficWallet();
    reply.send({ wallet });
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
