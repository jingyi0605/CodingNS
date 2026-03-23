import Fastify from "fastify";

import type { HostConfig } from "../config/env.js";
import { createAuthGuard } from "../middlewares/auth-guard.js";
import { AuthController } from "../modules/auth/auth-controller.js";
import { AuthService } from "../modules/auth/auth-service.js";
import { BootstrapController } from "../modules/bootstrap/bootstrap-controller.js";
import { BootstrapService } from "../modules/bootstrap/bootstrap-service.js";
import { ProviderController } from "../modules/provider/provider-controller.js";
import { SessionController } from "../modules/sessions/session-controller.js";
import { SessionRuntimeService } from "../modules/sessions/session-runtime-service.js";
import { WorkspaceController } from "../modules/workspace/workspace-controller.js";
import { WorkspaceService } from "../modules/workspace/workspace-service.js";
import { registerAuthRoutes } from "../routes/auth.js";
import { registerProviderRoutes } from "../routes/providers.js";
import { registerPublicRoutes } from "../routes/public.js";
import { registerSessionRoutes } from "../routes/sessions.js";
import { registerWorkspaceRoutes } from "../routes/workspaces.js";
import { setErrorHandler } from "../shared/http/error-handler.js";
import { AuthTokenRepository } from "../storage/repositories/auth-token-repository.js";
import { AuthUserRepository } from "../storage/repositories/auth-user-repository.js";
import { BootstrapStateRepository } from "../storage/repositories/bootstrap-state-repository.js";
import { SessionBindingRepository } from "../storage/repositories/session-binding-repository.js";
import { SessionIndexRepository } from "../storage/repositories/session-index-repository.js";
import { SessionStatusSnapshotRepository } from "../storage/repositories/session-status-snapshot-repository.js";
import { WorkspaceRepository } from "../storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../storage/sqlite/client.js";
import { createWsServer } from "../ws/ws-server.js";
import { WsAuthGuard } from "../ws/ws-auth-guard.js";
export function createServer(config: HostConfig) {
  const app = Fastify({
    logger: false
  });

  const database = createDatabaseClient(config.databasePath);
  const repositories = {
    bootstrapStateRepository: new BootstrapStateRepository(database.db),
    authUserRepository: new AuthUserRepository(database.db),
    authTokenRepository: new AuthTokenRepository(database.db),
    workspaceRepository: new WorkspaceRepository(database.db),
    sessionBindingRepository: new SessionBindingRepository(database.db),
    sessionIndexRepository: new SessionIndexRepository(database.db),
    sessionStatusSnapshotRepository: new SessionStatusSnapshotRepository(database.db)
  };

  const bootstrapService = new BootstrapService(
    database.db,
    repositories.bootstrapStateRepository,
    repositories.authUserRepository
  );
  const authService = new AuthService(
    repositories.bootstrapStateRepository,
    repositories.authUserRepository,
    repositories.authTokenRepository,
    config
  );
  const workspaceService = new WorkspaceService(repositories.workspaceRepository);
  const sessionRuntimeService = new SessionRuntimeService(
    database.db,
    repositories.workspaceRepository,
    repositories.sessionBindingRepository,
    repositories.sessionIndexRepository,
    repositories.sessionStatusSnapshotRepository,
    config
  );

  const bootstrapController = new BootstrapController(bootstrapService);
  const authController = new AuthController(authService);
  const workspaceController = new WorkspaceController(workspaceService);
  const sessionController = new SessionController(sessionRuntimeService);
  const providerController = new ProviderController(sessionRuntimeService);
  const wsHandle = createWsServer(app.server, new WsAuthGuard(authService), sessionRuntimeService);

  app.addHook("onRequest", createAuthGuard(authService));
  app.setErrorHandler(setErrorHandler);

  void registerPublicRoutes(app, bootstrapController);
  void registerAuthRoutes(app, authController);
  void registerWorkspaceRoutes(app, workspaceController);
  void registerSessionRoutes(app, sessionController);
  void registerProviderRoutes(app, providerController);

  app.addHook("onClose", async () => {
    await wsHandle.close();
    database.close();
  });

  return {
    app,
    services: {
      config,
      database,
      repositories,
      modules: {
        bootstrapService,
        authService,
        workspaceService,
        sessionRuntimeService
      }
    },
    startWs: () => wsHandle
  };
}
