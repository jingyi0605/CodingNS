import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ProviderCapabilities, ProviderModelOption } from "@codingns/session-sync-core";

interface ClaudeSettingsShape {
  env?: Record<string, unknown>;
}

const CLAUDE_STANDARD_MODEL_IDS = new Set([
  "sonnet",
  "opus",
  "haiku"
]);

const CLAUDE_STANDARD_MODEL_PREFIX = "claude-";

const CLAUDE_MODEL_ALIASES = [
  {
    id: "sonnet",
    label: "Sonnet",
    envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL"
  },
  {
    id: "opus",
    label: "Opus",
    envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL"
  },
  {
    id: "haiku",
    label: "Haiku",
    envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL"
  }
] as const;

export function enrichClaudeCapabilities(
  capabilities: ProviderCapabilities,
  input: {
    claudeHomeDir: string;
    workspacePath?: string | null;
  }
): ProviderCapabilities {
  if (capabilities.provider !== "claude-code") {
    return capabilities;
  }

  const env = readEffectiveClaudeEnv(input.claudeHomeDir, input.workspacePath ?? null);
  const modelOptions = buildClaudeModelOptions(env);

  return {
    ...capabilities,
    modelOptions
  };
}

function readEffectiveClaudeEnv(
  claudeHomeDir: string,
  workspacePath: string | null
): Record<string, string> {
  const settingsFiles = [
    join(claudeHomeDir, "settings.json"),
    join(claudeHomeDir, "settings.local.json"),
    workspacePath ? join(workspacePath, ".claude", "settings.json") : null,
    workspacePath ? join(workspacePath, ".claude", "settings.local.json") : null
  ].filter((value): value is string => Boolean(value));

  return settingsFiles.reduce<Record<string, string>>((current, filePath) => {
    const nextEnv = readClaudeEnvFile(filePath);

    if (!nextEnv) {
      return current;
    }

    return {
      ...current,
      ...nextEnv
    };
  }, {});
}

function readClaudeEnvFile(filePath: string): Record<string, string> | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as ClaudeSettingsShape;
    const env = parsed.env;

    if (!env || typeof env !== "object") {
      return null;
    }

    const entries = Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0
    );

    return Object.fromEntries(entries);
  } catch {
    return null;
  }
}

function buildClaudeModelOptions(env: Record<string, string>): ProviderModelOption[] {
  const defaultModel = normalizeModelId(env.ANTHROPIC_MODEL);
  const aliasTargets = CLAUDE_MODEL_ALIASES.map((alias) => ({
    ...alias,
    target: normalizeModelId(env[alias.envKey])
  }));
  const customModels = new Set<string>();

  if (defaultModel && isCustomModel(defaultModel)) {
    customModels.add(defaultModel);
  }

  aliasTargets.forEach((alias) => {
    if (alias.target && isCustomModel(alias.target)) {
      customModels.add(alias.target);
    }
  });

  return [
    {
      id: "provider-default",
      name: defaultModel ? `跟随 CLI 默认模型（当前：${defaultModel}）` : "跟随 CLI 默认模型",
      usesProviderDefault: true
    },
    ...aliasTargets.map((alias) => ({
      id: alias.id,
      name: alias.target ? `${alias.label}（当前：${alias.target}）` : alias.label
    })),
    ...Array.from(customModels).map((modelId) => ({
      id: modelId,
      name: modelId
    }))
  ];
}

function normalizeModelId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isCustomModel(modelId: string): boolean {
  if (CLAUDE_STANDARD_MODEL_IDS.has(modelId)) {
    return false;
  }

  if (modelId.startsWith(CLAUDE_STANDARD_MODEL_PREFIX)) {
    return false;
  }

  return true;
}
