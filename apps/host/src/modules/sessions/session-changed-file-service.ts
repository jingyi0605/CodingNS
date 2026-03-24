import path from "node:path";

import type { NormalizedMessage, NormalizedToolCall } from "@codingns/session-sync-core";

import type { SessionChangedFileRecord } from "../../types/domain.js";
import type { SessionChangedFileRepository } from "../../storage/repositories/session-changed-file-repository.js";

interface MutableChangedFileRecord {
  sessionId: string;
  workspaceId: string;
  path: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  lastToolName: string | null;
}

export class SessionChangedFileService {
  constructor(private readonly sessionChangedFileRepository: SessionChangedFileRepository) {}

  recordMessages(
    sessionId: string,
    workspaceId: string,
    workspacePath: string,
    messages: NormalizedMessage[]
  ): void {
    const records = this.collectRecords(sessionId, workspaceId, workspacePath, messages);
    this.sessionChangedFileRepository.upsertMany(records);
  }

  listBySessionId(sessionId: string): SessionChangedFileRecord[] {
    return this.sessionChangedFileRepository.listBySessionId(sessionId);
  }

  hasIndexedSession(sessionId: string): boolean {
    return this.sessionChangedFileRepository.findIndexStateBySessionId(sessionId) !== null;
  }

  markSessionIndexed(sessionId: string, timestamp: string): void {
    this.sessionChangedFileRepository.upsertIndexState({
      sessionId,
      indexedAt: timestamp,
      updatedAt: timestamp
    });
  }

  deleteBySessionId(sessionId: string): void {
    this.sessionChangedFileRepository.deleteBySessionId(sessionId);
  }

  private collectRecords(
    sessionId: string,
    workspaceId: string,
    workspacePath: string,
    messages: NormalizedMessage[]
  ): SessionChangedFileRecord[] {
    const collected = new Map<string, MutableChangedFileRecord>();

    for (const message of messages) {
      if (message.role !== "tool" || !message.toolCall) {
        continue;
      }

      const paths = this.extractPathsFromToolCall(message.toolCall, workspacePath);

      for (const filePath of paths) {
        const existing = collected.get(filePath);

        if (existing) {
          if (message.timestamp < existing.firstDetectedAt) {
            existing.firstDetectedAt = message.timestamp;
          }

          if (message.timestamp >= existing.lastDetectedAt) {
            existing.lastDetectedAt = message.timestamp;
            existing.lastToolName = message.toolCall.name.trim() || existing.lastToolName;
          }

          continue;
        }

        collected.set(filePath, {
          sessionId,
          workspaceId,
          path: filePath,
          firstDetectedAt: message.timestamp,
          lastDetectedAt: message.timestamp,
          lastToolName: message.toolCall.name.trim() || null
        });
      }
    }

    return [...collected.values()];
  }

  private extractPathsFromToolCall(
    toolCall: NormalizedToolCall,
    workspacePath: string
  ): string[] {
    const collected = new Set<string>();

    if (toolCall.name === "apply_patch") {
      for (const filePath of extractApplyPatchPaths(toolCall.input, workspacePath)) {
        collected.add(filePath);
      }
    }

    for (const filePath of extractStructuredPaths(toolCall.input, workspacePath)) {
      collected.add(filePath);
    }

    return [...collected];
  }
}

function extractApplyPatchPaths(input: string, workspacePath: string): string[] {
  return input
    .split(/\r?\n/)
    .flatMap((line) => {
      const matched =
        line.match(/^\*\*\* Update File:\s+(.+)$/) ??
        line.match(/^\*\*\* Add File:\s+(.+)$/) ??
        line.match(/^\*\*\* Delete File:\s+(.+)$/) ??
        line.match(/^\*\*\* Move to:\s+(.+)$/);

      const normalized = matched?.[1]
        ? normalizeWorkspaceRelativePath(matched[1].trim(), workspacePath)
        : null;

      return normalized ? [normalized] : [];
    });
}

function extractStructuredPaths(input: string, workspacePath: string): string[] {
  const payload = safeJsonParse(input);

  if (!payload) {
    return [];
  }

  const collected = new Set<string>();
  collectPathsFromValue(payload, workspacePath, collected);
  return [...collected];
}

function safeJsonParse(input: string): unknown {
  const trimmed = input.trim();

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function collectPathsFromValue(
  value: unknown,
  workspacePath: string,
  collector: Set<string>,
  parentKey = ""
): void {
  if (typeof value === "string") {
    if (!isPathLikeKey(parentKey)) {
      return;
    }

    const normalized = normalizeWorkspaceRelativePath(value, workspacePath);

    if (normalized) {
      collector.add(normalized);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectPathsFromValue(item, workspacePath, collector, parentKey));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
    collectPathsFromValue(nestedValue, workspacePath, collector, key);
  });
}

function isPathLikeKey(key: string): boolean {
  return [
    "path",
    "paths",
    "filePath",
    "file_path",
    "srcPath",
    "src_path",
    "dstPath",
    "dst_path",
    "oldPath",
    "old_path",
    "newPath",
    "new_path",
    "sourcePath",
    "source_path",
    "targetPath",
    "target_path"
  ].includes(key);
}

function normalizeWorkspaceRelativePath(value: string, workspacePath: string): string | null {
  const trimmed = value.trim().replace(/^['"]+|['"]+$/g, "");

  if (!trimmed || trimmed === "." || trimmed === "./") {
    return null;
  }

  const workspaceRoot = path.resolve(workspacePath);
  const candidatePath = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceRoot, trimmed);
  const relativePath = path.relative(workspaceRoot, candidatePath);

  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return normalizeRelativePath(relativePath);
  }

  if (path.isAbsolute(trimmed)) {
    return null;
  }

  const normalized = normalizeRelativePath(trimmed);
  return normalized.startsWith("../") ? null : normalized;
}

function normalizeRelativePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}
