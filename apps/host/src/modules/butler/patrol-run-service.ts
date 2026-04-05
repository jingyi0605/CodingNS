import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ButlerProjectRepository } from "../../storage/repositories/butler-project-repository.js";
import type {
  PatrolRunRecord,
  PatrolRunRepository
} from "../../storage/repositories/patrol-run-repository.js";
import type { PatrolPlanRepository } from "../../storage/repositories/patrol-plan-repository.js";

const DEFAULT_STALE_TIMEOUT_MS = 20 * 60_000;

export interface PatrolRunView {
  id: string;
  projectId: string;
  planId: string | null;
  triggeredBy: string;
  triggerRef: string | null;
  butlerSessionId: string | null;
  status: string;
  summary: string | null;
  riskLevel: string | null;
  suggestions: string[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface StartPatrolRunInput {
  planId?: string | null;
  triggeredBy?: string;
  triggerRef?: string | null;
  butlerSessionId?: string | null;
  suggestions?: string[];
}

export interface MarkPatrolRunRunningInput {
  butlerSessionId?: string | null;
  startedAt?: string | null;
}

export interface CompletePatrolRunInput {
  status: "succeeded" | "failed" | "cancelled";
  summary: string | null;
  riskLevel: PatrolRunView["riskLevel"];
  suggestions: string[];
  finishedAt?: string | null;
}

export interface ExpireStaleRunningRunsInput {
  referenceAt?: string;
  staleTimeoutMs?: number;
  summary?: string;
}

export class PatrolRunService {
  constructor(
    private readonly butlerProjectRepository: ButlerProjectRepository,
    private readonly patrolPlanRepository: PatrolPlanRepository,
    private readonly patrolRunRepository: PatrolRunRepository
  ) {}

  listRuns(projectId: string, filters?: { status?: string }): PatrolRunView[] {
    this.ensureProject(projectId);
    const records = this.patrolRunRepository.listByProject(projectId, {
      status: filters?.status
    });

    return records.map(mapRunRecord);
  }

  startRun(projectId: string, input: StartPatrolRunInput): PatrolRunView {
    this.ensureProject(projectId);

    if (input.planId && !this.patrolPlanRepository.findById(input.planId)) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PATROL_PLAN_NOT_FOUND",
        detail: "关联巡视计划不存在"
      });
    }

    const timestamp = nowIso();
    const suggestions = (input.suggestions ?? []).filter((item) => item.trim().length > 0);

    const record: PatrolRunRecord = {
      id: createId(),
      projectId,
      planId: input.planId ?? null,
      triggeredBy: input.triggeredBy ?? "user",
      triggerRef: input.triggerRef ?? null,
      butlerSessionId: input.butlerSessionId ?? null,
      status: "queued",
      summary: null,
      riskLevel: null,
      suggestionsJson: JSON.stringify(suggestions),
      startedAt: null,
      finishedAt: null,
      createdAt: timestamp
    };

    return mapRunRecord(this.patrolRunRepository.create(record));
  }

  hasRunningRun(projectId: string): boolean {
    this.ensureProject(projectId);
    return this.patrolRunRepository.listRunningByProject(projectId).length > 0;
  }

  expireStaleRunningRuns(
    projectId: string,
    input: ExpireStaleRunningRunsInput = {}
  ): PatrolRunView[] {
    this.ensureProject(projectId);
    const referenceAt = input.referenceAt ?? nowIso();
    const staleTimeoutMs = input.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
    const staleSummary = input.summary ?? "巡视执行超时，系统已自动回收该运行";
    const staleRecords = this.patrolRunRepository.listRunningByProject(projectId).filter((record) => {
      const baseline = record.startedAt ?? record.createdAt;
      return isStaleRun(referenceAt, baseline, staleTimeoutMs);
    });

    return staleRecords.map((record) =>
      this.completeRun(record.id, {
        status: "failed",
        summary: staleSummary,
        riskLevel: "high",
        suggestions: ["检查 provider 会话状态并重试巡视"],
        finishedAt: referenceAt
      })
    );
  }

  getRun(projectId: string, runId: string): PatrolRunView {
    this.ensureProject(projectId);
    const record = this.getRunRecordOrThrow(runId);

    if (record.projectId !== projectId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PATROL_RUN_NOT_FOUND",
        detail: "当前项目下不存在该巡视记录"
      });
    }

    return mapRunRecord(record);
  }

  getRunById(runId: string): PatrolRunView {
    return mapRunRecord(this.getRunRecordOrThrow(runId));
  }

  markRunRunning(runId: string, input: MarkPatrolRunRunningInput = {}): PatrolRunView {
    const existing = this.getRunRecordOrThrow(runId);
    const timestamp = input.startedAt ?? nowIso();
    const updated: PatrolRunRecord = {
      ...existing,
      butlerSessionId: input.butlerSessionId ?? existing.butlerSessionId,
      status: "running",
      startedAt: existing.startedAt ?? timestamp
    };

    return mapRunRecord(this.updateRunRecord(updated));
  }

  completeRun(runId: string, input: CompletePatrolRunInput): PatrolRunView {
    const existing = this.getRunRecordOrThrow(runId);

    if (isTerminalRunStatus(existing.status)) {
      return mapRunRecord(existing);
    }

    const updated: PatrolRunRecord = {
      ...existing,
      status: input.status,
      summary: input.summary,
      riskLevel: input.riskLevel,
      suggestionsJson: JSON.stringify(input.suggestions.filter((item) => item.trim().length > 0)),
      finishedAt: input.finishedAt ?? nowIso()
    };

    return mapRunRecord(this.updateRunRecord(updated));
  }

  private ensureProject(projectId: string) {
    const project = this.butlerProjectRepository.findById(projectId);

    if (!project) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_PROJECT_NOT_FOUND",
        detail: "代码管家项目不存在"
      });
    }

    return project;
  }

  private getRunRecordOrThrow(runId: string): PatrolRunRecord {
    const record = this.patrolRunRepository.findById(runId);

    if (!record) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PATROL_RUN_NOT_FOUND",
        detail: "巡视记录不存在"
      });
    }

    return record;
  }

  private updateRunRecord(record: PatrolRunRecord): PatrolRunRecord {
    const updated = this.patrolRunRepository.update(record);

    if (!updated) {
      throw new AppError({
        statusCode: 500,
        errorCode: "PATROL_RUN_UPDATE_FAILED",
        detail: "巡视记录更新失败"
      });
    }

    return updated;
  }
}

function mapRunRecord(record: PatrolRunRecord): PatrolRunView {
  return {
    id: record.id,
    projectId: record.projectId,
    planId: record.planId,
    triggeredBy: record.triggeredBy,
    triggerRef: record.triggerRef,
    butlerSessionId: record.butlerSessionId,
    status: record.status,
    summary: record.summary,
    riskLevel: record.riskLevel,
    suggestions: parseSuggestions(record.suggestionsJson),
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    createdAt: record.createdAt
  };
}

function parseSuggestions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function isStaleRun(referenceAt: string, baselineAt: string, staleTimeoutMs: number): boolean {
  const reference = Date.parse(referenceAt);
  const baseline = Date.parse(baselineAt);

  if (!Number.isFinite(reference) || !Number.isFinite(baseline)) {
    return false;
  }

  return reference - baseline >= staleTimeoutMs;
}

function isTerminalRunStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
