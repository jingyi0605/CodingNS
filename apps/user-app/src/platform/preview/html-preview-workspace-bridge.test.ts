import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHtmlPreviewWorkspaceBridge } from "./html-preview-workspace-bridge";

const bridgeApiMock = vi.hoisted(() => ({
  getWorkspaceBridgeCapabilities: vi.fn(),
  listWorkspaceBridgeDir: vi.fn(),
  readWorkspaceBridgeText: vi.fn(),
  readWorkspaceBridgeTexts: vi.fn(),
  writeWorkspaceBridgeText: vi.fn(),
  deleteWorkspaceBridgeFile: vi.fn(),
  statWorkspaceBridgePath: vi.fn(),
  existsWorkspaceBridgePath: vi.fn(),
  prepareWorkspaceBridgeOpenFile: vi.fn(),
  prepareWorkspaceBridgeRevealFile: vi.fn(),
  watchWorkspaceBridgeDir: vi.fn(),
  unwatchWorkspaceBridgeDir: vi.fn(),
  pollWorkspaceBridgeWatchEvents: vi.fn()
}));

const desktopBridgeMock = vi.hoisted(() => ({
  openFile: vi.fn(),
  revealInFileManager: vi.fn()
}));

vi.mock("./codingns-workspace-bridge", () => bridgeApiMock);
vi.mock("../desktop/codingns-desktop-bridge", () => ({
  getCodingNSDesktopBridge: () => ({
    fs: desktopBridgeMock
  })
}));

describe("createHtmlPreviewWorkspaceBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("只接受当前 iframe 发来的请求，并通过父页鉴权上下文代理 readText", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const iframeWindow = iframe.contentWindow as Window;
    const postMessage = vi.spyOn(iframeWindow, "postMessage").mockImplementation(() => undefined);

    bridgeApiMock.readWorkspaceBridgeText.mockResolvedValue({
      path: "重要信息/会员信息/91飞机场.md",
      content: "# 会员",
      mtime: 1,
      size: 4
    });

    const bridge = createHtmlPreviewWorkspaceBridge({
      iframe,
      workspaceId: "workspace-1"
    });

    await bridge.onMessage({
      source: iframeWindow,
      origin: "http://localhost:3000",
      data: {
        type: "codingns.workspace.request",
        id: "req-1",
        action: "readText",
        payload: {
          path: "重要信息/会员信息/91飞机场.md"
        }
      }
    } as MessageEvent);

    expect(bridgeApiMock.readWorkspaceBridgeText).toHaveBeenCalledWith(
      "workspace-1",
      "重要信息/会员信息/91飞机场.md"
    );
    expect(bridge.debug.lastEventMatchedSource).toBe(true);
    expect(bridge.debug.lastHandledRequestId).toBe("req-1");
    expect(bridge.debug.lastResponseId).toBe("req-1");
    postMessage.mockRestore();
    iframe.remove();
  });

  it("来源不能 postMessage 时会忽略请求并保留诊断状态", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const foreignSource = {};

    const bridge = createHtmlPreviewWorkspaceBridge({
      iframe,
      workspaceId: "workspace-1"
    });

    await bridge.onMessage({
      source: foreignSource,
      origin: "http://localhost:3000",
      data: {
        type: "codingns.workspace.request",
        id: "req-mismatch",
        action: "readText",
        payload: {
          path: "重要信息/会员信息/91飞机场.md"
        }
      }
    } as MessageEvent);

    expect(bridgeApiMock.readWorkspaceBridgeText).not.toHaveBeenCalled();
    expect(bridge.debug.lastEventRequestId).toBe("req-mismatch");
    expect(bridge.debug.lastEventMatchedSource).toBe(false);
    expect(bridge.debug.currentIframeWindowMatches).toBe(false);

    iframe.remove();
  });

  it("来源可 postMessage 但不等于当前 iframe.contentWindow 时仍会处理请求", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const foreignWindow = {
      postMessage: vi.fn()
    };

    bridgeApiMock.readWorkspaceBridgeText.mockResolvedValue({
      path: "重要信息/会员信息/91飞机场.md",
      content: "# 会员",
      mtime: 1,
      size: 4
    });

    const bridge = createHtmlPreviewWorkspaceBridge({
      iframe,
      workspaceId: "workspace-1"
    });

    await bridge.onMessage({
      source: foreignWindow,
      origin: "http://localhost:3000",
      data: {
        type: "codingns.workspace.request",
        id: "req-foreign-window",
        action: "readText",
        payload: {
          path: "重要信息/会员信息/91飞机场.md"
        }
      }
    } as unknown as MessageEvent);

    expect(bridgeApiMock.readWorkspaceBridgeText).toHaveBeenCalledWith(
      "workspace-1",
      "重要信息/会员信息/91飞机场.md"
    );
    expect(bridge.debug.lastEventMatchedSource).toBe(false);
    expect(bridge.debug.lastHandledRequestId).toBe("req-foreign-window");
    expect(bridge.debug.lastResponseId).toBe("req-foreign-window");
    expect(foreignWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "req-foreign-window",
        ok: true,
        type: "codingns.workspace.response"
      }),
      "http://localhost:3000"
    );

    iframe.remove();
  });
});
