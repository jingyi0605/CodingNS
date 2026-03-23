import Fastify from "fastify";

import type { HostConfig } from "../config/env.js";
import { createAuthGuard } from "../middlewares/auth-guard.js";
import { AuthController } from "../modules/auth/auth-controller.js";
import { AuthService } from "../modules/auth/auth-service.js";
import { BootstrapController } from "../modules/bootstrap/bootstrap-controller.js";
import { BootstrapService } from "../modules/bootstrap/bootstrap-service.js";
import { FileAccessGuard } from "../modules/file/file-access-guard.js";
import { FileContentService } from "../modules/file/file-content-service.js";
import { FileContextController } from "../modules/file/file-context-controller.js";
import { FileContextService } from "../modules/file/file-context-service.js";
import { FileController } from "../modules/file/file-controller.js";
import { FilePreviewService } from "../modules/file/file-preview-service.js";
import { FileSearchService } from "../modules/file/file-search-service.js";
import { FileTreeService } from "../modules/file/file-tree-service.js";
import { FileVersionChecker } from "../modules/file/file-version-checker.js";
import { RecentFileService } from "../modules/file/recent-file-service.js";
import { CommitDraftService } from "../modules/git/commit-draft-service.js";
import { CommitOrchestrator } from "../modules/git/commit-orchestrator.js";
import { CommitRuleEngine } from "../modules/git/commit-rule-engine.js";
import { GitCommandRunner } from "../modules/git/git-command-runner.js";
import { GitController } from "../modules/git/git-controller.js";
import { GitReadService } from "../modules/git/git-read-service.js";
import { GitRuleRepository } from "../modules/git/git-rule-repository.js";
import { GitWriteService } from "../modules/git/git-write-service.js";
import { WorkspaceRepoGuard } from "../modules/git/workspace-repo-guard.js";
import { ProviderController } from "../modules/provider/provider-controller.js";
import { SessionController } from "../modules/sessions/session-controller.js";
import { SessionRuntimeService } from "../modules/sessions/session-runtime-service.js";
import { CommandTemplateService } from "../modules/terminal/command-template-service.js";
import { TerminalController } from "../modules/terminal/terminal-controller.js";
import { TerminalService } from "../modules/terminal/terminal-service.js";
import { WorkspaceController } from "../modules/workspace/workspace-controller.js";
import { WorkspaceService } from "../modules/workspace/workspace-service.js";
import { registerAuthRoutes } from "../routes/auth.js";
import { registerFileRoutes } from "../routes/files.js";
import { registerGitRoutes } from "../routes/git.js";
import { registerProviderRoutes } from "../routes/providers.js";
import { registerPublicRoutes } from "../routes/public.js";
import { registerSessionContextRoutes } from "../routes/session-contexts.js";
import { registerSessionRoutes } from "../routes/sessions.js";
import { registerTerminalRoutes } from "../routes/terminals.js";
import { registerWorkspaceRoutes } from "../routes/workspaces.js";
import { setErrorHandler } from "../shared/http/error-handler.js";
import { AuthTokenRepository } from "../storage/repositories/auth-token-repository.js";
import { AuthUserRepository } from "../storage/repositories/auth-user-repository.js";
import { BootstrapStateRepository } from "../storage/repositories/bootstrap-state-repository.js";
import { CommitRuleProfileRepository } from "../storage/repositories/commit-rule-profile-repository.js";
import { FileContextBindingRepository } from "../storage/repositories/file-context-binding-repository.js";
import { RecentFileRepository } from "../storage/repositories/recent-file-repository.js";
import { SessionBindingRepository } from "../storage/repositories/session-binding-repository.js";
import { SessionIndexRepository } from "../storage/repositories/session-index-repository.js";
import { SessionStatusSnapshotRepository } from "../storage/repositories/session-status-snapshot-repository.js";
import { TerminalCommandTemplateRepository } from "../storage/repositories/terminal-command-template-repository.js";
import { TerminalInstanceRepository } from "../storage/repositories/terminal-instance-repository.js";
import { WorkspaceRepository } from "../storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../storage/sqlite/client.js";
import { TerminalWsHub } from "../ws/terminal-ws-hub.js";
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
    commitRuleProfileRepository: new CommitRuleProfileRepository(database.db),
    recentFileRepository: new RecentFileRepository(database.db),
    fileContextBindingRepository: new FileContextBindingRepository(database.db),
    sessionBindingRepository: new SessionBindingRepository(database.db),
    sessionIndexRepository: new SessionIndexRepository(database.db),
    sessionStatusSnapshotRepository: new SessionStatusSnapshotRepository(database.db),
    terminalInstanceRepository: new TerminalInstanceRepository(database.db),
    terminalCommandTemplateRepository: new TerminalCommandTemplateRepository(database.db)
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
  const fileAccessGuard = new FileAccessGuard(workspaceService, app.log);
  const recentFileService = new RecentFileService(repositories.recentFileRepository);
  const fileVersionChecker = new FileVersionChecker();
  const fileTreeService = new FileTreeService(fileAccessGuard);
  const fileSearchService = new FileSearchService(fileAccessGuard);
  const fileContentService = new FileContentService(
    fileAccessGuard,
    recentFileService,
    repositories.fileContextBindingRepository,
    fileVersionChecker
  );
  const filePreviewService = new FilePreviewService(fileAccessGuard, fileContentService);
  const gitCommandRunner = new GitCommandRunner();
  const workspaceRepoGuard = new WorkspaceRepoGuard(workspaceService, gitCommandRunner);
  const gitReadService = new GitReadService(gitCommandRunner, workspaceRepoGuard);
  const gitWriteService = new GitWriteService(gitCommandRunner, workspaceRepoGuard, gitReadService);
  const gitRuleRepository = new GitRuleRepository(repositories.commitRuleProfileRepository);
  const commitRuleEngine = new CommitRuleEngine();
  const commitDraftService = new CommitDraftService(gitReadService);
  const commitOrchestrator = new CommitOrchestrator(
    gitRuleRepository,
    commitRuleEngine,
    commitDraftService,
    gitWriteService
  );
  const sessionRuntimeService = new SessionRuntimeService(
    database.db,
    repositories.workspaceRepository,
    repositories.sessionBindingRepository,
    repositories.sessionIndexRepository,
    repositories.sessionStatusSnapshotRepository,
    config
  );
  const fileContextService = new FileContextService(
    sessionRuntimeService,
    repositories.fileContextBindingRepository
  );
  const terminalService = new TerminalService(
    database.db,
    repositories.terminalInstanceRepository,
    workspaceService,
    config.terminalIdleTimeoutSeconds
  );
  const commandTemplateService = new CommandTemplateService(
    database.db,
    repositories.terminalCommandTemplateRepository,
    workspaceService,
    terminalService
  );

  const bootstrapController = new BootstrapController(bootstrapService);
  const authController = new AuthController(authService);
  const workspaceController = new WorkspaceController(workspaceService);
  const sessionController = new SessionController(sessionRuntimeService);
  const providerController = new ProviderController(sessionRuntimeService);
  const fileController = new FileController(
    fileTreeService,
    fileContentService,
    fileSearchService,
    recentFileService,
    filePreviewService
  );
  const fileContextController = new FileContextController(
    fileContentService,
    fileContextService
  );
  const gitController = new GitController(gitReadService, gitWriteService, commitOrchestrator);
  const terminalController = new TerminalController(terminalService, commandTemplateService);
  const wsHandle = createWsServer(
    app.server,
    new WsAuthGuard(authService),
    sessionRuntimeService,
    new TerminalWsHub(terminalService)
  );

  app.addHook("onRequest", createAuthGuard(authService));
  app.setErrorHandler(setErrorHandler);

  void registerPublicRoutes(app, bootstrapController);
  void registerAuthRoutes(app, authController);
  void registerWorkspaceRoutes(app, workspaceController);
  void registerSessionRoutes(app, sessionController);
  void registerFileRoutes(app, fileController);
  void registerSessionContextRoutes(app, fileContextController);
  void registerTerminalRoutes(app, terminalController);
  void registerProviderRoutes(app, providerController);
  void registerGitRoutes(app, gitController);

  app.addHook("onClose", async () => {
    await terminalService.dispose();
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
        fileTreeService,
        fileSearchService,
        fileContentService,
        filePreviewService,
        fileContextService,
        recentFileService,
        gitReadService,
        gitWriteService,
        commitOrchestrator,
        sessionRuntimeService,
        terminalService,
        commandTemplateService
      }
    },
    startWs: () => wsHandle
  };
}
