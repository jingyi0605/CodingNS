import { spawn } from "node:child_process";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { resolveCommandLaunch } from "../../shared/utils/command-launch.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ButlerProjectRepository } from "../../storage/repositories/butler-project-repository.js";
import type { ButlerSessionRepository } from "../../storage/repositories/butler-session-repository.js";
import type { SessionCheckpointRepository } from "../../storage/repositories/session-checkpoint-repository.js";
import type {
  VerificationRunRecord,
  VerificationRunRepository
} from "../../storage/repositories/verification-run-repository.js";
import type {
  ButlerCheckpointProgressState,
  ButlerProject,
  ButlerSession,
  VerificationRunStatus,
  VerificationType
} from "../../types/domain.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 10_000;
const MAX_PREVIEW_LENGTH = 2_000;

interface CommandExecutionInput {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

interface CommandExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface HealthExecutionResult {
  statusCode: number;
  ok: boolean;
  responseText: string;
}

interface VerificationRunServiceOptions {
  now?: () => string;
  runCommand?: (input: CommandExecutionInput) => Promise<CommandExecutionResult>;
  runHealthCheck?: (url: string, timeoutMs: number) => Promise<HealthExecutionResult>;
}

export interface VerificationRunView {
  id: string;
  projectId: string;
  butlerSessionId: string | null;
  sourcePatrolRunId: string | null;
  verificationType: VerificationType;
  status: VerificationRunStatus;
  targetRef: string | null;
  spec: Record<string, unknown>;
  artifactRefs: Array<Record<string, unknown>>;
  result: Record<string, unknown>;
  summary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface StartVerificationRunInput {
  verificationType?: VerificationType;
  targetRef?: string | null;
  butlerSessionId?: string | null;
  sourcePatrolRunId?: string | null;
  spec?: Record<string, unknown>;
}

interface VerificationExecutionOutcome {
  status: Exclude<VerificationRunStatus, "queued" | "running">;
  summary: string;
  artifactRefs: Array<Record<string, unknown>>;
  result: Record<string, unknown>;
}

type PreparedVerificationPlan =
  | {
      kind: "command";
      summaryLabel: string;
      command: string;
      args: string[];
      cwd: string;
      env?: NodeJS.ProcessEnv;
      timeoutMs: number;
      expectedExitCode: number;
    }
  | {
      kind: "health-url";
      url: string;
      timeoutMs: number;
      expectedStatus: number | null;
    };

export class VerificationRunService {
  private readonly now: () => string;
  private readonly runCommand: (input: CommandExecutionInput) => Promise<CommandExecutionResult>;
  private readonly runHealthCheck: (url: string, timeoutMs: number) => Promise<HealthExecutionResult>;

  constructor(
    private readonly butlerProjectRepository: ButlerProjectRepository,
    private readonly butlerSessionRepository: ButlerSessionRepository,
    private readonly sessionCheckpointRepository: SessionCheckpointRepository,
    private readonly verificationRunRepository: VerificationRunRepository,
    options: VerificationRunServiceOptions = {}
  ) {
    this.now = options.now ?? nowIso;
    this.runCommand = options.runCommand ?? runCommandExecution;
    this.runHealthCheck = options.runHealthCheck ?? runHttpHealthCheck;
  }

  listRuns(
    projectId: string,
    filters?: { status?: VerificationRunStatus; verificationType?: VerificationType }
  ): VerificationRunView[] {
    this.getProjectOrThrow(projectId);
    return this.verificationRunRepository
      .listByProject(projectId, filters)
      .map(mapVerificationRunRecord);
  }

  getRun(projectId: string, runId: string): VerificationRunView {
    this.getProjectOrThrow(projectId);
    const record = this.getRunRecordOrThrow(runId);

    if (record.projectId !== projectId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "VERIFICATION_RUN_NOT_FOUND",
        detail: "当前项目下不存在该验证记录"
      });
    }

    return mapVerificationRunRecord(record);
  }

  async startRun(projectId: string, input: StartVerificationRunInput): Promise<VerificationRunView> {
    const project = this.getProjectOrThrow(projectId);
    const verificationType = normalizeVerificationType(input.verificationType);
    const targetRef = normalizeNullableText(input.targetRef) ?? null;
    const spec = normalizeSpec(input.spec);
    const plan = prepareVerificationPlan(project, verificationType, targetRef, spec);
    const butlerSession = input.butlerSessionId
      ? this.getProjectSessionOrThrow(project.id, input.butlerSessionId)
      : null;

    if (this.verificationRunRepository.listRunningByProject(project.id).length > 0) {
      throw new AppError({
        statusCode: 409,
        errorCode: "VERIFICATION_RUN_CONFLICT",
        detail: "当前项目已有进行中的验证任务"
      });
    }

    const startedAt = this.now();
    const record = this.verificationRunRepository.create({
      id: createId(),
      projectId: project.id,
      butlerSessionId: butlerSession?.id ?? null,
      sourcePatrolRunId: normalizeNullableText(input.sourcePatrolRunId) ?? null,
      verificationType,
      status: "running",
      targetRef,
      specJson: JSON.stringify(spec),
      artifactRefsJson: "[]",
      resultJson: "{}",
      summary: null,
      startedAt,
      finishedAt: null,
      createdAt: startedAt
    });

    try {
      const outcome = await this.executeVerification(plan);
      const finishedAt = this.now();
      const updated = this.updateRunRecord({
        ...record,
        status: outcome.status,
        summary: outcome.summary,
        artifactRefsJson: JSON.stringify(outcome.artifactRefs),
        resultJson: JSON.stringify(outcome.result),
        finishedAt
      });

      this.butlerProjectRepository.update({
        ...project,
        lastVerificationAt: finishedAt,
        updatedAt: finishedAt,
        config: {
          ...project.config,
          lastVerificationType: verificationType,
          lastVerificationStatus: outcome.status
        }
      });

      if (butlerSession) {
        this.writeVerificationCheckpoint(butlerSession, outcome, finishedAt);
      }

      return mapVerificationRunRecord(updated);
    } catch (error) {
      const finishedAt = this.now();
      const detail = error instanceof Error ? error.message : String(error);
      const failed = this.updateRunRecord({
        ...record,
        status: "failed",
        summary: detail,
        artifactRefsJson: JSON.stringify([]),
        resultJson: JSON.stringify({
          error: detail
        }),
        finishedAt
      });

      this.butlerProjectRepository.update({
        ...project,
        lastVerificationAt: finishedAt,
        updatedAt: finishedAt,
        config: {
          ...project.config,
          lastVerificationType: verificationType,
          lastVerificationStatus: "failed"
        }
      });

      if (butlerSession) {
        this.writeVerificationCheckpoint(
          butlerSession,
          {
            status: "failed",
            summary: detail,
            artifactRefs: [],
            result: {
              error: detail
            }
          },
          finishedAt
        );
      }

      return mapVerificationRunRecord(failed);
    }
  }

  private async executeVerification(
    plan: PreparedVerificationPlan
  ): Promise<VerificationExecutionOutcome> {
    if (plan.kind === "command") {
      const result = await this.runCommand({
        command: plan.command,
        args: plan.args,
        cwd: plan.cwd,
        env: plan.env,
        timeoutMs: plan.timeoutMs
      });
      const passed = result.exitCode === plan.expectedExitCode;
      const summary = passed
        ? `${plan.summaryLabel}通过：命令以退出码 ${result.exitCode} 结束`
        : `${plan.summaryLabel}失败：命令退出码为 ${result.exitCode}，期望为 ${plan.expectedExitCode}`;

      return {
        status: passed ? "passed" : "failed",
        summary,
        artifactRefs: buildCommandArtifactRefs(result.stdout, result.stderr),
        result: {
          command: plan.command,
          args: plan.args,
          cwd: plan.cwd,
          exitCode: result.exitCode,
          expectedExitCode: plan.expectedExitCode,
          stdoutPreview: truncateText(result.stdout),
          stderrPreview: truncateText(result.stderr)
        }
      };
    }

    const result = await this.runHealthCheck(plan.url, plan.timeoutMs);
    const passed = plan.expectedStatus === null ? result.ok : result.statusCode === plan.expectedStatus;
    const summary = passed
      ? `健康检查通过：${plan.url} 返回 ${result.statusCode}`
      : `健康检查失败：${plan.url} 返回 ${result.statusCode}`;

    return {
      status: passed ? "passed" : "failed",
      summary,
      artifactRefs: [
        {
          kind: "http",
          url: plan.url,
          statusCode: result.statusCode,
          ok: result.ok
        }
      ],
      result: {
        url: plan.url,
        statusCode: result.statusCode,
        ok: result.ok,
        expectedStatus: plan.expectedStatus,
        responsePreview: truncateText(result.responseText)
      }
    };
  }

  private writeVerificationCheckpoint(
    butlerSession: ButlerSession,
    outcome: VerificationExecutionOutcome,
    capturedAt: string
  ): void {
    const progressState: ButlerCheckpointProgressState =
      outcome.status === "failed" ? "blocked" : outcome.status === "skipped" ? "unknown" : "done";
    this.sessionCheckpointRepository.create({
      id: createId(),
      butlerSessionId: butlerSession.id,
      checkpointSeq: this.sessionCheckpointRepository.getLatestSeq(butlerSession.id) + 1,
      sourceKind: "verification",
      progressState,
      summary: outcome.summary,
      riskFlags: outcome.status === "failed" ? [outcome.summary] : [],
      nextActions:
        outcome.status === "failed"
          ? ["检查验证结果并修复失败原因"]
          : ["记录验证结论并继续推进后续任务"],
      capturedAt
    });

    this.butlerSessionRepository.update({
      ...butlerSession,
      status: resolveNextSessionStatus(butlerSession.status, outcome.status),
      lastSummary: outcome.summary,
      lastCheckpointAt: capturedAt,
      updatedAt: capturedAt
    });
  }

  private getProjectOrThrow(projectId: string): ButlerProject {
    const project = this.butlerProjectRepository.findById(projectId);

    if (!project) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_PROJECT_NOT_FOUND",
        detail: "代码管家项目不存在"
      });
    }

    return project;
  }

  private getProjectSessionOrThrow(projectId: string, butlerSessionId: string): ButlerSession {
    const session = this.butlerSessionRepository.findById(butlerSessionId);

    if (!session || session.projectId !== projectId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_SESSION_NOT_FOUND",
        detail: "当前项目下不存在该会话",
        field: "butlerSessionId"
      });
    }

    return session;
  }

  private getRunRecordOrThrow(runId: string): VerificationRunRecord {
    const record = this.verificationRunRepository.findById(runId);

    if (!record) {
      throw new AppError({
        statusCode: 404,
        errorCode: "VERIFICATION_RUN_NOT_FOUND",
        detail: "验证记录不存在"
      });
    }

    return record;
  }

  private updateRunRecord(record: VerificationRunRecord): VerificationRunRecord {
    const updated = this.verificationRunRepository.update(record);

    if (!updated) {
      throw new AppError({
        statusCode: 500,
        errorCode: "VERIFICATION_RUN_UPDATE_FAILED",
        detail: "验证记录更新失败"
      });
    }

    return updated;
  }
}

function mapVerificationRunRecord(record: VerificationRunRecord): VerificationRunView {
  return {
    id: record.id,
    projectId: record.projectId,
    butlerSessionId: record.butlerSessionId,
    sourcePatrolRunId: record.sourcePatrolRunId,
    verificationType: normalizeVerificationType(record.verificationType),
    status: normalizeVerificationStatus(record.status),
    targetRef: record.targetRef,
    spec: parseJsonObject(record.specJson),
    artifactRefs: parseJsonArray(record.artifactRefsJson),
    result: parseJsonObject(record.resultJson),
    summary: record.summary,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    createdAt: record.createdAt
  };
}

function normalizeVerificationType(value: string | undefined): VerificationType {
  switch (value) {
    case "test":
    case "health":
    case "browser":
    case "visual":
    case "metric":
      return value;
    default:
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "verificationType 不支持",
        field: "verificationType"
      });
  }
}

function normalizeVerificationStatus(value: string): VerificationRunStatus {
  switch (value) {
    case "queued":
    case "running":
    case "passed":
    case "failed":
    case "skipped":
      return value;
    default:
      return "failed";
  }
}

function normalizeSpec(spec: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!spec) {
    return {};
  }

  return { ...spec };
}

function prepareVerificationPlan(
  project: ButlerProject,
  verificationType: VerificationType,
  targetRef: string | null,
  spec: Record<string, unknown>
): PreparedVerificationPlan {
  if (verificationType === "test") {
    return prepareCommandPlan(project, spec, "测试验证");
  }

  if (verificationType === "health") {
    if (typeof spec.command === "string") {
      return prepareCommandPlan(project, spec, "健康检查");
    }

    return {
      kind: "health-url",
      url: requireUrlTarget(targetRef),
      timeoutMs: readTimeoutMs(spec.timeoutMs, DEFAULT_HEALTH_TIMEOUT_MS),
      expectedStatus: readOptionalStatusCode(spec.expectedStatus)
    };
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "VERIFICATION_TYPE_UNSUPPORTED",
    detail: `当前阶段暂不支持 ${verificationType} 验证`
  });
}

function prepareCommandPlan(
  project: ButlerProject,
  spec: Record<string, unknown>,
  summaryLabel: string
): PreparedVerificationPlan {
  return {
    kind: "command",
    summaryLabel,
    command: requireSpecString(spec, "command", "spec.command 不能为空"),
    args: readStringArray(spec.args, "spec.args"),
    cwd: resolveVerificationCwd(project.repoRoot, spec.cwd, "spec.cwd"),
    env: readEnvironment(spec.env),
    timeoutMs: readTimeoutMs(spec.timeoutMs, DEFAULT_COMMAND_TIMEOUT_MS),
    expectedExitCode: readExpectedExitCode(spec.expectedExitCode)
  };
}

function requireSpecString(
  spec: Record<string, unknown>,
  field: string,
  detail: string
): string {
  const value = normalizeNullableText(spec[field]);

  if (!value) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail,
      field
    });
  }

  return value;
}

function readStringArray(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是字符串数组`,
      field
    });
  }

  return value.map((item) => item.trim());
}

function readEnvironment(value: unknown): NodeJS.ProcessEnv | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "spec.env 必须是键值对象",
      field: "spec.env"
    });
  }

  const env: NodeJS.ProcessEnv = {};

  for (const [key, envValue] of Object.entries(value)) {
    if (typeof envValue !== "string") {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "spec.env 的值必须是字符串",
        field: "spec.env"
      });
    }

    env[key] = envValue;
  }

  return env;
}

function readTimeoutMs(value: unknown, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "timeoutMs 必须是正整数",
      field: "spec.timeoutMs"
    });
  }

  return Math.trunc(numericValue);
}

function readExpectedExitCode(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "expectedExitCode 必须是整数",
      field: "spec.expectedExitCode"
    });
  }

  return numericValue;
}

function readOptionalStatusCode(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 100 || numericValue > 599) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "expectedStatus 必须是合法的 HTTP 状态码",
      field: "spec.expectedStatus"
    });
  }

  return numericValue;
}

function requireUrlTarget(targetRef: string | null): string {
  if (!targetRef) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "health 验证缺少 targetRef",
      field: "targetRef"
    });
  }

  try {
    const url = new URL(targetRef);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported");
    }

    return url.toString();
  } catch {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "targetRef 必须是合法的 HTTP/HTTPS 地址",
      field: "targetRef"
    });
  }
}

function resolveVerificationCwd(repoRoot: string, value: unknown, field: string): string {
  if (value === undefined || value === null || value === "") {
    return repoRoot;
  }

  if (typeof value !== "string") {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是字符串`,
      field
    });
  }

  const trimmed = value.trim();
  const resolved = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(repoRoot, trimmed);
  const relative = path.relative(repoRoot, resolved);
  const isInsideRepo =
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

  if (!isInsideRepo) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "验证执行目录必须位于项目仓库内",
      field
    });
  }

  return resolved;
}

function normalizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(raw: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      : [];
  } catch {
    return [];
  }
}

function buildCommandArtifactRefs(stdout: string, stderr: string): Array<Record<string, unknown>> {
  const refs: Array<Record<string, unknown>> = [];

  if (stdout.trim().length > 0) {
    refs.push({
      kind: "stdout",
      preview: truncateText(stdout)
    });
  }

  if (stderr.trim().length > 0) {
    refs.push({
      kind: "stderr",
      preview: truncateText(stderr)
    });
  }

  return refs;
}

function truncateText(value: string): string {
  if (value.length <= MAX_PREVIEW_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_PREVIEW_LENGTH)}...`;
}

function resolveNextSessionStatus(
  currentStatus: ButlerSession["status"],
  verificationStatus: Exclude<VerificationRunStatus, "queued" | "running">
): ButlerSession["status"] {
  if (verificationStatus === "failed") {
    return currentStatus === "closed" ? "closed" : "blocked";
  }

  if (currentStatus === "running" || currentStatus === "closed") {
    return currentStatus;
  }

  if (currentStatus === "failed" || currentStatus === "blocked") {
    return currentStatus;
  }

  return "idle";
}

async function runCommandExecution(
  input: CommandExecutionInput
): Promise<CommandExecutionResult> {
  const launch = resolveCommandLaunch(input.command, input.args);

  return await new Promise<CommandExecutionResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let completed = false;

    const child = spawn(launch.command, launch.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...(input.env ?? {})
      },
      shell: launch.shell,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const finish = (callback: () => void) => {
      if (completed) {
        return;
      }

      completed = true;
      clearTimeout(timer);
      callback();
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => {
        reject(new Error(`VERIFICATION_COMMAND_TIMEOUT:${input.command}`));
      });
    }, input.timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      finish(() => {
        reject(new Error(`VERIFICATION_COMMAND_FAILED:${error.message}`));
      });
    });

    child.on("close", (exitCode) => {
      finish(() => {
        resolve({
          exitCode: exitCode ?? 1,
          stdout,
          stderr
        });
      });
    });
  });
}

async function runHttpHealthCheck(url: string, timeoutMs: number): Promise<HealthExecutionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    const responseText = await response.text();

    return {
      statusCode: response.status,
      ok: response.ok,
      responseText
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`VERIFICATION_HEALTHCHECK_FAILED:${detail}`);
  } finally {
    clearTimeout(timer);
  }
}
