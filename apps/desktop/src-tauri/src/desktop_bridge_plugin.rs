use tauri::{plugin::Builder as PluginBuilder, plugin::TauriPlugin, Runtime};

const CODINGNS_DESKTOP_INIT_SCRIPT: &str = r#"
  (function () {
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

    async function invokeDesktop(command, args) {
      var invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
      if (typeof invoke !== "function") {
        return unsupported("当前运行环境不支持桌面壳能力。");
      }

      try {
        var value = await invoke(command, args);
        return {
          ok: true,
          value: value
        };
      } catch (error) {
        return parseBridgeError(error);
      }
    }

    Object.defineProperty(window, "CodingNSDesktop", {
      configurable: true,
      value: {
        runtime: {
          isAvailable: function () {
            return !!(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === "function");
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
        .js_init_script_on_all_frames(CODINGNS_DESKTOP_INIT_SCRIPT)
        .build()
}
