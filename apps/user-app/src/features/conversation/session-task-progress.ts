import type { ProviderId, ToolCallDto } from "./api/conversation-api";
import type { SessionMessageViewModel } from "./runtime/session-runtime-machine";

export type ConversationTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface ConversationTaskItem {
  id: string;
  title: string;
  status: ConversationTaskStatus;
  detail: string | null;
  updatedAt: string;
}

export interface ConversationTaskSnapshot {
  provider: ProviderId | null;
  source: "plan" | "todo";
  explanation: string | null;
  items: ConversationTaskItem[];
  updatedAt: string;
}

interface MutableTaskRecord {
  id: string;
  title: string;
  status: ConversationTaskStatus;
  detail: string | null;
  updatedAt: string;
}

interface ParsedStructuredValue {
  value: unknown;
  source: "input" | "output";
}

const CODEX_PLAN_TOOL_NAMES = new Set(["updateplan"]);
const TODO_WRITE_TOOL_NAMES = new Set([
  "todowrite"
]);
const TODO_READ_TOOL_NAMES = new Set([
  "todoread"
]);
const CLAUDE_INCREMENTAL_TASK_TOOL_NAMES = new Set([
  "taskcreate",
  "taskupdate",
  "taskget",
  "tasklist",
  "taskdelete",
  "taskremove"
]);

export function buildConversationTaskSnapshot(
  messages: SessionMessageViewModel[],
  provider: ProviderId | null
): ConversationTaskSnapshot | null {
  const planSnapshot = buildCodexPlanSnapshot(messages, provider);

  if (planSnapshot) {
    return planSnapshot;
  }

  return buildTodoSnapshot(messages, provider);
}

export function countConversationTasksByStatus(
  items: ConversationTaskItem[]
): Record<ConversationTaskStatus, number> {
  return items.reduce<Record<ConversationTaskStatus, number>>((accumulator, item) => {
    accumulator[item.status] += 1;
    return accumulator;
  }, {
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    cancelled: 0
  });
}

export function buildConversationTaskSnapshotFromToolCall(
  toolCall: ToolCallDto,
  provider: ProviderId | null,
  updatedAt: string
): ConversationTaskSnapshot | null {
  if (!toolCall) {
    return null;
  }

  if (isCodexPlanTool(toolCall.name)) {
    const payload = parseStructuredPayload(toolCall);

    if (!payload || !isRecord(payload.value)) {
      return null;
    }

    const parsed = parsePlanPayload(payload.value, updatedAt);

    if (!parsed || parsed.items.length === 0) {
      return null;
    }

    return {
      provider,
      source: "plan",
      explanation: parsed.explanation,
      items: parsed.items,
      updatedAt
    };
  }

  const normalizedToolName = normalizeToolName(toolCall.name);

  if (
    !TODO_WRITE_TOOL_NAMES.has(normalizedToolName)
    && !TODO_READ_TOOL_NAMES.has(normalizedToolName)
    && !CLAUDE_INCREMENTAL_TASK_TOOL_NAMES.has(normalizedToolName)
  ) {
    return null;
  }

  const payload = parseStructuredPayload(
    toolCall,
    TODO_READ_TOOL_NAMES.has(normalizedToolName) ? "prefer-output" : "prefer-output"
  );

  if (!payload) {
    return null;
  }

  if (normalizedToolName === "taskdelete" || normalizedToolName === "taskremove") {
    const deletedIds = extractTaskIds(payload.value);

    return deletedIds.length > 0
      ? {
          provider,
          source: "todo",
          explanation: null,
          items: deletedIds.map((id, index) => ({
            id,
            title: `Task ${index + 1}`,
            status: "cancelled",
            detail: id,
            updatedAt
          })),
          updatedAt
        }
      : null;
  }

  const items = extractTaskItemsFromPayload(payload.value, updatedAt);

  if (items.length === 0) {
    return null;
  }

  return {
    provider,
    source: isCodexPlanTool(toolCall.name) ? "plan" : "todo",
    explanation: null,
    items,
    updatedAt
  };
}

function buildCodexPlanSnapshot(
  messages: SessionMessageViewModel[],
  provider: ProviderId | null
): ConversationTaskSnapshot | null {
  let latestSnapshot: ConversationTaskSnapshot | null = null;

  for (const message of messages) {
    const toolCall = message.toolCall;

    if (!toolCall || normalizeToolName(toolCall.name) === "" || !isCodexPlanTool(toolCall.name)) {
      continue;
    }

    const payload = parseStructuredPayload(toolCall);

    if (!payload || typeof payload.value !== "object" || payload.value === null) {
      continue;
    }

    const parsed = parsePlanPayload(payload.value as Record<string, unknown>, message.timestamp);

    if (!parsed || parsed.items.length === 0) {
      continue;
    }

    latestSnapshot = {
      provider,
      source: "plan",
      explanation: parsed.explanation,
      items: parsed.items,
      updatedAt: message.timestamp
    };
  }

  return latestSnapshot;
}

function buildTodoSnapshot(
  messages: SessionMessageViewModel[],
  provider: ProviderId | null
): ConversationTaskSnapshot | null {
  const taskMap = new Map<string, MutableTaskRecord>();
  let latestUpdatedAt: string | null = null;

  for (const message of messages) {
    const toolCall = message.toolCall;

    if (!toolCall) {
      continue;
    }

    const normalizedToolName = normalizeToolName(toolCall.name);

    if (TODO_WRITE_TOOL_NAMES.has(normalizedToolName)) {
      const payload = parseStructuredPayload(toolCall);
      const items = payload ? extractTaskItemsFromPayload(payload.value, message.timestamp) : [];

      if (items.length > 0) {
        replaceTaskMap(taskMap, items);
        latestUpdatedAt = message.timestamp;
      }
      continue;
    }

    if (TODO_READ_TOOL_NAMES.has(normalizedToolName)) {
      const payload = parseStructuredPayload(toolCall, "prefer-output");
      const items = payload ? extractTaskItemsFromPayload(payload.value, message.timestamp) : [];

      if (items.length > 0) {
        replaceTaskMap(taskMap, items);
        latestUpdatedAt = message.timestamp;
      }
      continue;
    }

    if (!CLAUDE_INCREMENTAL_TASK_TOOL_NAMES.has(normalizedToolName)) {
      continue;
    }

    const payload = parseStructuredPayload(toolCall, "prefer-output");

    if (!payload) {
      continue;
    }

    if (normalizedToolName === "tasklist" || normalizedToolName === "taskget") {
      const items = extractTaskItemsFromPayload(payload.value, message.timestamp);

      if (items.length > 0) {
        replaceTaskMap(taskMap, items);
        latestUpdatedAt = message.timestamp;
      }
      continue;
    }

    if (normalizedToolName === "taskdelete" || normalizedToolName === "taskremove") {
      const ids = extractTaskIds(payload.value);

      if (ids.length > 0) {
        for (const id of ids) {
          taskMap.delete(id);
        }
        latestUpdatedAt = message.timestamp;
      }
      continue;
    }

    const items = extractTaskItemsFromPayload(payload.value, message.timestamp);

    if (items.length === 0) {
      continue;
    }

    for (const item of items) {
      upsertTaskRecord(taskMap, item);
    }
    latestUpdatedAt = message.timestamp;
  }

  const items = Array.from(taskMap.values())
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    .map((item) => ({ ...item }));

  if (items.length === 0 || !latestUpdatedAt) {
    return null;
  }

  return {
    provider,
    source: "todo",
    explanation: null,
    items,
    updatedAt: latestUpdatedAt
  };
}

function isCodexPlanTool(name: string): boolean {
  return CODEX_PLAN_TOOL_NAMES.has(normalizeToolName(name));
}

function parsePlanPayload(
  payload: Record<string, unknown>,
  timestamp: string
): Pick<ConversationTaskSnapshot, "items" | "explanation"> | null {
  const planItems = Array.isArray(payload.plan) ? payload.plan : null;

  if (!planItems || planItems.length === 0) {
    return null;
  }

  const items = planItems
    .map((item, index) => toTaskItem(item, {
      fallbackIdPrefix: "plan",
      fallbackTitle: `Step ${index + 1}`,
      fallbackStatus: "pending",
      updatedAt: timestamp
    }))
    .filter((item): item is ConversationTaskItem => item !== null);

  if (items.length === 0) {
    return null;
  }

  return {
    items,
    explanation: readNonEmptyText(payload.explanation)
  };
}

function parseStructuredPayload(
  toolCall: ToolCallDto,
  mode: "prefer-input" | "prefer-output" = "prefer-input"
): ParsedStructuredValue | null {
  const orderedCandidates =
    mode === "prefer-output"
      ? [
          { text: toolCall.output, source: "output" as const },
          { text: toolCall.input, source: "input" as const }
        ]
      : [
          { text: toolCall.input, source: "input" as const },
          { text: toolCall.output, source: "output" as const }
        ];

  for (const candidate of orderedCandidates) {
    const parsed = parseJsonLikeText(candidate.text);

    if (parsed !== null) {
      return {
        value: parsed,
        source: candidate.source
      };
    }
  }

  return null;
}

function parseJsonLikeText(text: string | null): unknown {
  const normalized = text?.trim() ?? "";

  if (!normalized) {
    return null;
  }

  const direct = tryParseJson(normalized);

  if (direct !== null) {
    return direct;
  }

  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]+?)```/i);

  if (fencedMatch?.[1]) {
    const fencedParsed = tryParseJson(fencedMatch[1].trim());

    if (fencedParsed !== null) {
      return fencedParsed;
    }
  }

  const objectStart = normalized.indexOf("{");
  const objectEnd = normalized.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    const objectParsed = tryParseJson(normalized.slice(objectStart, objectEnd + 1));

    if (objectParsed !== null) {
      return objectParsed;
    }
  }

  const arrayStart = normalized.indexOf("[");
  const arrayEnd = normalized.lastIndexOf("]");

  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return tryParseJson(normalized.slice(arrayStart, arrayEnd + 1));
  }

  return null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractTaskItemsFromPayload(
  payload: unknown,
  updatedAt: string
): ConversationTaskItem[] {
  const taskNodes = collectTaskNodes(payload);

  return taskNodes
    .map((node, index) => toTaskItem(node, {
      fallbackIdPrefix: "task",
      fallbackTitle: `Task ${index + 1}`,
      fallbackStatus: "pending",
      updatedAt
    }))
    .filter((item): item is ConversationTaskItem => item !== null);
}

function collectTaskNodes(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => collectTaskNodes(item));
  }

  if (!isRecord(payload)) {
    return [];
  }

  if (isTaskLikeRecord(payload)) {
    return [payload];
  }

  const preferredKeys = ["tasks", "todos", "items", "entries", "results", "data"];

  for (const key of preferredKeys) {
    if (!(key in payload)) {
      continue;
    }

    const collected = collectTaskNodes(payload[key]);

    if (collected.length > 0) {
      return collected;
    }
  }

  return Object.values(payload).flatMap((value) => collectTaskNodes(value));
}

function extractTaskIds(payload: unknown): string[] {
  const taskNodes = collectTaskNodes(payload);
  const ids = taskNodes
    .map((node) => readTaskId(node))
    .filter((value): value is string => value !== null);

  if (ids.length > 0) {
    return ids;
  }

  if (!isRecord(payload)) {
    return [];
  }

  const directId = readTaskId(payload);
  return directId ? [directId] : [];
}

function toTaskItem(
  payload: unknown,
  input: {
    fallbackIdPrefix: string;
    fallbackTitle: string;
    fallbackStatus: ConversationTaskStatus;
    updatedAt: string;
  }
): ConversationTaskItem | null {
  if (!isRecord(payload)) {
    return null;
  }

  const title =
    readNonEmptyText(payload.step)
    ?? readNonEmptyText(payload.title)
    ?? readNonEmptyText(payload.content)
    ?? readNonEmptyText(payload.task)
    ?? readNonEmptyText(payload.text)
    ?? readNonEmptyText(payload.name)
    ?? readNonEmptyText(payload.subject)
    ?? readNonEmptyText(payload.description)
    ?? input.fallbackTitle;
  const id =
    readTaskId(payload)
    ?? buildStableFallbackTaskId(input.fallbackIdPrefix, title);
  const detail = resolveTaskDetail(payload, title);

  return {
    id,
    title,
    status: normalizeTaskStatus(payload.status, input.fallbackStatus),
    detail,
    updatedAt: input.updatedAt
  };
}

function upsertTaskRecord(
  taskMap: Map<string, MutableTaskRecord>,
  task: ConversationTaskItem
): void {
  const existing = taskMap.get(task.id);

  if (!existing) {
    taskMap.set(task.id, { ...task });
    return;
  }

  taskMap.set(task.id, {
    id: existing.id,
    title: task.title || existing.title,
    status: task.status,
    detail: task.detail ?? existing.detail,
    updatedAt: task.updatedAt
  });
}

function replaceTaskMap(
  taskMap: Map<string, MutableTaskRecord>,
  items: ConversationTaskItem[]
): void {
  taskMap.clear();

  for (const item of items) {
    taskMap.set(item.id, { ...item });
  }
}

function normalizeTaskStatus(
  value: unknown,
  fallbackStatus: ConversationTaskStatus
): ConversationTaskStatus {
  const normalized = readNonEmptyText(value)?.toLowerCase().replace(/[\s-]+/g, "_");

  if (!normalized) {
    return fallbackStatus;
  }

  if ([
    "pending",
    "todo",
    "open",
    "queued",
    "not_started",
    "created"
  ].includes(normalized)) {
    return "pending";
  }

  if ([
    "in_progress",
    "progress",
    "active",
    "doing",
    "running",
    "started"
  ].includes(normalized)) {
    return "in_progress";
  }

  if ([
    "completed",
    "complete",
    "done",
    "success",
    "succeeded",
    "finished",
    "closed"
  ].includes(normalized)) {
    return "completed";
  }

  if ([
    "failed",
    "error",
    "errored"
  ].includes(normalized)) {
    return "failed";
  }

  if ([
    "cancelled",
    "canceled",
    "aborted",
    "skipped"
  ].includes(normalized)) {
    return "cancelled";
  }

  return fallbackStatus;
}

function resolveTaskDetail(payload: Record<string, unknown>, title: string): string | null {
  const candidates = [
    readNonEmptyText(payload.detail),
    readNonEmptyText(payload.details),
    readNonEmptyText(payload.description),
    readNonEmptyText(payload.reason),
    readNonEmptyText(payload.summary),
    readNonEmptyText(payload.note),
    readNonEmptyText(payload.priority)
  ].filter((value): value is string => value !== null);

  for (const candidate of candidates) {
    if (candidate !== title) {
      return candidate;
    }
  }

  return null;
}

function readTaskId(payload: Record<string, unknown>): string | null {
  return (
    readNonEmptyText(payload.id)
    ?? readNonEmptyText(payload.taskId)
    ?? readNonEmptyText(payload.task_id)
    ?? readNonEmptyText(payload.uuid)
    ?? readNonEmptyText(payload.key)
  );
}

function buildStableFallbackTaskId(prefix: string, title: string): string {
  return `${prefix}:${title.trim().toLowerCase()}`;
}

function isTaskLikeRecord(value: Record<string, unknown>): boolean {
  return [
    value.step,
    value.title,
    value.content,
    value.task,
    value.text,
    value.subject,
    value.name,
    value.description
  ].some((item) => readNonEmptyText(item) !== null);
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_.-]+/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
