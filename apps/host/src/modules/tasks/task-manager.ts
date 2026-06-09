import { TaskMetrics } from "./task-metrics.js";
import { TaskRegistry } from "./task-registry.js";
import { TaskScheduler } from "./task-scheduler.js";
import type {
  TaskActivitySink,
  TaskCancelFilter,
  TaskDefinition,
  TaskExecutionLane,
  TaskEnqueueOptions,
  TaskHandle,
  TaskLaneExecutor,
  TaskMetricsSnapshot,
  TaskSnapshot
} from "./task-types.js";

export class TaskManager {
  private readonly registry = new TaskRegistry();
  private readonly metrics = new TaskMetrics();
  private readonly scheduler: TaskScheduler;

  constructor(
    activitySink: TaskActivitySink | null = null,
    laneExecutors: Partial<Record<TaskExecutionLane, TaskLaneExecutor>> = {}
  ) {
    this.scheduler = new TaskScheduler(this.registry, this.metrics, activitySink, laneExecutors);
  }

  register<TInput, TResult>(definition: TaskDefinition<TInput, TResult>): void {
    this.registry.register(definition);
  }

  has(taskType: string): boolean {
    return this.registry.has(taskType);
  }

  enqueue<TInput, TResult>(taskType: string, options: TaskEnqueueOptions<TInput>): TaskHandle<TResult> {
    return this.scheduler.enqueue<TInput, TResult>(taskType, options);
  }

  cancel(taskType: string, key: string, reason?: string): void {
    this.scheduler.cancel(taskType, key, reason);
  }

  cancelMatching(filter: TaskCancelFilter, reason?: string): TaskSnapshot[] {
    return this.scheduler.cancelMatching(filter, reason);
  }

  recordCacheHit(taskType: string, key: string): void {
    this.scheduler.recordCacheHit(taskType, key);
  }

  peek<TResult = unknown>(taskType: string, key: string): TaskSnapshot<TResult> | null {
    return this.scheduler.peek<TResult>(taskType, key);
  }

  observe(): TaskMetricsSnapshot {
    return this.metrics.observe();
  }

  listDefinitions(): TaskDefinition<unknown, unknown>[] {
    return this.registry.list();
  }
}

export function createTaskManager(
  activitySink: TaskActivitySink | null = null,
  laneExecutors: Partial<Record<TaskExecutionLane, TaskLaneExecutor>> = {}
): TaskManager {
  return new TaskManager(activitySink, laneExecutors);
}
