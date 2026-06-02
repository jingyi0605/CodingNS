import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { writeAffairsLibraryDebugLog } from "../../../../workspace/affairs-library-debug-log.js";
import { throwIfAborted } from "./abort.js";

const LOCK_DIR_RELATIVE_PATH = path.join(".ai-index", "runtime", "command.lock");
const OWNER_FILE_NAME = "owner.json";
const HEARTBEAT_FILE_NAME = "heartbeat.json";
const HEARTBEAT_INTERVAL_MS = 2_000;
const WAIT_POLL_MS = 500;
const WAIT_LOG_INTERVAL_MS = 5_000;
const STALE_HEARTBEAT_MS = 3 * 60 * 1000;

export interface AffairsIndexerRootLockHandle {
  release(): void;
}

export async function acquireAffairsIndexerRootLock(
  rootDir: string,
  command: string,
  options: {
    signal?: AbortSignal;
    reason?: string;
    targetPath?: string;
    taskId?: string;
    taskType?: string;
  } = {},
): Promise<AffairsIndexerRootLockHandle> {
  const lockDir = path.join(rootDir, LOCK_DIR_RELATIVE_PATH);
  const ownerFilePath = path.join(lockDir, OWNER_FILE_NAME);
  const heartbeatFilePath = path.join(lockDir, HEARTBEAT_FILE_NAME);
  const token = crypto.randomUUID();
  const startedAt = Date.now();
  let lastWaitLogAt = 0;

  while (true) {
    throwIfAborted(options.signal, "事务文档库根目录锁等待已取消");
    try {
      fs.mkdirSync(path.dirname(lockDir), { recursive: true });
      fs.mkdirSync(lockDir, { recursive: false });
      const nowIso = new Date().toISOString();
      const ownerPayload = {
        token,
        pid: process.pid,
        command,
        reason: options.reason?.trim() || null,
        targetPath: options.targetPath?.trim() || null,
        taskId: options.taskId?.trim() || null,
        taskType: options.taskType?.trim() || null,
        acquiredAt: nowIso,
      };
      fs.writeFileSync(ownerFilePath, `${JSON.stringify(ownerPayload, null, 2)}\n`, "utf8");
      fs.writeFileSync(heartbeatFilePath, `${JSON.stringify({ token, ts: nowIso })}\n`, "utf8");

      const heartbeatTimer = setInterval(() => {
        try {
          fs.writeFileSync(
            heartbeatFilePath,
            `${JSON.stringify({ token, ts: new Date().toISOString() })}\n`,
            "utf8",
          );
        } catch {
          // 心跳写失败不打断主流程，等待释放时统一收尾。
        }
      }, HEARTBEAT_INTERVAL_MS);

      writeAffairsLibraryDebugLog({
        event: "command_lock_acquired",
        processRole: "helper",
        rootDir,
        command,
        taskId: options.taskId ?? null,
        taskType: options.taskType ?? null,
        reason: options.reason ?? null,
        targetPath: options.targetPath ?? null,
        status: "acquired",
        durationMs: Date.now() - startedAt,
        details: {
          lockDir,
          waitedMs: Date.now() - startedAt,
          ownerPid: process.pid,
        },
      });

      return {
        release: () => {
          clearInterval(heartbeatTimer);
          try {
            const currentOwner = readOwnerPayload(ownerFilePath);
            if (currentOwner?.token === token) {
              fs.rmSync(lockDir, { recursive: true, force: true });
              writeAffairsLibraryDebugLog({
                event: "command_lock_released",
                processRole: "helper",
                rootDir,
                command,
                taskId: options.taskId ?? null,
                taskType: options.taskType ?? null,
                reason: options.reason ?? null,
                targetPath: options.targetPath ?? null,
                status: "released",
                details: {
                  lockDir,
                  ownerPid: process.pid,
                },
              });
            }
          } catch {
            // 锁释放失败不再反向打断主链路。
          }
        },
      };
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      const owner = readOwnerPayload(ownerFilePath);
      const heartbeatTs = readHeartbeatTimestamp(heartbeatFilePath);
      const ownerPid = typeof owner?.pid === "number" ? owner.pid : null;
      const heartbeatAgeMs = heartbeatTs ? Date.now() - heartbeatTs : Number.POSITIVE_INFINITY;
      const ownerAlive = ownerPid ? isProcessAlive(ownerPid) : false;
      const stale = !ownerAlive || heartbeatAgeMs > STALE_HEARTBEAT_MS;

      if (stale) {
        writeAffairsLibraryDebugLog({
          event: "command_lock_stale_detected",
          processRole: "helper",
          rootDir,
          command,
          taskId: options.taskId ?? null,
          taskType: options.taskType ?? null,
          reason: options.reason ?? null,
          targetPath: options.targetPath ?? null,
          status: "stale",
          details: {
            lockDir,
            ownerPid,
            ownerAlive,
            heartbeatAgeMs: Number.isFinite(heartbeatAgeMs) ? heartbeatAgeMs : null,
          },
        });
        try {
          fs.rmSync(lockDir, { recursive: true, force: true });
          writeAffairsLibraryDebugLog({
            event: "command_lock_stale_cleared",
            processRole: "helper",
            rootDir,
            command,
            taskId: options.taskId ?? null,
            taskType: options.taskType ?? null,
            reason: options.reason ?? null,
            targetPath: options.targetPath ?? null,
            status: "cleared",
            details: {
              lockDir,
              ownerPid,
            },
          });
          continue;
        } catch {
          // 别的进程可能已经抢先处理，继续等待下一轮。
        }
      }

      if (Date.now() - lastWaitLogAt >= WAIT_LOG_INTERVAL_MS) {
        lastWaitLogAt = Date.now();
        writeAffairsLibraryDebugLog({
          event: "command_lock_waiting",
          processRole: "helper",
          rootDir,
          command,
          taskId: options.taskId ?? null,
          taskType: options.taskType ?? null,
          reason: options.reason ?? null,
          targetPath: options.targetPath ?? null,
          status: "waiting",
          durationMs: Date.now() - startedAt,
          details: {
            lockDir,
            ownerPid,
            ownerAlive,
            heartbeatAgeMs: Number.isFinite(heartbeatAgeMs) ? heartbeatAgeMs : null,
            waitedMs: Date.now() - startedAt,
          },
        });
      }

      await waitForNextPoll(options.signal);
    }
  }
}

function readOwnerPayload(filePath: string): { token?: string; pid?: number } | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as { token?: string; pid?: number };
  } catch {
    return null;
  }
}

function readHeartbeatTimestamp(filePath: string): number | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const payload = JSON.parse(raw) as { ts?: string };
    const parsed = payload.ts ? Date.parse(payload.ts) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "EEXIST";
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "EPERM";
  }
}

async function waitForNextPoll(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal, "事务文档库根目录锁等待已取消");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, WAIT_POLL_MS);
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error("事务文档库根目录锁等待已取消"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  throwIfAborted(signal, "事务文档库根目录锁等待已取消");
}
