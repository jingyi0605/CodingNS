import type { AuthContext } from "../modules/auth/auth-service.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
    requestDiagnosticsId?: number;
  }
}

export {};
