import type { DesktopBridgeResult } from "../../config/client-config-types";
import type { PlatformAdapter } from "../platform-adapter";
import {
  createWindowDescriptor,
  type WindowDescriptor,
  type WindowKind
} from "./window-descriptor";

type ExternalWindowKind = Extract<WindowKind, "files" | "git" | "processes" | "terminals">;

export interface OpenExternalWorkspaceWindowInput {
  workspaceId: string;
  sessionId?: string | null;
  focusOwner?: string | null;
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
  }
};

function cloneDescriptor(descriptor: WindowDescriptor): WindowDescriptor {
  return {
    ...descriptor,
    bounds: {
      ...descriptor.bounds
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
    sessionId: input.sessionId ?? previousDescriptorSnapshot?.sessionId ?? null,
    mode: "external",
    bounds: previousDescriptorSnapshot?.bounds,
    focusOwner: input.focusOwner ?? kindConfig.defaultFocusOwner
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
