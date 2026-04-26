import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import type { HostConfig } from "../../config/env.js";

export type ClaudeCompatibleProviderId = "claude-code" | "legna-code";

interface ClaudeCompatibleProviderDefinition {
  provider: ClaudeCompatibleProviderId;
  sessionTitlePrefix: string;
  buildBridgeUrl(config: HostConfig): string;
  buildRawStoreRef(config: HostConfig, workspacePath: string, sessionId: string): string;
  findSessionFile(config: HostConfig, workspacePath: string, sessionId: string): string | null;
}

const CLAUDE_COMPATIBLE_PROVIDER_DEFINITIONS: Record<
  ClaudeCompatibleProviderId,
  ClaudeCompatibleProviderDefinition
> = {
  "claude-code": {
    provider: "claude-code",
    sessionTitlePrefix: "Claude 会话",
    buildBridgeUrl(config) {
      return `http://127.0.0.1:${config.port}/api/providers/claude-code/hook-bridge/events`;
    },
    buildRawStoreRef(config, workspacePath, sessionId) {
      return path.join(
        config.claudeCodeHomeDir,
        "projects",
        workspaceSlug(workspacePath),
        `${sessionId}.jsonl`
      );
    },
    findSessionFile(config, workspacePath, sessionId) {
      const exactCandidate = path.join(
        config.claudeCodeHomeDir,
        "projects",
        workspaceSlug(workspacePath),
        `${sessionId}.jsonl`
      );

      if (existsSync(exactCandidate)) {
        return exactCandidate;
      }

      return findSessionFileInProjectRoots(
        [path.join(config.claudeCodeHomeDir, "projects")],
        sessionId
      );
    }
  },
  "legna-code": {
    provider: "legna-code",
    sessionTitlePrefix: "Legna 会话",
    buildBridgeUrl(config) {
      return `http://127.0.0.1:${config.port}/api/providers/legna-code/hook-bridge/events`;
    },
    buildRawStoreRef(_config, workspacePath, sessionId) {
      return path.join(workspacePath, ".legna", "sessions", `${sessionId}.jsonl`);
    },
    findSessionFile(config, workspacePath, sessionId) {
      const candidates = [
        path.join(workspacePath, ".legna", "sessions", `${sessionId}.jsonl`),
        path.join(config.legnaCodeHomeDir, "projects", workspaceSlug(workspacePath), `${sessionId}.jsonl`),
        path.join(config.claudeCodeHomeDir, "projects", workspaceSlug(workspacePath), `${sessionId}.jsonl`)
      ];

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }

      return findSessionFileInProjectRoots(
        [
          path.join(config.legnaCodeHomeDir, "projects"),
          path.join(config.claudeCodeHomeDir, "projects")
        ],
        sessionId
      );
    }
  }
};

export function isClaudeCompatibleProvider(
  provider: string | null | undefined
): provider is ClaudeCompatibleProviderId {
  return provider === "claude-code" || provider === "legna-code";
}

export function getClaudeCompatibleProviderDefinition(
  provider: ClaudeCompatibleProviderId
): ClaudeCompatibleProviderDefinition {
  return CLAUDE_COMPATIBLE_PROVIDER_DEFINITIONS[provider];
}

export function buildClaudeCompatibleRawStoreRef(
  config: HostConfig,
  provider: ClaudeCompatibleProviderId,
  workspacePath: string,
  sessionId: string
): string {
  return getClaudeCompatibleProviderDefinition(provider).buildRawStoreRef(
    config,
    workspacePath,
    sessionId
  );
}

export function findClaudeCompatibleSessionFile(
  config: HostConfig,
  provider: ClaudeCompatibleProviderId,
  workspacePath: string,
  sessionId: string
): string | null {
  return getClaudeCompatibleProviderDefinition(provider).findSessionFile(
    config,
    workspacePath,
    sessionId
  );
}

export function buildClaudeCompatibleHookBridgeUrl(
  config: HostConfig,
  provider: ClaudeCompatibleProviderId
): string {
  return getClaudeCompatibleProviderDefinition(provider).buildBridgeUrl(config);
}

export function buildClaudeCompatibleSessionTitle(
  provider: ClaudeCompatibleProviderId,
  providerSessionId: string
): string {
  const prefix = getClaudeCompatibleProviderDefinition(provider).sessionTitlePrefix;
  return `${prefix} ${providerSessionId.slice(0, 8)}`;
}

function findSessionFileInProjectRoots(
  projectRoots: readonly string[],
  sessionId: string
): string | null {
  const candidates = new Set<string>();

  for (const projectRoot of projectRoots) {
    if (!projectRoot || !existsSync(projectRoot)) {
      continue;
    }

    const entries = readdirSync(projectRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(projectRoot, entry.name, `${sessionId}.jsonl`))
      .filter((candidate) => existsSync(candidate));

    for (const candidate of entries) {
      candidates.add(candidate);
    }
  }

  return Array.from(candidates)[0] ?? null;
}

function workspaceSlug(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, "");
  const normalizedDriveLetter = trimmed.replace(/^[A-Z](?=:)/, (value) => value.toLowerCase());

  return normalizedDriveLetter
    .replaceAll(":", "-")
    .replaceAll("\\", "-")
    .replaceAll("/", "-");
}
