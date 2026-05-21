import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { PluginAuditEventRepository } from "../../storage/repositories/plugin-audit-event-repository.js";
import type { PluginScheduleDefinition } from "../../types/domain.js";
import type { SchedulerMetrics } from "../tasks/scheduler-metrics.js";
import type { TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../tasks/task-types.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { PluginRegistryService } from "./plugin-registry-service.js";
import type { PluginRuntimeService } from "./plugin-runtime-service.js";

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_MAX_TRIGGER_ATTEMPTS = 3;

interface PluginScheduleTriggerTaskInput {
  pluginId: string;
  scheduleId: string;
  actionId: string;
  workspaceId: string;
  input: unknown;
}

interface PluginScheduleTriggerTaskResult {
  runId: string;
}

interface ScheduleDispatchPlan {
  pluginId: string;
  schedule: PluginScheduleDefinition;
  scheduleKey: string;
  workspaceId: string;
  input: unknown;
  attemptWindowStartedAtMs: number;
}

export class PluginSchedulerService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private disposed = false;
  private ticking = false;
  private readonly lastTriggeredAtByScheduleId = new Map<string, number>();
  private idleStreak = 0;

  constructor(
    private readonly pluginRegistryService: PluginRegistryService,
    private readonly pluginRuntimeService: PluginRuntimeService,
    private readonly pluginAuditEventRepository: PluginAuditEventRepository,
    private readonly workspaceService: WorkspaceService,
    private readonly taskManager: TaskManager,
    private readonly schedulerMetrics: SchedulerMetrics | null = null,
    private readonly intervalMs = DEFAULT_INTERVAL_MS
  ) {
    this.registerScheduleTriggerTask();
  }

  start(): void {
    if (this.started || this.disposed) {
      return;
    }

    this.started = true;
    this.scheduleNext(0);
  }

  async dispose(): Promise<void> {
    this.started = false;
    this.disposed = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    while (this.ticking) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private registerScheduleTriggerTask(): void {
    if (this.taskManager.has(HOST_TASK_TYPES.pluginScheduleTrigger)) {
      return;
    }

    this.taskManager.register<PluginScheduleTriggerTaskInput, PluginScheduleTriggerTaskResult>({
      taskType: HOST_TASK_TYPES.pluginScheduleTrigger,
      executionLane: "host_background",
      timeoutMs: 70_000,
      concurrency: 1,
      retryPolicy: {
        maxAttempts: DEFAULT_MAX_TRIGGER_ATTEMPTS,
        backoffMs: (attempt) => Math.min(30_000, 1_000 * (2 ** Math.max(0, attempt - 1)))
      },
      run: async (input, context) => {
        if (context.attempt > 1) {
          this.recordAuditEvent(input.pluginId, input.workspaceId, "plugin.schedule_retry_scheduled", {
            scheduleId: input.scheduleId,
            actionId: input.actionId,
            attempt: context.attempt,
            taskId: context.taskId
          });
        }

        const result = await this.pluginRuntimeService.callAction({
          pluginId: input.pluginId,
          actionId: input.actionId,
          workspaceId: input.workspaceId,
          input: input.input,
          triggerKind: "schedule",
          actorUserId: null
        });

        return {
          runId: result.run.id
        };
      }
    });
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.disposed) {
      return;
    }

    this.ticking = true;
    const startedAt = Date.now();
    const referenceAt = nowIso();
    let taskCount = 0;
    let errorCount = 0;

    try {
      const plans = this.collectDispatchPlans();
      taskCount = plans.length;

      for (const plan of plans) {
        try {
          this.dispatchSchedule(plan);
        } catch (error) {
          errorCount += 1;
          this.lastTriggeredAtByScheduleId.delete(plan.scheduleKey);
          this.recordAuditEvent(plan.pluginId, plan.workspaceId, "plugin.action_rejected", {
            scheduleId: plan.schedule.id,
            actionId: plan.schedule.actionId,
            errorCode: "PLUGIN_SCHEDULE_ENQUEUE_FAILED",
            errorMessage: error instanceof Error ? error.message : "插件调度入队失败"
          });
        }
      }
    } catch {
      errorCount += 1;
    } finally {
      this.ticking = false;
      this.idleStreak = taskCount === 0 ? this.idleStreak + 1 : 0;
      this.schedulerMetrics?.recordTick({
        schedulerName: "plugin",
        referenceAt,
        durationMs: Date.now() - startedAt,
        taskCount,
        idle: taskCount === 0,
        errorCount,
        nextDelayMs: this.intervalMs,
        idleStreak: this.idleStreak
      });

      if (this.started && !this.disposed && this.timer === null) {
        this.scheduleNext(this.intervalMs);
      }
    }
  }

  private collectDispatchPlans(): ScheduleDispatchPlan[] {
    const plugins = this.pluginRegistryService.listPlugins();
    const nowMs = Date.now();
    const plans: ScheduleDispatchPlan[] = [];

    for (const plugin of plugins) {
      const detail = this.pluginRegistryService.getPlugin(plugin.id);
      if (!detail.enablement.enabled || !detail.manifest.schedules?.length) {
        continue;
      }

      for (const schedule of detail.manifest.schedules) {
        if (!schedule.everySeconds) {
          continue;
        }

        const scheduleKey = `${plugin.id}:${schedule.id}`;
        const lastTriggeredAt = this.lastTriggeredAtByScheduleId.get(scheduleKey) ?? 0;
        if (nowMs - lastTriggeredAt < schedule.everySeconds * 1000) {
          continue;
        }

        const workspaceId = this.resolveScheduledWorkspaceId(plugin.id, schedule);
        if (!workspaceId) {
          continue;
        }

        plans.push({
          pluginId: plugin.id,
          schedule,
          scheduleKey,
          workspaceId,
          input: parseScheduleInput(schedule.inputJson),
          attemptWindowStartedAtMs: nowMs
        });
      }
    }

    return plans;
  }

  private dispatchSchedule(plan: ScheduleDispatchPlan): void {
    this.lastTriggeredAtByScheduleId.set(plan.scheduleKey, plan.attemptWindowStartedAtMs);
    this.recordAuditEvent(plan.pluginId, plan.workspaceId, "plugin.schedule_triggered", {
      scheduleId: plan.schedule.id,
      actionId: plan.schedule.actionId
    });

    const handle = this.taskManager.enqueue<PluginScheduleTriggerTaskInput, PluginScheduleTriggerTaskResult>(
      HOST_TASK_TYPES.pluginScheduleTrigger,
      {
        key: `${plan.pluginId}:${plan.workspaceId}:${plan.schedule.id}:${plan.attemptWindowStartedAtMs}`,
        source: `plugin.schedule.${plan.schedule.id}`,
        input: {
          pluginId: plan.pluginId,
          scheduleId: plan.schedule.id,
          actionId: plan.schedule.actionId,
          workspaceId: plan.workspaceId,
          input: plan.input
        }
      }
    );

    void handle.promise.catch((error) => {
      this.lastTriggeredAtByScheduleId.delete(plan.scheduleKey);
      this.recordAuditEvent(plan.pluginId, plan.workspaceId, "plugin.action_rejected", {
        scheduleId: plan.schedule.id,
        actionId: plan.schedule.actionId,
        errorCode: "PLUGIN_SCHEDULE_TRIGGER_FAILED",
        errorMessage: error instanceof Error ? error.message : "插件调度执行失败"
      });
    });
  }

  private resolveScheduledWorkspaceId(
    pluginId: string,
    schedule: PluginScheduleDefinition
  ): string | null {
    const workspaces = this.workspaceService.list();
    if (workspaces.length === 1) {
      return workspaces[0]?.id ?? null;
    }

    this.recordAuditEvent(pluginId, null, "plugin.schedule_skipped", {
      scheduleId: schedule.id,
      actionId: schedule.actionId,
      reason: "workspace_context_ambiguous",
      workspaceCount: workspaces.length
    });
    return null;
  }

  private recordAuditEvent(
    pluginId: string,
    workspaceId: string | null,
    eventType: "plugin.schedule_triggered" | "plugin.schedule_retry_scheduled" | "plugin.schedule_skipped" | "plugin.action_rejected",
    payload: Record<string, unknown>
  ): void {
    this.pluginAuditEventRepository.create({
      id: createId(),
      pluginId,
      workspaceId,
      eventType,
      actorUserId: null,
      payloadJson: JSON.stringify(payload),
      createdAt: nowIso()
    });
  }
}

function parseScheduleInput(inputJson: string | undefined): unknown {
  if (!inputJson) {
    return null;
  }

  return JSON.parse(inputJson);
}
