import type { Workspace } from "../../types/domain.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";

export class WorkspaceService {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  list(): Workspace[] {
    return this.workspaceRepository.list();
  }
}
