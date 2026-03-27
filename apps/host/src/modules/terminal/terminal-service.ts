import { EventEmitter } from "node:events";
import path from "node:path";

import type Database from "better-sqlite3";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  TerminalInstance,
  TerminalOutputChunk,
  TerminalRuntimeSession,
  TerminalRuntimeType
} from "../../types/domain.js";
import type { TerminalInstanceRepository } from "../../storage/repositories/terminal-instance-repository.js";
import type { TerminalRuntimeSessionRepository } from "../../storage/repositories/terminal-runtime-session-repository.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import { resolveWorkspaceCwd } from "./terminal-paths.js";
import { getDefaultShell, resolveRequestedShell } from "./terminal-shell.js";
import {
  TerminalOutputBuffer,
  type TerminalBackfillResult
} from "./runtime/terminal-output-buffer.js";
import {
  TerminalRuntimeManager,
  type RuntimeAttachmentExitEvent
} from "./runtime/terminal-runtime-manager.js";

interface CreateTerminalInput {
  workspaceId: string;
  name?: string;
  cwd?: string | null;
  shell?: string | null;
  runtimeType?: TerminalRuntimeType | null;
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
  private readonly runtimeManager = new TerminalRuntimeManager();
  private readonly lastPersistedActivity = new Map<string, number>();
  private readonly terminalSubscriptionCounts = new Map<string, number>();
  private readonly pendingCloseReasons = new Map<string, TerminalCloseReason>();
  private readonly pendingDeletedTerminalIds = new Set<string>();
  private isDisposing = false;

  constructor(
    private readonly db: Database.Database,
    private readonly terminalInstanceRepository: TerminalInstanceRepository,
    private readonly terminalRuntimeSessionRepository: TerminalRuntimeSessionRepository,
    private readonly workspaceService: WorkspaceService,
    _idleTimeoutSeconds: number
  ) {
    super();

    this.runtimeManager.on("output", (event) => {
      this.handleRuntimeOutput(event.terminalId, event.content);
    });
    this.runtimeManager.on("exit", (event) => {
      this.handleRuntimeExit(event);
    });

    this.recoverRuntimeStates();
  }

  createTerminal(input: CreateTerminalInput): TerminalInstance {
    const workspace = this.workspaceService.getWorkspaceOrThrow(input.workspaceId);
    const now = nowIso();
    const shell = resolveRequestedShell(sanitizeShell(input.shell) ?? getDefaultShell());
    const cwd = resolveWorkspaceCwd(workspace.path, input.cwd);
    const runtimeType = resolveRequestedRuntimeType(input.runtimeType);
    const runtimeSessionId = createId();
    const attachTarget = buildAttachTarget(runtimeType, runtimeSessionId);
    const terminal: TerminalInstance = {
      id: createId(),
      workspaceId: workspace.id,
      name: input.name?.trim() || buildDefaultTerminalName(cwd),
      cwd,
      shell,
      runtimeType,
      runtimeSessionId,
      attachTarget,
      status: "creating",
      processId: null,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      lastActiveAt: now,
      closedAt: null,
      exitCode: null,
      statusDetail: null
    };
    const runtimeSession: TerminalRuntimeSession = {
      id: runtimeSessionId,
      terminalId: terminal.id,
      runtimeType,
      sessionKey: runtimeSessionId,
      attachTarget,
      hostInstanceId: null,
      agentPid: null,
      shellPid: null,
      state: "starting",
      lastHeartbeatAt: null,
      lastCheckedAt: now,
      lastErrorDetail: null,
      createdAt: now,
      updatedAt: now
    };

    const persist = this.db.transaction(() => {
      this.terminalInstanceRepository.create(terminal);
      this.terminalRuntimeSessionRepository.create(runtimeSession);
    });

    persist();

    try {
      const env = buildTerminalEnv(input.env);
      const createdInspection = this.runtimeManager.createPersistentSession(
        terminal,
        runtimeSession,
        env
      );
      const attachmentProcessId = this.runtimeManager.ensureAttached(terminal, runtimeSession, env);
      const processId = createdInspection.shellPid ?? attachmentProcessId;

      const runningTerminal: TerminalInstance = {
        ...terminal,
        status: "running",
        processId
      };
      this.terminalInstanceRepository.updateLifecycle({
        id: runningTerminal.id,
        status: runningTerminal.status,
        processId: runningTerminal.processId,
        lastActiveAt: runningTerminal.lastActiveAt,
        closedAt: null,
        exitCode: null,
        statusDetail: null
      });
      this.terminalRuntimeSessionRepository.updateState({
        id: runtimeSession.id,
        shellPid: processId,
        state: "running",
        lastCheckedAt: nowIso(),
        lastErrorDetail: createdInspection.detail,
        updatedAt: nowIso()
      });
      this.emit("status", runningTerminal);

      return runningTerminal;
    } catch (error) {
      const failedAt = nowIso();
      this.terminalInstanceRepository.updateLifecycle({
        id: terminal.id,
        status: "error",
        processId: terminal.processId,
        lastActiveAt: failedAt,
        closedAt: failedAt,
        exitCode: null,
        statusDetail: error instanceof Error ? error.message : "PTY 启动失败"
      });
      this.terminalRuntimeSessionRepository.updateState({
        id: runtimeSession.id,
        shellPid: null,
        state: "error",
        lastCheckedAt: failedAt,
        lastErrorDetail: error instanceof Error ? error.message : "PTY 启动失败",
        updatedAt: failedAt
      });
      const failedTerminal = this.getTerminalOrThrow(terminal.id);
      this.emit("status", failedTerminal);
      throw error;
    }
  }

  listTerminals(workspaceId: string): TerminalInstance[] {
    this.workspaceService.getWorkspaceOrThrow(workspaceId);
    const terminals = this.terminalInstanceRepository.listByWorkspace(workspaceId);
    let hasLifecycleChange = false;

    for (const terminal of terminals) {
      if (this.reconcileTerminalRuntime(terminal)) {
        hasLifecycleChange = true;
      }
    }

    return hasLifecycleChange
      ? this.terminalInstanceRepository.listByWorkspace(workspaceId)
      : terminals;
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

  getRuntimeSessionOrThrow(runtimeSessionId: string): TerminalRuntimeSession {
    const session = this.terminalRuntimeSessionRepository.findById(runtimeSessionId);

    if (!session) {
      throw new AppError({
        statusCode: 404,
        errorCode: "RUNTIME_SESSION_NOT_FOUND",
        detail: "指定终端运行时会话不存在"
      });
    }

    return session;
  }

  closeTerminal(
    terminalId: string,
    reason: TerminalCloseReason = "user_closed"
  ): { success: true } {
    const terminal = this.getTerminalOrThrow(terminalId);
    const session = this.getRuntimeSessionOrThrow(terminal.runtimeSessionId);
    this.pendingCloseReasons.set(terminalId, reason);

    if (terminal.status === "closed" || terminal.status === "error") {
      this.pendingCloseReasons.delete(terminalId);
      return { success: true };
    }

    const willEmitExit = this.runtimeManager.terminateSession(terminal, session);

    if (!willEmitExit) {
      this.finalizeTerminalClosure(terminal, session, {
        requestedClose: true,
        exitCode: 0,
        sessionAlive: false,
        sessionDetail: null,
        shellPid: null
      });
    }

    return { success: true };
  }

  deleteTerminal(terminalId: string): { success: true } {
    const terminal = this.getTerminalOrThrow(terminalId);
    const session = this.getRuntimeSessionOrThrow(terminal.runtimeSessionId);
    this.pendingCloseReasons.delete(terminalId);
    this.lastPersistedActivity.delete(terminalId);
    this.outputBuffer.clear(terminalId);
    this.pendingDeletedTerminalIds.add(terminalId);
    const deleteRecords = this.db.transaction(() => {
      this.terminalRuntimeSessionRepository.deleteByTerminalId(terminalId);
      this.terminalInstanceRepository.delete(terminalId);
    });

    try {
      deleteRecords();
    } catch (error) {
      this.pendingDeletedTerminalIds.delete(terminalId);
      throw error;
    }

    let willEmitExit = false;

    try {
      willEmitExit = this.runtimeManager.terminateSession(terminal, session);
    } catch (error) {
      this.pendingDeletedTerminalIds.delete(terminalId);
      console.warn("[terminal-delete-runtime-cleanup-failed]", {
        terminalId,
        runtimeSessionId: session.id,
        runtimeType: session.runtimeType,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    if (!willEmitExit) {
      this.pendingDeletedTerminalIds.delete(terminalId);
    }

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

    const terminal = this.ensureTerminalInteractive(terminalId);
    this.runtimeManager.write(terminal.id, content);
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

    const terminal = this.ensureTerminalInteractive(terminalId);
    this.runtimeManager.resize(terminal.id, cols, rows);
    this.touchLastActiveAt(terminalId);

    return { accepted: true };
  }

  subscribeTerminal(
    terminalId: string,
    lastCursor: string | null,
    callbacks: SubscribeTerminalCallbacks
  ): { close(): void } {
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

    this.retainTerminalSubscription(terminalId);

    try {
      const current = this.ensureTerminalAttachedForSubscription(terminalId);
      const backfill = this.outputBuffer.readSince(terminalId, lastCursor);

      void callbacks.onStatus(current);
      void callbacks.onBackfill(backfill);
    } catch (error) {
      this.off("output", outputListener);
      this.off("status", statusListener);
      this.off("exit", exitListener);
      this.releaseTerminalSubscription(terminalId);
      throw error;
    }

    let closed = false;

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        this.off("output", outputListener);
        this.off("status", statusListener);
        this.off("exit", exitListener);
        this.releaseTerminalSubscription(terminalId);
      }
    };
  }

  async dispose(): Promise<void> {
    this.isDisposing = true;
    this.runtimeManager.closeAllAttachments();
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

  private handleRuntimeExit(event: RuntimeAttachmentExitEvent): void {
    if (this.isDisposing) {
      return;
    }

    if (this.pendingDeletedTerminalIds.delete(event.terminalId)) {
      this.pendingCloseReasons.delete(event.terminalId);
      this.lastPersistedActivity.delete(event.terminalId);
      this.outputBuffer.clear(event.terminalId);
      return;
    }

    const current = this.getTerminalOrThrow(event.terminalId);
    const session = this.getRuntimeSessionOrThrow(current.runtimeSessionId);

    if (event.sessionAlive && !event.requestedClose) {
      this.markTerminalRunning(current, session, event.shellPid, event.sessionDetail);
      return;
    }

    this.finalizeTerminalClosure(current, session, event);
  }

  private touchLastActiveAt(terminalId: string): void {
    if (this.isDisposing) {
      return;
    }

    const now = Date.now();
    const previous = this.lastPersistedActivity.get(terminalId) ?? 0;

    if (now - previous >= 500) {
      this.lastPersistedActivity.set(terminalId, now);
      this.terminalInstanceRepository.touchLastActiveAt(terminalId, nowIso(new Date(now)));
    }
  }

  private ensureTerminalInteractive(terminalId: string): TerminalInstance {
    const terminal = this.getTerminalOrThrow(terminalId);
    const session = this.getRuntimeSessionOrThrow(terminal.runtimeSessionId);
    const nextTerminal = this.ensureTerminalRunning(terminal, session, true);

    if (nextTerminal.status !== "running") {
      throw new AppError({
        statusCode: 409,
        errorCode: "TERMINAL_NOT_RUNNING",
        detail: nextTerminal.statusDetail ?? "终端当前不可写入"
      });
    }

    return nextTerminal;
  }

  private ensureTerminalAttachedForSubscription(terminalId: string): TerminalInstance {
    const terminal = this.getTerminalOrThrow(terminalId);
    const session = this.getRuntimeSessionOrThrow(terminal.runtimeSessionId);
    return this.ensureTerminalRunning(terminal, session, true);
  }

  private ensureTerminalRunning(
    terminal: TerminalInstance,
    session: TerminalRuntimeSession,
    ensureAttached: boolean
  ): TerminalInstance {
    if (terminal.status === "closed" || terminal.status === "error") {
      return terminal;
    }

    const inspection = this.runtimeManager.inspectPersistentSession(terminal, session);

    if (!inspection.alive) {
      if (shouldMarkRuntimeLost(terminal, inspection.detail)) {
        return this.markTerminalLost(terminal, session, inspection.detail);
      }

      return this.markTerminalError(terminal, session, inspection.detail ?? buildMissingProcessStatusDetail(terminal));
    }

    if (ensureAttached) {
      const attachmentProcessId = this.runtimeManager.ensureAttached(terminal, session, buildTerminalEnv());
      return this.markTerminalRunning(
        terminal,
        session,
        inspection.shellPid ?? attachmentProcessId,
        inspection.detail
      );
    }

    return this.markTerminalRunning(terminal, session, inspection.shellPid, inspection.detail);
  }

  private reconcileTerminalRuntime(terminal: TerminalInstance): boolean {
    if (terminal.status === "closed" || terminal.status === "error") {
      return false;
    }

    const before = JSON.stringify({
      status: terminal.status,
      processId: terminal.processId,
      statusDetail: terminal.statusDetail
    });
    const session = this.getRuntimeSessionOrThrow(terminal.runtimeSessionId);
    const nextTerminal = this.ensureTerminalRunning(terminal, session, false);
    const after = JSON.stringify({
      status: nextTerminal.status,
      processId: nextTerminal.processId,
      statusDetail: nextTerminal.statusDetail
    });

    return before !== after;
  }

  private markTerminalRunning(
    terminal: TerminalInstance,
    session: TerminalRuntimeSession,
    processId: number | null,
    detail: string | null
  ): TerminalInstance {
    const shouldUpdate =
      terminal.status !== "running" ||
      terminal.processId !== processId ||
      terminal.closedAt !== null ||
      (terminal.statusDetail ?? null) !== (detail ?? null) ||
      session.state !== "running" ||
      session.shellPid !== processId ||
      (session.lastErrorDetail ?? null) !== (detail ?? null);

    if (!shouldUpdate) {
      return terminal;
    }

    const updatedAt = nowIso();
    this.terminalInstanceRepository.updateLifecycle({
      id: terminal.id,
      status: "running",
      processId,
      lastActiveAt: terminal.lastActiveAt,
      closedAt: null,
      exitCode: null,
      statusDetail: detail ?? null
    });
    this.terminalRuntimeSessionRepository.updateState({
      id: session.id,
      shellPid: processId,
      state: "running",
      lastCheckedAt: updatedAt,
      lastErrorDetail: detail ?? null,
      updatedAt
    });

    const updated = this.getTerminalOrThrow(terminal.id);
    this.emit("status", updated);
    return updated;
  }

  private markTerminalLost(
    terminal: TerminalInstance,
    session: TerminalRuntimeSession,
    detail: string | null
  ): TerminalInstance {
    const updatedAt = nowIso();
    this.terminalRuntimeSessionRepository.updateState({
      id: session.id,
      shellPid: terminal.processId,
      state: "lost",
      lastCheckedAt: updatedAt,
      lastErrorDetail: detail ?? "RUNTIME_LOST",
      updatedAt
    });

    this.terminalInstanceRepository.updateLifecycle({
      id: terminal.id,
      status: "running",
      processId: terminal.processId,
      lastActiveAt: terminal.lastActiveAt,
      closedAt: null,
      exitCode: null,
      statusDetail: detail ?? terminal.statusDetail
    });

    const updated = this.getTerminalOrThrow(terminal.id);
    this.emit("status", updated);
    return updated;
  }

  private markTerminalError(
    terminal: TerminalInstance,
    session: TerminalRuntimeSession,
    detail: string
  ): TerminalInstance {
    const closedAt = nowIso();
    this.terminalInstanceRepository.updateLifecycle({
      id: terminal.id,
      status: "error",
      processId: terminal.processId,
      lastActiveAt: closedAt,
      closedAt,
      exitCode: terminal.exitCode,
      statusDetail: detail
    });
    this.terminalRuntimeSessionRepository.updateState({
      id: session.id,
      shellPid: terminal.processId,
      state: "error",
      lastCheckedAt: closedAt,
      lastErrorDetail: detail,
      updatedAt: closedAt
    });

    const updated = this.getTerminalOrThrow(terminal.id);
    this.emit("status", updated);
    return updated;
  }

  private finalizeTerminalClosure(
    terminal: TerminalInstance,
    session: TerminalRuntimeSession,
    event: Pick<
      RuntimeAttachmentExitEvent,
      "requestedClose" | "exitCode" | "sessionAlive" | "sessionDetail" | "shellPid"
    >
  ): void {
    const closeReason = this.pendingCloseReasons.get(terminal.id) ?? "user_closed";
    this.pendingCloseReasons.delete(terminal.id);
    const finishedAt = nowIso();
    const status =
      event.requestedClose || event.exitCode === 0 ? ("closed" as const) : ("error" as const);
    const statusDetail =
      status === "error"
        ? event.sessionDetail ?? `终端异常退出，exitCode=${event.exitCode ?? "unknown"}`
        : resolveClosedStatusDetail(closeReason, terminal.statusDetail);

    this.terminalInstanceRepository.updateLifecycle({
      id: terminal.id,
      status,
      processId: event.shellPid ?? terminal.processId,
      lastActiveAt: finishedAt,
      closedAt: finishedAt,
      exitCode: event.exitCode,
      statusDetail
    });
    this.terminalRuntimeSessionRepository.updateState({
      id: session.id,
      shellPid: event.shellPid,
      state: status === "closed" ? "closed" : "error",
      lastCheckedAt: finishedAt,
      lastErrorDetail: status === "error" ? statusDetail : null,
      updatedAt: finishedAt
    });

    const updated = this.getTerminalOrThrow(terminal.id);
    this.emit("status", updated);
    this.emit("exit", {
      terminal: updated,
      requestedClose: event.requestedClose
    });
  }

  private recoverRuntimeStates(): void {
    const terminals = this.terminalInstanceRepository.listRecoverable();

    for (const terminal of terminals) {
      const session = this.terminalRuntimeSessionRepository.findById(terminal.runtimeSessionId);

      if (!session) {
        this.markTerminalError(terminal, {
          id: terminal.runtimeSessionId,
          terminalId: terminal.id,
          runtimeType: terminal.runtimeType,
          sessionKey: terminal.runtimeSessionId,
          attachTarget: terminal.attachTarget,
          hostInstanceId: null,
          agentPid: null,
          shellPid: terminal.processId,
          state: "error",
          lastHeartbeatAt: null,
          lastCheckedAt: null,
          lastErrorDetail: "RUNTIME_SESSION_MISSING",
          createdAt: terminal.createdAt,
          updatedAt: terminal.lastActiveAt
        }, "RUNTIME_SESSION_MISSING");
        continue;
      }

      this.ensureTerminalRunning(terminal, session, false);
    }
  }

  private retainTerminalSubscription(terminalId: string): void {
    const currentCount = this.terminalSubscriptionCounts.get(terminalId) ?? 0;
    this.terminalSubscriptionCounts.set(terminalId, currentCount + 1);
  }

  private releaseTerminalSubscription(terminalId: string): void {
    const currentCount = this.terminalSubscriptionCounts.get(terminalId) ?? 0;

    if (currentCount <= 1) {
      this.terminalSubscriptionCounts.delete(terminalId);
      this.detachRuntimeAttachmentIfIdle(terminalId);
      return;
    }

    this.terminalSubscriptionCounts.set(terminalId, currentCount - 1);
  }

  private detachRuntimeAttachmentIfIdle(terminalId: string): void {
    if (this.isDisposing) {
      return;
    }

    const terminal = this.terminalInstanceRepository.findById(terminalId);

    if (!terminal || terminal.status !== "running") {
      return;
    }

    const session = this.terminalRuntimeSessionRepository.findById(terminal.runtimeSessionId);

    if (!session || session.runtimeType === "embedded-pty") {
      return;
    }

    this.runtimeManager.detach(terminalId);
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

function resolveRequestedRuntimeType(input?: TerminalRuntimeType | null): TerminalRuntimeType {
  const runtimeType = input ?? (process.platform === "win32" ? "embedded-pty" : "tmux");

  if (
    runtimeType !== "embedded-pty" &&
    runtimeType !== "tmux"
  ) {
    throw new AppError({
      statusCode: 400,
      errorCode: "UNSUPPORTED_TERMINAL_RUNTIME",
      detail: `当前 Host 还未实现 runtime=${runtimeType}`
    });
  }

  return runtimeType;
}

function buildAttachTarget(runtimeType: TerminalRuntimeType, runtimeSessionId: string): string {
  if (runtimeType === "embedded-pty") {
    return `embedded:${runtimeSessionId}`;
  }

  return `${runtimeType}:${runtimeSessionId}`;
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

function buildDefaultTerminalName(cwd: string): string {
  const folderName = path.basename(cwd).trim();
  return folderName || "终端";
}

function buildMissingProcessStatusDetail(terminal: TerminalInstance): string {
  if (terminal.processId && !isProcessAlive(terminal.processId)) {
    return `终端绑定进程已停止，PID=${terminal.processId}`;
  }

  if (terminal.processId) {
    return `终端运行时已经失联，PID=${terminal.processId}`;
  }

  return "终端运行时已经失联";
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
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

function shouldMarkRuntimeLost(
  terminal: TerminalInstance,
  detail: string | null
): boolean {
  return terminal.runtimeType !== "embedded-pty" && Boolean(detail?.includes("检查失败"));
}
