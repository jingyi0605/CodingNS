export type CommitRuleLanguage = "zh" | "en" | "any";

export interface GitRepoSnapshot {
  workspaceId: string;
  repoRoot: string;
  branch: string;
  ahead: number;
  behind: number;
  hasRemote: boolean;
  isDirty: boolean;
  lastFetchedAt: string | null;
}

export interface GitChangeItem {
  path: string;
  status: string;
  staged: boolean;
  oldPath: string | null;
  binary: boolean;
  stagedStatus: string | null;
  worktreeStatus: string | null;
}

export interface GitDiffResult {
  workspaceId: string;
  path: string;
  staged: boolean;
  binary: boolean;
  truncated: boolean;
  content: string;
}

export interface CommitRuleProfile {
  id: string;
  workspaceId: string;
  name: string;
  subjectPattern: string;
  maxSubjectLength: number;
  language: CommitRuleLanguage;
  requireBody: boolean;
  requireIssue: boolean;
  issuePattern: string | null;
  updatedAt: string;
}

export interface CommitDraft {
  subject: string;
  body: string | null;
  footer: string | null;
  source: "manual" | "ai";
}

export interface CommitValidationIssue {
  code: string;
  field: "subject" | "body" | "footer";
  detail: string;
}

export interface CommitValidationResult {
  passed: boolean;
  errors: CommitValidationIssue[];
  warnings: CommitValidationIssue[];
  normalizedDraft: CommitDraft;
}

export interface GitHistoryItem {
  commitHash: string;
  authorName: string;
  authoredAt: string;
  subject: string;
  body: string;
}

export interface GitHistoryPage {
  items: GitHistoryItem[];
  cursor: string | null;
  nextCursor: string | null;
}

export interface GitBranchItem {
  name: string;
  current: boolean;
  upstream: string | null;
  remote: boolean;
}

export interface GitBranchSnapshot {
  currentBranch: string;
  local: GitBranchItem[];
  remote: GitBranchItem[];
}

export interface GitRemoteSyncResult {
  action: "fetch" | "pull" | "push" | "publish";
  summary: string;
  stdout: string;
  stderr: string;
}
