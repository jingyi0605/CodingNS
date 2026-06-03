import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import { HostResourceService } from "./host-resource-service.js";

export class HostResourceController {
  constructor(private readonly hostResourceService: HostResourceService) {}

  readonly getSnapshot = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    requireUserId(request);
    reply.send(await this.hostResourceService.getSnapshot());
  };
}
