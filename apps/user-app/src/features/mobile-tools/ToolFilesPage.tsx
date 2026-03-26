import { FileContextPanel } from "../conversation/components/FileContextPanel";
import { useWorkbenchShell } from "../conversation/components/WorkbenchLayout";
import { t } from "../../shared/i18n";

export function ToolFilesPage() {
  const { currentWorkspaceId, currentSessionId } = useWorkbenchShell();

  if (!currentWorkspaceId) {
    return (
      <main className="mobile-feature-page">
        <article className="mobile-feature-empty surface-card">
          <h1>{t("shell.filesEntry")}</h1>
          <p>{t("shell.toolsWorkspaceRequiredBody")}</p>
        </article>
      </main>
    );
  }

  return (
    <main className="mobile-feature-page mobile-tool-panel-page">
      <section className="mobile-feature-panel surface-card">
        <div className="mobile-feature-section-header">
          <div>
            <h1>{t("shell.filesEntry")}</h1>
            <p>{t("shell.toolFilesBody")}</p>
          </div>
        </div>
        <FileContextPanel sessionId={currentSessionId} workspaceId={currentWorkspaceId} />
      </section>
    </main>
  );
}
