import type { FastifyInstance } from "fastify";

import type { AuthController } from "../modules/auth/auth-controller.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
  authController: AuthController
): Promise<void> {
  app.post("/api/auth/login", authController.login);
  app.post("/api/auth/refresh", authController.refresh);
  app.post("/api/auth/logout", authController.logout);
  app.get("/api/auth/devices", authController.getDevices);
  app.post("/api/auth/devices/current/primary", authController.updateCurrentDevicePrimary);
  app.post("/api/auth/devices/logout-others", authController.logoutOtherDevices);
  app.post("/api/auth/devices/:deviceId/logout", authController.logoutDevice);
  app.get("/api/admin/users", authController.listUsers);
  app.post("/api/admin/users", authController.createUser);
  app.patch("/api/admin/users/:userId/status", authController.updateUserStatus);
}
