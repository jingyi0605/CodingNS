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

export interface ModelManagementRequestOptions {
  targetHostId?: string | null;
}

export async function fetchModelManagementSnapshot(
  options?: ModelManagementRequestOptions
): Promise<ModelManagementSnapshotDto> {
  return await httpClient.request<ModelManagementSnapshotDto>("/api/system/model-switch", {
    targetHostId: options?.targetHostId ?? undefined
  });
}

export async function switchModelPreset(input: {
  app: ModelSwitchAppId;
  presetId: string;
}, options?: ModelManagementRequestOptions): Promise<ModelManagementAppSnapshotDto> {
  return await httpClient.request<ModelManagementAppSnapshotDto>("/api/system/model-switch", {
    method: "POST",
    body: JSON.stringify(input),
    targetHostId: options?.targetHostId ?? undefined
  });
}
