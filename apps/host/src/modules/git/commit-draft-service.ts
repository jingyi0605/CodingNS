import path from "node:path";

import type { CommitDraft, CommitRuleProfile, GitChangeItem } from "./types.js";
import type { GitReadService } from "./git-read-service.js";

export class CommitDraftService {
  constructor(private readonly gitReadService: GitReadService) {}

  async createDraft(
    workspaceId: string,
    mode: "manual" | "ai",
    ruleProfile: CommitRuleProfile
  ): Promise<CommitDraft> {
    if (mode === "manual") {
      return {
        subject: "chore: ",
        body: null,
        footer: ruleProfile.requireIssue ? "Refs: #TODO" : null,
        source: "manual"
      };
    }

    const status = await this.gitReadService.getStatus(workspaceId);
    const stagedChanges = status.changes.filter((item) => item.staged);
    const changes = stagedChanges.length > 0 ? stagedChanges : status.changes;
    const primaryChange = changes[0];
    const inferredType = inferCommitType(changes);
    const inferredScope = inferScope(primaryChange?.path ?? "");
    const subjectText = buildSubjectText(ruleProfile.language, primaryChange?.path ?? "");
    const subject = inferredScope
      ? `${inferredType}(${inferredScope}): ${subjectText}`
      : `${inferredType}: ${subjectText}`;
    const body = ruleProfile.requireBody
      ? buildBody(ruleProfile.language, changes)
      : changes.length > 1
        ? buildBody(ruleProfile.language, changes)
        : null;
    const footer = ruleProfile.requireIssue ? "Refs: #TODO" : null;

    return {
      subject,
      body,
      footer,
      source: "ai"
    };
  }
}

function inferCommitType(changes: GitChangeItem[]): string {
  if (changes.some((item) => item.path.startsWith("docs/"))) {
    return "docs";
  }

  if (changes.some((item) => /(^|\/)(test|tests)\//.test(item.path) || item.path.endsWith(".test.ts"))) {
    return "test";
  }

  if (changes.some((item) => item.status === "A")) {
    return "feat";
  }

  return "chore";
}

function inferScope(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const firstSegment = normalized.split("/").find(Boolean);

  if (!firstSegment) {
    return null;
  }

  return firstSegment.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || null;
}

function buildSubjectText(language: CommitRuleProfile["language"], filePath: string): string {
  const baseName = filePath ? path.basename(filePath) : "变更";

  if (language === "en") {
    return `update ${baseName}`;
  }

  return `更新${baseName}`;
}

function buildBody(language: CommitRuleProfile["language"], changes: GitChangeItem[]): string {
  const lines = changes.slice(0, 5).map((item) => {
    if (language === "en") {
      return `- update ${item.path}`;
    }

    return `- 调整 ${item.path}`;
  });

  return lines.join("\n");
}
