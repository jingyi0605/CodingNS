import fs from "node:fs";
import path from "node:path";

import type { FileNode } from "../../types/domain.js";
import { DEFAULT_TREE_LIMIT } from "./file-constants.js";
import type { FileAccessGuard } from "./file-access-guard.js";

export class FileTreeService {
  constructor(private readonly fileAccessGuard: FileAccessGuard) {}

  list(workspaceId: string, requestedPath: string | undefined, limit = DEFAULT_TREE_LIMIT): FileNode[] {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      allowRoot: true,
      mustExist: true,
      kind: "directory"
    });

    return fs
      .readdirSync(resolved.absolutePath, {
        withFileTypes: true
      })
      .filter((entry) => !entry.isSymbolicLink())
      .slice(0, limit)
      .map((entry) => {
        const childAbsolutePath = path.join(resolved.absolutePath, entry.name);
        const childStats = fs.statSync(childAbsolutePath);
        const childRelativePath = resolved.relativePath
          ? `${resolved.relativePath}/${entry.name}`
          : entry.name;

        return {
          path: childRelativePath.replace(/\\/g, "/"),
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
          size: entry.isDirectory() ? null : childStats.size,
          updatedAt: childStats.mtime.toISOString()
        } satisfies FileNode;
      })
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });
  }
}
