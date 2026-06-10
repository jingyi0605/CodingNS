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
import { AssistantAutomationService } from "../modules/butler/assistant-automation-service.js";
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
import { HostHandshakeService } from "../modules/peer-host/host-handshake.js";
import { HostHandshakeController } from "../modules/peer-host/host-handshake-controller.js";
import { HostApiProxyService } from "../modules/peer-host/host-api-proxy-service.js";
import { HostWsProxyService } from "../modules/peer-host/host-ws-proxy-service.js";
import { HostApiProxyController, PeerHostController } from "../modules/peer-host/peer-host-controller.js";
import { PeerHostService } from "../modules/peer-host/peer-host-service.js";
import { NpmGlobalPackageService } from "../modules/client/npm-global-package-service.js";
import { ServiceUpdateTaskService } from "../modules/client/service-update-task-service.js";
import { ChannelBridgeService } from "../modules/channels/channel-bridge-service.js";
import { ChannelController } from "../modules/channels/channel-controller.js";
import { ChannelDeliveryService } from "../modules/channels/channel-delivery-service.js";
import { ChannelGatewayController } from "../modules/channels/channel-gateway-controller.js";
import { ChannelGatewayService } from "../modules/channels/channel-gateway-service.js";
import { ChannelPollingScheduler } from "../modules/channels/channel-polling-scheduler.js";
import { ChannelPollingService } from "../modules/channels/channel-polling-service.js";
import { createDefaultChannelPlatformAdapterRegistry } from "../modules/channels/channel-platform-adapters.js";
import { ChannelService } from "../modules/channels/channel-service.js";
import { WechatClawRuntimeClient } from "../modules/channels/wechat-claw-runtime-client.js";
import { WechatClawRuntimeManager } from "../modules/channels/wechat-claw-runtime-manager.js";
import { BrowserProfileService } from "../modules/browser-runtime/browser-profile-service.js";
import { BrowserRuntimeController } from "../modules/browser-runtime/browser-runtime-controller.js";
import { BrowserRuntimeService } from "../modules/browser-runtime/browser-runtime-service.js";
import { OpenCliBridgeBrowserExecutor } from "../modules/browser-runtime/opencli-bridge-browser-executor.js";
import { OpenCliBrowserBridgeService } from "../modules/browser-runtime/opencli-browser-bridge-service.js";
import { PlaywrightBrowserExecutor } from "../modules/browser-runtime/playwright-browser-executor.js";
import { DocumentRuntimeController } from "../modules/document-runtime/document-runtime-controller.js";
import { DocumentExportExecutor } from "../modules/document-runtime/document-export-executor.js";
import { DocumentRuntimeService } from "../modules/document-runtime/document-runtime-service.js";
import { DebugTargetController } from "../modules/debug-target/debug-target-controller.js";
import { DebugRuntimeReconciliationScheduler } from "../modules/debug-target/debug-runtime-reconciliation-scheduler.js";
import { DebugTargetService } from "../modules/debug-target/debug-target-service.js";
import { FileAccessGuard } from "../modules/file/file-access-guard.js";
import { FileContentService } from "../modules/file/file-content-service.js";
import { FileContextController } from "../modules/file/file-context-controller.js";
import { FileContextService } from "../modules/file/file-context-service.js";
import { FileController } from "../modules/file/file-controller.js";
import { WorkspaceIndexApplyService } from "../modules/file/workspace-index-apply-service.js";
import { FilePreviewLinkService } from "../modules/file/file-preview-link-service.js";
import { FilePreviewService } from "../modules/file/file-preview-service.js";
import { RecentModifiedFileService } from "../modules/file/recent-modified-file-service.js";
import { FileSearchService } from "../modules/file/file-search-service.js";
import { FileTreeService } from "../modules/file/file-tree-service.js";
import { FileVersionChecker } from "../modules/file/file-version-checker.js";
import { RecentFileService } from "../modules/file/recent-file-service.js";
import { WorkspaceFileBridgeService } from "../modules/file/workspace-file-bridge-service.js";
import { WorkspaceFileBridgeWatchService } from "../modules/file/workspace-file-bridge-watch-service.js";
import { CommitDraftService } from "../modules/git/commit-draft-service.js";
import { CommitOrchestrator } from "../modules/git/commit-orchestrator.js";
import { CommitRuleEngine } from "../modules/git/commit-rule-engine.js";
import { GitCommandRunner } from "../modules/git/git-command-runner.js";
import { GitController } from "../modules/git/git-controller.js";
import { GitRemoteCredentialService } from "../modules/git/git-remote-credential-service.js";
import { GitReadService } from "../modules/git/git-read-service.js";
import { GitRuleRepository } from "../modules/git/git-rule-repository.js";
import { GitWriteService } from "../modules/git/git-write-service.js";
import { OfficeController } from "../modules/office/office-controller.js";
import { OnlyOfficeIntegrationService } from "../modules/office/onlyoffice-integration-service.js";
import { OfficePreviewLinkService } from "../modules/office/office-preview-link-service.js";
import { OfficeService } from "../modules/office/office-service.js";
import { OpsRuntimeController } from "../modules/ops-runtime/ops-runtime-controller.js";
import { OpsRuntimeService } from "../modules/ops-runtime/ops-runtime-service.js";
import { SshOpsExecutor } from "../modules/ops-runtime/ssh-ops-executor.js";
import { WorkspaceRepoGuard } from "../modules/git/workspace-repo-guard.js";
import { ProfileController } from "../modules/preferences/profile-controller.js";
import { PreferenceProfileService } from "../modules/preferences/profile-service.js";
import { QuickPhraseController } from "../modules/preferences/quick-phrase-controller.js";
import { QuickPhraseService } from "../modules/preferences/quick-phrase-service.js";
import { PresentationController } from "../modules/presentation/presentation-controller.js";
import { PresentationExportTaskService } from "../modules/presentation/presentation-export-task-service.js";
import { PresentationPdfExportService } from "../modules/presentation/presentation-pdf-export-service.js";
import { PresentationPptxExportService } from "../modules/presentation/presentation-pptx-export-service.js";
import { RelayTunnelController } from "../modules/relay-tunnel/relay-tunnel-controller.js";
import { RelayTunnelRuntimeEdgeAdapter } from "../modules/relay-tunnel/relay-tunnel-runtime-adapter.js";
import { RelayTunnelService } from "../modules/relay-tunnel/relay-tunnel-service.js";
import { CcSwitchAdapter } from "../modules/model-switch/cc-switch-adapter.js";
import { ModelSwitchController } from "../modules/model-switch/model-switch-controller.js";
import { ModelSwitchService } from "../modules/model-switch/model-switch-service.js";
import { HostResourceController } from "../modules/system/host-resource-controller.js";
import { HostResourceService } from "../modules/system/host-resource-service.js";
import { ParallelSessionController } from "../modules/parallel-sessions/parallel-session-controller.js";
import { ParallelSessionGroupService } from "../modules/parallel-sessions/parallel-session-group-service.js";
import { SessionIsolatedWorkspaceService } from "../modules/parallel-sessions/session-isolated-workspace-service.js";
import { OpenCliCatalogService } from "../modules/opencli/opencli-catalog-service.js";
import { OpenCliController } from "../modules/opencli/opencli-controller.js";
import { OpenCliHealthService } from "../modules/opencli/opencli-health-service.js";
import { OpenCliManagementService } from "../modules/opencli/opencli-management-service.js";
import { OpenCliBridgeSkillService } from "../modules/opencli/opencli-bridge-skill-service.js";
import { OpenCliRuntimeBuilder } from "../modules/opencli/opencli-runtime-builder.js";
import { OpenCliRuntimeProfileService } from "../modules/opencli/opencli-runtime-profile-service.js";
import { OpenCliRuntimeResolver } from "../modules/opencli/opencli-runtime-resolver.js";
import { OpenCliSessionPromptService } from "../modules/opencli/opencli-session-prompt-service.js";
import { ProviderCatalogService } from "../modules/provider/provider-catalog-service.js";
import { ProviderController } from "../modules/provider/provider-controller.js";
import { disposeSharedProviderDiscoveryHelperClient } from "../modules/provider/provider-discovery-helper-client.js";
import { ProviderRuntimeStateService } from "../modules/provider/provider-runtime-state-service.js";
import { SkillController } from "../modules/skills/skill-controller.js";
import { syncBuiltinSkillsOnStartup } from "../modules/skills/builtin-skill-service.js";
import { cleanupLegacyAssistantRuntimeSkillCopies } from "../modules/skills/assistant-runtime-skill-cleanup.js";
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
import { SessionLiveRuntimeRouterService } from "../modules/sessions/session-live-runtime-router-service.js";
import { SessionLiveRuntimeService } from "../modules/sessions/session-live-runtime-service.js";
import { SessionProviderConfigService } from "../modules/sessions/session-provider-config-service.js";
import { SessionProviderUsageLimitGuardService } from "../modules/sessions/session-provider-usage-guard-service.js";
import { SessionMessageAttachmentService } from "../modules/sessions/session-message-attachment-service.js";
import { WorkspaceSessionInstructionWatchService } from "../modules/sessions/workspace-session-instruction-watch-service.js";
import { WorkspaceSessionAuthService } from "../modules/sessions/workspace-session-auth-service.js";
import { WorkspaceSessionRuntimeContextService } from "../modules/sessions/workspace-session-runtime-context-service.js";
import { EventLoopMonitor } from "../modules/tasks/event-loop-monitor.js";
import { ObservabilityController } from "../modules/tasks/observability-controller.js";
import { RuntimeObservabilityService } from "../modules/tasks/observability-service.js";
import { SchedulerMetrics } from "../modules/tasks/scheduler-metrics.js";
import { TaskActivityLog } from "../modules/tasks/task-activity-log.js";
import { createTaskManager } from "../modules/tasks/task-manager.js";
import { disposeSharedTaskHelperPool } from "../modules/tasks/task-helper-pool.js";
import { createHostTaskLaneExecutors } from "../modules/tasks/task-lane-executors.js";
import { CommandTemplateService } from "../modules/terminal/command-template-service.js";
import { TerminalController } from "../modules/terminal/terminal-controller.js";
import { TemplateReverseProxyService } from "../modules/terminal/template-reverse-proxy-service.js";
import { TerminalService } from "../modules/terminal/terminal-service.js";
import { CodexArchiveWatcher } from "../modules/workbench/codex-archive-watcher.js";
import { AffairsAssistantSessionSnapshotService } from "../modules/workbench/affairs-assistant-session-snapshot-service.js";
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
import { AffairsLibraryController } from "../modules/workspace/affairs-library-controller.js";
import { getAffairsLibraryDebugLogPath } from "../modules/workspace/affairs-library-debug-log.js";
import { AffairsLibraryDirtyWatchService } from "../modules/workspace/affairs-library-dirty-watch-service.js";
import { AffairsLightweightSessionController } from "../modules/workspace/affairs-lightweight-session-controller.js";
import { AffairsLightweightSessionService } from "../modules/workspace/affairs-lightweight-session-service.js";
import { AffairsLibraryPreviewLinkService } from "../modules/workspace/affairs-library-preview-link-service.js";
import { AFFAIRS_GLOBAL_WORKSPACE_ID, AffairsLibraryService } from "../modules/workspace/affairs-library-service.js";
import { AffairsTagController } from "../modules/workspace/affairs-tag-controller.js";
import { AffairsTagService } from "../modules/workspace/affairs-tag-service.js";
import { TeableCatalogController } from "../modules/workspace/teable-catalog-controller.js";
import { TeableCatalogService } from "../modules/workspace/teable-catalog-service.js";
import { TeableFieldMappingController } from "../modules/workspace/teable-field-mapping-controller.js";
import { TeableFieldMappingService } from "../modules/workspace/teable-field-mapping-service.js";
import { TeableGlobalBindingController } from "../modules/workspace/teable-global-binding-controller.js";
import { TeableGlobalBindingService } from "../modules/workspace/teable-global-binding-service.js";
import { TeableMirrorSyncController } from "../modules/workspace/teable-mirror-sync-controller.js";
import { TeableRuntimeController } from "../modules/workspace/teable-runtime-controller.js";
import { TeableRuntimeService } from "../modules/workspace/teable-runtime-service.js";
import { TeableWorkbenchSyncConfigController } from "../modules/workspace/teable-workbench-sync-config-controller.js";
import { TeableWorkbenchSyncConfigService } from "../modules/workspace/teable-workbench-sync-config-service.js";
import { TeableMirrorSyncService } from "../modules/workspace/teable-mirror-sync-service.js";
import { TeableCredentialService } from "../modules/workspace/teable-credential-service.js";
import { WorkspaceService } from "../modules/workspace/workspace-service.js";
import { registerAuthRoutes } from "../routes/auth.js";
import { registerAffairsRoutes } from "../routes/affairs.js";
import { registerAssistantCapabilityRoutes } from "../routes/assistant.js";
import { registerButlerRoutes } from "../routes/butler.js";
import { registerBrowserRuntimeRoutes } from "../routes/browser-runtime.js";
import { registerChannelRoutes } from "../routes/channels.js";
import { registerClientRoutes } from "../routes/client.js";
import { registerDebugTargetRoutes } from "../routes/debug-targets.js";
import { registerDocumentRuntimeRoutes } from "../routes/document-runtime.js";
import { registerFileRoutes } from "../routes/files.js";
import { registerGitRoutes } from "../routes/git.js";
import { registerOfficeRoutes } from "../routes/office.js";
import { registerOpenCliRoutes } from "../routes/opencli.js";
import { registerObservabilityRoutes } from "../routes/observability.js";
import { registerParallelGroupRoutes } from "../routes/parallel-groups.js";
import { registerPeerHostRoutes } from "../routes/peer-hosts.js";
import { registerPluginRoutes } from "../routes/plugins.js";
import { registerPluginPublicRoutes } from "../routes/plugins-public.js";
import { registerPresentationRoutes } from "../routes/presentation.js";
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
import { registerOpsRuntimeRoutes } from "../routes/ops-runtime.js";
import { DemoCleanupService, DemoOnlineTracker } from "../modules/demo/demo-cleanup-service.js";
import { setErrorHandler } from "../shared/http/error-handler.js";
import { startTerminalDebugEventLoopLagMonitor } from "../shared/utils/terminal-debug-log.js";
import { AssistantAutomationRunRepository } from "../storage/repositories/assistant-automation-run-repository.js";
import { AssistantAutomationTaskRepository } from "../storage/repositories/assistant-automation-task-repository.js";
import { AuthDeviceRepository } from "../storage/repositories/auth-device-repository.js";
import { AuthDeviceSessionRepository } from "../storage/repositories/auth-device-session-repository.js";
import { AuthLoginEventRepository } from "../storage/repositories/auth-login-event-repository.js";
import { AuthTokenRepository } from "../storage/repositories/auth-token-repository.js";
import { AuthLoginAttemptRepository } from "../storage/repositories/auth-login-attempt-repository.js";
import { AuthUserRepository } from "../storage/repositories/auth-user-repository.js";
import { AiFallbackEditRepository } from "../storage/repositories/ai-fallback-edit-repository.js";
import { AffairsAssistantSessionSnapshotRepository } from "../storage/repositories/affairs-assistant-session-snapshot-repository.js";
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
import { BrowserProfileRepository } from "../storage/repositories/browser-profile-repository.js";
import {
  PeerHostRepository,
  PeerHostSessionRepository,
  PeerHostWorkspaceBindingRepository,
} from "../storage/repositories/peer-host-repository.js";
import { DocumentCommentRepository } from "../storage/repositories/document-comment-repository.js";
import { DocumentRepository } from "../storage/repositories/document-repository.js";
import { DocumentRevisionRepository } from "../storage/repositories/document-revision-repository.js";
import { DocumentTemplateRepository } from "../storage/repositories/document-template-repository.js";
import { PatrolPlanRepository } from "../storage/repositories/patrol-plan-repository.js";
import { PatrolRunRepository } from "../storage/repositories/patrol-run-repository.js";
import { ProjectMemoryRepository } from "../storage/repositories/project-memory-repository.js";
import { VerificationRunRepository } from "../storage/repositories/verification-run-repository.js";
import { CommitRuleProfileRepository } from "../storage/repositories/commit-rule-profile-repository.js";
import { ChannelAccountRepository } from "../storage/repositories/channel-account-repository.js";
import { ChannelDeliveryRepository } from "../storage/repositories/channel-delivery-repository.js";
import { ChannelInboundEventRepository } from "../storage/repositories/channel-inbound-event-repository.js";
import { ChannelThreadRepository } from "../storage/repositories/channel-thread-repository.js";
import { DebugRuntimeSessionRepository } from "../storage/repositories/debug-runtime-session-repository.js";
import { DebugServiceRepository } from "../storage/repositories/debug-service-repository.js";
import { DebugTargetRepository } from "../storage/repositories/debug-target-repository.js";
import { OfficeApprovalRepository } from "../storage/repositories/office-approval-repository.js";
import { OfficeArtifactRepository } from "../storage/repositories/office-artifact-repository.js";
import { OfficeAuditEventRepository } from "../storage/repositories/office-audit-event-repository.js";
import { PluginAuditEventRepository } from "../storage/repositories/plugin-audit-event-repository.js";
import { OfficeConnectorRepository } from "../storage/repositories/office-connector-repository.js";
import { OfficeReceiptRepository } from "../storage/repositories/office-receipt-repository.js";
import { OfficeRollbackRecordRepository } from "../storage/repositories/office-rollback-record-repository.js";
import { OfficeTaskRepository } from "../storage/repositories/office-task-repository.js";
import { OfficeTaskStepRepository } from "../storage/repositories/office-task-step-repository.js";
import { OpsTargetRepository } from "../storage/repositories/ops-target-repository.js";
import { FileContextBindingRepository } from "../storage/repositories/file-context-binding-repository.js";
import { FrameworkAnalysisResultRepository } from "../storage/repositories/framework-analysis-result-repository.js";
import { GitRemoteCredentialRepository } from "../storage/repositories/git-remote-credential-repository.js";
import { ManagedSkillRepository } from "../storage/repositories/managed-skill-repository.js";
import { OpenCliCatalogEntryRepository } from "../storage/repositories/opencli-catalog-entry-repository.js";
import { OpenCliProviderRepository } from "../storage/repositories/opencli-provider-repository.js";
import { OpenCliRuntimeProfileRepository } from "../storage/repositories/opencli-runtime-profile-repository.js";
import { OfficeOnlyOfficeSettingRepository } from "../storage/repositories/office-onlyoffice-setting-repository.js";
import { PluginDefinitionRepository } from "../storage/repositories/plugin-definition-repository.js";
import { PluginEnablementRepository } from "../storage/repositories/plugin-enablement-repository.js";
import { PluginPermissionGrantRepository } from "../storage/repositories/plugin-permission-grant-repository.js";
import { PluginRuntimeSessionRepository } from "../storage/repositories/plugin-runtime-session-repository.js";
import { PluginRunRepository } from "../storage/repositories/plugin-run-repository.js";
import { PortLeaseRepository } from "../storage/repositories/port-lease-repository.js";
import { ParallelSessionGroupRepository } from "../storage/repositories/parallel-session-group-repository.js";
import { ParallelSessionMemberRepository } from "../storage/repositories/parallel-session-member-repository.js";
import { ProviderControlRepository } from "../storage/repositories/provider-control-repository.js";
import { ProviderRuntimeStateRepository } from "../storage/repositories/provider-runtime-state-repository.js";
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
import { SessionIsolatedWorkspaceRepository } from "../storage/repositories/session-isolated-workspace-repository.js";
import { InstanceTailscaleRepository } from "../storage/repositories/instance-tailscale-repository.js";
import { InstanceRelayTunnelIdentityRepository } from "../storage/repositories/instance-relay-tunnel-identity-repository.js";
import { InstanceRelayTunnelRepository } from "../storage/repositories/instance-relay-tunnel-repository.js";
import { SkillTargetBindingRepository } from "../storage/repositories/skill-target-binding-repository.js";
import { TerminalCommandTemplateRepository } from "../storage/repositories/terminal-command-template-repository.js";
import { TerminalInstanceRepository } from "../storage/repositories/terminal-instance-repository.js";
import { TerminalLogFileRepository } from "../storage/repositories/terminal-log-file-repository.js";
import { TerminalLogSegmentRepository } from "../storage/repositories/terminal-log-segment-repository.js";
import { TerminalRuntimeSessionRepository } from "../storage/repositories/terminal-runtime-session-repository.js";
import { UserPreferenceProfileRepository } from "../storage/repositories/user-preference-profile-repository.js";
import { UserAffairsLibrarySettingRepository } from "../storage/repositories/user-affairs-library-setting-repository.js";
import { UserTeableGlobalSettingRepository } from "../storage/repositories/user-teable-global-setting-repository.js";
import { UserTeableWorkbenchSyncConfigRepository } from "../storage/repositories/user-teable-workbench-sync-config-repository.js";
import { UserTeableMirrorTableBindingRepository } from "../storage/repositories/user-teable-mirror-table-binding-repository.js";
import { UserTeableMirrorRecordMappingRepository } from "../storage/repositories/user-teable-mirror-record-mapping-repository.js";
import { UserTeableCredentialRepository } from "../storage/repositories/user-teable-credential-repository.js";
import { UserTeableFieldMappingRepository } from "../storage/repositories/user-teable-field-mapping-repository.js";
import { UserTeableSyncLogRepository } from "../storage/repositories/user-teable-sync-log-repository.js";
import { UserQuickPhrasePreferenceRepository } from "../storage/repositories/user-quick-phrase-preference-repository.js";
import { WorkspaceRepository } from "../storage/repositories/workspace-repository.js";
import { WorkspaceWorktreeRepository } from "../storage/repositories/workspace-worktree-repository.js";
import { WorkspaceNavigationStateRepository } from "../storage/repositories/workspace-navigation-state-repository.js";
import { createDatabaseClient } from "../storage/sqlite/client.js";
import { HttpRequestDiagnosticsTracker } from "../shared/http/request-diagnostics.js";
import { TerminalWsHub } from "../ws/terminal-ws-hub.js";
import { WorkbenchWsHub } from "../ws/workbench-ws-hub.js";
import { createWsServer } from "../ws/ws-server.js";
import { WsAuthGuard } from "../ws/ws-auth-guard.js";
import { registerStaticWebRoutes } from "./static-web.js";
import { registerWorkbenchRuntimeTerminalSync } from "./workbench-runtime-terminal-sync.js";
import type { OfficeConnector, TerminalInstance } from "../types/domain.js";
import { PluginRegistryService } from "../modules/plugins/plugin-registry-service.js";
import { PluginController } from "../modules/plugins/plugin-controller.js";
import { PluginPermissionService } from "../modules/plugins/plugin-permission-service.js";
import { PluginRuntimeSessionService } from "../modules/plugins/plugin-runtime-session-service.js";
import { PluginStaticService } from "../modules/plugins/plugin-static-service.js";
import { PluginFileGatewayService } from "../modules/plugins/plugin-file-gateway-service.js";
import { PluginProcessRunner } from "../modules/plugins/plugin-process-runner.js";
import { PluginRuntimeService } from "../modules/plugins/plugin-runtime-service.js";
import { PluginSchedulerService } from "../modules/plugins/plugin-scheduler-service.js";

export function createServer(config: HostConfig) {
  const affairsLibraryDebugLogPath = getAffairsLibraryDebugLogPath();
  if (affairsLibraryDebugLogPath) {
    process.env.CODINGNS_AFFAIRS_DEBUG_LOG_DIR = path.dirname(affairsLibraryDebugLogPath);
  }
  // Demo 模式下覆盖 token TTL 为 15 分钟
  const effectiveConfig: HostConfig = config.demoMode
    ? { ...config, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 900 }
    : config;
  const enableWechatClawHelperInTests = process.env.CODINGNS_ENABLE_WECHAT_CLAW_HELPER_IN_TESTS === "true";
  const enableWechatClawHelper = !process.env.VITEST || enableWechatClawHelperInTests;

  const app = Fastify({
    logger: false,
    routerOptions: {
      maxParamLength: 512
    }
  });
  const requestDiagnosticsTracker = new HttpRequestDiagnosticsTracker();
  let shuttingDown = false;
  const stopTerminalDebugEventLoopLagMonitor = startTerminalDebugEventLoopLagMonitor();

  const database = createDatabaseClient(config.databasePath);
  const repositories = {
    bootstrapStateRepository: new BootstrapStateRepository(database.db),
    authUserRepository: new AuthUserRepository(database.db),
    authTokenRepository: new AuthTokenRepository(database.db),
    authDeviceRepository: new AuthDeviceRepository(database.db),
    authDeviceSessionRepository: new AuthDeviceSessionRepository(database.db),
    authLoginEventRepository: new AuthLoginEventRepository(database.db),
    authLoginAttemptRepository: new AuthLoginAttemptRepository(database.db),
    peerHostRepository: new PeerHostRepository(database.db),
    peerHostSessionRepository: new PeerHostSessionRepository(database.db),
    peerHostWorkspaceBindingRepository: new PeerHostWorkspaceBindingRepository(database.db),
    assistantAutomationTaskRepository: new AssistantAutomationTaskRepository(database.db),
    assistantAutomationRunRepository: new AssistantAutomationRunRepository(database.db),
    workspaceRepository: new WorkspaceRepository(database.db),
    workspaceWorktreeRepository: new WorkspaceWorktreeRepository(database.db),
    workspaceNavigationStateRepository: new WorkspaceNavigationStateRepository(database.db),
    affairsAssistantSessionSnapshotRepository: new AffairsAssistantSessionSnapshotRepository(database.db),
    userAffairsLibrarySettingRepository: new UserAffairsLibrarySettingRepository(database.db),
    userTeableGlobalSettingRepository: new UserTeableGlobalSettingRepository(database.db),
    userTeableCredentialRepository: new UserTeableCredentialRepository(database.db),
    userTeableWorkbenchSyncConfigRepository: new UserTeableWorkbenchSyncConfigRepository(database.db),
    userTeableMirrorTableBindingRepository: new UserTeableMirrorTableBindingRepository(database.db),
    userTeableMirrorRecordMappingRepository: new UserTeableMirrorRecordMappingRepository(database.db),
    userTeableFieldMappingRepository: new UserTeableFieldMappingRepository(database.db),
    userTeableSyncLogRepository: new UserTeableSyncLogRepository(database.db),
    parallelSessionGroupRepository: new ParallelSessionGroupRepository(database.db),
    parallelSessionMemberRepository: new ParallelSessionMemberRepository(database.db),
    sessionIsolatedWorkspaceRepository: new SessionIsolatedWorkspaceRepository(database.db),
    debugTargetRepository: new DebugTargetRepository(database.db),
    debugServiceRepository: new DebugServiceRepository(database.db),
    frameworkAnalysisResultRepository: new FrameworkAnalysisResultRepository(database.db),
    debugRuntimeSessionRepository: new DebugRuntimeSessionRepository(database.db),
    officeTaskRepository: new OfficeTaskRepository(database.db),
    officeTaskStepRepository: new OfficeTaskStepRepository(database.db),
    officeArtifactRepository: new OfficeArtifactRepository(database.db),
    officeApprovalRepository: new OfficeApprovalRepository(database.db),
    officeReceiptRepository: new OfficeReceiptRepository(database.db),
    officeConnectorRepository: new OfficeConnectorRepository(database.db),
    officeAuditEventRepository: new OfficeAuditEventRepository(database.db),
    officeRollbackRecordRepository: new OfficeRollbackRecordRepository(database.db),
    officeOnlyOfficeSettingRepository: new OfficeOnlyOfficeSettingRepository(database.db),
    browserProfileRepository: new BrowserProfileRepository(database.db),
    pluginDefinitionRepository: new PluginDefinitionRepository(database.db),
    pluginEnablementRepository: new PluginEnablementRepository(database.db),
    pluginAuditEventRepository: new PluginAuditEventRepository(database.db),
    pluginPermissionGrantRepository: new PluginPermissionGrantRepository(database.db),
    pluginRuntimeSessionRepository: new PluginRuntimeSessionRepository(database.db),
    pluginRunRepository: new PluginRunRepository(database.db),
    documentTemplateRepository: new DocumentTemplateRepository(database.db),
    documentRepository: new DocumentRepository(database.db),
    documentRevisionRepository: new DocumentRevisionRepository(database.db),
    documentCommentRepository: new DocumentCommentRepository(database.db),
    opsTargetRepository: new OpsTargetRepository(database.db),
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
    channelAccountRepository: new ChannelAccountRepository(database.db),
    channelThreadRepository: new ChannelThreadRepository(database.db),
    channelInboundEventRepository: new ChannelInboundEventRepository(database.db),
    channelDeliveryRepository: new ChannelDeliveryRepository(database.db),
    projectMemoryRepository: new ProjectMemoryRepository(database.db),
    patrolPlanRepository: new PatrolPlanRepository(database.db),
    patrolRunRepository: new PatrolRunRepository(database.db),
    verificationRunRepository: new VerificationRunRepository(database.db),
    commitRuleProfileRepository: new CommitRuleProfileRepository(database.db),
    gitRemoteCredentialRepository: new GitRemoteCredentialRepository(database.db),
    managedSkillRepository: new ManagedSkillRepository(database.db),
    openCliProviderRepository: new OpenCliProviderRepository(database.db),
    openCliCatalogEntryRepository: new OpenCliCatalogEntryRepository(database.db),
    openCliRuntimeProfileRepository: new OpenCliRuntimeProfileRepository(database.db),
    providerControlRepository: new ProviderControlRepository(database.db),
    providerRuntimeStateRepository: new ProviderRuntimeStateRepository(database.db),
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
    instanceRelayTunnelIdentityRepository: new InstanceRelayTunnelIdentityRepository(database.db),
    instanceRelayTunnelRepository: new InstanceRelayTunnelRepository(database.db),
    skillTargetBindingRepository: new SkillTargetBindingRepository(database.db),
    userQuickPhrasePreferenceRepository: new UserQuickPhrasePreferenceRepository(database.db),
    userPreferenceProfileRepository: new UserPreferenceProfileRepository(database.db),
    terminalInstanceRepository: new TerminalInstanceRepository(database.db),
    terminalLogFileRepository: new TerminalLogFileRepository(database.db),
    terminalLogSegmentRepository: new TerminalLogSegmentRepository(database.db),
    terminalRuntimeSessionRepository: new TerminalRuntimeSessionRepository(database.db),
    terminalCommandTemplateRepository: new TerminalCommandTemplateRepository(database.db)
  };

  ensureDefaultOfficeConnectors(repositories.officeConnectorRepository);
  ensureDefaultDocumentTemplates(repositories.documentTemplateRepository);

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
    repositories.authDeviceRepository,
    repositories.authDeviceSessionRepository,
    repositories.authLoginEventRepository,
    repositories.authLoginAttemptRepository,
    effectiveConfig,
    demoServices
  );
  const butlerProfileService = new ButlerProfileService(
    repositories.butlerProfileRepository,
    repositories.butlerProjectRepository,
    path.dirname(config.databasePath),
    repositories.providerControlRepository
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
  const workspaceService = new WorkspaceService(
    repositories.workspaceRepository,
    gitCommandRunner,
    repositories.workspaceNavigationStateRepository,
    butlerProfileService,
    repositories.workspaceWorktreeRepository,
    taskManager,
    repositories.sessionIsolatedWorkspaceRepository
  );
  const fileAccessGuard = new FileAccessGuard(workspaceService, app.log);
  const recentFileService = new RecentFileService(repositories.recentFileRepository);
  const recentModifiedFileService = new RecentModifiedFileService(fileAccessGuard);
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
  const workspaceFileBridgeWatchService = new WorkspaceFileBridgeWatchService(
    fileAccessGuard,
    app.log
  );
  const workspaceFileBridgeService = new WorkspaceFileBridgeService(
    workspaceService,
    fileAccessGuard,
    app.log,
    workspaceFileBridgeWatchService
  );
  const workspaceIndexApplyService = new WorkspaceIndexApplyService(
    workspaceService,
    app.log
  );
  const filePreviewLinkService = new FilePreviewLinkService(
    fileAccessGuard,
    config.filePreviewTokenSecret
  );
  const pluginRegistryService = new PluginRegistryService(
    repositories.pluginDefinitionRepository,
    repositories.pluginEnablementRepository,
    repositories.pluginAuditEventRepository,
    config.pluginRootDir,
    app.log
  );
  pluginRegistryService.syncPluginsFromDisk();
  const pluginPermissionService = new PluginPermissionService(
    repositories.pluginPermissionGrantRepository,
    repositories.pluginAuditEventRepository
  );
  const pluginRuntimeSessionService = new PluginRuntimeSessionService(
    pluginRegistryService,
    repositories.pluginRuntimeSessionRepository,
    workspaceService
  );
  const pluginStaticService = new PluginStaticService(pluginRegistryService);
  const pluginFileGatewayService = new PluginFileGatewayService(
    pluginRegistryService,
    fileAccessGuard,
    pluginPermissionService,
    repositories.pluginAuditEventRepository
  );
  const pluginProcessRunner = new PluginProcessRunner();
  const pluginRuntimeService = new PluginRuntimeService(
    pluginRegistryService,
    repositories.pluginRunRepository,
    repositories.pluginAuditEventRepository,
    workspaceService,
    fileAccessGuard,
    pluginPermissionService,
    pluginProcessRunner,
    taskManager
  );
  const pluginSchedulerService = new PluginSchedulerService(
    pluginRegistryService,
    pluginRuntimeService,
    repositories.pluginAuditEventRepository,
    workspaceService,
    taskManager,
    schedulerMetrics
  );
  const presentationPdfExportService = new PresentationPdfExportService(config);
  const presentationPptxExportService = new PresentationPptxExportService(config);
  const presentationExportTaskService = new PresentationExportTaskService(
    taskManager,
    presentationPdfExportService,
    presentationPptxExportService,
    fileAccessGuard
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
  const relayTunnelService = new RelayTunnelService(
    database.db,
    repositories.bootstrapStateRepository,
    repositories.instanceRelayTunnelIdentityRepository,
    repositories.instanceRelayTunnelRepository,
    {
      // 开发态默认回源到 user-app Vite 入口，由它继续代理 /api 和 /ws 到 Host。
      // 正式 npm 包由 Host 自己托管前端，此时 webUiPort 会和 --port 一致。
      defaultLocalTargetBaseUrl: `http://127.0.0.1:${config.webUiPort}`,
      legacyLocalTargetBaseUrl:
        config.webUiPort !== config.port
          ? `http://127.0.0.1:${config.port}`
          : null,
      controlSessionSecret: config.gitCredentialSecret
    },
    taskManager,
    new RelayTunnelRuntimeEdgeAdapter(
      repositories.instanceRelayTunnelIdentityRepository,
      repositories.instanceRelayTunnelRepository,
      {
        controlSessionSecret: config.gitCredentialSecret
      }
    )
  );
  const clientService = new ClientService(
    config,
    npmGlobalPackageService,
    serviceUpdateTaskService,
    relayTunnelService
  );
  const hostHandshakeService = new HostHandshakeService(
    repositories.instanceRelayTunnelIdentityRepository
  );
  const peerHostService = new PeerHostService(
    repositories.peerHostRepository,
    repositories.peerHostSessionRepository,
    repositories.peerHostWorkspaceBindingRepository,
    config.gitCredentialSecret
  );
  const hostApiProxyService = new HostApiProxyService(peerHostService);
  const wechatClawRuntimeManager = enableWechatClawHelper
    ? new WechatClawRuntimeManager(
        path.join(path.dirname(config.databasePath), "wechat-claw-helper")
      )
    : null;
  const wechatClawRuntimeClient = wechatClawRuntimeManager
    ? new WechatClawRuntimeClient(wechatClawRuntimeManager)
    : null;
  const channelPlatformAdapterRegistry = createDefaultChannelPlatformAdapterRegistry({
    wechatClawRuntimeClient
  });
  const ccSwitchAdapter = new CcSwitchAdapter({
    commandPath: config.ccSwitchCliPath,
    dbPath: config.ccSwitchDbPath
  });
  const modelSwitchService = new ModelSwitchService(ccSwitchAdapter);
  const openCliRuntimeProfileService = new OpenCliRuntimeProfileService(
    repositories.openCliProviderRepository,
    repositories.openCliCatalogEntryRepository,
    repositories.openCliRuntimeProfileRepository,
    {
      runtimeStorageRootPath: path.dirname(config.databasePath)
    }
  );
  const openCliCatalogService = new OpenCliCatalogService(
    repositories.openCliProviderRepository,
    repositories.openCliCatalogEntryRepository
  );
  const openCliRuntimeBuilder = new OpenCliRuntimeBuilder(
    repositories.openCliRuntimeProfileRepository
  );
  const openCliHealthService = new OpenCliHealthService();
  const openCliRuntimeResolver = new OpenCliRuntimeResolver(
    repositories.openCliProviderRepository,
    repositories.openCliRuntimeProfileRepository,
    openCliRuntimeProfileService,
    openCliRuntimeBuilder
  );
  const openCliManagementService = new OpenCliManagementService(
    repositories.openCliProviderRepository,
    repositories.openCliCatalogEntryRepository,
    repositories.openCliRuntimeProfileRepository,
    openCliCatalogService,
    openCliHealthService,
    openCliRuntimeResolver
  );
  const openCliSessionPromptService = new OpenCliSessionPromptService(
    repositories.openCliProviderRepository,
    repositories.openCliCatalogEntryRepository
  );
  const openCliBridgeSkillService = new OpenCliBridgeSkillService(
    repositories.openCliProviderRepository,
    repositories.openCliCatalogEntryRepository
  );
  const openCliController = new OpenCliController(openCliManagementService);
  const workspaceSessionAuthService = new WorkspaceSessionAuthService(authService, config);
  const workspaceSessionRuntimeContextService = new WorkspaceSessionRuntimeContextService(
    workspaceSessionAuthService,
    {
      codexHomeDir: config.codexHomeDir,
      claudeCodeHomeDir: config.claudeCodeHomeDir,
      runtimeStorageRootDir: path.dirname(config.databasePath)
    }
  );
  const workspaceSessionInstructionWatchService = new WorkspaceSessionInstructionWatchService(
    workspaceService,
    ({ workspaceId, workspacePath, reason }) => {
      const result = workspaceSessionRuntimeContextService.refreshWorkspaceInstructionBundlesForWorkspace({
        workspaceId,
        workspacePath
      });
      app.log.info(
        {
          workspaceId,
          workspacePath,
          reason,
          refreshedCount: result.refreshedCount,
          scannedRuntimeHomeDirs: result.scannedRuntimeHomeDirs,
          updatedInstructionFiles: result.updatedInstructionFiles,
          source: "workspace_session.agents_watch"
        },
        "工作区会话 instruction bundle 已按最新 AGENTS.md 重写"
      );
    },
    app.log
  );
  workspaceSessionInstructionWatchService.syncAll();
  const sessionProviderConfigService = new SessionProviderConfigService(
    config,
    ccSwitchAdapter,
    openCliRuntimeResolver,
    openCliBridgeSkillService,
    workspaceSessionRuntimeContextService
  );
  const skillTargetAdapters = createDefaultSkillTargetAdapters(config);
  const skillManagerService = new SkillManagerService(
    repositories.managedSkillRepository,
    repositories.skillTargetBindingRepository,
    skillTargetAdapters,
    {
      ssotRootDir: path.join(path.dirname(config.databasePath), "skills"),
      providerControlRepository: repositories.providerControlRepository,
      runtimeStorageRootDir: path.dirname(config.databasePath),
      workspaceRootResolver: (workspaceId: string) =>
        workspaceService.getWorkspaceOrThrow(workspaceId).path
    }
  );
  for (const result of cleanupLegacyAssistantRuntimeSkillCopies(skillTargetAdapters)) {
    if (result.status === "removed_legacy_copy") {
      console.info(`[host] 已清理公共 Skill 根目录里的旧助手副本 ${result.targetCli}: ${result.targetPath}`);
      continue;
    }

    if (result.status === "kept_drifted_copy" || result.status === "invalid_entry") {
      console.warn(
        `[host] 保留公共 Skill 根目录里的助手专用目录 ${result.targetCli}: ${result.targetPath} (${result.detail ?? "unknown"})`
      );
    }
  }
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
  const providerRuntimeStateService = new ProviderRuntimeStateService(
    config,
    repositories.providerRuntimeStateRepository
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
    config,
    sessionActivityAuthorityService,
    repositories.sessionMessageOriginRepository,
    repositories.sessionForkRepository,
    {},
    taskManager,
    repositories.parallelSessionGroupRepository,
    repositories.parallelSessionMemberRepository,
    repositories.sessionIsolatedWorkspaceRepository,
    sessionProviderConfigService,
    repositories.providerControlRepository,
    providerRuntimeStateService
  );
  const providerCatalogService = new ProviderCatalogService(
    config,
    repositories.providerControlRepository,
    providerRuntimeStateService
  );
  runtimeObservabilityService = new RuntimeObservabilityService(
    () => sessionHistoryService.observeBackgroundTaskMetrics(),
    () => taskManager.listDefinitions(),
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
    sessionProviderConfigService,
    config,
    sessionActivityAuthorityService,
    openCliSessionPromptService,
    workspaceSessionRuntimeContextService
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
    sessionProviderConfigService,
    butlerRuntimeConfig,
    sessionActivityAuthorityService,
    openCliSessionPromptService
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
    sessionProviderConfigService,
    butlerSummaryRuntimeConfig,
    sessionActivityAuthorityService,
    openCliSessionPromptService
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
    sessionProviderConfigService,
    butlerFollowUpRuntimeConfig,
    sessionActivityAuthorityService,
    openCliSessionPromptService
  );
  sessionHistoryService.registerLiveActivityObservationResolver((sessionId) =>
    butlerFollowUpSessionLiveRuntimeService.resolveLiveActivityObservation(sessionId)
  );
  const routedSessionLiveRuntimeService = new SessionLiveRuntimeRouterService(
    sessionLiveRuntimeService,
    [
      butlerSessionLiveRuntimeService,
      butlerSummarySessionLiveRuntimeService,
      butlerFollowUpSessionLiveRuntimeService
    ]
  );
  const sessionProviderUsageLimitGuardService = new SessionProviderUsageLimitGuardService(
    sessionHistoryService
  );
  let parallelSessionGroupService!: ParallelSessionGroupService;
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
    repositories.sessionMessageOriginRepository,
    sessionProviderUsageLimitGuardService
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
    config.codexHomeDir,
    butlerRuntimeConfig.claudeCodeHomeDir,
    config.claudeCodeHomeDir
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
    repositories.sessionMessageOriginRepository,
    sessionProviderUsageLimitGuardService
  );
  const butlerActionContextService = new ButlerActionContextService(
    butlerProjectService,
    butlerSessionService,
    butlerFollowUpService,
    verificationRunService
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
    butlerRuntimeConfig.claudeCodeHomeDir,
    config.claudeCodeHomeDir,
    repositories.sessionMessageOriginRepository,
    sessionProviderUsageLimitGuardService,
    repositories.providerControlRepository
  );
  const channelBridgeService = new ChannelBridgeService(
    repositories.channelAccountRepository,
    repositories.channelThreadRepository,
    repositories.channelInboundEventRepository,
    butlerControlSessionService
  );
  const channelDeliveryService = new ChannelDeliveryService(
    repositories.channelAccountRepository,
    repositories.channelThreadRepository,
    repositories.channelInboundEventRepository,
    repositories.channelDeliveryRepository,
    sessionHistoryService,
    channelPlatformAdapterRegistry,
    taskManager
  );
  channelDeliveryService.recoverRetryableDeliveries();
  const channelGatewayService = new ChannelGatewayService(
    repositories.channelAccountRepository,
    channelPlatformAdapterRegistry,
    channelBridgeService,
    channelDeliveryService
  );
  const channelPollingService = new ChannelPollingService(
    repositories.channelAccountRepository,
    channelPlatformAdapterRegistry,
    channelBridgeService,
    channelDeliveryService,
    taskManager,
    {
      logger: app.log,
      wechatClawRuntimeClient
    }
  );
  const channelPollingScheduler = new ChannelPollingScheduler(
    channelPollingService,
    {
      schedulerMetrics
    }
  );
  const channelsService = new ChannelService(
    repositories.channelAccountRepository,
    repositories.channelThreadRepository,
    repositories.channelInboundEventRepository,
    repositories.channelDeliveryRepository,
    repositories.providerControlRepository,
    channelPlatformAdapterRegistry,
    channelPollingService,
    wechatClawRuntimeClient
  );
  const assistantAutomationService = new AssistantAutomationService(
    butlerProfileService,
    butlerControlSessionService,
    repositories.assistantAutomationTaskRepository,
    repositories.assistantAutomationRunRepository,
    taskManager,
    {
      gitCommandRunner,
      sessionLiveRuntimeService: butlerSessionLiveRuntimeService
    }
  );
  const butlerControlTimerService = new ButlerControlTimerService(
    butlerProfileService,
    butlerControlSessionService,
    repositories.butlerControlTimerRepository,
    assistantAutomationService
  );
  const butlerControlTimerScheduler = new ButlerControlTimerScheduler(
    butlerControlTimerService,
    {
      schedulerMetrics
    }
  );
  const butlerFollowUpTerminalSubscription = sessionLiveRuntimeService.registerTerminalStateListener(
    async (event) => {
      await butlerFollowUpService.handleSessionTerminal(event.sessionId, event.timestamp);
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
    preferenceProfileService,
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
  const worktreeManager = new WorktreeManager(
    workspaceService,
    repositories.workspaceWorktreeRepository,
    gitReadService,
    gitCommandRunner,
    commandTemplateService
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
  const sessionIsolatedWorkspaceService = new SessionIsolatedWorkspaceService(
    repositories.sessionIsolatedWorkspaceRepository,
    repositories.workspaceWorktreeRepository,
    workspaceService,
    gitReadService,
    gitCommandRunner,
    commandTemplateService
  );
  parallelSessionGroupService = new ParallelSessionGroupService(
    repositories.parallelSessionGroupRepository,
    repositories.parallelSessionMemberRepository,
    repositories.sessionIsolatedWorkspaceRepository,
    sessionHistoryService,
    sessionLiveRuntimeService,
    sessionIsolatedWorkspaceService
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
  const codexArchiveWatcher = new CodexArchiveWatcher(config.codexHomeDir);
  const affairsLibraryService = new AffairsLibraryService(
    workspaceService,
    repositories.workspaceNavigationStateRepository,
    repositories.userAffairsLibrarySettingRepository,
    taskManager,
    app.log
  );
  fileContentService.setFileMutationHook((event) => {
    affairsLibraryService.notifyWorkspaceFileMutation(event.workspaceId, {
      absolutePath: event.absolutePath,
      kind: event.kind
    });
  });
  workspaceFileBridgeService.setMutationHook((event) => {
    affairsLibraryService.notifyWorkspaceFileMutation(event.workspaceId, {
      absolutePath: event.absolutePath,
      kind: event.kind
    });
  });
  pluginFileGatewayService.setMutationHook((event) => {
    affairsLibraryService.notifyWorkspaceFileMutation(event.workspaceId, {
      absolutePath: event.absolutePath,
      kind: event.kind
    });
  });
  const affairsLibraryDirtyWatchService = new AffairsLibraryDirtyWatchService(
    () => affairsLibraryService.listEnabledBindingsForWatch(),
    (workspaceId) => affairsLibraryService.getBindingForWatch(workspaceId),
    (workspaceId, event) => {
      if (event.kind === "config") {
        affairsLibraryService.scheduleAutoApplyConfig(workspaceId, event.reason);
        return;
      }
      if (event.kind === "audit") {
        affairsLibraryService.schedulePeriodicAudit(workspaceId, event.reason);
        return;
      }
      affairsLibraryService.scheduleAutoRefresh(workspaceId, event.reason, event.targetPath);
    },
    app.log
  );
  affairsLibraryDirtyWatchService.syncAll();
  const affairsLibraryPreviewLinkService = new AffairsLibraryPreviewLinkService(
    affairsLibraryService,
    config.filePreviewTokenSecret
  );
  const affairsAssistantSessionSnapshotService = new AffairsAssistantSessionSnapshotService(
    repositories.affairsAssistantSessionSnapshotRepository,
    affairsLibraryService,
    butlerProjectService,
    butlerSessionService,
    taskManager
  );
  const workbenchService = new WorkbenchService(
    repositories.workspaceRepository,
    repositories.workspaceNavigationStateRepository,
    sessionHistoryService,
    butlerProfileService,
    repositories.butlerControlSessionRepository,
    repositories.workspaceWorktreeRepository,
    taskManager,
    repositories.sessionIsolatedWorkspaceRepository,
    affairsAssistantSessionSnapshotService
  );
  const onlyOfficeIntegrationService = new OnlyOfficeIntegrationService(
    repositories.officeOnlyOfficeSettingRepository,
    filePreviewLinkService,
    affairsLibraryPreviewLinkService,
    fileAccessGuard,
    affairsLibraryService,
    config.filePreviewTokenSecret
  );
  const affairsLightweightSessionService = new AffairsLightweightSessionService(
    path.dirname(config.databasePath)
  );
  const teableCredentialService = new TeableCredentialService(
    repositories.userTeableCredentialRepository,
    config.teableCredentialSecret
  );
  const teableGlobalBindingService = new TeableGlobalBindingService(
    repositories.userTeableGlobalSettingRepository,
    teableCredentialService
  );
  const teableWorkbenchSyncConfigService = new TeableWorkbenchSyncConfigService(
    repositories.userTeableWorkbenchSyncConfigRepository
  );
  const teableCatalogService = new TeableCatalogService(
    teableGlobalBindingService,
    teableCredentialService,
    config.filePreviewTokenSecret
  );
  const teableRuntimeService = new TeableRuntimeService(
    teableGlobalBindingService,
    teableCredentialService
  );
  const teableFieldMappingService = new TeableFieldMappingService(
    repositories.userTeableFieldMappingRepository,
    repositories.userTeableWorkbenchSyncConfigRepository
  );


  const bootstrapController = new BootstrapController(bootstrapService);
  const clientController = new ClientController(clientService);
  const channelController = new ChannelController(channelsService);
  const channelGatewayController = new ChannelGatewayController(channelGatewayService);
  const debugTargetController = new DebugTargetController(debugTargetService);
  const handleDebugTargetTerminalExit = (event: {
    terminal: TerminalInstance;
    requestedClose: boolean;
  }) => {
    void debugTargetService.handleTerminalExit(event);
  };
  terminalService.on("exit", handleDebugTargetTerminalExit);
  const authController = new AuthController(authService);
  const workspaceController = new WorkspaceController(
    workspaceService,
    (workspaceId) => {
      workspaceSessionInstructionWatchService.syncWorkspace(workspaceId);
    }
  );
  const affairsLibraryController = new AffairsLibraryController(
    affairsLibraryService,
    affairsLibraryPreviewLinkService,
    onlyOfficeIntegrationService,
    (workspaceId) => {
      const normalizedWorkspaceId = workspaceId?.trim() ?? "";
      if (!normalizedWorkspaceId) {
        return;
      }
      affairsLibraryDirtyWatchService.syncWorkspace(normalizedWorkspaceId);
      if (normalizedWorkspaceId === AFFAIRS_GLOBAL_WORKSPACE_ID) {
        return;
      }
      workspaceSessionInstructionWatchService.syncWorkspace(normalizedWorkspaceId);
    }
  );
  const affairsLightweightSessionController = new AffairsLightweightSessionController(
    affairsLightweightSessionService
  );
  const teableGlobalBindingController = new TeableGlobalBindingController(
    teableGlobalBindingService
  );
  const teableWorkbenchSyncConfigController = new TeableWorkbenchSyncConfigController(
    teableWorkbenchSyncConfigService
  );
  const teableCatalogController = new TeableCatalogController(
    teableCatalogService
  );
  const teableRuntimeController = new TeableRuntimeController(
    teableRuntimeService
  );
  const teableFieldMappingController = new TeableFieldMappingController(
    teableFieldMappingService
  );

  const affairsTagService = new AffairsTagService(
    workspaceService,
    affairsLibraryService,
    taskManager
  );
  const teableMirrorSyncService = new TeableMirrorSyncService(
    repositories.userTeableMirrorTableBindingRepository,
    repositories.userTeableMirrorRecordMappingRepository,
    taskManager,
    teableGlobalBindingService,
    teableCredentialService,
    teableWorkbenchSyncConfigService,
    affairsTagService,
    affairsLightweightSessionService,
    repositories.butlerInboxItemRepository,
    repositories.butlerProjectRepository,
    repositories.butlerFollowUpTaskRepository,
    repositories.workspaceRepository,
    teableFieldMappingService,
    repositories.userTeableSyncLogRepository
  );
  const requestTeableLocalChangeSyncForUser = (
    userId: string,
    mirrorTypes: Array<"tags" | "sessions" | "todos">,
    reason: string
  ) => {
    teableMirrorSyncService.requestLocalChangeMirrorSync(userId, {
      mirrorTypes,
      reason
    });
  };
  const requestTeableTodoLocalChangeSync = (reason: string) => {
    for (const userId of repositories.authUserRepository.listIds()) {
      requestTeableLocalChangeSyncForUser(userId, ["todos"], reason);
    }
  };
  affairsTagService.configureTeableMirrorSyncNotifier((userId, reason) => {
    requestTeableLocalChangeSyncForUser(userId, ["tags"], reason);
  });
  affairsLightweightSessionService.configureTeableMirrorSyncNotifier((userId, reason) => {
    requestTeableLocalChangeSyncForUser(userId, ["sessions"], reason);
  });
  butlerInboxService.configureTeableMirrorSyncNotifier(requestTeableTodoLocalChangeSync);
  butlerFollowUpService.configureTeableMirrorSyncNotifier(requestTeableTodoLocalChangeSync);
  const teableMirrorSyncController = new TeableMirrorSyncController(teableMirrorSyncService);

  const affairsTagController = new AffairsTagController(affairsTagService);
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
    butlerControlTimerService,
    affairsLibraryService
  );
  const sessionController = new SessionController(
    sessionHistoryService,
    routedSessionLiveRuntimeService,
    repositories.butlerControlSessionRepository
  );
  const parallelSessionController = new ParallelSessionController(
    parallelSessionGroupService,
    sessionIsolatedWorkspaceService
  );
  const providerController = new ProviderController(
    sessionHistoryService,
    sessionProviderConfigService,
    providerCatalogService,
    routedSessionLiveRuntimeService,
    config
  );
  const skillController = new SkillController(skillManagerService);
  const tailscaleController = new TailscaleController(tailscaleService);
  const relayTunnelController = new RelayTunnelController(relayTunnelService);
  const modelSwitchController = new ModelSwitchController(modelSwitchService);
  const hostResourceController = new HostResourceController(
    new HostResourceService(path.dirname(config.databasePath))
  );
  const quickPhraseController = new QuickPhraseController(quickPhraseService);
  const profileController = new ProfileController(preferenceProfileService);
  const officeService = new OfficeService(
    repositories.officeTaskRepository,
    repositories.officeTaskStepRepository,
    repositories.officeArtifactRepository,
    repositories.officeApprovalRepository,
    repositories.officeReceiptRepository,
    repositories.officeConnectorRepository,
    repositories.officeAuditEventRepository,
    repositories.officeRollbackRecordRepository,
    config.databasePath
  );
  const officePreviewLinkService = new OfficePreviewLinkService(
    officeService,
    config.filePreviewTokenSecret
  );
  const officeController = new OfficeController(
    officeService,
    officePreviewLinkService,
    onlyOfficeIntegrationService
  );
  const pluginController = new PluginController(
    pluginRegistryService,
    pluginRuntimeService,
    pluginStaticService,
    pluginRuntimeSessionService,
    pluginFileGatewayService,
    pluginPermissionService
  );
  const browserProfileService = new BrowserProfileService(
    repositories.browserProfileRepository,
    config.databasePath
  );
  const playwrightBrowserExecutor = new PlaywrightBrowserExecutor(
    config,
    repositories.officeTaskRepository,
    repositories.officeTaskStepRepository,
    repositories.officeArtifactRepository,
    repositories.officeReceiptRepository,
    repositories.officeAuditEventRepository
  );
  const openCliBrowserBridgeService = new OpenCliBrowserBridgeService(openCliHealthService);
  const openCliBridgeBrowserExecutor = new OpenCliBridgeBrowserExecutor(
    config.databasePath,
    repositories.officeTaskRepository,
    repositories.officeTaskStepRepository,
    repositories.officeArtifactRepository,
    repositories.officeReceiptRepository,
    repositories.officeAuditEventRepository,
    openCliHealthService
  );
  const browserRuntimeService = new BrowserRuntimeService(
    browserProfileService,
    officeService,
    repositories.officeTaskRepository,
    [
      playwrightBrowserExecutor,
      openCliBridgeBrowserExecutor
    ],
    openCliBrowserBridgeService,
    taskManager
  );
  const browserRuntimeController = new BrowserRuntimeController(browserRuntimeService);
  const documentRuntimeService = new DocumentRuntimeService(
    repositories.documentTemplateRepository,
    repositories.documentRepository,
    repositories.documentRevisionRepository,
    repositories.documentCommentRepository,
    officeService,
    taskManager,
    new DocumentExportExecutor(
      config,
      repositories.officeTaskRepository,
      repositories.officeTaskStepRepository,
      repositories.officeArtifactRepository,
      repositories.officeReceiptRepository,
      repositories.officeAuditEventRepository
    ),
    path.join(path.dirname(config.databasePath), "document-templates")
  );
  const documentRuntimeController = new DocumentRuntimeController(documentRuntimeService);
  const sshOpsExecutor = new SshOpsExecutor(
    config,
    repositories.officeTaskRepository,
    repositories.officeTaskStepRepository,
    repositories.officeArtifactRepository,
    repositories.officeReceiptRepository,
    repositories.officeAuditEventRepository
  );
  const opsRuntimeService = new OpsRuntimeService(
    repositories.opsTargetRepository,
    browserProfileService,
    officeService,
    repositories.officeTaskRepository,
    sshOpsExecutor,
    taskManager
  );
  const opsRuntimeController = new OpsRuntimeController(opsRuntimeService);
  const assistantCapabilityController = new AssistantCapabilityController(
    new AssistantCapabilityService(
      butlerProjectService,
      butlerSessionService,
      butlerControlSessionService,
      assistantAutomationService,
      butlerControlTimerService,
      sessionHistoryService,
      sessionLiveRuntimeService,
      terminalService,
      debugTargetService,
      workspaceService,
      repositories.workspaceWorktreeRepository,
      worktreeManager,
      worktreeSyncService,
      worktreeMergeService,
      worktreeCleanupService,
      repositories.sessionMessageOriginRepository,
      butlerFollowUpService,
      repositories.providerControlRepository,
      documentRuntimeService,
      officeService,
      officePreviewLinkService,
      browserRuntimeService,
      opsRuntimeService
    )
  );
  const hostHandshakeController = new HostHandshakeController(hostHandshakeService);
  const peerHostController = new PeerHostController(peerHostService);
  const hostApiProxyController = new HostApiProxyController(hostApiProxyService);
  const presentationController = new PresentationController(presentationExportTaskService);
  const fileController = new FileController(
    fileTreeService,
    fileContentService,
    fileSearchService,
    recentFileService,
    recentModifiedFileService,
    filePreviewService,
    filePreviewLinkService,
    affairsLibraryPreviewLinkService,
    affairsLibraryService,
    onlyOfficeIntegrationService,
    workspaceFileBridgeService,
    workspaceIndexApplyService
  );
  const fileContextController = new FileContextController(
    fileContentService,
    fileContextService
  );
  const gitController = new GitController(
    gitReadService,
    gitWriteService,
    commitOrchestrator,
    gitRemoteCredentialService
  );
  const terminalController = new TerminalController(terminalService, commandTemplateService);
  const observabilityController = new ObservabilityController(runtimeObservabilityService);
  const workbenchWsHub = new WorkbenchWsHub(
    workbenchService,
    workspacePanelSnapshotService,
    fileWatcher,
    terminalService,
    codexArchiveWatcher
  );
  const sessionTitleChangedWorkbenchSync = sessionHistoryService.registerSessionTitleChangedObserver(
    (event) => {
      void workbenchWsHub.broadcastSnapshot(event.userId).catch((error) => {
        app.log.warn(
          {
            error,
            userId: event.userId,
            sessionId: event.sessionId
          },
          "session title change workbench broadcast failed"
        );
      });
    }
  );
  const wsHandle = createWsServer(
    app.server,
    new WsAuthGuard(authService),
    sessionHistoryService,
    routedSessionLiveRuntimeService,
    new TerminalWsHub(terminalService),
    workbenchWsHub,
    butlerActionContextService,
    new HostWsProxyService(new WsAuthGuard(authService), peerHostService)
  );
  const workbenchRuntimeTerminalSync = registerWorkbenchRuntimeTerminalSync({
    authUserRepository: repositories.authUserRepository,
    sessionHistoryService,
    workbenchWsHub,
    runtimeServices: [
      sessionLiveRuntimeService,
      butlerSessionLiveRuntimeService,
      butlerSummarySessionLiveRuntimeService,
      butlerFollowUpSessionLiveRuntimeService
    ]
  });

  app.server.on("upgrade", (request, socket, head) => {
    templateReverseProxyService.handleWebSocketUpgrade(request, socket, head);
  });

  app.addHook("onRequest", async (request, reply) => {
    const requestDiagnosticsId = requestDiagnosticsTracker.begin(request);
    requestDiagnosticsTracker.watchReply(requestDiagnosticsId, reply);
    request.raw.once("aborted", () => {
      requestDiagnosticsTracker.markAborted(requestDiagnosticsId);
    });
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) {
        requestDiagnosticsTracker.markAborted(requestDiagnosticsId);
      }
    });
    reply.raw.once("finish", () => {
      requestDiagnosticsTracker.finish(requestDiagnosticsId, reply, request);
    });
    request.requestDiagnosticsId = requestDiagnosticsId;
  });
  app.addHook("onResponse", async (request, reply) => {
    if (typeof request.requestDiagnosticsId === "number") {
      requestDiagnosticsTracker.finish(request.requestDiagnosticsId, reply, request);
    }
  });
  app.addHook("onRequest", async (request, reply) => {
    applyCorsHeaders(request.headers.origin, reply, config.demoMode, config.allowedCorsOrigins);

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
    void relayTunnelService.restoreOnStartup().catch((error) => {
      if (shuttingDown) {
        return;
      }

      console.error("[startup-recovery] CodingNS Connect 启动恢复失败", {
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

  void registerPublicRoutes(app, bootstrapController, channelGatewayController, hostHandshakeController);
  void registerPluginPublicRoutes(app, pluginController);
  void registerProxyRoutes(app, templateReverseProxyService);
  void registerAuthRoutes(app, authController);
  void registerPeerHostRoutes(app, peerHostController, hostApiProxyController);
  void registerAssistantCapabilityRoutes(app, assistantCapabilityController);
  void registerChannelRoutes(app, channelController);
  void registerClientRoutes(app, clientController);
  void registerDebugTargetRoutes(app, debugTargetController);
  void registerObservabilityRoutes(app, observabilityController);
  void registerOfficeRoutes(app, officeController);
  void registerBrowserRuntimeRoutes(app, browserRuntimeController);
  void registerDocumentRuntimeRoutes(app, documentRuntimeController);
  void registerOpsRuntimeRoutes(app, opsRuntimeController);
  void registerAffairsRoutes(
    app,
    affairsLibraryController,
    teableGlobalBindingController,
    teableMirrorSyncController,
    teableWorkbenchSyncConfigController,
    teableCatalogController,
    teableFieldMappingController,
    affairsTagController,
    affairsLightweightSessionController,
    teableRuntimeController
  );
  void registerWorkspaceRoutes(
    app,
    workspaceController,
    affairsLibraryController,
    affairsLightweightSessionController,
    affairsTagController
  );
  void registerWorktreeRoutes(app, worktreeController);
  void registerWorkbenchRoutes(app, workbenchController);
  void registerButlerRoutes(app, butlerController);
  void registerSessionRoutes(app, sessionController);
  void registerParallelGroupRoutes(app, parallelSessionController);
  void registerPresentationRoutes(app, presentationController);
  void registerPluginRoutes(app, pluginController);
  void registerPreferenceRoutes(app, quickPhraseController, profileController);
  void registerSkillRoutes(app, skillController);
  void registerOpenCliRoutes(app, openCliController);
  void registerSystemRoutes(
    app,
    tailscaleController,
    relayTunnelController,
    modelSwitchController,
    hostResourceController
  );
  void registerFileRoutes(app, fileController);
  void registerSessionContextRoutes(app, fileContextController);
  void registerTerminalRoutes(app, terminalController);
  void registerProviderRoutes(app, providerController);
  void registerGitRoutes(app, gitController);
  patrolScheduler.start();
  sessionSummaryScheduler.start();
  butlerFollowUpScheduler.start();
  butlerControlTimerScheduler.start();
  channelPollingScheduler.start();
  debugRuntimeReconciliationScheduler.start();
  pluginSchedulerService.start();

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
    await channelPollingScheduler.dispose();
    await debugRuntimeReconciliationScheduler.dispose();
    await pluginSchedulerService.dispose();
    terminalService.off("exit", handleDebugTargetTerminalExit);
    await terminalService.dispose();
    await butlerFollowUpSessionLiveRuntimeService.dispose();
    await butlerSummarySessionLiveRuntimeService.dispose();
    await butlerSessionLiveRuntimeService.dispose();
    await sessionLiveRuntimeService.dispose();
    workspaceSessionInstructionWatchService.dispose();
    affairsLibraryDirtyWatchService.dispose();
    affairsLibraryService.dispose();
    sessionTitleChangedWorkbenchSync.close();
    workbenchRuntimeTerminalSync.close();
    await wsHandle.close();
    codexArchiveWatcher.dispose();
    fileWatcher.dispose();
    workspaceFileBridgeWatchService.dispose();
    config.opencodeBaseUrlResolver?.dispose?.();
    gitCommandRunner.dispose();
    tailscaleHelperClient.dispose();
    wechatClawRuntimeManager?.dispose();
    disposeSharedTaskHelperPool();
    disposeSharedProviderDiscoveryHelperClient();
    disposeSharedOpenCodeSystemProbeHelperClient();
    database.close();
  });

  return {
    app,
    diagnostics: {
      requestDiagnosticsTracker
    },
    services: {
      config,
      database,
      repositories,
      modules: {
        bootstrapService,
        clientService,
        channelsService,
        channelBridgeService,
        channelDeliveryService,
        channelGatewayService,
        channelPollingService,
        channelPollingScheduler,
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
        officeService,
        browserProfileService,
        pluginRegistryService,
        pluginRuntimeSessionService,
        pluginRuntimeService,
        pluginSchedulerService,
        documentRuntimeService,
        opsRuntimeService,
        runtimeObservabilityService,
        sessionHistoryService,
        sessionChangedFileService,
        sessionMessageAttachmentService,
        sessionLiveRuntimeService,
        parallelSessionGroupService,
        terminalService,
        commandTemplateService
      }
    },
    startWs: () => wsHandle
  };
}

function ensureDefaultOfficeConnectors(
  repository: Pick<OfficeConnectorRepository, "findByKey" | "create">
): void {
  const timestamp = new Date().toISOString();
  const defaults: Array<Omit<OfficeConnector, "id" | "createdAt" | "updatedAt">> = [
    {
      connectorKey: "browser.playwright",
      kind: "browser",
      displayName: "Playwright Browser",
      capabilityJson: JSON.stringify({
        supportedTaskTypes: ["browser", "ops"],
        supportedActions: ["goto", "click", "fill", "upload", "download", "read_dom", "screenshot"],
        supportedArtifacts: ["screenshot", "ocr_result", "downloaded_file", "dom_snapshot"],
        supportsSubscription: false
      }),
      status: "active"
    },
    {
      connectorKey: "browser.opencli_bridge",
      kind: "browser",
      displayName: "OpenCLI Bridge Browser",
      capabilityJson: JSON.stringify({
        supportedTaskTypes: ["browser"],
        supportedActions: ["goto", "click", "fill", "upload", "download", "read_dom", "screenshot"],
        supportedArtifacts: ["screenshot", "downloaded_file", "dom_snapshot"],
        supportsSubscription: false
      }),
      status: "active"
    },
    {
      connectorKey: "document.doct",
      kind: "document",
      displayName: "doct Document Runtime",
      capabilityJson: JSON.stringify({
        supportedTaskTypes: ["document"],
        supportedActions: ["validate_template", "render_docx", "render_pdf", "render_md"],
        supportedArtifacts: ["document_export"],
        supportsSubscription: false
      }),
      status: "active"
    },
    {
      connectorKey: "ops.ssh",
      kind: "ops",
      displayName: "SSH Ops Runtime",
      capabilityJson: JSON.stringify({
        supportedTaskTypes: ["ops"],
        supportedActions: ["run_command", "collect_log"],
        supportedArtifacts: ["command_log", "custom"],
        supportsSubscription: false
      }),
      status: "active"
    },
    {
      connectorKey: "ops.browser_console",
      kind: "ops",
      displayName: "Browser Console Ops Runtime",
      capabilityJson: JSON.stringify({
        supportedTaskTypes: ["ops"],
        supportedActions: ["login_console", "goto", "click", "fill", "download", "screenshot"],
        supportedArtifacts: ["screenshot", "dom_snapshot", "downloaded_file"],
        supportsSubscription: false
      }),
      status: "active"
    },
    {
      connectorKey: "file.workspace",
      kind: "external",
      displayName: "Workspace File Runtime",
      capabilityJson: JSON.stringify({
        supportedTaskTypes: ["document", "workflow"],
        supportedActions: ["read_file", "write_file", "list_files"],
        supportedArtifacts: ["custom"],
        supportsSubscription: false
      }),
      status: "active"
    }
  ];

  for (const item of defaults) {
    if (repository.findByKey(item.connectorKey)) {
      continue;
    }

    repository.create({
      id: item.connectorKey,
      ...item,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }
}

function ensureDefaultDocumentTemplates(
  repository: Pick<DocumentTemplateRepository, "findByKey" | "create">
): void {
  if (repository.findByKey("default.doct.standard")) {
    return;
  }

  const timestamp = new Date().toISOString();
  repository.create({
    id: "default.doct.standard@v1",
    templateKey: "default.doct.standard",
    displayName: "默认正式文档模板",
    engine: "doct",
    templateVersion: "v1",
    templateSourcePath: null,
    schemaJson: JSON.stringify({
      requiredFields: ["title", "body"],
      optionalFields: ["summary", "outline", "references", "annotations"]
    }),
    mappingJson: JSON.stringify({
      title: "document.title",
      summary: "revision.summary",
      sections: "content.blocks",
      references: "content.references",
      annotations: "document.comments"
    }),
    outputFormatsJson: JSON.stringify(["docx", "pdf", "md"]),
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function applyCorsHeaders(origin: string | undefined, reply: {
  header: (name: string, value: string) => unknown;
}, demoMode: boolean, extraAllowedOrigins: readonly string[]): void {
  const allowedOrigin = resolveAllowedCorsOrigin(origin, demoMode, extraAllowedOrigins);

  if (!allowedOrigin) {
    return;
  }

  reply.header("Access-Control-Allow-Origin", allowedOrigin);
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Credentials", "true");
  reply.header("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
  reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
}

const CORS_ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
  "x-codingns-client-type",
  "x-codingns-client-instance-id",
  "x-codingns-assistant-source",
  "x-codingns-hook-token"
].join(", ");

function resolveAllowedCorsOrigin(
  origin: string | undefined,
  demoMode: boolean,
  extraAllowedOrigins: readonly string[]
): string | null {
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

    if (extraAllowedOrigins.includes(parsed.origin)) {
      return parsed.origin;
    }

    return null;
  } catch {
    return null;
  }
}
