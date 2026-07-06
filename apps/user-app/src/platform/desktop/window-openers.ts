import type { DesktopBridgeResult } from "../../config/client-config-types";
import type { PlatformAdapter } from "../platform-adapter";
import {
  createWindowDescriptor,
  type WindowBounds,
  type WindowDescriptor,
  type WindowKind
} from "./window-descriptor";

type ExternalWindowKind = Extract<WindowKind, "files" | "git" | "processes" | "terminals" | "code">;
type FilePreviewWindowKind = Extract<WindowKind, "file-preview">;

export interface OpenExternalWorkspaceWindowInput {
  workspaceId: string;
  requestWorkspaceId?: string | null;
  workspaceName?: string | null;
  sessionId?: string | null;
  focusOwner?: string | null;
  routePath?: string | null;
  targetHostId?: string | null;
}

export interface OpenFilePreviewExternalWindowInput extends OpenExternalWorkspaceWindowInput {
  filePath: string;
  bounds?: Partial<WindowBounds>;
}

interface WindowKindConfig {
  kind: ExternalWindowKind;
  label: string;
  defaultFocusOwner: string;
}

const EXTERNAL_WINDOW_KIND_CONFIG: Record<ExternalWindowKind, WindowKindConfig> = {
  files: {
    kind: "files",
    label: "文件",
    defaultFocusOwner: "file-context-panel"
  },
  git: {
    kind: "git",
    label: "Git",
    defaultFocusOwner: "git-sidebar"
  },
  processes: {
    kind: "processes",
    label: "调试",
    defaultFocusOwner: "terminal-manager-panel"
  },
  terminals: {
    kind: "terminals",
    label: "终端",
    defaultFocusOwner: "terminal-page"
  },
  code: {
    kind: "code",
    label: "代码",
    defaultFocusOwner: "code-workbench"
  }
};

function cloneDescriptor(descriptor: WindowDescriptor): WindowDescriptor {
  return {
    ...descriptor,
    bounds: {
      ...descriptor.bounds
    },
    payload: {
      ...descriptor.payload
    }
  };
}

function restorePreviousDescriptorState(
  platform: Pick<PlatformAdapter, "windows">,
  previousDescriptor: WindowDescriptor | null,
  wasOpen: boolean
) {
  if (!previousDescriptor) {
    return;
  }

  platform.windows.registerDescriptor(previousDescriptor);

  if (wasOpen) {
    platform.windows.markWindowOpen(previousDescriptor.windowId);
  } else {
    platform.windows.markWindowClosed(previousDescriptor.windowId);
  }
}

function getExternalWindowKindConfig(kind: ExternalWindowKind): WindowKindConfig {
  return EXTERNAL_WINDOW_KIND_CONFIG[kind];
}

export function buildExternalWorkspaceWindowId(
  kind: ExternalWindowKind,
  workspaceId: string
): string {
  return `${kind}-${workspaceId}`;
}

function normalizeFilePreviewWindowPath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/");
}

function encodeFilePreviewWindowSegment(value: string): string {
  return encodeURIComponent(value).replace(/%/g, "_").replace(/\./g, "_");
}

export function buildFilePreviewExternalWindowId(workspaceId: string, filePath: string): string {
  const normalizedWorkspaceId = workspaceId.trim();
  const normalizedPath = normalizeFilePreviewWindowPath(filePath);
  return `file-preview-${encodeFilePreviewWindowSegment(normalizedWorkspaceId)}-${encodeFilePreviewWindowSegment(normalizedPath)}`;
}

function buildScopedFilePreviewExternalWindowId(
  workspaceId: string,
  filePath: string,
  targetHostId?: string | null
): string {
  const baseWindowId = buildFilePreviewExternalWindowId(workspaceId, filePath);
  const normalizedTargetHostId = targetHostId?.trim() ?? "";

  if (!normalizedTargetHostId) {
    return baseWindowId;
  }

  return `${baseWindowId}-${encodeFilePreviewWindowSegment(normalizedTargetHostId)}`;
}

async function openExternalWorkspaceWindow(
  platform: Pick<PlatformAdapter, "isDesktop" | "bridge" | "windows">,
  kind: ExternalWindowKind,
  input: OpenExternalWorkspaceWindowInput
): Promise<DesktopBridgeResult<WindowDescriptor>> {
  const workspaceId = input.workspaceId.trim();
  const kindConfig = getExternalWindowKindConfig(kind);

  if (!platform.isDesktop || !platform.bridge.supported) {
    return {
      ok: false,
      errorCode: "PLATFORM_NOT_SUPPORTED",
      detail: "当前运行环境不支持桌面外部窗口。"
    };
  }

  if (!workspaceId) {
    return {
      ok: false,
      errorCode: "WINDOW_WORKSPACE_REQUIRED",
      detail: `${kindConfig.label}外部窗口必须绑定工作区。`
    };
  }

  const windowId = buildExternalWorkspaceWindowId(kind, workspaceId);
  const previousDescriptor = platform.windows.getDescriptor(windowId);
  const previousDescriptorSnapshot = previousDescriptor ? cloneDescriptor(previousDescriptor) : null;
  const wasOpen = platform.windows.isWindowOpen(windowId);
  const descriptor = createWindowDescriptor({
    windowId,
    kind,
    workspaceId,
    workspaceName: input.workspaceName ?? previousDescriptorSnapshot?.workspaceName ?? null,
    sessionId: input.sessionId ?? previousDescriptorSnapshot?.sessionId ?? null,
    mode: "external",
    bounds: previousDescriptorSnapshot?.bounds,
    focusOwner: input.focusOwner ?? kindConfig.defaultFocusOwner,
    payload: {
      targetHostId: input.targetHostId ?? previousDescriptorSnapshot?.payload.targetHostId ?? null,
      requestWorkspaceId:
        input.requestWorkspaceId ?? previousDescriptorSnapshot?.payload.requestWorkspaceId ?? input.workspaceId,
      routePath: input.routePath ?? previousDescriptorSnapshot?.payload.routePath ?? null
    }
  });

  platform.windows.registerDescriptor(descriptor);

  const result = await platform.bridge.createWindow(descriptor);

  if (!result.ok) {
    if (previousDescriptorSnapshot) {
      restorePreviousDescriptorState(platform, previousDescriptorSnapshot, wasOpen);
    } else {
      platform.windows.removeWindow(windowId);
    }

    return {
      ok: false,
      errorCode: result.errorCode,
      detail: result.detail
    };
  }

  platform.windows.markWindowOpen(windowId);
  return {
    ok: true,
    value: descriptor
  };
}

async function openFilePreviewWorkspaceWindow(
  platform: Pick<PlatformAdapter, "isDesktop" | "bridge" | "windows">,
  kind: FilePreviewWindowKind,
  input: OpenFilePreviewExternalWindowInput
): Promise<DesktopBridgeResult<WindowDescriptor>> {
  const workspaceId = input.workspaceId.trim();
  const filePath = normalizeFilePreviewWindowPath(input.filePath);
  const targetHostId = input.targetHostId?.trim() || null;

  if (!platform.isDesktop || !platform.bridge.supported) {
    return {
      ok: false,
      errorCode: "PLATFORM_NOT_SUPPORTED",
      detail: "当前运行环境不支持桌面外部窗口。"
    };
  }

  if (!workspaceId) {
    return {
      ok: false,
      errorCode: "WINDOW_WORKSPACE_REQUIRED",
      detail: "文件预览外部窗口必须绑定工作区。"
    };
  }

  if (!filePath) {
    return {
      ok: false,
      errorCode: "WINDOW_FILE_REQUIRED",
      detail: "文件预览外部窗口必须指定文件。"
    };
  }

  const windowId = buildScopedFilePreviewExternalWindowId(workspaceId, filePath, targetHostId);
  const previousDescriptor = platform.windows.getDescriptor(windowId);
  const previousDescriptorSnapshot = previousDescriptor ? cloneDescriptor(previousDescriptor) : null;
  const wasOpen = platform.windows.isWindowOpen(windowId);
  const descriptor = createWindowDescriptor({
    windowId,
    kind,
    workspaceId,
    workspaceName: input.workspaceName ?? previousDescriptorSnapshot?.workspaceName ?? null,
    sessionId: input.sessionId ?? previousDescriptorSnapshot?.sessionId ?? null,
    mode: "external",
    bounds: input.bounds ?? previousDescriptorSnapshot?.bounds ?? {
      width: 1120,
      height: 760,
      minWidth: 720,
      minHeight: 480
    },
    focusOwner: input.focusOwner ?? "file-preview-window",
    payload: {
      filePath,
      targetHostId
    }
  });

  platform.windows.registerDescriptor(descriptor);

  const result = await platform.bridge.createWindow(descriptor);

  if (!result.ok) {
    if (previousDescriptorSnapshot) {
      restorePreviousDescriptorState(platform, previousDescriptorSnapshot, wasOpen);
    } else {
      platform.windows.removeWindow(windowId);
    }

    return {
      ok: false,
      errorCode: result.errorCode,
      detail: result.detail
    };
  }

  platform.windows.markWindowOpen(windowId);
  return {
    ok: true,
    value: descriptor
  };
}

export function buildFilesExternalWindowId(workspaceId: string): string {
  return buildExternalWorkspaceWindowId("files", workspaceId);
}

export function buildGitExternalWindowId(workspaceId: string): string {
  return buildExternalWorkspaceWindowId("git", workspaceId);
}

export function buildProcessesExternalWindowId(workspaceId: string): string {
  return buildExternalWorkspaceWindowId("processes", workspaceId);
}

export function buildCodeExternalWindowId(workspaceId: string): string {
  return buildExternalWorkspaceWindowId("code", workspaceId);
}

export function buildTerminalsExternalWindowId(workspaceId: string): string {
  return buildExternalWorkspaceWindowId("terminals", workspaceId);
}

export function openFilesExternalWindow(
  platform: Pick<PlatformAdapter, "isDesktop" | "bridge" | "windows">,
  input: OpenExternalWorkspaceWindowInput
): Promise<DesktopBridgeResult<WindowDescriptor>> {
  return openExternalWorkspaceWindow(platform, "files", input);
}

export function openGitExternalWindow(
  platform: Pick<PlatformAdapter, "isDesktop" | "bridge" | "windows">,
  input: OpenExternalWorkspaceWindowInput
): Promise<DesktopBridgeResult<WindowDescriptor>> {
  return openExternalWorkspaceWindow(platform, "git", input);
}

export function openProcessesExternalWindow(
  platform: Pick<PlatformAdapter, "isDesktop" | "bridge" | "windows">,
  input: OpenExternalWorkspaceWindowInput
): Promise<DesktopBridgeResult<WindowDescriptor>> {
  return openExternalWorkspaceWindow(platform, "processes", input);
}

export function openTerminalsExternalWindow(
  platform: Pick<PlatformAdapter, "isDesktop" | "bridge" | "windows">,
  input: OpenExternalWorkspaceWindowInput
): Promise<DesktopBridgeResult<WindowDescriptor>> {
  return openExternalWorkspaceWindow(platform, "terminals", input);
}

export function openCodeExternalWindow(
  platform: Pick<PlatformAdapter, "isDesktop" | "bridge" | "windows">,
  input: OpenExternalWorkspaceWindowInput
): Promise<DesktopBridgeResult<WindowDescriptor>> {
  return openExternalWorkspaceWindow(platform, "code", input);
}

export function openFilePreviewExternalWindow(
  platform: Pick<PlatformAdapter, "isDesktop" | "bridge" | "windows">,
  input: OpenFilePreviewExternalWindowInput
): Promise<DesktopBridgeResult<WindowDescriptor>> {
  return openFilePreviewWorkspaceWindow(platform, "file-preview", input);
}
