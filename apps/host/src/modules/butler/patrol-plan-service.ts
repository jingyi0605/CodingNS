import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ButlerProjectRepository } from "../../storage/repositories/butler-project-repository.js";
import type {
  PatrolPlanRecord,
  PatrolPlanRepository
} from "../../storage/repositories/patrol-plan-repository.js";

const TRIGGER_TYPES = ["manual", "interval", "cron"] as const;
const EXECUTION_MODES = ["readonly", "controlled"] as const;

export interface PatrolPlanView {
  id: string;
  projectId: string;
  name: string;
  triggerType: (typeof TRIGGER_TYPES)[number];
  triggerConfig: Record<string, unknown>;
  executionMode: (typeof EXECUTION_MODES)[number];
  patrolScope: Record<string, unknown>;
  enabled: boolean;
  lastScheduledAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePatrolPlanInput {
  name: string;
  triggerType: (typeof TRIGGER_TYPES)[number];
  triggerConfig: Record<string, unknown>;
  executionMode: (typeof EXECUTION_MODES)[number];
  patrolScope: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdatePatrolPlanInput {
  name?: string;
  triggerConfig?: Record<string, unknown>;
  executionMode?: (typeof EXECUTION_MODES)[number];
  patrolScope?: Record<string, unknown>;
  enabled?: boolean;
  lastScheduledAt?: string | null;
  nextRunAt?: string | null;
}

export interface PatrolScheduleContext {
  referenceAt: string;
  source: "create" | "update" | "scheduler";
}

export class PatrolPlanService {
  constructor(
    private readonly butlerProjectRepository: ButlerProjectRepository,
    private readonly patrolPlanRepository: PatrolPlanRepository
  ) {}

  listPlans(projectId: string, filters?: { enabled?: boolean; executionMode?: PatrolPlanView["executionMode"] }): PatrolPlanView[] {
    this.ensureProject(projectId);
    const records = this.patrolPlanRepository.listByProject(projectId, {
      enabled: filters?.enabled ? 1 : filters?.enabled === false ? 0 : undefined,
      executionMode: filters?.executionMode
    });

    return records.map(mapPlanRecord);
  }

  createPlan(projectId: string, input: CreatePatrolPlanInput): PatrolPlanView {
    this.ensureProject(projectId);
    validateTriggerType(input.triggerType);
    validateExecutionMode(input.executionMode);
    const timestamp = nowIso();
    const enabled = input.enabled !== false;

    const record: PatrolPlanRecord = {
      id: createId(),
      projectId,
      name: requireNonEmptyText(input.name, "name", "巡视计划名称不能为空"),
      triggerType: input.triggerType,
      triggerConfigJson: JSON.stringify(input.triggerConfig),
      executionMode: input.executionMode,
      patrolScopeJson: JSON.stringify(input.patrolScope),
      enabled: enabled ? 1 : 0,
      lastScheduledAt: null,
      nextRunAt: enabled
        ? computeNextRunAt(input.triggerType, input.triggerConfig, {
          referenceAt: timestamp,
          source: "create"
        })
        : null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    return mapPlanRecord(this.patrolPlanRepository.create(record));
  }

  updatePlan(projectId: string, planId: string, input: UpdatePatrolPlanInput): PatrolPlanView {
    this.ensureProject(projectId);
    const existing = this.patrolPlanRepository.findById(planId);

    if (!existing) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PATROL_PLAN_NOT_FOUND",
        detail: "巡视计划不存在"
      });
    }

    if (existing.projectId !== projectId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PATROL_PLAN_NOT_FOUND",
        detail: "当前项目下不存在该巡视计划"
      });
    }

    const nextEnabled = input.enabled !== undefined ? input.enabled : existing.enabled === 1;
    const triggerConfig =
      input.triggerConfig
        ? input.triggerConfig
        : parseJsonObject(existing.triggerConfigJson);

    const updated: PatrolPlanRecord = {
      ...existing,
      name: input.name?.trim() || existing.name,
      triggerConfigJson: JSON.stringify(triggerConfig),
      executionMode: input.executionMode ?? existing.executionMode,
      patrolScopeJson: input.patrolScope ? JSON.stringify(input.patrolScope) : existing.patrolScopeJson,
      enabled: nextEnabled ? 1 : 0,
      lastScheduledAt: input.lastScheduledAt ?? existing.lastScheduledAt,
      nextRunAt: resolveNextRunAtForUpdate(existing, triggerConfig, input, nextEnabled),
      updatedAt: nowIso()
    };

    validateExecutionMode(updated.executionMode);

    const record = this.patrolPlanRepository.update(updated);

    if (!record) {
      throw new AppError({
        statusCode: 500,
        errorCode: "PATROL_PLAN_UPDATE_FAILED",
        detail: "巡视计划更新失败"
      });
    }

    return mapPlanRecord(record);
  }

  listDuePlans(referenceTime: string, limit = 50): PatrolPlanView[] {
    return this.patrolPlanRepository.listDue(referenceTime, limit).map(mapPlanRecord);
  }

  markPlanScheduled(projectId: string, planId: string, scheduledAt: string): PatrolPlanView {
    const existing = this.patrolPlanRepository.findById(planId);

    if (!existing || existing.projectId !== projectId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PATROL_PLAN_NOT_FOUND",
        detail: "当前项目下不存在该巡视计划"
      });
    }

    const updated: PatrolPlanRecord = {
      ...existing,
      lastScheduledAt: scheduledAt,
      nextRunAt:
        existing.enabled === 1
          ? computeNextRunAt(existing.triggerType, parseJsonObject(existing.triggerConfigJson), {
            referenceAt: scheduledAt,
            source: "scheduler"
          })
          : null,
      updatedAt: nowIso()
    };

    const record = this.patrolPlanRepository.update(updated);

    if (!record) {
      throw new AppError({
        statusCode: 500,
        errorCode: "PATROL_PLAN_UPDATE_FAILED",
        detail: "巡视计划调度推进失败"
      });
    }

    return mapPlanRecord(record);
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
}

function mapPlanRecord(record: PatrolPlanRecord): PatrolPlanView {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    triggerType: record.triggerType as PatrolPlanView["triggerType"],
    triggerConfig: JSON.parse(record.triggerConfigJson),
    executionMode: record.executionMode as PatrolPlanView["executionMode"],
    patrolScope: JSON.parse(record.patrolScopeJson),
    enabled: record.enabled === 1,
    lastScheduledAt: record.lastScheduledAt,
    nextRunAt: record.nextRunAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function validateTriggerType(value: string): void {
  if (!TRIGGER_TYPES.includes(value as (typeof TRIGGER_TYPES)[number])) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_TRIGGER_TYPE",
      detail: "triggerType 无效",
      field: "triggerType"
    });
  }
}

function validateExecutionMode(value: string): void {
  if (!EXECUTION_MODES.includes(value as (typeof EXECUTION_MODES)[number])) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_EXECUTION_MODE",
      detail: "executionMode 无效",
      field: "executionMode"
    });
  }
}

function resolveNextRunAtForUpdate(
  existing: PatrolPlanRecord,
  triggerConfig: Record<string, unknown>,
  input: UpdatePatrolPlanInput,
  enabled: boolean
): string | null {
  if (input.nextRunAt !== undefined) {
    return input.nextRunAt;
  }

  if (!enabled) {
    return null;
  }

  if (existing.enabled === 0 || existing.nextRunAt === null || input.triggerConfig) {
    return computeNextRunAt(existing.triggerType, triggerConfig, {
      referenceAt: nowIso(),
      source: "update"
    });
  }

  return existing.nextRunAt;
}

function computeNextRunAt(
  triggerType: string,
  triggerConfig: Record<string, unknown>,
  context: PatrolScheduleContext
): string | null {
  if (triggerType === "manual") {
    return null;
  }

  if (triggerType === "interval") {
    return computeIntervalNextRunAt(triggerConfig, context.referenceAt);
  }

  if (triggerType === "cron") {
    return computeCronNextRunAt(triggerConfig, context.referenceAt);
  }

  return null;
}

function computeIntervalNextRunAt(
  triggerConfig: Record<string, unknown>,
  referenceAt: string
): string | null {
  const intervalMs =
    toPositiveInteger(triggerConfig.seconds) * 1000
    || toPositiveInteger(triggerConfig.minutes) * 60 * 1000
    || toPositiveInteger(triggerConfig.hours) * 60 * 60 * 1000;

  if (!intervalMs) {
    return null;
  }

  return new Date(new Date(referenceAt).getTime() + intervalMs).toISOString();
}

function computeCronNextRunAt(
  triggerConfig: Record<string, unknown>,
  referenceAt: string
): string | null {
  const minute = normalizeCronMinute(triggerConfig.minute);
  const hour = normalizeCronHour(triggerConfig.hour);
  const daysOfWeek = normalizeCronDaysOfWeek(triggerConfig.daysOfWeek);
  const cursor = new Date(referenceAt);

  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let index = 0; index < 60 * 24 * 8; index += 1) {
    if (
      cursor.getMinutes() === minute
      && (hour === null || cursor.getHours() === hour)
      && (daysOfWeek === null || daysOfWeek.includes(cursor.getDay()))
    ) {
      return cursor.toISOString();
    }

    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
}

function normalizeCronMinute(value: unknown): number {
  const minute = toPositiveInteger(value);
  return minute >= 0 && minute <= 59 ? minute : 0;
}

function normalizeCronHour(value: unknown): number | null {
  const hour = toPositiveInteger(value);
  return hour >= 0 && hour <= 23 ? hour : null;
}

function normalizeCronDaysOfWeek(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const days = value
    .map((item) => toPositiveInteger(item))
    .filter((item) => item >= 0 && item <= 6);

  return days.length > 0 ? days : null;
}

function toPositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  const normalized = Math.floor(value);
  return normalized > 0 || normalized === 0 ? normalized : 0;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function requireNonEmptyText(value: string | undefined, field: string, detail: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail,
      field
    });
  }

  return normalized;
}
