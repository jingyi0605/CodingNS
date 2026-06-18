// 多窗口类型在这里统一收口，后续新增类型只改这里即可。
export const WINDOW_KINDS = ["chat", "files", "file-preview", "git", "processes", "terminals", "affairs", "code"] as const;
export const WINDOW_MODES = ["docked", "floating", "external"] as const;

export type WindowKind = (typeof WINDOW_KINDS)[number];
export type WindowMode = (typeof WINDOW_MODES)[number];

export interface WindowBounds {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface WindowDescriptorPayload {
  // 单文件预览窗口使用 workspace 相对路径。后续新增窗口上下文字段也统一放这里。
  filePath?: string | null;
  targetHostId?: string | null;
  routePath?: string | null;
}

export interface WindowDescriptor {
  // 作为前端窗口主键，同时预留给桌面壳作为窗口 label 使用。
  windowId: string;
  kind: WindowKind;
  workspaceId: string | null;
  workspaceName?: string | null;
  sessionId: string | null;
  mode: WindowMode;
  bounds: WindowBounds;
  focusOwner: string | null;
  payload: WindowDescriptorPayload;
}

export interface CreateWindowDescriptorInput {
  windowId: string;
  kind: WindowKind;
  workspaceId?: string | null;
  workspaceName?: string | null;
  sessionId?: string | null;
  mode?: WindowMode;
  bounds?: Partial<WindowBounds>;
  focusOwner?: string | null;
  payload?: WindowDescriptorPayload | null;
}

function normalizeWindowDescriptorPayload(
  payload: WindowDescriptorPayload | null | undefined
): WindowDescriptorPayload {
  return {
    filePath: payload?.filePath ?? null,
    targetHostId: payload?.targetHostId ?? null,
    routePath: payload?.routePath ?? null
  };
}

export function createWindowBounds(bounds: Partial<WindowBounds> = {}): WindowBounds {
  // 先给出稳定默认值，避免业务层到处判断 undefined/null。
  return {
    x: bounds.x ?? null,
    y: bounds.y ?? null,
    width: bounds.width ?? 1200,
    height: bounds.height ?? 780,
    minWidth: bounds.minWidth ?? 720,
    minHeight: bounds.minHeight ?? 480
  };
}

export function createWindowDescriptor(input: CreateWindowDescriptorInput): WindowDescriptor {
  // 这里统一做字段归一化，避免 descriptor 在业务组件里被“半初始化”。
  return {
    windowId: input.windowId,
    kind: input.kind,
    workspaceId: input.workspaceId ?? null,
    workspaceName: input.workspaceName ?? null,
    sessionId: input.sessionId ?? null,
    mode: input.mode ?? "docked",
    bounds: createWindowBounds(input.bounds),
    focusOwner: input.focusOwner ?? null,
    payload: normalizeWindowDescriptorPayload(input.payload)
  };
}
