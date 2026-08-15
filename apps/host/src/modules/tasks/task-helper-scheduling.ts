import type { TaskHelperProcessHandlerName } from "./task-helper-process-handlers.js";

const TASK_HELPER_HANDLER_CONCURRENCY: Partial<Record<TaskHelperProcessHandlerName, number>> = {
  "session.workspace_discovery": 2,
  "session.history_delta_read": 1
};

const SERIAL_AFFAIRS_HANDLERS = new Set<TaskHelperProcessHandlerName>([
  "affairs.library_apply_config",
  "affairs.library_index",
  "affairs.library_export"
]);

export interface TaskHelperSchedulingDecision {
  bucket: string;
  concurrency: number;
}

/**
 * helper 进程里的任务调度不能只看 handler。
 * 事务文档库的 apply-config / index / export 虽然是三个 handler，
 * 但只要指向同一个 rootDir，本质上就是同一份索引产物，必须串行。
 */
export function resolveTaskHelperScheduling(
  handler: TaskHelperProcessHandlerName,
  input: unknown
): TaskHelperSchedulingDecision {
  if (SERIAL_AFFAIRS_HANDLERS.has(handler)) {
    const rootDir = readRootDir(input);
    if (rootDir) {
      return {
        bucket: `affairs-root:${rootDir}`,
        concurrency: 1
      };
    }
  }

  const configuredConcurrency = TASK_HELPER_HANDLER_CONCURRENCY[handler];
  return {
    bucket: `handler:${handler}`,
    concurrency: !configuredConcurrency || configuredConcurrency <= 0
      ? Number.POSITIVE_INFINITY
      : Math.max(1, Math.floor(configuredConcurrency))
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
