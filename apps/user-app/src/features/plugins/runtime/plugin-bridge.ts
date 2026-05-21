import { ApiError } from "../../../shared/network/api-error";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { I18nProvider } from "../../../shared/i18n";
import { ThemeProvider } from "../../../shared/theme";
import { PlatformProvider } from "../../../platform/platform-provider";
import {
  callPluginAction,
  closePluginRuntimeSession,
  createPluginPermissionGrant,
  createPluginRuntimeSession,
  listPluginDirectory,
  openPluginFile,
  readPluginFile,
  revealPluginFile,
  writePluginFile,
  type PluginFileNodeDto,
  type PluginPermissionGrantDto,
  type PluginRuntimeContextDto
} from "../api/plugins-api";
import { getCodingNSDesktopBridge } from "../../../platform/desktop/codingns-desktop-bridge";
import { PluginPermissionPromptModal, type PluginPermissionRequestState } from "../components/PluginPermissionPromptModal";

export interface PluginHostBridgeContext {
  pluginId: string;
  workspaceId: string;
  runtimeSessionId: string;
  pluginName: string;
  pluginVersion: string;
  frontendEntryUrl: string;
  hostOrigin: string;
}

interface PluginRequestMessage {
  type: "codingns-plugin:request";
  requestId: string;
  action: "callAction" | "openFile" | "revealInFileManager" | "readFile" | "writeFile" | "listDir";
  payload?: Record<string, unknown>;
}

interface PluginReadyMessage {
  type: "codingns-plugin:ready";
}

const RESPONSE_TYPE = "codingns-plugin:response";
const INIT_TYPE = "codingns-plugin:init";
const READY_TYPE = "codingns-plugin:ready";
const REQUEST_TYPE = "codingns-plugin:request";

export async function buildPluginHostBridgeContext(
  pluginId: string,
  workspaceId: string,
  hostOrigin: string
): Promise<PluginHostBridgeContext> {
  const runtime = await createPluginRuntimeSession(pluginId, workspaceId);
  return mapPluginRuntimeContext(runtime.context, hostOrigin);
}

export async function closePluginHostBridgeContext(
  pluginId: string,
  runtimeSessionId: string
): Promise<void> {
  await closePluginRuntimeSession(pluginId, runtimeSessionId);
}

export function attachPluginBridge(options: {
  iframe: HTMLIFrameElement;
  pluginId: string;
  hostOrigin: string;
  context: PluginHostBridgeContext;
}) {
  const { iframe, pluginId, hostOrigin, context } = options;

  function handleMessage(event: MessageEvent) {
    if (event.source !== iframe.contentWindow) {
      return;
    }

    if (event.origin !== hostOrigin) {
      return;
    }

    const payload = event.data;
    if (!payload || typeof payload !== "object") {
      return;
    }

    if ((payload as PluginReadyMessage).type === READY_TYPE) {
      iframe.contentWindow?.postMessage({
        type: INIT_TYPE,
        context
      }, hostOrigin);
      return;
    }

    const request = payload as PluginRequestMessage;
    if (request.type !== REQUEST_TYPE || typeof request.requestId !== "string") {
      return;
    }

    void resolvePluginRequest({
      pluginId,
      pluginName: context.pluginName,
      runtimeSessionId: context.runtimeSessionId,
      request
    }).then((result) => {
      iframe.contentWindow?.postMessage({
        type: RESPONSE_TYPE,
        requestId: request.requestId,
        ok: true,
        result
      }, hostOrigin);
    }).catch((error) => {
      iframe.contentWindow?.postMessage({
        type: RESPONSE_TYPE,
        requestId: request.requestId,
        ok: false,
        error: normalizePluginBridgeError(error)
      }, hostOrigin);
    });
  }

  window.addEventListener("message", handleMessage);
  return () => {
    window.removeEventListener("message", handleMessage);
  };
}

async function resolvePluginRequest(input: {
  pluginId: string;
  pluginName: string;
  runtimeSessionId: string;
  request: PluginRequestMessage;
}): Promise<unknown> {
  const { pluginId, pluginName, runtimeSessionId, request } = input;
  if (request.action === "callAction") {
    const actionId = typeof request.payload?.actionId === "string" ? request.payload.actionId.trim() : "";
    if (!actionId) {
      throw new ApiError(400, {
        error_code: "PLUGIN_ACTION_ID_REQUIRED",
        detail: "插件动作请求缺少 actionId"
      });
    }

    return await callPluginAction(pluginId, actionId, runtimeSessionId, request.payload?.input);
  }

  if (request.action === "readFile") {
    const targetPath = readTargetPath(request.payload?.path, "插件读文件缺少路径");
    return await withPluginPermissionRetry({
      pluginId,
      pluginName,
      runtimeSessionId,
      permissionKey: "workspace.read_file",
      scopePath: targetPath,
      execute: async () => await readPluginFile(pluginId, runtimeSessionId, targetPath)
    });
  }

  if (request.action === "writeFile") {
    const targetPath = readTargetPath(request.payload?.path, "插件写文件缺少路径");
    const content = typeof request.payload?.content === "string" ? request.payload.content : "";
    return await withPluginPermissionRetry({
      pluginId,
      pluginName,
      runtimeSessionId,
      permissionKey: "workspace.write_file",
      scopePath: targetPath,
      execute: async () => await writePluginFile(pluginId, runtimeSessionId, targetPath, content)
    });
  }

  if (request.action === "listDir") {
    const targetPath = typeof request.payload?.path === "string" ? request.payload.path.trim() : "";
    const result = await withPluginPermissionRetry({
      pluginId,
      pluginName,
      runtimeSessionId,
      permissionKey: "workspace.list_dir",
      scopePath: targetPath || null,
      execute: async () => await listPluginDirectory(pluginId, runtimeSessionId, targetPath || undefined)
    });
    return {
      items: result.items.map(normalizeDirectoryNode)
    };
  }

  const targetPath = readTargetPath(request.payload?.path, "插件桌面动作缺少路径");

  if (request.action === "openFile") {
    const prepared = await withPluginPermissionRetry({
      pluginId,
      pluginName,
      runtimeSessionId,
      permissionKey: "desktop.open_file",
      scopePath: targetPath,
      execute: async () => await openPluginFile(pluginId, runtimeSessionId, targetPath)
    });
    const bridge = getCodingNSDesktopBridge();
    const result = await bridge.fs.openFile(prepared.absolutePath);
    if (!result.ok) {
      throw new ApiError(500, {
        error_code: result.errorCode ?? "PLUGIN_DESKTOP_OPEN_FAILED",
        detail: result.detail ?? "打开文件失败"
      });
    }
    return prepared;
  }

  if (request.action === "revealInFileManager") {
    const prepared = await withPluginPermissionRetry({
      pluginId,
      pluginName,
      runtimeSessionId,
      permissionKey: "desktop.reveal_in_file_manager",
      scopePath: targetPath,
      execute: async () => await revealPluginFile(pluginId, runtimeSessionId, targetPath)
    });
    const bridge = getCodingNSDesktopBridge();
    const result = await bridge.fs.revealInFileManager(prepared.absolutePath);
    if (!result.ok) {
      throw new ApiError(500, {
        error_code: result.errorCode ?? "PLUGIN_DESKTOP_REVEAL_FAILED",
        detail: result.detail ?? "打开所在目录失败"
      });
    }
    return prepared;
  }

  throw new ApiError(400, {
    error_code: "PLUGIN_BRIDGE_ACTION_UNKNOWN",
    detail: `未知插件桥动作：${request.action}`
  });
}

function readTargetPath(pathValue: unknown, detail: string): string {
  const targetPath = typeof pathValue === "string" ? pathValue.trim() : "";
  if (!targetPath) {
    throw new ApiError(400, {
      error_code: "PLUGIN_PATH_REQUIRED",
      detail
    });
  }

  return targetPath;
}

function normalizeDirectoryNode(item: PluginFileNodeDto): PluginFileNodeDto {
  return {
    path: item.path,
    name: item.name,
    kind: item.kind,
    size: item.size,
    updatedAt: item.updatedAt
  };
}

async function withPluginPermissionRetry<T>(input: {
  pluginId: string;
  pluginName: string;
  runtimeSessionId: string;
  permissionKey: PluginPermissionGrantDto["permissionKey"];
  scopePath: string | null;
  execute: () => Promise<T>;
}): Promise<T> {
  try {
    return await input.execute();
  } catch (error) {
    const request = toPluginPermissionRequest(error, input);
    if (!request) {
      throw error;
    }

    const approved = await requestPluginPermissionGrant(request);
    if (!approved) {
      throw error;
    }

    return await input.execute();
  }
}

function toPluginPermissionRequest(
  error: unknown,
  input: {
    pluginId: string;
    pluginName: string;
    runtimeSessionId: string;
    permissionKey: PluginPermissionGrantDto["permissionKey"];
    scopePath: string | null;
  }
): PluginPermissionRequestState | null {
  if (!(error instanceof ApiError) || error.errorCode !== "PLUGIN_PERMISSION_GRANT_REQUIRED") {
    return null;
  }

  const permissionKey = readPermissionKey(error.data?.permissionKey, input.permissionKey);
  const scopeType = readScopeType(error.data?.scopeType, input.scopePath ? "file" : "workspace");
  const scopePath = typeof error.data?.scopePath === "string"
    ? error.data.scopePath
    : input.scopePath;
  const grantOptions = readGrantOptions(error.data?.grantOptions);

  return {
    pluginId: input.pluginId,
    pluginName: input.pluginName,
    runtimeSessionId: input.runtimeSessionId,
    permissionKey,
    scopeType,
    scopePath,
    grantOptions
  };
}

function readPermissionKey(
  value: unknown,
  fallback: PluginPermissionGrantDto["permissionKey"]
): PluginPermissionGrantDto["permissionKey"] {
  if (
    value === "workspace.read_file"
    || value === "workspace.list_dir"
    || value === "workspace.write_file"
    || value === "desktop.open_file"
    || value === "desktop.reveal_in_file_manager"
  ) {
    return value;
  }

  return fallback;
}

function readScopeType(
  value: unknown,
  fallback: PluginPermissionGrantDto["scopeType"]
): PluginPermissionGrantDto["scopeType"] {
  if (value === "workspace" || value === "directory" || value === "file") {
    return value;
  }

  return fallback;
}

function readGrantOptions(value: unknown): Array<"once" | "session" | "persistent"> {
  if (!Array.isArray(value)) {
    return ["once", "session"];
  }

  return value.filter((item): item is "once" | "session" | "persistent" => (
    item === "once" || item === "session" || item === "persistent"
  ));
}

let permissionPromptRoot: Root | null = null;
let permissionPromptContainer: HTMLDivElement | null = null;
let permissionPromptHandler: null | ((request: PluginPermissionRequestState) => Promise<boolean>) = null;

export function setPluginPermissionPromptHandlerForTesting(
  handler: null | ((request: PluginPermissionRequestState) => Promise<boolean>)
): void {
  permissionPromptHandler = handler;
}

async function requestPluginPermissionGrant(request: PluginPermissionRequestState): Promise<boolean> {
  if (permissionPromptHandler) {
    return await permissionPromptHandler(request);
  }

  if (typeof document === "undefined") {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    ensurePermissionPromptRoot();

    const close = (approved: boolean) => {
      renderPermissionPrompt({
        open: false,
        request: null,
        submitting: false,
        onClose: () => close(false),
        onApprove: () => undefined
      });
      window.setTimeout(() => resolve(approved), 0);
    };

    const handleApprove = async (grantInput: {
      scopeType: PluginPermissionGrantDto["scopeType"];
      scopePath: string | null;
      grantMode: PluginPermissionGrantDto["grantMode"];
    }) => {
      renderPermissionPrompt({
        open: true,
        request,
        submitting: true,
        onClose: () => undefined,
        onApprove: () => undefined
      });

      try {
        await createPluginPermissionGrant(request.pluginId, {
          runtimeSessionId: request.runtimeSessionId,
          permissionKey: request.permissionKey,
          scopeType: grantInput.scopeType,
          scopePath: grantInput.scopePath,
          grantMode: grantInput.grantMode
        });
        close(true);
      } catch {
        close(false);
      }
    };

    renderPermissionPrompt({
      open: true,
      request,
      submitting: false,
      onClose: () => close(false),
      onApprove: handleApprove
    });
  });
}

function ensurePermissionPromptRoot(): void {
  if (!permissionPromptContainer) {
    permissionPromptContainer = document.createElement("div");
    permissionPromptContainer.dataset.pluginPermissionPrompt = "true";
    document.body.appendChild(permissionPromptContainer);
  }

  if (!permissionPromptRoot) {
    permissionPromptRoot = createRoot(permissionPromptContainer);
  }
}

function renderPermissionPrompt(input: {
  open: boolean;
  request: PluginPermissionRequestState | null;
  submitting: boolean;
  onClose: () => void;
  onApprove: (input: {
    scopeType: PluginPermissionGrantDto["scopeType"];
    scopePath: string | null;
    grantMode: PluginPermissionGrantDto["grantMode"];
  }) => void;
}): void {
  if (!permissionPromptRoot) {
    return;
  }

  permissionPromptRoot.render(
    createElement(
      I18nProvider,
      null,
      createElement(
        ThemeProvider,
        null,
        createElement(
          PlatformProvider,
          null,
          createElement(PluginPermissionPromptModal, {
            open: input.open,
            request: input.request,
            submitting: input.submitting,
            onClose: input.onClose,
            onApprove: input.onApprove
          })
        )
      )
    )
  );
}

function mapPluginRuntimeContext(
  context: PluginRuntimeContextDto,
  hostOrigin: string
): PluginHostBridgeContext {
  if (!context.frontendEntryUrl) {
    throw new ApiError(404, {
      error_code: "PLUGIN_FRONTEND_NOT_FOUND",
      detail: "当前插件没有可运行的前端入口"
    });
  }

  return {
    pluginId: context.pluginId,
    workspaceId: context.workspaceId,
    runtimeSessionId: context.runtimeSessionId,
    pluginName: context.pluginName,
    pluginVersion: context.pluginVersion,
    frontendEntryUrl: context.frontendEntryUrl,
    hostOrigin
  };
}

function normalizePluginBridgeError(error: unknown): { code: string; detail: string } {
  if (error instanceof ApiError) {
    return {
      code: error.errorCode ?? `HTTP_${error.status}`,
      detail: error.message
    };
  }

  if (error instanceof Error) {
    return {
      code: "PLUGIN_BRIDGE_REQUEST_FAILED",
      detail: error.message
    };
  }

  return {
    code: "PLUGIN_BRIDGE_REQUEST_FAILED",
    detail: "插件桥请求失败"
  };
}
