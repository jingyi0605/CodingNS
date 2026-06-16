import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { DebugAnalysisView } from "../components/DebugAnalysisView";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { createDebugLaunchPlan } from "../../conversation/api/conversation-api";
import { runTerminalTemplate } from "../../terminal/api/terminal-api";
import { getTerminalRuntimeLabel } from "../../terminal/runtime/terminal-runtime-meta";
import { buildWorkspaceDetailPath, buildWorkspaceToolProcessesPath } from "../../workbench/utils/workbench-navigation";
import { buildScopedWorkspaceRef, normalizeTargetHostId } from "../../workbench/utils/resource-scope";
import { useDebugAnalysis } from "../hooks/useDebugAnalysis";
import { useRegisteredDebugTemplates } from "../hooks/useRegisteredDebugTemplates";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  buildRegisteredLaunchPlan,
  buildTemplateCommandPreview,
  formatLaunchDecision,
  formatRegisteredDateTime,
  formatRegisteredOverallStatus,
  formatRegisteredOverallSummary,
  formatRegisteredPort,
  formatRuntimeProcessSummary,
  formatRuntimeReason,
  formatTemplatePath,
  formatTemplateRuntimeStatus,
  resolveRegisteredOverallTone,
  resolveTemplateRuntimeTone,
  type RegisteredLaunchPlan
} from "../registered-debug-model";

type RegisteredDebugPendingAction = "sync" | "plan" | "run" | "refresh" | null;

export function WorkspaceDebugDetailPage() {
  const { workspaceId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { navigationGroups, selectWorkspace, currentWorkspaceRef } = useWorkbenchShell();
  const targetHostId = normalizeTargetHostId(searchParams.get("targetHostId"));
  const requestWorkspaceId =
    targetHostId && currentWorkspaceRef?.hostId === targetHostId
      ? currentWorkspaceRef.workspaceId?.trim() || workspaceId
      : workspaceId;
  const workspace =
    navigationGroups.find((group) => group.workspace.id === workspaceId)?.workspace
    ?? null;
  const [pendingAction, setPendingAction] = useState<RegisteredDebugPendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastLaunchPlan, setLastLaunchPlan] = useState<RegisteredLaunchPlan | null>(null);
  const launchPlanSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    selectWorkspace(workspaceId, buildScopedWorkspaceRef(workspaceId, targetHostId));
  }, [selectWorkspace, targetHostId, workspaceId]);

  const workspaceTarget = useMemo(
    () => (
      workspace
        ? {
            id: requestWorkspaceId,
            path: workspace.path,
            name: workspace.name,
            targetHostId
          }
        : null
    ),
    [requestWorkspaceId, targetHostId, workspace]
  );
  const registeredState = useRegisteredDebugTemplates(workspaceTarget);
  const debugAnalysisState = useDebugAnalysis(workspaceTarget);
  const currentLaunchPlan = useMemo(
    () => lastLaunchPlan ?? buildRegisteredLaunchPlan(registeredState.templates, registeredState.runtimeStatuses),
    [lastLaunchPlan, registeredState.runtimeStatuses, registeredState.templates]
  );
  const launchPlanNeedsServiceDiscovery = useMemo(
    () => lastLaunchPlan?.items.some((item) => item.planItem?.missingRequirements.includes("service_discovery")) ?? false,
    [lastLaunchPlan]
  );
  const runtimeStatusByTemplateId = useMemo(
    () => new Map(registeredState.runtimeStatuses.map((item) => [item.templateId, item] as const)),
    [registeredState.runtimeStatuses]
  );

  useEffect(() => {
    if (!lastLaunchPlan || !launchPlanSectionRef.current) {
      return;
    }

    if (typeof launchPlanSectionRef.current.scrollIntoView !== "function") {
      return;
    }

    launchPlanSectionRef.current.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, [lastLaunchPlan]);

  if (!workspace) {
    return (
      <main className="workbench-page conversation-page-shell debug-readiness-page-shell">
        <div className="workbench-empty-guide surface-card">
          <h1>{t("shell.workspaceDetailMissingTitle")}</h1>
          <p>{t("shell.workspaceDetailMissingBody")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="workbench-page conversation-page-shell debug-readiness-page-shell">
      <div className="debug-readiness-page">
        <section className="debug-readiness-hero surface-card">
          <div className="debug-readiness-hero-header">
            <div className="debug-readiness-hero-copy">
              <h2>{t("shell.workspaceDetailDebugPageTitle")}</h2>
              <p>{t("shell.workspaceDetailRegisteredDebugPageDescription")}</p>
            </div>
          </div>

          <div className="debug-readiness-hero-toolbar">
            <div className="workbench-modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate(buildWorkspaceDetailPath(workspace.id, buildScopedWorkspaceRef(workspace.id, targetHostId)))}
              >
                {t("shell.goBack")}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={pendingAction !== null}
                onClick={() => {
                  void handleSyncTemplates();
                }}
              >
                {pendingAction === "sync"
                  ? t("shell.workspaceDetailRegisteredDebugActionSyncingTemplates")
                  : t("shell.workspaceDetailRegisteredDebugActionSyncTemplates")}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={pendingAction !== null}
                onClick={() => {
                  void handleInspectLaunchPlan();
                }}
              >
                {pendingAction === "plan"
                  ? t("shell.workspaceDetailDebugActionPlanning")
                  : t("shell.workspaceDetailDebugActionPlan")}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={pendingAction !== null}
                onClick={() => {
                  void handleRunRegisteredTemplates();
                }}
              >
                {pendingAction === "run"
                  ? t("shell.workspaceDetailRegisteredDebugActionRunningRegistered")
                  : t("shell.workspaceDetailRegisteredDebugActionRunRegistered")}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={pendingAction !== null}
                onClick={() => {
                  void handleRefreshRuntime();
                }}
              >
                {pendingAction === "refresh"
                  ? t("shell.workspaceDetailDebugActionRefreshing")
                  : t("shell.workspaceDetailDebugActionRefresh")}
              </button>
            </div>
            {actionError ? (
              <p className="workbench-manage-status status-text" data-tone="error">
                {actionError}
              </p>
            ) : null}
          </div>

          <div className="debug-readiness-summary-grid debug-readiness-summary-grid-hero">
            <article
              className="debug-readiness-summary-card"
              data-tone={resolveRegisteredOverallTone(currentLaunchPlan, registeredState.templates.length)}
            >
              <span>{t("shell.workspaceDetailDebugOverallStatusLabel")}</span>
              <strong>{formatRegisteredOverallStatus(currentLaunchPlan, registeredState.templates.length)}</strong>
              <small>{formatRegisteredOverallSummary(currentLaunchPlan, registeredState.templates.length)}</small>
            </article>
            <article className="debug-readiness-summary-card">
              <span>{t("shell.workspaceDetailRegisteredDebugSummaryRegisteredCountLabel")}</span>
              <strong>{registeredState.templates.length}</strong>
            </article>
            <article className="debug-readiness-summary-card">
              <span>{t("shell.workspaceDetailRegisteredDebugSummaryConfiguredPortLabel")}</span>
              <strong>{registeredState.templates.filter((item) => item.port !== null).length}</strong>
              <small>{t("shell.workspaceDetailRegisteredDebugRuntimeScopeNote")}</small>
            </article>
            <article className="debug-readiness-summary-card">
              <span>{t("shell.workspaceDetailRegisteredDebugSummaryRunnableCountLabel")}</span>
              <strong>{currentLaunchPlan.runnableCount}</strong>
            </article>
            <article className="debug-readiness-summary-card">
              <span>{t("shell.workspaceDetailRegisteredDebugSummaryOrchestratedCountLabel")}</span>
              <strong>{currentLaunchPlan.orchestratedCount}</strong>
            </article>
            <article className="debug-readiness-summary-card">
              <span>{t("shell.workspaceDetailRegisteredDebugSummaryBlockedCountLabel")}</span>
              <strong>{currentLaunchPlan.blockedCount}</strong>
            </article>
            <article className="debug-readiness-summary-card">
              <span>{t("shell.workspaceDetailRegisteredDebugSummaryLastRefreshLabel")}</span>
              <strong>{formatRegisteredDateTime(registeredState.lastRefreshedAt)}</strong>
              <small>{workspace.path}</small>
            </article>
          </div>
        </section>

        <DebugAnalysisView
          workspace={workspaceTarget}
          state={debugAnalysisState}
          variant="page"
        />

        {lastLaunchPlan ? (
          <section ref={launchPlanSectionRef} className="debug-readiness-section surface-card">
            <div className="debug-readiness-section-header">
              <div>
                <h3>{t("shell.workspaceDetailDebugLaunchPlanTitle")}</h3>
                <p>{t("shell.workspaceDetailRegisteredDebugLaunchPlanDescription")}</p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setLastLaunchPlan(null)}
              >
                {t("shell.workspaceDetailDebugLaunchPlanDismissAction")}
              </button>
            </div>

            <div className="workbench-manage-kv-list">
              <div className="workbench-manage-kv-item">
                <span>{t("shell.workspaceDetailRegisteredDebugLaunchPlanGeneratedAtLabel")}</span>
                <span>{formatRegisteredDateTime(lastLaunchPlan.generatedAt)}</span>
              </div>
              <div className="workbench-manage-kv-item">
                <span>{t("shell.workspaceDetailDebugLaunchPlanAutoStartLabel")}</span>
                <span>
                  {lastLaunchPlan.autoStartAllowed
                    ? t("shell.workspaceDetailDebugLaunchPlanAutoStartAllowed")
                    : t("shell.workspaceDetailDebugLaunchPlanAutoStartBlocked")}
                </span>
              </div>
              <div className="workbench-manage-kv-item">
                <span>{t("shell.workspaceDetailRegisteredDebugLaunchPlanRunnableLabel")}</span>
                <span>{lastLaunchPlan.runnableCount}</span>
              </div>
              <div className="workbench-manage-kv-item">
                <span>{t("shell.workspaceDetailRegisteredDebugLaunchPlanOrchestratedLabel")}</span>
                <span>{lastLaunchPlan.orchestratedCount}</span>
              </div>
              <div className="workbench-manage-kv-item">
                <span>{t("shell.workspaceDetailRegisteredDebugLaunchPlanBlockedLabel")}</span>
                <span>{lastLaunchPlan.blockedCount}</span>
              </div>
            </div>

            <p className="workbench-manage-hint">
              {t("shell.workspaceDetailRegisteredDebugLaunchPlanNote")}
            </p>
            {launchPlanNeedsServiceDiscovery ? (
              <p className="workbench-manage-hint">
                {t("shell.workspaceDetailRegisteredDebugLaunchPlanServiceDiscoveryHelp")}
              </p>
            ) : null}

            {lastLaunchPlan.items.length > 0 ? (
              <div className="debug-readiness-runtime-list">
                {lastLaunchPlan.items.map((item) => (
                  <article key={item.template.id} className="debug-readiness-runtime-item">
                    <div className="debug-readiness-runtime-item-header">
                      <strong>{item.template.name}</strong>
                      <span>{buildTemplateCommandPreview(item.template)}</span>
                    </div>
                    <div className="debug-readiness-runtime-item-grid">
                      <div>
                        <span>{t("shell.workspaceDetailRegisteredDebugTemplatePathLabel")}</span>
                        <strong title={item.template.cwd}>
                          {formatTemplatePath(item.template.cwd, workspace.path)}
                        </strong>
                      </div>
                      <div>
                        <span>{t("shell.workspaceDetailRegisteredDebugTemplatePortLabel")}</span>
                        <strong>{formatRegisteredPort(item.assignedPort)}</strong>
                      </div>
                      <div>
                        <span>{t("shell.workspaceDetailRegisteredDebugPlanItemRuntimeLabel")}</span>
                        <strong>{getTerminalRuntimeLabel(item.template.runtimeType)}</strong>
                      </div>
                      <div>
                        <span>{t("shell.workspaceDetailRegisteredDebugPlanItemActionLabel")}</span>
                        <strong>{formatLaunchDecision(item.decision)}</strong>
                      </div>
                    </div>
                    <p className="workbench-manage-hint">
                      {t("shell.workspaceDetailRegisteredDebugPlanItemReasonLabel")}
                      {": "}
                      {item.reason}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="workbench-section-empty">
                {t("shell.workspaceDetailRegisteredDebugTemplatesEmpty")}
              </p>
            )}
          </section>
        ) : null}

        <section className="debug-readiness-section surface-card">
          <div className="debug-readiness-section-header">
            <div>
              <h3>{t("shell.workspaceDetailRegisteredDebugTemplatesTitle")}</h3>
              <p>{t("shell.workspaceDetailRegisteredDebugTemplatesDescription")}</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate(buildWorkspaceToolProcessesPath(workspace.id, buildScopedWorkspaceRef(workspace.id, targetHostId)))}
            >
              {t("shell.workspaceDetailRegisteredDebugOpenProcessManagerAction")}
            </button>
          </div>

          {registeredState.loading && registeredState.templates.length === 0 ? (
            <p className="workbench-section-empty">{t("common.loading")}</p>
          ) : null}
          {registeredState.error && registeredState.templates.length === 0 ? (
            <p className="workbench-manage-status status-text" data-tone="error">
              {registeredState.error}
            </p>
          ) : null}
          {!registeredState.loading && registeredState.templates.length === 0 ? (
            <p className="workbench-section-empty">
              {t("shell.workspaceDetailRegisteredDebugTemplatesEmpty")}
            </p>
          ) : null}
          {registeredState.templates.length > 0 ? (
            <div className="debug-readiness-service-grid">
              {registeredState.templates.map((template) => {
                const runtimeStatus = runtimeStatusByTemplateId.get(template.id) ?? null;
                const runtimeTone = resolveTemplateRuntimeTone(template, runtimeStatus);
                return (
                  <article key={template.id} className="debug-readiness-service-card">
                    <div className="debug-readiness-service-card-header">
                      <div>
                        <strong>{template.name}</strong>
                        <p title={template.cwd}>{formatTemplatePath(template.cwd, workspace.path)}</p>
                      </div>
                      <span className="debug-readiness-chip" data-tone={runtimeTone}>
                        {formatTemplateRuntimeStatus(template, runtimeStatus)}
                      </span>
                    </div>
                    <div className="debug-readiness-service-card-grid">
                      <div>
                        <span>{t("shell.workspaceDetailRegisteredDebugTemplatePathLabel")}</span>
                        <strong title={template.cwd}>{formatTemplatePath(template.cwd, workspace.path)}</strong>
                      </div>
                      <div>
                        <span>{t("shell.workspaceDetailRegisteredDebugTemplatePortLabel")}</span>
                        <strong>{formatRegisteredPort(template.port)}</strong>
                      </div>
                      <div>
                        <span>{t("shell.workspaceDetailRegisteredDebugTemplateRuntimeTypeLabel")}</span>
                        <strong>{getTerminalRuntimeLabel(template.runtimeType)}</strong>
                      </div>
                      <div>
                        <span>{t("shell.workspaceDetailRegisteredDebugRuntimeProcessLabel")}</span>
                        <strong>{formatRuntimeProcessSummary(runtimeStatus)}</strong>
                      </div>
                    </div>
                    <div className="debug-readiness-service-card-list">
                      <p>
                        <span>{t("shell.workspaceDetailRegisteredDebugPlanItemCommandLabel")}</span>
                        <strong>{buildTemplateCommandPreview(template)}</strong>
                      </p>
                      <p>
                        <span>{t("shell.workspaceDetailRegisteredDebugPlanItemReasonLabel")}</span>
                        <strong>{formatRuntimeReason(template, runtimeStatus)}</strong>
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );

  async function handleSyncTemplates() {
    setPendingAction("sync");
    setActionError(null);

    try {
      await registeredState.refreshAll();
      setLastLaunchPlan(null);
      showToast({
        title: t("shell.workspaceDetailRegisteredDebugActionSyncTemplatesSuccess"),
        tone: "success"
      });
    } catch (error) {
      const message = normalizeActionError(error, t("shell.workspaceDetailRegisteredDebugActionSyncTemplatesFailed"));
      setActionError(message);
      showToast({
        title: message,
        tone: "error"
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleInspectLaunchPlan() {
    setPendingAction("plan");
    setActionError(null);

    try {
      if (!debugAnalysisState.targetId) {
        throw new Error(t("shell.workspaceDetailDebugActionTargetMissing"));
      }

      const preview = await createDebugLaunchPlan(debugAnalysisState.targetId, undefined, { targetHostId });
      const plan = buildRegisteredLaunchPlan(
        registeredState.templates,
        registeredState.runtimeStatuses,
        preview
      );
      setLastLaunchPlan(plan);
      showToast({
        title: t("shell.workspaceDetailDebugActionPlanSuccess"),
        tone: "info"
      });
    } catch (error) {
      const message = normalizeActionError(error, t("shell.workspaceDetailDebugActionPlanFailed"));
      setActionError(message);
      showToast({
        title: message,
        tone: "error"
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRunRegisteredTemplates() {
    setPendingAction("run");
    setActionError(null);

    try {
      const plan = lastLaunchPlan ?? (
        debugAnalysisState.targetId
          ? buildRegisteredLaunchPlan(
              registeredState.templates,
              registeredState.runtimeStatuses,
              await createDebugLaunchPlan(debugAnalysisState.targetId, undefined, { targetHostId })
            )
          : buildRegisteredLaunchPlan(registeredState.templates, registeredState.runtimeStatuses)
      );
      setLastLaunchPlan(plan);
      const runnableItems = plan.items.filter((item) => item.decision !== "blocked");

      if (runnableItems.length === 0) {
        const message = t("shell.workspaceDetailRegisteredDebugActionRunRegisteredSkipped");
        setActionError(message);
        showToast({
          title: message,
          tone: "info"
        });
        return;
      }

      const failures: string[] = [];

      for (const item of runnableItems) {
        try {
          await runTerminalTemplate(item.template.id, {
            runtimeType: item.template.runtimeType ?? undefined,
            argsOverride: item.planItem?.args,
            envPatch: item.planItem?.envPatch,
            portOverride: item.assignedPort
          }, { targetHostId });
        } catch (error) {
          failures.push(`${item.template.name}: ${normalizeActionError(error, t("shell.workspaceDetailRegisteredDebugActionRunRegisteredFailed"))}`);
        }
      }

      await registeredState.refreshRuntime();

      if (failures.length > 0) {
        throw new Error(failures.join("；"));
      }

      showToast({
        title: t("shell.workspaceDetailRegisteredDebugActionRunRegisteredSuccess"),
        tone: "success"
      });
    } catch (error) {
      const message = normalizeActionError(error, t("shell.workspaceDetailRegisteredDebugActionRunRegisteredFailed"));
      setActionError(message);
      showToast({
        title: message,
        tone: "error"
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRefreshRuntime() {
    setPendingAction("refresh");
    setActionError(null);

    try {
      await registeredState.refreshRuntime();
      showToast({
        title: t("shell.workspaceDetailDebugActionRefreshSuccess"),
        tone: "success"
      });
    } catch (error) {
      const message = normalizeActionError(error, t("shell.workspaceDetailRegisteredDebugActionRefreshFailed"));
      setActionError(message);
      showToast({
        title: message,
        tone: "error"
      });
    } finally {
      setPendingAction(null);
    }
  }
}

function normalizeActionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
