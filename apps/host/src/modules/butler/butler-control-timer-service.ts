import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
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

const DEFAULT_DUE_TASK_LIMIT = 20;

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
    private readonly butlerControlTimerRepository: ButlerControlTimerRepository
  ) {}

  listTimers(filters: {
    userId: string;
    statuses?: ButlerControlTimerStatus[];
    controlSessionId?: string | null;
    limit?: number;
  }): ButlerControlTimerView[] {
    this.butlerProfileService.ensureInitialized();
    return this.butlerControlTimerRepository
      .list({
        statuses: filters.statuses,
        controlSessionId: filters.controlSessionId?.trim() || undefined,
        limit: filters.limit
      })
      .map((record) => this.toView(record, filters.userId));
  }

  getTimer(timerId: string, userId: string): ButlerControlTimerView {
    this.butlerProfileService.ensureInitialized();
    const timer = this.butlerControlTimerRepository.findById(timerId.trim());

    if (!timer) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_CONTROL_TIMER_NOT_FOUND",
        detail: "未找到对应的助手计时器"
      });
    }

    return this.toView(timer, userId);
  }

  createTimer(input: CreateButlerControlTimerInput): ButlerControlTimerView {
    this.butlerProfileService.ensureInitialized();
    const controlSession = input.controlSessionId?.trim()
      ? this.butlerControlSessionService.getSession(input.controlSessionId, input.userId)
      : this.butlerControlSessionService.getCurrentSession(input.userId);

    if (!controlSession) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_CONTROL_SESSION_NOT_FOUND",
        detail: "当前没有可用的助手控制会话，无法创建计时器"
      });
    }

    const timestamp = nowIso();
    const dueAt = resolveTimerDueAt(input, timestamp);
    const created = this.butlerControlTimerRepository.create({
      id: createId(),
      controlSessionId: controlSession.id,
      sessionId: controlSession.sessionId,
      userId: input.userId,
      projectId: normalizeNullableText(input.projectId),
      targetSessionId: normalizeNullableText(input.targetSessionId),
      title: normalizeNullableText(input.title),
      content: requireTimerContent(input.content),
      dueAt,
      status: "active",
      triggeredAt: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      cancelledAt: null
    });

    return this.toView(created, input.userId);
  }

  cancelTimer(timerId: string, userId: string): ButlerControlTimerView {
    this.butlerProfileService.ensureInitialized();
    const current = this.requireTimer(timerId);
    const cancelledAt = nowIso();
    const updated = this.butlerControlTimerRepository.update({
      ...current,
      status: "cancelled",
      updatedAt: cancelledAt,
      cancelledAt
    });

    return this.toView(updated, userId);
  }

  async runDueTimers(referenceAt: string): Promise<ButlerControlTimerRunDueTimersResult> {
    this.butlerProfileService.ensureInitialized();
    const activeTimerCount = this.butlerControlTimerRepository.list({
      statuses: ["active"]
    }).length;
    const dueTimers = this.butlerControlTimerRepository.listDueActive(referenceAt, DEFAULT_DUE_TASK_LIMIT);
    let processedTaskCount = 0;

    for (const timer of dueTimers) {
      processedTaskCount += 1;
      await this.processDueTimer(timer, referenceAt);
    }

    return {
      activeTimerCount,
      dueTimerCount: dueTimers.length,
      processedTimerCount: processedTaskCount,
      idle: dueTimers.length === 0
    };
  }

  private async processDueTimer(timer: ButlerControlTimer, referenceAt: string): Promise<void> {
    try {
      const result = await this.butlerControlSessionService.sendMessage(timer.userId, {
        controlSessionId: timer.controlSessionId,
        content: timer.content,
        clientRequestId: buildTimerClientRequestId(timer.id, referenceAt)
      });
      this.butlerControlTimerRepository.update({
        ...timer,
        status: "completed",
        triggeredAt: result.acceptedAt,
        lastError: null,
        updatedAt: result.acceptedAt
      });
    } catch (error) {
      this.butlerControlTimerRepository.update({
        ...timer,
        status: "failed",
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: nowIso()
      });
    }
  }

  private requireTimer(timerId: string): ButlerControlTimer {
    const timer = this.butlerControlTimerRepository.findById(timerId.trim());

    if (!timer) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_CONTROL_TIMER_NOT_FOUND",
        detail: "未找到对应的助手计时器"
      });
    }

    return timer;
  }

  private toView(record: ButlerControlTimer, userId: string): ButlerControlTimerView {
    return {
      ...record,
      controlSession: this.butlerControlSessionService.getSession(record.controlSessionId, userId)
    };
  }
}

function requireTimerContent(value: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "创建助手计时器必须提供 content",
      field: "content"
    });
  }

  return normalized;
}

function resolveTimerDueAt(input: CreateButlerControlTimerInput, referenceAt: string): string {
  if (input.dueAt?.trim()) {
    const dueTimestamp = Date.parse(input.dueAt.trim());

    if (Number.isNaN(dueTimestamp)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "dueAt 必须是合法的 ISO 时间",
        field: "dueAt"
      });
    }

    return new Date(dueTimestamp).toISOString();
  }

  if (input.afterSeconds === null || input.afterSeconds === undefined) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "创建助手计时器必须提供 dueAt 或 afterSeconds",
      field: "dueAt"
    });
  }

  const delaySeconds = Math.max(1, Math.floor(input.afterSeconds));
  const referenceMs = Date.parse(referenceAt);
  return new Date(referenceMs + delaySeconds * 1000).toISOString();
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function buildTimerClientRequestId(timerId: string, referenceAt: string): string {
  return `butler-control-timer:${timerId}:${Date.parse(referenceAt) || Date.now()}`;
}
