import { readFileSync, statSync } from "node:fs";

import type { ProviderId } from "@codingns/session-sync-core";

export interface SessionActivityInspection {
  runningState: "idle" | "running";
  hasPendingTools: boolean;
  lastEventAt: string | null;
  completedAtCandidate: string | null;
}

const ACTIVE_WINDOW_MS = 20_000;
const ACTIVITY_CACHE_LIMIT = 20;
const activityCache = new Map<string, CachedActivityEntry>();

export function inspectSessionActivity(
  provider: ProviderId,
  rawStoreRef: string,
  now = Date.now()
): SessionActivityInspection {
  let stats: ReturnType<typeof statSync>;
  let records: Array<Record<string, unknown>>;

  try {
    stats = statSync(rawStoreRef);
  } catch {
    return {
      runningState: "idle",
      hasPendingTools: false,
      lastEventAt: null,
      completedAtCandidate: null
    };
  }

  const cached = activityCache.get(rawStoreRef);

  if (
    cached
    && cached.provider === provider
    && cached.mtimeMs === stats.mtimeMs
    && cached.size === stats.size
  ) {
    touchActivityCache(rawStoreRef, cached);
    return cached.inspection.hasPendingTools && !cached.inspection.completedAtCandidate
      ? {
          ...cached.inspection,
          runningState: now - cached.mtimeMs <= ACTIVE_WINDOW_MS ? "running" : "idle"
        }
      : cached.inspection;
  }

  records = readJsonlRecords(rawStoreRef);
  const inspection =
    provider === "claude-code"
      ? inspectClaudeActivity(records, stats.mtimeMs, now)
      : inspectCodexActivity(records, stats.mtimeMs, now);

  touchActivityCache(rawStoreRef, {
    provider,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    inspection
  });

  return inspection;
}

function inspectClaudeActivity(
  records: Array<Record<string, unknown>>,
  mtimeMs: number,
  now: number
): SessionActivityInspection {
  const pendingToolCalls = new Set<string>();
  let lastEventAt: string | null = null;
  let lastStopAt: string | null = null;
  let lastToolUseAt: string | null = null;

  for (const record of records) {
    const directType = readText(record.type);
    const recordTimestamp = normalizeTimestamp(record.timestamp);

    if (directType === "assistant") {
      const stopReason = readText((record.message as Record<string, unknown> | undefined)?.stop_reason);

      if (stopReason === "end_turn" || stopReason === "stop_sequence") {
        lastStopAt = maxTimestamp(lastStopAt, recordTimestamp);
      }
    }

    for (const envelope of collectClaudeEnvelopes(record)) {
      lastEventAt = maxTimestamp(lastEventAt, envelope.timestamp);

      const parts = Array.isArray(envelope.message.content) ? envelope.message.content : [];

      for (const part of parts) {
        const partType = readText(part.type);

        if (envelope.type === "assistant" && partType === "tool_use") {
          const callId = readText(part.id);

          if (callId) {
            pendingToolCalls.add(callId);
          }
          lastToolUseAt = maxTimestamp(lastToolUseAt, envelope.timestamp);
          continue;
        }

        if (envelope.type === "user" && partType === "tool_result") {
          const callId = readText(part.tool_use_id);

          if (callId) {
            pendingToolCalls.delete(callId);
          }
        }
      }
    }
  }

  const hasExplicitCompletion = isTimestampAtOrAfter(lastStopAt, lastToolUseAt);
  const hasPendingTools = pendingToolCalls.size > 0 && !hasExplicitCompletion;
  const runningState =
    hasPendingTools && now - mtimeMs <= ACTIVE_WINDOW_MS
      ? "running"
      : "idle";

  return {
    runningState,
    hasPendingTools,
    lastEventAt,
    completedAtCandidate: hasExplicitCompletion ? lastStopAt : hasPendingTools ? null : lastStopAt ?? lastEventAt
  };
}

function inspectCodexActivity(
  records: Array<Record<string, unknown>>,
  mtimeMs: number,
  now: number
): SessionActivityInspection {
  const pendingToolCalls = new Set<string>();
  let lastEventAt: string | null = null;
  let lastTaskCompleteAt: string | null = null;
  let lastToolCallAt: string | null = null;

  for (const record of records) {
    const recordType = readText(record.type);
    const recordTimestamp = normalizeTimestamp(record.timestamp);

    if (recordType === "event_msg") {
      const payload = asRecord(record.payload);
      const eventType = readText(payload.type);

      if (eventType.length > 0) {
        lastEventAt = maxTimestamp(lastEventAt, recordTimestamp);
      }

      if (eventType === "task_complete") {
        lastTaskCompleteAt = maxTimestamp(lastTaskCompleteAt, recordTimestamp);
      }

      continue;
    }

    if (recordType !== "response_item") {
      continue;
    }

    const payload = asRecord(record.payload);
    const payloadType = readText(payload.type);

    if (payloadType.length === 0) {
      continue;
    }

    lastEventAt = maxTimestamp(lastEventAt, recordTimestamp);

    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      const callId = readText(payload.call_id);

      if (callId) {
        pendingToolCalls.add(callId);
      }
      lastToolCallAt = maxTimestamp(lastToolCallAt, recordTimestamp);
      continue;
    }

    if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
      const callId = readText(payload.call_id);

      if (callId) {
        pendingToolCalls.delete(callId);
      }
    }
  }

  const hasExplicitCompletion = isTimestampAtOrAfter(lastTaskCompleteAt, lastToolCallAt);
  const hasPendingTools = pendingToolCalls.size > 0 && !hasExplicitCompletion;
  const runningState =
    hasPendingTools && now - mtimeMs <= ACTIVE_WINDOW_MS
      ? "running"
      : "idle";

  return {
    runningState,
    hasPendingTools,
    lastEventAt,
    completedAtCandidate:
      hasExplicitCompletion ? lastTaskCompleteAt : hasPendingTools ? null : lastTaskCompleteAt ?? lastEventAt
  };
}

function collectClaudeEnvelopes(record: Record<string, unknown>): ClaudeEnvelope[] {
  const envelopes: ClaudeEnvelope[] = [];
  const directType = readText(record.type);

  if (directType === "user" || directType === "assistant") {
    envelopes.push({
      type: directType,
      timestamp: normalizeTimestamp(record.timestamp),
      message: asRecord(record.message)
    });
  }

  if (directType === "progress") {
    const nested = asRecord(asRecord(record.data).message);
    const nestedType = readText(nested.type);

    if (nestedType === "user" || nestedType === "assistant") {
      envelopes.push({
        type: nestedType,
        timestamp: normalizeTimestamp(nested.timestamp ?? record.timestamp),
        message: asRecord(nested.message)
      });
    }
  }

  return envelopes;
}

function readJsonlRecords(filePath: string): Array<Record<string, unknown>> {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);

        if (!parsed || typeof parsed !== "object") {
          return [];
        }

        return [parsed as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function maxTimestamp(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left.localeCompare(right) >= 0 ? left : right;
}

function isTimestampAtOrAfter(left: string | null, right: string | null): boolean {
  if (!left) {
    return false;
  }

  if (!right) {
    return true;
  }

  return left.localeCompare(right) >= 0;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

interface ClaudeEnvelope {
  type: "user" | "assistant";
  timestamp: string | null;
  message: Record<string, unknown> & {
    content?: Array<Record<string, unknown>>;
  };
}

interface CachedActivityEntry {
  provider: ProviderId;
  mtimeMs: number;
  size: number;
  inspection: SessionActivityInspection;
}

function touchActivityCache(filePath: string, entry: CachedActivityEntry): void {
  activityCache.delete(filePath);
  activityCache.set(filePath, entry);

  while (activityCache.size > ACTIVITY_CACHE_LIMIT) {
    const oldestKey = activityCache.keys().next().value;

    if (!oldestKey) {
      break;
    }

    activityCache.delete(oldestKey);
  }
}
