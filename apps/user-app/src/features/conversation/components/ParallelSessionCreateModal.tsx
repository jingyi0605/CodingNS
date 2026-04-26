import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";

import { DesktopModal } from "../../../components/DesktopModal";
import { ModalActions, ModalField, ModalSection } from "../../../components/ModalAtoms";
import { getDefaultSessionPermissionMode } from "../../../preferences/default-session-permission-mode";
import { t } from "../../../shared/i18n";
import {
  fetchModelManagementSnapshot,
  type ModelManagementAppSnapshotDto,
  type ModelSwitchAppId
} from "../../settings/api/model-switch-api";
import {
  appendParallelGroupMembers,
  createParallelGroupFromSession,
  createParallelGroupFromWorkspace,
  getProviderCapabilities,
  listProviderCapabilities,
  type ParallelSessionMemberFailureDto,
  type BuiltinProviderId,
  type ParallelSessionGroupDetailDto,
  type ProviderCapabilitiesDto,
  type ProviderId,
  type SessionProviderConfigMode
} from "../api/conversation-api";
import {
  createDraftCapabilities,
  getProviderDisplayName,
  SESSION_PROVIDER_PICKER_IDS
} from "../capability/provider-ui";
import { useEnabledProviderCatalog } from "../capability/use-enabled-provider-catalog";
import {
  createDeploymentPresetOptions,
  DeploymentMacSelect,
  GLOBAL_DEFAULT_PRESET_VALUE,
  isProviderDefaultModel,
  mapProviderToModelSwitchApp,
  normalizeProviderSelection,
  PROVIDER_DEFAULT_MODEL_ID,
  shouldShowDeploymentPresetColumn
} from "./provider-deployment";

const DEPLOYMENT_SNAPSHOT_APPS: ModelSwitchAppId[] = ["codex", "claude-code", "gemini"];

interface ParallelSessionCreateMemberDraft {
  provider: ProviderId;
  model: string;
  providerConfigMode: SessionProviderConfigMode;
  providerPresetId: string | null;
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
    providerConfigMode: "global-default",
    providerPresetId: null,
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

function buildDeploymentCapabilityCacheKey(
  provider: ProviderId,
  providerConfigMode: SessionProviderConfigMode,
  providerPresetId: string | null
): string | null {
  if (providerConfigMode !== "cc-switch-preset" || !providerPresetId) {
    return null;
  }

  return `${provider}::${providerPresetId}`;
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
  const { visibleProviders: visibleCatalogProviders } = useEnabledProviderCatalog(
    SESSION_PROVIDER_PICKER_IDS,
    open
  );
  const [sharedPrompt, setSharedPrompt] = useState(initialSharedPrompt);
  const [memberCount, setMemberCount] = useState(initialMemberCount);
  const [members, setMembers] = useState<ParallelSessionCreateMemberDraft[]>(() =>
    createMemberDrafts(defaultProvider, initialMemberCount)
  );
  const [providerCapabilitiesByProvider, setProviderCapabilitiesByProvider] = useState<
    Partial<Record<ProviderId, ProviderCapabilitiesDto>>
  >({});
  const [deploymentSnapshotsByApp, setDeploymentSnapshotsByApp] = useState<
    Partial<Record<ModelSwitchAppId, ModelManagementAppSnapshotDto | null>>
  >({});
  const [loadingDeploymentApps, setLoadingDeploymentApps] = useState<
    Partial<Record<ModelSwitchAppId, boolean>>
  >({});
  const [deploymentCapabilitiesByKey, setDeploymentCapabilitiesByKey] = useState<
    Record<string, ProviderCapabilitiesDto | null>
  >({});
  const [loadingDeploymentCapabilityKeys, setLoadingDeploymentCapabilityKeys] = useState<
    Record<string, boolean>
  >({});
  const [loadingProviderCapabilities, setLoadingProviderCapabilities] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [partialDetail, setPartialDetail] = useState<ParallelSessionGroupDetailDto | null>(null);
  const [memberErrorsByOrdinal, setMemberErrorsByOrdinal] = useState<
    Record<number, ParallelSessionMemberFailureDto>
  >({});
  const deploymentSnapshotRequestedRef = useRef(false);
  const deploymentCapabilityInFlightRef = useRef<Record<string, boolean>>({});

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
    setDeploymentSnapshotsByApp({});
    setLoadingDeploymentApps({});
    setDeploymentCapabilitiesByKey({});
    setLoadingDeploymentCapabilityKeys({});
    setLoadingProviderCapabilities(false);
    setSubmitting(false);
    setSubmitError(null);
    setPartialDetail(null);
    setMemberErrorsByOrdinal({});
    deploymentSnapshotRequestedRef.current = false;
    Object.keys(deploymentCapabilityInFlightRef.current).forEach((key) => {
      delete deploymentCapabilityInFlightRef.current[key];
    });
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

    void listProviderCapabilities(visibleCatalogProviders, source.workspaceId)
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
  }, [open, source?.workspaceId, visibleCatalogProviders]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (deploymentSnapshotRequestedRef.current) {
      return;
    }
    deploymentSnapshotRequestedRef.current = true;

    setLoadingDeploymentApps((current) => ({
      ...current,
      ...Object.fromEntries(DEPLOYMENT_SNAPSHOT_APPS.map((app) => [app, true]))
    }));

    void fetchModelManagementSnapshot()
      .then((snapshot) => {
        const fetchedSnapshots = Object.fromEntries(
          snapshot.items.map((item) => [item.app, item] as const)
        ) as Partial<Record<ModelSwitchAppId, ModelManagementAppSnapshotDto>>;

        setDeploymentSnapshotsByApp(
          Object.fromEntries(
            DEPLOYMENT_SNAPSHOT_APPS.map((app) => [app, fetchedSnapshots[app] ?? null])
          ) as Partial<Record<ModelSwitchAppId, ModelManagementAppSnapshotDto | null>>
        );
      })
      .catch(() => {
        setDeploymentSnapshotsByApp(
          Object.fromEntries(
            DEPLOYMENT_SNAPSHOT_APPS.map((app) => [app, null])
          ) as Partial<Record<ModelSwitchAppId, ModelManagementAppSnapshotDto | null>>
        );
      })
      .finally(() => {
        setLoadingDeploymentApps((current) => ({
          ...current,
          ...Object.fromEntries(DEPLOYMENT_SNAPSHOT_APPS.map((app) => [app, false]))
        }));
      });
  }, [open]);

  useEffect(() => {
    if (!open || !source) {
      return;
    }

    const pendingKeys = Array.from(new Set(
      members
        .map((member) => {
          const selection = normalizeProviderSelection(member.providerConfigMode, member.providerPresetId);
          return buildDeploymentCapabilityCacheKey(
            member.provider,
            selection.providerConfigMode,
            selection.providerPresetId
          );
        })
        .filter((key): key is string => key !== null)
    )).filter((key) => deploymentCapabilitiesByKey[key] === undefined && !deploymentCapabilityInFlightRef.current[key]);

    if (pendingKeys.length === 0) {
      return;
    }

    for (const key of pendingKeys) {
      const [provider, presetId] = key.split("::") as [ProviderId, string];
      deploymentCapabilityInFlightRef.current[key] = true;

      setLoadingDeploymentCapabilityKeys((current) => ({
        ...current,
        [key]: true
      }));

      void getProviderCapabilities(provider, source.workspaceId, {
        providerConfigMode: "cc-switch-preset",
        providerPresetId: presetId
      })
        .then((capabilities) => {
          setDeploymentCapabilitiesByKey((current) => ({
            ...current,
            [key]: capabilities
          }));
        })
        .catch(() => {
          setDeploymentCapabilitiesByKey((current) => ({
            ...current,
            [key]: null
          }));
        })
        .finally(() => {
          delete deploymentCapabilityInFlightRef.current[key];

          setLoadingDeploymentCapabilityKeys((current) => ({
            ...current,
            [key]: false
          }));
        });
    }
  }, [deploymentCapabilitiesByKey, members, open, source]);

  const availableProviderIds = useMemo(
    () =>
      visibleCatalogProviders.filter((providerId) => {
        const capabilities = providerCapabilitiesByProvider[providerId];
        if (!capabilities) {
          return false;
        }

        return capabilities.canStartSession !== false;
      }),
    [providerCapabilitiesByProvider, visibleCatalogProviders]
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
        const nextMember: ParallelSessionCreateMemberDraft = {
          ...member,
          provider: defaultAvailableProvider,
          providerConfigMode: "global-default",
          providerPresetId: null,
          model: ""
        };

        return nextMember;
      });

      return changed ? nextMembers : current;
    });
  }, [availableProviderIds, defaultProvider]);

  const memberConfigs = useMemo(
    () =>
      members.map((member, index) => {
        const normalizedSelection = normalizeProviderSelection(
          member.providerConfigMode,
          member.providerPresetId
        );
        const deploymentApp = mapProviderToModelSwitchApp(member.provider);
        const deploymentSnapshot = deploymentApp ? (deploymentSnapshotsByApp[deploymentApp] ?? null) : null;
        const deploymentPresetOptions = createDeploymentPresetOptions(deploymentSnapshot);
        const selectedPresetValue = normalizedSelection.providerConfigMode === "cc-switch-preset"
          ? normalizedSelection.providerPresetId ?? GLOBAL_DEFAULT_PRESET_VALUE
          : GLOBAL_DEFAULT_PRESET_VALUE;
        const selectedPresetOption = deploymentPresetOptions.find((option) => option.value === selectedPresetValue)
          ?? deploymentPresetOptions[0]
          ?? null;
        const deploymentCapabilityKey = buildDeploymentCapabilityCacheKey(
          member.provider,
          normalizedSelection.providerConfigMode,
          normalizedSelection.providerPresetId
        );
        const defaultCapabilities = providerCapabilitiesByProvider[member.provider] ?? null;
        const deploymentCapabilities = deploymentCapabilityKey
          ? (deploymentCapabilitiesByKey[deploymentCapabilityKey] ?? null)
          : null;
        const rawModelOptions =
          normalizedSelection.providerConfigMode === "cc-switch-preset"
            ? deploymentCapabilities
              ? resolveModelOptions(deploymentCapabilities, member.provider)
              : [{
                  id: PROVIDER_DEFAULT_MODEL_ID,
                  name: t("conversation.modelUseCliDefault"),
                  usesProviderDefault: true
                }]
            : resolveModelOptions(defaultCapabilities, member.provider);
        const modelOptions = rawModelOptions.map((option) => ({
          value: option.id,
          label: isProviderDefaultModel(option) ? t("conversation.modelUseCliDefault") : option.name
        }));
        const selectedModelValue = member.model.trim() || PROVIDER_DEFAULT_MODEL_ID;
        const selectedModelLabel = modelOptions.find((option) => option.value === selectedModelValue)?.label
          ?? t("conversation.modelUseCliDefault");
        const showPresetColumn = shouldShowDeploymentPresetColumn(deploymentSnapshot);
        const supportsDeploymentPicker = deploymentApp !== null;
        const loadingModels = deploymentCapabilityKey
          ? loadingDeploymentCapabilityKeys[deploymentCapabilityKey] === true
          : false;
        const modelColumnDisabled = Boolean(
          deploymentCapabilityKey
          && loadingModels
          && deploymentCapabilities === null
        );

        return {
          index,
          draft: member,
          supportsDeploymentPicker,
          showPresetColumn,
          deploymentPresetOptions,
          selectedPresetValue,
          selectedPresetOption,
          triggerLabel: showPresetColumn
            ? `${selectedPresetOption?.label ?? t("conversation.deploymentDefaultPreset")} · ${selectedModelLabel}`
            : selectedModelLabel,
          selectedModelValue,
          modelOptions,
          loadingPresets: deploymentApp ? loadingDeploymentApps[deploymentApp] === true : false,
          loadingModels,
          modelColumnDisabled
        };
      }),
    [
      deploymentCapabilitiesByKey,
      deploymentSnapshotsByApp,
      loadingDeploymentApps,
      loadingDeploymentCapabilityKeys,
      members,
      providerCapabilitiesByProvider
    ]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setMembers((current) => {
      let changed = false;
      const nextMembers = current.map((member, index) => {
        const memberConfig = memberConfigs[index];

        if (!memberConfig) {
          return member;
        }

        let nextMember = member;
        const normalizedSelection = normalizeProviderSelection(
          member.providerConfigMode,
          member.providerPresetId
        );

        if (
          normalizedSelection.providerConfigMode === "cc-switch-preset"
          && normalizedSelection.providerPresetId
          && !memberConfig.loadingPresets
          && !memberConfig.deploymentPresetOptions.some((option) => option.value === normalizedSelection.providerPresetId)
        ) {
          nextMember = {
            ...nextMember,
            providerConfigMode: "global-default",
            providerPresetId: null,
            model: ""
          };
          changed = true;
        }

        const allowedModelValues = new Set(memberConfig.modelOptions.map((option) => option.value));
        const currentModelValue = nextMember.model.trim() || PROVIDER_DEFAULT_MODEL_ID;

        if (!allowedModelValues.has(currentModelValue)) {
          nextMember = {
            ...nextMember,
            model: ""
          };
          changed = true;
        }

        return nextMember;
      });

      return changed ? nextMembers : current;
    });
  }, [memberConfigs, open]);

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
      : activeSource.workspaceName;
  const sharedPromptLabel = activeSource.kind === "group"
    ? t("shell.parallelAppendSharedPromptLabel")
    : t("shell.parallelCreateSharedPromptLabel");
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

  function updateMemberIsolationMode(index: number, enabled: boolean) {
    clearFeedbackForMember(index);
    const nextIsolationMode = enabled ? "temporary_worktree" : "none";
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
      const permissionMode = getDefaultSessionPermissionMode();
      const memberPayload = members.map((member) => {
        const normalizedSelection = normalizeProviderSelection(
          member.providerConfigMode,
          member.providerPresetId
        );

        return {
          provider: member.provider,
          model: member.model.trim() || null,
          providerConfigMode: normalizedSelection.providerConfigMode,
          providerPresetId:
            normalizedSelection.providerConfigMode === "cc-switch-preset"
              ? normalizedSelection.providerPresetId
              : null,
          memberPrompt: member.memberPrompt.trim() || null,
          workspaceIsolationMode: member.workspaceIsolationMode
        };
      });
      const detail =
        activeSource.kind === "group"
          ? await appendParallelGroupMembers(activeSource.groupId, {
              permissionMode,
              members: memberPayload
            })
          : activeSource.kind === "session"
            ? await createParallelGroupFromSession(activeSource.sessionId, {
                sharedPrompt: normalizedSharedPrompt,
                permissionMode,
                members: memberPayload
              })
            : await createParallelGroupFromWorkspace(activeSource.workspaceId, {
                sharedPrompt: normalizedSharedPrompt,
                permissionMode,
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
              htmlFor={`${modalFieldIdPrefix}-shared-prompt`}
            >
              <textarea
                id={`${modalFieldIdPrefix}-shared-prompt`}
                className="parallel-create-textarea parallel-create-textarea-target"
                rows={2}
                value={sharedPrompt}
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
        >
          <div className="parallel-create-member-list" style={memberGridStyle}>
            {memberConfigs.map(({
              draft,
              index,
              supportsDeploymentPicker,
              showPresetColumn,
              deploymentPresetOptions,
              selectedPresetValue,
              selectedPresetOption,
              triggerLabel,
              selectedModelValue,
              modelOptions,
              loadingPresets,
              loadingModels,
              modelColumnDisabled
            }) => {
              const memberProviderOptions = availableProviderIds;
              const providerSelectValue = memberProviderOptions.includes(draft.provider as BuiltinProviderId)
                ? draft.provider
                : "";
              const legacyModelOptions = resolveModelOptions(
                providerCapabilitiesByProvider[draft.provider] ?? null,
                draft.provider
              );

              return (
                <article
                  key={`parallel-member-${index}`}
                  className="parallel-create-member-card"
                  data-state={memberErrorsByOrdinal[index] ? "error" : successfulOrdinals.has(index) ? "success" : undefined}
                >
                  <header className="parallel-create-member-header">
                    <div className="parallel-create-member-title-block">
                      <strong>{t("shell.parallelCreateMemberTitle", { index: index + 1 })}</strong>
                      <span className="parallel-create-member-provider">
                        {getProviderDisplayName(draft.provider, "full")}
                      </span>
                      <label className="parallel-create-isolation-toggle">
                        <input
                          type="checkbox"
                          checked={draft.workspaceIsolationMode === "temporary_worktree"}
                          onChange={(event) => {
                            updateMemberIsolationMode(index, event.target.checked);
                          }}
                        />
                        <span className="parallel-create-isolation-copy">
                          {t("shell.parallelCreateIsolationLabel")}
                        </span>
                      </label>
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
                                    providerConfigMode: "global-default",
                                    providerPresetId: null,
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
                      htmlFor={supportsDeploymentPicker ? undefined : `${modalFieldIdPrefix}-member-${index}-model`}
                    >
                      {supportsDeploymentPicker ? (
                        <div className="parallel-create-deployment-select">
                          <DeploymentMacSelect
                            triggerId={`${modalFieldIdPrefix}-member-${index}-model`}
                            ariaLabel={t("shell.parallelCreateModelLabel")}
                            triggerLabel={triggerLabel}
                            presetOptions={deploymentPresetOptions}
                            selectedPresetValue={selectedPresetValue}
                            selectedPresetSummary={selectedPresetOption?.summary ?? null}
                            onSelectPreset={(value) => {
                              clearFeedbackForMember(index);
                              setMembers((current) =>
                                current.map((item, memberIndex) => {
                                  if (memberIndex !== index) {
                                    return item;
                                  }

                                  return value === GLOBAL_DEFAULT_PRESET_VALUE
                                    ? {
                                        ...item,
                                        providerConfigMode: "global-default",
                                        providerPresetId: null,
                                        model: ""
                                      }
                                    : {
                                        ...item,
                                        providerConfigMode: "cc-switch-preset",
                                        providerPresetId: value,
                                        model: ""
                                      };
                                })
                              );
                            }}
                            modelOptions={modelOptions}
                            selectedModelValue={selectedModelValue}
                            onSelectModel={(value) => {
                              clearFeedbackForMember(index);
                              setMembers((current) =>
                                current.map((item, memberIndex) =>
                                  memberIndex === index
                                    ? {
                                        ...item,
                                        model: value === PROVIDER_DEFAULT_MODEL_ID ? "" : value
                                      }
                                    : item
                                )
                              );
                            }}
                            loadingPresets={loadingPresets}
                            loadingModels={loadingModels}
                            modelColumnDisabled={modelColumnDisabled}
                            showPresetColumn={showPresetColumn}
                            modelEmptyText={t("conversation.deploymentModelEmpty")}
                          />
                        </div>
                      ) : (
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
                          {legacyModelOptions.length > 0 ? (
                            <>
                              <option value="">
                                {legacyModelOptions.find((option) => option.usesProviderDefault === true)?.name
                                  ?? t("shell.parallelPaneModelFallback")}
                              </option>
                              {legacyModelOptions
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
                      )}
                    </ModalField>
                  </div>

                  <ModalField
                    label={t("shell.parallelCreateMemberPromptLabel")}
                    htmlFor={`${modalFieldIdPrefix}-member-${index}-prompt`}
                  >
                    <textarea
                      id={`${modalFieldIdPrefix}-member-${index}-prompt`}
                      className="parallel-create-textarea member"
                      rows={2}
                      value={draft.memberPrompt}
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
