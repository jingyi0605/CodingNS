import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { AppError } from "../../shared/errors/app-error.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";

const APPLY_CONFIG_TIMEOUT_MS = 10 * 60 * 1000;
const TOOL_RELATIVE_DIR = "Code/doc-semantic-index-node";
const TOOL_DIST_ENTRY_CANDIDATES = [
  "dist/bin/index.js",
  "packages/cli/dist/bin/index.js"
];

interface WorkspaceIndexApplyLogger {
  info(bindings: Record<string, unknown>, message: string): void;
}

export interface WorkspaceIndexApplyResult {
  ok: true;
  workspaceId: string;
  workspacePath: string;
  toolRoot: string;
  entryFile: string;
  command: string[];
  exitCode: number;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
}

/**
 * 这里只开放一个极窄能力：对当前 workspace 执行 doc-semantic-index 的 apply-config。
 * 不开放任意命令，不开放任意 cwd，不让静态 HTML 变成一个后门 shell。
 */
export class WorkspaceIndexApplyService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly logger: WorkspaceIndexApplyLogger
  ) {}

  async applyConfig(workspaceId: string): Promise<WorkspaceIndexApplyResult> {
    const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);
    const toolRoot = path.join(workspace.path, TOOL_RELATIVE_DIR);
    const entryFile = resolveToolEntryFile(toolRoot);

    if (!fs.existsSync(toolRoot)) {
      throw new AppError({
        statusCode: 404,
        errorCode: "INDEX_TOOL_NOT_FOUND",
        detail: `未找到索引工具目录：${TOOL_RELATIVE_DIR}`
      });
    }

    if (!entryFile) {
      throw new AppError({
        statusCode: 409,
        errorCode: "INDEX_TOOL_BUILD_MISSING",
        detail: "未找到 CLI 构建产物，请先在 Code/doc-semantic-index-node 执行 pnpm build"
      });
    }

    const startedAt = Date.now();
    const command = [
      process.execPath,
      entryFile,
      "apply-config",
      "--root-dir",
      workspace.path
    ];

    const result = await this.runCommand({
      workspaceId,
      workspacePath: workspace.path,
      toolRoot,
      entryFile,
      command
    });

    this.logger.info(
      {
        workspaceId,
        toolRoot,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        signal: result.signal,
        operation: "workspace_bridge.apply_index_config"
      },
      "静态 HTML 预览通过受控桥接执行 apply-config"
    );

    if (result.exitCode !== 0) {
      const stderrTail = readTail(result.stderr || result.stdout, 600);
      throw new AppError({
        statusCode: 500,
        errorCode: "INDEX_APPLY_CONFIG_FAILED",
        detail: stderrTail
          ? `apply-config 执行失败（exit ${result.exitCode}）：${stderrTail}`
          : `apply-config 执行失败（exit ${result.exitCode}）`
      });
    }

    return {
      ...result,
      durationMs: Date.now() - startedAt
    };
  }

  private async runCommand(input: {
    workspaceId: string;
    workspacePath: string;
    toolRoot: string;
    entryFile: string;
    command: string[];
  }): Promise<WorkspaceIndexApplyResult> {
    return await new Promise<WorkspaceIndexApplyResult>((resolve, reject) => {
      const child = spawn(input.command[0], input.command.slice(1), {
        cwd: input.toolRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const startedAt = Date.now();

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        reject(
          new AppError({
            statusCode: 504,
            errorCode: "INDEX_APPLY_CONFIG_TIMEOUT",
            detail: `apply-config 执行超时，已超过 ${Math.round(APPLY_CONFIG_TIMEOUT_MS / 1000)} 秒`
          })
        );
      }, APPLY_CONFIG_TIMEOUT_MS);

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(
          new AppError({
            statusCode: 500,
            errorCode: "INDEX_APPLY_CONFIG_SPAWN_FAILED",
            detail: error.message || "apply-config 进程启动失败"
          })
        );
      });

      child.once("close", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          ok: true,
          workspaceId: input.workspaceId,
          workspacePath: input.workspacePath,
          toolRoot: input.toolRoot,
          entryFile: input.entryFile,
          command: input.command,
          exitCode: typeof exitCode === "number" ? exitCode : -1,
          signal,
          durationMs: Date.now() - startedAt,
          stdout,
          stderr
        });
      });
    });
  }
}

function readTail(input: string, maxChars: number): string {
  const text = String(input || "").trim();
  if (!text) return "";
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

function resolveToolEntryFile(toolRoot: string): string {
  for (const relativePath of TOOL_DIST_ENTRY_CANDIDATES) {
    const absolutePath = path.join(toolRoot, relativePath);
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }
  return "";
}
