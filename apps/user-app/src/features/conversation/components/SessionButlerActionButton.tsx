import { useEffect, useId, useMemo, useState } from "react";

import { ModalActions } from "../../../components/ModalAtoms";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  cancelButlerVerificationRun,
  cancelButlerFollowUpTask,
  createButlerFollowUpTask,
  getButlerSessionActionContext,
  startButlerVerificationAction,
  type ButlerFollowUpTaskDto,
  type ButlerSessionActionContextDto,
  type ButlerSessionTargetDto
} from "../../butler/api/butler-api";
import { useWorkbenchShell } from "./WorkbenchLayout";
import { WorkbenchModal } from "./WorkbenchModal";
import { ButlerActionIcon } from "./ConversationActionIcons";
import { SessionProviderPicker } from "./SessionProviderPicker";

import type { ProviderId, SessionSummaryDto } from "../api/conversation-api";

interface SessionButlerActionButtonProps {
  session: SessionSummaryDto | null;
  showTrigger?: boolean;
  openRequestKey?: number;
}

type ButlerActionKind = "follow-up" | "verification" | null;
type FollowUpProviderId = "codex" | "claude-code";
const DEFAULT_FOLLOW_UP_ROUND_LIMIT = 5;
const FOLLOW_UP_PROVIDER_IDS: FollowUpProviderId[] = ["codex", "claude-code"];

interface ButlerCompletionCriteriaPreset {
  id: string;
  label: string;
  description: string;
  value: string;
}

function buildCompletionCriteriaPresets(): ButlerCompletionCriteriaPreset[] {
  return [
    {
      id: "recommended",
      label: t("conversation.butlerCompletionTemplateRecommendedLabel"),
      description: t("conversation.butlerCompletionTemplateRecommendedDescription"),
      value: t("conversation.butlerCompletionTemplateRecommendedValue")
    },
    {
      id: "spec-finish",
      label: t("conversation.butlerCompletionTemplateSpecLabel"),
      description: t("conversation.butlerCompletionTemplateSpecDescription"),
      value: t("conversation.butlerCompletionTemplateSpecValue")
    },
    {
      id: "bugfix",
      label: t("conversation.butlerCompletionTemplateBugfixLabel"),
      description: t("conversation.butlerCompletionTemplateBugfixDescription"),
      value: t("conversation.butlerCompletionTemplateBugfixValue")
    }
  ];
}

function getDefaultCompletionCriteria(): string {
  return buildCompletionCriteriaPresets()[0]?.value ?? "";
}

function resolveDefaultFollowUpProvider(
  sessionProvider: string | null | undefined
): FollowUpProviderId {
  return sessionProvider === "claude-code" ? "claude-code" : "codex";
}

function isFollowUpProviderId(provider: ProviderId): provider is FollowUpProviderId {
  return provider === "codex" || provider === "claude-code";
}

export function SessionButlerActionButton({
  session,
  showTrigger = true,
  openRequestKey = 0
}: SessionButlerActionButtonProps) {
  const { showToast } = useToast();
  const { requestNavigationRefresh } = useWorkbenchShell();
  const objectiveFieldId = useId();
  const completionCriteriaFieldId = useId();
  const completionCriteriaHintId = useId();
  const roundLimitFieldId = useId();
  const [modalOpen, setModalOpen] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [actionContext, setActionContext] = useState<ButlerSessionActionContextDto | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<ButlerActionKind>(null);
  const [followUpProviderId, setFollowUpProviderId] = useState<FollowUpProviderId>(
    resolveDefaultFollowUpProvider(session?.provider)
  );
  const [followUpObjective, setFollowUpObjective] = useState("");
  const [followUpCompletionCriteria, setFollowUpCompletionCriteria] = useState(() => getDefaultCompletionCriteria());
  const [followUpRoundLimit, setFollowUpRoundLimit] = useState(DEFAULT_FOLLOW_UP_ROUND_LIMIT);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [contextRequestSeq, setContextRequestSeq] = useState(0);
  const completionCriteriaPresets = buildCompletionCriteriaPresets();

  const currentTitle = useMemo(() => session?.title?.trim() || null, [session?.title]);
  const target = useMemo<ButlerSessionTargetDto | null>(() => {
    if (!actionContext) {
      return null;
    }

    return {
      workspaceId: actionContext.workspaceId,
      project: actionContext.project,
      session: actionContext.session
    };
  }, [actionContext]);
  const latestFollowUpTask = actionContext?.latestFollowUpTask ?? null;
  const latestVerificationRun = actionContext?.latestVerificationRun ?? null;
  const activeFollowUpTask = latestFollowUpTask
    && (latestFollowUpTask.status === "active" || latestFollowUpTask.status === "waiting_user")
    ? latestFollowUpTask
    : null;
  const activeVerificationRun = latestVerificationRun
    && (latestVerificationRun.status === "queued" || latestVerificationRun.status === "running")
    ? latestVerificationRun
    : null;

  useEffect(() => {
    setModalOpen(false);
    setAnalysisOpen(false);
    setContextError(null);
    setActionContext(null);
    setFollowUpObjective("");
    setFollowUpProviderId(resolveDefaultFollowUpProvider(session?.provider));
    setFollowUpCompletionCriteria(getDefaultCompletionCriteria());
    setFollowUpRoundLimit(DEFAULT_FOLLOW_UP_ROUND_LIMIT);
  }, [session?.sessionId]);

  useEffect(() => {
    if (!session?.sessionId) {
      setContextLoading(false);
      return;
    }

    let disposed = false;
    setContextLoading(true);
    setContextError(null);

    void getButlerSessionActionContext(session.sessionId)
      .then((response) => {
        if (disposed) {
          return;
        }

        setActionContext(response.context);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

        setActionContext(null);
        setContextError(error instanceof Error ? error.message : t("conversation.butlerActionLoadFailed"));
      })
      .finally(() => {
        if (!disposed) {
          setContextLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [contextRequestSeq, session?.sessionId]);

  if (!session?.sessionId) {
    return null;
  }

  function requestContextReload() {
    if (contextLoading) {
      return;
    }

    setContextRequestSeq((current) => current + 1);
  }

  function ensureActionContext() {
    if (!actionContext && !contextLoading) {
      requestContextReload();
    }
  }

  useEffect(() => {
    if (showTrigger || openRequestKey <= 0) {
      return;
    }

    setModalOpen(true);
    ensureActionContext();
  }, [contextLoading, openRequestKey, showTrigger, actionContext]);

  async function handleFollowUp() {
    if (!target) {
      ensureActionContext();
      return;
    }

    const objective = followUpObjective.trim();
    const completionCriteria = followUpCompletionCriteria.trim();

    if (!objective) {
      showToast({
        title: t("conversation.butlerFollowUpObjectiveRequired"),
        tone: "warning"
      });
      return;
    }

    if (!completionCriteria) {
      showToast({
        title: t("conversation.butlerFollowUpCompletionCriteriaRequired"),
        tone: "warning"
      });
      return;
    }

    setRunningAction("follow-up");

    try {
      const response = await createButlerFollowUpTask({
        projectId: target.project.id,
        butlerSessionId: target.session.id,
        providerId: followUpProviderId,
        objective,
        completionCriteria,
        maxAutoContinueCount: followUpRoundLimit
      });
      setActionContext((current) => (
        current
          ? {
              ...current,
              latestFollowUpTask: response.task
            }
          : current
      ));
      requestNavigationRefresh();
      showToast({
        title: t("conversation.butlerFollowUpStarted"),
        description: t("conversation.butlerFollowUpStartedDescription", {
          projectName: target.project.name
        }),
        tone: "success"
      });
      setFollowUpObjective("");
      setFollowUpCompletionCriteria(getDefaultCompletionCriteria());
      setFollowUpRoundLimit(DEFAULT_FOLLOW_UP_ROUND_LIMIT);
      setModalOpen(false);
    } catch (error) {
      showToast({
        title: t("conversation.butlerFollowUpFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setRunningAction(null);
    }
  }

  async function handleCancelFollowUp() {
    if (!latestFollowUpTask) {
      return;
    }

    setRunningAction("follow-up");

    try {
      const response = await cancelButlerFollowUpTask(latestFollowUpTask.id);
      setActionContext((current) => (
        current
          ? {
              ...current,
              latestFollowUpTask: response.task
            }
          : current
      ));
      requestNavigationRefresh();
      showToast({
        title: t("conversation.butlerFollowUpStopped"),
        description: t("conversation.butlerFollowUpStoppedDescription"),
        tone: "success"
      });
      setModalOpen(false);
    } catch (error) {
      showToast({
        title: t("conversation.butlerFollowUpStopFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setRunningAction(null);
    }
  }

  async function handleVerification() {
    if (!target) {
      ensureActionContext();
      return;
    }

    setRunningAction("verification");

    try {
      const response = await startButlerVerificationAction({
        projectId: target.project.id,
        butlerSessionId: target.session.id,
        verificationType: "browser",
        targetRef: currentTitle || target.session.title || target.project.name
      });
      setActionContext((current) => (
        current
          ? {
              ...current,
              latestVerificationRun: response.result.run
            }
          : current
      ));
      requestNavigationRefresh();
      showToast({
        title: t("conversation.butlerVerificationStarted"),
        description: t("conversation.butlerVerificationStartedDescription", {
          projectName: target.project.name
        }),
        tone: "success"
      });
      setModalOpen(false);
    } catch (error) {
      showToast({
        title: t("conversation.butlerVerificationFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setRunningAction(null);
    }
  }

  async function handleCancelVerification() {
    if (!latestVerificationRun) {
      return;
    }

    setRunningAction("verification");

    try {
      const response = await cancelButlerVerificationRun(
        latestVerificationRun.projectId,
        latestVerificationRun.id
      );
      setActionContext((current) => (
        current
          ? {
              ...current,
              latestVerificationRun: response.run
            }
          : current
      ));
      requestNavigationRefresh();
      showToast({
        title: t("conversation.butlerVerificationStopped"),
        description: t("conversation.butlerVerificationStoppedDescription"),
        tone: "success"
      });
      setModalOpen(false);
    } catch (error) {
      showToast({
        title: t("conversation.butlerVerificationStopFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setRunningAction(null);
    }
  }

  return (
    <>
      {showTrigger ? (
        <div
          className="conversation-butler-entry"
          onMouseEnter={() => {
            setAnalysisOpen(true);
            ensureActionContext();
          }}
          onMouseLeave={() => {
            setAnalysisOpen(false);
          }}
        >
          <button
            type="button"
            className="conversation-header-ai-button"
            aria-label={t("conversation.butlerActionButton")}
            title={t("conversation.butlerActionButton")}
            onFocus={() => {
              setAnalysisOpen(true);
              ensureActionContext();
            }}
            onBlur={() => {
              setAnalysisOpen(false);
            }}
            onClick={() => {
              setModalOpen(true);
              ensureActionContext();
            }}
          >
            <span className="conversation-header-ai-button-label" aria-hidden="true">
              <ButlerActionIcon />
            </span>
          </button>

          {analysisOpen ? (
            <div className="conversation-butler-analysis-popover" role="status" aria-live="polite">
              <strong>{t("conversation.butlerAnalysisTitle")}</strong>
              {contextLoading ? (
                <p>{t("conversation.butlerActionLoading")}</p>
              ) : contextError ? (
                <p>{contextError}</p>
              ) : latestFollowUpTask ? (
                <>
                  <p>
                    {t("conversation.butlerAnalysisObjectiveLabel")}：{latestFollowUpTask.objective}
                  </p>
                  <p>
                    {t("conversation.butlerAnalysisStatusLabel")}：
                    {renderButlerTaskStatus(latestFollowUpTask.status)}
                  </p>
                  <p>
                    {t("conversation.butlerAnalysisSummaryLabel")}：
                    {latestFollowUpTask.lastAutomationSummary
                      || latestFollowUpTask.waitingReason
                      || t("conversation.butlerAnalysisEmpty")}
                  </p>
                  {latestFollowUpTask.waitingReason ? (
                    <p>
                      {t("conversation.butlerAnalysisWaitingReasonLabel")}：
                      {latestFollowUpTask.waitingReason}
                    </p>
                  ) : null}
                </>
              ) : (
                <p>{t("conversation.butlerAnalysisEmpty")}</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <WorkbenchModal
        open={modalOpen}
        title={t("conversation.butlerActionModalTitle")}
        description={t("conversation.butlerActionModalDescription")}
        className="conversation-butler-modal-card"
        footer={!contextLoading && !contextError && target ? (
          <ModalActions>
            <button
              type="button"
              className="secondary-button"
              disabled={runningAction !== null}
              onClick={() => {
                void handleVerification();
              }}
            >
              {t("conversation.butlerVerificationAction")}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={runningAction !== null}
              onClick={() => {
                void handleFollowUp();
              }}
            >
              {t("conversation.butlerFollowUpAction")}
            </button>
          </ModalActions>
        ) : undefined}
        onClose={() => {
          if (runningAction) {
            return;
          }

          setModalOpen(false);
        }}
      >
        <div className="conversation-butler-modal">
          {contextLoading ? (
            <p className="conversation-butler-modal-hint">{t("conversation.butlerActionLoading")}</p>
          ) : null}

          {!contextLoading && contextError ? (
            <p className="conversation-butler-modal-error">{contextError}</p>
          ) : null}

          {!contextLoading && !contextError && target ? (
            <>
              <div className="conversation-butler-target-grid">
                <div className="conversation-butler-target-card">
                  <span>{t("conversation.butlerActionProjectLabel")}</span>
                  <strong>{target.project.name}</strong>
                </div>
                <div className="conversation-butler-target-card">
                  <span>{t("conversation.butlerActionSessionLabel")}</span>
                  <strong>{target.session.title || currentTitle || target.session.sessionId}</strong>
                </div>
              </div>

              <div className="conversation-butler-follow-up-grid">
                <div className="workbench-modal-field conversation-butler-modal-field">
                  <div className="conversation-butler-field-heading">
                    <label>{t("conversation.butlerFollowUpProviderLabel")}</label>
                    <small>{t("conversation.butlerFollowUpProviderHint")}</small>
                  </div>
                  <SessionProviderPicker
                    workspaceId={target.workspaceId}
                    providers={FOLLOW_UP_PROVIDER_IDS}
                    selectedProvider={followUpProviderId}
                    disabled={runningAction !== null}
                    onSelect={(provider) => {
                      if (isFollowUpProviderId(provider)) {
                        setFollowUpProviderId(provider);
                      }
                    }}
                  />
                </div>

                <div className="workbench-modal-field conversation-butler-modal-field conversation-butler-round-limit-field">
                  <div className="conversation-butler-field-heading">
                    <label htmlFor={roundLimitFieldId}>{t("conversation.butlerFollowUpRoundLimitLabel")}</label>
                    <small>{t("conversation.butlerFollowUpRoundLimitHint")}</small>
                  </div>
                  <input
                    id={roundLimitFieldId}
                    type="number"
                    min={1}
                    max={20}
                    value={followUpRoundLimit}
                    disabled={runningAction !== null}
                    onChange={(event) => {
                      const nextValue = Number.parseInt(event.target.value, 10);
                      setFollowUpRoundLimit(Number.isFinite(nextValue) ? nextValue : DEFAULT_FOLLOW_UP_ROUND_LIMIT);
                    }}
                  />
                </div>
              </div>

              <div className="workbench-modal-field conversation-butler-modal-field">
                <label htmlFor={objectiveFieldId}>{t("conversation.butlerFollowUpObjectiveLabel")}</label>
                <textarea
                  id={objectiveFieldId}
                  rows={3}
                  value={followUpObjective}
                  placeholder={t("conversation.butlerFollowUpObjectivePlaceholder")}
                  disabled={runningAction !== null}
                  onChange={(event) => {
                    setFollowUpObjective(event.target.value);
                  }}
                />
              </div>

              <div className="workbench-modal-field conversation-butler-modal-field">
                <div className="conversation-butler-field-heading">
                  <label htmlFor={completionCriteriaFieldId}>
                    {t("conversation.butlerFollowUpCompletionCriteriaLabel")}
                  </label>
                  <small id={completionCriteriaHintId}>
                    {t("conversation.butlerCompletionTemplateSectionHint")}
                  </small>
                </div>
                <textarea
                  id={completionCriteriaFieldId}
                  rows={3}
                  value={followUpCompletionCriteria}
                  placeholder={t("conversation.butlerFollowUpCompletionCriteriaPlaceholder")}
                  aria-describedby={completionCriteriaHintId}
                  disabled={runningAction !== null}
                  onChange={(event) => {
                    setFollowUpCompletionCriteria(event.target.value);
                  }}
                />
                <div
                  className="conversation-butler-preset-grid"
                  role="group"
                  aria-label={t("conversation.butlerCompletionTemplateSectionLabel")}
                >
                  {completionCriteriaPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="conversation-butler-preset-card"
                      data-selected={followUpCompletionCriteria.trim() === preset.value}
                      aria-pressed={followUpCompletionCriteria.trim() === preset.value}
                      disabled={runningAction !== null}
                      onClick={() => {
                        setFollowUpCompletionCriteria(preset.value);
                      }}
                    >
                      <strong>{preset.label}</strong>
                      <span>{preset.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {activeFollowUpTask || activeVerificationRun ? (
                <div className="conversation-butler-meta-grid">
                  {activeFollowUpTask ? (
                    <div className="conversation-butler-target-card conversation-butler-current-task-card">
                      <span>{t("conversation.butlerCurrentFollowUpLabel")}</span>
                      <strong>{renderButlerTaskStatus(activeFollowUpTask.status)}</strong>
                      <small>
                        {t("conversation.butlerCurrentFollowUpProgress", {
                          current: activeFollowUpTask.autoContinueCount,
                          max: activeFollowUpTask.maxAutoContinueCount ?? DEFAULT_FOLLOW_UP_ROUND_LIMIT
                        })}
                      </small>
                      <button
                        type="button"
                        className="workbench-secondary-button"
                        disabled={runningAction !== null}
                        onClick={() => {
                          void handleCancelFollowUp();
                        }}
                      >
                        {t("conversation.butlerStopFollowUpAction")}
                      </button>
                    </div>
                  ) : null}

                  {activeVerificationRun ? (
                    <div className="conversation-butler-target-card conversation-butler-current-task-card">
                      <span>{t("conversation.butlerCurrentVerificationLabel")}</span>
                      <strong>{renderButlerVerificationStatus(activeVerificationRun.status)}</strong>
                      <small>
                        {activeVerificationRun.targetRef || activeVerificationRun.verificationType}
                      </small>
                      <button
                        type="button"
                        className="workbench-secondary-button"
                        disabled={runningAction !== null}
                        onClick={() => {
                          void handleCancelVerification();
                        }}
                      >
                        {t("conversation.butlerStopVerificationAction")}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

            </>
          ) : null}
        </div>
      </WorkbenchModal>
    </>
  );
}

function renderButlerTaskStatus(status: ButlerFollowUpTaskDto["status"]): string {
  switch (status) {
    case "waiting_user":
      return t("shell.butlerAutomationStatusWaitingUser");
    case "completed":
      return t("shell.butlerAutomationStatusCompleted");
    case "failed":
      return t("shell.butlerAutomationStatusFailed");
    case "cancelled":
      return t("shell.butlerAutomationStatusCancelled");
    case "active":
    default:
      return t("shell.butlerAutomationStatusActive");
  }
}

function renderButlerVerificationStatus(status: "queued" | "running" | "passed" | "failed" | "skipped" | "cancelled"): string {
  switch (status) {
    case "queued":
    case "running":
      return t("shell.butlerAutomationStatusActive");
    case "passed":
    case "skipped":
      return t("shell.butlerAutomationStatusCompleted");
    case "failed":
      return t("shell.butlerAutomationStatusFailed");
    case "cancelled":
    default:
      return t("shell.butlerAutomationStatusCancelled");
  }
}
