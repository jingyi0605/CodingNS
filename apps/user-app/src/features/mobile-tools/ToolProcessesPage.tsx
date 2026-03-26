import { TerminalManagerPanel } from "../workbench/components/TerminalManagerPanel";
import { useWorkbenchShell } from "../conversation/components/WorkbenchLayout";
import { t } from "../../shared/i18n";

export function ToolProcessesPage() {
  const { currentWorkspaceId, navigationGroups } = useWorkbenchShell();

  if (!currentWorkspaceId) {
    return (
      <main className="mobile-feature-page">
        <article className="mobile-feature-empty surface-card">
          <h1>{t("shell.terminalManagerEntry")}</h1>
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
            <h1>{t("shell.terminalManagerEntry")}</h1>
            <p>{t("shell.toolProcessesBody")}</p>
          </div>
        </div>
        <TerminalManagerPanel currentWorkspaceId={currentWorkspaceId} navigationGroups={navigationGroups} />
      </section>
    </main>
  );
}
