import type { RuntimeConfig } from "./runtime-config.js";

export interface CliCommandContext {
  command: string;
  cwd: string;
  args: Record<string, unknown>;
  config: RuntimeConfig;
}
