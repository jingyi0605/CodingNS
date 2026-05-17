import path from "node:path";
import { pathToFileURL } from "node:url";

import { AppError } from "../../shared/errors/app-error.js";
import { OpenCliInstallDiscovery } from "../opencli/opencli-install-discovery.js";
import type { OpenCliHealthService } from "../opencli/opencli-health-service.js";
import type { OfficeArtifactRepository } from "../../storage/repositories/office-artifact-repository.js";
import type { OfficeAuditEventRepository } from "../../storage/repositories/office-audit-event-repository.js";
import type { OfficeReceiptRepository } from "../../storage/repositories/office-receipt-repository.js";
import type { OfficeTaskRepository } from "../../storage/repositories/office-task-repository.js";
import type { OfficeTaskStepRepository } from "../../storage/repositories/office-task-step-repository.js";
import type {
  BrowserExecutionResult,
  BrowserStepResult,
  BrowserTaskExecutor,
  ExecuteBrowserTaskInput
} from "./browser-task-executor.js";
import {
  BrowserTaskExecutionPersistence,
  ensureNotCancelled,
  normalizeFilePaths,
  requireString,
  runBrowserTaskActions
} from "./browser-task-execution-support.js";
import { parseBrowserTaskPayload, type BrowserTaskAction } from "./browser-task-payload.js";
import { OpenCliBrowserBridgeService } from "./opencli-browser-bridge-service.js";

interface OpenCliPageLike {
  goto(url: string, options?: { waitUntil?: string; settleMs?: number }): Promise<void>;
  click(ref: string): Promise<unknown>;
  typeText(ref: string, text: string): Promise<unknown>;
  pressKey(key: string): Promise<void>;
  evaluate(js: string): Promise<unknown>;
  snapshot(options?: { raw?: boolean }): Promise<unknown>;
  screenshot(options?: { fullPage?: boolean; path?: string; format?: string }): Promise<string>;
  wait(options: number | { selector?: string; text?: string; timeout?: number; time?: number }): Promise<void>;
  setFileInput(files: string[], selector: string): Promise<void>;
  getCurrentUrl(): Promise<string | null>;
}

export class OpenCliBridgeBrowserExecutor implements BrowserTaskExecutor {
  readonly backend = "opencli_bridge" as const;

  private readonly persistence: BrowserTaskExecutionPersistence;
  private readonly bridgeStatusService: OpenCliBrowserBridgeService;
  private readonly installDiscovery: OpenCliInstallDiscovery;

  constructor(
    databasePath: string,
    officeTaskRepository: OfficeTaskRepository,
    officeTaskStepRepository: OfficeTaskStepRepository,
    officeArtifactRepository: OfficeArtifactRepository,
    officeReceiptRepository: OfficeReceiptRepository,
    officeAuditEventRepository: OfficeAuditEventRepository,
    openCliHealthService: OpenCliHealthService,
    installDiscovery: OpenCliInstallDiscovery = new OpenCliInstallDiscovery()
  ) {
    this.persistence = new BrowserTaskExecutionPersistence(this.backend, {
      databasePath,
      officeTaskRepository,
      officeTaskStepRepository,
      officeArtifactRepository,
      officeReceiptRepository,
      officeAuditEventRepository
    });
    this.bridgeStatusService = new OpenCliBrowserBridgeService(openCliHealthService);
    this.installDiscovery = installDiscovery;
  }

  async execute(input: ExecuteBrowserTaskInput): Promise<BrowserExecutionResult> {
    await this.ensureBridgeReady();
    const payload = parseBrowserTaskPayload(input.task.inputJson);
    const page = await this.createPage();

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
      getFinalUrl: () => page.getCurrentUrl()
    });
  }

  private async executeAction(
    page: OpenCliPageLike,
    task: ExecuteBrowserTaskInput["task"],
    step: BrowserStepResult["step"],
    action: BrowserTaskAction,
    runContext?: ExecuteBrowserTaskInput["runContext"]
  ): Promise<BrowserStepResult> {
    const timeout = action.timeoutMs && action.timeoutMs > 0 ? action.timeoutMs : 15_000;
    ensureNotCancelled(runContext);

    switch (action.type) {
      case "goto": {
        await page.goto(requireString(action.url, "url"), {
          waitUntil: "domcontentloaded",
          settleMs: timeout
        });
        return {
          step,
          artifactIds: [],
          outputJson: JSON.stringify({
            currentUrl: await page.getCurrentUrl(),
            executionBackend: this.backend
          })
        };
      }
      case "click": {
        await page.click(requireString(action.selector, "selector"));
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
        await page.typeText(requireString(action.selector, "selector"), requireString(action.value, "value"));
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
          await page.click(action.selector.trim());
        }
        await page.pressKey(key);
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
      case "upload": {
        const selector = requireString(action.selector, "selector");
        const files = normalizeFilePaths(action.filePaths, action.filePath);
        await page.setFileInput(files, selector);
        return {
          step,
          artifactIds: [],
          outputJson: JSON.stringify({
            selector,
            fileCount: files.length,
            executionBackend: this.backend
          })
        };
      }
      case "wait": {
        await page.wait({ time: timeout / 1000 });
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
        const bodyText = await page.evaluate("document.body ? document.body.innerText : ''");
        const currentUrl = await page.getCurrentUrl();
        const artifact = this.persistence.createTextArtifact(task, step, {
          kind: "dom_snapshot",
          fileName: "dom-snapshot.json",
          contentType: "application/json",
          content: JSON.stringify({
            url: currentUrl,
            text: typeof bodyText === "string" ? bodyText : String(bodyText ?? ""),
            executionBackend: this.backend
          }, null, 2)
        });
        return {
          step,
          artifactIds: [artifact.id],
          outputJson: JSON.stringify({
            artifactId: artifact.id,
            textLength: typeof bodyText === "string" ? bodyText.length : String(bodyText ?? "").length,
            executionBackend: this.backend
          })
        };
      }
      case "screenshot": {
        const base64 = await page.screenshot({
          fullPage: action.fullPage ?? true,
          format: "png"
        });
        const artifact = this.persistence.createBinaryArtifact(task, step, {
          kind: "screenshot",
          fileName: `screenshot-${step.stepSeq}.png`,
          contentType: "image/png",
          content: Buffer.from(base64, "base64")
        });
        return {
          step,
          artifactIds: [artifact.id],
          outputJson: JSON.stringify({
            artifactId: artifact.id,
            url: await page.getCurrentUrl(),
            executionBackend: this.backend
          })
        };
      }
      default:
        throw new AppError({
          statusCode: 400,
          errorCode: "BROWSER_ACTION_BACKEND_NOT_SUPPORTED",
          detail: `opencli 浏览器桥接暂不支持动作 ${action.type}`
        });
    }
  }

  private async ensureBridgeReady(): Promise<void> {
    const status = await this.bridgeStatusService.getStatus();

    if (status.availability === "ready") {
      return;
    }

    const errorCode =
      status.availability === "daemon_missing"
        ? "OPENCLI_BRIDGE_DAEMON_MISSING"
        : status.availability === "extension_missing"
          ? "OPENCLI_BRIDGE_EXTENSION_MISSING"
          : "OPENCLI_BRIDGE_UNAVAILABLE";

    throw new AppError({
      statusCode: 409,
      errorCode,
      detail: status.detail ?? "OpenCLI 浏览器桥接当前不可用"
    });
  }

  private async createPage(): Promise<OpenCliPageLike> {
    const discovery = this.installDiscovery.discover();
    const installPath = discovery.installPath?.trim();

    if (!installPath) {
      throw new AppError({
        statusCode: 409,
        errorCode: "OPENCLI_INSTALL_NOT_FOUND",
        detail: "未找到 opencli 安装目录，无法加载浏览器桥接"
      });
    }

    const pageModuleUrl = pathToFileURL(path.join(installPath, "dist", "src", "browser", "page.js")).href;

    try {
      const pageModule = await import(pageModuleUrl);
      const PageCtor = pageModule.Page as new (workspace?: string, idleTimeout?: number) => OpenCliPageLike;
      return new PageCtor("codingns-office-browser");
    } catch (error) {
      throw new AppError({
        statusCode: 500,
        errorCode: "OPENCLI_BRIDGE_LOAD_FAILED",
        detail: error instanceof Error ? error.message : "无法加载 opencli 浏览器桥接模块"
      });
    }
  }
}
