import { useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { t } from "../../../shared/i18n";
import type { SessionPermissionRequestDto } from "../api/conversation-api";
import { getProviderDisplayName, getProviderIcon } from "../capability/provider-ui";
import { MarkdownText } from "./MessageMarkdown";

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
  const [otherAnswersByRequestId, setOtherAnswersByRequestId] = useState<Record<string, Record<string, string>>>({});
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
        <strong>{t("conversation.permissionRequestSectionTitle")}</strong>
        <span className="permission-request-count">{pendingRequests.length}</span>
      </div>

      <div className="permission-request-stack">
        {pendingRequests.map((request) => {
          return (
            <PermissionRequestCard
              key={request.id}
              request={request}
              replyingRequestId={replyingRequestId}
              answersByRequestId={answersByRequestId}
              otherAnswersByRequestId={otherAnswersByRequestId}
              setAnswersByRequestId={setAnswersByRequestId}
              setOtherAnswersByRequestId={setOtherAnswersByRequestId}
              onReply={onReply}
            />
          );
        })}
      </div>
    </section>
  );
}

interface PermissionRequestCardProps {
  request: SessionPermissionRequestDto;
  replyingRequestId: string | null;
  answersByRequestId: Record<string, Record<string, string[]>>;
  otherAnswersByRequestId: Record<string, Record<string, string>>;
  setAnswersByRequestId: Dispatch<SetStateAction<Record<string, Record<string, string[]>>>>;
  setOtherAnswersByRequestId: Dispatch<SetStateAction<Record<string, Record<string, string>>>>;
  onReply: (requestId: string, payload: { action: string; answers?: Record<string, string[]> }) => Promise<void> | void;
  className?: string;
}

export function PermissionRequestCard({
  request,
  replyingRequestId,
  answersByRequestId,
  otherAnswersByRequestId,
  setAnswersByRequestId,
  setOtherAnswersByRequestId,
  onReply,
  className
}: PermissionRequestCardProps) {
  const answers = answersByRequestId[request.id] ?? {};
  const otherAnswers = otherAnswersByRequestId[request.id] ?? {};
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
      (question) =>
        (answers[question.id]?.filter(Boolean).length ?? 0) === 0 &&
        !otherAnswers[question.id]?.trim()
    );

  return (
    <article className={className ? `permission-request-card ${className}` : "permission-request-card"}>
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
          request.kind === "plan_approval" ? (
            <div className="permission-request-plan-summary-scroll">
              <MarkdownText
                content={request.summary}
                className="permission-request-summary markdown-content"
                paragraphClassName="permission-request-summary-paragraph"
              />
            </div>
          ) : (
            <p className="permission-request-summary">{request.summary}</p>
          )
        ) : null}
        {request.questions.length > 0 ? (
          <div className={`permission-request-block${request.questions.length > 1 ? " permission-request-scrollable-questions" : ""}`}>
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
                      const inputType = question.multiSelect ? "checkbox" : "radio";
                      const shouldUseSingleColumn =
                        option.label.length > 18 || (option.description?.length ?? 0) > 34;

                      return (
                        <label
                          key={`${question.id}:${option.label}`}
                          className={`permission-request-question-option${shouldUseSingleColumn ? " single-column" : ""}`}
                        >
                          <input
                            type={inputType}
                            name={`${request.id}:${question.id}`}
                            checked={checked}
                            onChange={() => {
                              setOtherAnswersByRequestId((current) => ({
                                ...current,
                                [request.id]: {
                                  ...(current[request.id] ?? {}),
                                  [question.id]: ""
                                }
                              }));
                              setAnswersByRequestId((current) => ({
                                ...current,
                                [request.id]: {
                                  ...(current[request.id] ?? {}),
                                  [question.id]: question.multiSelect
                                    ? toggleAnswerValue(current[request.id]?.[question.id] ?? [], option.label)
                                    : [option.label]
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
                    {question.allowOther ? (
                      <label className="permission-request-question-option permission-request-question-option-other single-column">
                        <input
                          type="radio"
                          name={`${request.id}:${question.id}`}
                          checked={Boolean(otherAnswers[question.id]?.trim())}
                          onChange={() => {
                            setAnswersByRequestId((current) => ({
                              ...current,
                              [request.id]: {
                                ...(current[request.id] ?? {}),
                                [question.id]: []
                              }
                            }));
                          }}
                        />
                        <span>
                          <strong>{t("conversation.permissionRequestQuestionOtherLabel")}</strong>
                          <input
                            className="permission-request-question-other-input"
                            type={question.secret ? "password" : "text"}
                            value={otherAnswers[question.id] ?? ""}
                            placeholder={t("conversation.permissionRequestQuestionOtherPlaceholder")}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setOtherAnswersByRequestId((current) => ({
                                ...current,
                                [request.id]: {
                                  ...(current[request.id] ?? {}),
                                  [question.id]: value
                                }
                              }));
                              setAnswersByRequestId((current) => ({
                                ...current,
                                [request.id]: {
                                  ...(current[request.id] ?? {}),
                                  [question.id]: []
                                }
                              }));
                            }}
                          />
                        </span>
                      </label>
                    ) : null}
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
            className={resolvePermissionActionClassName(action.tone)}
            disabled={
              replyingRequestId === request.id || (action.value === "submit" && disableSubmit)
            }
            onClick={() => {
              const mergedAnswers = mergeQuestionAnswers(answers, otherAnswers);
              void onReply(request.id, {
                action: action.value,
                answers: Object.keys(mergedAnswers).length > 0 ? mergedAnswers : undefined
              });
            }}
          >
            {replyingRequestId === request.id
              ? t("conversation.permissionRequestSubmitting")
              : action.label}
          </button>
        ))}
      </footer>
    </article>
  );
}

function toggleAnswerValue(values: string[], nextValue: string): string[] {
  if (values.includes(nextValue)) {
    return values.filter((value) => value !== nextValue);
  }

  return [...values, nextValue];
}

function mergeQuestionAnswers(
  selectedAnswers: Record<string, string[]>,
  otherAnswers: Record<string, string>
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};

  for (const [questionId, values] of Object.entries(selectedAnswers)) {
    const normalizedValues = values.filter(Boolean);

    if (normalizedValues.length > 0) {
      merged[questionId] = normalizedValues;
    }
  }

  for (const [questionId, value] of Object.entries(otherAnswers)) {
    const normalized = value.trim();

    if (normalized) {
      merged[questionId] = [normalized];
    }
  }

  return merged;
}

function resolvePermissionActionClassName(tone: SessionPermissionRequestDto["actions"][number]["tone"]) {
  if (tone === "danger") {
    return "workbench-danger-button permission-request-action";
  }

  if (tone === "primary") {
    return "primary-button permission-request-action";
  }

  return "secondary-button permission-request-action";
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

  if (kind === "plan_approval") {
    return t("conversation.permissionRequestKindPlanApproval");
  }

  return t("conversation.permissionRequestKindToolCall");
}

function getPathName(path: string) {
  const segments = path.split(/[/\\]+/).filter(Boolean);
  return segments.at(-1) ?? path;
}
