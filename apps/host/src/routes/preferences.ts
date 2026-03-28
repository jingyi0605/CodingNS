import type { FastifyInstance } from "fastify";

import type { QuickPhraseController } from "../modules/preferences/quick-phrase-controller.js";

export async function registerPreferenceRoutes(
  app: FastifyInstance,
  quickPhraseController: QuickPhraseController
): Promise<void> {
  app.get("/api/preferences/quick-phrases", quickPhraseController.list);
  app.put("/api/preferences/quick-phrases", quickPhraseController.replace);
}
