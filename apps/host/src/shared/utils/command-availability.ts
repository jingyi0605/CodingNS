import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";

const SCRIPT_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);

export function isCommandAvailable(commandPath: string | null | undefined): boolean {
  const normalizedCommandPath = stripWrappingQuotes(commandPath ?? "");

  if (!normalizedCommandPath) {
    return false;
  }

  if (isPathLikeCommand(normalizedCommandPath)) {
    return canExecuteResolvedPath(normalizedCommandPath);
  }

  return resolveExecutableOnPath(normalizedCommandPath) !== null;
}

function isPathLikeCommand(commandPath: string): boolean {
  return path.isAbsolute(commandPath) || commandPath.includes("/") || commandPath.includes("\\");
}

function canExecuteResolvedPath(commandPath: string): boolean {
  if (!existsSync(commandPath)) {
    return false;
  }

  const extension = path.extname(commandPath).toLowerCase();

  // JS 脚本最终会通过 node 启动，存在即可视为可用。
  if (SCRIPT_EXTENSIONS.has(extension)) {
    return true;
  }

  if (process.platform === "win32") {
    return true;
  }

  try {
    accessSync(commandPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutableOnPath(executableName: string): string | null {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (process.platform === "win32") {
    const pathextEntries = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
      .split(";")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const candidateNames = path.extname(executableName)
      ? [executableName]
      : pathextEntries.map((extension) => `${executableName}${extension.toLowerCase()}`);

    for (const entry of pathEntries) {
      for (const candidateName of candidateNames) {
        const candidatePath = path.join(entry, candidateName);

        if (existsSync(candidatePath)) {
          return candidatePath;
        }
      }
    }

    return null;
  }

  for (const entry of pathEntries) {
    const candidatePath = path.join(entry, executableName);

    if (!existsSync(candidatePath)) {
      continue;
    }

    try {
      accessSync(candidatePath, constants.X_OK);
      return candidatePath;
    } catch {
      continue;
    }
  }

  return null;
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}
