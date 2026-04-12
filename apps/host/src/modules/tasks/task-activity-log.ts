import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { TaskExecutionLane, TaskStatus } from "./task-types.js";

export type TaskActivityEventType =
  | "enqueued"
  | "deduped"
  | "started"
  | "finished"
  | "failed"
  | "cancelled"
  | "timeout"
  | "cache_hit";

export interface TaskActivityRecord {
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

export interface TaskActivityEventInput {
  readonly eventType: TaskActivityEventType;
  readonly taskId?: string | null;
  readonly taskType: string;
  readonly key: string;
  readonly executionLane: TaskExecutionLane;
  readonly source?: string | null;
  readonly status?: TaskStatus | null;
  readonly attempt?: number | null;
  readonly waitMs?: number | null;
  readonly runMs?: number | null;
  readonly errorMessage?: string | null;
}

export class TaskActivityLog {
  private readonly records: TaskActivityRecord[] = [];

  constructor(
    private readonly isEnabled: () => boolean,
    private readonly limit = 200
  ) {}

  record(input: TaskActivityEventInput): void {
    if (!this.isEnabled()) {
      return;
    }

    this.records.unshift({
      eventId: createId(),
      recordedAt: nowIso(),
      eventType: input.eventType,
      taskId: input.taskId ?? null,
      taskType: input.taskType,
      key: input.key,
      executionLane: input.executionLane,
      source: input.source ?? null,
      status: input.status ?? null,
      attempt: input.attempt ?? null,
      waitMs: input.waitMs ?? null,
      runMs: input.runMs ?? null,
      errorMessage: input.errorMessage ?? null
    });

    if (this.records.length > this.limit) {
      this.records.length = this.limit;
    }
  }

  list(limit = 100): TaskActivityRecord[] {
    return this.records.slice(0, Math.max(1, limit)).map((record) => ({
      ...record
    }));
  }

  clear(): void {
    this.records.length = 0;
  }
}
