import { EventEmitter } from "node:events";

import type Database from "better-sqlite3";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { TerminalInstance, TerminalOutputChunk } from "../../types/domain.js";
import type { TerminalInstanceRepository } from "../../storage/repositories/terminal-instance-repository.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import { resolveWorkspaceCwd } from "./terminal-paths.js";
import { getDefaultShell, resolveRequestedShell } from "./terminal-shell.js";
import { PtyRuntimeManager, type TerminalRuntimeExitEvent } from "./runtime/pty-runtime-manager.js";
import {
  TerminalOutputBuffer,
  type TerminalBackfillResult
} from "./runtime/terminal-output-buffer.js";

interface CreateTerminalInput {
  workspaceId: string;
  name?: string;
  cwd?: string | null;
  shell?: string | null;
  createdByUserId: string;
  env?: Record<string, string>;
}

interface SubscribeTerminalCallbacks {
  onBackfill: (payload: TerminalBackfillResult) => Promise<void> | void;
  onOutput: (chunk: TerminalOutputChunk) => Promise<void> | void;
  onStatus: (terminal: TerminalInstance) => Promise<void> | void;
  onExit: (payload: { terminal: TerminalInstance; requestedClose: boolean }) => Promise<void> | void;
}

type TerminalCloseReason = "user_closed" | "idle_timeout";

export declare interface TerminalService {
  on(event: "output", listener: (event: { terminalId: string; chunks: TerminalOutputChunk[] }) => void): this;
  on(event: "status", listener: (terminal: TerminalInstance) => void): this;
  on(
    event: "exit",
    listener: (event: { terminal: TerminalInstance; requestedClose: boolean }) => void
  ): this;
  emit(event: "output", eventPayload: { terminalId: string; chunks: TerminalOutputChunk[] }): boolean;
  emit(event: "status", terminal: TerminalInstance): boolean;
  emit(
    event: "exit",
    eventPayload: { terminal: TerminalInstance; requestedClose: boolean }
  ): boolean;
}

export class TerminalService extends EventEmitter {
  private readonly outputBuffer = new TerminalOutputBuffer();
  private readonly runtimeManager = new PtyRuntimeManager();
  private readonly lastPersistedActivity = new Map<string, number>();
  private readonly activeSubscribers = new Map<string, number>();
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingCloseReasons = new Map<string, TerminalCloseReason>();
  private isDisposing = false;

  constructor(
    private readonly db: Database.Database,
    private readonly terminalInstanceRepository: TerminalInstanceRepository,
    private readonly workspaceService: WorkspaceService,
    private readonly idleTimeoutSeconds: number
  ) {
    super();

    this.runtimeManager.on("output", (event) => {
      this.handleRuntimeOutput(event.terminalId, event.content);
    });
    this.runtimeManager.on("exit", (event) => {
      this.handleRuntimeExit(event);
    });
  }

  createTerminal(input: CreateTerminalInput): TerminalInstance {
    const workspace = this.workspaceService.getWorkspaceOrThrow(input.workspaceId);
    const now = nowIso();
    const shell = resolveRequestedShell(sanitizeShell(input.shell) ?? getDefaultShell());
    const cwd = resolveWorkspaceCwd(workspace.path, input.cwd);
    const terminal: TerminalInstance = {
      id: createId(),
      workspaceId: workspace.id,
      name: input.name?.trim() || `终端 ${new Date().toISOString().slice(11, 19)}`,
      cwd,
      shell,
      status: "creating",
      createdByUserId: input.createdByUserId,
      createdAt: now,
      lastActiveAt: now,
      closedAt: null,
      exitCode: null,
      statusDetail: null
    };

    const persist = this.db.transaction(() => {
      this.terminalInstanceRepository.create(terminal);
    });

    persist();

    try {
      this.runtimeManager.start(terminal, buildTerminalEnv(input.env));

      const runningTerminal: TerminalInstance = {
        ...terminal,
        status: "running"
      };
      this.terminalInstanceRepository.updateLifecycle({
        id: runningTerminal.id,
        status: runningTerminal.status,
        lastActiveAt: runningTerminal.lastActiveAt,
        closedAt: null,
        exitCode: null,
        statusDetail: null
      });
      this.emit("status", runningTerminal);
      this.scheduleIdleCleanup(runningTerminal.id);

      return runningTerminal;
    } catch (error) {
      const failedAt = nowIso();
      this.terminalInstanceRepository.updateLifecycle({
        id: terminal.id,
        status: "error",
        lastActiveAt: failedAt,
        closedAt: failedAt,
        exitCode: null,
        statusDetail: error instanceof Error ? error.message : "PTY 启动失败"
      });
      const failedTerminal = this.getTerminalOrThrow(terminal.id);
      this.emit("status", failedTerminal);
      throw error;
    }
  }

  listTerminals(workspaceId: string): TerminalInstance[] {
    this.workspaceService.getWorkspaceOrThrow(workspaceId);
    return this.terminalInstanceRepository.listByWorkspace(workspaceId);
  }

  getTerminalOrThrow(terminalId: string): TerminalInstance {
    const terminal = this.terminalInstanceRepository.findById(terminalId);

    if (!terminal) {
      throw new AppError({
        statusCode: 404,
        errorCode: "TERMINAL_NOT_FOUND",
        detail: "指定终端不存在"
      });
    }

    return terminal;
  }

  closeTerminal(
    terminalId: string,
    reason: TerminalCloseReason = "user_closed"
  ): { success: true } {
    const terminal = this.getTerminalOrThrow(terminalId);
    this.cancelIdleCleanup(terminalId);
    this.activeSubscribers.delete(terminalId);
    this.pendingCloseReasons.set(terminalId, reason);

    if (terminal.status === "closed" || terminal.status === "error") {
      this.pendingCloseReasons.delete(terminalId);
      return { success: true };
    }

    if (!this.runtimeManager.isRunning(terminalId)) {
      const closedAt = nowIso();
      this.terminalInstanceRepository.updateLifecycle({
        id: terminalId,
        status: "closed",
        lastActiveAt: closedAt,
        closedAt,
        exitCode: terminal.exitCode,
        statusDetail: resolveClosedStatusDetail(reason, terminal.statusDetail)
      });
      this.pendingCloseReasons.delete(terminalId);
      this.emit("status", this.getTerminalOrThrow(terminalId));
      return { success: true };
    }

    this.runtimeManager.close(terminalId);
    return { success: true };
  }

  writeInput(terminalId: string, content: string): { accepted: true } {
    if (!content) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "终端输入不能为空",
        field: "content"
      });
    }

    this.getTerminalOrThrow(terminalId);
    this.runtimeManager.write(terminalId, content);
    this.touchLastActiveAt(terminalId);

    return { accepted: true };
  }

  resizeTerminal(terminalId: string, cols: number, rows: number): { accepted: true } {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || rows < 5) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_TERMINAL_SIZE",
        detail: "终端尺寸不合法",
        field: "cols"
      });
    }

    this.getTerminalOrThrow(terminalId);
    this.runtimeManager.resize(terminalId, cols, rows);
    this.touchLastActiveAt(terminalId);

    return { accepted: true };
  }

  subscribeTerminal(
    terminalId: string,
    lastCursor: string | null,
    callbacks: SubscribeTerminalCallbacks
  ): { close(): void } {
    const terminal = this.getTerminalOrThrow(terminalId);
    const backfill = this.outputBuffer.readSince(terminalId, lastCursor);
    this.cancelIdleCleanup(terminalId);
    this.activeSubscribers.set(terminalId, (this.activeSubscribers.get(terminalId) ?? 0) + 1);

    void callbacks.onStatus(terminal);
    void callbacks.onBackfill(backfill);

    const outputListener = (event: { terminalId: string; chunks: TerminalOutputChunk[] }) => {
      if (event.terminalId !== terminalId) {
        return;
      }

      for (const chunk of event.chunks) {
        void callbacks.onOutput(chunk);
      }
    };
    const statusListener = (nextTerminal: TerminalInstance) => {
      if (nextTerminal.id !== terminalId) {
        return;
      }

      void callbacks.onStatus(nextTerminal);
    };
    const exitListener = (event: { terminal: TerminalInstance; requestedClose: boolean }) => {
      if (event.terminal.id !== terminalId) {
        return;
      }

      void callbacks.onExit(event);
    };

    this.on("output", outputListener);
    this.on("status", statusListener);
    this.on("exit", exitListener);

    return {
      close: () => {
        this.off("output", outputListener);
        this.off("status", statusListener);
        this.off("exit", exitListener);
        this.releaseSubscription(terminalId);
      }
    };
  }

  async dispose(): Promise<void> {
    this.isDisposing = true;

    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }

    this.idleTimers.clear();
    this.runtimeManager.closeAll();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  private handleRuntimeOutput(terminalId: string, content: string): void {
    if (this.isDisposing) {
      return;
    }

    const chunks = this.outputBuffer.append(terminalId, content);

    if (chunks.length === 0) {
      return;
    }

    this.touchLastActiveAt(terminalId);
    this.emit("output", {
      terminalId,
      chunks
    });
  }

  private handleRuntimeExit(event: TerminalRuntimeExitEvent): void {
    if (this.isDisposing) {
      return;
    }

    this.cancelIdleCleanup(event.terminalId);
    this.activeSubscribers.delete(event.terminalId);
    const closeReason = this.pendingCloseReasons.get(event.terminalId) ?? "user_closed";
    this.pendingCloseReasons.delete(event.terminalId);
    const current = this.getTerminalOrThrow(event.terminalId);
    const finishedAt = nowIso();
    const status =
      event.requestedClose || event.exitCode === 0 ? ("closed" as const) : ("error" as const);

    this.terminalInstanceRepository.updateLifecycle({
      id: event.terminalId,
      status,
      lastActiveAt: finishedAt,
      closedAt: finishedAt,
      exitCode: event.exitCode,
      statusDetail:
        status === "error"
          ? `终端异常退出，exitCode=${event.exitCode ?? "unknown"}`
          : resolveClosedStatusDetail(closeReason, current.statusDetail)
    });

    const updated = this.getTerminalOrThrow(event.terminalId);
    this.emit("status", updated);
    this.emit("exit", {
      terminal: updated,
      requestedClose: event.requestedClose
    });
  }

  private touchLastActiveAt(terminalId: string): void {
    if (this.isDisposing) {
      return;
    }

    this.cancelIdleCleanup(terminalId);
    const hasSubscribers = (this.activeSubscribers.get(terminalId) ?? 0) > 0;
    const now = Date.now();
    const previous = this.lastPersistedActivity.get(terminalId) ?? 0;

    if (now - previous >= 500) {
      this.lastPersistedActivity.set(terminalId, now);
      this.terminalInstanceRepository.touchLastActiveAt(terminalId, nowIso(new Date(now)));
    }

    if (!hasSubscribers) {
      // 终端重新活跃后，从当前时刻重新计算空闲清理窗口。
      this.scheduleIdleCleanup(terminalId);
    }
  }

  private releaseSubscription(terminalId: string): void {
    const current = this.activeSubscribers.get(terminalId) ?? 0;

    if (current <= 1) {
      this.activeSubscribers.delete(terminalId);
      this.scheduleIdleCleanup(terminalId);
      return;
    }

    this.activeSubscribers.set(terminalId, current - 1);
  }

  private scheduleIdleCleanup(terminalId: string): void {
    this.cancelIdleCleanup(terminalId);

    if (this.idleTimeoutSeconds <= 0 || !this.runtimeManager.isRunning(terminalId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.idleTimers.delete(terminalId);

      if ((this.activeSubscribers.get(terminalId) ?? 0) > 0) {
        return;
      }

      if (!this.runtimeManager.isRunning(terminalId)) {
        return;
      }

      this.closeTerminal(terminalId, "idle_timeout");
    }, this.idleTimeoutSeconds * 1000);

    timer.unref?.();
    this.idleTimers.set(terminalId, timer);
  }

  private cancelIdleCleanup(terminalId: string): void {
    const timer = this.idleTimers.get(terminalId);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.idleTimers.delete(terminalId);
  }
}

function sanitizeShell(shell?: string | null): string | null {
  const value = shell?.trim();

  if (!value) {
    return null;
  }

  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_SHELL",
      detail: "shell 不能包含非法控制字符",
      field: "shell"
    });
  }

  return value;
}

function buildTerminalEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(extraEnv ?? {})) {
    env[key] = value;
  }

  return env;
}

function resolveClosedStatusDetail(
  reason: TerminalCloseReason,
  currentStatusDetail: string | null
): string | null {
  if (reason === "idle_timeout") {
    return "TERMINAL_IDLE_TIMEOUT";
  }

  return currentStatusDetail;
}
