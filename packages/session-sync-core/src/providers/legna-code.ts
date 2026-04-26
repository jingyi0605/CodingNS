import { ClaudeCodeAdapter, CLAUDE_COMPAT_MODEL_OPTIONS } from "./claude-code.js";
import { createLegnaSessionStoreProfile } from "./claude-session-store.js";

interface LegnaCodeAdapterOptions {
  homeDir: string;
  legacyClaudeHomeDir?: string | null;
}

export class LegnaCodeAdapter extends ClaudeCodeAdapter {
  constructor(options: LegnaCodeAdapterOptions) {
    super({
      homeDir: options.homeDir,
      providerId: "legna-code",
      sessionStoreProfile: createLegnaSessionStoreProfile({
        legacyClaudeHomeDir: options.legacyClaudeHomeDir
      }),
      modelOptions: CLAUDE_COMPAT_MODEL_OPTIONS,
      defaultSessionTitle: "New LegnaCode session",
      capabilityLimitations: ["当前实现复用 Claude 兼容 jsonl/runtime，暂未接入 Legna 专属扩展能力。"]
    });
  }
}
