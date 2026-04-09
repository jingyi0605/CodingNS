import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeWorkspacePath } from "./providers/utils.js";

export interface KimiWorkDirRecord {
  path: string;
  normalizedPath: string;
  hash: string;
  lastSessionId: string | null;
}

export function buildKimiSessionRawStoreRef(sessionId: string): string {
  return `kimi://session/${encodeURIComponent(sessionId)}`;
}

export function parseKimiSessionIdFromRawStoreRef(rawStoreRef: string): string | null {
  const matched = rawStoreRef.match(/^kimi:\/\/session\/([^/?#]+)$/i);

  if (!matched) {
    return null;
  }

  return decodeURIComponent(matched[1]);
}

export function readKimiWorkDirRecords(homeDir: string): KimiWorkDirRecord[] {
  const kimiJsonPath = join(homeDir, "kimi.json");

  if (!existsSync(kimiJsonPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(kimiJsonPath, "utf8")) as {
      work_dirs?: unknown;
    };

    if (!Array.isArray(parsed.work_dirs)) {
      return [];
    }

    const records: KimiWorkDirRecord[] = [];

    for (const item of parsed.work_dirs) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const rawPath = normalizeOptionalText((item as Record<string, unknown>).path);

      if (!rawPath) {
        continue;
      }

      records.push({
        path: rawPath,
        normalizedPath: normalizeWorkspacePath(rawPath),
        hash: createHash("md5").update(rawPath).digest("hex"),
        lastSessionId: normalizeOptionalText(
          (item as Record<string, unknown>).last_session_id
          ?? (item as Record<string, unknown>).lastSessionId
        )
      });
    }

    return records;
  } catch {
    return [];
  }
}

export function findKimiWorkDirRecordByPath(
  records: KimiWorkDirRecord[],
  workspacePath: string
): KimiWorkDirRecord | null {
  const trimmedWorkspacePath = workspacePath.trim();
  const normalizedWorkspacePath = normalizeWorkspacePath(trimmedWorkspacePath);

  if (!normalizedWorkspacePath) {
    return null;
  }

  return records.find((record) => record.path === trimmedWorkspacePath)
    ?? records.find((record) => record.normalizedPath === normalizedWorkspacePath)
    ?? null;
}

export function buildKimiWorkspacePathByHash(
  records: KimiWorkDirRecord[]
): Map<string, string> {
  const pathByHash = new Map<string, string>();

  for (const record of records) {
    if (!pathByHash.has(record.hash)) {
      pathByHash.set(record.hash, record.path);
    }
  }

  return pathByHash;
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
