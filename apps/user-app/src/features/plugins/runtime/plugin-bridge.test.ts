import { afterEach, describe, expect, it, vi } from "vitest";

import { attachPluginBridge, setPluginPermissionPromptHandlerForTesting } from "./plugin-bridge";
import * as pluginsApi from "../api/plugins-api";
import * as desktopBridge from "../../../platform/desktop/codingns-desktop-bridge";
import { ApiError } from "../../../shared/network/api-error";

function createIframeWindowStub() {
  return {
    postMessage: vi.fn()
  } as unknown as Window;
}

describe("plugin bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setPluginPermissionPromptHandlerForTesting(null);
  });

  it("只接受来自目标 iframe + 正确 origin 的消息，并能转发动作", async () => {
    const iframeWindow = createIframeWindowStub();
    const iframe = {
      contentWindow: iframeWindow
    } as HTMLIFrameElement;

    vi.spyOn(pluginsApi, "callPluginAction").mockResolvedValue({
      run: {
        id: "run-1",
        pluginId: "demo.plugin",
        workspaceId: "workspace-1",
        runtimeSessionId: "runtime-session-1",
        triggerKind: "frontend",
        actionId: "run-report",
        status: "succeeded",
        inputSummaryJson: null,
        outputSummaryJson: null,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        createdAt: "2026-05-21T00:00:00.000Z"
      },
      output: {
        ok: true
      }
    });

    const dispose = attachPluginBridge({
      iframe,
      pluginId: "demo.plugin",
      hostOrigin: "http://127.0.0.1:3002",
      context: {
        pluginId: "demo.plugin",
        workspaceId: "workspace-1",
        runtimeSessionId: "runtime-session-1",
        pluginName: "演示插件",
        pluginVersion: "1.0.0",
        frontendEntryUrl: "/preview/plugins/demo.plugin/frontend/index.html",
        hostOrigin: "http://127.0.0.1:3002"
      }
    });

    window.dispatchEvent(new MessageEvent("message", {
      origin: "http://evil.example",
      source: iframeWindow,
      data: {
        type: "codingns-plugin:ready"
      }
    }));
    expect((iframeWindow.postMessage as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent("message", {
      origin: "http://127.0.0.1:3002",
      source: iframeWindow,
      data: {
        type: "codingns-plugin:ready"
      }
    }));
    expect((iframeWindow.postMessage as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      type: "codingns-plugin:init",
      context: expect.objectContaining({
        pluginId: "demo.plugin",
        workspaceId: "workspace-1",
        runtimeSessionId: "runtime-session-1"
      })
    }, "http://127.0.0.1:3002");

    window.dispatchEvent(new MessageEvent("message", {
      origin: "http://127.0.0.1:3002",
      source: iframeWindow,
      data: {
        type: "codingns-plugin:request",
        requestId: "req-1",
        action: "callAction",
        payload: {
          actionId: "run-report",
          input: {
            range: "today"
          }
        }
      }
    }));

    await flushBridgeTasks();

    expect(pluginsApi.callPluginAction).toHaveBeenCalledWith("demo.plugin", "run-report", "runtime-session-1", {
      range: "today"
    });
    expect((iframeWindow.postMessage as unknown as ReturnType<typeof vi.fn>)).toHaveBeenLastCalledWith({
      type: "codingns-plugin:response",
      requestId: "req-1",
      ok: true,
      result: expect.objectContaining({
        output: {
          ok: true
        }
      })
    }, "http://127.0.0.1:3002");

    dispose();
  });

  it("桌面动作会先通过 Host 校验再调用桌面桥", async () => {
    const iframeWindow = createIframeWindowStub();
    const iframe = {
      contentWindow: iframeWindow
    } as HTMLIFrameElement;

    vi.spyOn(pluginsApi, "openPluginFile").mockResolvedValue({
      workspaceId: "workspace-1",
      relativePath: "report.txt",
      absolutePath: "/tmp/workspace-1/report.txt"
    });
    vi.spyOn(desktopBridge, "getCodingNSDesktopBridge").mockReturnValue({
      runtime: {
        isAvailable: () => true,
        getPlatformInfo: async () => ({ ok: true, value: { platform: "macos", isDesktop: true, fileManager: "finder" } })
      },
      fs: {
        openFile: async () => ({ ok: true, value: undefined }),
        revealInFileManager: async () => ({ ok: true, value: undefined }),
        pickDirectory: async () => ({ ok: true, value: null })
      }
    });

    const dispose = attachPluginBridge({
      iframe,
      pluginId: "demo.plugin",
      hostOrigin: "http://127.0.0.1:3002",
      context: {
        pluginId: "demo.plugin",
        workspaceId: "workspace-1",
        runtimeSessionId: "runtime-session-1",
        pluginName: "演示插件",
        pluginVersion: "1.0.0",
        frontendEntryUrl: "/preview/plugins/demo.plugin/frontend/index.html",
        hostOrigin: "http://127.0.0.1:3002"
      }
    });

    window.dispatchEvent(new MessageEvent("message", {
      origin: "http://127.0.0.1:3002",
      source: iframeWindow,
      data: {
        type: "codingns-plugin:ready"
      }
    }));

    window.dispatchEvent(new MessageEvent("message", {
      origin: "http://127.0.0.1:3002",
      source: iframeWindow,
      data: {
        type: "codingns-plugin:request",
        requestId: "req-2",
        action: "openFile",
        payload: {
          path: "report.txt"
        }
      }
    }));

    await Promise.resolve();
    await Promise.resolve();

    expect(pluginsApi.openPluginFile).toHaveBeenCalledWith("demo.plugin", "runtime-session-1", "report.txt");
    dispose();
  });

  it("文件桥会转发 readFile/writeFile/listDir，并保留统一错误结构", async () => {
    const iframeWindow = createIframeWindowStub();
    const iframe = {
      contentWindow: iframeWindow
    } as HTMLIFrameElement;

    vi.spyOn(pluginsApi, "readPluginFile").mockResolvedValue({
      workspaceId: "workspace-1",
      path: "reports/today.txt",
      content: "hello",
      encoding: "utf-8",
      version: "v1",
      size: 5,
      updatedAt: "2026-05-21T00:00:00.000Z"
    });
    vi.spyOn(pluginsApi, "createPluginPermissionGrant").mockResolvedValue({
      id: "grant-1",
      pluginId: "demo.plugin",
      workspaceId: "workspace-1",
      permissionKey: "workspace.write_file",
      scopeType: "file",
      scopePath: "reports/output.txt",
      grantMode: "session",
      grantedByUserId: "user-1",
      runtimeSessionId: "runtime-session-1",
      createdAt: "2026-05-21T00:00:00.000Z",
      expiresAt: null,
      revokedAt: null
    });
    vi.spyOn(pluginsApi, "writePluginFile")
      .mockRejectedValueOnce(new ApiError(403, {
        error_code: "PLUGIN_PERMISSION_GRANT_REQUIRED",
        detail: "插件权限尚未授权：workspace.write_file",
        data: {
          permissionKey: "workspace.write_file",
          scopeType: "file",
          scopePath: "reports/output.txt",
          grantOptions: ["once", "session", "persistent"]
        }
      }))
      .mockResolvedValue({
        path: "reports/output.txt",
        size: 9,
        updatedAt: "2026-05-21T00:00:01.000Z"
      });
    vi.spyOn(pluginsApi, "listPluginDirectory").mockResolvedValue({
      items: [
        {
          path: "reports/today.txt",
          name: "today.txt",
          kind: "file",
          size: 5,
          updatedAt: "2026-05-21T00:00:00.000Z"
        }
      ]
    });
    setPluginPermissionPromptHandlerForTesting(async (request) => {
      await pluginsApi.createPluginPermissionGrant(request.pluginId, {
        runtimeSessionId: request.runtimeSessionId,
        permissionKey: request.permissionKey,
        scopeType: "file",
        scopePath: request.scopePath,
        grantMode: "session"
      });
      return true;
    });

    const dispose = attachPluginBridge({
      iframe,
      pluginId: "demo.plugin",
      hostOrigin: "http://127.0.0.1:3002",
      context: {
        pluginId: "demo.plugin",
        workspaceId: "workspace-1",
        runtimeSessionId: "runtime-session-1",
        pluginName: "演示插件",
        pluginVersion: "1.0.0",
        frontendEntryUrl: "/preview/plugins/demo.plugin/frontend/index.html",
        hostOrigin: "http://127.0.0.1:3002"
      }
    });

    window.dispatchEvent(new MessageEvent("message", {
      origin: "http://127.0.0.1:3002",
      source: iframeWindow,
      data: {
        type: "codingns-plugin:request",
        requestId: "req-read",
        action: "readFile",
        payload: {
          path: "reports/today.txt"
        }
      }
    }));

    await Promise.resolve();
    await Promise.resolve();

    expect(pluginsApi.readPluginFile).toHaveBeenCalledWith("demo.plugin", "runtime-session-1", "reports/today.txt");
    window.dispatchEvent(new MessageEvent("message", {
      origin: "http://127.0.0.1:3002",
      source: iframeWindow,
      data: {
        type: "codingns-plugin:request",
        requestId: "req-write",
        action: "writeFile",
        payload: {
          path: "reports/output.txt",
          content: "generated"
        }
      }
    }));

    await Promise.resolve();
    await Promise.resolve();

    await flushBridgeTasks();

    expect(pluginsApi.writePluginFile).toHaveBeenCalledWith("demo.plugin", "runtime-session-1", "reports/output.txt", "generated");
    expect(pluginsApi.createPluginPermissionGrant).toHaveBeenCalled();
    expect((iframeWindow.postMessage as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      type: "codingns-plugin:response",
      requestId: "req-write",
      ok: true,
      result: {
        path: "reports/output.txt",
        size: 9,
        updatedAt: "2026-05-21T00:00:01.000Z"
      }
    }, "http://127.0.0.1:3002");

    window.dispatchEvent(new MessageEvent("message", {
      origin: "http://127.0.0.1:3002",
      source: iframeWindow,
      data: {
        type: "codingns-plugin:request",
        requestId: "req-list",
        action: "listDir",
        payload: {
          path: "reports"
        }
      }
    }));

    await Promise.resolve();
    await Promise.resolve();

    await flushBridgeTasks();

    expect(pluginsApi.listPluginDirectory).toHaveBeenCalledWith("demo.plugin", "runtime-session-1", "reports");
    expect((iframeWindow.postMessage as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      type: "codingns-plugin:response",
      requestId: "req-list",
      ok: true,
      result: {
        items: [
          expect.objectContaining({
            path: "reports/today.txt"
          })
        ]
      }
    }, "http://127.0.0.1:3002");

    dispose();
  });
});

async function flushBridgeTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}
