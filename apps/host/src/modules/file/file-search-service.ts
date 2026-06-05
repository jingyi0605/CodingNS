import fs from "node:fs";
import path from "node:path";

import type { FileSearchItem } from "../../types/domain.js";
import {
  DEFAULT_SEARCH_PAGE,
  DEFAULT_SEARCH_PAGE_SIZE,
  MAX_PREVIEW_FILE_BYTES,
  MAX_SEARCH_PAGE_SIZE
} from "./file-constants.js";
import type { FileAccessGuard } from "./file-access-guard.js";

export interface FileSearchResult {
  items: FileSearchItem[];
  total: number;
  page: number;
  pageSize: number;
}

const CONTENT_TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".config",
  ".env",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".py",
  ".rb",
  ".java",
  ".kt",
  ".kts",
  ".go",
  ".rs",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hpp",
  ".cs",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".proto",
  ".graphql",
  ".vue",
  ".svelte",
  ".dart"
]);

function normalizeKeyword(value: string) {
  return value.trim().toLowerCase();
}

function countKeywordOccurrences(source: string, keyword: string) {
  if (!source || !keyword) {
    return 0;
  }

  let count = 0;
  let startIndex = 0;

  while (startIndex < source.length) {
    const index = source.indexOf(keyword, startIndex);
    if (index < 0) {
      break;
    }
    count += 1;
    startIndex = index + keyword.length;
  }

  return count;
}

function looksLikeTextBuffer(buffer: Buffer) {
  const sampleLength = Math.min(buffer.length, 1024);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return false;
    }
  }
  return true;
}

function shouldAttemptContentSearch(relativePath: string, size: number) {
  if (size <= 0 || size > MAX_PREVIEW_FILE_BYTES) {
    return false;
  }

  const extension = path.extname(relativePath).toLowerCase();
  return CONTENT_TEXT_EXTENSIONS.has(extension);
}

function buildContentSnippet(content: string, normalizedKeyword: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  const maxLines = 2;
  const maxLineLength = 120;
  const truncateLine = (line: string) => {
    if (line.length <= maxLineLength) {
      return line;
    }

    const index = line.toLowerCase().indexOf(normalizedKeyword);
    if (index < 0) {
      return `${line.slice(0, maxLineLength - 1)}…`;
    }

    const preferredStart = Math.max(0, index - 28);
    const start = Math.max(0, Math.min(preferredStart, line.length - maxLineLength));
    const end = Math.min(line.length, start + maxLineLength);
    return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
  };

  const matchedLineIndex = lines.findIndex((line) => line.toLowerCase().includes(normalizedKeyword));
  if (matchedLineIndex >= 0) {
    return lines
      .slice(matchedLineIndex, matchedLineIndex + maxLines)
      .map(truncateLine)
      .join("\n");
  }

  return truncateLine(lines[0] ?? "");
}

function resolveFileSearchScore(
  fileName: string,
  lowerPath: string,
  normalizedKeyword: string,
  pathMatchCount: number,
  contentMatchCount: number
) {
  const lowerName = fileName.toLowerCase();
  let score = pathMatchCount * 10 + contentMatchCount * 6;

  if (lowerName === normalizedKeyword) {
    score += 36;
  } else if (lowerName.startsWith(normalizedKeyword)) {
    score += 24;
  } else if (lowerName.includes(normalizedKeyword)) {
    score += 12;
  }

  if (lowerPath === normalizedKeyword) {
    score += 18;
  } else if (lowerPath.startsWith(normalizedKeyword)) {
    score += 8;
  }

  if (pathMatchCount > 0 && contentMatchCount > 0) {
    score += 6;
  }

  return score;
}

function compareFileSearchItems(left: FileSearchItem, right: FileSearchItem) {
  const leftScore = left.matchScore ?? 0;
  const rightScore = right.matchScore ?? 0;
  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }

  const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : Number.NaN;
  const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : Number.NaN;
  if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  return left.path.localeCompare(right.path, "zh-Hans-CN");
}

export class FileSearchService {
  constructor(private readonly fileAccessGuard: FileAccessGuard) {}

  search(
    workspaceId: string,
    keyword: string,
    page = DEFAULT_SEARCH_PAGE,
    pageSize = DEFAULT_SEARCH_PAGE_SIZE
  ): FileSearchResult {
    const safeKeyword = normalizeKeyword(keyword);
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
        const normalizedPath = nextRelativePath.replace(/\\/g, "/");
        const lowerPath = normalizedPath.toLowerCase();
        const stats = fs.statSync(nextAbsolutePath);
        const pathMatchCount = countKeywordOccurrences(lowerPath, safeKeyword);
        let contentMatchCount = 0;
        let snippet: string | null = null;

        if (entry.isDirectory()) {
          pendingDirectories.push({
            absolutePath: nextAbsolutePath,
            relativePath: nextRelativePath
          });
        } else if (safeKeyword && shouldAttemptContentSearch(normalizedPath, stats.size)) {
          try {
            const buffer = fs.readFileSync(nextAbsolutePath);
            if (looksLikeTextBuffer(buffer)) {
              const content = buffer.toString("utf8");
              const lowerContent = content.toLowerCase();
              contentMatchCount = countKeywordOccurrences(lowerContent, safeKeyword);
              if (contentMatchCount > 0) {
                snippet = buildContentSnippet(content, safeKeyword);
              }
            }
          } catch {
            // 搜索是辅助手段，不因为单个文件读失败就让整批结果报废。
          }
        }

        if (pathMatchCount <= 0 && contentMatchCount <= 0) {
          continue;
        }

        const matchSource =
          pathMatchCount > 0 && contentMatchCount > 0
            ? "path_and_content"
            : pathMatchCount > 0
              ? "path"
              : "content";

        allMatches.push({
          path: normalizedPath,
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
          size: entry.isDirectory() ? null : stats.size,
          updatedAt: stats.mtime.toISOString(),
          matchSource,
          snippet,
          matchScore: resolveFileSearchScore(
            entry.name,
            lowerPath,
            safeKeyword,
            pathMatchCount,
            contentMatchCount
          )
        });
      }
    }

    allMatches.sort(compareFileSearchItems);

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
