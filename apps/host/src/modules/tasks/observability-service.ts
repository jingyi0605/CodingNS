import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { TaskMetricsSnapshot } from "./task-types.js";
import type { SchedulerMetricsSnapshot } from "./scheduler-metrics.js";
import type { EventLoopDelaySnapshot, EventLoopMonitor } from "./event-loop-monitor.js";
import type { TaskActivityLog, TaskActivityRecord } from "./task-activity-log.js";

const DEFAULT_SESSION_TTL_MS = 20_000;
const MIN_SESSION_TTL_MS = 5_000;
const MAX_SESSION_TTL_MS = 120_000;

export interface RuntimeObservabilitySessionLease {
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly ttlMs: number;
}

export interface RuntimeObservabilitySnapshot {
  readonly observedAt: string;
  readonly session: RuntimeObservabilitySessionLease;
  readonly backgroundTasks: TaskMetricsSnapshot;
  readonly recentTaskActivities: TaskActivityRecord[];
  readonly schedulers: SchedulerMetricsSnapshot;
  readonly eventLoop: EventLoopDelaySnapshot;
}

interface ObservabilitySessionState {
  expiresAtMs: number;
  ttlMs: number;
}

export class RuntimeObservabilityService {
  private readonly sessions = new Map<string, ObservabilitySessionState>();

  constructor(
    private readonly getTaskMetrics: () => TaskMetricsSnapshot,
    private readonly getSchedulerMetrics: () => SchedulerMetricsSnapshot,
    private readonly eventLoopMonitor: EventLoopMonitor,
    private readonly taskActivityLog: TaskActivityLog
  ) {}

  hasActiveSession(): boolean {
    this.pruneExpiredSessions();
    return this.sessions.size > 0;
  }

  openSession(ttlMs?: number): RuntimeObservabilitySessionLease {
    this.pruneExpiredSessions();
    const normalizedTtlMs = normalizeSessionTtlMs(ttlMs);
    const sessionId = createId();
    const expiresAtMs = Date.now() + normalizedTtlMs;

    this.sessions.set(sessionId, {
      expiresAtMs,
      ttlMs: normalizedTtlMs
    });
    this.syncCollectors();

    return buildLease(sessionId, expiresAtMs, normalizedTtlMs);
  }

  touchSession(sessionId: string, ttlMs?: number): RuntimeObservabilitySessionLease {
    this.pruneExpiredSessions();
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new AppError({
        statusCode: 404,
        errorCode: "OBSERVABILITY_SESSION_NOT_FOUND",
        detail: "观测会话不存在或已过期"
      });
    }

    const normalizedTtlMs = normalizeSessionTtlMs(ttlMs ?? session.ttlMs);
    session.ttlMs = normalizedTtlMs;
    session.expiresAtMs = Date.now() + normalizedTtlMs;
    this.sessions.set(sessionId, session);
    this.syncCollectors();

    return buildLease(sessionId, session.expiresAtMs, normalizedTtlMs);
  }

  closeSession(sessionId: string): void {
    this.pruneExpiredSessions();
    this.sessions.delete(sessionId);
    this.syncCollectors();
  }

  observe(sessionId: string, activityLimit = 100): RuntimeObservabilitySnapshot {
    const session = this.touchSession(sessionId);

    return {
      observedAt: nowIso(),
      session,
      backgroundTasks: this.getTaskMetrics(),
      recentTaskActivities: this.taskActivityLog.list(activityLimit),
      schedulers: this.getSchedulerMetrics(),
      eventLoop: this.eventLoopMonitor.observe()
    };
  }

  private pruneExpiredSessions(): void {
    const now = Date.now();
    let changed = false;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAtMs > now) {
        continue;
      }

      this.sessions.delete(sessionId);
      changed = true;
    }

    if (changed) {
      this.syncCollectors();
    }
  }

  private syncCollectors(): void {
    if (this.sessions.size > 0) {
      this.eventLoopMonitor.start();
      return;
    }

    this.taskActivityLog.clear();
    this.eventLoopMonitor.stop();
  }
}

function normalizeSessionTtlMs(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_SESSION_TTL_MS;
  }

  return Math.min(MAX_SESSION_TTL_MS, Math.max(MIN_SESSION_TTL_MS, Math.floor(value)));
}

function buildLease(
  sessionId: string,
  expiresAtMs: number,
  ttlMs: number
): RuntimeObservabilitySessionLease {
  return {
    sessionId,
    expiresAt: new Date(expiresAtMs).toISOString(),
    ttlMs
  };
}
