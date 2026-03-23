import Fastify from "fastify";

import type { HostConfig } from "../config/env.js";
import { createAuthGuard } from "../middlewares/auth-guard.js";
import { AuthController } from "../modules/auth/auth-controller.js";
import { AuthService } from "../modules/auth/auth-service.js";
import { BootstrapController } from "../modules/bootstrap/bootstrap-controller.js";
import { BootstrapService } from "../modules/bootstrap/bootstrap-service.js";
import {
  ProviderMessageGateway,
  type ProviderReaderRegistry
} from "../modules/provider/provider-message-gateway.js";
import { SessionIndexController } from "../modules/session-index/session-index-controller.js";
import { SessionIndexService } from "../modules/session-index/session-index-service.js";
import { SessionReadService } from "../modules/sessions/session-read-service.js";
import { WorkspaceController } from "../modules/workspace/workspace-controller.js";
import { WorkspaceService } from "../modules/workspace/workspace-service.js";
import { registerAuthRoutes } from "../routes/auth.js";
import { registerPublicRoutes } from "../routes/public.js";
import { registerSessionRoutes } from "../routes/sessions.js";
import { registerWorkspaceRoutes } from "../routes/workspaces.js";
import { setErrorHandler } from "../shared/http/error-handler.js";
import { AuthTokenRepository } from "../storage/repositories/auth-token-repository.js";
import { AuthUserRepository } from "../storage/repositories/auth-user-repository.js";
import { BootstrapStateRepository } from "../storage/repositories/bootstrap-state-repository.js";
import { SessionIndexRepository } from "../storage/repositories/session-index-repository.js";
import { SessionStateRepository } from "../storage/repositories/session-state-repository.js";
import { WorkspaceRepository } from "../storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../storage/sqlite/client.js";
import { createWsServer } from "../ws/ws-server.js";
import { WsAuthGuard } from "../ws/ws-auth-guard.js";

export interface CreateServerOverrides {
  providerReaders?: ProviderReaderRegistry;
}

export function createServer(config: HostConfig, overrides: CreateServerOverrides = {}) {
  const app = Fastify({
    logger: false
  });
  let wsHandle: ReturnType<typeof createWsServer> | null = null;

  const database = createDatabaseClient(config.databasePath);
  const repositories = {
    bootstrapStateRepository: new BootstrapStateRepository(database.db),
    authUserRepository: new AuthUserRepository(database.db),
    authTokenRepository: new AuthTokenRepository(database.db),
    workspaceRepository: new WorkspaceRepository(database.db),
    sessionIndexRepository: new SessionIndexRepository(database.db),
    sessionStateRepository: new SessionStateRepository(database.db)
  };

  const providerMessageGateway = new ProviderMessageGateway(overrides.providerReaders);
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
  const sessionIndexService = new SessionIndexService(repositories.sessionIndexRepository);
  const sessionReadService = new SessionReadService(
    repositories.sessionIndexRepository,
    repositories.sessionStateRepository,
    providerMessageGateway
  );

  const bootstrapController = new BootstrapController(bootstrapService);
  const authController = new AuthController(authService);
  const workspaceController = new WorkspaceController(workspaceService);
  const sessionIndexController = new SessionIndexController(sessionIndexService);

  app.addHook("onRequest", createAuthGuard(authService));
  app.setErrorHandler(setErrorHandler);

  void registerPublicRoutes(app, bootstrapController);
  void registerAuthRoutes(app, authController);
  void registerWorkspaceRoutes(app, workspaceController);
  void registerSessionRoutes(app, sessionIndexController, sessionReadService);

  app.addHook("onClose", async () => {
    if (wsHandle) {
      await wsHandle.close();
      wsHandle = null;
    }

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
        sessionIndexService,
        sessionReadService,
        providerMessageGateway
      }
    },
    startWs: () => {
      if (!wsHandle) {
        wsHandle = createWsServer(app.server, new WsAuthGuard(authService));
      }

      return wsHandle;
    }
  };
}
