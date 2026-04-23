import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";

import { DesktopModal } from "../../../components/DesktopModal";
import { ModalActions, ModalField, ModalSection } from "../../../components/ModalAtoms";
import { t } from "../../../shared/i18n";
import {
  createParallelGroupFromSession,
  createParallelGroupFromWorkspace,
  listProviderCapabilities,
  type ParallelSessionMemberFailureDto,
  type BuiltinProviderId,
  type ParallelSessionGroupDetailDto,
  type ProviderCapabilitiesDto,
  type ProviderId
} from "../api/conversation-api";
import {
  createDraftCapabilities,
  getProviderDisplayName,
  SESSION_PROVIDER_PICKER_IDS
} from "../capability/provider-ui";

interface ParallelSessionCreateMemberDraft {
  provider: ProviderId;
  model: string;
  memberPrompt: string;
  workspaceIsolationMode: "none" | "temporary_worktree";
}

export type ParallelSessionCreateSource =
  | {
      kind: "workspace";
      workspaceId: string;
      workspaceName: string;
      defaultProvider?: ProviderId | null;
    }
  | {
      kind: "session";
      sessionId: string;
      workspaceId: string;
      workspaceName: string;
      sessionTitle: string;
      defaultProvider?: ProviderId | null;
    };

interface ParallelSessionCreateModalProps {
  readonly open: boolean;
  readonly source: ParallelSessionCreateSource | null;
  readonly onClose: () => void;
  readonly onCreated: (detail: ParallelSessionGroupDetailDto) => void | Promise<void>;
}

function createMemberDraft(defaultProvider: ProviderId): ParallelSessionCreateMemberDraft {
  return {
    provider: defaultProvider,
    model: "",
    memberPrompt: "",
    workspaceIsolationMode: "none"
  };
}

function resolveModelOptions(
  capabilities: ProviderCapabilitiesDto | null | undefined,
  provider: ProviderId
) {
  if (capabilities?.modelOptions?.length) {
    return capabilities.modelOptions;
  }

  return createDraftCapabilities(provider).modelOptions ?? [];
}

export function ParallelSessionCreateModal({
  open,
  source,
  onClose,
  onCreated
}: ParallelSessionCreateModalProps) {
  const modalFieldIdPrefix = useId();
  const defaultProvider = source?.defaultProvider ?? "codex";
  const [sharedPrompt, setSharedPrompt] = useState("");
  const [memberCount, setMemberCount] = useState(2);
  const [members, setMembers] = useState<ParallelSessionCreateMemberDraft[]>(() => [
    createMemberDraft(defaultProvider),
    createMemberDraft(defaultProvider)
  ]);
  const [providerCapabilitiesByProvider, setProviderCapabilitiesByProvider] = useState<
    Partial<Record<ProviderId, ProviderCapabilitiesDto>>
  >({});
  const [loadingProviderCapabilities, setLoadingProviderCapabilities] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [partialDetail, setPartialDetail] = useState<ParallelSessionGroupDetailDto | null>(null);
  const [memberErrorsByOrdinal, setMemberErrorsByOrdinal] = useState<
    Record<number, ParallelSessionMemberFailureDto>
  >({});

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextDefaultProvider = source?.defaultProvider ?? "codex";
    setSharedPrompt("");
    setMemberCount(2);
    setMembers([
      createMemberDraft(nextDefaultProvider),
      createMemberDraft(nextDefaultProvider)
    ]);
    setProviderCapabilitiesByProvider({});
    setLoadingProviderCapabilities(false);
    setSubmitting(false);
    setSubmitError(null);
    setPartialDetail(null);
    setMemberErrorsByOrdinal({});
  }, [
    open,
    source?.defaultProvider,
    source?.kind,
    source?.workspaceId,
    source?.kind === "session" ? source.sessionId : null
  ]);

  useEffect(() => {
    setMembers((current) => {
      if (current.length === memberCount) {
        return current;
      }

      if (current.length > memberCount) {
        return current.slice(0, memberCount);
      }

      const nextMembers = current.slice();
      const fallbackProvider = current[0]?.provider ?? defaultProvider;

      while (nextMembers.length < memberCount) {
        nextMembers.push(createMemberDraft(fallbackProvider));
      }

      return nextMembers;
    });
  }, [defaultProvider, memberCount]);

  useEffect(() => {
    if (!open || !source) {
      return;
    }

    let cancelled = false;
    setLoadingProviderCapabilities(true);

    void listProviderCapabilities(SESSION_PROVIDER_PICKER_IDS, source.workspaceId)
      .then((capabilities) => {
        if (cancelled) {
          return;
        }

        setProviderCapabilitiesByProvider(capabilities);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setLoadingProviderCapabilities(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, source?.workspaceId]);

  const availableProviderIds = useMemo(
    () =>
      SESSION_PROVIDER_PICKER_IDS.filter((providerId) => {
        const capabilities = providerCapabilitiesByProvider[providerId];
        if (!capabilities) {
          return false;
        }

        return capabilities.canStartSession !== false;
      }),
    [providerCapabilitiesByProvider]
  );

  useEffect(() => {
    if (!availableProviderIds.length) {
      return;
    }

    const defaultAvailableProvider = availableProviderIds.includes(defaultProvider as BuiltinProviderId)
      ? defaultProvider
      : availableProviderIds[0];

    setMembers((current) => {
      let changed = false;
      const nextMembers = current.map((member) => {
        if (availableProviderIds.includes(member.provider as BuiltinProviderId)) {
          return member;
        }

        changed = true;
        return {
          ...member,
          provider: defaultAvailableProvider,
          model: ""
        };
      });

      return changed ? nextMembers : current;
    });
  }, [availableProviderIds, defaultProvider]);

  const memberConfigs = useMemo(
    () =>
      members.map((member, index) => {
        const capabilities = providerCapabilitiesByProvider[member.provider] ?? null;
        const modelOptions = resolveModelOptions(capabilities, member.provider);

        return {
          index,
          draft: member,
          modelOptions
        };
      }),
    [members, providerCapabilitiesByProvider]
  );

  if (!open || !source) {
    return null;
  }

  const successfulOrdinals = new Set(
    (partialDetail?.members ?? []).map((item) => item.member.ordinal)
  );
  const description =
    source.kind === "session"
      ? `${source.workspaceName} · ${source.sessionTitle}`
      : `${source.workspaceName} · ${t("shell.parallelCreateModalDescription")}`;
  const activeSource = source;
  const footerStatusMessage =
    submitError
    ?? (!loadingProviderCapabilities && availableProviderIds.length === 0
      ? t("shell.parallelCreateNoAvailableProviders")
      : null);

  function clearFeedbackForMember(ordinal: number) {
    setSubmitError(null);
    setPartialDetail(null);
    setMemberErrorsByOrdinal((current) => {
      if (!(ordinal in current)) {
        return current;
      }

      const next = { ...current };
      delete next[ordinal];
      return next;
    });
  }

  function clearAllFeedback() {
    setSubmitError(null);
    setPartialDetail(null);
    setMemberErrorsByOrdinal({});
  }

  async function handleSubmit() {
    const normalizedSharedPrompt = sharedPrompt.trim();

    if (!normalizedSharedPrompt) {
      setSubmitError(t("shell.parallelCreatePromptRequired"));
      return;
    }

    if (!availableProviderIds.length) {
      setSubmitError(t("shell.parallelCreateNoAvailableProviders"));
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setPartialDetail(null);
    setMemberErrorsByOrdinal({});

    try {
      const payload = {
        sharedPrompt: normalizedSharedPrompt,
        members: members.map((member) => ({
          provider: member.provider,
          model: member.model.trim() || null,
          memberPrompt: member.memberPrompt.trim() || null,
          workspaceIsolationMode: member.workspaceIsolationMode
        }))
      };
      const detail =
        activeSource.kind === "session"
          ? await createParallelGroupFromSession(activeSource.sessionId, payload)
          : await createParallelGroupFromWorkspace(activeSource.workspaceId, payload);

      if (detail.memberFailures.length > 0) {
        setPartialDetail(detail);
        setMemberErrorsByOrdinal(
          Object.fromEntries(detail.memberFailures.map((item) => [item.ordinal, item]))
        );
        setSubmitError(
          detail.members.length > 0
            ? t("shell.parallelCreatePartialFailure", {
                successCount: detail.members.length,
                failureCount: detail.memberFailures.length
              })
            : t("shell.parallelCreateAllFailed", {
                failureCount: detail.memberFailures.length
              })
        );
        return;
      }

      await onCreated(detail);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("shell.parallelGroupLoadFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const memberGridStyle = {
    "--parallel-member-columns": String(Math.max(2, Math.min(memberCount, 4)))
  } as CSSProperties;

  return (
    <DesktopModal
      open={open}
      title={t("shell.parallelCreateModalTitle")}
      description={description}
      size="xwide"
      layout="form"
      className="parallel-create-modal"
      bodyClassName="parallel-create-modal-body"
      dismissible={!submitting}
      onClose={onClose}
      footer={(
        <ModalActions align="between" className="parallel-create-modal-footer">
          <div className="parallel-create-modal-status" role="status" aria-live="polite">
            {footerStatusMessage ? (
              <span className="parallel-create-modal-error">{footerStatusMessage}</span>
            ) : null}
          </div>
          <div className="parallel-create-modal-footer-actions">
            {partialDetail?.members.length ? (
              <button
                type="button"
                className="secondary-button"
                disabled={submitting}
                onClick={() => {
                  void onCreated(partialDetail);
                }}
              >
                {t("shell.parallelCreateContinuePartial")}
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              disabled={submitting}
              onClick={onClose}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={submitting || loadingProviderCapabilities || availableProviderIds.length === 0}
              onClick={() => {
                void handleSubmit();
              }}
            >
              {submitting ? t("shell.parallelCreateSubmitting") : t("shell.parallelCreateSubmit")}
            </button>
          </div>
        </ModalActions>
      )}
    >
      <div className="parallel-create-layout">
        <ModalSection
          className="parallel-create-shared-section"
          tone="accent"
        >
          <div className="parallel-create-target-row">
            <ModalField
              className="parallel-create-target-field"
              label={t("shell.parallelCreateSharedPromptLabel")}
              description={t("shell.parallelCreateSharedPromptPlaceholder")}
              htmlFor={`${modalFieldIdPrefix}-shared-prompt`}
            >
              <textarea
                id={`${modalFieldIdPrefix}-shared-prompt`}
                className="parallel-create-textarea parallel-create-textarea-target"
                rows={3}
                value={sharedPrompt}
                placeholder={t("shell.parallelCreateSharedPromptPlaceholder")}
                onChange={(event) => {
                  clearAllFeedback();
                  setSharedPrompt(event.target.value);
                }}
              />
            </ModalField>

            <ModalField className="parallel-create-count-field" label={t("shell.parallelCreateCountLabel")}>
              <div className="parallel-create-count-group" role="group" aria-label={t("shell.parallelCreateCountLabel")}>
                {[2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className="parallel-create-count-button"
                    data-active={memberCount === count}
                    onClick={() => {
                      clearAllFeedback();
                      setMemberCount(count);
                    }}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </ModalField>
          </div>
        </ModalSection>

        <ModalSection
          className="parallel-create-members-section"
          heading={t("shell.parallelCreateMembersTitle")}
          description={t("shell.parallelCreateMembersDescription")}
        >
          <div
            className="parallel-create-member-list"
            style={memberGridStyle}
          >
            {memberConfigs.map(({ draft, index, modelOptions }) => {
              const memberProviderOptions = availableProviderIds;
              const providerSelectValue = memberProviderOptions.includes(draft.provider as BuiltinProviderId)
                ? draft.provider
                : "";

              return (
                <article
                  key={`parallel-member-${index}`}
                  className="parallel-create-member-card"
                  data-state={memberErrorsByOrdinal[index] ? "error" : successfulOrdinals.has(index) ? "success" : undefined}
                >
                  <header className="parallel-create-member-header">
                    <div className="parallel-create-member-title-block">
                      <strong>{t("shell.parallelCreateMemberTitle", { index: index + 1 })}</strong>
                      <span>{getProviderDisplayName(draft.provider, "full")}</span>
                    </div>
                    {memberErrorsByOrdinal[index] ? (
                      <span className="parallel-create-member-status error">
                        {t("shell.parallelCreateMemberFailed")}
                      </span>
                    ) : successfulOrdinals.has(index) ? (
                      <span className="parallel-create-member-status success">
                        {t("shell.parallelCreateMemberSucceeded")}
                      </span>
                    ) : null}
                  </header>

                  <div className="parallel-create-member-grid">
                    <ModalField
                      label={t("shell.createSessionProviderLabel")}
                      htmlFor={`${modalFieldIdPrefix}-member-${index}-provider`}
                    >
                      <select
                        id={`${modalFieldIdPrefix}-member-${index}-provider`}
                        className="parallel-create-select"
                        value={providerSelectValue}
                        disabled={!memberProviderOptions.length}
                        onChange={(event) => {
                          clearFeedbackForMember(index);
                          const nextProvider = event.target.value as ProviderId;
                          setMembers((current) =>
                            current.map((item, memberIndex) =>
                              memberIndex === index
                                ? {
                                    ...item,
                                    provider: nextProvider,
                                    model: ""
                                  }
                                : item
                            )
                          );
                        }}
                      >
                        {memberProviderOptions.length > 0 ? (
                          memberProviderOptions.map((providerId) => (
                            <option key={providerId} value={providerId}>
                              {getProviderDisplayName(providerId, "full")}
                            </option>
                          ))
                        ) : (
                          <option value="" disabled>
                            {loadingProviderCapabilities
                              ? t("shell.parallelCreateProvidersLoading")
                              : t("shell.parallelCreateNoAvailableProviders")}
                          </option>
                        )}
                      </select>
                    </ModalField>

                    <ModalField
                      label={t("shell.parallelCreateModelLabel")}
                      htmlFor={`${modalFieldIdPrefix}-member-${index}-model`}
                    >
                      <select
                        id={`${modalFieldIdPrefix}-member-${index}-model`}
                        className="parallel-create-select"
                        value={draft.model}
                        disabled={!memberProviderOptions.length}
                        onChange={(event) => {
                          clearFeedbackForMember(index);
                          const nextModel = event.target.value;
                          setMembers((current) =>
                            current.map((item, memberIndex) =>
                              memberIndex === index
                                ? {
                                    ...item,
                                    model: nextModel
                                  }
                                : item
                            )
                          );
                        }}
                      >
                        {modelOptions.length > 0 ? (
                          <>
                            <option value="">
                              {modelOptions.find((option) => option.usesProviderDefault === true)?.name
                                ?? t("shell.parallelPaneModelFallback")}
                            </option>
                            {modelOptions
                              .filter((option) => option.usesProviderDefault !== true)
                              .map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name}
                                </option>
                              ))}
                          </>
                        ) : (
                          <option value="">
                            {t("shell.parallelCreateNoModelsAvailable")}
                          </option>
                        )}
                      </select>
                    </ModalField>
                  </div>

                  <ModalField
                    label={t("shell.parallelCreateMemberPromptLabel")}
                    htmlFor={`${modalFieldIdPrefix}-member-${index}-prompt`}
                  >
                    <textarea
                      id={`${modalFieldIdPrefix}-member-${index}-prompt`}
                      className="parallel-create-textarea member"
                      rows={3}
                      value={draft.memberPrompt}
                      placeholder={t("shell.parallelCreateMemberPromptPlaceholder")}
                      onChange={(event) => {
                        clearFeedbackForMember(index);
                        const nextPrompt = event.target.value;
                        setMembers((current) =>
                          current.map((item, memberIndex) =>
                            memberIndex === index
                              ? {
                                  ...item,
                                  memberPrompt: nextPrompt
                                }
                              : item
                          )
                        );
                      }}
                    />
                  </ModalField>

                  <label className="parallel-create-isolation-toggle">
                    <input
                      type="checkbox"
                      checked={draft.workspaceIsolationMode === "temporary_worktree"}
                      onChange={(event) => {
                        clearFeedbackForMember(index);
                        const nextIsolationMode = event.target.checked ? "temporary_worktree" : "none";
                        setMembers((current) =>
                          current.map((item, memberIndex) =>
                            memberIndex === index
                              ? {
                                  ...item,
                                  workspaceIsolationMode: nextIsolationMode
                                }
                              : item
                          )
                        );
                      }}
                    />
                    <span className="parallel-create-isolation-copy">
                      <strong>{t("shell.parallelCreateIsolationLabel")}</strong>
                    </span>
                  </label>

                  {memberErrorsByOrdinal[index] ? (
                    <div className="parallel-create-member-error" role="alert">
                      <strong>{t("shell.parallelCreateMemberErrorTitle")}</strong>
                      <p>{memberErrorsByOrdinal[index].detail}</p>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </ModalSection>
      </div>
    </DesktopModal>
  );
}
