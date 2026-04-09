import type {
  ButlerFollowUpTaskDto,
  ButlerVerificationDigestDto
} from "./api/butler-api";

export function isCountedFollowUpTask(task: Pick<ButlerFollowUpTaskDto, "status">): boolean {
  return task.status === "active";
}

export function isCountedVerificationRun(
  verification: Pick<ButlerVerificationDigestDto, "status">
): boolean {
  return verification.status === "queued" || verification.status === "running";
}

export function countInProgressButlerTasks(
  followUpTasks: ReadonlyArray<Pick<ButlerFollowUpTaskDto, "status">>,
  verifications: ReadonlyArray<Pick<ButlerVerificationDigestDto, "status">>
): number {
  // 移动端所有入口统一口径：只统计真正还在推进中的跟进和验证。
  return (
    followUpTasks.filter(isCountedFollowUpTask).length
    + verifications.filter(isCountedVerificationRun).length
  );
}
