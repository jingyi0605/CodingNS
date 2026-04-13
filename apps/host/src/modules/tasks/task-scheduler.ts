import { createId } from "../../shared/utils/id.js";
import { TaskMetrics } from "./task-metrics.js";
import { TaskRegistry } from "./task-registry.js";
import {
  TaskCancelledError,
  type TaskActivitySink,
  type TaskDefinition,
  type TaskExecutionLane,
  type TaskEnqueueOptions,
  type TaskLaneExecutor,
  type TaskHandle,
  type TaskSnapshot,
  type TaskRunContext,
  TaskTimeoutError
} from "./task-types.js";

interface TaskDeferred<TResult> {
  promise: Promise<TResult>;
  resolve: (value: TResult | PromiseLike<TResult>) => void;
  reject: (reason?: unknown) => void;
}

interface TaskRecord<TInput = unknown, TResult = unknown> {
  definition: TaskDefinition<TInput, TResult>;
  dedupeKey: string;
  taskId: string;
  taskType: string;
  key: string;
  input: TInput;
  source: string | null;
  controller: AbortController;
  deferred: TaskDeferred<TResult>;
  snapshot: TaskSnapshot<TResult>;
  settled: boolean;
}

export class TaskScheduler {
  private readonly activeTasks = new Map<string, TaskRecord<any, any>>();
  private readonly latestSnapshots = new Map<string, TaskSnapshot>();
  private readonly queuedTasks = new Map<string, TaskRecord<any, any>[]>();
  private readonly runningCountByType = new Map<string, number>();

  constructor(
    private readonly registry: TaskRegistry,
    private readonly metrics: TaskMetrics,
    private readonly activitySink: TaskActivitySink | null = null,
    private readonly laneExecutors: Partial<Record<TaskExecutionLane, TaskLaneExecutor>> = {}
  ) {}

  enqueue<TInput, TResult>(taskType: string, options: TaskEnqueueOptions<TInput>): TaskHandle<TResult> {
    const definition = this.registry.get<TInput, TResult>(taskType);
    const dedupeKey = buildDedupeKey(taskType, options.key);

    this.metrics.increment(taskType, definition.executionLane, "enqueue");
    this.activitySink?.record({
      eventType: "enqueued",
      taskType,
      key: options.key,
      executionLane: definition.executionLane,
      source: options.source ?? null,
      status: "queued"
    });

    const existing = this.activeTasks.get(dedupeKey);

    if (existing) {
      this.metrics.increment(taskType, definition.executionLane, "dedupe");
      this.activitySink?.record({
        eventType: "deduped",
        taskId: existing.taskId,
        taskType,
        key: options.key,
        executionLane: definition.executionLane,
        source: options.source ?? null,
        status: existing.snapshot.status,
        attempt: existing.snapshot.attempt
      });
      return this.createHandle(existing as TaskRecord<any, TResult>, true);
    }

    const record = this.createRecord(definition, options, dedupeKey);
    this.activeTasks.set(dedupeKey, record);
    this.startOrQueue(record as TaskRecord<any, any>);
    return this.createHandle(record as TaskRecord<any, TResult>, false);
  }

  cancel(taskType: string, key: string, reason?: string): void {
    const record = this.activeTasks.get(buildDedupeKey(taskType, key));

    if (!record) {
      return;
    }

    this.cancelRecord(record, reason);
  }

  recordCacheHit(taskType: string, key: string): void {
    const definition = this.registry.get(taskType);
    this.metrics.increment(taskType, definition.executionLane, "cache_hit");
    this.activitySink?.record({
      eventType: "cache_hit",
      taskType,
      key,
      executionLane: definition.executionLane,
      status: this.peek(taskType, key)?.status ?? null
    });

    const current = this.peek(taskType, key);

    if (!current) {
      return;
    }

    this.latestSnapshots.set(buildDedupeKey(taskType, key), current);
  }

  peek<TResult = unknown>(taskType: string, key: string): TaskSnapshot<TResult> | null {
    const dedupeKey = buildDedupeKey(taskType, key);
    const active = this.activeTasks.get(dedupeKey);
    const snapshot = active?.snapshot ?? this.latestSnapshots.get(dedupeKey);

    if (!snapshot) {
      return null;
    }

    return cloneSnapshot(snapshot) as TaskSnapshot<TResult>;
  }

  private createHandle<TResult>(
    record: TaskRecord<any, TResult>,
    deduped: boolean
  ): TaskHandle<TResult> {
    return {
      taskId: record.taskId,
      taskType: record.taskType,
      key: record.key,
      executionLane: record.definition.executionLane,
      deduped,
      promise: record.deferred.promise,
      cancel: (reason?: string) => {
        this.cancel(record.taskType, record.key, reason);
      }
    };
  }

  private createRecord<TInput, TResult>(
    definition: TaskDefinition<TInput, TResult>,
    options: TaskEnqueueOptions<TInput>,
    dedupeKey: string
  ): TaskRecord<TInput, TResult> {
    const deferred = createDeferred<TResult>();
    const enqueuedAt = Date.now();

    return {
      definition,
      dedupeKey,
      taskId: createId(),
      taskType: definition.taskType,
      key: options.key,
      input: options.input,
      source: options.source ?? null,
      controller: new AbortController(),
      deferred,
      snapshot: {
        taskId: "",
        taskType: definition.taskType,
        key: options.key,
        executionLane: definition.executionLane,
        status: "queued",
        source: options.source ?? null,
        attempt: 0,
        enqueuedAt,
        startedAt: null,
        finishedAt: null,
        timeoutMs: definition.timeoutMs ?? null
      },
      settled: false
    };
  }

  private startOrQueue(record: TaskRecord): void {
    const concurrency = normalizeConcurrency(record.definition.concurrency);
    const runningCount = this.runningCountByType.get(record.taskType) ?? 0;

    record.snapshot = {
      ...record.snapshot,
      taskId: record.taskId
    };

    if (runningCount >= concurrency) {
      const queue = this.queuedTasks.get(record.taskType) ?? [];
      queue.push(record);
      this.queuedTasks.set(record.taskType, queue);
      this.latestSnapshots.set(record.dedupeKey, cloneSnapshot(record.snapshot));
      return;
    }

    void this.executeRecord(record);
  }

  private async executeRecord(record: TaskRecord): Promise<void> {
    const definition = record.definition;
    const maxAttempts = Math.max(1, definition.retryPolicy?.maxAttempts ?? 1);

    this.runningCountByType.set(record.taskType, (this.runningCountByType.get(record.taskType) ?? 0) + 1);
    const startedAt = Date.now();

    record.snapshot = {
      ...record.snapshot,
      status: "running",
      startedAt
    };
    this.metrics.increment(record.taskType, definition.executionLane, "started");
    const waitMs = startedAt - record.snapshot.enqueuedAt;
    this.metrics.recordDuration(
      record.taskType,
      definition.executionLane,
      "wait_ms",
      waitMs
    );
    this.activitySink?.record({
      eventType: "started",
      taskId: record.taskId,
      taskType: record.taskType,
      key: record.key,
      executionLane: definition.executionLane,
      source: record.source,
      status: "running",
      attempt: 1,
      waitMs
    });

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (record.settled) {
          return;
        }

        record.snapshot = {
          ...record.snapshot,
          attempt
        };

        const startedAt = Date.now();

        try {
          const result = await this.runTask(record, attempt);
          this.metrics.recordDuration(
            record.taskType,
            definition.executionLane,
            "run_ms",
            Date.now() - startedAt
          );
          this.finishSuccess(record, result);
          return;
        } catch (error) {
          this.metrics.recordDuration(
            record.taskType,
            definition.executionLane,
            "run_ms",
            Date.now() - startedAt
          );

          if (record.settled) {
            return;
          }

          if (error instanceof TaskTimeoutError) {
            this.finishTimeout(record, error);
            return;
          }

          if (record.controller.signal.aborted) {
            this.finishCancelled(record, error);
            return;
          }

          if (attempt < maxAttempts) {
            await this.waitForRetryDelay(record, attempt);

            if (!record.settled) {
              this.metrics.increment(record.taskType, definition.executionLane, "started");
              this.activitySink?.record({
                eventType: "started",
                taskId: record.taskId,
                taskType: record.taskType,
                key: record.key,
                executionLane: definition.executionLane,
                source: record.source,
                status: "running",
                attempt: attempt + 1,
                waitMs: 0
              });
            }

            continue;
          }

          this.finishFailure(record, error);
          return;
        }
      }
    } finally {
      this.runningCountByType.set(
        record.taskType,
        Math.max(0, (this.runningCountByType.get(record.taskType) ?? 1) - 1)
      );
      this.startNext(record.taskType);
    }
  }

  private async runTask<TInput, TResult>(
    record: TaskRecord<TInput, TResult>,
    attempt: number
  ): Promise<TResult> {
    const timeoutMs = record.definition.timeoutMs ?? 0;
    const runContext: TaskRunContext = {
      taskType: record.taskType,
      key: record.key,
      taskId: record.taskId,
      executionLane: record.definition.executionLane,
      attempt,
      signal: record.controller.signal
    };
    const executor = this.laneExecutors[record.definition.executionLane];

    const runPromise = executor
      ? executor.execute(record.definition, record.input, runContext)
      : record.definition.run(record.input, runContext);

    if (timeoutMs <= 0) {
      return runPromise;
    }

    return await new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new TaskTimeoutError(
          `${record.taskType}:${record.key} 超过 ${timeoutMs}ms 未完成`
        );
        record.controller.abort(error);
        reject(error);
      }, timeoutMs);

      runPromise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private async waitForRetryDelay(record: TaskRecord, attempt: number): Promise<void> {
    const backoffMs = resolveBackoffMs(record.definition, attempt);

    if (backoffMs <= 0) {
      return;
    }

    let onAbort: (() => void) | null = null;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, backoffMs);
      onAbort = () => {
        clearTimeout(timer);
        reject(record.controller.signal.reason ?? new TaskCancelledError());
      };

      record.controller.signal.addEventListener("abort", onAbort, { once: true });
    }).finally(() => {
      if (onAbort) {
        record.controller.signal.removeEventListener("abort", onAbort);
      }
    });
  }

  private finishSuccess<TResult>(record: TaskRecord<unknown, TResult>, result: TResult): void {
    this.metrics.increment(record.taskType, record.definition.executionLane, "finished");
    const finishedAt = Date.now();
    const runMs = record.snapshot.startedAt === null ? null : finishedAt - record.snapshot.startedAt;
    record.snapshot = {
      ...record.snapshot,
      status: "succeeded",
      finishedAt,
      result,
      errorMessage: undefined
    };
    this.activitySink?.record({
      eventType: "finished",
      taskId: record.taskId,
      taskType: record.taskType,
      key: record.key,
      executionLane: record.definition.executionLane,
      source: record.source,
      status: "succeeded",
      attempt: record.snapshot.attempt,
      waitMs: record.snapshot.startedAt === null ? null : record.snapshot.startedAt - record.snapshot.enqueuedAt,
      runMs
    });
    this.settle(record, "resolve", result);
  }

  private finishFailure(record: TaskRecord, error: unknown): void {
    this.metrics.increment(record.taskType, record.definition.executionLane, "failed");
    const finishedAt = Date.now();
    const runMs = record.snapshot.startedAt === null ? null : finishedAt - record.snapshot.startedAt;
    record.snapshot = {
      ...record.snapshot,
      status: "failed",
      finishedAt,
      errorMessage: getErrorMessage(error)
    };
    this.activitySink?.record({
      eventType: "failed",
      taskId: record.taskId,
      taskType: record.taskType,
      key: record.key,
      executionLane: record.definition.executionLane,
      source: record.source,
      status: "failed",
      attempt: record.snapshot.attempt,
      waitMs: record.snapshot.startedAt === null ? null : record.snapshot.startedAt - record.snapshot.enqueuedAt,
      runMs,
      errorMessage: getErrorMessage(error)
    });
    this.settle(record, "reject", normalizeError(error));
  }

  private finishCancelled(record: TaskRecord, error: unknown): void {
    if (record.settled) {
      return;
    }

    this.metrics.increment(record.taskType, record.definition.executionLane, "cancelled");
    const finishedAt = Date.now();
    const runMs = record.snapshot.startedAt === null ? null : finishedAt - record.snapshot.startedAt;
    record.snapshot = {
      ...record.snapshot,
      status: "cancelled",
      finishedAt,
      errorMessage: getErrorMessage(error)
    };
    this.activitySink?.record({
      eventType: "cancelled",
      taskId: record.taskId,
      taskType: record.taskType,
      key: record.key,
      executionLane: record.definition.executionLane,
      source: record.source,
      status: "cancelled",
      attempt: record.snapshot.attempt,
      waitMs: record.snapshot.startedAt === null ? null : record.snapshot.startedAt - record.snapshot.enqueuedAt,
      runMs,
      errorMessage: getErrorMessage(error)
    });
    this.settle(record, "reject", normalizeCancelledError(error));
  }

  private finishTimeout(record: TaskRecord, error: TaskTimeoutError): void {
    this.metrics.increment(record.taskType, record.definition.executionLane, "timeout");
    const finishedAt = Date.now();
    const runMs = record.snapshot.startedAt === null ? null : finishedAt - record.snapshot.startedAt;
    record.snapshot = {
      ...record.snapshot,
      status: "timeout",
      finishedAt,
      errorMessage: error.message
    };
    this.activitySink?.record({
      eventType: "timeout",
      taskId: record.taskId,
      taskType: record.taskType,
      key: record.key,
      executionLane: record.definition.executionLane,
      source: record.source,
      status: "timeout",
      attempt: record.snapshot.attempt,
      waitMs: record.snapshot.startedAt === null ? null : record.snapshot.startedAt - record.snapshot.enqueuedAt,
      runMs,
      errorMessage: error.message
    });
    this.settle(record, "reject", error);
  }

  private settle<TResult>(
    record: TaskRecord<unknown, TResult>,
    mode: "resolve" | "reject",
    value: TResult | unknown
  ): void {
    if (record.settled) {
      return;
    }

    record.settled = true;
    this.activeTasks.delete(record.dedupeKey);
    this.latestSnapshots.set(record.dedupeKey, cloneSnapshot(record.snapshot));

    if (mode === "resolve") {
      record.deferred.resolve(value as TResult);
      return;
    }

    record.deferred.reject(value);
  }

  private cancelRecord(record: TaskRecord, reason?: string): void {
    if (record.settled) {
      return;
    }

    removeQueuedRecord(this.queuedTasks.get(record.taskType), record);
    record.controller.abort(
      new TaskCancelledError(reason ? `任务已取消: ${reason}` : "任务已取消")
    );
    this.finishCancelled(record, record.controller.signal.reason);
  }

  private startNext(taskType: string): void {
    const queue = this.queuedTasks.get(taskType);

    if (!queue || queue.length === 0) {
      return;
    }

    const concurrency = normalizeConcurrency(this.registry.get(taskType).concurrency);

    while ((this.runningCountByType.get(taskType) ?? 0) < concurrency && queue.length > 0) {
      const next = queue.shift();

      if (!next || next.settled) {
        continue;
      }

      void this.executeRecord(next);
    }

    if (queue.length === 0) {
      this.queuedTasks.delete(taskType);
    }
  }
}

function createDeferred<TResult>(): TaskDeferred<TResult> {
  let resolve!: (value: TResult | PromiseLike<TResult>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TResult>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function buildDedupeKey(taskType: string, key: string): string {
  return `${taskType}:${key}`;
}

function cloneSnapshot(snapshot: TaskSnapshot): TaskSnapshot {
  return {
    ...snapshot
  };
}

function normalizeConcurrency(value: number | undefined): number {
  if (!value || value <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(1, Math.floor(value));
}

function resolveBackoffMs(definition: TaskDefinition, attempt: number): number {
  const retryPolicy = definition.retryPolicy;

  if (!retryPolicy?.backoffMs) {
    return 0;
  }

  return typeof retryPolicy.backoffMs === "function"
    ? Math.max(0, retryPolicy.backoffMs(attempt))
    : Math.max(0, retryPolicy.backoffMs);
}

function normalizeCancelledError(error: unknown): TaskCancelledError {
  if (error instanceof TaskCancelledError) {
    return error;
  }

  return new TaskCancelledError(getErrorMessage(error));
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(getErrorMessage(error));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "unknown";
}

function removeQueuedRecord(queue: TaskRecord[] | undefined, record: TaskRecord): void {
  if (!queue) {
    return;
  }

  const index = queue.findIndex((item) => item.taskId === record.taskId);

  if (index >= 0) {
    queue.splice(index, 1);
  }
}
