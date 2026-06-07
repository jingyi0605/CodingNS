import { AppError } from "../../shared/errors/app-error.js";
import type {
  ButlerControlTimer,
  ButlerControlTimerStatus
} from "../../types/domain.js";
import type { ButlerProfileService } from "./butler-profile-service.js";
import type {
  ButlerControlSessionService,
  ButlerControlSessionView
} from "./butler-control-session-service.js";
import type { ButlerControlTimerRepository } from "../../storage/repositories/butler-control-timer-repository.js";
import type {
  AssistantAutomationService,
  AssistantAutomationTaskView
} from "./assistant-automation-service.js";

export interface ButlerControlTimerView extends ButlerControlTimer {
  controlSession: ButlerControlSessionView | null;
}

export interface CreateButlerControlTimerInput {
  userId: string;
  controlSessionId?: string | null;
  projectId?: string | null;
  targetSessionId?: string | null;
  title?: string | null;
  content: string;
  dueAt?: string | null;
  afterSeconds?: number | null;
}

export interface ButlerControlTimerRunDueTimersResult {
  activeTimerCount: number;
  dueTimerCount: number;
  processedTimerCount: number;
  idle: boolean;
}

export class ButlerControlTimerService {
  constructor(
    private readonly butlerProfileService: Pick<ButlerProfileService, "ensureInitialized">,
    private readonly butlerControlSessionService: Pick<
      ButlerControlSessionService,
      "getCurrentSession" | "getSession" | "sendMessage"
    >,
    private readonly butlerControlTimerRepository: ButlerControlTimerRepository,
    private readonly assistantAutomationService: Pick<
      AssistantAutomationService,
      "listTasks" | "getTask" | "createTask" | "cancelTask" | "runDueTasks"
    >
  ) {}

  listTimers(filters: {
    userId: string;
    statuses?: ButlerControlTimerStatus[];
    controlSessionId?: string | null;
    limit?: number;
  }): ButlerControlTimerView[] {
    this.butlerProfileService.ensureInitialized(filters.userId);
    return this.assistantAutomationService
      .listTasks({
        userId: filters.userId,
        statuses: mapTimerStatusesToAutomationStatuses(filters.statuses),
        controlSessionId: filters.controlSessionId?.trim() || null,
        limit: filters.limit
      })
      .filter((task) => task.triggerType === "once")
      .map((task) => this.mapTaskToTimerView(task));
  }

  getTimer(timerId: string, userId: string): ButlerControlTimerView {
    this.butlerProfileService.ensureInitialized(userId);
    return this.mapTaskToTimerView(this.assistantAutomationService.getTask(timerId.trim(), userId));
  }

  createTimer(input: CreateButlerControlTimerInput): ButlerControlTimerView {
    this.butlerProfileService.ensureInitialized(input.userId);
    const created = this.assistantAutomationService.createTask({
      userId: input.userId,
      controlSessionId: input.controlSessionId,
      projectId: input.projectId,
      title: input.title,
      trigger: {
        type: "once",
        dueAt: input.dueAt,
        afterSeconds: input.afterSeconds ?? null
      },
      action: {
        type: "send_control_message",
        content: input.content,
        includeTriggerContext: false,
        targetSessionId: input.targetSessionId
      }
    });

    return this.mapTaskToTimerView(created);
  }

  cancelTimer(timerId: string, userId: string): ButlerControlTimerView {
    this.butlerProfileService.ensureInitialized(userId);
    return this.mapTaskToTimerView(this.assistantAutomationService.cancelTask(timerId.trim(), userId));
  }

  async runDueTimers(referenceAt: string): Promise<ButlerControlTimerRunDueTimersResult> {
    const result = await this.assistantAutomationService.runDueTasks(referenceAt);
    return {
      activeTimerCount: result.activeTaskCount,
      dueTimerCount: result.dueTaskCount,
      processedTimerCount: result.processedTaskCount,
      idle: result.idle
    };
  }

  private mapTaskToTimerView(task: AssistantAutomationTaskView): ButlerControlTimerView {
    if (task.triggerType !== "once") {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_CONTROL_TIMER_COMPATIBILITY_ERROR",
        detail: "当前计时器兼容视图只支持 once 类型自动化"
      });
    }
    const triggerConfig = parseOnceTriggerConfig(task.triggerConfigJson);
    const actionConfig = parseSendControlMessageActionConfig(task.actionConfigJson);
    return {
      id: task.id,
      controlSessionId: task.controlSessionId,
      sessionId: task.controlSession?.sessionId ?? "",
      userId: task.userId,
      projectId: task.projectId,
      targetSessionId: actionConfig.targetSessionId,
      title: task.title,
      content: actionConfig.content,
      dueAt: triggerConfig.dueAt,
      status: mapAutomationStatusToTimerStatus(task.status),
      triggeredAt: task.lastRunAt,
      lastError: task.lastError,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      cancelledAt: task.cancelledAt,
      controlSession: task.controlSession
    };
  }
}

function mapTimerStatusesToAutomationStatuses(
  statuses: ButlerControlTimerStatus[] | undefined
): Array<"active" | "completed" | "cancelled" | "failed" | "paused"> | undefined {
  return statuses?.map((status) => (status === "active" ? "active" : status));
}

function mapAutomationStatusToTimerStatus(
  status: "active" | "paused" | "completed" | "cancelled" | "failed"
): ButlerControlTimerStatus {
  if (status === "paused") {
    return "active";
  }

  return status;
}

function parseOnceTriggerConfig(value: string): { dueAt: string } {
  const parsed = JSON.parse(value) as Partial<{ dueAt: string }>;
  const dueAt = parsed.dueAt?.trim();

  if (!dueAt) {
    throw new AppError({
      statusCode: 500,
      errorCode: "BUTLER_CONTROL_TIMER_COMPATIBILITY_ERROR",
      detail: "自动化缺少 once 触发时间，无法映射为计时器"
    });
  }

  return {
    dueAt
  };
}

function parseSendControlMessageActionConfig(value: string): {
  content: string;
  targetSessionId: string | null;
} {
  const parsed = JSON.parse(value) as Partial<{
    content: string;
    targetSessionId: string | null;
  }>;
  const content = parsed.content?.trim();

  if (!content) {
    throw new AppError({
      statusCode: 500,
      errorCode: "BUTLER_CONTROL_TIMER_COMPATIBILITY_ERROR",
      detail: "自动化缺少控制会话消息内容，无法映射为计时器"
    });
  }

  return {
    content,
    targetSessionId: parsed.targetSessionId?.trim() || null
  };
}
