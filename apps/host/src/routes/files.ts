import type { FastifyInstance } from "fastify";

import type { FileController } from "../modules/file/file-controller.js";

const FILE_UPLOAD_BODY_LIMIT_BYTES = 256 * 1024 * 1024;

export async function registerFileRoutes(
  app: FastifyInstance,
  fileController: FileController
): Promise<void> {
  app.get("/api/files/tree", fileController.getTree);
  app.get("/api/files/content", fileController.getContent);
  app.put("/api/files/content", fileController.saveContent);
  app.post("/api/files/ops", fileController.operate);
  app.post(
    "/api/files/upload",
    {
      bodyLimit: FILE_UPLOAD_BODY_LIMIT_BYTES
    },
    fileController.upload
  );
  app.get("/api/files/download", fileController.download);
  app.get("/api/files/search", fileController.search);
  app.get("/api/files/recent", fileController.getRecent);
  app.get("/api/files/preview", fileController.preview);
  app.get("/api/files/preview-link", fileController.createPreviewLink);
  app.get("/preview/files/*", fileController.publicPreview);
}
