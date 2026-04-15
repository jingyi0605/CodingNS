import { EventEmitter } from "node:events";
import path from "node:path";

import type Database from "better-sqlite3";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import {
  isTerminalDebugEnabled,
  logTerminalDebug,
  terminalDebugNowMs
} from "../../shared/utils/terminal-debug-log.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  TerminalInstance,
  TerminalOutputChunk,
  TerminalRuntimeSession,
  TerminalRuntimeType
} from "../../types/domain.js";
import type { TerminalInstanceRepository } from "../../storage/repositories/terminal-instance-repository.js";
import type { TerminalLogFileRepository } from "../../storage/repositories/terminal-log-file-repository.js";
import type { TerminalLogSegmentRepository } from "../../storage/repositories/terminal-log-segment-repository.js";
import type { TerminalRuntimeSessionRepository } from "../../storage/repositories/terminal-runtime-session-repository.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import { resolveWorkspaceCwd } from "./terminal-paths.js";
import {
  getDefaultShell,
  resolveRequestedShell,
  resolveWindowsPersistentRuntimeType
} from "./terminal-shell.js";
import type { TerminalHistoryPageDto } from "./terminal-history.js";
import {
  captureTmuxPaneContent
} from "./runtime/adapters/tmux-runtime-adapter.js";
import { isConptyRuntimeType } from "./runtime/conpty-runtime-shared.js";
import { TerminalLogFileStore } from "./runtime/terminal-log-file-store.js";
import { TerminalLogSpooler } from "./runtime/terminal-log-spooler.js";
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
  debugRuntimeSessionId?: string | null;
  debugTargetId?: string | null;
  debugServiceId?: string | null;
  frameworkAnalysisId?: string | null;
  launcherSourceType?: TerminalInstance["launcherSourceType"];
  launchStage?: string | null;
  failureStage?: string | null;
  adapterKind?: TerminalInstance["adapterKind"];
  envPatchSummary?: Record<string, unknown>;
  artifactRef?: string | null;
}

interface TerminalInputDebugContext {
  clientTraceId?: string;
  clientSentAtMs?: number | null;
  wsReceivedAtMs?: number | null;
}

interface SubscribeTerminalCallbacks {
  onBackfill: (payload: TerminalBackfillResult) => Promise<void> | void;
  onOutput: (chunk: TerminalOutputChunk) => Promise<void> | void;
  onStatus: (terminal: TerminalInstance) => Promise<void> | void;
  onExit: (payload: { terminal: TerminalInstance; requestedClose: boolean }) => Promise<void> | void;
}

type TerminalCloseReason = "user_closed" | "idle_timeout";

interface TerminalServiceOptions {
  databasePath?: string;
  terminalLogRootDir?: string;
  terminalLogFileRepository?: TerminalLogFileRepository;
  terminalLogSegmentRepository?: TerminalLogSegmentRepository;
}

const TERMINAL_ACTIVITY_FLUSH_INTERVAL_MS = 2_000;
const TERMINAL_OUTPUT_FLUSH_INTERVAL_MS = 8;

interface PendingTerminalOutputBatch {
  contents: string[];
  timer: ReturnType<typeof setTimeout> | null;
}

interface PendingTerminalInputTrace {
  traceId: string;
  clientSentAtMs: number | null;
  wsReceivedAtMs: number | null;
  serviceWriteStartedAtMs: number;
  serviceWriteFinishedAtMs: number;
  charCount: number;
}

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
  private readonly terminalSubscriptionCounts = new Map<string, number>();
  private readonly pendingCloseReasons = new Map<string, TerminalCloseReason>();
  private readonly pendingDeletedTerminalIds = new Set<string>();
  private readonly pendingActivityByTerminalId = new Map<string, string>();
  private readonly pendingInputTraceByTerminalId = new Map<string, PendingTerminalInputTrace[]>();
  private readonly pendingOutputByTerminalId = new Map<string, PendingTerminalOutputBatch>();
  private readonly terminalLogSpooler: TerminalLogSpooler | null;
  private readonly terminalLogFileRepository: TerminalLogFileRepository | null;
  private readonly terminalLogSegmentRepository: TerminalLogSegmentRepository | null;
  private readonly terminalLogFileStore: TerminalLogFileStore | null;
  private activityFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private isDisposing = false;

  constructor(
    private readonly db: Database.Database,
    private readonly terminalInstanceRepository: TerminalInstanceRepository,
    private readonly terminalRuntimeSessionRepository: TerminalRuntimeSessionRepository,
    private readonly workspaceService: WorkspaceService,
    _idleTimeoutSeconds: number,
    options: TerminalServiceOptions = {}
  ) {
    super();

    this.terminalLogFileRepository = options.terminalLogFileRepository ?? null;
    this.terminalLogSegmentRepository = options.terminalLogSegmentRepository ?? null;
    this.terminalLogFileStore = options.terminalLogRootDir
      ? new TerminalLogFileStore(options.terminalLogRootDir)
      : null;

    this.terminalLogSpooler =
      options.terminalLogRootDir &&
      options.terminalLogFileRepository &&
      options.terminalLogSegmentRepository
        ? new TerminalLogSpooler({
            databasePath: options.databasePath,
            logRootDir: options.terminalLogRootDir,
            fileRepository: options.terminalLogFileRepository,
            segmentRepository: options.terminalLogSegmentRepository
          })
        : null;

    this.runtimeManager.on("output", (event) => {
      this.handleRuntimeOutput(event.terminalId, event.content);
    });
    this.runtimeManager.on("exit", (event) => {
      this.handleRuntimeExit(event);
    });

    this.recoverRuntimeStates();
  }

  async createTerminal(input: CreateTerminalInput): Promise<TerminalInstance> {
    const workspace = this.workspaceService.getWorkspaceOrThrow(input.workspaceId);
    const existingTerminals = this.terminalInstanceRepository.listByWorkspace(workspace.id);
    const now = nowIso();
    const shell = resolveRequestedShell(sanitizeShell(input.shell) ?? getDefaultShell());
    const cwd = resolveWorkspaceCwd(workspace.path, input.cwd);
    const runtimeType = resolveRequestedRuntimeType(input.runtimeType, shell);
    const runtimeSessionId = createId();
    const attachTarget = buildAttachTarget(runtimeType, runtimeSessionId);
    const terminal: TerminalInstance = {
      id: createId(),
      workspaceId: workspace.id,
      name: input.name?.trim() || buildDefaultTerminalName(cwd, existingTerminals),
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
      statusDetail: null,
      debugRuntimeSessionId: input.debugRuntimeSessionId ?? null,
      debugTargetId: input.debugTargetId ?? null,
      debugServiceId: input.debugServiceId ?? null,
      frameworkAnalysisId: input.frameworkAnalysisId ?? null,
      launcherSourceType: input.launcherSourceType ?? null,
      launchStage: input.launchStage ?? null,
      failureStage: input.failureStage ?? null,
      adapterKind: input.adapterKind ?? null,
      envPatchSummary: input.envPatchSummary ?? undefined,
      artifactRef: input.artifactRef ?? null
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
      const createdInspection = await this.runtimeManager.createPersistentSession(
        terminal,
        runtimeSession,
        env
      );
      runtimeSession.agentPid = createdInspection.agentPid ?? runtimeSession.agentPid;
      const attachmentProcessId = await this.runtimeManager.ensureAttached(terminal, runtimeSession, env);
      const processId = createdInspection.shellPid ?? attachmentProcessId;
      terminal.processId = processId;
      runtimeSession.shellPid = processId;

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
        agentPid: createdInspection.agentPid ?? runtimeSession.agentPid,
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
        agentPid: runtimeSession.agentPid,
        shellPid: null,
        state: "error",
        lastCheckedAt: failedAt,
        lastErrorDetail: error instanceof Error ? error.message : "PTY 启动失败",
        updatedAt: failedAt
      });
      if (runtimeSession.agentPid) {
        try {
          process.kill(runtimeSession.agentPid);
        } catch {
          // agent 已退出时忽略。
        }
      }
      const failedTerminal = this.getTerminalOrThrow(terminal.id);
      this.emit("status", failedTerminal);
      throw error;
    }
  }

  async listTerminals(workspaceId: string): Promise<TerminalInstance[]> {
    this.workspaceService.getWorkspaceOrThrow(workspaceId);
    const terminals = this.terminalInstanceRepository.listByWorkspace(workspaceId);
    let hasLifecycleChange = false;

    for (const terminal of terminals) {
      if (await this.reconcileTerminalRuntime(terminal)) {
        hasLifecycleChange = true;
      }
    }

    return hasLifecycleChange
      ? this.terminalInstanceRepository.listByWorkspace(workspaceId)
      : terminals;
  }

  listTerminalSnapshotItems(workspaceId: string): TerminalInstance[] {
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

  async closeTerminal(
    terminalId: string,
    reason: TerminalCloseReason = "user_closed"
  ): Promise<{ success: true }> {
    const terminal = this.getTerminalOrThrow(terminalId);
    const session = this.getRuntimeSessionOrThrow(terminal.runtimeSessionId);
    this.pendingCloseReasons.set(terminalId, reason);

    if (terminal.status === "closed" || terminal.status === "error") {
      this.pendingCloseReasons.delete(terminalId);
      return { success: true };
    }

    await this.flushTerminalLogs(terminalId);
    const willEmitExit = await this.runtimeManager.terminateSession(terminal, session);

    if (!willEmitExit) {
      await this.finalizeTerminalClosure(terminal, session, {
        requestedClose: true,
        exitCode: 0,
        sessionAlive: false,
        sessionDetail: null,
        shellPid: null
      });
    }

    return { success: true };
  }

  async deleteTerminal(terminalId: string): Promise<{ success: true }> {
    const terminal = this.getTerminalOrThrow(terminalId);
    const session = this.getRuntimeSessionOrThrow(terminal.runtimeSessionId);
    this.pendingCloseReasons.delete(terminalId);
    this.pendingActivityByTerminalId.delete(terminalId);
    this.clearActivityFlushTimerIfIdle();
    await this.flushTerminalLogs(terminalId);
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
      willEmitExit = await this.runtimeManager.terminateSession(terminal, session);
    } catch (error) {
      this.pendingDeletedTerminalIds.delete(terminalId);
      await this.clearTerminalLogs(terminalId);
      console.warn("[terminal-delete-runtime-cleanup-failed]", {
        terminalId,
        runtimeSessionId: session.id,
        runtimeType: session.runtimeType,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    if (!willEmitExit) {
      this.pendingDeletedTerminalIds.delete(terminalId);
      await this.clearTerminalLogs(terminalId);
    }

    return { success: true };
  }

  async writeInput(
    terminalId: string,
    content: string,
    debugContext: TerminalInputDebugContext = {}
  ): Promise<{ accepted: true }> {
    if (!content) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "终端输入不能为空",
        field: "content"
      });
    }

    const serviceWriteStartedAtMs = terminalDebugNowMs();
    const terminal = await this.ensureTerminalInteractive(terminalId);
    this.runtimeManager.write(terminal.id, content);
    const serviceWriteFinishedAtMs = terminalDebugNowMs();
    this.recordPendingInputTrace(terminalId, content, {
      ...debugContext,
      serviceWriteStartedAtMs,
      serviceWriteFinishedAtMs
    });
    logTerminalDebug("terminal.input.write_completed", {
      terminalId,
      traceId: debugContext.clientTraceId ?? null,
      charCount: content.length,
      ensureAndWriteMs: serviceWriteFinishedAtMs - serviceWriteStartedAtMs,
      wsToWriteMs:
        debugContext.wsReceivedAtMs === null || debugContext.wsReceivedAtMs === undefined
          ? null
          : serviceWriteFinishedAtMs - debugContext.wsReceivedAtMs,
      clientToWriteMs:
        debugContext.clientSentAtMs === null || debugContext.clientSentAtMs === undefined
          ? null
          : serviceWriteFinishedAtMs - debugContext.clientSentAtMs
    });
    this.touchLastActiveAt(terminalId);

    return { accepted: true };
  }

  async resizeTerminal(terminalId: string, cols: number, rows: number): Promise<{ accepted: true }> {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || rows < 5) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_TERMINAL_SIZE",
        detail: "终端尺寸不合法",
        field: "cols"
      });
    }

    const terminal = await this.ensureTerminalInteractive(terminalId);
    this.runtimeManager.resize(terminal.id, cols, rows);
    this.touchLastActiveAt(terminalId);

    return { accepted: true };
  }

  async subscribeTerminal(
    terminalId: string,
    lastCursor: string | null,
    callbacks: SubscribeTerminalCallbacks
  ): Promise<{ close(): void }> {
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
      const current = await this.ensureTerminalAttachedForSubscription(terminalId);
      const backfill = this.outputBuffer.readSince(terminalId, lastCursor);

      await callbacks.onStatus(current);
      await callbacks.onBackfill(backfill);
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
    this.flushPendingTerminalOutput();
    this.flushPendingActivity();
    await this.terminalLogSpooler?.dispose();
    this.runtimeManager.closeAllAttachments();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async readTerminalHistory(
    terminalId: string,
    beforeSeq: number | null,
    limit: number
  ): Promise<TerminalHistoryPageDto> {
    const terminal = this.getTerminalOrThrow(terminalId);
    await this.flushTerminalLogs(terminalId);
    const runtimeSession =
      terminal.runtimeSessionId
        ? this.terminalRuntimeSessionRepository.findById(terminal.runtimeSessionId)
        : null;

    if (beforeSeq === 1 && runtimeSession?.runtimeType === "tmux") {
      const capturedContent = normalizeTerminalHistoryContent(
        await captureTmuxPaneContent(runtimeSession.sessionKey)
      );
      const capturedLineCount = countTerminalHistoryLines(capturedContent);

      return {
        terminalId,
        content: capturedContent,
        lineCount: capturedLineCount,
        anchorLine: 0,
        replaceContent: true,
        hasMore: false,
        nextBeforeSeq: null
      };
    }

    const historyPage = this.readTerminalHistorySegments(terminalId, beforeSeq, limit);
    const orderedSegments = [...historyPage.segments].reverse();
    const content = normalizeTerminalHistoryContent(
      orderedSegments.map((segment) => segment.content).join("")
    );
    const lineCount = countTerminalHistoryLines(content);
    const shouldFallbackToTmuxPane =
      runtimeSession?.runtimeType === "tmux" &&
      !historyPage.hasMore &&
      historyPage.nextBeforeSeq === 1;

    return {
      terminalId,
      content,
      lineCount,
      anchorLine: lineCount,
      hasMore: shouldFallbackToTmuxPane ? true : historyPage.hasMore,
      nextBeforeSeq: historyPage.nextBeforeSeq
    };
  }

  private readTerminalHistorySegments(
    terminalId: string,
    beforeSeq: number | null,
    limit: number
  ): {
    terminalId: string;
    segments: Array<{
      id: string;
      fileId: string;
      startSeq: number;
      endSeq: number;
      content: string;
      byteLength: number;
      createdAt: string;
    }>;
    hasMore: boolean;
    nextBeforeSeq: number | null;
  } {
    this.getTerminalOrThrow(terminalId);

    if (!this.terminalLogSegmentRepository || !this.terminalLogFileRepository || !this.terminalLogFileStore) {
      return {
        terminalId,
        segments: [],
        hasMore: false,
        nextBeforeSeq: null
      };
    }

    const terminalLogSegmentRepository = this.terminalLogSegmentRepository;
    const terminalLogFileRepository = this.terminalLogFileRepository;
    const terminalLogFileStore = this.terminalLogFileStore;
    const segments = this.terminalLogSegmentRepository.listBeforeSeq(terminalId, beforeSeq, limit);
    const historySegments = segments.map((segment) => {
      const logFile = terminalLogFileRepository.findById(segment.fileId);

      if (!logFile) {
        throw new AppError({
          statusCode: 409,
          errorCode: "TERMINAL_LOG_INDEX_INVALID",
          detail: "终端日志索引缺少对应文件记录"
        });
      }

      try {
        return {
          id: segment.id,
          fileId: segment.fileId,
          startSeq: segment.startSeq,
          endSeq: segment.endSeq,
          content: terminalLogFileStore.read(
            logFile.relativePath,
            segment.startOffset,
            segment.byteLength
          ),
          byteLength: segment.byteLength,
          createdAt: segment.createdAt
        };
      } catch (error) {
        throw new AppError({
          statusCode: 409,
          errorCode: "TERMINAL_LOG_FILE_MISSING",
          detail: error instanceof Error ? error.message : "终端日志文件不存在，无法回放历史"
        });
      }
    });
    const oldestSeq = historySegments.at(-1)?.startSeq ?? null;
    const hasMore = oldestSeq !== null
      ? terminalLogSegmentRepository.listBeforeSeq(terminalId, oldestSeq, 1).length > 0
      : false;

    return {
      terminalId,
      segments: historySegments,
      hasMore,
      nextBeforeSeq: oldestSeq
    };
  }

  private handleRuntimeOutput(terminalId: string, content: string): void {
    if (this.isDisposing) {
      return;
    }

    const batch = this.getOrCreatePendingOutputBatch(terminalId);
    batch.contents.push(content);

    if (batch.timer !== null) {
      return;
    }

    batch.timer = setTimeout(() => {
      batch.timer = null;
      this.flushPendingTerminalOutput(terminalId);
    }, TERMINAL_OUTPUT_FLUSH_INTERVAL_MS);
    batch.timer.unref?.();
  }

  private handleRuntimeExit(event: RuntimeAttachmentExitEvent): void {
    void this.handleRuntimeExitAsync(event);
  }

  private async handleRuntimeExitAsync(event: RuntimeAttachmentExitEvent): Promise<void> {
    if (this.isDisposing) {
      return;
    }

    if (this.pendingDeletedTerminalIds.delete(event.terminalId)) {
      this.pendingCloseReasons.delete(event.terminalId);
      this.pendingActivityByTerminalId.delete(event.terminalId);
      this.clearActivityFlushTimerIfIdle();
      this.pendingInputTraceByTerminalId.delete(event.terminalId);
      await this.clearTerminalLogs(event.terminalId);
      return;
    }

    await this.flushTerminalLogs(event.terminalId);
    const current = this.getTerminalOrThrow(event.terminalId);
    const session = this.getRuntimeSessionOrThrow(current.runtimeSessionId);

    if (event.sessionAlive && !event.requestedClose) {
      this.markTerminalRunning(current, session, event.shellPid, event.sessionDetail);
      return;
    }

    await this.finalizeTerminalClosure(current, session, event);
  }

  private touchLastActiveAt(terminalId: string): void {
    if (this.isDisposing) {
      return;
    }

    this.pendingActivityByTerminalId.set(terminalId, nowIso());
    this.scheduleActivityFlush();
  }

  private async ensureTerminalInteractive(terminalId: string): Promise<TerminalInstance> {
    const terminal = this.getTerminalOrThrow(terminalId);

    if (terminal.status === "running" && this.runtimeManager.isAttached(terminal.id)) {
      return terminal;
    }

    const session = this.getRuntimeSessionOrThrow(terminal.runtimeSessionId);
    const nextTerminal = await this.ensureTerminalRunning(terminal, session, true);

    if (nextTerminal.status !== "running") {
      throw new AppError({
        statusCode: 409,
        errorCode: "TERMINAL_NOT_RUNNING",
        detail: nextTerminal.statusDetail ?? "终端当前不可写入"
      });
    }

    return nextTerminal;
  }

  private async ensureTerminalAttachedForSubscription(terminalId: string): Promise<TerminalInstance> {
    const terminal = this.getTerminalOrThrow(terminalId);
    const session = this.getRuntimeSessionOrThrow(terminal.runtimeSessionId);
    return this.ensureTerminalRunning(terminal, session, true);
  }

  private async ensureTerminalRunning(
    terminal: TerminalInstance,
    session: TerminalRuntimeSession,
    ensureAttached: boolean
  ): Promise<TerminalInstance> {
    if (terminal.status === "closed" || terminal.status === "error") {
      return terminal;
    }

    const inspection = await this.runtimeManager.inspectPersistentSession(terminal, session);

    if (!inspection.alive) {
      if (shouldMarkRuntimeLost(terminal, inspection.detail)) {
        return this.markTerminalLost(terminal, session, inspection.detail);
      }

      return this.markTerminalError(terminal, session, inspection.detail ?? buildMissingProcessStatusDetail(terminal));
    }

    if (ensureAttached) {
      if (session.runtimeType === "embedded-pty") {
        if (!this.runtimeManager.isAttached(terminal.id)) {
          return this.markTerminalError(
            terminal,
            session,
            inspection.detail ?? "EMBEDDED_RUNTIME_NOT_ATTACHED"
          );
        }

        return this.markTerminalRunning(
          terminal,
          session,
          inspection.shellPid ?? this.runtimeManager.getProcessId(terminal.id),
          inspection.detail
        );
      }

      const attachmentProcessId = this.runtimeManager.ensureLegacyAttached(
        terminal,
        session,
        buildTerminalEnv()
      );
      return this.markTerminalRunning(
        terminal,
        session,
        inspection.shellPid ?? attachmentProcessId,
        inspection.detail
      );
    }

    return this.markTerminalRunning(terminal, session, inspection.shellPid, inspection.detail);
  }

  private async reconcileTerminalRuntime(terminal: TerminalInstance): Promise<boolean> {
    if (terminal.status === "closed" || terminal.status === "error") {
      return false;
    }

    const before = JSON.stringify({
      status: terminal.status,
      processId: terminal.processId,
      statusDetail: terminal.statusDetail
    });
    const session = this.getRuntimeSessionOrThrow(terminal.runtimeSessionId);
    const nextTerminal = await this.ensureTerminalRunning(terminal, session, false);
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
      agentPid: session.agentPid,
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
      agentPid: session.agentPid,
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
    this.pendingActivityByTerminalId.delete(terminal.id);
    this.clearActivityFlushTimerIfIdle();
    this.pendingInputTraceByTerminalId.delete(terminal.id);
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
      agentPid: session.agentPid,
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

  private async finalizeTerminalClosure(
    terminal: TerminalInstance,
    session: TerminalRuntimeSession,
    event: Pick<
      RuntimeAttachmentExitEvent,
      "requestedClose" | "exitCode" | "sessionAlive" | "sessionDetail" | "shellPid"
    >
  ): Promise<void> {
    const closeReason = this.pendingCloseReasons.get(terminal.id) ?? "user_closed";
    this.pendingCloseReasons.delete(terminal.id);
    this.pendingActivityByTerminalId.delete(terminal.id);
    this.clearActivityFlushTimerIfIdle();
    this.pendingInputTraceByTerminalId.delete(terminal.id);
    const finishedAt = nowIso();
    const status =
      event.requestedClose || event.exitCode === 0 ? ("closed" as const) : ("error" as const);
    const statusDetail = status === "error"
      ? normalizeTerminalErrorDetail(event.sessionDetail, event.exitCode)
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
      agentPid: session.agentPid,
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

    if (status === "closed") {
      await this.clearTerminalLogs(terminal.id);
    }
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

      void this.ensureTerminalRunning(terminal, session, false);
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

  private async flushTerminalLogs(terminalId: string): Promise<void> {
    this.flushPendingTerminalOutput(terminalId);
    await this.terminalLogSpooler?.flushTerminal(terminalId);
  }

  private async clearTerminalLogs(terminalId: string): Promise<void> {
    const pendingOutput = this.pendingOutputByTerminalId.get(terminalId);

    if (pendingOutput?.timer) {
      clearTimeout(pendingOutput.timer);
    }

    this.pendingOutputByTerminalId.delete(terminalId);
    this.pendingInputTraceByTerminalId.delete(terminalId);
    this.outputBuffer.clear(terminalId);

    if (this.terminalLogSpooler) {
      await this.terminalLogSpooler.deleteTerminalLogs(terminalId);
      return;
    }

    this.terminalLogSegmentRepository?.deleteByTerminalId(terminalId);
    this.terminalLogFileRepository?.deleteByTerminalId(terminalId);
  }

  private getOrCreatePendingOutputBatch(terminalId: string): PendingTerminalOutputBatch {
    let batch = this.pendingOutputByTerminalId.get(terminalId);

    if (!batch) {
      batch = {
        contents: [],
        timer: null
      };
      this.pendingOutputByTerminalId.set(terminalId, batch);
    }

    return batch;
  }

  private flushPendingTerminalOutput(terminalId?: string): void {
    if (terminalId) {
      const batch = this.pendingOutputByTerminalId.get(terminalId);

      if (!batch) {
        return;
      }

      if (batch.timer) {
        clearTimeout(batch.timer);
        batch.timer = null;
      }

      const content = batch.contents.join("");
      this.pendingOutputByTerminalId.delete(terminalId);
      this.commitTerminalOutput(terminalId, content);
      return;
    }

    for (const nextTerminalId of [...this.pendingOutputByTerminalId.keys()]) {
      this.flushPendingTerminalOutput(nextTerminalId);
    }
  }

  private commitTerminalOutput(terminalId: string, content: string): void {
    const traceQueue = this.pendingInputTraceByTerminalId.get(terminalId) ?? [];
    const outputReceivedAtMs = traceQueue.length > 0 ? terminalDebugNowMs() : null;
    const chunks = this.outputBuffer.append(terminalId, content);

    if (chunks.length === 0) {
      return;
    }

    this.terminalLogSpooler?.appendChunks(terminalId, chunks);
    this.touchLastActiveAt(terminalId);
    this.emit("output", {
      terminalId,
      chunks
    });

    if (traceQueue.length > 0 && outputReceivedAtMs !== null) {
      for (const trace of traceQueue) {
        logTerminalDebug("terminal.output.after_input", {
          terminalId,
          traceId: trace.traceId,
          charCount: trace.charCount,
          outputBytes: Buffer.byteLength(content, "utf8"),
          writeToOutputMs: outputReceivedAtMs - trace.serviceWriteFinishedAtMs,
          wsToOutputMs:
            trace.wsReceivedAtMs === null ? null : outputReceivedAtMs - trace.wsReceivedAtMs,
          clientToOutputMs:
            trace.clientSentAtMs === null ? null : outputReceivedAtMs - trace.clientSentAtMs,
          pendingTraceCount: traceQueue.length
        });
      }

      this.pendingInputTraceByTerminalId.delete(terminalId);
    }
  }

  private recordPendingInputTrace(
    terminalId: string,
    content: string,
    input: TerminalInputDebugContext & {
      serviceWriteStartedAtMs: number;
      serviceWriteFinishedAtMs: number;
    }
  ): void {
    if (!isTerminalDebugEnabled() || !input.clientTraceId) {
      return;
    }

    const queue = this.pendingInputTraceByTerminalId.get(terminalId) ?? [];
    queue.push({
      traceId: input.clientTraceId,
      clientSentAtMs: input.clientSentAtMs ?? null,
      wsReceivedAtMs: input.wsReceivedAtMs ?? null,
      serviceWriteStartedAtMs: input.serviceWriteStartedAtMs,
      serviceWriteFinishedAtMs: input.serviceWriteFinishedAtMs,
      charCount: content.length
    });
    this.pendingInputTraceByTerminalId.set(terminalId, queue);
  }

  private scheduleActivityFlush(): void {
    if (this.activityFlushTimer !== null) {
      return;
    }

    this.activityFlushTimer = setTimeout(() => {
      this.activityFlushTimer = null;
      this.flushPendingActivity();
    }, TERMINAL_ACTIVITY_FLUSH_INTERVAL_MS);
    this.activityFlushTimer.unref?.();
  }

  private flushPendingActivity(terminalId?: string): void {
    if (terminalId) {
      const lastActiveAt = this.pendingActivityByTerminalId.get(terminalId);

      if (!lastActiveAt) {
        return;
      }

      this.pendingActivityByTerminalId.delete(terminalId);
      this.terminalInstanceRepository.touchLastActiveAt(terminalId, lastActiveAt);
      this.clearActivityFlushTimerIfIdle();
      return;
    }

    if (this.pendingActivityByTerminalId.size === 0) {
      this.clearActivityFlushTimerIfIdle();
      return;
    }

    const entries = [...this.pendingActivityByTerminalId.entries()];
    this.pendingActivityByTerminalId.clear();

    for (const [nextTerminalId, lastActiveAt] of entries) {
      this.terminalInstanceRepository.touchLastActiveAt(nextTerminalId, lastActiveAt);
    }

    this.clearActivityFlushTimerIfIdle();
  }

  private clearActivityFlushTimerIfIdle(): void {
    if (this.pendingActivityByTerminalId.size > 0 || this.activityFlushTimer === null) {
      return;
    }

    clearTimeout(this.activityFlushTimer);
    this.activityFlushTimer = null;
  }
}

function normalizeTerminalHistoryContent(content: string): string {
  return content
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001bP[\s\S]*?\u001b\\/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

function countTerminalHistoryLines(content: string): number {
  if (!content) {
    return 0;
  }

  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;

  if (!normalized) {
    return 0;
  }

  return normalized.split("\n").length;
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

function resolveRequestedRuntimeType(
  input: TerminalRuntimeType | null | undefined,
  shell: string
): TerminalRuntimeType {
  const runtimeType = input ?? (process.platform === "win32" ? "embedded-pty" : "tmux");

  if (runtimeType === "embedded-pty") {
    return runtimeType;
  }

  if (process.platform === "win32") {
    if (runtimeType === "tmux" || isConptyRuntimeType(runtimeType)) {
      return resolveWindowsPersistentRuntimeType(shell);
    }
    throw new AppError({
      statusCode: 400,
      errorCode: "UNSUPPORTED_TERMINAL_RUNTIME",
      detail: `褰撳墠 Host 杩樻湭瀹炵幇 runtime=${runtimeType}`
    });
  }

  if (runtimeType === "tmux") {
    return runtimeType;
  }

  if (isConptyRuntimeType(runtimeType)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "RUNTIME_UNSUPPORTED_PLATFORM",
      detail: "conpty runtime 浠呮敮鎸?Windows"
    });
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "UNSUPPORTED_TERMINAL_RUNTIME",
    detail: `褰撳墠 Host 杩樻湭瀹炵幇 runtime=${runtimeType}`
  });
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

function buildDefaultTerminalName(
  cwd: string,
  existingTerminals: ReadonlyArray<Pick<TerminalInstance, "name">>
): string {
  const folderName = path.basename(cwd).trim();
  const baseName = folderName || "终端";
  const nextSequence = resolveNextTerminalSequence(baseName, existingTerminals);
  return `${baseName} ${nextSequence}`;
}

function resolveNextTerminalSequence(
  baseName: string,
  terminals: ReadonlyArray<Pick<TerminalInstance, "name">>
): number {
  const escapedBaseName = escapeRegExp(baseName);
  const namePattern = new RegExp(`^${escapedBaseName}(?:\\s+(\\d+))?$`);
  let maxSequence = 0;

  for (const terminal of terminals) {
    const normalizedName = terminal.name.trim();
    const match = namePattern.exec(normalizedName);

    if (!match) {
      continue;
    }

    if (!match[1]) {
      maxSequence = Math.max(maxSequence, 1);
      continue;
    }

    const sequence = Number.parseInt(match[1], 10);

    if (Number.isFinite(sequence) && sequence > 0) {
      maxSequence = Math.max(maxSequence, sequence);
    }
  }

  return maxSequence + 1;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function normalizeTerminalErrorDetail(
  sessionDetail: string | null,
  exitCode: number | null
): string {
  if (sessionDetail && sessionDetail !== "EMBEDDED_RUNTIME_NOT_RECOVERABLE") {
    return sessionDetail;
  }

  return `终端异常退出，exitCode=${exitCode ?? "unknown"}`;
}

function shouldMarkRuntimeLost(
  terminal: TerminalInstance,
  detail: string | null
): boolean {
  return terminal.runtimeType !== "embedded-pty" && Boolean(detail?.includes("检查失败"));
}
