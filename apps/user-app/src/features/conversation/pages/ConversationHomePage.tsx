import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { useWorkbenchShell } from "../components/WorkbenchLayout";

function sortByRecent(left: { updatedAt: string; lastMessageAt: string | null }, right: { updatedAt: string; lastMessageAt: string | null }) {
  return (right.lastMessageAt ?? right.updatedAt).localeCompare(left.lastMessageAt ?? left.updatedAt);
}

export function ConversationHomePage() {
  const { navigationGroups, navigationLoading, setAuxiliaryPanel } = useWorkbenchShell();

  const sessions = useMemo(
    () => navigationGroups.flatMap((group) => group.sessions).sort(sortByRecent),
    [navigationGroups]
  );
  const latestSession = sessions[0] ?? null;
  const workspaceCount = navigationGroups.length;
  const sessionCount = sessions.length;

  useEffect(() => {
    setAuxiliaryPanel({
      title: t("shell.auxiliaryTitle"),
      description: t("home.auxiliarySubtitle"),
      defaultCollapsed: true,
      content: (
        <>
          <section className="workbench-side-card">
            <h3>{t("home.quickOverviewTitle")}</h3>
            <p className="status-text">{t("home.quickOverviewBody")}</p>
            <div className="badge-row">
              <span className="badge">
                {t("shell.workspaceCount")} {workspaceCount}
              </span>
              <span className="badge">
                {t("shell.sessionCount")} {sessionCount}
              </span>
            </div>
          </section>

          <section className="workbench-side-card">
            <h3>{t("home.nextStepTitle")}</h3>
            <p className="status-text">{t("home.nextStepBody")}</p>
          </section>
        </>
      )
    });

    return () => {
      setAuxiliaryPanel(null);
    };
  }, [sessionCount, setAuxiliaryPanel, workspaceCount]);

  return (
    <main className="workbench-page">
      <section className="workbench-hero surface-card">
        <div className="badge-row">
          <span className="badge">{t("shell.title")}</span>
          <span className="badge">{t("home.homeBadge")}</span>
        </div>
        <h1>{t("home.dashboardTitle")}</h1>
        <p className="status-text">{t("home.dashboardSubtitle")}</p>

        <div className="workbench-hero-actions">
          {latestSession ? (
            <Link className="primary-button" to={`/sessions/${latestSession.sessionId}`}>
              {t("home.resumeLatestSession")}
            </Link>
          ) : null}
          <Link className="secondary-button" to="/terminals">
            {t("home.terminalsEntry")}
          </Link>
        </div>
      </section>

      <section className="workbench-home-grid">
        <article className="workbench-home-card surface-card">
          <h2>{t("home.workspaceSection")}</h2>
          <p className="status-text">
            {navigationLoading ? t("common.loading") : t("home.workspaceGuide")}
          </p>
          <div className="workbench-stat-grid">
            <div className="workbench-stat-card">
              <strong>{workspaceCount}</strong>
              <span>{t("shell.workspaceCount")}</span>
            </div>
            <div className="workbench-stat-card">
              <strong>{sessionCount}</strong>
              <span>{t("shell.sessionCount")}</span>
            </div>
          </div>
        </article>

        <article className="workbench-home-card surface-card">
          <h2>{t("home.sessionSection")}</h2>
          <p className="status-text">{t("home.sessionGuide")}</p>
          {latestSession ? (
            <Link className="workbench-highlight-link" to={`/sessions/${latestSession.sessionId}`}>
              <strong>{latestSession.title || t("common.unknown")}</strong>
              <small>{latestSession.provider}</small>
              <small>{latestSession.lastMessageAt ?? latestSession.updatedAt}</small>
            </Link>
          ) : (
            <div className="workbench-empty-state">
              <strong>{t("home.emptySessionsTitle")}</strong>
              <p className="status-text">{t("home.emptySessions")}</p>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
