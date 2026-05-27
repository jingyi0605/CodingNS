import fs from "node:fs";
import path from "node:path";

import type { FileAccessGuard } from "./file-access-guard.js";

export interface RecentModifiedFileRecord {
  path: string;
  name: string;
  updatedAt: string;
  size: number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".idea",
  ".vscode",
  ".yarn",
  ".pnpm-store",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  "out",
  "target",
  "vendor",
  "bin",
  "obj"
]);

export class RecentModifiedFileService {
  constructor(private readonly fileAccessGuard: FileAccessGuard) {}

  list(workspaceId: string, input?: { limit?: number; keyword?: string | null }): RecentModifiedFileRecord[] {
    const root = this.fileAccessGuard.resolvePath(workspaceId, "", {
      allowRoot: true,
      mustExist: true,
      kind: "directory"
    });
    const safeLimit = Number.isFinite(input?.limit) ? Math.min(Math.max(Math.floor(input!.limit!), 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const normalizedKeyword = input?.keyword?.trim().toLowerCase() ?? "";
    const matches: RecentModifiedFileRecord[] = [];
    const pendingDirectories = [{ absolutePath: root.absolutePath, relativePath: root.relativePath }];

    while (pendingDirectories.length > 0) {
      const current = pendingDirectories.pop();

      if (!current) {
        continue;
      }

      let entries: fs.Dirent[] = [];

      try {
        entries = fs.readdirSync(current.absolutePath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          continue;
        }

        const nextRelativePath = current.relativePath
          ? `${current.relativePath}/${entry.name}`
          : entry.name;
        const nextAbsolutePath = path.join(current.absolutePath, entry.name);

        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) {
            pendingDirectories.push({
              absolutePath: nextAbsolutePath,
              relativePath: nextRelativePath
            });
          }
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        let stats: fs.Stats;

        try {
          stats = fs.statSync(nextAbsolutePath);
        } catch {
          continue;
        }

        const normalizedPath = nextRelativePath.replace(/\\/g, "/");

        if (
          normalizedKeyword.length > 0
          && !entry.name.toLowerCase().includes(normalizedKeyword)
          && !normalizedPath.toLowerCase().includes(normalizedKeyword)
        ) {
          continue;
        }

        matches.push({
          path: normalizedPath,
          name: entry.name,
          updatedAt: stats.mtime.toISOString(),
          size: stats.size
        });
      }
    }

    matches.sort((left, right) => {
      const timeDiff = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);

      if (timeDiff !== 0) {
        return timeDiff;
      }

      return left.path.localeCompare(right.path);
    });

    return matches.slice(0, safeLimit);
  }
}
