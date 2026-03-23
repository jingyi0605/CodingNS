import { AppError } from "../../shared/errors/app-error.js";
import type {
  CommitDraft,
  CommitRuleProfile,
  CommitValidationIssue,
  CommitValidationResult
} from "./types.js";

export class CommitRuleEngine {
  validate(ruleProfile: CommitRuleProfile, draft: CommitDraft): CommitValidationResult {
    const normalizedDraft = normalizeDraft(draft);
    const errors: CommitValidationIssue[] = [];
    const warnings: CommitValidationIssue[] = [];
    const pattern = compilePattern(ruleProfile.subjectPattern);
    const match = pattern.exec(normalizedDraft.subject);
    const plainSubject = extractPlainSubject(normalizedDraft.subject, match);
    const completeMessage = [
      normalizedDraft.subject,
      normalizedDraft.body ?? "",
      normalizedDraft.footer ?? ""
    ]
      .filter(Boolean)
      .join("\n\n");

    if (!normalizedDraft.subject) {
      errors.push({
        code: "SUBJECT_REQUIRED",
        field: "subject",
        detail: "提交标题不能为空"
      });
    }

    if (normalizedDraft.subject.length > ruleProfile.maxSubjectLength) {
      errors.push({
        code: "SUBJECT_TOO_LONG",
        field: "subject",
        detail: `提交标题不能超过 ${ruleProfile.maxSubjectLength} 个字符`
      });
    }

    if (!match) {
      errors.push({
        code: "SUBJECT_PATTERN_MISMATCH",
        field: "subject",
        detail: "提交标题必须符合 type(scope): subject 格式"
      });
    }

    if (ruleProfile.requireBody && !normalizedDraft.body) {
      errors.push({
        code: "BODY_REQUIRED",
        field: "body",
        detail: "当前规则要求必须填写提交正文"
      });
    }

    if (ruleProfile.requireIssue) {
      const issuePattern = compilePattern(ruleProfile.issuePattern ?? "(#\\d+|[A-Z]+-\\d+)");

      if (!issuePattern.test(completeMessage)) {
        errors.push({
          code: "ISSUE_REQUIRED",
          field: "footer",
          detail: "当前规则要求必须包含 issue 编号"
        });
      }
    }

    if (ruleProfile.language === "zh" && !containsChinese(plainSubject)) {
      errors.push({
        code: "LANGUAGE_MISMATCH",
        field: "subject",
        detail: "当前仓库要求提交标题使用中文"
      });
    }

    if (ruleProfile.language === "en" && containsChinese(plainSubject)) {
      errors.push({
        code: "LANGUAGE_MISMATCH",
        field: "subject",
        detail: "当前仓库要求提交标题使用英文"
      });
    }

    if (ruleProfile.language === "en" && !containsLatinLetter(plainSubject)) {
      warnings.push({
        code: "LANGUAGE_WEAK_SIGNAL",
        field: "subject",
        detail: "提交标题看起来不像英文，请再检查一下"
      });
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
      normalizedDraft
    };
  }

  ensureValid(ruleProfile: CommitRuleProfile, draft: CommitDraft): CommitValidationResult {
    const result = this.validate(ruleProfile, draft);

    if (!result.passed) {
      throw new AppError({
        statusCode: 400,
        errorCode: "COMMIT_VALIDATION_FAILED",
        detail: result.errors.map((item) => item.detail).join("；")
      });
    }

    return result;
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

function compilePattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new AppError({
      statusCode: 500,
      errorCode: "INVALID_RULE_PROFILE",
      detail: `提交规则格式无效：${error instanceof Error ? error.message : "未知错误"}`
    });
  }
}

function extractPlainSubject(subject: string, match: RegExpExecArray | null): string {
  const namedSubject = match?.groups?.subject?.trim();

  if (namedSubject) {
    return namedSubject;
  }

  const separatorIndex = subject.indexOf(":");

  if (separatorIndex >= 0) {
    return subject.slice(separatorIndex + 1).trim();
  }

  return subject.trim();
}

function containsChinese(input: string): boolean {
  return /[\u3400-\u9fff]/.test(input);
}

function containsLatinLetter(input: string): boolean {
  return /[A-Za-z]/.test(input);
}
