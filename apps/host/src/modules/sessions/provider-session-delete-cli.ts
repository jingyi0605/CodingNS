import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HostConfig } from "../../config/env.js";
import { resolveCommandLaunch } from "../../shared/utils/command-launch.js";

const PROVIDER_DELETE_OUTPUT_LIMIT = 16 * 1024;

export interface ProviderSessionDeleteCliInput {
  provider: string;
  providerSessionId: string;
  rawStoreRef: string;
}

export interface ProviderSessionDeleteCli {
  deleteSession(input: ProviderSessionDeleteCliInput): Promise<void>;
}

export class CodingnsProviderSessionDeleteCli implements ProviderSessionDeleteCli {
  private readonly commandPath: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(config: HostConfig) {
    this.commandPath = resolveCodingnsCliPath();
    this.env = buildProviderSessionDeleteEnv(config);
  }

  async deleteSession(input: ProviderSessionDeleteCliInput): Promise<void> {
    const launch = resolveCommandLaunch(this.commandPath, [
      "provider-sessions",
      "delete",
      "--provider",
      input.provider,
      "--provider-session-id",
      input.providerSessionId,
      "--raw-store-ref",
      input.rawStoreRef
    ]);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(launch.command, launch.args, {
        cwd: process.cwd(),
        env: this.env,
        shell: launch.shell,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      const stdout = createBoundedOutputCollector();
      const stderr = createBoundedOutputCollector();
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        callback();
      };

      child.stdout.on("data", (chunk) => {
        stdout.push(String(chunk));
      });
      child.stderr.on("data", (chunk) => {
        stderr.push(String(chunk));
      });
      child.on("error", (error) => {
        finish(() => reject(error));
      });
      child.on("close", (code, signal) => {
        if (code === 0) {
          finish(resolve);
          return;
        }

        const output = stderr.read().trim() || stdout.read().trim();
        const suffix = signal ? `signal=${signal}` : `exitCode=${code ?? "null"}`;

        finish(() => {
          reject(normalizeProviderDeleteCliError(output, suffix));
        });
      });
    });
  }
}

function resolveCodingnsCliPath(): string {
  const configuredPath = process.env.CODINGNS_CLI_PATH?.trim();

  if (configuredPath) {
    return configuredPath;
  }

  let currentDir = path.dirname(fileURLToPath(import.meta.url));

  while (true) {
    const directCandidate = path.join(currentDir, "bin", "codingns.mjs");

    if (existsSync(directCandidate)) {
      return directCandidate;
    }

    const workspaceCandidate = path.join(
      currentDir,
      "packages",
      "codingns",
      "bin",
      "codingns.mjs"
    );

    if (existsSync(workspaceCandidate)) {
      return workspaceCandidate;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return "codingns";
}

function buildProviderSessionDeleteEnv(config: HostConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CODINGNS_CLAUDE_CODE_HOME: config.claudeCodeHomeDir,
    CODINGNS_LEGNA_CODE_HOME: config.legnaCodeHomeDir,
    CODINGNS_LEGNA_COMMAND: config.legnaCodeCliPath,
    CODINGNS_CODEX_HOME: config.codexHomeDir,
    CODINGNS_GEMINI_HOME: config.geminiHomeDir,
    CODINGNS_GEMINI_COMMAND: config.geminiCliPath,
    CODINGNS_KIMI_HOME: config.kimiHomeDir,
    CODINGNS_KIMI_COMMAND: config.kimiCliPath,
    CODINGNS_KIMI_CONFIG_PATH: config.kimiConfigPath,
    CODINGNS_KIMI_DEFAULT_MODEL: config.kimiDefaultModel ?? "",
    CODINGNS_OPENCODE_BASE_URL: config.opencodeBaseUrl,
    CODINGNS_OPENCODE_DATA_DIR: config.opencodeDataDir,
    CODINGNS_OPENCODE_DB_PATH: config.opencodeDbPath,
    CODINGNS_OPENCODE_COMMAND: config.opencodeCliPath
  };
}

function normalizeProviderDeleteCliError(output: string, fallbackDetail: string): Error {
  const parsed = tryParseJson(output);
  const errorCode =
    parsed && typeof parsed.errorCode === "string" && parsed.errorCode.trim().length > 0
      ? parsed.errorCode.trim()
      : null;
  const detail =
    parsed && typeof parsed.detail === "string" && parsed.detail.trim().length > 0
      ? parsed.detail.trim()
      : output.trim();

  return new Error(errorCode || detail || fallbackDetail);
}

function tryParseJson(input: string): Record<string, unknown> | null {
  if (!input.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(input) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function createBoundedOutputCollector(): {
  push(chunk: string): void;
  read(): string;
} {
  let content = "";

  return {
    push(chunk: string) {
      if (!chunk) {
        return;
      }

      content = `${content}${chunk}`;

      if (content.length > PROVIDER_DELETE_OUTPUT_LIMIT) {
        content = content.slice(content.length - PROVIDER_DELETE_OUTPUT_LIMIT);
      }
    },
    read() {
      return content;
    }
  };
}
