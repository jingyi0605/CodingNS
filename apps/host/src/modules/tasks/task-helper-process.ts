import readline from "node:readline";

import {
  runTaskHelperProcessHandler,
  type TaskHelperProcessHandlerName
} from "./task-helper-process-handlers.js";
import { resolveTaskHelperScheduling } from "./task-helper-scheduling.js";

interface HelperTaskRequest {
  id: string;
  type: "run";
  handler: TaskHelperProcessHandlerName;
  input: unknown;
  queueWaitTimeoutMs?: number | null;
}

interface HelperTaskCancelRequest {
  id: string;
  type: "cancel";
  targetId: string;
}

type HelperTaskResponse =
  | {
      type: "result";
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      type: "result";
      id: string;
      ok: false;
      error: string;
      errorCode?: string;
    };

type HelperTaskMessage = HelperTaskRequest | HelperTaskCancelRequest;

interface QueuedHelperTask {
  payload: HelperTaskRequest;
  controller: AbortController;
  schedulingBucket: string;
  queueWaitTimeoutMs: number | null;
  queueWaitTimer: NodeJS.Timeout | null;
}

const TASK_HELPER_RSS_HIGH_WATER_BYTES = 768 * 1024 * 1024;

const activeRequests = new Map<string, AbortController>();
const queuedRequests = new Map<string, QueuedHelperTask>();
const queuedRequestsByBucket = new Map<string, QueuedHelperTask[]>();
const runningCountByBucket = new Map<string, number>();

const reader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY
});

reader.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();

  if (!trimmed) {
    return;
  }

  let payload: HelperTaskMessage;

  try {
    payload = JSON.parse(trimmed) as HelperTaskMessage;
  } catch (error) {
    writeResponse({
      type: "result",
      id: "unknown",
      ok: false,
      error: error instanceof Error ? error.message : "helper request parse failed"
    });
    return;
  }

  if (payload.type === "cancel") {
    cancelRequest(payload.targetId);
    return;
  }

  const controller = new AbortController();
  const scheduling = resolveTaskHelperScheduling(payload.handler, payload.input);
  const task = {
    payload,
    controller,
    schedulingBucket: scheduling.bucket,
    queueWaitTimeoutMs: normalizeHelperQueueWaitTimeout(payload.queueWaitTimeoutMs),
    queueWaitTimer: null
  } satisfies QueuedHelperTask;

  if (canStartTask(task)) {
    startTask(task);
    return;
  }

  queuedRequests.set(payload.id, task);
  const queue = queuedRequestsByBucket.get(task.schedulingBucket) ?? [];
  queue.push(task);
  queuedRequestsByBucket.set(task.schedulingBucket, queue);
  armQueuedTaskTimeout(task);
}

function writeResponse(payload: HelperTaskResponse): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function canStartTask(task: QueuedHelperTask): boolean {
  const scheduling = resolveTaskHelperScheduling(task.payload.handler, task.payload.input);
  return (runningCountByBucket.get(scheduling.bucket) ?? 0) < scheduling.concurrency;
}

function startTask(task: QueuedHelperTask): void {
  const { payload, controller, schedulingBucket } = task;

  clearQueuedTaskTimeout(task);
  queuedRequests.delete(payload.id);
  activeRequests.set(payload.id, controller);
  runningCountByBucket.set(
    schedulingBucket,
    (runningCountByBucket.get(schedulingBucket) ?? 0) + 1
  );

  void runTask(task);
}

async function runTask(task: QueuedHelperTask): Promise<void> {
  const { payload, controller } = task;

  try {
    const result = await runTaskHelperProcessHandler(payload.handler, payload.input, controller.signal);
    writeResponse({
      type: "result",
      id: payload.id,
      ok: true,
      result
    });
  } catch (error) {
    writeResponse({
      type: "result",
      id: payload.id,
      ok: false,
      error: error instanceof Error ? error.message : "helper task failed"
    });
  } finally {
    activeRequests.delete(payload.id);
    runningCountByBucket.set(
      task.schedulingBucket,
      Math.max(0, (runningCountByBucket.get(task.schedulingBucket) ?? 1) - 1)
    );
    drainQueue(task.schedulingBucket);
    maybeRecycleProcess();
  }
}

function drainQueue(bucket: string): void {
  const queue = queuedRequestsByBucket.get(bucket);

  if (!queue || queue.length === 0) {
    return;
  }

  while (queue.length > 0) {
    const next = queue.shift();

    if (!next) {
      continue;
    }

    if (!queuedRequests.has(next.payload.id)) {
      continue;
    }

    if (!canStartTask(next)) {
      queue.unshift(next);
      break;
    }

    startTask(next);
  }

  if (queue.length === 0) {
    queuedRequestsByBucket.delete(bucket);
  }
}

function cancelRequest(targetId: string): void {
  const active = activeRequests.get(targetId);

  if (active) {
    active.abort(new Error("helper task aborted"));
    return;
  }

  const queued = queuedRequests.get(targetId);

  if (!queued) {
    return;
  }

  clearQueuedTaskTimeout(queued);
  queuedRequests.delete(targetId);
  const queue = queuedRequestsByBucket.get(queued.schedulingBucket);

  if (!queue) {
    return;
  }

  const nextQueue = queue.filter((entry) => entry.payload.id !== targetId);

  if (nextQueue.length === 0) {
    queuedRequestsByBucket.delete(queued.schedulingBucket);
    return;
  }

  queuedRequestsByBucket.set(queued.schedulingBucket, nextQueue);
}

function armQueuedTaskTimeout(task: QueuedHelperTask): void {
  if (!task.queueWaitTimeoutMs || task.queueWaitTimeoutMs <= 0) {
    return;
  }

  task.queueWaitTimer = setTimeout(() => {
    const queued = queuedRequests.get(task.payload.id);
    if (!queued) {
      return;
    }

    clearQueuedTaskTimeout(queued);
    queuedRequests.delete(task.payload.id);
    const queue = queuedRequestsByBucket.get(task.schedulingBucket);
    if (queue) {
      const nextQueue = queue.filter((entry) => entry.payload.id !== task.payload.id);
      if (nextQueue.length === 0) {
        queuedRequestsByBucket.delete(task.schedulingBucket);
      } else {
        queuedRequestsByBucket.set(task.schedulingBucket, nextQueue);
      }
    }

    writeResponse({
      type: "result",
      id: task.payload.id,
      ok: false,
      error: `${task.payload.handler}:${task.payload.id} helper 内部排队等待超过 ${task.queueWaitTimeoutMs}ms 仍未开始执行`,
      errorCode: "TASK_QUEUE_WAIT_TIMEOUT"
    });
  }, task.queueWaitTimeoutMs);
}

function clearQueuedTaskTimeout(task: QueuedHelperTask): void {
  if (!task.queueWaitTimer) {
    return;
  }

  clearTimeout(task.queueWaitTimer);
  task.queueWaitTimer = null;
}

function normalizeHelperQueueWaitTimeout(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.max(1, Math.floor(value));
}

function maybeRecycleProcess(): void {
  if (activeRequests.size > 0 || queuedRequests.size > 0) {
    return;
  }

  if (process.memoryUsage.rss() < TASK_HELPER_RSS_HIGH_WATER_BYTES) {
    return;
  }

  process.stderr.write(
    `[task-helper] rss 高水位回收，rss=${process.memoryUsage.rss()}\n`
  );
  setImmediate(() => {
    process.exit(0);
  });
}
