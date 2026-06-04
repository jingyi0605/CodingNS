import { describe, expect, it, vi } from "vitest";

import { createWindowRegistryStore } from "./window-registry";
import {
  buildExternalWorkspaceWindowId,
  buildFilePreviewExternalWindowId,
  openAffairsExternalWindow,
  openFilePreviewExternalWindow,
  openFilesExternalWindow,
  openGitExternalWindow,
  openProcessesExternalWindow,
  openTerminalsExternalWindow
} from "./window-openers";

describe("window-openers", () => {
  it("会按窗口类型生成稳定 windowId", () => {
    expect(buildExternalWorkspaceWindowId("files", "workspace-1")).toBe("files-workspace-1");
    expect(buildExternalWorkspaceWindowId("git", "workspace-1")).toBe("git-workspace-1");
    expect(buildExternalWorkspaceWindowId("processes", "workspace-1")).toBe("processes-workspace-1");
    expect(buildExternalWorkspaceWindowId("terminals", "workspace-1")).toBe("terminals-workspace-1");
    expect(buildExternalWorkspaceWindowId("affairs", "workspace-1")).toBe("affairs-workspace-1");
    expect(buildFilePreviewExternalWindowId("workspace-1", "docs/read me.md")).toBe(
      "file-preview-workspace-1-docs_2Fread_20me_md"
    );
  });

  it("openFilesExternalWindow 会注册 descriptor 并调用桌面开窗命令", async () => {
    const windows = createWindowRegistryStore();
    const createWindow = vi.fn().mockResolvedValue({ ok: true });

    const result = await openFilesExternalWindow(
      {
        isDesktop: true,
        bridge: {
          supported: true,
          createWindow
        },
        windows
      } as never,
      {
        workspaceId: "workspace-1",
        workspaceName: "项目一",
        sessionId: "session-1"
      }
    );

    expect(result.ok).toBe(true);
    expect(createWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "files-workspace-1",
        kind: "files",
        workspaceId: "workspace-1",
        workspaceName: "项目一",
        sessionId: "session-1",
        focusOwner: "file-context-panel"
      })
    );
    expect(windows.getDescriptor("files-workspace-1")).toMatchObject({
      kind: "files",
      mode: "external"
    });
    expect(windows.isWindowOpen("files-workspace-1")).toBe(true);
  });

  it("openFilePreviewExternalWindow 会把文件路径和弹窗尺寸放进 descriptor", async () => {
    const windows = createWindowRegistryStore();
    const createWindow = vi.fn().mockResolvedValue({ ok: true });

    const result = await openFilePreviewExternalWindow(
      {
        isDesktop: true,
        bridge: {
          supported: true,
          createWindow
        },
        windows
      } as never,
      {
        workspaceId: "workspace-1",
        workspaceName: "项目一",
        sessionId: "session-1",
        filePath: "docs/readme.md",
        bounds: {
          width: 980,
          height: 640,
          minWidth: 720,
          minHeight: 480
        }
      }
    );

    expect(result.ok).toBe(true);
    expect(createWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "file-preview-workspace-1-docs_2Freadme_md",
        kind: "file-preview",
        workspaceId: "workspace-1",
        workspaceName: "项目一",
        sessionId: "session-1",
        focusOwner: "file-preview-window",
        bounds: expect.objectContaining({
          width: 980,
          height: 640
        }),
        payload: {
          filePath: "docs/readme.md"
        }
      })
    );
    expect(windows.getDescriptor("file-preview-workspace-1-docs_2Freadme_md")).toMatchObject({
      kind: "file-preview",
      mode: "external",
      bounds: {
        x: null,
        y: null,
        width: 980,
        height: 640,
        minWidth: 720,
        minHeight: 480
      },
      payload: {
        filePath: "docs/readme.md"
      }
    });
  });

  it("openGitExternalWindow 会复用已登记窗口的 bounds", async () => {
    const windows = createWindowRegistryStore();
    const createWindow = vi.fn().mockResolvedValue({ ok: true });

    windows.registerDescriptor({
      windowId: "git-workspace-1",
      kind: "git",
      workspaceId: "workspace-1",
      sessionId: null,
      mode: "external",
      bounds: {
        x: 64,
        y: 96,
        width: 1400,
        height: 900,
        minWidth: 720,
        minHeight: 540
      },
      focusOwner: "previous"
    });

    const result = await openGitExternalWindow(
      {
        isDesktop: true,
        bridge: {
          supported: true,
          createWindow
        },
        windows
      } as never,
      {
        workspaceId: "workspace-1",
        workspaceName: "项目一"
      }
    );

    expect(result.ok).toBe(true);
    expect(createWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "git-workspace-1",
        kind: "git",
        bounds: expect.objectContaining({
          x: 64,
          y: 96,
          width: 1400,
          height: 900
        }),
        focusOwner: "git-sidebar"
      })
    );
  });

  it("openProcessesExternalWindow 失败时不会留下脏 descriptor", async () => {
    const windows = createWindowRegistryStore();
    const createWindow = vi.fn().mockResolvedValue({
      ok: false,
      errorCode: "WINDOW_CREATE_FAILED",
      detail: "创建失败"
    });

    const result = await openProcessesExternalWindow(
      {
        isDesktop: true,
        bridge: {
          supported: true,
          createWindow
        },
        windows
      } as never,
      {
        workspaceId: "workspace-1",
        workspaceName: "项目一"
      }
    );

    expect(result).toEqual({
      ok: false,
      errorCode: "WINDOW_CREATE_FAILED",
      detail: "创建失败"
    });
    expect(windows.getDescriptor("processes-workspace-1")).toBeNull();
    expect(windows.isWindowOpen("processes-workspace-1")).toBe(false);
  });

  it("openAffairsExternalWindow 会注册事务外部窗口 descriptor", async () => {
    const windows = createWindowRegistryStore();
    const createWindow = vi.fn().mockResolvedValue({ ok: true });

    const result = await openAffairsExternalWindow(
      {
        isDesktop: true,
        bridge: {
          supported: true,
          createWindow
        },
        windows
      } as never,
      {
        workspaceId: "workspace-1",
        workspaceName: "项目一"
      }
    );

    expect(result.ok).toBe(true);
    expect(createWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "affairs-workspace-1",
        kind: "affairs",
        workspaceId: "workspace-1",
        workspaceName: "项目一",
        focusOwner: "affairs-workbench"
      })
    );
    expect(windows.getDescriptor("affairs-workspace-1")).toMatchObject({
      kind: "affairs",
      mode: "external"
    });
  });

  it("openTerminalsExternalWindow 会注册终端页外部窗口 descriptor", async () => {
    const windows = createWindowRegistryStore();
    const createWindow = vi.fn().mockResolvedValue({ ok: true });

    const result = await openTerminalsExternalWindow(
      {
        isDesktop: true,
        bridge: {
          supported: true,
          createWindow
        },
        windows
      } as never,
      {
        workspaceId: "workspace-1",
        workspaceName: "项目一"
      }
    );

    expect(result.ok).toBe(true);
    expect(createWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "terminals-workspace-1",
        kind: "terminals",
        workspaceId: "workspace-1",
        workspaceName: "项目一",
        focusOwner: "terminal-page"
      })
    );
    expect(windows.getDescriptor("terminals-workspace-1")).toMatchObject({
      kind: "terminals",
      mode: "external"
    });
  });

  it("开窗失败时会恢复已有 descriptor 和打开状态", async () => {
    const windows = createWindowRegistryStore();
    const createWindow = vi.fn().mockResolvedValue({
      ok: false,
      errorCode: "WINDOW_CREATE_FAILED",
      detail: "创建失败"
    });

    windows.registerDescriptor({
      windowId: "git-workspace-1",
      kind: "git",
      workspaceId: "workspace-1",
      sessionId: "session-old",
      mode: "external",
      bounds: {
        x: 12,
        y: 24,
        width: 1280,
        height: 840,
        minWidth: 720,
        minHeight: 480
      },
      focusOwner: "previous-owner"
    });
    windows.markWindowOpen("git-workspace-1");

    const result = await openGitExternalWindow(
      {
        isDesktop: true,
        bridge: {
          supported: true,
          createWindow
        },
        windows
      } as never,
      {
        workspaceId: "workspace-1",
        workspaceName: "项目一",
        sessionId: "session-new"
      }
    );

    expect(result.ok).toBe(false);
    expect(windows.getDescriptor("git-workspace-1")).toMatchObject({
      sessionId: "session-old",
      focusOwner: "previous-owner"
    });
    expect(windows.isWindowOpen("git-workspace-1")).toBe(true);
  });
});
