import {
  deleteWorkspaceBridgeFile,
  existsWorkspaceBridgePath,
  getWorkspaceBridgeCapabilities,
  listWorkspaceBridgeDir,
  pollWorkspaceBridgeWatchEvents,
  prepareWorkspaceBridgeOpenFile,
  prepareWorkspaceBridgeRevealFile,
  readWorkspaceBridgeText,
  readWorkspaceBridgeTexts,
  statWorkspaceBridgePath,
  unwatchWorkspaceBridgeDir,
  watchWorkspaceBridgeDir,
  writeWorkspaceBridgeText
} from "./codingns-workspace-bridge";
import { getCodingNSDesktopBridge } from "../desktop/codingns-desktop-bridge";

interface HtmlPreviewBridgeRequest {
  type: "codingns.workspace.request";
  id: string;
  action: string;
  payload?: Record<string, unknown>;
}

interface HtmlPreviewBridgeResponse {
  type: "codingns.workspace.response";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    path?: string;
  };
}

interface HtmlPreviewBridgeEvent {
  type: "codingns.workspace.event";
  watchId: string;
  payload: unknown;
}

export interface HtmlPreviewWorkspaceBridgeOptions {
  iframe: HTMLIFrameElement | null;
  workspaceId: string | null | undefined;
}

export function createHtmlPreviewWorkspaceBridge(options: HtmlPreviewWorkspaceBridgeOptions) {
  const watchPollers = new Map<string, { stopped: boolean; cursor: number }>();
  let iframeOrigin: string | null = null;
  const debugState = {
    lastEventOrigin: null as string | null,
    lastEventMatchedSource: false,
    lastEventRequestId: null as string | null,
    lastEventAction: null as string | null,
    lastResponseId: null as string | null,
    lastResponseOrigin: null as string | null,
    lastHandledRequestId: null as string | null,
    currentIframeWindowMatches: false
  };

  debugLog("create", {
    hasIframe: Boolean(options.iframe),
    hasContentWindow: Boolean(options.iframe?.contentWindow),
    workspaceId: options.workspaceId ?? null
  });

  function debugLog(stage: string, payload?: Record<string, unknown>): void {
    const detail = {
      at: new Date().toISOString(),
      source: "html-preview-host",
      stage,
      payload: payload ?? {}
    };

    if (typeof console !== "undefined" && typeof console.debug === "function") {
      console.debug(`[html-preview-bridge] ${stage}`, payload ?? {});
    }

    postHostDebugEvent(detail);
  }

  function postHostDebugEvent(detail: Record<string, unknown>): void {
    const iframeWindow = options.iframe?.contentWindow;
    if (!iframeWindow || typeof iframeWindow.postMessage !== "function") {
      return;
    }

    iframeWindow.postMessage(
      {
        type: "codingns.workspace.debug",
        payload: detail
      },
      iframeOrigin ?? "*"
    );
  }

  function postError(event: MessageEvent, request: HtmlPreviewBridgeRequest, code: string, message: string, path?: string) {
    debugLog("post-error", {
      id: request.id,
      action: request.action,
      code,
      message,
      path,
      origin: event.origin
    });
    postResponse(event, {
      type: "codingns.workspace.response",
      id: request.id,
      ok: false,
      error: {
        code,
        message,
        path
      }
    });
  }

  function postResponse(event: MessageEvent, response: HtmlPreviewBridgeResponse) {
    const targetWindow = event.source;
    debugState.lastResponseId = response.id;
    debugState.lastResponseOrigin = event.origin;
    debugLog("post-response", {
      id: response.id,
      ok: response.ok,
      origin: event.origin,
      targetCanPostMessage: canPostMessage(targetWindow)
    });

    if (!canPostMessage(targetWindow)) {
      debugLog("drop-response", {
        id: response.id,
        reason: "event.source cannot postMessage",
        origin: event.origin
      });
      return;
    }

    targetWindow.postMessage(response, event.origin);
  }

  function postWatchEvent(payload: HtmlPreviewBridgeEvent) {
    const iframeWindow = options.iframe?.contentWindow;
    if (!iframeWindow || !iframeOrigin) {
      debugLog("drop-watch-event", {
        watchId: payload.watchId,
        hasIframeWindow: Boolean(iframeWindow),
        iframeOrigin
      });
      return;
    }

    debugLog("post-watch-event", {
      watchId: payload.watchId,
      iframeOrigin
    });
    iframeWindow.postMessage(payload, iframeOrigin);
  }

  async function handleRequest(event: MessageEvent, request: HtmlPreviewBridgeRequest): Promise<void> {
    const iframeWindow = options.iframe?.contentWindow;
    const workspaceId = options.workspaceId?.trim() ?? "";
    const sourceCanPostMessage = canPostMessage(event.source);
    const sourceMatchesCurrentIframe = Boolean(iframeWindow && event.source === iframeWindow);

    debugState.lastEventOrigin = event.origin;
    debugState.lastEventMatchedSource = sourceMatchesCurrentIframe;
    debugState.lastEventRequestId = request.id;
    debugState.lastEventAction = request.action;
    debugState.currentIframeWindowMatches = sourceMatchesCurrentIframe;

    debugLog("handle-request", {
      id: request.id,
      action: request.action,
      origin: event.origin,
      hasIframeWindow: Boolean(iframeWindow),
      sourceCanPostMessage,
      sourceMatchesCurrentIframe,
      workspaceId: workspaceId || null
    });

    if (!iframeWindow || !sourceCanPostMessage) {
      debugLog("drop-request", {
        id: request.id,
        action: request.action,
        reason: !iframeWindow ? "missing iframe.contentWindow" : "event.source cannot postMessage",
        origin: event.origin
      });
      return;
    }

    // 桌面端/WebView 下 Window proxy 身份不一定稳定，不能再把 event.source === iframe.contentWindow
    // 当成唯一真相，否则合法请求会被父页静默吞掉，子页最终只会超时。
    iframeOrigin = event.origin;

    if (!workspaceId) {
      postError(event, request, "INTERNAL_ERROR", "当前预览缺少 workspaceId");
      return;
    }

    try {
      let payload: unknown;
      const rawPayload = request.payload ?? {};

      switch (request.action) {
        case "capabilities":
          payload = await getWorkspaceBridgeCapabilities(workspaceId);
          break;
        case "listDir":
          payload = await listWorkspaceBridgeDir(
            workspaceId,
            typeof rawPayload.path === "string" ? rawPayload.path : "",
            isPlainObject(rawPayload.options) ? rawPayload.options : undefined
          );
          break;
        case "readText":
          payload = await readWorkspaceBridgeText(
            workspaceId,
            typeof rawPayload.path === "string" ? rawPayload.path : ""
          );
          break;
        case "readTexts":
          payload = await readWorkspaceBridgeTexts(
            workspaceId,
            Array.isArray(rawPayload.paths)
              ? rawPayload.paths.filter((item): item is string => typeof item === "string")
              : []
          );
          break;
        case "writeText":
          payload = await writeWorkspaceBridgeText(
            workspaceId,
            typeof rawPayload.path === "string" ? rawPayload.path : "",
            typeof rawPayload.content === "string" ? rawPayload.content : "",
            isPlainObject(rawPayload.options) ? rawPayload.options : undefined
          );
          break;
        case "deleteFile":
          payload = await deleteWorkspaceBridgeFile(
            workspaceId,
            typeof rawPayload.path === "string" ? rawPayload.path : "",
            isPlainObject(rawPayload.options) ? rawPayload.options : undefined
          );
          break;
        case "stat":
          payload = await statWorkspaceBridgePath(
            workspaceId,
            typeof rawPayload.path === "string" ? rawPayload.path : ""
          );
          break;
        case "exists":
          payload = await existsWorkspaceBridgePath(
            workspaceId,
            typeof rawPayload.path === "string" ? rawPayload.path : ""
          );
          break;
        case "openWorkspaceFile": {
          const prepared = await prepareWorkspaceBridgeOpenFile(
            workspaceId,
            typeof rawPayload.path === "string" ? rawPayload.path : ""
          );
          const result = await getCodingNSDesktopBridge().fs.openFile(prepared.absolutePath);
          if (!result.ok) {
            throw {
              code: result.errorCode ?? "DESKTOP_OPEN_FAILED",
              message: result.detail ?? "打开文件失败",
              path: prepared.relativePath
            };
          }
          payload = prepared;
          break;
        }
        case "revealWorkspaceFile": {
          const prepared = await prepareWorkspaceBridgeRevealFile(
            workspaceId,
            typeof rawPayload.path === "string" ? rawPayload.path : ""
          );
          const result = await getCodingNSDesktopBridge().fs.revealInFileManager(prepared.absolutePath);
          if (!result.ok) {
            throw {
              code: result.errorCode ?? "DESKTOP_REVEAL_FAILED",
              message: result.detail ?? "打开所在目录失败",
              path: prepared.relativePath
            };
          }
          payload = prepared;
          break;
        }
        case "watchDir": {
          const created = await watchWorkspaceBridgeDir(
            workspaceId,
            typeof rawPayload.path === "string" ? rawPayload.path : "",
            isPlainObject(rawPayload.options) ? rawPayload.options : undefined
          );
          startWatchPolling(created.watchId);
          payload = created;
          break;
        }
        case "unwatch": {
          const watchId = typeof rawPayload.watchId === "string" ? rawPayload.watchId.trim() : "";
          if (!watchId) {
            postError(event, request, "INVALID_WATCH_ID", "必须提供 watchId");
            return;
          }
          stopWatchPolling(watchId);
          payload = await unwatchWorkspaceBridgeDir(watchId);
          break;
        }
        case "applyIndexConfig":
          postError(event, request, "INTERNAL_ERROR", "当前预览宿主页暂未代理 applyIndexConfig，请优先走 Preview HTTP Bridge。");
          return;
        default:
          postError(event, request, "INTERNAL_ERROR", `不支持的 workspace bridge 动作：${request.action}`);
          return;
      }

      debugLog("handle-success", {
        id: request.id,
        action: request.action,
        origin: event.origin
      });
      postResponse(event, {
        type: "codingns.workspace.response",
        id: request.id,
        ok: true,
        payload
      });
      debugState.lastHandledRequestId = request.id;
    } catch (error) {
      const detail = readApiError(error);
      debugLog("handle-error", {
        id: request.id,
        action: request.action,
        code: detail.code,
        message: detail.message,
        path: detail.path
      });
      postError(event, request, detail.code, detail.message, detail.path);
    }
  }

  return {
    async onMessage(event: MessageEvent): Promise<void> {
      if (!isWorkspaceBridgeRequest(event.data)) {
        const data = event.data as { type?: unknown } | null;
        if (data && typeof data === "object" && typeof data.type === "string" && data.type.startsWith("codingns.")) {
          debugLog("ignore-message", {
            origin: event.origin,
            type: data.type,
            reason: "not workspace bridge request"
          });
        }
        return;
      }

      debugLog("incoming-message", {
        origin: event.origin,
        id: event.data.id,
        action: event.data.action
      });
      await handleRequest(event, event.data);
    },
    debug: debugState,
    dispose(): void {
      debugLog("dispose", {
        activeWatchCount: watchPollers.size,
        lastEventRequestId: debugState.lastEventRequestId,
        lastHandledRequestId: debugState.lastHandledRequestId
      });
      for (const watchId of [...watchPollers.keys()]) {
        stopWatchPolling(watchId);
        void unwatchWorkspaceBridgeDir(watchId).catch(() => undefined);
      }
    }
  };

  function startWatchPolling(watchId: string): void {
    if (!watchId || watchPollers.has(watchId)) {
      return;
    }

    const state = {
      stopped: false,
      cursor: 0
    };
    watchPollers.set(watchId, state);

    void runPollLoop(watchId, state);
  }

  function stopWatchPolling(watchId: string): void {
    const state = watchPollers.get(watchId);
    if (!state) {
      return;
    }

    state.stopped = true;
    watchPollers.delete(watchId);
  }

  async function runPollLoop(
    watchId: string,
    state: { stopped: boolean; cursor: number }
  ): Promise<void> {
    while (!state.stopped) {
      try {
        const result = await pollWorkspaceBridgeWatchEvents(watchId, state.cursor);
        state.cursor = result.nextCursor;
        for (const item of result.events) {
          postWatchEvent({
            type: "codingns.workspace.event",
            watchId,
            payload: item
          });
        }
      } catch (error) {
        const detail = readApiError(error);
        if (detail.code === "WATCH_NOT_FOUND") {
          stopWatchPolling(watchId);
          return;
        }
      }

      await delay(700);
    }
  }
}

function canPostMessage(value: unknown): value is { postMessage: (message: unknown, targetOrigin: string) => void } {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as { postMessage?: unknown }).postMessage === "function";
}

function isWorkspaceBridgeRequest(value: unknown): value is HtmlPreviewBridgeRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.type === "codingns.workspace.request"
    && typeof candidate.id === "string"
    && typeof candidate.action === "string";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readApiError(error: unknown): {
  code: string;
  message: string;
  path?: string;
} {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Record<string, unknown>;
    return {
      code: typeof candidate.code === "string" ? candidate.code : "INTERNAL_ERROR",
      message: typeof candidate.message === "string"
        ? candidate.message
        : typeof candidate.detail === "string"
          ? candidate.detail
          : "请求失败",
      path: typeof candidate.path === "string" ? candidate.path : undefined
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message || "请求失败"
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "请求失败"
  };
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, timeoutMs);
  });
}
