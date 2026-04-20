import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { AssistantAutomationRunRepository } from "../../storage/repositories/assistant-automation-run-repository.js";
import type { AssistantAutomationTaskRepository } from "../../storage/repositories/assistant-automation-task-repository.js";
import type {
  AssistantAutomationRun,
  AssistantAutomationStatus,
  AssistantAutomationTask
} from "../../types/domain.js";
import type { SessionRuntimeStatusView } from "../sessions/session-live-runtime-service.js";
import { readProviderUsageLimitErrorData } from "../sessions/session-provider-usage-guard-service.js";
import { createTaskManager, type TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../tasks/task-types.js";
import type { GitCommandRunner } from "../git/git-command-runner.js";
import type { ButlerProfileService } from "./butler-profile-service.js";
import type {
  ButlerControlSessionService,
  ButlerControlSessionView
} from "./butler-control-session-service.js";
import {
  buildConditionTriggerConfig,
  computeNextRunAt,
  createTriggerConfig,
  parseActionConfig,
  parseConditionState,
  parseTriggerConfig,
  type AssistantAutomationTriggerConfig,
  type AssistantConditionKind,
  type ConditionTriggerConfig,
  type CreateAssistantAutomationTriggerInput,
  type GitRemoteTagChangedConditionState,
  type SendControlMessageActionConfig,
  type SessionRuntimeIdleConditionState
} from "./assistant-automation-trigger.js";

const DEFAULT_DUE_TASK_LIMIT = 20;
const DEFAULT_RECENT_RUN_LIMIT = 30;

export interface AssistantAutomationTaskView extends AssistantAutomationTask {
  controlSession: ButlerControlSessionView | null;
  triggerConfig: AssistantAutomationTriggerConfig;
  actionConfig: SendControlMessageActionConfig;
}

export interface AssistantAutomationRunView extends AssistantAutomationRun {
  triggerSnapshot: AssistantAutomationTriggerConfig & {
    triggerContext?: Record<string, unknown>;
  };
  actionSnapshot: SendControlMessageActionConfig;
}

export interface CreateAssistantAutomationInput {
  userId: string;
  controlSessionId?: string | null;
  projectId?: string | null;
  title?: string | null;
  trigger: CreateAssistantAutomationTriggerInput;
  action: {
    type: "send_control_message";
    content: string;
    includeTriggerContext?: boolean;
    targetSessionId?: string | null;
  };
}

export interface UpdateAssistantAutomationInput {
  taskId: string;
  userId: string;
  title?: string | null;
  content?: string;
  includeTriggerContext?: boolean;
  dueAt?: string | null;
  everySeconds?: number | null;
  everyMinutes?: number | null;
  everyHours?: number | null;
  stopAt?: string | null;
  cronMinute?: number | null;
  cronHour?: number | null;
  cronDaysOfWeek?: number[] | null;
  pollIntervalSeconds?: number | null;
  expiresAt?: string | null;
  maxChecks?: number | null;
}

export interface AssistantAutomationRunDueTasksResult {
  activeTaskCount: number;
  dueTaskCount: number;
  processedTaskCount: number;
  idle: boolean;
}

interface AssistantAutomationDependencies {
  gitCommandRunner?: Pick<GitCommandRunner, "run">;
  sessionLiveRuntimeService?: Pick<{
    getSessionRuntime(sessionId: string, userId: string): Promise<SessionRuntimeStatusView>;
  }, "getSessionRuntime">;
  gitWorkingDirectory?: string;
}

type PreparedAutomationAction =
  | {
      kind: "skip";
      task: AssistantAutomationTask;
    }
  | {
      kind: "run";
      task: AssistantAutomationTask;
      scheduledAt: string;
      triggerSnapshotJson: string;
      actionConfig: SendControlMessageActionConfig;
      messageContent: string;
      finalizeSuccess: (finishedAt: string, summary: string) => AssistantAutomationTask;
      finalizeFailure: (finishedAt: string, errorMessage: string) => AssistantAutomationTask;
    };

export class AssistantAutomationService {
  private readonly taskManager: TaskManager;
  private readonly gitCommandRunner: Pick<GitCommandRunner, "run"> | null;
  private readonly sessionLiveRuntimeService:
    | Pick<{ getSessionRuntime(sessionId: string, userId: string): Promise<SessionRuntimeStatusView> }, "getSessionRuntime">
    | null;
  private readonly gitWorkingDirectory: string;

  constructor(
    private readonly butlerProfileService: Pick<ButlerProfileService, "ensureInitialized">,
    private readonly butlerControlSessionService: Pick<
      ButlerControlSessionService,
      "getCurrentSession" | "getSession" | "sendMessage"
    >,
    private readonly taskRepository: AssistantAutomationTaskRepository,
    private readonly runRepository: Pick<
      AssistantAutomationRunRepository,
      | "create"
      | "listByAutomation"
      | "findLatestByAutomation"
      | "getLatestSeq"
      | "listRecent"
      | "update"
    >,
    taskManager: TaskManager = createTaskManager(),
    dependencies: AssistantAutomationDependencies = {}
  ) {
    this.taskManager = taskManager;
    this.gitCommandRunner = dependencies.gitCommandRunner ?? null;
    this.sessionLiveRuntimeService = dependencies.sessionLiveRuntimeService ?? null;
    this.gitWorkingDirectory = dependencies.gitWorkingDirectory ?? process.cwd();
    this.registerBackgroundTasks();
  }

  listTasks(filters: {
    userId: string;
    statuses?: AssistantAutomationStatus[];
    controlSessionId?: string | null;
    limit?: number;
  }): AssistantAutomationTaskView[] {
    this.butlerProfileService.ensureInitialized();
    return this.taskRepository
      .list({
        statuses: filters.statuses,
        controlSessionId: filters.controlSessionId?.trim() || undefined,
        limit: filters.limit
      })
      .map((record) => this.toTaskView(record, filters.userId));
  }

  getTask(taskId: string, userId: string): AssistantAutomationTaskView {
    this.butlerProfileService.ensureInitialized();
    const task = this.requireTask(taskId.trim());
    return this.toTaskView(task, userId);
  }

  listRuns(taskId: string, _userId: string, limit?: number): AssistantAutomationRunView[] {
    this.butlerProfileService.ensureInitialized();
    this.requireTask(taskId);
    return this.runRepository
      .listByAutomation(taskId.trim(), limit)
      .map((record) => this.toRunView(record));
  }

  listRecentRuns(filters: {
    userId: string;
    controlSessionId?: string | null;
    limit?: number;
  }): AssistantAutomationRunView[] {
    this.butlerProfileService.ensureInitialized();
    const limit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_RECENT_RUN_LIMIT;
    const taskMap = new Map(this.taskRepository.list().map((task) => [task.id, task] as const));

    return this.runRepository
      .listRecent(limit * 3)
      .filter((run) => {
        const task = taskMap.get(run.automationId);

        if (!task || task.userId !== filters.userId) {
          return false;
        }

        if (filters.controlSessionId?.trim()) {
          return task.controlSessionId === filters.controlSessionId.trim();
        }

        return true;
      })
      .slice(0, limit)
      .map((record) => this.toRunView(record));
  }

  createTask(input: CreateAssistantAutomationInput): AssistantAutomationTaskView {
    this.butlerProfileService.ensureInitialized();
    const controlSession = input.controlSessionId?.trim()
      ? this.butlerControlSessionService.getSession(input.controlSessionId, input.userId)
      : this.butlerControlSessionService.getCurrentSession(input.userId);

    if (!controlSession) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_CONTROL_SESSION_NOT_FOUND",
        detail: "当前没有可用的助手控制会话，无法创建自动化任务"
      });
    }

    const timestamp = nowIso();
    const trigger = createTriggerConfig(input.trigger, timestamp);
    const task = this.taskRepository.create({
      id: createId(),
      userId: input.userId,
      controlSessionId: controlSession.id,
      projectId: normalizeNullableText(input.projectId),
      title: normalizeNullableText(input.title),
      triggerType: trigger.triggerType,
      triggerConfigJson: trigger.triggerConfigJson,
      actionType: "send_control_message",
      actionConfigJson: JSON.stringify({
        content: requireContent(input.action.content),
        includeTriggerContext: input.action.includeTriggerContext === true,
        targetSessionId: normalizeNullableText(input.action.targetSessionId)
      } satisfies SendControlMessageActionConfig),
      status: "active",
      nextRunAt: trigger.nextRunAt,
      lastRunAt: null,
      lastRunSummary: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      cancelledAt: null
    });

    return this.toTaskView(task, input.userId);
  }

  updateTask(input: UpdateAssistantAutomationInput): AssistantAutomationTaskView {
    this.butlerProfileService.ensureInitialized();
    const current = this.requireTask(input.taskId);

    if (current.status !== "active") {
      throw new AppError({
        statusCode: 409,
        errorCode: "ASSISTANT_AUTOMATION_UPDATE_NOT_ALLOWED",
        detail: "只有进行中的自动化可以修改配置"
      });
    }

    const updatedAt = nowIso();
    const currentTriggerConfig = parseTriggerConfig(current.triggerType, current.triggerConfigJson);
    const currentActionConfig = parseActionConfig(current.actionConfigJson);
    const trigger = this.buildUpdatedTrigger(current, currentTriggerConfig, input, updatedAt);
    const actionConfig: SendControlMessageActionConfig = {
      content:
        typeof input.content === "string"
          ? requireContent(input.content)
          : currentActionConfig.content,
      includeTriggerContext:
        typeof input.includeTriggerContext === "boolean"
          ? input.includeTriggerContext
          : currentActionConfig.includeTriggerContext,
      targetSessionId: currentActionConfig.targetSessionId
    };
    const nextTitle =
      input.title !== undefined
        ? normalizeNullableText(input.title)
        : current.title;

    const updated = this.taskRepository.update({
      ...current,
      title: nextTitle,
      triggerConfigJson: trigger.triggerConfigJson,
      nextRunAt: trigger.nextRunAt,
      actionConfigJson: JSON.stringify(actionConfig),
      updatedAt,
      lastError: null
    });

    return this.toTaskView(updated, input.userId);
  }

  cancelTask(taskId: string, userId: string): AssistantAutomationTaskView {
    this.butlerProfileService.ensureInitialized();
    const current = this.requireTask(taskId);
    const cancelledAt = nowIso();
    const updated = this.taskRepository.update({
      ...current,
      status: "cancelled",
      updatedAt: cancelledAt,
      cancelledAt,
      nextRunAt: null
    });

    return this.toTaskView(updated, userId);
  }

  skipCurrentWait(taskId: string, userId: string): AssistantAutomationTaskView {
    this.butlerProfileService.ensureInitialized();
    const current = this.requireTask(taskId);

    if (current.status !== "active" || !current.nextRunAt) {
      throw new AppError({
        statusCode: 409,
        errorCode: "ASSISTANT_AUTOMATION_WAIT_NOT_ACTIVE",
        detail: "当前自动化没有可取消的等待"
      });
    }

    if (current.triggerType === "once") {
      throw new AppError({
        statusCode: 409,
        errorCode: "ASSISTANT_AUTOMATION_WAIT_SKIP_UNSUPPORTED",
        detail: "单次自动化不支持只取消本次等待"
      });
    }

    const referenceAt = nowIso();
    const triggerConfig = parseTriggerConfig(current.triggerType, current.triggerConfigJson);
    const nextReferenceAt = current.nextRunAt > referenceAt ? current.nextRunAt : referenceAt;
    const nextRunAt = computeNextRunAt(triggerConfig, nextReferenceAt);
    const updatedAt = referenceAt;

    this.runRepository.create({
      id: createId(),
      automationId: current.id,
      runSeq: this.runRepository.getLatestSeq(current.id) + 1,
      triggerType: current.triggerType,
      triggerSnapshotJson: current.triggerConfigJson,
      actionType: current.actionType,
      actionSnapshotJson: current.actionConfigJson,
      status: "cancelled",
      summary: "已手动取消本次等待，保留自动化并重新安排下一次运行。",
      error: null,
      scheduledAt: current.nextRunAt,
      startedAt: updatedAt,
      finishedAt: updatedAt,
      createdAt: updatedAt
    });

    const updated = this.taskRepository.update({
      ...current,
      status: nextRunAt === null ? "completed" : "active",
      nextRunAt,
      lastError: null,
      updatedAt
    });

    return this.toTaskView(updated, userId);
  }

  async runDueTasks(referenceAt: string): Promise<AssistantAutomationRunDueTasksResult> {
    this.butlerProfileService.ensureInitialized();
    return await this.taskManager.enqueue<{
      referenceAt: string;
    }, AssistantAutomationRunDueTasksResult>(HOST_TASK_TYPES.assistantAutomationTick, {
      key: "global",
      source: "assistant_automation.run_due_tasks",
      input: {
        referenceAt
      }
    }).promise;
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.assistantAutomationTick)) {
      this.taskManager.register<{
        referenceAt: string;
      }, AssistantAutomationRunDueTasksResult>({
        taskType: HOST_TASK_TYPES.assistantAutomationTick,
        executionLane: "host_background",
        timeoutMs: 10_000,
        run: async ({ referenceAt }) => await this.runDueTasksDirect(referenceAt)
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.assistantAutomationEvaluate)) {
      this.taskManager.register<{
        automationId: string;
        referenceAt: string;
      }, void>({
        taskType: HOST_TASK_TYPES.assistantAutomationEvaluate,
        executionLane: "host_background",
        timeoutMs: 20_000,
        run: async ({ automationId, referenceAt }) => {
          await this.evaluateTask(automationId, referenceAt);
        }
      });
    }
  }

  private async runDueTasksDirect(referenceAt: string): Promise<AssistantAutomationRunDueTasksResult> {
    this.reactivatePausedTasks(referenceAt);
    const activeTaskCount = this.taskRepository.list({
      statuses: ["active"]
    }).length;
    const dueTasks = this.taskRepository.listDueActive(referenceAt, DEFAULT_DUE_TASK_LIMIT);
    const handles = dueTasks.map((task) =>
      this.taskManager.enqueue<{
        automationId: string;
        referenceAt: string;
      }, void>(HOST_TASK_TYPES.assistantAutomationEvaluate, {
        key: task.id,
        source: "assistant_automation.tick.evaluate",
        input: {
          automationId: task.id,
          referenceAt
        }
      })
    );
    await Promise.all(handles.map((handle) => handle.promise));

    return {
      activeTaskCount,
      dueTaskCount: dueTasks.length,
      processedTaskCount: dueTasks.length,
      idle: dueTasks.length === 0
    };
  }

  private reactivatePausedTasks(referenceAt: string): void {
    const pausedTasks = this.taskRepository.listDuePaused(referenceAt, DEFAULT_DUE_TASK_LIMIT);

    for (const task of pausedTasks) {
      this.taskRepository.update({
        ...task,
        status: "active",
        updatedAt: referenceAt
      });
    }
  }

  private async evaluateTask(automationId: string, referenceAt: string): Promise<void> {
    const task = this.reconcileTaskWithLatestRun(this.requireTask(automationId), referenceAt);

    if (!task || task.status !== "active" || !task.nextRunAt || task.nextRunAt > referenceAt) {
      return;
    }

    await this.processDueTask(task, referenceAt);
  }

  private async processDueTask(
    task: AssistantAutomationTask,
    referenceAt: string
  ): Promise<void> {
    const prepared = await this.prepareDueTask(task, referenceAt);

    if (prepared.kind === "skip") {
      this.taskRepository.update(prepared.task);
      return;
    }

    const run = this.runRepository.create({
      id: createId(),
      automationId: task.id,
      runSeq: this.runRepository.getLatestSeq(task.id) + 1,
      triggerType: task.triggerType,
      triggerSnapshotJson: prepared.triggerSnapshotJson,
      actionType: task.actionType,
      actionSnapshotJson: task.actionConfigJson,
      status: "running",
      summary: null,
      error: null,
      scheduledAt: prepared.scheduledAt,
      startedAt: referenceAt,
      finishedAt: null,
      createdAt: referenceAt
    });

    try {
      const result = await this.butlerControlSessionService.sendMessage(task.userId, {
        controlSessionId: task.controlSessionId,
        content: prepared.messageContent,
        clientRequestId: buildAutomationClientRequestId(task.id, prepared.scheduledAt)
      });
      const summary = summarizeMessage(prepared.messageContent);
      const finishedRun = this.runRepository.update({
        ...run,
        status: "succeeded",
        summary,
        error: null,
        finishedAt: result.acceptedAt
      });
      this.taskRepository.update(
        prepared.finalizeSuccess(
          result.acceptedAt,
          finishedRun.summary ?? summary
        )
      );
    } catch (error) {
      const usageLimitBlocked = readProviderUsageLimitErrorData(
        error instanceof AppError ? error.data : undefined
      );

      if (usageLimitBlocked?.blockedUntil) {
        const summary = `${usageLimitBlocked.sourceLabel?.trim() || "当前控制会话"}检测到 provider 套餐限额，已顺延到 ${usageLimitBlocked.blockedUntil} 后再继续。`;
        this.runRepository.update({
          ...run,
          status: "skipped",
          summary,
          error: null,
          finishedAt: referenceAt
        });
        this.taskRepository.update(
          this.buildUsageLimitDeferredTask(
            task,
            prepared,
            referenceAt,
            usageLimitBlocked.blockedUntil,
            usageLimitBlocked.sourceLabel
          )
        );
        return;
      }

      const finishedAt = nowIso();
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.runRepository.update({
        ...run,
        status: "failed",
        summary: null,
        error: errorMessage,
        finishedAt
      });
      this.taskRepository.update(prepared.finalizeFailure(finishedAt, errorMessage));
    }
  }

  private async prepareDueTask(
    task: AssistantAutomationTask,
    referenceAt: string
  ): Promise<PreparedAutomationAction> {
    const actionConfig = parseActionConfig(task.actionConfigJson);
    const triggerConfig = parseTriggerConfig(task.triggerType, task.triggerConfigJson);
    const scheduledAt = task.nextRunAt ?? referenceAt;

    if (triggerConfig.type === "condition") {
      return await this.prepareConditionTask(task, triggerConfig, actionConfig, referenceAt, scheduledAt);
    }

    const messageContent = actionConfig.content;
    const triggerSnapshotJson = JSON.stringify(triggerConfig);

    return {
      kind: "run",
      task,
      scheduledAt,
      triggerSnapshotJson,
      actionConfig,
      messageContent,
      finalizeSuccess: (finishedAt, summary) => this.finalizeSuccessfulTask(task, triggerConfig, finishedAt, summary),
      finalizeFailure: (finishedAt, errorMessage) => ({
        ...task,
        status: "failed",
        nextRunAt: null,
        lastRunAt: finishedAt,
        lastError: errorMessage,
        updatedAt: finishedAt
      })
    };
  }

  private async prepareConditionTask(
    task: AssistantAutomationTask,
    triggerConfig: ConditionTriggerConfig,
    actionConfig: SendControlMessageActionConfig,
    referenceAt: string,
    scheduledAt: string
  ): Promise<PreparedAutomationAction> {
    const currentState = parseConditionState(triggerConfig);

    if (shouldCompleteConditionWithoutCheck(triggerConfig, currentState, referenceAt)) {
      return {
        kind: "skip",
        task: {
          ...task,
          status: "completed",
          nextRunAt: null,
          updatedAt: referenceAt,
          lastError: null
        }
      };
    }

    try {
      if (triggerConfig.conditionKind === "git.remote_tag_changed") {
        return await this.prepareGitRemoteTagChangedTask(
          task,
          triggerConfig,
          currentState as GitRemoteTagChangedConditionState,
          actionConfig,
          referenceAt,
          scheduledAt
        );
      }

      return await this.prepareSessionRuntimeIdleTask(
        task,
        triggerConfig,
        currentState as SessionRuntimeIdleConditionState,
        actionConfig,
        referenceAt,
        scheduledAt
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const nextState = bumpConditionStateOnError(triggerConfig.conditionKind, currentState, referenceAt);
      const nextTask = this.buildConditionSkippedTask(task, triggerConfig, nextState, referenceAt, errorMessage);
      return {
        kind: "skip",
        task: nextTask
      };
    }
  }

  private async prepareGitRemoteTagChangedTask(
    task: AssistantAutomationTask,
    triggerConfig: ConditionTriggerConfig,
    state: GitRemoteTagChangedConditionState,
    actionConfig: SendControlMessageActionConfig,
    referenceAt: string,
    scheduledAt: string
  ): Promise<PreparedAutomationAction> {
    const latest = await this.readLatestRemoteTag(state.repositoryUrl);
    const nextState: GitRemoteTagChangedConditionState = {
      ...state,
      latestTag: latest.tag,
      latestRef: latest.ref,
      checkCount: state.checkCount + 1,
      lastCheckedAt: referenceAt
    };

    const baselineMissing = !state.latestTag && !state.latestRef;
    const matched =
      !baselineMissing
      && (state.latestTag !== latest.tag || state.latestRef !== latest.ref);

    if (!matched) {
      return {
        kind: "skip",
        task: this.buildConditionSkippedTask(task, triggerConfig, nextState, referenceAt, null)
      };
    }

    const nextTriggerConfig = buildConditionTriggerConfig(triggerConfig, nextState);
    const triggerContext = {
      conditionKind: triggerConfig.conditionKind,
      repositoryUrl: state.repositoryUrl,
      previousTag: state.latestTag,
      previousRef: state.latestRef,
      currentTag: latest.tag,
      currentRef: latest.ref,
      checkedAt: referenceAt
    };
    const messageContent = mergeTriggerContext(
      actionConfig.content,
      actionConfig.includeTriggerContext,
      buildGitTagChangedContextMessage(triggerContext)
    );

    return {
      kind: "run",
      task,
      scheduledAt,
      triggerSnapshotJson: JSON.stringify({
        ...nextTriggerConfig,
        triggerContext
      }),
      actionConfig,
      messageContent,
      finalizeSuccess: (finishedAt, summary) => ({
        ...task,
        triggerConfigJson: JSON.stringify(nextTriggerConfig),
        status: "completed",
        nextRunAt: null,
        lastRunAt: finishedAt,
        lastRunSummary: summary,
        lastError: null,
        updatedAt: finishedAt
      }),
      finalizeFailure: (finishedAt, errorMessage) => ({
        ...task,
        triggerConfigJson: JSON.stringify(nextTriggerConfig),
        status: "failed",
        nextRunAt: null,
        lastRunAt: finishedAt,
        lastError: errorMessage,
        updatedAt: finishedAt
      })
    };
  }

  private async prepareSessionRuntimeIdleTask(
    task: AssistantAutomationTask,
    triggerConfig: ConditionTriggerConfig,
    state: SessionRuntimeIdleConditionState,
    actionConfig: SendControlMessageActionConfig,
    referenceAt: string,
    scheduledAt: string
  ): Promise<PreparedAutomationAction> {
    if (!this.sessionLiveRuntimeService) {
      throw new AppError({
        statusCode: 500,
        errorCode: "ASSISTANT_AUTOMATION_CONDITION_UNSUPPORTED",
        detail: "当前环境未配置 session runtime 能力，无法检查 session.runtime_idle"
      });
    }

    const runtime = await this.sessionLiveRuntimeService.getSessionRuntime(state.sessionId, task.userId);
    const nextState: SessionRuntimeIdleConditionState = {
      ...state,
      lastObservedRunningState: normalizeNullableText(String(runtime.runningState)),
      lastHasActiveRun: runtime.hasActiveRun,
      checkCount: state.checkCount + 1,
      lastCheckedAt: referenceAt
    };
    const baselineMissing = state.lastHasActiveRun === null && !state.lastObservedRunningState;
    const matched =
      !baselineMissing
      && state.lastHasActiveRun === true
      && runtime.hasActiveRun === false;

    if (!matched) {
      return {
        kind: "skip",
        task: this.buildConditionSkippedTask(task, triggerConfig, nextState, referenceAt, null)
      };
    }

    const nextTriggerConfig = buildConditionTriggerConfig(triggerConfig, nextState);
    const triggerContext = {
      conditionKind: triggerConfig.conditionKind,
      sessionId: state.sessionId,
      previousRunningState: state.lastObservedRunningState,
      previousHasActiveRun: state.lastHasActiveRun,
      currentRunningState: String(runtime.runningState),
      currentHasActiveRun: runtime.hasActiveRun,
      checkedAt: referenceAt
    };
    const messageContent = mergeTriggerContext(
      actionConfig.content,
      actionConfig.includeTriggerContext,
      buildSessionRuntimeIdleContextMessage(triggerContext)
    );

    return {
      kind: "run",
      task,
      scheduledAt,
      triggerSnapshotJson: JSON.stringify({
        ...nextTriggerConfig,
        triggerContext
      }),
      actionConfig,
      messageContent,
      finalizeSuccess: (finishedAt, summary) => ({
        ...task,
        triggerConfigJson: JSON.stringify(nextTriggerConfig),
        status: "completed",
        nextRunAt: null,
        lastRunAt: finishedAt,
        lastRunSummary: summary,
        lastError: null,
        updatedAt: finishedAt
      }),
      finalizeFailure: (finishedAt, errorMessage) => ({
        ...task,
        triggerConfigJson: JSON.stringify(nextTriggerConfig),
        status: "failed",
        nextRunAt: null,
        lastRunAt: finishedAt,
        lastError: errorMessage,
        updatedAt: finishedAt
      })
    };
  }

  private buildConditionSkippedTask(
    task: AssistantAutomationTask,
    triggerConfig: ConditionTriggerConfig,
    nextState: GitRemoteTagChangedConditionState | SessionRuntimeIdleConditionState,
    referenceAt: string,
    lastError: string | null
  ): AssistantAutomationTask {
    const nextTriggerConfig = buildConditionTriggerConfig(triggerConfig, nextState);
    const exhaustedByCount =
      triggerConfig.maxChecks !== null && nextState.checkCount >= triggerConfig.maxChecks;
    const nextRunAt = exhaustedByCount ? null : computeNextRunAt(nextTriggerConfig, referenceAt);
    const completed = nextRunAt === null;

    return {
      ...task,
      triggerConfigJson: JSON.stringify(nextTriggerConfig),
      status: completed ? "completed" : "active",
      nextRunAt,
      lastError,
      updatedAt: referenceAt
    };
  }

  private finalizeSuccessfulTask(
    task: AssistantAutomationTask,
    triggerConfig: AssistantAutomationTriggerConfig,
    finishedAt: string,
    summary: string
  ): AssistantAutomationTask {
    const nextRunAt = computeNextRunAt(triggerConfig, finishedAt);
    const completed = triggerConfig.type === "once" || nextRunAt === null;

    return {
      ...task,
      status: completed ? "completed" : "active",
      nextRunAt,
      lastRunAt: finishedAt,
      lastRunSummary: summary,
      lastError: null,
      updatedAt: finishedAt
    };
  }

  private buildUsageLimitDeferredTask(
    task: AssistantAutomationTask,
    prepared: Extract<PreparedAutomationAction, { kind: "run" }>,
    referenceAt: string,
    blockedUntil: string,
    sourceLabel: string | null
  ): AssistantAutomationTask {
    const effectiveLabel = sourceLabel?.trim()
      || (
        prepared.actionConfig.targetSessionId?.trim()
          ? `目标会话 ${prepared.actionConfig.targetSessionId.trim()}`
          : "当前控制会话"
      );
    const summary = `${effectiveLabel}检测到 provider 套餐限额，系统会在 ${blockedUntil} 后自动继续。`;
    const nextStatus = task.triggerType === "once" ? "active" : "paused";

    return {
      ...task,
      status: nextStatus,
      nextRunAt: blockedUntil,
      lastRunAt: referenceAt,
      lastRunSummary: summary,
      lastError: null,
      updatedAt: referenceAt
    };
  }

  private requireTask(taskId: string): AssistantAutomationTask {
    const task = this.taskRepository.findById(taskId.trim());

    if (!task) {
      throw new AppError({
        statusCode: 404,
        errorCode: "ASSISTANT_AUTOMATION_NOT_FOUND",
        detail: "未找到对应的助手自动化任务"
      });
    }

    return task;
  }

  private buildUpdatedTrigger(
    task: AssistantAutomationTask,
    currentTriggerConfig: AssistantAutomationTriggerConfig,
    input: UpdateAssistantAutomationInput,
    referenceAt: string
  ): {
    triggerConfigJson: string;
    nextRunAt: string | null;
  } {
    switch (currentTriggerConfig.type) {
      case "once": {
        const nextDueAt =
          input.dueAt !== undefined
            ? requireIsoTimestamp(input.dueAt, "dueAt")
            : currentTriggerConfig.dueAt;

        return {
          triggerConfigJson: JSON.stringify({
            type: "once",
            dueAt: nextDueAt
          }),
          nextRunAt: nextDueAt
        };
      }
      case "interval": {
        const nextTrigger = createTriggerConfig({
          type: "interval",
          seconds: input.everySeconds !== undefined ? input.everySeconds : currentTriggerConfig.seconds,
          minutes: input.everyMinutes !== undefined ? input.everyMinutes : currentTriggerConfig.minutes,
          hours: input.everyHours !== undefined ? input.everyHours : currentTriggerConfig.hours,
          stopAt: input.stopAt !== undefined ? input.stopAt : currentTriggerConfig.stopAt
        }, referenceAt);

        return {
          triggerConfigJson: nextTrigger.triggerConfigJson,
          nextRunAt: nextTrigger.nextRunAt
        };
      }
      case "cron": {
        const nextTrigger = createTriggerConfig({
          type: "cron",
          minute: input.cronMinute !== undefined ? input.cronMinute : currentTriggerConfig.minute,
          hour: input.cronHour !== undefined ? input.cronHour : currentTriggerConfig.hour,
          daysOfWeek:
            input.cronDaysOfWeek !== undefined
              ? input.cronDaysOfWeek
              : currentTriggerConfig.daysOfWeek,
          stopAt: input.stopAt !== undefined ? input.stopAt : currentTriggerConfig.stopAt
        }, referenceAt);

        return {
          triggerConfigJson: nextTrigger.triggerConfigJson,
          nextRunAt: nextTrigger.nextRunAt
        };
      }
      case "condition": {
        const nextTriggerConfig: AssistantAutomationTriggerConfig = {
          ...currentTriggerConfig,
          pollIntervalSeconds:
            input.pollIntervalSeconds !== undefined
              ? input.pollIntervalSeconds || currentTriggerConfig.pollIntervalSeconds
              : currentTriggerConfig.pollIntervalSeconds,
          expiresAt:
            input.expiresAt !== undefined
              ? input.expiresAt
              : currentTriggerConfig.expiresAt,
          maxChecks:
            input.maxChecks !== undefined
              ? input.maxChecks
              : currentTriggerConfig.maxChecks
        };

        return {
          triggerConfigJson: JSON.stringify(nextTriggerConfig),
          nextRunAt: computeNextRunAt(nextTriggerConfig, referenceAt)
        };
      }
      default:
        return assertNeverTriggerConfig(currentTriggerConfig);
    }
  }

  private reconcileTaskWithLatestRun(
    task: AssistantAutomationTask,
    referenceAt: string
  ): AssistantAutomationTask | null {
    if (task.status !== "active" || !task.nextRunAt) {
      return task;
    }

    const latestRun = this.runRepository.findLatestByAutomation(task.id);

    if (!latestRun || latestRun.scheduledAt !== task.nextRunAt) {
      return task;
    }

    const triggerConfig = parseTriggerConfig(task.triggerType, task.triggerConfigJson);

    if (latestRun.status === "succeeded") {
      const reconciled = this.finalizeSuccessfulTask(
        task,
        triggerConfig,
        latestRun.finishedAt ?? latestRun.startedAt ?? referenceAt,
        latestRun.summary ?? summarizeMessage(parseActionConfig(task.actionConfigJson).content)
      );
      this.taskRepository.update(reconciled);
      return null;
    }

    if (latestRun.status === "failed") {
      this.taskRepository.update({
        ...task,
        status: "failed",
        nextRunAt: null,
        lastRunAt: latestRun.finishedAt ?? latestRun.startedAt,
        lastRunSummary: latestRun.summary,
        lastError: latestRun.error ?? "ASSISTANT_AUTOMATION_RUN_FAILED",
        updatedAt: latestRun.finishedAt ?? referenceAt
      });
      return null;
    }

    if (latestRun.status === "running") {
      this.runRepository.update({
        ...latestRun,
        status: "failed",
        error: latestRun.error ?? "ASSISTANT_AUTOMATION_RUN_INTERRUPTED",
        finishedAt: referenceAt
      });
    }

    return this.requireTask(task.id);
  }

  private async readLatestRemoteTag(repositoryUrl: string): Promise<{
    tag: string | null;
    ref: string | null;
  }> {
    if (!this.gitCommandRunner) {
      throw new AppError({
        statusCode: 500,
        errorCode: "ASSISTANT_AUTOMATION_CONDITION_UNSUPPORTED",
        detail: "当前环境未配置 git 能力，无法检查 git.remote_tag_changed"
      });
    }

    const result = await this.gitCommandRunner.run(
      this.gitWorkingDirectory,
      ["ls-remote", "--refs", "--tags", "--sort=-v:refname", repositoryUrl],
      {
        timeoutMs: 15_000,
        allowNonZeroExit: false,
        operation: "assistant_automation_git_remote_tag_changed"
      }
    );
    const firstLine = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (!firstLine) {
      return {
        tag: null,
        ref: null
      };
    }

    const [ref, fullName] = firstLine.split(/\s+/, 2);

    return {
      tag: fullName?.replace(/^refs\/tags\//, "") || null,
      ref: ref?.trim() || null
    };
  }

  private toTaskView(record: AssistantAutomationTask, userId: string): AssistantAutomationTaskView {
    return {
      ...record,
      controlSession: this.butlerControlSessionService.getSession(record.controlSessionId, userId),
      triggerConfig: parseTriggerConfig(record.triggerType, record.triggerConfigJson),
      actionConfig: parseActionConfig(record.actionConfigJson)
    };
  }

  private toRunView(record: AssistantAutomationRun): AssistantAutomationRunView {
    const triggerSnapshot = parseTriggerConfig(record.triggerType, record.triggerSnapshotJson) as
      AssistantAutomationTriggerConfig & { triggerContext?: Record<string, unknown> };

    const parsedSnapshot = tryParseJson(record.triggerSnapshotJson);

    if (parsedSnapshot?.triggerContext && typeof parsedSnapshot.triggerContext === "object") {
      triggerSnapshot.triggerContext = parsedSnapshot.triggerContext as Record<string, unknown>;
    }

    return {
      ...record,
      triggerSnapshot,
      actionSnapshot: parseActionConfig(record.actionSnapshotJson)
    };
  }
}

function requireContent(value: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "创建助手自动化必须提供 content",
      field: "content"
    });
  }

  return normalized;
}

function requireIsoTimestamp(value: string | null | undefined, field: string): string {
  const normalized = normalizeNullableText(value);

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是合法的 ISO 时间`,
      field
    });
  }

  const timestamp = Date.parse(normalized);

  if (Number.isNaN(timestamp)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是合法的 ISO 时间`,
      field
    });
  }

  return new Date(timestamp).toISOString();
}

function assertNeverTriggerConfig(value: never): never {
  throw new Error(`Unsupported trigger config: ${JSON.stringify(value)}`);
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function buildAutomationClientRequestId(taskId: string, referenceAt: string): string {
  return `assistant-automation:${taskId}:${Date.parse(referenceAt) || Date.now()}`;
}

function summarizeMessage(content: string): string {
  return content.length > 120 ? `${content.slice(0, 117)}...` : content;
}

function shouldCompleteConditionWithoutCheck(
  config: ConditionTriggerConfig,
  state: GitRemoteTagChangedConditionState | SessionRuntimeIdleConditionState,
  referenceAt: string
): boolean {
  if (config.maxChecks !== null && state.checkCount >= config.maxChecks) {
    return true;
  }

  return config.expiresAt !== null && referenceAt > config.expiresAt;
}

function bumpConditionStateOnError(
  conditionKind: AssistantConditionKind,
  state: GitRemoteTagChangedConditionState | SessionRuntimeIdleConditionState,
  referenceAt: string
): GitRemoteTagChangedConditionState | SessionRuntimeIdleConditionState {
  if (conditionKind === "git.remote_tag_changed") {
    return {
      ...(state as GitRemoteTagChangedConditionState),
      checkCount: state.checkCount + 1,
      lastCheckedAt: referenceAt
    };
  }

  return {
    ...(state as SessionRuntimeIdleConditionState),
    checkCount: state.checkCount + 1,
    lastCheckedAt: referenceAt
  };
}

function mergeTriggerContext(
  content: string,
  includeTriggerContext: boolean,
  triggerContext: string
): string {
  return includeTriggerContext ? `${triggerContext}\n\n${content}` : content;
}

function buildGitTagChangedContextMessage(context: {
  repositoryUrl: string;
  previousTag: string | null;
  previousRef: string | null;
  currentTag: string | null;
  currentRef: string | null;
  checkedAt: string;
}): string {
  return [
    "触发条件：远端仓库出现新 tag",
    `仓库：${context.repositoryUrl}`,
    `旧基线：${context.previousTag ?? "-"} @ ${context.previousRef ?? "-"}`,
    `新状态：${context.currentTag ?? "-"} @ ${context.currentRef ?? "-"}`,
    `检查时间：${context.checkedAt}`
  ].join("\n");
}

function buildSessionRuntimeIdleContextMessage(context: {
  sessionId: string;
  previousRunningState: string | null;
  previousHasActiveRun: boolean | null;
  currentRunningState: string | null;
  currentHasActiveRun: boolean;
  checkedAt: string;
}): string {
  return [
    "触发条件：目标会话已进入空闲状态",
    `会话：${context.sessionId}`,
    `上一轮状态：${context.previousRunningState ?? "-"} / hasActiveRun=${String(context.previousHasActiveRun)}`,
    `当前状态：${context.currentRunningState ?? "-"} / hasActiveRun=${String(context.currentHasActiveRun)}`,
    `检查时间：${context.checkedAt}`
  ].join("\n");
}

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
