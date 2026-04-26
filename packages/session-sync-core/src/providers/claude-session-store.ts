import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { walkJsonlFiles, workspaceSlug } from "./utils.js";

export interface ClaudeSessionStoreProfile {
  resolveWorkspaceFiles(homeDir: string, workspacePath: string): string[];
  resolveSessionFilePath(homeDir: string, workspacePath: string, sessionId: string): string;
  resolvePendingSessionFilePath(homeDir: string, workspacePath: string, sessionId: string): string;
  findSessionFile(homeDir: string, workspacePath: string, sessionId: string): string | null;
}

export interface LegnaSessionStoreProfileOptions {
  legacyClaudeHomeDir?: string | null;
}

export const CLAUDE_CODE_SESSION_STORE_PROFILE: ClaudeSessionStoreProfile = {
  resolveWorkspaceFiles(homeDir, workspacePath) {
    const exactProjectDir = join(homeDir, "projects", workspaceSlug(workspacePath));

    if (existsSync(exactProjectDir)) {
      return walkJsonlFiles(exactProjectDir);
    }

    return walkJsonlFiles(join(homeDir, "projects"));
  },
  resolveSessionFilePath(homeDir, workspacePath, sessionId) {
    return join(homeDir, "projects", workspaceSlug(workspacePath), `${sessionId}.jsonl`);
  },
  resolvePendingSessionFilePath(homeDir, workspacePath, sessionId) {
    return join(homeDir, "projects", workspaceSlug(workspacePath), `.pending-${sessionId}.jsonl`);
  },
  findSessionFile(homeDir, workspacePath, sessionId) {
    const exactCandidate = join(
      homeDir,
      "projects",
      workspaceSlug(workspacePath),
      `${sessionId}.jsonl`
    );

    if (existsSync(exactCandidate)) {
      return exactCandidate;
    }

    return findSessionFileInProjectsRoots([join(homeDir, "projects")], sessionId);
  }
};

export function createLegnaSessionStoreProfile(
  options: LegnaSessionStoreProfileOptions = {}
): ClaudeSessionStoreProfile {
  const legacyClaudeProjectsDir =
    options.legacyClaudeHomeDir?.trim()
      ? join(options.legacyClaudeHomeDir.trim(), "projects")
      : join(homedir(), ".claude", "projects");

  return {
    resolveWorkspaceFiles(homeDir, workspacePath) {
      const exactRoots = [
        join(workspacePath, ".legna", "sessions"),
        join(homeDir, "projects", workspaceSlug(workspacePath)),
        join(legacyClaudeProjectsDir, workspaceSlug(workspacePath))
      ];
      const exactFiles = collectJsonlFiles(exactRoots);

      if (exactFiles.length > 0) {
        return exactFiles;
      }

      return collectJsonlFiles([join(homeDir, "projects"), legacyClaudeProjectsDir]);
    },
    resolveSessionFilePath(_homeDir, workspacePath, sessionId) {
      return join(workspacePath, ".legna", "sessions", `${sessionId}.jsonl`);
    },
    resolvePendingSessionFilePath(_homeDir, workspacePath, sessionId) {
      return join(workspacePath, ".legna", "sessions", `.pending-${sessionId}.jsonl`);
    },
    findSessionFile(homeDir, workspacePath, sessionId) {
      const directCandidates = [
        join(workspacePath, ".legna", "sessions", `${sessionId}.jsonl`),
        join(homeDir, "projects", workspaceSlug(workspacePath), `${sessionId}.jsonl`),
        join(legacyClaudeProjectsDir, workspaceSlug(workspacePath), `${sessionId}.jsonl`)
      ].filter((candidate, index, array) => array.indexOf(candidate) === index);

      for (const candidate of directCandidates) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }

      return findSessionFileInProjectsRoots(
        [join(homeDir, "projects"), legacyClaudeProjectsDir],
        sessionId
      );
    }
  };
}

function collectJsonlFiles(roots: readonly string[]): string[] {
  const uniqueFiles = new Set<string>();

  for (const root of roots) {
    if (!root || !existsSync(root)) {
      continue;
    }

    for (const filePath of walkJsonlFiles(root)) {
      uniqueFiles.add(filePath);
    }
  }

  return Array.from(uniqueFiles);
}

function findSessionFileInProjectsRoots(
  projectRoots: readonly string[],
  sessionId: string
): string | null {
  const candidates = new Set<string>();

  for (const projectRoot of projectRoots) {
    if (!projectRoot || !existsSync(projectRoot)) {
      continue;
    }

    const projectEntries = readdirSync(projectRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(projectRoot, entry.name, `${sessionId}.jsonl`))
      .filter((filePath) => existsSync(filePath));

    for (const filePath of projectEntries) {
      candidates.add(filePath);
    }
  }

  if (candidates.size === 0) {
    return null;
  }

  const sortedCandidates = Array.from(candidates).sort((left, right) =>
    compareSessionFiles(right, left)
  );

  return sortedCandidates[0] ?? null;
}

function compareSessionFiles(left: string, right: string): number {
  const leftStat = statSync(left);
  const rightStat = statSync(right);

  if (leftStat.size !== rightStat.size) {
    return leftStat.size - rightStat.size;
  }

  return leftStat.mtimeMs - rightStat.mtimeMs;
}
