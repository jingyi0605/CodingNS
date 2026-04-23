import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  ModalActions,
  ModalField,
  ModalList,
  ModalListItem,
  ModalSection,
  ModalTag
} from "../components/ModalAtoms";
import { clientConfigStore } from "../config/client-config-store";
import {
  getActiveHost,
  getActiveHostBaseUrl,
  type HostRelayTunnelProfile
} from "../config/client-config-types";
import {
  resolveActiveConnectionRouteLabelKey,
  useActiveConnectionRouteSummary
} from "../config/active-connection-route";
import {
  canConfigureRelayControlBaseUrl,
  getFixedRelayControlBaseUrl,
  resolveRelayControlBaseUrl,
  safelyNormalizeRelayControlBaseUrl
} from "../config/relay-control-site-config";
import type { PlatformAdapter } from "../platform/platform-adapter";
import { usePlatform } from "../platform/platform-provider";
import {
  bindRelayTunnelControlHost,
  checkRelayTunnelHostLabelAvailability,
  disableRelayTunnel,
  enableRelayTunnel,
  fetchRelayTunnelTrafficWallet,
  fetchRelayTunnelStatus,
  loginRelayTunnelControl,
  logoutRelayTunnelControl,
  updateRelayTunnelConfig,
  type RelayControlHostLabelAvailability,
  type RelayTrafficWalletSummary,
  type RelayTunnelStatusView,
  unbindRelayTunnel
} from "../platform/server/relay-tunnel-manager";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";
import { useToast } from "../shared/toast";

type PendingAction =
  | "save-config"
  | "login-control"
  | "logout-control"
  | "check-host-label"
  | "enable"
  | "reconnect"
  | "disconnect-device"
  | "learn-service"
  | "manage-account"
  | null;

type HostLabelCheckState =
  | { status: "idle" }
  | { status: "checking"; hostLabel: string }
  | { status: "available"; hostLabel: string; tunnelDomain: string }
  | { status: "error"; hostLabel: string; message: string };

export function RelayTunnelPanel() {
  const platform = usePlatform();
  const { showToast } = useToast();
  const [status, setStatus] = useState<RelayTunnelStatusView | null>(null);
  const [hostLabelDraft, setHostLabelDraft] = useState("");
  const [controlBaseUrlDraft, setControlBaseUrlDraft] = useState(() => getFixedRelayControlBaseUrl());
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(() => canConfigureRelayControlBaseUrl());
  const [accountEmailDraft, setAccountEmailDraft] = useState("");
  const [accountPasswordDraft, setAccountPasswordDraft] = useState("");
  const [wallet, setWallet] = useState<RelayTrafficWalletSummary | null>(null);
  const [hostLabelCheckState, setHostLabelCheckState] = useState<HostLabelCheckState>({
    status: "idle"
  });
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const activeRef = useRef(true);
  const savedControlBaseUrl = resolveRelayControlBaseUrl(status?.controlBaseUrl);
  const normalizedControlBaseUrlDraft = safelyNormalizeRelayControlBaseUrl(controlBaseUrlDraft);
  const effectiveControlBaseUrl = normalizedControlBaseUrlDraft ?? savedControlBaseUrl;
  const runtimeControlBaseUrl = resolveRelayControlBaseUrl(
    normalizedControlBaseUrlDraft ?? status?.controlBaseUrl
  );
  const normalizedHostLabelDraft = hostLabelDraft.trim();
  const canSaveControlBaseUrl =
    normalizedControlBaseUrlDraft !== null
    && normalizedControlBaseUrlDraft !== savedControlBaseUrl;
  const activated = status?.activated ?? false;
  const canLoginControl =
    accountEmailDraft.trim().length > 0
    && accountPasswordDraft.trim().length > 0;
  const hasControlSession = Boolean(status?.controlAccountEmail);
  const hasValidatedHostLabel =
    status?.bindingId
    ? true
    : (
      hostLabelCheckState.status === "available"
      && hostLabelCheckState.hostLabel === normalizedHostLabelDraft
    );
  const canEnableTunnel =
    Boolean(status?.bindingId)
    || (
      hasControlSession
      && normalizedHostLabelDraft.length > 0
      && hasValidatedHostLabel
    );
  const boundAccessUrl = buildRelayTunnelPublicAccessUrl({
    controlBaseUrl: runtimeControlBaseUrl,
    tunnelDomain: status?.tunnelDomain,
    hostLabel: hostLabelDraft
  });
  const isAccountStepComplete = Boolean(status?.controlAccountEmail || status?.bindingId);
  const isHostLabelStepComplete = Boolean(status?.bindingId || hasValidatedHostLabel);
  const isTunnelReady = Boolean(status?.enabled && status?.bindingId);
  const canStartTunnel = Boolean(status?.bindingId) || canEnableTunnel;
  const trafficGrantedValue = wallet
    ? formatTrafficBytes(wallet.grantedBytes)
    : t("settings.tailscaleUnavailable");
  const trafficUsedValue = wallet
    ? formatTrafficBytes(wallet.usedBytes)
    : formatTrafficBytes(status?.trafficUsedBytes);
  const trafficRemainingValue = wallet
    ? formatTrafficBytes(wallet.remainingBytes)
    : formatTrafficBytes(status?.trafficRemainingBytes);
  const activeHostBaseUrl = getActiveHostBaseUrl(clientConfigStore.getState());
  const activeConnectionRoute = useActiveConnectionRouteSummary();
  const activeConnectionRouteLabel = activeConnectionRoute
    ? t(resolveActiveConnectionRouteLabelKey(activeConnectionRoute.kind))
    : null;
  const activeConnectionRouteHint = activeConnectionRoute
    ? resolveRelayTunnelClientRouteHint(activeConnectionRoute)
    : null;

  useEffect(() => {
    activeRef.current = true;
    void loadStatus(false);

    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!activated) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadStatus(true);
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activated]);

  useEffect(() => {
    if (!activated || !hasControlSession) {
      return;
    }

    void loadBillingData();
  }, [activated, hasControlSession]);

  useEffect(() => {
    if (status?.bindingId) {
      return;
    }

    if (hostLabelCheckState.status !== "idle" && hostLabelCheckState.hostLabel !== normalizedHostLabelDraft) {
      setHostLabelCheckState({
        status: "idle"
      });
    }
  }, [hostLabelCheckState, normalizedHostLabelDraft, status?.bindingId]);

  useEffect(() => {
    setControlBaseUrlDraft(savedControlBaseUrl);
  }, [savedControlBaseUrl]);

  async function loadStatus(
    silent: boolean,
    options?: {
      syncProfile?: boolean;
    }
  ): Promise<void> {
    if (!silent) {
      setLoading(true);
    }

    try {
      const nextStatus = await fetchRelayTunnelStatus();

      if (!activeRef.current) {
        return;
      }

      applyLoadedStatus(nextStatus, options);
      setStatusError(null);
    } catch (error) {
      if (activeRef.current) {
        setStatusError(resolveRelayTunnelScopedError(error, "status", activeHostBaseUrl));
      }
    } finally {
      if (activeRef.current && !silent) {
        setLoading(false);
      }
    }
  }

  function applyLoadedStatus(
    nextStatus: RelayTunnelStatusView,
    options?: {
      syncProfile?: boolean;
    }
  ): void {
    setStatus(nextStatus);
    setPanelError(null);

    if (!nextStatus.controlAccountEmail) {
      setWallet(null);
    }

    if (nextStatus.tunnelDomain && hostLabelDraft.trim().length === 0) {
      setHostLabelDraft(nextStatusHostLabel(nextStatus.tunnelDomain));
    }

    if (options?.syncProfile ?? true) {
      syncRelayTunnelProfile(nextStatus);
    }
  }

  async function loadBillingData(): Promise<void> {
    try {
      const walletResponse = await fetchRelayTunnelTrafficWallet();

      if (!activeRef.current) {
        return;
      }

      setWallet(walletResponse.wallet);
    } catch (error) {
      if (activeRef.current) {
        setPanelError(resolvePanelError(error));
      }
    }
  }

  async function handleLoginControl(): Promise<void> {
    if (!canLoginControl) {
      return;
    }

    setPendingAction("login-control");
    setPanelError(null);

    try {
      const nextStatus = await loginRelayTunnelControl({
        email: accountEmailDraft.trim(),
        password: accountPasswordDraft
      });
      setLoginError(null);
      applyLoadedStatus(nextStatus);
      await loadBillingData();
    } catch (error) {
      setLoginError(resolveRelayTunnelScopedError(error, "login", activeHostBaseUrl));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleLogoutControl(): Promise<void> {
    setPendingAction("logout-control");
    setPanelError(null);

    try {
      const nextStatus = await logoutRelayTunnelControl();
      applyLoadedStatus(nextStatus);
      setWallet(null);
      setHostLabelCheckState({
        status: "idle"
      });
    } catch (error) {
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function ensureHostLabelAvailability(): Promise<RelayControlHostLabelAvailability> {
    if (!normalizedHostLabelDraft) {
      throw new Error(t("settings.relayTunnelHostLabelRequired"));
    }

    if (
      hostLabelCheckState.status === "available"
      && hostLabelCheckState.hostLabel === normalizedHostLabelDraft
    ) {
      return {
        hostLabel: hostLabelCheckState.hostLabel,
        tunnelDomain: hostLabelCheckState.tunnelDomain,
        available: true,
        reason: "available"
      };
    }

    setHostLabelCheckState({
      status: "checking",
      hostLabel: normalizedHostLabelDraft
    });

    const response = await checkRelayTunnelHostLabelAvailability({
      hostLabel: normalizedHostLabelDraft
    });

    if (!response.available || !response.tunnelDomain) {
      const message = resolveHostLabelCheckMessage(response);
      setHostLabelCheckState({
        status: "error",
        hostLabel: normalizedHostLabelDraft,
        message
      });
      throw new Error(message);
    }

    setHostLabelCheckState({
      status: "available",
      hostLabel: normalizedHostLabelDraft,
      tunnelDomain: response.tunnelDomain
    });

    return response;
  }

  async function handleCheckHostLabel(): Promise<void> {
    if (!isAccountStepComplete || status?.bindingId) {
      return;
    }

    setPendingAction("check-host-label");
    setPanelError(null);

    try {
      await ensureHostLabelAvailability();
    } catch {
      // 字段下方已经展示了名称校验结果，这里不重复叠加全局错误。
    } finally {
      setPendingAction(null);
    }
  }

  async function handleLearnTunnelService(): Promise<void> {
    setPendingAction("learn-service");
    setPanelError(null);

    try {
      await openExternalUrl(platform.bridge.openExternal, runtimeControlBaseUrl);
    } catch (error) {
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleManageAccount(): Promise<void> {
    setPendingAction("manage-account");
    setPanelError(null);

    try {
      await openExternalUrl(platform.bridge.openExternal, runtimeControlBaseUrl);
    } catch (error) {
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCopyAccessUrl(): Promise<void> {
    if (!boundAccessUrl) {
      return;
    }

    try {
      await writeTextToClipboard(boundAccessUrl, platform);
      showToast({
        title: t("settings.relayTunnelAccessUrlCopied"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("settings.relayTunnelCopyAccessUrlFailed"),
        tone: "error"
      });
    }
  }

  async function handleOpenAccessUrl(): Promise<void> {
    if (!boundAccessUrl) {
      return;
    }

    try {
      await openExternalUrl(platform.bridge.openExternal, boundAccessUrl);
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("settings.relayTunnelOpenAccessUrlFailed"),
        tone: "error"
      });
    }
  }

  async function handleEnableTunnel(): Promise<void> {
    if (!canEnableTunnel) {
      return;
    }

    setPendingAction("enable");
    setPanelError(null);

    try {
      let nextStatus = status;

      if (!nextStatus?.activated) {
        nextStatus = await updateRelayTunnelConfig({
          activated: true,
          controlBaseUrl: effectiveControlBaseUrl
        });
        applyLoadedStatus(nextStatus);
      }

      if (!nextStatus?.bindingId) {
        await ensureHostLabelAvailability();
        nextStatus = await bindRelayTunnelControlHost({
          hostLabel: normalizedHostLabelDraft
        });
        applyLoadedStatus(nextStatus);
        await loadBillingData();
      }

      if (!nextStatus?.enabled) {
        const enabledStatus = await enableRelayTunnel();
        applyLoadedStatus(enabledStatus);
      }
    } catch (error) {
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleReconnectTunnel(): Promise<void> {
    if (!status?.bindingId) {
      return;
    }

    setPendingAction("reconnect");
    setPanelError(null);

    try {
      if (status?.enabled) {
        await disableRelayTunnel();
      }

      const enabledStatus = await enableRelayTunnel();
      applyLoadedStatus(enabledStatus);

      if (enabledStatus.controlAccountEmail) {
        await loadBillingData();
      }
    } catch (error) {
      const panelMessage = resolvePanelError(error);
      await loadStatus(true, { syncProfile: false });
      setPanelError(panelMessage);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDisconnectDevice(): Promise<void> {
    setPendingAction("disconnect-device");
    setPanelError(null);

    try {
      if (status?.bindingId || status?.accountId) {
        const unboundStatus = await unbindRelayTunnel();
        applyLoadedStatus(unboundStatus);
      }

      if (status?.activated) {
        const deactivatedStatus = await updateRelayTunnelConfig({
          activated: false
        });
        applyLoadedStatus(deactivatedStatus);
      }

      setWallet(null);
      setAccountEmailDraft("");
      setHostLabelDraft("");
      setAccountPasswordDraft("");
      setHostLabelCheckState({
        status: "idle"
      });
    } catch (error) {
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSaveControlBaseUrl(): Promise<void> {
    if (!normalizedControlBaseUrlDraft) {
      setConfigError(t("settings.serverInvalid"));
      return;
    }

    setPendingAction("save-config");
    setConfigError(null);

    try {
      const nextStatus = await updateRelayTunnelConfig({
        controlBaseUrl: normalizedControlBaseUrlDraft
      });
      setConfigError(null);
      applyLoadedStatus(nextStatus);
    } catch (error) {
      setConfigError(resolveRelayTunnelScopedError(error, "config", activeHostBaseUrl));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="settings-relay-tunnel-panel">
      {loading && !status ? (
        <ModalSection
          heading={t("settings.relayTunnelWizardTitle")}
          description={t("settings.relayTunnelWizardDescription")}
        >
          <p className="settings-remote-access-panel-note">{t("common.loading")}</p>
        </ModalSection>
      ) : null}

      {!loading && !isTunnelReady ? (
        <ModalSection
          heading={t("settings.relayTunnelWizardTitle")}
          description={t("settings.relayTunnelWizardDescription")}
          actions={(
            <button
              className="secondary-button"
              disabled={pendingAction !== null}
              type="button"
              onClick={() => void handleLearnTunnelService()}
            >
              {t("settings.relayTunnelLearnService")}
            </button>
          )}
        >
          {statusError ? (
            <RelayTunnelFeedbackBanner
              title={t("settings.relayTunnelStatusErrorTitle")}
              message={statusError}
              action={(
                <button
                  className="secondary-button"
                  disabled={loading || pendingAction !== null}
                  type="button"
                  onClick={() => void loadStatus(false)}
                >
                  {t("common.retry")}
                </button>
              )}
            />
          ) : null}
          <div className="settings-relay-tunnel-step-list">
            <section
              className="settings-relay-tunnel-step"
              data-state={resolveRelayTunnelStepState(isAccountStepComplete, true)}
            >
              <div className="settings-relay-tunnel-step-header">
                <span className="settings-relay-tunnel-step-badge">1</span>
                <div className="settings-relay-tunnel-step-copy">
                  <strong className="settings-relay-tunnel-step-title">
                    {t("settings.relayTunnelStepLoginTitle")}
                  </strong>
                  <p className="settings-relay-tunnel-step-description">
                    {t("settings.relayTunnelStepLoginDescription")}
                  </p>
                </div>
                <ModalTag className="settings-relay-tunnel-step-tag">
                  {t(resolveRelayTunnelStepStateLabel(isAccountStepComplete, true))}
                </ModalTag>
              </div>
              <div className="settings-relay-tunnel-step-body">
                {isAccountStepComplete ? (
                  <>
                    {status?.controlAccountEmail ? (
                      <p className="settings-relay-tunnel-success">
                        {t("settings.relayTunnelLoggedInAs", { email: status.controlAccountEmail })}
                      </p>
                    ) : (
                      <p className="settings-relay-tunnel-inline-note">
                        {t("settings.relayTunnelStepLoginConnected")}
                      </p>
                    )}
                    <ModalActions align="start">
                      <button
                        className="secondary-button"
                        disabled={pendingAction !== null}
                        type="button"
                        onClick={() => {
                          if (status?.bindingId) {
                            void handleDisconnectDevice();
                            return;
                          }

                          void handleLogoutControl();
                        }}
                      >
                        {t("common.logout")}
                      </button>
                    </ModalActions>
                  </>
                ) : (
                  <>
                    <div className="settings-relay-tunnel-form">
                      <ModalField label={t("settings.relayTunnelAccountEmail")}>
                        <input
                          aria-label={t("settings.relayTunnelAccountEmail")}
                          className="settings-text-input"
                          type="email"
                          value={accountEmailDraft}
                          onChange={(event) => {
                            setAccountEmailDraft(event.target.value);
                            setLoginError(null);
                          }}
                          placeholder={t("settings.relayTunnelAccountEmailPlaceholder")}
                        />
                      </ModalField>

                      <ModalField label={t("settings.relayTunnelAccountPassword")}>
                        <input
                          aria-label={t("settings.relayTunnelAccountPassword")}
                          className="settings-text-input"
                          type="password"
                          value={accountPasswordDraft}
                          onChange={(event) => {
                            setAccountPasswordDraft(event.target.value);
                            setLoginError(null);
                          }}
                          placeholder={t("settings.relayTunnelAccountPasswordPlaceholder")}
                        />
                      </ModalField>
                      {loginError ? (
                        <RelayTunnelFeedbackBanner
                          title={t("settings.relayTunnelLoginErrorTitle")}
                          message={loginError}
                        />
                      ) : null}
                      <ModalActions align="start">
                        <button
                          className="settings-button"
                          disabled={pendingAction !== null || !canLoginControl}
                          type="button"
                          onClick={() => void handleLoginControl()}
                        >
                          {pendingAction === "login-control"
                            ? t("common.loading")
                            : t("settings.relayTunnelLoginAccount")}
                        </button>
                        <button
                          className="secondary-button"
                          disabled={pendingAction !== null}
                          type="button"
                          onClick={() => {
                            setShowAdvancedSettings((value) => !value);
                            setConfigError(null);
                          }}
                        >
                          {showAdvancedSettings
                            ? t("settings.relayTunnelAdvancedSettingsHide")
                            : t("settings.relayTunnelAdvancedSettings")}
                        </button>
                      </ModalActions>
                      {showAdvancedSettings ? (
                        <div className="settings-relay-tunnel-inline-stack">
                          <ModalField
                            label={t("settings.relayTunnelControlBaseUrl")}
                            description={t("settings.relayTunnelServerAddressHint")}
                          >
                            <input
                              aria-label={t("settings.relayTunnelControlBaseUrl")}
                              className="settings-text-input"
                              type="url"
                              value={controlBaseUrlDraft}
                              onChange={(event) => {
                                setControlBaseUrlDraft(event.target.value);
                                setConfigError(null);
                              }}
                              placeholder={getFixedRelayControlBaseUrl()}
                            />
                          </ModalField>
                          <p className="settings-relay-tunnel-inline-note">
                            {t("settings.relayTunnelAdvancedSettingsDescription")}
                          </p>
                          {configError ? (
                            <RelayTunnelFeedbackBanner
                              title={t("settings.relayTunnelConfigErrorTitle")}
                              message={configError}
                            />
                          ) : null}
                          <ModalActions align="start">
                            <button
                              className="settings-button"
                              disabled={loading || pendingAction !== null || !canSaveControlBaseUrl}
                              type="button"
                              onClick={() => void handleSaveControlBaseUrl()}
                            >
                              {pendingAction === "save-config" ? t("common.loading") : t("common.save")}
                            </button>
                          </ModalActions>
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </section>

            <section
              className="settings-relay-tunnel-step"
              data-state={resolveRelayTunnelStepState(isHostLabelStepComplete, isAccountStepComplete)}
            >
              <div className="settings-relay-tunnel-step-header">
                <span className="settings-relay-tunnel-step-badge">2</span>
                <div className="settings-relay-tunnel-step-copy">
                  <strong className="settings-relay-tunnel-step-title">
                    {t("settings.relayTunnelStepHostLabelTitle")}
                  </strong>
                  <p className="settings-relay-tunnel-step-description">
                    {t("settings.relayTunnelStepHostLabelDescription")}
                  </p>
                </div>
                <ModalTag className="settings-relay-tunnel-step-tag">
                  {t(resolveRelayTunnelStepStateLabel(isHostLabelStepComplete, isAccountStepComplete))}
                </ModalTag>
              </div>
              <div className="settings-relay-tunnel-step-body">
                {!isAccountStepComplete ? (
                  <p className="settings-relay-tunnel-inline-note">
                    {t("settings.relayTunnelStepLocked")}
                  </p>
                ) : status?.bindingId ? (
                  <p className="settings-relay-tunnel-success">
                    {t("settings.relayTunnelHostLabelAvailable", {
                      domain: boundAccessUrl ?? status.tunnelDomain ?? t("settings.relayTunnelUnbound")
                    })}
                  </p>
                ) : (
                  <>
                    <div className="settings-relay-tunnel-domain-row">
                      <input
                        aria-label={t("settings.relayTunnelHostLabel")}
                        className="settings-text-input settings-relay-tunnel-domain-prefix"
                        value={hostLabelDraft}
                        onChange={(event) => setHostLabelDraft(event.target.value)}
                        placeholder={t("settings.relayTunnelHostLabelPlaceholder")}
                      />
                      <span className="settings-relay-tunnel-domain-suffix">
                        {t("settings.relayTunnelHostLabelSuffix")}
                      </span>
                      <button
                        className="settings-button settings-relay-tunnel-domain-check"
                        disabled={pendingAction !== null || normalizedHostLabelDraft.length === 0}
                        type="button"
                        onClick={() => void handleCheckHostLabel()}
                      >
                        {pendingAction === "check-host-label"
                          ? t("common.loading")
                          : t("settings.relayTunnelHostLabelCheck")}
                      </button>
                    </div>
                    <div className="settings-relay-tunnel-inline-stack">
                      {hostLabelCheckState.status === "available" && hostLabelCheckState.hostLabel === normalizedHostLabelDraft ? (
                        <p className="settings-relay-tunnel-success">
                          {t("settings.relayTunnelHostLabelAvailable", {
                            domain:
                              buildRelayTunnelPublicAccessUrl({
                                controlBaseUrl: effectiveControlBaseUrl,
                                tunnelDomain: hostLabelCheckState.tunnelDomain,
                                hostLabel: hostLabelCheckState.hostLabel
                              })
                              ?? hostLabelCheckState.tunnelDomain
                          })}
                        </p>
                      ) : null}
                      {hostLabelCheckState.status === "checking" && hostLabelCheckState.hostLabel === normalizedHostLabelDraft ? (
                        <p className="settings-relay-tunnel-inline-note">
                          {t("settings.relayTunnelHostLabelChecking")}
                        </p>
                      ) : null}
                      {hostLabelCheckState.status === "error" && hostLabelCheckState.hostLabel === normalizedHostLabelDraft ? (
                        <p className="settings-relay-tunnel-error">
                          {hostLabelCheckState.message}
                        </p>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </section>

            <section
              className="settings-relay-tunnel-step"
              data-state={resolveRelayTunnelStepState(isTunnelReady, isHostLabelStepComplete)}
            >
              <div className="settings-relay-tunnel-step-header">
                <span className="settings-relay-tunnel-step-badge">3</span>
                <div className="settings-relay-tunnel-step-copy">
                  <strong className="settings-relay-tunnel-step-title">
                    {t("settings.relayTunnelStepStartTitle")}
                  </strong>
                  <p className="settings-relay-tunnel-step-description">
                    {t("settings.relayTunnelStepStartDescription")}
                  </p>
                </div>
                <ModalTag className="settings-relay-tunnel-step-tag">
                  {t(resolveRelayTunnelStepStateLabel(isTunnelReady, isHostLabelStepComplete))}
                </ModalTag>
              </div>
              <div className="settings-relay-tunnel-step-body">
                {!isHostLabelStepComplete ? (
                  <p className="settings-relay-tunnel-inline-note">
                    {t("settings.relayTunnelStepLocked")}
                  </p>
                ) : (
                  <>
                    <p className="settings-relay-tunnel-inline-note">
                      {activated
                        ? t("settings.relayTunnelStepStartReady")
                        : t("settings.relayTunnelActivationHint")}
                    </p>
                    <ModalActions align="start">
                      <button
                        className="settings-button"
                        disabled={pendingAction !== null || !canStartTunnel}
                        type="button"
                        onClick={() => void handleEnableTunnel()}
                      >
                        {pendingAction === "enable"
                          ? t("common.loading")
                          : t("settings.relayTunnelStartAction")}
                      </button>
                    </ModalActions>
                  </>
                )}
              </div>
            </section>
          </div>

          <div className="settings-relay-tunnel-inline-stack">
            {activeConnectionRoute && activeConnectionRouteLabel && activeConnectionRouteHint ? (
              <RelayTunnelClientRouteSummary
                hint={activeConnectionRouteHint}
                label={activeConnectionRouteLabel}
                url={activeConnectionRoute.url}
              />
            ) : null}
            <p className="settings-relay-tunnel-inline-note">
              {t("settings.relayTunnelTrustBoundaryNotice")}
            </p>
            {status?.lastError ? (
              <p className="settings-relay-tunnel-error">
                {t("settings.relayTunnelRecentError", { message: status.lastError })}
              </p>
            ) : null}
            {panelError ? <p className="settings-relay-tunnel-error">{panelError}</p> : null}
          </div>
        </ModalSection>
      ) : null}

      {!loading && isTunnelReady ? (
        <ModalSection
          heading={t("settings.relayTunnelReadyTitle")}
          description={t("settings.relayTunnelReadyDescription")}
        >
          <ModalList compact>
            {activeConnectionRoute && activeConnectionRouteLabel ? (
              <>
                <SummaryLine
                  label={t("settings.relayTunnelClientRouteLabel")}
                  value={activeConnectionRouteLabel}
                />
                <SummaryLine
                  label={t("settings.relayTunnelClientRouteAddressLabel")}
                  value={activeConnectionRoute.url}
                />
              </>
            ) : null}
            <SummaryLine
              className="settings-relay-tunnel-summary-line-access-url"
              label={t("settings.relayTunnelAccessUrlLabel")}
              trailing={
                boundAccessUrl ? (
                  <div className="settings-relay-tunnel-access-url">
                    <span
                      className="settings-relay-tunnel-access-url-text"
                      title={boundAccessUrl}
                    >
                      {boundAccessUrl}
                    </span>
                    <span className="settings-relay-tunnel-access-url-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void handleCopyAccessUrl()}
                      >
                        {t("settings.relayTunnelCopyAccessUrl")}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void handleOpenAccessUrl()}
                      >
                        {t("settings.relayTunnelOpenAccessUrl")}
                      </button>
                    </span>
                  </div>
                ) : (
                  <span className="settings-relay-tunnel-summary-value">
                    {t("settings.relayTunnelUnbound")}
                  </span>
                )
              }
            />
            <SummaryLine label={t("settings.relayTunnelTrafficGranted")} value={trafficGrantedValue} />
            <SummaryLine label={t("settings.relayTunnelTrafficUsed")} value={trafficUsedValue} />
            <SummaryLine label={t("settings.relayTunnelTrafficRemaining")} value={trafficRemainingValue} />
          </ModalList>

          <ModalActions align="start" className="settings-relay-tunnel-ready-actions">
            <button
              className="secondary-button"
              disabled={pendingAction !== null || !status?.bindingId}
              type="button"
              onClick={() => void handleReconnectTunnel()}
            >
              {pendingAction === "reconnect"
                ? t("common.loading")
                : t("settings.relayTunnelReconnectAction")}
            </button>
            <button
              className="secondary-button"
              disabled={pendingAction !== null}
              type="button"
              onClick={() => void handleManageAccount()}
            >
              {pendingAction === "manage-account"
                ? t("common.loading")
                : t("settings.relayTunnelManageAccountAction")}
            </button>
            <button
              className="settings-button settings-button-danger"
              disabled={pendingAction !== null}
              type="button"
              onClick={() => void handleDisconnectDevice()}
            >
              {pendingAction === "disconnect-device"
                ? t("common.loading")
                : t("settings.relayTunnelDisconnectDeviceAction")}
            </button>
          </ModalActions>

          <div className="settings-relay-tunnel-inline-stack">
            {activeConnectionRoute && activeConnectionRouteLabel && activeConnectionRouteHint ? (
              <p className="settings-relay-tunnel-inline-note">{activeConnectionRouteHint}</p>
            ) : null}
            <p className="settings-relay-tunnel-inline-note">
              {t("settings.relayTunnelTrustBoundaryNotice")}
            </p>
            {status?.lastError ? (
              <p className="settings-relay-tunnel-error">
                {t("settings.relayTunnelRecentError", { message: status.lastError })}
              </p>
            ) : null}
            {panelError ? <p className="settings-relay-tunnel-error">{panelError}</p> : null}
          </div>
        </ModalSection>
      ) : null}
    </div>
  );

  function syncRelayTunnelProfile(nextStatus: RelayTunnelStatusView | null): void {
    const runtimeConfig = clientConfigStore.getState();
    const activeHost = getActiveHost(runtimeConfig);

    if (!activeHost) {
      return;
    }

    const nextProfile = buildRelayTunnelProfile(nextStatus);

    if (equalRelayTunnelProfile(activeHost.relayTunnel ?? null, nextProfile)) {
      return;
    }

    void clientConfigStore.update({
      hosts: runtimeConfig.hosts.map((host) =>
        host.id === activeHost.id
          ? {
              ...host,
              relayTunnel: nextProfile,
              updatedAt: new Date().toISOString()
            }
          : host
      )
    });
  }

  function buildRelayTunnelProfile(
    nextStatus: RelayTunnelStatusView | null
  ): HostRelayTunnelProfile | null {
    if (!nextStatus?.bindingId || !nextStatus.tunnelDomain) {
      return null;
    }

    return {
      provider: "codingns_relay",
      enabled: nextStatus.enabled,
      tunnelDomain: nextStatus.tunnelDomain.trim().toLowerCase(),
      controlBaseUrl: resolveRelayControlBaseUrl(nextStatus.controlBaseUrl),
      bindingId: nextStatus.bindingId,
      hostFingerprint: nextStatus.hostFingerprint,
      candidateEndpoints: nextStatus.candidateEndpoints
    };
  }
}

function RelayTunnelClientRouteSummary({
  label,
  url,
  hint
}: {
  label: string;
  url: string;
  hint: string;
}) {
  return (
    <>
      <ModalList compact>
        <SummaryLine label={t("settings.relayTunnelClientRouteLabel")} value={label} />
        <SummaryLine label={t("settings.relayTunnelClientRouteAddressLabel")} value={url} />
      </ModalList>
      <p className="settings-relay-tunnel-inline-note">{hint}</p>
    </>
  );
}

function SummaryLine({
  label,
  value,
  trailing,
  className
}: {
  label: string;
  value?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <ModalListItem
      className={className}
      label={label}
      trailing={
        trailing ?? <span className="settings-relay-tunnel-summary-value">{value}</span>
      }
    />
  );
}

function resolveRelayTunnelClientRouteHint(
  summary: NonNullable<ReturnType<typeof useActiveConnectionRouteSummary>>
): string {
  if (summary.probeInProgress) {
    return t("settings.relayTunnelClientRouteHintRelayProbing");
  }

  switch (summary.kind) {
    case "relay":
      return t("settings.relayTunnelClientRouteHintRelay");
    case "lan":
      return t("settings.relayTunnelClientRouteHintLan");
    case "loopback":
      return t("settings.relayTunnelClientRouteHintLoopback");
    case "tailscale":
      return t("settings.relayTunnelClientRouteHintTailscale");
    default:
      return t("settings.relayTunnelClientRouteHintDirect");
  }
}

function RelayTunnelFeedbackBanner({
  title,
  message,
  action
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="settings-relay-tunnel-feedback-banner" role="alert">
      <div className="settings-relay-tunnel-feedback-copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      {action ? <div className="settings-relay-tunnel-feedback-action">{action}</div> : null}
    </div>
  );
}

function resolveRelayTunnelStepState(done: boolean, unlocked: boolean): "done" | "current" | "pending" {
  if (done) {
    return "done";
  }

  return unlocked ? "current" : "pending";
}

function resolveRelayTunnelStepStateLabel(done: boolean, unlocked: boolean): string {
  if (done) {
    return "settings.relayTunnelStepDone";
  }

  return unlocked
    ? "settings.relayTunnelStepCurrent"
    : "settings.relayTunnelStepPending";
}

function resolveHostLabelCheckMessage(result: RelayControlHostLabelAvailability): string {
  switch (result.reason) {
    case "reserved":
      return t("settings.relayTunnelHostLabelReserved");
    case "occupied":
      return t("settings.relayTunnelHostLabelOccupied");
    case "available":
      return result.tunnelDomain
        ? t("settings.relayTunnelHostLabelAvailable", { domain: result.tunnelDomain })
        : t("settings.relayTunnelHostLabelUnavailable");
    default:
      return t("settings.relayTunnelHostLabelUnavailable");
  }
}

function resolvePanelError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return t("settings.relayTunnelLoadFailed");
}

function resolveRelayTunnelScopedError(
  error: unknown,
  scope: "status" | "config" | "login",
  hostBaseUrl: string | null
): string {
  if (error instanceof ApiError && error.errorCode === "NETWORK_ERROR") {
    const address = hostBaseUrl?.trim() || t("common.unknown");

    if (scope === "login") {
      return t("settings.relayTunnelLoginNetworkError", { address });
    }

    if (scope === "config") {
      return t("settings.relayTunnelConfigNetworkError", { address });
    }

    return t("settings.relayTunnelStatusNetworkError", { address });
  }

  return resolvePanelError(error);
}

function formatTrafficBytes(value: string | null | undefined): string {
  if (!value) {
    return t("settings.tailscaleUnavailable");
  }

  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${value} B`;
  }

  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function nextStatusHostLabel(tunnelDomain: string | null | undefined): string {
  if (!tunnelDomain) {
    return t("common.unknown");
  }

  return tunnelDomain.split(".")[0] || t("common.unknown");
}

function buildRelayTunnelPublicAccessUrl(input: {
  controlBaseUrl: string | null | undefined;
  tunnelDomain: string | null | undefined;
  hostLabel?: string | null | undefined;
}): string | null {
  const hostLabel = normalizeTunnelHostLabel(input.hostLabel)
    ?? normalizeTunnelHostLabel(nextStatusHostLabel(input.tunnelDomain));

  if (!hostLabel) {
    return input.tunnelDomain?.trim() ?? null;
  }

  const controlBaseUrl = input.controlBaseUrl?.trim();

  if (!controlBaseUrl) {
    return input.tunnelDomain?.trim() ?? null;
  }

  try {
    const accessUrl = new URL(controlBaseUrl);
    accessUrl.hostname = `${hostLabel}.${accessUrl.hostname}`;
    accessUrl.pathname = "/";
    accessUrl.search = "";
    accessUrl.hash = "";
    return accessUrl.origin;
  } catch {
    return input.tunnelDomain?.trim() ?? null;
  }
}

function normalizeTunnelHostLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized || normalized === t("common.unknown").toLowerCase()) {
    return null;
  }

  return normalized;
}

async function openExternalUrl(
  openExternal: (url: string) => Promise<{ ok: boolean; detail?: string }>,
  url: string
): Promise<void> {
  const result = await openExternal(url);

  if (!result.ok && typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function copyTextWithExecCommand(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const execCommand = document.execCommand?.bind(document);

  if (typeof execCommand !== "function") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    return execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

async function writeTextToClipboard(text: string, platform: PlatformAdapter): Promise<void> {
  if (platform.bridge.supported) {
    try {
      const result = await platform.bridge.writeClipboardText(text);

      if (result.ok) {
        return;
      }
    } catch {
      // 桌面桥接失败时继续尝试浏览器回退，不把复制做成死路。
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 某些 WebView 会拒绝 clipboard API，继续走同步老回退。
    }
  }

  if (copyTextWithExecCommand(text)) {
    return;
  }

  throw new Error(t("settings.relayTunnelCopyAccessUrlFailed"));
}

function equalRelayTunnelProfile(
  left: HostRelayTunnelProfile | null,
  right: HostRelayTunnelProfile | null
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.provider === right.provider
    && left.enabled === right.enabled
    && left.tunnelDomain === right.tunnelDomain
    && left.controlBaseUrl === right.controlBaseUrl
    && (left.bindingId ?? null) === (right.bindingId ?? null)
    && (left.hostFingerprint ?? null) === (right.hostFingerprint ?? null)
    && JSON.stringify(left.candidateEndpoints ?? []) === JSON.stringify(right.candidateEndpoints ?? [])
  );
}
