import fs from "node:fs";
import path from "node:path";

export interface FileScanResult {
  relativePath: string;
  fullPath: string;
  name: string;
  extension: string;
  size: number;
  mtime: string;
  ctime: string;
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

/**
 * 文件扫描器。
 * 第二阶段改成显式迭代器遍历，避免大目录下先把整棵树一次性塞进内存。
 */
export class FileScanner {
  private readonly allowedExtensions: Set<string> | null;

  constructor(
    private readonly rootDir: string,
    options: {
      allowedExtensions?: string[];
    } = {},
  ) {
    const normalizedExtensions = (options.allowedExtensions ?? [])
      .map(item => item.trim().toLowerCase())
      .filter(Boolean);
    this.allowedExtensions = normalizedExtensions.length > 0 ? new Set(normalizedExtensions) : null;
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

  scan(targetPath?: string): FileScanResult[] {
    return [...this.scanIterator(targetPath)];
  }

  *scanIterator(targetPath?: string): Generator<FileScanResult> {
    const base = targetPath ? path.resolve(this.rootDir, targetPath) : this.rootDir;
    if (!fs.existsSync(base)) {
      return;
    }

    const stack: string[] = [base];
    while (stack.length > 0) {
      const currentPath = stack.pop();
      if (!currentPath || !fs.existsSync(currentPath)) {
        continue;
      }

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

      const entries = fs.readdirSync(currentPath, { withFileTypes: true })
        .filter(entry => {
          if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
            return false;
          }
          if (entry.isDirectory()) {
            return !entry.name.startsWith(".");
          }
          return !entry.name.startsWith(".");
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
    return {
      relativePath,
      fullPath: filePath,
      name: path.basename(filePath),
      extension,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      ctime: stat.ctime.toISOString(),
    };
  }
}
