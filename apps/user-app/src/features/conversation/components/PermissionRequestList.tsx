import { useMemo, useState } from "react";

import { t } from "../../../shared/i18n";
import type { SessionPermissionRequestDto } from "../api/conversation-api";
import { getProviderDisplayName, getProviderIcon } from "../capability/provider-ui";

interface PermissionRequestListProps {
  requests: SessionPermissionRequestDto[];
  replyingRequestId: string | null;
  onReply: (requestId: string, payload: { action: string; answers?: Record<string, string[]> }) => Promise<void> | void;
}

export function PermissionRequestList({
  requests,
  replyingRequestId,
  onReply
}: PermissionRequestListProps) {
  const [answersByRequestId, setAnswersByRequestId] = useState<Record<string, Record<string, string[]>>>({});
  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === "pending"),
    [requests]
  );

  if (pendingRequests.length === 0) {
    return null;
  }

  return (
    <section className="permission-request-list">
      <div className="permission-request-list-header">
        <div>
          <strong>{t("conversation.permissionRequestSectionTitle")}</strong>
        </div>
        <span className="permission-request-count">{pendingRequests.length}</span>
      </div>

      <div className="permission-request-stack">
        {pendingRequests.map((request) => {
          const answers = answersByRequestId[request.id] ?? {};
          const primaryPaths = request.paths.filter(Boolean);
          const shouldShowCommand = request.kind === "command" && Boolean(request.command?.trim());
          const shouldShowSummary =
            request.questions.length === 0 &&
            primaryPaths.length === 0 &&
            !shouldShowCommand &&
            Boolean(request.summary?.trim());
          const disableSubmit =
            request.kind === "user_input" &&
            request.questions.some(
              (question) => (answers[question.id]?.filter(Boolean).length ?? 0) === 0
            );

          return (
            <article key={request.id} className="permission-request-card">
              <header className="permission-request-card-header">
                <div className="permission-request-provider">
                  <span className="permission-request-provider-icon" aria-hidden="true">
                    <img src={getProviderIcon(request.provider)} alt="" loading="lazy" />
                  </span>
                  <div className="permission-request-provider-copy">
                    <strong>{request.title}</strong>
                    <span>{getProviderDisplayName(request.provider, "full")}</span>
                  </div>
                </div>
                <span className="permission-request-kind">{getRequestKindLabel(request.kind)}</span>
              </header>

              <div className="permission-request-card-body">
                {primaryPaths.length > 0 ? (
                  <div className="permission-request-block">
                    <ul className="permission-request-target-list">
                      {primaryPaths.map((path) => (
                        <li key={`${request.id}:${path}`} className="permission-request-target-item">
                          <strong>{getPathName(path)}</strong>
                          <span>{path}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {shouldShowCommand ? (
                  <div className="permission-request-block">
                    <div className="permission-request-block-label">
                      {t("conversation.permissionRequestCommandLabel")}
                    </div>
                    <pre>{request.command}</pre>
                  </div>
                ) : null}
                {shouldShowSummary ? (
                  <p className="permission-request-summary">{request.summary}</p>
                ) : null}
                {request.questions.length > 0 ? (
                  <div className="permission-request-block">
                    <div className="permission-request-block-label">
                      {t("conversation.permissionRequestQuestionsLabel")}
                    </div>
                    <div className="permission-request-question-list">
                      {request.questions.map((question) => (
                        <div key={question.id} className="permission-request-question">
                          <div className="permission-request-question-header">{question.header}</div>
                          <p>{question.question}</p>
                          <div className="permission-request-question-options">
                            {question.options.map((option) => {
                              const checked = answers[question.id]?.includes(option.label) ?? false;

                              return (
                                <label key={`${question.id}:${option.label}`} className="permission-request-question-option">
                                  <input
                                    type="radio"
                                    name={`${request.id}:${question.id}`}
                                    checked={checked}
                                    onChange={() => {
                                      setAnswersByRequestId((current) => ({
                                        ...current,
                                        [request.id]: {
                                          ...(current[request.id] ?? {}),
                                          [question.id]: [option.label]
                                        }
                                      }));
                                    }}
                                  />
                                  <span>
                                    <strong>{option.label}</strong>
                                    {option.description ? <small>{option.description}</small> : null}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <footer className="permission-request-card-footer">
                {request.actions.map((action) => (
                  <button
                    key={`${request.id}:${action.value}`}
                    type="button"
                    className={`permission-request-action permission-request-action-${action.tone}`}
                    disabled={
                      replyingRequestId === request.id || (action.value === "submit" && disableSubmit)
                    }
                    onClick={() =>
                      void onReply(request.id, {
                        action: action.value,
                        answers: Object.keys(answers).length > 0 ? answers : undefined
                      })
                    }
                  >
                    {replyingRequestId === request.id
                      ? t("conversation.permissionRequestSubmitting")
                      : action.label}
                  </button>
                ))}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function getRequestKindLabel(kind: SessionPermissionRequestDto["kind"]) {
  if (kind === "command") {
    return t("conversation.permissionRequestKindCommand");
  }

  if (kind === "file_change") {
    return t("conversation.permissionRequestKindFileChange");
  }

  if (kind === "permissions") {
    return t("conversation.permissionRequestKindPermissions");
  }

  if (kind === "user_input") {
    return t("conversation.permissionRequestKindUserInput");
  }

  return t("conversation.permissionRequestKindToolCall");
}

function getPathName(path: string) {
  const segments = path.split(/[/\\]+/).filter(Boolean);
  return segments.at(-1) ?? path;
}
