import { Navigate } from "react-router-dom";

import { useWorkbenchShell } from "../conversation/components/WorkbenchLayout";
import {
  buildWorkspaceSessionIndexPath,
  buildWorkspaceSessionPath
} from "../workbench/utils/workbench-navigation";
import { t } from "../../shared/i18n";

export function ToolProcessesPage() {
  const { currentWorkspaceId, currentSessionId, navigationGroups } = useWorkbenchShell();

  if (!currentWorkspaceId) {
    return (
      <main className="mobile-feature-page mobile-page-scroll-root">
        <article className="mobile-feature-empty surface-card">
          <h1>{t("shell.terminalManagerEntry")}</h1>
          <p>{t("shell.toolsWorkspaceRequiredBody")}</p>
        </article>
      </main>
    );
  }

  const currentSessionInWorkspace = navigationGroups
    .flatMap((group) => group.sessions)
    .find(
      (session) =>
        session.sessionId === currentSessionId && session.workspaceId === currentWorkspaceId
    );
  const targetPath = currentSessionInWorkspace
    ? buildWorkspaceSessionPath(currentWorkspaceId, currentSessionInWorkspace.sessionId)
    : buildWorkspaceSessionIndexPath(currentWorkspaceId);

  return (
    <Navigate
      to={`${targetPath}?toolPanel=processes`}
      replace
      state={{ mobileToolPanelRouteRedirect: true }}
    />
  );
}
