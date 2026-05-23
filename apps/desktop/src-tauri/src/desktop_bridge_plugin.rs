use tauri::{plugin::Builder as PluginBuilder, plugin::TauriPlugin, Runtime};

const CODINGNS_DESKTOP_INIT_SCRIPT: &str = r#"
  (function () {
    if (window.__CODINGNS_DESKTOP_BRIDGE_INSTALLED__) {
      return;
    }
    window.__CODINGNS_DESKTOP_BRIDGE_INSTALLED__ = true;

    var REQUEST_EVENT = "codingns-desktop-bridge-request";
    var RESPONSE_EVENT = "codingns-desktop-bridge-response";
    var REQUEST_TIMEOUT_MS = 5000;
    var relayRequestSeq = 0;
    var relayPending = Object.create(null);

    function hasDirectInvoke() {
      return !!(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === "function");
    }

    function readParentOriginFromQuery() {
      try {
        var currentUrl = new URL(window.location.href);
        return currentUrl.searchParams.get("_cns_parent_origin") || "";
      } catch (_error) {
        return "";
      }
    }

    function resolveParentOrigin() {
      var fromQuery = readParentOriginFromQuery();
      if (fromQuery) {
        return fromQuery;
      }

      try {
        if (document.referrer) {
          return new URL(document.referrer).origin;
        }
      } catch (_error) {}

      return window.location.origin;
    }

    function canRelayToParent() {
      return window.parent && window.parent !== window && !!resolveParentOrigin();
    }

    function unsupported(detail) {
      return {
        ok: false,
        errorCode: "PLATFORM_NOT_SUPPORTED",
        detail: detail
      };
    }

    function parseBridgeError(error) {
      var message = error instanceof Error ? error.message : String(error || "桌面壳调用失败。");
      var matched = message.match(/^([A-Z0-9_]+):\s*(.+)$/);
      if (!matched) {
        return {
          ok: false,
          errorCode: "SHELL_BRIDGE_ERROR",
          detail: message
        };
      }

      return {
        ok: false,
        errorCode: matched[1],
        detail: matched[2]
      };
    }

    function buildTimeoutResult() {
      return {
        ok: false,
        errorCode: "SHELL_BRIDGE_TIMEOUT",
        detail: "等待宿主页面响应桌面 bridge 超时。"
      };
    }

    function resolveRelayRequest(requestId, result) {
      var pending = relayPending[requestId];
      if (!pending) {
        return;
      }

      delete relayPending[requestId];
      window.clearTimeout(pending.timer);
      pending.resolve(result);
    }

    async function invokeDirect(command, args) {
      if (!hasDirectInvoke()) {
        return unsupported("当前运行环境不支持桌面壳能力。");
      }

      try {
        var value = await window.__TAURI_INTERNALS__.invoke(command, args);
        return {
          ok: true,
          value: value
        };
      } catch (error) {
        return parseBridgeError(error);
      }
    }

    function invokeViaParent(command, args) {
      if (!canRelayToParent()) {
        return Promise.resolve(unsupported("当前运行环境不支持桌面壳能力。"));
      }

      return new Promise(function (resolve) {
        relayRequestSeq += 1;
        var requestId = "codingns-desktop-" + String(Date.now()) + "-" + String(relayRequestSeq);
        var timer = window.setTimeout(function () {
          resolveRelayRequest(requestId, buildTimeoutResult());
        }, REQUEST_TIMEOUT_MS);

        relayPending[requestId] = {
          resolve: resolve,
          timer: timer
        };

        window.parent.postMessage(
          {
            type: REQUEST_EVENT,
            requestId: requestId,
            command: command,
            args: args || {}
          },
          resolveParentOrigin()
        );
      });
    }

    async function invokeDesktop(command, args) {
      if (hasDirectInvoke()) {
        return invokeDirect(command, args);
      }

      return invokeViaParent(command, args);
    }

    window.addEventListener("message", function (event) {
      var payload = event && event.data;
      if (!payload || typeof payload !== "object") {
        return;
      }

      var parentOrigin = resolveParentOrigin();
      var eventOrigin = event.origin || "";
      var currentOrigin = window.location.origin || "";
      var isExpectedParentOrigin = eventOrigin === parentOrigin;
      var isPreviewChildToDesktopParent = !!(
        payload.type === REQUEST_EVENT
        && hasDirectInvoke()
        && currentOrigin.indexOf("tauri://") === 0
        && eventOrigin.indexOf("http") === 0
      );

      if (!isExpectedParentOrigin && !isPreviewChildToDesktopParent) {
        return;
      }

      if (payload.type === RESPONSE_EVENT) {
        if (typeof payload.requestId !== "string") {
          return;
        }

        resolveRelayRequest(payload.requestId, payload.result || unsupported("桌面 bridge 响应为空。"));
        return;
      }

      if (payload.type !== REQUEST_EVENT) {
        return;
      }

      if (typeof payload.requestId !== "string" || typeof payload.command !== "string") {
        return;
      }

      if (!hasDirectInvoke()) {
        return;
      }

      var source = event.source;
      if (!source || typeof source.postMessage !== "function") {
        return;
      }

      invokeDirect(payload.command, payload.args || {}).then(function (result) {
        source.postMessage(
          {
            type: RESPONSE_EVENT,
            requestId: payload.requestId,
            result: result
          },
          eventOrigin || currentOrigin || parentOrigin
        );
      });
    });

    Object.defineProperty(window, "CodingNSDesktop", {
      configurable: true,
      value: {
        runtime: {
          isAvailable: function () {
            return hasDirectInvoke() || canRelayToParent();
          },
          getPlatformInfo: function () {
            return invokeDesktop("get_platform_info");
          }
        },
        fs: {
          openFile: function (path) {
            return invokeDesktop("open_local_file", { path: path });
          },
          revealInFileManager: function (path) {
            return invokeDesktop("reveal_in_file_manager", { path: path });
          },
          pickDirectory: function () {
            return invokeDesktop("pick_directory");
          }
        }
      }
    });
  })();
"#;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("codingns_desktop_bridge")
        .js_init_script(CODINGNS_DESKTOP_INIT_SCRIPT)
        .build()
}
