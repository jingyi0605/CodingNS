import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import type {
  PluginActionDefinition,
  PluginDesktopPermission,
  PluginManifest,
  PluginPermissionManifest,
  PluginScheduleDefinition
} from "../../types/domain.js";

const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const DESKTOP_PERMISSION_SET = new Set<PluginDesktopPermission>([
  "open_file",
  "reveal_in_file_manager"
]);

export interface ParsedPluginManifest {
  manifest: PluginManifest;
  installRoot: string;
  manifestPath: string;
}

export function readPluginManifest(installRoot: string): ParsedPluginManifest {
  const normalizedInstallRoot = path.resolve(installRoot);
  const manifestPath = path.join(normalizedInstallRoot, "plugin.json");

  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_MANIFEST_NOT_FOUND",
      detail: `插件目录缺少 plugin.json：${manifestPath}`
    });
  }

  let rawManifest: unknown;

  try {
    rawManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_MANIFEST_INVALID_JSON",
      detail: `plugin.json 不是合法 JSON：${error instanceof Error ? error.message : "未知错误"}`
    });
  }

  return {
    manifest: validatePluginManifest(rawManifest, normalizedInstallRoot),
    installRoot: normalizedInstallRoot,
    manifestPath
  };
}

export function validatePluginManifest(input: unknown, installRoot: string): PluginManifest {
  if (!isPlainObject(input)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_MANIFEST_INVALID",
      detail: "plugin.json 顶层必须是对象"
    });
  }

  const id = readRequiredString(input.id, "id");
  const name = readRequiredString(input.name, "name");
  const version = readRequiredString(input.version, "version");
  const description = readOptionalString(input.description);

  if (!PLUGIN_ID_PATTERN.test(id)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_MANIFEST_INVALID_ID",
      detail: "插件 id 只允许小写字母、数字以及 . _ -",
      field: "id"
    });
  }

  if (!SEMVER_PATTERN.test(version)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_MANIFEST_INVALID_VERSION",
      detail: "插件 version 必须是合法 semver，例如 1.0.0",
      field: "version"
    });
  }

  const frontend = parseFrontend(input.frontend, installRoot);
  const backend = parseBackend(input.backend, installRoot);

  if (!frontend && !backend) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_MANIFEST_ENTRY_REQUIRED",
      detail: "插件至少要声明 frontend 或 backend"
    });
  }

  const permissions = parsePermissions(input.permissions);
  const schedules = parseSchedules(input.schedules, backend?.actions ?? []);

  return {
    id,
    name,
    version,
    description: description ?? undefined,
    frontend: frontend ?? undefined,
    backend: backend ?? undefined,
    permissions,
    schedules: schedules.length > 0 ? schedules : undefined
  };
}

function parseFrontend(value: unknown, installRoot: string): PluginManifest["frontend"] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_FRONTEND_INVALID",
      detail: "frontend 必须是对象",
      field: "frontend"
    });
  }

  const entry = readRequiredString(value.entry, "frontend.entry");
  ensureInstallRootRelativeFile(installRoot, entry, "frontend.entry");
  const mode = readOptionalString(value.mode);

  if (mode && mode !== "static_html") {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_FRONTEND_MODE_INVALID",
      detail: "frontend.mode 目前只支持 static_html",
      field: "frontend.mode"
    });
  }

  return {
    entry: normalizeManifestPath(entry),
    mode: mode === "static_html" ? "static_html" : undefined
  };
}

function parseBackend(value: unknown, installRoot: string): PluginManifest["backend"] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_BACKEND_INVALID",
      detail: "backend 必须是对象",
      field: "backend"
    });
  }

  const runtime = readRequiredString(value.runtime, "backend.runtime");
  if (runtime !== "node") {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_BACKEND_RUNTIME_INVALID",
      detail: "backend.runtime 目前只支持 node",
      field: "backend.runtime"
    });
  }

  const mode = readOptionalString(value.mode);
  if (mode && mode !== "on_demand" && mode !== "daemon") {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_BACKEND_MODE_INVALID",
      detail: "backend.mode 只允许 on_demand 或 daemon",
      field: "backend.mode"
    });
  }

  if (!Array.isArray(value.actions) || value.actions.length === 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_BACKEND_ACTIONS_REQUIRED",
      detail: "backend.actions 至少要有一个动作",
      field: "backend.actions"
    });
  }

  const actionIdSet = new Set<string>();
  const actions: PluginActionDefinition[] = value.actions.map((item, index) => {
    if (!isPlainObject(item)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PLUGIN_ACTION_INVALID",
        detail: `backend.actions[${index}] 必须是对象`,
        field: `backend.actions[${index}]`
      });
    }

    const id = readRequiredString(item.id, `backend.actions[${index}].id`);
    const title = readRequiredString(item.title, `backend.actions[${index}].title`);
    const entry = readRequiredString(item.entry, `backend.actions[${index}].entry`);
    ensureInstallRootRelativeFile(installRoot, entry, `backend.actions[${index}].entry`);

    if (!PLUGIN_ID_PATTERN.test(id)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PLUGIN_ACTION_ID_INVALID",
        detail: `动作 id 不合法：${id}`,
        field: `backend.actions[${index}].id`
      });
    }

    if (actionIdSet.has(id)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PLUGIN_ACTION_ID_DUPLICATED",
        detail: `动作 id 重复：${id}`,
        field: `backend.actions[${index}].id`
      });
    }
    actionIdSet.add(id);

    const timeoutMs = readOptionalPositiveInteger(item.timeoutMs, `backend.actions[${index}].timeoutMs`);
    const inputSchemaJson = serializeOptionalJson(item.inputSchemaJson ?? item.inputSchema);
    const outputSchemaJson = serializeOptionalJson(item.outputSchemaJson ?? item.outputSchema);

    return {
      id,
      title,
      entry: normalizeManifestPath(entry),
      timeoutMs: timeoutMs ?? undefined,
      inputSchemaJson: inputSchemaJson ?? undefined,
      outputSchemaJson: outputSchemaJson ?? undefined
    };
  });

  return {
    runtime: "node",
    mode: mode === "daemon" ? "daemon" : mode === "on_demand" ? "on_demand" : undefined,
    actions
  };
}

function parsePermissions(value: unknown): PluginPermissionManifest {
  if (!isPlainObject(value)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_PERMISSIONS_REQUIRED",
      detail: "permissions 必须是对象",
      field: "permissions"
    });
  }

  const desktop = value.desktop === undefined
    ? undefined
    : readDesktopPermissions(value.desktop);
  const hostApis = value.hostApis === undefined
    ? undefined
    : readStringArray(value.hostApis, "permissions.hostApis");

  return {
    workspaceRead: readOptionalBoolean(value.workspaceRead) ?? undefined,
    workspaceWrite: readOptionalBoolean(value.workspaceWrite) ?? undefined,
    network: readOptionalBoolean(value.network) ?? undefined,
    desktop: desktop && desktop.length > 0 ? desktop : undefined,
    hostApis: hostApis && hostApis.length > 0 ? hostApis : undefined
  };
}

function parseSchedules(value: unknown, actions: PluginActionDefinition[]): PluginScheduleDefinition[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_SCHEDULES_INVALID",
      detail: "schedules 必须是数组",
      field: "schedules"
    });
  }

  const actionIds = new Set(actions.map((item) => item.id));
  const scheduleIdSet = new Set<string>();

  return value.map((item, index) => {
    if (!isPlainObject(item)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PLUGIN_SCHEDULE_INVALID",
        detail: `schedules[${index}] 必须是对象`,
        field: `schedules[${index}]`
      });
    }

    const id = readRequiredString(item.id, `schedules[${index}].id`);
    const actionId = readRequiredString(item.actionId, `schedules[${index}].actionId`);
    const cron = readOptionalString(item.cron);
    const everySeconds = readOptionalPositiveInteger(item.everySeconds, `schedules[${index}].everySeconds`);

    if (scheduleIdSet.has(id)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PLUGIN_SCHEDULE_ID_DUPLICATED",
        detail: `schedule id 重复：${id}`,
        field: `schedules[${index}].id`
      });
    }
    scheduleIdSet.add(id);

    if (!actionIds.has(actionId)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PLUGIN_SCHEDULE_ACTION_NOT_FOUND",
        detail: `schedule 绑定的 action 不存在：${actionId}`,
        field: `schedules[${index}].actionId`
      });
    }

    if (!cron && !everySeconds) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PLUGIN_SCHEDULE_TRIGGER_REQUIRED",
        detail: "schedule 至少要声明 cron 或 everySeconds",
        field: `schedules[${index}]`
      });
    }

    return {
      id,
      cron: cron ?? undefined,
      everySeconds: everySeconds ?? undefined,
      actionId,
      inputJson: serializeOptionalJson(item.inputJson ?? item.input) ?? undefined
    };
  });
}

function readDesktopPermissions(value: unknown): PluginDesktopPermission[] {
  if (!Array.isArray(value)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_DESKTOP_PERMISSIONS_INVALID",
      detail: "permissions.desktop 必须是数组",
      field: "permissions.desktop"
    });
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || !DESKTOP_PERMISSION_SET.has(item as PluginDesktopPermission)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PLUGIN_DESKTOP_PERMISSION_UNKNOWN",
        detail: `不支持的桌面权限：${String(item)}`,
        field: `permissions.desktop[${index}]`
      });
    }

    return item as PluginDesktopPermission;
  });
}

function ensureInstallRootRelativeFile(installRoot: string, requestedPath: string, field: string): string {
  const normalizedPath = normalizeManifestPath(requestedPath);
  const absolutePath = path.resolve(installRoot, normalizedPath);
  const relative = path.relative(installRoot, absolutePath);

  if (
    path.isAbsolute(requestedPath)
    || normalizedPath.startsWith("../")
    || normalizedPath === ".."
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_PATH_OUT_OF_ROOT",
      detail: `${field} 超出插件目录边界`,
      field
    });
  }

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_ENTRY_NOT_FOUND",
      detail: `${field} 指向的文件不存在：${normalizedPath}`,
      field
    });
  }

  return absolutePath;
}

function normalizeManifestPath(input: string): string {
  return input.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function readRequiredString(value: unknown, field: string): string {
  const normalized = readOptionalString(value);
  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_MANIFEST_REQUIRED_FIELD_MISSING",
      detail: `缺少必要字段：${field}`,
      field
    });
  }

  return normalized;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readOptionalPositiveInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_INTEGER_INVALID",
      detail: `${field} 必须是正整数`,
      field
    });
  }

  return Number(value);
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_STRING_ARRAY_INVALID",
      detail: `${field} 必须是字符串数组`,
      field
    });
  }

  return value.map((item, index) => {
    const normalized = readOptionalString(item);
    if (!normalized) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PLUGIN_STRING_ARRAY_ITEM_INVALID",
        detail: `${field}[${index}] 必须是非空字符串`,
        field: `${field}[${index}]`
      });
    }

    return normalized;
  });
}

function serializeOptionalJson(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return JSON.stringify(value);
    }
  }

  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
