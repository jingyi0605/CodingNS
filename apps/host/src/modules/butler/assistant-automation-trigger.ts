import { AppError } from "../../shared/errors/app-error.js";
import type { AssistantAutomationTriggerType } from "../../types/domain.js";

export type AssistantConditionKind = "git.remote_tag_changed" | "session.runtime_idle";

export interface OnceTriggerConfig {
  type: "once";
  dueAt: string;
}

export interface IntervalTriggerConfig {
  type: "interval";
  seconds: number | null;
  minutes: number | null;
  hours: number | null;
  stopAt: string | null;
}

export interface CronTriggerConfig {
  type: "cron";
  minute: number;
  hour: number | null;
  daysOfWeek: number[] | null;
  stopAt: string | null;
}

export interface GitRemoteTagChangedConditionState {
  repositoryUrl: string;
  latestTag: string | null;
  latestRef: string | null;
  checkCount: number;
  lastCheckedAt: string | null;
}

export interface SessionRuntimeIdleConditionState {
  sessionId: string;
  lastObservedRunningState: string | null;
  lastHasActiveRun: boolean | null;
  checkCount: number;
  lastCheckedAt: string | null;
}

export interface ConditionTriggerConfig {
  type: "condition";
  conditionKind: AssistantConditionKind;
  pollIntervalSeconds: number;
  expiresAt: string | null;
  maxChecks: number | null;
  stateJson: string;
}

export type AssistantAutomationTriggerConfig =
  | OnceTriggerConfig
  | IntervalTriggerConfig
  | CronTriggerConfig
  | ConditionTriggerConfig;

export interface SendControlMessageActionConfig {
  content: string;
  includeTriggerContext: boolean;
  targetSessionId: string | null;
}

export interface CreateOnceTriggerInput {
  type: "once";
  dueAt?: string | null;
  afterSeconds?: number | null;
}

export interface CreateIntervalTriggerInput {
  type: "interval";
  seconds?: number | null;
  minutes?: number | null;
  hours?: number | null;
  stopAt?: string | null;
}

export interface CreateCronTriggerInput {
  type: "cron";
  minute?: number | null;
  hour?: number | null;
  daysOfWeek?: number[] | null;
  stopAt?: string | null;
}

export interface CreateGitRemoteTagChangedTriggerInput {
  type: "condition";
  conditionKind: "git.remote_tag_changed";
  pollIntervalSeconds?: number | null;
  expiresAt?: string | null;
  maxChecks?: number | null;
  repositoryUrl?: string | null;
}

export interface CreateSessionRuntimeIdleTriggerInput {
  type: "condition";
  conditionKind: "session.runtime_idle";
  pollIntervalSeconds?: number | null;
  expiresAt?: string | null;
  maxChecks?: number | null;
  sessionId?: string | null;
}

export type CreateAssistantAutomationTriggerInput =
  | CreateOnceTriggerInput
  | CreateIntervalTriggerInput
  | CreateCronTriggerInput
  | CreateGitRemoteTagChangedTriggerInput
  | CreateSessionRuntimeIdleTriggerInput;

export function createTriggerConfig(
  input: CreateAssistantAutomationTriggerInput,
  referenceAt: string
): {
  triggerType: AssistantAutomationTriggerType;
  triggerConfigJson: string;
  nextRunAt: string | null;
} {
  switch (input.type) {
    case "once": {
      const config: OnceTriggerConfig = {
        type: "once",
        dueAt: resolveOnceDueAt(input, referenceAt)
      };

      return {
        triggerType: "once",
        triggerConfigJson: JSON.stringify(config),
        nextRunAt: config.dueAt
      };
    }
    case "interval": {
      const config = createIntervalTriggerConfig(input);
      return {
        triggerType: "interval",
        triggerConfigJson: JSON.stringify(config),
        nextRunAt: computeIntervalNextRunAt(config, referenceAt)
      };
    }
    case "cron": {
      const config = createCronTriggerConfig(input);
      return {
        triggerType: "cron",
        triggerConfigJson: JSON.stringify(config),
        nextRunAt: computeCronNextRunAt(config, referenceAt)
      };
    }
    case "condition": {
      const config = createConditionTriggerConfig(input);
      return {
        triggerType: "condition",
        triggerConfigJson: JSON.stringify(config),
        nextRunAt: computeConditionNextRunAt(config, referenceAt)
      };
    }
    default:
      return assertNever(input);
  }
}

export function parseTriggerConfig(
  triggerType: AssistantAutomationTriggerType,
  triggerConfigJson: string
): AssistantAutomationTriggerConfig {
  const parsed = parseJsonObject(triggerConfigJson, "triggerConfigJson");

  switch (triggerType) {
    case "once":
      return {
        type: "once",
        dueAt: requireIsoTimestamp(parsed.dueAt, "trigger.dueAt")
      };
    case "interval":
      return createIntervalTriggerConfig({
        type: "interval",
        seconds: toOptionalInteger(parsed.seconds),
        minutes: toOptionalInteger(parsed.minutes),
        hours: toOptionalInteger(parsed.hours),
        stopAt: normalizeNullableIsoTimestamp(parsed.stopAt, "trigger.stopAt")
      });
    case "cron":
      return createCronTriggerConfig({
        type: "cron",
        minute: toOptionalInteger(parsed.minute),
        hour: toOptionalInteger(parsed.hour),
        daysOfWeek: normalizeDaysOfWeek(parsed.daysOfWeek),
        stopAt: normalizeNullableIsoTimestamp(parsed.stopAt, "trigger.stopAt")
      });
    case "condition":
      return createConditionTriggerConfig({
        type: "condition",
        conditionKind: requireConditionKind(parsed.conditionKind),
        pollIntervalSeconds: toOptionalInteger(parsed.pollIntervalSeconds),
        expiresAt: normalizeNullableIsoTimestamp(parsed.expiresAt, "trigger.expiresAt"),
        maxChecks: toOptionalInteger(parsed.maxChecks),
        repositoryUrl: readOptionalString(parsed.repositoryUrl),
        sessionId: readOptionalString(parsed.sessionId),
        ...(typeof parsed.stateJson === "string" ? { stateJson: parsed.stateJson } : {})
      });
    default:
      return assertNever(triggerType);
  }
}

export function parseActionConfig(actionConfigJson: string): SendControlMessageActionConfig {
  const parsed = parseJsonObject(actionConfigJson, "actionConfigJson");
  return {
    content: requireContent(readOptionalString(parsed.content) ?? ""),
    includeTriggerContext: parsed.includeTriggerContext === true,
    targetSessionId: normalizeNullableText(readOptionalString(parsed.targetSessionId))
  };
}

export function computeNextRunAt(
  triggerConfig: AssistantAutomationTriggerConfig,
  referenceAt: string
): string | null {
  switch (triggerConfig.type) {
    case "once":
      return null;
    case "interval":
      return computeIntervalNextRunAt(triggerConfig, referenceAt);
    case "cron":
      return computeCronNextRunAt(triggerConfig, referenceAt);
    case "condition":
      return computeConditionNextRunAt(triggerConfig, referenceAt);
    default:
      return assertNever(triggerConfig);
  }
}

export function parseConditionState(
  config: ConditionTriggerConfig
): GitRemoteTagChangedConditionState | SessionRuntimeIdleConditionState {
  const parsed = parseJsonObject(config.stateJson, "trigger.stateJson");

  if (config.conditionKind === "git.remote_tag_changed") {
    return {
      repositoryUrl: requireNonEmptyText(
        readOptionalString(parsed.repositoryUrl),
        "repositoryUrl",
        "git.remote_tag_changed 必须提供 repositoryUrl"
      ),
      latestTag: normalizeNullableText(readOptionalString(parsed.latestTag)),
      latestRef: normalizeNullableText(readOptionalString(parsed.latestRef)),
      checkCount: Math.max(0, toOptionalInteger(parsed.checkCount) ?? 0),
      lastCheckedAt: normalizeNullableIsoTimestamp(parsed.lastCheckedAt, "trigger.state.lastCheckedAt")
    };
  }

  return {
    sessionId: requireNonEmptyText(
      readOptionalString(parsed.sessionId),
      "sessionId",
      "session.runtime_idle 必须提供 sessionId"
    ),
    lastObservedRunningState: normalizeNullableText(readOptionalString(parsed.lastObservedRunningState)),
    lastHasActiveRun:
      typeof parsed.lastHasActiveRun === "boolean"
        ? parsed.lastHasActiveRun
        : null,
    checkCount: Math.max(0, toOptionalInteger(parsed.checkCount) ?? 0),
    lastCheckedAt: normalizeNullableIsoTimestamp(parsed.lastCheckedAt, "trigger.state.lastCheckedAt")
  };
}

export function buildConditionTriggerConfig(
  config: ConditionTriggerConfig,
  state: GitRemoteTagChangedConditionState | SessionRuntimeIdleConditionState
): ConditionTriggerConfig {
  return {
    ...config,
    stateJson: JSON.stringify(state)
  };
}

function createIntervalTriggerConfig(input: CreateIntervalTriggerInput): IntervalTriggerConfig {
  const seconds = toPositiveInteger(input.seconds, "seconds");
  const minutes = toPositiveInteger(input.minutes, "minutes");
  const hours = toPositiveInteger(input.hours, "hours");

  if (!seconds && !minutes && !hours) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "interval 自动化至少要提供 seconds、minutes、hours 其中之一",
      field: "trigger"
    });
  }

  return {
    type: "interval",
    seconds: seconds || null,
    minutes: minutes || null,
    hours: hours || null,
    stopAt: normalizeNullableIsoTimestamp(input.stopAt, "trigger.stopAt")
  };
}

function createCronTriggerConfig(input: CreateCronTriggerInput): CronTriggerConfig {
  const minute = toOptionalInteger(input.minute);

  if (minute === null || minute < 0 || minute > 59) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "cron.minute 必须是 0 到 59 的整数",
      field: "cronMinute"
    });
  }

  const hour = toOptionalInteger(input.hour);

  if (hour !== null && (hour < 0 || hour > 23)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "cron.hour 必须是 0 到 23 的整数",
      field: "cronHour"
    });
  }

  return {
    type: "cron",
    minute,
    hour,
    daysOfWeek: normalizeDaysOfWeek(input.daysOfWeek),
    stopAt: normalizeNullableIsoTimestamp(input.stopAt, "trigger.stopAt")
  };
}

function createConditionTriggerConfig(
  input:
    | CreateGitRemoteTagChangedTriggerInput
    | CreateSessionRuntimeIdleTriggerInput
    | ({
        type: "condition";
        conditionKind: AssistantConditionKind;
        pollIntervalSeconds?: number | null;
        expiresAt?: string | null;
        maxChecks?: number | null;
        stateJson?: string;
        repositoryUrl?: string | null;
        sessionId?: string | null;
      })
): ConditionTriggerConfig {
  const pollIntervalSeconds = toPositiveInteger(
    input.pollIntervalSeconds,
    "pollIntervalSeconds"
  );
  const normalizedPollIntervalSeconds = pollIntervalSeconds || 60;
  const expiresAt = normalizeNullableIsoTimestamp(input.expiresAt, "trigger.expiresAt");
  const maxChecks = toPositiveInteger(input.maxChecks, "maxChecks") || null;

  if ("stateJson" in input && typeof input.stateJson === "string" && input.stateJson.trim()) {
    return {
      type: "condition",
      conditionKind: input.conditionKind,
      pollIntervalSeconds: normalizedPollIntervalSeconds,
      expiresAt,
      maxChecks,
      stateJson: input.stateJson
    };
  }

  if (input.conditionKind === "git.remote_tag_changed") {
    const repositoryUrl = requireNonEmptyText(
      normalizeNullableText(input.repositoryUrl),
      "repositoryUrl",
      "git.remote_tag_changed 必须提供 repositoryUrl"
    );

    const state: GitRemoteTagChangedConditionState = {
      repositoryUrl,
      latestTag: null,
      latestRef: null,
      checkCount: 0,
      lastCheckedAt: null
    };

    return {
      type: "condition",
      conditionKind: input.conditionKind,
      pollIntervalSeconds: normalizedPollIntervalSeconds,
      expiresAt,
      maxChecks,
      stateJson: JSON.stringify(state)
    };
  }

  const sessionId = requireNonEmptyText(
    normalizeNullableText(input.sessionId),
    "sessionId",
    "session.runtime_idle 必须提供 sessionId"
  );
  const state: SessionRuntimeIdleConditionState = {
    sessionId,
    lastObservedRunningState: null,
    lastHasActiveRun: null,
    checkCount: 0,
    lastCheckedAt: null
  };

  return {
    type: "condition",
    conditionKind: input.conditionKind,
    pollIntervalSeconds: normalizedPollIntervalSeconds,
    expiresAt,
    maxChecks,
    stateJson: JSON.stringify(state)
  };
}

function resolveOnceDueAt(input: CreateOnceTriggerInput, referenceAt: string): string {
  if (normalizeNullableText(input.dueAt)) {
    return requireIsoTimestamp(input.dueAt, "dueAt");
  }

  const delaySeconds = toPositiveInteger(input.afterSeconds, "afterSeconds");

  if (!delaySeconds) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "创建一次性自动化必须提供 dueAt 或 afterSeconds",
      field: "dueAt"
    });
  }

  const referenceMs = Date.parse(referenceAt);
  return new Date(referenceMs + delaySeconds * 1000).toISOString();
}

function computeIntervalNextRunAt(
  config: IntervalTriggerConfig,
  referenceAt: string
): string | null {
  const intervalMs =
    (config.seconds ?? 0) * 1000
    || (config.minutes ?? 0) * 60 * 1000
    || (config.hours ?? 0) * 60 * 60 * 1000;

  if (!intervalMs) {
    return null;
  }

  const nextRunAt = new Date(new Date(referenceAt).getTime() + intervalMs).toISOString();
  return applyStopAt(nextRunAt, config.stopAt);
}

function computeCronNextRunAt(config: CronTriggerConfig, referenceAt: string): string | null {
  const cursor = new Date(referenceAt);

  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let index = 0; index < 60 * 24 * 8; index += 1) {
    if (
      cursor.getMinutes() === config.minute
      && (config.hour === null || cursor.getHours() === config.hour)
      && (config.daysOfWeek === null || config.daysOfWeek.includes(cursor.getDay()))
    ) {
      return applyStopAt(cursor.toISOString(), config.stopAt);
    }

    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
}

function computeConditionNextRunAt(
  config: ConditionTriggerConfig,
  referenceAt: string
): string | null {
  const nextRunAt = new Date(
    new Date(referenceAt).getTime() + config.pollIntervalSeconds * 1000
  ).toISOString();

  return applyStopAt(nextRunAt, config.expiresAt);
}

function applyStopAt(candidate: string, stopAt: string | null): string | null {
  if (!stopAt) {
    return candidate;
  }

  return candidate <= stopAt ? candidate : null;
}

function requireContent(value: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "创建助手自动化必须提供 content",
      field: "content"
    });
  }

  return normalized;
}

function requireIsoTimestamp(value: unknown, field: string): string {
  const normalized = normalizeNullableText(readOptionalString(value));

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是合法的 ISO 时间`,
      field
    });
  }

  const timestamp = Date.parse(normalized);

  if (Number.isNaN(timestamp)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是合法的 ISO 时间`,
      field
    });
  }

  return new Date(timestamp).toISOString();
}

function normalizeNullableIsoTimestamp(value: unknown, field: string): string | null {
  const normalized = normalizeNullableText(readOptionalString(value));
  return normalized ? requireIsoTimestamp(normalized, field) : null;
}

function requireConditionKind(value: unknown): AssistantConditionKind {
  if (value === "git.remote_tag_changed" || value === "session.runtime_idle") {
    return value;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: "conditionKind 只支持 git.remote_tag_changed 或 session.runtime_idle",
    field: "conditionKind"
  });
}

function normalizeDaysOfWeek(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const days = value
    .map((item) => toOptionalInteger(item))
    .filter((item): item is number => item !== null && item >= 0 && item <= 6);

  return days.length > 0 ? Array.from(new Set(days)).sort((left, right) => left - right) : null;
}

function toPositiveInteger(value: unknown, field: string): number {
  const normalized = toOptionalInteger(value);

  if (normalized === null) {
    return 0;
  }

  if (normalized <= 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是正整数`,
      field
    });
  }

  return normalized;
}

function toOptionalInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

function requireNonEmptyText(
  value: string | null,
  field: string,
  detail: string
): string {
  if (!value) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail,
      field
    });
  }

  return value;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseJsonObject(value: string, field: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }

  throw new AppError({
    statusCode: 500,
    errorCode: "ASSISTANT_AUTOMATION_CONFIG_INVALID",
    detail: `${field} 解析失败`
  });
}

function assertNever(value: never): never {
  throw new Error(`Unexpected assistant automation trigger: ${String(value)}`);
}
