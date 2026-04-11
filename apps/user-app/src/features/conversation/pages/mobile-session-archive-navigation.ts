import { isRealSubagentSession } from "../session-fork-display";
import {
  flattenNavigationSessions,
  type WorkbenchNavigationEntry,
  type WorkbenchNavigationGroup
} from "../../workbench/utils/workbench-navigation";

export function resolveNextMobileSessionEntry(
  navigationGroups: readonly WorkbenchNavigationGroup[],
  workspaceId: string | null,
  sessionId: string
): WorkbenchNavigationEntry | null {
  if (!workspaceId) {
    return null;
  }

  const workspaceGroup = navigationGroups.find((group) => group.workspace.id === workspaceId);

  if (!workspaceGroup) {
    return null;
  }

  const visibleEntries = flattenNavigationSessions([workspaceGroup]).filter(
    (entry) => !entry.session.isArchived && !isRealSubagentSession(entry.session)
  );
  const currentIndex = visibleEntries.findIndex((entry) => entry.session.sessionId === sessionId);

  if (currentIndex < 0) {
    return null;
  }

  // 归档后只前进到当前列表里的下一条；如果已经是最后一条，就交给页面退回会话总览。
  return visibleEntries[currentIndex + 1] ?? null;
}

export function resolveFirstMobileSessionEntry(
  navigationGroups: readonly WorkbenchNavigationGroup[],
  workspaceId: string | null
): WorkbenchNavigationEntry | null {
  if (!workspaceId) {
    return null;
  }

  const workspaceGroup = navigationGroups.find((group) => group.workspace.id === workspaceId);

  if (!workspaceGroup) {
    return null;
  }

  const visibleEntries = flattenNavigationSessions([workspaceGroup]).filter(
    (entry) => !entry.session.isArchived && !isRealSubagentSession(entry.session)
  );

  return visibleEntries[0] ?? null;
}
