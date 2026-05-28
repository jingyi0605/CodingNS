(function () {
  if (typeof window === "undefined") {
    return;
  }

  if (window.CodingNSWorkspace) {
    return;
  }

  var REQUEST_TIMEOUT_MS = 3000;
  var WATCH_POLL_INTERVAL_MS = 700;
  var RESPONSE_TYPE = "codingns.workspace.response";
  var REQUEST_TYPE = "codingns.workspace.request";
  var EVENT_TYPE = "codingns.workspace.event";
  var DEBUG_TYPE = "codingns.workspace.debug";
  var bootstrapConfig = readBootstrapConfig();
  var parentOrigin = null;
  var pendingRequests = Object.create(null);
  var watchListeners = Object.create(null);
  var activeWatchPollers = Object.create(null);
  var requestSeq = 0;
  var debugEvents = [];
  var debugState = createDebugState();
  var iframeHostBridge = createIframeHostBridge();
  var iframeBridgeUnavailable = false;
  debugLog("init", {
    href: window.location.href,
    referrer: document.referrer || "",
    context: readWorkspaceContext(),
    parentOrigin: isIframe() ? ensureParentOrigin() : null
  });

  function readBootstrapConfig() {
    var raw = window.__CODINGNS_WORKSPACE_BRIDGE_BOOTSTRAP__;
    if (raw && typeof raw === "object") {
      return raw;
    }

    var script = document.currentScript;
    if (!script || typeof script.getAttribute !== "function") {
      return {};
    }

    var workspaceId = script.getAttribute("data-codingns-workspace-id") || "";
    var hostOrigin = script.getAttribute("data-codingns-host-origin") || "";
    var parentOrigin = script.getAttribute("data-codingns-parent-origin") || "";
    var runtimeVersion = script.getAttribute("data-codingns-runtime-version") || "";
    return {
      workspaceId: workspaceId,
      hostOrigin: hostOrigin,
      parentOrigin: parentOrigin,
      runtimeVersion: runtimeVersion,
      runtimeScriptPath: script.getAttribute("src") || ""
    };
  }

  function createDebugState() {
    return {
      initializedAt: Date.now(),
      runtimeUrl: window.location.href,
      referrer: document.referrer || "",
      bootstrapParentOrigin: typeof bootstrapConfig.parentOrigin === "string" ? bootstrapConfig.parentOrigin : "",
      bootstrapHostOrigin: typeof bootstrapConfig.hostOrigin === "string" ? bootstrapConfig.hostOrigin : "",
      runtimeVersion: typeof bootstrapConfig.runtimeVersion === "string" ? bootstrapConfig.runtimeVersion : "",
      isIframe: isIframe(),
      lastRequestId: null,
      lastRequestAction: null,
      lastRequestTargetOrigin: null,
      lastResponseId: null,
      lastResponseOrigin: null,
      lastResponseAccepted: false,
      lastEventType: null,
      lastDropReason: null,
      lastTimeoutRequestId: null,
      lastTimeoutAction: null,
      lastTimeoutTargetOrigin: null,
      pendingRequestCount: 0,
      pendingRequestIds: [],
      iframeBridgeUnavailable: false,
      lastHttpFallbackAction: null,
      lastHttpRequestAction: null,
      lastHttpRequestUrl: null,
      debugEventCount: 0
    };
  }

  function updatePendingRequestCount() {
    var ids = Object.keys(pendingRequests);
    debugState.pendingRequestCount = ids.length;
    debugState.pendingRequestIds = ids;
  }

  function debugLog(stage, payload) {
    var entry = {
      at: new Date().toISOString(),
      source: "workspace-runtime",
      stage: stage,
      payload: payload || {}
    };
    debugEvents.push(entry);
    if (debugEvents.length > 200) {
      debugEvents.shift();
    }
    debugState.debugEventCount = debugEvents.length;

    if (!window.console || typeof window.console.debug !== "function") {
      return;
    }

    window.console.debug("[workspace-bridge] " + stage, payload);
  }

  function isIframe() {
    return window.parent && window.parent !== window;
  }

  function ensureParentOrigin() {
    if (parentOrigin) {
      return parentOrigin;
    }

    var context = readWorkspaceContext();
    if (context.parentOrigin) {
      parentOrigin = context.parentOrigin;
      return parentOrigin;
    }

    if (typeof bootstrapConfig.parentOrigin === "string" && bootstrapConfig.parentOrigin) {
      parentOrigin = bootstrapConfig.parentOrigin;
      return parentOrigin;
    }

    if (document.referrer) {
      try {
        parentOrigin = new URL(document.referrer).origin;
      } catch (_error) {
        parentOrigin = window.location.origin;
      }
    } else {
      parentOrigin = window.location.origin;
    }

    return parentOrigin;
  }

  function readWorkspaceContext() {
    var currentUrl;

    try {
      currentUrl = new URL(window.location.href);
    } catch (_error) {
      currentUrl = null;
    }

    var workspaceId = typeof bootstrapConfig.workspaceId === "string" && bootstrapConfig.workspaceId
      ? bootstrapConfig.workspaceId
      : currentUrl ? currentUrl.searchParams.get("workspaceId") : null;
    var previewPath = currentUrl ? currentUrl.pathname : "";
    var previewToken = "";
    var parentOriginFromQuery = currentUrl
      ? currentUrl.searchParams.get("_cns_parent_origin") || ""
      : "";

    if (previewPath.indexOf("/preview/files/") === 0) {
      var prefix = "/preview/files/";
      var remaining = previewPath.slice(prefix.length);
      previewToken = remaining.split("/")[0] || "";
    }

    if (!workspaceId && previewToken) {
      workspaceId = readWorkspaceIdFromPreviewToken(previewToken);
    }

    return {
      workspaceId: workspaceId || "",
      previewToken: previewToken,
      hostOrigin: window.location.origin,
      parentOrigin: parentOriginFromQuery
    };
  }

  function readWorkspaceIdFromPreviewToken(token) {
    var payload = token.split(".")[0];
    if (!payload) {
      return "";
    }

    try {
      var jsonText = decodeBase64Url(payload);
      var parsed = JSON.parse(jsonText);
      return parsed && typeof parsed.workspaceId === "string" ? parsed.workspaceId : "";
    } catch (_error) {
      return "";
    }
  }

  function decodeBase64Url(input) {
    var normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    var remainder = normalized.length % 4;

    if (remainder === 2) {
      normalized += "==";
    } else if (remainder === 3) {
      normalized += "=";
    } else if (remainder === 1) {
      return "";
    }

    try {
      return decodeURIComponent(escape(window.atob(normalized)));
    } catch (_error) {
      return "";
    }
  }

  function buildApiUrl(pathname, params) {
    var url = new URL(pathname, window.location.origin);
    if (params) {
      Object.keys(params).forEach(function (key) {
        var value = params[key];
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      });
    }
    return url.toString();
  }

  function ensureWorkspaceId(context) {
    if (!context.workspaceId) {
      throw new Error("当前 HTML 预览缺少 workspaceId，无法使用 CodingNSWorkspace");
    }
    return context.workspaceId;
  }

  function requestHost(action, payload) {
    var context = readWorkspaceContext();

    // 预览 token 已经能安全限定 workspace。静态 HTML 预览页直接走同源 HTTP，
    // 不再先撞 Tauri postMessage 这条在 macOS WebView 中可能沉默超时的链路。
    if (context.previewToken) {
      debugLog("preview-token-http-first", {
        action: action,
        payload: payload || {}
      });
      return requestHttp(action, payload);
    }

    if (iframeHostBridge && !iframeBridgeUnavailable) {
      return iframeHostBridge.request(action, payload).catch(function (error) {
        if (!shouldFallbackToHttp(error)) {
          debugLog("iframe-request-error-no-fallback", {
            action: action,
            message: error && error.message ? error.message : String(error || ""),
            code: error && error.code ? error.code : null
          });
          throw error;
        }

        iframeBridgeUnavailable = true;
        debugState.iframeBridgeUnavailable = true;
        debugState.lastHttpFallbackAction = action;
        debugLog("iframe-timeout-fallback-http", {
          action: action,
          payload: payload || {},
          message: error.message || ""
        });
        return requestHttp(action, payload);
      });
    }

    if (iframeHostBridge && iframeBridgeUnavailable) {
      debugLog("iframe-skipped-http-fallback", {
        action: action,
        payload: payload || {}
      });
    }

    return requestHttp(action, payload);
  }

  function shouldFallbackToHttp(error) {
    var message = error && typeof error.message === "string" ? error.message : "";
    return message.indexOf("等待宿主 workspace bridge 响应超时") >= 0;
  }

  function requestHttp(action, payload) {
    var context = readWorkspaceContext();
    var workspaceId = ensureWorkspaceId(context);
    var usePreviewBridge = Boolean(context.previewToken);
    var requestBody = usePreviewBridge
      ? Object.assign({}, payload || {})
      : Object.assign({ workspaceId: workspaceId }, payload || {});
    var requestConfig;

    function bridgeUrl(pathname, params) {
      if (usePreviewBridge) {
        return buildApiUrl("/preview/workspace-bridge" + pathname, Object.assign({
          token: context.previewToken
        }, params || {}));
      }

      return buildApiUrl("/api/files/workspace-bridge" + pathname, Object.assign({
        workspaceId: workspaceId
      }, params || {}));
    }

    function bridgePost(pathname, body) {
      var url = bridgeUrl(pathname);
      debugState.lastHttpRequestAction = action;
      debugState.lastHttpRequestUrl = url;
      debugLog("http-request", {
        action: action,
        url: url,
        previewTokenMode: usePreviewBridge
      });
      return fetchJson(url, {
        method: "POST",
        body: JSON.stringify(body)
      });
    }

    function bridgeGet(pathname, params) {
      var url = bridgeUrl(pathname, params);
      debugState.lastHttpRequestAction = action;
      debugState.lastHttpRequestUrl = url;
      debugLog("http-request", {
        action: action,
        url: url,
        previewTokenMode: usePreviewBridge
      });
      return fetchJson(url);
    }

    switch (action) {
      case "capabilities":
        return bridgeGet("/capabilities");
      case "listDir":
        requestConfig = requestBody;
        return bridgePost("/list-dir", requestConfig);
      case "readText":
        requestConfig = requestBody;
        return bridgePost("/read-text", requestConfig);
      case "readTexts":
        requestConfig = requestBody;
        return bridgePost("/read-texts", requestConfig);
      case "writeText":
        requestConfig = requestBody;
        return bridgePost("/write-text", requestConfig);
      case "deleteFile":
        requestConfig = requestBody;
        return bridgePost("/delete-file", requestConfig);
      case "stat":
        return bridgeGet("/stat", {
          path: payload && payload.path ? payload.path : ""
        });
      case "exists":
        return bridgeGet("/exists", {
          path: payload && payload.path ? payload.path : ""
        });
      case "openWorkspaceFile":
        requestConfig = requestBody;
        return bridgePost("/open-file", requestConfig).then(function (prepared) {
          return runDesktopAction("openFile", prepared, "DESKTOP_OPEN_UNAVAILABLE", "当前环境不支持打开本地文件");
        });
      case "revealWorkspaceFile":
        requestConfig = requestBody;
        return bridgePost("/reveal-in-file-manager", requestConfig).then(function (prepared) {
          return runDesktopAction("revealInFileManager", prepared, "DESKTOP_REVEAL_UNAVAILABLE", "当前环境不支持在文件管理器中定位文件");
        });
      case "watchDir":
        requestConfig = requestBody;
        return bridgePost("/watch-dir", requestConfig);
      case "unwatch":
        requestConfig = payload || {};
        return bridgePost("/unwatch", requestConfig);
      case "watchPoll":
        return bridgeGet("/watch-events", {
          watchId: payload && payload.watchId ? payload.watchId : "",
          cursor: payload && typeof payload.cursor === "number" ? payload.cursor : ""
        });
      case "applyIndexConfig":
        requestConfig = requestBody;
        return bridgePost("/apply-index-config", requestConfig);
      default:
        return Promise.reject(new Error("不支持的 workspace bridge 动作: " + action));
    }
  }

  function fetchJson(input, init) {
    return fetch(input, Object.assign({
      credentials: "include",
      headers: {
        "content-type": "application/json"
      }
    }, init || {})).then(function (response) {
      return response.text().then(function (text) {
        var body = null;

        if (text) {
          try {
            body = JSON.parse(text);
          } catch (parseError) {
            debugLog("http-response-parse-error", {
              url: typeof input === "string" ? input : "",
              status: response.status,
              statusText: response.statusText,
              bodyPreview: text.slice(0, 500),
              message: parseError && parseError.message ? parseError.message : String(parseError || "")
            });
          }
        }

        debugLog("http-response", {
          url: typeof input === "string" ? input : "",
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          errorCode: body && body.error_code ? body.error_code : null,
          detail: body && body.detail ? body.detail : null,
          bodyPreview: body ? null : text.slice(0, 500)
        });

        if (!response.ok) {
          var error = new Error(body && body.detail ? body.detail : "请求失败 HTTP " + String(response.status));
          error.code = body && body.error_code ? body.error_code : "HTTP_" + String(response.status);
          error.status = response.status;
          error.path = body && body.data && typeof body.data.path === "string" ? body.data.path : undefined;
          error.bodyPreview = body ? undefined : text.slice(0, 500);
          throw error;
        }

        if (!body) {
          var invalidJsonError = new Error("响应不是有效 JSON");
          invalidJsonError.code = "INVALID_JSON_RESPONSE";
          invalidJsonError.status = response.status;
          invalidJsonError.bodyPreview = text.slice(0, 500);
          throw invalidJsonError;
        }

        return body;
      });
    });
  }

  function createIframeHostBridge() {
    if (!isIframe()) {
      return null;
    }

    window.addEventListener("message", function (event) {
      var payload = event.data;
      debugState.lastEventType = payload && typeof payload === "object" && typeof payload.type === "string"
        ? payload.type
        : null;
      debugState.lastResponseOrigin = event.origin || null;
      debugLog("message", {
        origin: event.origin,
        expectedOrigin: ensureParentOrigin(),
        fromParent: event.source === window.parent,
        type: payload && payload.type ? payload.type : null
      });

      if (event.source !== window.parent) {
        debugState.lastDropReason = "message source is not parent";
        debugLog("drop-message", {
          reason: debugState.lastDropReason,
          origin: event.origin,
          expectedOrigin: ensureParentOrigin(),
          type: payload && payload.type ? payload.type : null
        });
        return;
      }

      if (event.origin !== ensureParentOrigin()) {
        debugState.lastDropReason = "origin mismatch";
        debugLog("drop-message", {
          reason: debugState.lastDropReason,
          origin: event.origin,
          expectedOrigin: ensureParentOrigin(),
          type: payload && payload.type ? payload.type : null
        });
        return;
      }

      if (!payload || typeof payload !== "object") {
        debugState.lastDropReason = "payload is not object";
        debugLog("drop-message", {
          reason: debugState.lastDropReason,
          origin: event.origin
        });
        return;
      }

      if (payload.type === DEBUG_TYPE) {
        debugLog("host-debug", {
          origin: event.origin,
          detail: payload.payload || null
        });
        return;
      }

      if (payload.type === EVENT_TYPE && typeof payload.watchId === "string") {
        debugLog("watch-event", {
          watchId: payload.watchId,
          origin: event.origin
        });
        dispatchWatchEvent(payload.watchId, payload.payload);
        return;
      }

      if (payload.type !== RESPONSE_TYPE || typeof payload.id !== "string") {
        debugState.lastDropReason = "not response payload";
        debugLog("drop-message", {
          reason: debugState.lastDropReason,
          origin: event.origin,
          type: payload.type || null,
          id: payload.id || null
        });
        return;
      }

      var pending = pendingRequests[payload.id];
      if (!pending) {
        debugState.lastDropReason = "no pending request for response";
        debugLog("drop-response", {
          reason: debugState.lastDropReason,
          id: payload.id,
          origin: event.origin,
          pendingRequestIds: Object.keys(pendingRequests)
        });
        return;
      }

      delete pendingRequests[payload.id];
      updatePendingRequestCount();
      window.clearTimeout(pending.timer);
      debugState.lastResponseId = payload.id;
      debugState.lastResponseAccepted = true;

      debugLog("response-accepted", {
        id: payload.id,
        ok: payload.ok !== false,
        origin: event.origin
      });

      if (payload.ok === false) {
        var bridgeError = new Error(payload.error && payload.error.message ? payload.error.message : "宿主桥调用失败");
        bridgeError.code = payload.error && payload.error.code ? payload.error.code : "INTERNAL_ERROR";
        bridgeError.path = payload.error && payload.error.path ? payload.error.path : undefined;
        pending.reject(bridgeError);
        return;
      }

      pending.resolve(payload.payload);
    });

    return {
      request: function (action, payload) {
        return new Promise(function (resolve, reject) {
          requestSeq += 1;
          var requestId = "workspace-bridge-" + String(Date.now()) + "-" + String(requestSeq);
          var targetOrigin = ensureParentOrigin();
          pendingRequests[requestId] = {
            resolve: resolve,
            reject: reject,
            timer: window.setTimeout(function () {
              delete pendingRequests[requestId];
              updatePendingRequestCount();
              debugState.lastTimeoutRequestId = requestId;
              debugState.lastTimeoutAction = action;
              debugState.lastTimeoutTargetOrigin = targetOrigin;
              debugLog("request-timeout", {
                requestId: requestId,
                action: action,
                targetOrigin: targetOrigin,
                pendingRequestIds: Object.keys(pendingRequests),
                lastResponseId: debugState.lastResponseId,
                lastResponseOrigin: debugState.lastResponseOrigin,
                lastDropReason: debugState.lastDropReason
              });
              var timeoutError = new Error("等待宿主 workspace bridge 响应超时");
              timeoutError.code = "INTERNAL_ERROR";
              reject(timeoutError);
            }, REQUEST_TIMEOUT_MS)
          };
          updatePendingRequestCount();
          debugState.lastRequestId = requestId;
          debugState.lastRequestAction = action;
          debugState.lastRequestTargetOrigin = targetOrigin;
          debugLog("request", {
            requestId: requestId,
            action: action,
            targetOrigin: targetOrigin,
            payload: payload || {}
          });

          window.parent.postMessage({
            type: REQUEST_TYPE,
            id: requestId,
            action: action,
            payload: payload || {}
          }, targetOrigin);
        });
      }
    };
  }

  function createBridgeError(code, message, path) {
    var error = new Error(message);
    error.code = code;
    error.path = path;
    return error;
  }

  function getDesktopFsBridge() {
    var desktop = window.CodingNSDesktop;
    if (!desktop || !desktop.fs) {
      return null;
    }

    return desktop.fs;
  }

  function runDesktopAction(actionName, prepared, unavailableCode, unavailableMessage) {
    if (!prepared || typeof prepared !== "object" || typeof prepared.absolutePath !== "string") {
      return Promise.reject(createBridgeError("INTERNAL_ERROR", "桌面动作预处理结果无效"));
    }

    var fsBridge = getDesktopFsBridge();
    if (!fsBridge || typeof fsBridge[actionName] !== "function") {
      return Promise.reject(createBridgeError(unavailableCode, unavailableMessage, prepared.relativePath));
    }

    return fsBridge[actionName](prepared.absolutePath).then(function (result) {
      if (!result || result.ok !== true) {
        throw createBridgeError(
          result && result.errorCode ? result.errorCode : "INTERNAL_ERROR",
          result && result.detail ? result.detail : unavailableMessage,
          prepared.relativePath
        );
      }

      return prepared;
    });
  }

  function dispatchWatchEvent(watchId, payload) {
    var listeners = watchListeners[watchId];
    if (!listeners || listeners.length === 0) {
      return;
    }

    listeners.slice().forEach(function (listener) {
      try {
        listener(payload);
      } catch (_error) {
        // ignore listener error
      }
    });
  }

  function ensureWatchListenerBucket(watchId) {
    if (!watchListeners[watchId]) {
      watchListeners[watchId] = [];
    }

    return watchListeners[watchId];
  }

  function addWatchListener(watchId, callback) {
    if (typeof callback !== "function") {
      return;
    }

    ensureWatchListenerBucket(watchId).push(callback);
  }

  function removeWatchListener(watchId, callback) {
    var listeners = watchListeners[watchId];
    if (!listeners || listeners.length === 0) {
      return;
    }

    watchListeners[watchId] = listeners.filter(function (item) {
      return item !== callback;
    });

    if (watchListeners[watchId].length === 0) {
      delete watchListeners[watchId];
    }
  }

  function startDirectWatchPolling(watchId) {
    if (iframeHostBridge || activeWatchPollers[watchId]) {
      return;
    }

    var state = {
      stopped: false,
      cursor: 0
    };
    activeWatchPollers[watchId] = state;

    function loop() {
      if (state.stopped) {
        delete activeWatchPollers[watchId];
        return;
      }

      requestHost("watchPoll", {
        watchId: watchId,
        cursor: state.cursor
      }).then(function (result) {
        if (!result || typeof result !== "object") {
          return;
        }

        if (typeof result.nextCursor === "number") {
          state.cursor = result.nextCursor;
        }

        if (Array.isArray(result.events)) {
          result.events.forEach(function (eventPayload) {
            dispatchWatchEvent(watchId, eventPayload);
          });
        }
      }).catch(function (error) {
        if (error && error.code === "WATCH_NOT_FOUND") {
          state.stopped = true;
        }
      }).finally(function () {
        if (!state.stopped) {
          window.setTimeout(loop, WATCH_POLL_INTERVAL_MS);
        } else {
          delete activeWatchPollers[watchId];
        }
      });
    }

    loop();
  }

  function stopDirectWatchPolling(watchId) {
    if (!activeWatchPollers[watchId]) {
      return;
    }

    activeWatchPollers[watchId].stopped = true;
    delete activeWatchPollers[watchId];
  }

  function createWatchHandle(watchId, callback) {
    return {
      watchId: watchId,
      unsubscribe: function () {
        if (typeof callback === "function") {
          removeWatchListener(watchId, callback);
        }

        stopDirectWatchPolling(watchId);
        return requestHost("unwatch", {
          watchId: watchId
        }).catch(function (error) {
          if (error && error.code === "WATCH_NOT_FOUND") {
            return {
              ok: true,
              watchId: watchId
            };
          }
          throw error;
        });
      }
    };
  }

  var workspace = {
    capabilities: function () {
      return requestHost("capabilities");
    },
    requestPermission: function (_input) {
      return Promise.resolve({
        ok: true,
        granted: true,
        scope: "workspace"
      });
    },
    listDir: function (relativePath, options) {
      return requestHost("listDir", {
        path: typeof relativePath === "string" ? relativePath : "",
        options: options || {}
      });
    },
    readText: function (relativePath, options) {
      return requestHost("readText", {
        path: typeof relativePath === "string" ? relativePath : "",
        options: options || {}
      });
    },
    readTexts: function (paths, options) {
      return requestHost("readTexts", {
        paths: Array.isArray(paths) ? paths : [],
        options: options || {}
      });
    },
    writeText: function (relativePath, content, options) {
      return requestHost("writeText", {
        path: typeof relativePath === "string" ? relativePath : "",
        content: typeof content === "string" ? content : "",
        options: options || {}
      });
    },
    writeTexts: function () {
      return Promise.reject(createBridgeError("INTERNAL_ERROR", "当前版本暂不支持批量写入"));
    },
    deleteFile: function (relativePath, options) {
      return requestHost("deleteFile", {
        path: typeof relativePath === "string" ? relativePath : "",
        options: options || {}
      });
    },
    stat: function (relativePath) {
      return requestHost("stat", {
        path: typeof relativePath === "string" ? relativePath : ""
      });
    },
    exists: function (relativePath) {
      return requestHost("exists", {
        path: typeof relativePath === "string" ? relativePath : ""
      });
    },
    openWorkspaceFile: function (relativePath) {
      return requestHost("openWorkspaceFile", {
        path: typeof relativePath === "string" ? relativePath : ""
      });
    },
    revealWorkspaceFile: function (relativePath) {
      return requestHost("revealWorkspaceFile", {
        path: typeof relativePath === "string" ? relativePath : ""
      });
    },
    watchDir: function (relativePath, options, callback) {
      var resolvedOptions = options;
      var resolvedCallback = callback;

      if (typeof options === "function") {
        resolvedCallback = options;
        resolvedOptions = {};
      }

      return requestHost("watchDir", {
        path: typeof relativePath === "string" ? relativePath : "",
        options: resolvedOptions || {}
      }).then(function (result) {
        var watchId = result && typeof result.watchId === "string" ? result.watchId : "";
        if (!watchId) {
          throw createBridgeError("INTERNAL_ERROR", "目录监听返回了无效 watchId");
        }

        if (typeof resolvedCallback === "function") {
          addWatchListener(watchId, resolvedCallback);
        }

        startDirectWatchPolling(watchId);
        return createWatchHandle(watchId, resolvedCallback);
      });
    },
    unwatch: function (watchIdOrHandle) {
      if (watchIdOrHandle && typeof watchIdOrHandle === "object" && typeof watchIdOrHandle.unsubscribe === "function") {
        return watchIdOrHandle.unsubscribe();
      }

      var watchId = typeof watchIdOrHandle === "string"
        ? watchIdOrHandle
        : watchIdOrHandle && typeof watchIdOrHandle.watchId === "string"
          ? watchIdOrHandle.watchId
          : "";

      if (!watchId) {
        return Promise.reject(createBridgeError("INVALID_WATCH_ID", "必须提供 watchId"));
      }

      stopDirectWatchPolling(watchId);
      delete watchListeners[watchId];
      return requestHost("unwatch", {
        watchId: watchId
      }).catch(function (error) {
        if (error && error.code === "WATCH_NOT_FOUND") {
          return {
            ok: true,
            watchId: watchId
          };
        }
        throw error;
      });
    },
    applyIndexConfig: function () {
      return requestHost("applyIndexConfig", {});
    },
    bridgeProtocol: {
      requestType: REQUEST_TYPE,
      responseType: RESPONSE_TYPE,
      eventType: EVENT_TYPE,
      debugType: DEBUG_TYPE,
      runtimeVersion: typeof bootstrapConfig.runtimeVersion === "string" ? bootstrapConfig.runtimeVersion : "",
      parentOrigin: isIframe() ? ensureParentOrigin() : null
    },
    debug: debugState,
    debugEvents: debugEvents
  };

  Object.defineProperty(window, "CodingNSWorkspace", {
    configurable: true,
    writable: false,
    value: workspace
  });
})();
