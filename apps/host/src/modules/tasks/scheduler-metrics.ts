export interface SchedulerDurationStatsSnapshot {
  readonly count: number;
  readonly total: number;
  readonly max: number;
  readonly min: number | null;
  readonly avg: number;
}

export interface SchedulerMetricSnapshot {
  readonly tickTotal: number;
  readonly idleTickTotal: number;
  readonly errorTotal: number;
  readonly taskCountTotal: number;
  readonly durationMs: SchedulerDurationStatsSnapshot;
  readonly lastTickAt: string | null;
  readonly lastDurationMs: number | null;
  readonly lastTaskCount: number;
  readonly lastIdle: boolean;
  readonly lastErrorCount: number;
  readonly nextDelayMs: number | null;
  readonly idleStreak: number;
}

export interface SchedulerMetricsSnapshot {
  readonly schedulers: Readonly<Record<string, SchedulerMetricSnapshot>>;
}

export interface SchedulerTickObservation {
  readonly schedulerName: string;
  readonly referenceAt: string;
  readonly durationMs: number;
  readonly taskCount: number;
  readonly idle: boolean;
  readonly errorCount?: number;
  readonly nextDelayMs?: number | null;
  readonly idleStreak?: number;
}

interface SchedulerDurationStatsState {
  count: number;
  total: number;
  max: number;
  min: number | null;
}

interface SchedulerMetricState {
  tickTotal: number;
  idleTickTotal: number;
  errorTotal: number;
  taskCountTotal: number;
  durationMs: SchedulerDurationStatsState;
  lastTickAt: string | null;
  lastDurationMs: number | null;
  lastTaskCount: number;
  lastIdle: boolean;
  lastErrorCount: number;
  nextDelayMs: number | null;
  idleStreak: number;
}

export class SchedulerMetrics {
  private readonly schedulers = new Map<string, SchedulerMetricState>();

  recordTick(observation: SchedulerTickObservation): void {
    const state = this.getState(observation.schedulerName);
    const durationMs = Math.max(0, observation.durationMs);
    const errorCount = Math.max(0, observation.errorCount ?? 0);

    state.tickTotal += 1;
    state.taskCountTotal += Math.max(0, observation.taskCount);
    state.errorTotal += errorCount;
    state.lastTickAt = observation.referenceAt;
    state.lastDurationMs = durationMs;
    state.lastTaskCount = Math.max(0, observation.taskCount);
    state.lastIdle = observation.idle;
    state.lastErrorCount = errorCount;
    state.nextDelayMs = observation.nextDelayMs ?? null;
    state.idleStreak = Math.max(0, observation.idleStreak ?? 0);

    if (observation.idle) {
      state.idleTickTotal += 1;
    }

    state.durationMs.count += 1;
    state.durationMs.total += durationMs;
    state.durationMs.max = Math.max(state.durationMs.max, durationMs);
    state.durationMs.min =
      state.durationMs.min === null ? durationMs : Math.min(state.durationMs.min, durationMs);
  }

  observe(): SchedulerMetricsSnapshot {
    return {
      schedulers: Object.fromEntries(
        [...this.schedulers.entries()].map(([name, state]) => [
          name,
          {
            tickTotal: state.tickTotal,
            idleTickTotal: state.idleTickTotal,
            errorTotal: state.errorTotal,
            taskCountTotal: state.taskCountTotal,
            durationMs: snapshotDuration(state.durationMs),
            lastTickAt: state.lastTickAt,
            lastDurationMs: state.lastDurationMs,
            lastTaskCount: state.lastTaskCount,
            lastIdle: state.lastIdle,
            lastErrorCount: state.lastErrorCount,
            nextDelayMs: state.nextDelayMs,
            idleStreak: state.idleStreak
          } satisfies SchedulerMetricSnapshot
        ])
      )
    };
  }

  private getState(name: string): SchedulerMetricState {
    const existing = this.schedulers.get(name);

    if (existing) {
      return existing;
    }

    const created: SchedulerMetricState = {
      tickTotal: 0,
      idleTickTotal: 0,
      errorTotal: 0,
      taskCountTotal: 0,
      durationMs: {
        count: 0,
        total: 0,
        max: 0,
        min: null
      },
      lastTickAt: null,
      lastDurationMs: null,
      lastTaskCount: 0,
      lastIdle: false,
      lastErrorCount: 0,
      nextDelayMs: null,
      idleStreak: 0
    };
    this.schedulers.set(name, created);
    return created;
  }
}

export function resolveAdaptiveSchedulerDelayMs(
  baseIntervalMs: number,
  maxIntervalMs: number,
  idleStreak: number
): number {
  const normalizedBase = Math.max(1, Math.floor(baseIntervalMs));
  const normalizedMax = Math.max(normalizedBase, Math.floor(maxIntervalMs));

  if (idleStreak <= 0) {
    return normalizedBase;
  }

  return Math.min(normalizedMax, normalizedBase * (2 ** Math.max(0, idleStreak - 1)));
}

function snapshotDuration(state: SchedulerDurationStatsState): SchedulerDurationStatsSnapshot {
  return {
    count: state.count,
    total: state.total,
    max: state.max,
    min: state.min,
    avg: state.count > 0 ? state.total / state.count : 0
  };
}
