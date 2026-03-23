import fs from "node:fs";
import path from "node:path";

import type { FileSearchItem } from "../../types/domain.js";
import {
  DEFAULT_SEARCH_PAGE,
  DEFAULT_SEARCH_PAGE_SIZE,
  MAX_SEARCH_PAGE_SIZE
} from "./file-constants.js";
import type { FileAccessGuard } from "./file-access-guard.js";

export interface FileSearchResult {
  items: FileSearchItem[];
  total: number;
  page: number;
  pageSize: number;
}

export class FileSearchService {
  constructor(private readonly fileAccessGuard: FileAccessGuard) {}

  search(
    workspaceId: string,
    keyword: string,
    page = DEFAULT_SEARCH_PAGE,
    pageSize = DEFAULT_SEARCH_PAGE_SIZE
  ): FileSearchResult {
    const safeKeyword = keyword.trim().toLowerCase();
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : DEFAULT_SEARCH_PAGE;
    const safePageSize =
      Number.isFinite(pageSize) && pageSize > 0
        ? Math.min(Math.floor(pageSize), MAX_SEARCH_PAGE_SIZE)
        : DEFAULT_SEARCH_PAGE_SIZE;
    const root = this.fileAccessGuard.resolvePath(workspaceId, "", {
      allowRoot: true,
      mustExist: true,
      kind: "directory"
    });
    const allMatches: FileSearchItem[] = [];
    const pendingDirectories = [{ absolutePath: root.absolutePath, relativePath: root.relativePath }];

    while (pendingDirectories.length > 0) {
      const current = pendingDirectories.pop()!;
      const entries = fs.readdirSync(current.absolutePath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          continue;
        }

        const nextRelativePath = current.relativePath
          ? `${current.relativePath}/${entry.name}`
          : entry.name;
        const nextAbsolutePath = path.join(current.absolutePath, entry.name);
        const stats = fs.statSync(nextAbsolutePath);

        if (nextRelativePath.toLowerCase().includes(safeKeyword)) {
          allMatches.push({
            path: nextRelativePath.replace(/\\/g, "/"),
            name: entry.name,
            kind: entry.isDirectory() ? "directory" : "file",
            size: entry.isDirectory() ? null : stats.size,
            updatedAt: stats.mtime.toISOString()
          });
        }

        if (entry.isDirectory()) {
          pendingDirectories.push({
            absolutePath: nextAbsolutePath,
            relativePath: nextRelativePath
          });
        }
      }
    }

    allMatches.sort((left, right) => left.path.localeCompare(right.path));

    const startIndex = (safePage - 1) * safePageSize;
    const endIndex = startIndex + safePageSize;

    return {
      items: allMatches.slice(startIndex, endIndex),
      total: allMatches.length,
      page: safePage,
      pageSize: safePageSize
    };
  }
}
