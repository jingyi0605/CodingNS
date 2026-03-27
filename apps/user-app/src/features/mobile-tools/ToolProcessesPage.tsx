import { TerminalManagerPanel } from "../workbench/components/TerminalManagerPanel";
import { useWorkbenchShell } from "../conversation/components/WorkbenchLayout";
import { t } from "../../shared/i18n";

export function ToolProcessesPage() {
  const { currentWorkspaceId, navigationGroups } = useWorkbenchShell();

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

  return (
    <main className="mobile-feature-page mobile-page-fixed-root mobile-tool-panel-page">
      <TerminalManagerPanel
        className="mobile-panel-scroll-root mobile-tool-native-panel"
        currentWorkspaceId={currentWorkspaceId}
        navigationGroups={navigationGroups}
      />
    </main>
  );
}
