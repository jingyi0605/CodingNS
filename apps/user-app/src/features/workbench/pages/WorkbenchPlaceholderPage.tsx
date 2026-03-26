import { t } from "../../../shared/i18n";

const emptyGuideItems = [
  {
    titleKey: "workbench.emptyResumeTitle",
    bodyKey: "workbench.emptyResumeBody"
  },
  {
    titleKey: "workbench.emptyNewTitle",
    bodyKey: "workbench.emptyNewBody"
  },
  {
    titleKey: "workbench.emptyCompanionTitle",
    bodyKey: "workbench.emptyCompanionBody"
  }
] as const;

export function WorkbenchPlaceholderPage() {
  return (
    <main className="workbench-page conversation-page-shell">
      <section className="workbench-center-placeholder">
        <div className="workbench-empty-guide surface-card">
          <p className="workbench-empty-eyebrow">{t("workbench.emptyEyebrow")}</p>
          <div className="workbench-empty-main">
            <div className="workbench-empty-copy">
              <h1>{t("workbench.emptyTitle")}</h1>
              <p className="workbench-empty-body">{t("workbench.emptyBody")}</p>
            </div>
          </div>
          <ol className="workbench-empty-steps">
            {emptyGuideItems.map((item, index) => (
              <li key={item.titleKey} className="workbench-empty-step">
                <span className="workbench-empty-step-index">{index + 1}</span>
                <div className="workbench-empty-step-copy">
                  <h2>{t(item.titleKey)}</h2>
                  <p>{t(item.bodyKey)}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="workbench-empty-tip">{t("workbench.emptyTip")}</p>
        </div>
      </section>
    </main>
  );
}
