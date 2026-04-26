import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type {
  OpenCliCheckResultDto,
  UpdateOpenCliConfigInput,
  UpdateOpenCliConfigResultDto
} from "./opencli-management-service.js";
import { OpenCliManagementService } from "./opencli-management-service.js";

export class OpenCliController {
  constructor(private readonly openCliManagementService: OpenCliManagementService) {}

  readonly getOverview = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(this.openCliManagementService.getOverview());
  };

  readonly getCatalog = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(this.openCliManagementService.getCatalog());
  };

  readonly check = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    const result: OpenCliCheckResultDto = await this.openCliManagementService.check();
    reply.send(result);
  };

  readonly updateConfig = async (
    request: FastifyRequest<{ Body: UpdateOpenCliConfigInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    const body = request.body ?? { enabled: false, enabledCommandIds: [] };
    const result: UpdateOpenCliConfigResultDto = this.openCliManagementService.updateConfig({
      enabled: Boolean(body.enabled),
      enabledCommandIds: Array.isArray(body.enabledCommandIds) ? body.enabledCommandIds : []
    });
    reply.send(result);
  };
}
