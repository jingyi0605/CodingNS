import type { MessageKind, NormalizedMessage, NormalizedToolCall } from "./types.js";
import { ensureText, extractTextBlocks } from "./providers/utils.js";
import { buildApplyPatchFromStructuredFileTool } from "./patch-builder.js";

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
      ["message", "payload", "role"],
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

  const rawType = readKimiMessageType(record);

  if (rawType === "user" || rawType === "assistant" || rawType === "tool" || rawType === "system") {
    return rawType;
  }

  return "assistant";
}

export function extractKimiMessageBlocks(record: Record<string, unknown>): unknown[] {
  const directCandidates = [
    record.content,
    record.tool_calls,
    readKimiPath(record, ["message", "content"]),
    readKimiPath(record, ["message", "payload"]),
    readKimiPath(record, ["message", "payload", "content"]),
    readKimiPath(record, ["message", "payload", "text"]),
    readKimiPath(record, ["message", "payload", "tool_calls"]),
    readKimiPath(record, ["payload", "content"]),
    readKimiPath(record, ["payload"]),
    readKimiPath(record, ["payload", "text"]),
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
      ["message", "payload", "role"],
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
    || rawType === "turnbegin"
    || rawType === "stepend"
    || rawType === "stepbegin"
    || rawType === "stepinterrupted"
    || rawType === "turnend"
    || (rawType === "contentpart" && !hasKimiDisplayPayload(record))
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
    const content = sanitizeKimiDisplayText(extractKimiTextContent(record));

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
    rawType.includes("toolcall") ||
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
        ["payload", "id"],
        ["message", "payload", "id"],
        ["tool_call", "id"],
        ["function_call", "id"],
        ["tool_calls", "0", "id"]
      ]) ??
      "kimi-tool-call";
    const name =
      readKimiFirstNonEmptyString(record, [
        ["name"],
        ["tool", "name"],
        ["function", "name"],
        ["payload", "function", "name"],
        ["message", "payload", "function", "name"],
        ["tool_call", "name"],
        ["function_call", "name"],
        ["tool_calls", "0", "function", "name"]
      ]) ??
      "unknown_tool";
    const patchText = buildKimiApplyPatchFromToolRecord(record);
    const input = extractKimiFallbackMessageText(
      readKimiPath(record, ["arguments"]) ??
        readKimiPath(record, ["input"]) ??
        readKimiPath(record, ["params"]) ??
        readKimiPath(record, ["payload", "function", "arguments"]) ??
        readKimiPath(record, ["message", "payload", "function", "arguments"]) ??
        readKimiPath(record, ["tool_call", "arguments"]) ??
        readKimiPath(record, ["tool_call", "input"]) ??
        readKimiPath(record, ["function_call", "arguments"]) ??
        readKimiPath(record, ["function_call", "input"]) ??
        readKimiPath(record, ["tool_calls", "0", "function", "arguments"])
    );
    const output = extractKimiFallbackMessageText(
      readKimiPath(record, ["output"]) ??
        readKimiPath(record, ["result"]) ??
        readKimiPath(record, ["payload", "output"]) ??
        readKimiPath(record, ["message", "payload", "output"]) ??
        readKimiPath(record, ["tool_call", "output"]) ??
        readKimiPath(record, ["function_call", "output"])
    );

    return {
      role: patchText ? "tool" : "assistant",
      kind: "tool_call",
      content: patchText || output || input || name,
      toolCall: {
        callId,
        name: patchText ? "apply_patch" : name,
        input: patchText || input,
        output: output || null,
        error: null,
        status: output ? "completed" : "running"
      }
    };
  }

  if (
    rawType.includes("tool_result") ||
    rawType.includes("toolresult") ||
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
        ["tool_call_id"],
        ["payload", "tool_call_id"],
        ["message", "payload", "tool_call_id"],
        ["tool_result", "call_id"],
        ["function_result", "call_id"]
      ]) ??
      "kimi-tool-call";
    const output = sanitizeKimiToolResultText(extractKimiFallbackMessageText(
      readKimiPath(record, ["output"]) ??
        readKimiPath(record, ["result"]) ??
        readKimiPath(record, ["content"]) ??
        readKimiPath(record, ["payload", "return_value", "output"]) ??
        readKimiPath(record, ["message", "payload", "return_value", "output"]) ??
        readKimiPath(record, ["payload", "display"]) ??
        readKimiPath(record, ["message", "payload", "display"]) ??
        readKimiPath(record, ["tool_result", "output"]) ??
        readKimiPath(record, ["function_result", "output"])
    ));
    const isError = readKimiFirstPresentValue(record, [
      ["payload", "return_value", "is_error"],
      ["message", "payload", "return_value", "is_error"]
    ]) === true;
    const messageText =
      readKimiFirstNonEmptyString(record, [
        ["payload", "return_value", "message"],
        ["message", "payload", "return_value", "message"],
        ["error"],
        ["failure"],
        ["tool_result", "error"],
        ["function_result", "error"]
      ]) ?? null;
    const error =
      isError
        ? messageText ?? "KIMI_TOOL_RESULT_FAILED"
        : null;

    return {
      role: "tool",
      kind: "tool_result",
      content: output || messageText || error || "",
      toolCall: {
        callId,
        name:
          readKimiFirstNonEmptyString(record, [
            ["name"],
            ["tool", "name"],
            ["payload", "function", "name"],
            ["message", "payload", "function", "name"],
            ["tool_result", "name"],
            ["function_result", "name"]
          ]) ?? "tool_result",
        input: "",
        output: output || null,
        error,
        status: isError || error ? "failed" : "completed"
      }
    };
  }

  const content = sanitizeKimiDisplayText(extractKimiTextContent(record));

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
      ["message", "type"],
      ["message", "payload", "type"],
      ["payload", "type"],
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
    rawType.includes("toolcall") ||
    rawType.includes("toolresult") ||
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

  return sanitizeKimiDisplayText(extractKimiTextContent(value) || ensureText(value));
}

function hasKimiDisplayPayload(record: Record<string, unknown>): boolean {
  return extractKimiTextContent(record).trim().length > 0;
}

function extractKimiTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return extractTextBlocks(value);
  }

  const record = value as Record<string, unknown>;
  const directValue = readKimiFirstPresentValue(record, [
    ["text"],
    ["content"],
    ["message", "payload"],
    ["message", "payload", "text"],
    ["message", "payload", "content"],
    ["payload"],
    ["payload", "text"],
    ["payload", "content"],
    ["delta"],
    ["delta", "text"],
    ["delta", "content"]
  ]);

  if (directValue !== null) {
    const extracted = extractTextBlocks(directValue);

    if (extracted.trim().length > 0) {
      return extracted;
    }
  }

  return extractTextBlocks(value);
}

function sanitizeKimiToolResultText(value: string): string {
  const stripped = value.replace(/<system>[\s\S]*?<\/system>\s*/gi, "").trim();
  return stripped || value.trim();
}

function buildKimiApplyPatchFromToolRecord(record: Record<string, unknown>): string | null {
  const candidates = [
    toKimiRecord(readKimiPath(record, ["payload", "function", "arguments"])),
    toKimiRecord(readKimiPath(record, ["message", "payload", "function", "arguments"])),
    toKimiRecord(readKimiPath(record, ["tool_calls", "0", "function", "arguments"])),
    toKimiRecord(readKimiPath(record, ["arguments"])),
    toKimiRecord(readKimiPath(record, ["input"])),
    toKimiRecord(readKimiPath(record, ["params"]))
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const patchText = buildApplyPatchFromStructuredFileTool(candidate);

    if (patchText) {
      return patchText;
    }
  }

  return null;
}

function toKimiRecord(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
    typeof readKimiPath(record, ["tool_calls"]) !== "undefined" ||
    typeof readKimiPath(record, ["arguments"]) !== "undefined" ||
    typeof readKimiPath(record, ["input"]) !== "undefined" ||
    typeof readKimiPath(record, ["payload", "function"]) !== "undefined" ||
    typeof readKimiPath(record, ["message", "payload", "function"]) !== "undefined" ||
    typeof readKimiPath(record, ["tool_call"]) !== "undefined" ||
    typeof readKimiPath(record, ["function_call"]) !== "undefined"
  );
}

function hasKimiToolResultShape(record: Record<string, unknown>): boolean {
  return (
    typeof readKimiPath(record, ["tool_call_id"]) !== "undefined" ||
    typeof readKimiPath(record, ["output"]) !== "undefined" ||
    typeof readKimiPath(record, ["result"]) !== "undefined" ||
    typeof readKimiPath(record, ["payload", "return_value"]) !== "undefined" ||
    typeof readKimiPath(record, ["message", "payload", "return_value"]) !== "undefined" ||
    typeof readKimiPath(record, ["tool_result"]) !== "undefined" ||
    typeof readKimiPath(record, ["function_result"]) !== "undefined"
  );
}

export function sanitizeKimiPlainTextLine(line: string): string {
  const normalized = line.trim().toLowerCase();

  if (KIMI_CONTROL_TEXT_LINES.has(normalized) || KIMI_STATUS_TOKEN_PATTERN.test(line.trim())) {
    return "";
  }

  return line.trim();
}

export function extractKimiDisplayTextSegments(value: string): string[] {
  const stripped = stripKimiSystemReminderBlocks(value);
  const lines = stripped.replace(/\r\n/g, "\n").split("\n");
  const transcriptSegments = extractKimiTranscriptSegments(lines);

  if (transcriptSegments !== null) {
    return transcriptSegments;
  }

  const fallback = sanitizeKimiDisplayTextLines(lines);
  return fallback ? [fallback] : [];
}

function sanitizeKimiDisplayText(value: string): string {
  return extractKimiDisplayTextSegments(value)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripKimiSystemReminderBlocks(value: string): string {
  return value.replace(/<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/gi, "");
}

function extractKimiTranscriptSegments(lines: string[]): string[] | null {
  const hasContentPart = lines.some((line) => line.trim().toLowerCase() === "contentpart");

  if (!hasContentPart) {
    return null;
  }

  const segments: string[] = [];
  const currentLines: string[] = [];
  let capturing = false;
  let skipNextStatusToken = false;

  const flushCurrentSegment = (): void => {
    const content = normalizeKimiTranscriptSegment(currentLines.join("\n"));
    currentLines.length = 0;

    if (!content) {
      return;
    }

    segments.push(content);
  };

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

    if (normalized === "contentpart") {
      flushCurrentSegment();
      capturing = true;
      continue;
    }

    if (KIMI_CONTROL_TEXT_LINES.has(normalized)) {
      if (normalized === "statusupdate") {
        skipNextStatusToken = true;
      }

      flushCurrentSegment();
      capturing = false;
      continue;
    }

    if (KIMI_STATUS_TOKEN_PATTERN.test(trimmed)) {
      flushCurrentSegment();
      capturing = false;
      continue;
    }

    if (!capturing) {
      continue;
    }

    if (!trimmed) {
      if (currentLines.length > 0 && currentLines.at(-1) !== "") {
        currentLines.push("");
      }
      continue;
    }

    currentLines.push(line.trimEnd());
  }

  flushCurrentSegment();
  return collapseKimiTranscriptSegments(segments);
}

function collapseKimiTranscriptSegments(segments: string[]): string[] {
  const collapsed: string[] = [];

  for (const segment of segments) {
    const normalizedSegment = normalizeKimiTranscriptSegment(segment);

    if (!normalizedSegment) {
      continue;
    }

    const previous = collapsed.at(-1);

    if (!previous) {
      collapsed.push(normalizedSegment);
      continue;
    }

    const comparablePrevious = normalizeComparableKimiTranscriptText(previous);
    const comparableCurrent = normalizeComparableKimiTranscriptText(normalizedSegment);

    if (!comparableCurrent || comparableCurrent === comparablePrevious) {
      continue;
    }

    if (comparableCurrent.includes(comparablePrevious)) {
      collapsed[collapsed.length - 1] = normalizedSegment;
      continue;
    }

    if (comparablePrevious.includes(comparableCurrent)) {
      continue;
    }

    collapsed.push(normalizedSegment);
  }

  return collapsed;
}

function normalizeComparableKimiTranscriptText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeKimiTranscriptSegment(value: string): string {
  return value
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeKimiDisplayTextLines(lines: string[]): string {
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
