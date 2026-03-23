import type { CommitRuleProfile } from "./types.js";
import type { CommitRuleProfileRepository } from "../../storage/repositories/commit-rule-profile-repository.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";

export class GitRuleRepository {
  constructor(private readonly repository: CommitRuleProfileRepository) {}

  getRuleProfile(workspaceId: string): CommitRuleProfile {
    return this.repository.findByWorkspaceId(workspaceId) ?? createDefaultRuleProfile(workspaceId);
  }

  saveRuleProfile(
    workspaceId: string,
    input: Omit<CommitRuleProfile, "id" | "workspaceId" | "updatedAt">
  ): CommitRuleProfile {
    const existing = this.repository.findByWorkspaceId(workspaceId);
    const record: CommitRuleProfile = {
      id: existing?.id ?? createId(),
      workspaceId,
      name: input.name.trim(),
      subjectPattern: input.subjectPattern.trim(),
      maxSubjectLength: input.maxSubjectLength,
      language: input.language,
      requireBody: input.requireBody,
      requireIssue: input.requireIssue,
      issuePattern: input.issuePattern?.trim() || null,
      updatedAt: nowIso()
    };

    this.repository.upsert(record);

    return record;
  }
}

export function createDefaultRuleProfile(workspaceId: string): CommitRuleProfile {
  return {
    id: `default-${workspaceId}`,
    workspaceId,
    name: "默认中文提交规则",
    subjectPattern: "^(?<type>[a-z]+)(\\([^)]+\\))?:\\s(?<subject>.+)$",
    maxSubjectLength: 72,
    language: "zh",
    requireBody: false,
    requireIssue: false,
    issuePattern: "(#\\d+|[A-Z]+-\\d+)",
    updatedAt: nowIso()
  };
}
