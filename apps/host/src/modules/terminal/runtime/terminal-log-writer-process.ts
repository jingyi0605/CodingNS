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

type WriterRequest = PersistRequest | DeleteRequest | ShutdownRequest;

const cliArgs = parseCliArgs(process.argv.slice(2));
const databasePath = readRequiredCliArg(cliArgs, "database-path");
const logRootDir = path.resolve(readRequiredCliArg(cliArgs, "log-root-dir"));
const db = new Database(databasePath);
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
const persistBatchTransaction = db.transaction((input: PersistRequest) => {
  const timestamp = new Date().toISOString();
  let activeFile = findActiveFileStatement.get(input.terminalId) as
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
      relative_path: buildActiveRelativePath(input.terminalId),
      status: "active",
      size_bytes: 0
    };

    createFileStatement.run(
      activeFile.id,
      input.terminalId,
      activeFile.relative_path,
      activeFile.status,
      input.startSeq,
      null,
      0,
      timestamp,
      timestamp
    );
  }

  const appendResult = appendLogFile(
    activeFile.relative_path,
    input.content,
    activeFile.size_bytes
  );

  createSegmentStatement.run(
    randomUUID(),
    input.terminalId,
    activeFile.id,
    input.startSeq,
    input.endSeq,
    appendResult.startOffset,
    appendResult.endOffset,
    appendResult.byteLength,
    timestamp
  );

  updateFileStatement.run(
    activeFile.status,
    input.endSeq,
    appendResult.endOffset,
    timestamp,
    activeFile.id
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
        persistBatchTransaction(payload);
        await writeResult({
          type: "result",
          id: payload.id,
          ok: true
        });
        return;
      case "delete":
        deleteTerminalLogsTransaction(payload.terminalId);
        deleteTerminalDirectory(payload.terminalId);
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
