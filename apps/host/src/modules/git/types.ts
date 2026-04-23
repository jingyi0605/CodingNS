export type CommitRuleLanguage = "zh" | "en" | "any";

export interface GitRepoSnapshot {
  workspaceId: string;
  repoRoot: string;
  enabled?: boolean;
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
  commitKind: "local" | "remote" | "shared";
  refs: GitHistoryRef[];
}

export interface GitHistoryPage {
  items: GitHistoryItem[];
  cursor: string | null;
  nextCursor: string | null;
  totalCount: number;
}

export interface GitHistoryRef {
  name: string;
  kind: "head" | "local" | "remote";
  remoteName: string | null;
}

export interface GitCommitChangedFile {
  path: string;
  oldPath: string | null;
  status: string;
  binary: boolean;
}

export interface GitCommitDetail {
  workspaceId: string;
  commitHash: string;
  shortHash: string;
  versionLabel: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committerName: string;
  committerEmail: string;
  committedAt: string;
  subject: string;
  body: string;
  changedFiles: GitCommitChangedFile[];
  diffTruncated: boolean;
  diffContent: string;
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

export interface GitTagItem {
  name: string;
}

export interface GitRemoteSyncResult {
  action: "fetch" | "pull" | "push" | "publish";
  summary: string;
  stdout: string;
  stderr: string;
}

export interface GitRemoteItem {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitUndoCommitResult {
  summary: string;
  commitHash: string;
  commitSubject: string;
}
