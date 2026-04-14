import { httpClient } from "../../../network/http-client";

export type SkillTargetCli = "codex" | "claude-code" | "gemini" | "opencode";

export interface ManagedSkillDto {
  id: string;
  name: string;
  directoryName: string;
  sourceType: string;
  sourcePath: string;
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

export interface SkillOverviewDto {
  summary: {
    managedSkillCount: number;
    managedEntryCount: number;
    unmanagedEntryCount: number;
    conflictedEntryCount: number;
    diagnosticCount: number;
  };
  managedSkills: ManagedSkillOverviewItemDto[];
  managedEntries: SkillScanEntryDto[];
  unmanagedEntries: SkillScanEntryDto[];
  conflictedEntries: SkillScanEntryDto[];
  diagnostics: SkillScanDiagnosticDto[];
  scannedAt: string;
}

export async function fetchSkillOverview(): Promise<SkillOverviewDto> {
  return await httpClient.request<SkillOverviewDto>("/api/skills/overview");
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
