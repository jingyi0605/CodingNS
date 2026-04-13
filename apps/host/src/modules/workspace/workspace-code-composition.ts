import fs from "node:fs";
import path from "node:path";

import type { WorkspaceCodeCompositionSummary } from "./workspace-service.js";

const WORKSPACE_CODE_SCAN_LIMIT = 20_000;
const IGNORED_COMPOSITION_DIRECTORIES = new Set([
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

const COMPOSITION_TYPE_BY_NAME: Record<string, string> = {
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  justfile: "Justfile"
};

const COMPOSITION_TYPE_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".css": "CSS",
  ".scss": "SCSS",
  ".sass": "Sass",
  ".less": "Less",
  ".html": "HTML",
  ".xml": "XML",
  ".json": "JSON",
  ".jsonc": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".toml": "TOML",
  ".md": "Markdown",
  ".mdx": "Markdown",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".ps1": "PowerShell",
  ".bat": "Batch",
  ".cmd": "Batch",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".swift": "Swift",
  ".php": "PHP",
  ".rb": "Ruby",
  ".sql": "SQL",
  ".c": "C",
  ".h": "C/C++ Header",
  ".cc": "C++",
  ".cpp": "C++",
  ".cxx": "C++",
  ".hpp": "C++ Header",
  ".cs": "C#"
};

export function readWorkspaceCodeComposition(workspacePath: string): WorkspaceCodeCompositionSummary {
  const resolvedPath = path.resolve(workspacePath);

  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    return {
      scannedFileCount: 0,
      truncated: false,
      items: [],
      error: "工作区路径不存在，无法统计代码类型"
    };
  }

  const typeCounts = new Map<string, number>();
  const directories = [resolvedPath];
  let scannedFileCount = 0;
  let truncated = false;

  while (directories.length > 0 && !truncated) {
    const currentDirectory = directories.pop();

    if (!currentDirectory) {
      continue;
    }

    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_COMPOSITION_DIRECTORIES.has(entry.name)) {
          directories.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const detectedType = detectWorkspaceFileType(entry.name);

      if (!detectedType) {
        continue;
      }

      scannedFileCount += 1;
      typeCounts.set(detectedType, (typeCounts.get(detectedType) ?? 0) + 1);

      if (scannedFileCount >= WORKSPACE_CODE_SCAN_LIMIT) {
        truncated = true;
        break;
      }
    }
  }

  const items = [...typeCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([type, count]) => ({
      type,
      count,
      ratio: scannedFileCount > 0 ? Number((count / scannedFileCount).toFixed(4)) : 0
    }));

  return {
    scannedFileCount,
    truncated,
    items,
    error: null
  };
}

function detectWorkspaceFileType(fileName: string): string | null {
  const normalizedName = fileName.trim().toLowerCase();

  if (!normalizedName) {
    return null;
  }

  const byName = COMPOSITION_TYPE_BY_NAME[normalizedName];

  if (byName) {
    return byName;
  }

  return COMPOSITION_TYPE_BY_EXTENSION[path.extname(normalizedName)] ?? null;
}
