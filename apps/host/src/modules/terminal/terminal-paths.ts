import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";

export function resolveWorkspaceCwd(workspacePath: string, cwd?: string | null): string {
  const candidate = cwd?.trim() ? cwd.trim() : workspacePath;
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedCandidate = path.resolve(candidate);

  if (!isPathInsideWorkspace(resolvedWorkspace, resolvedCandidate)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_CWD",
      detail: "cwd 必须位于工作区目录内",
      field: "cwd"
    });
  }

  return resolvedCandidate;
}

function isPathInsideWorkspace(workspacePath: string, candidatePath: string): boolean {
  const normalizedWorkspace = normalizePathForCompare(workspacePath);
  const normalizedCandidate = normalizePathForCompare(candidatePath);
  const relativePath = path.relative(normalizedWorkspace, normalizedCandidate);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function normalizePathForCompare(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
