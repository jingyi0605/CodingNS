import { useMemo } from "react";

import { getTerminalRuntimeLabel } from "../../terminal/runtime/terminal-runtime-meta";
import { t } from "../../../shared/i18n";
import type { RegisteredDebugTemplatesState } from "../hooks/useRegisteredDebugTemplates";
import {
  buildRegisteredLaunchPlan,
  buildTemplateCommandPreview,
  formatRegisteredDateTime,
  formatRegisteredOverallStatus,
  formatRegisteredPort,
  formatRuntimeProcessSummary,
  formatRuntimeReason,
  formatTemplatePath,
  formatTemplateRuntimeStatus
} from "../registered-debug-model";

interface RegisteredDebugTemplatesMobileSectionProps {
  workspaceId: string;
  workspacePath: string;
  state: RegisteredDebugTemplatesState;
  onOpenProcessManager: (workspaceId: string) => void;
}

export function RegisteredDebugTemplatesMobileSection({
  workspaceId,
  workspacePath,
  state,
  onOpenProcessManager
}: RegisteredDebugTemplatesMobileSectionProps) {
  const currentLaunchPlan = useMemo(
    () => buildRegisteredLaunchPlan(state.templates, state.runtimeStatuses),
    [state.runtimeStatuses, state.templates]
  );
  const runtimeStatusByTemplateId = useMemo(
    () => new Map(state.runtimeStatuses.map((item) => [item.templateId, item] as const)),
    [state.runtimeStatuses]
  );

  return (
    <section className="mobile-feature-panel surface-card mobile-workspace-composition-panel">
      <div className="mobile-feature-section-header">
        <div>
          <h2>{t("shell.workspaceDetailRegisteredDebugTemplatesTitle")}</h2>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onOpenProcessManager(workspaceId)}
        >
          {t("shell.workspaceDetailRegisteredDebugOpenProcessManagerAction")}
        </button>
      </div>
      <p className="mobile-workspace-composition-note">
        {t("shell.workspaceDetailRegisteredDebugTemplatesDescription")}
      </p>

      <div className="mobile-detail-grid mobile-workspace-detail-grid">
        <div className="mobile-detail-metric">
          <span>{t("shell.workspaceDetailDebugOverallStatusLabel")}</span>
          <strong>{formatRegisteredOverallStatus(currentLaunchPlan, state.templates.length)}</strong>
        </div>
        <div className="mobile-detail-metric">
          <span>{t("shell.workspaceDetailRegisteredDebugSummaryRegisteredCountLabel")}</span>
          <strong>{state.templates.length}</strong>
        </div>
        <div className="mobile-detail-metric">
          <span>{t("shell.workspaceDetailRegisteredDebugSummaryRunnableCountLabel")}</span>
          <strong>{currentLaunchPlan.runnableCount}</strong>
        </div>
        <div className="mobile-detail-metric">
          <span>{t("shell.workspaceDetailRegisteredDebugSummaryOrchestratedCountLabel")}</span>
          <strong>{currentLaunchPlan.orchestratedCount}</strong>
        </div>
        <div className="mobile-detail-metric">
          <span>{t("shell.workspaceDetailRegisteredDebugSummaryBlockedCountLabel")}</span>
          <strong>{currentLaunchPlan.blockedCount}</strong>
        </div>
        <div className="mobile-detail-metric mobile-detail-metric-wide">
          <span>{t("shell.workspaceDetailRegisteredDebugSummaryLastRefreshLabel")}</span>
          <strong>{formatRegisteredDateTime(state.lastRefreshedAt)}</strong>
        </div>
      </div>

      {state.loading && state.templates.length === 0 ? <p>{t("common.loading")}</p> : null}
      {state.error && state.templates.length === 0 ? (
        <p className="status-text" data-tone="error">{state.error}</p>
      ) : null}
      {!state.loading && state.templates.length === 0 ? (
        <p>{t("shell.workspaceDetailRegisteredDebugTemplatesEmpty")}</p>
      ) : null}

      {state.templates.length > 0 ? (
        <div className="mobile-feature-stack">
          {state.templates.map((template) => {
            const runtimeStatus = runtimeStatusByTemplateId.get(template.id) ?? null;

            return (
              <article key={template.id} className="surface-card mobile-session-row">
                <div className="mobile-session-row-primary mobile-session-row-primary-static">
                  <span className="mobile-session-row-title">{template.name}</span>
                  <span className="mobile-session-row-provider">
                    {formatTemplateRuntimeStatus(template, runtimeStatus)}
                  </span>
                </div>
                <div className="mobile-detail-grid mobile-workspace-detail-grid">
                  <div className="mobile-detail-metric">
                    <span>{t("shell.workspaceDetailRegisteredDebugTemplatePathLabel")}</span>
                    <strong title={template.cwd}>{formatTemplatePath(template.cwd, workspacePath)}</strong>
                  </div>
                  <div className="mobile-detail-metric">
                    <span>{t("shell.workspaceDetailRegisteredDebugTemplatePortLabel")}</span>
                    <strong>{formatRegisteredPort(template.port)}</strong>
                  </div>
                  <div className="mobile-detail-metric">
                    <span>{t("shell.workspaceDetailRegisteredDebugTemplateRuntimeTypeLabel")}</span>
                    <strong>{getTerminalRuntimeLabel(template.runtimeType)}</strong>
                  </div>
                  <div className="mobile-detail-metric">
                    <span>{t("shell.workspaceDetailRegisteredDebugRuntimeProcessLabel")}</span>
                    <strong>{formatRuntimeProcessSummary(runtimeStatus)}</strong>
                  </div>
                  <div className="mobile-detail-metric mobile-detail-metric-wide">
                    <span>{t("shell.workspaceDetailRegisteredDebugPlanItemCommandLabel")}</span>
                    <strong>{buildTemplateCommandPreview(template)}</strong>
                  </div>
                  <div className="mobile-detail-metric mobile-detail-metric-wide">
                    <span>{t("shell.workspaceDetailRegisteredDebugPlanItemReasonLabel")}</span>
                    <strong>{formatRuntimeReason(template, runtimeStatus)}</strong>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
