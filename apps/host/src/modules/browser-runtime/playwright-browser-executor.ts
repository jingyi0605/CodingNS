import { chromium, type Browser, type BrowserContext, type Download, type Page } from "playwright-core";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { OfficeArtifactRepository } from "../../storage/repositories/office-artifact-repository.js";
import type { OfficeAuditEventRepository } from "../../storage/repositories/office-audit-event-repository.js";
import type { OfficeReceiptRepository } from "../../storage/repositories/office-receipt-repository.js";
import type { OfficeTaskRepository } from "../../storage/repositories/office-task-repository.js";
import type { OfficeTaskStepRepository } from "../../storage/repositories/office-task-step-repository.js";
import type { BrowserProfile } from "../../types/domain.js";
import type {
  BrowserExecutionResult,
  BrowserStepResult,
  BrowserTaskExecutor,
  ExecuteBrowserTaskInput
} from "./browser-task-executor.js";
import {
  BrowserTaskExecutionPersistence,
  ensureBrowserExecutablePath,
  ensureNotCancelled,
  normalizeFileName,
  normalizeFilePaths,
  normalizeStringArray,
  requireString,
  runBrowserTaskActions
} from "./browser-task-execution-support.js";
import { parseBrowserTaskPayload, type BrowserTaskAction } from "./browser-task-payload.js";

export class PlaywrightBrowserExecutor implements BrowserTaskExecutor {
  readonly backend = "playwright" as const;

  private readonly persistence: BrowserTaskExecutionPersistence;

  constructor(
    private readonly config: HostConfig,
    officeTaskRepository: OfficeTaskRepository,
    officeTaskStepRepository: OfficeTaskStepRepository,
    officeArtifactRepository: OfficeArtifactRepository,
    officeReceiptRepository: OfficeReceiptRepository,
    officeAuditEventRepository: OfficeAuditEventRepository
  ) {
    this.persistence = new BrowserTaskExecutionPersistence(this.backend, {
      databasePath: config.databasePath,
      officeTaskRepository,
      officeTaskStepRepository,
      officeArtifactRepository,
      officeReceiptRepository,
      officeAuditEventRepository
    });
  }

  async execute(input: ExecuteBrowserTaskInput): Promise<BrowserExecutionResult> {
    let context: BrowserContext | null = null;
    let browser: Browser | null = null;

    try {
      const profile = requireBrowserProfile(input.profile);
      const payload = parseBrowserTaskPayload(input.task.inputJson);

      if (profile.mode === "persistent") {
        const executablePath = requireBrowserExecutablePath(this.config, profile.engine);
        context = await chromium.launchPersistentContext(profile.userDataDir ?? "", {
          channel: undefined,
          executablePath,
          acceptDownloads: true,
          headless: true
        });
      } else {
        browser = await chromium.connectOverCDP(profile.cdpEndpoint ?? "");
        context = browser.contexts()[0] ?? await browser.newContext({ acceptDownloads: true });
      }

      const page = await ensurePage(context, payload.startUrl);

      return await runBrowserTaskActions({
        task: input.task,
        payload: {
          ...payload,
          executionBackend: this.backend
        },
        backend: this.backend,
        runContext: input.runContext,
        lifecycle: this.persistence,
        executeAction: async (action, step, runContext) => {
          return await this.executeAction(page, input.task, step, action, runContext);
        },
        getFinalUrl: () => page.url()
      });
    } finally {
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }
  }

  private async executeAction(
    page: Page,
    task: ExecuteBrowserTaskInput["task"],
    step: BrowserStepResult["step"],
    action: BrowserTaskAction,
    runContext?: ExecuteBrowserTaskInput["runContext"]
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
          outputJson: JSON.stringify({
            currentUrl: page.url(),
            executionBackend: this.backend
          })
        };
      }
      case "click": {
        await page.locator(requireString(action.selector, "selector")).click({ timeout });
        ensureNotCancelled(runContext);
        return {
          step,
          artifactIds: [],
          outputJson: JSON.stringify({
            clicked: action.selector,
            executionBackend: this.backend
          })
        };
      }
      case "fill": {
        await page.locator(requireString(action.selector, "selector")).fill(requireString(action.value, "value"), { timeout });
        ensureNotCancelled(runContext);
        return {
          step,
          artifactIds: [],
          outputJson: JSON.stringify({
            filled: action.selector,
            executionBackend: this.backend
          })
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
          outputJson: JSON.stringify({
            key,
            selector: action.selector ?? null,
            executionBackend: this.backend
          })
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
          outputJson: JSON.stringify({
            selector,
            values: optionValues,
            executionBackend: this.backend
          })
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
          outputJson: JSON.stringify({
            selector,
            fileCount: filePaths.length,
            executionBackend: this.backend
          })
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
            fileName,
            executionBackend: this.backend
          })
        };
      }
      case "wait": {
        await page.waitForTimeout(timeout);
        ensureNotCancelled(runContext);
        return {
          step,
          artifactIds: [],
          outputJson: JSON.stringify({
            waitedMs: timeout,
            executionBackend: this.backend
          })
        };
      }
      case "read_dom":
      case "extract_text": {
        const bodyText = await page.locator("body").innerText({ timeout });
        ensureNotCancelled(runContext);
        const artifact = this.persistence.createTextArtifact(task, step, {
          kind: "dom_snapshot",
          fileName: "dom-snapshot.json",
          contentType: "application/json",
          content: JSON.stringify({
            url: page.url(),
            text: bodyText,
            executionBackend: this.backend
          }, null, 2)
        });
        return {
          step,
          artifactIds: [artifact.id],
          outputJson: JSON.stringify({
            artifactId: artifact.id,
            textLength: bodyText.length,
            executionBackend: this.backend
          })
        };
      }
      case "screenshot": {
        const screenshot = await page.screenshot({ fullPage: action.fullPage ?? true, type: "png", timeout });
        ensureNotCancelled(runContext);
        const artifact = this.persistence.createBinaryArtifact(task, step, {
          kind: "screenshot",
          fileName: `screenshot-${step.stepSeq}.png`,
          contentType: "image/png",
          content: screenshot
        });
        return {
          step,
          artifactIds: [artifact.id],
          outputJson: JSON.stringify({
            artifactId: artifact.id,
            url: page.url(),
            executionBackend: this.backend
          })
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

  private async createDownloadedArtifact(
    task: ExecuteBrowserTaskInput["task"],
    step: BrowserStepResult["step"],
    download: Download,
    fileName: string
  ) {
    const temporaryPath = await download.path();

    if (!temporaryPath) {
      throw new AppError({
        statusCode: 500,
        errorCode: "BROWSER_DOWNLOAD_PATH_UNAVAILABLE",
        detail: "下载文件路径不可用"
      });
    }

    return this.persistence.createFileArtifact(task, step, {
      kind: "downloaded_file",
      fileName,
      contentType: null,
      sourceFilePath: temporaryPath,
      metadata: {
        suggestedFileName: await download.suggestedFilename()
      }
    });
  }
}

async function ensurePage(context: BrowserContext, startUrl?: string): Promise<Page> {
  const page = context.pages()[0] ?? await context.newPage();
  if (startUrl?.trim()) {
    await page.goto(startUrl.trim(), { waitUntil: "domcontentloaded" });
  }

  return page;
}

function requireBrowserProfile(profile: ExecuteBrowserTaskInput["profile"]): BrowserProfile {
  if (!profile) {
    throw new AppError({
      statusCode: 500,
      errorCode: "BROWSER_PROFILE_REQUIRED",
      detail: "playwright 执行器缺少浏览器 Profile"
    });
  }

  return profile;
}

function requireBrowserExecutablePath(config: HostConfig, engine: BrowserProfile["engine"]): string {
  return ensureBrowserExecutablePath(
    config.databasePath,
    engine === "chrome" ? config.chromeExecutablePath : config.edgeExecutablePath,
    engine
  );
}
