import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { OfficeArtifactRepository } from "../../storage/repositories/office-artifact-repository.js";
import type { OfficeAuditEventRepository } from "../../storage/repositories/office-audit-event-repository.js";
import type { OfficeReceiptRepository } from "../../storage/repositories/office-receipt-repository.js";
import type { OfficeTaskRepository } from "../../storage/repositories/office-task-repository.js";
import type { OfficeTaskStepRepository } from "../../storage/repositories/office-task-step-repository.js";
import type { BrowserProfile, OfficeArtifact, OfficeReceipt, OfficeTask, OfficeTaskStep } from "../../types/domain.js";
import { TaskCancelledError, type TaskRunContext } from "../tasks/task-types.js";
import type {
  BrowserStepResult,
  BrowserTaskArtifactInput,
  BrowserTaskExecutionReceiptPayload,
  BrowserTaskStepLifecyclePort
} from "./browser-task-executor.js";
import type { BrowserExecutionBackend, BrowserTaskAction, BrowserTaskPayload } from "./browser-task-payload.js";
import { parseBrowserTaskPayload } from "./browser-task-payload.js";

export interface BrowserTaskExecutionPersistenceDeps {
  databasePath: string;
  officeTaskRepository: OfficeTaskRepository;
  officeTaskStepRepository: OfficeTaskStepRepository;
  officeArtifactRepository: OfficeArtifactRepository;
  officeReceiptRepository: OfficeReceiptRepository;
  officeAuditEventRepository: OfficeAuditEventRepository;
}

export class BrowserTaskExecutionPersistence implements BrowserTaskStepLifecyclePort {
  private readonly artifactRoot: string;

  constructor(
    private readonly backend: BrowserExecutionBackend,
    private readonly deps: BrowserTaskExecutionPersistenceDeps
  ) {
    this.artifactRoot = path.join(path.dirname(deps.databasePath), "office-artifacts");
  }

  markTaskRunning(task: OfficeTask): OfficeTask {
    const timestamp = nowIso();
    const next = this.deps.officeTaskRepository.update({
      ...task,
      status: "running",
      startedAt: task.startedAt ?? timestamp,
      finishedAt: null,
      updatedAt: timestamp
    });

    this.deps.officeAuditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      eventKind: "task_started",
      actorKind: "connector",
      actorId: buildBrowserConnectorActorId(this.backend),
      summary: "浏览器任务开始执行",
      payloadJson: JSON.stringify({ executionBackend: this.backend }),
      createdAt: timestamp
    });

    return next;
  }

  markTaskSucceeded(task: OfficeTask, payload: BrowserTaskExecutionReceiptPayload): {
    task: OfficeTask;
    receipt: OfficeReceipt;
  } {
    const timestamp = nowIso();
    const nextTask = this.deps.officeTaskRepository.update({
      ...task,
      status: "succeeded",
      finishedAt: timestamp,
      updatedAt: timestamp
    });
    const receipt = this.deps.officeReceiptRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      receiptType: "browser_execution",
      summary: "浏览器任务执行完成",
      payloadJson: JSON.stringify(payload),
      createdAt: timestamp
    });

    this.deps.officeAuditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      eventKind: "task_finished",
      actorKind: "connector",
      actorId: buildBrowserConnectorActorId(this.backend),
      summary: "浏览器任务执行成功",
      payloadJson: JSON.stringify({
        status: "succeeded",
        executionBackend: this.backend
      }),
      createdAt: timestamp
    });

    return {
      task: nextTask,
      receipt
    };
  }

  markTaskFailed(task: OfficeTask, reason: string): OfficeTask {
    const timestamp = nowIso();
    const next = this.deps.officeTaskRepository.update({
      ...task,
      status: "failed",
      finishedAt: timestamp,
      updatedAt: timestamp
    });

    this.deps.officeAuditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      eventKind: "task_finished",
      actorKind: "connector",
      actorId: buildBrowserConnectorActorId(this.backend),
      summary: "浏览器任务执行失败",
      payloadJson: JSON.stringify({
        status: "failed",
        reason,
        executionBackend: this.backend
      }),
      createdAt: timestamp
    });

    return next;
  }

  createStep(task: OfficeTask, stepSeq: number, action: BrowserTaskAction): OfficeTaskStep {
    const timestamp = nowIso();
    return this.deps.officeTaskStepRepository.create({
      id: createId(),
      taskId: task.id,
      stepSeq,
      stepType: action.type,
      title: buildStepTitle(action),
      inputJson: JSON.stringify({
        ...action,
        executionBackend: this.backend
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

  startStep(step: OfficeTaskStep): OfficeTaskStep {
    const timestamp = nowIso();
    return this.deps.officeTaskStepRepository.update({
      ...step,
      status: "running",
      startedAt: timestamp,
      updatedAt: timestamp
    });
  }

  finishStep(step: OfficeTaskStep, outputJson: string): OfficeTaskStep {
    const timestamp = nowIso();
    const next = this.deps.officeTaskStepRepository.update({
      ...step,
      status: "succeeded",
      outputJson,
      finishedAt: timestamp,
      updatedAt: timestamp
    });

    this.deps.officeAuditEventRepository.create({
      id: createId(),
      taskId: step.taskId,
      stepId: step.id,
      eventKind: "task_updated",
      actorKind: "connector",
      actorId: buildBrowserConnectorActorId(this.backend),
      summary: `浏览器步骤完成：${step.title}`,
      payloadJson: outputJson,
      createdAt: timestamp
    });

    return next;
  }

  failStep(step: OfficeTaskStep, errorMessage: string): OfficeTaskStep {
    const timestamp = nowIso();
    return this.deps.officeTaskStepRepository.update({
      ...step,
      status: "failed",
      errorMessage,
      finishedAt: timestamp,
      updatedAt: timestamp
    });
  }

  createTextArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    input: BrowserTaskArtifactInput & { content: string }
  ): OfficeArtifact {
    const targetDir = this.ensureArtifactDir(task.id);
    const artifactId = createId();
    const storagePath = path.join(targetDir, `${artifactId}-${input.fileName}`);
    fs.writeFileSync(storagePath, input.content, "utf8");

    const artifact = this.deps.officeArtifactRepository.create({
      id: artifactId,
      taskId: task.id,
      stepId: step.id,
      kind: input.kind,
      name: input.fileName,
      storagePath,
      contentType: input.contentType,
      metadataJson: JSON.stringify({
        size: Buffer.byteLength(input.content),
        stepSeq: step.stepSeq,
        executionBackend: this.backend
      }),
      createdAt: nowIso()
    });

    this.recordArtifactAudit(task.id, step.id, artifact);
    return artifact;
  }

  createBinaryArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    input: BrowserTaskArtifactInput & { content: Buffer }
  ): OfficeArtifact {
    const targetDir = this.ensureArtifactDir(task.id);
    const artifactId = createId();
    const storagePath = path.join(targetDir, `${artifactId}-${input.fileName}`);
    fs.writeFileSync(storagePath, input.content);

    const artifact = this.deps.officeArtifactRepository.create({
      id: artifactId,
      taskId: task.id,
      stepId: step.id,
      kind: input.kind,
      name: input.fileName,
      storagePath,
      contentType: input.contentType,
      metadataJson: JSON.stringify({
        size: input.content.byteLength,
        stepSeq: step.stepSeq,
        executionBackend: this.backend
      }),
      createdAt: nowIso()
    });

    this.recordArtifactAudit(task.id, step.id, artifact);
    return artifact;
  }

  createFileArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    input: BrowserTaskArtifactInput & {
      sourceFilePath: string;
      metadata?: Record<string, unknown>;
    }
  ): OfficeArtifact {
    const targetDir = this.ensureArtifactDir(task.id);
    const artifactId = createId();
    const storagePath = path.join(targetDir, `${artifactId}-${input.fileName}`);
    fs.copyFileSync(input.sourceFilePath, storagePath);
    const stats = fs.statSync(storagePath);

    const artifact = this.deps.officeArtifactRepository.create({
      id: artifactId,
      taskId: task.id,
      stepId: step.id,
      kind: input.kind,
      name: input.fileName,
      storagePath,
      contentType: input.contentType,
      metadataJson: JSON.stringify({
        size: stats.size,
        stepSeq: step.stepSeq,
        executionBackend: this.backend,
        ...(input.metadata ?? {})
      }),
      createdAt: nowIso()
    });

    this.recordArtifactAudit(task.id, step.id, artifact);
    return artifact;
  }

  private recordArtifactAudit(taskId: string, stepId: string, artifact: OfficeArtifact): void {
    this.deps.officeAuditEventRepository.create({
      id: createId(),
      taskId,
      stepId,
      eventKind: "artifact_created",
      actorKind: "connector",
      actorId: buildBrowserConnectorActorId(this.backend),
      summary: `生成浏览器产物：${artifact.name}`,
      payloadJson: JSON.stringify({
        artifactId: artifact.id,
        kind: artifact.kind,
        executionBackend: this.backend
      }),
      createdAt: artifact.createdAt
    });
  }

  private ensureArtifactDir(taskId: string): string {
    const targetDir = path.join(this.artifactRoot, taskId);
    fs.mkdirSync(targetDir, { recursive: true });
    return targetDir;
  }
}

export async function runBrowserTaskActions(
  input: {
    task: OfficeTask;
    payload: BrowserTaskPayload;
    backend: BrowserExecutionBackend;
    runContext?: TaskRunContext;
    lifecycle: BrowserTaskStepLifecyclePort;
    executeAction: (
      action: BrowserTaskAction,
      step: OfficeTaskStep,
      runContext?: TaskRunContext
    ) => Promise<BrowserStepResult>;
    getFinalUrl: () => string | null | Promise<string | null>;
  }
): Promise<{
  task: OfficeTask;
  receipt: OfficeReceipt;
  stepResults: BrowserStepResult[];
}> {
  const normalizedPayload = parseBrowserTaskPayload(JSON.stringify(input.payload));
  const actions = normalizeActions(normalizedPayload);
  const runningTask = input.lifecycle.markTaskRunning(input.task);

  try {
    if (actions.length === 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "BROWSER_TASK_ACTIONS_REQUIRED",
        detail: "浏览器任务必须至少提供一个动作"
      });
    }

    const stepResults: BrowserStepResult[] = [];

    for (let index = 0; index < actions.length; index += 1) {
      ensureNotCancelled(input.runContext);
      const action = actions[index];
      const step = input.lifecycle.createStep(runningTask, index + 1, action);
      const startedStep = input.lifecycle.startStep(step);

      try {
        const result = await input.executeAction(action, startedStep, input.runContext);
        input.lifecycle.finishStep(startedStep, result.outputJson);
        stepResults.push(result);
      } catch (error) {
        input.lifecycle.failStep(
          startedStep,
          error instanceof Error ? error.message : String(error)
        );
        throw error;
      }
    }

    const finished = input.lifecycle.markTaskSucceeded(runningTask, {
      executionBackend: input.backend,
      stepCount: stepResults.length,
      finalUrl: await input.getFinalUrl(),
      artifactCount: stepResults.flatMap((item) => item.artifactIds).length
    });

    return {
      task: finished.task,
      receipt: finished.receipt,
      stepResults
    };
  } catch (error) {
    input.lifecycle.markTaskFailed(
      runningTask,
      error instanceof Error ? error.message : "浏览器任务执行失败"
    );

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError({
      statusCode: 500,
      errorCode: "BROWSER_TASK_EXECUTION_FAILED",
      detail: error instanceof Error ? error.message : "浏览器任务执行失败"
    });
  }
}

export function ensureBrowserExecutablePath(databasePath: string, configPath: string, engine: BrowserProfile["engine"]): string {
  void databasePath;
  const executablePath = configPath.trim();
  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new AppError({
      statusCode: 409,
      errorCode: "BROWSER_EXECUTABLE_NOT_FOUND",
      detail: `未找到可用的 ${engine === "chrome" ? "Chrome" : "Edge"} 可执行文件`
    });
  }

  return executablePath;
}

export function requireString(value: string | undefined, field: string): string {
  if (!value?.trim()) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_BROWSER_ACTION",
      detail: `浏览器动作缺少 ${field}`,
      field
    });
  }

  return value.trim();
}

export function normalizeStringArray(values: string[] | undefined, singleValue: string | undefined, field: string): string[] {
  const normalizedValues = Array.isArray(values)
    ? values.map((item) => item.trim()).filter((item) => item.length > 0)
    : [];

  if (normalizedValues.length > 0) {
    return normalizedValues;
  }

  if (singleValue?.trim()) {
    return [singleValue.trim()];
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_BROWSER_ACTION",
    detail: `浏览器动作缺少 ${field}`,
    field
  });
}

export function normalizeFilePaths(filePaths: string[] | undefined, singleFilePath: string | undefined): string[] {
  const normalizedPaths = Array.isArray(filePaths)
    ? filePaths.map((item) => path.resolve(item.trim())).filter((item) => item.length > 0)
    : [];

  if (normalizedPaths.length > 0) {
    ensureFilesExist(normalizedPaths);
    return normalizedPaths;
  }

  if (singleFilePath?.trim()) {
    const resolved = [path.resolve(singleFilePath.trim())];
    ensureFilesExist(resolved);
    return resolved;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_BROWSER_ACTION",
    detail: "上传动作缺少 filePath 或 filePaths",
    field: "filePath"
  });
}

export function normalizeFileName(fileName: string | undefined, fallback: string): string {
  const candidate = fileName?.trim() || fallback.trim();
  return candidate.replace(/[\\/]/g, "_") || "download.bin";
}

export function buildStepTitle(action: BrowserTaskAction): string {
  switch (action.type) {
    case "goto":
      return `打开页面 ${action.url ?? ""}`.trim();
    case "click":
      return `点击 ${action.selector ?? ""}`.trim();
    case "fill":
      return `填写 ${action.selector ?? ""}`.trim();
    case "press":
      return `按键 ${action.key ?? action.value ?? ""}`.trim();
    case "select":
      return `选择 ${action.selector ?? ""}`.trim();
    case "upload":
      return `上传文件 ${action.selector ?? ""}`.trim();
    case "download":
      return `下载文件 ${action.selector ?? ""}`.trim();
    case "wait":
      return "等待页面";
    case "read_dom":
      return "读取 DOM";
    case "extract_text":
      return "提取文本";
    case "screenshot":
      return "截图";
    default:
      return `执行 ${action.type}`;
  }
}

export function ensureNotCancelled(runContext?: TaskRunContext): void {
  if (!runContext?.signal.aborted) {
    return;
  }

  const reason = runContext.signal.reason;
  if (reason instanceof TaskCancelledError) {
    throw reason;
  }

  throw new TaskCancelledError(
    reason instanceof Error ? reason.message : "浏览器任务已取消"
  );
}

function normalizeActions(payload: BrowserTaskPayload): BrowserTaskAction[] {
  if (!Array.isArray(payload.actions)) {
    return [];
  }

  return payload.actions.filter((item): item is BrowserTaskAction => Boolean(item && typeof item.type === "string"));
}

function ensureFilesExist(filePaths: string[]): void {
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "BROWSER_UPLOAD_FILE_NOT_FOUND",
        detail: `上传文件不存在：${filePath}`,
        field: "filePath"
      });
    }
  }
}

function buildBrowserConnectorActorId(backend: BrowserExecutionBackend): string {
  return backend === "opencli_bridge" ? "browser.opencli_bridge" : "browser.playwright";
}
