import { AppError } from "../../shared/errors/app-error.js";

export type BrowserExecutionBackend = "playwright" | "opencli_bridge";

export interface BrowserTaskAction {
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

export interface BrowserTaskPayload {
  profileId?: string;
  startUrl?: string;
  actions?: BrowserTaskAction[];
  executionBackend?: BrowserExecutionBackend;
}

export interface BrowserTaskPayloadSummary {
  executionBackend: BrowserExecutionBackend;
  startUrl: string | null;
  actions: BrowserTaskAction[];
}

export function parseBrowserTaskPayload(raw: string): BrowserTaskPayload {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as BrowserTaskPayload;
  } catch {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_BROWSER_TASK_INPUT",
      detail: "浏览器任务输入格式不合法"
    });
  }
}

export function normalizeBrowserTaskPayload(input: unknown): BrowserTaskPayloadSummary {
  const payload = normalizeBrowserTaskPayloadShape(input);

  return {
    executionBackend: normalizeBrowserExecutionBackend(payload.executionBackend),
    startUrl: normalizeOptionalText(payload.startUrl),
    actions: normalizeBrowserTaskActions(payload)
  };
}

export function normalizeBrowserExecutionBackend(value: unknown): BrowserExecutionBackend {
  if (value === "opencli_bridge") {
    return "opencli_bridge";
  }

  return "playwright";
}

export function normalizeBrowserTaskActions(input: unknown): BrowserTaskAction[] {
  if (Array.isArray(input)) {
    return input.filter((item): item is BrowserTaskAction => Boolean(item && typeof item === "object" && typeof item.type === "string"));
  }

  const payload = normalizeBrowserTaskPayloadShape(input);

  if (!Array.isArray(payload.actions)) {
    return [];
  }

  return payload.actions.filter((item): item is BrowserTaskAction => Boolean(item && typeof item === "object" && typeof item.type === "string"));
}

export function normalizeBrowserTaskPayloadShape(input: unknown): BrowserTaskPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return input as BrowserTaskPayload;
}

export function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
