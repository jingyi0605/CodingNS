import { createLegnaSessionStoreProfile } from "../providers/claude-session-store.js";
import { ClaudeRuntimeAdapter } from "./claude-runtime.js";

interface LegnaRuntimeAdapterOptions {
  homeDir: string;
  commandPath?: string;
  legacyClaudeHomeDir?: string | null;
  hookBridge?: {
    url: string;
    token: string;
    scriptPath: string;
  } | null;
}

export class LegnaRuntimeAdapter extends ClaudeRuntimeAdapter {
  constructor(options: LegnaRuntimeAdapterOptions) {
    super({
      homeDir: options.homeDir,
      commandPath: options.commandPath,
      providerId: "legna-code",
      sessionStoreProfile: createLegnaSessionStoreProfile({
        legacyClaudeHomeDir: options.legacyClaudeHomeDir
      }),
      hookBridge: options.hookBridge ?? null
    });
  }
}
