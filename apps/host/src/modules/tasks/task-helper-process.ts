import readline from "node:readline";

import {
  runTaskHelperProcessHandler,
  type TaskHelperProcessHandlerName
} from "./task-helper-process-handlers.js";

interface HelperTaskRequest {
  id: string;
  type: "run";
  handler: TaskHelperProcessHandlerName;
  input: unknown;
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
    };

type HelperTaskMessage = HelperTaskRequest | HelperTaskCancelRequest;

interface QueuedHelperTask {
  payload: HelperTaskRequest;
  controller: AbortController;
}

const TASK_HELPER_HANDLER_CONCURRENCY: Partial<Record<TaskHelperProcessHandlerName, number>> = {
  "session.workspace_discovery": 2
};
const TASK_HELPER_RSS_HIGH_WATER_BYTES = 768 * 1024 * 1024;

const activeRequests = new Map<string, AbortController>();
const queuedRequests = new Map<string, QueuedHelperTask>();
const queuedRequestsByHandler = new Map<TaskHelperProcessHandlerName, QueuedHelperTask[]>();
const runningCountByHandler = new Map<TaskHelperProcessHandlerName, number>();

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
  const task = {
    payload,
    controller
  } satisfies QueuedHelperTask;

  if (canStartTask(payload.handler)) {
    startTask(task);
    return;
  }

  queuedRequests.set(payload.id, task);
  const queue = queuedRequestsByHandler.get(payload.handler) ?? [];
  queue.push(task);
  queuedRequestsByHandler.set(payload.handler, queue);
}

function writeResponse(payload: HelperTaskResponse): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function canStartTask(handler: TaskHelperProcessHandlerName): boolean {
  const limit = TASK_HELPER_HANDLER_CONCURRENCY[handler];

  if (!limit || limit <= 0) {
    return true;
  }

  return (runningCountByHandler.get(handler) ?? 0) < limit;
}

function startTask(task: QueuedHelperTask): void {
  const { payload, controller } = task;

  queuedRequests.delete(payload.id);
  activeRequests.set(payload.id, controller);
  runningCountByHandler.set(
    payload.handler,
    (runningCountByHandler.get(payload.handler) ?? 0) + 1
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
    runningCountByHandler.set(
      payload.handler,
      Math.max(0, (runningCountByHandler.get(payload.handler) ?? 1) - 1)
    );
    drainQueue(payload.handler);
    maybeRecycleProcess();
  }
}

function drainQueue(handler: TaskHelperProcessHandlerName): void {
  const queue = queuedRequestsByHandler.get(handler);

  if (!queue || queue.length === 0) {
    return;
  }

  while (queue.length > 0 && canStartTask(handler)) {
    const next = queue.shift();

    if (!next) {
      continue;
    }

    if (!queuedRequests.has(next.payload.id)) {
      continue;
    }

    startTask(next);
  }

  if (queue.length === 0) {
    queuedRequestsByHandler.delete(handler);
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

  queuedRequests.delete(targetId);
  const queue = queuedRequestsByHandler.get(queued.payload.handler);

  if (!queue) {
    return;
  }

  const nextQueue = queue.filter((entry) => entry.payload.id !== targetId);

  if (nextQueue.length === 0) {
    queuedRequestsByHandler.delete(queued.payload.handler);
    return;
  }

  queuedRequestsByHandler.set(queued.payload.handler, nextQueue);
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
