import Fastify from "fastify";

import type { HostConfig } from "../config/env.js";
import { createAuthGuard } from "../middlewares/auth-guard.js";
import { AuthController } from "../modules/auth/auth-controller.js";
import { AuthService } from "../modules/auth/auth-service.js";
import { BootstrapController } from "../modules/bootstrap/bootstrap-controller.js";
import { BootstrapService } from "../modules/bootstrap/bootstrap-service.js";
import { ClientController } from "../modules/client/client-controller.js";
import { ClientService } from "../modules/client/client-service.js";
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
import { SessionChangedFileService } from "../modules/sessions/session-changed-file-service.js";
import { SessionHistoryService } from "../modules/sessions/session-history-service.js";
import { SessionLiveRuntimeService } from "../modules/sessions/session-live-runtime-service.js";
import { SessionMessageAttachmentService } from "../modules/sessions/session-message-attachment-service.js";
import { CommandTemplateService } from "../modules/terminal/command-template-service.js";
import { TerminalController } from "../modules/terminal/terminal-controller.js";
import { TerminalService } from "../modules/terminal/terminal-service.js";
import { WorkbenchController } from "../modules/workbench/workbench-controller.js";
import { WorkbenchService } from "../modules/workbench/workbench-service.js";
import { WorkspacePanelSnapshotService } from "../modules/workbench/workspace-panel-snapshot-service.js";
import { WorkspaceController } from "../modules/workspace/workspace-controller.js";
import { WorkspaceService } from "../modules/workspace/workspace-service.js";
import { registerAuthRoutes } from "../routes/auth.js";
import { registerClientRoutes } from "../routes/client.js";
import { registerFileRoutes } from "../routes/files.js";
import { registerGitRoutes } from "../routes/git.js";
import { registerProviderRoutes } from "../routes/providers.js";
import { registerPublicRoutes } from "../routes/public.js";
import { registerSessionContextRoutes } from "../routes/session-contexts.js";
import { registerSessionRoutes } from "../routes/sessions.js";
import { registerTerminalRoutes } from "../routes/terminals.js";
import { registerWorkbenchRoutes } from "../routes/workbench.js";
import { registerWorkspaceRoutes } from "../routes/workspaces.js";
import { setErrorHandler } from "../shared/http/error-handler.js";
import { AuthTokenRepository } from "../storage/repositories/auth-token-repository.js";
import { AuthUserRepository } from "../storage/repositories/auth-user-repository.js";
import { BootstrapStateRepository } from "../storage/repositories/bootstrap-state-repository.js";
import { CommitRuleProfileRepository } from "../storage/repositories/commit-rule-profile-repository.js";
import { FileContextBindingRepository } from "../storage/repositories/file-context-binding-repository.js";
import { RecentFileRepository } from "../storage/repositories/recent-file-repository.js";
import { SessionBindingRepository } from "../storage/repositories/session-binding-repository.js";
import { SessionChangedFileRepository } from "../storage/repositories/session-changed-file-repository.js";
import { SessionIndexRepository } from "../storage/repositories/session-index-repository.js";
import { SessionMessageAttachmentRepository } from "../storage/repositories/session-message-attachment-repository.js";
import { SessionSendQueueRepository } from "../storage/repositories/session-send-queue-repository.js";
import { SessionStateRepository } from "../storage/repositories/session-state-repository.js";
import { SessionStatusSnapshotRepository } from "../storage/repositories/session-status-snapshot-repository.js";
import { TerminalCommandTemplateRepository } from "../storage/repositories/terminal-command-template-repository.js";
import { TerminalInstanceRepository } from "../storage/repositories/terminal-instance-repository.js";
import { TerminalRuntimeSessionRepository } from "../storage/repositories/terminal-runtime-session-repository.js";
import { WorkspaceRepository } from "../storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../storage/sqlite/client.js";
import { TerminalWsHub } from "../ws/terminal-ws-hub.js";
import { WorkbenchWsHub } from "../ws/workbench-ws-hub.js";
import { createWsServer } from "../ws/ws-server.js";
import { WsAuthGuard } from "../ws/ws-auth-guard.js";
import { registerStaticWebRoutes } from "./static-web.js";

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
    sessionChangedFileRepository: new SessionChangedFileRepository(database.db),
    sessionIndexRepository: new SessionIndexRepository(database.db),
    sessionMessageAttachmentRepository: new SessionMessageAttachmentRepository(database.db),
    sessionSendQueueRepository: new SessionSendQueueRepository(database.db),
    sessionStateRepository: new SessionStateRepository(database.db),
    sessionStatusSnapshotRepository: new SessionStatusSnapshotRepository(database.db),
    terminalInstanceRepository: new TerminalInstanceRepository(database.db),
    terminalRuntimeSessionRepository: new TerminalRuntimeSessionRepository(database.db),
    terminalCommandTemplateRepository: new TerminalCommandTemplateRepository(database.db)
  };

  const bootstrapService = new BootstrapService(
    database.db,
    repositories.bootstrapStateRepository,
    repositories.authUserRepository
  );
  const clientService = new ClientService(config);
  const authService = new AuthService(
    repositories.bootstrapStateRepository,
    repositories.authUserRepository,
    repositories.authTokenRepository,
    config
  );
  const gitCommandRunner = new GitCommandRunner();
  const workspaceService = new WorkspaceService(repositories.workspaceRepository, gitCommandRunner);
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
  const sessionMessageAttachmentService = new SessionMessageAttachmentService(
    repositories.sessionMessageAttachmentRepository,
    config
  );
  const sessionChangedFileService = new SessionChangedFileService(
    repositories.sessionChangedFileRepository
  );
  const sessionHistoryService = new SessionHistoryService(
    database.db,
    repositories.workspaceRepository,
    repositories.sessionBindingRepository,
    sessionChangedFileService,
    repositories.sessionIndexRepository,
    sessionMessageAttachmentService,
    repositories.sessionStateRepository,
    repositories.sessionStatusSnapshotRepository,
    config
  );
  const sessionLiveRuntimeService = new SessionLiveRuntimeService(
    sessionHistoryService,
    sessionMessageAttachmentService,
    workspaceService,
    sessionChangedFileService,
    repositories.sessionBindingRepository,
    repositories.authUserRepository,
    repositories.sessionSendQueueRepository,
    repositories.sessionIndexRepository,
    repositories.sessionStateRepository,
    repositories.sessionStatusSnapshotRepository,
    config
  );
  const workbenchService = new WorkbenchService(
    repositories.workspaceRepository,
    sessionHistoryService
  );
  const fileContextService = new FileContextService(
    sessionHistoryService,
    repositories.fileContextBindingRepository
  );
  const terminalService = new TerminalService(
    database.db,
    repositories.terminalInstanceRepository,
    repositories.terminalRuntimeSessionRepository,
    workspaceService,
    config.terminalIdleTimeoutSeconds
  );
  const commandTemplateService = new CommandTemplateService(
    database.db,
    repositories.terminalCommandTemplateRepository,
    workspaceService,
    terminalService
  );
  const workspacePanelSnapshotService = new WorkspacePanelSnapshotService(
    fileTreeService,
    gitReadService,
    terminalService,
    commandTemplateService,
    workspaceService
  );

  const bootstrapController = new BootstrapController(bootstrapService);
  const clientController = new ClientController(clientService);
  const authController = new AuthController(authService);
  const workspaceController = new WorkspaceController(workspaceService);
  const workbenchController = new WorkbenchController(workbenchService);
  const sessionController = new SessionController(
    sessionHistoryService,
    sessionLiveRuntimeService
  );
  const providerController = new ProviderController(
    sessionHistoryService,
    sessionLiveRuntimeService,
    config
  );
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
    sessionHistoryService,
    sessionLiveRuntimeService,
    new TerminalWsHub(terminalService),
    new WorkbenchWsHub(workbenchService, workspacePanelSnapshotService)
  );

  app.addHook("onRequest", async (request, reply) => {
    applyCorsHeaders(request.headers.origin, reply);

    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return reply;
    }
  });
  app.addHook("onRequest", createAuthGuard(authService));
  app.setErrorHandler(setErrorHandler);

  void registerPublicRoutes(app, bootstrapController);
  void registerAuthRoutes(app, authController);
  void registerClientRoutes(app, clientController);
  void registerWorkspaceRoutes(app, workspaceController);
  void registerWorkbenchRoutes(app, workbenchController);
  void registerSessionRoutes(app, sessionController);
  void registerFileRoutes(app, fileController);
  void registerSessionContextRoutes(app, fileContextController);
  void registerTerminalRoutes(app, terminalController);
  void registerProviderRoutes(app, providerController);
  void registerGitRoutes(app, gitController);

  if (config.webUiDir) {
    registerStaticWebRoutes(app, config.webUiDir);
  }

  app.addHook("onClose", async () => {
    await terminalService.dispose();
    await sessionLiveRuntimeService.dispose();
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
        clientService,
        authService,
        workspaceService,
        workbenchService,
        workspacePanelSnapshotService,
        fileTreeService,
        fileSearchService,
        fileContentService,
        filePreviewService,
        fileContextService,
        recentFileService,
        gitReadService,
        gitWriteService,
        commitOrchestrator,
        sessionHistoryService,
        sessionChangedFileService,
        sessionMessageAttachmentService,
        sessionLiveRuntimeService,
        terminalService,
        commandTemplateService
      }
    },
    startWs: () => wsHandle
  };
}

function applyCorsHeaders(origin: string | undefined, reply: {
  header: (name: string, value: string) => unknown;
}): void {
  const allowedOrigin = resolveAllowedCorsOrigin(origin);

  if (!allowedOrigin) {
    return;
  }

  reply.header("Access-Control-Allow-Origin", allowedOrigin);
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Credentials", "true");
  reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
}

function resolveAllowedCorsOrigin(origin: string | undefined): string | null {
  if (!origin) {
    return null;
  }

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    const protocol = parsed.protocol.toLowerCase();

    // Tauri 在 macOS/Linux 默认使用 tauri://localhost，
    // Windows/Android 则会落到 http(s)://tauri.localhost。
    // 桌面壳不在这里放行，打包后的 fetch 会被浏览器 CORS 直接拦掉。
    if (protocol === "tauri:" && hostname === "localhost") {
      return origin;
    }

    if (
      (protocol === "http:" || protocol === "https:") &&
      (hostname === "127.0.0.1" ||
        hostname === "localhost" ||
        hostname === "::1" ||
        hostname === "tauri.localhost")
    ) {
      return origin;
    }

    return null;
  } catch {
    return null;
  }
}
