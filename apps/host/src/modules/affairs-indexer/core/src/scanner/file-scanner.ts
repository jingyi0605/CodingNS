import fs from "node:fs";
import path from "node:path";
import { throwIfAborted } from "../utils/abort.js";

export interface FileScanResult {
  relativePath: string;
  fullPath: string;
  name: string;
  extension: string;
  size: number;
  mtime: string;
  ctime: string;
  inodeKey?: string | null;
}

const SUPPORTED_INDEX_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".rtf",
  ".html",
  ".htm",
  ".xml",
  ".json",
  ".yaml",
  ".yml",
  ".tsv",
  ".pdf",
  ".doc",
  ".docx",
  ".odt",
  ".wps",
  ".ppt",
  ".pptx",
  ".odp",
  ".key",
  ".xlsx",
  ".xls",
  ".ods",
  ".et",
  ".numbers",
  ".csv",
]);

export const SUPPORTED_INDEX_EXTENSION_LIST = [...SUPPORTED_INDEX_EXTENSIONS].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

const IGNORED_DIRECTORY_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".ai-index",
  ".git",
  ".svn",
  ".hg",
  ".next",
  ".nuxt",
  ".vite",
  ".cache",
  "__pycache__",
  "venv",
  ".venv",
]);

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function normalizeHiddenPathCandidate(input: string): string | null {
  const normalized = input.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    return null;
  }

  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  const resolved = path.posix.normalize(segments.join("/")).replace(/^\/+|\/+$/g, "");
  if (!resolved || resolved === "." || resolved === ".." || resolved.startsWith("../")) {
    return null;
  }
  return resolved;
}

export function hasHiddenPathSegment(relativePath: string): boolean {
  return normalizeHiddenPathCandidate(relativePath)
    ?.split("/")
    .some((segment) => segment.startsWith(".")) ?? false;
}

export function normalizeIncludedHiddenPaths(input: readonly string[]): string[] {
  const values = new Set<string>();
  for (const item of input) {
    const normalized = normalizeHiddenPathCandidate(String(item ?? ""));
    if (!normalized) {
      continue;
    }
    if (!hasHiddenPathSegment(normalized)) {
      continue;
    }
    if (normalized === ".ai-index" || normalized.startsWith(".ai-index/")) {
      continue;
    }
    values.add(normalized);
  }
  return [...values].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

export function isIncludedHiddenPath(relativePath: string, includedHiddenPaths: readonly string[]): boolean {
  const normalizedRelativePath = normalizeHiddenPathCandidate(relativePath);
  if (!normalizedRelativePath || !hasHiddenPathSegment(normalizedRelativePath)) {
    return false;
  }

  const normalizedIncludedPaths = normalizeIncludedHiddenPaths(includedHiddenPaths);
  return normalizedIncludedPaths.some(
    (includedPath) =>
      normalizedRelativePath === includedPath
      || normalizedRelativePath.startsWith(`${includedPath}/`)
  );
}

/**
 * 文件扫描器。
 * 第二阶段改成显式迭代器遍历，避免大目录下先把整棵树一次性塞进内存。
 */
export class FileScanner {
  private readonly allowedExtensions: Set<string> | null;
  private readonly includedHiddenPaths: string[];

  constructor(
    private readonly rootDir: string,
    options: {
      allowedExtensions?: string[];
      includedHiddenPaths?: string[];
    } = {},
  ) {
    const normalizedExtensions = (options.allowedExtensions ?? [])
      .map(item => item.trim().toLowerCase())
      .filter(Boolean);
    this.allowedExtensions = normalizedExtensions.length > 0 ? new Set(normalizedExtensions) : null;
    this.includedHiddenPaths = normalizeIncludedHiddenPaths(options.includedHiddenPaths ?? []);
  }

  private isIndexableExtension(extension: string): boolean {
    if (!SUPPORTED_INDEX_EXTENSIONS.has(extension)) {
      return false;
    }
    if (!this.allowedExtensions) {
      return true;
    }
    return this.allowedExtensions.has(extension);
  }

  scan(targetPath?: string, signal?: AbortSignal): FileScanResult[] {
    return [...this.scanIterator(targetPath, signal)];
  }

  *scanIterator(targetPath?: string, signal?: AbortSignal): Generator<FileScanResult> {
    const base = targetPath ? path.resolve(this.rootDir, targetPath) : this.rootDir;
    if (!fs.existsSync(base)) {
      return;
    }

    const stack: string[] = [base];
    while (stack.length > 0) {
      throwIfAborted(signal, "事务文档库扫描已取消");
      const currentPath = stack.pop();
      if (!currentPath || !fs.existsSync(currentPath)) {
        continue;
      }

      throwIfAborted(signal, "事务文档库扫描已取消");
      const stat = fs.statSync(currentPath);
      if (stat.isFile()) {
        const item = this.scanFile(currentPath, stat);
        if (item) {
          yield item;
        }
        continue;
      }

      if (!stat.isDirectory()) {
        continue;
      }

      throwIfAborted(signal, "事务文档库扫描已取消");
      const entries = fs.readdirSync(currentPath, { withFileTypes: true })
        .filter(entry => {
          if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
            return false;
          }
          const relativeEntryPath = normalizeRelativePath(path.relative(this.rootDir, path.join(currentPath, entry.name)));
          if (!entry.name.startsWith(".")) {
            return true;
          }
          return isIncludedHiddenPath(relativeEntryPath, this.includedHiddenPaths);
        })
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

      for (let index = entries.length - 1; index >= 0; index -= 1) {
        stack.push(path.join(currentPath, entries[index].name));
      }
    }
  }

  scanFile(filePath: string, existingStat?: fs.Stats): FileScanResult | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stat = existingStat ?? fs.statSync(filePath);
    if (!stat.isFile()) {
      return null;
    }

    const extension = path.extname(filePath).toLowerCase();
    if (!this.isIndexableExtension(extension)) {
      return null;
    }

    const relativePath = normalizeRelativePath(path.relative(this.rootDir, filePath));
    if (hasHiddenPathSegment(relativePath) && !isIncludedHiddenPath(relativePath, this.includedHiddenPaths)) {
      return null;
    }
    return {
      relativePath,
      fullPath: filePath,
      name: path.basename(filePath),
      extension,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      ctime: stat.ctime.toISOString(),
      inodeKey: buildInodeKey(stat),
    };
  }
}

function buildInodeKey(stat: fs.Stats): string | null {
  const dev = Number(stat.dev);
  const ino = Number(stat.ino);
  if (!Number.isFinite(dev) || !Number.isFinite(ino) || dev < 0 || ino <= 0) {
    return null;
  }
  return `${dev}:${ino}`;
}
