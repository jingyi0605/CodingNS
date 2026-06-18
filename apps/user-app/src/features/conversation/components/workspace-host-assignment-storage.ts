export const WORKSPACE_HOST_ASSIGNMENT_KEY = "workbench.workspace.host.assignment.v1";
export const WORKSPACE_HOST_ASSIGNMENT_CHANGED_EVENT = "codingns:workspace-host-assignment-changed";

export interface WorkspaceHostAssignment {
  selectedHostId: string;
  remoteWorkspaceId: string | null;
  remoteWorkspacePath: string | null;
  remoteWorkspaceName: string | null;
}

export function buildWorkspaceHostAssignmentKey(workspaceId: string, workspacePath?: string | null): string {
  const pathPart = workspacePath?.trim() || "unknown";
  return `${workspaceId}::${pathPart}`;
}

export function normalizeWorkspaceHostAssignment(value: unknown): WorkspaceHostAssignment | null {
  if (typeof value === "string" && value.trim()) {
    return {
      selectedHostId: value.trim(),
      remoteWorkspaceId: null,
      remoteWorkspacePath: null,
      remoteWorkspaceName: null
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Partial<Record<keyof WorkspaceHostAssignment, unknown>>;
  const selectedHostId = typeof raw.selectedHostId === "string" ? raw.selectedHostId.trim() : "";

  if (!selectedHostId) {
    return null;
  }

  return {
    selectedHostId,
    remoteWorkspaceId: typeof raw.remoteWorkspaceId === "string" && raw.remoteWorkspaceId.trim()
      ? raw.remoteWorkspaceId.trim()
      : null,
    remoteWorkspacePath: typeof raw.remoteWorkspacePath === "string" && raw.remoteWorkspacePath.trim()
      ? raw.remoteWorkspacePath.trim()
      : null,
    remoteWorkspaceName: typeof raw.remoteWorkspaceName === "string" && raw.remoteWorkspaceName.trim()
      ? raw.remoteWorkspaceName.trim()
      : null
  };
}

export function readWorkspaceHostAssignments(): Record<string, WorkspaceHostAssignment> {
  const raw = readStoredString(WORKSPACE_HOST_ASSIGNMENT_KEY);

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, WorkspaceHostAssignment> = {};

    for (const [key, value] of Object.entries(parsed)) {
      const assignment = normalizeWorkspaceHostAssignment(value);
      if (typeof key === "string" && key.trim() && assignment) {
        result[key] = assignment;
      }
    }

    return result;
  } catch {
    return {};
  }
}

export function writeWorkspaceHostAssignments(assignments: Record<string, WorkspaceHostAssignment>): void {
  writeWorkspaceHostAssignmentsInternal(assignments, true);
}

export function writeWorkspaceHostAssignmentsSilently(assignments: Record<string, WorkspaceHostAssignment>): void {
  writeWorkspaceHostAssignmentsInternal(assignments, false);
}

function writeWorkspaceHostAssignmentsInternal(
  assignments: Record<string, WorkspaceHostAssignment>,
  notify: boolean
): void {
  writeStoredValue(WORKSPACE_HOST_ASSIGNMENT_KEY, JSON.stringify(assignments));

  if (notify && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WORKSPACE_HOST_ASSIGNMENT_CHANGED_EVENT));
  }
}

function readStoredString(key: string): string | null {
  try {
    const raw = window.localStorage.getItem(key)?.trim();
    return raw ? raw : null;
  } catch {
    return null;
  }
}

function writeStoredValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 忽略隐私模式或测试环境里的本地存储失败。
  }
}
