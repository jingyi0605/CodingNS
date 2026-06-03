import type { FastifyInstance } from "fastify";

import type { AffairsLibraryController } from "../modules/workspace/affairs-library-controller.js";

export async function registerAffairsRoutes(
  app: FastifyInstance,
  affairsLibraryController: AffairsLibraryController
): Promise<void> {
  app.get("/api/affairs/library-binding", affairsLibraryController.getGlobalBinding);
  app.put("/api/affairs/library-binding", affairsLibraryController.saveGlobalBinding);
  app.put("/api/affairs/library-enabled", affairsLibraryController.setGlobalEnabled);
  app.put("/api/affairs/library-favorites", affairsLibraryController.updateGlobalFavorites);
}
