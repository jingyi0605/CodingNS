import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";

import { DesktopModal } from "../../../components/DesktopModal";
import { ModalActions, ModalField, ModalSection } from "../../../components/ModalAtoms";
import { t } from "../../../shared/i18n";
import {
  appendParallelGroupMembers,
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
    }
  | {
      kind: "group";
      groupId: string;
      workspaceId: string;
      workspaceName: string;
      sharedPrompt: string;
      currentMemberCount: number;
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

function createMemberDrafts(defaultProvider: ProviderId, count: number) {
  return Array.from({ length: count }, () => createMemberDraft(defaultProvider));
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

function countCreatedMembers(requestedCount: number, memberFailures: readonly ParallelSessionMemberFailureDto[]) {
  return Math.max(0, requestedCount - memberFailures.length);
}

export function ParallelSessionCreateModal({
  open,
  source,
  onClose,
  onCreated
}: ParallelSessionCreateModalProps) {
  const modalFieldIdPrefix = useId();
  const defaultProvider = source?.defaultProvider ?? "codex";
  const promptLocked = source?.kind === "group";
  const maxSelectableMemberCount = source?.kind === "group" ? Math.max(0, 4 - source.currentMemberCount) : 4;
  const countOptions = useMemo(
    () =>
      source?.kind === "group"
        ? Array.from({ length: maxSelectableMemberCount }, (_, index) => index + 1)
        : [2, 3, 4],
    [maxSelectableMemberCount, source?.kind]
  );
  const initialMemberCount = source?.kind === "group" ? 1 : 2;
  const initialSharedPrompt = source?.kind === "group" ? source.sharedPrompt : "";
  const [sharedPrompt, setSharedPrompt] = useState(initialSharedPrompt);
  const [memberCount, setMemberCount] = useState(initialMemberCount);
  const [members, setMembers] = useState<ParallelSessionCreateMemberDraft[]>(() =>
    createMemberDrafts(defaultProvider, initialMemberCount)
  );
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
    const nextMemberCount = source?.kind === "group" ? 1 : 2;
    setSharedPrompt(source?.kind === "group" ? source.sharedPrompt : "");
    setMemberCount(nextMemberCount);
    setMembers(createMemberDrafts(nextDefaultProvider, nextMemberCount));
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
    source?.kind === "session" ? source.sessionId : null,
    source?.kind === "group" ? source.groupId : null,
    source?.kind === "group" ? source.sharedPrompt : null
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
    if (countOptions.length === 0) {
      return;
    }

    setMemberCount((current) => (countOptions.includes(current) ? current : countOptions[0] ?? current));
  }, [countOptions]);

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

  const activeSource = source;
  const createdMemberCount = partialDetail
    ? countCreatedMembers(members.length, partialDetail.memberFailures)
    : 0;
  const successfulOrdinals = new Set(
    partialDetail
      ? members
        .map((_, index) => index)
        .filter((index) => !(index in memberErrorsByOrdinal))
      : []
  );
  const title = activeSource.kind === "group"
    ? t("shell.parallelAppendModalTitle")
    : t("shell.parallelCreateModalTitle");
  const description =
    activeSource.kind === "session"
      ? `${activeSource.workspaceName} · ${activeSource.sessionTitle}`
      : activeSource.kind === "group"
        ? `${activeSource.workspaceName} · ${t("shell.parallelAppendModalDescription")}`
        : `${activeSource.workspaceName} · ${t("shell.parallelCreateModalDescription")}`;
  const sharedPromptLabel = activeSource.kind === "group"
    ? t("shell.parallelAppendSharedPromptLabel")
    : t("shell.parallelCreateSharedPromptLabel");
  const sharedPromptDescription = activeSource.kind === "group"
    ? t("shell.parallelAppendSharedPromptDescription")
    : t("shell.parallelCreateSharedPromptPlaceholder");
  const countLabel = activeSource.kind === "group"
    ? t("shell.parallelAppendCountLabel")
    : t("shell.parallelCreateCountLabel");
  const submitLabel = activeSource.kind === "group"
    ? t("shell.parallelAppendSubmit")
    : t("shell.parallelCreateSubmit");
  const submittingLabel = activeSource.kind === "group"
    ? t("shell.parallelAppendSubmitting")
    : t("shell.parallelCreateSubmitting");
  const footerStatusMessage =
    submitError
    ?? (
      activeSource.kind === "group" && maxSelectableMemberCount === 0
        ? t("shell.parallelAppendNoRemainingSlots")
        : null
    )
    ?? (!loadingProviderCapabilities && availableProviderIds.length === 0
      ? t("shell.parallelCreateNoAvailableProviders")
      : null);
  const memberGridStyle = {
    "--parallel-member-columns": String(Math.max(1, Math.min(memberCount, 4)))
  } as CSSProperties;

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

    if (!promptLocked && !normalizedSharedPrompt) {
      setSubmitError(t("shell.parallelCreatePromptRequired"));
      return;
    }

    if (activeSource.kind === "group" && maxSelectableMemberCount === 0) {
      setSubmitError(t("shell.parallelAppendNoRemainingSlots"));
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
      const memberPayload = members.map((member) => ({
        provider: member.provider,
        model: member.model.trim() || null,
        memberPrompt: member.memberPrompt.trim() || null,
        workspaceIsolationMode: member.workspaceIsolationMode
      }));
      const detail =
        activeSource.kind === "group"
          ? await appendParallelGroupMembers(activeSource.groupId, {
              members: memberPayload
            })
          : activeSource.kind === "session"
            ? await createParallelGroupFromSession(activeSource.sessionId, {
                sharedPrompt: normalizedSharedPrompt,
                members: memberPayload
              })
            : await createParallelGroupFromWorkspace(activeSource.workspaceId, {
                sharedPrompt: normalizedSharedPrompt,
                members: memberPayload
              });

      if (detail.memberFailures.length > 0) {
        const nextCreatedMemberCount = countCreatedMembers(members.length, detail.memberFailures);
        setPartialDetail(detail);
        setMemberErrorsByOrdinal(
          Object.fromEntries(detail.memberFailures.map((item) => [item.ordinal, item]))
        );
        setSubmitError(
          nextCreatedMemberCount > 0
            ? t("shell.parallelCreatePartialFailure", {
                successCount: nextCreatedMemberCount,
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

  return (
    <DesktopModal
      open={open}
      title={title}
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
            {partialDetail && createdMemberCount > 0 ? (
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
              disabled={
                submitting
                || loadingProviderCapabilities
                || availableProviderIds.length === 0
                || (activeSource.kind === "group" && maxSelectableMemberCount === 0)
              }
              onClick={() => {
                void handleSubmit();
              }}
            >
              {submitting ? submittingLabel : submitLabel}
            </button>
          </div>
        </ModalActions>
      )}
    >
      <div className="parallel-create-layout">
        <ModalSection className="parallel-create-shared-section" tone="accent">
          <div className="parallel-create-target-row">
            <ModalField
              className="parallel-create-target-field"
              label={sharedPromptLabel}
              description={sharedPromptDescription}
              htmlFor={`${modalFieldIdPrefix}-shared-prompt`}
            >
              <textarea
                id={`${modalFieldIdPrefix}-shared-prompt`}
                className="parallel-create-textarea parallel-create-textarea-target"
                rows={3}
                value={sharedPrompt}
                placeholder={!promptLocked ? t("shell.parallelCreateSharedPromptPlaceholder") : undefined}
                readOnly={promptLocked}
                aria-readonly={promptLocked}
                data-readonly={promptLocked ? "true" : undefined}
                onChange={(event) => {
                  if (promptLocked) {
                    return;
                  }

                  clearAllFeedback();
                  setSharedPrompt(event.target.value);
                }}
              />
            </ModalField>

            <ModalField className="parallel-create-count-field" label={countLabel}>
              <div className="parallel-create-count-group" role="group" aria-label={countLabel}>
                {countOptions.map((count) => (
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
          <div className="parallel-create-member-list" style={memberGridStyle}>
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
