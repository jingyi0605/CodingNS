import type { MessageKind, NormalizedMessage, NormalizedToolCall } from "./types.js";
import { ensureText, extractTextBlocks } from "./providers/utils.js";

export interface KimiNormalizedMessagePart {
  role: NormalizedMessage["role"];
  kind: MessageKind;
  content: string;
  toolCall: NormalizedToolCall | null;
  partIndex: number | null;
}

const KIMI_CONTROL_TEXT_LINES = new Set([
  "turnbegin",
  "turnend",
  "stepbegin",
  "stepend",
  "stepinterrupted",
  "contentpart",
  "statusupdate",
  "metadata",
  "_usage",
  "_checkpoint"
]);

const KIMI_STATUS_TOKEN_PATTERN = /^chatcmpl[-_a-z0-9]+$/i;

export function buildKimiMessageRawRef(
  sessionId: string,
  source: "context" | "wire",
  lineNumber: number,
  partIndex?: number
): string {
  const suffix = partIndex === undefined ? "" : `&part=${partIndex}`;
  return `kimi://session/${encodeURIComponent(sessionId)}/${source}#line=${lineNumber}${suffix}`;
}

export function readKimiPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;

  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

export function readKimiFirstNonEmptyString(
  record: Record<string, unknown> | null,
  paths: string[][]
): string | null {
  if (!record) {
    return null;
  }

  for (const path of paths) {
    const value = readKimiPath(record, path);

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function readKimiFirstPresentValue(
  record: Record<string, unknown> | null,
  paths: string[][]
): unknown {
  if (!record) {
    return null;
  }

  for (const path of paths) {
    const value = readKimiPath(record, path);

    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === "string" && !value.trim()) {
      continue;
    }

    return value;
  }

  return null;
}

export function resolveKimiMessageRole(
  record: Record<string, unknown>
): NormalizedMessage["role"] {
  const rawRole =
    readKimiFirstNonEmptyString(record, [
      ["role"],
      ["message", "role"],
      ["payload", "role"],
      ["event", "role"],
      ["author", "role"],
      ["speaker"]
    ]) ?? "";
  const normalized = rawRole.trim().toLowerCase();

  if (normalized === "user" || normalized === "human") {
    return "user";
  }

  if (normalized === "assistant" || normalized === "ai" || normalized === "model") {
    return "assistant";
  }

  if (normalized === "tool") {
    return "tool";
  }

  if (normalized === "system" || normalized.includes("system")) {
    return "system";
  }

  const rawType = ensureText(record.type).trim().toLowerCase();

  if (rawType === "user" || rawType === "assistant" || rawType === "tool" || rawType === "system") {
    return rawType;
  }

  return "assistant";
}

export function extractKimiMessageBlocks(record: Record<string, unknown>): unknown[] {
  const directCandidates = [
    record.content,
    readKimiPath(record, ["message", "content"]),
    readKimiPath(record, ["payload", "content"]),
    readKimiPath(record, ["event", "content"]),
    readKimiPath(record, ["data", "content"]),
    record.parts,
    readKimiPath(record, ["delta", "content"]),
    record.tool,
    record.toolCall,
    record.tool_call,
    record.function_call,
    record.toolResult,
    record.tool_result,
    record.function_result
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }

    if (candidate && typeof candidate === "object") {
      return [candidate];
    }
  }

  return [];
}

export function looksLikeKimiMessagePayload(
  payload: Record<string, unknown>,
  wireType = ""
): boolean {
  return (
    wireType.includes("message") ||
    wireType.includes("text") ||
    wireType.includes("delta") ||
    wireType.includes("think") ||
    wireType.includes("tool") ||
    wireType.includes("function") ||
    extractKimiMessageBlocks(payload).length > 0 ||
    looksLikeSelfContainedKimiBlock(payload) ||
    readKimiPath(payload, ["text"]) !== undefined ||
    readKimiPath(payload, ["message"]) !== undefined
  );
}

export function normalizeKimiMessageRecord(
  record: Record<string, unknown>
): KimiNormalizedMessagePart[] {
  if (isKimiInternalRecord(record)) {
    return [];
  }

  const fallbackRole = resolveKimiMessageRole(record);
  const blocks = extractKimiMessageBlocks(record);

  if (blocks.length > 0) {
    const normalizedBlocks = blocks
      .map((block, blockIndex) => {
        const normalized = normalizeKimiMessageBlock(block, fallbackRole);

        if (!normalized) {
          return null;
        }

        return {
          ...normalized,
          partIndex: blockIndex
        };
      })
      .filter(
        (block): block is Omit<KimiNormalizedMessagePart, "partIndex"> & { partIndex: number } =>
          block !== null
      );

    if (normalizedBlocks.length > 0) {
      return normalizedBlocks;
    }
  }

  if (looksLikeSelfContainedKimiBlock(record)) {
    const normalized = normalizeKimiMessageBlock(record, fallbackRole);

    if (normalized) {
      return [
        {
          ...normalized,
          partIndex: 0
        }
      ];
    }
  }

  const fallbackText = extractKimiFallbackMessageText(record).trim();

  if (!fallbackText) {
    return [];
  }

  return [
    {
      role: fallbackRole,
      kind: inferKimiFallbackMessageKind(record),
      content: fallbackText,
      toolCall: null,
      partIndex: null
    }
  ];
}

function isKimiInternalRecord(record: Record<string, unknown>): boolean {
  const rawRole = (
    readKimiFirstNonEmptyString(record, [
      ["role"],
      ["message", "role"],
      ["payload", "role"]
    ]) ?? ""
  ).trim().toLowerCase();

  if (rawRole.startsWith("_")) {
    return true;
  }

  const rawType = readKimiMessageType(record);
  return (
    rawType === "metadata"
    || rawType === "statusupdate"
    || rawType === "contentpart"
    || rawType === "turnbegin"
    || rawType === "stepend"
    || rawType === "stepbegin"
    || rawType === "stepinterrupted"
    || rawType === "turnend"
  );
}

function normalizeKimiMessageBlock(
  block: unknown,
  fallbackRole: NormalizedMessage["role"]
): Omit<KimiNormalizedMessagePart, "partIndex"> | null {
  if (typeof block === "string") {
    const content = sanitizeKimiDisplayText(block);

    if (!content) {
      return null;
    }

    return {
      role: fallbackRole,
      kind: "text",
      content,
      toolCall: null
    };
  }

  if (!block || typeof block !== "object") {
    return null;
  }

  const record = block as Record<string, unknown>;
  const rawType = readKimiMessageType(record);

  if (rawType.includes("think") || rawType.includes("reason")) {
    const content = sanitizeKimiDisplayText(extractTextBlocks(record));

    if (!content) {
      return null;
    }

    return {
      role: "assistant",
      kind: "thinking",
      content,
      toolCall: null
    };
  }

  if (
    rawType.includes("tool_call") ||
    rawType.includes("tool-use") ||
    rawType.includes("tool_use") ||
    rawType.includes("function_call") ||
    hasKimiToolCallShape(record)
  ) {
    const callId =
      readKimiFirstNonEmptyString(record, [
        ["id"],
        ["callId"],
        ["call_id"],
        ["tool_use_id"],
        ["tool_call", "id"],
        ["function_call", "id"]
      ]) ??
      "kimi-tool-call";
    const name =
      readKimiFirstNonEmptyString(record, [
        ["name"],
        ["tool", "name"],
        ["function", "name"],
        ["tool_call", "name"],
        ["function_call", "name"]
      ]) ??
      "unknown_tool";
    const input = extractKimiFallbackMessageText(
      readKimiPath(record, ["arguments"]) ??
        readKimiPath(record, ["input"]) ??
        readKimiPath(record, ["params"]) ??
        readKimiPath(record, ["tool_call", "arguments"]) ??
        readKimiPath(record, ["tool_call", "input"]) ??
        readKimiPath(record, ["function_call", "arguments"]) ??
        readKimiPath(record, ["function_call", "input"])
    );
    const output = extractKimiFallbackMessageText(
      readKimiPath(record, ["output"]) ??
        readKimiPath(record, ["result"]) ??
        readKimiPath(record, ["tool_call", "output"]) ??
        readKimiPath(record, ["function_call", "output"])
    );

    return {
      role: "assistant",
      kind: "tool_call",
      content: output || input || name,
      toolCall: {
        callId,
        name,
        input,
        output: output || null,
        error: null,
        status: output ? "completed" : "running"
      }
    };
  }

  if (
    rawType.includes("tool_result") ||
    rawType.includes("tool-output") ||
    rawType.includes("tool_output") ||
    rawType.includes("function_result") ||
    hasKimiToolResultShape(record)
  ) {
    const callId =
      readKimiFirstNonEmptyString(record, [
        ["tool_use_id"],
        ["callId"],
        ["call_id"],
        ["id"],
        ["tool_result", "call_id"],
        ["function_result", "call_id"]
      ]) ??
      "kimi-tool-call";
    const output = extractKimiFallbackMessageText(
      readKimiPath(record, ["output"]) ??
        readKimiPath(record, ["result"]) ??
        readKimiPath(record, ["content"]) ??
        readKimiPath(record, ["tool_result", "output"]) ??
        readKimiPath(record, ["function_result", "output"])
    );
    const error =
      readKimiFirstNonEmptyString(record, [
        ["error"],
        ["failure"],
        ["tool_result", "error"],
        ["function_result", "error"]
      ]) ?? null;

    return {
      role: "tool",
      kind: "tool_result",
      content: output || error || "",
      toolCall: {
        callId,
        name:
          readKimiFirstNonEmptyString(record, [
            ["name"],
            ["tool", "name"],
            ["tool_result", "name"],
            ["function_result", "name"]
          ]) ?? "tool_result",
        input: "",
        output: output || null,
        error,
        status: error ? "failed" : "completed"
      }
    };
  }

  const content = sanitizeKimiDisplayText(extractTextBlocks(record));

  if (!content) {
    return null;
  }

  return {
    role: fallbackRole,
    kind: "text",
    content,
    toolCall: null
  };
}

function readKimiMessageType(record: Record<string, unknown>): string {
  return (
    readKimiFirstNonEmptyString(record, [
      ["type"],
      ["kind"],
      ["eventType"],
      ["name"],
      ["tool_call", "type"],
      ["tool_result", "type"],
      ["function_call", "type"],
      ["function_result", "type"]
    ]) ?? ""
  )
    .trim()
    .toLowerCase();
}

function looksLikeSelfContainedKimiBlock(record: Record<string, unknown>): boolean {
  const rawType = readKimiMessageType(record);

  if (
    rawType.includes("think") ||
    rawType.includes("reason") ||
    rawType.includes("tool") ||
    rawType.includes("function")
  ) {
    return true;
  }

  return hasKimiToolCallShape(record) || hasKimiToolResultShape(record);
}

function extractKimiFallbackMessageText(value: unknown): string {
  if (typeof value === "string") {
    return sanitizeKimiDisplayText(value);
  }

  if (value === undefined || value === null) {
    return "";
  }

  return sanitizeKimiDisplayText(extractTextBlocks(value) || ensureText(value));
}

function inferKimiFallbackMessageKind(record: Record<string, unknown>): MessageKind {
  const rawType = ensureText(record.type).toLowerCase();

  if (rawType.includes("think") || rawType.includes("reason")) {
    return "thinking";
  }

  return "text";
}

function hasKimiToolCallShape(record: Record<string, unknown>): boolean {
  return (
    typeof readKimiPath(record, ["arguments"]) !== "undefined" ||
    typeof readKimiPath(record, ["input"]) !== "undefined" ||
    typeof readKimiPath(record, ["tool_call"]) !== "undefined" ||
    typeof readKimiPath(record, ["function_call"]) !== "undefined"
  );
}

function hasKimiToolResultShape(record: Record<string, unknown>): boolean {
  return (
    typeof readKimiPath(record, ["output"]) !== "undefined" ||
    typeof readKimiPath(record, ["result"]) !== "undefined" ||
    typeof readKimiPath(record, ["tool_result"]) !== "undefined" ||
    typeof readKimiPath(record, ["function_result"]) !== "undefined"
  );
}

function sanitizeKimiDisplayText(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const keptLines: string[] = [];
  let skipNextStatusToken = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const normalized = trimmed.toLowerCase();

    if (skipNextStatusToken) {
      if (!trimmed) {
        continue;
      }

      if (KIMI_STATUS_TOKEN_PATTERN.test(trimmed)) {
        skipNextStatusToken = false;
        continue;
      }

      skipNextStatusToken = false;
    }

    if (KIMI_CONTROL_TEXT_LINES.has(normalized)) {
      if (normalized === "statusupdate") {
        skipNextStatusToken = true;
      }

      continue;
    }

    keptLines.push(line);
  }

  return keptLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
