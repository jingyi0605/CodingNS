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
    const projectsRoot = join(homeDir, "projects");
    const exactProjectDir = join(projectsRoot, workspaceSlug(workspacePath));
    const files = new Set<string>();

    if (existsSync(exactProjectDir)) {
      for (const filePath of walkJsonlFiles(exactProjectDir)) {
        files.add(filePath);
      }
    }

    // Claude CLI 对非 ASCII 工作区路径会使用自己的目录命名规则。
    // 如果我们只扫自己算出的 exact 目录，中文路径下会被一个空的占位目录挡住，
    // 真实 transcript 反而永远发现不到。
    for (const filePath of walkJsonlFiles(projectsRoot)) {
      files.add(filePath);
    }

    return Array.from(files);
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
    const candidates = new Set<string>();

    if (existsSync(exactCandidate)) {
      candidates.add(exactCandidate);
    }

    for (const filePath of collectSessionFileCandidates([join(homeDir, "projects")], sessionId)) {
      candidates.add(filePath);
    }

    return selectBestSessionFile(Array.from(candidates));
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
  return selectBestSessionFile(collectSessionFileCandidates(projectRoots, sessionId));
}

function collectSessionFileCandidates(
  projectRoots: readonly string[],
  sessionId: string
): string[] {
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

  return Array.from(candidates);
}

function selectBestSessionFile(candidates: readonly string[]): string | null {
  if (candidates.length === 0) {
    return null;
  }

  const existingCandidates = Array.from(new Set(candidates))
    .filter((filePath) => existsSync(filePath));
  const nonEmptyCandidates = existingCandidates.filter((filePath) => statSync(filePath).size > 0);
  const sortableCandidates = nonEmptyCandidates.length > 0 ? nonEmptyCandidates : existingCandidates;

  if (sortableCandidates.length === 0) {
    return null;
  }

  const sortedCandidates = sortableCandidates.sort((left, right) =>
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
