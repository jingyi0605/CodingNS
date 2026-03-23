import type Database from "better-sqlite3";

import type { CommitRuleProfile } from "../../modules/git/types.js";

export class CommitRuleProfileRepository {
  constructor(private readonly db: Database.Database) {}

  findByWorkspaceId(workspaceId: string): CommitRuleProfile | null {
    const row = this.db
      .prepare(
        `SELECT id, workspace_id, name, subject_pattern, max_subject_length, language,
                require_body, require_issue, issue_pattern, updated_at
         FROM commit_rule_profiles
         WHERE workspace_id = ?`
      )
      .get(workspaceId) as CommitRuleProfileRow | undefined;

    return row ? mapRow(row) : null;
  }

  upsert(record: CommitRuleProfile): void {
    this.db
      .prepare(
        `INSERT INTO commit_rule_profiles (
           id, workspace_id, name, subject_pattern, max_subject_length, language,
           require_body, require_issue, issue_pattern, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET
           name = excluded.name,
           subject_pattern = excluded.subject_pattern,
           max_subject_length = excluded.max_subject_length,
           language = excluded.language,
           require_body = excluded.require_body,
           require_issue = excluded.require_issue,
           issue_pattern = excluded.issue_pattern,
           updated_at = excluded.updated_at`
      )
      .run(
        record.id,
        record.workspaceId,
        record.name,
        record.subjectPattern,
        record.maxSubjectLength,
        record.language,
        record.requireBody ? 1 : 0,
        record.requireIssue ? 1 : 0,
        record.issuePattern,
        record.updatedAt
      );
  }
}

interface CommitRuleProfileRow {
  id: string;
  workspace_id: string;
  name: string;
  subject_pattern: string;
  max_subject_length: number;
  language: CommitRuleProfile["language"];
  require_body: number;
  require_issue: number;
  issue_pattern: string | null;
  updated_at: string;
}

function mapRow(row: CommitRuleProfileRow): CommitRuleProfile {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    subjectPattern: row.subject_pattern,
    maxSubjectLength: row.max_subject_length,
    language: row.language,
    requireBody: row.require_body === 1,
    requireIssue: row.require_issue === 1,
    issuePattern: row.issue_pattern,
    updatedAt: row.updated_at
  };
}
