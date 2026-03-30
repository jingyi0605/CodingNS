import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { QuickPhraseService } from "./quick-phrase-service.js";
import { requireUserId } from "./common.js";

interface ReplaceQuickPhrasesBody {
  items?: Array<{
    id?: string;
    text?: string;
  }>;
}

export class QuickPhraseController {
  constructor(private readonly quickPhraseService: QuickPhraseService) {}

  readonly list = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send({
      items: this.quickPhraseService.listByUser(requireUserId(request))
    });
  };

  readonly replace = async (
    request: FastifyRequest<{ Body: ReplaceQuickPhrasesBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    if (!Array.isArray(request.body.items)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "更新快捷短语请提供 items 数组",
        field: "items"
      });
    }

    reply.send({
      items: this.quickPhraseService.replaceByUser(requireUserId(request), request.body.items)
    });
  };
}
