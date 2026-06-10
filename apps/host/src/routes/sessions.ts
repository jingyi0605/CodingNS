import type { FastifyInstance } from "fastify";

import type { SessionController } from "../modules/sessions/session-controller.js";

// 会话附件当前通过 JSON + base64 直接提交，Fastify 默认 1MB bodyLimit
// 对首条/追加/排队消息都过小，合法图片会在进入 controller 前就被 413 拦掉。
export const SESSION_MESSAGE_BODY_LIMIT_BYTES = 64 * 1024 * 1024;

export async function registerSessionRoutes(
  app: FastifyInstance,
  sessionController: SessionController
): Promise<void> {
  app.get("/api/sessions", sessionController.list);
  app.get("/api/sessions/:sessionId", sessionController.getDetail);
  app.get("/api/sessions/:sessionId/changed-files", sessionController.getChangedFiles);
  app.get("/api/sessions/:sessionId/messages", sessionController.readMessages);
  app.get("/api/sessions/:sessionId/attachments/:attachmentId/content", sessionController.readAttachment);
  app.get("/api/sessions/:sessionId/capabilities", sessionController.getCapabilities);
  app.get("/api/sessions/:sessionId/permission-requests", sessionController.listPermissionRequests);
  app.get("/api/sessions/:sessionId/queue", sessionController.listQueue);
  app.get("/api/sessions/:sessionId/runtime", sessionController.getRuntime);
  app.patch("/api/sessions/:sessionId/title", sessionController.renameTitle);
  app.patch("/api/sessions/:sessionId/archive", sessionController.updateArchiveState);
  app.patch("/api/sessions/:sessionId/favorite", sessionController.updateFavoriteState);
  app.post("/api/sessions/:sessionId/forks", sessionController.fork);
  app.post("/api/sessions/:sessionId/messages", sessionController.sendMessage);
  app.post(
    "/api/sessions/:sessionId/messages/live",
    {
      bodyLimit: SESSION_MESSAGE_BODY_LIMIT_BYTES
    },
    sessionController.sendLiveMessage
  );
  app.post(
    "/api/sessions/:sessionId/permission-requests/:requestId/reply",
    sessionController.replyPermissionRequest
  );
  app.post(
    "/api/sessions/:sessionId/queue",
    {
      bodyLimit: SESSION_MESSAGE_BODY_LIMIT_BYTES
    },
    sessionController.enqueueLiveMessage
  );
  app.post("/api/sessions/:sessionId/queue/:queueItemId/steer", sessionController.steerQueuedMessage);
  app.post("/api/sessions/:sessionId/interrupt", sessionController.interrupt);
  app.post("/api/sessions/:sessionId/seen", sessionController.markSeen);
  app.post("/api/sessions/:sessionId/resume", sessionController.resume);
  app.post("/api/sessions/source-index/repair", sessionController.repairSourceIndex);
  app.post("/api/sessions/source-index/rebuild", sessionController.repairSourceIndex);
  app.post("/api/sessions/start", sessionController.start);
  app.post(
    "/api/sessions/start-live",
    {
      bodyLimit: SESSION_MESSAGE_BODY_LIMIT_BYTES
    },
    sessionController.startLive
  );
  app.delete("/api/sessions/:sessionId", sessionController.deleteSession);
  app.delete("/api/sessions/:sessionId/queue/:queueItemId", sessionController.deleteQueuedMessage);
}
