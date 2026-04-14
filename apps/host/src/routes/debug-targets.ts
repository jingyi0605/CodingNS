import type { FastifyInstance } from "fastify";

import type { DebugTargetController } from "../modules/debug-target/debug-target-controller.js";

export async function registerDebugTargetRoutes(
  app: FastifyInstance,
  debugTargetController: DebugTargetController
): Promise<void> {
  app.get("/api/debug-runtimes/:runtimeId", debugTargetController.getRuntime);
  app.get("/api/debug-targets/:targetId/runtime-latest", debugTargetController.getLatestRuntime);
  app.get("/api/debug-targets/:targetId/runtimes", debugTargetController.getRuntimeHistory);
  app.post("/api/debug-targets/analyze", debugTargetController.analyze);
  app.post("/api/debug-targets/:targetId/launch-plan", debugTargetController.createLaunchPlan);
  app.post("/api/debug-targets/:targetId/run", debugTargetController.run);
  app.get("/api/debug-targets/:targetId/framework-analysis", debugTargetController.getFrameworkAnalysis);
  app.post("/api/ai-fallback-edits/:editId/apply", debugTargetController.applyAiFallbackEdit);
  app.post("/api/ai-fallback-edits/:editId/reject", debugTargetController.rejectAiFallbackEdit);
  app.post("/api/ai-fallback-edits/:editId/rollback", debugTargetController.rollbackAiFallbackEdit);
  app.post(
    "/api/debug-targets/:targetId/framework-analysis/refresh",
    debugTargetController.refreshFrameworkAnalysis
  );
  app.get("/api/framework-compatibility-matrix", debugTargetController.getCompatibilityMatrix);
}
