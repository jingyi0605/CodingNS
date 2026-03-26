import { accessSync, chmodSync, constants, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { EventEmitter } from "node:events";

import { spawn, type IPty } from "node-pty";

import { AppError } from "../../../shared/errors/app-error.js";
import type { TerminalInstance } from "../../../types/domain.js";

const require = createRequire(import.meta.url);
let hasEnsuredPtySpawnHelper = false;

export interface TerminalRuntimeExitEvent {
  terminalId: string;
  exitCode: number | null;
  requestedClose: boolean;
}

interface TerminalRuntimeRecord {
  pty: IPty;
}

export declare interface PtyRuntimeManager {
  on(event: "output", listener: (event: { terminalId: string; content: string }) => void): this;
  on(event: "exit", listener: (event: TerminalRuntimeExitEvent) => void): this;
  emit(event: "output", eventPayload: { terminalId: string; content: string }): boolean;
  emit(event: "exit", eventPayload: TerminalRuntimeExitEvent): boolean;
}

export class PtyRuntimeManager extends EventEmitter {
  private readonly runtimes = new Map<string, TerminalRuntimeRecord>();
  private readonly requestedClose = new Set<string>();

  start(terminal: TerminalInstance, env: Record<string, string>): void {
    try {
      ensurePtySpawnHelperExecutable();

      const ptyProcess = spawn(terminal.shell, [], {
        cols: 120,
        rows: 30,
        cwd: terminal.cwd,
        env,
        name: "xterm-color"
      });

      this.runtimes.set(terminal.id, { pty: ptyProcess });

      ptyProcess.onData((content) => {
        this.emit("output", {
          terminalId: terminal.id,
          content
        });
      });

      ptyProcess.onExit((event) => {
        this.runtimes.delete(terminal.id);
        const requestedClose = this.requestedClose.delete(terminal.id);

        this.emit("exit", {
          terminalId: terminal.id,
          exitCode: event.exitCode ?? null,
          requestedClose
        });
      });
    } catch (error) {
      throw new AppError({
        statusCode: 502,
        errorCode: "PTY_START_FAILED",
        detail: error instanceof Error ? error.message : "PTY 启动失败"
      });
    }
  }

  write(terminalId: string, content: string): void {
    const runtime = this.runtimes.get(terminalId);

    if (!runtime) {
      throw new AppError({
        statusCode: 409,
        errorCode: "TERMINAL_NOT_RUNNING",
        detail: "终端当前不可写入"
      });
    }

    runtime.pty.write(content);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const runtime = this.runtimes.get(terminalId);

    if (!runtime) {
      throw new AppError({
        statusCode: 409,
        errorCode: "TERMINAL_NOT_RUNNING",
        detail: "终端当前不可调整尺寸"
      });
    }

    runtime.pty.resize(cols, rows);
  }

  close(terminalId: string): void {
    const runtime = this.runtimes.get(terminalId);

    if (!runtime) {
      return;
    }

    this.requestedClose.add(terminalId);
    runtime.pty.kill();
  }

  isRunning(terminalId: string): boolean {
    return this.runtimes.has(terminalId);
  }

  closeAll(): void {
    for (const terminalId of this.runtimes.keys()) {
      this.close(terminalId);
    }
  }
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
  try {
    const packageJsonPath = require.resolve("node-pty/package.json");
    const helperPath = path.join(
      path.dirname(packageJsonPath),
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper"
    );

    return existsSync(helperPath) ? helperPath : null;
  } catch {
    return null;
  }
}
