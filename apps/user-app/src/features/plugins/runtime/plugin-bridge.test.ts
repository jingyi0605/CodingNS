import { afterEach, describe, expect, it, vi } from "vitest";

import { attachPluginBridge } from "./plugin-bridge";
import * as pluginsApi from "../api/plugins-api";
import * as desktopBridge from "../../../platform/desktop/codingns-desktop-bridge";

function createIframeWindowStub() {
  return {
    postMessage: vi.fn()
  } as unknown as Window;
}

describe("plugin bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
      workspaceId: "workspace-1",
      hostOrigin: "http://127.0.0.1:3002",
      context: {
        pluginId: "demo.plugin",
        workspaceId: "workspace-1",
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
        workspaceId: "workspace-1"
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

    await Promise.resolve();
    await Promise.resolve();

    expect(pluginsApi.callPluginAction).toHaveBeenCalledWith("demo.plugin", "run-report", "workspace-1", {
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
      workspaceId: "workspace-1",
      hostOrigin: "http://127.0.0.1:3002",
      context: {
        pluginId: "demo.plugin",
        workspaceId: "workspace-1",
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
        requestId: "req-2",
        action: "openFile",
        payload: {
          path: "report.txt"
        }
      }
    }));

    await Promise.resolve();
    await Promise.resolve();

    expect(pluginsApi.openPluginFile).toHaveBeenCalledWith("demo.plugin", "workspace-1", "report.txt");
    dispose();
  });
});
