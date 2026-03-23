import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";

const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:/;

export function normalizeRelativePath(input: string | undefined, allowRoot = false): string {
  const rawPath = input?.trim() ?? "";

  if (!rawPath) {
    if (allowRoot) {
      return "";
    }

    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_PATH",
      detail: "必须提供文件路径",
      field: "path"
    });
  }

  if (rawPath.includes("\0")) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_PATH",
      detail: "文件路径包含非法字符",
      field: "path"
    });
  }

  if (path.isAbsolute(rawPath) || WINDOWS_DRIVE_PATTERN.test(rawPath)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PATH_OUT_OF_WORKSPACE",
      detail: "文件路径必须是工作区内相对路径",
      field: "path"
    });
  }

  const normalizedInput = rawPath.replace(/\\/g, "/");
  const segments = normalizedInput.split("/").filter(Boolean);

  if (segments.some((segment) => segment === "..")) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PATH_TRAVERSAL_BLOCKED",
      detail: "检测到路径穿越请求，已拒绝访问",
      field: "path"
    });
  }

  const normalized = path.posix.normalize(segments.filter((segment) => segment !== ".").join("/"));

  if (!normalized || normalized === ".") {
    if (allowRoot) {
      return "";
    }

    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_PATH",
      detail: "必须提供文件路径",
      field: "path"
    });
  }

  if (normalized === ".." || normalized.startsWith("../")) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PATH_TRAVERSAL_BLOCKED",
      detail: "检测到路径穿越请求，已拒绝访问",
      field: "path"
    });
  }

  return normalized;
}

export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const absolutePath = path.resolve(workspaceRoot, relativePath || ".");
  const relativeToRoot = path.relative(workspaceRoot, absolutePath);

  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PATH_OUT_OF_WORKSPACE",
      detail: "文件路径超出工作区边界",
      field: "path"
    });
  }

  return absolutePath;
}
