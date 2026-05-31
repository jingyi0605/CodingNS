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
  app.get("/api/files/recent-modified", fileController.getRecentModified);
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
  app.post("/api/files/workspace-bridge/apply-index-config", fileController.workspaceBridgeApplyIndexConfig);
  app.get("/preview/runtime/codingns-workspace-bridge.js", fileController.workspaceBridgeRuntime);
  app.get("/preview/workspace-bridge/capabilities", fileController.previewWorkspaceBridgeCapabilities);
  app.post("/preview/workspace-bridge/list-dir", fileController.previewWorkspaceBridgeListDir);
  app.post("/preview/workspace-bridge/read-text", fileController.previewWorkspaceBridgeReadText);
  app.post("/preview/workspace-bridge/read-texts", fileController.previewWorkspaceBridgeReadTexts);
  app.post("/preview/workspace-bridge/write-text", fileController.previewWorkspaceBridgeWriteText);
  app.post("/preview/workspace-bridge/delete-file", fileController.previewWorkspaceBridgeDeleteFile);
  app.get("/preview/workspace-bridge/stat", fileController.previewWorkspaceBridgeStat);
  app.get("/preview/workspace-bridge/exists", fileController.previewWorkspaceBridgeExists);
  app.post("/preview/workspace-bridge/open-file", fileController.previewWorkspaceBridgeOpenFile);
  app.post("/preview/workspace-bridge/reveal-in-file-manager", fileController.previewWorkspaceBridgeRevealInFileManager);
  app.post("/preview/workspace-bridge/watch-dir", fileController.previewWorkspaceBridgeWatchDir);
  app.post("/preview/workspace-bridge/unwatch", fileController.previewWorkspaceBridgeUnwatch);
  app.get("/preview/workspace-bridge/watch-events", fileController.previewWorkspaceBridgePollWatch);
  app.post("/preview/workspace-bridge/apply-index-config", fileController.previewWorkspaceBridgeApplyIndexConfig);
  app.get("/preview/workspace-bridge/:token/capabilities", fileController.previewWorkspaceBridgeCapabilities);
  app.post("/preview/workspace-bridge/:token/list-dir", fileController.previewWorkspaceBridgeListDir);
  app.post("/preview/workspace-bridge/:token/read-text", fileController.previewWorkspaceBridgeReadText);
  app.post("/preview/workspace-bridge/:token/read-texts", fileController.previewWorkspaceBridgeReadTexts);
  app.post("/preview/workspace-bridge/:token/write-text", fileController.previewWorkspaceBridgeWriteText);
  app.post("/preview/workspace-bridge/:token/delete-file", fileController.previewWorkspaceBridgeDeleteFile);
  app.get("/preview/workspace-bridge/:token/stat", fileController.previewWorkspaceBridgeStat);
  app.get("/preview/workspace-bridge/:token/exists", fileController.previewWorkspaceBridgeExists);
  app.post("/preview/workspace-bridge/:token/open-file", fileController.previewWorkspaceBridgeOpenFile);
  app.post("/preview/workspace-bridge/:token/reveal-in-file-manager", fileController.previewWorkspaceBridgeRevealInFileManager);
  app.post("/preview/workspace-bridge/:token/watch-dir", fileController.previewWorkspaceBridgeWatchDir);
  app.post("/preview/workspace-bridge/:token/unwatch", fileController.previewWorkspaceBridgeUnwatch);
  app.get("/preview/workspace-bridge/:token/watch-events", fileController.previewWorkspaceBridgePollWatch);
  app.post("/preview/workspace-bridge/:token/apply-index-config", fileController.previewWorkspaceBridgeApplyIndexConfig);
  app.get("/preview/files/*", fileController.publicPreview);
  app.get("/preview/affairs-files/*", fileController.publicAffairsPreview);
}
