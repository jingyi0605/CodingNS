import { ApiError } from "../../../shared/network/api-error";
import { getPlugin, callPluginAction, openPluginFile, revealPluginFile } from "../api/plugins-api";
import { getCodingNSDesktopBridge } from "../../../platform/desktop/codingns-desktop-bridge";

export interface PluginHostBridgeContext {
  pluginId: string;
  workspaceId: string;
  pluginName: string;
  pluginVersion: string;
  frontendEntryUrl: string;
  hostOrigin: string;
}

interface PluginRequestMessage {
  type: "codingns-plugin:request";
  requestId: string;
  action: "callAction" | "openFile" | "revealInFileManager";
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
  const detail = await getPlugin(pluginId);

  if (!detail.frontend?.entryUrl) {
    throw new ApiError(404, {
      error_code: "PLUGIN_FRONTEND_NOT_FOUND",
      detail: "当前插件没有可运行的前端入口"
    });
  }

  return {
    pluginId,
    workspaceId,
    pluginName: detail.manifest.name,
    pluginVersion: detail.manifest.version,
    frontendEntryUrl: detail.frontend.entryUrl,
    hostOrigin
  };
}

export function attachPluginBridge(options: {
  iframe: HTMLIFrameElement;
  pluginId: string;
  workspaceId: string;
  hostOrigin: string;
  context: PluginHostBridgeContext;
}) {
  const { iframe, pluginId, workspaceId, hostOrigin, context } = options;

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
      workspaceId,
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
  workspaceId: string;
  request: PluginRequestMessage;
}) {
  const { pluginId, workspaceId, request } = input;
  if (request.action === "callAction") {
    const actionId = typeof request.payload?.actionId === "string" ? request.payload.actionId.trim() : "";
    if (!actionId) {
      throw new ApiError(400, {
        error_code: "PLUGIN_ACTION_ID_REQUIRED",
        detail: "插件动作请求缺少 actionId"
      });
    }

    return await callPluginAction(pluginId, actionId, workspaceId, request.payload?.input);
  }

  const targetPath = typeof request.payload?.path === "string" ? request.payload.path.trim() : "";
  if (!targetPath) {
    throw new ApiError(400, {
      error_code: "PLUGIN_PATH_REQUIRED",
      detail: "插件桌面动作缺少路径"
    });
  }

  if (request.action === "openFile") {
    const prepared = await openPluginFile(pluginId, workspaceId, targetPath);
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
    const prepared = await revealPluginFile(pluginId, workspaceId, targetPath);
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
