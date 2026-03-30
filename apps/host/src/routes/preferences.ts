import type { FastifyInstance } from "fastify";

import type { ProfileController } from "../modules/preferences/profile-controller.js";
import type { QuickPhraseController } from "../modules/preferences/quick-phrase-controller.js";

export async function registerPreferenceRoutes(
  app: FastifyInstance,
  quickPhraseController: QuickPhraseController,
  profileController: ProfileController
): Promise<void> {
  app.get("/api/preferences/profile", profileController.read);
  app.put("/api/preferences/profile", profileController.update);
  app.get("/api/preferences/quick-phrases", quickPhraseController.list);
  app.put("/api/preferences/quick-phrases", quickPhraseController.replace);
}
