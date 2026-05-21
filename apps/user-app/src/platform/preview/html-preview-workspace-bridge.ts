import {
  deleteWorkspaceBridgeFile,
  existsWorkspaceBridgePath,
  getWorkspaceBridgeCapabilities,
  listWorkspaceBridgeDir,
  pollWorkspaceBridgeWatchEvents,
  readWorkspaceBridgeText,
  readWorkspaceBridgeTexts,
  statWorkspaceBridgePath,
  unwatchWorkspaceBridgeDir,
  watchWorkspaceBridgeDir,
  writeWorkspaceBridgeText
} from "./codingns-workspace-bridge";

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

  function postError(event: MessageEvent, request: HtmlPreviewBridgeRequest, code: string, message: string, path?: string) {
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

    if (!(targetWindow instanceof Window)) {
      return;
    }

    targetWindow.postMessage(response, event.origin);
  }

  function postWatchEvent(payload: HtmlPreviewBridgeEvent) {
    const iframeWindow = options.iframe?.contentWindow;
    if (!iframeWindow || !iframeOrigin) {
      return;
    }

    iframeWindow.postMessage(payload, iframeOrigin);
  }

  async function handleRequest(event: MessageEvent, request: HtmlPreviewBridgeRequest): Promise<void> {
    const iframeWindow = options.iframe?.contentWindow;
    const workspaceId = options.workspaceId?.trim() ?? "";

    if (!iframeWindow || event.source !== iframeWindow) {
      return;
    }

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
        default:
          postError(event, request, "INTERNAL_ERROR", `不支持的 workspace bridge 动作：${request.action}`);
          return;
      }

      postResponse(event, {
        type: "codingns.workspace.response",
        id: request.id,
        ok: true,
        payload
      });
    } catch (error) {
      const detail = readApiError(error);
      postError(event, request, detail.code, detail.message, detail.path);
    }
  }

  return {
    async onMessage(event: MessageEvent): Promise<void> {
      if (!isWorkspaceBridgeRequest(event.data)) {
        return;
      }

      await handleRequest(event, event.data);
    },
    dispose(): void {
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
