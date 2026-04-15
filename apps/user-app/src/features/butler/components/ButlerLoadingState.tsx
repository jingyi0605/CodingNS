import { t } from "../../../shared/i18n";

export function ButlerLoadingState() {
  return (
    <section className="butler-loading-panel" role="status" aria-live="polite">
      <div className="butler-loading-orb" aria-hidden="true">
        <span className="butler-loading-ring butler-loading-ring-primary" />
        <span className="butler-loading-ring butler-loading-ring-secondary" />
        <span className="butler-loading-core" />
      </div>
      <div className="butler-loading-copy">
        <h1>{t("shell.butlerLoadingTitle")}</h1>
        <p>{t("shell.butlerLoadingDescription")}</p>
      </div>
    </section>
  );
}
