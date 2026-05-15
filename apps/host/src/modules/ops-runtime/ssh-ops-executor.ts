import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { OfficeArtifactRepository } from "../../storage/repositories/office-artifact-repository.js";
import type { OfficeAuditEventRepository } from "../../storage/repositories/office-audit-event-repository.js";
import type { OfficeReceiptRepository } from "../../storage/repositories/office-receipt-repository.js";
import type { OfficeTaskRepository } from "../../storage/repositories/office-task-repository.js";
import type { OfficeTaskStepRepository } from "../../storage/repositories/office-task-step-repository.js";
import type { OfficeArtifact, OfficeReceipt, OfficeTask, OfficeTaskStep } from "../../types/domain.js";
import { TaskCancelledError, type TaskRunContext } from "../tasks/task-types.js";

export interface ExecuteSshTaskInput {
  task: OfficeTask;
  runContext?: TaskRunContext;
}

interface SshTaskPayload {
  targetId?: string;
  targetKind?: string;
  config?: {
    host?: string;
    port?: number;
    username?: string;
    privateKeyPath?: string;
    passphraseRef?: string;
    strictHostKeyChecking?: "yes" | "no" | "accept-new";
    knownHostsPath?: string;
    jumpHost?: string;
    workspacePath?: string;
    env?: Record<string, string>;
  };
  commandSpec?: {
    command?: string;
    commands?: string[];
    env?: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
  };
}

interface ResolvedSshTaskInput {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string | null;
  strictHostKeyChecking: "yes" | "no" | "accept-new";
  knownHostsPath: string | null;
  jumpHost: string | null;
  workspacePath: string | null;
  timeoutMs: number;
  commands: string[];
  env: Record<string, string>;
}

export class SshOpsExecutor {
  private readonly artifactRoot: string;

  constructor(
    private readonly config: HostConfig,
    private readonly officeTaskRepository: OfficeTaskRepository,
    private readonly officeTaskStepRepository: OfficeTaskStepRepository,
    private readonly officeArtifactRepository: OfficeArtifactRepository,
    private readonly officeReceiptRepository: OfficeReceiptRepository,
    private readonly officeAuditEventRepository: OfficeAuditEventRepository
  ) {
    this.artifactRoot = path.join(path.dirname(config.databasePath), "office-artifacts");
  }

  async execute(input: ExecuteSshTaskInput): Promise<SshExecutionResult> {
    const task = this.markTaskRunning(input.task);
    const parsed = parseSshTaskPayload(task.inputJson);
    const resolved = resolveSshTaskInput(parsed);
    const step = this.createStep(task, resolved);
    const startedStep = this.startStep(step);

    try {
      ensureNotCancelled(input.runContext);
      const result = await this.runSshCommand(task, startedStep, resolved, input.runContext);
      this.finishStep(startedStep, JSON.stringify({
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs
      }));
      const receipt = this.createReceipt(task, resolved, result);
      const nextTask = this.markTaskSucceeded(task, result);
      return {
        task: nextTask,
        step: startedStep,
        receipt,
        stdoutArtifact: result.stdoutArtifact,
        stderrArtifact: result.stderrArtifact
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SSH 运维任务执行失败";
      this.failStep(startedStep, message);
      this.markTaskFailed(task, message);

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError({
        statusCode: error instanceof TaskCancelledError ? 409 : 500,
        errorCode: error instanceof TaskCancelledError ? "OPS_SSH_TASK_CANCELLED" : "OPS_SSH_TASK_EXECUTION_FAILED",
        detail: message
      });
    }
  }

  private async runSshCommand(
    task: OfficeTask,
    step: OfficeTaskStep,
    resolved: ResolvedSshTaskInput,
    runContext?: TaskRunContext
  ): Promise<{
    exitCode: number;
    signal: NodeJS.Signals | null;
    durationMs: number;
    stdoutArtifact: OfficeArtifact | null;
    stderrArtifact: OfficeArtifact | null;
  }> {
    const commandScript = buildRemoteCommandScript(resolved);
    const sshArgs = buildSshArgs(resolved, commandScript);
    const spawnEnv = {
      ...process.env,
      ...resolved.env
    };

    const startedAt = Date.now();
    const child = spawn("ssh", sshArgs, {
      env: spawnEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, resolved.timeoutMs);

    const cancelListener = () => {
      child.kill("SIGTERM");
    };
    runContext?.signal.addEventListener("abort", cancelListener, { once: true });

    try {
      const exit = await new Promise<{ code: number; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => {
          settled = true;
          resolve({ code: code ?? -1, signal });
        });
      });

      ensureNotCancelled(runContext);
      if (timedOut) {
        throw new AppError({
          statusCode: 504,
          errorCode: "OPS_SSH_TASK_TIMEOUT",
          detail: `SSH 命令执行超时，超过 ${resolved.timeoutMs}ms`
        });
      }

      if (exit.code !== 0) {
        const stderrMessage = stderr.trim();
        throw new AppError({
          statusCode: 500,
          errorCode: "OPS_SSH_TASK_COMMAND_FAILED",
          detail: stderrMessage || `SSH 命令退出码 ${exit.code}`
        });
      }

      const stdoutArtifact = stdout.trim().length > 0
        ? this.createTextArtifact(task, step, "command_log", "stdout.log", stdout, "text/plain")
        : null;
      const stderrArtifact = stderr.trim().length > 0
        ? this.createTextArtifact(task, step, "command_log", "stderr.log", stderr, "text/plain")
        : null;

      return {
        exitCode: exit.code,
        signal: exit.signal,
        durationMs: Date.now() - startedAt,
        stdoutArtifact,
        stderrArtifact
      };
    } finally {
      clearTimeout(timeout);
      runContext?.signal.removeEventListener("abort", cancelListener);
      if (!settled && child.exitCode === null) {
        child.kill("SIGTERM");
      }
    }
  }

  private createStep(task: OfficeTask, resolved: ResolvedSshTaskInput): OfficeTaskStep {
    const timestamp = nowIso();
    return this.officeTaskStepRepository.create({
      id: createId(),
      taskId: task.id,
      stepSeq: 1,
      stepType: "ssh_execute",
      title: `执行 SSH 命令：${resolved.commands[0]}`,
      inputJson: JSON.stringify({
        host: resolved.host,
        port: resolved.port,
        username: resolved.username,
        workspacePath: resolved.workspacePath,
        commandCount: resolved.commands.length,
        timeoutMs: resolved.timeoutMs
      }),
      outputJson: null,
      status: "pending",
      retryCount: 0,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  private startStep(step: OfficeTaskStep): OfficeTaskStep {
    const timestamp = nowIso();
    return this.officeTaskStepRepository.update({
      ...step,
      status: "running",
      startedAt: timestamp,
      updatedAt: timestamp
    });
  }

  private finishStep(step: OfficeTaskStep, outputJson: string): OfficeTaskStep {
    const timestamp = nowIso();
    const next = this.officeTaskStepRepository.update({
      ...step,
      status: "succeeded",
      outputJson,
      finishedAt: timestamp,
      updatedAt: timestamp
    });
    this.officeAuditEventRepository.create({
      id: createId(),
      taskId: step.taskId,
      stepId: step.id,
      eventKind: "task_updated",
      actorKind: "connector",
      actorId: "ops.ssh",
      summary: "SSH 步骤执行完成",
      payloadJson: outputJson,
      createdAt: timestamp
    });
    return next;
  }

  private failStep(step: OfficeTaskStep, errorMessage: string): OfficeTaskStep {
    const timestamp = nowIso();
    return this.officeTaskStepRepository.update({
      ...step,
      status: "failed",
      errorMessage,
      finishedAt: timestamp,
      updatedAt: timestamp
    });
  }

  private createTextArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    kind: OfficeArtifact["kind"],
    fileName: string,
    content: string,
    contentType: string
  ): OfficeArtifact {
    const targetDir = this.ensureArtifactDir(task.id);
    const artifactId = createId();
    const storagePath = path.join(targetDir, `${artifactId}-${fileName}`);
    fs.writeFileSync(storagePath, content, "utf8");

    const artifact = this.officeArtifactRepository.create({
      id: artifactId,
      taskId: task.id,
      stepId: step.id,
      kind,
      name: fileName,
      storagePath,
      contentType,
      metadataJson: JSON.stringify({
        size: Buffer.byteLength(content),
        stepSeq: step.stepSeq
      }),
      createdAt: nowIso()
    });

    this.officeAuditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: step.id,
      eventKind: "artifact_created",
      actorKind: "connector",
      actorId: "ops.ssh",
      summary: `生成 SSH 执行产物：${artifact.name}`,
      payloadJson: JSON.stringify({ artifactId: artifact.id, kind: artifact.kind }),
      createdAt: artifact.createdAt
    });

    return artifact;
  }

  private createReceipt(
    task: OfficeTask,
    resolved: ResolvedSshTaskInput,
    result: {
      exitCode: number;
      signal: NodeJS.Signals | null;
      durationMs: number;
      stdoutArtifact: OfficeArtifact | null;
      stderrArtifact: OfficeArtifact | null;
    }
  ): OfficeReceipt {
    return this.officeReceiptRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      receiptType: "ssh_execution",
      summary: "SSH 运维任务执行完成",
      payloadJson: JSON.stringify({
        host: resolved.host,
        port: resolved.port,
        username: resolved.username,
        workspacePath: resolved.workspacePath,
        commandCount: resolved.commands.length,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        stdoutArtifactId: result.stdoutArtifact?.id ?? null,
        stderrArtifactId: result.stderrArtifact?.id ?? null
      }),
      createdAt: nowIso()
    });
  }

  private markTaskRunning(task: OfficeTask): OfficeTask {
    const timestamp = nowIso();
    const next = this.officeTaskRepository.update({
      ...task,
      status: "running",
      startedAt: task.startedAt ?? timestamp,
      finishedAt: null,
      updatedAt: timestamp
    });
    this.officeAuditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      eventKind: "task_started",
      actorKind: "connector",
      actorId: "ops.ssh",
      summary: "SSH 运维任务开始执行",
      payloadJson: null,
      createdAt: timestamp
    });
    return next;
  }

  private markTaskSucceeded(
    task: OfficeTask,
    result: { exitCode: number; durationMs: number }
  ): OfficeTask {
    const timestamp = nowIso();
    const next = this.officeTaskRepository.update({
      ...task,
      status: "succeeded",
      finishedAt: timestamp,
      updatedAt: timestamp
    });
    this.officeAuditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      eventKind: "task_finished",
      actorKind: "connector",
      actorId: "ops.ssh",
      summary: "SSH 运维任务执行成功",
      payloadJson: JSON.stringify({
        status: "succeeded",
        exitCode: result.exitCode,
        durationMs: result.durationMs
      }),
      createdAt: timestamp
    });
    return next;
  }

  private markTaskFailed(task: OfficeTask, reason: string): OfficeTask {
    const timestamp = nowIso();
    const next = this.officeTaskRepository.update({
      ...task,
      status: "failed",
      finishedAt: timestamp,
      updatedAt: timestamp
    });
    this.officeAuditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      eventKind: "task_finished",
      actorKind: "connector",
      actorId: "ops.ssh",
      summary: "SSH 运维任务执行失败",
      payloadJson: JSON.stringify({
        status: "failed",
        reason
      }),
      createdAt: timestamp
    });
    return next;
  }

  private ensureArtifactDir(taskId: string): string {
    const targetDir = path.join(this.artifactRoot, taskId);
    fs.mkdirSync(targetDir, { recursive: true });
    return targetDir;
  }
}

export interface SshExecutionResult {
  task: OfficeTask;
  step: OfficeTaskStep;
  receipt: OfficeReceipt;
  stdoutArtifact: OfficeArtifact | null;
  stderrArtifact: OfficeArtifact | null;
}

function parseSshTaskPayload(raw: string): SshTaskPayload {
  try {
    return JSON.parse(raw) as SshTaskPayload;
  } catch {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_OPS_SSH_TASK_INPUT",
      detail: "SSH 运维任务输入格式不合法"
    });
  }
}

function resolveSshTaskInput(payload: SshTaskPayload): ResolvedSshTaskInput {
  const config = payload.config;
  const commandSpec = payload.commandSpec;
  if (!config || typeof config !== "object") {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_OPS_SSH_TASK_INPUT",
      detail: "SSH 运维任务缺少目标配置"
    });
  }

  const commands = Array.isArray(commandSpec?.commands)
    ? commandSpec.commands.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0)
    : [];
  if (commandSpec?.command && typeof commandSpec.command === "string" && commandSpec.command.trim()) {
    commands.unshift(commandSpec.command.trim());
  }

  const uniqueCommands = [...new Set(commands)];
  if (uniqueCommands.length === 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_OPS_SSH_TASK_INPUT",
      detail: "SSH 运维任务必须提供 command 或 commands"
    });
  }

  const host = typeof config.host === "string" ? config.host.trim() : "";
  const username = typeof config.username === "string" ? config.username.trim() : "";
  if (!host || !username) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_OPS_SSH_TASK_INPUT",
      detail: "SSH 运维目标必须包含 host 和 username"
    });
  }

  const port = typeof config.port === "number" && Number.isFinite(config.port) && config.port > 0
    ? Math.trunc(config.port)
    : 22;
  const timeoutMs = typeof commandSpec?.timeoutMs === "number" && Number.isFinite(commandSpec.timeoutMs) && commandSpec.timeoutMs > 0
    ? Math.min(Math.trunc(commandSpec.timeoutMs), 300_000)
    : 60_000;

  return {
    host,
    port,
    username,
    privateKeyPath: normalizeOptionalText(config.privateKeyPath),
    strictHostKeyChecking: normalizeStrictHostKeyChecking(config.strictHostKeyChecking),
    knownHostsPath: normalizeOptionalText(config.knownHostsPath),
    jumpHost: normalizeOptionalText(config.jumpHost),
    workspacePath: normalizeOptionalText(commandSpec?.cwd) ?? normalizeOptionalText(config.workspacePath),
    timeoutMs,
    commands: uniqueCommands,
    env: {
      ...normalizeEnvMap(config.env),
      ...normalizeEnvMap(commandSpec?.env)
    }
  };
}

function buildRemoteCommandScript(input: ResolvedSshTaskInput): string {
  const parts: string[] = ["set -e"];
  if (input.workspacePath) {
    parts.push(`cd ${shellEscape(input.workspacePath)}`);
  }
  for (const [key, value] of Object.entries(input.env)) {
    parts.push(`export ${key}=${shellEscape(value)}`);
  }
  parts.push(...input.commands);
  return parts.join(" && ");
}

function buildSshArgs(input: ResolvedSshTaskInput, commandScript: string): string[] {
  const args = [
    "-p",
    String(input.port),
    "-o",
    `StrictHostKeyChecking=${input.strictHostKeyChecking}`,
    "-o",
    "BatchMode=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3"
  ];

  if (input.knownHostsPath) {
    args.push("-o", `UserKnownHostsFile=${input.knownHostsPath}`);
  }
  if (input.privateKeyPath) {
    args.push("-i", input.privateKeyPath);
  }
  if (input.jumpHost) {
    args.push("-J", input.jumpHost);
  }

  args.push(`${input.username}@${input.host}`, commandScript);
  return args;
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeStrictHostKeyChecking(
  value: unknown
): "yes" | "no" | "accept-new" {
  if (value === "yes" || value === "no" || value === "accept-new") {
    return value;
  }
  return "accept-new";
}

function normalizeEnvMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    if (typeof entry === "string") {
      result[key] = entry;
    } else if (typeof entry === "number" || typeof entry === "boolean") {
      result[key] = String(entry);
    }
  }
  return result;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function ensureNotCancelled(runContext?: TaskRunContext): void {
  if (runContext?.signal.aborted) {
    throw new TaskCancelledError("SSH 运维任务已取消");
  }
}
