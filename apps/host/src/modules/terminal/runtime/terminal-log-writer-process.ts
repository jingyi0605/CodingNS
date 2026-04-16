import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import Database from "better-sqlite3";

import { parseCliArgs, readRequiredCliArg } from "./conpty-runtime-shared.js";

interface PersistRequest {
  type: "persist";
  id: string;
  terminalId: string;
  startSeq: number;
  endSeq: number;
  content: string;
}

interface DeleteRequest {
  type: "delete";
  id: string;
  terminalId: string;
}

interface ShutdownRequest {
  type: "shutdown";
  id: string;
}

interface PreparedActiveLogFile {
  id: string;
  relativePath: string;
  status: string;
  sizeBytes: number;
}

interface PersistBatchCommitInput {
  terminalId: string;
  fileId: string;
  fileStatus: string;
  startSeq: number;
  endSeq: number;
  appendResult: {
    startOffset: number;
    endOffset: number;
    byteLength: number;
  };
  timestamp: string;
}

interface SqliteRetryResult<T> {
  value: T;
  attempts: number;
  busyRetryCount: number;
  busyWaitMs: number;
  durationMs: number;
}

type WriterRequest = PersistRequest | DeleteRequest | ShutdownRequest;

const SQLITE_BUSY_TIMEOUT_MS = 250;
const SQLITE_BUSY_RETRY_DELAYS_MS = [100, 200, 400, 800, 1_200, 1_600] as const;
const SQLITE_SLOW_OPERATION_THRESHOLD_MS = 200;

const cliArgs = parseCliArgs(process.argv.slice(2));
const databasePath = readRequiredCliArg(cliArgs, "database-path");
const logRootDir = path.resolve(readRequiredCliArg(cliArgs, "log-root-dir"));
const db = new Database(databasePath);

// writer 子进程自己负责短超时和显式重试，避免 SQLite 在单次写入里闷等 5 秒。
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

const ensuredDirectories = new Set<string>();
const findActiveFileStatement = db.prepare(
  `SELECT
     id,
     relative_path,
     status,
     size_bytes
   FROM terminal_log_files
   WHERE terminal_id = ? AND status = 'active'
   ORDER BY updated_at DESC, created_at DESC
   LIMIT 1`
);
const createFileStatement = db.prepare(
  `INSERT INTO terminal_log_files (
     id,
     terminal_id,
     relative_path,
     status,
     start_seq,
     end_seq,
     size_bytes,
     created_at,
     updated_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const createSegmentStatement = db.prepare(
  `INSERT INTO terminal_log_segments (
     id,
     terminal_id,
     file_id,
     start_seq,
     end_seq,
     start_offset,
     end_offset,
     byte_length,
     created_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const updateFileStatement = db.prepare(
  `UPDATE terminal_log_files
   SET status = ?,
       end_seq = ?,
       size_bytes = ?,
       updated_at = ?
   WHERE id = ?`
);
const deleteSegmentsStatement = db.prepare(
  `DELETE FROM terminal_log_segments
   WHERE terminal_id = ?`
);
const deleteFilesStatement = db.prepare(
  `DELETE FROM terminal_log_files
   WHERE terminal_id = ?`
);
const preparePersistBatchTransaction = db.transaction((
  terminalId: string,
  startSeq: number,
  timestamp: string
): PreparedActiveLogFile => {
  let activeFile = findActiveFileStatement.get(terminalId) as
    | {
        id: string;
        relative_path: string;
        status: string;
        size_bytes: number;
      }
    | undefined;

  if (!activeFile) {
    activeFile = {
      id: randomUUID(),
      relative_path: buildActiveRelativePath(terminalId),
      status: "active",
      size_bytes: 0
    };

    createFileStatement.run(
      activeFile.id,
      terminalId,
      activeFile.relative_path,
      activeFile.status,
      startSeq,
      null,
      0,
      timestamp,
      timestamp
    );
  }

  return {
    id: activeFile.id,
    relativePath: activeFile.relative_path,
    status: activeFile.status,
    sizeBytes: activeFile.size_bytes
  };
});
const commitPersistBatchTransaction = db.transaction((input: PersistBatchCommitInput) => {
  createSegmentStatement.run(
    randomUUID(),
    input.terminalId,
    input.fileId,
    input.startSeq,
    input.endSeq,
    input.appendResult.startOffset,
    input.appendResult.endOffset,
    input.appendResult.byteLength,
    input.timestamp
  );

  updateFileStatement.run(
    input.fileStatus,
    input.endSeq,
    input.appendResult.endOffset,
    input.timestamp,
    input.fileId
  );
});
const deleteTerminalLogsTransaction = db.transaction((terminalId: string) => {
  deleteSegmentsStatement.run(terminalId);
  deleteFilesStatement.run(terminalId);
});

const stdinReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

let queue = Promise.resolve();

stdinReader.on("line", (line) => {
  queue = queue.then(async () => {
    await handleLine(line);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
  });
});

process.on("SIGINT", () => {
  shutdown();
});
process.on("SIGTERM", () => {
  shutdown();
});

async function handleLine(line: string): Promise<void> {
  let payload: WriterRequest;

  try {
    payload = JSON.parse(line) as WriterRequest;
  } catch {
    return;
  }

  try {
    switch (payload.type) {
      case "persist":
        await handlePersistRequest(payload);
        await writeResult({
          type: "result",
          id: payload.id,
          ok: true
        });
        return;
      case "delete":
        await handleDeleteRequest(payload);
        await writeResult({
          type: "result",
          id: payload.id,
          ok: true
        });
        return;
      case "shutdown":
        await writeResult({
          type: "result",
          id: payload.id,
          ok: true
        });
        shutdown();
        return;
      default:
        return;
    }
  } catch (error) {
    await writeResult({
      type: "result",
      id: payload.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handlePersistRequest(payload: PersistRequest): Promise<void> {
  const requestStartedAt = Date.now();
  const timestamp = new Date().toISOString();
  const prepareResult = await runSqliteBusyRetry(
    payload.id,
    payload.terminalId,
    "prepare",
    () => preparePersistBatchTransaction(payload.terminalId, payload.startSeq, timestamp)
  );
  const appendStartedAt = Date.now();
  const appendResult = appendLogFile(
    prepareResult.value.relativePath,
    payload.content,
    prepareResult.value.sizeBytes
  );
  const appendDurationMs = Date.now() - appendStartedAt;
  const commitResult = await runSqliteBusyRetry(
    payload.id,
    payload.terminalId,
    "commit",
    () => commitPersistBatchTransaction({
      terminalId: payload.terminalId,
      fileId: prepareResult.value.id,
      fileStatus: prepareResult.value.status,
      startSeq: payload.startSeq,
      endSeq: payload.endSeq,
      appendResult,
      timestamp
    })
  );
  const totalDurationMs = Date.now() - requestStartedAt;

  if (
    prepareResult.busyRetryCount > 0
    || commitResult.busyRetryCount > 0
    || appendDurationMs >= SQLITE_SLOW_OPERATION_THRESHOLD_MS
    || totalDurationMs >= SQLITE_SLOW_OPERATION_THRESHOLD_MS
  ) {
    logWriterWarning("persist.completed", {
      requestId: payload.id,
      terminalId: payload.terminalId,
      totalDurationMs,
      appendDurationMs,
      prepareAttempts: prepareResult.attempts,
      prepareBusyRetries: prepareResult.busyRetryCount,
      prepareBusyWaitMs: prepareResult.busyWaitMs,
      prepareDurationMs: prepareResult.durationMs,
      commitAttempts: commitResult.attempts,
      commitBusyRetries: commitResult.busyRetryCount,
      commitBusyWaitMs: commitResult.busyWaitMs,
      commitDurationMs: commitResult.durationMs
    });
  }
}

async function handleDeleteRequest(payload: DeleteRequest): Promise<void> {
  const requestStartedAt = Date.now();
  const deleteResult = await runSqliteBusyRetry(
    payload.id,
    payload.terminalId,
    "delete",
    () => deleteTerminalLogsTransaction(payload.terminalId)
  );
  const deleteDirectoryStartedAt = Date.now();

  deleteTerminalDirectory(payload.terminalId);

  const deleteDirectoryDurationMs = Date.now() - deleteDirectoryStartedAt;
  const totalDurationMs = Date.now() - requestStartedAt;

  if (
    deleteResult.busyRetryCount > 0
    || deleteDirectoryDurationMs >= SQLITE_SLOW_OPERATION_THRESHOLD_MS
    || totalDurationMs >= SQLITE_SLOW_OPERATION_THRESHOLD_MS
  ) {
    logWriterWarning("delete.completed", {
      requestId: payload.id,
      terminalId: payload.terminalId,
      totalDurationMs,
      deleteDirectoryDurationMs,
      deleteAttempts: deleteResult.attempts,
      deleteBusyRetries: deleteResult.busyRetryCount,
      deleteBusyWaitMs: deleteResult.busyWaitMs,
      deleteDurationMs: deleteResult.durationMs
    });
  }
}

async function runSqliteBusyRetry<T>(
  requestId: string,
  terminalId: string,
  phase: string,
  operation: () => T
): Promise<SqliteRetryResult<T>> {
  const startedAt = Date.now();
  let attempts = 0;
  let busyRetryCount = 0;
  let busyWaitMs = 0;

  while (true) {
    attempts += 1;
    const attemptStartedAt = Date.now();

    try {
      const value = operation();

      return {
        value,
        attempts,
        busyRetryCount,
        busyWaitMs,
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      if (!isSqliteBusyError(error)) {
        throw error;
      }

      const retryDelayMs = SQLITE_BUSY_RETRY_DELAYS_MS[busyRetryCount];

      if (retryDelayMs === undefined) {
        throw error;
      }

      busyRetryCount += 1;
      busyWaitMs += retryDelayMs;
      logWriterWarning("sqlite.busy.retry", {
        requestId,
        terminalId,
        phase,
        attempt: attempts,
        busyRetryCount,
        busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
        attemptDurationMs: Date.now() - attemptStartedAt,
        elapsedMs: Date.now() - startedAt,
        nextDelayMs: retryDelayMs,
        error: error instanceof Error ? error.message : String(error)
      });
      await delay(retryDelayMs);
    }
  }
}

function isSqliteBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("database is locked") || message.includes("SQLITE_BUSY");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function appendLogFile(
  relativePath: string,
  content: string,
  currentSizeBytes: number
): {
  startOffset: number;
  endOffset: number;
  byteLength: number;
} {
  const filePath = resolveLogPath(relativePath);
  const directoryPath = path.dirname(filePath);

  if (!ensuredDirectories.has(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
    ensuredDirectories.add(directoryPath);
  }

  appendFileSync(filePath, content, "utf8");

  const byteLength = Buffer.byteLength(content, "utf8");

  return {
    startOffset: currentSizeBytes,
    endOffset: currentSizeBytes + byteLength,
    byteLength
  };
}

function deleteTerminalDirectory(terminalId: string): void {
  const terminalDir = resolveLogPath(terminalId);
  ensuredDirectories.delete(terminalDir);
  rmSync(terminalDir, { recursive: true, force: true });
}

function buildActiveRelativePath(terminalId: string): string {
  return path.join(terminalId, "active.log");
}

function resolveLogPath(relativePath: string): string {
  const resolvedPath = path.resolve(logRootDir, relativePath);

  if (resolvedPath !== logRootDir && !resolvedPath.startsWith(`${logRootDir}${path.sep}`)) {
    throw new Error(`Invalid terminal log path: ${relativePath}`);
  }

  return resolvedPath;
}

function logWriterWarning(scope: string, detail: Record<string, unknown>): void {
  const suffix = Object.entries(detail)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatWriterLogValue(value)}`)
    .join(" ");

  console.warn(`[terminal-log-writer] ${scope}${suffix ? ` ${suffix}` : ""}`);
}

function formatWriterLogValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.round(value)) : String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (value === null) {
    return "null";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function writeResult(payload: {
  type: "result";
  id: string;
  ok: boolean;
  error?: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function shutdown(): void {
  stdinReader.close();

  if (db.open) {
    db.close();
  }

  process.exit(0);
}
