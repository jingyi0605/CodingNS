import type { TaskStatus } from "../tasks/task-types.js";

export interface ServiceUpdateTaskDto {
  taskId: string;
  packageName: string;
  channel: "stable" | "beta";
  targetVersion: string | null;
  status: TaskStatus;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  restartRequired: boolean;
  restartScheduled: boolean;
  restartDelayMs: number | null;
}

export interface ManagedServicePackageDto {
  channel: "stable" | "beta";
  packageName: string;
  registryUrl: string;
  packagePageUrl: string;
  currentVersion: string;
  latestVersion: string | null;
  latestTitle: string | null;
  latestNotes: string | null;
  latestPublishedAt: string | null;
  hasUpdate: boolean;
  checkStatus: "ready" | "up_to_date" | "check_failed";
  checkError: string | null;
  restartRequired: boolean;
  installTask: ServiceUpdateTaskDto | null;
}

export interface ServiceUpdateListDto {
  channel: "stable" | "beta";
  checkedAt: string;
  packages: ManagedServicePackageDto[];
}
