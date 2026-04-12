import type { FastifyInstance } from "fastify";

import type { ObservabilityController } from "../modules/tasks/observability-controller.js";

export async function registerObservabilityRoutes(
  app: FastifyInstance,
  observabilityController: ObservabilityController
): Promise<void> {
  app.post("/api/observability/runtime/session", observabilityController.createRuntimeSession);
  app.post(
    "/api/observability/runtime/session/:sessionId/heartbeat",
    observabilityController.heartbeatRuntimeSession
  );
  app.delete(
    "/api/observability/runtime/session/:sessionId",
    observabilityController.closeRuntimeSession
  );
  app.get("/api/observability/runtime", observabilityController.getRuntimeSnapshot);
}
