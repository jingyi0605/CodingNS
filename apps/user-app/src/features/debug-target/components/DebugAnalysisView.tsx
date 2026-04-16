import type { FrameworkAnalysisResultDto } from "../../conversation/api/conversation-api";
import { t } from "../../../shared/i18n";
import type { DebugAnalysisState, DebugAnalysisWorkspaceTarget } from "../hooks/useDebugAnalysis";

export interface DebugAnalysisViewProps {
  workspace: (DebugAnalysisWorkspaceTarget & { name?: string | null }) | null;
  state: DebugAnalysisState;
  variant: "mobile" | "page";
}

export function DebugAnalysisView({
  workspace,
  state,
  variant
}: DebugAnalysisViewProps) {
  if (!workspace) {
    return <p className="workbench-section-empty">{t("shell.workspaceDetailMissingBody")}</p>;
  }

  return variant === "mobile"
    ? <MobileDebugAnalysisView workspace={workspace} state={state} />
    : <PageDebugAnalysisView workspace={workspace} state={state} />;
}

function MobileDebugAnalysisView({
  workspace,
  state
}: Omit<DebugAnalysisViewProps, "variant"> & {
  workspace: DebugAnalysisWorkspaceTarget & { name?: string | null };
}) {
  const primaryAnalysis = state.primaryAnalysis;
  const analysisCount = state.analyses.length;

  return (
    <>
      <section className="mobile-feature-panel surface-card mobile-workspace-composition-panel">
        <div className="mobile-feature-section-header">
          <div>
            <h2>{t("shell.workspaceDetailRegisteredDebugAnalysisTitle")}</h2>
          </div>
        </div>
        {state.loading && primaryAnalysis === null ? <p>{t("common.loading")}</p> : null}
        {state.error ? <p className="status-text" data-tone="error">{state.error}</p> : null}
        {primaryAnalysis ? (
          <div className="mobile-detail-grid mobile-workspace-detail-grid">
            <div className="mobile-detail-metric">
              <span>{t("shell.workspaceDetailDebugFrameworkLabel")}</span>
              <strong>{primaryAnalysis.primaryFramework ?? t("common.unknown")}</strong>
            </div>
            <div className="mobile-detail-metric">
              <span>{t("shell.workspaceDetailDebugConfidenceLabel")}</span>
              <strong>{formatDebugConfidence(primaryAnalysis.confidence)}</strong>
            </div>
            <div className="mobile-detail-metric">
              <span>{t("shell.workspaceDetailDebugSummaryServiceCountLabel")}</span>
              <strong>{analysisCount}</strong>
            </div>
            <div className="mobile-detail-metric">
              <span>{t("shell.workspaceDetailDebugCompatibilityLabel")}</span>
              <strong>{formatCompatibilityLevel(primaryAnalysis.compatibilityLevel)}</strong>
            </div>
            <div className="mobile-detail-metric">
              <span>{t("shell.workspaceDetailDebugLastAnalyzedAtLabel")}</span>
              <strong>{state.lastAnalyzedAt ?? t("shell.workspaceDetailDebugFrameworkNoteEmpty")}</strong>
            </div>
            <div className="mobile-detail-metric mobile-detail-metric-wide">
              <span>{t("shell.manageWorkspacePathLabel")}</span>
              <strong>{workspace.path}</strong>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}

function PageDebugAnalysisView({
  workspace,
  state
}: Omit<DebugAnalysisViewProps, "variant"> & {
  workspace: DebugAnalysisWorkspaceTarget & { name?: string | null };
}) {
  const primaryAnalysis = state.primaryAnalysis;
  const analysisCount = state.analyses.length;

  return (
    <section className="debug-readiness-section surface-card">
      <div className="debug-readiness-section-header">
        <div>
          <h3>{t("shell.workspaceDetailRegisteredDebugAnalysisTitle")}</h3>
          <p>{t("shell.workspaceDetailRegisteredDebugAnalysisDescription")}</p>
        </div>
      </div>
      {state.loading && primaryAnalysis === null ? (
        <p className="workbench-section-empty">{t("common.loading")}</p>
      ) : null}
      {state.error ? (
        <p className="workbench-manage-status status-text" data-tone="error">{state.error}</p>
      ) : null}
      {primaryAnalysis ? (
        <div className="debug-readiness-summary-grid">
          <article className="debug-readiness-summary-card">
            <span>{t("shell.workspaceDetailDebugFrameworkLabel")}</span>
            <strong>{primaryAnalysis.primaryFramework ?? t("common.unknown")}</strong>
          </article>
          <article className="debug-readiness-summary-card">
            <span>{t("shell.workspaceDetailDebugConfidenceLabel")}</span>
            <strong>{formatDebugConfidence(primaryAnalysis.confidence)}</strong>
            <small>{state.lastAnalyzedAt ?? t("shell.workspaceDetailDebugFrameworkNoteEmpty")}</small>
          </article>
          <article className="debug-readiness-summary-card">
            <span>{t("shell.workspaceDetailDebugSummaryServiceCountLabel")}</span>
            <strong>{analysisCount}</strong>
          </article>
          <article className="debug-readiness-summary-card">
            <span>{t("shell.workspaceDetailDebugCompatibilityLabel")}</span>
            <strong>{formatCompatibilityLevel(primaryAnalysis.compatibilityLevel)}</strong>
          </article>
          <article className="debug-readiness-summary-card">
            <span>{t("shell.manageWorkspacePathLabel")}</span>
            <strong title={workspace.path}>{workspace.path}</strong>
          </article>
        </div>
      ) : null}
    </section>
  );
}

function formatCompatibilityLevel(level: FrameworkAnalysisResultDto["compatibilityLevel"] | "unknown"): string {
  switch (level) {
    case "supported":
      return t("shell.workspaceDetailDebugCompatibilitySupported");
    case "conditional":
      return t("shell.workspaceDetailDebugCompatibilityConditional");
    case "unsupported":
      return t("shell.workspaceDetailDebugCompatibilityUnsupported");
    default:
      return t("shell.workspaceDetailDebugCompatibilityUnknown");
  }
}

function formatDebugConfidence(confidence: FrameworkAnalysisResultDto["confidence"] | null | undefined): string {
  switch (confidence) {
    case "high":
      return t("shell.workspaceDetailDebugConfidenceHigh");
    case "medium":
      return t("shell.workspaceDetailDebugConfidenceMedium");
    case "low":
      return t("shell.workspaceDetailDebugConfidenceLow");
    default:
      return t("common.unknown");
  }
}
