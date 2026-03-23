import type { FastifyReply, FastifyRequest } from "fastify";

import type { BootstrapService, SetupInput } from "./bootstrap-service.js";

export class BootstrapController {
  constructor(private readonly bootstrapService: BootstrapService) {}

  readonly getStatus = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send(this.bootstrapService.getStatus());
  };

  readonly setup = async (
    request: FastifyRequest<{ Body: SetupInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.status(201).send(this.bootstrapService.setup(request.body));
  };
}
