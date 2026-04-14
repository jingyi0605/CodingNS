import { useState, type ReactNode } from "react";

import type {
  DebugRuntimeDetailDto,
  DebugServiceSpecDto,
  FrameworkAnalysisResultDto
} from "../../conversation/api/conversation-api";
import { WorkbenchModal } from "../../conversation/components/WorkbenchModal";
import { t } from "../../../shared/i18n";
import type { DebugReadinessState, DebugReadinessWorkspaceTarget } from "../hooks/useDebugReadiness";

export interface DebugReadinessViewProps {
  workspace: (DebugReadinessWorkspaceTarget & { name?: string | null }) | null;
  state: DebugReadinessState;
  variant: "mobile" | "desktop-modal" | "desktop-page";
  actions?: ReactNode;
  matrixLimit?: number;
}

export function DebugReadinessView({
  workspace,
  state,
  variant,
  actions,
  matrixLimit
}: DebugReadinessViewProps) {
  if (!workspace) {
    return <p className="workbench-section-empty">{t("shell.workspaceDetailMissingBody")}</p>;
  }

  return variant === "mobile"
    ? (
      <MobileDebugReadinessView
        workspace={workspace}
        state={state}
        actions={actions}
        matrixLimit={matrixLimit}
      />
    )
    : variant === "desktop-modal"
      ? (
        <DesktopDebugReadinessModalView
          workspace={workspace}
          state={state}
          actions={actions}
          matrixLimit={matrixLimit}
        />
      )
      : (
        <DesktopDebugReadinessPageView
          workspace={workspace}
          state={state}
          actions={actions}
          matrixLimit={matrixLimit}
        />
      );
}

function MobileDebugReadinessView({
  workspace,
  state,
  actions,
  matrixLimit
}: Omit<DebugReadinessViewProps, "variant"> & {
  workspace: DebugReadinessWorkspaceTarget & { name?: string | null };
}) {
  const primaryAnalysis = state.primaryAnalysis;
  const runtimeSession = state.runtime?.runtimeSession ?? null;
  const matrixItems = matrixLimit ? state.matrixItems.slice(0, matrixLimit) : state.matrixItems;
  const summary = buildOverallSummary(state);
  const [matrixModalOpen, setMatrixModalOpen] = useState(false);

  return (
    <>
      <section className="mobile-feature-panel surface-card mobile-workspace-composition-panel">
        <div className="mobile-feature-section-header">
          <div>
            <h2>{t("shell.workspaceDetailDebugTitle")}</h2>
          </div>
        </div>
        {state.loading && primaryAnalysis === null ? <p>{t("common.loading")}</p> : null}
        {state.error ? <p className="status-text" data-tone="error">{state.error}</p> : null}
        {primaryAnalysis ? (
          <>
            <div className="mobile-detail-grid mobile-workspace-detail-grid">
              <div className="mobile-detail-metric">
                <span>{t("shell.workspaceDetailDebugOverallStatusLabel")}</span>
                <strong>{formatOverallStatus(summary)}</strong>
              </div>
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
                <strong>{summary.totalServices}</strong>
              </div>
              <div className="mobile-detail-metric">
                <span>{t("shell.workspaceDetailDebugCompatibilityLabel")}</span>
                <strong>{formatCompatibilityLevel(primaryAnalysis.compatibilityLevel)}</strong>
              </div>
              <div className="mobile-detail-metric">
                <span>{t("shell.workspaceDetailDebugInjectionLabel")}</span>
                <strong>{formatInjectionMode(primaryAnalysis.recommendedInjectionMode ?? "none")}</strong>
              </div>
              <div className="mobile-detail-metric">
                <span>{t("shell.workspaceDetailDebugRuntimeStatusLabel")}</span>
                <strong>{formatRuntimeStatus(runtimeSession?.status ?? null)}</strong>
              </div>
              <div className="mobile-detail-metric">
                <span>{t("shell.workspaceDetailDebugFailureStageLabel")}</span>
                <strong>{formatFailureStage(runtimeSession?.failureStage ?? null)}</strong>
              </div>
              <div className="mobile-detail-metric">
                <span>{t("shell.workspaceDetailDebugServiceDiscoveryLabel")}</span>
                <strong>{formatRequirementFlag(primaryAnalysis.requiresServiceDiscoveryHandling)}</strong>
              </div>
              <div className="mobile-detail-metric">
                <span>{t("shell.workspaceDetailDebugHmrLabel")}</span>
                <strong>{formatRequirementFlag(primaryAnalysis.requiresHmrHandling)}</strong>
              </div>
              <div className="mobile-detail-metric">
                <span>{t("shell.workspaceDetailDebugCallbackLabel")}</span>
                <strong>{formatRequirementFlag(primaryAnalysis.requiresCallbackHandling)}</strong>
              </div>
              <div className="mobile-detail-metric mobile-detail-metric-wide">
                <span>{t("shell.workspaceDetailDebugAiFallbackLabel")}</span>
                <strong>{formatAiFallbackPolicy(primaryAnalysis.aiFallbackPolicy)}</strong>
              </div>
              <div className="mobile-detail-metric mobile-detail-metric-wide">
                <span>{t("shell.manageWorkspacePathLabel")}</span>
                <strong>{workspace.path}</strong>
              </div>
              <div className="mobile-detail-metric mobile-detail-metric-wide">
                <span>{t("shell.workspaceDetailDebugFrameworkNoteLabel")}</span>
                <strong>{state.currentCompatibilityItem?.notes ?? t("shell.workspaceDetailDebugFrameworkNoteEmpty")}</strong>
              </div>
              <div className="mobile-detail-metric mobile-detail-metric-wide">
                <span>{t("shell.workspaceDetailDebugOverallSummaryLabel")}</span>
                <strong>{formatOverallSummaryText(summary)}</strong>
              </div>
              <div className="mobile-detail-metric mobile-detail-metric-wide">
                <span>{t("shell.workspaceDetailDebugReasonsLabel")}</span>
                <strong>{formatDebugList(primaryAnalysis.reasons, "shell.workspaceDetailDebugEmptyReasons")}</strong>
              </div>
              <div className="mobile-detail-metric mobile-detail-metric-wide">
                <span>{t("shell.workspaceDetailDebugFilesLabel")}</span>
                <strong>{formatDebugList(primaryAnalysis.detectedFiles, "shell.workspaceDetailDebugEmptyFiles")}</strong>
              </div>
            </div>
            {state.runtime === null ? (
              <p className="status-text">{t("shell.workspaceDetailDebugRuntimeEmpty")}</p>
            ) : null}
            {actions ? <div className="workbench-modal-actions">{actions}</div> : null}
          </>
        ) : null}
      </section>

      {state.services.length > 0 ? (
        <section className="mobile-feature-panel surface-card mobile-workspace-composition-panel">
          <div className="mobile-feature-section-header">
            <div>
              <h2>{t("shell.workspaceDetailDebugDetectedServicesTitle")}</h2>
            </div>
            <span className="mobile-feature-counter">{state.services.length}</span>
          </div>
          <div className="mobile-feature-stack">
            {state.services.map((service) => {
              const analysis = state.analyses.find((item) => item.serviceId === service.id) ?? null;

              return (
                <article key={service.id} className="surface-card mobile-session-row">
                  <div className="mobile-session-row-primary mobile-session-row-primary-static">
                    <span className="mobile-session-row-title">{service.name}</span>
                    <span className="mobile-session-row-provider">{formatServiceCategory(resolveServiceCategory(service, analysis))}</span>
                  </div>
                  <div className="mobile-detail-grid mobile-workspace-detail-grid">
                    <div className="mobile-detail-metric">
                      <span>{t("shell.workspaceDetailDebugServicePathLabel")}</span>
                      <strong title={service.cwd}>{formatServicePath(service.cwd, workspace.path)}</strong>
                    </div>
                    <div className="mobile-detail-metric">
                      <span>{t("shell.workspaceDetailDebugServiceFrameworkLabel")}</span>
                      <strong>{analysis?.primaryFramework ?? t("common.unknown")}</strong>
                    </div>
                    <div className="mobile-detail-metric">
                      <span>{t("shell.workspaceDetailDebugCompatibilityLabel")}</span>
                      <strong>{formatCompatibilityLevel(analysis?.compatibilityLevel ?? "unknown")}</strong>
                    </div>
                    <div className="mobile-detail-metric mobile-detail-metric-wide">
                      <span>{t("shell.workspaceDetailDebugServiceCommandLabel")}</span>
                      <strong>{formatCommand(service)}</strong>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {state.runtime?.services.length ? (
        <section className="mobile-feature-panel surface-card mobile-workspace-composition-panel">
          <div className="mobile-feature-section-header">
            <div>
              <h2>{t("shell.workspaceDetailDebugRuntimeServicesTitle")}</h2>
            </div>
            <span className="mobile-feature-counter">{state.runtime.services.length}</span>
          </div>
          <div className="mobile-feature-stack">
            {state.runtime.services.map((item) => (
              <article key={item.service.id} className="surface-card mobile-session-row">
                <div className="mobile-session-row-primary mobile-session-row-primary-static">
                  <span className="mobile-session-row-title">{item.service.name}</span>
                  <span className="mobile-session-row-provider">{formatServiceCategory(resolveServiceCategory(item.service, item.analysis))}</span>
                </div>
                <div className="mobile-detail-grid mobile-workspace-detail-grid">
                  <div className="mobile-detail-metric">
                    <span>{t("shell.workspaceDetailDebugServicePathLabel")}</span>
                    <strong title={item.service.cwd}>{formatServicePath(item.service.cwd, workspace.path)}</strong>
                  </div>
                  <div className="mobile-detail-metric">
                    <span>{t("shell.workspaceDetailDebugRuntimeServicePortLabel")}</span>
                    <strong>{formatPortValue(item.binding?.leasedPort ?? item.portLease?.port ?? null)}</strong>
                  </div>
                  <div className="mobile-detail-metric">
                    <span>{t("shell.workspaceDetailDebugRuntimeServiceBindingLabel")}</span>
                    <strong>{formatBindingStatus(item.binding?.status ?? null)}</strong>
                  </div>
                  <div className="mobile-detail-metric">
                    <span>{t("shell.workspaceDetailDebugRuntimeServiceProcessLabel")}</span>
                    <strong>{formatProcessStatus(item.processInstance?.status ?? null)}</strong>
                  </div>
                  <div className="mobile-detail-metric">
                    <span>{t("shell.workspaceDetailDebugRuntimeServiceFailureLabel")}</span>
                    <strong>{formatFailureStage(item.processInstance?.failureStage ?? runtimeSession?.failureStage ?? null)}</strong>
                  </div>
                  <div className="mobile-detail-metric mobile-detail-metric-wide">
                    <span>{t("shell.workspaceDetailDebugRuntimeServiceAiLabel")}</span>
                    <strong>{formatAiFallbackEditStatuses(item.aiFallbackEdits.map((edit) => edit.status))}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {matrixItems.length > 0 ? (
        <section className="mobile-feature-panel surface-card mobile-workspace-composition-panel">
          <DebugSupportMatrixEntry
            items={matrixItems}
            layout="mobile"
            open={matrixModalOpen}
            onOpen={() => setMatrixModalOpen(true)}
            onClose={() => setMatrixModalOpen(false)}
          />
        </section>
      ) : null}
    </>
  );
}

function DesktopDebugReadinessModalView({
  workspace,
  state,
  actions,
  matrixLimit
}: Omit<DebugReadinessViewProps, "variant"> & {
  workspace: DebugReadinessWorkspaceTarget & { name?: string | null };
}) {
  const primaryAnalysis = state.primaryAnalysis;
  const runtimeSession = state.runtime?.runtimeSession ?? null;
  const matrixItems = matrixLimit ? state.matrixItems.slice(0, matrixLimit) : state.matrixItems;
  const summary = buildOverallSummary(state);

  return (
    <div className="workbench-manage-list">
      {state.loading && primaryAnalysis === null ? (
        <p className="workbench-manage-status status-text">{t("common.loading")}</p>
      ) : null}
      {state.error ? (
        <p className="workbench-manage-status status-text" data-tone="error">{state.error}</p>
      ) : null}
      {primaryAnalysis ? (
        <>
          <div className="workbench-manage-detail-block">
            <span className="workbench-manage-detail-label">{t("shell.workspaceDetailDebugOverallStatusLabel")}</span>
            <p className="workbench-manage-detail-value">{formatOverallStatus(summary)}</p>
            <p className="workbench-manage-hint">{formatOverallSummaryText(summary)}</p>
          </div>

          <div className="workbench-manage-detail-block">
            <span className="workbench-manage-detail-label">{t("shell.manageWorkspacePathLabel")}</span>
            <p className="workbench-manage-detail-value">{workspace.path}</p>
          </div>

          <div className="workbench-manage-detail-block">
            <div className="workbench-manage-kv-list">
              <div className="workbench-manage-kv-item">
                <span>{t("shell.workspaceDetailDebugFrameworkLabel")}</span>
                <span>{primaryAnalysis.primaryFramework ?? t("common.unknown")}</span>
              </div>
              <div className="workbench-manage-kv-item">
                <span>{t("shell.workspaceDetailDebugConfidenceLabel")}</span>
                <span>{formatDebugConfidence(primaryAnalysis.confidence)}</span>
              </div>
              <div className="workbench-manage-kv-item">
                <span>{t("shell.workspaceDetailDebugCompatibilityLabel")}</span>
                <span>{formatCompatibilityLevel(primaryAnalysis.compatibilityLevel)}</span>
              </div>
              <div className="workbench-manage-kv-item">
                <span>{t("shell.workspaceDetailDebugInjectionLabel")}</span>
                <span>{formatInjectionMode(primaryAnalysis.recommendedInjectionMode ?? "none")}</span>
              </div>
              <div className="workbench-manage-kv-item">
                <span>{t("shell.workspaceDetailDebugRuntimeStatusLabel")}</span>
                <span>{formatRuntimeStatus(runtimeSession?.status ?? null)}</span>
              </div>
              <div className="workbench-manage-kv-item">
                <span>{t("shell.workspaceDetailDebugFailureStageLabel")}</span>
                <span>{formatFailureStage(runtimeSession?.failureStage ?? null)}</span>
              </div>
              <div className="workbench-manage-kv-item">
                <span>{t("shell.workspaceDetailDebugAiFallbackLabel")}</span>
                <span>{formatAiFallbackPolicy(primaryAnalysis.aiFallbackPolicy)}</span>
              </div>
            </div>
          </div>

          <div className="workbench-manage-detail-block">
            <span className="workbench-manage-detail-label">{t("shell.workspaceDetailDebugDetectedServicesTitle")}</span>
            {state.services.length > 0 ? (
              <div className="workbench-manage-type-list">
                {state.services.map((service) => {
                  const analysis = state.analyses.find((item) => item.serviceId === service.id) ?? null;

                  return (
                    <div key={service.id} className="workbench-manage-type-item">
                      <span className="workbench-manage-type-meta">
                      <span className="workbench-manage-type-name">
                          {service.name} · {formatServiceCategory(resolveServiceCategory(service, analysis))}
                        </span>
                      </span>
                      <span title={service.cwd}>
                        {formatServicePath(service.cwd, workspace.path)}
                        {" · "}
                        {analysis?.primaryFramework ?? t("common.unknown")}
                        {" · "}
                        {formatCompatibilityLevel(analysis?.compatibilityLevel ?? "unknown")}
                        {" · "}
                        {formatCommand(service)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="workbench-section-empty">{t("shell.workspaceDetailDebugRuntimeEmpty")}</p>
            )}
          </div>

          <div className="workbench-manage-detail-block">
            <span className="workbench-manage-detail-label">{t("shell.workspaceDetailDebugFrameworkNoteLabel")}</span>
            <p className="workbench-manage-hint">
              {state.currentCompatibilityItem?.notes ?? t("shell.workspaceDetailDebugFrameworkNoteEmpty")}
            </p>
          </div>

          <div className="workbench-manage-detail-block">
            <span className="workbench-manage-detail-label">{t("shell.workspaceDetailDebugReasonsLabel")}</span>
            <p className="workbench-manage-hint">
              {formatDebugList(primaryAnalysis.reasons, "shell.workspaceDetailDebugEmptyReasons")}
            </p>
          </div>

          <div className="workbench-manage-detail-block">
            <span className="workbench-manage-detail-label">{t("shell.workspaceDetailDebugFilesLabel")}</span>
            <p className="workbench-manage-hint">
              {formatDebugList(primaryAnalysis.detectedFiles, "shell.workspaceDetailDebugEmptyFiles")}
            </p>
          </div>

          <div className="workbench-manage-detail-block">
            <span className="workbench-manage-detail-label">{t("shell.workspaceDetailDebugRuntimeServicesTitle")}</span>
            {state.runtime?.services.length ? (
              <div className="workbench-manage-type-list">
                {state.runtime.services.map((item) => (
                  <div key={item.service.id} className="workbench-manage-type-item">
                    <span className="workbench-manage-type-meta">
                      <span className="workbench-manage-type-name">
                        {item.service.name} · {formatServiceCategory(resolveServiceCategory(item.service, item.analysis))}
                      </span>
                    </span>
                    <span title={item.service.cwd}>
                      {formatServicePath(item.service.cwd, workspace.path)}
                      {" · "}
                      {t("shell.workspaceDetailDebugRuntimeServicePortLabel")} {formatPortValue(item.binding?.leasedPort ?? item.portLease?.port ?? null)}
                      {" · "}
                      {t("shell.workspaceDetailDebugRuntimeServiceBindingLabel")} {formatBindingStatus(item.binding?.status ?? null)}
                      {" · "}
                      {t("shell.workspaceDetailDebugRuntimeServiceProcessLabel")} {formatProcessStatus(item.processInstance?.status ?? null)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="workbench-section-empty">{t("shell.workspaceDetailDebugRuntimeEmpty")}</p>
            )}
          </div>

          <div className="workbench-manage-detail-block">
            <span className="workbench-manage-detail-label">{t("shell.workspaceDetailDebugMatrixTitle")}</span>
            <div className="workbench-manage-type-list">
              {matrixItems.map((item) => (
                <div key={item.framework} className="workbench-manage-type-item">
                  <span className="workbench-manage-type-meta">
                    <span className="workbench-manage-type-name">{item.framework}</span>
                  </span>
                  <span>
                    {formatCompatibilityLevel(item.compatibilityLevel)}
                    {" · "}
                    {formatInjectionMode(item.recommendedInjectionMode)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {actions ? <div className="workbench-modal-actions">{actions}</div> : null}
        </>
      ) : null}
    </div>
  );
}

function DesktopDebugReadinessPageView({
  workspace,
  state,
  actions,
  matrixLimit
}: Omit<DebugReadinessViewProps, "variant"> & {
  workspace: DebugReadinessWorkspaceTarget & { name?: string | null };
}) {
  const primaryAnalysis = state.primaryAnalysis;
  const runtimeSession = state.runtime?.runtimeSession ?? null;
  const matrixItems = matrixLimit ? state.matrixItems.slice(0, matrixLimit) : state.matrixItems;
  const summary = buildOverallSummary(state);
  const derivedServices = buildDerivedServices(state);
  const lastAnalyzedAt = state.analyses[0]?.createdAt ?? null;
  const [matrixModalOpen, setMatrixModalOpen] = useState(false);

  return (
    <div className="debug-readiness-page">
      {state.loading && primaryAnalysis === null ? (
        <p className="workbench-manage-status status-text">{t("common.loading")}</p>
      ) : null}
      {state.error ? (
        <p className="workbench-manage-status status-text" data-tone="error">{state.error}</p>
      ) : null}
      {primaryAnalysis ? (
        <>
          <section className="debug-readiness-hero surface-card">
            <div className="debug-readiness-hero-header">
              <div className="debug-readiness-hero-copy">
                <span className="debug-readiness-eyebrow">{workspace.name ?? t("shell.workspaceDetailDebugPageHeroEyebrow")}</span>
                <h2>{t("shell.workspaceDetailDebugPageTitle")}</h2>
                <p>{formatOverallSummaryText(summary)}</p>
              </div>
              {actions ? <div className="debug-readiness-hero-actions">{actions}</div> : null}
            </div>

            <div className="debug-readiness-summary-grid">
              <article className="debug-readiness-summary-card" data-tone={summary.overallTone}>
                <span>{t("shell.workspaceDetailDebugOverallStatusLabel")}</span>
                <strong>{formatOverallStatus(summary)}</strong>
                <small>{summary.autoInjectionEligible
                  ? t("shell.workspaceDetailDebugAutoInjectionEligible")
                  : t("shell.workspaceDetailDebugAutoInjectionBlocked")}</small>
              </article>
              <article className="debug-readiness-summary-card">
                <span>{t("shell.workspaceDetailDebugSummaryServiceCountLabel")}</span>
                <strong>{summary.totalServices}</strong>
                <small>{t("shell.workspaceDetailDebugDetectedServicesTitle")}</small>
              </article>
              <article className="debug-readiness-summary-card">
                <span>{t("shell.workspaceDetailDebugSummaryWebCountLabel")}</span>
                <strong>{summary.webServiceCount}</strong>
                <small>{formatCompatibilityBreakdown(summary)}</small>
              </article>
              <article className="debug-readiness-summary-card">
                <span>{t("shell.workspaceDetailDebugSummaryDesktopShellCountLabel")}</span>
                <strong>{summary.desktopShellCount}</strong>
                <small>{t("shell.workspaceDetailDebugDesktopShellSummaryHint")}</small>
              </article>
              <article className="debug-readiness-summary-card">
                <span>{t("shell.workspaceDetailDebugRuntimeStatusLabel")}</span>
                <strong>{formatRuntimeStatus(runtimeSession?.status ?? null)}</strong>
                <small>{formatFailureStage(runtimeSession?.failureStage ?? null)}</small>
              </article>
              <article className="debug-readiness-summary-card">
                <span>{t("shell.workspaceDetailDebugLastAnalyzedAtLabel")}</span>
                <strong>{formatDateTime(lastAnalyzedAt)}</strong>
                <small>{formatTargetSourceType(state.targetSourceType)}</small>
              </article>
            </div>

            <div className="debug-readiness-chip-row">
              {summary.categoryChips.map((chip) => (
                <span key={chip.key} className="debug-readiness-chip" data-tone={chip.tone}>
                  {chip.label}
                </span>
              ))}
            </div>

            <div className="debug-readiness-hero-meta">
              <span>{t("shell.manageWorkspacePathLabel")}</span>
              <strong>{workspace.path}</strong>
            </div>
          </section>

          <div className="debug-readiness-layout">
            <section className="debug-readiness-section surface-card">
              <div className="debug-readiness-section-header">
                <div>
                  <h3>{t("shell.workspaceDetailDebugDetectedServicesTitle")}</h3>
                  <p>{t("shell.workspaceDetailDebugServiceSectionDescription")}</p>
                </div>
              </div>
              <div className="debug-readiness-service-grid">
                {derivedServices.map((item) => (
                  <article key={item.service.id} className="debug-readiness-service-card">
                    <div className="debug-readiness-service-card-header">
                      <div>
                        <strong>{item.service.name}</strong>
                        <p>{formatServicePath(item.service.cwd, workspace.path)}</p>
                      </div>
                      <span className="debug-readiness-chip" data-tone={resolveServiceCategoryTone(item.category)}>
                        {formatServiceCategory(item.category)}
                      </span>
                    </div>
                    <div className="debug-readiness-service-card-grid">
                      <div>
                        <span>{t("shell.workspaceDetailDebugServiceFrameworkLabel")}</span>
                        <strong>{item.analysis?.primaryFramework ?? t("common.unknown")}</strong>
                      </div>
                      <div>
                        <span>{t("shell.workspaceDetailDebugCompatibilityLabel")}</span>
                        <strong>{formatCompatibilityLevel(item.analysis?.compatibilityLevel ?? "unknown")}</strong>
                      </div>
                      <div>
                        <span>{t("shell.workspaceDetailDebugInjectionLabel")}</span>
                        <strong>{formatInjectionMode(item.analysis?.recommendedInjectionMode ?? "none")}</strong>
                      </div>
                      <div>
                        <span>{t("shell.workspaceDetailDebugRuntimeStatusLabel")}</span>
                        <strong>{formatRuntimeStatus(resolveRuntimeStatus(item))}</strong>
                      </div>
                    </div>
                    <div className="debug-readiness-service-card-list">
                      <p>
                        <span>{t("shell.workspaceDetailDebugServiceCommandLabel")}</span>
                        <strong>{formatCommand(item.service)}</strong>
                      </p>
                      <p>
                        <span>{t("shell.workspaceDetailDebugServiceRequirementsLabel")}</span>
                        <strong>{formatRequirementSummary(item.analysis)}</strong>
                      </p>
                      <p>
                        <span>{t("shell.workspaceDetailDebugServiceActionLabel")}</span>
                        <strong>{formatServiceAction(item)}</strong>
                      </p>
                      <p>
                        <span>{t("shell.workspaceDetailDebugReasonsLabel")}</span>
                        <strong>{formatServiceOverview(item)}</strong>
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <aside className="debug-readiness-sidebar">
              <section className="debug-readiness-section surface-card">
                <div className="debug-readiness-section-header">
                  <div>
                    <h3>{t("shell.workspaceDetailDebugRuntimeHistoryTitle")}</h3>
                    <p>{t("shell.workspaceDetailDebugRuntimeSectionDescription")}</p>
                  </div>
                </div>
                {state.runtimeHistory.length > 0 ? (
                  <div className="debug-readiness-runtime-list">
                    {state.runtimeHistory.map((runtime) => (
                      <article key={runtime.runtimeSession.id} className="debug-readiness-runtime-item">
                        <div className="debug-readiness-runtime-item-header">
                          <strong>{formatRuntimeHistoryTitle(runtime)}</strong>
                          <span>{formatRuntimeStatus(runtime.runtimeSession.status)}</span>
                        </div>
                        <p>{formatRuntimeHistorySummary(runtime)}</p>
                        <div className="debug-readiness-runtime-item-grid">
                          <span>{t("shell.workspaceDetailDebugRuntimeHistoryTimeLabel")} {formatDateTime(runtime.runtimeSession.startedAt ?? runtime.runtimeSession.createdAt)}</span>
                          <span>{t("shell.workspaceDetailDebugRuntimeHistoryServiceLabel")} {formatRuntimeHistoryServices(runtime)}</span>
                          <span>{t("shell.workspaceDetailDebugRuntimeServiceFailureLabel")} {formatFailureStage(runtime.runtimeSession.failureStage ?? null)}</span>
                          <span>{t("shell.workspaceDetailDebugRuntimeHistoryResultLabel")} {formatRuntimeHistoryResult(runtime)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="workbench-section-empty">{t("shell.workspaceDetailDebugRuntimeEmpty")}</p>
                )}
              </section>

              <section className="debug-readiness-section surface-card">
                <DebugSupportMatrixEntry
                  items={matrixItems}
                  layout="desktop"
                  open={matrixModalOpen}
                  onOpen={() => setMatrixModalOpen(true)}
                  onClose={() => setMatrixModalOpen(false)}
                />
              </section>
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}

type DebugSupportMatrixItem = DebugReadinessState["matrixItems"][number];
type DebugReadinessTone = "success" | "warn" | "danger" | "neutral";
type MatrixStatusIcon = "check" | "warn" | "cross" | "neutral";

interface DebugSupportMatrixEntryProps {
  items: DebugSupportMatrixItem[];
  layout: "mobile" | "desktop";
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function DebugSupportMatrixEntry({
  items,
  layout,
  open,
  onOpen,
  onClose
}: DebugSupportMatrixEntryProps) {
  const summary = buildSupportMatrixSummary(items);

  return (
    <>
      <div className={layout === "mobile" ? undefined : "debug-readiness-section-body"}>
        <div className={layout === "mobile" ? "mobile-feature-section-header" : "debug-readiness-section-header"}>
          <div>
            {layout === "mobile" ? <h2>{t("shell.workspaceDetailDebugMatrixTitle")}</h2> : null}
            {layout === "desktop" ? <h3>{t("shell.workspaceDetailDebugMatrixTitle")}</h3> : null}
            <p>{t("shell.workspaceDetailDebugMatrixSectionDescription")}</p>
          </div>
          <span className={layout === "mobile" ? "mobile-feature-counter" : "debug-readiness-matrix-counter"}>
            {items.length}
          </span>
        </div>

        <div className={`debug-readiness-matrix-entry${layout === "mobile" ? " debug-readiness-matrix-entry-mobile" : ""}`}>
          <div className="debug-readiness-matrix-summary-row">
            <span className="debug-readiness-matrix-summary-pill" data-tone="success">
              {t("shell.workspaceDetailDebugCompatibilitySupported")}
              <strong>{summary.supportedCount}</strong>
            </span>
            <span className="debug-readiness-matrix-summary-pill" data-tone="warn">
              {t("shell.workspaceDetailDebugCompatibilityConditional")}
              <strong>{summary.conditionalCount}</strong>
            </span>
            <span className="debug-readiness-matrix-summary-pill" data-tone="danger">
              {t("shell.workspaceDetailDebugCompatibilityUnsupported")}
              <strong>{summary.unsupportedCount}</strong>
            </span>
            <span className="debug-readiness-matrix-summary-pill" data-tone="neutral">
              {t("shell.workspaceDetailDebugCompatibilityUnknown")}
              <strong>{summary.unknownCount}</strong>
            </span>
          </div>
          <button type="button" className="secondary-button debug-readiness-matrix-open-button" onClick={onOpen}>
            {t("shell.workspaceDetailDebugMatrixOpenAction")}
          </button>
        </div>
      </div>

      <WorkbenchModal
        open={open}
        title={t("shell.workspaceDetailDebugMatrixTitle")}
        description={t("shell.workspaceDetailDebugMatrixModalDescription")}
        className={`debug-readiness-matrix-modal-card${layout === "mobile" ? " debug-readiness-matrix-modal-card-mobile" : ""}`}
        onClose={onClose}
      >
        <div className="debug-readiness-matrix-modal">
          <div className="debug-readiness-matrix-summary-row debug-readiness-matrix-summary-row-modal">
            <span className="debug-readiness-matrix-summary-pill" data-tone="success">
              {t("shell.workspaceDetailDebugCompatibilitySupported")}
              <strong>{summary.supportedCount}</strong>
            </span>
            <span className="debug-readiness-matrix-summary-pill" data-tone="warn">
              {t("shell.workspaceDetailDebugCompatibilityConditional")}
              <strong>{summary.conditionalCount}</strong>
            </span>
            <span className="debug-readiness-matrix-summary-pill" data-tone="danger">
              {t("shell.workspaceDetailDebugCompatibilityUnsupported")}
              <strong>{summary.unsupportedCount}</strong>
            </span>
            <span className="debug-readiness-matrix-summary-pill" data-tone="neutral">
              {t("shell.workspaceDetailDebugCompatibilityUnknown")}
              <strong>{summary.unknownCount}</strong>
            </span>
          </div>

          <div className="debug-readiness-matrix-table-wrap">
            <table className="debug-readiness-matrix-table">
              <thead>
                <tr>
                  <th scope="col">{t("shell.workspaceDetailDebugMatrixFrameworkHeader")}</th>
                  <th scope="col">{t("shell.workspaceDetailDebugMatrixCompatibilityHeader")}</th>
                  <th scope="col">{t("shell.workspaceDetailDebugMatrixInjectionHeader")}</th>
                  <th scope="col">{t("shell.workspaceDetailDebugMatrixDiscoveryHeader")}</th>
                  <th scope="col">{t("shell.workspaceDetailDebugMatrixHmrHeader")}</th>
                  <th scope="col">{t("shell.workspaceDetailDebugMatrixCallbackHeader")}</th>
                  <th scope="col">{t("shell.workspaceDetailDebugMatrixAiHeader")}</th>
                  <th scope="col">{t("shell.workspaceDetailDebugMatrixNotesHeader")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const tone = resolveCompatibilityTone(item.compatibilityLevel);

                  return (
                    <tr key={item.framework}>
                      <th scope="row" className="debug-readiness-matrix-framework-cell">
                        {item.framework}
                      </th>
                      <td>
                        <MatrixStatusPill
                          className="debug-readiness-matrix-badge"
                          tone={tone}
                          icon={resolveCompatibilityIcon(item.compatibilityLevel)}
                          label={formatCompatibilityLevelReadable(item.compatibilityLevel)}
                          title={formatCompatibilityLevel(item.compatibilityLevel)}
                        />
                      </td>
                      <td>
                        <span
                          className="debug-readiness-matrix-badge debug-readiness-matrix-badge-subtle"
                          data-tone="neutral"
                          title={formatInjectionMode(item.recommendedInjectionMode)}
                        >
                          {formatInjectionModeCompact(item.recommendedInjectionMode)}
                        </span>
                      </td>
                      <td>
                        <MatrixStatusPill
                          className="debug-readiness-matrix-flag"
                          tone={item.requiresServiceDiscoveryHandling ? "warn" : "success"}
                          icon={item.requiresServiceDiscoveryHandling ? "warn" : "check"}
                          label={formatRequirementFlagReadable(item.requiresServiceDiscoveryHandling)}
                          title={formatRequirementFlag(item.requiresServiceDiscoveryHandling)}
                        />
                      </td>
                      <td>
                        <MatrixStatusPill
                          className="debug-readiness-matrix-flag"
                          tone={item.requiresHmrHandling ? "warn" : "success"}
                          icon={item.requiresHmrHandling ? "warn" : "check"}
                          label={formatRequirementFlagReadable(item.requiresHmrHandling)}
                          title={formatRequirementFlag(item.requiresHmrHandling)}
                        />
                      </td>
                      <td>
                        <MatrixStatusPill
                          className="debug-readiness-matrix-flag"
                          tone={item.requiresCallbackHandling ? "warn" : "success"}
                          icon={item.requiresCallbackHandling ? "warn" : "check"}
                          label={formatRequirementFlagReadable(item.requiresCallbackHandling)}
                          title={formatRequirementFlag(item.requiresCallbackHandling)}
                        />
                      </td>
                      <td>
                        <MatrixStatusPill
                          className="debug-readiness-matrix-badge debug-readiness-matrix-badge-subtle"
                          tone={resolveAiFallbackTone(item.aiFallbackPolicy)}
                          icon={resolveAiFallbackIcon(item.aiFallbackPolicy)}
                          label={formatAiFallbackPolicyReadable(item.aiFallbackPolicy)}
                          title={formatAiFallbackPolicy(item.aiFallbackPolicy)}
                        />
                      </td>
                      <td className="debug-readiness-matrix-note-cell">{item.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="debug-readiness-matrix-legend">
            <p>{t("shell.workspaceDetailDebugMatrixLegendSummary")}</p>
            <div className="debug-readiness-matrix-legend-grid">
              <div>
                <strong>{t("shell.workspaceDetailDebugMatrixDiscoveryHeader")}</strong>
                <span>{t("shell.workspaceDetailDebugMatrixDiscoveryNote")}</span>
              </div>
              <div>
                <strong>{t("shell.workspaceDetailDebugMatrixHmrHeader")}</strong>
                <span>{t("shell.workspaceDetailDebugMatrixHmrNote")}</span>
              </div>
              <div>
                <strong>{t("shell.workspaceDetailDebugMatrixCallbackHeader")}</strong>
                <span>{t("shell.workspaceDetailDebugMatrixCallbackNote")}</span>
              </div>
              <div>
                <strong>{t("shell.workspaceDetailDebugMatrixAiHeader")}</strong>
                <span>{t("shell.workspaceDetailDebugMatrixAiNote")}</span>
              </div>
            </div>
          </div>
        </div>
      </WorkbenchModal>
    </>
  );
}

function MatrixStatusPill({
  tone,
  icon,
  label,
  title,
  className
}: {
  tone: DebugReadinessTone;
  icon: MatrixStatusIcon;
  label: string;
  title: string;
  className: string;
}) {
  return (
    <span className={className} data-tone={tone} title={title}>
      <MatrixStatusIconMark kind={icon} />
      <span>{label}</span>
    </span>
  );
}

function MatrixStatusIconMark({ kind }: { kind: MatrixStatusIcon }) {
  if (kind === "check") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.2 8.3L6.4 11.5L12.8 4.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
      </svg>
    );
  }

  if (kind === "cross") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.4 4.4L11.6 11.6M11.6 4.4L4.4 11.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
      </svg>
    );
  }

  if (kind === "warn") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2.2L14 13.4H2L8 2.2Z" fill="currentColor" opacity="0.18" />
        <path d="M8 5.3V8.8M8 11.3H8.01" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
        <path d="M8 2.2L14 13.4H2L8 2.2Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5.1V8.4M8 11H8.01" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

function formatDebugConfidence(confidence: FrameworkAnalysisResultDto["confidence"]) {
  switch (confidence) {
    case "high":
      return t("shell.workspaceDetailDebugConfidenceHigh");
    case "medium":
      return t("shell.workspaceDetailDebugConfidenceMedium");
    case "low":
      return t("shell.workspaceDetailDebugConfidenceLow");
    default:
      return confidence;
  }
}

type ServiceCategory = "frontend" | "backend" | "worker" | "mock" | "desktop_shell" | "custom";

interface DerivedServiceItem {
  service: DebugServiceSpecDto;
  analysis: FrameworkAnalysisResultDto | null;
  runtimeItem: DebugRuntimeDetailDto["services"][number] | null;
  category: ServiceCategory;
}

interface DebugOverallSummary {
  totalServices: number;
  webServiceCount: number;
  desktopShellCount: number;
  supportedCount: number;
  conditionalCount: number;
  unsupportedCount: number;
  unknownCount: number;
  autoInjectionEligible: boolean;
  overallTone: "success" | "warn" | "danger" | "neutral";
  categoryChips: Array<{
    key: string;
    label: string;
    tone: "success" | "warn" | "danger" | "neutral";
  }>;
}

function buildDerivedServices(state: DebugReadinessState): DerivedServiceItem[] {
  return state.services.map((service) => {
    const analysis = state.analyses.find((item) => item.serviceId === service.id) ?? null;
    const runtimeItem = state.runtime?.services.find((item) => item.service.id === service.id) ?? null;

    return {
      service,
      analysis,
      runtimeItem,
      category: resolveServiceCategory(service, analysis)
    };
  });
}

function buildOverallSummary(state: DebugReadinessState): DebugOverallSummary {
  const derivedServices = buildDerivedServices(state);
  const webServices = derivedServices.filter((item) => item.category !== "desktop_shell");
  const webAnalyses = webServices.map((item) => item.analysis).filter((item): item is FrameworkAnalysisResultDto => item !== null);
  const compatibilitySource = webAnalyses.length > 0 ? webAnalyses : state.analyses;
  const supportedCount = compatibilitySource.filter((item) => item.compatibilityLevel === "supported").length;
  const conditionalCount = compatibilitySource.filter((item) => item.compatibilityLevel === "conditional").length;
  const unsupportedCount = compatibilitySource.filter((item) => item.compatibilityLevel === "unsupported").length;
  const unknownCount = compatibilitySource.filter((item) => item.compatibilityLevel === "unknown").length;
  const desktopShellCount = derivedServices.filter((item) => item.category === "desktop_shell").length;
  const totalServices = derivedServices.length;
  const webServiceCount = webServices.length;
  const overallTone =
    unsupportedCount > 0
      ? "danger"
      : conditionalCount > 0
        ? "warn"
        : supportedCount > 0
          ? "success"
          : "neutral";
  const categoryChips = [
    webServiceCount > 0
      ? {
          key: "web",
          label: t("shell.workspaceDetailDebugSummaryWebServicesChip", { count: webServiceCount }),
          tone: webServiceCount === supportedCount && conditionalCount === 0 ? "success" : "warn"
        }
      : null,
    desktopShellCount > 0
      ? {
          key: "desktop-shell",
          label: t("shell.workspaceDetailDebugSummaryDesktopShellChip", { count: desktopShellCount }),
          tone: "neutral" as const
        }
      : null,
    unsupportedCount > 0
      ? {
          key: "unsupported",
          label: t("shell.workspaceDetailDebugSummaryUnsupportedChip", { count: unsupportedCount }),
          tone: "danger" as const
        }
      : null
  ].filter((item): item is DebugOverallSummary["categoryChips"][number] => item !== null);

  return {
    totalServices,
    webServiceCount,
    desktopShellCount,
    supportedCount,
    conditionalCount,
    unsupportedCount,
    unknownCount,
    autoInjectionEligible: state.autoInjectionEligible,
    overallTone,
    categoryChips
  };
}

function buildSupportMatrixSummary(items: DebugSupportMatrixItem[]) {
  return {
    supportedCount: items.filter((item) => item.compatibilityLevel === "supported").length,
    conditionalCount: items.filter((item) => item.compatibilityLevel === "conditional").length,
    unsupportedCount: items.filter((item) => item.compatibilityLevel === "unsupported").length,
    unknownCount: items.filter((item) => item.compatibilityLevel === "unknown").length
  };
}

function resolveServiceCategory(
  service: DebugServiceSpecDto,
  analysis: FrameworkAnalysisResultDto | null
): ServiceCategory {
  if (analysis?.primaryFramework === "tauri" || analysis?.primaryFramework === "electron") {
    return "desktop_shell";
  }

  switch (service.role) {
    case "frontend":
      return "frontend";
    case "backend":
      return "backend";
    case "worker":
      return "worker";
    case "mock":
      return "mock";
    default:
      return "custom";
  }
}

function resolveServiceCategoryTone(category: ServiceCategory): "success" | "warn" | "danger" | "neutral" {
  switch (category) {
    case "frontend":
      return "success";
    case "backend":
      return "warn";
    case "desktop_shell":
      return "neutral";
    case "worker":
    case "mock":
    case "custom":
    default:
      return "neutral";
  }
}

function formatOverallStatus(summary: DebugOverallSummary) {
  if (summary.unsupportedCount > 0) {
    return t("shell.workspaceDetailDebugOverallStatusBlocked");
  }

  if (summary.conditionalCount > 0) {
    return t("shell.workspaceDetailDebugOverallStatusConditional");
  }

  if (summary.supportedCount > 0) {
    return t("shell.workspaceDetailDebugOverallStatusSupported");
  }

  return t("shell.workspaceDetailDebugCompatibilityUnknown");
}

function formatOverallSummaryText(summary: DebugOverallSummary) {
  if (summary.totalServices === 0) {
    return t("shell.workspaceDetailDebugOverallSummaryEmpty");
  }

  if (summary.desktopShellCount > 0 && summary.webServiceCount > 0) {
    return t("shell.workspaceDetailDebugOverallSummaryMixed", {
      webCount: summary.webServiceCount,
      desktopCount: summary.desktopShellCount
    });
  }

  if (summary.desktopShellCount > 0 && summary.webServiceCount === 0) {
    return t("shell.workspaceDetailDebugOverallSummaryDesktopOnly", {
      count: summary.desktopShellCount
    });
  }

  return t("shell.workspaceDetailDebugOverallSummaryWebOnly", {
    count: summary.webServiceCount
  });
}

function formatCompatibilityBreakdown(summary: DebugOverallSummary) {
  return t("shell.workspaceDetailDebugCompatibilityBreakdown", {
    supported: summary.supportedCount,
    conditional: summary.conditionalCount,
    unsupported: summary.unsupportedCount
  });
}

function formatTargetSourceType(sourceType: DebugReadinessState["targetSourceType"]) {
  switch (sourceType) {
    case "repo":
      return t("shell.workspaceDetailDebugTargetSourceRepo");
    case "worktree":
      return t("shell.workspaceDetailDebugTargetSourceWorktree");
    default:
      return t("common.unknown");
  }
}

function resolveRuntimeStatus(item: DerivedServiceItem): DebugRuntimeDetailDto["runtimeSession"]["status"] | null {
  if (item.runtimeItem?.processInstance?.status === "running") {
    return "RUNNING";
  }

  if (item.runtimeItem?.processInstance?.status === "error") {
    return "FAILED";
  }

  return item.runtimeItem ? item.runtimeItem.binding?.status === "RELEASED" ? "STOPPED" : null : null;
}

function formatRequirementSummary(analysis: FrameworkAnalysisResultDto | null) {
  if (!analysis) {
    return t("shell.workspaceDetailDebugEmptyReasons");
  }

  const items = [
    analysis.requiresServiceDiscoveryHandling ? t("shell.workspaceDetailDebugFailureStageServiceDiscovery") : null,
    analysis.requiresHmrHandling ? t("shell.workspaceDetailDebugFailureStageHmr") : null,
    analysis.requiresCallbackHandling ? t("shell.workspaceDetailDebugFailureStageCallback") : null
  ].filter((item): item is string => item !== null);

  return items.length > 0 ? items.join(" / ") : t("shell.workspaceDetailDebugRequirementsNone");
}

function formatServiceOverview(item: DerivedServiceItem) {
  if (item.category === "desktop_shell") {
    return t("shell.workspaceDetailDebugServiceOverviewDesktopShell");
  }

  switch (item.analysis?.compatibilityLevel) {
    case "supported":
      return t("shell.workspaceDetailDebugServiceOverviewSupported");
    case "conditional":
      return t("shell.workspaceDetailDebugServiceOverviewConditional");
    case "unsupported":
      return t("shell.workspaceDetailDebugServiceOverviewUnsupported");
    default:
      return t("shell.workspaceDetailDebugServiceOverviewUnknown");
  }
}

function formatServiceAction(item: DerivedServiceItem) {
  if (item.category === "desktop_shell") {
    return t("shell.workspaceDetailDebugServiceActionDesktopShell");
  }

  switch (item.analysis?.compatibilityLevel) {
    case "supported":
      return t("shell.workspaceDetailDebugServiceActionSupported");
    case "conditional":
      return t("shell.workspaceDetailDebugServiceActionConditional");
    case "unsupported":
      return t("shell.workspaceDetailDebugServiceActionUnsupported");
    default:
      return t("shell.workspaceDetailDebugServiceActionUnknown");
  }
}

function formatRuntimeHistoryTitle(runtime: DebugRuntimeDetailDto) {
  return t("shell.workspaceDetailDebugRuntimeHistoryTitleWithIndex", {
    id: runtime.runtimeSession.id.slice(0, 8)
  });
}

function formatRuntimeHistorySummary(runtime: DebugRuntimeDetailDto) {
  const failedServices = runtime.services
    .filter((item) =>
      item.processInstance?.status === "error"
      || item.binding?.status === "FAILED"
    )
    .map((item) => item.service.name);

  if (failedServices.length > 0) {
    return t("shell.workspaceDetailDebugRuntimeHistoryFailedSummary", {
      services: failedServices.join("、")
    });
  }

  return t("shell.workspaceDetailDebugRuntimeHistoryGenericSummary");
}

function formatRuntimeHistoryServices(runtime: DebugRuntimeDetailDto) {
  if (runtime.services.length === 0) {
    return t("shell.workspaceDetailDebugRuntimeHistoryNoServices");
  }

  return runtime.services.map((item) => item.service.name).join("、");
}

function formatRuntimeHistoryResult(runtime: DebugRuntimeDetailDto) {
  const hasRunningService = runtime.services.some((item) => item.processInstance?.status === "running");

  if (runtime.runtimeSession.status === "RUNNING" || hasRunningService) {
    return t("shell.workspaceDetailDebugRuntimeHistoryResultRunning");
  }

  if (runtime.runtimeSession.status === "FAILED") {
    return t("shell.workspaceDetailDebugRuntimeHistoryResultFailed");
  }

  if (runtime.runtimeSession.status === "STOPPED") {
    return t("shell.workspaceDetailDebugRuntimeHistoryResultStopped");
  }

  return t("shell.workspaceDetailDebugRuntimeHistoryResultPreparing");
}

function formatDateTime(value: string | null) {
  if (!value) {
    return t("shell.workspaceDetailDebugFailureStageEmpty");
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatCompatibilityLevel(level: FrameworkAnalysisResultDto["compatibilityLevel"]) {
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

function formatCompatibilityLevelReadable(level: FrameworkAnalysisResultDto["compatibilityLevel"]) {
  switch (level) {
    case "supported":
      return t("shell.workspaceDetailDebugMatrixCompatibilitySupportedShort");
    case "conditional":
      return t("shell.workspaceDetailDebugMatrixCompatibilityConditionalShort");
    case "unsupported":
      return t("shell.workspaceDetailDebugMatrixCompatibilityUnsupportedShort");
    default:
      return t("shell.workspaceDetailDebugMatrixCompatibilityUnknownShort");
  }
}

function resolveCompatibilityIcon(level: FrameworkAnalysisResultDto["compatibilityLevel"]): MatrixStatusIcon {
  switch (level) {
    case "supported":
      return "check";
    case "conditional":
      return "warn";
    case "unsupported":
      return "cross";
    default:
      return "neutral";
  }
}

function resolveCompatibilityTone(level: FrameworkAnalysisResultDto["compatibilityLevel"]): DebugReadinessTone {
  switch (level) {
    case "supported":
      return "success";
    case "conditional":
      return "warn";
    case "unsupported":
      return "danger";
    default:
      return "neutral";
  }
}

function formatInjectionMode(mode: NonNullable<FrameworkAnalysisResultDto["recommendedInjectionMode"]> | "none") {
  switch (mode) {
    case "cli":
      return t("shell.workspaceDetailDebugInjectionCli");
    case "env":
      return t("shell.workspaceDetailDebugInjectionEnv");
    case "override":
      return t("shell.workspaceDetailDebugInjectionOverride");
    case "ai_fallback":
      return t("shell.workspaceDetailDebugInjectionAiFallback");
    default:
      return t("shell.workspaceDetailDebugInjectionNone");
  }
}

function formatInjectionModeCompact(mode: NonNullable<FrameworkAnalysisResultDto["recommendedInjectionMode"]> | "none") {
  switch (mode) {
    case "cli":
      return t("shell.workspaceDetailDebugMatrixInjectionCliShort");
    case "env":
      return t("shell.workspaceDetailDebugMatrixInjectionEnvShort");
    case "override":
      return t("shell.workspaceDetailDebugMatrixInjectionOverrideShort");
    case "ai_fallback":
      return t("shell.workspaceDetailDebugMatrixInjectionAiFallbackShort");
    default:
      return t("shell.workspaceDetailDebugMatrixInjectionNoneShort");
  }
}

function formatRuntimeStatus(status: DebugRuntimeDetailDto["runtimeSession"]["status"] | null) {
  switch (status) {
    case "PREPARING":
      return t("shell.workspaceDetailDebugRuntimePreparing");
    case "RUNNING":
      return t("shell.workspaceDetailDebugRuntimeRunning");
    case "FAILED":
      return t("shell.workspaceDetailDebugRuntimeFailed");
    case "STOPPED":
      return t("shell.workspaceDetailDebugRuntimeStopped");
    default:
      return t("shell.workspaceDetailDebugRuntimeNotStarted");
  }
}

function formatFailureStage(stage: string | null) {
  switch (stage) {
    case null:
    case "":
      return t("shell.workspaceDetailDebugFailureStageEmpty");
    case "service_discovery":
      return t("shell.workspaceDetailDebugFailureStageServiceDiscovery");
    case "hmr":
      return t("shell.workspaceDetailDebugFailureStageHmr");
    case "callback":
      return t("shell.workspaceDetailDebugFailureStageCallback");
    case "ai_fallback_required":
      return t("shell.workspaceDetailDebugFailureStageAiFallbackRequired");
    case "adapter_selection":
      return t("shell.workspaceDetailDebugFailureStageAdapterSelection");
    case "launch_requirements":
      return t("shell.workspaceDetailDebugFailureStageLaunchRequirements");
    case "command_execution":
      return t("shell.workspaceDetailDebugFailureStageCommandExecution");
    case "process_exit":
      return t("shell.workspaceDetailDebugFailureStageProcessExit");
    case "process_runtime_error":
      return t("shell.workspaceDetailDebugFailureStageProcessRuntimeError");
    case "stale_runtime_binding":
      return t("shell.workspaceDetailDebugFailureStageStaleRuntimeBinding");
    default:
      return t("shell.workspaceDetailDebugFailureStageUnknown", { code: stage });
  }
}

function formatRequirementFlag(required: boolean) {
  return required
    ? t("shell.workspaceDetailDebugRequirementRequired")
    : t("shell.workspaceDetailDebugRequirementNotRequired");
}

function formatRequirementFlagReadable(required: boolean) {
  return required
    ? t("shell.workspaceDetailDebugMatrixRequirementRequiredShort")
    : t("shell.workspaceDetailDebugMatrixRequirementNotRequiredShort");
}

function formatAiFallbackPolicy(policy: string) {
  switch (policy) {
    case "never":
      return t("shell.workspaceDetailDebugAiPolicyNever");
    case "conditional":
      return t("shell.workspaceDetailDebugAiPolicyConditional");
    default:
      return t("shell.workspaceDetailDebugAiPolicyAllowed");
  }
}

function formatAiFallbackPolicyReadable(policy: string) {
  switch (policy) {
    case "never":
      return t("shell.workspaceDetailDebugMatrixAiNeverShort");
    case "conditional":
      return t("shell.workspaceDetailDebugMatrixAiConditionalShort");
    default:
      return t("shell.workspaceDetailDebugMatrixAiAllowedShort");
  }
}

function resolveAiFallbackTone(policy: string): DebugReadinessTone {
  switch (policy) {
    case "never":
      return "danger";
    case "conditional":
      return "warn";
    default:
      return "success";
  }
}

function resolveAiFallbackIcon(policy: string): MatrixStatusIcon {
  switch (policy) {
    case "never":
      return "cross";
    case "conditional":
      return "warn";
    default:
      return "check";
  }
}

function formatDebugList(items: string[], emptyKey: string) {
  return items.length > 0 ? items.join(", ") : t(emptyKey);
}

function formatServiceRole(role: string) {
  return formatServiceCategory(
    role === "frontend" || role === "backend" || role === "worker" || role === "mock"
      ? role
      : "custom"
  );
}

function formatServiceCategory(category: ServiceCategory) {
  switch (category) {
    case "frontend":
      return t("shell.workspaceDetailDebugRoleFrontend");
    case "backend":
      return t("shell.workspaceDetailDebugRoleBackend");
    case "worker":
      return t("shell.workspaceDetailDebugRoleWorker");
    case "mock":
      return t("shell.workspaceDetailDebugRoleMock");
    case "desktop_shell":
      return t("shell.workspaceDetailDebugRoleDesktopShell");
    default:
      return t("shell.workspaceDetailDebugRoleCustom");
  }
}

function formatPortValue(port: number | null) {
  return port === null ? t("shell.workspaceDetailDebugPortEmpty") : String(port);
}

function formatBindingStatus(status: string | null) {
  switch (status) {
    case "ALLOCATED":
      return t("shell.workspaceDetailDebugBindingAllocated");
    case "LISTENING":
      return t("shell.workspaceDetailDebugBindingListening");
    case "FAILED":
      return t("shell.workspaceDetailDebugBindingFailed");
    case "RELEASED":
      return t("shell.workspaceDetailDebugBindingReleased");
    default:
      return t("shell.workspaceDetailDebugBindingUnknown");
  }
}

function formatProcessStatus(status: string | null) {
  switch (status) {
    case "creating":
      return t("shell.workspaceDetailDebugProcessCreating");
    case "running":
      return t("shell.workspaceDetailDebugProcessRunning");
    case "closed":
      return t("shell.workspaceDetailDebugProcessClosed");
    case "error":
      return t("shell.workspaceDetailDebugProcessError");
    default:
      return t("shell.workspaceDetailDebugProcessUnknown");
  }
}

function formatAiFallbackEditStatuses(statuses: string[]) {
  if (statuses.length === 0) {
    return t("shell.workspaceDetailDebugAiEditEmpty");
  }

  return statuses.map((status) => formatAiFallbackEditStatus(status)).join(", ");
}

function formatAiFallbackEditStatus(status: string) {
  switch (status) {
    case "PENDING":
      return t("shell.workspaceDetailDebugAiEditPending");
    case "APPLIED":
      return t("shell.workspaceDetailDebugAiEditApplied");
    case "ROLLED_BACK":
      return t("shell.workspaceDetailDebugAiEditRolledBack");
    case "REJECTED":
      return t("shell.workspaceDetailDebugAiEditRejected");
    default:
      return status;
  }
}

function formatServicePath(servicePath: string, rootPath: string) {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedServicePath = normalizePath(servicePath);

  if (normalizedServicePath === normalizedRoot) {
    return ".";
  }

  if (normalizedServicePath.startsWith(`${normalizedRoot}/`)) {
    return normalizedServicePath.slice(normalizedRoot.length + 1);
  }

  return normalizedServicePath;
}

function formatCommand(service: DebugServiceSpecDto) {
  return [service.command, ...service.args].filter(Boolean).join(" ");
}

function normalizePath(input: string) {
  return input.replace(/\\/g, "/").replace(/\/+$/g, "");
}
