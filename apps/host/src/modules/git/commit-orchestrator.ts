import { AppError } from "../../shared/errors/app-error.js";
import type { AiFallbackEditRepository } from "../../storage/repositories/ai-fallback-edit-repository.js";
import type { CommitDraft, CommitRuleProfile, CommitValidationResult } from "./types.js";
import type { CommitRuleEngine } from "./commit-rule-engine.js";
import type { CommitDraftService } from "./commit-draft-service.js";
import type { GitRuleRepository } from "./git-rule-repository.js";
import type { GitWriteService } from "./git-write-service.js";

export class CommitOrchestrator {
  constructor(
    private readonly gitRuleRepository: GitRuleRepository,
    private readonly commitRuleEngine: CommitRuleEngine,
    private readonly commitDraftService: CommitDraftService,
    private readonly gitWriteService: GitWriteService,
    private readonly aiFallbackEditRepository: Pick<AiFallbackEditRepository, "listBlockingByWorkspaceId">
  ) {}

  getRuleProfile(workspaceId: string): CommitRuleProfile {
    return this.gitRuleRepository.getRuleProfile(workspaceId);
  }

  saveRuleProfile(
    workspaceId: string,
    input: Omit<CommitRuleProfile, "id" | "workspaceId" | "updatedAt">
  ): CommitRuleProfile {
    return this.gitRuleRepository.saveRuleProfile(workspaceId, input);
  }

  async createDraft(workspaceId: string, mode: "manual" | "ai"): Promise<{
    ruleProfile: CommitRuleProfile;
    draft: CommitDraft;
    validation: CommitValidationResult;
  }> {
    const ruleProfile = this.gitRuleRepository.getRuleProfile(workspaceId);
    const draft = await this.commitDraftService.createDraft(workspaceId, mode, ruleProfile);
    const validation = this.commitRuleEngine.validate(ruleProfile, draft);

    return {
      ruleProfile,
      draft: validation.normalizedDraft,
      validation
    };
  }

  validate(workspaceId: string, draft: CommitDraft): {
    ruleProfile: CommitRuleProfile;
    validation: CommitValidationResult;
  } {
    this.ensureNoBlockingAiFallbackEdits(workspaceId);
    const ruleProfile = this.gitRuleRepository.getRuleProfile(workspaceId);
    const validation = this.commitRuleEngine.validate(ruleProfile, draft);

    return {
      ruleProfile,
      validation
    };
  }

  async commit(workspaceId: string, draft: CommitDraft): Promise<{
    commitHash: string;
    ruleProfile: CommitRuleProfile;
    validation: CommitValidationResult;
  }> {
    this.ensureNoBlockingAiFallbackEdits(workspaceId);
    const ruleProfile = this.gitRuleRepository.getRuleProfile(workspaceId);
    const validation = this.commitRuleEngine.validate(ruleProfile, draft);
    const commitResult = await this.gitWriteService.commit(workspaceId, validation.normalizedDraft);

    return {
      commitHash: commitResult.commitHash,
      ruleProfile,
      validation
    };
  }

  private ensureNoBlockingAiFallbackEdits(workspaceId: string): void {
    const blockingEdits = this.aiFallbackEditRepository.listBlockingByWorkspaceId(workspaceId);

    if (blockingEdits.length === 0) {
      return;
    }

    const latestEdit = blockingEdits[0];

    throw new AppError({
      statusCode: 409,
      errorCode: "AI_FALLBACK_EDIT_BLOCKING_COMMIT",
      detail: `当前工作区存在未清理的 AI 兜底补丁记录，必须先拒绝或回滚。记录 ID：${latestEdit.id}`
    });
  }
}
