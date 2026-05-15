import fs from "node:fs";
import path from "node:path";

import { chromium, type Browser, type BrowserContext, type Download, type Page } from "playwright-core";

import type { HostConfig } from "../../config/env.js";
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

export interface ExecuteBrowserTaskInput {
  task: OfficeTask;
  profile: BrowserProfile;
  runContext?: TaskRunContext;
}

interface BrowserTaskAction {
  type: string;
  url?: string;
  selector?: string;
  value?: string;
  values?: string[];
  key?: string;
  filePath?: string;
  filePaths?: string[];
  fileName?: string;
  fullPage?: boolean;
  timeoutMs?: number;
}

interface BrowserTaskPayload {
  profileId?: string;
  startUrl?: string;
  actions?: BrowserTaskAction[];
}

export class PlaywrightBrowserExecutor {
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

  async execute(input: ExecuteBrowserTaskInput): Promise<BrowserExecutionResult> {
    const task = this.markTaskRunning(input.task);

    let context: BrowserContext | null = null;
    let browser: Browser | null = null;

    try {
      const payload = parseBrowserTaskPayload(task.inputJson);
      const actions = normalizeActions(payload);

      if (actions.length === 0) {
        throw new AppError({
          statusCode: 400,
          errorCode: "BROWSER_TASK_ACTIONS_REQUIRED",
          detail: "浏览器任务必须至少提供一个动作"
        });
      }

      if (input.profile.mode === "persistent") {
        const executablePath = requireBrowserExecutablePath(this.config, input.profile.engine);
        context = await chromium.launchPersistentContext(input.profile.userDataDir ?? "", {
          channel: undefined,
          executablePath,
          acceptDownloads: true,
          headless: true
        });
      } else {
        browser = await chromium.connectOverCDP(input.profile.cdpEndpoint ?? "");
        context = browser.contexts()[0] ?? await browser.newContext({ acceptDownloads: true });
      }

      const page = await ensurePage(context, payload.startUrl);
      const stepResults: BrowserStepResult[] = [];

      for (let index = 0; index < actions.length; index += 1) {
        ensureNotCancelled(input.runContext);
        const action = actions[index];
        const step = this.createStep(task, index + 1, action);
        const startedStep = this.startStep(step);

        try {
          const result = await this.executeAction(page, task, startedStep, action, input.runContext);
          this.finishStep(startedStep, result.outputJson);
          stepResults.push(result);
        } catch (error) {
          this.failStep(
            startedStep,
            error instanceof Error ? error.message : String(error)
          );
          throw error;
        }
      }

      const receipt = this.createReceipt(task, {
        stepCount: stepResults.length,
        finalUrl: page.url(),
        artifactCount: stepResults.flatMap((item) => item.artifactIds).length
      });
      const nextTask = this.markTaskSucceeded(task);

      return {
        task: nextTask,
        receipt,
        stepResults
      };
    } catch (error) {
      this.markTaskFailed(task, error instanceof Error ? error.message : "浏览器任务执行失败");

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError({
        statusCode: 500,
        errorCode: "BROWSER_TASK_EXECUTION_FAILED",
        detail: error instanceof Error ? error.message : "浏览器任务执行失败"
      });
    } finally {
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }
  }

  private async executeAction(
    page: Page,
    task: OfficeTask,
    step: OfficeTaskStep,
    action: BrowserTaskAction,
    runContext?: TaskRunContext
  ): Promise<BrowserStepResult> {
    const timeout = action.timeoutMs && action.timeoutMs > 0 ? action.timeoutMs : 15_000;
    ensureNotCancelled(runContext);

    switch (action.type) {
      case "goto": {
        await page.goto(requireString(action.url, "url"), { waitUntil: "domcontentloaded", timeout });
        ensureNotCancelled(runContext);
        return {
          step,
          artifactIds: [],
          outputJson: JSON.stringify({ currentUrl: page.url() })
        };
      }
      case "click": {
        await page.locator(requireString(action.selector, "selector")).click({ timeout });
        ensureNotCancelled(runContext);
        return {
          step,
          artifactIds: [],
          outputJson: JSON.stringify({ clicked: action.selector })
        };
      }
      case "fill": {
        await page.locator(requireString(action.selector, "selector")).fill(requireString(action.value, "value"), { timeout });
        ensureNotCancelled(runContext);
        return {
          step,
          artifactIds: [],
          outputJson: JSON.stringify({ filled: action.selector })
        };
      }
      case "press": {
        const key = requireString(action.key ?? action.value, "key");
        if (action.selector?.trim()) {
          await page.locator(action.selector.trim()).press(key, { timeout });
        } else {
          await page.keyboard.press(key);
        }
        ensureNotCancelled(runContext);

        return {
          step,
          artifactIds: [],
          outputJson: JSON.stringify({ key, selector: action.selector ?? null })
        };
      }
      case "select": {
        const selector = requireString(action.selector, "selector");
        const optionValues = normalizeStringArray(action.values, action.value, "value");
        await page.locator(selector).selectOption(optionValues, { timeout });
        ensureNotCancelled(runContext);
        return {
          step,
          artifactIds: [],
          outputJson: JSON.stringify({ selector, values: optionValues })
        };
      }
      case "upload": {
        const selector = requireString(action.selector, "selector");
        const filePaths = normalizeFilePaths(action.filePaths, action.filePath);
        await page.locator(selector).setInputFiles(filePaths, { timeout });
        ensureNotCancelled(runContext);
        return {
          step,
          artifactIds: [],
          outputJson: JSON.stringify({ selector, fileCount: filePaths.length })
        };
      }
      case "download": {
        const selector = requireString(action.selector, "selector");
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout }),
          page.locator(selector).click({ timeout })
        ]);
        ensureNotCancelled(runContext);
        const fileName = normalizeFileName(action.fileName, await download.suggestedFilename());
        const artifact = await this.createDownloadedArtifact(task, step, download, fileName);
        return {
          step,
          artifactIds: [artifact.id],
          outputJson: JSON.stringify({
            artifactId: artifact.id,
            selector,
            fileName
          })
        };
      }
      case "wait": {
        await page.waitForTimeout(timeout);
        ensureNotCancelled(runContext);
        return {
          step,
          artifactIds: [],
          outputJson: JSON.stringify({ waitedMs: timeout })
        };
      }
      case "read_dom":
      case "extract_text": {
        const bodyText = await page.locator("body").innerText({ timeout });
        ensureNotCancelled(runContext);
        const artifact = this.createArtifact(task, step, "dom_snapshot", "dom-snapshot.json", JSON.stringify({
          url: page.url(),
          text: bodyText
        }, null, 2), "application/json");
        return {
          step,
          artifactIds: [artifact.id],
          outputJson: JSON.stringify({ artifactId: artifact.id, textLength: bodyText.length })
        };
      }
      case "screenshot": {
        const screenshot = await page.screenshot({ fullPage: action.fullPage ?? true, type: "png", timeout });
        ensureNotCancelled(runContext);
        const artifact = this.createBinaryArtifact(task, step, "screenshot", `screenshot-${step.stepSeq}.png`, screenshot, "image/png");
        return {
          step,
          artifactIds: [artifact.id],
          outputJson: JSON.stringify({ artifactId: artifact.id, url: page.url() })
        };
      }
      default:
        throw new AppError({
          statusCode: 400,
          errorCode: "BROWSER_ACTION_NOT_SUPPORTED",
          detail: `暂不支持浏览器动作 ${action.type}`
        });
    }
  }

  private createStep(task: OfficeTask, stepSeq: number, action: BrowserTaskAction): OfficeTaskStep {
    const timestamp = nowIso();
    return this.officeTaskStepRepository.create({
      id: createId(),
      taskId: task.id,
      stepSeq,
      stepType: action.type,
      title: buildStepTitle(action),
      inputJson: JSON.stringify(action),
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
      actorId: "browser.playwright",
      summary: `浏览器步骤完成：${step.title}`,
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

  private createArtifact(
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
      metadataJson: JSON.stringify({ size: Buffer.byteLength(content), stepSeq: step.stepSeq }),
      createdAt: nowIso()
    });

    this.recordArtifactAudit(task.id, step.id, artifact);
    return artifact;
  }

  private createBinaryArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    kind: OfficeArtifact["kind"],
    fileName: string,
    content: Buffer,
    contentType: string
  ): OfficeArtifact {
    const targetDir = this.ensureArtifactDir(task.id);
    const artifactId = createId();
    const storagePath = path.join(targetDir, `${artifactId}-${fileName}`);
    fs.writeFileSync(storagePath, content);

    const artifact = this.officeArtifactRepository.create({
      id: artifactId,
      taskId: task.id,
      stepId: step.id,
      kind,
      name: fileName,
      storagePath,
      contentType,
      metadataJson: JSON.stringify({ size: content.byteLength, stepSeq: step.stepSeq }),
      createdAt: nowIso()
    });

    this.recordArtifactAudit(task.id, step.id, artifact);
    return artifact;
  }

  private async createDownloadedArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    download: Download,
    fileName: string
  ): Promise<OfficeArtifact> {
    const targetDir = this.ensureArtifactDir(task.id);
    const artifactId = createId();
    const storagePath = path.join(targetDir, `${artifactId}-${fileName}`);
    await download.saveAs(storagePath);
    const stats = fs.statSync(storagePath);

    const artifact = this.officeArtifactRepository.create({
      id: artifactId,
      taskId: task.id,
      stepId: step.id,
      kind: "downloaded_file",
      name: fileName,
      storagePath,
      contentType: null,
      metadataJson: JSON.stringify({
        size: stats.size,
        stepSeq: step.stepSeq,
        suggestedFileName: await download.suggestedFilename()
      }),
      createdAt: nowIso()
    });

    this.recordArtifactAudit(task.id, step.id, artifact);
    return artifact;
  }

  private createReceipt(task: OfficeTask, payload: Record<string, unknown>): OfficeReceipt {
    return this.officeReceiptRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      receiptType: "browser_execution",
      summary: "浏览器任务执行完成",
      payloadJson: JSON.stringify(payload),
      createdAt: nowIso()
    });
  }

  private markTaskRunning(task: OfficeTask): OfficeTask {
    const timestamp = nowIso();
    const next = this.officeTaskRepository.update({
      ...task,
      status: "running",
      startedAt: task.startedAt ?? timestamp,
      updatedAt: timestamp
    });

    this.officeAuditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      eventKind: "task_started",
      actorKind: "connector",
      actorId: "browser.playwright",
      summary: "浏览器任务开始执行",
      payloadJson: null,
      createdAt: timestamp
    });

    return next;
  }

  private markTaskSucceeded(task: OfficeTask): OfficeTask {
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
      actorId: "browser.playwright",
      summary: "浏览器任务执行成功",
      payloadJson: JSON.stringify({ status: "succeeded" }),
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
      actorId: "browser.playwright",
      summary: "浏览器任务执行失败",
      payloadJson: JSON.stringify({ status: "failed", reason }),
      createdAt: timestamp
    });

    return next;
  }

  private recordArtifactAudit(taskId: string, stepId: string, artifact: OfficeArtifact): void {
    this.officeAuditEventRepository.create({
      id: createId(),
      taskId,
      stepId,
      eventKind: "artifact_created",
      actorKind: "connector",
      actorId: "browser.playwright",
      summary: `生成浏览器产物：${artifact.name}`,
      payloadJson: JSON.stringify({ artifactId: artifact.id, kind: artifact.kind }),
      createdAt: artifact.createdAt
    });
  }

  private ensureArtifactDir(taskId: string): string {
    const targetDir = path.join(this.artifactRoot, taskId);
    fs.mkdirSync(targetDir, { recursive: true });
    return targetDir;
  }
}

export interface BrowserExecutionResult {
  task: OfficeTask;
  receipt: OfficeReceipt;
  stepResults: BrowserStepResult[];
}

interface BrowserStepResult {
  step: OfficeTaskStep;
  artifactIds: string[];
  outputJson: string;
}

function parseBrowserTaskPayload(raw: string): BrowserTaskPayload {
  try {
    return JSON.parse(raw) as BrowserTaskPayload;
  } catch {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_BROWSER_TASK_INPUT",
      detail: "浏览器任务输入格式不合法"
    });
  }
}

function normalizeActions(payload: BrowserTaskPayload): BrowserTaskAction[] {
  if (!Array.isArray(payload.actions)) {
    return [];
  }

  return payload.actions.filter((item): item is BrowserTaskAction => Boolean(item && typeof item.type === "string"));
}

async function ensurePage(context: BrowserContext, startUrl?: string): Promise<Page> {
  const page = context.pages()[0] ?? await context.newPage();
  if (startUrl?.trim()) {
    await page.goto(startUrl.trim(), { waitUntil: "domcontentloaded" });
  }

  return page;
}

function resolveBrowserExecutablePath(config: HostConfig, engine: BrowserProfile["engine"]): string {
  return engine === "chrome" ? config.chromeExecutablePath : config.edgeExecutablePath;
}

function requireBrowserExecutablePath(config: HostConfig, engine: BrowserProfile["engine"]): string {
  const executablePath = resolveBrowserExecutablePath(config, engine).trim();
  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new AppError({
      statusCode: 409,
      errorCode: "BROWSER_EXECUTABLE_NOT_FOUND",
      detail: `未找到可用的 ${engine === "chrome" ? "Chrome" : "Edge"} 可执行文件`
    });
  }

  return executablePath;
}

function requireString(value: string | undefined, field: string): string {
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

function normalizeStringArray(values: string[] | undefined, singleValue: string | undefined, field: string): string[] {
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

function normalizeFilePaths(filePaths: string[] | undefined, singleFilePath: string | undefined): string[] {
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

function normalizeFileName(fileName: string | undefined, fallback: string): string {
  const candidate = fileName?.trim() || fallback.trim();
  return candidate.replace(/[\\/]/g, "_") || "download.bin";
}

function buildStepTitle(action: BrowserTaskAction): string {
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

function ensureNotCancelled(runContext?: TaskRunContext): void {
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
