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
  app.get("/api/files/workspace-bridge/capabilities", fileController.getWorkspaceBridgeCapabilities);
  app.post("/api/files/workspace-bridge/list-dir", fileController.workspaceBridgeListDir);
  app.post("/api/files/workspace-bridge/read-text", fileController.workspaceBridgeReadText);
  app.post("/api/files/workspace-bridge/read-texts", fileController.workspaceBridgeReadTexts);
  app.post("/api/files/workspace-bridge/write-text", fileController.workspaceBridgeWriteText);
  app.post("/api/files/workspace-bridge/delete-file", fileController.workspaceBridgeDeleteFile);
  app.get("/api/files/workspace-bridge/stat", fileController.workspaceBridgeStat);
  app.get("/api/files/workspace-bridge/exists", fileController.workspaceBridgeExists);
  app.post("/api/files/workspace-bridge/open-file", fileController.workspaceBridgeOpenFile);
  app.post("/api/files/workspace-bridge/reveal-in-file-manager", fileController.workspaceBridgeRevealInFileManager);
  app.post("/api/files/workspace-bridge/watch-dir", fileController.workspaceBridgeWatchDir);
  app.post("/api/files/workspace-bridge/unwatch", fileController.workspaceBridgeUnwatch);
  app.get("/api/files/workspace-bridge/watch-events", fileController.workspaceBridgePollWatch);
  app.get("/preview/runtime/codingns-workspace-bridge.js", fileController.workspaceBridgeRuntime);
  app.get("/preview/files/*", fileController.publicPreview);
}
