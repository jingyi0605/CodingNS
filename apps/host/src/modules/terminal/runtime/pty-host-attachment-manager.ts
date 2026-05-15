import { accessSync, chmodSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";

import { AppError } from "../../../shared/errors/app-error.js";
import {
  loadNodePty,
  resolveLoadedNodePtyPackageRoot,
  type IPty
} from "./node-pty-loader.js";

const { spawn } = loadNodePty();
let hasEnsuredPtySpawnHelper = false;

export interface HostAttachmentExitEvent {
  attachmentId: string;
  exitCode: number | null;
  requestedClose: boolean;
}

interface HostAttachmentRecord {
  pty: IPty;
  processId: number | null;
  closeStrategy: "pty-kill" | "process-kill";
}

export declare interface PtyHostAttachmentManager {
  on(event: "output", listener: (event: { attachmentId: string; content: string }) => void): this;
  on(event: "exit", listener: (event: HostAttachmentExitEvent) => void): this;
  emit(event: "output", eventPayload: { attachmentId: string; content: string }): boolean;
  emit(event: "exit", eventPayload: HostAttachmentExitEvent): boolean;
}

export class PtyHostAttachmentManager extends EventEmitter {
  private readonly attachments = new Map<string, HostAttachmentRecord>();
  private readonly requestedClose = new Set<string>();

  start(
    attachmentId: string,
    input: {
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      cols?: number;
      rows?: number;
      closeStrategy?: "pty-kill" | "process-kill";
    }
  ): number | null {
    try {
      ensurePtySpawnHelperExecutable();

      const ptyProcess = spawn(input.command, input.args, {
        cols: input.cols ?? 120,
        rows: input.rows ?? 30,
        cwd: input.cwd,
        env: input.env,
        name: "xterm-color"
      });

      const processId = normalizeProcessId(ptyProcess.pid);
      this.attachments.set(attachmentId, {
        pty: ptyProcess,
        processId,
        closeStrategy: input.closeStrategy ?? "pty-kill"
      });

      ptyProcess.onData((content) => {
        this.emit("output", {
          attachmentId,
          content
        });
      });

      ptyProcess.onExit((event) => {
        this.attachments.delete(attachmentId);
        const requestedClose = this.requestedClose.delete(attachmentId);

        this.emit("exit", {
          attachmentId,
          exitCode: event.exitCode ?? null,
          requestedClose
        });
      });

      return processId;
    } catch (error) {
      throw new AppError({
        statusCode: 502,
        errorCode: "PTY_START_FAILED",
        detail: error instanceof Error ? error.message : "PTY 启动失败"
      });
    }
  }

  write(attachmentId: string, content: string): void {
    const runtime = this.attachments.get(attachmentId);

    if (!runtime) {
      throw new AppError({
        statusCode: 409,
        errorCode: "TERMINAL_NOT_RUNNING",
        detail: "终端当前不可写入"
      });
    }

    runtime.pty.write(content);
  }

  resize(attachmentId: string, cols: number, rows: number): void {
    const runtime = this.attachments.get(attachmentId);

    if (!runtime) {
      throw new AppError({
        statusCode: 409,
        errorCode: "TERMINAL_NOT_RUNNING",
        detail: "终端当前不可调整尺寸"
      });
    }

    runtime.pty.resize(cols, rows);
  }

  close(attachmentId: string): void {
    const runtime = this.attachments.get(attachmentId);

    if (!runtime) {
      return;
    }

    this.requestedClose.add(attachmentId);

    if (runtime.closeStrategy === "process-kill" && runtime.processId) {
      try {
        process.kill(runtime.processId);
        return;
      } catch {
        // 进程已经结束时退回到 node-pty 默认关闭逻辑。
      }
    }

    runtime.pty.kill();
  }

  isRunning(attachmentId: string): boolean {
    return this.attachments.has(attachmentId);
  }

  getProcessId(attachmentId: string): number | null {
    return this.attachments.get(attachmentId)?.processId ?? null;
  }

  closeAll(): void {
    for (const attachmentId of this.attachments.keys()) {
      this.close(attachmentId);
    }
  }
}

function normalizeProcessId(processId: number | undefined): number | null {
  if (typeof processId !== "number" || !Number.isInteger(processId) || processId <= 0) {
    return null;
  }

  return processId;
}

function ensurePtySpawnHelperExecutable(): void {
  if (hasEnsuredPtySpawnHelper || process.platform !== "darwin") {
    return;
  }

  const helperPath = resolvePtySpawnHelperPath();

  if (!helperPath) {
    hasEnsuredPtySpawnHelper = true;
    return;
  }

  try {
    accessSync(helperPath, constants.X_OK);
    hasEnsuredPtySpawnHelper = true;
    return;
  } catch {
    // 文件存在但不可执行时，自动修复权限。
  }

  try {
    chmodSync(helperPath, 0o755);
    hasEnsuredPtySpawnHelper = true;
  } catch (error) {
    throw new AppError({
      statusCode: 502,
      errorCode: "PTY_START_FAILED",
      detail:
        error instanceof Error
          ? `node-pty spawn-helper 权限修复失败: ${error.message}`
          : "node-pty spawn-helper 权限修复失败"
    });
  }
}

function resolvePtySpawnHelperPath(): string | null {
  const packageRoot = resolveLoadedNodePtyPackageRoot();

  if (!packageRoot) {
    return null;
  }

  const helperPath = path.join(
    packageRoot,
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper"
  );

  return existsSync(helperPath) ? helperPath : null;
}
