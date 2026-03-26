import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";

interface ProviderParams {
  provider: string;
}

interface ProviderCapabilitiesQuery {
  workspaceId?: string;
}

export class ProviderController {
  constructor(private readonly sessionHistoryService: SessionHistoryService) {}

  readonly getCapabilities = async (
    request: FastifyRequest<{ Params: ProviderParams; Querystring: ProviderCapabilitiesQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const provider = request.params.provider.trim();

    if (!provider) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "provider 不能为空",
        field: "provider"
      });
    }

    reply.send(
      await this.sessionHistoryService.getProviderCapabilities(
        provider,
        request.query.workspaceId?.trim() || null
      )
    );
  };
}
