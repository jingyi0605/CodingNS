import type {
  TaskCounterMetricName,
  TaskDurationMetricName,
  TaskDurationStatsSnapshot,
  TaskExecutionLane,
  TaskMetricGroupSnapshot,
  TaskMetricsSnapshot
} from "./task-types.js";

interface TaskMetricGroupState {
  executionLane: TaskExecutionLane;
  counters: Record<TaskCounterMetricName, number>;
  waitMs: TaskDurationStatsState;
  runMs: TaskDurationStatsState;
}

interface TaskDurationStatsState {
  count: number;
  total: number;
  max: number;
  min: number | null;
}

const COUNTER_METRIC_NAMES: readonly TaskCounterMetricName[] = [
  "enqueue",
  "dedupe",
  "started",
  "finished",
  "failed",
  "cancelled",
  "timeout",
  "cache_hit"
];

export class TaskMetrics {
  private readonly totals = createCounterRecord();
  private readonly taskTypes = new Map<string, TaskMetricGroupState>();

  increment(taskType: string, executionLane: TaskExecutionLane, metric: TaskCounterMetricName): void {
    this.totals[metric] += 1;
    this.getTaskGroup(taskType, executionLane).counters[metric] += 1;
  }

  recordDuration(
    taskType: string,
    executionLane: TaskExecutionLane,
    metric: TaskDurationMetricName,
    valueMs: number
  ): void {
    const normalized = Math.max(0, valueMs);
    const stats = metric === "wait_ms"
      ? this.getTaskGroup(taskType, executionLane).waitMs
      : this.getTaskGroup(taskType, executionLane).runMs;

    stats.count += 1;
    stats.total += normalized;
    stats.max = Math.max(stats.max, normalized);
    stats.min = stats.min === null ? normalized : Math.min(stats.min, normalized);
  }

  observe(): TaskMetricsSnapshot {
    const taskTypes = Object.fromEntries(
      [...this.taskTypes.entries()].map(([taskType, group]) => [
        taskType,
        {
          executionLane: group.executionLane,
          counters: { ...group.counters },
          waitMs: snapshotDurationStats(group.waitMs),
          runMs: snapshotDurationStats(group.runMs)
        } satisfies TaskMetricGroupSnapshot
      ])
    );

    return {
      totals: { ...this.totals },
      taskTypes
    };
  }

  private getTaskGroup(taskType: string, executionLane: TaskExecutionLane): TaskMetricGroupState {
    const existing = this.taskTypes.get(taskType);

    if (existing) {
      return existing;
    }

    const created: TaskMetricGroupState = {
      executionLane,
      counters: createCounterRecord(),
      waitMs: createDurationStats(),
      runMs: createDurationStats()
    };
    this.taskTypes.set(taskType, created);
    return created;
  }
}

function createCounterRecord(): Record<TaskCounterMetricName, number> {
  return COUNTER_METRIC_NAMES.reduce<Record<TaskCounterMetricName, number>>(
    (result, metric) => {
      result[metric] = 0;
      return result;
    },
    {} as Record<TaskCounterMetricName, number>
  );
}

function createDurationStats(): TaskDurationStatsState {
  return {
    count: 0,
    total: 0,
    max: 0,
    min: null
  };
}

function snapshotDurationStats(stats: TaskDurationStatsState): TaskDurationStatsSnapshot {
  return {
    count: stats.count,
    total: stats.total,
    max: stats.max,
    min: stats.min,
    avg: stats.count > 0 ? stats.total / stats.count : 0
  };
}
