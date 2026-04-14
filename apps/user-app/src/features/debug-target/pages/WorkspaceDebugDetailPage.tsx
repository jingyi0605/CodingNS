import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { DebugReadinessView } from "../components/DebugReadinessView";
import { useDebugReadiness } from "../hooks/useDebugReadiness";
import { buildWorkspaceDetailPath } from "../../workbench/utils/workbench-navigation";
import { t } from "../../../shared/i18n";

export function WorkspaceDebugDetailPage() {
  const { workspaceId = "" } = useParams();
  const navigate = useNavigate();
  const { navigationGroups, selectWorkspace } = useWorkbenchShell();
  const workspace =
    navigationGroups.find((group) => group.workspace.id === workspaceId)?.workspace
    ?? null;

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    selectWorkspace(workspaceId);
  }, [selectWorkspace, workspaceId]);

  const readinessWorkspace = useMemo(
    () => (workspace ? { id: workspace.id, path: workspace.path, name: workspace.name } : null),
    [workspace]
  );
  const readinessState = useDebugReadiness(readinessWorkspace);

  if (!workspace) {
    return (
      <main className="workbench-page conversation-page-shell debug-readiness-page-shell">
        <div className="workbench-empty-guide surface-card">
          <h1>{t("shell.workspaceDetailMissingTitle")}</h1>
          <p>{t("shell.workspaceDetailMissingBody")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="workbench-page conversation-page-shell debug-readiness-page-shell">
      <DebugReadinessView
        workspace={readinessWorkspace}
        state={readinessState}
        variant="desktop-page"
        actions={(
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate(buildWorkspaceDetailPath(workspace.id))}
          >
            {t("shell.goBack")}
          </button>
        )}
      />
    </main>
  );
}
