export const HOST_TASK_TYPES = {
  channelAccountPoll: "channel.account_poll",
  channelDeliveryRetry: "channel.delivery_retry",
  relayTunnelConnect: "relay_tunnel.connect",
  workspaceDiscovery: "workspace.discovery",
  workspaceDiscoveryScan: "workspace.discovery_scan",
  providerCapabilityRefresh: "provider.capability_refresh",
  providerClaudeModelDiscovery: "provider.claude_model_discovery",
  harnessSidecarHealth: "harness.sidecar.health",
  harnessSessionReconcile: "harness.session.reconcile",
  sessionCodexTitleGenerate: "session.codex_title_generate",
  sessionCleanupScan: "session_cleanup.scan",
  sessionCleanupBackup: "session_cleanup.backup",
  sessionCleanupRestore: "session_cleanup.restore",
  sessionCleanupDelete: "session_cleanup.delete",
  workbenchSyncTitles: "workbench.sync_titles",
  workbenchAffairsAssistantSessions: "workbench.affairs_assistant_sessions",
  workspaceManagementSummary: "workspace.management_summary",
  workspaceCodeCompositionScan: "workspace.code_composition_scan",
  butlerInboxAnalyze: "butler.inbox_analyze",
  terminalManagerSnapshot: "terminal.manager_snapshot",
  templateRuntimeStatusDiscovery: "terminal.template_runtime_status_discovery",
  debugRuntimeStaleReconciliation: "debug_runtime.stale_reconciliation",
  serviceNpmGlobalUpdateInstall: "service.npm_global_update_install",
  assistantAutomationTick: "assistant.automation.tick",
  assistantAutomationEvaluate: "assistant.automation.evaluate",
  verificationRunExecute: "butler.verification_run.execute",
  officeDocumentExportExecute: "office.document_export.execute",
  affairsLibraryApplyConfig: "affairs.library_apply_config",
  affairsLibraryDirectoryHint: "affairs.library_directory_hint",
  affairsLibraryIndex: "affairs.library_index",
  affairsLibraryExport: "affairs.library_export",
  affairsLibraryTagRecompute: "affairs.library_tag_recompute",
  affairsLibraryTagApplyBindings: "affairs.library_tag_apply_bindings",
  affairsLibraryTagExportRefresh: "affairs.library_tag_export_refresh",
  teableMirrorSync: "teable.mirror_sync",
  pluginScheduleTrigger: "plugin.schedule.trigger",
  pluginActionExecute: "plugin.action.execute",
  presentationExportPdf: "presentation.export_pdf",
  presentationExportPptx: "presentation.export_pptx"
} as const;

export type HostTaskType = (typeof HOST_TASK_TYPES)[keyof typeof HOST_TASK_TYPES];

export type TaskExecutionLane =
  | "request_main_thread"
  | "host_background"
  | "helper_process"
  | "external_process";

export type TaskStatus =
  | "queued"
  | "running"
  | "queue_timeout"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout";

export type TaskCounterMetricName =
  | "enqueue"
  | "dedupe"
  | "started"
  | "finished"
  | "failed"
  | "cancelled"
  | "timeout"
  | "cache_hit";

export type TaskDurationMetricName = "wait_ms" | "run_ms";

export interface TaskRetryPolicy {
  maxAttempts: number;
  backoffMs?: number | ((attempt: number) => number);
}

export interface TaskDefinition<TInput = unknown, TResult = unknown> {
  taskType: string;
  executionLane: TaskExecutionLane;
  concurrency?: number;
  timeoutMs?: number;
  queueWaitTimeoutMs?: number;
  retryPolicy?: TaskRetryPolicy;
  helperProcessHandler?: string;
  run: (input: TInput, context: TaskRunContext) => Promise<TResult>;
}

export interface TaskRunContext {
  readonly taskType: string;
  readonly key: string;
  readonly taskId: string;
  readonly executionLane: TaskExecutionLane;
  readonly attempt: number;
  readonly signal: AbortSignal;
  reportProgress(progress: TaskProgressUpdate): void;
}

export interface TaskProgressUpdate {
  readonly phase: string;
  readonly label?: string | null;
  readonly detail?: string | null;
  readonly current?: number | null;
  readonly total?: number | null;
  readonly percent?: number | null;
}

export interface TaskProgressSnapshot extends TaskProgressUpdate {
  readonly updatedAt: number;
}

export interface TaskLaneExecutor {
  execute<TInput, TResult>(
    definition: TaskDefinition<TInput, TResult>,
    input: TInput,
    context: TaskRunContext
  ): Promise<TResult>;
}

export interface TaskEnqueueOptions<TInput = unknown> {
  key: string;
  input: TInput;
  source?: string;
}

export interface TaskHandle<TResult = unknown> {
  readonly taskId: string;
  readonly taskType: string;
  readonly key: string;
  readonly executionLane: TaskExecutionLane;
  readonly deduped: boolean;
  readonly promise: Promise<TResult>;
  cancel(reason?: string): void;
}

export interface TaskSnapshot<TResult = unknown> {
  readonly taskId: string;
  readonly taskType: string;
  readonly key: string;
  readonly executionLane: TaskExecutionLane;
  readonly status: TaskStatus;
  readonly source: string | null;
  readonly attempt: number;
  readonly enqueuedAt: number;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  readonly timeoutMs: number | null;
  readonly progress?: TaskProgressSnapshot | null;
  readonly result?: TResult;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly errorDetail?: string;
}

export interface TaskCancelFilter {
  taskTypes?: readonly string[];
  key?: string;
  keyPrefix?: string;
}

export interface TaskMetricGroupSnapshot {
  readonly executionLane: TaskExecutionLane;
  readonly counters: Readonly<Record<TaskCounterMetricName, number>>;
  readonly waitMs: TaskDurationStatsSnapshot;
  readonly runMs: TaskDurationStatsSnapshot;
}

export interface TaskDurationStatsSnapshot {
  readonly count: number;
  readonly total: number;
  readonly max: number;
  readonly min: number | null;
  readonly avg: number;
}

export interface TaskMetricsSnapshot {
  readonly totals: Readonly<Record<TaskCounterMetricName, number>>;
  readonly taskTypes: Readonly<Record<string, TaskMetricGroupSnapshot>>;
}

export interface TaskActivitySink {
  record(event: {
    eventType: "enqueued" | "deduped" | "started" | "finished" | "failed" | "cancelled" | "timeout" | "cache_hit";
    taskId?: string | null;
    taskType: string;
    key: string;
    executionLane: TaskExecutionLane;
    source?: string | null;
    status?: TaskStatus | null;
    attempt?: number | null;
    waitMs?: number | null;
    runMs?: number | null;
    errorMessage?: string | null;
  }): void;
}

export class TaskCancelledError extends Error {
  constructor(message = "任务已取消") {
    super(message);
    this.name = "TaskCancelledError";
  }
}

export class TaskTimeoutError extends Error {
  constructor(message = "任务执行超时") {
    super(message);
    this.name = "TaskTimeoutError";
  }
}

export class TaskQueueWaitTimeoutError extends Error {
  constructor(message = "任务排队等待超时") {
    super(message);
    this.name = "TaskQueueWaitTimeoutError";
  }
}
