import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ButlerNotificationArchiveRepository } from "../../storage/repositories/butler-notification-archive-repository.js";

export interface ButlerNotificationArchiveView {
  notificationId: string;
  archivedAt: string;
  updatedAt: string;
}

export class ButlerNotificationService {
  constructor(
    private readonly butlerNotificationArchiveRepository: Pick<
      ButlerNotificationArchiveRepository,
      "listByUserId" | "upsert" | "delete"
    >
  ) {}

  listArchivedNotifications(userId: string): ButlerNotificationArchiveView[] {
    return this.butlerNotificationArchiveRepository
      .listByUserId(userId)
      .map((record) => ({
        notificationId: record.notificationId,
        archivedAt: record.archivedAt,
        updatedAt: record.updatedAt
      }));
  }

  setArchived(userId: string, notificationId: string, archived: boolean): ButlerNotificationArchiveView | null {
    const normalizedNotificationId = notificationId.trim();

    if (!normalizedNotificationId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "notificationId 不能为空",
        field: "notificationId"
      });
    }

    if (!archived) {
      this.butlerNotificationArchiveRepository.delete(userId, normalizedNotificationId);
      return null;
    }

    const timestamp = nowIso();
    const record = this.butlerNotificationArchiveRepository.upsert({
      userId,
      notificationId: normalizedNotificationId,
      archivedAt: timestamp,
      updatedAt: timestamp
    });

    return {
      notificationId: record.notificationId,
      archivedAt: record.archivedAt,
      updatedAt: record.updatedAt
    };
  }
}
