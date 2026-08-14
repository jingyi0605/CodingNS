import { httpClient } from "../../../network/http-client";

export type SkillTargetCli = "codex" | "claude-code" | "gemini" | "opencode";
export type SkillScope = "workspace" | "assistant";

export interface ManagedSkillDto {
  id: string;
  name: string;
  scope: SkillScope;
  directoryName: string;
  sourceType: string;
  sourcePath: string | null;
  contentHash: string;
  managedState: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillTargetBindingDto {
  skillId: string;
  targetCli: SkillTargetCli;
  enabled: boolean;
  syncStatus: "pending" | "synced" | "failed" | "conflicted";
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
}

export interface SkillScanEntryDto {
  targetCli: SkillTargetCli;
  directoryPath: string;
  directoryName: string;
  name: string;
  contentHash: string;
  managementState: "managed" | "unmanaged" | "conflicted";
  managedSkillId: string | null;
}

export interface SkillScanDiagnosticDto {
  targetCli: SkillTargetCli;
  rootDir: string;
  code: string;
  detail: string;
  directoryName: string | null;
  directoryPath: string | null;
  managedSkillId: string | null;
}

export interface ManagedSkillOverviewItemDto {
  skill: ManagedSkillDto;
  bindings: SkillTargetBindingDto[];
  ssotPath: string;
}

export interface AssistantRuntimeSkillOverviewItemDto {
  name: string;
  directoryName: string;
  sourcePath: string;
  usedByTargetCli: SkillTargetCli[];
}

export interface SkillOverviewDto {
  summary: {
    managedSkillCount: number;
    managedEntryCount: number;
    unmanagedEntryCount: number;
    conflictedEntryCount: number;
    diagnosticCount: number;
  };
  managedSkills: ManagedSkillOverviewItemDto[];
  assistantRuntimeSkills: AssistantRuntimeSkillOverviewItemDto[];
  managedEntries: SkillScanEntryDto[];
  unmanagedEntries: SkillScanEntryDto[];
  conflictedEntries: SkillScanEntryDto[];
  diagnostics: SkillScanDiagnosticDto[];
  scannedAt: string;
}

export interface WorkspaceSessionMcpCliStatusDto {
  cli: "codex" | "claude-code" | "opencode";
  label: string;
  runtimeConfigFile: string;
  runtimeConfigExists: boolean;
  mcpConfigured: boolean;
  callState: "ready" | "runtime_injected" | "missing_runtime_config" | "missing_runtime_artifacts";
  callStateDetail: string;
}

export interface WorkspaceSessionMcpCommandStatusDto {
  globalCodingnsInstalled: boolean;
  globalCodingnsPath: string | null;
  globalCodingnsSupportsWorkspaceMcp: boolean;
  globalCodingnsWorkspaceMcpDetail: string;
  globalWorkspaceOfficeMcpInstalled: boolean;
  globalWorkspaceOfficeMcpPath: string | null;
  repoCodingnsSupportsWorkspaceMcp: boolean;
  repoCodingnsWorkspaceMcpDetail: string;
}

export interface WorkspaceSessionMcpRuntimeStatusDto {
  workspaceId: string;
  workspacePath: string;
  sessionId: string | null;
  runtimeHomeDir: string | null;
  runtimeHomeExists: boolean;
  scopedAuthFilePath: string | null;
  scopedAuthFileExists: boolean;
  composedInstructionPath: string | null;
  composedInstructionExists: boolean;
  skillDirectoryPath: string | null;
  skillDirectoryExists: boolean;
}

export interface WorkspaceSessionMcpStatusDto {
  summary: {
    readyCliCount: number;
    configuredCliCount: number;
    totalCliCount: number;
  };
  simplified: {
    overallState: "ready" | "partial" | "missing";
    overallDetail: string;
    currentSessionReady: boolean;
    currentSessionDetail: string;
    codexState: "ready" | "partial" | "missing";
    codexDetail: string;
    globalCodingnsState: "ready" | "partial" | "missing";
    globalCodingnsDetail: string;
    recommendedPath: string | null;
  };
  runtime: WorkspaceSessionMcpRuntimeStatusDto;
  commands: WorkspaceSessionMcpCommandStatusDto;
  cliStatuses: WorkspaceSessionMcpCliStatusDto[];
}

export async function fetchSkillOverview(): Promise<SkillOverviewDto> {
  return await httpClient.request<SkillOverviewDto>("/api/skills/overview");
}

export async function fetchWorkspaceSessionMcpStatus(input: {
  workspaceId: string;
  sessionId?: string | null;
}): Promise<WorkspaceSessionMcpStatusDto> {
  const query = new URLSearchParams();
  query.set("workspaceId", input.workspaceId);

  if (input.sessionId?.trim()) {
    query.set("sessionId", input.sessionId.trim());
  }

  return await httpClient.request<WorkspaceSessionMcpStatusDto>(
    `/api/skills/workspace-session-mcp-status?${query.toString()}`
  );
}

export async function addSkillFromMarkdown(input: {
  markdownContent: string;
  targetCli: SkillTargetCli[];
  scope: SkillScope;
  fileName?: string | null;
  directoryName?: string | null;
}): Promise<void> {
  await httpClient.request<void>("/api/skills", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function importSkillEntry(input: {
  targetCli: SkillTargetCli;
  directoryPath: string;
  expectedContentHash?: string | null;
}): Promise<void> {
  await httpClient.request<void>("/api/skills/import", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function syncManagedSkillTargets(input: {
  skillId: string;
  targetCli: SkillTargetCli[];
}): Promise<void> {
  await httpClient.request<void>("/api/skills/sync", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
