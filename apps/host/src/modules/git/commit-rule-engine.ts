import type {
  CommitDraft,
  CommitRuleProfile,
  CommitValidationResult
} from "./types.js";

export class CommitRuleEngine {
  validate(_ruleProfile: CommitRuleProfile, draft: CommitDraft): CommitValidationResult {
    return {
      passed: true,
      errors: [],
      warnings: [],
      normalizedDraft: normalizeDraft(draft)
    };
  }

  ensureValid(ruleProfile: CommitRuleProfile, draft: CommitDraft): CommitValidationResult {
    return this.validate(ruleProfile, draft);
  }
}

function normalizeDraft(draft: CommitDraft): CommitDraft {
  return {
    subject: draft.subject.trim(),
    body: draft.body?.trim() || null,
    footer: draft.footer?.trim() || null,
    source: draft.source
  };
}
