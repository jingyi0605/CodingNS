import type { SessionIndex } from "../../types/domain.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";

export class SessionIndexService {
  constructor(private readonly sessionIndexRepository: SessionIndexRepository) {}

  list(workspaceId: string): SessionIndex[] {
    return this.sessionIndexRepository.listByWorkspace(workspaceId);
  }
}
