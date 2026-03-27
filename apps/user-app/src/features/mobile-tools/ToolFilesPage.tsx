import { FileContextPanel } from "../conversation/components/FileContextPanel";
import { useWorkbenchShell } from "../conversation/components/WorkbenchLayout";
import { t } from "../../shared/i18n";

export function ToolFilesPage() {
  const { currentWorkspaceId, currentSessionId } = useWorkbenchShell();

  if (!currentWorkspaceId) {
    return (
      <main className="mobile-feature-page mobile-page-scroll-root">
        <article className="mobile-feature-empty surface-card">
          <h1>{t("shell.filesEntry")}</h1>
          <p>{t("shell.toolsWorkspaceRequiredBody")}</p>
        </article>
      </main>
    );
  }

  return (
    <main className="mobile-feature-page mobile-page-fixed-root mobile-tool-panel-page">
      <FileContextPanel
        className="mobile-panel-scroll-root mobile-tool-native-panel"
        sessionId={currentSessionId}
        workspaceId={currentWorkspaceId}
      />
    </main>
  );
}
