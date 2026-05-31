import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ModalCloseButton } from "../components/ModalCloseButton";
import { httpClient } from "../network/http-client";
import { t } from "../shared/i18n";

const SESSION_TTL_MS = 20_000;
const SNAPSHOT_INTERVAL_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

type TaskExecutionLane =
  | "request_main_thread"
  | "host_background"
  | "helper_process"
  | "external_process";

type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout";

type TaskActivityEventType =
  | "enqueued"
  | "deduped"
  | "started"
  | "finished"
  | "failed"
  | "cancelled"
  | "timeout"
  | "cache_hit";

interface RuntimeObservabilitySessionLease {
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly ttlMs: number;
}

interface TaskDurationStatsSnapshot {
  readonly count: number;
  readonly total: number;
  readonly max: number;
  readonly min: number | null;
  readonly avg: number;
}

interface TaskMetricGroupSnapshot {
  readonly executionLane: TaskExecutionLane;
  readonly counters: Record<string, number>;
  readonly waitMs: TaskDurationStatsSnapshot;
  readonly runMs: TaskDurationStatsSnapshot;
}

interface TaskActivityRecord {
  readonly eventId: string;
  readonly recordedAt: string;
  readonly eventType: TaskActivityEventType;
  readonly taskId: string | null;
  readonly taskType: string;
  readonly key: string;
  readonly executionLane: TaskExecutionLane;
  readonly source: string | null;
  readonly status: TaskStatus | null;
  readonly attempt: number | null;
  readonly waitMs: number | null;
  readonly runMs: number | null;
  readonly errorMessage: string | null;
}

interface RegisteredTaskSummary {
  readonly taskType: string;
  readonly executionLane: TaskExecutionLane;
  readonly timeoutMs: number | null;
  readonly concurrency: number | null;
  readonly retryMaxAttempts: number | null;
  readonly helperProcessHandler: string | null;
}

interface RuntimeObservabilitySnapshot {
  readonly observedAt: string;
  readonly session: RuntimeObservabilitySessionLease;
  readonly backgroundTasks: {
    readonly totals: Record<string, number>;
    readonly taskTypes: Record<string, TaskMetricGroupSnapshot>;
  };
  readonly registeredTasks: RegisteredTaskSummary[];
  readonly recentTaskActivities: TaskActivityRecord[];
  readonly schedulers: {
    readonly schedulers: Record<string, {
      readonly tickTotal: number;
      readonly idleTickTotal: number;
      readonly errorTotal: number;
      readonly taskCountTotal: number;
      readonly durationMs: TaskDurationStatsSnapshot;
      readonly lastTickAt: string | null;
      readonly lastDurationMs: number | null;
      readonly lastTaskCount: number;
      readonly lastIdle: boolean;
      readonly lastErrorCount: number;
      readonly nextDelayMs: number | null;
      readonly idleStreak: number;
    }>;
  };
  readonly eventLoop: {
    readonly enabled: boolean;
    readonly resolutionMs: number;
    readonly minMs: number;
    readonly maxMs: number;
    readonly meanMs: number;
    readonly stddevMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly p99Ms: number;
  };
}

interface ParallelTaskDebugModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function ParallelTaskDebugModal({ isOpen, onClose }: ParallelTaskDebugModalProps) {
  const [session, setSession] = useState<RuntimeObservabilitySessionLease | null>(null);
  const [snapshot, setSnapshot] = useState<RuntimeObservabilitySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let disposed = false;

    async function openSession(): Promise<void> {
      setLoading(true);
      setErrorText(null);
      setSnapshot(null);

      try {
        const createdSession = await httpClient.request<RuntimeObservabilitySessionLease>(
          "/api/observability/runtime/session",
          {
            method: "POST",
            body: JSON.stringify({
              ttlMs: SESSION_TTL_MS
            })
          }
        );

        if (disposed) {
          await closeRuntimeSession(createdSession.sessionId);
          return;
        }

        sessionIdRef.current = createdSession.sessionId;
        setSession(createdSession);

        const initialSnapshot = await requestSnapshot(createdSession.sessionId);

        if (disposed) {
          await closeRuntimeSession(createdSession.sessionId);
          return;
        }

        setSnapshot(initialSnapshot);
      } catch (error) {
        if (!disposed) {
          setErrorText(resolveErrorMessage(error));
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }

    void openSession();

    return () => {
      disposed = true;
      const currentSessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      setSession(null);
      setSnapshot(null);
      setLoading(false);
      setRefreshing(false);
      setErrorText(null);

      if (currentSessionId) {
        void closeRuntimeSession(currentSessionId);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    const sessionId = session?.sessionId ?? null;

    if (!isOpen || !sessionId) {
      return;
    }

    const activeSessionId: string = sessionId;
    let stopped = false;

    async function refreshSnapshot(): Promise<void> {
      setRefreshing(true);

      try {
        const nextSnapshot = await requestSnapshot(activeSessionId);

        if (!stopped) {
          setSnapshot(nextSnapshot);
          setErrorText(null);
        }
      } catch (error) {
        if (!stopped) {
          setErrorText(resolveErrorMessage(error));
        }
      } finally {
        if (!stopped) {
          setRefreshing(false);
        }
      }
    }

    const timer = window.setInterval(() => {
      void refreshSnapshot();
    }, SNAPSHOT_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [isOpen, session?.sessionId]);

  useEffect(() => {
    const sessionId = session?.sessionId ?? null;

    if (!isOpen || !sessionId) {
      return;
    }

    const activeSessionId: string = sessionId;
    let stopped = false;

    async function heartbeat(): Promise<void> {
      try {
        const lease = await httpClient.request<RuntimeObservabilitySessionLease>(
          `/api/observability/runtime/session/${activeSessionId}/heartbeat`,
          {
            method: "POST",
            body: JSON.stringify({
              ttlMs: SESSION_TTL_MS
            })
          }
        );

        if (!stopped) {
          setSession(lease);
        }
      } catch (error) {
        if (!stopped) {
          setErrorText(resolveErrorMessage(error));
        }
      }
    }

    const timer = window.setInterval(() => {
      void heartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [isOpen, session?.sessionId]);

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  const taskTypeEntries = Object.entries(snapshot?.backgroundTasks.taskTypes ?? {});
  const registeredTaskEntries = snapshot?.registeredTasks ?? [];
  const schedulerEntries = Object.entries(snapshot?.schedulers.schedulers ?? {});
  const counterEntries = Object.entries(snapshot?.backgroundTasks.totals ?? {});

  return createPortal(
    <div className="workbench-modal-layer parallel-task-debug-modal-layer" aria-hidden={!isOpen}>
      <button
        type="button"
        className="workbench-modal-backdrop parallel-task-debug-modal-backdrop"
        aria-label={t("settings.parallelTaskDebugClose")}
        onClick={onClose}
      />
      <div
        className="workbench-modal-card surface-card parallel-task-debug-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="parallel-task-debug-title"
      >
        <div className="workbench-modal-header">
          <div className="workbench-modal-title-wrap">
            <h2 id="parallel-task-debug-title">{t("settings.parallelTaskDebugModalTitle")}</h2>
            <p>{t("settings.parallelTaskDebugModalDescription")}</p>
          </div>
          <div className="workbench-modal-header-actions">
            <span className="parallel-task-debug-status-chip" data-tone={errorText ? "error" : "active"}>
              {errorText ? t("settings.parallelTaskDebugStatusError") : t("settings.parallelTaskDebugStatusActive")}
            </span>
            <ModalCloseButton
              onClick={onClose}
              aria-label={t("settings.parallelTaskDebugClose")}
            />
          </div>
        </div>

        <div className="workbench-modal-body parallel-task-debug-body">
          <div className="parallel-task-debug-meta-grid">
            <div className="parallel-task-debug-meta-card">
              <span>{t("settings.parallelTaskDebugObservedAt")}</span>
              <strong>{formatDateTime(snapshot?.observedAt)}</strong>
            </div>
            <div className="parallel-task-debug-meta-card">
              <span>{t("settings.parallelTaskDebugSessionExpireAt")}</span>
              <strong>{formatDateTime(session?.expiresAt)}</strong>
            </div>
            <div className="parallel-task-debug-meta-card">
              <span>{t("settings.parallelTaskDebugSessionTtl")}</span>
              <strong>{formatDuration(session?.ttlMs ?? null)}</strong>
            </div>
            <div className="parallel-task-debug-meta-card">
              <span>{t("settings.parallelTaskDebugCollectorState")}</span>
              <strong>
                {snapshot?.eventLoop.enabled
                  ? t("settings.parallelTaskDebugCollectorEnabled")
                  : t("settings.parallelTaskDebugCollectorDisabled")}
              </strong>
            </div>
          </div>

          {loading ? (
            <div className="parallel-task-debug-empty">{t("settings.parallelTaskDebugLoading")}</div>
          ) : null}

          {!loading && errorText ? (
            <div className="parallel-task-debug-error">{errorText}</div>
          ) : null}

          {!loading && !errorText && snapshot ? (
            <>
              <section className="parallel-task-debug-section">
                <div className="parallel-task-debug-section-header">
                  <h3>{t("settings.parallelTaskDebugCountersTitle")}</h3>
                  <span>
                    {refreshing ? t("common.loading") : t("settings.parallelTaskDebugAutoRefresh")}
                  </span>
                </div>
                <div className="parallel-task-debug-counter-grid">
                  {counterEntries.map(([metricName, value]) => (
                    <div className="parallel-task-debug-counter-card" key={metricName}>
                      <span>{getCounterLabel(metricName)}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="parallel-task-debug-section">
                <div className="parallel-task-debug-section-header">
                  <h3>{t("settings.parallelTaskDebugRegisteredTasksTitle")}</h3>
                  <span>{registeredTaskEntries.length}</span>
                </div>
                {registeredTaskEntries.length > 0 ? (
                  <div className="parallel-task-debug-grid">
                    {registeredTaskEntries.map((task) => (
                      <article className="parallel-task-debug-panel" key={task.taskType}>
                        <div className="parallel-task-debug-panel-header">
                          <strong>{task.taskType}</strong>
                          <span>{getExecutionLaneLabel(task.executionLane)}</span>
                        </div>
                        <div className="parallel-task-debug-panel-body">
                          <span>{t("settings.parallelTaskDebugTaskCategory")}: {getTaskCategoryLabel(task.taskType)}</span>
                          <span>{t("settings.parallelTaskDebugTaskRuntime")}: {getTaskRuntimeLabel(task.executionLane, task.taskType)}</span>
                          <span>{t("settings.parallelTaskDebugTaskTimeout")}: {formatMs(task.timeoutMs)}</span>
                          <span>{t("settings.parallelTaskDebugTaskConcurrency")}: {task.concurrency ?? t("common.none")}</span>
                          <span>{t("settings.parallelTaskDebugTaskRetry")}: {task.retryMaxAttempts ?? t("common.none")}</span>
                          <span>{t("settings.parallelTaskDebugTaskHelper")}: {task.helperProcessHandler ?? t("common.none")}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="parallel-task-debug-empty">{t("settings.parallelTaskDebugRegisteredTasksEmpty")}</div>
                )}
              </section>

              <section className="parallel-task-debug-section">
                <div className="parallel-task-debug-section-header">
                  <h3>{t("settings.parallelTaskDebugTaskMetricsTitle")}</h3>
                  <span>{taskTypeEntries.length}</span>
                </div>
                {taskTypeEntries.length > 0 ? (
                  <div className="parallel-task-debug-grid">
                    {taskTypeEntries.map(([taskType, metrics]) => (
                      <article className="parallel-task-debug-panel" key={taskType}>
                        <div className="parallel-task-debug-panel-header">
                          <strong>{taskType}</strong>
                          <span>{getExecutionLaneLabel(metrics.executionLane)}</span>
                        </div>
                        <div className="parallel-task-debug-panel-body">
                          <span>{t("settings.parallelTaskDebugTaskCategory")}: {getTaskCategoryLabel(taskType)}</span>
                          <span>{t("settings.parallelTaskDebugTaskRuntime")}: {getTaskRuntimeLabel(metrics.executionLane, taskType)}</span>
                          <span>{t("settings.parallelTaskDebugWaitAvg")}: {formatMs(metrics.waitMs.avg)}</span>
                          <span>{t("settings.parallelTaskDebugRunAvg")}: {formatMs(metrics.runMs.avg)}</span>
                          <span>{t("settings.parallelTaskDebugRunMax")}: {formatMs(metrics.runMs.max)}</span>
                          <span>{t("settings.parallelTaskDebugStartedCount")}: {metrics.counters.started ?? 0}</span>
                          <span>{t("settings.parallelTaskDebugFinishedCount")}: {metrics.counters.finished ?? 0}</span>
                          <span>{t("settings.parallelTaskDebugFailedCount")}: {metrics.counters.failed ?? 0}</span>
                          <span>{t("settings.parallelTaskDebugCacheHitCount")}: {metrics.counters.cache_hit ?? 0}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="parallel-task-debug-empty">{t("settings.parallelTaskDebugActiveTaskMetricsEmpty")}</div>
                )}
              </section>

              <section className="parallel-task-debug-section">
                <div className="parallel-task-debug-section-header">
                  <h3>{t("settings.parallelTaskDebugSchedulerTitle")}</h3>
                  <span>{schedulerEntries.length}</span>
                </div>
                {schedulerEntries.length > 0 ? (
                  <div className="parallel-task-debug-grid">
                    {schedulerEntries.map(([schedulerName, metrics]) => (
                      <article className="parallel-task-debug-panel" key={schedulerName}>
                        <div className="parallel-task-debug-panel-header">
                          <strong>{schedulerName}</strong>
                          <span>{metrics.lastIdle ? t("settings.parallelTaskDebugIdle") : t("settings.parallelTaskDebugBusy")}</span>
                        </div>
                        <div className="parallel-task-debug-panel-body">
                          <span>{t("settings.parallelTaskDebugTickTotal")}: {metrics.tickTotal}</span>
                          <span>{t("settings.parallelTaskDebugIdleTickTotal")}: {metrics.idleTickTotal}</span>
                          <span>{t("settings.parallelTaskDebugTaskCountTotal")}: {metrics.taskCountTotal}</span>
                          <span>{t("settings.parallelTaskDebugSchedulerErrorTotal")}: {metrics.errorTotal}</span>
                          <span>{t("settings.parallelTaskDebugLastDuration")}: {formatMs(metrics.lastDurationMs)}</span>
                          <span>{t("settings.parallelTaskDebugNextDelay")}: {formatMs(metrics.nextDelayMs)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="parallel-task-debug-empty">{t("settings.parallelTaskDebugEmpty")}</div>
                )}
              </section>

              <section className="parallel-task-debug-section">
                <div className="parallel-task-debug-section-header">
                  <h3>{t("settings.parallelTaskDebugEventLoopTitle")}</h3>
                  <span>{snapshot.eventLoop.enabled ? t("settings.parallelTaskDebugCollectorEnabled") : t("settings.parallelTaskDebugCollectorDisabled")}</span>
                </div>
                <div className="parallel-task-debug-counter-grid">
                  <div className="parallel-task-debug-counter-card">
                    <span>{t("settings.parallelTaskDebugEventLoopResolution")}</span>
                    <strong>{formatMs(snapshot.eventLoop.resolutionMs)}</strong>
                  </div>
                  <div className="parallel-task-debug-counter-card">
                    <span>{t("settings.parallelTaskDebugEventLoopMean")}</span>
                    <strong>{formatMs(snapshot.eventLoop.meanMs)}</strong>
                  </div>
                  <div className="parallel-task-debug-counter-card">
                    <span>{t("settings.parallelTaskDebugEventLoopP95")}</span>
                    <strong>{formatMs(snapshot.eventLoop.p95Ms)}</strong>
                  </div>
                  <div className="parallel-task-debug-counter-card">
                    <span>{t("settings.parallelTaskDebugEventLoopP99")}</span>
                    <strong>{formatMs(snapshot.eventLoop.p99Ms)}</strong>
                  </div>
                  <div className="parallel-task-debug-counter-card">
                    <span>{t("settings.parallelTaskDebugEventLoopMax")}</span>
                    <strong>{formatMs(snapshot.eventLoop.maxMs)}</strong>
                  </div>
                </div>
              </section>

              <section className="parallel-task-debug-section">
                <div className="parallel-task-debug-section-header">
                  <h3>{t("settings.parallelTaskDebugRecentActivitiesTitle")}</h3>
                  <span>{snapshot.recentTaskActivities.length}</span>
                </div>
                {snapshot.recentTaskActivities.length > 0 ? (
                  <div className="parallel-task-debug-activity-list">
                    {snapshot.recentTaskActivities.map((activity) => (
                      <article className="parallel-task-debug-activity-item" key={activity.eventId}>
                        <div className="parallel-task-debug-activity-main">
                          <div className="parallel-task-debug-activity-title-row">
                            <strong>{activity.taskType}</strong>
                            <span>{getActivityEventLabel(activity.eventType)}</span>
                            <span>{getExecutionLaneLabel(activity.executionLane)}</span>
                          </div>
                          <p>{t("settings.parallelTaskDebugTaskKey")}: {activity.key}</p>
                          <p>{t("settings.parallelTaskDebugStatus")}: {activity.status ? getTaskStatusLabel(activity.status) : "-"}</p>
                        </div>
                        <div className="parallel-task-debug-activity-meta">
                          <span>{formatDateTime(activity.recordedAt)}</span>
                          <span>{t("settings.parallelTaskDebugAttempt")}: {activity.attempt ?? "-"}</span>
                          <span>{t("settings.parallelTaskDebugWaitMs")}: {formatMs(activity.waitMs)}</span>
                          <span>{t("settings.parallelTaskDebugRunMs")}: {formatMs(activity.runMs)}</span>
                          <span>{t("settings.parallelTaskDebugSource")}: {activity.source ?? "-"}</span>
                          {activity.errorMessage ? (
                            <span>{t("settings.parallelTaskDebugError")}: {activity.errorMessage}</span>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="parallel-task-debug-empty">{t("settings.parallelTaskDebugEmpty")}</div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

async function requestSnapshot(sessionId: string): Promise<RuntimeObservabilitySnapshot> {
  return await httpClient.request<RuntimeObservabilitySnapshot>(
    `/api/observability/runtime?sessionId=${encodeURIComponent(sessionId)}`
  );
}

async function closeRuntimeSession(sessionId: string): Promise<void> {
  try {
    await httpClient.request<void>(`/api/observability/runtime/session/${sessionId}`, {
      method: "DELETE"
    });
  } catch {
    // 关闭调试窗口时不需要再把释放失败抛给用户，避免二次打断。
  }
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return t("settings.parallelTaskDebugLoadFailed");
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return `${Math.round(value * 100) / 100} ms`;
}

function formatDuration(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }

  return `${Math.round(value / 1000)} s`;
}

const AFFAIRS_LIBRARY_TASK_TYPES = new Set([
  "affairs.library_apply_config",
  "affairs.library_index",
  "affairs.library_recompute_tags",
  "affairs.library_export"
]);

function isAffairsLibraryTaskType(taskType: string): boolean {
  return AFFAIRS_LIBRARY_TASK_TYPES.has(taskType);
}

function getTaskCategoryLabel(taskType: string): string {
  if (isAffairsLibraryTaskType(taskType)) {
    return t("settings.parallelTaskDebugTaskCategoryBuiltinIndexer");
  }

  return t("settings.parallelTaskDebugTaskCategoryGeneric");
}

function getTaskRuntimeLabel(lane: TaskExecutionLane, taskType: string): string {
  if (lane === "helper_process" && isAffairsLibraryTaskType(taskType)) {
    return t("settings.parallelTaskDebugTaskRuntimeBuiltinHelper");
  }

  switch (lane) {
    case "host_background":
      return t("settings.parallelTaskDebugTaskRuntimeHostBackground");
    case "helper_process":
      return t("settings.parallelTaskDebugTaskRuntimeHelperProcess");
    case "external_process":
      return t("settings.parallelTaskDebugTaskRuntimeExternalProcess");
    default:
      return t("settings.parallelTaskDebugTaskRuntimeMainThread");
  }
}

function getCounterLabel(metricName: string): string {
  switch (metricName) {
    case "enqueue":
      return t("settings.parallelTaskDebugMetricEnqueue");
    case "dedupe":
      return t("settings.parallelTaskDebugMetricDedupe");
    case "started":
      return t("settings.parallelTaskDebugMetricStarted");
    case "finished":
      return t("settings.parallelTaskDebugMetricFinished");
    case "failed":
      return t("settings.parallelTaskDebugMetricFailed");
    case "cancelled":
      return t("settings.parallelTaskDebugMetricCancelled");
    case "timeout":
      return t("settings.parallelTaskDebugMetricTimeout");
    case "cache_hit":
      return t("settings.parallelTaskDebugMetricCacheHit");
    default:
      return metricName;
  }
}

function getExecutionLaneLabel(lane: TaskExecutionLane): string {
  switch (lane) {
    case "host_background":
      return t("settings.parallelTaskDebugLaneHostBackground");
    case "helper_process":
      return t("settings.parallelTaskDebugLaneHelperProcess");
    case "external_process":
      return t("settings.parallelTaskDebugLaneExternalProcess");
    default:
      return t("settings.parallelTaskDebugLaneRequestMainThread");
  }
}

function getActivityEventLabel(eventType: TaskActivityEventType): string {
  switch (eventType) {
    case "enqueued":
      return t("settings.parallelTaskDebugEventEnqueued");
    case "deduped":
      return t("settings.parallelTaskDebugEventDeduped");
    case "started":
      return t("settings.parallelTaskDebugEventStarted");
    case "finished":
      return t("settings.parallelTaskDebugEventFinished");
    case "failed":
      return t("settings.parallelTaskDebugEventFailed");
    case "cancelled":
      return t("settings.parallelTaskDebugEventCancelled");
    case "timeout":
      return t("settings.parallelTaskDebugEventTimeout");
    case "cache_hit":
      return t("settings.parallelTaskDebugEventCacheHit");
    default:
      return eventType;
  }
}

function getTaskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case "queued":
      return t("settings.parallelTaskDebugTaskStatusQueued");
    case "running":
      return t("settings.parallelTaskDebugTaskStatusRunning");
    case "succeeded":
      return t("settings.parallelTaskDebugTaskStatusSucceeded");
    case "failed":
      return t("settings.parallelTaskDebugTaskStatusFailed");
    case "cancelled":
      return t("settings.parallelTaskDebugTaskStatusCancelled");
    case "timeout":
      return t("settings.parallelTaskDebugTaskStatusTimeout");
    default:
      return status;
  }
}
