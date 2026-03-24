import { t } from "../../../shared/i18n";

export function WorkbenchPlaceholderPage() {
  return (
    <main className="workbench-page conversation-page-shell">
      <section className="workbench-center-placeholder surface-card">
        <h1>{t("workbench.emptyTitle")}</h1>
        <p className="status-text">{t("workbench.emptyBody")}</p>
      </section>
    </main>
  );
}
