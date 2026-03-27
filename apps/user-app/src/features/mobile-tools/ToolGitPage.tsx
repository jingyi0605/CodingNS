import { GitSidebar } from "../conversation/components/GitSidebar";
import { useWorkbenchShell } from "../conversation/components/WorkbenchLayout";
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

  return (
    <main className="mobile-feature-page mobile-page-fixed-root mobile-tool-panel-page mobile-tool-git-page">
      <GitSidebar
        className="mobile-panel-scroll-root mobile-tool-native-panel mobile-tool-git-panel"
        workspaceId={currentWorkspaceId}
      />
    </main>
  );
}
