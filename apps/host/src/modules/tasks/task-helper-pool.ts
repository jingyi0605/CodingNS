import type { TaskHelperProcessHandlerName } from "./task-helper-process-handlers.js";
import {
  TaskHelperProcessClient,
  type TaskHelperProcessClientHealthSnapshot,
  type TaskHelperWorkerClientLike
} from "./task-helper-client.js";

const GLOBAL_TASK_HELPER_POOL_KEY = "__codingnsTaskHelperPool__";
const DEFAULT_WORKER_KEY = "__default__";
const ROOTDIR_HELPER_CANCEL_FALLBACK_MS = 3_000;

export interface TaskHelperPoolExecuteOptions {
  queueWaitTimeoutMs?: number;
}

export interface TaskHelperWorkerHealthSnapshot {
  workerKey: string;
  rootDir: string | null;
  state: "idle" | "running" | "terminating" | "recycled";
  pid: number | null;
  inflightLocalCount: number;
  inflightRemoteRequestCount: number;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  lastSoftCancelRequestedAt: string | null;
  lastHardKillAt: string | null;
  lastExitAt: string | null;
  lastTerminationReason: string | null;
}

interface TaskHelperWorkerEntry {
  workerKey: string;
  rootDir: string | null;
  client: TaskHelperWorkerClientLike;
  inflightLocalCount: number;
  lastStartedAtMs: number | null;
  lastCompletedAtMs: number | null;
  lastFailedAtMs: number | null;
  lastSoftCancelRequestedAtMs: number | null;
  lastHardKillAtMs: number | null;
  state: "idle" | "running" | "terminating" | "recycled";
}

type TaskHelperWorkerClientFactory = () => TaskHelperWorkerClientLike;

export class TaskHelperPool {
  private readonly workers = new Map<string, TaskHelperWorkerEntry>();

  constructor(
    private readonly clientFactory: TaskHelperWorkerClientFactory = () => new TaskHelperProcessClient()
  ) {}

  async execute<TResult>(
    handler: TaskHelperProcessHandlerName,
    input: unknown,
    signal?: AbortSignal,
    options: TaskHelperPoolExecuteOptions = {}
  ): Promise<TResult> {
    const rootDir = readRootDir(input);
    const workerKey = rootDir ? `rootDir:${rootDir}` : DEFAULT_WORKER_KEY;
    const entry = this.getOrCreateWorker(workerKey, rootDir);
    entry.inflightLocalCount += 1;
    entry.lastStartedAtMs = Date.now();
    entry.state = "running";

    let cancelFallbackTimer: NodeJS.Timeout | null = null;
    let onAbort: (() => void) | null = null;

    if (signal && rootDir) {
      onAbort = () => {
        entry.lastSoftCancelRequestedAtMs = Date.now();
        cancelFallbackTimer = setTimeout(() => {
          if (!entry.client.hasInflightRemoteWork()) {
            return;
          }

          entry.lastHardKillAtMs = Date.now();
          entry.state = "terminating";
          entry.client.terminateCurrentChild(
            `helper_soft_cancel_timeout:${handler}:${rootDir}`
          );
        }, ROOTDIR_HELPER_CANCEL_FALLBACK_MS);
      };

      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    try {
      const result = await entry.client.execute<TResult>(handler, input, signal, options);
      entry.lastCompletedAtMs = Date.now();
      entry.state = resolveWorkerState(entry.state, entry.client.hasInflightRemoteWork());
      return result;
    } catch (error) {
      entry.lastFailedAtMs = Date.now();
      entry.state = resolveWorkerState(entry.state, entry.client.hasInflightRemoteWork());
      throw error;
    } finally {
      entry.inflightLocalCount = Math.max(0, entry.inflightLocalCount - 1);
      if (entry.inflightLocalCount === 0) {
        entry.state = resolveWorkerState(entry.state, entry.client.hasInflightRemoteWork());
      }
      if (cancelFallbackTimer) {
        clearTimeout(cancelFallbackTimer);
      }
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  getWorkerHealth(rootDir: string): TaskHelperWorkerHealthSnapshot | null {
    const normalizedRootDir = rootDir.trim();
    if (!normalizedRootDir) {
      return null;
    }
    return this.describeWorker(`rootDir:${normalizedRootDir}`);
  }

  listWorkerHealth(): TaskHelperWorkerHealthSnapshot[] {
    return [...this.workers.keys()]
      .sort((left, right) => left.localeCompare(right, "zh-CN"))
      .map((workerKey) => this.describeWorker(workerKey))
      .filter((snapshot): snapshot is TaskHelperWorkerHealthSnapshot => Boolean(snapshot));
  }

  dispose(): void {
    for (const entry of this.workers.values()) {
      entry.client.dispose();
      entry.state = "recycled";
    }
    this.workers.clear();
  }

  private getOrCreateWorker(workerKey: string, rootDir: string | null): TaskHelperWorkerEntry {
    const existing = this.workers.get(workerKey);
    if (existing) {
      return existing;
    }

    const entry: TaskHelperWorkerEntry = {
      workerKey,
      rootDir,
      client: this.clientFactory(),
      inflightLocalCount: 0,
      lastStartedAtMs: null,
      lastCompletedAtMs: null,
      lastFailedAtMs: null,
      lastSoftCancelRequestedAtMs: null,
      lastHardKillAtMs: null,
      state: "idle"
    };
    this.workers.set(workerKey, entry);
    return entry;
  }

  private describeWorker(workerKey: string): TaskHelperWorkerHealthSnapshot | null {
    const entry = this.workers.get(workerKey);
    if (!entry) {
      return null;
    }

    const health = entry.client.getHealthSnapshot();
    return buildWorkerHealthSnapshot(entry, health);
  }
}

export function getSharedTaskHelperPool(): TaskHelperPool {
  const scope = globalThis as typeof globalThis & {
    [GLOBAL_TASK_HELPER_POOL_KEY]?: TaskHelperPool | null;
  };
  const globalPool = scope[GLOBAL_TASK_HELPER_POOL_KEY];

  if (globalPool) {
    return globalPool;
  }

  const pool = new TaskHelperPool();
  scope[GLOBAL_TASK_HELPER_POOL_KEY] = pool;
  return pool;
}

export function disposeSharedTaskHelperPool(): void {
  const scope = globalThis as typeof globalThis & {
    [GLOBAL_TASK_HELPER_POOL_KEY]?: TaskHelperPool | null;
  };
  const pool = scope[GLOBAL_TASK_HELPER_POOL_KEY];
  if (!pool) {
    return;
  }

  pool.dispose();
  scope[GLOBAL_TASK_HELPER_POOL_KEY] = null;
}

function buildWorkerHealthSnapshot(
  entry: TaskHelperWorkerEntry,
  health: TaskHelperProcessClientHealthSnapshot
): TaskHelperWorkerHealthSnapshot {
  return {
    workerKey: entry.workerKey,
    rootDir: entry.rootDir,
    state: entry.state,
    pid: health.pid,
    inflightLocalCount: entry.inflightLocalCount,
    inflightRemoteRequestCount: health.inflightRemoteRequestCount,
    startedAt: health.startedAt,
    lastHeartbeatAt: health.lastHeartbeatAt,
    lastStartedAt: toIso(entry.lastStartedAtMs),
    lastCompletedAt: toIso(entry.lastCompletedAtMs),
    lastFailedAt: toIso(entry.lastFailedAtMs),
    lastSoftCancelRequestedAt: toIso(entry.lastSoftCancelRequestedAtMs),
    lastHardKillAt: toIso(entry.lastHardKillAtMs),
    lastExitAt: health.lastExitAt,
    lastTerminationReason: health.lastTerminationReason
  };
}

function readRootDir(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const candidate = "rootDir" in input ? input.rootDir : null;
  if (typeof candidate !== "string") {
    return null;
  }

  const normalized = candidate.trim();
  return normalized || null;
}

function toIso(timestampMs: number | null): string | null {
  if (!timestampMs || !Number.isFinite(timestampMs)) {
    return null;
  }

  return new Date(timestampMs).toISOString();
}

function resolveWorkerState(
  currentState: TaskHelperWorkerEntry["state"],
  hasInflightRemoteWork: boolean
): TaskHelperWorkerEntry["state"] {
  if (!hasInflightRemoteWork) {
    return "idle";
  }

  return currentState === "terminating" ? "terminating" : "running";
}
