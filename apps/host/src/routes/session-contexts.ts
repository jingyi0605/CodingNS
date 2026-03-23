import type { FastifyInstance } from "fastify";

import type { FileContextController } from "../modules/file/file-context-controller.js";

export async function registerSessionContextRoutes(
  app: FastifyInstance,
  fileContextController: FileContextController
): Promise<void> {
  app.get("/api/sessions/:sessionId/contexts/files", fileContextController.list);
  app.post("/api/sessions/:sessionId/contexts/files", fileContextController.attach);
  app.delete(
    "/api/sessions/:sessionId/contexts/files/:bindingId",
    fileContextController.detach
  );
}
