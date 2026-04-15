import { httpClient } from "../../../network/http-client";

export type ModelSwitchAppId = "codex" | "claude-code" | "gemini" | "opencode";
export type ModelSwitchAppStatus = "ready" | "unconfigured" | "unavailable" | "error";

export interface ModelPresetOptionDto {
  id: string;
  name: string;
  model: string | null;
  summary: string | null;
  isCurrent: boolean;
}

export interface ModelManagementAppSnapshotDto {
  app: ModelSwitchAppId;
  displayName: string;
  cliAvailable: boolean;
  status: ModelSwitchAppStatus;
  statusText: string | null;
  currentPresetId: string | null;
  currentPresetName: string | null;
  currentModel: string | null;
  options: ModelPresetOptionDto[];
}

export interface ModelManagementSnapshotDto {
  items: ModelManagementAppSnapshotDto[];
  scannedAt: string;
}

export async function fetchModelManagementSnapshot(): Promise<ModelManagementSnapshotDto> {
  return await httpClient.request<ModelManagementSnapshotDto>("/api/system/model-switch");
}

export async function switchModelPreset(input: {
  app: ModelSwitchAppId;
  presetId: string;
}): Promise<ModelManagementAppSnapshotDto> {
  return await httpClient.request<ModelManagementAppSnapshotDto>("/api/system/model-switch", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
