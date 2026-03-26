import { GitSidebar } from "../conversation/components/GitSidebar";
import { useWorkbenchShell } from "../conversation/components/WorkbenchLayout";
import { t } from "../../shared/i18n";

export function ToolGitPage() {
  const { currentWorkspaceId } = useWorkbenchShell();

  if (!currentWorkspaceId) {
    return (
      <main className="mobile-feature-page">
        <article className="mobile-feature-empty surface-card">
          <h1>{t("shell.gitEntry")}</h1>
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
            <h1>{t("shell.gitEntry")}</h1>
            <p>{t("shell.toolGitBody")}</p>
          </div>
        </div>
        <GitSidebar workspaceId={currentWorkspaceId} />
      </section>
    </main>
  );
}
