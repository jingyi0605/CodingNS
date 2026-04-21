import { t } from "../../../shared/i18n";

export function TrustedEntryLandingPage() {
  return (
    <main className="page-center app-shell">
      <section className="auth-card surface-card">
        <h1>{t("auth.trustedEntryOnlyTitle")}</h1>
        <p className="status-text">{t("auth.trustedEntryOnlyDescription")}</p>
        <div className="field-group">
          <span>{t("auth.trustedEntryOnlyHintTitle")}</span>
          <span className="auth-server-value">{t("auth.trustedEntryOnlyHint")}</span>
        </div>
      </section>
    </main>
  );
}
