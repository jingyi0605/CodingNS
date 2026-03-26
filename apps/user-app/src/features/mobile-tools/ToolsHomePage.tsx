import { useNavigate } from "react-router-dom";

import { useWorkbenchShell } from "../conversation/components/WorkbenchLayout";
import { t } from "../../shared/i18n";

export function ToolsHomePage() {
  const navigate = useNavigate();
  const { navigationGroups, currentWorkspaceId } = useWorkbenchShell();
  const currentWorkspace =
    navigationGroups.find((group) => group.workspace.id === currentWorkspaceId)?.workspace ?? null;

  const toolCards = [
    {
      key: "files",
      title: t("shell.filesEntry"),
      body: t("shell.toolFilesBody"),
      onClick: () => navigate("/tools/files")
    },
    {
      key: "git",
      title: t("shell.gitEntry"),
      body: t("shell.toolGitBody"),
      onClick: () => navigate("/tools/git")
    },
    {
      key: "terminals",
      title: t("shell.terminalsEntry"),
      body: t("shell.toolTerminalsBody"),
      onClick: () => navigate("/terminals")
    },
    {
      key: "processes",
      title: t("shell.terminalManagerEntry"),
      body: t("shell.toolProcessesBody"),
      onClick: () => navigate("/tools/processes")
    }
  ];

  return (
    <main className="mobile-feature-page mobile-tools-home-page">
      <section className="mobile-feature-hero surface-card">
        <div className="mobile-feature-hero-copy">
          <p className="mobile-feature-eyebrow">{t("shell.mobileToolsEntry")}</p>
          <h1>{t("shell.toolsOverviewTitle")}</h1>
          <p>
            {currentWorkspace
              ? t("shell.toolsOverviewBody", { name: currentWorkspace.name })
              : t("shell.toolsOverviewBodyEmpty")}
          </p>
        </div>
      </section>

      {currentWorkspace ? (
        <section className="mobile-feature-section">
          <div className="mobile-feature-section-header">
            <div>
              <h2>{currentWorkspace.name}</h2>
              <p>{currentWorkspace.path}</p>
            </div>
          </div>
          <div className="mobile-feature-grid">
            {toolCards.map((card) => (
              <button
                key={card.key}
                type="button"
                className="mobile-tool-card surface-card"
                aria-label={card.title}
                onClick={card.onClick}
              >
                <strong>{card.title}</strong>
                <p>{card.body}</p>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <article className="mobile-feature-empty surface-card">
          <p>{t("shell.emptyNavigationBody")}</p>
        </article>
      )}
    </main>
  );
}
