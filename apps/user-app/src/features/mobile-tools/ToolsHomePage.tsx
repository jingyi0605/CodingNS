import { Navigate } from "react-router-dom";

import { useWorkbenchShell } from "../conversation/components/WorkbenchLayout";
import {
  buildWorkspaceSessionIndexPath,
  buildWorkspaceSessionPath
} from "../workbench/utils/workbench-navigation";
import { t } from "../../shared/i18n";

export function ToolsHomePage() {
  const { navigationGroups, currentWorkspaceId, currentSessionId } = useWorkbenchShell();
  const currentWorkspace =
    navigationGroups.find((group) => group.workspace.id === currentWorkspaceId)?.workspace
    ?? navigationGroups[0]?.workspace
    ?? null;

  if (!currentWorkspace) {
    return (
      <main className="mobile-feature-page mobile-page-scroll-root">
        <article className="mobile-feature-empty surface-card">
          <h1>{t("shell.mobileSessionsEntry")}</h1>
          <p>{t("shell.emptyNavigationBody")}</p>
        </article>
      </main>
    );
  }

  const currentSessionInWorkspace = navigationGroups
    .flatMap((group) => group.sessions)
    .find(
      (session) =>
        session.sessionId === currentSessionId && session.workspaceId === currentWorkspace.id
    );
  const targetPath = currentSessionInWorkspace
    ? buildWorkspaceSessionPath(currentWorkspace.id, currentSessionInWorkspace.sessionId)
    : buildWorkspaceSessionIndexPath(currentWorkspace.id);

  return <Navigate to={targetPath} replace />;
}
