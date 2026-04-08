import { useEffect, useMemo, useState } from "react";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  cancelButlerFollowUpTask,
  getButlerSessionTarget,
  createButlerFollowUpTask,
  listButlerFollowUpTasks,
  startButlerVerificationAction,
  type ButlerFollowUpTaskDto,
  type ButlerSessionTargetDto
} from "../../butler/api/butler-api";
import { useWorkbenchShell } from "./WorkbenchLayout";
import { WorkbenchModal } from "./WorkbenchModal";

import type { SessionSummaryDto } from "../api/conversation-api";

interface SessionButlerActionButtonProps {
  session: SessionSummaryDto | null;
}

type ButlerActionKind = "follow-up" | "verification" | null;
const DEFAULT_FOLLOW_UP_ROUND_LIMIT = 5;

export function SessionButlerActionButton({ session }: SessionButlerActionButtonProps) {
  const { showToast } = useToast();
  const { requestNavigationRefresh } = useWorkbenchShell();
  const [modalOpen, setModalOpen] = useState(false);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [target, setTarget] = useState<ButlerSessionTargetDto | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<ButlerActionKind>(null);
  const [followUpObjective, setFollowUpObjective] = useState("");
  const [followUpCompletionCriteria, setFollowUpCompletionCriteria] = useState("");
  const [followUpRoundLimit, setFollowUpRoundLimit] = useState(DEFAULT_FOLLOW_UP_ROUND_LIMIT);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [latestFollowUpTask, setLatestFollowUpTask] = useState<ButlerFollowUpTaskDto | null>(null);

  const currentTitle = useMemo(() => session?.title?.trim() || null, [session?.title]);

  useEffect(() => {
    if (!modalOpen || !session?.sessionId) {
      return;
    }

    let disposed = false;
    setLoadingTarget(true);
    setTargetError(null);

    void getButlerSessionTarget(session.sessionId)
      .then((response) => {
        if (disposed) {
          return;
        }

        setTarget(response.target);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

        setTarget(null);
        setTargetError(error instanceof Error ? error.message : t("conversation.butlerActionLoadFailed"));
      })
      .finally(() => {
        if (!disposed) {
          setLoadingTarget(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [modalOpen, session?.sessionId]);

  useEffect(() => {
    if ((!analysisOpen && !modalOpen) || !session?.sessionId) {
      return;
    }

    let disposed = false;
    setAnalysisLoading(true);
    setAnalysisError(null);

    void listButlerFollowUpTasks({ sessionId: session.sessionId })
      .then((response) => {
        if (disposed) {
          return;
        }

        setLatestFollowUpTask(response.items[0] ?? null);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

        setLatestFollowUpTask(null);
        setAnalysisError(error instanceof Error ? error.message : t("conversation.butlerAnalysisLoadFailed"));
      })
      .finally(() => {
        if (!disposed) {
          setAnalysisLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [analysisOpen, modalOpen, session?.sessionId]);

  if (!session?.sessionId) {
    return null;
  }

  async function handleFollowUp() {
    if (!target) {
      return;
    }

    const objective = followUpObjective.trim();

    if (!objective) {
      showToast({
        title: t("conversation.butlerFollowUpObjectiveRequired"),
        tone: "warning"
      });
      return;
    }

    setRunningAction("follow-up");

    try {
      await createButlerFollowUpTask({
        projectId: target.project.id,
        butlerSessionId: target.session.id,
        objective,
        completionCriteria: followUpCompletionCriteria.trim() || undefined,
        maxAutoContinueCount: followUpRoundLimit
      });
      requestNavigationRefresh();
      showToast({
        title: t("conversation.butlerFollowUpStarted"),
        description: t("conversation.butlerFollowUpStartedDescription", {
          projectName: target.project.name
        }),
        tone: "success"
      });
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
      await cancelButlerFollowUpTask(latestFollowUpTask.id);
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
      return;
    }

    setRunningAction("verification");

    try {
      await startButlerVerificationAction({
        projectId: target.project.id,
        butlerSessionId: target.session.id,
        verificationType: "browser",
        targetRef: currentTitle || target.session.title || target.project.name
      });
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

  return (
    <>
      <div
        className="conversation-butler-entry"
        onMouseEnter={() => {
          setAnalysisOpen(true);
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
          }}
          onBlur={() => {
            setAnalysisOpen(false);
          }}
          onClick={() => {
            setModalOpen(true);
          }}
        >
          <span className="conversation-header-ai-button-label">AI</span>
        </button>

        {analysisOpen ? (
          <div className="conversation-butler-analysis-popover" role="status" aria-live="polite">
            <strong>{t("conversation.butlerAnalysisTitle")}</strong>
            {analysisLoading ? (
              <p>{t("conversation.butlerActionLoading")}</p>
            ) : analysisError ? (
              <p>{analysisError}</p>
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

      <WorkbenchModal
        open={modalOpen}
        title={t("conversation.butlerActionModalTitle")}
        description={t("conversation.butlerActionModalDescription")}
        onClose={() => {
          if (runningAction) {
            return;
          }

          setModalOpen(false);
        }}
      >
        <div className="conversation-butler-modal">
          {loadingTarget ? (
            <p className="conversation-butler-modal-hint">{t("conversation.butlerActionLoading")}</p>
          ) : null}

          {!loadingTarget && targetError ? (
            <p className="conversation-butler-modal-error">{targetError}</p>
          ) : null}

          {!loadingTarget && !targetError && target ? (
            <>
              <div className="conversation-butler-target-card">
                <span>{t("conversation.butlerActionProjectLabel")}</span>
                <strong>{target.project.name}</strong>
              </div>
              <div className="conversation-butler-target-card">
                <span>{t("conversation.butlerActionSessionLabel")}</span>
                <strong>{target.session.title || currentTitle || target.session.sessionId}</strong>
              </div>

              <label className="workbench-modal-field">
                <span>{t("conversation.butlerFollowUpObjectiveLabel")}</span>
                <textarea
                  rows={4}
                  value={followUpObjective}
                  placeholder={t("conversation.butlerFollowUpObjectivePlaceholder")}
                  disabled={runningAction !== null}
                  onChange={(event) => {
                    setFollowUpObjective(event.target.value);
                  }}
                />
              </label>

              <label className="workbench-modal-field">
                <span>{t("conversation.butlerFollowUpCompletionCriteriaLabel")}</span>
                <textarea
                  rows={3}
                  value={followUpCompletionCriteria}
                  placeholder={t("conversation.butlerFollowUpCompletionCriteriaPlaceholder")}
                  disabled={runningAction !== null}
                  onChange={(event) => {
                    setFollowUpCompletionCriteria(event.target.value);
                  }}
                />
              </label>

              <label className="workbench-modal-field">
                <span>{t("conversation.butlerFollowUpRoundLimitLabel")}</span>
                <input
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
                <small>{t("conversation.butlerFollowUpRoundLimitHint")}</small>
              </label>

              {latestFollowUpTask && (latestFollowUpTask.status === "active" || latestFollowUpTask.status === "waiting_user") ? (
                <div className="conversation-butler-target-card">
                  <span>{t("conversation.butlerCurrentFollowUpLabel")}</span>
                  <strong>{renderButlerTaskStatus(latestFollowUpTask.status)}</strong>
                  <small>
                    {t("conversation.butlerCurrentFollowUpProgress", {
                      current: latestFollowUpTask.autoContinueCount,
                      max: latestFollowUpTask.maxAutoContinueCount ?? DEFAULT_FOLLOW_UP_ROUND_LIMIT
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

              <div className="conversation-butler-action-grid">
                <button
                  type="button"
                  className="conversation-butler-action-card"
                  disabled={runningAction !== null}
                  onClick={() => {
                    void handleFollowUp();
                  }}
                >
                  <strong>{t("conversation.butlerFollowUpAction")}</strong>
                  <span>{t("conversation.butlerFollowUpActionDescription")}</span>
                </button>
                <button
                  type="button"
                  className="conversation-butler-action-card"
                  disabled={runningAction !== null}
                  onClick={() => {
                    void handleVerification();
                  }}
                >
                  <strong>{t("conversation.butlerVerificationAction")}</strong>
                  <span>{t("conversation.butlerVerificationActionDescription")}</span>
                </button>
              </div>
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
