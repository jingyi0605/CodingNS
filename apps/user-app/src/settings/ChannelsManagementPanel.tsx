import { useEffect, useMemo, useState } from "react";

import { DesktopModal } from "../components/DesktopModal";
import {
  ModalActions,
  ModalEmptyState,
  ModalField,
  ModalList,
  ModalListItem,
  ModalSection,
  ModalTag
} from "../components/ModalAtoms";
import { MobileSheet } from "../components/MobileSheet";
import { useAuthSelector } from "../features/auth/store/auth-store";
import type {
  ButlerProfileProviderId,
  ChannelAccountStatus,
  ChannelAccountSummaryDto,
  ChannelConnectionMode,
  ChannelDeliveryDto,
  ChannelDeliveryStatus,
  ChannelInboundEventDto,
  ChannelInboundEventStatus,
  ChannelMultiSessionSupportLevel,
  ChannelPlatformCapabilityDto,
  ChannelPlatformCode,
  ChannelThreadDto,
  ChannelThreadStatus,
  WechatClawLoginActionResultDto,
  WechatClawLoginStatus
} from "../features/settings/api/channels-api";
import {
  createChannelAccount,
  listChannelAccounts,
  listChannelDeliveries,
  listChannelEvents,
  listChannelPlatforms,
  listChannelThreads,
  logoutWechatClaw,
  pollChannelAccount,
  probeChannelAccount,
  refreshWechatClawLogin,
  removeChannelAccount,
  startWechatClawLogin
} from "../features/settings/api/channels-api";
import { usePlatform } from "../platform/platform-provider";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";
import { ChannelPlatformIcon } from "./ChannelPlatformIcons";

type ChannelWizardStep = "platform" | "config" | "binding";
type PendingActionKey =
  | null
  | "refresh"
  | "probe"
  | "poll"
  | "remove-account"
  | "wechat-start-login"
  | "wechat-refresh-login"
  | "wechat-logout";
type CreatePendingActionKey = null | "save";

interface ChannelAccountDraft {
  platformCode: ChannelPlatformCode | "";
  displayName: string;
  providerId: ButlerProfileProviderId;
  status: ChannelAccountStatus;
  configValues: Record<string, string>;
  advancedConfigText: string;
}

interface PlatformConfigFieldDef {
  readonly key: string;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly placeholderKey: string;
  readonly type?: "text" | "password" | "url";
  readonly required?: boolean;
}

interface PlatformConfigChecklistDef {
  readonly titleKey: string;
  readonly summaryKey: string;
  readonly items: readonly string[];
}

const CHANNEL_PROVIDER_OPTIONS: ButlerProfileProviderId[] = ["codex", "claude-code"];
const CHANNEL_STATUS_OPTIONS: ChannelAccountStatus[] = ["active", "disabled", "degraded"];
const CHANNEL_FIXED_CONNECTION_MODE: ChannelConnectionMode = "polling";
const EMPTY_JSON_TEXT = "{\n}";

const PLATFORM_CONFIG_FIELDS: Record<ChannelPlatformCode, PlatformConfigFieldDef[]> = {
  "wechat-claw": [],
  telegram: [
    {
      key: "botToken",
      labelKey: "settings.channelsConfigFieldTelegramBotToken",
      descriptionKey: "settings.channelsConfigFieldTelegramBotTokenDescription",
      placeholderKey: "settings.channelsConfigFieldTelegramBotTokenPlaceholder",
      type: "password",
      required: true
    }
  ]
};

const PLATFORM_CONFIG_CHECKLISTS: Partial<Record<ChannelPlatformCode, PlatformConfigChecklistDef>> = {};

export function ChannelsManagementPanel() {
  const platform = usePlatform();
  const accessToken = useAuthSelector((state) => state.session?.accessToken ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [platforms, setPlatforms] = useState<ChannelPlatformCapabilityDto[]>([]);
  const [accounts, setAccounts] = useState<ChannelAccountSummaryDto[]>([]);
  const [overviewLoaded, setOverviewLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingActionKey>(null);
  const [createPendingAction, setCreatePendingAction] = useState<CreatePendingActionKey>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createWizardStep, setCreateWizardStep] = useState<ChannelWizardStep>("platform");
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [pendingRemovalAccountId, setPendingRemovalAccountId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<ChannelAccountDraft>(() => createEmptyDraft());
  const [threads, setThreads] = useState<ChannelThreadDto[]>([]);
  const [events, setEvents] = useState<ChannelInboundEventDto[]>([]);
  const [deliveries, setDeliveries] = useState<ChannelDeliveryDto[]>([]);

  const activeAccount = useMemo(
    () => accounts.find((item) => item.id === activeAccountId) ?? null,
    [accounts, activeAccountId]
  );
  const createSelectedPlatform = useMemo(
    () => platforms.find((item) => item.code === createDraft.platformCode) ?? null,
    [createDraft.platformCode, platforms]
  );
  const createConfigFields = useMemo(
    () => (createDraft.platformCode ? PLATFORM_CONFIG_FIELDS[createDraft.platformCode] ?? [] : []),
    [createDraft.platformCode]
  );
  const activePlatformCount = useMemo(
    () => new Set(accounts.map((item) => item.platformCode)).size,
    [accounts]
  );
  const activeAccountCount = useMemo(
    () => accounts.filter((item) => item.status === "active").length,
    [accounts]
  );
  const createSelectedPlatformIsWechatClaw = createSelectedPlatform?.code === "wechat-claw";
  const activeAccountIsWechatClaw = activeAccount?.platformCode === "wechat-claw";
  const activeWechatClawBindingState = useMemo(
    () => (activeAccount ? readWechatClawBindingState(activeAccount) : null),
    [activeAccount]
  );
  const activeWechatClawIsBound = activeWechatClawBindingState?.loginStatus === "active";

  useEffect(() => {
    if (accessToken) {
      return;
    }

    setModalOpen(false);
    setCreateModalOpen(false);
    setPlatforms([]);
    setAccounts([]);
    setOverviewLoaded(false);
    setLoading(false);
    setDetailLoading(false);
    setPendingAction(null);
    setCreatePendingAction(null);
    setStatusText(null);
    setPanelError(null);
    setCreateError(null);
    setCreateWizardStep("platform");
    setActiveAccountId(null);
    setPendingRemovalAccountId(null);
    setCreateDraft(createEmptyDraft());
    setThreads([]);
    setEvents([]);
    setDeliveries([]);
  }, [accessToken]);

  useEffect(() => {
    if (!activeAccountId || pendingRemovalAccountId !== activeAccountId) {
      setPendingRemovalAccountId(null);
    }
  }, [activeAccountId, pendingRemovalAccountId]);

  useEffect(() => {
    if (!modalOpen || !accessToken) {
      return;
    }

    void loadOverview();
  }, [accessToken, modalOpen]);

  useEffect(() => {
    if (!modalOpen || !accessToken || !activeAccountId) {
      setThreads([]);
      setEvents([]);
      setDeliveries([]);
      return;
    }

    void loadDetails(activeAccountId);
  }, [accessToken, activeAccountId, modalOpen]);
  async function loadOverview(options: { showSuccess?: boolean } = {}): Promise<void> {
    if (!accessToken) {
      return;
    }

    setLoading(true);
    setPanelError(null);

    try {
      const [nextPlatforms, nextAccounts] = await Promise.all([
        listChannelPlatforms(),
        listChannelAccounts()
      ]);

      setOverviewLoaded(true);
      setPlatforms(nextPlatforms);
      setAccounts(nextAccounts);

      if (activeAccountId && !nextAccounts.some((item) => item.id === activeAccountId)) {
        setActiveAccountId(null);
        setThreads([]);
        setEvents([]);
        setDeliveries([]);
      }

      if (options.showSuccess) {
        setStatusText(t("settings.channelsRefreshSuccess"));
      }
    } catch (error) {
      setPanelError(resolveChannelsError(error, "loadOverview"));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetails(accountId: string): Promise<void> {
    if (!accessToken) {
      return;
    }

    setDetailLoading(true);
    setPanelError(null);

    try {
      const [nextThreads, nextEvents, nextDeliveries] = await Promise.all([
        listChannelThreads(accountId),
        listChannelEvents(accountId),
        listChannelDeliveries(accountId)
      ]);
      if (activeAccountId !== accountId) {
        return;
      }
      setThreads(nextThreads);
      setEvents(nextEvents);
      setDeliveries(nextDeliveries);
    } catch (error) {
      setPanelError(resolveChannelsError(error, "loadDetails"));
    } finally {
      setDetailLoading(false);
    }
  }

  function handleOpen(): void {
    setModalOpen(true);
    setStatusText(null);
    setPanelError(null);
  }

  function handleCloseManageModal(): void {
    setModalOpen(false);
    setCreateModalOpen(false);
    setPendingRemovalAccountId(null);
  }

  function resetCreateModalState(): void {
    setCreatePendingAction(null);
    setCreateError(null);
    setCreateWizardStep("platform");
    setCreateDraft(createEmptyDraft());
  }

  function handleOpenCreateModal(): void {
    resetCreateModalState();
    setCreateModalOpen(true);
  }

  function handleCloseCreateModal(): void {
    setCreateModalOpen(false);
    resetCreateModalState();
  }

  function handleSelectAccount(account: ChannelAccountSummaryDto): void {
    setActiveAccountId(account.id);
    setPendingRemovalAccountId(null);
    setStatusText(null);
    setPanelError(null);
  }

  function handleChooseCreatePlatform(platformCode: ChannelPlatformCode): void {
    setCreateWizardStep(platformCode === "wechat-claw" ? "binding" : "config");
    setCreateDraft((current) => createEmptyDraft({
      platformCode,
      displayName: current.platformCode === platformCode ? current.displayName : "",
      providerId: current.providerId,
      status: current.status
    }));
    setCreateError(null);
  }

  function handleCreatePlatformConfigChange(key: string, value: string): void {
    setCreateDraft((current) => ({
      ...current,
      configValues: {
        ...current.configValues,
        [key]: value
      }
    }));
  }

  function handleContinueCreateToBinding(): void {
    const validation = validateConfigStep(createDraft, createSelectedPlatform);
    if (!validation.ok) {
      setCreateError(validation.errorText);
      return;
    }

    setCreateWizardStep("binding");
    setCreateError(null);
  }

  async function handleCreateAccount(): Promise<void> {
    if (!accessToken) {
      return;
    }

    const normalized = validateDraft(createDraft, createSelectedPlatform);
    if (!normalized.ok) {
      setCreateError(normalized.errorText);
      return;
    }

    setCreatePendingAction("save");
    setCreateError(null);
    setStatusText(null);

    try {
      const created = await createChannelAccount(normalized.input);
      setAccounts((current) => [created, ...current]);
      setActiveAccountId(created.id);
      handleCloseCreateModal();
      setStatusText(t("settings.channelsCreateSuccess", { account: created.displayName }));
    } catch (error) {
      setCreateError(resolveChannelsError(error, "save"));
    } finally {
      setCreatePendingAction(null);
    }
  }

  async function handleProbe(): Promise<void> {
    if (!accessToken || !activeAccountId) {
      return;
    }

    setPendingAction("probe");
    setPanelError(null);
    setStatusText(null);

    try {
      const result = await probeChannelAccount(activeAccountId);
      setAccounts((current) => replaceAccount(current, result.account));
      setStatusText(result.detail);
      await loadDetails(activeAccountId);
    } catch (error) {
      setPanelError(resolveChannelsError(error, "probe"));
    } finally {
      setPendingAction(null);
    }
  }

  async function handlePoll(): Promise<void> {
    if (!accessToken || !activeAccountId) {
      return;
    }

    setPendingAction("poll");
    setPanelError(null);
    setStatusText(null);

    try {
      const result = await pollChannelAccount(activeAccountId);
      setAccounts((current) => replaceAccount(current, result.account));
      setStatusText(result.detail);
      await loadDetails(activeAccountId);
    } catch (error) {
      setPanelError(resolveChannelsError(error, "poll"));
    } finally {
      setPendingAction(null);
    }
  }

  async function runWechatClawLoginAction(
    action: "start" | "refresh" | "logout"
  ): Promise<void> {
    if (!accessToken || !activeAccountId || !activeAccountIsWechatClaw) {
      return;
    }

    const pendingKey: Exclude<PendingActionKey, null | "refresh" | "probe" | "poll"> =
      action === "start"
        ? "wechat-start-login"
        : action === "refresh"
          ? "wechat-refresh-login"
          : "wechat-logout";

    setPendingAction(pendingKey);
    setPanelError(null);
    setStatusText(null);

    try {
      let result: WechatClawLoginActionResultDto;
      if (action === "start") {
        result = await startWechatClawLogin(activeAccountId);
      } else if (action === "refresh") {
        result = await refreshWechatClawLogin(activeAccountId);
      } else {
        result = await logoutWechatClaw(activeAccountId);
      }

      applyUpdatedAccount(result.account);
      setStatusText(result.detail);
    } catch (error) {
      setPanelError(resolveChannelsError(error, action));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRemoveAccount(): Promise<void> {
    if (!accessToken || !activeAccount) {
      return;
    }

    setPendingAction("remove-account");
    setPanelError(null);
    setStatusText(null);

    try {
      const result = await removeChannelAccount(activeAccount.id);
      setAccounts((current) => current.filter((item) => item.id !== result.accountId));
      if (activeAccountId === result.accountId) {
        setActiveAccountId(null);
        setThreads([]);
        setEvents([]);
        setDeliveries([]);
      }
      setPendingRemovalAccountId(null);
      setStatusText(t("settings.channelsRemoveSuccess", {
        account: result.displayName
      }));
    } catch (error) {
      setPanelError(resolveChannelsError(error, "remove"));
    } finally {
      setPendingAction(null);
    }
  }

  function applyUpdatedAccount(account: ChannelAccountSummaryDto): void {
    setAccounts((current) => replaceAccount(current, account));
  }

  async function handleRefresh(): Promise<void> {
    setPendingAction("refresh");
    setStatusText(null);
    setPanelError(null);

    try {
      await loadOverview({ showSuccess: true });
    } finally {
      setPendingAction(null);
    }
  }

  const summaryCards = (
    <div className="settings-channels-summary-grid" aria-label={t("settings.channelsSummaryTitle")}>
      <SummaryCard label={t("settings.channelsSummaryAccounts")} value={String(accounts.length)} />
      <SummaryCard label={t("settings.channelsSummaryActive")} value={String(activeAccountCount)} />
      <SummaryCard label={t("settings.channelsSummaryPlatforms")} value={String(activePlatformCount)} />
    </div>
  );

  const manageActions = (
    <>
      <button className="secondary-button" type="button" onClick={handleOpenCreateModal}>
        {t("settings.channelsAddAccountAction")}
      </button>
      <button
        className="secondary-button"
        type="button"
        disabled={loading || pendingAction !== null}
        onClick={() => {
          void handleRefresh();
        }}
      >
        {pendingAction === "refresh"
          ? t("settings.channelsActionPending")
          : t("settings.channelsRefresh")}
      </button>
    </>
  );

  const showProbeAndPollActions = !activeAccountIsWechatClaw || activeWechatClawIsBound;
  const showRemoveConfirmation = activeAccount !== null && pendingRemovalAccountId === activeAccount.id;

  const createModalBody = (
    <div className="settings-channels-modal-layout">
      {createError ? <p className="settings-channels-error">{createError}</p> : null}
      <ModalSection
        heading={t("settings.channelsWizardTitle")}
        description={t("settings.channelsWizardCreateDescription")}
      >
        <WizardSteps currentStep={createWizardStep} />

        {createWizardStep === "platform" ? (
          <>
            {loading && platforms.length === 0 ? (
              <ModalEmptyState compact title={t("settings.channelsLoading")} />
            ) : null}

            {!loading && platforms.length === 0 ? (
              <ModalEmptyState
                title={t("settings.channelsPlatformsEmpty")}
                description={t("settings.channelsPlatformsEmptyDescription")}
              />
            ) : null}

            {platforms.length > 0 ? (
              <div className="settings-channels-platform-grid">
                {platforms.map((item) => (
                  <button
                    key={item.code}
                    className="settings-channels-platform-card"
                    type="button"
                    aria-pressed={createDraft.platformCode === item.code}
                    data-selected={createDraft.platformCode === item.code ? "true" : undefined}
                    onClick={() => handleChooseCreatePlatform(item.code)}
                  >
                    <div className="settings-channels-platform-card-top">
                      <div className="settings-channels-platform-card-brand">
                        <div className="settings-channels-platform-card-logo">
                          <ChannelPlatformIcon code={item.code} width={40} height={40} aria-hidden="true" />
                        </div>
                        <div className="settings-channels-platform-card-copy">
                          <strong>{item.displayName}</strong>
                          <span>
                            {t("settings.channelsPlatformSummary", {
                              modes: getConnectionModeLabel(CHANNEL_FIXED_CONNECTION_MODE),
                              multiSession: getMultiSessionSupportLabel(item.multiSessionSupportLevel)
                            })}
                          </span>
                        </div>
                      </div>
                      <ModalTag tone={item.multiSessionSupportLevel === "supported" ? "success" : "warning"}>
                        {getMultiSessionSupportLabel(item.multiSessionSupportLevel)}
                      </ModalTag>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            <ModalActions>
              <button
                className="primary-button"
                type="button"
                disabled={!createSelectedPlatform}
                onClick={() => {
                  if (createSelectedPlatform) {
                    setCreateWizardStep("config");
                  }
                }}
              >
                {t("settings.channelsWizardNextToConfig")}
              </button>
            </ModalActions>
          </>
        ) : null}

        {createWizardStep === "config" ? (
          <>
            {createSelectedPlatform ? (
              <PlatformSummaryCard platformCapability={createSelectedPlatform} />
            ) : (
              <ModalEmptyState
                compact
                title={t("settings.channelsValidationPlatform")}
                description={t("settings.channelsWizardSelectPlatformHint")}
              />
            )}

            {createSelectedPlatform ? (
              <>
                <PlatformConfigUnavailableNotice platformCode={createSelectedPlatform.code} />
                <PlatformConfigChecklist platformCode={createSelectedPlatform.code} />

                {createConfigFields.length > 0 ? (
                  <div className="settings-channels-form-grid">
                    {createConfigFields.map((field) => (
                      <ModalField
                        key={field.key}
                        label={t(field.labelKey)}
                        description={t(field.descriptionKey)}
                        htmlFor={`channels-create-config-${field.key}`}
                      >
                        <input
                          id={`channels-create-config-${field.key}`}
                          className="settings-text-input"
                          type={field.type ?? "text"}
                          placeholder={t(field.placeholderKey)}
                          value={createDraft.configValues[field.key] ?? ""}
                          onChange={(event) => handleCreatePlatformConfigChange(field.key, event.target.value)}
                        />
                      </ModalField>
                    ))}
                  </div>
                ) : null}

                <details className="settings-channels-advanced-config">
                  <summary>{t("settings.channelsAdvancedConfigTitle")}</summary>
                  <p className="settings-channels-inline-note">
                    {t("settings.channelsAdvancedConfigDescription")}
                  </p>
                  <ModalField
                    className="settings-channels-form-field-wide"
                    label={t("settings.channelsFieldConfig")}
                    htmlFor="channels-create-config-advanced"
                  >
                    <textarea
                      id="channels-create-config-advanced"
                      className="settings-channels-textarea"
                      rows={8}
                      value={createDraft.advancedConfigText}
                      onChange={(event) => {
                        setCreateDraft((current) => ({
                          ...current,
                          advancedConfigText: event.target.value
                        }));
                      }}
                    />
                  </ModalField>
                </details>
              </>
            ) : null}

            <ModalActions align="between">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setCreateWizardStep("platform")}
              >
                {t("settings.channelsWizardBackToPlatform")}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={!createSelectedPlatform}
                onClick={handleContinueCreateToBinding}
              >
                {t("settings.channelsWizardNextToBinding")}
              </button>
            </ModalActions>
          </>
        ) : null}

        {createWizardStep === "binding" ? (
          <>
            {createSelectedPlatform ? (
              <div className="settings-channels-detail-grid">
                <DetailCard label={t("settings.channelsDetailPlatform")} value={createSelectedPlatform.displayName} />
                <DetailCard label={t("settings.channelsDetailConnectionMode")} value={getConnectionModeLabel(CHANNEL_FIXED_CONNECTION_MODE)} />
                <DetailCard
                  label={t("settings.channelsWizardBindingSummary")}
                  value={getMultiSessionSupportLabel(createSelectedPlatform.multiSessionSupportLevel)}
                />
              </div>
            ) : null}

            <div className="settings-channels-form-grid">
              <ModalField
                label={t("settings.channelsFieldDisplayName")}
                description={createSelectedPlatformIsWechatClaw ? t("settings.channelsWechatCreateDescription") : undefined}
                htmlFor="channels-create-display-name"
              >
                <input
                  id="channels-create-display-name"
                  className="settings-text-input"
                  placeholder={t("settings.channelsFieldDisplayNamePlaceholder")}
                  value={createDraft.displayName}
                  onChange={(event) => {
                    setCreateDraft((current) => ({
                      ...current,
                      displayName: event.target.value
                    }));
                  }}
                />
              </ModalField>

              <ModalField
                label={t("settings.channelsFieldProvider")}
                description={t("settings.channelsFieldProviderDescription")}
                htmlFor="channels-create-provider"
              >
                <select
                  id="channels-create-provider"
                  className="settings-select"
                  value={createDraft.providerId}
                  onChange={(event) => {
                    setCreateDraft((current) => ({
                      ...current,
                      providerId: event.target.value as ButlerProfileProviderId
                    }));
                  }}
                >
                  {CHANNEL_PROVIDER_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {getProviderLabel(item)}
                    </option>
                  ))}
                </select>
              </ModalField>

              <ModalField
                label={t("settings.channelsFieldStatus")}
                description={t("settings.channelsFieldStatusDescription")}
                htmlFor="channels-create-status"
              >
                <select
                  id="channels-create-status"
                  className="settings-select"
                  value={createDraft.status}
                  onChange={(event) => {
                    setCreateDraft((current) => ({
                      ...current,
                      status: event.target.value as ChannelAccountStatus
                    }));
                  }}
                >
                  {CHANNEL_STATUS_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {getAccountStatusLabel(item)}
                    </option>
                  ))}
                </select>
              </ModalField>

              <ModalField
                label={t("settings.channelsFieldConnectionMode")}
                description={t("settings.channelsFieldConnectionModeDescription")}
              >
                <div className="settings-channels-fixed-field">
                  <strong>{getConnectionModeLabel(CHANNEL_FIXED_CONNECTION_MODE)}</strong>
                  <span>{t("settings.channelsConnectionModeFixedHint")}</span>
                </div>
              </ModalField>
            </div>

            <ModalActions align="between">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setCreateWizardStep(createSelectedPlatformIsWechatClaw ? "platform" : "config")}
              >
                {createSelectedPlatformIsWechatClaw
                  ? t("settings.channelsWizardBackToPlatform")
                  : t("settings.channelsWizardBackToConfig")}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={createPendingAction === "save"}
                onClick={() => {
                  void handleCreateAccount();
                }}
              >
                {createPendingAction === "save"
                  ? t("settings.channelsActionPending")
                  : t("settings.channelsCreateAction")}
              </button>
            </ModalActions>
          </>
        ) : null}
      </ModalSection>
    </div>
  );

  const modalBody = (
    <div className="settings-channels-modal-layout">
      {statusText ? <p className="settings-channels-status">{statusText}</p> : null}
      {panelError ? <p className="settings-channels-error">{panelError}</p> : null}
      {summaryCards}
      {platform.isMobile ? (
        <ModalActions className="settings-channels-inline-actions">
          {manageActions}
        </ModalActions>
      ) : null}

      <ModalSection
        heading={t("settings.channelsAccountsTitle")}
        description={t("settings.channelsAccountsDescription")}
      >
        {loading && accounts.length === 0 ? (
          <ModalEmptyState compact title={t("settings.channelsLoading")} />
        ) : null}

        {!loading && accounts.length === 0 ? (
          <ModalEmptyState
            title={t("settings.channelsAccountsEmpty")}
            description={t("settings.channelsAccountsEmptyDescription")}
            action={(
              <button className="secondary-button" type="button" onClick={handleOpenCreateModal}>
                {t("settings.channelsAddAccountAction")}
              </button>
            )}
          />
        ) : null}

        {accounts.length > 0 ? (
          <ModalList className="settings-channels-account-list">
            {accounts.map((item) => (
              <ModalListItem
                key={item.id}
                as="button"
                selected={activeAccountId === item.id}
                className="settings-channels-account-item"
                label={item.displayName}
                description={t("settings.channelsAccountRowDescription", {
                  platform: item.capability.displayName,
                  provider: getProviderLabel(item.providerId),
                  mode: getConnectionModeLabel(item.connectionMode)
                })}
                trailing={(
                  <div className="settings-channels-account-tags">
                    <ModalTag tone={getAccountStatusTone(item.status)}>
                      {getAccountStatusLabel(item.status)}
                    </ModalTag>
                    <ModalTag>{getProviderLabel(item.providerId)}</ModalTag>
                  </div>
                )}
                onClick={() => handleSelectAccount(item)}
              >
                <div className="settings-channels-record-meta">
                  <span>
                    {t("settings.channelsThreadsTitle")}: {item.threadCount}
                  </span>
                  <span>
                    {t("settings.channelsEventsTitle")}: {item.inboundEventCount}
                  </span>
                  <span>
                    {t("settings.channelsDeliveriesTitle")}: {item.deliveryCount}
                  </span>
                </div>
              </ModalListItem>
            ))}
          </ModalList>
        ) : null}
      </ModalSection>

      {activeAccount ? (
        <>
          <ModalSection
            heading={t("settings.channelsDetailTitle")}
            description={t("settings.channelsDetailDescription")}
            actions={(
              <ModalActions className="settings-channels-inline-actions">
                {showProbeAndPollActions ? (
                  <>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={pendingAction !== null}
                      onClick={() => {
                        void handleProbe();
                      }}
                    >
                      {pendingAction === "probe"
                        ? t("settings.channelsActionPending")
                        : t("settings.channelsProbeAction")}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={pendingAction !== null}
                      onClick={() => {
                        void handlePoll();
                      }}
                    >
                      {pendingAction === "poll"
                        ? t("settings.channelsActionPending")
                        : t("settings.channelsPollAction")}
                    </button>
                  </>
                ) : null}
                {showRemoveConfirmation ? (
                  <>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={pendingAction !== null}
                      onClick={() => {
                        setPendingRemovalAccountId(null);
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      className="settings-button settings-button-danger"
                      type="button"
                      disabled={pendingAction !== null}
                      onClick={() => {
                        void handleRemoveAccount();
                      }}
                    >
                      {pendingAction === "remove-account"
                        ? t("settings.channelsActionPending")
                        : t("settings.channelsRemoveConfirmAction")}
                    </button>
                  </>
                ) : (
                  <button
                    className="settings-button settings-button-danger"
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => {
                      if (activeAccount) {
                        setPendingRemovalAccountId(activeAccount.id);
                      }
                    }}
                  >
                    {t("settings.channelsRemoveAction")}
                  </button>
                )}
              </ModalActions>
            )}
          >
            <div className="settings-channels-detail-grid">
              <DetailCard label={t("settings.channelsDetailPlatform")} value={activeAccount.capability.displayName} />
              <DetailCard label={t("settings.channelsDetailProvider")} value={getProviderLabel(activeAccount.providerId)} />
              <DetailCard label={t("settings.channelsDetailConnectionMode")} value={getConnectionModeLabel(activeAccount.connectionMode)} />
              <DetailCard label={t("settings.channelsDetailStatus")} value={getAccountStatusLabel(activeAccount.status)} />
              <DetailCard label={t("settings.channelsDetailLastInbound")} value={formatTimestamp(activeAccount.lastInboundAt)} />
              <DetailCard label={t("settings.channelsDetailLastOutbound")} value={formatTimestamp(activeAccount.lastOutboundAt)} />
            </div>
            {activeAccount.lastError ? (
              <p className="settings-channels-inline-note">
                {t("settings.channelsDetailLastError")}: {activeAccount.lastError}
              </p>
            ) : null}
            {showRemoveConfirmation ? (
              <p className="settings-channels-inline-note">
                {t("settings.channelsRemoveConfirmDescription")}
              </p>
            ) : null}
          </ModalSection>

          {activeAccount.platformCode === "wechat-claw" ? (
            <ModalSection
              heading={t("settings.channelsWechatBindingTitle")}
              description={t("settings.channelsWechatBindingDescription")}
              actions={(
                <ModalActions className="settings-channels-inline-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => {
                      void runWechatClawLoginAction("start");
                    }}
                  >
                    {pendingAction === "wechat-start-login"
                      ? t("settings.channelsActionPending")
                      : activeWechatClawBindingState?.qrcodeUrl
                        ? t("settings.channelsWechatRestartBindingAction")
                        : t("settings.channelsWechatStartLoginAction")}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => {
                      void runWechatClawLoginAction("refresh");
                    }}
                  >
                    {pendingAction === "wechat-refresh-login"
                      ? t("settings.channelsActionPending")
                      : t("settings.channelsWechatRefreshLoginAction")}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => {
                      void runWechatClawLoginAction("logout");
                    }}
                  >
                    {pendingAction === "wechat-logout"
                      ? t("settings.channelsActionPending")
                      : t("settings.channelsWechatLogoutAction")}
                  </button>
                </ModalActions>
              )}
            >
              <div className="settings-channels-wechat-binding-entry">
                <div className="settings-channels-detail-grid">
                  <DetailCard
                    label={t("settings.channelsWechatLoginStatus")}
                    value={getWechatClawLoginStatusLabel(activeWechatClawBindingState?.loginStatus ?? "not_logged_in")}
                  />
                  <DetailCard
                    label={t("settings.channelsDetailConnectionMode")}
                    value={t("settings.channelsWechatBindingModeValue")}
                  />
                  <DetailCard
                    label={t("settings.channelsMetaUpdatedAt")}
                    value={formatTimestamp(activeWechatClawBindingState?.updatedAt ?? null)}
                  />
                </div>
                <p className="settings-channels-inline-note">
                  {activeWechatClawIsBound
                    ? t("settings.channelsWechatBoundDescription")
                    : t("settings.channelsWechatPendingDescription")}
                </p>
                {activeWechatClawBindingState?.lastDetail ? (
                  <p className="settings-channels-inline-note">{activeWechatClawBindingState.lastDetail}</p>
                ) : null}
                {!activeWechatClawIsBound ? (
                  <div className="settings-channels-wechat-qr-panel">
                    {activeWechatClawBindingState?.qrcodeUrl ? (
                      <>
                        <img
                          className="settings-channels-wechat-qr-image"
                          src={activeWechatClawBindingState.qrcodeUrl}
                          alt={t("settings.channelsWechatQrAlt")}
                        />
                        <p className="settings-channels-inline-note">{t("settings.channelsWechatQrHint")}</p>
                        <ModalActions className="settings-channels-inline-actions">
                          <a
                            className="secondary-button"
                            href={
                              activeWechatClawBindingState.qrcodeSourceUrl
                              ?? activeWechatClawBindingState.qrcodeUrl
                            }
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("settings.channelsWechatOpenQrLinkAction")}
                          </a>
                        </ModalActions>
                      </>
                    ) : (
                      <ModalEmptyState
                        compact
                        title={t("settings.channelsWechatQrEmpty")}
                        description={t("settings.channelsWechatQrEmptyDescription")}
                      />
                    )}
                    {activeWechatClawBindingState?.qrcodeText ? (
                      <ModalField
                        label={t("settings.channelsWechatQrRawTitle")}
                        description={t("settings.channelsWechatQrRawDescription")}
                      >
                        <textarea
                          className="settings-textarea settings-channels-textarea"
                          value={activeWechatClawBindingState.qrcodeText}
                          readOnly
                        />
                      </ModalField>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="settings-channels-platform-selected-notes">
                {activeAccount.capability.stageOneLimitations.map((line) => (
                  <p key={line} className="settings-channels-platform-limitations">
                    {line}
                  </p>
                ))}
              </div>
            </ModalSection>
          ) : null}

          <ModalSection
            heading={t("settings.channelsThreadsTitle")}
            description={t("settings.channelsThreadsDescription", {
              count: activeAccount.threadCount
            })}
          >
            {detailLoading ? <ModalEmptyState compact title={t("settings.channelsLoadingDetails")} /> : null}
            {!detailLoading && threads.length === 0 ? (
              <ModalEmptyState
                compact
                title={t("settings.channelsThreadsEmpty")}
                description={t("settings.channelsThreadsEmptyDescription")}
              />
            ) : null}
            {!detailLoading && threads.length > 0 ? (
              <ModalList compact>
                {threads.map((item) => (
                  <ModalListItem
                    key={item.id}
                    label={item.title || item.externalConversationKey}
                    description={t("settings.channelsThreadSummary", {
                      status: getThreadStatusLabel(item.status),
                      conversationKey: item.externalConversationKey
                    })}
                    trailing={(
                      <ModalTag tone={getThreadStatusTone(item.status)}>
                        {getThreadStatusLabel(item.status)}
                      </ModalTag>
                    )}
                  >
                    <div className="settings-channels-record-meta">
                      <span>{t("settings.channelsMetaCreatedAt")}: {formatTimestamp(item.createdAt)}</span>
                      <span>{t("settings.channelsMetaUpdatedAt")}: {formatTimestamp(item.updatedAt)}</span>
                      {item.externalUserId ? (
                        <span>{t("settings.channelsMetaExternalUser")}: {item.externalUserId}</span>
                      ) : null}
                    </div>
                  </ModalListItem>
                ))}
              </ModalList>
            ) : null}
          </ModalSection>

          <ModalSection
            heading={t("settings.channelsEventsTitle")}
            description={t("settings.channelsEventsDescription", {
              count: activeAccount.inboundEventCount
            })}
          >
            {detailLoading ? <ModalEmptyState compact title={t("settings.channelsLoadingDetails")} /> : null}
            {!detailLoading && events.length === 0 ? (
              <ModalEmptyState
                compact
                title={t("settings.channelsEventsEmpty")}
                description={t("settings.channelsEventsEmptyDescription")}
              />
            ) : null}
            {!detailLoading && events.length > 0 ? (
              <ModalList compact>
                {events.map((item) => (
                  <ModalListItem
                    key={item.id}
                    label={summarizeText(item.textContent)}
                    description={t("settings.channelsEventSummary", {
                      status: getInboundEventStatusLabel(item.status),
                      conversationKey: item.externalConversationKey
                    })}
                    trailing={(
                      <ModalTag tone={getInboundEventStatusTone(item.status)}>
                        {getInboundEventStatusLabel(item.status)}
                      </ModalTag>
                    )}
                  >
                    <div className="settings-channels-record-meta">
                      <span>{t("settings.channelsMetaReceivedAt")}: {formatTimestamp(item.receivedAt)}</span>
                      <span>{t("settings.channelsMetaEventId")}: {item.externalEventId}</span>
                      {item.errorMessage ? (
                        <span>{t("settings.channelsMetaError")}: {item.errorMessage}</span>
                      ) : null}
                    </div>
                  </ModalListItem>
                ))}
              </ModalList>
            ) : null}
          </ModalSection>

          <ModalSection
            heading={t("settings.channelsDeliveriesTitle")}
            description={t("settings.channelsDeliveriesDescription", {
              count: activeAccount.deliveryCount
            })}
          >
            {detailLoading ? <ModalEmptyState compact title={t("settings.channelsLoadingDetails")} /> : null}
            {!detailLoading && deliveries.length === 0 ? (
              <ModalEmptyState
                compact
                title={t("settings.channelsDeliveriesEmpty")}
                description={t("settings.channelsDeliveriesEmptyDescription")}
              />
            ) : null}
            {!detailLoading && deliveries.length > 0 ? (
              <ModalList compact>
                {deliveries.map((item) => (
                  <ModalListItem
                    key={item.id}
                    label={summarizeText(item.textContent)}
                    description={t("settings.channelsDeliverySummary", {
                      status: getDeliveryStatusLabel(item.status)
                    })}
                    trailing={(
                      <ModalTag tone={getDeliveryStatusTone(item.status)}>
                        {getDeliveryStatusLabel(item.status)}
                      </ModalTag>
                    )}
                  >
                    <div className="settings-channels-record-meta">
                      <span>{t("settings.channelsMetaCreatedAt")}: {formatTimestamp(item.createdAt)}</span>
                      {item.providerMessageRef ? (
                        <span>{t("settings.channelsMetaProviderRef")}: {item.providerMessageRef}</span>
                      ) : null}
                      {item.errorMessage ? (
                        <span>{t("settings.channelsMetaError")}: {item.errorMessage}</span>
                      ) : null}
                    </div>
                  </ModalListItem>
                ))}
              </ModalList>
            ) : null}
          </ModalSection>
        </>
      ) : null}
    </div>
  );

  const entrypointValue = t("settings.channelsEntrypointSummary", {
    accounts: accounts.length,
    platforms: activePlatformCount
  });

  return (
    <>
      <div className="settings-channels-entrypoint">
        <p className="settings-channels-entrypoint-note">
          {overviewLoaded ? entrypointValue : t("settings.channelsEntrypointPending")}
        </p>
        <button
          className="secondary-button"
          type="button"
          disabled={!accessToken}
          onClick={handleOpen}
        >
          {t("settings.channelsManageAction")}
        </button>
      </div>

      {platform.isMobile ? (
        <MobileSheet
          open={modalOpen}
          title={t("settings.channelsModalTitle")}
          height="full"
          kind="form"
          bodyClassName="settings-channels-sheet-body"
          footer={undefined}
          onClose={handleCloseManageModal}
        >
          <div className="settings-channels-modal-body">{modalBody}</div>
        </MobileSheet>
      ) : (
        <DesktopModal
          open={modalOpen}
          title={t("settings.channelsModalTitle")}
          size="xwide"
          layout="form"
          className="settings-channels-modal"
          bodyClassName="settings-channels-modal-body"
          headerActions={manageActions}
          onClose={handleCloseManageModal}
        >
          {modalBody}
        </DesktopModal>
      )}

      {platform.isMobile ? (
        <MobileSheet
          open={createModalOpen}
          title={t("settings.channelsAddAccountAction")}
          height="full"
          kind="form"
          bodyClassName="settings-channels-sheet-body"
          footer={undefined}
          onClose={handleCloseCreateModal}
        >
          <div className="settings-channels-modal-body">{createModalBody}</div>
        </MobileSheet>
      ) : (
        <DesktopModal
          open={createModalOpen}
          title={t("settings.channelsAddAccountAction")}
          size="wide"
          layout="form"
          className="settings-channels-modal"
          bodyClassName="settings-channels-modal-body"
          onClose={handleCloseCreateModal}
        >
          {createModalBody}
        </DesktopModal>
      )}

    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-channels-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-channels-detail-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WizardSteps({ currentStep }: { currentStep: ChannelWizardStep }) {
  const steps: Array<{ step: ChannelWizardStep; number: number; label: string }> = [
    { step: "platform", number: 1, label: t("settings.channelsWizardStepPlatform") },
    { step: "config", number: 2, label: t("settings.channelsWizardStepConfig") },
    { step: "binding", number: 3, label: t("settings.channelsWizardStepBinding") }
  ];

  const currentIndex = steps.findIndex((item) => item.step === currentStep);

  return (
    <div className="settings-channels-step-strip" aria-label={t("settings.channelsWizardStepsTitle")}>
      {steps.map((item, index) => (
        <div
          key={item.step}
          className="settings-channels-step-chip"
          data-state={
            index === currentIndex
              ? "current"
              : index < currentIndex
                ? "complete"
                : "pending"
          }
        >
          <span className="settings-channels-step-chip-badge">{item.number}</span>
          <span className="settings-channels-step-chip-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function PlatformSummaryCard({ platformCapability }: { platformCapability: ChannelPlatformCapabilityDto }) {
  return (
    <div className="settings-channels-platform-selected">
      <div className="settings-channels-platform-selected-head">
        <div className="settings-channels-platform-card-brand">
          <div className="settings-channels-platform-card-logo">
            <ChannelPlatformIcon code={platformCapability.code} width={40} height={40} aria-hidden="true" />
          </div>
          <div className="settings-channels-platform-card-copy">
            <strong>{platformCapability.displayName}</strong>
            <span>
              {t("settings.channelsPlatformSummary", {
                modes: getConnectionModeLabel(CHANNEL_FIXED_CONNECTION_MODE),
                multiSession: getMultiSessionSupportLabel(platformCapability.multiSessionSupportLevel)
              })}
            </span>
          </div>
        </div>
        <ModalTag tone={platformCapability.multiSessionSupportLevel === "supported" ? "success" : "warning"}>
          {getMultiSessionSupportLabel(platformCapability.multiSessionSupportLevel)}
        </ModalTag>
      </div>
      <div className="settings-channels-platform-selected-notes">
        {platformCapability.stageOneLimitations.map((line) => (
          <p key={line} className="settings-channels-platform-limitations">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function PlatformConfigChecklist({ platformCode }: { platformCode: ChannelPlatformCode }) {
  const checklist = PLATFORM_CONFIG_CHECKLISTS[platformCode];
  if (!checklist) {
    return null;
  }

  return (
    <div className="settings-channels-config-checklist">
      <div className="settings-channels-config-checklist-head">
        <strong>{t(checklist.titleKey)}</strong>
        <p className="settings-channels-inline-note">{t(checklist.summaryKey)}</p>
      </div>
      <ul className="settings-channels-config-checklist-list">
        {checklist.items.map((itemKey) => (
          <li key={itemKey}>{t(itemKey)}</li>
        ))}
      </ul>
    </div>
  );
}

function PlatformConfigUnavailableNotice({ platformCode }: { platformCode: ChannelPlatformCode }) {
  if (platformCode !== "wechat-claw") {
    return null;
  }

  return (
    <div className="settings-channels-config-unavailable">
      <strong>{t("settings.channelsConfigWechatUnavailableTitle")}</strong>
      <p className="settings-channels-inline-note">{t("settings.channelsConfigWechatUnavailableDescription")}</p>
    </div>
  );
}

interface WechatClawBindingState {
  loginStatus: WechatClawLoginStatus;
  qrcodeUrl: string | null;
  qrcodeSourceUrl: string | null;
  qrcodeText: string | null;
  lastDetail: string | null;
  updatedAt: string | null;
}

function readWechatClawBindingState(account: ChannelAccountSummaryDto): WechatClawBindingState {
  return {
    loginStatus: readWechatClawLoginStatus(account.runtimeState.wechatClawLoginStatus),
    qrcodeUrl: readRuntimeStateText(account.runtimeState.wechatClawQrCodeUrl),
    qrcodeSourceUrl: readRuntimeStateText(account.runtimeState.wechatClawQrCodeSourceUrl),
    qrcodeText: readRuntimeStateText(account.runtimeState.wechatClawQrCodeText),
    lastDetail: readRuntimeStateText(account.runtimeState.wechatClawLastDetail),
    updatedAt: readRuntimeStateText(account.runtimeState.wechatClawUpdatedAt)
  };
}

function readWechatClawLoginStatus(value: unknown): WechatClawLoginStatus {
  return value === "waiting_scan"
    || value === "scan_confirmed"
    || value === "active"
    || value === "expired"
    ? value
    : "not_logged_in";
}

function readRuntimeStateText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function createEmptyDraft(overrides: Partial<ChannelAccountDraft> = {}): ChannelAccountDraft {
  return {
    platformCode: "",
    displayName: "",
    providerId: "codex",
    status: "active",
    configValues: {},
    advancedConfigText: EMPTY_JSON_TEXT,
    ...overrides
  };
}

function replaceAccount(
  accounts: ChannelAccountSummaryDto[],
  nextAccount: ChannelAccountSummaryDto
): ChannelAccountSummaryDto[] {
  const existingIndex = accounts.findIndex((item) => item.id === nextAccount.id);

  if (existingIndex === -1) {
    return [nextAccount, ...accounts];
  }

  return accounts.map((item) => (item.id === nextAccount.id ? nextAccount : item));
}

function validateConfigStep(
  draft: ChannelAccountDraft,
  selectedPlatform: ChannelPlatformCapabilityDto | null
): { ok: true } | { ok: false; errorText: string } {
  if (!draft.platformCode || !selectedPlatform) {
    return {
      ok: false,
      errorText: t("settings.channelsValidationPlatform")
    };
  }

  const fieldError = validatePlatformFields(draft.platformCode, draft.configValues);
  if (fieldError) {
    return {
      ok: false,
      errorText: fieldError
    };
  }

  try {
    parseAdvancedConfig(draft.advancedConfigText);
  } catch {
    return {
      ok: false,
      errorText: t("settings.channelsValidationConfigJson")
    };
  }

  return { ok: true };
}

function validateDraft(
  draft: ChannelAccountDraft,
  selectedPlatform: ChannelPlatformCapabilityDto | null
):
  | {
      ok: true;
      input: {
        platformCode: ChannelPlatformCode;
        displayName: string;
        providerId: ButlerProfileProviderId;
        connectionMode: ChannelConnectionMode;
        status: ChannelAccountStatus;
        config: Record<string, unknown>;
      };
    }
  | { ok: false; errorText: string } {
  const configStepValidation = validateConfigStep(draft, selectedPlatform);
  if (!configStepValidation.ok) {
    return configStepValidation;
  }

  const displayName = draft.displayName.trim();
  if (!displayName) {
    return {
      ok: false,
      errorText: t("settings.channelsValidationDisplayName")
    };
  }

  const platformCode = draft.platformCode as ChannelPlatformCode;
  const advancedConfig = parseAdvancedConfig(draft.advancedConfigText);
  const config = buildConfigPayload(platformCode, draft.configValues, advancedConfig);

  return {
    ok: true,
    input: {
      displayName,
      platformCode,
      providerId: draft.providerId,
      connectionMode: CHANNEL_FIXED_CONNECTION_MODE,
      status: draft.status,
      config
    }
  };
}

function validatePlatformFields(
  platformCode: ChannelPlatformCode,
  configValues: Record<string, string>
): string | null {
  const fields = PLATFORM_CONFIG_FIELDS[platformCode] ?? [];
  const requiredField = fields.find((item) => item.required && !(configValues[item.key] ?? "").trim());

  if (!requiredField) {
    return null;
  }

  return t("settings.channelsValidationRequiredField", {
    field: t(requiredField.labelKey)
  });
}

function parseAdvancedConfig(value: string): Record<string, unknown> {
  if (!value.trim()) {
    return {};
  }

  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("advanced_config_must_be_object");
  }

  return { ...(parsed as Record<string, unknown>) };
}

function buildConfigPayload(
  platformCode: ChannelPlatformCode,
  configValues: Record<string, string>,
  advancedConfig: Record<string, unknown>
): Record<string, unknown> {
  const payload = { ...advancedConfig };

  for (const field of PLATFORM_CONFIG_FIELDS[platformCode] ?? []) {
    const nextValue = (configValues[field.key] ?? "").trim();
    if (nextValue) {
      payload[field.key] = nextValue;
    } else {
      delete payload[field.key];
    }
  }

  return payload;
}

function resolveChannelsError(
  error: unknown,
  action:
    | "loadOverview"
    | "loadDetails"
    | "save"
    | "probe"
    | "poll"
    | "remove"
    | "start"
    | "refresh"
    | "logout"
): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  switch (action) {
    case "save":
      return t("settings.channelsSaveFailed");
    case "probe":
      return t("settings.channelsProbeFailed");
    case "poll":
      return t("settings.channelsPollFailed");
    case "remove":
      return t("settings.channelsRemoveFailed");
    case "start":
    case "refresh":
    case "logout":
      return t("settings.channelsSaveFailed");
    case "loadDetails":
      return t("settings.channelsLoadDetailsFailed");
    default:
      return t("settings.channelsLoadFailed");
  }
}

function summarizeText(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 72) {
    return normalized || t("settings.channelsTextFallback");
  }

  return `${normalized.slice(0, 72)}...`;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return t("settings.channelsTimeUnknown");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getProviderLabel(providerId: ButlerProfileProviderId): string {
  return providerId === "claude-code" ? "Claude Code" : "Codex";
}

function getConnectionModeLabel(mode: ChannelConnectionMode): string {
  if (mode === "polling") {
    return t("settings.channelsConnectionModePolling");
  }

  if (mode === "bridge") {
    return t("settings.channelsConnectionModeBridge");
  }

  return t("settings.channelsConnectionModeWebhook");
}

function getMultiSessionSupportLabel(level: ChannelMultiSessionSupportLevel): string {
  return level === "supported"
    ? t("settings.channelsMultiSessionSupported")
    : t("settings.channelsMultiSessionLimited");
}

function getAccountStatusLabel(status: ChannelAccountStatus): string {
  switch (status) {
    case "disabled":
      return t("settings.channelsStatusDisabled");
    case "degraded":
      return t("settings.channelsStatusDegraded");
    default:
      return t("settings.channelsStatusActive");
  }
}

function getAccountStatusTone(status: ChannelAccountStatus): "success" | "default" | "warning" {
  switch (status) {
    case "disabled":
      return "default";
    case "degraded":
      return "warning";
    default:
      return "success";
  }
}

function getThreadStatusLabel(status: ChannelThreadStatus): string {
  switch (status) {
    case "closed":
      return t("settings.channelsThreadStatusClosed");
    case "failed":
      return t("settings.channelsThreadStatusFailed");
    default:
      return t("settings.channelsThreadStatusActive");
  }
}

function getThreadStatusTone(status: ChannelThreadStatus): "success" | "danger" | "default" {
  switch (status) {
    case "failed":
      return "danger";
    case "closed":
      return "default";
    default:
      return "success";
  }
}

function getInboundEventStatusLabel(status: ChannelInboundEventStatus): string {
  switch (status) {
    case "dispatched":
      return t("settings.channelsEventStatusDispatched");
    case "replied":
      return t("settings.channelsEventStatusReplied");
    case "failed":
      return t("settings.channelsEventStatusFailed");
    case "ignored":
      return t("settings.channelsEventStatusIgnored");
    default:
      return t("settings.channelsEventStatusReceived");
  }
}

function getInboundEventStatusTone(
  status: ChannelInboundEventStatus
): "success" | "danger" | "default" | "accent" | "warning" {
  switch (status) {
    case "replied":
      return "success";
    case "failed":
      return "danger";
    case "ignored":
      return "warning";
    case "dispatched":
      return "accent";
    default:
      return "default";
  }
}

function getDeliveryStatusLabel(status: ChannelDeliveryStatus): string {
  switch (status) {
    case "failed":
      return t("settings.channelsDeliveryStatusFailed");
    case "skipped":
      return t("settings.channelsDeliveryStatusSkipped");
    default:
      return t("settings.channelsDeliveryStatusSent");
  }
}

function getDeliveryStatusTone(status: ChannelDeliveryStatus): "success" | "danger" | "default" {
  switch (status) {
    case "failed":
      return "danger";
    case "skipped":
      return "default";
    default:
      return "success";
  }
}

function getWechatClawLoginStatusLabel(status: WechatClawLoginStatus): string {
  switch (status) {
    case "waiting_scan":
      return t("settings.channelsWechatLoginStatusWaitingScan");
    case "scan_confirmed":
      return t("settings.channelsWechatLoginStatusScanConfirmed");
    case "active":
      return t("settings.channelsWechatLoginStatusActive");
    case "expired":
      return t("settings.channelsWechatLoginStatusExpired");
    case "not_logged_in":
    default:
      return t("settings.channelsWechatLoginStatusNotLoggedIn");
  }
}
