import { Navigate } from "react-router-dom";

import { useWorkbenchShell } from "../conversation/components/WorkbenchLayout";
import { buildWorkspaceToolsPath } from "../workbench/utils/workbench-navigation";
import { t } from "../../shared/i18n";

export function ToolGitPage() {
  const { currentWorkspaceId } = useWorkbenchShell();

  if (!currentWorkspaceId) {
    return (
      <main className="mobile-feature-page mobile-page-scroll-root">
        <article className="mobile-feature-empty surface-card">
          <h1>{t("shell.gitEntry")}</h1>
          <p>{t("shell.toolsWorkspaceRequiredBody")}</p>
        </article>
      </main>
    );
  }

  return <Navigate to={buildWorkspaceToolsPath(currentWorkspaceId, "git")} replace />;
}
