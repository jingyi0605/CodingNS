import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  HistoryDirection,
  HistoryPage,
  NormalizedMessage,
  ProviderId
} from "../types.js";

interface RawJsonLine {
  lineNumber: number;
  raw: string;
  data: Record<string, unknown>;
}

export function normalizeWorkspacePath(value: string): string {
  return value.replaceAll("/", "\\").toLowerCase();
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

  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => ({
      lineNumber: index + 1,
      raw: line,
      data: JSON.parse(line) as Record<string, unknown>
    }));
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

export function messageIdFromRawRef(rawRef: string): string {
  return createHash("sha1").update(rawRef).digest("hex");
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
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return fallback;
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
