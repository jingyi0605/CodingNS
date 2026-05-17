import { AppError } from "../../shared/errors/app-error.js";
import type { BrowserProfile } from "../../types/domain.js";
import type { OfficeTaskRepository } from "../../storage/repositories/office-task-repository.js";
import type { CreateOfficeTaskInput, OfficeService } from "../office/office-service.js";
import type { TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskSnapshot } from "../tasks/task-types.js";
import { BrowserProfileService } from "./browser-profile-service.js";
import type { BrowserTaskExecutor } from "./browser-task-executor.js";
import { BrowserTaskExecutorRegistry } from "./browser-task-executor-registry.js";
import {
  normalizeBrowserExecutionBackend,
  normalizeBrowserTaskActions,
  normalizeBrowserTaskPayloadShape,
  normalizeOptionalText,
  parseBrowserTaskPayload,
  type BrowserExecutionBackend
} from "./browser-task-payload.js";
import type { BrowserBridgeStatusDto, OpenCliBrowserBridgeService } from "./opencli-browser-bridge-service.js";

export interface CreateBrowserTaskInput {
  userId: string;
  workspaceId?: string | null;
  title: string;
  profileId: string;
  executionBackend?: BrowserExecutionBackend;
  input?: unknown;
  riskLevel?: CreateOfficeTaskInput["riskLevel"];
}

export class BrowserRuntimeService {
  private readonly executorRegistry: BrowserTaskExecutorRegistry;

  constructor(
    private readonly browserProfileService: BrowserProfileService,
    private readonly officeService: OfficeService,
    private readonly officeTaskRepository: OfficeTaskRepository,
    browserExecutors: BrowserTaskExecutor[],
    private readonly openCliBrowserBridgeService: OpenCliBrowserBridgeService,
    private readonly taskManager: TaskManager
  ) {
    this.executorRegistry = new BrowserTaskExecutorRegistry(browserExecutors);
    this.registerBackgroundTask();
  }

  listProfiles(userId: string, workspaceId?: string | null): BrowserProfile[] {
    return this.browserProfileService.listProfiles(userId, workspaceId);
  }

  getProfile(profileId: string, userId: string): BrowserProfile {
    return this.browserProfileService.getProfile(profileId, userId);
  }

  createProfile(input: Parameters<BrowserProfileService["createProfile"]>[0]): BrowserProfile {
    return this.browserProfileService.createProfile(input);
  }

  updateProfile(input: Parameters<BrowserProfileService["updateProfile"]>[0]): BrowserProfile {
    return this.browserProfileService.updateProfile(input);
  }

  deleteProfile(profileId: string, userId: string): { profileId: string; deleted: true } {
    const tasks = this.officeTaskRepository.list({
      userId,
      taskType: "browser"
    }).filter((task) => task.targetRefId === profileId);
    const blockingTask = tasks.find((task) =>
      task.status === "running"
      || task.status === "paused"
      || task.status === "waiting_external"
    );

    if (blockingTask) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BROWSER_PROFILE_TASK_IN_USE",
        detail: "当前浏览器 Profile 仍有关联任务正在执行或等待外部完成，暂时不能删除"
      });
    }

    for (const task of tasks) {
      if (task.status === "draft" || task.status === "pending_approval" || task.status === "ready") {
        this.officeService.cancelTask(task.id, userId);
      }
    }

    this.browserProfileService.deleteProfile(profileId, userId);
    return {
      profileId,
      deleted: true
    };
  }

  attachCdpProfile(input: Parameters<BrowserProfileService["createProfile"]>[0]): BrowserProfile {
    return this.browserProfileService.createProfile({
      ...input,
      mode: "cdp_attached"
    });
  }

  createBrowserTask(input: CreateBrowserTaskInput) {
    const profile = this.browserProfileService.getProfile(input.profileId, input.userId);
    if (profile.status !== "active") {
      throw new AppError({
        statusCode: 409,
        errorCode: "BROWSER_PROFILE_NOT_ACTIVE",
        detail: "当前浏览器 Profile 不可用"
      });
    }

    const payload = normalizeBrowserTaskPayloadShape(input.input);
    const executionBackend = normalizeBrowserExecutionBackend(
      input.executionBackend ?? payload.executionBackend
    );

    return this.officeService.createTask({
      userId: input.userId,
      workspaceId: input.workspaceId ?? profile.workspaceId,
      taskType: "browser",
      title: input.title,
      connectorId: "browser.playwright",
      targetRefKind: "browser_profile",
      targetRefId: profile.id,
      input: {
        profileId: profile.id,
        engine: profile.engine,
        mode: profile.mode,
        ...payload,
        executionBackend,
        startUrl: normalizeOptionalText(payload.startUrl),
        actions: normalizeBrowserTaskActions(input.input)
      },
      riskLevel: input.riskLevel ?? "low"
    });
  }

  async getBridgeStatus(): Promise<BrowserBridgeStatusDto> {
    return await this.openCliBrowserBridgeService.getStatus();
  }

  async executeBrowserTask(taskId: string, userId: string) {
    const task = this.requireExecutableTask(taskId, userId);
    const handle = this.taskManager.enqueue<{ taskId: string; userId: string }, Awaited<ReturnType<BrowserTaskExecutor["execute"]>>>(
      HOST_TASK_TYPES.officeBrowserTaskExecute,
      {
        key: task.id,
        source: "office.browser_task.execute",
        input: {
          taskId: task.id,
          userId
        }
      }
    );

    void handle.promise.catch(() => undefined);
    return {
      taskId: task.id,
      executionTaskId: handle.taskId,
      deduped: handle.deduped
    };
  }

  getExecutionSnapshot(taskId: string, userId: string): TaskSnapshot | null {
    this.requireOwnedBrowserTask(taskId, userId);
    return this.taskManager.peek(HOST_TASK_TYPES.officeBrowserTaskExecute, taskId.trim());
  }

  cancelExecution(taskId: string, userId: string): { taskId: string; cancelled: boolean } {
    const task = this.requireOwnedBrowserTask(taskId, userId);
    this.taskManager.cancel(
      HOST_TASK_TYPES.officeBrowserTaskExecute,
      task.id,
      "office_browser_task_cancelled"
    );
    return {
      taskId: task.id,
      cancelled: true
    };
  }

  private registerBackgroundTask(): void {
    if (this.taskManager.has(HOST_TASK_TYPES.officeBrowserTaskExecute)) {
      return;
    }

    this.taskManager.register<{ taskId: string; userId: string }, Awaited<ReturnType<BrowserTaskExecutor["execute"]>>>({
      taskType: HOST_TASK_TYPES.officeBrowserTaskExecute,
      executionLane: "host_background",
      timeoutMs: 180_000,
      concurrency: 1,
      run: async (input, context) => {
        const task = this.requireExecutableTask(input.taskId, input.userId);
        const payload = parseBrowserTaskPayload(task.inputJson);
        const executor = this.executorRegistry.get(
          normalizeBrowserExecutionBackend(payload.executionBackend)
        );
        const profile = this.browserProfileService.getProfile(task.targetRefId ?? "", input.userId);
        if (profile.status !== "active") {
          throw new AppError({
            statusCode: 409,
            errorCode: "BROWSER_PROFILE_NOT_ACTIVE",
            detail: "当前浏览器 Profile 不可用"
          });
        }

        return await executor.execute({
          task,
          profile,
          runContext: context
        });
      }
    });
  }

  private requireExecutableTask(taskId: string, userId: string) {
    const task = this.requireOwnedBrowserTask(taskId, userId);
    if (task.status !== "ready" && task.status !== "failed") {
      throw new AppError({
        statusCode: 409,
        errorCode: "BROWSER_TASK_EXECUTION_NOT_ALLOWED",
        detail: "当前任务状态不允许执行"
      });
    }

    return task;
  }

  private requireOwnedBrowserTask(taskId: string, userId: string) {
    const task = this.officeTaskRepository.findById(taskId.trim());
    if (!task || task.userId !== userId || task.taskType !== "browser") {
      throw new AppError({
        statusCode: 404,
        errorCode: "BROWSER_TASK_NOT_FOUND",
        detail: "未找到对应浏览器任务"
      });
    }

    return task;
  }
}
