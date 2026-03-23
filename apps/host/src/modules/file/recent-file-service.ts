import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { RecentFileRecord } from "../../types/domain.js";
import type { RecentFileRepository } from "../../storage/repositories/recent-file-repository.js";

export class RecentFileService {
  constructor(private readonly recentFileRepository: RecentFileRepository) {}

  recordOpened(workspaceId: string, userId: string, filePath: string): void {
    this.recentFileRepository.upsert({
      id: createId(),
      workspaceId,
      userId,
      path: filePath,
      lastOpenedAt: nowIso(),
      pinned: false
    });
  }

  list(workspaceId: string, userId: string, limit: number): RecentFileRecord[] {
    return this.recentFileRepository.listByWorkspaceAndUser(workspaceId, userId, limit);
  }

  renamePath(workspaceId: string, oldPath: string, newPath: string): void {
    this.recentFileRepository.renamePath(workspaceId, oldPath, newPath);
  }

  deleteByPath(workspaceId: string, targetPath: string): void {
    this.recentFileRepository.deleteByPath(workspaceId, targetPath);
  }
}
