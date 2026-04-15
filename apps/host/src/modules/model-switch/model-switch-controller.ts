import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import { requireUserId } from "../preferences/common.js";
import type { ModelSwitchInput } from "./model-switch-service.js";
import { ModelSwitchService } from "./model-switch-service.js";

export class ModelSwitchController {
  constructor(private readonly modelSwitchService: ModelSwitchService) {}

  readonly getSnapshot = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    requireUserId(request);
    reply.send(await this.modelSwitchService.getSnapshot());
  };

  readonly switchPreset = async (
    request: FastifyRequest<{ Body: ModelSwitchInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);

    try {
      reply.send(await this.modelSwitchService.switchPreset(request.body ?? {}));
    } catch (error) {
      if (error instanceof Error && error.message === "MODEL_SWITCH_APP_UNSUPPORTED") {
        throw new AppError({
          statusCode: 400,
          errorCode: "INVALID_INPUT",
          detail: "当前仅支持 codex、claude-code、gemini、opencode 四个应用",
          field: "app"
        });
      }

      throw error;
    }
  };
}
