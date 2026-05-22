(function () {
  if (typeof window === "undefined") {
    return;
  }

  if (window.CodingNSWorkspace) {
    return;
  }

  var REQUEST_TIMEOUT_MS = 15000;
  var WATCH_POLL_INTERVAL_MS = 700;
  var RESPONSE_TYPE = "codingns.workspace.response";
  var REQUEST_TYPE = "codingns.workspace.request";
  var EVENT_TYPE = "codingns.workspace.event";
  var bootstrapConfig = readBootstrapConfig();
  var parentOrigin = null;
  var pendingRequests = Object.create(null);
  var watchListeners = Object.create(null);
  var activeWatchPollers = Object.create(null);
  var requestSeq = 0;
  var debugState = createDebugState();
  var iframeHostBridge = createIframeHostBridge();

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
    return {
      workspaceId: workspaceId,
      hostOrigin: hostOrigin,
      parentOrigin: parentOrigin,
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
      isIframe: isIframe(),
      lastRequestId: null,
      lastRequestAction: null,
      lastRequestTargetOrigin: null,
      lastResponseId: null,
      lastResponseOrigin: null,
      lastResponseAccepted: false,
      lastEventType: null,
      pendingRequestCount: 0
    };
  }

  function updatePendingRequestCount() {
    debugState.pendingRequestCount = Object.keys(pendingRequests).length;
  }

  function isIframe() {
    return window.parent && window.parent !== window;
  }

  function ensureParentOrigin() {
    if (parentOrigin) {
      return parentOrigin;
    }

    if (typeof bootstrapConfig.parentOrigin === "string" && bootstrapConfig.parentOrigin) {
      parentOrigin = bootstrapConfig.parentOrigin;
      return parentOrigin;
    }

    if (typeof bootstrapConfig.hostOrigin === "string" && bootstrapConfig.hostOrigin) {
      parentOrigin = bootstrapConfig.hostOrigin;
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
      hostOrigin: window.location.origin
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
    if (iframeHostBridge) {
      return iframeHostBridge.request(action, payload);
    }

    return requestHttp(action, payload);
  }

  function requestHttp(action, payload) {
    var context = readWorkspaceContext();
    var workspaceId = ensureWorkspaceId(context);
    var requestBody = Object.assign({ workspaceId: workspaceId }, payload || {});
    var requestConfig;

    switch (action) {
      case "capabilities":
        return fetchJson(buildApiUrl("/api/files/workspace-bridge/capabilities", {
          workspaceId: workspaceId
        }));
      case "listDir":
        requestConfig = {
          method: "POST",
          body: JSON.stringify(requestBody)
        };
        return fetchJson("/api/files/workspace-bridge/list-dir", requestConfig);
      case "readText":
        requestConfig = {
          method: "POST",
          body: JSON.stringify(requestBody)
        };
        return fetchJson("/api/files/workspace-bridge/read-text", requestConfig);
      case "readTexts":
        requestConfig = {
          method: "POST",
          body: JSON.stringify(requestBody)
        };
        return fetchJson("/api/files/workspace-bridge/read-texts", requestConfig);
      case "writeText":
        requestConfig = {
          method: "POST",
          body: JSON.stringify(requestBody)
        };
        return fetchJson("/api/files/workspace-bridge/write-text", requestConfig);
      case "deleteFile":
        requestConfig = {
          method: "POST",
          body: JSON.stringify(requestBody)
        };
        return fetchJson("/api/files/workspace-bridge/delete-file", requestConfig);
      case "stat":
        return fetchJson(buildApiUrl("/api/files/workspace-bridge/stat", {
          workspaceId: workspaceId,
          path: payload && payload.path ? payload.path : ""
        }));
      case "exists":
        return fetchJson(buildApiUrl("/api/files/workspace-bridge/exists", {
          workspaceId: workspaceId,
          path: payload && payload.path ? payload.path : ""
        }));
      case "openWorkspaceFile":
        requestConfig = {
          method: "POST",
          body: JSON.stringify(requestBody)
        };
        return fetchJson("/api/files/workspace-bridge/open-file", requestConfig).then(function (prepared) {
          return runDesktopAction("openFile", prepared, "DESKTOP_OPEN_UNAVAILABLE", "当前环境不支持打开本地文件");
        });
      case "revealWorkspaceFile":
        requestConfig = {
          method: "POST",
          body: JSON.stringify(requestBody)
        };
        return fetchJson("/api/files/workspace-bridge/reveal-in-file-manager", requestConfig).then(function (prepared) {
          return runDesktopAction("revealInFileManager", prepared, "DESKTOP_REVEAL_UNAVAILABLE", "当前环境不支持在文件管理器中定位文件");
        });
      case "watchDir":
        requestConfig = {
          method: "POST",
          body: JSON.stringify(requestBody)
        };
        return fetchJson("/api/files/workspace-bridge/watch-dir", requestConfig);
      case "unwatch":
        requestConfig = {
          method: "POST",
          body: JSON.stringify(payload || {})
        };
        return fetchJson("/api/files/workspace-bridge/unwatch", requestConfig);
      case "watchPoll":
        return fetchJson(buildApiUrl("/api/files/workspace-bridge/watch-events", {
          watchId: payload && payload.watchId ? payload.watchId : "",
          cursor: payload && typeof payload.cursor === "number" ? payload.cursor : ""
        }));
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
      return response.json().then(function (body) {
        if (!response.ok) {
          var error = new Error(body && body.detail ? body.detail : "请求失败");
          error.code = body && body.error_code ? body.error_code : "INTERNAL_ERROR";
          error.path = body && body.data && typeof body.data.path === "string" ? body.data.path : undefined;
          throw error;
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

      if (event.source !== window.parent) {
        return;
      }

      if (event.origin !== ensureParentOrigin()) {
        return;
      }

      if (!payload || typeof payload !== "object") {
        return;
      }

      if (payload.type === EVENT_TYPE && typeof payload.watchId === "string") {
        dispatchWatchEvent(payload.watchId, payload.payload);
        return;
      }

      if (payload.type !== RESPONSE_TYPE || typeof payload.id !== "string") {
        return;
      }

      var pending = pendingRequests[payload.id];
      if (!pending) {
        return;
      }

      delete pendingRequests[payload.id];
      updatePendingRequestCount();
      window.clearTimeout(pending.timer);
      debugState.lastResponseId = payload.id;
      debugState.lastResponseAccepted = true;

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
              var timeoutError = new Error("等待宿主 workspace bridge 响应超时");
              timeoutError.code = "INTERNAL_ERROR";
              reject(timeoutError);
            }, REQUEST_TIMEOUT_MS)
          };
          updatePendingRequestCount();
          debugState.lastRequestId = requestId;
          debugState.lastRequestAction = action;
          debugState.lastRequestTargetOrigin = targetOrigin;

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
    bridgeProtocol: {
      requestType: REQUEST_TYPE,
      responseType: RESPONSE_TYPE,
      eventType: EVENT_TYPE,
      parentOrigin: isIframe() ? ensureParentOrigin() : null
    },
    debug: debugState
  };

  Object.defineProperty(window, "CodingNSWorkspace", {
    configurable: true,
    writable: false,
    value: workspace
  });
})();
