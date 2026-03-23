import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { authStore } from "../../auth/store/auth-store";
import {
  listWorkspaceSessions,
  listWorkspaces,
  type SessionSummaryDto,
  type WorkspaceDto
} from "../api/conversation-api";

export function ConversationHomePage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [sessions, setSessions] = useState<SessionSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const workspaceResponse = await listWorkspaces();
      setWorkspaces(workspaceResponse.items);

      const sessionGroups = await Promise.all(
        workspaceResponse.items.map(async (workspace) => {
          const response = await listWorkspaceSessions(workspace.id);
          return response.items;
        })
      );

      const flattened = sessionGroups.flat().sort((left, right) =>
        (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? "")
      );

      setSessions(flattened);
      setLoading(false);

      if (flattened.length === 1) {
        navigate(`/sessions/${flattened[0].sessionId}`, { replace: true });
      }
    })();
  }, [navigate]);

  return (
    <main className="home-layout app-shell">
      <div className="home-layout-inner">
        <section className="home-hero surface-card">
          <div className="badge-row">
            <span className="badge">{t("common.appName")}</span>
          </div>
          <h1>{t("home.title")}</h1>
          <p className="status-text">{t("home.subtitle")}</p>
        </section>

        <section className="home-grid">
          <div className="home-panel surface-card">
            <h2>{t("home.sessionSection")}</h2>
            {loading ? <p className="status-text">{t("common.loading")}</p> : null}
            {!loading && sessions.length === 0 ? (
              <p className="status-text">{t("home.emptySessions")}</p>
            ) : null}
            <div className="home-session-list">
              {sessions.map((session) => (
                <Link
                  key={session.sessionId}
                  className="session-link-card"
                  to={`/sessions/${session.sessionId}`}
                >
                  <strong>{session.title || t("common.unknown")}</strong>
                  <small>{session.provider}</small>
                  <small>{session.lastMessageAt ?? t("home.noActivity")}</small>
                </Link>
              ))}
            </div>
          </div>

          <aside className="home-panel surface-card">
            <h2>{t("home.workspaceSection")}</h2>
            {loading ? <p className="status-text">{t("common.loading")}</p> : null}
            {!loading && workspaces.length === 0 ? (
              <p className="status-text">{t("home.emptyWorkspaces")}</p>
            ) : null}
            <div className="home-workspace-list">
              {workspaces.map((workspace) => (
                <span key={workspace.id} className="badge">
                  {workspace.name}
                </span>
              ))}
            </div>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                authStore.clear();
                navigate("/login", { replace: true });
              }}
            >
              {t("common.logout")}
            </button>
          </aside>
        </section>
      </div>
    </main>
  );
}
