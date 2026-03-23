import type { FastifyInstance } from "fastify";

import type { AuthController } from "../modules/auth/auth-controller.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
  authController: AuthController
): Promise<void> {
  app.post("/api/auth/login", authController.login);
  app.post("/api/auth/refresh", authController.refresh);
  app.post("/api/auth/logout", authController.logout);
}
