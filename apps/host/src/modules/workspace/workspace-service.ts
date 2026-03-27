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

interface WorkspaceGitRemoteSummary {
  name: string;
  url: string;
}

export interface WorkspaceGitSummary {
  isRepository: boolean;
  repoRoot: string | null;
  currentBranch: string | null;
  commitCount: number | null;
  remotes: WorkspaceGitRemoteSummary[];
  error: string | null;
}

export interface WorkspaceCodeCompositionItem {
  type: string;
  count: number;
  ratio: number;
}

export interface WorkspaceCodeCompositionSummary {
  scannedFileCount: number;
  truncated: boolean;
  items: WorkspaceCodeCompositionItem[];
  error: string | null;
}

export interface WorkspaceManagementSummary {
  workspaceId: string;
  name: string;
  path: string;
  git: WorkspaceGitSummary;
  codeComposition: WorkspaceCodeCompositionSummary;
}

const DIRECTORY_BROWSE_LIMIT = 200;
const GIT_CLONE_TIMEOUT_MS = 120_000;
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
        env: authContext?.env,
        operation: "workspace.cloneWorkspace"
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

  removeWorkspace(workspaceId: string): Workspace {
    const workspace = this.getWorkspaceOrThrow(workspaceId);
    const timestamp = nowIso();

    return (
      this.workspaceRepository.markRemoved(workspace.id, timestamp, timestamp) ?? {
        ...workspace,
        updatedAt: timestamp,
        removedAt: timestamp
      }
    );
  }

  async getManagementSummary(workspaceId: string): Promise<WorkspaceManagementSummary> {
    const workspace = this.getWorkspaceOrThrow(workspaceId);

    const [git, codeComposition] = await Promise.all([
      this.readGitSummary(workspace),
      Promise.resolve(readWorkspaceCodeComposition(workspace.path))
    ]);

    return {
      workspaceId: workspace.id,
      name: workspace.name,
      path: workspace.path,
      git,
      codeComposition
    };
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

  private async readGitSummary(workspace: Workspace): Promise<WorkspaceGitSummary> {
    const workspacePath = path.resolve(workspace.path);

    if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) {
      return {
        isRepository: false,
        repoRoot: null,
        currentBranch: null,
        commitCount: null,
        remotes: [],
        error: "工作区路径不存在，Git 信息不可用"
      };
    }

    try {
      const repoRootResult = await this.gitCommandRunner.run(
        workspacePath,
        ["rev-parse", "--show-toplevel"],
        {
          allowNonZeroExit: true,
          workspaceId: workspace.id,
          operation: "workspace.readGitSummary"
        }
      );

      if (repoRootResult.exitCode !== 0) {
        return {
          isRepository: false,
          repoRoot: null,
          currentBranch: null,
          commitCount: null,
          remotes: [],
          error: "当前工作区不是 Git 仓库"
        };
      }

      const repoRoot = repoRootResult.stdout.trim();

      if (!repoRoot) {
        return {
          isRepository: false,
          repoRoot: null,
          currentBranch: null,
          commitCount: null,
          remotes: [],
          error: "Git 仓库根目录解析失败"
        };
      }

      const [branchResult, commitCountResult, remoteResult] = await Promise.all([
        this.gitCommandRunner.run(repoRoot, ["branch", "--show-current"], {
          allowNonZeroExit: true,
          workspaceId: workspace.id,
          operation: "workspace.readGitSummary"
        }),
        this.gitCommandRunner.run(repoRoot, ["rev-list", "--count", "--all"], {
          allowNonZeroExit: true,
          workspaceId: workspace.id,
          operation: "workspace.readGitSummary"
        }),
        this.gitCommandRunner.run(repoRoot, ["remote", "-v"], {
          allowNonZeroExit: true,
          workspaceId: workspace.id,
          operation: "workspace.readGitSummary"
        })
      ]);

      return {
        isRepository: true,
        repoRoot,
        currentBranch: normalizeGitOutput(branchResult.stdout),
        commitCount: parseGitCommitCount(commitCountResult.stdout),
        remotes: parseGitRemotes(remoteResult.stdout),
        error: null
      };
    } catch (error) {
      return {
        isRepository: false,
        repoRoot: null,
        currentBranch: null,
        commitCount: null,
        remotes: [],
        error: mapWorkspaceGitSummaryError(error)
      };
    }
  }
}

function createWorkspaceRecord(
  workspaceRepository: WorkspaceRepository,
  workspacePath: string,
  name?: string
): Workspace {
  const existing = workspaceRepository.findByPath(workspacePath);

  if (existing) {
    if (!existing.removedAt) {
      return existing;
    }

    const timestamp = nowIso();

    return (
      workspaceRepository.restore(existing.id, {
        name: name?.trim() || undefined,
        repoRoot: workspacePath,
        updatedAt: timestamp
      }) ?? {
        ...existing,
        name: name?.trim() || existing.name,
        repoRoot: workspacePath,
        updatedAt: timestamp,
        removedAt: null
      }
    );
  }

  const timestamp = nowIso();

  return workspaceRepository.create({
    id: createId(),
    name: name?.trim() || path.basename(workspacePath),
    path: workspacePath,
    repoRoot: workspacePath,
    favorite: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    removedAt: null
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

function mapWorkspaceGitSummaryError(error: unknown): string {
  if (isAppError(error)) {
    if (error.errorCode === "GIT_COMMAND_TIMEOUT") {
      return "Git 信息读取超时，请稍后重试";
    }

    return error.message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Git 信息读取失败";
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

function readWorkspaceCodeComposition(workspacePath: string): WorkspaceCodeCompositionSummary {
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

  // 这里故意只做轻量扫描，避免为了一个信息面板把大仓库整棵树扫爆。
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
    .map(([type, count]) => ({
      type,
      count,
      ratio: scannedFileCount > 0 ? count / scannedFileCount : 0
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

  const directMatch = COMPOSITION_TYPE_BY_NAME[normalizedName];

  if (directMatch) {
    return directMatch;
  }

  return COMPOSITION_TYPE_BY_EXTENSION[path.extname(normalizedName)] ?? null;
}

function normalizeGitOutput(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function parseGitCommitCount(value: string): number | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGitRemotes(output: string): WorkspaceGitRemoteSummary[] {
  const remoteMap = new Map<string, WorkspaceGitRemoteSummary>();

  for (const line of output.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      continue;
    }

    const match = /^([^\s]+)\s+([^\s]+)\s+\((fetch|push)\)$/.exec(trimmedLine);

    if (!match) {
      continue;
    }

    const [, name, url, mode] = match;
    const existing = remoteMap.get(name);

    // 远程列表通常 fetch/push 会重复两次，这里优先保留 fetch 行，避免 UI 重复。
    if (!existing || mode === "fetch") {
      remoteMap.set(name, { name, url });
    }
  }

  return [...remoteMap.values()].sort((left, right) => left.name.localeCompare(right.name));
}
