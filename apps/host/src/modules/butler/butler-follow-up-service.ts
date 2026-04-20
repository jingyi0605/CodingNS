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
import { ProviderAdapterRegistry } from "./provider-adapter-registry.js";
import { ButlerFollowUpEvaluationInstructionAdapter } from "./butler-follow-up-evaluation-instruction-adapter.js";
import { resolveButlerCodexBackgroundModel } from "./butler-codex-model-policy.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import {
  normalizeProviderUsageLimit,
  type NormalizedProviderUsageLimit
} from "../sessions/session-provider-usage-limit.js";

const DEFAULT_CHECK_INTERVAL_SECONDS = 300;
const MIN_CHECK_INTERVAL_SECONDS = 60;
const MAX_CHECK_INTERVAL_SECONDS = 3600;
const DEFAULT_MAX_AUTO_CONTINUE_COUNT = 5;
const MIN_MAX_AUTO_CONTINUE_COUNT = 1;
const MAX_MAX_AUTO_CONTINUE_COUNT = 20;
const FOLLOW_UP_EVALUATOR_DIRNAME = ".butler-follow-up-evaluator";
const RECENT_HISTORY_LIMIT = 40;
const FOLLOW_UP_PERMISSION_CHECK_INTERVAL_MS = 10_000;
const FOLLOW_UP_ASSISTANT_WAIT_TIMEOUT_MS = 20 * 60_000;
const FOLLOW_UP_ASSISTANT_WAIT_POLL_INTERVAL_MS = 2_000;
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
  providerId: ButlerFollowUpTask["providerId"];
  assistantButlerSessionId: string;
  assistantSessionId: string;
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

export interface ButlerFollowUpRunDueTasksResult {
  activeTaskCount: number;
  dueTaskCount: number;
  processedTaskCount: number;
  idle: boolean;
}

export interface CreateButlerFollowUpTaskInput {
  projectId: string;
  butlerSessionId: string;
  providerId: ButlerFollowUpTask["providerId"];
  objective: string;
  completionCriteria?: string;
  maxAutoContinueCount?: number;
  checkIntervalSeconds?: number;
}

export interface ContinueButlerFollowUpTaskInput {
  summary: string;
  continuePrompt: string;
}

export interface WaitingUserButlerFollowUpTaskInput {
  summary: string;
  waitingReason: string;
}

export interface CompleteButlerFollowUpTaskInput {
  summary: string;
}

export interface FailButlerFollowUpTaskInput {
  summary: string;
  reason?: string | null;
}

interface FollowUpTaskInspection {
  providerId: string | null;
  runningState: SessionRunningState | null;
  messageAt: string | null;
  messageCount: number;
  sessionTitle: string | null;
  providerUsageLimit: NormalizedProviderUsageLimit | null;
  latestAssistantText: string | null;
  transcriptLines: string[];
}

interface FollowUpTaskExecutionState {
  cancelled: boolean;
  assistantSessionId: string | null;
}

interface FollowUpTaskProgressSnapshot {
  roundCount: number;
  updatedAt: string;
  lastAutomationAt: string | null;
  autoContinueCount: number;
}

class FollowUpTaskCancelledError extends Error {
  constructor() {
    super("FOLLOW_UP_TASK_CANCELLED");
    this.name = "FollowUpTaskCancelledError";
  }
}

export class ButlerFollowUpService {
  private readonly permissionRequestSweepAtByTaskId = new Map<string, number>();
  private readonly activeExecutionStateByTaskId = new Map<string, FollowUpTaskExecutionState>();

  constructor(
    private readonly butlerProfileService: Pick<ButlerProfileService, "ensureInitialized">,
    private readonly butlerProjectService: Pick<ButlerProjectService, "getById">,
    private readonly butlerSessionService: Pick<
      ButlerSessionService,
      "captureSessionSnapshot" | "startSession"
    >,
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
      | "interruptSession"
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

  private toTaskView(task: ButlerFollowUpTask): ButlerFollowUpTaskView {
    const project = this.butlerProjectService.getById(task.projectId);
    const index = this.sessionIndexRepository.findIndexRecordBySessionId(task.sessionId);
    return mapTaskView(task, project.workspaceId, project.name, index?.title ?? null);
  }

  private requireTaskForAssistantUpdate(taskId: string, userId: string): ButlerFollowUpTask {
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
        detail: "你没有权限更新这个跟进任务"
      });
    }

    if (task.status !== "active") {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_FOLLOW_UP_TASK_NOT_ACTIVE",
        detail: "当前跟进任务已经不处于可回写状态"
      });
    }

    return task;
  }

  async createTask(
    input: CreateButlerFollowUpTaskInput,
    userId: string
  ): Promise<ButlerFollowUpTaskView> {
    this.butlerProfileService.ensureInitialized();
    const project = this.butlerProjectService.getById(input.projectId);
    const providerId = normalizeFollowUpProviderId(input.providerId);
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
    const inspection = await this.inspectSession(snapshot.sessionId, userId);
    const assistantSession = await this.butlerSessionService.startSession(
      project.id,
      {
        providerId,
        role: "adhoc",
        ownershipMode: "managed",
        content: buildFollowUpBootstrapPrompt({
          project,
          sourceButlerSessionId: input.butlerSessionId,
          sourceSessionId: snapshot.sessionId,
          sourceSessionTitle: inspection.sessionTitle,
          objective,
          completionCriteria,
          maxAutoContinueCount,
          latestAssistantText: inspection.latestAssistantText,
          transcriptLines: inspection.transcriptLines
        }),
        model: resolveFollowUpModel(providerId, this.sourceCodexHomeDir),
        reasoningLevel: "low",
        permissionMode: "default"
      },
      userId
    );
    const timestamp = nowIso();
    const initialSummary =
      snapshot.runningState === "starting" || snapshot.runningState === "running"
        ? `已创建跟进助手会话，先等待当前运行结束，再由该会话决定是否继续推进。默认最多自动推进 ${maxAutoContinueCount} 轮。`
        : `已创建跟进助手会话，准备由该会话检查当前进展并决定是否继续推进。默认最多自动推进 ${maxAutoContinueCount} 轮。`;
    const task = this.butlerFollowUpTaskRepository.create({
      id: createId(),
      projectId: project.id,
      butlerSessionId: input.butlerSessionId,
      sessionId: snapshot.sessionId,
      providerId,
      assistantButlerSessionId: assistantSession.id,
      assistantSessionId: assistantSession.sessionId,
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

  async continueTask(
    taskId: string,
    input: ContinueButlerFollowUpTaskInput,
    userId: string
  ): Promise<ButlerFollowUpTaskView> {
    const summary = requireNonEmptyFollowUpText(input.summary, "summary", "继续推进必须提供 summary");
    const continuePrompt = requireNonEmptyFollowUpText(
      input.continuePrompt,
      "continuePrompt",
      "继续推进必须提供 continuePrompt"
    );
    const task = this.requireTaskForAssistantUpdate(taskId, userId);

    if (hasReachedAutoContinueLimit(task)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_FOLLOW_UP_TASK_LIMIT_REACHED",
        detail: "当前跟进任务已经达到自动推进上限，不能继续自动推进"
      });
    }

    this.butlerSessionService.captureSessionSnapshot(
      task.projectId,
      task.butlerSessionId,
      task.createdByUserId,
      { sourceKind: "manual" }
    );

    const inspection = await this.inspectTask(task);
    const timestamp = nowIso();
    const runningState = normalizeRunningState(inspection.runningState);
    const nextAutoContinueCount = task.autoContinueCount + 1;
    const updated = this.persistWithRound({
      ...task,
      status: "active",
      lastCheckedAt: timestamp,
      lastObservedRunningState: runningState,
      lastObservedMessageAt: inspection.messageAt,
      lastObservedMessageCount: inspection.messageCount,
      waitingReason: null,
      nextCheckAt: shiftSeconds(timestamp, task.checkIntervalSeconds),
      lastAutomationSummary: summary,
      lastAutomationAt: timestamp,
      autoContinueCount: nextAutoContinueCount,
      updatedAt: timestamp,
      completedAt: null
    }, {
      kind: "continue",
      status: "active",
      summary,
      waitingReason: null,
      continuePrompt,
      observedRunningState: runningState,
      autoContinueCount: nextAutoContinueCount,
      createdAt: timestamp
    });

    return this.toTaskView(updated);
  }

  async markTaskWaitingUser(
    taskId: string,
    input: WaitingUserButlerFollowUpTaskInput,
    userId: string
  ): Promise<ButlerFollowUpTaskView> {
    const summary = requireNonEmptyFollowUpText(
      input.summary,
      "summary",
      "等待用户必须提供 summary"
    );
    const waitingReason = requireNonEmptyFollowUpText(
      input.waitingReason,
      "waitingReason",
      "等待用户必须提供 waitingReason"
    );
    const task = this.requireTaskForAssistantUpdate(taskId, userId);
    const inspection = await this.inspectTask(task);
    const timestamp = nowIso();
    const runningState = normalizeRunningState(inspection.runningState);
    const updated = this.persistWithRound({
      ...task,
      status: "waiting_user",
      lastCheckedAt: timestamp,
      lastObservedRunningState: runningState,
      lastObservedMessageAt: inspection.messageAt,
      lastObservedMessageCount: inspection.messageCount,
      waitingReason,
      nextCheckAt: null,
      lastAutomationSummary: summary,
      lastAutomationAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    }, {
      kind: "waiting_user",
      status: "waiting_user",
      summary,
      waitingReason,
      continuePrompt: null,
      observedRunningState: runningState,
      autoContinueCount: task.autoContinueCount,
      createdAt: timestamp
    });

    return this.toTaskView(updated);
  }

  async completeTask(
    taskId: string,
    input: CompleteButlerFollowUpTaskInput,
    userId: string
  ): Promise<ButlerFollowUpTaskView> {
    const summary = requireNonEmptyFollowUpText(input.summary, "summary", "完成任务必须提供 summary");
    const task = this.requireTaskForAssistantUpdate(taskId, userId);
    const inspection = await this.inspectTask(task);
    const timestamp = nowIso();
    const runningState = normalizeRunningState(inspection.runningState);
    const updated = this.persistWithRound({
      ...task,
      status: "completed",
      lastCheckedAt: timestamp,
      lastObservedRunningState: runningState,
      lastObservedMessageAt: inspection.messageAt,
      lastObservedMessageCount: inspection.messageCount,
      waitingReason: null,
      nextCheckAt: null,
      lastAutomationSummary: summary,
      lastAutomationAt: timestamp,
      updatedAt: timestamp,
      completedAt: timestamp
    }, {
      kind: "completed",
      status: "completed",
      summary,
      waitingReason: null,
      continuePrompt: null,
      observedRunningState: runningState,
      autoContinueCount: task.autoContinueCount,
      createdAt: timestamp
    });

    return this.toTaskView(updated);
  }

  async failTask(
    taskId: string,
    input: FailButlerFollowUpTaskInput,
    userId: string
  ): Promise<ButlerFollowUpTaskView> {
    const summary = requireNonEmptyFollowUpText(input.summary, "summary", "标记失败必须提供 summary");
    const reason = normalizeNullableText(input.reason) ?? summary;
    const task = this.requireTaskForAssistantUpdate(taskId, userId);
    const inspection = await this.inspectTask(task);
    const timestamp = nowIso();
    const runningState = normalizeRunningState(inspection.runningState);
    const updated = this.persistWithRound({
      ...task,
      status: "failed",
      lastCheckedAt: timestamp,
      lastObservedRunningState: runningState,
      lastObservedMessageAt: inspection.messageAt,
      lastObservedMessageCount: inspection.messageCount,
      waitingReason: reason,
      nextCheckAt: null,
      lastAutomationSummary: summary,
      lastAutomationAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    }, {
      kind: "failed",
      status: "failed",
      summary,
      waitingReason: reason,
      continuePrompt: null,
      observedRunningState: runningState,
      autoContinueCount: task.autoContinueCount,
      createdAt: timestamp
    });

    return this.toTaskView(updated);
  }

  async cancelTask(taskId: string, userId: string): Promise<ButlerFollowUpTaskView> {
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

    const execution = this.markTaskExecutionCancelled(task.id);
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

    await this.stopActiveTaskAutomation(task, execution);

    const project = this.butlerProjectService.getById(updated.projectId);
    const index = this.sessionIndexRepository.findIndexRecordBySessionId(updated.sessionId);

    return mapTaskView(updated, project.workspaceId, project.name, index?.title ?? null);
  }

  async runDueTasks(referenceAt = nowIso()): Promise<ButlerFollowUpRunDueTasksResult> {
    const tasks = this.butlerFollowUpTaskRepository.list({
      statuses: ["active"],
      limit: 100
    });
    let dueTaskCount = 0;
    let processedTaskCount = 0;

    for (const task of tasks) {
      await this.autoApprovePendingPermissionRequestsIfDue(task, referenceAt);

      if (task.nextCheckAt && task.nextCheckAt > referenceAt) {
        continue;
      }

      dueTaskCount += 1;
      await this.processTask(task.id, referenceAt);
      processedTaskCount += 1;
    }

    return {
      activeTaskCount: tasks.length,
      dueTaskCount,
      processedTaskCount,
      idle: dueTaskCount === 0
    };
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

    const execution = this.beginTaskExecution(task.id);

    try {
      const project = this.butlerProjectService.getById(task.projectId);
      const inspection = await this.inspectTask(task);
      this.ensureTaskExecutionActive(task.id, execution);
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
        return this.persistIfExecutionActive(task.id, execution, {
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

        return this.persistWithRoundIfExecutionActive(task.id, execution, {
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

      if (shouldWaitForProviderUsageLimit(inspection.providerUsageLimit, referenceAt)) {
        const nextCheckAt = resolveProviderUsageLimitNextCheckAt(
          inspection.providerUsageLimit,
          referenceAt,
          task.checkIntervalSeconds
        );

        return this.persistIfExecutionActive(task.id, execution, {
          ...baseUpdate,
          status: "active",
          waitingReason: null,
          nextCheckAt,
          completedAt: null,
          lastAutomationAt: referenceAt,
          lastAutomationSummary: buildFollowUpUsageLimitSummary(
            inspection.providerUsageLimit,
            "检测到当前会话被 provider 额度限制暂时挡住。"
          )
        });
      }

      try {
        const progressBeforeDispatch = snapshotTaskProgress(task);
        await this.requestAssistantEvaluation(project, task, inspection, runningState, execution);
        this.ensureTaskExecutionActive(task.id, execution);

        return this.requireAssistantDecisionPersisted(task.id, progressBeforeDispatch);
      } catch (error) {
        if (error instanceof FollowUpTaskCancelledError) {
          return this.butlerFollowUpTaskRepository.findById(task.id) ?? task;
        }

        const providerUsageLimit = resolveProviderUsageLimitFromError(error, task.providerId, referenceAt);

        if (providerUsageLimit) {
          return this.persistIfExecutionActive(task.id, execution, {
            ...baseUpdate,
            status: "active",
            waitingReason: null,
            nextCheckAt: resolveProviderUsageLimitNextCheckAt(
              providerUsageLimit,
              referenceAt,
              task.checkIntervalSeconds
            ),
            completedAt: null,
            lastAutomationAt: referenceAt,
            lastAutomationSummary: buildFollowUpUsageLimitSummary(
              providerUsageLimit,
              "跟进助手会话当前被 provider 额度限制暂时挡住。"
            )
          });
        }

        if (isDeferredFollowUpSendError(error)) {
          return this.persistIfExecutionActive(task.id, execution, {
            ...baseUpdate,
            status: "active",
            waitingReason: null,
            nextCheckAt: shiftSeconds(referenceAt, task.checkIntervalSeconds),
            completedAt: null,
            lastAutomationAt: referenceAt,
            lastAutomationSummary: "跟进助手会话当前仍在运行，本轮继续等待下一次检查。"
          });
        }

        const detail = error instanceof Error ? error.message : String(error);
        const summary = `跟进助手执行失败：${detail}`;

        return this.persistWithRoundIfExecutionActive(task.id, execution, {
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
    } finally {
      if (this.activeExecutionStateByTaskId.get(task.id) === execution) {
        this.activeExecutionStateByTaskId.delete(task.id);
      }
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

  private requireAssistantDecisionPersisted(
    taskId: string,
    before: FollowUpTaskProgressSnapshot
  ): ButlerFollowUpTask {
    const updated = this.butlerFollowUpTaskRepository.findById(taskId);

    if (!updated) {
      throw new Error("跟进任务在回写结果前已丢失");
    }

    if (!hasTaskProgressAdvanced(updated, before)) {
      throw new Error("跟进助手没有通过 follow-ups 命令回写本轮结果");
    }

    return updated;
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

  private persistIfExecutionActive(
    taskId: string,
    execution: FollowUpTaskExecutionState,
    task: ButlerFollowUpTask
  ): ButlerFollowUpTask {
    if (!this.isTaskExecutionActive(taskId, execution)) {
      return this.butlerFollowUpTaskRepository.findById(taskId) ?? task;
    }

    return this.persist(task);
  }

  private persistWithRoundIfExecutionActive(
    taskId: string,
    execution: FollowUpTaskExecutionState,
    task: ButlerFollowUpTask,
    round: Omit<ButlerFollowUpRound, "roundNumber">
  ): ButlerFollowUpTask {
    if (!this.isTaskExecutionActive(taskId, execution)) {
      return this.butlerFollowUpTaskRepository.findById(taskId) ?? task;
    }

    return this.persistWithRound(task, round);
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
    providerId: string | null,
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
    | {
        delivery: "cooldown";
        providerUsageLimit: NormalizedProviderUsageLimit;
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
      const providerUsageLimit = resolveProviderUsageLimitFromError(error, providerId, referenceAt);

      if (providerUsageLimit) {
        return {
          delivery: "cooldown",
          providerUsageLimit
        };
      }

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
    return this.inspectSession(task.sessionId, task.createdByUserId);
  }

  private async inspectSession(
    sessionId: string,
    userId: string
  ): Promise<FollowUpTaskInspection> {
    const session = this.sessionHistoryService.getSession(sessionId, userId);
    const runtime = await this.sessionLiveRuntimeService.getSessionRuntime(
      sessionId,
      userId
    );
    const envelope = await this.sessionHistoryService.readRecentHistoryEnvelope(
      sessionId,
      RECENT_HISTORY_LIMIT
    );
    const latestAssistantText = resolveLatestAssistantText(envelope);
    const sortedMessages = (envelope?.messages ?? [])
      .slice()
      .sort((left, right) => left.sequence - right.sequence);
    const providerUsageLimit = resolveInspectionProviderUsageLimit(
      session.provider,
      session.lastErrorDetail,
      latestAssistantText,
      session.lastMessageAt
    );

    return {
      providerId: session.provider,
      runningState: normalizeRunningState(runtime.runningState),
      messageAt: session.lastMessageAt,
      messageCount: session.messageCount,
      sessionTitle: session.title ?? null,
      providerUsageLimit,
      latestAssistantText,
      transcriptLines: sortedMessages.map((message) => renderHistoryLine(
        message.sequence,
        message.role,
        message.kind ?? "text",
        message.timestamp,
        message.content
      ))
    };
  }

  private async requestAssistantEvaluation(
    project: ButlerProject,
    task: ButlerFollowUpTask,
    inspection: FollowUpTaskInspection,
    runningState: SessionRunningState | null,
    execution: FollowUpTaskExecutionState
  ): Promise<void> {
    const instruction = this.instructionAdapter.buildInstruction({
      taskId: task.id,
      providerId: task.providerId,
      project,
      sessionId: task.sessionId,
      butlerSessionId: task.butlerSessionId,
      assistantSessionId: task.assistantSessionId,
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
    execution.assistantSessionId = task.assistantSessionId;

    try {
      await this.waitForAssistantSessionTerminal(task.assistantSessionId, task.createdByUserId);
      this.ensureTaskExecutionActive(task.id, execution);
      await this.sessionLiveRuntimeService.sendLiveMessage({
        sessionId: task.assistantSessionId,
        userId: task.createdByUserId,
        content: instruction.prompt,
        clientRequestId: null,
        runtimeOptions: {
          model: resolveFollowUpModel(task.providerId, this.sourceCodexHomeDir),
          reasoningLevel: "low",
          permissionMode: "default",
          attachments: []
        }
      });
      await this.waitForAssistantSessionTerminal(task.assistantSessionId, task.createdByUserId);
      this.ensureTaskExecutionActive(task.id, execution);
    } finally {
      if (execution.assistantSessionId === task.assistantSessionId) {
        execution.assistantSessionId = null;
      }
    }
  }

  private beginTaskExecution(taskId: string): FollowUpTaskExecutionState {
    const execution: FollowUpTaskExecutionState = {
      cancelled: false,
      assistantSessionId: null
    };
    this.activeExecutionStateByTaskId.set(taskId, execution);
    return execution;
  }

  private markTaskExecutionCancelled(taskId: string): FollowUpTaskExecutionState | null {
    const execution = this.activeExecutionStateByTaskId.get(taskId) ?? null;

    if (execution) {
      execution.cancelled = true;
    }

    return execution;
  }

  private ensureTaskExecutionActive(taskId: string, execution: FollowUpTaskExecutionState): void {
    if (!this.isTaskExecutionActive(taskId, execution)) {
      throw new FollowUpTaskCancelledError();
    }
  }

  private isTaskExecutionActive(taskId: string, execution: FollowUpTaskExecutionState): boolean {
    const current = this.activeExecutionStateByTaskId.get(taskId);
    return Boolean(current && current === execution && !execution.cancelled);
  }

  private async stopActiveTaskAutomation(
    task: ButlerFollowUpTask,
    execution: FollowUpTaskExecutionState | null
  ): Promise<void> {
    if (!execution?.assistantSessionId) {
      return;
    }

    try {
      await this.sessionLiveRuntimeService.interruptSession(
        execution.assistantSessionId,
        task.createdByUserId
      );
    } catch (error) {
      console.warn("[butler-follow-up] interrupt assistant follow-up session failed", {
        sessionId: execution.assistantSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      execution.assistantSessionId = null;
    }
  }

  private async waitForAssistantSessionTerminal(sessionId: string, userId: string): Promise<void> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < FOLLOW_UP_ASSISTANT_WAIT_TIMEOUT_MS) {
      const runtime = await this.sessionLiveRuntimeService.getSessionRuntime(sessionId, userId);

      if (isAssistantTerminalRuntimeState(runtime.runningState)) {
        return;
      }

      await delay(FOLLOW_UP_ASSISTANT_WAIT_POLL_INTERVAL_MS);
    }

    throw new Error(`BUTLER_FOLLOW_UP_ASSISTANT_WAIT_TIMEOUT:${sessionId}`);
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
    providerId: task.providerId,
    assistantButlerSessionId: task.assistantButlerSessionId,
    assistantSessionId: task.assistantSessionId,
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

function normalizeFollowUpProviderId(value: string | undefined): ButlerFollowUpTask["providerId"] {
  switch (value) {
    case undefined:
    case null as never:
    case "":
      return "codex";
    case "codex":
    case "claude-code":
      return value;
    default:
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "会话跟进只允许选择 Codex 或 Claude Code",
        field: "providerId"
      });
  }
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

function buildFollowUpUsageLimitSummary(
  providerUsageLimit: NormalizedProviderUsageLimit,
  prefix: string
): string {
  return `${prefix} ${providerUsageLimit.summary}`;
}

function shouldWaitForProviderUsageLimit(
  providerUsageLimit: NormalizedProviderUsageLimit | null,
  referenceAt: string
): providerUsageLimit is NormalizedProviderUsageLimit {
  return Boolean(
    providerUsageLimit?.retryAt
    && Date.parse(providerUsageLimit.retryAt) > Date.parse(referenceAt)
  );
}

function resolveProviderUsageLimitNextCheckAt(
  providerUsageLimit: NormalizedProviderUsageLimit,
  referenceAt: string,
  fallbackSeconds: number
): string {
  if (providerUsageLimit.retryAt && Date.parse(providerUsageLimit.retryAt) > Date.parse(referenceAt)) {
    return providerUsageLimit.retryAt;
  }

  return shiftSeconds(referenceAt, fallbackSeconds);
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

function isAssistantTerminalRuntimeState(state: string | null): boolean {
  return state === "idle" || state === "completed" || state === "failed" || state === "interrupted";
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
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

function resolveInspectionProviderUsageLimit(
  providerId: string | null | undefined,
  lastErrorDetail: string | null | undefined,
  latestAssistantText: string | null | undefined,
  referenceAt: string | null | undefined
): NormalizedProviderUsageLimit | null {
  const normalizedReferenceAt = normalizeNullableIso(referenceAt) ?? undefined;
  const fromErrorDetail = normalizeProviderUsageLimit({
    providerId,
    text: lastErrorDetail,
    referenceAt: normalizedReferenceAt,
    source: "error_detail"
  });

  if (fromErrorDetail) {
    return fromErrorDetail;
  }

  return normalizeProviderUsageLimit({
    providerId,
    text: latestAssistantText,
    referenceAt: normalizedReferenceAt,
    source: "message"
  });
}

function resolveProviderUsageLimitFromError(
  error: unknown,
  providerId: string | null,
  referenceAt: string
): NormalizedProviderUsageLimit | null {
  if (error instanceof AppError) {
    const fromData = readProviderUsageLimitFromErrorData(error.data);

    if (fromData) {
      return fromData;
    }
  }

  if (error instanceof Error) {
    return normalizeProviderUsageLimit({
      providerId,
      text: error.message,
      referenceAt,
      source: "error"
    });
  }

  return null;
}

function readProviderUsageLimitFromErrorData(
  value: Record<string, unknown> | undefined
): NormalizedProviderUsageLimit | null {
  const candidate = value?.providerUsageLimit;

  if (!isRecord(candidate) || candidate.category !== "usage_limit") {
    return null;
  }

  return {
    category: "usage_limit",
    providerId: typeof candidate.providerId === "string" && candidate.providerId.trim().length > 0
      ? candidate.providerId.trim()
      : null,
    source: candidate.source === "error_detail" || candidate.source === "message" ? candidate.source : "error",
    retryAt: normalizeNullableIso(
      typeof candidate.retryAt === "string" ? candidate.retryAt : null
    ),
    retryAfterSeconds: typeof candidate.retryAfterSeconds === "number"
      && Number.isFinite(candidate.retryAfterSeconds)
      && candidate.retryAfterSeconds > 0
      ? candidate.retryAfterSeconds
      : null,
    rawText: typeof candidate.rawText === "string" ? candidate.rawText : "",
    summary: typeof candidate.summary === "string" && candidate.summary.trim().length > 0
      ? candidate.summary.trim()
      : "检测到 provider 额度已达上限，系统会按下一次可用时机自动重试。"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function buildFollowUpBootstrapPrompt(input: {
  project: ButlerProject;
  sourceButlerSessionId: string;
  sourceSessionId: string;
  sourceSessionTitle: string | null;
  objective: string;
  completionCriteria: string;
  maxAutoContinueCount: number;
  latestAssistantText: string | null;
  transcriptLines: string[];
}): string {
  const transcript =
    input.transcriptLines.length > 0
      ? input.transcriptLines.slice(-12).join("\n")
      : "- 暂时没有可用消息，请先按会话现状建立上下文。";

  return [
    "你现在是这条开发会话的专用跟进助手，会长期复用当前助手会话推进，不再切回隐藏评估器。",
    "你的职责只有三件事：",
    "1. 用 codingns assistant CLI 复核目标项目和目标会话的最新状态。",
    "2. 判断当前是否真的还需要继续跟进，还是应该等待用户决定，或者已经可以结束。",
    "3. 用 codingns assistant sessions send 和 codingns assistant follow-ups.* 自己完成发消息与任务回写，不要等后台代发或猜结果。",
    "",
    "硬约束：",
    "- 不要直接改当前仓库代码，这条会话只负责跟进判断和向目标开发会话发消息。",
    "- 如果决定继续，必须显式使用 `codingns assistant sessions send` 把中文跟进消息发到目标开发会话。",
    "- 每一轮正式结论都必须用 `codingns assistant follow-ups continue|waiting-user|complete|fail` 之一回写到跟进任务。",
    "- 如果信息不足或需要用户决策，要明确说明缺口，不要假装已经发消息。",
    "- 跟进边界只围绕当前目标和结束条件，不准顺手扩范围。",
    "",
    `项目名称：${input.project.name}`,
    `项目路径：${input.project.repoRoot}`,
    `目标 Butler 会话 ID：${input.sourceButlerSessionId}`,
    `目标真实会话 ID：${input.sourceSessionId}`,
    `目标会话标题：${input.sourceSessionTitle ?? "未命名会话"}`,
    `跟进目标：${input.objective}`,
    `结束条件：${input.completionCriteria}`,
    `最多自动推进轮数：${input.maxAutoContinueCount}`,
    `最近一条助手消息：${input.latestAssistantText?.trim() || "无"}`,
    "",
    "最近消息摘录：",
    transcript,
    "",
    "这条消息只用来建立上下文。请先整理当前理解，后续我会继续给你发送正式的跟进检查请求。"
  ].join("\n");
}

function resolveFollowUpModel(
  providerId: ButlerProfile["providerId"],
  sourceCodexHomeDir: string | null
): string | null {
  if (providerId !== "codex") {
    return "haiku";
  }

  return resolveButlerCodexBackgroundModel("gpt-5.1-codex-mini", sourceCodexHomeDir);
}

function snapshotTaskProgress(task: ButlerFollowUpTask): FollowUpTaskProgressSnapshot {
  return {
    roundCount: normalizeFollowUpRounds(task.rounds).length,
    updatedAt: task.updatedAt,
    lastAutomationAt: task.lastAutomationAt,
    autoContinueCount: task.autoContinueCount
  };
}

function hasTaskProgressAdvanced(
  task: ButlerFollowUpTask,
  before: FollowUpTaskProgressSnapshot
): boolean {
  const roundCount = normalizeFollowUpRounds(task.rounds).length;
  return (
    roundCount > before.roundCount
    || task.updatedAt !== before.updatedAt
    || task.lastAutomationAt !== before.lastAutomationAt
    || task.autoContinueCount !== before.autoContinueCount
  );
}

function requireNonEmptyFollowUpText(
  value: unknown,
  field: string,
  detail: string
): string {
  if (typeof value !== "string") {
    throw new AppError({
      statusCode: 400,
      errorCode: "BUTLER_FOLLOW_UP_TASK_INVALID_INPUT",
      detail
    });
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "BUTLER_FOLLOW_UP_TASK_INVALID_INPUT",
      detail
    });
  }

  if (normalized.length > 4000) {
    throw new AppError({
      statusCode: 400,
      errorCode: "BUTLER_FOLLOW_UP_TASK_INVALID_INPUT",
      detail: `${field} 长度不能超过 4000 个字符`
    });
  }

  return normalized;
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}
