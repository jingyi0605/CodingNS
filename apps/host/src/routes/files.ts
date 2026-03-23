import type { FastifyInstance } from "fastify";

import type { FileController } from "../modules/file/file-controller.js";

export async function registerFileRoutes(
  app: FastifyInstance,
  fileController: FileController
): Promise<void> {
  app.get("/api/files/tree", fileController.getTree);
  app.get("/api/files/content", fileController.getContent);
  app.put("/api/files/content", fileController.saveContent);
  app.post("/api/files/ops", fileController.operate);
  app.get("/api/files/search", fileController.search);
  app.get("/api/files/recent", fileController.getRecent);
  app.get("/api/files/preview", fileController.preview);
}
