import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppError, isAppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";
import type { Workspace } from "../../types/domain.js";
import type { GitCommandRunner } from "../git/git-command-runner.js";

interface WorkspaceDirectoryOption {
  path: string;
  name: string;
}

export interface WorkspaceDirectoryBrowseResult {
  currentPath: string;
  parentPath: string | null;
  roots: WorkspaceDirectoryOption[];
  items: WorkspaceDirectoryOption[];
}

type WorkspaceCloneAuth =
  | {
      mode?: "none";
    }
  | {
      mode: "basic";
      username?: string;
      password?: string;
    }
  | {
      mode: "token";
      username?: string;
      token?: string;
    };

export interface CloneWorkspaceInput {
  repositoryUrl: string;
  parentPath: string;
  directoryName?: string;
  name?: string;
  auth?: WorkspaceCloneAuth | null;
}

interface GitAuthContext {
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
}

const DIRECTORY_BROWSE_LIMIT = 200;
const GIT_CLONE_TIMEOUT_MS = 120_000;

export class WorkspaceService {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly gitCommandRunner: GitCommandRunner
  ) {}

  browseDirectories(requestedPath?: string): WorkspaceDirectoryBrowseResult {
    const roots = listDirectoryRoots();
    const fallbackPath = resolveDefaultBrowsePath(roots);
    const currentPath = resolveBrowsePath(requestedPath, fallbackPath);

    ensureExistingDirectory(currentPath, "path");

    return {
      currentPath,
      parentPath: resolveParentPath(currentPath),
      roots,
      items: fs
        .readdirSync(currentPath, {
          withFileTypes: true
        })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .slice(0, DIRECTORY_BROWSE_LIMIT)
        .map((entry) => ({
          path: path.join(currentPath, entry.name),
          name: entry.name
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
    };
  }

  importWorkspace(workspacePath: string, name?: string): Workspace {
    const resolvedPath = path.resolve(workspacePath);
    ensureExistingDirectory(resolvedPath, "path");
    return createWorkspaceRecord(this.workspaceRepository, resolvedPath, name);
  }

  async cloneWorkspace(input: CloneWorkspaceInput): Promise<Workspace> {
    const repositoryUrl = input.repositoryUrl.trim();

    if (!repositoryUrl) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "Git 仓库地址不能为空",
        field: "repositoryUrl"
      });
    }

    const parentPath = path.resolve(input.parentPath);
    ensureExistingDirectory(parentPath, "parentPath");

    const directoryName = normalizeCloneDirectoryName(input.directoryName, repositoryUrl);
    const targetPath = path.join(parentPath, directoryName);

    if (fs.existsSync(targetPath)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKSPACE_TARGET_EXISTS",
        detail: "目标路径已经存在，不能直接覆盖克隆",
        field: "directoryName"
      });
    }

    const authContext = createGitAuthContext(input.auth);

    try {
      await this.gitCommandRunner.run(parentPath, ["clone", repositoryUrl, directoryName], {
        timeoutMs: GIT_CLONE_TIMEOUT_MS,
        env: authContext?.env
      });

      return this.importWorkspace(targetPath, input.name?.trim());
    } catch (error) {
      if (fs.existsSync(targetPath)) {
        // clone 失败会留下半成品目录，直接清掉，避免下一次重试被脏状态卡死。
        fs.rmSync(targetPath, { recursive: true, force: true });
      }

      throw mapCloneError(error);
    } finally {
      authContext?.cleanup();
    }
  }

  list(): Workspace[] {
    return this.workspaceRepository.list();
  }

  getWorkspaceOrThrow(workspaceId: string): Workspace {
    const workspace = this.workspaceRepository.findById(workspaceId);

    if (!workspace) {
      throw new AppError({
        statusCode: 404,
        errorCode: "WORKSPACE_NOT_FOUND",
        detail: "指定工作区不存在"
      });
    }

    return workspace;
  }

  findWorkspaceByPath(workspacePath: string): Workspace | null {
    return this.workspaceRepository.findByPath(path.resolve(workspacePath));
  }
}

function createWorkspaceRecord(
  workspaceRepository: WorkspaceRepository,
  workspacePath: string,
  name?: string
): Workspace {
  const existing = workspaceRepository.findByPath(workspacePath);

  if (existing) {
    return existing;
  }

  const timestamp = nowIso();

  return workspaceRepository.create({
    id: createId(),
    name: name?.trim() || path.basename(workspacePath),
    path: workspacePath,
    repoRoot: workspacePath,
    favorite: false,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function ensureExistingDirectory(targetPath: string, field: string): void {
  if (!fs.existsSync(targetPath)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_WORKSPACE_PATH",
      detail: "工作区路径不存在",
      field
    });
  }

  if (!fs.statSync(targetPath).isDirectory()) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_WORKSPACE_PATH",
      detail: "工作区路径必须是目录",
      field
    });
  }
}

function normalizeCloneDirectoryName(directoryName: string | undefined, repositoryUrl: string): string {
  const rawValue = directoryName?.trim() || deriveDirectoryNameFromRepository(repositoryUrl);
  const normalized = rawValue.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "目标目录名不能为空",
      field: "directoryName"
    });
  }

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("-") ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    path.isAbsolute(normalized)
  ) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "目标目录名无效，必须是单层目录名",
      field: "directoryName"
    });
  }

  return normalized;
}

function deriveDirectoryNameFromRepository(repositoryUrl: string): string {
  const normalized = repositoryUrl.trim().replace(/\\/g, "/").replace(/[\/]+$/, "");
  const lastSlashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf(":"));
  const rawName = lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized;
  return rawName.replace(/\.git$/i, "");
}

function createGitAuthContext(auth: WorkspaceCloneAuth | null | undefined): GitAuthContext | null {
  if (!auth || !auth.mode || auth.mode === "none") {
    return null;
  }

  const mode = auth.mode;
  let username = "";
  let secret = "";

  if (auth.mode === "basic") {
    username = auth.username?.trim() || "";
    secret = auth.password?.trim() || "";
  } else if (auth.mode === "token") {
    username = auth.username?.trim() || "git";
    secret = auth.token?.trim() || "";
  } else {
    return null;
  }

  if (!username) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "Git 用户名不能为空",
      field: "username"
    });
  }

  if (!secret) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: mode === "basic" ? "Git 密码不能为空" : "Git token 不能为空",
      field: mode === "basic" ? "password" : "token"
    });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-git-auth-"));
  const helperRuntimePath = path.join(tempDir, "askpass.cjs");
  const helperScriptPath = path.join(tempDir, process.platform === "win32" ? "askpass.cmd" : "askpass.sh");

  fs.writeFileSync(
    helperRuntimePath,
    [
      'const prompt = (process.argv.slice(2).join(" ") || "").toLowerCase();',
      'const username = process.env.CODINGNS_GIT_AUTH_USERNAME || "";',
      'const secret = process.env.CODINGNS_GIT_AUTH_SECRET || "";',
      'if (prompt.includes("username")) {',
      "  process.stdout.write(username);",
      '} else if (prompt.includes("password") || prompt.includes("passphrase")) {',
      "  process.stdout.write(secret);",
      "} else {",
      "  process.stdout.write(secret || username);",
      "}"
    ].join("\n"),
    "utf8"
  );

  if (process.platform === "win32") {
    fs.writeFileSync(
      helperScriptPath,
      '@echo off\r\n"%CODINGNS_GIT_NODE%" "%~dp0askpass.cjs" %*\r\n',
      "utf8"
    );
  } else {
    fs.writeFileSync(
      helperScriptPath,
      '#!/bin/sh\n"$CODINGNS_GIT_NODE" "$(dirname "$0")/askpass.cjs" "$@"\n',
      "utf8"
    );
    fs.chmodSync(helperScriptPath, 0o755);
  }

  return {
    env: {
      CODINGNS_GIT_NODE: process.execPath,
      CODINGNS_GIT_AUTH_USERNAME: username,
      CODINGNS_GIT_AUTH_SECRET: secret,
      GIT_ASKPASS: helperScriptPath,
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never"
    },
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function mapCloneError(error: unknown): AppError {
  if (isAppError(error)) {
    if (error.errorCode === "GIT_COMMAND_FAILED") {
      return mapGitCloneCommandError(error.message);
    }

    return error;
  }

  return mapGitCloneCommandError(error instanceof Error ? error.message : "Git clone 失败");
}

function mapGitCloneCommandError(detail: string): AppError {
  if (
    /authentication failed|fatal: could not read Username|fatal: could not read Password|permission denied/i.test(
      detail
    )
  ) {
    return new AppError({
      statusCode: 401,
      errorCode: "GIT_CLONE_AUTH_FAILED",
      detail: "Git 仓库认证失败，请检查用户名、密码或 token"
    });
  }

  if (
    /unable to access|failed to connect|connection timed out|operation timed out|could not resolve host|network is unreachable|connection reset/i.test(
      detail
    )
  ) {
    return new AppError({
      statusCode: 502,
      errorCode: "GIT_CLONE_NETWORK_FAILED",
      detail: "连接 Git 仓库失败，请检查网络或仓库地址"
    });
  }

  if (/repository .* not found|remote branch .* not found|repository not found|not found/i.test(detail)) {
    return new AppError({
      statusCode: 404,
      errorCode: "GIT_REPOSITORY_NOT_FOUND",
      detail: "Git 仓库不存在，或当前账号没有访问权限"
    });
  }

  return new AppError({
    statusCode: 500,
    errorCode: "GIT_CLONE_FAILED",
    detail: detail.trim() || "Git clone 失败"
  });
}

function listDirectoryRoots(): WorkspaceDirectoryOption[] {
  if (process.platform === "win32") {
    const driveLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

    return driveLetters
      .map((letter) => `${letter}:\\`)
      .filter((rootPath) => fs.existsSync(rootPath))
      .map((rootPath) => ({
        path: rootPath,
        name: rootPath
      }));
  }

  return [
    {
      path: "/",
      name: "/"
    }
  ];
}

function resolveDefaultBrowsePath(roots: WorkspaceDirectoryOption[]): string {
  const homePath = os.homedir();

  if (homePath && fs.existsSync(homePath) && fs.statSync(homePath).isDirectory()) {
    return path.resolve(homePath);
  }

  if (roots[0]?.path) {
    return roots[0].path;
  }

  return path.resolve(process.cwd());
}

function resolveBrowsePath(requestedPath: string | undefined, fallbackPath: string): string {
  const trimmedPath = requestedPath?.trim();

  if (!trimmedPath) {
    return fallbackPath;
  }

  return path.resolve(trimmedPath);
}

function resolveParentPath(currentPath: string): string | null {
  const parentPath = path.dirname(currentPath);
  const currentRoot = path.parse(currentPath).root;

  if (parentPath === currentPath || currentPath === currentRoot) {
    return null;
  }

  return parentPath;
}
