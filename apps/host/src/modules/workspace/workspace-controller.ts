import type { FastifyReply, FastifyRequest } from "fastify";

import type { WorkspaceService } from "./workspace-service.js";

export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  readonly list = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send({
      items: this.workspaceService.list()
    });
  };
}
