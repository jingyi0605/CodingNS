import type {
  ModelManagementAppSnapshotDto,
  ModelSwitchAppId
} from "./cc-switch-adapter.js";
import { CcSwitchAdapter } from "./cc-switch-adapter.js";

export interface ModelManagementSnapshotDto {
  items: ModelManagementAppSnapshotDto[];
  scannedAt: string;
}

export interface ModelSwitchInput {
  app?: string;
  presetId?: string;
}

const MODEL_SWITCH_APPS: ModelSwitchAppId[] = [
  "codex",
  "claude-code",
  "gemini",
  "opencode"
];

export class ModelSwitchService {
  constructor(private readonly adapter: CcSwitchAdapter) {}

  async getSnapshot(): Promise<ModelManagementSnapshotDto> {
    const items = await Promise.all(
      MODEL_SWITCH_APPS.map((app) => this.adapter.readAppSnapshot(app))
    );

    return {
      items,
      scannedAt: new Date().toISOString()
    };
  }

  async switchPreset(input: ModelSwitchInput): Promise<ModelManagementAppSnapshotDto> {
    return await this.adapter.switchPreset(
      normalizeAppId(input.app),
      (input.presetId ?? "").trim()
    );
  }
}

function normalizeAppId(value: string | undefined): ModelSwitchAppId {
  if (value === "codex" || value === "claude-code" || value === "gemini" || value === "opencode") {
    return value;
  }

  throw new Error("MODEL_SWITCH_APP_UNSUPPORTED");
}
