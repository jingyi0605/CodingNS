import { spawn } from "node:child_process";

import { AppError } from "../../shared/errors/app-error.js";
import Database from "../../shared/runtime/better-sqlite3.js";
import { resolveAvailableCommandPath } from "../../shared/utils/command-availability.js";
import { resolveCommandLaunch } from "../../shared/utils/command-launch.js";

export type ModelSwitchAppId = "claude-code" | "codex" | "gemini" | "opencode";
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

export interface ModelPresetRuntimeConfigDto {
  id: string;
  name: string;
  app: ModelSwitchAppId;
  settingsConfig: Record<string, unknown>;
}

interface CcSwitchAdapterOptions {
  commandPath: string;
  dbPath: string;
  timeoutMs?: number;
}

interface ProviderRow {
  id: string;
  name: string;
  settings_config: string;
  is_current: number;
}

interface AppMetadata {
  dbTypes: string[];
  cliApp: string;
  displayName: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const CC_SWITCH_CLI_REPO_URL = "https://github.com/SaladDay/cc-switch-cli";

const APP_METADATA: Record<ModelSwitchAppId, AppMetadata> = {
  "claude-code": {
    dbTypes: ["claude"],
    cliApp: "claude",
    displayName: "Claude Code"
  },
  codex: {
    dbTypes: ["codex"],
    cliApp: "codex",
    displayName: "Codex"
  },
  gemini: {
    dbTypes: ["gemini"],
    cliApp: "gemini",
    displayName: "Gemini"
  },
  opencode: {
    dbTypes: ["opencode", "open-code"],
    cliApp: "open-code",
    displayName: "OpenCode"
  }
};

export class CcSwitchAdapter {
  private readonly timeoutMs: number;

  constructor(private readonly options: CcSwitchAdapterOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async readAppSnapshot(app: ModelSwitchAppId): Promise<ModelManagementAppSnapshotDto> {
    const metadata = APP_METADATA[app];
    const commandPath = this.resolveCommandPath();

    if (!commandPath) {
      return {
        app,
        displayName: metadata.displayName,
        cliAvailable: false,
        status: "unavailable",
        statusText: buildCcSwitchCliMissingMessage(),
        currentPresetId: null,
        currentPresetName: null,
        currentModel: null,
        options: []
      };
    }

    try {
      const rows = this.readProviderRows(metadata.dbTypes);

      if (rows.length === 0) {
        return {
          app,
          displayName: metadata.displayName,
          cliAvailable: true,
          status: "unconfigured",
          statusText: "当前还没有可切换的预设",
          currentPresetId: null,
          currentPresetName: null,
          currentModel: null,
          options: []
        };
      }

      const options = rows.map((row) => normalizeProviderOption(app, row));
      const currentOption = options.find((option) => option.isCurrent) ?? null;

      return {
        app,
        displayName: metadata.displayName,
        cliAvailable: true,
        status: "ready",
        statusText: null,
        currentPresetId: currentOption?.id ?? null,
        currentPresetName: currentOption?.name ?? null,
        currentModel: currentOption?.model ?? null,
        options
      };
    } catch (error) {
      return {
        app,
        displayName: metadata.displayName,
        cliAvailable: true,
        status: "error",
        statusText: error instanceof Error ? error.message : "读取预设失败",
        currentPresetId: null,
        currentPresetName: null,
        currentModel: null,
        options: []
      };
    }
  }

  async switchPreset(app: ModelSwitchAppId, presetId: string): Promise<ModelManagementAppSnapshotDto> {
    const normalizedPresetId = presetId.trim();

    if (!normalizedPresetId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "presetId 不能为空",
        field: "presetId"
      });
    }

    const metadata = APP_METADATA[app];
    const commandPath = this.resolveCommandPath();

    if (!commandPath) {
      throw new AppError({
        statusCode: 503,
        errorCode: "CC_SWITCH_UNAVAILABLE",
        detail: buildCcSwitchCliMissingMessage()
      });
    }

    const existingRows = this.readProviderRows(metadata.dbTypes);

    if (!existingRows.some((row) => row.id === normalizedPresetId)) {
      throw new AppError({
        statusCode: 404,
        errorCode: "MODEL_PRESET_NOT_FOUND",
        detail: `当前应用下不存在预设 ${normalizedPresetId}`
      });
    }

    await this.runSwitchCommand(commandPath, metadata.cliApp, normalizedPresetId);
    const snapshot = await this.readAppSnapshot(app);

    if (snapshot.currentPresetId !== normalizedPresetId) {
      throw new AppError({
        statusCode: 502,
        errorCode: "CC_SWITCH_STATE_STALE",
        detail: "切换命令已执行，但当前预设状态没有刷新到目标项"
      });
    }

    return snapshot;
  }

  readPresetRuntimeConfig(app: ModelSwitchAppId, presetId: string): ModelPresetRuntimeConfigDto | null {
    const metadata = APP_METADATA[app];
    const normalizedPresetId = presetId.trim();

    if (!normalizedPresetId) {
      return null;
    }

    const row = this.readProviderRows(metadata.dbTypes).find((item) => item.id === normalizedPresetId);

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: normalizeText(row.name) ?? row.id,
      app,
      settingsConfig: safeParseJson(row.settings_config) ?? {}
    };
  }

  private resolveCommandPath(): string | null {
    return resolveAvailableCommandPath(this.options.commandPath, [this.options.commandPath]);
  }

  private readProviderRows(appTypes: string[]): ProviderRow[] {
    const db = new Database(this.options.dbPath, {
      readonly: true,
      fileMustExist: true
    });

    try {
      const placeholders = appTypes.map(() => "?").join(", ");
      return db
        .prepare(
          `SELECT id, name, settings_config, is_current
           FROM providers
           WHERE app_type IN (${placeholders})
           ORDER BY
             CASE WHEN sort_index IS NULL THEN 1 ELSE 0 END,
             sort_index ASC,
             created_at ASC,
             name COLLATE NOCASE ASC`
        )
        .all(...appTypes) as ProviderRow[];
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : "cc-switch 数据库读取失败"
      );
    } finally {
      db.close();
    }
  }

  private async runSwitchCommand(commandPath: string, cliApp: string, presetId: string): Promise<void> {
    const launch = resolveCommandLaunch(commandPath, ["provider", "switch", "-a", cliApp, presetId]);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(launch.command, launch.args, {
        cwd: process.cwd(),
        env: process.env,
        shell: launch.shell,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      const output = createBoundedOutputCollector();
      let settled = false;
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, this.timeoutMs);

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        callback();
      };

      child.stdout.on("data", (chunk) => {
        output.push(String(chunk));
      });
      child.stderr.on("data", (chunk) => {
        output.push(String(chunk));
      });
      child.on("error", (error) => {
        finish(() => {
          reject(
            new AppError({
              statusCode: 502,
              errorCode: "CC_SWITCH_SWITCH_FAILED",
              detail: error.message
            })
          );
        });
      });
      child.on("close", (code, signal) => {
        if (code === 0) {
          finish(resolve);
          return;
        }

        const detail = output.read().trim();
        const suffix = signal ? `signal=${signal}` : `exitCode=${code ?? "null"}`;

        finish(() => {
          reject(
            new AppError({
              statusCode: 502,
              errorCode: "CC_SWITCH_SWITCH_FAILED",
              detail:
                detail.length > 0
                  ? `${detail}\n${suffix}`
                  : `cc-switch 执行失败，${suffix}`
            })
          );
        });
      });
    });
  }
}

function normalizeProviderOption(
  app: ModelSwitchAppId,
  row: ProviderRow
): ModelPresetOptionDto {
  return {
    id: row.id,
    name: normalizeText(row.name) ?? row.id,
    model: extractModelId(app, row.settings_config),
    summary: null,
    isCurrent: Boolean(row.is_current)
  };
}

function extractModelId(app: ModelSwitchAppId, settingsConfig: string): string | null {
  const parsed = safeParseJson(settingsConfig);

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  switch (app) {
    case "codex":
      return extractCodexModel(parsed);
    case "claude-code":
      return extractClaudeModel(parsed);
    case "gemini":
      return extractGeminiModel(parsed);
    case "opencode":
      return extractOpenCodeModel(parsed);
    default:
      return null;
  }
}

function extractCodexModel(parsed: Record<string, unknown>): string | null {
  const configText = normalizeText(parsed.config);

  if (!configText) {
    return normalizeText(parsed.model);
  }

  const matched = configText.match(/(?:^|\n)\s*model\s*=\s*["']([^"'\n]+)["']/i);
  return matched?.[1]?.trim() ?? null;
}

function extractClaudeModel(parsed: Record<string, unknown>): string | null {
  const env = asRecord(parsed.env);

  if (!env) {
    return null;
  }

  return (
    normalizeText(env.ANTHROPIC_MODEL)
    ?? collapseClaudeAliasTargets([
      normalizeText(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
      normalizeText(env.ANTHROPIC_DEFAULT_OPUS_MODEL),
      normalizeText(env.ANTHROPIC_DEFAULT_HAIKU_MODEL)
    ])
  );
}

function extractGeminiModel(parsed: Record<string, unknown>): string | null {
  const env = asRecord(parsed.env);

  return (
    normalizeText(parsed.model)
    ?? normalizeText(parsed.defaultModel)
    ?? normalizeText(parsed.selectedModel)
    ?? normalizeText(parsed.modelId)
    ?? normalizeText(env?.GEMINI_MODEL)
    ?? normalizeText(env?.GOOGLE_MODEL)
  );
}

function extractOpenCodeModel(parsed: Record<string, unknown>): string | null {
  return (
    normalizeText(parsed.model)
    ?? normalizeText(asRecord(parsed.config)?.model)
    ?? normalizeText(asRecord(parsed.settings)?.model)
    ?? normalizeText(parsed.defaultModel)
  );
}

function collapseClaudeAliasTargets(values: Array<string | null>): string | null {
  const normalized = values.filter((value): value is string => Boolean(value));

  if (normalized.length === 0) {
    return null;
  }

  return normalized.every((value) => value === normalized[0]) ? normalized[0] : normalized[0];
}

function safeParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function createBoundedOutputCollector(maxLength = 4096): {
  push: (chunk: string) => void;
  read: () => string;
} {
  let content = "";

  return {
    push(chunk: string) {
      content += chunk;

      if (content.length > maxLength) {
        content = content.slice(content.length - maxLength);
      }
    },
    read() {
      return content;
    }
  };
}

function buildCcSwitchCliMissingMessage(): string {
  return `当前机器未安装 cc-switch-cli。这里集成的是 CC-Switch 的衍生 CLI 版本，不是 CC-Switch UI 版本。请先安装：${CC_SWITCH_CLI_REPO_URL}`;
}
