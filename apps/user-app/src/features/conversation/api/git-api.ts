import { httpClient } from "../../../network/http-client";

interface GitRequestOptions {
  targetHostId?: string | null;
}

export interface GitRepoSnapshotDto {
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

export interface GitCommitChangedFileDto {
  path: string;
  oldPath: string | null;
  status: string;
  binary: boolean;
}

export interface GitCommitDetailDto {
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
  changedFiles: GitCommitChangedFileDto[];
  diffTruncated: boolean;
  diffContent: string;
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

export interface GitTagItemDto {
  name: string;
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
  credentialConfigured: boolean;
}

export interface GitUndoCommitResultDto {
  summary: string;
  commitHash: string;
  commitSubject: string;
}

export type GitRemoteAuthDto =
  | {
      mode?: "none";
    }
  | {
      mode: "basic";
      username?: string;
      password?: string;
    }
  | {
      mode: "token";
      username?: string;
      token?: string;
    };

export function getGitStatus(workspaceId: string, options?: GitRequestOptions) {
  return httpClient.request<GitStatusDto>(
    `/api/git/status?workspaceId=${encodeURIComponent(workspaceId)}`,
    { targetHostId: options?.targetHostId ?? undefined }
  );
}

export function initializeGitRepository(workspaceId: string, options?: GitRequestOptions) {
  return httpClient.request<GitStatusDto>("/api/git/init", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify({
      workspaceId
    })
  });
}

export function getGitDiff(workspaceId: string, filePath: string, staged: boolean, options?: GitRequestOptions) {
  const search = new URLSearchParams({
    workspaceId,
    path: filePath,
    staged: String(staged)
  });

  return httpClient.request<GitDiffDto>(`/api/git/diff?${search.toString()}`, {
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function stageGitTargets(workspaceId: string, targets: string[], options?: GitRequestOptions) {
  return httpClient.request<GitStatusDto>("/api/git/stage", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify({
      workspaceId,
      targets
    })
  });
}

export function unstageGitTargets(workspaceId: string, targets: string[], options?: GitRequestOptions) {
  return httpClient.request<GitStatusDto>("/api/git/unstage", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify({
      workspaceId,
      targets
    })
  });
}

export function discardGitTargets(workspaceId: string, targets: string[], options?: GitRequestOptions) {
  return httpClient.request<GitStatusDto>("/api/git/discard", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
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
  mode: "manual" | "ai",
  options?: GitRequestOptions
) {
  return httpClient.request<CommitDraftResponseDto>("/api/git/commit/draft", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify({
      workspaceId,
      mode
    })
  });
}

export function validateCommitDraft(workspaceId: string, draft: CommitDraftDto, options?: GitRequestOptions) {
  return httpClient.request<CommitValidateResponseDto>("/api/git/commit/validate", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify({
      workspaceId,
      draft
    })
  });
}

export function commitDraft(workspaceId: string, draft: CommitDraftDto, options?: GitRequestOptions) {
  return httpClient.request<{ commitHash: string; ruleProfile: CommitRuleProfileDto; validation: CommitValidationResultDto }>(
    "/api/git/commit",
    {
      method: "POST",
      targetHostId: options?.targetHostId ?? undefined,
      body: JSON.stringify({
        workspaceId,
        draft
      })
    }
  );
}

export function undoLastCommit(workspaceId: string, options?: GitRequestOptions) {
  return httpClient.request<GitUndoCommitResultDto>("/api/git/commit/undo", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify({
      workspaceId
    })
  });
}

export function getGitHistory(
  workspaceId: string,
  limit = 5,
  cursor: string | null = null,
  options?: GitRequestOptions
) {
  const search = new URLSearchParams({
    workspaceId,
    limit: String(limit)
  });

  if (cursor) {
    search.set("cursor", cursor);
  }

  return httpClient.request<GitHistoryPageDto>(`/api/git/history?${search.toString()}`, {
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function getGitCommitDetail(workspaceId: string, commitHash: string, options?: GitRequestOptions) {
  const search = new URLSearchParams({
    workspaceId,
    commitHash
  });

  return httpClient.request<GitCommitDetailDto>(`/api/git/commit-detail?${search.toString()}`, {
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function getGitBranches(workspaceId: string, options?: GitRequestOptions) {
  return httpClient.request<GitBranchSnapshotDto>(
    `/api/git/branches?workspaceId=${encodeURIComponent(workspaceId)}`,
    { targetHostId: options?.targetHostId ?? undefined }
  );
}

export function getGitTags(workspaceId: string, options?: GitRequestOptions) {
  return httpClient.request<GitTagItemDto[]>(
    `/api/git/tags?workspaceId=${encodeURIComponent(workspaceId)}`,
    { targetHostId: options?.targetHostId ?? undefined }
  );
}

export function switchGitBranch(workspaceId: string, branchName: string, create: boolean, options?: GitRequestOptions) {
  return httpClient.request<GitBranchSnapshotDto>("/api/git/branches/switch", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
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
  remote?: string,
  auth?: GitRemoteAuthDto | null,
  remember?: boolean,
  options?: GitRequestOptions
) {
  return httpClient.request<GitRemoteSyncResultDto>("/api/git/remote/sync", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify({
      workspaceId,
      action,
      ...(remote ? { remote } : {}),
      ...(auth ? { auth } : {}),
      ...(remember ? { remember } : {})
    })
  });
}

export function getGitRemotes(workspaceId: string, options?: GitRequestOptions) {
  return httpClient.request<GitRemoteItemDto[]>(
    `/api/git/remotes?workspaceId=${encodeURIComponent(workspaceId)}`,
    { targetHostId: options?.targetHostId ?? undefined }
  );
}
