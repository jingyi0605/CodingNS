import { httpClient } from "../../../network/http-client";

export interface GitRepoSnapshotDto {
  workspaceId: string;
  repoRoot: string;
  branch: string;
  ahead: number;
  behind: number;
  hasRemote: boolean;
  isDirty: boolean;
  lastFetchedAt: string | null;
}

export interface GitChangeItemDto {
  path: string;
  status: string;
  staged: boolean;
  oldPath: string | null;
  binary: boolean;
  stagedStatus: string | null;
  worktreeStatus: string | null;
}

export interface GitStatusDto {
  snapshot: GitRepoSnapshotDto;
  changes: GitChangeItemDto[];
}

export interface GitDiffDto {
  workspaceId: string;
  path: string;
  staged: boolean;
  binary: boolean;
  truncated: boolean;
  content: string;
}

export interface CommitRuleProfileDto {
  id: string;
  workspaceId: string;
  name: string;
  subjectPattern: string;
  maxSubjectLength: number;
  language: "zh" | "en" | "any";
  requireBody: boolean;
  requireIssue: boolean;
  issuePattern: string | null;
  updatedAt: string;
}

export interface CommitDraftDto {
  subject: string;
  body: string | null;
  footer: string | null;
  source: "manual" | "ai";
}

export interface CommitValidationIssueDto {
  code: string;
  field: "subject" | "body" | "footer";
  detail: string;
}

export interface CommitValidationResultDto {
  passed: boolean;
  errors: CommitValidationIssueDto[];
  warnings: CommitValidationIssueDto[];
  normalizedDraft: CommitDraftDto;
}

export interface CommitDraftResponseDto {
  ruleProfile: CommitRuleProfileDto;
  draft: CommitDraftDto;
  validation: CommitValidationResultDto;
}

export interface CommitValidateResponseDto {
  ruleProfile: CommitRuleProfileDto;
  validation: CommitValidationResultDto;
}

export interface GitHistoryItemDto {
  commitHash: string;
  authorName: string;
  authoredAt: string;
  subject: string;
  body: string;
  commitKind: "local" | "remote" | "shared";
  refs: GitHistoryRefDto[];
}

export interface GitHistoryPageDto {
  items: GitHistoryItemDto[];
  cursor: string | null;
  nextCursor: string | null;
  totalCount: number;
}

export interface GitHistoryRefDto {
  name: string;
  kind: "head" | "local" | "remote";
  remoteName: string | null;
}

export interface GitBranchItemDto {
  name: string;
  current: boolean;
  upstream: string | null;
  remote: boolean;
}

export interface GitBranchSnapshotDto {
  currentBranch: string;
  local: GitBranchItemDto[];
  remote: GitBranchItemDto[];
}

export interface GitRemoteSyncResultDto {
  action: "fetch" | "pull" | "push" | "publish";
  summary: string;
  stdout: string;
  stderr: string;
}

export interface GitRemoteItemDto {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitUndoCommitResultDto {
  summary: string;
  commitHash: string;
  commitSubject: string;
}

export function getGitStatus(workspaceId: string) {
  return httpClient.request<GitStatusDto>(
    `/api/git/status?workspaceId=${encodeURIComponent(workspaceId)}`
  );
}

export function getGitDiff(workspaceId: string, filePath: string, staged: boolean) {
  const search = new URLSearchParams({
    workspaceId,
    path: filePath,
    staged: String(staged)
  });

  return httpClient.request<GitDiffDto>(`/api/git/diff?${search.toString()}`);
}

export function stageGitTargets(workspaceId: string, targets: string[]) {
  return httpClient.request<GitStatusDto>("/api/git/stage", {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      targets
    })
  });
}

export function unstageGitTargets(workspaceId: string, targets: string[]) {
  return httpClient.request<GitStatusDto>("/api/git/unstage", {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      targets
    })
  });
}

export function discardGitTargets(workspaceId: string, targets: string[]) {
  return httpClient.request<GitStatusDto>("/api/git/discard", {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      targets
    })
  });
}

export function getCommitRules(workspaceId: string) {
  return httpClient.request<CommitRuleProfileDto>(
    `/api/git/rules?workspaceId=${encodeURIComponent(workspaceId)}`
  );
}

export function createCommitDraft(
  workspaceId: string,
  mode: "manual" | "ai"
) {
  return httpClient.request<CommitDraftResponseDto>("/api/git/commit/draft", {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      mode
    })
  });
}

export function validateCommitDraft(workspaceId: string, draft: CommitDraftDto) {
  return httpClient.request<CommitValidateResponseDto>("/api/git/commit/validate", {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      draft
    })
  });
}

export function commitDraft(workspaceId: string, draft: CommitDraftDto) {
  return httpClient.request<{ commitHash: string; ruleProfile: CommitRuleProfileDto; validation: CommitValidationResultDto }>(
    "/api/git/commit",
    {
      method: "POST",
      body: JSON.stringify({
        workspaceId,
        draft
      })
    }
  );
}

export function undoLastCommit(workspaceId: string) {
  return httpClient.request<GitUndoCommitResultDto>("/api/git/commit/undo", {
    method: "POST",
    body: JSON.stringify({
      workspaceId
    })
  });
}

export function getGitHistory(workspaceId: string, limit = 5, cursor: string | null = null) {
  const search = new URLSearchParams({
    workspaceId,
    limit: String(limit)
  });

  if (cursor) {
    search.set("cursor", cursor);
  }

  return httpClient.request<GitHistoryPageDto>(`/api/git/history?${search.toString()}`);
}

export function getGitBranches(workspaceId: string) {
  return httpClient.request<GitBranchSnapshotDto>(
    `/api/git/branches?workspaceId=${encodeURIComponent(workspaceId)}`
  );
}

export function switchGitBranch(workspaceId: string, branchName: string, create: boolean) {
  return httpClient.request<GitBranchSnapshotDto>("/api/git/branches/switch", {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      branchName,
      create
    })
  });
}

export function syncGitRemote(
  workspaceId: string,
  action: GitRemoteSyncResultDto["action"],
  remote?: string
) {
  return httpClient.request<GitRemoteSyncResultDto>("/api/git/remote/sync", {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      action,
      ...(remote ? { remote } : {})
    })
  });
}

export function getGitRemotes(workspaceId: string) {
  return httpClient.request<GitRemoteItemDto[]>(
    `/api/git/remotes?workspaceId=${encodeURIComponent(workspaceId)}`
  );
}
