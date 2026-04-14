import type { FastifyInstance } from "fastify";

import type { SkillController } from "../modules/skills/skill-controller.js";

export async function registerSkillRoutes(
  app: FastifyInstance,
  skillController: SkillController
): Promise<void> {
  app.get("/api/skills/overview", skillController.getOverview);
  app.post("/api/skills", skillController.add);
  app.post("/api/skills/import", skillController.import);
  app.post("/api/skills/sync", skillController.sync);
}
