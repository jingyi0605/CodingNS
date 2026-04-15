import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CODEX_MODEL_PROVIDER_PATTERN = /^\s*model_provider\s*=\s*"([^"]+)"/m;

export function resolveButlerCodexBackgroundModel(
  preferredModel: string,
  sourceCodexHomeDir: string | null
): string | null {
  const provider = readCodexModelProvider(sourceCodexHomeDir);

  // 当前 api 供应商下，gpt-5.1-codex-mini 会出现空完成/502，后台 Butler 任务不能再强行覆盖模型。
  if (provider === "api") {
    return null;
  }

  return preferredModel;
}

function readCodexModelProvider(sourceCodexHomeDir: string | null): string | null {
  const homeDir = resolveSourceCodexHomeDir(sourceCodexHomeDir);
  const configPath = path.join(homeDir, "config.toml");

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, "utf8");
    const matched = content.match(CODEX_MODEL_PROVIDER_PATTERN);
    const provider = matched?.[1]?.trim() ?? "";
    return provider.length > 0 ? provider : null;
  } catch {
    return null;
  }
}

function resolveSourceCodexHomeDir(sourceCodexHomeDir: string | null): string {
  const configured = sourceCodexHomeDir?.trim();

  if (configured) {
    return path.resolve(configured);
  }

  return path.resolve(path.join(os.homedir(), ".codex"));
}
