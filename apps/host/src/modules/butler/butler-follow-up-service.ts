import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ButlerFollowUpRound,
  ButlerFollowUpTask,
  ButlerFollowUpTaskStatus,
  ButlerProject,
  ButlerProfile,
  SessionRunningState
} from "../../types/domain.js";
import type { ButlerProfileService } from "./butler-profile-service.js";
import { ensureButlerWorkspaceIsolation } from "./butler-profile-service.js";
import type { ButlerProjectService } from "./butler-project-service.js";
import type { ButlerSessionService } from "./butler-session-service.js";
import type { ButlerFollowUpTaskRepository } from "../../storage/repositories/butler-follow-up-task-repository.js";
import type { SessionQueueItemView } from "../sessions/session-live-runtime-service.js";
import type { SessionHistoryEnvelope, SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { SessionMessageOriginRepository } from "../../storage/repositories/session-message-origin-repository.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";
import type {
  SessionPermissionReplyInput,
  SessionPermissionRequestView
} from "../sessions/session-permission-request-service.js";
import { ProviderAdapterRegistry, type PatrolSessionResult } from "./provider-adapter-registry.js";
import {
  ButlerFollowUpEvaluationInstructionAdapter,
  type ButlerFollowUpEvaluationDecision
} from "./butler-follow-up-evaluation-instruction-adapter.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";

const DEFAULT_CHECK_INTERVAL_SECONDS = 300;
const MIN_CHECK_INTERVAL_SECONDS = 60;
const MAX_CHECK_INTERVAL_SECONDS = 3600;
const DEFAULT_MAX_AUTO_CONTINUE_COUNT = 5;
const MIN_MAX_AUTO_CONTINUE_COUNT = 1;
const MAX_MAX_AUTO_CONTINUE_COUNT = 20;
const FOLLOW_UP_EVALUATOR_DIRNAME = ".butler-follow-up-evaluator";
const RECENT_HISTORY_LIMIT = 40;
const FOLLOW_UP_PERMISSION_CHECK_INTERVAL_MS = 10_000;
const FOLLOW_UP_AUTO_APPROVE_ACTION_PREFERENCE = [
  "acceptForSession",
  "allow_session",
  "accept",
  "allow_turn",
  "once",
  "allow"
] as const;

export interface ButlerFollowUpTaskView {
  id: string;
  projectId: string;
  projectName: string;
  workspaceId: string;
  butlerSessionId: string;
  sessionId: string;
  sessionTitle: string | null;
  objective: string;
  completionCriteria: string;
  maxAutoContinueCount: number;
  status: ButlerFollowUpTaskStatus;
  checkIntervalSeconds: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastObservedRunningState: SessionRunningState | null;
  lastObservedMessageAt: string | null;
  lastObservedMessageCount: number;
  lastAutomationSummary: string | null;
  lastAutomationAt: string | null;
  autoContinueCount: number;
  waitingReason: string | null;
  rounds: ButlerFollowUpRound[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateButlerFollowUpTaskInput {
  projectId: string;
  butlerSessionId: string;
  objective: string;
  completionCriteria?: string;
  maxAutoContinueCount?: number;
  checkIntervalSeconds?: number;
}

interface FollowUpTaskInspection {
  runningState: SessionRunningState | null;
  messageAt: string | null;
  messageCount: number;
  sessionTitle: string | null;
  latestAssistantText: string | null;
  transcriptLines: string[];
}

interface ButlerFollowUpEvaluationResult {
  decision: ButlerFollowUpEvaluationDecision;
  summary: string;
  waitingReason: string | null;
  continuePrompt: string | null;
  riskLevel: "low" | "medium" | "high" | null;
}

export class ButlerFollowUpService {
  private readonly permissionRequestSweepAtByTaskId = new Map<string, number>();

  constructor(
    private readonly butlerProfileService: Pick<ButlerProfileService, "ensureInitialized">,
    private readonly butlerProjectService: Pick<ButlerProjectService, "getById">,
    private readonly butlerSessionService: Pick<ButlerSessionService, "captureSessionSnapshot">,
    private readonly butlerFollowUpTaskRepository: ButlerFollowUpTaskRepository,
    private readonly sessionHistoryService: Pick<
      SessionHistoryService,
      "getSession" | "readRecentHistoryEnvelope"
    >,
    private readonly sessionIndexRepository: Pick<SessionIndexRepository, "findIndexRecordBySessionId">,
    private readonly sessionLiveRuntimeService: Pick<
      SessionLiveRuntimeService,
      | "getSessionRuntime"
      | "sendLiveMessage"
      | "enqueueLiveMessage"
      | "listPermissionRequests"
      | "replyPermissionRequest"
    >,
    private readonly workspaceService: Pick<WorkspaceService, "importWorkspace">,
    private readonly providerAdapterRegistry: ProviderAdapterRegistry,
    private readonly instructionAdapter: ButlerFollowUpEvaluationInstructionAdapter,
    private readonly followUpCodexHomeDir: string | null = null,
    private readonly sourceCodexHomeDir: string | null = null,
    private readonly sessionMessageOriginRepository: Pick<SessionMessageOriginRepository, "upsert"> | null = null
  ) {}

  listTasks(filters: {
    statuses?: ButlerFollowUpTaskStatus[];
    projectId?: string;
    sessionId?: string;
    limit?: number;
  } = {}): ButlerFollowUpTaskView[] {
    this.butlerProfileService.ensureInitialized();

    return this.butlerFollowUpTaskRepository.list(filters).flatMap((task) => {
      const project = this.butlerProjectService.getById(task.projectId);
      const index = this.sessionIndexRepository.findIndexRecordBySessionId(task.sessionId);

      if (!project) {
        return [];
      }

      return [mapTaskView(task, project.workspaceId, project.name, index?.title ?? null)];
    });
  }

  getTask(taskId: string): ButlerFollowUpTaskView {
    this.butlerProfileService.ensureInitialized();
    const task = this.butlerFollowUpTaskRepository.findById(taskId);

    if (!task) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_FOLLOW_UP_TASK_NOT_FOUND",
        detail: "未找到对应的跟进任务"
      });
    }

    const project = this.butlerProjectService.getById(task.projectId);
    const index = this.sessionIndexRepository.findIndexRecordBySessionId(task.sessionId);

    return mapTaskView(task, project.workspaceId, project.name, index?.title ?? null);
  }

  async createTask(
    input: CreateButlerFollowUpTaskInput,
    userId: string
  ): Promise<ButlerFollowUpTaskView> {
    this.butlerProfileService.ensureInitialized();
    const project = this.butlerProjectService.getById(input.projectId);
    const objective = normalizeObjective(input.objective);
    const completionCriteria = normalizeCompletionCriteria(input.completionCriteria, objective);
    const maxAutoContinueCount = normalizeMaxAutoContinueCount(input.maxAutoContinueCount);
    const checkIntervalSeconds = normalizeCheckInterval(input.checkIntervalSeconds);
    const snapshot = this.butlerSessionService.captureSessionSnapshot(
      project.id,
      input.butlerSessionId,
      userId,
      { sourceKind: "manual" }
    );
    const existing = this.butlerFollowUpTaskRepository.findActiveByButlerSessionId(input.butlerSessionId);

    if (existing) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_FOLLOW_UP_TASK_EXISTS",
        detail: "当前会话已经有一个进行中的跟进任务"
      });
    }

    const session = this.sessionHistoryService.getSession(snapshot.sessionId, userId);
    const timestamp = nowIso();
    const initialSummary =
      snapshot.runningState === "starting" || snapshot.runningState === "running"
        ? `已开始跟进，先等待当前运行结束，再由后台评估助手决定下一步。默认最多自动推进 ${maxAutoContinueCount} 轮。`
        : `已开始跟进，准备由后台评估助手检查当前进展。默认最多自动推进 ${maxAutoContinueCount} 轮。`;
    const task = this.butlerFollowUpTaskRepository.create({
      id: createId(),
      projectId: project.id,
      butlerSessionId: input.butlerSessionId,
      sessionId: snapshot.sessionId,
      createdByUserId: userId,
      objective,
      completionCriteria,
      maxAutoContinueCount,
      status: "active",
      checkIntervalSeconds,
      lastCheckedAt: null,
      nextCheckAt:
        snapshot.runningState === "starting" || snapshot.runningState === "running"
          ? shiftSeconds(timestamp, checkIntervalSeconds)
          : timestamp,
      lastObservedRunningState: snapshot.runningState,
      lastObservedMessageAt: session.lastMessageAt,
      lastObservedMessageCount: session.messageCount,
      lastAutomationSummary: initialSummary,
      lastAutomationAt: null,
      autoContinueCount: 0,
      waitingReason: null,
      rounds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    });

    const processed = await this.processTask(task.id);
    return mapTaskView(
      processed,
      project.workspaceId,
      project.name,
      session.title ?? null
    );
  }

  cancelTask(taskId: string, userId: string): ButlerFollowUpTaskView {
    this.butlerProfileService.ensureInitialized();
    const task = this.butlerFollowUpTaskRepository.findById(taskId);

    if (!task) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_FOLLOW_UP_TASK_NOT_FOUND",
        detail: "未找到对应的跟进任务"
      });
    }

    if (task.createdByUserId !== userId) {
      throw new AppError({
        statusCode: 403,
        errorCode: "BUTLER_FOLLOW_UP_TASK_FORBIDDEN",
        detail: "你没有权限停止这个跟进任务"
      });
    }

    if (task.status !== "active" && task.status !== "waiting_user") {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_FOLLOW_UP_TASK_NOT_STOPPABLE",
        detail: "当前跟进任务已经结束，不能再次停止"
      });
    }

    const timestamp = nowIso();
    const updated = this.persistWithRound({
      ...task,
      status: "cancelled",
      nextCheckAt: null,
      waitingReason: null,
      completedAt: timestamp,
      updatedAt: timestamp,
      lastAutomationAt: timestamp,
      lastAutomationSummary: "已手动终止当前会话跟进任务，不再继续自动续接。"
    }, {
      kind: "cancelled",
      status: "cancelled",
      summary: "已手动终止当前会话跟进任务，不再继续自动续接。",
      waitingReason: null,
      continuePrompt: null,
      observedRunningState: task.lastObservedRunningState,
      autoContinueCount: task.autoContinueCount,
      createdAt: timestamp
    });

    const project = this.butlerProjectService.getById(updated.projectId);
    const index = this.sessionIndexRepository.findIndexRecordBySessionId(updated.sessionId);

    return mapTaskView(updated, project.workspaceId, project.name, index?.title ?? null);
  }

  async runDueTasks(referenceAt = nowIso()): Promise<void> {
    const tasks = this.butlerFollowUpTaskRepository.list({
      statuses: ["active"],
      limit: 100
    });

    for (const task of tasks) {
      await this.autoApprovePendingPermissionRequestsIfDue(task, referenceAt);

      if (task.nextCheckAt && task.nextCheckAt > referenceAt) {
        continue;
      }

      await this.processTask(task.id, referenceAt);
    }
  }

  async handleSessionTerminal(sessionId: string, referenceAt = nowIso()): Promise<void> {
    const tasks = this.butlerFollowUpTaskRepository.list({
      statuses: ["active"],
      sessionId,
      limit: 20
    });

    for (const task of tasks) {
      if (this.shouldSkipImmediateTerminalRecheck(task)) {
        continue;
      }

      await this.processTask(task.id, referenceAt);
    }
  }

  async processTask(taskId: string, referenceAt = nowIso()): Promise<ButlerFollowUpTask> {
    const task = this.butlerFollowUpTaskRepository.findById(taskId);

    if (!task) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_FOLLOW_UP_TASK_NOT_FOUND",
        detail: "未找到对应的跟进任务"
      });
    }

    if (task.status !== "active") {
      return task;
    }

    const profile = this.butlerProfileService.ensureInitialized();
    const project = this.butlerProjectService.getById(task.projectId);
    const inspection = await this.inspectTask(task);
    const runningState = normalizeRunningState(inspection.runningState);
    const baseUpdate: ButlerFollowUpTask = {
      ...task,
      lastCheckedAt: referenceAt,
      lastObservedRunningState: runningState,
      lastObservedMessageAt: inspection.messageAt,
      lastObservedMessageCount: inspection.messageCount,
      updatedAt: referenceAt
    };

    if (runningState === "starting" || runningState === "running") {
      return this.persist({
        ...baseUpdate,
        status: "active",
        waitingReason: null,
        nextCheckAt: shiftSeconds(referenceAt, task.checkIntervalSeconds),
        lastAutomationSummary:
          hasReachedAutoContinueLimit(task)
            ? `会话仍在运行，但已达到预设的自动跟进轮数上限（${task.autoContinueCount}/${task.maxAutoContinueCount}），本轮结束后将停止自动续接。`
            : "会话仍在运行，助手继续观察当前进度。"
      });
    }

    if (hasReachedAutoContinueLimit(task)) {
      const waitingReason = `已达到预设的自动跟进轮数上限（${task.autoContinueCount}/${task.maxAutoContinueCount}），如需继续，请手动重新发起跟进。`;
      const summary = `自动跟进已按预设上限停止。结束条件：${task.completionCriteria}`;

      return this.persistWithRound({
        ...baseUpdate,
        status: "waiting_user",
        waitingReason,
        nextCheckAt: null,
        completedAt: null,
        lastAutomationAt: referenceAt,
        lastAutomationSummary: summary
      }, {
        kind: "limit_reached",
        status: "waiting_user",
        summary,
        waitingReason,
        continuePrompt: null,
        observedRunningState: runningState,
        autoContinueCount: task.autoContinueCount,
        createdAt: referenceAt
      });
    }

    try {
      const evaluation = await this.evaluateTask(profile, project, task, inspection, runningState);

      switch (evaluation.decision) {
        case "completed":
          return this.persistWithRound({
            ...baseUpdate,
            status: "completed",
            waitingReason: null,
            nextCheckAt: null,
            completedAt: referenceAt,
            lastAutomationAt: referenceAt,
            lastAutomationSummary: evaluation.summary
          }, {
            kind: "completed",
            status: "completed",
            summary: evaluation.summary,
            waitingReason: null,
            continuePrompt: null,
            observedRunningState: runningState,
            autoContinueCount: task.autoContinueCount,
            createdAt: referenceAt
          });
        case "waiting_user":
          return this.persistWithRound({
            ...baseUpdate,
            status: "waiting_user",
            waitingReason: evaluation.waitingReason ?? evaluation.summary,
            nextCheckAt: null,
            completedAt: null,
            lastAutomationAt: referenceAt,
            lastAutomationSummary: evaluation.summary
          }, {
            kind: "waiting_user",
            status: "waiting_user",
            summary: evaluation.summary,
            waitingReason: evaluation.waitingReason ?? evaluation.summary,
            continuePrompt: null,
            observedRunningState: runningState,
            autoContinueCount: task.autoContinueCount,
            createdAt: referenceAt
          });
        case "failed":
          return this.persistWithRound({
            ...baseUpdate,
            status: "failed",
            waitingReason: evaluation.waitingReason ?? evaluation.summary,
            nextCheckAt: null,
            completedAt: null,
            lastAutomationAt: referenceAt,
            lastAutomationSummary: evaluation.summary
          }, {
            kind: "failed",
            status: "failed",
            summary: evaluation.summary,
            waitingReason: evaluation.waitingReason ?? evaluation.summary,
            continuePrompt: null,
            observedRunningState: runningState,
            autoContinueCount: task.autoContinueCount,
            createdAt: referenceAt
          });
        case "continue":
          if (!evaluation.continuePrompt) {
            return this.persistWithRound({
              ...baseUpdate,
              status: "failed",
              waitingReason: "后台评估助手没有返回可继续推进的指令。",
              nextCheckAt: null,
              completedAt: null,
              lastAutomationAt: referenceAt,
              lastAutomationSummary: evaluation.summary
            }, {
              kind: "failed",
              status: "failed",
              summary: evaluation.summary,
              waitingReason: "后台评估助手没有返回可继续推进的指令。",
              continuePrompt: null,
              observedRunningState: runningState,
              autoContinueCount: task.autoContinueCount,
              createdAt: referenceAt
            });
          }

          const sendResult = await this.sendContinuePrompt(
            task,
            evaluation.continuePrompt,
            referenceAt
          );

          this.butlerSessionService.captureSessionSnapshot(
            task.projectId,
            task.butlerSessionId,
            task.createdByUserId,
            { sourceKind: "manual" }
          );

          const nextAutoContinueCount = task.autoContinueCount + 1;
          const nextSummary =
            sendResult.delivery === "queued"
              ? buildQueuedFollowUpSummary(evaluation.summary, sendResult.queueItem)
              : evaluation.summary;

          return this.persistWithRound({
            ...baseUpdate,
            status: "active",
            waitingReason: null,
            nextCheckAt: shiftSeconds(referenceAt, task.checkIntervalSeconds),
            lastAutomationAt: referenceAt,
            autoContinueCount: nextAutoContinueCount,
            lastAutomationSummary: nextSummary
          }, {
            kind: sendResult.delivery === "queued" ? "queued" : "continue",
            status: "active",
            summary: nextSummary,
            waitingReason: null,
            continuePrompt: evaluation.continuePrompt,
            observedRunningState: runningState,
            autoContinueCount: nextAutoContinueCount,
            createdAt: referenceAt
          });
        default:
          return this.persistWithRound({
            ...baseUpdate,
            status: "failed",
            waitingReason: "后台评估助手返回了不支持的决策。",
            nextCheckAt: null,
            completedAt: null,
            lastAutomationAt: referenceAt,
            lastAutomationSummary: "后台评估助手返回了不支持的决策。"
          }, {
            kind: "failed",
            status: "failed",
            summary: "后台评估助手返回了不支持的决策。",
            waitingReason: "后台评估助手返回了不支持的决策。",
            continuePrompt: null,
            observedRunningState: runningState,
            autoContinueCount: task.autoContinueCount,
            createdAt: referenceAt
          });
      }
    } catch (error) {
      if (isDeferredFollowUpSendError(error)) {
        return this.persist({
          ...baseUpdate,
          status: "active",
          waitingReason: null,
          nextCheckAt: shiftSeconds(referenceAt, task.checkIntervalSeconds),
          completedAt: null,
          lastAutomationAt: referenceAt,
          lastAutomationSummary: "当前会话又进入运行态，本轮不插话，等待下一次检查。"
        });
      }

      const detail = error instanceof Error ? error.message : String(error);
      const summary = `后台评估助手执行失败：${detail}`;

      return this.persistWithRound({
        ...baseUpdate,
        status: "failed",
        waitingReason: detail,
        nextCheckAt: null,
        completedAt: null,
        lastAutomationAt: referenceAt,
        lastAutomationSummary: summary
      }, {
        kind: "failed",
        status: "failed",
        summary,
        waitingReason: detail,
        continuePrompt: null,
        observedRunningState: runningState,
        autoContinueCount: task.autoContinueCount,
        createdAt: referenceAt
      });
    }
  }

  private persist(task: ButlerFollowUpTask): ButlerFollowUpTask {
    const normalizedTask = {
      ...task,
      rounds: normalizeFollowUpRounds(task.rounds)
    };

    if (normalizedTask.status !== "active") {
      this.permissionRequestSweepAtByTaskId.delete(normalizedTask.id);
    }

    return this.butlerFollowUpTaskRepository.update(normalizedTask) ?? normalizedTask;
  }

  private persistWithRound(
    task: ButlerFollowUpTask,
    round: Omit<ButlerFollowUpRound, "roundNumber">
  ): ButlerFollowUpTask {
    const normalizedRounds = normalizeFollowUpRounds(task.rounds);

    return this.persist({
      ...task,
      rounds: [...normalizedRounds, createFollowUpRound(normalizedRounds, round)]
    });
  }

  private async autoApprovePendingPermissionRequestsIfDue(
    task: ButlerFollowUpTask,
    referenceAt: string
  ): Promise<void> {
    const parsedReferenceAt = Date.parse(referenceAt);
    const referenceAtMs = Number.isFinite(parsedReferenceAt) ? parsedReferenceAt : Date.now();
    const lastSweepAtMs = this.permissionRequestSweepAtByTaskId.get(task.id) ?? 0;

    if (
      lastSweepAtMs > 0
      && referenceAtMs - lastSweepAtMs < FOLLOW_UP_PERMISSION_CHECK_INTERVAL_MS
    ) {
      return;
    }

    this.permissionRequestSweepAtByTaskId.set(task.id, referenceAtMs);

    let requests: SessionPermissionRequestView[];

    try {
      requests = await this.sessionLiveRuntimeService.listPermissionRequests(
        task.sessionId,
        task.createdByUserId
      );
    } catch (error) {
      console.warn("[butler-follow-up] list permission requests failed", {
        taskId: task.id,
        sessionId: task.sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    for (const request of requests) {
      const reply = buildAutoApprovePermissionReply(request);

      if (!reply) {
        continue;
      }

      try {
        await this.sessionLiveRuntimeService.replyPermissionRequest(
          task.sessionId,
          task.createdByUserId,
          request.id,
          reply
        );
      } catch (error) {
        if (isIgnorablePermissionReplyError(error)) {
          continue;
        }

        console.warn("[butler-follow-up] auto approve permission request failed", {
          taskId: task.id,
          sessionId: task.sessionId,
          requestId: request.id,
          action: reply.action,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private shouldSkipImmediateTerminalRecheck(task: ButlerFollowUpTask): boolean {
    const session = this.sessionHistoryService.getSession(task.sessionId, task.createdByUserId);

    return (
      isTerminalFollowUpRunningState(task.lastObservedRunningState)
      && normalizeRunningState(session.runningState) === task.lastObservedRunningState
      && normalizeNullableIso(session.lastMessageAt) === normalizeNullableIso(task.lastObservedMessageAt)
      && session.messageCount === task.lastObservedMessageCount
    );
  }

  private async sendContinuePrompt(
    task: ButlerFollowUpTask,
    continuePrompt: string,
    referenceAt: string
  ): Promise<
    | {
        delivery: "sent";
      }
    | {
        delivery: "queued";
        queueItem: SessionQueueItemView;
      }
  > {
    const clientRequestId = buildFollowUpClientRequestId(task.id, referenceAt);

    try {
      const result = await this.sessionLiveRuntimeService.sendLiveMessage({
        sessionId: task.sessionId,
        userId: task.createdByUserId,
        content: continuePrompt,
        clientRequestId,
        runtimeOptions: {
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          attachments: []
        }
      });

      this.recordMessageOrigin(task, clientRequestId, continuePrompt, result.acceptedAt, result.message.messageId);

      return {
        delivery: "sent"
      };
    } catch (error) {
      if (!isDeferredFollowUpSendError(error)) {
        throw error;
      }

      const queueItem = await this.sessionLiveRuntimeService.enqueueLiveMessage({
        sessionId: task.sessionId,
        userId: task.createdByUserId,
        content: continuePrompt,
        clientRequestId,
        runtimeOptions: {
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          attachments: []
        }
      });

      this.recordMessageOrigin(task, clientRequestId, continuePrompt, queueItem.createdAt, null);

      return {
        delivery: "queued",
        queueItem
      };
    }
  }

  private recordMessageOrigin(
    task: ButlerFollowUpTask,
    clientRequestId: string,
    content: string,
    timestamp: string,
    messageId: string | null | undefined
  ): void {
    this.sessionMessageOriginRepository?.upsert({
      sessionId: task.sessionId,
      clientRequestId,
      messageId: isSyntheticMessageId(messageId) ? null : messageId ?? null,
      origin: "butler_proxy",
      originRef: task.id,
      content,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  private async inspectTask(task: ButlerFollowUpTask): Promise<FollowUpTaskInspection> {
    const session = this.sessionHistoryService.getSession(task.sessionId, task.createdByUserId);
    const runtime = await this.sessionLiveRuntimeService.getSessionRuntime(
      task.sessionId,
      task.createdByUserId
    );
    const envelope = await this.sessionHistoryService.readRecentHistoryEnvelope(
      task.sessionId,
      RECENT_HISTORY_LIMIT
    );
    const sortedMessages = (envelope?.messages ?? [])
      .slice()
      .sort((left, right) => left.sequence - right.sequence);

    return {
      runningState: normalizeRunningState(runtime.runningState),
      messageAt: session.lastMessageAt,
      messageCount: session.messageCount,
      sessionTitle: session.title ?? null,
      latestAssistantText: resolveLatestAssistantText(envelope),
      transcriptLines: sortedMessages.map((message) => renderHistoryLine(
        message.sequence,
        message.role,
        message.kind ?? "text",
        message.timestamp,
        message.content
      ))
    };
  }

  private async evaluateTask(
    profile: ButlerProfile,
    project: ButlerProject,
    task: ButlerFollowUpTask,
    inspection: FollowUpTaskInspection,
    runningState: SessionRunningState | null
  ): Promise<ButlerFollowUpEvaluationResult> {
    const evaluatorWorkspacePath = path.join(profile.workspacePath, FOLLOW_UP_EVALUATOR_DIRNAME);
    ensureButlerWorkspaceIsolation(evaluatorWorkspacePath);
    this.writeEvaluationInstructionFiles(evaluatorWorkspacePath, profile.providerId);
    this.syncCodexInstructionConfig(profile.providerId, evaluatorWorkspacePath);
    const workspace = this.workspaceService.importWorkspace(evaluatorWorkspacePath, "代码助手");
    const instruction = this.instructionAdapter.buildInstruction({
      providerId: profile.providerId,
      project,
      sessionId: task.sessionId,
      butlerSessionId: task.butlerSessionId,
      sessionTitle: inspection.sessionTitle,
      objective: task.objective,
      completionCriteria: task.completionCriteria,
      runningState,
      messageCount: inspection.messageCount,
      lastMessageAt: inspection.messageAt,
      autoContinueCount: task.autoContinueCount,
      maxAutoContinueCount: task.maxAutoContinueCount,
      lastAutomationSummary: task.lastAutomationSummary,
      latestAssistantText: inspection.latestAssistantText,
      transcriptLines: inspection.transcriptLines
    });
    const adapter = this.providerAdapterRegistry.get(profile.providerId);
    const launch = await adapter.startPatrolSession({
      workspaceId: workspace.id,
      userId: task.createdByUserId,
      providerId: profile.providerId,
      prompt: instruction.prompt,
      model: resolveFollowUpModel(profile.providerId),
      reasoningLevel: "low",
      permissionMode: "default"
    });

    await adapter.waitForSessionTerminal(launch.sessionId);
    const result = await adapter.readPatrolResult(launch.sessionId);
    return parseEvaluationResult(result);
  }

  private writeEvaluationInstructionFiles(
    workspacePath: string,
    providerId: ButlerProfile["providerId"]
  ): void {
    const content = [
      "# 代码助手后台跟进评估规则",
      "",
      "你不是普通项目会话，也不是面向用户的聊天助手。",
      "你的身份是后台跟进评估器，只负责判断某个开发会话现在该继续推进、等用户决定、还是已经完成。",
      "如果目标或上下文里提到了 spec，完成标准只能按 spec 明确要求的必做项判断。",
      "“建议下一步”“最佳实践”“可以顺手优化”这类内容默认都不是必做项，不能据此继续扩范围。",
      "如果没有 spec，就先从目标和最近消息里归纳一句当前核心任务，后续只能围绕这个核心任务判断，不准无限扩展。",
      "除非目标本身要求，否则不要把重构、补测试、补体验优化之类建议项升级成必须开发的工作。",
      "禁止照搬最后一句回复做草率判断，必须结合用户目标、当前运行态和最近消息一起判断。",
      "如果能继续推进，就直接给出下一条要发给开发会话的中文指令，不要空谈。",
      "如果确实需要用户决定，要把缺口说清楚，但不要替用户做不存在的决定。",
      "输出语言必须是中文，先给结论，再给结构化 JSON。"
    ].join("\n");

    writeFileIfChanged(path.join(workspacePath, "AGENTS.md"), `${content}\n`);

    if (providerId === "claude-code") {
      writeFileIfChanged(path.join(workspacePath, "CLAUDE.md"), `${content}\n`);
    }
  }

  private syncCodexInstructionConfig(
    providerId: ButlerProfile["providerId"],
    workspacePath: string
  ): void {
    if (providerId !== "codex" || !this.followUpCodexHomeDir?.trim()) {
      return;
    }

    const targetHomeDir = path.resolve(this.followUpCodexHomeDir);
    const sourceHomeDir = resolveSourceCodexHomeDir(this.sourceCodexHomeDir, targetHomeDir);
    const sourceConfigPath = path.join(sourceHomeDir, "config.toml");
    const sourceConfigContent =
      sourceHomeDir !== targetHomeDir && fs.existsSync(sourceConfigPath) && fs.statSync(sourceConfigPath).isFile()
        ? fs.readFileSync(sourceConfigPath, "utf8")
        : "";
    const instructionFilePath = path.join(workspacePath, "AGENTS.md");

    fs.mkdirSync(targetHomeDir, { recursive: true });
    removeFileIfExists(path.join(targetHomeDir, "AGENTS.md"));
    removeFileIfExists(path.join(targetHomeDir, "AGENTS.override.md"));
    syncOptionalFile(path.join(sourceHomeDir, "auth.json"), path.join(targetHomeDir, "auth.json"));
    writeFileIfChanged(
      path.join(targetHomeDir, "config.toml"),
      `${composeCodexConfigContent(sourceConfigContent, instructionFilePath)}\n`
    );
  }
}

function mapTaskView(
  task: ButlerFollowUpTask,
  workspaceId: string,
  projectName: string,
  sessionTitle: string | null
): ButlerFollowUpTaskView {
  const rounds = normalizeFollowUpRounds(task.rounds);

  return {
    id: task.id,
    projectId: task.projectId,
    projectName,
    workspaceId,
    butlerSessionId: task.butlerSessionId,
    sessionId: task.sessionId,
    sessionTitle,
    objective: task.objective,
    completionCriteria: task.completionCriteria,
    maxAutoContinueCount: task.maxAutoContinueCount,
    status: task.status,
    checkIntervalSeconds: task.checkIntervalSeconds,
    lastCheckedAt: task.lastCheckedAt,
    nextCheckAt: task.nextCheckAt,
    lastObservedRunningState: task.lastObservedRunningState,
    lastObservedMessageAt: task.lastObservedMessageAt,
    lastObservedMessageCount: task.lastObservedMessageCount,
    lastAutomationSummary: task.lastAutomationSummary,
    lastAutomationAt: task.lastAutomationAt,
    autoContinueCount: task.autoContinueCount,
    waitingReason: task.waitingReason,
    rounds,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt
  };
}

function createFollowUpRound(
  existingRounds: ButlerFollowUpRound[],
  input: Omit<ButlerFollowUpRound, "roundNumber">
): ButlerFollowUpRound {
  return {
    roundNumber: existingRounds.length + 1,
    kind: input.kind,
    status: input.status,
    summary: input.summary,
    waitingReason: input.waitingReason,
    continuePrompt: input.continuePrompt,
    observedRunningState: input.observedRunningState,
    autoContinueCount: input.autoContinueCount,
    createdAt: input.createdAt
  };
}

function normalizeFollowUpRounds(rounds: ButlerFollowUpRound[]): ButlerFollowUpRound[] {
  return rounds
    .filter((round) => round.kind !== "started")
    .map((round, index) => ({
      ...round,
      roundNumber: index + 1
    }));
}

function buildAutoApprovePermissionReply(
  request: SessionPermissionRequestView
): SessionPermissionReplyInput | null {
  if (request.status !== "pending" || request.kind === "user_input") {
    return null;
  }

  const availableActions = new Set(
    request.actions
      .map((action) => action.value.trim())
      .filter((action) => action.length > 0)
  );

  for (const action of FOLLOW_UP_AUTO_APPROVE_ACTION_PREFERENCE) {
    if (availableActions.has(action)) {
      return { action };
    }
  }

  return null;
}

function isIgnorablePermissionReplyError(error: unknown): boolean {
  if (error instanceof AppError) {
    return (
      error.errorCode === "PERMISSION_REQUEST_ALREADY_RESOLVED"
      || error.errorCode === "PERMISSION_REQUEST_NOT_FOUND"
    );
  }

  return (
    error instanceof Error
    && (
      error.message === "PERMISSION_REQUEST_ALREADY_RESOLVED"
      || error.message === "PERMISSION_REQUEST_NOT_FOUND"
    )
  );
}

function normalizeObjective(value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "请先写清楚希望助手继续推动的目标",
      field: "objective"
    });
  }

  return normalized;
}

function normalizeCompletionCriteria(value: string | undefined, objective: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : `仅当以下目标已经明确完成时，才允许结束本次自动跟进：${objective}`;
}

function normalizeMaxAutoContinueCount(value: number | undefined): number {
  const fallback = value ?? DEFAULT_MAX_AUTO_CONTINUE_COUNT;
  const rounded = Math.round(fallback);

  return Math.min(
    MAX_MAX_AUTO_CONTINUE_COUNT,
    Math.max(MIN_MAX_AUTO_CONTINUE_COUNT, rounded)
  );
}

function normalizeCheckInterval(value: number | undefined): number {
  const fallback = value ?? DEFAULT_CHECK_INTERVAL_SECONDS;
  const rounded = Math.round(fallback);

  return Math.min(MAX_CHECK_INTERVAL_SECONDS, Math.max(MIN_CHECK_INTERVAL_SECONDS, rounded));
}

function hasReachedAutoContinueLimit(task: Pick<ButlerFollowUpTask, "autoContinueCount" | "maxAutoContinueCount">): boolean {
  return task.autoContinueCount >= task.maxAutoContinueCount;
}

function buildFollowUpClientRequestId(taskId: string, referenceAt: string): string {
  return `butler-follow-up:${taskId}:${Date.parse(referenceAt) || Date.now()}`;
}

function buildQueuedFollowUpSummary(summary: string, queueItem: SessionQueueItemView): string {
  return `${summary} 已转入消息队列，等待当前会话空闲后自动补发（队列项 ${queueItem.orderIndex}）。`;
}

function isDeferredFollowUpSendError(error: unknown): boolean {
  if (error instanceof AppError) {
    return (
      error.errorCode === "ACTIVE_RUN_EXISTS"
      || error.errorCode === "SESSION_NOT_RUNNING"
      || error.errorCode === "IN_RUN_INPUT_NOT_SUPPORTED"
      || error.errorCode === "SESSION_EXTERNAL_RUN_ACTIVE"
      || error.errorCode === "PROVIDER_RUNTIME_UNAVAILABLE"
      || error.errorCode === "PROVIDER_RUNTIME_TIMEOUT"
      || error.statusCode >= 500
    );
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "ACTIVE_RUN_EXISTS"
    || error.message === "SESSION_NOT_RUNNING"
    || error.message === "IN_RUN_INPUT_NOT_SUPPORTED"
    || error.message === "SESSION_EXTERNAL_RUN_ACTIVE"
    || error.message === "SERVER_UNAVAILABLE"
    || error.message === "SERVER_TIMEOUT"
    || error.message.includes("当前会话正在运行")
  );
}

function isSyntheticMessageId(messageId: string | null | undefined): boolean {
  return typeof messageId === "string" && messageId.startsWith("synthetic-");
}

function shiftSeconds(referenceAt: string, seconds: number): string {
  const time = new Date(referenceAt).getTime();
  return new Date(time + seconds * 1000).toISOString();
}

function normalizeRunningState(value: string | null | undefined): SessionRunningState | null {
  switch (value) {
    case "idle":
    case "starting":
    case "running":
    case "completed":
    case "interrupted":
    case "failed":
      return value;
    default:
      return null;
  }
}

function isTerminalFollowUpRunningState(
  value: SessionRunningState | null | undefined
): value is "completed" | "interrupted" | "failed" {
  return value === "completed" || value === "interrupted" || value === "failed";
}

function normalizeNullableIso(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function resolveLatestAssistantText(envelope: SessionHistoryEnvelope | null): string | null {
  if (!envelope || envelope.messages.length === 0) {
    return null;
  }

  const latestAssistant = [...envelope.messages]
    .sort((left, right) => right.sequence - left.sequence)
    .find((message) => message.role === "assistant" && message.content.trim().length > 0);

  return latestAssistant?.content?.trim() || null;
}

function renderHistoryLine(
  sequence: number,
  role: string,
  kind: string,
  timestamp: string,
  content: string
): string {
  const compactContent = truncateText(
    content
      .replace(/\s+/g, " ")
      .trim(),
    kind === "tool_call" ? 220 : 360
  );

  return `#${sequence} [${timestamp}] ${role}/${kind}: ${compactContent || "（空内容）"}`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function resolveFollowUpModel(providerId: ButlerProfile["providerId"]): string {
  return providerId === "codex" ? "gpt-5.1-codex-mini" : "haiku";
}

function parseEvaluationResult(result: PatrolSessionResult): ButlerFollowUpEvaluationResult {
  const rawJson = result.structured.rawJson ?? extractJsonFromText(result.latestAssistantMessage);

  if (!rawJson) {
    throw new Error("后台评估助手没有返回结构化 JSON");
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `后台评估助手返回的 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`
    );
  }

  const decision = normalizeDecision(parsed.decision);

  if (!decision) {
    throw new Error("后台评估助手返回的 decision 不合法");
  }

  const summary = normalizeNonEmptyString(parsed.summary) ?? result.structured.summary ?? "后台评估助手未提供摘要";
  const waitingReason = normalizeNullableString(parsed.waitingReason);
  const continuePrompt = normalizeNullableString(parsed.continuePrompt);
  const riskLevel = normalizeRiskLevel(parsed.riskLevel);

  return {
    decision,
    summary,
    waitingReason,
    continuePrompt,
    riskLevel
  };
}

function normalizeDecision(value: unknown): ButlerFollowUpEvaluationDecision | null {
  switch (value) {
    case "continue":
    case "waiting_user":
    case "completed":
    case "failed":
      return value;
    default:
      return null;
  }
}

function normalizeRiskLevel(value: unknown): "low" | "medium" | "high" | null {
  switch (value) {
    case "low":
    case "medium":
    case "high":
      return value;
    default:
      return null;
  }
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeNonEmptyString(value);
}

function extractJsonFromText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const matched = value.match(/```json\s*([\s\S]*?)```/i);
  const raw = matched?.[1]?.trim();
  return raw || null;
}

function resolveSourceCodexHomeDir(sourceCodexHomeDir: string | null, targetHomeDir: string): string {
  const configuredSource = sourceCodexHomeDir?.trim();

  if (configuredSource) {
    const resolvedConfiguredSource = path.resolve(configuredSource);

    if (resolvedConfiguredSource !== targetHomeDir) {
      return resolvedConfiguredSource;
    }
  }

  const fallbackHomeDir = path.resolve(path.join(os.homedir(), ".codex"));

  if (fallbackHomeDir !== targetHomeDir) {
    return fallbackHomeDir;
  }

  return targetHomeDir;
}

function composeCodexConfigContent(sourceConfigContent: string, instructionFilePath: string): string {
  const normalizedSource = sourceConfigContent
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("model_instructions_file");
    })
    .join("\n")
    .trim();

  return [
    "# 代码助手跟进评估专用 Codex 配置（系统自动生成）",
    normalizedSource,
    `model_instructions_file = ${toTomlString(path.resolve(instructionFilePath))}`
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function toTomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function writeFileIfChanged(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) {
    return;
  }

  fs.writeFileSync(filePath, content, "utf8");
}

function removeFileIfExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  if (fs.statSync(filePath).isFile()) {
    fs.rmSync(filePath, { force: true });
  }
}

function syncOptionalFile(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    removeFileIfExists(targetPath);
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (fs.existsSync(targetPath) && fs.readFileSync(targetPath).equals(fs.readFileSync(sourcePath))) {
    return;
  }

  fs.copyFileSync(sourcePath, targetPath);
}
