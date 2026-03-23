import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { SessionIndexController } from "../modules/session-index/session-index-controller.js";
import type { SessionReadService } from "../modules/sessions/session-read-service.js";

interface SessionMessageParams {
  sessionId: string;
}

interface SessionMessageQuery {
  cursor?: string;
  limit?: string;
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  sessionIndexController: SessionIndexController,
  sessionReadService: SessionReadService
): Promise<void> {
  app.get("/api/sessions", sessionIndexController.list);
  app.get(
    "/api/sessions/:sessionId/messages",
    async (
      request: FastifyRequest<{
        Params: SessionMessageParams;
        Querystring: SessionMessageQuery;
      }>,
      reply: FastifyReply
    ) => {
      const page = await sessionReadService.readMessages(
        request.params.sessionId,
        request.query.cursor ?? null,
        Number(request.query.limit ?? "50")
      );

      reply.send(page);
    }
  );
}
