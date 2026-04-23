import type { TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskSnapshot } from "../tasks/task-types.js";
import { AppError } from "../../shared/errors/app-error.js";
import { readHostPackageVersion } from "./client-service.js";
import type {
  NpmGlobalPackageInstallResult,
  NpmGlobalPackageService
} from "./npm-global-package-service.js";
import type { ServiceUpdateTaskDto } from "./service-update-types.js";

interface ServiceUpdateInstallTaskInput {
  packageName: string;
  channel: "stable" | "beta";
  targetVersion: string;
  distTag: "latest" | "beta";
}

interface ServiceUpdateTaskRecord {
  readonly packageName: string;
  readonly channel: "stable" | "beta";
  readonly key: string;
  readonly targetVersion: string;
}

export class ServiceUpdateTaskService {
  private readonly taskRecordById = new Map<string, ServiceUpdateTaskRecord>();
  private readonly latestTaskIdByPackageName = new Map<string, string>();

  constructor(
    private readonly taskManager: TaskManager,
    private readonly npmGlobalPackageService: NpmGlobalPackageService
  ) {
    this.registerTask();
  }

  async installPackage(
    channel: "stable" | "beta",
    packageName: string
  ): Promise<ServiceUpdateTaskDto> {
    const latestTask = this.getLatestTaskByPackageName(packageName);

    if (latestTask?.restartRequired) {
      throw new AppError({
        statusCode: 409,
        errorCode: "SERVICE_UPDATE_RESTART_REQUIRED",
        detail: "新版本已经安装完成，重启 Host 后才会生效"
      });
    }

    const target = await this.npmGlobalPackageService.resolveInstallTarget(
      channel,
      readHostPackageVersion(),
      packageName
    );
    const handle = this.taskManager.enqueue<
      ServiceUpdateInstallTaskInput,
      ServiceUpdateInstallTaskResult
    >(
      HOST_TASK_TYPES.serviceNpmGlobalUpdateInstall,
      {
        key: packageName,
        source: "client.service_update.install",
        input: {
          packageName: target.packageName,
          channel: target.channel,
          targetVersion: target.targetVersion,
          distTag: target.distTag
        }
      }
    );

    this.taskRecordById.set(handle.taskId, {
      packageName,
      channel,
      key: packageName,
      targetVersion: target.targetVersion
    });
    this.latestTaskIdByPackageName.set(packageName, handle.taskId);
    void handle.promise.catch(() => undefined);

    return this.getTask(handle.taskId);
  }

  getTask(taskId: string): ServiceUpdateTaskDto {
    const record = this.taskRecordById.get(taskId);

    if (!record) {
      throw new AppError({
        statusCode: 404,
        errorCode: "SERVICE_UPDATE_TASK_NOT_FOUND",
        detail: `未找到更新任务 ${taskId}`
      });
    }

    const snapshot = this.taskManager.peek<ServiceUpdateInstallTaskResult>(
      HOST_TASK_TYPES.serviceNpmGlobalUpdateInstall,
      record.key
    );

    if (!snapshot || snapshot.taskId !== taskId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "SERVICE_UPDATE_TASK_NOT_FOUND",
        detail: `未找到更新任务 ${taskId}`
      });
    }

    return this.toTaskDto(record, snapshot);
  }

  getLatestTaskByPackageName(packageName: string): ServiceUpdateTaskDto | null {
    const taskId = this.latestTaskIdByPackageName.get(packageName);

    if (!taskId) {
      return null;
    }

    try {
      return this.getTask(taskId);
    } catch {
      return null;
    }
  }

  private registerTask(): void {
    if (this.taskManager.has(HOST_TASK_TYPES.serviceNpmGlobalUpdateInstall)) {
      return;
    }

    this.taskManager.register<ServiceUpdateInstallTaskInput, ServiceUpdateInstallTaskResult>({
      taskType: HOST_TASK_TYPES.serviceNpmGlobalUpdateInstall,
      executionLane: "external_process",
      timeoutMs: 300_000,
      concurrency: 1,
      run: async (input, context) => {
        return await this.npmGlobalPackageService.installGlobalPackage({
          packageName: input.packageName,
          distTag: input.distTag,
          signal: context.signal
        });
      }
    });
  }

  private toTaskDto(
    record: ServiceUpdateTaskRecord,
    snapshot: TaskSnapshot<ServiceUpdateInstallTaskResult>
  ): ServiceUpdateTaskDto {
    const installResult = snapshot.result ?? null;

    return {
      taskId: snapshot.taskId,
      packageName: record.packageName,
      channel: record.channel,
      targetVersion: record.targetVersion,
      status: snapshot.status,
      startedAt: toIsoTime(snapshot.startedAt),
      finishedAt: toIsoTime(snapshot.finishedAt),
      errorMessage: snapshot.errorMessage ?? null,
      restartRequired:
        snapshot.status === "succeeded"
        && !installResult?.restartScheduled
        && compareSemver(record.targetVersion, readHostPackageVersion()) > 0,
      restartScheduled: Boolean(installResult?.restartScheduled),
      restartDelayMs: installResult?.restartDelayMs ?? null
    };
  }
}

type ServiceUpdateInstallTaskResult = NpmGlobalPackageInstallResult;

function toIsoTime(timestamp: number | null): string | null {
  if (timestamp === null) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function compareSemver(left: string, right: string): number {
  const leftMeta = parseSemver(left);
  const rightMeta = parseSemver(right);

  for (let index = 0; index < 3; index += 1) {
    const diff = (leftMeta.numbers[index] ?? 0) - (rightMeta.numbers[index] ?? 0);

    if (diff !== 0) {
      return diff;
    }
  }

  if (leftMeta.prerelease === rightMeta.prerelease) {
    return 0;
  }

  if (!leftMeta.prerelease) {
    return 1;
  }

  if (!rightMeta.prerelease) {
    return -1;
  }

  return leftMeta.prerelease.localeCompare(rightMeta.prerelease);
}

function parseSemver(input: string): {
  readonly numbers: [number, number, number];
  readonly prerelease: string;
} {
  const normalized = input.trim().replace(/^v/i, "");
  const [versionPart, prerelease = ""] = normalized.split("-", 2);
  const rawNumbers = versionPart.split(".");

  return {
    numbers: [
      Number.parseInt(rawNumbers[0] ?? "0", 10) || 0,
      Number.parseInt(rawNumbers[1] ?? "0", 10) || 0,
      Number.parseInt(rawNumbers[2] ?? "0", 10) || 0
    ],
    prerelease
  };
}
