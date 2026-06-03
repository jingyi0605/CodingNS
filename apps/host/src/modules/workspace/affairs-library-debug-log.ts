import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRuntimeConfig } from "../affairs-indexer/core/src/config/load-runtime-config.js";

const DEFAULT_LOG_FILE_NAME = "affairs-library-debug.log";
const LOG_DIR_ENV_KEY = "CODINGNS_AFFAIRS_DEBUG_LOG_DIR";
const LOG_LEVEL_ENV_KEY = "DOC_SEMANTIC_INDEX_LOG_LEVEL";

export interface AffairsLibraryDebugPayload {
  event: string;
  processRole?: "host" | "helper";
  workspaceId?: string | null;
  rootDir?: string | null;
  taskType?: string | null;
  taskId?: string | null;
  command?: string | null;
  source?: string | null;
  reason?: string | null;
  targetPath?: string | null;
  watchKind?: string | null;
  eventType?: string | null;
  message?: string | null;
  durationMs?: number | null;
  deduped?: boolean | null;
  status?: string | null;
  resultSummary?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
}

let ensuredLogDir: string | null = null;
const debugEnabledCache = new Map<string, boolean>();

export function writeAffairsLibraryDebugLog(payload: AffairsLibraryDebugPayload): void {
  const logDir = resolveAffairsLibraryDebugLogDir(payload.rootDir);
  if (!logDir) {
    return;
  }

  try {
    if (ensuredLogDir !== logDir) {
      mkdirSync(logDir, { recursive: true });
      ensuredLogDir = logDir;
    }

    const filePath = path.join(logDir, DEFAULT_LOG_FILE_NAME);
    const entry = {
      ts: new Date().toISOString(),
      pid: process.pid,
      processRole: payload.processRole ?? "host",
      logType: "affairs_library_debug",
      event: payload.event,
      workspaceId: normalizeString(payload.workspaceId),
      rootDir: normalizeString(payload.rootDir),
      taskType: normalizeString(payload.taskType),
      taskId: normalizeString(payload.taskId),
      command: normalizeString(payload.command),
      source: normalizeString(payload.source),
      reason: normalizeString(payload.reason),
      targetPath: normalizeString(payload.targetPath),
      watchKind: normalizeString(payload.watchKind),
      eventType: normalizeString(payload.eventType),
      message: normalizeString(payload.message),
      durationMs: typeof payload.durationMs === "number" ? payload.durationMs : null,
      deduped: typeof payload.deduped === "boolean" ? payload.deduped : null,
      status: normalizeString(payload.status),
      resultSummary: payload.resultSummary ?? null,
      details: payload.details ?? null,
    };
    appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // 调试日志写失败不能反向打断主链路。
  }
}

export function getAffairsLibraryDebugLogPath(rootDir?: string | null): string | null {
  const logDir = resolveAffairsLibraryDebugLogDir(rootDir);
  return logDir ? path.join(logDir, DEFAULT_LOG_FILE_NAME) : null;
}

export function isAffairsLibraryDebugEnabled(rootDir?: string | null): boolean {
  if (process.env[LOG_LEVEL_ENV_KEY]?.trim() === "debug") {
    return true;
  }

  const normalizedRootDir = normalizeString(rootDir);
  if (!normalizedRootDir) {
    return false;
  }

  const cached = debugEnabledCache.get(normalizedRootDir);
  if (cached !== undefined) {
    return cached;
  }

  let enabled = false;
  try {
    enabled = loadRuntimeConfig(normalizedRootDir, {
      args: {
        rootDir: normalizedRootDir,
        "root-dir": normalizedRootDir,
      },
      env: process.env,
    }).logLevel === "debug";
  } catch {
    enabled = false;
  }
  debugEnabledCache.set(normalizedRootDir, enabled);
  return enabled;
}

function resolveAffairsLibraryDebugLogDir(rootDir?: string | null): string | null {
  if (!isAffairsLibraryDebugEnabled(rootDir)) {
    return null;
  }

  const explicitDir = process.env[LOG_DIR_ENV_KEY]?.trim();
  if (explicitDir) {
    return path.resolve(explicitDir);
  }

  if (process.env.NODE_ENV === "test") {
    return null;
  }

  return path.resolve(resolveWorkspaceRepoRoot(), "tmp", "logs");
}

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveWorkspaceRepoRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const appRootCandidate = path.resolve(moduleDir, "..", "..", "..");
  const appRootDir = path.basename(appRootCandidate) === ".build"
    ? path.dirname(appRootCandidate)
    : appRootCandidate;
  return path.resolve(appRootDir, "..", "..");
}
