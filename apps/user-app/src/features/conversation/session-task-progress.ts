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
  hasExplicitTitle: boolean;
}

interface ParsedTaskItem extends ConversationTaskItem {
  hasExplicitTitle: boolean;
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

  if (normalizedToolName === "taskdelete" || normalizedToolName === "taskremove") {
    const payload = parseStructuredPayload(
      toolCall,
      resolveTaskPayloadMode(normalizedToolName)
    );

    if (!payload) {
      return null;
    }

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

  const items = extractTaskItemsFromToolCall(toolCall, normalizedToolName, updatedAt);

  if (items.length === 0) {
    return null;
  }

  if (isTitlelessIncrementalTaskUpdate(normalizedToolName, items)) {
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
      const items = extractTaskItemsFromToolCall(toolCall, normalizedToolName, message.timestamp);

      if (items.length > 0) {
        replaceTaskMap(taskMap, items);
        latestUpdatedAt = message.timestamp;
      }
      continue;
    }

    if (TODO_READ_TOOL_NAMES.has(normalizedToolName)) {
      const items = extractTaskItemsFromToolCall(toolCall, normalizedToolName, message.timestamp);

      if (items.length > 0) {
        replaceTaskMap(taskMap, items);
        latestUpdatedAt = message.timestamp;
      }
      continue;
    }

    if (!CLAUDE_INCREMENTAL_TASK_TOOL_NAMES.has(normalizedToolName)) {
      continue;
    }

    if (normalizedToolName === "tasklist" || normalizedToolName === "taskget") {
      const items = extractTaskItemsFromToolCall(toolCall, normalizedToolName, message.timestamp);

      if (items.length > 0) {
        replaceTaskMap(taskMap, items);
        latestUpdatedAt = message.timestamp;
      }
      continue;
    }

    if (normalizedToolName === "taskdelete" || normalizedToolName === "taskremove") {
      const payload = parseStructuredPayload(toolCall, resolveTaskPayloadMode(normalizedToolName));

      if (!payload) {
        continue;
      }

      const ids = extractTaskIds(payload.value);

      if (ids.length > 0) {
        for (const id of ids) {
          taskMap.delete(resolveExistingTaskId(taskMap, id));
        }
        latestUpdatedAt = message.timestamp;
      }
      continue;
    }

    const items = extractTaskItemsFromToolCall(toolCall, normalizedToolName, message.timestamp);

    if (items.length === 0) {
      continue;
    }

    for (const item of items) {
      upsertTaskRecord(taskMap, item);
    }
    latestUpdatedAt = message.timestamp;
  }

  const items = Array.from(taskMap.values())
    .map((item) => toPublicTaskItem(item));

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
    .filter((item): item is ParsedTaskItem => item !== null);

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

function resolveTaskPayloadMode(
  normalizedToolName: string
): "prefer-input" | "prefer-output" {
  if (
    normalizedToolName === "todoread"
    || normalizedToolName === "tasklist"
    || normalizedToolName === "taskget"
  ) {
    return "prefer-output";
  }

  return "prefer-input";
}

function extractTaskItemsFromToolCall(
  toolCall: ToolCallDto,
  normalizedToolName: string,
  updatedAt: string
): ParsedTaskItem[] {
  if (normalizedToolName === "taskcreate") {
    return extractClaudeTaskCreateItems(toolCall, updatedAt);
  }

  const payload = parseStructuredPayload(toolCall, resolveTaskPayloadMode(normalizedToolName));
  return payload ? extractTaskItemsFromPayload(payload.value, updatedAt) : [];
}

function extractClaudeTaskCreateItems(
  toolCall: ToolCallDto,
  updatedAt: string
): ParsedTaskItem[] {
  const inputPayload = parseStructuredPayload(toolCall, "prefer-input");
  const inputItems = inputPayload ? extractTaskItemsFromPayload(inputPayload.value, updatedAt) : [];

  if (inputItems.length === 0) {
    const outputPayload = parseStructuredPayload(toolCall, "prefer-output");
    const outputItems = outputPayload ? extractTaskItemsFromPayload(outputPayload.value, updatedAt) : [];

    if (outputItems.length > 0) {
      return outputItems;
    }

    return extractPlainTextTaskCreateItems(toolCall, updatedAt);
  }

  const outputPayload = parseStructuredPayload(toolCall, "prefer-output");
  const outputIds = outputPayload ? extractTaskIds(outputPayload.value) : [];

  if (outputIds.length === 0) {
    return inputItems;
  }

  return inputItems.map((item, index) => {
    const outputId = outputIds[index] ?? (outputIds.length === 1 ? outputIds[0] : null);

    if (!outputId || item.id === outputId || !isFallbackTaskId(item.id)) {
      return item;
    }

    return {
      ...item,
      id: outputId
    };
  });
}

function extractPlainTextTaskCreateItems(
  toolCall: ToolCallDto,
  updatedAt: string
): ParsedTaskItem[] {
  const candidates = [
    toolCall.output,
    toolCall.input
  ].filter((value): value is string => readNonEmptyText(value) !== null);

  for (const candidate of candidates) {
    const items = parseTaskCreateText(candidate, updatedAt);

    if (items.length > 0) {
      return items;
    }
  }

  return [];
}

function parseTaskCreateText(text: string, updatedAt: string): ParsedTaskItem[] {
  return text
    .split(/\r?\n/)
    .map((line) => parseTaskCreateLine(line, updatedAt))
    .filter((item): item is ParsedTaskItem => item !== null);
}

function parseTaskCreateLine(line: string, updatedAt: string): ParsedTaskItem | null {
  const normalized = line.trim();

  if (!normalized) {
    return null;
  }

  const match =
    normalized.match(/^Task\s*#?(\d+)\s+created\s+successfully\s*:\s*(.+)$/i)
    ?? normalized.match(/^Created\s+task\s*#?(\d+)\s*:\s*(.+)$/i)
    ?? normalized.match(/^Task\s*#?(\d+)\s+created\s*:\s*(.+)$/i);

  if (!match) {
    return null;
  }

  const id = readNonEmptyText(match[1]);
  const title = readNonEmptyText(match[2]);

  if (!id || !title) {
    return null;
  }

  return {
    id,
    title,
    status: "pending",
    detail: null,
    updatedAt,
    hasExplicitTitle: true
  };
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
): ParsedTaskItem[] {
  const taskNodes = collectTaskNodes(payload);

  return taskNodes
    .map((node, index) => toTaskItem(node, {
      fallbackIdPrefix: "task",
      fallbackTitle: `Task ${index + 1}`,
      fallbackStatus: "pending",
      updatedAt
    }))
    .filter((item): item is ParsedTaskItem => item !== null);
}

function collectTaskNodes(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => collectTaskNodes(item));
  }

  if (!isRecord(payload)) {
    return [];
  }

  if (isTaskLikeRecord(payload) || isIncrementalTaskMutationPayload(payload)) {
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
  const directScalarId = readTextOrNumber(payload);

  if (directScalarId) {
    return [directScalarId];
  }

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
): ParsedTaskItem | null {
  if (!isRecord(payload)) {
    return null;
  }

  const explicitTitle =
    readNonEmptyText(payload.step)
    ?? readNonEmptyText(payload.title)
    ?? readNonEmptyText(payload.content)
    ?? readNonEmptyText(payload.task)
    ?? readNonEmptyText(payload.text)
    ?? readNonEmptyText(payload.name)
    ?? readNonEmptyText(payload.subject)
    ?? readNonEmptyText(payload.description);
  const title = explicitTitle ?? input.fallbackTitle;
  const id =
    readTaskId(payload)
    ?? buildStableFallbackTaskId(input.fallbackIdPrefix, title);
  const detail = resolveTaskDetail(payload, title);

  return {
    id,
    title,
    status: normalizeTaskStatus(payload.status, input.fallbackStatus),
    detail,
    updatedAt: input.updatedAt,
    hasExplicitTitle: explicitTitle !== null
  };
}

function upsertTaskRecord(
  taskMap: Map<string, MutableTaskRecord>,
  task: ParsedTaskItem
): void {
  const taskId = resolveExistingTaskId(taskMap, task.id);
  const normalizedTask = taskId === task.id ? task : { ...task, id: taskId };
  const existing = taskMap.get(taskId);

  if (!existing) {
    taskMap.set(taskId, { ...normalizedTask });
    return;
  }

  taskMap.set(taskId, {
    id: existing.id,
    title: normalizedTask.hasExplicitTitle ? normalizedTask.title : existing.title,
    status: normalizedTask.status,
    detail: normalizedTask.detail ?? existing.detail,
    updatedAt: normalizedTask.updatedAt,
    hasExplicitTitle: existing.hasExplicitTitle || normalizedTask.hasExplicitTitle
  });
}

function resolveExistingTaskId(
  taskMap: Map<string, MutableTaskRecord>,
  incomingId: string
): string {
  if (taskMap.has(incomingId)) {
    return incomingId;
  }

  const ordinal = parsePositiveInteger(incomingId);

  if (ordinal === null) {
    return incomingId;
  }

  const taskIds = Array.from(taskMap.keys());
  return taskIds[ordinal - 1] ?? incomingId;
}

function replaceTaskMap(
  taskMap: Map<string, MutableTaskRecord>,
  items: ParsedTaskItem[]
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
    readNonEmptyText(payload.priority),
    readNonEmptyText(payload.activeForm)
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
    readTextOrNumber(payload.id)
    ?? readTextOrNumber(payload.taskId)
    ?? readTextOrNumber(payload.task_id)
    ?? readTextOrNumber(payload.uuid)
    ?? readTextOrNumber(payload.key)
  );
}

function buildStableFallbackTaskId(prefix: string, title: string): string {
  return `${prefix}:${title.trim().toLowerCase()}`;
}

function isFallbackTaskId(value: string): boolean {
  return value.startsWith("task:") || value.startsWith("plan:");
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

function isIncrementalTaskMutationPayload(value: Record<string, unknown>): boolean {
  const taskId = readTaskId(value);

  if (!taskId) {
    return false;
  }

  return (
    readNonEmptyText(value.status) !== null
    || readNonEmptyText(value.subject) !== null
    || readNonEmptyText(value.activeForm) !== null
  );
}

function isTitlelessIncrementalTaskUpdate(
  normalizedToolName: string,
  items: ParsedTaskItem[]
): boolean {
  return normalizedToolName === "taskupdate" && items.every((item) => !item.hasExplicitTitle);
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_.-]+/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTextOrNumber(value: unknown): string | null {
  if (typeof value === "number") {
    return String(value);
  }
  return readNonEmptyText(value);
}

function parsePositiveInteger(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }

  return Number(value);
}

function toPublicTaskItem(item: MutableTaskRecord): ConversationTaskItem {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    detail: item.detail,
    updatedAt: item.updatedAt
  };
}

function readNonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
