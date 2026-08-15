import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import type {
  HistoryDirection,
  HistoryPage,
  NormalizedMessage,
  ProviderId
} from "../types.js";

export interface RawJsonLine {
  lineNumber: number;
  partIndex: number;
  raw: string;
  data: Record<string, unknown>;
}

export interface JsonLinesReadResult {
  records: RawJsonLine[];
  lineCount: number;
  endsWithNewline: boolean;
}

export function normalizeWorkspacePath(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const normalizedSeparators = trimmed.replaceAll("\\", "/");
  const withoutTrailingSeparators =
    normalizedSeparators.length > 1
      ? normalizedSeparators.replace(/\/+$/, "")
      : normalizedSeparators;

  return isCaseInsensitiveWorkspacePath(withoutTrailingSeparators)
    ? withoutTrailingSeparators.toLowerCase()
    : withoutTrailingSeparators;
}

function isCaseInsensitiveWorkspacePath(value: string): boolean {
  return /^[a-z]:(?:\/|$)/i.test(value) || value.startsWith("//");
}

export function ensureDirectory(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

export function walkJsonlFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const results: string[] = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

export function readJsonLines(filePath: string): RawJsonLine[] {
  const content = readFileSync(filePath, "utf8");
  return parseJsonLines(filePath, content.split(/\r?\n/));
}

/**
 * 读取完整 JSONL 时同时保留续读所需的物理行信息。
 *
 * 这只用于首次建立或异常重建缓存；普通追加路径不会调用它。
 */
export function readJsonLinesWithMetadata(filePath: string): JsonLinesReadResult {
  const content = readFileSync(filePath, "utf8");
  const endsWithNewline = content.endsWith("\n");
  const lines = content.split(/\r?\n/);
  const lineCount =
    content.length === 0
      ? 0
      : lines.length - (endsWithNewline ? 1 : 0);

  return {
    records: parseJsonLines(filePath, lines),
    lineCount,
    endsWithNewline
  };
}

/**
 * 解析已经按行边界切好的增量 JSONL 文本。
 *
 * firstLineNumber 必须由调用方维护，保证 rawRef 和稳定 messageId 不会因为
 * 增量读取而漂移。
 */
export function parseJsonLinesFromText(
  filePath: string,
  content: string,
  firstLineNumber: number
): RawJsonLine[] {
  return parseJsonLines(filePath, content.split(/\r?\n/), firstLineNumber);
}

export function readFirstNonEmptyLine(filePath: string, maxBytes = 256 * 1024): string | null {
  const stats = statSync(filePath);

  if (stats.size <= 0 || maxBytes <= 0) {
    return null;
  }

  const readLimit = Math.min(stats.size, Math.max(1, Math.trunc(maxBytes)));
  const fd = openSync(filePath, "r");

  try {
    let bytesToRead = Math.min(readLimit, 8 * 1024);

    while (bytesToRead > 0) {
      const buffer = Buffer.alloc(bytesToRead);
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, 0);

      if (bytesRead <= 0) {
        return null;
      }

      let content = buffer.subarray(0, bytesRead);
      const newlineIndex = content.indexOf(0x0a);

      if (newlineIndex >= 0) {
        content = content.subarray(0, newlineIndex);
      } else if (bytesToRead < readLimit) {
        bytesToRead = Math.min(readLimit, bytesToRead * 2);
        continue;
      }

      const firstLine = content.toString("utf8").replace(/\r$/, "").trim();
      return firstLine.length > 0 ? firstLine : null;
    }
  } finally {
    closeSync(fd);
  }

  return null;
}

export function readTrailingJsonLines(filePath: string, maxBytes: number): RawJsonLine[] {
  const stats = statSync(filePath);

  if (stats.size <= 0 || maxBytes <= 0) {
    return [];
  }

  const bytesToRead = Math.min(Math.max(1, Math.trunc(maxBytes)), stats.size);
  const startOffset = stats.size - bytesToRead;
  const fd = openSync(filePath, "r");

  try {
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = readSync(fd, buffer, 0, bytesToRead, startOffset);

    if (bytesRead <= 0) {
      return [];
    }

    let content = buffer.subarray(0, bytesRead);
    let alignedStartOffset = startOffset;

    if (startOffset > 0) {
      const newlineIndex = content.indexOf(0x0a);

      if (newlineIndex < 0) {
        return [];
      }

      alignedStartOffset += newlineIndex + 1;
      content = content.subarray(newlineIndex + 1);
    }

    if (content.length === 0) {
      return [];
    }

    const firstLineNumber = countLinesBeforeOffset(fd, alignedStartOffset) + 1;
    return parseJsonLines(filePath, content.toString("utf8").split(/\r?\n/), firstLineNumber);
  } finally {
    closeSync(fd);
  }
}

const warnedInvalidJsonLineKeys = new Set<string>();
const MAX_INVALID_JSON_WARNINGS = 256;

function parseJsonLines(
  filePath: string,
  lines: string[],
  firstLineNumber = 1
): RawJsonLine[] {
  return lines.flatMap((line, index) => parseJsonLine(filePath, line, firstLineNumber + index));
}

function parseJsonLine(
  filePath: string,
  rawLine: string,
  lineNumber: number
): RawJsonLine[] {
  const trimmed = rawLine.trim();

  if (trimmed.length === 0) {
    return [];
  }

  const directRecord = parseJsonRecord(trimmed);

  if (directRecord) {
    return [{
      lineNumber,
      partIndex: 0,
      raw: trimmed,
      data: directRecord
    }];
  }

  const splitRecords = splitConcatenatedJsonObjects(trimmed);

  if (splitRecords.length > 1) {
    const parsedRecords = splitRecords.flatMap((segment, partIndex) => {
      const parsed = parseJsonRecord(segment);

      if (!parsed) {
        return [];
      }

      return [{
        lineNumber,
        partIndex,
        raw: segment,
        data: parsed
      }];
    });

    if (parsedRecords.length === splitRecords.length) {
      return parsedRecords;
    }
  }

  warnInvalidJsonLine(filePath, lineNumber, trimmed);
  return [];
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function splitConcatenatedJsonObjects(raw: string): string[] {
  if (!raw.startsWith("{")) {
    return [];
  }

  const segments: string[] = [];
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        startIndex = index;
      }

      depth += 1;
      continue;
    }

    if (char !== "}") {
      continue;
    }

    depth -= 1;

    if (depth === 0 && startIndex >= 0) {
      segments.push(raw.slice(startIndex, index + 1));
      startIndex = -1;
    }
  }

  if (depth !== 0 || inString || segments.length === 0) {
    return [];
  }

  return segments.join("") === raw ? segments : [];
}

function warnInvalidJsonLine(filePath: string, lineNumber: number, raw: string): void {
  const warningKey = `${filePath}:${lineNumber}:${createHash("sha1").update(raw).digest("hex")}`;

  if (warnedInvalidJsonLineKeys.has(warningKey)) {
    return;
  }

  warnedInvalidJsonLineKeys.add(warningKey);

  if (warnedInvalidJsonLineKeys.size > MAX_INVALID_JSON_WARNINGS) {
    const oldestKey = warnedInvalidJsonLineKeys.keys().next().value;

    if (oldestKey) {
      warnedInvalidJsonLineKeys.delete(oldestKey);
    }
  }

  console.warn(
    `[session-sync-core] 忽略损坏的 JSONL 记录: ${filePath}:${String(lineNumber)}`
  );
}

function countLinesBeforeOffset(fd: number, offset: number): number {
  if (offset <= 0) {
    return 0;
  }

  const buffer = Buffer.alloc(64 * 1024);
  let count = 0;
  let position = 0;

  while (position < offset) {
    const length = Math.min(buffer.length, offset - position);
    const bytesRead = readSync(fd, buffer, 0, length, position);

    if (bytesRead <= 0) {
      break;
    }

    for (let index = 0; index < bytesRead; index += 1) {
      if (buffer[index] === 0x0a) {
        count += 1;
      }
    }

    position += bytesRead;
  }

  return count;
}

export function encodeCursor(index: number): string {
  return Buffer.from(JSON.stringify({ index }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null): number {
  if (!cursor) {
    return 0;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      index?: number;
    };
    const index = typeof parsed.index === "number" ? parsed.index : -1;

    if (index < 0) {
      throw new Error("CURSOR_INVALID");
    }

    return index;
  } catch {
    throw new Error("CURSOR_INVALID");
  }
}

export function sliceHistory(
  messages: NormalizedMessage[],
  cursor: string | null,
  limit: number,
  direction: HistoryDirection = "forward"
): HistoryPage {
  const safeLimit = Math.max(1, Math.min(limit, 100));

  if (direction === "backward") {
    const end = cursor ? decodeCursor(cursor) : messages.length;
    const boundedEnd = Math.max(0, Math.min(end, messages.length));
    const start = Math.max(0, boundedEnd - safeLimit);
    const page = messages.slice(start, boundedEnd);

    return {
      messages: page,
      cursor: encodeCursor(boundedEnd),
      nextCursor: start > 0 ? encodeCursor(start) : null,
      total: messages.length
    };
  }

  const start = decodeCursor(cursor);
  const page = messages.slice(start, start + safeLimit);
  const nextIndex = start + page.length;

  return {
    messages: page,
    cursor: encodeCursor(nextIndex),
    nextCursor: nextIndex < messages.length ? encodeCursor(nextIndex) : null,
    total: messages.length
  };
}

export function createRawRef(
  provider: ProviderId,
  filePath: string,
  lineNumber: number,
  partIndex?: number
): string {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const suffix = partIndex === undefined ? "" : `&part=${partIndex}`;
  return `${provider}://${normalizedPath}#line=${lineNumber}${suffix}`;
}

export function messageIdFromStableKey(stableKey: string): string {
  return createHash("sha1").update(stableKey).digest("hex");
}

export function messageIdFromRawRef(rawRef: string): string {
  return messageIdFromStableKey(rawRef);
}

export function ensureText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  return JSON.stringify(value);
}

export function stringifyStructuredValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return ensureText(value);
  }
}

export function extractTextBlocks(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "";
    }

    const combined = value
      .map((item) => extractTextBlocks(item).trim())
      .filter((item) => item.length > 0)
      .join("\n");

    if (combined.length > 0) {
      return combined;
    }

    return stringifyStructuredValue(value);
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    for (const key of ["text", "thinking", "output", "content", "message"]) {
      const text = extractTextBlocks(record[key]).trim();

      if (text.length > 0) {
        return text;
      }
    }

    return stringifyStructuredValue(value);
  }

  return ensureText(value);
}

export function safeDate(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return fallback;
    }

    const numericValue = Number(trimmed);

    if (Number.isFinite(numericValue) && /^[0-9]+(?:\.[0-9]+)?$/.test(trimmed)) {
      return normalizeEpochTimestamp(numericValue) ?? fallback;
    }

    const parsedAt = Date.parse(trimmed);
    return Number.isFinite(parsedAt) ? new Date(parsedAt).toISOString() : trimmed;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeEpochTimestamp(value) ?? fallback;
  }

  return fallback;
}

function normalizeEpochTimestamp(value: number): string | null {
  const absoluteValue = Math.abs(value);
  const timestampMs = absoluteValue >= 1e12
    ? value
    : absoluteValue >= 1e9
      ? value * 1_000
      : null;

  if (timestampMs === null) {
    return null;
  }

  const date = new Date(timestampMs);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function workspaceSlug(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, "");
  const normalizedDriveLetter = trimmed.replace(/^[A-Z](?=:)/, (value) => value.toLowerCase());

  return normalizedDriveLetter
    .replaceAll(":", "-")
    .replaceAll("\\", "-")
    .replaceAll("/", "-");
}

export function appendJsonLine(filePath: string, payload: unknown): void {
  const line = JSON.stringify(payload);
  const prefix = existsSync(filePath) && readFileSync(filePath, "utf8").length > 0 ? "\n" : "";
  writeFileSync(filePath, `${prefix}${line}`, { encoding: "utf8", flag: "a" });
}

export function nextTimestamp(): string {
  return new Date().toISOString();
}

export function newSessionId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
