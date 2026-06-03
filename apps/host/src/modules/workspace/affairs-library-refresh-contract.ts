export const AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS = {
  refreshRequested: "refresh_requested",
  refreshFailed: "refresh_failed",
  bindingRequired: "binding_required",
  libraryDisabled: "library_disabled",
  missingIndexArtifact: "missing_index_artifact",
  missingExportDir: "missing_export_dir",
  missingExportStatus: "missing_export_status",
  missingExportManifest: "missing_export_manifest",
  commandLockMissing: "command_lock_missing",
  commandLockOwnerDead: "command_lock_owner_dead",
  commandLockHeartbeatStale: "command_lock_heartbeat_stale",
  queueTimeout: "queue_timeout",
  staleFallback: "stale_fallback",
  driftDetected: "drift_detected",
  rebuildRequired: "rebuild_required"
} as const;

export const AFFAIRS_LIBRARY_RECONCILE_SCOPES = {
  lightweight: "lightweight",
  periodicAudit: "periodic_audit"
} as const;

export const AFFAIRS_LIBRARY_RECONCILE_STATUSES = {
  healthy: "healthy",
  driftDetected: "drift_detected",
  rebuildRequired: "rebuild_required"
} as const;

export const AFFAIRS_LIBRARY_RECONCILE_REASONS = {
  timer: "lightweight_reconcile:timer",
  pendingDirtySignal: "lightweight_reconcile:pending_dirty_signal",
  runtimeStatusAhead: "lightweight_reconcile:runtime_status_ahead",
  recentDirectoryMtime: "lightweight_reconcile:recent_directory_mtime",
  periodicAuditTimer: "periodic_audit:timer",
  periodicAuditPendingDirtySignal: "periodic_audit:pending_dirty_signal",
  periodicAuditRuntimeStatusAhead: "periodic_audit:runtime_status_ahead",
  periodicAuditLightweightDriftStreak: "periodic_audit:lightweight_drift_streak",
  periodicAuditRootDirMtime: "periodic_audit:root_dir_mtime"
} as const;

export const AFFAIRS_LIBRARY_DEBUG_EVENTS = {
  lightweightReconcileTick: "lightweight_reconcile_tick",
  lightweightReconcileSkipped: "lightweight_reconcile_skipped",
  lightweightReconcileDriftDetected: "lightweight_reconcile_drift_detected",
  lightweightReconcileScheduledRefresh: "lightweight_reconcile_scheduled_refresh",
  periodicAuditTick: "periodic_audit_tick",
  periodicAuditSkipped: "periodic_audit_skipped",
  periodicAuditDriftDetected: "periodic_audit_drift_detected",
  periodicAuditScheduledRefresh: "periodic_audit_scheduled_refresh"
} as const;

export type AffairsLibraryReconcileScope =
  (typeof AFFAIRS_LIBRARY_RECONCILE_SCOPES)[keyof typeof AFFAIRS_LIBRARY_RECONCILE_SCOPES];

export type AffairsLibraryReconcileStatus =
  (typeof AFFAIRS_LIBRARY_RECONCILE_STATUSES)[keyof typeof AFFAIRS_LIBRARY_RECONCILE_STATUSES];

export interface AffairsLibraryReconcileResult {
  scope: AffairsLibraryReconcileScope;
  status: AffairsLibraryReconcileStatus;
  reason: string;
  targetPaths: string[];
  observedAt: string;
}
