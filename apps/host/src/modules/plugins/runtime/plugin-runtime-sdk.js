(function () {
  if (typeof window === "undefined") {
    return;
  }

  if (window.CodingNSPlugin) {
    return;
  }

  var parentWindow = window.parent;
  var parentOrigin = null;
  var contextPromise = null;
  var pendingRequests = Object.create(null);
  var requestSeq = 0;
  var REQUEST_TYPE = "codingns-plugin:request";
  var RESPONSE_TYPE = "codingns-plugin:response";
  var READY_TYPE = "codingns-plugin:ready";
  var INIT_TYPE = "codingns-plugin:init";
  var TIMEOUT_MS = 15000;

  function isParentMessage(event) {
    return event && event.source === parentWindow && typeof event.origin === "string";
  }

  function ensureParentOrigin() {
    if (parentOrigin) {
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

  function createTimeoutResult(id) {
    return {
      requestId: id,
      ok: false,
      error: {
        code: "PLUGIN_BRIDGE_TIMEOUT",
        detail: "等待插件宿主响应超时"
      }
    };
  }

  function resolvePending(requestId, payload) {
    var pending = pendingRequests[requestId];
    if (!pending) {
      return;
    }

    delete pendingRequests[requestId];
    window.clearTimeout(pending.timer);
    if (payload.ok === false) {
      pending.reject(new Error((payload.error && payload.error.detail) || "插件桥调用失败"));
      return;
    }

    pending.resolve(payload.result);
  }

  function postToParent(message) {
    parentWindow.postMessage(message, ensureParentOrigin());
  }

  function getContext() {
    if (!contextPromise) {
      contextPromise = new Promise(function (resolve, reject) {
        var settled = false;
        var timer = window.setTimeout(function () {
          if (settled) {
            return;
          }
          settled = true;
          reject(new Error("插件上下文初始化超时"));
        }, TIMEOUT_MS);

        function handleMessage(event) {
          if (!isParentMessage(event)) {
            return;
          }

          if (event.origin !== ensureParentOrigin()) {
            return;
          }

          var payload = event.data;
          if (!payload || typeof payload !== "object" || payload.type !== INIT_TYPE) {
            return;
          }

          window.removeEventListener("message", handleMessage);
          window.clearTimeout(timer);
          settled = true;
          resolve(payload.context);
        }

        window.addEventListener("message", handleMessage);
        postToParent({ type: READY_TYPE });
      });
    }

    return contextPromise;
  }

  function callHost(action, payload) {
    return getContext().then(function () {
      return new Promise(function (resolve, reject) {
        requestSeq += 1;
        var requestId = "plugin-req-" + String(Date.now()) + "-" + String(requestSeq);
        pendingRequests[requestId] = {
          resolve: resolve,
          reject: reject,
          timer: window.setTimeout(function () {
            resolvePending(requestId, createTimeoutResult(requestId));
          }, TIMEOUT_MS)
        };

        postToParent({
          type: REQUEST_TYPE,
          requestId: requestId,
          action: action,
          payload: payload || {}
        });
      });
    });
  }

  window.addEventListener("message", function (event) {
    if (!isParentMessage(event)) {
      return;
    }

    if (event.origin !== ensureParentOrigin()) {
      return;
    }

    var payload = event.data;
    if (!payload || typeof payload !== "object" || payload.type !== RESPONSE_TYPE || typeof payload.requestId !== "string") {
      return;
    }

    resolvePending(payload.requestId, payload);
  });

  window.CodingNSPlugin = {
    getContext: getContext,
    callAction: function (actionId, input) {
      return callHost("callAction", {
        actionId: actionId,
        input: input === undefined ? null : input
      });
    },
    openFile: function (relativePath) {
      return callHost("openFile", {
        path: relativePath
      });
    },
    revealInFileManager: function (relativePath) {
      return callHost("revealInFileManager", {
        path: relativePath
      });
    }
  };
})();
