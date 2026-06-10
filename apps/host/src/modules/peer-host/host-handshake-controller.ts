import type { FastifyReply, FastifyRequest } from "fastify";

import type { HostHandshakeService } from "./host-handshake.js";

export class HostHandshakeController {
  constructor(private readonly hostHandshakeService: HostHandshakeService) {}

  readonly getHandshake = async (
    _request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.hostHandshakeService.getHandshake());
  };
}
