import os from "node:os";
import path from "node:path";

import type { HostConfig } from "../../config/env.js";
import type { SkillTargetCli } from "../../types/domain.js";

export interface SkillTargetLocation {
  targetCli: SkillTargetCli;
  rootDir: string;
}

export interface SkillTargetAdapter {
  readonly targetCli: SkillTargetCli;
  resolveRootDir(): string;
}

export class ClaudeCodeSkillTargetAdapter implements SkillTargetAdapter {
  readonly targetCli = "claude-code" as const;

  constructor(private readonly config: Pick<HostConfig, "claudeCodeHomeDir">) {}

  resolveRootDir(): string {
    return path.resolve(this.config.claudeCodeHomeDir, "skills");
  }
}

export class CodexSkillTargetAdapter implements SkillTargetAdapter {
  readonly targetCli = "codex" as const;

  constructor(private readonly config: Pick<HostConfig, "codexHomeDir">) {}

  resolveRootDir(): string {
    return path.resolve(this.config.codexHomeDir, "skills");
  }
}

export class GeminiSkillTargetAdapter implements SkillTargetAdapter {
  readonly targetCli = "gemini" as const;

  constructor(private readonly config: Pick<HostConfig, "geminiHomeDir">) {}

  resolveRootDir(): string {
    return path.resolve(this.config.geminiHomeDir, "skills");
  }
}

export class OpenCodeSkillTargetAdapter implements SkillTargetAdapter {
  readonly targetCli = "opencode" as const;

  resolveRootDir(): string {
    return resolveDefaultOpenCodeSkillsDir();
  }
}

export class DeepSeekHarnessSkillTargetAdapter implements SkillTargetAdapter {
  readonly targetCli = "deepseek-harness" as const;

  constructor(private readonly config: Pick<HostConfig, "deepseekHarnessHomeDir">) {}

  resolveRootDir(): string {
    return path.resolve(this.config.deepseekHarnessHomeDir, "skills");
  }
}

export function createDefaultSkillTargetAdapters(
  config: Pick<HostConfig, "claudeCodeHomeDir" | "codexHomeDir" | "geminiHomeDir" | "deepseekHarnessHomeDir">
): SkillTargetAdapter[] {
  return [
    new ClaudeCodeSkillTargetAdapter(config),
    new CodexSkillTargetAdapter(config),
    new GeminiSkillTargetAdapter(config),
    new OpenCodeSkillTargetAdapter(),
    new DeepSeekHarnessSkillTargetAdapter(config)
  ];
}

export function resolveSkillTargetLocation(
  adapters: readonly SkillTargetAdapter[],
  targetCli: SkillTargetCli
): SkillTargetLocation {
  const adapter = adapters.find((candidate) => candidate.targetCli === targetCli);

  if (!adapter) {
    throw new Error("SKILL_TARGET_NOT_SUPPORTED");
  }

  return {
    targetCli,
    rootDir: adapter.resolveRootDir()
  };
}

function resolveDefaultOpenCodeSkillsDir(): string {
  const homeDir = os.homedir();

  if (process.platform === "win32") {
    const appDataDir = process.env.APPDATA?.trim();

    return path.resolve(appDataDir || path.join(homeDir, "AppData", "Roaming"), "opencode", "skills");
  }

  return path.resolve(homeDir, ".config", "opencode", "skills");
}
