import { httpClient } from "../../../network/http-client";
import { getHostRequestUrl } from "../../../config/env";
import { ApiError } from "../../../shared/network/api-error";
import type { FileNodeDto } from "./file-context-api";

export type BuiltinProviderId =
  | "claude-code"
  | "legna-code"
  | "codex"
  | "opencode"
  | "gemini"
  | "kimi";
export type ProviderId = BuiltinProviderId | (string & {});
export type SyncStatus = "idle" | "syncing" | "error";
export type DeliveryState = "sending" | "sent" | "failed";
export type MessageKind = "text" | "thinking" | "tool_call" | "tool_result";
export type SessionRunningState =
  | "idle"
  | "starting"
  | "running"
  | "reconnecting"
  | "stale"
  | "unknown"
  | "completed"
  | "interrupted"
  | "failed";
export type SessionActivityState = "idle" | "running" | "completed_unread";
export type InRunInputMode = "none" | "streaming_guidance" | "queued_guidance";
export type SessionActivitySource = "none" | "runtime" | "inferred";
export type SessionActivityResolutionSource =
  | "authoritative_runtime"
  | "authoritative_provider_event"
  | "inferred_log"
  | "unknown";
export type SessionActivityConfidence = "authoritative" | "strong" | "weak";
export type SessionInterruptSource = "user" | "runtime";
export type HistoryDirection = "forward" | "backward";
export type SessionKind = "default" | "annotation";
export type SessionProviderConfigMode = "global-default" | "cc-switch-preset";
export type ForkSourceType = "session" | "message";
export type ForkMethod =
  | "native_session_fork"
  | "native_message_fork"
  | "reconstructed_session_fork"
  | "reconstructed_message_fork";
export type ForkStrategy = "auto" | "native-only" | "reconstruct-only";

export interface ForkSourceMessageSnapshotDto {
  role: "user" | "assistant" | "tool" | "system";
  kind: MessageKind;
  content: string;
}

export interface ToolCallDto {
  callId: string;
  name: string;
  input: string;
  output: string | null;
  error: string | null;
  status: "running" | "completed" | "failed";
}

export interface MessageAttachmentDto {
  id: string;
  kind: "image" | "file";
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface AttachmentPayload {
  kind: "image" | "file";
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  path: string;
  repoRoot: string | null;
  backgroundColor?: string | null;
  sortOrder?: number;
}

export interface WorkspaceGitRemoteDto {
  name: string;
  url: string;
}

export interface WorkspaceManagementGitDto {
  isRepository: boolean;
  repoRoot: string | null;
  currentBranch: string | null;
  commitCount: number | null;
  remotes: WorkspaceGitRemoteDto[];
  error: string | null;
}

export interface WorkspaceCodeCompositionItemDto {
  type: string;
  count: number;
  ratio: number;
}

export interface WorkspaceCodeCompositionDto {
  scannedFileCount: number;
  truncated: boolean;
  items: WorkspaceCodeCompositionItemDto[];
  error: string | null;
}

export interface WorkspaceManagementSummaryDto {
  revision?: string;
  workspaceId: string;
  name: string;
  path: string;
  git: WorkspaceManagementGitDto;
  codeComposition: WorkspaceCodeCompositionDto;
}

export type AffairsLibraryFavoriteKindDto = "folder" | "tag";
export type AffairsLibraryIndexStateDto = "fresh" | "stale" | "queued" | "running" | "queue_timeout" | "cooldown" | "failed";

export interface AffairsLibraryBindingDto {
  workspaceId: string | null;
  rootDir: string;
  enabled: boolean;
  mirrorRoot: string | null;
  allowedExtensions: string[];
  includedHiddenPaths?: string[];
  folderOpenBehavior?: "single_click" | "double_click";
  configRelativePath: string;
  exportMode: "v2";
  updatedAt: string;
}

export interface AffairsLibraryConfigDto {
  binding: AffairsLibraryBindingDto | null;
  mirrorRoot: string | null;
  allowedExtensions: string[];
  includedHiddenPaths?: string[];
  folderOpenBehavior?: "single_click" | "double_click";
  configRelativePath: string;
  canWrite: boolean;
  applyConfigTaskId?: string;
  applyConfigStatus?: AffairsLibraryIndexStatusDto;
}

export interface AffairsDashboardStateDto {
  dashboardState: unknown;
}

export interface AffairsLibraryIndexStatusDto {
  state: AffairsLibraryIndexStateDto;
  dirtyReasons: string[];
  lastRequestedAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  nextAllowedAt: string | null;
  runningTaskId: string | null;
  runningStage: string | null;
  errorSummary: string | null;
  workerHealth?: AffairsLibraryWorkerHealthDto | null;
  progress?: AffairsLibraryIndexProgressDto | null;
}

export interface AffairsLibraryWorkerHealthDto {
  workerKey: string;
  rootDir: string | null;
  state: "idle" | "running" | "terminating" | "recycled";
  pid: number | null;
  inflightLocalCount: number;
  inflightRemoteRequestCount: number;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  lastSoftCancelRequestedAt: string | null;
  lastHardKillAt: string | null;
  lastExitAt: string | null;
  lastTerminationReason: string | null;
}

export interface AffairsLibraryIndexProgressDto {
  scannedCount: number;
  indexedCount: number;
  skippedCount: number;
  failedCount: number;
  unchangedCount: number;
  totalCount: number | null;
  maxConcurrency: number | null;
}

export type AffairsLibraryDirectoryStateDto = "idle" | "queued" | "running" | "queue_timeout" | "fresh" | "failed";
export type AffairsLibraryDirectorySourceDto = "live" | "snapshot" | "mixed" | "stale_fallback";

export interface AffairsLibraryDirectoryStatusDto {
  path: string;
  state: AffairsLibraryDirectoryStateDto;
  source: AffairsLibraryDirectorySourceDto;
  lastRequestedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  runningTaskId: string | null;
  errorSummary: string | null;
  generatedAt?: string | null;
  filesystemObservedAt?: string | null;
  staleReason?: string | null;
}

export interface AffairsLibraryFavoriteRecordDto {
  kind: AffairsLibraryFavoriteKindDto;
  path: string;
  label: string;
}

export interface AffairsLibraryDocumentRecordDto {
  documentId: string;
  path: string;
  title: string;
  summary: string;
  updatedAt: string;
  createdAt?: string | null;
  sizeBytes?: number | null;
  tags: string[];
  derivedTags: string[];
  isFavorite: boolean;
}

export interface AffairsLibraryTagNodeDto {
  path: string;
  name: string;
  rootType: string;
  parentPath: string | null;
  depth: number;
  documentCount: number;
}

export interface AffairsTagNodeDto {
  id: string;
  path: string;
  name: string;
  rootType: string;
  parentId: string | null;
  parentPath: string | null;
  description: string | null;
  status: "active" | "disabled";
  documentCount: number;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export interface AffairsTagDetailDto extends AffairsTagNodeDto {}

export type AffairsTagRuleRelationDto = "and" | "or" | "not";

export type AffairsTagRuleTypeDto =
  | "file_name_contains"
  | "file_content_contains"
  | "file_extension_in"
  | "modified_time_between"
  | "document_path_in_folder";

export interface AffairsTagRuleDto {
  id: string;
  relation: AffairsTagRuleRelationDto;
  ruleType: AffairsTagRuleTypeDto;
  matcher: Record<string, unknown>;
  enabled: boolean;
  priority: number;
}

export interface AffairsTagDetailWithRulesDto extends AffairsTagDetailDto {
  smartRules: AffairsTagRuleDto[];
  smartRuleEnabled: boolean;
}

export type AffairsResolvedTagSourceTypeDto =
  | "manual_document"
  | "folder_binding"
  | "smart_rule"
  | "system_derived";

export interface AffairsResolvedTagSourceDto {
  path: string;
  sourceType: AffairsResolvedTagSourceTypeDto;
  sourceRef: string | null;
  evidence: string | null;
  confidence: number;
  priority: number;
}

export type AffairsTagRecommendationReasonDto =
  | "name_match"
  | "folder_context"
  | "smart_rule"
  | "time_pattern";

export interface AffairsTagRecommendationDto {
  tagId: string;
  path: string;
  name: string;
  score: number;
  reason: AffairsTagRecommendationReasonDto;
  evidence: string;
}

export interface AffairsDocumentTagDetailsDto {
  documentId: string;
  path: string;
  title: string;
  manualTagIds: string[];
  effectiveFolderBindings: Array<{
    id: string;
    folderPath: string;
    tagId: string;
    tagPath: string;
  }>;
  resolvedTags: AffairsResolvedTagSourceDto[];
  recommendedTags?: AffairsTagRecommendationDto[];
}

export interface AffairsFolderTagDetailsDto {
  folderPath: string;
  exists: boolean;
  bindingTagIds: string[];
  bindings: Array<{
    id: string;
    tagId: string;
    tagPath: string;
    applyMode: string;
  }>;
  recommendedTags?: AffairsTagRecommendationDto[];
}

export interface AffairsLibraryFolderNodeDto {
  path: string;
  name: string;
  parentPath: string | null;
  directDocumentCount: number;
  documentCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AffairsLibrarySnapshotDto {
  binding: AffairsLibraryBindingDto | null;
  status: AffairsLibraryIndexStatusDto;
  tags: AffairsLibraryTagNodeDto[];
  favorites: AffairsLibraryFavoriteRecordDto[];
  folders: AffairsLibraryFolderNodeDto[];
  documentCount: number;
  lastError: string | null;
}

export interface AffairsLibraryDocumentListDto {
  total: number;
  visibleEntryTotal?: number;
  offset: number;
  limit: number;
  items: AffairsLibraryDocumentRecordDto[];
  tagFacetCounts?: Record<string, number>;
  directoryStatus?: AffairsLibraryDirectoryStatusDto | null;
}

export type AffairsLibraryPreviewKindDto =
  | "text"
  | "markdown"
  | "html"
  | "image"
  | "pdf"
  | "office"
  | "binary"
  | "unsupported";

export interface AffairsLibraryPreviewCapabilitiesDto {
  canEdit: boolean;
  canRefresh: boolean;
  canResize: boolean;
  canZoom: boolean;
  canPaginate: boolean;
}

export interface AffairsLibraryPreviewDto {
  workspaceId: string;
  path: string;
  supported: boolean;
  kind: AffairsLibraryPreviewKindDto;
  reason: string | null;
  content: string | null;
  version: string | null;
  size: number;
  updatedAt: string | null;
  previewPath: string | null;
  previewUrl: string | null;
  onlyOffice: {
    apiScriptUrl: string;
    editorMode: "edit" | "view";
    documentUrl: string;
    callbackUrl: string;
    editorConfig: Record<string, unknown>;
  } | null;
  capabilities: AffairsLibraryPreviewCapabilitiesDto;
}

export interface AffairsLibraryDownloadDto {
  workspaceId: string;
  path: string;
  fileName: string;
  contentBase64: string;
  size: number;
  updatedAt: string;
}

export type AffairsLibraryOperationType = "delete" | "move" | "copy" | "create_directory" | "create_file" | "write";

export interface AffairsLibraryOperationResultDto {
  success: true;
  opType: AffairsLibraryOperationType;
  sourcePath: string;
  targetPath: string | null;
}

export type TeableMirrorModeDto = "manual" | "scheduled" | "event_driven";
export type TeableSyncSourceTypeDto = "tags" | "sessions" | "todos";
export type TeableMirrorReadOnlyModeDto = "role_based" | "matrix_based" | "unknown";
export interface TeableGlobalBindingDto {
  baseUrl: string;
  spaceId: string;
  baseId: string;
  authRef: string;
  enabled: boolean;
  mirrorMode: TeableMirrorModeDto;
  updatedAt: string;
}

export interface TeableGlobalBindingOverviewDto {
  binding: TeableGlobalBindingDto | null;
  status: "unbound" | "ready" | "disabled" | "config_invalid";
  summary: string;
  updatedAt: string | null;
}

export interface TeableWorkbenchSyncConfigDto {
  configId: string;
  sourceType: TeableSyncSourceTypeDto;
  enabled: boolean;
  scope:
    | {
        rootTagIds: string[];
      }
    | {
        mode: "all_workspaces";
      }
    | {
        mode: "selected_workspaces";
        workspaceIds: string[];
      }
    | {
        includeWorkspaceTodos: boolean;
        includeAffairsTodos: boolean;
        workspaceIds?: string[];
      };
  targetTableId: string | null;
  updatedAt: string;
}

export interface TeableMirrorTableBindingDto {
  mirrorType: TeableSyncSourceTypeDto;
  tableId: string;
  tableName: string;
  readOnlyMode: TeableMirrorReadOnlyModeDto;
  lastSyncedAt: string | null;
  updatedAt: string;
}

export interface TeableMirrorSyncResultDto {
  state: "succeeded" | "partial_failed" | "failed";
  summary: string;
  syncedMirrorTypes: TeableSyncSourceTypeDto[];
  failedMirrorTypes: Array<{
    mirrorType: TeableSyncSourceTypeDto;
    detail: string;
  }>;
  counts: Record<TeableSyncSourceTypeDto, {
    created: number;
    updated: number;
    deleted: number;
    skipped: number;
  }>;
}

export interface TeableSyncTaskSnapshotDto {
  taskId: string;
  taskType: "mirror_sync";
  state: "queued" | "running" | "succeeded" | "partial_failed" | "failed";
  summary: string | null;
  lastError: string | null;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: {
    phase: string;
    label: string | null;
    detail: string | null;
    current: number | null;
    total: number | null;
    percent: number | null;
    updatedAt: string;
  } | null;
  result: TeableMirrorSyncResultDto | null;
}

export interface TeableMirrorSyncTaskRequestDto {
  taskId: string;
  deduped: boolean;
  taskType: "mirror_sync";
  state: "queued";
  summary: string;
  updatedAt: string;
}

export interface TeableSyncLogDto {
  logId: string;
  triggerType: "manual" | "local_change" | "retry";
  sourceTypes: TeableSyncSourceTypeDto[];
  taskId: string | null;
  state: "queued" | "running" | "succeeded" | "partial_failed" | "failed";
  summary: string;
  counts: Partial<TeableMirrorSyncResultDto["counts"]>;
  errorDetail: string | null;
  reason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeableOverviewDto {
  binding: TeableGlobalBindingOverviewDto;
  syncConfigs: TeableWorkbenchSyncConfigDto[];
  mirrorBindings: TeableMirrorTableBindingDto[];
  latestMirrorSyncTask: TeableSyncTaskSnapshotDto | null;
}

export interface TeableTableCatalogItemDto {
  tableId: string;
  tableName: string;
}

export interface TeableFieldSummaryDto {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  isPrimary: boolean;
}

export interface TeableCreatedFieldMappingDto {
  sourceField: string;
  targetFieldId: string;
  targetFieldName: string;
  required: boolean;
  fieldType: string;
}

export interface TeableFieldMappingItemDto {
  sourceField: string;
  targetFieldId: string;
  targetFieldName: string;
  required: boolean;
}

export interface TeableFieldMappingDto {
  mappingId: string;
  configId: string;
  sourceType: TeableSyncSourceTypeDto;
  targetTableId: string;
  items: TeableFieldMappingItemDto[];
  updatedAt: string;
}

export interface TeableSourceFieldDefinitionDto {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "datetime";
  required: boolean;
}

export type DebugServiceRoleDto = "frontend" | "backend" | "worker" | "mock" | "custom";
export type FrameworkAnalysisConfidenceDto = "high" | "medium" | "low";
export type FrameworkCompatibilityLevelDto = "supported" | "conditional" | "unsupported" | "unknown";
export type DebugInjectionModeDto = "cli" | "env" | "override" | "ai_fallback" | "none";
export type DebugAiFallbackPolicyDto = "never" | "conditional" | "allowed";
export type DebugRuntimeSessionStatusDto = "PREPARING" | "RUNNING" | "FAILED" | "STOPPED";

export interface DebugTargetProfileDto {
  id: string;
  workspaceId: string;
  rootPath: string;
  displayName: string;
  stackHint?: string | null;
  sourceType: "repo" | "worktree";
  rootWorkspaceId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DebugServiceSpecDto {
  id: string;
  targetId: string;
  role: DebugServiceRoleDto;
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  defaultPortHint?: number | null;
  protocol?: "http" | "ws" | "tcp" | null;
  healthPath?: string | null;
  adapterKind?: "cli" | "env" | "override" | "ai_fallback" | null;
  frameworkAnalysisId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FrameworkAnalysisResultDto {
  id: string;
  targetId: string;
  serviceId?: string | null;
  primaryFramework?: string | null;
  confidence: FrameworkAnalysisConfidenceDto;
  compatibilityLevel: FrameworkCompatibilityLevelDto;
  recommendedInjectionMode?: DebugInjectionModeDto | null;
  requiresServiceDiscoveryHandling: boolean;
  requiresHmrHandling: boolean;
  requiresCallbackHandling: boolean;
  aiFallbackPolicy: DebugAiFallbackPolicyDto;
  reasons: string[];
  detectedFiles: string[];
  rawEvidence?: Record<string, unknown>;
  createdAt: string;
}

export interface DebugRuntimeSessionDto {
  id: string;
  targetId: string;
  status: DebugRuntimeSessionStatusDto;
  failureStage?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortLeaseRecordDto {
  id: string;
  runtimeId: string;
  serviceId: string;
  port: number;
  protocol: "tcp" | "udp";
  status: "LEASED" | "RELEASING" | "RELEASED" | "STALE";
  leasedAt: string;
  expiresAt?: string | null;
  releasedAt?: string | null;
}

export interface RuntimeBindingDto {
  id: string;
  runtimeId: string;
  serviceId: string;
  processInstanceId?: string | null;
  expectedPort?: number | null;
  leasedPort?: number | null;
  observedPort?: number | null;
  proxyPath?: string | null;
  status: "ALLOCATED" | "LISTENING" | "FAILED" | "RELEASED";
  updatedAt: string;
}

export interface AiFallbackEditRecordDto {
  id: string;
  runtimeId: string;
  serviceId: string;
  reason: string;
  allowedFiles: string[];
  targetPort: number;
  patchRef?: string | null;
  rollbackRef?: string | null;
  status: "PENDING" | "APPLIED" | "ROLLED_BACK" | "REJECTED";
  createdAt: string;
}

export interface TerminalInstanceDebugDto {
  id: string;
  workspaceId: string;
  name: string;
  cwd: string;
  shell: string;
  runtimeType: string;
  runtimeSessionId: string;
  attachTarget: string;
  status: "creating" | "running" | "closed" | "error";
  processId: number | null;
  createdByUserId: string;
  createdAt: string;
  lastActiveAt: string;
  closedAt: string | null;
  exitCode: number | null;
  statusDetail: string | null;
  debugRuntimeSessionId?: string | null;
  debugTargetId?: string | null;
  debugServiceId?: string | null;
  frameworkAnalysisId?: string | null;
  launcherSourceType?: "manual" | "debug_service" | null;
  launchStage?: string | null;
  failureStage?: string | null;
  adapterKind?: "cli" | "env" | "override" | "ai_fallback" | null;
  envPatchSummary?: Record<string, unknown>;
  artifactRef?: string | null;
}

export interface DebugRuntimeDetailServiceItemDto {
  service: DebugServiceSpecDto;
  analysis: FrameworkAnalysisResultDto | null;
  binding: RuntimeBindingDto | null;
  portLease: PortLeaseRecordDto | null;
  processInstance: TerminalInstanceDebugDto | null;
  aiFallbackEdits: AiFallbackEditRecordDto[];
}

export interface DebugRuntimeDetailDto {
  runtimeSession: DebugRuntimeSessionDto;
  target: DebugTargetProfileDto;
  services: DebugRuntimeDetailServiceItemDto[];
}

export interface DebugRuntimeHistoryEnvelopeDto {
  targetId: string;
  items: DebugRuntimeDetailDto[];
}

export interface DebugTargetAnalysisEnvelopeDto {
  target: DebugTargetProfileDto;
  services: DebugServiceSpecDto[];
  analyses: FrameworkAnalysisResultDto[];
  autoInjectionEligible: boolean;
}

export interface FrameworkAnalysisListEnvelopeDto {
  targetId: string;
  items: FrameworkAnalysisResultDto[];
}

export interface FrameworkCompatibilityMatrixItemDto {
  framework: string;
  compatibilityLevel: FrameworkCompatibilityLevelDto;
  recommendedInjectionMode: DebugInjectionModeDto;
  requiresServiceDiscoveryHandling: boolean;
  requiresHmrHandling: boolean;
  requiresCallbackHandling: boolean;
  aiFallbackPolicy: DebugAiFallbackPolicyDto;
  notes: string;
}

export interface FrameworkCompatibilityMatrixDto {
  version: string;
  items: FrameworkCompatibilityMatrixItemDto[];
}

export interface DebugLaunchAdapterAttemptDto {
  kind: "cli" | "env" | "override" | "ai_fallback";
  status: "selected" | "blocked" | "fallback_required" | "skipped";
  reason: string;
}

export interface DebugAiFallbackSummaryDto {
  eligible: boolean;
  editId: string | null;
  status: "PENDING" | "APPLIED" | "ROLLED_BACK" | "REJECTED" | null;
  reason: string;
  allowedFiles: string[];
}

export interface DebugLaunchPlanServiceItemDto {
  serviceId: string;
  role: DebugServiceRoleDto;
  frameworkAnalysisId: string | null;
  primaryFramework: string | null;
  compatibilityLevel: FrameworkCompatibilityLevelDto;
  adapterKind: "cli" | "env" | "override" | "ai_fallback" | null;
  injectionMode: DebugInjectionModeDto | null;
  command: string;
  args: string[];
  envPatch: Record<string, string>;
  expectedPort: number | null;
  leasedPort: number | null;
  artifactRef: string | null;
  runtimeBindingId: string;
  portLeaseId: string | null;
  requiresServiceDiscoveryHandling: boolean;
  requiresHmrHandling: boolean;
  requiresCallbackHandling: boolean;
  failureStage: string | null;
  adapterAttempts: DebugLaunchAdapterAttemptDto[];
  aiFallback: DebugAiFallbackSummaryDto | null;
  missingRequirements: string[];
  autoStartAllowed: boolean;
}

export interface DebugLaunchPlanDto {
  runtimeSession: DebugRuntimeSessionDto;
  targetId: string;
  autoStartAllowed: boolean;
  services: DebugLaunchPlanServiceItemDto[];
}

export interface DebugTargetPortRequestDto {
  serviceId?: string | null;
  role?: DebugServiceRoleDto | null;
  cwd?: string | null;
  name?: string | null;
  command?: string | null;
  port: number;
}

export interface RunDebugTargetPayload {
  shell?: string;
  runtimeType?: string | null;
  portRequests?: DebugTargetPortRequestDto[];
}

export interface RunDebugTargetResultDto {
  runtimeSession: DebugRuntimeSessionDto;
  services: Array<{
    serviceId: string;
    processInstanceId: string;
    terminalId: string;
    leasedPort: number | null;
    runtimeBindingId: string;
  }>;
}

export interface ProviderModelOptionDto {
  id: string;
  name: string;
  usesProviderDefault?: boolean;
  supportedReasoningEfforts?: string[];
}

export interface ImportWorkspacePayload {
  path: string;
  name?: string;
}

export type CloneWorkspaceAuthMode = "none" | "basic" | "token";

export interface CloneWorkspacePayload {
  repositoryUrl: string;
  parentPath: string;
  directoryName?: string;
  name?: string;
  auth?:
    | {
        mode?: "none";
      }
    | {
        mode: "basic";
        username?: string;
        password?: string;
      }
    | {
        mode: "token";
        username?: string;
        token?: string;
      };
}

export interface WorkspaceDirectoryOptionDto {
  path: string;
  name: string;
}

export interface WorkspaceDirectoryBrowseDto {
  currentPath: string;
  parentPath: string | null;
  roots: WorkspaceDirectoryOptionDto[];
  items: WorkspaceDirectoryOptionDto[];
}

export interface CreateWorkspaceDirectoryPayload {
  parentPath: string;
  directoryName: string;
}

export interface WorkspaceCreatedDirectoryDto {
  path: string;
  name: string;
}

export interface CreateParallelSessionGroupPayload {
  sourceMessageId?: string | null;
  sharedPrompt: string;
  permissionMode?: string | null;
  members: ParallelSessionMemberConfigDto[];
}

export interface AppendParallelGroupMembersPayload {
  permissionMode?: string | null;
  members: ParallelSessionMemberConfigDto[];
}

export interface ReorderWorkspacesPayload {
  workspaceIds: string[];
}

export interface WorkspaceNavigationStateDto {
  workspaceId: string;
  userId: string;
  collapsed: boolean;
  backgroundColor: string | null;
  updatedAt: string;
}

export interface ParallelGroupSummaryDto {
  groupId: string;
  role: "anchor" | "member";
  memberCount: number;
  sourceType: "fork" | "new";
  sourceSessionId: string | null;
  anchorSessionId: string | null;
  colorToken: string;
}

export interface SessionIsolatedWorkspaceSummaryDto {
  id: string;
  workspaceId: string;
  sourceWorkspaceId: string;
  branchName: string;
  lifecycleStatus: "active" | "promoted" | "removing" | "removed";
  promotedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummaryDto {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
  providerSessionId: string;
  rawStoreRef: string;
  providerConfigMode?: SessionProviderConfigMode;
  providerPresetId?: string | null;
  parentSessionId?: string | null;
  sessionKind?: SessionKind;
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
  forkMethod?: ForkMethod | null;
  forkSourceType?: ForkSourceType | null;
  forkSourceSessionId?: string | null;
  forkSourceMessageId?: string | null;
  inheritedPrefixMessageCount?: number | null;
  isSubagent?: boolean;
  subagentLabel?: string | null;
  isArchived?: boolean;
  isFavorite?: boolean;
  title: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus | null;
  syncCursor: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  resumedAt: string | null;
  runningState: SessionRunningState | null;
  activitySource: SessionActivitySource;
  activityResolutionSource?: SessionActivityResolutionSource;
  activityConfidence?: SessionActivityConfidence;
  runId?: string | null;
  lastEventAt: string | null;
  completedAt: string | null;
  lastSeenAt: string | null;
  watchdogTriggeredAt?: string | null;
  activityState: SessionActivityState;
  parallelGroup?: ParallelGroupSummaryDto | null;
  displayParentSessionId?: string | null;
  sessionIsolatedWorkspace?: SessionIsolatedWorkspaceSummaryDto | null;
}

export interface ParallelSessionMemberConfigDto {
  provider: ProviderId;
  model?: string | null;
  providerConfigMode?: SessionProviderConfigMode;
  providerPresetId?: string | null;
  memberPrompt?: string | null;
  workspaceIsolationMode?: "none" | "temporary_worktree";
}

export interface ParallelSessionMemberFailureDto {
  ordinal: number;
  provider: ProviderId;
  model: string | null;
  workspaceIsolationMode: "none" | "temporary_worktree";
  errorCode: string;
  detail: string;
}

export interface ParallelSessionGroupDto {
  id: string;
  workspaceId: string;
  sourceType: "fork" | "new";
  sourceSessionId: string | null;
  sourceMessageId: string | null;
  sharedPrompt: string | null;
  requestedCount: number;
  anchorSessionId: string | null;
  status: "active" | "deleting" | "deleted";
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ParallelSessionMemberViewDto {
  member: {
    groupId: string;
    sessionId: string;
    ordinal: number;
    role: "anchor" | "member";
    provider: ProviderId;
    model: string | null;
    memberPrompt: string | null;
    workspaceIsolationMode: "none" | "temporary_worktree";
    temporaryWorkspaceId: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  };
  session: SessionSummaryDto;
  sessionIsolatedWorkspace: SessionIsolatedWorkspaceSummaryDto | null;
}

export interface ParallelSessionGroupDetailDto {
  group: ParallelSessionGroupDto;
  members: ParallelSessionMemberViewDto[];
  memberFailures: ParallelSessionMemberFailureDto[];
}

export interface SessionIsolatedWorkspacePromoteDto {
  record: {
    id: string;
    groupId: string;
    ownerSessionId: string;
    workspaceId: string;
    sourceWorkspaceId: string;
    branchName: string;
    baseRef: string;
    baseCommit: string;
    headCommit: string | null;
    lifecycleStatus: "active" | "promoted" | "removing" | "removed";
    promotedAt: string | null;
    removedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  workspace: WorkspaceDto;
  worktree: WorktreeMetaDto;
}

export type SessionPermissionRequestKind =
  | "tool_call"
  | "command"
  | "file_change"
  | "permissions"
  | "user_input";
export type SessionPermissionRequestStatus =
  | "pending"
  | "approved"
  | "declined"
  | "cancelled"
  | "expired";
export type SessionPermissionRequestActionTone = "primary" | "neutral" | "danger";

export interface SessionPermissionRequestActionDto {
  value: string;
  label: string;
  tone: SessionPermissionRequestActionTone;
  description: string | null;
}

export interface SessionPermissionRequestQuestionOptionDto {
  label: string;
  description: string | null;
}

export interface SessionPermissionRequestQuestionDto {
  id: string;
  header: string;
  question: string;
  allowOther: boolean;
  secret: boolean;
  options: SessionPermissionRequestQuestionOptionDto[];
}

export interface SessionPermissionProfileDto {
  readPaths: string[];
  writePaths: string[];
  networkEnabled: boolean | null;
}

export interface SessionPermissionRequestDto {
  id: string;
  sessionId: string;
  provider: ProviderId;
  providerSessionId: string;
  requestKey: string;
  kind: SessionPermissionRequestKind;
  status: SessionPermissionRequestStatus;
  title: string;
  summary: string;
  detail: string | null;
  reason: string | null;
  toolName: string | null;
  command: string | null;
  cwd: string | null;
  paths: string[];
  permissionProfile: SessionPermissionProfileDto | null;
  questions: SessionPermissionRequestQuestionDto[];
  actions: SessionPermissionRequestActionDto[];
  rawPayload: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface ReplyPermissionRequestPayload {
  action: string;
  answers?: Record<string, string[]>;
}

export interface ProviderCapabilitiesDto {
  provider: ProviderId;
  canStartSession: boolean;
  canResumeSession: boolean;
  canSendMessage?: boolean;
  inRunInputMode: InRunInputMode;
  supportsSubagents: boolean;
  supportsInterrupt: boolean;
  supportsStructuredToolCalls: boolean;
  supportsTokenUsage: boolean;
  supportsAttachments: boolean;
  supportsPermissionPrompt: boolean;
  supportsCheckpoint: boolean;
  supportsTodo?: boolean;
  supportsSessionDiff?: boolean;
  supportsPermissionRequests?: boolean;
  supportsSessionFork?: boolean;
  supportsSessionDelete?: boolean;
  supportsSessionShare?: boolean;
  supportsAsyncPrompt?: boolean;
  supportsNativeAgents?: boolean;
  modelOptions?: ProviderModelOptionDto[];
  defaultReasoningLevel?: string | null;
  limitations: string[];
  // 新增补充字段，方便前端收口 provider 行为判定
  supportsSlashMenu?: boolean;
  supportsReasoningSelector?: boolean;
  supportsRunSteering?: boolean;
  supportsQueueWhileRunning?: boolean;
  supportsRulesMessageFolding?: boolean;
}

export interface ProviderCatalogEntryDto {
  provider: ProviderId;
  displayName: string;
  enabled: boolean;
  installState: "ready" | "missing" | "unknown";
  version: string | null;
  disableImpact: {
    hidesSessions: boolean;
    blocksSessionStart: boolean;
    blocksFork: boolean;
    blocksAssistant: boolean;
    blocksSkillTargets: boolean;
  };
  capabilities: ProviderCapabilitiesDto;
  productCapabilities: {
    streamingOutput: boolean;
    toolCalls: boolean;
    assistantService: boolean;
    sessionFork: boolean;
    skillUsage: boolean;
  };
}

export interface HistoryMessageDto {
  messageId: string;
  provider: ProviderId;
  providerSessionId: string;
  role: "user" | "assistant" | "tool" | "system";
  origin?: "butler_proxy" | "system" | null;
  originRef?: string | null;
  kind?: MessageKind;
  content: string;
  toolCall?: ToolCallDto | null;
  attachments?: MessageAttachmentDto[];
  timestamp: string;
  sequence: number;
  rawRef: string;
}

export interface HistoryPageDto {
  messages: HistoryMessageDto[];
  cursor: string | null;
  nextCursor: string | null;
  total: number;
}

export interface WorkbenchSnapshotItemDto {
  workspace: WorkspaceDto;
  sessions: SessionSummaryDto[];
  childWorktrees?: WorkbenchWorktreeNodeDto[];
  collapsed?: boolean;
}

export interface WorkbenchSnapshotDto {
  revision?: string;
  items: WorkbenchSnapshotItemDto[];
}

export interface WorkbenchWorktreeNodeDto {
  workspace: WorkspaceDto;
  meta: {
    workspaceId: string;
    rootWorkspaceId: string;
    parentWorkspaceId: string;
    sourceWorkspaceId: string;
    mergeTargetWorkspaceId: string;
    branchName: string;
    baseRef: string;
    baseCommit: string;
    headCommit: string | null;
    displayName: string;
    depth: number;
    lifecycleStatus: "active" | "merged" | "abandoned" | "removing" | "removed";
    mergedAt: string | null;
    removedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  sessions: SessionSummaryDto[];
  children: WorkbenchWorktreeNodeDto[];
}

export interface CreateWorktreePayload {
  sourceWorkspaceId: string;
  branchName: string;
  displayName?: string;
  baseRef?: string;
}

export interface WorktreeMetaDto {
  workspaceId: string;
  rootWorkspaceId: string;
  parentWorkspaceId: string;
  sourceWorkspaceId: string;
  mergeTargetWorkspaceId: string;
  branchName: string;
  baseRef: string;
  baseCommit: string;
  headCommit: string | null;
  displayName: string;
  depth: number;
  lifecycleStatus: "active" | "merged" | "abandoned" | "removing" | "removed";
  mergedAt: string | null;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeMergeBlockerDto {
  code:
    | "SOURCE_NOT_ACTIVE"
    | "SOURCE_DIRTY"
    | "TARGET_DIRTY"
    | "HAS_ACTIVE_CHILDREN"
    | "NO_COMMITS_TO_MERGE"
    | "HAS_CONFLICTS";
  detail: string;
}

export interface WorktreeMergePreviewDto {
  workspaceId: string;
  sourceWorkspace: WorkspaceDto;
  targetWorkspace: WorkspaceDto;
  meta: WorktreeMetaDto;
  sourceBranchName: string;
  targetBranchName: string;
  sourceHeadCommit: string | null;
  targetHeadCommit: string | null;
  mergeBaseCommit: string | null;
  ahead: number;
  behind: number;
  hasConflicts: boolean;
  conflictPaths: string[];
  alreadyMerged: boolean;
  canMerge: boolean;
  blockers: WorktreeMergeBlockerDto[];
}

export interface WorktreeMergeApplyResponseDto {
  preview: WorktreeMergePreviewDto;
  applied: boolean;
  mergeCommit: string | null;
  meta: WorktreeMetaDto;
}

export interface WorktreeCleanupResponseDto {
  workspaceId: string;
  removed: boolean;
  meta: WorktreeMetaDto;
  branchDeleteRequested: boolean;
  branchDeleted: boolean;
  deletedBranchName: string | null;
  branchDeleteError: string | null;
}

export interface CreateWorktreeResponseDto {
  workspace: WorkspaceDto;
  meta: WorktreeMetaDto;
}

export interface SendMessageResponseDto {
  sessionId: string;
  acceptedAt: string;
  clientRequestId: string | null;
  message: HistoryMessageDto;
}

export interface AffairsLightweightSessionTurnResponseDto {
  session: SessionSummaryDto;
  acceptedAt: string;
  clientRequestId: string;
  userMessage: HistoryMessageDto;
  assistantMessage: HistoryMessageDto;
  messages: HistoryMessageDto[];
}

export type AffairsLightweightSessionStreamEventDto =
  | {
      type: "started";
      session: SessionSummaryDto;
      acceptedAt: string;
      clientRequestId: string;
      userMessage: HistoryMessageDto;
    }
  | {
      type: "tool";
      toolCallId: string;
      toolName: string;
      status: "running" | "completed" | "failed";
      detail: string | null;
      input: string | null;
      output: string | null;
    }
  | {
      type: "delta";
      delta: string;
    }
  | {
      type: "completed";
      result: AffairsLightweightSessionTurnResponseDto;
    }
  | {
      type: "error";
      errorCode: string;
      detail: string;
    };

export interface StartSessionPayload {
  workspaceId: string;
  provider: ProviderId;
  initialPrompt?: string;
  parentSessionId?: string | null;
  sessionKind?: SessionKind;
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
}

export interface StartLivePayload {
  workspaceId: string;
  provider: ProviderId;
  content: string;
  clientRequestId?: string | null;
  sessionVisibility?: "workspace" | "affairs_lightweight";
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
  attachments?: AttachmentPayload[];
  parentSessionId?: string | null;
  sessionKind?: SessionKind;
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
  providerConfigMode?: SessionProviderConfigMode;
  providerPresetId?: string | null;
}

export interface SendLiveMessagePayload {
  content: string;
  clientRequestId: string;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
  attachments?: AttachmentPayload[];
  providerConfigMode?: SessionProviderConfigMode;
  providerPresetId?: string | null;
}

export interface SendSessionMessagePayload {
  content: string;
  clientRequestId: string;
  permissionMode?: string | null;
}

export interface StartAffairsLightweightSessionPayload {
  provider: ProviderId;
  content: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  attachments?: AttachmentPayload[];
}

export interface SendAffairsLightweightSessionMessagePayload {
  content: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  attachments?: AttachmentPayload[];
}

export interface ForkSessionPayload {
  sourceType: ForkSourceType;
  sourceMessageId?: string | null;
  sourceMessageSnapshot?: ForkSourceMessageSnapshotDto | null;
  strategy?: ForkStrategy;
  targetProvider?: ProviderId | null;
  providerConfigMode?: SessionProviderConfigMode;
  providerPresetId?: string | null;
  sessionKind?: SessionKind;
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
}

export interface StartLiveResponseDto extends SendMessageResponseDto {
  provider: ProviderId;
  providerSessionId: string;
  session?: SessionSummaryDto;
}

export interface SessionRuntimeDto {
  sessionId: string;
  runningState: SessionRunningState;
  hasActiveRun: boolean;
  canAttach: boolean;
  canInterrupt: boolean;
  inRunInputMode: InRunInputMode;
  provider: ProviderId;
  providerSessionId: string;
  activityResolutionSource: SessionActivityResolutionSource;
  activityConfidence: SessionActivityConfidence;
  runId: string | null;
  detail: string | null;
  interruptSource: SessionInterruptSource | null;
  errorCode: string | null;
  errorDetail: string | null;
  updatedAt: string;
  watchdogTriggeredAt: string | null;
  contextUsage: ContextUsageDto | null;
}

export interface SessionQueueItemDto {
  id: string;
  sessionId: string;
  content: string;
  clientRequestId: string | null;
  model: string | null;
  reasoningLevel: string | null;
  permissionMode: string | null;
  status: "queued" | "dispatching" | "failed";
  orderIndex: number;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContextUsageDto {
  provider: ProviderId;
  promptTokens: number;
  uncachedInputTokens: number;
  cachedInputTokens: number;
  contextWindow: number;
  usageRatio: number;
  source: "provider-log" | "provider-runtime" | "provider-config" | "model-map";
  contextWindowSource: "provider-log" | "provider-runtime" | "provider-config" | "model-map";
  modelId: string | null;
  capturedAt: string | null;
  isEstimated: boolean;
}

export interface SessionPermissionRequestListDto {
  items: SessionPermissionRequestDto[];
}

export interface InterruptSessionResponseDto {
  sessionId: string;
  interrupted: boolean;
  detail?: string | null;
}

export interface SessionChangedFileDto {
  sessionId: string;
  workspaceId: string;
  path: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  lastToolName: string | null;
}

export interface QuickPhraseDto {
  id: string;
  text: string;
}

export function listWorkspaces() {
  return httpClient.request<{ items: WorkspaceDto[] }>("/api/workspaces");
}

export async function getWorkbenchSnapshot(options?: {
  refresh?: boolean;
  awaitDiscovery?: boolean;
}) {
  const headers = new Headers();
  if (options?.refresh) {
    headers.set("X-CodingNS-Workbench-Refresh", "true");
  }
  if (options?.awaitDiscovery) {
    headers.set("X-CodingNS-Workbench-Await-Discovery", "true");
  }
  try {
    return await httpClient.request<WorkbenchSnapshotDto>("/api/workbench", {
      headers
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error;
    }

    const workspaceResponse = await listWorkspaces();
    const sessionResponses = await Promise.all(
      workspaceResponse.items.map(async (workspace) => ({
        workspace,
        sessions: (await listWorkspaceSessions(workspace.id)).items
      }))
    );

    return {
      items: sessionResponses
    } satisfies WorkbenchSnapshotDto;
  }
}

export function importWorkspace(payload: ImportWorkspacePayload) {
  return httpClient.request<WorkspaceDto>("/api/workspaces/import", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function cloneWorkspace(payload: CloneWorkspacePayload) {
  return httpClient.request<WorkspaceDto>("/api/workspaces/clone", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getWorkspaceManagementSummary(workspaceId: string) {
  return httpClient.request<WorkspaceManagementSummaryDto>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/management`
  );
}

export function removeWorkspace(workspaceId: string) {
  return httpClient.request<WorkspaceDto>(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE"
  });
}

export function analyzeDebugTarget(payload: {
  workspaceId: string;
  rootPath: string;
  commandHints?: string[];
}) {
  return httpClient.request<DebugTargetAnalysisEnvelopeDto>("/api/debug-targets/analyze", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getFrameworkAnalysis(targetId: string) {
  return httpClient.request<FrameworkAnalysisListEnvelopeDto>(
    `/api/debug-targets/${encodeURIComponent(targetId)}/framework-analysis`
  );
}

export function createDebugLaunchPlan(
  targetId: string,
  payload?: { portRequests?: DebugTargetPortRequestDto[] }
) {
  return httpClient.request<DebugLaunchPlanDto>(
    `/api/debug-targets/${encodeURIComponent(targetId)}/launch-plan`,
    {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    }
  );
}

export function getLatestDebugRuntime(targetId: string) {
  return httpClient.request<DebugRuntimeDetailDto | null>(
    `/api/debug-targets/${encodeURIComponent(targetId)}/runtime-latest`
  );
}

export function getRecentDebugRuntimes(targetId: string, limit = 5) {
  const search = new URLSearchParams();
  search.set("limit", String(limit));

  return httpClient.request<DebugRuntimeHistoryEnvelopeDto>(
    `/api/debug-targets/${encodeURIComponent(targetId)}/runtimes?${search.toString()}`
  );
}

export function getFrameworkCompatibilityMatrix() {
  return httpClient.request<FrameworkCompatibilityMatrixDto>("/api/framework-compatibility-matrix");
}

export function reorderWorkspaces(payload: ReorderWorkspacesPayload) {
  return httpClient.request<{ items: WorkspaceDto[] }>("/api/workspaces/reorder", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function updateWorkspaceNavigationState(
  workspaceId: string,
  payload: {
    collapsed?: boolean;
    backgroundColor?: string | null;
  }
) {
  return httpClient.request<WorkspaceNavigationStateDto>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/navigation-state`,
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export function getAffairsLibraryBinding(workspaceId: string) {
  return httpClient.request<AffairsLibraryBindingDto | null>(
    "/api/affairs/library-binding"
  );
}

export function getGlobalAffairsLibraryBinding() {
  return httpClient.request<AffairsLibraryBindingDto | null>("/api/affairs/library-binding");
}

export function saveAffairsLibraryBinding(workspaceId: string, payload: { rootDir: string }) {
  return httpClient.request<AffairsLibraryBindingDto>(
    "/api/affairs/library-binding",
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export function saveGlobalAffairsLibraryBinding(payload: { rootDir: string }) {
  return httpClient.request<AffairsLibraryBindingDto>("/api/affairs/library-binding", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function setAffairsLibraryEnabled(workspaceId: string, payload: { enabled: boolean }) {
  return httpClient.request<AffairsLibraryBindingDto>(
    "/api/affairs/library-enabled",
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export function setGlobalAffairsLibraryEnabled(payload: { enabled: boolean }) {
  return httpClient.request<AffairsLibraryBindingDto>("/api/affairs/library-enabled", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getAffairsLibrarySnapshot(workspaceId: string) {
  return httpClient.request<AffairsLibrarySnapshotDto>(
    "/api/affairs/library-snapshot"
  );
}

export function getAffairsLibraryConfig(workspaceId: string) {
  return httpClient.request<AffairsLibraryConfigDto>(
    "/api/affairs/library-config"
  );
}

export function saveAffairsLibraryConfig(
  workspaceId: string,
  payload: {
    mirrorRoot?: string | null;
    allowedExtensions?: string[];
    includedHiddenPaths?: string[];
    folderOpenBehavior?: "single_click" | "double_click";
  }
) {
  return httpClient.request<AffairsLibraryConfigDto>(
    "/api/affairs/library-config",
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export function listAffairsLibraryDocuments(
  workspaceId: string,
  query: {
    browseMode: "folder" | "tag";
    selectedFolderPath?: string | null;
    selectedTagPath?: string | null;
    selectedTagPaths?: string[] | null;
    selectedFavoriteId?: string | null;
    keyword?: string | null;
    offset?: number;
    limit?: number;
  }
) {
  const search = new URLSearchParams();
  search.set("browseMode", query.browseMode);
  if (query.selectedFolderPath?.trim()) {
    search.set("selectedFolderPath", query.selectedFolderPath.trim());
  }
  if (query.selectedTagPath?.trim()) {
    search.set("selectedTagPath", query.selectedTagPath.trim());
  }
  if (Array.isArray(query.selectedTagPaths)) {
    const normalizedTagPaths = query.selectedTagPaths
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (normalizedTagPaths.length > 0) {
      search.set("selectedTagPaths", normalizedTagPaths.join(","));
    }
  }
  if (query.selectedFavoriteId?.trim()) {
    search.set("selectedFavoriteId", query.selectedFavoriteId.trim());
  }
  if (query.keyword?.trim()) {
    search.set("keyword", query.keyword.trim());
  }
  if (typeof query.offset === "number") {
    search.set("offset", String(query.offset));
  }
  if (typeof query.limit === "number") {
    search.set("limit", String(query.limit));
  }
  return httpClient.request<AffairsLibraryDocumentListDto>(
    `/api/affairs/library-documents?${search.toString()}`
  );
}

export function listAffairsLibraryFiles(
  workspaceId: string,
  query?: {
    path?: string | null;
    limit?: number;
  }
) {
  const search = new URLSearchParams();
  if (query?.path?.trim()) {
    search.set("path", query.path.trim());
  }
  if (typeof query?.limit === "number") {
    search.set("limit", String(query.limit));
  }

  const suffix = search.toString();
  return httpClient.request<{ items: FileNodeDto[] }>(
    `/api/affairs/library-files${suffix ? `?${suffix}` : ""}`
  );
}

export function getAffairsLibraryPreview(workspaceId: string, filePath: string) {
  return getAffairsLibraryPreviewWithOptions(workspaceId, filePath);
}

export function getAffairsLibraryPreviewWithOptions(
  workspaceId: string,
  filePath: string,
  options?: {
    officeDisplayMode?: "default" | "reading";
  }
) {
  const search = new URLSearchParams({
    path: filePath
  });

  if (options?.officeDisplayMode === "reading") {
    search.set("displayMode", "reading");
  }

  return httpClient.request<AffairsLibraryPreviewDto>(
    `/api/affairs/library-preview?${search.toString()}`
  );
}


export function downloadAffairsLibraryFile(workspaceId: string, filePath: string) {
  const search = new URLSearchParams({
    path: filePath
  });

  return httpClient.request<AffairsLibraryDownloadDto>(
    `/api/affairs/library-download?${search.toString()}`
  );
}

export function operateAffairsLibraryFile(
  workspaceId: string,
  payload: {
    opType: AffairsLibraryOperationType;
    srcPath?: string;
    dstPath?: string | null;
    content?: string | null;
    expectedVersion?: string | null;
  }
) {
  return httpClient.request<AffairsLibraryOperationResultDto>(
    "/api/affairs/library-ops",
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function requestAffairsLibraryRefresh(
  workspaceId: string,
  payload: { reason?: string; targetPath?: string | null } = {}
) {
  return httpClient.request<{
    scheduled?: boolean;
    taskId?: string;
    deduped?: boolean;
    status: AffairsLibraryIndexStatusDto;
    directoryStatus?: AffairsLibraryDirectoryStatusDto | null;
  }>("/api/affairs/library-refresh", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateAffairsLibraryFavorites(
  workspaceId: string,
  payload: { favorites: AffairsLibraryFavoriteRecordDto[] }
) {
  return httpClient.request<{ items: AffairsLibraryFavoriteRecordDto[] }>(
    "/api/affairs/library-favorites",
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export function updateGlobalAffairsLibraryFavorites(
  payload: { favorites: AffairsLibraryFavoriteRecordDto[] }
) {
  return httpClient.request<{ items: AffairsLibraryFavoriteRecordDto[] }>(
    "/api/affairs/library-favorites",
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export function getGlobalAffairsDashboardState() {
  return httpClient.request<AffairsDashboardStateDto>("/api/affairs/dashboard-state");
}

export function updateGlobalAffairsDashboardState(payload: { dashboardState: unknown }) {
  return httpClient.request<AffairsDashboardStateDto>("/api/affairs/dashboard-state", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getTeableGlobalBinding() {
  return httpClient.request<TeableGlobalBindingDto | null>("/api/affairs/teable/global-binding");
}

export function saveTeableGlobalBinding(payload: {
  baseUrl: string;
  spaceId: string;
  baseId: string;
  authRef: string;
  authToken?: string;
  enabled: boolean;
  mirrorMode: TeableMirrorModeDto;
}) {
  return httpClient.request<TeableGlobalBindingDto>("/api/affairs/teable/global-binding", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getTeableWorkbenchSyncConfigs() {
  return httpClient.request<TeableWorkbenchSyncConfigDto[]>("/api/affairs/teable/workbench-sync-config");
}

export function saveTeableWorkbenchSyncConfigs(payload: {
  items: Array<{
    sourceType: TeableSyncSourceTypeDto;
    enabled: boolean;
    scope?: Record<string, unknown>;
    targetTableId?: string | null;
  }>;
}) {
  return httpClient.request<TeableWorkbenchSyncConfigDto[]>("/api/affairs/teable/workbench-sync-config", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getTeableOverview() {
  return httpClient.request<TeableOverviewDto>("/api/affairs/teable/overview");
}

export function requestTeableMirrorSync(payload: {
  mirrorTypes?: TeableSyncSourceTypeDto[];
}) {
  return httpClient.request<TeableMirrorSyncTaskRequestDto>("/api/affairs/teable/mirror-sync", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getTeableSyncLogs(limit = 50) {
  const search = new URLSearchParams();
  search.set("limit", String(limit));
  return httpClient.request<TeableSyncLogDto[]>(`/api/affairs/teable/sync-logs?${search.toString()}`);
}

export function getTeableTableCatalog() {
  return httpClient.request<TeableTableCatalogItemDto[]>("/api/affairs/teable/table-catalog");
}

export function getTeableTableFields(tableId: string) {
  const search = new URLSearchParams({ tableId });
  return httpClient.request<TeableFieldSummaryDto[]>(`/api/affairs/teable/table-fields?${search.toString()}`);
}

export function createTeableTableFields(payload: {
  tableId: string;
  fields: Array<{
    sourceField: string;
    fieldName: string;
    fieldType: "singleLineText" | "longText" | "date";
    required?: boolean;
  }>;
}) {
  return httpClient.request<TeableCreatedFieldMappingDto[]>("/api/affairs/teable/table-fields", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getTeableFieldMappings() {
  return httpClient.request<{
    mappings: TeableFieldMappingDto[];
    sourceFieldsByType: Record<TeableSyncSourceTypeDto, TeableSourceFieldDefinitionDto[]>;
  }>("/api/affairs/teable/field-mappings");
}

export function saveTeableFieldMappings(payload: {
  items: Array<{
    configId: string;
    sourceType: TeableSyncSourceTypeDto;
    targetTableId: string;
    items: Array<{
      sourceField: string;
      targetFieldId: string;
      targetFieldName: string;
      required?: boolean;
    }>;
  }>;
}) {
  return httpClient.request<TeableFieldMappingDto[]>("/api/affairs/teable/field-mappings", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function listAffairsTags(workspaceId: string, query?: { includeDisabled?: boolean }) {
  const search = new URLSearchParams();
  if (query?.includeDisabled === true) {
    search.set("includeDisabled", "true");
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return httpClient.request<{
    items: AffairsTagNodeDto[];
    summary: {
      totalActiveTags: number;
      totalDisabledTags: number;
      totalRuleEnabledTags: number;
      totalBoundDocuments: number;
    };
    status: {
      recomputeState: "idle" | "queued" | "running" | "succeeded" | "failed";
      lastRecomputedAt: string | null;
      lastError: string | null;
    };
  }>(`/api/affairs/tags${suffix}`);
}

export function listGlobalAffairsTags(query?: { includeDisabled?: boolean }) {
  const search = new URLSearchParams();
  if (query?.includeDisabled === true) {
    search.set("includeDisabled", "true");
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return httpClient.request<{
    items: AffairsTagNodeDto[];
    summary: {
      totalActiveTags: number;
      totalDisabledTags: number;
      totalRuleEnabledTags: number;
      totalBoundDocuments: number;
    };
    status: {
      recomputeState: "idle" | "queued" | "running" | "succeeded" | "failed";
      lastRecomputedAt: string | null;
      lastError: string | null;
    };
  }>(`/api/affairs/tags${suffix}`);
}

export function createAffairsTag(
  workspaceId: string,
  payload: {
    name: string;
    parentId?: string | null;
    description?: string | null;
    status?: "active" | "disabled";
    smartRules?: AffairsTagRuleDto[];
  },
) {
  return httpClient.request<AffairsTagDetailWithRulesDto>(
    "/api/affairs/tags",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function ensureAffairsTag(
  workspaceId: string,
  payload: { path: string },
) {
  return httpClient.request<AffairsTagDetailWithRulesDto>(
    "/api/affairs/tags/ensure",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function getAffairsTagDetail(workspaceId: string, tagId: string) {
  return httpClient.request<AffairsTagDetailWithRulesDto>(
    `/api/affairs/tags/${encodeURIComponent(tagId)}`
  );
}

export function updateAffairsTag(
  workspaceId: string,
  tagId: string,
  payload: {
    name: string;
    parentId?: string | null;
    description?: string | null;
    status?: "active" | "disabled";
    smartRules?: AffairsTagRuleDto[];
  },
) {
  return httpClient.request<AffairsTagDetailWithRulesDto>(
    `/api/affairs/tags/${encodeURIComponent(tagId)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteAffairsTag(workspaceId: string, tagId: string) {
  return httpClient.request<{
    deletedTagIds: string[];
    deletedPaths: string[];
    exportRefreshTask: {
      taskId: string;
      deduped: boolean;
      status: "queued";
    } | null;
  }>(
    `/api/affairs/tags/${encodeURIComponent(tagId)}`,
    {
      method: "DELETE",
    },
  );
}

export function requestAffairsTagFullRecompute(workspaceId: string) {
  return httpClient.request<{
    taskId: string;
    deduped: boolean;
    status: "queued";
    scope: "full";
  }>(
    "/api/affairs/tags/recompute",
    {
      method: "POST",
    },
  );
}

export function getAffairsTagRecomputeTask(workspaceId: string) {
  return httpClient.request<AffairsTaskSnapshotDto | null>(
    "/api/affairs/tags/recompute-task"
  );
}

export function requestAffairsTagRecoveryRecompute(workspaceId: string) {
  return httpClient.request<{
    taskId: string;
    deduped: boolean;
    status: "queued";
    scope: "full";
  }>(
    "/api/affairs/tags/recovery/recompute",
    {
      method: "POST",
    },
  );
}

export function getAffairsDocumentTagDetails(workspaceId: string, documentId: string) {
  return httpClient.request<AffairsDocumentTagDetailsDto>(
    `/api/affairs/documents/${encodeURIComponent(documentId)}/tag-details`
  );
}

export function getAffairsDocumentTagTask(workspaceId: string, documentId: string) {
  return httpClient.request<AffairsTaskSnapshotDto | null>(
    `/api/affairs/documents/${encodeURIComponent(documentId)}/tag-task`
  );
}

export function saveAffairsDocumentTags(workspaceId: string, documentId: string, payload: { tagIds: string[] }) {
  return httpClient.request<{
    target: { type: "document"; documentId: string };
    items: AffairsResolvedTagSourceDto[];
    refreshTask: { taskId: string; deduped: boolean; affectedPaths: string[] } | null;
  }>(
    `/api/affairs/documents/${encodeURIComponent(documentId)}/tags`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function saveAffairsDocumentTagsWithCreate(
  workspaceId: string,
  documentId: string,
  payload: { tagIds: string[]; createTagPaths?: string[] },
) {
  return httpClient.request<{
    target: { type: "document"; documentId: string };
    items: AffairsResolvedTagSourceDto[];
    refreshTask: { taskId: string; deduped: boolean; affectedPaths: string[] } | null;
  }>(
    `/api/affairs/documents/${encodeURIComponent(documentId)}/tags`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function getAffairsFolderTagDetails(workspaceId: string, folderPath: string) {
  const search = new URLSearchParams({ folderPath });
  return httpClient.request<AffairsFolderTagDetailsDto>(
    `/api/affairs/folders/tag-details?${search.toString()}`
  );
}

export interface AffairsTaskProgressSnapshotDto {
  phase: string;
  label?: string | null;
  detail?: string | null;
  current?: number | null;
  total?: number | null;
  percent?: number | null;
  updatedAt: number;
}

export interface AffairsTaskSnapshotDto<TResult = unknown> {
  taskId: string;
  taskType: string;
  key: string;
  executionLane: "request_main_thread" | "host_background" | "helper_process" | "external_process";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timeout";
  source: string | null;
  attempt: number;
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  timeoutMs: number | null;
  progress?: AffairsTaskProgressSnapshotDto | null;
  result?: TResult;
  errorMessage?: string;
}

export interface AffairsTagRecoveryStatusDto {
  task: AffairsTaskSnapshotDto | null;
  bindingStats: {
    identityBindingCount: number;
    legacyBindingCount: number;
    legacyFallbackBindingCount: number;
    legacyFallbackDocumentCount: number;
  };
}

export function getAffairsTagRecoveryStatus(workspaceId: string) {
  return httpClient.request<AffairsTagRecoveryStatusDto>(
    "/api/affairs/tags/recovery/status"
  );
}

export function getAffairsFolderTagTask(workspaceId: string, folderPath: string) {
  const search = new URLSearchParams({ folderPath });
  return httpClient.request<AffairsTaskSnapshotDto | null>(
    `/api/affairs/folders/tag-task?${search.toString()}`
  );
}

export function saveAffairsFolderTags(workspaceId: string, payload: { folderPath: string; tagIds: string[] }) {
  return httpClient.request<{
    target: { type: "folder"; folderPath: string };
    items: AffairsResolvedTagSourceDto[];
    refreshTask: { taskId: string; deduped: boolean; affectedPaths: string[] } | null;
  }>(
    "/api/affairs/folders/tags",
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function saveAffairsFolderTagsWithCreate(
  workspaceId: string,
  payload: { folderPath: string; tagIds: string[]; createTagPaths?: string[] },
) {
  return httpClient.request<{
    target: { type: "folder"; folderPath: string };
    items: AffairsResolvedTagSourceDto[];
    refreshTask: { taskId: string; deduped: boolean; affectedPaths: string[] } | null;
  }>(
    "/api/affairs/folders/tags",
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function browseWorkspaceDirectories(targetPath?: string) {
  const search = new URLSearchParams();

  if (targetPath?.trim()) {
    search.set("path", targetPath.trim());
  }

  return httpClient.request<WorkspaceDirectoryBrowseDto>(
    `/api/workspaces/browse${search.size > 0 ? `?${search.toString()}` : ""}`
  );
}

export function createWorkspaceDirectory(payload: CreateWorkspaceDirectoryPayload) {
  return httpClient.request<WorkspaceCreatedDirectoryDto>("/api/workspaces/directories", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listWorkspaceSessions(workspaceId: string) {
  return httpClient.request<{ items: SessionSummaryDto[] }>(
    `/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}`
  );
}

export function startSession(payload: StartSessionPayload) {
  return httpClient.request<SessionSummaryDto>("/api/sessions/start", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getSessionDetail(sessionId: string) {
  return httpClient.request<SessionSummaryDto>(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export function getSessionChangedFiles(sessionId: string) {
  return httpClient.request<{ items: SessionChangedFileDto[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/changed-files`
  );
}

export function markSessionSeen(sessionId: string) {
  return httpClient.request<void>(`/api/sessions/${encodeURIComponent(sessionId)}/seen`, {
    method: "POST"
  });
}

export function renameSessionTitle(sessionId: string, title: string) {
  return httpClient.request<SessionSummaryDto>(`/api/sessions/${encodeURIComponent(sessionId)}/title`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
}

export function updateSessionArchiveState(sessionId: string, archived: boolean) {
  return httpClient.request<SessionSummaryDto>(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, {
    method: "PATCH",
    body: JSON.stringify({ archived })
  });
}

export function updateSessionFavoriteState(sessionId: string, favorite: boolean) {
  return httpClient.request<SessionSummaryDto>(`/api/sessions/${encodeURIComponent(sessionId)}/favorite`, {
    method: "PATCH",
    body: JSON.stringify({ favorite })
  });
}

export function deleteSession(sessionId: string) {
  return httpClient.request<void>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE"
  });
}

export function createParallelGroupFromSession(
  sessionId: string,
  payload: CreateParallelSessionGroupPayload
) {
  return httpClient.request<ParallelSessionGroupDetailDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/parallel-groups`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function createParallelGroupFromWorkspace(
  workspaceId: string,
  payload: CreateParallelSessionGroupPayload
) {
  return httpClient.request<ParallelSessionGroupDetailDto>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/parallel-groups`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function getParallelGroupDetail(groupId: string) {
  return httpClient.request<ParallelSessionGroupDetailDto>(
    `/api/parallel-groups/${encodeURIComponent(groupId)}`
  );
}

export function appendParallelGroupMembers(
  groupId: string,
  payload: AppendParallelGroupMembersPayload
) {
  return httpClient.request<ParallelSessionGroupDetailDto>(
    `/api/parallel-groups/${encodeURIComponent(groupId)}/members`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function deleteParallelGroup(groupId: string) {
  return httpClient.request<{
    group: ParallelSessionGroupDto;
    deletedSessionIds: string[];
    failedSessionIds: Array<{ sessionId: string; detail: string }>;
    isolatedWorkspaceCleanupResults: Array<{
      record: SessionIsolatedWorkspaceSummaryDto & {
        groupId?: string;
        ownerSessionId?: string;
        baseRef?: string;
        baseCommit?: string;
        headCommit?: string | null;
        removedAt?: string | null;
      };
      removed: boolean;
      branchDeleted: boolean;
      deletedBranchName: string | null;
      detail: string | null;
    }>;
  }>(`/api/parallel-groups/${encodeURIComponent(groupId)}`, {
    method: "DELETE"
  });
}

export function promoteSessionIsolatedWorkspace(id: string) {
  return httpClient.request<SessionIsolatedWorkspacePromoteDto>(
    `/api/session-isolated-workspaces/${encodeURIComponent(id)}/promote`,
    {
      method: "POST"
    }
  );
}

export function createWorktree(payload: CreateWorktreePayload) {
  return httpClient.request<CreateWorktreeResponseDto>("/api/worktrees", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getWorktreeMergePreview(workspaceId: string) {
  return httpClient.request<WorktreeMergePreviewDto>(
    `/api/worktrees/${encodeURIComponent(workspaceId)}/merge-preview`,
    {
      method: "POST"
    }
  );
}

export function mergeWorktreeIntoParent(workspaceId: string) {
  return httpClient.request<WorktreeMergeApplyResponseDto>(
    `/api/worktrees/${encodeURIComponent(workspaceId)}/merge-into-parent`,
    {
      method: "POST"
    }
  );
}

export function cleanupWorktree(workspaceId: string, payload?: { deleteBranch?: boolean }) {
  return httpClient.request<WorktreeCleanupResponseDto>(
    `/api/worktrees/${encodeURIComponent(workspaceId)}/cleanup`,
    {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    }
  );
}

export function getSessionCapabilities(sessionId: string) {
  return httpClient.request<ProviderCapabilitiesDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/capabilities`
  );
}

export function getSessionPermissionRequests(sessionId: string) {
  return httpClient.request<SessionPermissionRequestListDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/permission-requests`
  );
}

export function listQuickPhrases() {
  return httpClient.request<{ items: QuickPhraseDto[] }>("/api/preferences/quick-phrases");
}

export function replaceQuickPhrases(items: Array<{ id?: string; text: string }>) {
  return httpClient.request<{ items: QuickPhraseDto[] }>("/api/preferences/quick-phrases", {
    method: "PUT",
    body: JSON.stringify({ items })
  });
}

export function getProviderCapabilities(
  provider: ProviderId,
  workspaceId?: string,
  providerConfig?: {
    providerConfigMode?: SessionProviderConfigMode;
    providerPresetId?: string | null;
  }
) {
  const search = new URLSearchParams();

  if (workspaceId?.trim()) {
    search.set("workspaceId", workspaceId.trim());
  }

  if (providerConfig?.providerConfigMode === "cc-switch-preset" && providerConfig.providerPresetId?.trim()) {
    search.set("providerConfigMode", "cc-switch-preset");
    search.set("providerPresetId", providerConfig.providerPresetId.trim());
  }

  return httpClient.request<ProviderCapabilitiesDto>(
    `/api/providers/${encodeURIComponent(provider)}/capabilities${
      search.size > 0 ? `?${search.toString()}` : ""
    }`
  );
}

export async function listProviderCatalog(): Promise<ProviderCatalogEntryDto[]> {
  const response = await httpClient.request<{ items: ProviderCatalogEntryDto[] }>("/api/providers/catalog");
  return response.items;
}

export async function refreshProviderCatalog(): Promise<ProviderCatalogEntryDto[]> {
  const response = await httpClient.request<{ items: ProviderCatalogEntryDto[] }>(
    "/api/providers/catalog/refresh",
    {
      method: "POST"
    }
  );
  return response.items;
}

export async function updateProviderCatalogEntry(
  provider: ProviderId,
  enabled: boolean
): Promise<ProviderCatalogEntryDto> {
  const response = await httpClient.request<{ item: ProviderCatalogEntryDto }>(
    `/api/providers/catalog/${encodeURIComponent(provider)}`,
    {
      method: "PUT",
      body: JSON.stringify({ enabled })
    }
  );

  return response.item;
}

export async function listProviderCapabilities(
  providers: readonly ProviderId[],
  workspaceId?: string
): Promise<Partial<Record<ProviderId, ProviderCapabilitiesDto>>> {
  const results = await Promise.allSettled(
    providers.map(async (provider) => [provider, await getProviderCapabilities(provider, workspaceId)] as const)
  );
  const entries: Array<[ProviderId, ProviderCapabilitiesDto]> = [];

  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }

    const [provider, capabilities] = result.value;
    entries.push([provider, capabilities]);
  }

  return Object.fromEntries(entries) as Partial<Record<ProviderId, ProviderCapabilitiesDto>>;
}

export function getSessionMessages(
  sessionId: string,
  cursor: string | null,
  limit: number,
  direction: HistoryDirection = "forward"
) {
  const search = new URLSearchParams();

  if (cursor) {
    search.set("cursor", cursor);
  }

  search.set("limit", String(limit));
  search.set("direction", direction);

  return httpClient.request<HistoryPageDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?${search.toString()}`
  );
}

export function getSessionAttachmentBlob(sessionId: string, attachmentId: string) {
  return httpClient.requestBlob(
    `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}/content`
  );
}

export interface AffairsAssistantSessionsSnapshotDto {
  projectId: string | null;
  projectWorkspaceId: string | null;
  agentWorkspacePath: string | null;
  sessions: SessionSummaryDto[];
  updatedAt: string;
}

export function getAffairsAssistantSessionsSnapshot(workspaceId: string, options?: {
  refresh?: boolean;
}) {
  const headers = new Headers();
  if (options?.refresh) {
    headers.set("X-CodingNS-Affairs-Assistant-Refresh", "true");
  }

  return httpClient.request<{ item: AffairsAssistantSessionsSnapshotDto }>(
    "/api/affairs/assistant-sessions",
    {
      headers
    }
  );
}

export function sendSessionMessage(
  sessionId: string,
  payload: SendSessionMessagePayload
) {
  return httpClient.request<SendMessageResponseDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function forkSession(sessionId: string, payload: ForkSessionPayload) {
  return httpClient.request<SessionSummaryDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/forks`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function startLiveSession(payload: StartLivePayload) {
  return httpClient.request<StartLiveResponseDto>("/api/sessions/start-live", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listAffairsLightweightSessions(workspaceId: string) {
  return httpClient.request<{ items: SessionSummaryDto[] }>(
    "/api/affairs/lightweight-sessions"
  );
}

export function getAffairsLightweightSession(workspaceId: string, sessionId: string) {
  return httpClient.request<SessionSummaryDto>(
    `/api/affairs/lightweight-sessions/${encodeURIComponent(sessionId)}`
  );
}

export function getAffairsLightweightSessionMessages(workspaceId: string, sessionId: string) {
  return httpClient.request<HistoryPageDto>(
    `/api/affairs/lightweight-sessions/${encodeURIComponent(sessionId)}/messages`
  );
}

export function markAffairsLightweightSessionSeen(workspaceId: string, sessionId: string, seenAt?: string) {
  return httpClient.request<void>(
    `/api/affairs/lightweight-sessions/${encodeURIComponent(sessionId)}/seen`,
    {
      method: "POST",
      body: JSON.stringify(seenAt ? { seenAt } : {})
    }
  );
}

export function renameAffairsLightweightSessionTitle(workspaceId: string, sessionId: string, title: string) {
  return httpClient.request<SessionSummaryDto>(
    `/api/affairs/lightweight-sessions/${encodeURIComponent(sessionId)}/title`,
    {
      method: "PATCH",
      body: JSON.stringify({ title })
    }
  );
}

export function updateAffairsLightweightSessionArchiveState(
  workspaceId: string,
  sessionId: string,
  archived: boolean
) {
  return httpClient.request<SessionSummaryDto>(
    `/api/affairs/lightweight-sessions/${encodeURIComponent(sessionId)}/archive`,
    {
      method: "PATCH",
      body: JSON.stringify({ archived })
    }
  );
}

export function updateAffairsLightweightSessionFavoriteState(
  workspaceId: string,
  sessionId: string,
  favorite: boolean
) {
  return httpClient.request<SessionSummaryDto>(
    `/api/affairs/lightweight-sessions/${encodeURIComponent(sessionId)}/favorite`,
    {
      method: "PATCH",
      body: JSON.stringify({ favorite })
    }
  );
}

export function deleteAffairsLightweightSession(workspaceId: string, sessionId: string) {
  return httpClient.request<void>(
    `/api/affairs/lightweight-sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE"
    }
  );
}

export function startAffairsLightweightSession(
  workspaceId: string,
  payload: StartAffairsLightweightSessionPayload
) {
  return httpClient.request<AffairsLightweightSessionTurnResponseDto>(
    "/api/affairs/lightweight-sessions",
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export async function startAffairsLightweightSessionStream(
  workspaceId: string,
  payload: StartAffairsLightweightSessionPayload,
  onEvent: (event: AffairsLightweightSessionStreamEventDto) => void | Promise<void>
) {
  const response = await httpClient.requestRaw(
    "/api/affairs/lightweight-sessions/stream",
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
  return consumeAffairsLightweightSessionStream(response, onEvent);
}

export function sendAffairsLightweightSessionMessage(
  workspaceId: string,
  sessionId: string,
  payload: SendAffairsLightweightSessionMessagePayload
) {
  return httpClient.request<AffairsLightweightSessionTurnResponseDto>(
    `/api/affairs/lightweight-sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export async function sendAffairsLightweightSessionMessageStream(
  workspaceId: string,
  sessionId: string,
  payload: SendAffairsLightweightSessionMessagePayload,
  onEvent: (event: AffairsLightweightSessionStreamEventDto) => void | Promise<void>
) {
  const response = await httpClient.requestRaw(
    `/api/affairs/lightweight-sessions/${encodeURIComponent(sessionId)}/messages/stream`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
  return consumeAffairsLightweightSessionStream(response, onEvent);
}

export function sendLiveMessage(
  sessionId: string,
  payload: SendLiveMessagePayload
) {
  return httpClient.request<SendMessageResponseDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages/live`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function getSessionQueue(sessionId: string) {
  return httpClient.request<{ items: SessionQueueItemDto[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/queue`
  );
}

export function enqueueSessionMessage(
  sessionId: string,
  payload: SendLiveMessagePayload
) {
  return httpClient.request<SessionQueueItemDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/queue`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function deleteSessionQueueItem(sessionId: string, queueItemId: string) {
  return httpClient.request<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(queueItemId)}`,
    {
      method: "DELETE"
    }
  );
}

export function steerSessionQueueItem(sessionId: string, queueItemId: string) {
  return httpClient.request<StartLiveResponseDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(queueItemId)}/steer`,
    {
      method: "POST"
    }
  );
}

export function getSessionRuntime(sessionId: string) {
  return httpClient.request<SessionRuntimeDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/runtime`
  );
}

export function interruptSession(sessionId: string) {
  return httpClient.request<InterruptSessionResponseDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/interrupt`,
    {
      method: "POST"
    }
  );
}

export function replySessionPermissionRequest(
  sessionId: string,
  requestId: string,
  payload: ReplyPermissionRequestPayload
) {
  return httpClient.request<SessionPermissionRequestDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/permission-requests/${encodeURIComponent(requestId)}/reply`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

async function consumeAffairsLightweightSessionStream(
  response: Response,
  onEvent: (event: AffairsLightweightSessionStreamEventDto) => void | Promise<void>
): Promise<AffairsLightweightSessionTurnResponseDto> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ApiError(0, {
      detail: "轻量会话流式响应为空",
      error_code: "INVALID_RESPONSE"
    });
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let completed: AffairsLightweightSessionTurnResponseDto | null = null;

  const consumeLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let parsed: AffairsLightweightSessionStreamEventDto;
    try {
      parsed = JSON.parse(trimmed) as AffairsLightweightSessionStreamEventDto;
    } catch (error) {
      const detail = error instanceof Error ? `：${error.message}` : "";
      throw new ApiError(0, {
        detail: `轻量会话流式响应不是合法 JSON${detail}`,
        error_code: "INVALID_RESPONSE"
      });
    }

    if (parsed.type === "error") {
      throw new ApiError(502, {
        detail: parsed.detail,
        error_code: parsed.errorCode
      });
    }

    if (parsed.type === "completed") {
      completed = parsed.result;
    }

    await onEvent(parsed);
  };

  while (true) {
    const next = await reader.read();
    buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      await consumeLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
    if (next.done) {
      break;
    }
  }

  if (buffer.trim()) {
    await consumeLine(buffer);
  }

  if (!completed) {
    throw new ApiError(0, {
      detail: "轻量会话流式响应提前结束，缺少 completed 事件",
      error_code: "INVALID_RESPONSE"
    });
  }

  return completed;
}
