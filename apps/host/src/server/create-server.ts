import path from "node:path";

import Fastify from "fastify";

import type { HostConfig } from "../config/env.js";
import { disposeSharedOpenCodeSystemProbeHelperClient } from "../config/opencode-system-probe-helper-client.js";
import { createAuthGuard } from "../middlewares/auth-guard.js";
import { AuthController } from "../modules/auth/auth-controller.js";
import { AuthService } from "../modules/auth/auth-service.js";
import { AssistantCapabilityController } from "../modules/assistant-capability/assistant-capability-controller.js";
import { AssistantCapabilityService } from "../modules/assistant-capability/assistant-capability-service.js";
import { BootstrapController } from "../modules/bootstrap/bootstrap-controller.js";
import { BootstrapService } from "../modules/bootstrap/bootstrap-service.js";
import { ButlerControlTimerScheduler } from "../modules/butler/butler-control-timer-scheduler.js";
import { ButlerControlTimerService } from "../modules/butler/butler-control-timer-service.js";
import { ButlerControlSessionService } from "../modules/butler/butler-control-session-service.js";
import { ButlerControlActionService } from "../modules/butler/butler-control-action-service.js";
import { ButlerController } from "../modules/butler/butler-controller.js";
import { ButlerActionContextService } from "../modules/butler/butler-action-context-service.js";
import { ButlerContextAggregator } from "../modules/butler/context-aggregator.js";
import { ButlerAuthService } from "../modules/butler/butler-auth-service.js";
import { ButlerFollowUpEvaluationInstructionAdapter } from "../modules/butler/butler-follow-up-evaluation-instruction-adapter.js";
import { ButlerFollowUpScheduler } from "../modules/butler/butler-follow-up-scheduler.js";
import { ButlerFollowUpService } from "../modules/butler/butler-follow-up-service.js";
import { ButlerInboxAnalysisService } from "../modules/butler/butler-inbox-analysis-service.js";
import { ButlerInboxService } from "../modules/butler/butler-inbox-service.js";
import { ButlerNotificationService } from "../modules/butler/butler-notification-service.js";
import { ButlerProfileService } from "../modules/butler/butler-profile-service.js";
import { ButlerProjectService } from "../modules/butler/butler-project-service.js";
import { ButlerSessionService } from "../modules/butler/butler-session-service.js";
import { ButlerSessionSummaryService } from "../modules/butler/butler-session-summary-service.js";
import { InstructionAdapter } from "../modules/butler/instruction-adapter.js";
import { PatrolPlanService } from "../modules/butler/patrol-plan-service.js";
import { PatrolExecutionService } from "../modules/butler/patrol-execution-service.js";
import {
  ProviderAdapterRegistry,
  RuntimePatrolProviderAdapter
} from "../modules/butler/provider-adapter-registry.js";
import { PatrolRunService } from "../modules/butler/patrol-run-service.js";
import { PatrolScheduler } from "../modules/butler/patrol-scheduler.js";
import { ProjectMemoryService } from "../modules/butler/project-memory-service.js";
import { SessionSummaryInstructionAdapter } from "../modules/butler/session-summary-instruction-adapter.js";
import { SessionSummaryScheduler } from "../modules/butler/session-summary-scheduler.js";
import { VerificationRunService } from "../modules/butler/verification-run-service.js";
import { ClientController } from "../modules/client/client-controller.js";
import { ClientService } from "../modules/client/client-service.js";
import { NpmGlobalPackageService } from "../modules/client/npm-global-package-service.js";
import { ServiceUpdateTaskService } from "../modules/client/service-update-task-service.js";
import { DebugTargetController } from "../modules/debug-target/debug-target-controller.js";
import { DebugRuntimeReconciliationScheduler } from "../modules/debug-target/debug-runtime-reconciliation-scheduler.js";
import { DebugTargetService } from "../modules/debug-target/debug-target-service.js";
import { FileAccessGuard } from "../modules/file/file-access-guard.js";
import { FileContentService } from "../modules/file/file-content-service.js";
import { FileContextController } from "../modules/file/file-context-controller.js";
import { FileContextService } from "../modules/file/file-context-service.js";
import { FileController } from "../modules/file/file-controller.js";
import { FilePreviewLinkService } from "../modules/file/file-preview-link-service.js";
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
import { GitRemoteCredentialService } from "../modules/git/git-remote-credential-service.js";
import { GitReadService } from "../modules/git/git-read-service.js";
import { GitRuleRepository } from "../modules/git/git-rule-repository.js";
import { GitWriteService } from "../modules/git/git-write-service.js";
import { WorkspaceRepoGuard } from "../modules/git/workspace-repo-guard.js";
import { ProfileController } from "../modules/preferences/profile-controller.js";
import { PreferenceProfileService } from "../modules/preferences/profile-service.js";
import { QuickPhraseController } from "../modules/preferences/quick-phrase-controller.js";
import { QuickPhraseService } from "../modules/preferences/quick-phrase-service.js";
import { CcSwitchAdapter } from "../modules/model-switch/cc-switch-adapter.js";
import { ModelSwitchController } from "../modules/model-switch/model-switch-controller.js";
import { ModelSwitchService } from "../modules/model-switch/model-switch-service.js";
import { ProviderController } from "../modules/provider/provider-controller.js";
import { disposeSharedProviderDiscoveryHelperClient } from "../modules/provider/provider-discovery-helper-client.js";
import { SkillController } from "../modules/skills/skill-controller.js";
import { syncBuiltinSkillsOnStartup } from "../modules/skills/builtin-skill-service.js";
import { SkillManagerService } from "../modules/skills/skill-manager-service.js";
import { createDefaultSkillTargetAdapters } from "../modules/skills/skill-target-adapter.js";
import { TailscaleManager } from "../modules/tailscale/tailscale-manager.js";
import { TailscaleController } from "../modules/tailscale/tailscale-controller.js";
import { TailscaleHelperClient } from "../modules/tailscale/tailscale-helper-client.js";
import { TailscaleService } from "../modules/tailscale/tailscale-service.js";
import { SessionController } from "../modules/sessions/session-controller.js";
import { SessionChangedFileService } from "../modules/sessions/session-changed-file-service.js";
import { SessionActivityAuthorityService } from "../modules/sessions/session-activity-authority-service.js";
import { SessionHistoryService } from "../modules/sessions/session-history-service.js";
import { SessionLiveRuntimeService } from "../modules/sessions/session-live-runtime-service.js";
import { SessionMessageAttachmentService } from "../modules/sessions/session-message-attachment-service.js";
import { EventLoopMonitor } from "../modules/tasks/event-loop-monitor.js";
import { ObservabilityController } from "../modules/tasks/observability-controller.js";
import { RuntimeObservabilityService } from "../modules/tasks/observability-service.js";
import { SchedulerMetrics } from "../modules/tasks/scheduler-metrics.js";
import { TaskActivityLog } from "../modules/tasks/task-activity-log.js";
import { createTaskManager } from "../modules/tasks/task-manager.js";
import { disposeSharedTaskHelperProcessClient } from "../modules/tasks/task-helper-client.js";
import { createHostTaskLaneExecutors } from "../modules/tasks/task-lane-executors.js";
import { CommandTemplateService } from "../modules/terminal/command-template-service.js";
import { TerminalController } from "../modules/terminal/terminal-controller.js";
import { TemplateReverseProxyService } from "../modules/terminal/template-reverse-proxy-service.js";
import { TerminalService } from "../modules/terminal/terminal-service.js";
import { WorkbenchController } from "../modules/workbench/workbench-controller.js";
import { WorkbenchService } from "../modules/workbench/workbench-service.js";
import { WorkspacePanelSnapshotService } from "../modules/workbench/workspace-panel-snapshot-service.js";
import { WorkspaceFileWatcher } from "../modules/workbench/workspace-file-watcher.js";
import { WorktreeController } from "../modules/worktree/worktree-controller.js";
import { WorktreeCleanupService } from "../modules/worktree/worktree-cleanup-service.js";
import { WorktreeMergeService } from "../modules/worktree/worktree-merge-service.js";
import { WorktreeManager } from "../modules/worktree/worktree-manager.js";
import { WorktreeSyncService } from "../modules/worktree/worktree-sync-service.js";
import { WorkspaceController } from "../modules/workspace/workspace-controller.js";
import { WorkspaceService } from "../modules/workspace/workspace-service.js";
import { registerAuthRoutes } from "../routes/auth.js";
import { registerAssistantCapabilityRoutes } from "../routes/assistant.js";
import { registerButlerRoutes } from "../routes/butler.js";
import { registerClientRoutes } from "../routes/client.js";
import { registerDebugTargetRoutes } from "../routes/debug-targets.js";
import { registerFileRoutes } from "../routes/files.js";
import { registerGitRoutes } from "../routes/git.js";
import { registerObservabilityRoutes } from "../routes/observability.js";
import { registerPreferenceRoutes } from "../routes/preferences.js";
import { registerProviderRoutes } from "../routes/providers.js";
import { registerPublicRoutes } from "../routes/public.js";
import { registerProxyRoutes } from "../routes/proxy.js";
import { registerSessionContextRoutes } from "../routes/session-contexts.js";
import { registerSessionRoutes } from "../routes/sessions.js";
import { registerSkillRoutes } from "../routes/skills.js";
import { registerTerminalRoutes } from "../routes/terminals.js";
import { registerWorkbenchRoutes } from "../routes/workbench.js";
import { registerWorktreeRoutes } from "../routes/worktrees.js";
import { registerWorkspaceRoutes } from "../routes/workspaces.js";
import { registerSystemRoutes } from "../routes/system.js";
import { DemoCleanupService, DemoOnlineTracker } from "../modules/demo/demo-cleanup-service.js";
import { setErrorHandler } from "../shared/http/error-handler.js";
import { startTerminalDebugEventLoopLagMonitor } from "../shared/utils/terminal-debug-log.js";
import { AuthTokenRepository } from "../storage/repositories/auth-token-repository.js";
import { AuthLoginAttemptRepository } from "../storage/repositories/auth-login-attempt-repository.js";
import { AuthUserRepository } from "../storage/repositories/auth-user-repository.js";
import { AiFallbackEditRepository } from "../storage/repositories/ai-fallback-edit-repository.js";
import { BootstrapStateRepository } from "../storage/repositories/bootstrap-state-repository.js";
import { ButlerControlTimerRepository } from "../storage/repositories/butler-control-timer-repository.js";
import { ButlerControlSessionRepository } from "../storage/repositories/butler-control-session-repository.js";
import { ButlerControlEventRepository } from "../storage/repositories/butler-control-event-repository.js";
import { ButlerFollowUpTaskRepository } from "../storage/repositories/butler-follow-up-task-repository.js";
import { ButlerInboxItemRepository } from "../storage/repositories/butler-inbox-item-repository.js";
import { ButlerNotificationArchiveRepository } from "../storage/repositories/butler-notification-archive-repository.js";
import { ButlerProfileRepository } from "../storage/repositories/butler-profile-repository.js";
import { ButlerProjectRepository } from "../storage/repositories/butler-project-repository.js";
import { ButlerSessionRepository } from "../storage/repositories/butler-session-repository.js";
import { ButlerSessionSummaryStateRepository } from "../storage/repositories/butler-session-summary-state-repository.js";
import { PatrolPlanRepository } from "../storage/repositories/patrol-plan-repository.js";
import { PatrolRunRepository } from "../storage/repositories/patrol-run-repository.js";
import { ProjectMemoryRepository } from "../storage/repositories/project-memory-repository.js";
import { VerificationRunRepository } from "../storage/repositories/verification-run-repository.js";
import { CommitRuleProfileRepository } from "../storage/repositories/commit-rule-profile-repository.js";
import { DebugRuntimeSessionRepository } from "../storage/repositories/debug-runtime-session-repository.js";
import { DebugServiceRepository } from "../storage/repositories/debug-service-repository.js";
import { DebugTargetRepository } from "../storage/repositories/debug-target-repository.js";
import { FileContextBindingRepository } from "../storage/repositories/file-context-binding-repository.js";
import { FrameworkAnalysisResultRepository } from "../storage/repositories/framework-analysis-result-repository.js";
import { GitRemoteCredentialRepository } from "../storage/repositories/git-remote-credential-repository.js";
import { ManagedSkillRepository } from "../storage/repositories/managed-skill-repository.js";
import { PortLeaseRepository } from "../storage/repositories/port-lease-repository.js";
import { RecentFileRepository } from "../storage/repositories/recent-file-repository.js";
import { RuntimeBindingRepository } from "../storage/repositories/runtime-binding-repository.js";
import { SessionBindingRepository } from "../storage/repositories/session-binding-repository.js";
import { SessionChangedFileRepository } from "../storage/repositories/session-changed-file-repository.js";
import { SessionForkRepository } from "../storage/repositories/session-fork-repository.js";
import { SessionIndexRepository } from "../storage/repositories/session-index-repository.js";
import { SessionCheckpointRepository } from "../storage/repositories/session-checkpoint-repository.js";
import { SessionMessageAttachmentRepository } from "../storage/repositories/session-message-attachment-repository.js";
import { SessionMessageOriginRepository } from "../storage/repositories/session-message-origin-repository.js";
import { SessionSendQueueRepository } from "../storage/repositories/session-send-queue-repository.js";
import { SessionStateRepository } from "../storage/repositories/session-state-repository.js";
import { SessionStatusSnapshotRepository } from "../storage/repositories/session-status-snapshot-repository.js";
import { InstanceTailscaleRepository } from "../storage/repositories/instance-tailscale-repository.js";
import { SkillTargetBindingRepository } from "../storage/repositories/skill-target-binding-repository.js";
import { TerminalCommandTemplateRepository } from "../storage/repositories/terminal-command-template-repository.js";
import { TerminalInstanceRepository } from "../storage/repositories/terminal-instance-repository.js";
import { TerminalLogFileRepository } from "../storage/repositories/terminal-log-file-repository.js";
import { TerminalLogSegmentRepository } from "../storage/repositories/terminal-log-segment-repository.js";
import { TerminalRuntimeSessionRepository } from "../storage/repositories/terminal-runtime-session-repository.js";
import { UserPreferenceProfileRepository } from "../storage/repositories/user-preference-profile-repository.js";
import { UserQuickPhrasePreferenceRepository } from "../storage/repositories/user-quick-phrase-preference-repository.js";
import { WorkspaceRepository } from "../storage/repositories/workspace-repository.js";
import { WorkspaceWorktreeRepository } from "../storage/repositories/workspace-worktree-repository.js";
import { WorkspaceNavigationStateRepository } from "../storage/repositories/workspace-navigation-state-repository.js";
import { createDatabaseClient } from "../storage/sqlite/client.js";
import { TerminalWsHub } from "../ws/terminal-ws-hub.js";
import { WorkbenchWsHub } from "../ws/workbench-ws-hub.js";
import { createWsServer } from "../ws/ws-server.js";
import { WsAuthGuard } from "../ws/ws-auth-guard.js";
import { registerStaticWebRoutes } from "./static-web.js";
import type { TerminalInstance } from "../types/domain.js";

export function createServer(config: HostConfig) {
  // Demo 模式下覆盖 token TTL 为 15 分钟
  const effectiveConfig: HostConfig = config.demoMode
    ? { ...config, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 900 }
    : config;

  const app = Fastify({
    logger: false
  });
  let shuttingDown = false;
  const stopTerminalDebugEventLoopLagMonitor = startTerminalDebugEventLoopLagMonitor();

  const database = createDatabaseClient(config.databasePath);
  const repositories = {
    bootstrapStateRepository: new BootstrapStateRepository(database.db),
    authUserRepository: new AuthUserRepository(database.db),
    authTokenRepository: new AuthTokenRepository(database.db),
    authLoginAttemptRepository: new AuthLoginAttemptRepository(database.db),
    workspaceRepository: new WorkspaceRepository(database.db),
    workspaceWorktreeRepository: new WorkspaceWorktreeRepository(database.db),
    workspaceNavigationStateRepository: new WorkspaceNavigationStateRepository(database.db),
    debugTargetRepository: new DebugTargetRepository(database.db),
    debugServiceRepository: new DebugServiceRepository(database.db),
    frameworkAnalysisResultRepository: new FrameworkAnalysisResultRepository(database.db),
    debugRuntimeSessionRepository: new DebugRuntimeSessionRepository(database.db),
    portLeaseRepository: new PortLeaseRepository(database.db),
    runtimeBindingRepository: new RuntimeBindingRepository(database.db),
    aiFallbackEditRepository: new AiFallbackEditRepository(database.db),
    butlerControlTimerRepository: new ButlerControlTimerRepository(database.db),
    butlerControlSessionRepository: new ButlerControlSessionRepository(database.db),
    butlerControlEventRepository: new ButlerControlEventRepository(database.db),
    butlerFollowUpTaskRepository: new ButlerFollowUpTaskRepository(database.db),
    butlerInboxItemRepository: new ButlerInboxItemRepository(database.db),
    butlerNotificationArchiveRepository: new ButlerNotificationArchiveRepository(database.db),
    butlerProfileRepository: new ButlerProfileRepository(database.db),
    butlerProjectRepository: new ButlerProjectRepository(database.db),
    butlerSessionRepository: new ButlerSessionRepository(database.db),
    butlerSessionSummaryStateRepository: new ButlerSessionSummaryStateRepository(database.db),
    projectMemoryRepository: new ProjectMemoryRepository(database.db),
    patrolPlanRepository: new PatrolPlanRepository(database.db),
    patrolRunRepository: new PatrolRunRepository(database.db),
    verificationRunRepository: new VerificationRunRepository(database.db),
    commitRuleProfileRepository: new CommitRuleProfileRepository(database.db),
    gitRemoteCredentialRepository: new GitRemoteCredentialRepository(database.db),
    managedSkillRepository: new ManagedSkillRepository(database.db),
    recentFileRepository: new RecentFileRepository(database.db),
    fileContextBindingRepository: new FileContextBindingRepository(database.db),
    sessionBindingRepository: new SessionBindingRepository(database.db),
    sessionChangedFileRepository: new SessionChangedFileRepository(database.db),
    sessionForkRepository: new SessionForkRepository(database.db),
    sessionCheckpointRepository: new SessionCheckpointRepository(database.db),
    sessionIndexRepository: new SessionIndexRepository(database.db),
    sessionMessageAttachmentRepository: new SessionMessageAttachmentRepository(database.db),
    sessionMessageOriginRepository: new SessionMessageOriginRepository(database.db),
    sessionSendQueueRepository: new SessionSendQueueRepository(database.db),
    sessionStateRepository: new SessionStateRepository(database.db),
    sessionStatusSnapshotRepository: new SessionStatusSnapshotRepository(database.db),
    instanceTailscaleRepository: new InstanceTailscaleRepository(database.db),
    skillTargetBindingRepository: new SkillTargetBindingRepository(database.db),
    userQuickPhrasePreferenceRepository: new UserQuickPhrasePreferenceRepository(database.db),
    userPreferenceProfileRepository: new UserPreferenceProfileRepository(database.db),
    terminalInstanceRepository: new TerminalInstanceRepository(database.db),
    terminalLogFileRepository: new TerminalLogFileRepository(database.db),
    terminalLogSegmentRepository: new TerminalLogSegmentRepository(database.db),
    terminalRuntimeSessionRepository: new TerminalRuntimeSessionRepository(database.db),
    terminalCommandTemplateRepository: new TerminalCommandTemplateRepository(database.db)
  };

  const bootstrapService = new BootstrapService(
    database.db,
    repositories.bootstrapStateRepository,
    repositories.authUserRepository,
    config.demoMode
  );
  // Demo 模式服务
  const demoCleanupService = config.demoMode
    ? new DemoCleanupService(database.db, config.databasePath)
    : undefined;
  const demoOnlineTracker = config.demoMode
    ? new DemoOnlineTracker()
    : undefined;
  const demoServices = (demoCleanupService && demoOnlineTracker)
    ? { cleanupService: demoCleanupService, onlineTracker: demoOnlineTracker }
    : undefined;

  const authService = new AuthService(
    repositories.bootstrapStateRepository,
    repositories.authUserRepository,
    repositories.authTokenRepository,
    repositories.authLoginAttemptRepository,
    effectiveConfig,
    demoServices
  );
  const butlerProfileService = new ButlerProfileService(
    repositories.butlerProfileRepository,
    repositories.butlerProjectRepository,
    path.dirname(config.databasePath)
  );
  const gitCommandRunner = new GitCommandRunner({
    preferHelperProcess: !process.env.VITEST
  });
  const schedulerMetrics = new SchedulerMetrics();
  const eventLoopMonitor = new EventLoopMonitor();
  let runtimeObservabilityService!: RuntimeObservabilityService;
  const taskActivityLog = new TaskActivityLog(() => runtimeObservabilityService.hasActiveSession());
  const taskManager = createTaskManager(taskActivityLog, createHostTaskLaneExecutors());
  const npmGlobalPackageService = new NpmGlobalPackageService(config);
  const serviceUpdateTaskService = new ServiceUpdateTaskService(
    taskManager,
    npmGlobalPackageService
  );
  const clientService = new ClientService(
    config,
    npmGlobalPackageService,
    serviceUpdateTaskService
  );
  const workspaceService = new WorkspaceService(
    repositories.workspaceRepository,
    gitCommandRunner,
    repositories.workspaceNavigationStateRepository,
    butlerProfileService,
    repositories.workspaceWorktreeRepository,
    taskManager
  );
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
  const filePreviewService = new FilePreviewService(
    fileAccessGuard,
    fileContentService,
    recentFileService
  );
  const filePreviewLinkService = new FilePreviewLinkService(
    fileAccessGuard,
    config.filePreviewTokenSecret
  );
  const workspaceRepoGuard = new WorkspaceRepoGuard(workspaceService, gitCommandRunner);
  const gitReadService = new GitReadService(gitCommandRunner, workspaceRepoGuard);
  const gitRemoteCredentialService = new GitRemoteCredentialService(
    repositories.gitRemoteCredentialRepository,
    config.gitCredentialSecret
  );
  const gitWriteService = new GitWriteService(
    gitCommandRunner,
    workspaceRepoGuard,
    gitReadService,
    gitRemoteCredentialService
  );
  const gitRuleRepository = new GitRuleRepository(repositories.commitRuleProfileRepository);
  const quickPhraseService = new QuickPhraseService(
    repositories.userQuickPhrasePreferenceRepository
  );
  const preferenceProfileService = new PreferenceProfileService(
    repositories.userPreferenceProfileRepository
  );
  const tailscaleHelperClient = new TailscaleHelperClient();
  const tailscaleManager = new TailscaleManager(
    repositories.bootstrapStateRepository,
    repositories.instanceTailscaleRepository,
    tailscaleHelperClient,
    {
      commandPath: config.tailscaleCliPath,
      webUiPort: config.webUiPort
    }
  );
  const tailscaleService = new TailscaleService(
    database.db,
    repositories.instanceTailscaleRepository,
    tailscaleManager,
    {
      databasePath: config.databasePath
    }
  );
  const modelSwitchService = new ModelSwitchService(
    new CcSwitchAdapter({
      commandPath: config.ccSwitchCliPath,
      dbPath: config.ccSwitchDbPath
    })
  );
  const skillManagerService = new SkillManagerService(
    repositories.managedSkillRepository,
    repositories.skillTargetBindingRepository,
    createDefaultSkillTargetAdapters(config),
    {
      ssotRootDir: path.join(path.dirname(config.databasePath), "skills")
    }
  );
  for (const result of syncBuiltinSkillsOnStartup(skillManagerService)) {
    if (result.ok) {
      console.info(
        `[host] 已同步内置 Skill ${result.directoryName} -> ${result.targetCli.join(",")}`
      );
      continue;
    }

    console.warn(
      `[host] 同步内置 Skill 失败 ${result.directoryName}: ${result.errorDetail ?? "unknown error"}`
    );
  }
  const commitRuleEngine = new CommitRuleEngine();
  const commitDraftService = new CommitDraftService(gitReadService);
  const commitOrchestrator = new CommitOrchestrator(
    gitRuleRepository,
    commitRuleEngine,
    commitDraftService,
    gitWriteService,
    repositories.aiFallbackEditRepository
  );
  const sessionMessageAttachmentService = new SessionMessageAttachmentService(
    repositories.sessionMessageAttachmentRepository,
    config
  );
  const sessionChangedFileService = new SessionChangedFileService(
    repositories.sessionChangedFileRepository
  );
  const sessionActivityAuthorityService = new SessionActivityAuthorityService();
  const sessionHistoryService = new SessionHistoryService(
    database.db,
    repositories.workspaceRepository,
    repositories.sessionBindingRepository,
    sessionChangedFileService,
    repositories.sessionIndexRepository,
    sessionMessageAttachmentService,
    repositories.sessionStateRepository,
    repositories.sessionStatusSnapshotRepository,
    config,
    sessionActivityAuthorityService,
    repositories.sessionMessageOriginRepository,
    repositories.sessionForkRepository,
    {},
    taskManager
  );
  runtimeObservabilityService = new RuntimeObservabilityService(
    () => sessionHistoryService.observeBackgroundTaskMetrics(),
    () => schedulerMetrics.observe(),
    eventLoopMonitor,
    taskActivityLog
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
    config,
    sessionActivityAuthorityService
  );
  sessionHistoryService.registerLiveActivityObservationResolver((sessionId) =>
    sessionLiveRuntimeService.resolveLiveActivityObservation(sessionId)
  );
  const butlerRuntimeRootDir = path.join(path.dirname(config.databasePath), "butler-runtime");
  const butlerRuntimeConfig: HostConfig = {
    ...config,
    codexHomeDir: path.join(butlerRuntimeRootDir, "codex-home"),
    claudeCodeHomeDir: path.join(butlerRuntimeRootDir, "claude-home")
  };
  const butlerSummaryRuntimeConfig: HostConfig = {
    ...config,
    codexHomeDir: path.join(butlerRuntimeRootDir, "summary-codex-home"),
    claudeCodeHomeDir: path.join(butlerRuntimeRootDir, "summary-claude-home")
  };
  const butlerFollowUpRuntimeConfig: HostConfig = {
    ...config,
    codexHomeDir: path.join(butlerRuntimeRootDir, "follow-up-codex-home"),
    claudeCodeHomeDir: path.join(butlerRuntimeRootDir, "follow-up-claude-home")
  };
  const butlerSessionLiveRuntimeService = new SessionLiveRuntimeService(
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
    butlerRuntimeConfig,
    sessionActivityAuthorityService
  );
  sessionHistoryService.registerLiveActivityObservationResolver((sessionId) =>
    butlerSessionLiveRuntimeService.resolveLiveActivityObservation(sessionId)
  );
  const butlerSummarySessionLiveRuntimeService = new SessionLiveRuntimeService(
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
    butlerSummaryRuntimeConfig,
    sessionActivityAuthorityService
  );
  sessionHistoryService.registerLiveActivityObservationResolver((sessionId) =>
    butlerSummarySessionLiveRuntimeService.resolveLiveActivityObservation(sessionId)
  );
  const butlerFollowUpSessionLiveRuntimeService = new SessionLiveRuntimeService(
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
    butlerFollowUpRuntimeConfig,
    sessionActivityAuthorityService
  );
  sessionHistoryService.registerLiveActivityObservationResolver((sessionId) =>
    butlerFollowUpSessionLiveRuntimeService.resolveLiveActivityObservation(sessionId)
  );
  const worktreeManager = new WorktreeManager(
    workspaceService,
    repositories.workspaceWorktreeRepository,
    gitReadService,
    gitCommandRunner
  );
  const worktreeSyncService = new WorktreeSyncService(
    workspaceService,
    repositories.workspaceWorktreeRepository,
    gitCommandRunner
  );
  const worktreeMergeService = new WorktreeMergeService(
    workspaceService,
    repositories.workspaceWorktreeRepository,
    gitReadService,
    gitCommandRunner,
    worktreeSyncService
  );
  const worktreeCleanupService = new WorktreeCleanupService(
    workspaceService,
    repositories.workspaceWorktreeRepository,
    repositories.sessionIndexRepository,
    repositories.terminalInstanceRepository,
    gitReadService,
    gitCommandRunner,
    worktreeSyncService
  );
  const workbenchService = new WorkbenchService(
    repositories.workspaceRepository,
    repositories.workspaceNavigationStateRepository,
    sessionHistoryService,
    butlerProfileService,
    repositories.butlerControlSessionRepository,
    repositories.workspaceWorktreeRepository,
    taskManager
  );
  const butlerProjectService = new ButlerProjectService(
    repositories.butlerProjectRepository,
    repositories.butlerSessionRepository,
    repositories.workspaceRepository,
    butlerProfileService
  );
  const butlerInboxService = new ButlerInboxService(
    repositories.butlerProjectRepository,
    repositories.butlerInboxItemRepository,
    taskManager
  );
  const butlerNotificationService = new ButlerNotificationService(
    repositories.butlerNotificationArchiveRepository
  );
  const butlerSessionService = new ButlerSessionService(
    repositories.butlerProjectRepository,
    repositories.butlerSessionRepository,
    repositories.sessionCheckpointRepository,
    repositories.sessionBindingRepository,
    repositories.sessionIndexRepository,
    repositories.sessionStateRepository,
    sessionLiveRuntimeService,
    sessionHistoryService,
    repositories.sessionMessageOriginRepository
  );
  const projectMemoryService = new ProjectMemoryService(
    repositories.butlerProjectRepository,
    repositories.projectMemoryRepository
  );
  const patrolPlanService = new PatrolPlanService(
    repositories.butlerProjectRepository,
    repositories.patrolPlanRepository
  );
  const patrolRunService = new PatrolRunService(
    repositories.butlerProjectRepository,
    repositories.patrolPlanRepository,
    repositories.patrolRunRepository
  );
  const instructionAdapter = new InstructionAdapter();
  const providerAdapterRegistry = new ProviderAdapterRegistry([
    new RuntimePatrolProviderAdapter("codex", sessionLiveRuntimeService, sessionHistoryService),
    new RuntimePatrolProviderAdapter("claude-code", sessionLiveRuntimeService, sessionHistoryService)
  ]);
  const summaryProviderAdapterRegistry = new ProviderAdapterRegistry([
    new RuntimePatrolProviderAdapter("codex", butlerSummarySessionLiveRuntimeService, sessionHistoryService),
    new RuntimePatrolProviderAdapter("claude-code", butlerSummarySessionLiveRuntimeService, sessionHistoryService)
  ]);
  const followUpProviderAdapterRegistry = new ProviderAdapterRegistry([
    new RuntimePatrolProviderAdapter("codex", butlerFollowUpSessionLiveRuntimeService, sessionHistoryService),
    new RuntimePatrolProviderAdapter("claude-code", butlerFollowUpSessionLiveRuntimeService, sessionHistoryService)
  ]);
  const butlerAnalysisProviderAdapterRegistry = new ProviderAdapterRegistry([
    new RuntimePatrolProviderAdapter("codex", butlerSessionLiveRuntimeService, sessionHistoryService),
    new RuntimePatrolProviderAdapter("claude-code", butlerSessionLiveRuntimeService, sessionHistoryService)
  ]);
  const patrolExecutionService = new PatrolExecutionService(
    repositories.butlerProjectRepository,
    repositories.butlerSessionRepository,
    repositories.sessionCheckpointRepository,
    repositories.patrolPlanRepository,
    patrolRunService,
    repositories.projectMemoryRepository,
    repositories.sessionChangedFileRepository,
    repositories.authUserRepository,
    providerAdapterRegistry,
    instructionAdapter
  );
  const patrolScheduler = new PatrolScheduler(
    patrolPlanService,
    patrolRunService,
    patrolExecutionService,
    {
      schedulerMetrics
    }
  );
  const sessionSummaryInstructionAdapter = new SessionSummaryInstructionAdapter();
  const butlerFollowUpEvaluationInstructionAdapter = new ButlerFollowUpEvaluationInstructionAdapter();
  const verificationRunService = new VerificationRunService(
    repositories.butlerProjectRepository,
    repositories.butlerSessionRepository,
    repositories.sessionCheckpointRepository,
    repositories.verificationRunRepository
  );
  const butlerContextAggregator = new ButlerContextAggregator(
    butlerProfileService,
    butlerProjectService,
    butlerSessionService,
    butlerInboxService,
    projectMemoryService,
    patrolRunService,
    verificationRunService,
    repositories.sessionCheckpointRepository
  );
  const butlerAuthService = new ButlerAuthService(
    repositories.authTokenRepository,
    config
  );
  const butlerInboxAnalysisService = new ButlerInboxAnalysisService(
    butlerProfileService,
    workspaceService,
    butlerContextAggregator,
    butlerAuthService,
    skillManagerService,
    sessionHistoryService,
    butlerSessionLiveRuntimeService,
    butlerAnalysisProviderAdapterRegistry,
    butlerRuntimeConfig.codexHomeDir,
    config.codexHomeDir
  );
  const butlerSessionSummaryService = new ButlerSessionSummaryService(
    butlerProfileService,
    butlerProjectService,
    butlerSessionService,
    repositories.butlerSessionRepository,
    repositories.butlerSessionSummaryStateRepository,
    repositories.sessionCheckpointRepository,
    repositories.sessionIndexRepository,
    repositories.authUserRepository,
    workspaceService,
    sessionHistoryService,
    summaryProviderAdapterRegistry,
    sessionSummaryInstructionAdapter,
    {
      summaryCodexHomeDir: butlerSummaryRuntimeConfig.codexHomeDir,
      sourceCodexHomeDir: config.codexHomeDir
    }
  );
  const butlerFollowUpService = new ButlerFollowUpService(
    butlerProfileService,
    butlerProjectService,
    butlerSessionService,
    repositories.butlerFollowUpTaskRepository,
    sessionHistoryService,
    repositories.sessionIndexRepository,
    sessionLiveRuntimeService,
    workspaceService,
    followUpProviderAdapterRegistry,
    butlerFollowUpEvaluationInstructionAdapter,
    butlerFollowUpRuntimeConfig.codexHomeDir,
    config.codexHomeDir,
    repositories.sessionMessageOriginRepository
  );
  const butlerActionContextService = new ButlerActionContextService(
    butlerProjectService,
    butlerSessionService,
    butlerFollowUpService
  );
  const sessionSummaryScheduler = new SessionSummaryScheduler(
    butlerSessionSummaryService,
    {
      schedulerMetrics
    }
  );
  const butlerFollowUpScheduler = new ButlerFollowUpScheduler(
    butlerFollowUpService,
    {
      schedulerMetrics
    }
  );
  const butlerFollowUpTerminalSubscription = sessionLiveRuntimeService.registerTerminalStateListener(
    async (event) => {
      await butlerFollowUpService.handleSessionTerminal(event.sessionId, event.timestamp);
    }
  );
  const butlerControlSessionService = new ButlerControlSessionService(
    butlerProfileService,
    repositories.butlerControlSessionRepository,
    workspaceService,
    sessionHistoryService,
    butlerSessionLiveRuntimeService,
    butlerContextAggregator,
    butlerAuthService,
    skillManagerService,
    butlerRuntimeConfig.codexHomeDir,
    config.codexHomeDir,
    repositories.sessionMessageOriginRepository
  );
  const butlerControlTimerService = new ButlerControlTimerService(
    butlerProfileService,
    butlerControlSessionService,
    repositories.butlerControlTimerRepository
  );
  const butlerControlTimerScheduler = new ButlerControlTimerScheduler(
    butlerControlTimerService,
    {
      schedulerMetrics
    }
  );
  butlerInboxService.configureLifecycleServices({
    butlerInboxAnalysisService,
    butlerControlSessionService,
    butlerSessionService,
    butlerFollowUpService
  });
  const butlerControlActionService = new ButlerControlActionService(
    butlerProfileService,
    repositories.butlerControlSessionRepository,
    repositories.butlerControlEventRepository,
    butlerProjectService,
    butlerSessionService,
    patrolRunService,
    patrolExecutionService,
    verificationRunService,
    butlerContextAggregator
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
    config.terminalIdleTimeoutSeconds,
    {
      databasePath: config.databasePath,
      terminalLogRootDir: path.join(path.dirname(config.databasePath), "terminal-logs"),
      terminalLogFileRepository: repositories.terminalLogFileRepository,
      terminalLogSegmentRepository: repositories.terminalLogSegmentRepository
    }
  );
  const debugTargetService = new DebugTargetService(
    database.db,
    workspaceService,
    repositories.workspaceWorktreeRepository,
    repositories.debugTargetRepository,
    repositories.debugServiceRepository,
    repositories.frameworkAnalysisResultRepository,
    repositories.debugRuntimeSessionRepository,
    repositories.portLeaseRepository,
    repositories.runtimeBindingRepository,
    repositories.aiFallbackEditRepository,
    repositories.terminalCommandTemplateRepository,
    terminalService,
    repositories.terminalInstanceRepository,
    taskManager
  );
  const debugRuntimeReconciliationScheduler = new DebugRuntimeReconciliationScheduler(
    debugTargetService,
    {
      schedulerMetrics
    }
  );
  const commandTemplateService = new CommandTemplateService(
    database.db,
    repositories.terminalCommandTemplateRepository,
    workspaceService,
    terminalService
  );
  const templateReverseProxyService = new TemplateReverseProxyService(commandTemplateService);
  const workspacePanelSnapshotService = new WorkspacePanelSnapshotService(
    fileTreeService,
    gitReadService,
    terminalService,
    commandTemplateService,
    workspaceService,
    taskManager
  );
  const fileWatcher = new WorkspaceFileWatcher(workspaceService);

  const bootstrapController = new BootstrapController(bootstrapService);
  const clientController = new ClientController(clientService);
  const debugTargetController = new DebugTargetController(debugTargetService);
  const handleDebugTargetTerminalExit = (event: {
    terminal: TerminalInstance;
    requestedClose: boolean;
  }) => {
    void debugTargetService.handleTerminalExit(event);
  };
  terminalService.on("exit", handleDebugTargetTerminalExit);
  const authController = new AuthController(authService);
  const workspaceController = new WorkspaceController(workspaceService);
  const worktreeController = new WorktreeController(
    worktreeManager,
    worktreeSyncService,
    worktreeMergeService,
    worktreeCleanupService
  );
  const workbenchController = new WorkbenchController(workbenchService);
  const butlerController = new ButlerController(
    butlerProfileService,
    butlerControlSessionService,
    butlerControlActionService,
    butlerContextAggregator,
    butlerFollowUpService,
    butlerInboxService,
    butlerNotificationService,
    butlerProjectService,
    butlerSessionService,
    projectMemoryService,
    patrolPlanService,
    patrolRunService,
    patrolExecutionService,
    verificationRunService,
    butlerActionContextService,
    butlerControlTimerService
  );
  const sessionController = new SessionController(
    sessionHistoryService,
    sessionLiveRuntimeService,
    repositories.butlerControlSessionRepository
  );
  const assistantCapabilityController = new AssistantCapabilityController(
    new AssistantCapabilityService(
      butlerProjectService,
      butlerSessionService,
      butlerControlSessionService,
      butlerControlTimerService,
      sessionHistoryService,
      sessionLiveRuntimeService,
      terminalService,
      debugTargetService,
      workspaceService,
      worktreeManager,
      worktreeSyncService,
      worktreeMergeService,
      worktreeCleanupService,
      repositories.sessionMessageOriginRepository
    )
  );
  const providerController = new ProviderController(
    sessionHistoryService,
    sessionLiveRuntimeService,
    config
  );
  const skillController = new SkillController(skillManagerService);
  const tailscaleController = new TailscaleController(tailscaleService);
  const modelSwitchController = new ModelSwitchController(modelSwitchService);
  const quickPhraseController = new QuickPhraseController(quickPhraseService);
  const profileController = new ProfileController(preferenceProfileService);
  const fileController = new FileController(
    fileTreeService,
    fileContentService,
    fileSearchService,
    recentFileService,
    filePreviewService,
    filePreviewLinkService
  );
  const fileContextController = new FileContextController(
    fileContentService,
    fileContextService
  );
  const gitController = new GitController(gitReadService, gitWriteService, commitOrchestrator);
  const terminalController = new TerminalController(terminalService, commandTemplateService);
  const observabilityController = new ObservabilityController(runtimeObservabilityService);
  const wsHandle = createWsServer(
    app.server,
    new WsAuthGuard(authService),
    sessionHistoryService,
    sessionLiveRuntimeService,
    new TerminalWsHub(terminalService),
    new WorkbenchWsHub(workbenchService, workspacePanelSnapshotService, fileWatcher),
    butlerActionContextService
  );

  app.server.on("upgrade", (request, socket, head) => {
    templateReverseProxyService.handleWebSocketUpgrade(request, socket, head);
  });

  app.addHook("onRequest", async (request, reply) => {
    applyCorsHeaders(request.headers.origin, reply, config.demoMode);

    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return reply;
    }
  });
  app.addHook("onRequest", createAuthGuard(authService));
  app.setErrorHandler(setErrorHandler);
  app.addHook("onReady", () => {
    // 启动恢复属于后台补偿流程，不能把 Host ready 绑死在外部命令或慢任务上。
    void debugTargetService.runBackgroundRuntimeReconciliation(
      "debug_target.startup_runtime_recovery"
    ).catch((error) => {
      if (shuttingDown) {
        return;
      }

      console.error("[startup-recovery] 调试运行时恢复失败", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
    void tailscaleService.restoreOnStartup().catch((error) => {
      if (shuttingDown) {
        return;
      }

      console.error("[startup-recovery] Tailscale 启动恢复失败", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });

  // Demo 模式：自动创建演示用户
  if (config.demoMode) {
    const status = bootstrapService.getStatus();
    if (!status.initialized) {
      bootstrapService.setup({ username: "demo", password: "codingns" });
    }
  }

  void registerPublicRoutes(app, bootstrapController);
  void registerProxyRoutes(app, templateReverseProxyService);
  void registerAuthRoutes(app, authController);
  void registerAssistantCapabilityRoutes(app, assistantCapabilityController);
  void registerClientRoutes(app, clientController);
  void registerDebugTargetRoutes(app, debugTargetController);
  void registerObservabilityRoutes(app, observabilityController);
  void registerWorkspaceRoutes(app, workspaceController);
  void registerWorktreeRoutes(app, worktreeController);
  void registerWorkbenchRoutes(app, workbenchController);
  void registerButlerRoutes(app, butlerController);
  void registerSessionRoutes(app, sessionController);
  void registerPreferenceRoutes(app, quickPhraseController, profileController);
  void registerSkillRoutes(app, skillController);
  void registerSystemRoutes(app, tailscaleController, modelSwitchController);
  void registerFileRoutes(app, fileController);
  void registerSessionContextRoutes(app, fileContextController);
  void registerTerminalRoutes(app, terminalController);
  void registerProviderRoutes(app, providerController);
  void registerGitRoutes(app, gitController);
  patrolScheduler.start();
  sessionSummaryScheduler.start();
  butlerFollowUpScheduler.start();
  butlerControlTimerScheduler.start();
  debugRuntimeReconciliationScheduler.start();

  if (config.webUiDir) {
    registerStaticWebRoutes(app, config.webUiDir);
  }

  app.addHook("onClose", async () => {
    shuttingDown = true;
    stopTerminalDebugEventLoopLagMonitor();
    eventLoopMonitor.dispose();
    butlerFollowUpTerminalSubscription.close();
    await patrolScheduler.dispose();
    await sessionSummaryScheduler.dispose();
    await butlerFollowUpScheduler.dispose();
    await butlerControlTimerScheduler.dispose();
    await debugRuntimeReconciliationScheduler.dispose();
    terminalService.off("exit", handleDebugTargetTerminalExit);
    await terminalService.dispose();
    await butlerFollowUpSessionLiveRuntimeService.dispose();
    await butlerSummarySessionLiveRuntimeService.dispose();
    await butlerSessionLiveRuntimeService.dispose();
    await sessionLiveRuntimeService.dispose();
    await wsHandle.close();
    config.opencodeBaseUrlResolver?.dispose?.();
    gitCommandRunner.dispose();
    tailscaleHelperClient.dispose();
    disposeSharedTaskHelperProcessClient();
    disposeSharedProviderDiscoveryHelperClient();
    disposeSharedOpenCodeSystemProbeHelperClient();
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
        debugTargetService,
        debugRuntimeReconciliationScheduler,
        authService,
        workspaceService,
        worktreeManager,
        worktreeSyncService,
        worktreeMergeService,
        worktreeCleanupService,
        workbenchService,
        butlerProfileService,
        butlerSessionLiveRuntimeService,
        butlerControlSessionService,
        butlerControlActionService,
        butlerFollowUpService,
        butlerActionContextService,
        butlerProjectService,
        butlerSessionService,
        projectMemoryService,
        patrolPlanService,
        patrolRunService,
        verificationRunService,
        patrolScheduler,
        butlerSessionSummaryService,
        sessionSummaryScheduler,
        butlerFollowUpScheduler,
        workspacePanelSnapshotService,
        fileTreeService,
        fileSearchService,
        fileContentService,
        filePreviewService,
        filePreviewLinkService,
        fileContextService,
        recentFileService,
        gitReadService,
        gitWriteService,
        commitOrchestrator,
        quickPhraseService,
        preferenceProfileService,
        skillManagerService,
        tailscaleManager,
        tailscaleService,
        modelSwitchService,
        runtimeObservabilityService,
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
}, demoMode: boolean): void {
  const allowedOrigin = resolveAllowedCorsOrigin(origin, demoMode);

  if (!allowedOrigin) {
    return;
  }

  reply.header("Access-Control-Allow-Origin", allowedOrigin);
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Credentials", "true");
  reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
}

function resolveAllowedCorsOrigin(origin: string | undefined, demoMode: boolean): string | null {
  if (!origin) {
    return null;
  }

  // Demo 模式：放行所有来源
  if (demoMode) {
    return origin;
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
