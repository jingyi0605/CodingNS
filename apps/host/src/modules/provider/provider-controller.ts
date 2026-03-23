import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { SessionRuntimeService } from "../sessions/session-runtime-service.js";

interface ProviderParams {
  provider: string;
}

export class ProviderController {
  constructor(private readonly sessionRuntimeService: SessionRuntimeService) {}

  readonly getCapabilities = async (
    request: FastifyRequest<{ Params: ProviderParams }>,
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

    reply.send(this.sessionRuntimeService.getProviderCapabilities(provider));
  };
}
