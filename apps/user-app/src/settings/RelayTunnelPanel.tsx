import { useEffect, useRef, useState } from "react";

import {
  ModalActions,
  ModalField,
  ModalList,
  ModalListItem,
  ModalSection,
  ModalTag
} from "../components/ModalAtoms";
import { clientConfigStore } from "../config/client-config-store";
import { getActiveHost, type HostRelayTunnelProfile } from "../config/client-config-types";
import { usePlatform } from "../platform/platform-provider";
import {
  bindRelayControlHost,
  bindRelayTunnelHost,
  createRelayCheckoutSession,
  disableRelayTunnel,
  enableRelayTunnel,
  ensureRelayTunnelIdentity,
  fetchRelayTrafficOrders,
  fetchRelayTrafficPackages,
  fetchRelayTrafficWallet,
  fetchRelayTunnelStatus,
  loginRelayControlByEmail,
  updateRelayTunnelConfig,
  type RelayTrafficOrderSummary,
  type RelayTrafficPackage,
  type RelayTrafficWalletSummary,
  type RelayTunnelStatusView,
  unbindRelayTunnel
} from "../platform/server/relay-tunnel-manager";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";
import {
  RemoteAccessActivationSwitch,
  RemoteAccessMetricCard,
  RemoteAccessMetricGrid
} from "./RemoteAccessPanelAtoms";

type PendingAction =
  | "refresh"
  | "save-config"
  | "login-control"
  | "enable"
  | "disable"
  | "unbind"
  | "checkout"
  | "toggle-activation"
  | null;

interface RelayControlSessionState {
  accessToken: string;
  accountId: string;
  email: string;
}

const DEFAULT_RELAY_TUNNEL_CONTROL_BASE_URL = "https://channel.codingns.com/";

export function RelayTunnelPanel() {
  const platform = usePlatform();
  const [status, setStatus] = useState<RelayTunnelStatusView | null>(null);
  const [hostLabelDraft, setHostLabelDraft] = useState(() => t("settings.relayTunnelHostLabelDefault"));
  const [accountEmailDraft, setAccountEmailDraft] = useState("");
  const [accountPasswordDraft, setAccountPasswordDraft] = useState("");
  const [controlSession, setControlSession] = useState<RelayControlSessionState | null>(null);
  const [wallet, setWallet] = useState<RelayTrafficWalletSummary | null>(null);
  const [packages, setPackages] = useState<RelayTrafficPackage[]>([]);
  const [orders, setOrders] = useState<RelayTrafficOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const activeRef = useRef(true);
  const defaultHostLabel = t("settings.relayTunnelHostLabelDefault");
  const effectiveControlBaseUrl =
    status?.controlBaseUrl?.trim() || DEFAULT_RELAY_TUNNEL_CONTROL_BASE_URL;
  const activated = status?.activated ?? false;
  const canUseSavedSession =
    controlSession !== null
    && (accountEmailDraft.trim().length === 0 || controlSession.email === accountEmailDraft.trim());
  const canManageBilling =
    controlSession !== null
    || (
      accountEmailDraft.trim().length > 0
      && accountPasswordDraft.trim().length > 0
    );
  const canLoginControl =
    accountEmailDraft.trim().length > 0
    && accountPasswordDraft.trim().length > 0;
  const canEnableTunnel =
    Boolean(status?.bindingId)
    || (
      accountEmailDraft.trim().length > 0
      && accountPasswordDraft.trim().length > 0
      && hostLabelDraft.trim().length > 0
    );

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
    if (!activated || !controlSession || !effectiveControlBaseUrl) {
      return;
    }

    void loadBillingData(effectiveControlBaseUrl, controlSession.accessToken);
  }, [activated, controlSession, effectiveControlBaseUrl]);

  async function loadStatus(silent: boolean): Promise<void> {
    if (!silent) {
      setLoading(true);
    }

    try {
      const nextStatus = await fetchRelayTunnelStatus();

      if (!activeRef.current) {
        return;
      }

      applyLoadedStatus(nextStatus);
    } catch (error) {
      if (activeRef.current) {
        setPanelError(resolvePanelError(error));
      }
    } finally {
      if (activeRef.current && !silent) {
        setLoading(false);
      }
    }
  }

  function applyLoadedStatus(nextStatus: RelayTunnelStatusView): void {
    setStatus(nextStatus);
    setPanelError(null);

    if (nextStatus.tunnelDomain && hostLabelDraft === defaultHostLabel) {
      setHostLabelDraft(nextStatus.tunnelDomain.split(".")[0] || defaultHostLabel);
    }

    syncRelayTunnelProfile(nextStatus);
  }

  async function loadBillingData(controlBaseUrl: string, accessToken: string): Promise<void> {
    try {
      const [walletResponse, packagesResponse, ordersResponse] = await Promise.all([
        fetchRelayTrafficWallet({
          controlBaseUrl,
          accessToken
        }),
        fetchRelayTrafficPackages(controlBaseUrl),
        fetchRelayTrafficOrders({
          controlBaseUrl,
          accessToken
        })
      ]);

      if (!activeRef.current) {
        return;
      }

      setWallet(walletResponse.wallet);
      setPackages(packagesResponse.packages);
      setOrders(ordersResponse.orders);
    } catch (error) {
      if (activeRef.current) {
        setPanelError(resolvePanelError(error));
      }
    }
  }

  async function handleActivationToggle(nextActivated: boolean): Promise<void> {
    setPendingAction("toggle-activation");
    setPanelError(null);

    try {
      const nextStatus = await updateRelayTunnelConfig({
        activated: nextActivated,
        controlBaseUrl: nextActivated ? effectiveControlBaseUrl : undefined
      });

      if (!nextActivated) {
        setControlSession(null);
        setWallet(null);
        setPackages([]);
        setOrders([]);
      }

      applyLoadedStatus(nextStatus);
    } catch (error) {
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
      setLoading(false);
    }
  }

  async function ensureControlSession(): Promise<RelayControlSessionState> {
    if (canUseSavedSession && controlSession) {
      return controlSession;
    }

    if (!accountEmailDraft.trim() || !accountPasswordDraft.trim()) {
      throw new Error(t("settings.relayTunnelAccountRequired"));
    }

    const loginResponse = await loginRelayControlByEmail({
      controlBaseUrl: effectiveControlBaseUrl,
      email: accountEmailDraft.trim(),
      password: accountPasswordDraft
    });
    const nextSession = {
      accessToken: loginResponse.accessToken,
      accountId: loginResponse.account.accountId,
      email: loginResponse.account.email
    } satisfies RelayControlSessionState;

    setControlSession(nextSession);
    return nextSession;
  }

  async function handleLoginControl(): Promise<void> {
    if (!canLoginControl) {
      return;
    }

    setPendingAction("login-control");
    setPanelError(null);

    try {
      const nextControlSession = await ensureControlSession();
      await loadBillingData(effectiveControlBaseUrl, nextControlSession.accessToken);
    } catch (error) {
      setControlSession(null);
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
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

      if (!nextStatus?.bindingId) {
        const nextControlSession = await ensureControlSession();
        const identityStatus = await ensureRelayTunnelIdentity();

        if (!identityStatus.hostPublicKey || !identityStatus.hostKeyFingerprint) {
          throw new Error(t("settings.relayTunnelIdentityUnavailable"));
        }

        const bindResponse = await bindRelayControlHost({
          controlBaseUrl: effectiveControlBaseUrl,
          accessToken: nextControlSession.accessToken,
          hostLabel: hostLabelDraft.trim(),
          hostPublicKey: identityStatus.hostPublicKey,
          hostFingerprint: identityStatus.hostKeyFingerprint
        });
        nextStatus = await bindRelayTunnelHost({
          accountId: nextControlSession.accountId,
          bindingId: bindResponse.binding.bindingId,
          tunnelDomain: bindResponse.binding.tunnelDomain,
          relayBaseUrl: bindResponse.binding.relayBaseUrl,
          controlBaseUrl: bindResponse.binding.controlBaseUrl
        });
        applyLoadedStatus(nextStatus);
        await loadBillingData(effectiveControlBaseUrl, nextControlSession.accessToken);
      }

      if (!nextStatus?.enabled) {
        const enabledStatus = await enableRelayTunnel();
        applyLoadedStatus(enabledStatus);
      }
    } catch (error) {
      setControlSession(null);
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDisableTunnel(): Promise<void> {
    if (!status?.enabled) {
      return;
    }

    setPendingAction("disable");
    setPanelError(null);

    try {
      const nextStatus = await disableRelayTunnel();
      applyLoadedStatus(nextStatus);
    } catch (error) {
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRefresh(): Promise<void> {
    setPendingAction("refresh");
    setPanelError(null);

    try {
      await loadStatus(false);

      if (controlSession) {
        await loadBillingData(effectiveControlBaseUrl, controlSession.accessToken);
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCheckout(packageId: string): Promise<void> {
    setPendingAction("checkout");
    setPanelError(null);

    try {
      const nextControlSession = await ensureControlSession();
      const checkoutResponse = await createRelayCheckoutSession({
        controlBaseUrl: effectiveControlBaseUrl,
        accessToken: nextControlSession.accessToken,
        packageId
      });

      await openCheckoutUrl(platform.bridge.openExternal, checkoutResponse.checkoutUrl);
      await loadBillingData(effectiveControlBaseUrl, nextControlSession.accessToken);
    } catch (error) {
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleUnbind(): Promise<void> {
    setPendingAction("unbind");
    setPanelError(null);

    try {
      const nextStatus = await unbindRelayTunnel();
      applyLoadedStatus(nextStatus);
    } catch (error) {
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="settings-relay-tunnel-panel">
      <ModalSection
        heading={t("settings.relayTunnelStatus")}
        description={t("settings.relayTunnelDescription")}
        actions={(
          <RemoteAccessActivationSwitch
            checked={activated}
            label={t("settings.relayTunnelMasterSwitchLabel")}
            disabled={pendingAction !== null}
            onChange={(checked) => {
              void handleActivationToggle(checked);
            }}
          />
        )}
      >
        {loading && !status ? (
          <p className="settings-remote-access-panel-note">{t("common.loading")}</p>
        ) : (
          <>
            <RemoteAccessMetricGrid>
              <RemoteAccessMetricCard
                label={t("settings.relayTunnelPhase")}
                value={activated ? resolveRelayTunnelPhaseLabel(status?.phase ?? "disabled") : t("settings.remoteAccessFeatureDisabledValue")}
              />
              <RemoteAccessMetricCard
                label={t("settings.relayTunnelDomain")}
                value={status?.tunnelDomain ?? t("settings.relayTunnelUnbound")}
              />
              <RemoteAccessMetricCard
                label={t("settings.relayTunnelTrafficRemaining")}
                value={activated ? formatTrafficBytes(status?.trafficRemainingBytes) : t("settings.tailscaleUnavailable")}
              />
              <RemoteAccessMetricCard
                label={t("settings.relayTunnelHostFingerprint")}
                value={status?.hostKeyFingerprint ?? t("settings.tailscaleUnavailable")}
              />
            </RemoteAccessMetricGrid>

            {!activated ? (
              <p className="settings-remote-access-panel-note">
                {t("settings.relayTunnelActivationHint")}
              </p>
            ) : (
              <p className="settings-relay-tunnel-inline-note">
                {t("settings.relayTunnelTrustBoundaryNotice")}
              </p>
            )}

            {panelError ? <p className="settings-relay-tunnel-error">{panelError}</p> : null}
          </>
        )}
      </ModalSection>

      {activated ? (
        <ModalSection
          heading={t("settings.relayTunnelAccessTitle")}
          description={t("settings.relayTunnelAccessDescription")}
          actions={(
            <RelayTunnelSwitch
              checked={Boolean(status?.enabled)}
              label={t("settings.relayTunnelEnableToggleLabel")}
              disabled={pendingAction !== null || (!status?.enabled && !canEnableTunnel)}
              onChange={(checked) => {
                if (checked) {
                  void handleEnableTunnel();
                  return;
                }

                void handleDisableTunnel();
              }}
            />
          )}
        >
          <div className="settings-relay-tunnel-form">
            <ModalField label={t("settings.relayTunnelAccountEmail")}>
              <input
                aria-label={t("settings.relayTunnelAccountEmail")}
                className="settings-text-input"
                type="email"
                value={accountEmailDraft}
                onChange={(event) => setAccountEmailDraft(event.target.value)}
                placeholder={t("settings.relayTunnelAccountEmailPlaceholder")}
              />
            </ModalField>

            <ModalField label={t("settings.relayTunnelAccountPassword")}>
              <input
                aria-label={t("settings.relayTunnelAccountPassword")}
                className="settings-text-input"
                type="password"
                value={accountPasswordDraft}
                onChange={(event) => setAccountPasswordDraft(event.target.value)}
                placeholder={t("settings.relayTunnelAccountPasswordPlaceholder")}
              />
            </ModalField>

            <ModalField label={t("settings.relayTunnelHostLabel")}>
              <input
                aria-label={t("settings.relayTunnelHostLabel")}
                className="settings-text-input"
                value={hostLabelDraft}
                onChange={(event) => setHostLabelDraft(event.target.value)}
                placeholder={t("settings.relayTunnelHostLabelPlaceholder")}
              />
            </ModalField>
          </div>

          {controlSession || status?.bindingId ? (
            <ModalSection tone="accent">
              <div className="settings-relay-tunnel-inline-stack">
                <strong className="modal-section-heading">
                  {status?.enabled
                    ? t("settings.relayTunnelConnectedBannerActiveTitle")
                    : t("settings.relayTunnelConnectedBannerTitle")}
                </strong>
                <p className="modal-section-description">
                  {status?.enabled
                    ? t("settings.relayTunnelConnectedBannerActiveDescription")
                    : t("settings.relayTunnelConnectedBannerDescription")}
                </p>
              </div>
              <div className="settings-relay-tunnel-status-bar-meta">
                {controlSession ? (
                  <ModalTag className="settings-relay-tunnel-status-chip">
                    {t("settings.relayTunnelLoggedInAs", { email: controlSession.email })}
                  </ModalTag>
                ) : null}
                <ModalTag className="settings-relay-tunnel-status-chip">
                  {t("settings.relayTunnelConnectedDevice", { name: hostLabelDraft.trim() || defaultHostLabel })}
                </ModalTag>
                {status?.tunnelDomain ? (
                  <ModalTag className="settings-relay-tunnel-status-chip">
                    {t("settings.relayTunnelBoundDomain", { domain: status.tunnelDomain })}
                  </ModalTag>
                ) : null}
              </div>
            </ModalSection>
          ) : null}

          <ModalActions align="start" className="settings-relay-tunnel-actions">
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
              onClick={() => void handleRefresh()}
            >
              {t("settings.relayTunnelRefresh")}
            </button>
            <button
              className="secondary-button"
              disabled={pendingAction !== null || !status?.bindingId}
              type="button"
              onClick={() => void handleUnbind()}
            >
              {t("settings.relayTunnelUnbind")}
            </button>
          </ModalActions>
        </ModalSection>
      ) : null}

      {activated && wallet ? (
        <ModalSection
          heading={t("settings.relayTunnelWalletTitle")}
          description={t("settings.relayTunnelWalletDescription")}
        >
          <ModalList compact>
            <SummaryLine label={t("settings.relayTunnelTrafficGranted")} value={formatTrafficBytes(wallet.grantedBytes)} />
            <SummaryLine label={t("settings.relayTunnelTrafficUsed")} value={formatTrafficBytes(wallet.usedBytes)} />
            <SummaryLine label={t("settings.relayTunnelTrafficRemaining")} value={formatTrafficBytes(wallet.remainingBytes)} />
          </ModalList>
        </ModalSection>
      ) : null}

      {activated && packages.length > 0 ? (
        <ModalSection
          heading={t("settings.relayTunnelPackagesTitle")}
          description={t("settings.relayTunnelPackagesDescription")}
        >
          <ModalList compact>
            {packages.map((item) => (
              <ModalListItem
                key={item.packageId}
                label={item.name}
                description={`${item.description} · ${formatTrafficBytes(item.grantedBytes)} · ${formatMoney(item.currency, item.priceMinor)}`}
                trailing={(
                  <div className="settings-relay-tunnel-item-actions">
                    {item.featured ? <ModalTag>{t("settings.relayTunnelFeaturedPackage")}</ModalTag> : null}
                    <button
                      className="settings-button"
                      disabled={pendingAction !== null || !canManageBilling}
                      type="button"
                      onClick={() => void handleCheckout(item.packageId)}
                    >
                      {t("settings.relayTunnelBuyPackage")}
                    </button>
                  </div>
                )}
              />
            ))}
          </ModalList>
        </ModalSection>
      ) : null}

      {activated && orders.length > 0 ? (
        <ModalSection
          heading={t("settings.relayTunnelOrdersTitle")}
          description={t("settings.relayTunnelOrdersDescription")}
        >
          <ModalList compact>
            {orders.slice(0, 5).map((item) => (
              <ModalListItem
                key={item.orderId}
                label={item.packageName}
                description={`${resolveOrderStatusLabel(item.status)} · ${formatMoney(item.currency, item.amountMinor)} · ${formatTrafficBytes(item.grantedBytes)}`}
              />
            ))}
          </ModalList>
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
      controlBaseUrl: nextStatus.controlBaseUrl?.trim() || DEFAULT_RELAY_TUNNEL_CONTROL_BASE_URL
    };
  }
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <ModalListItem
      label={label}
      trailing={<span className="settings-relay-tunnel-summary-value">{value}</span>}
    />
  );
}

function RelayTunnelSwitch({
  checked,
  label,
  disabled,
  onChange
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className="settings-mobile-switch"
      aria-label={label}
      data-disabled={disabled ? "true" : undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }

        if (event.target instanceof HTMLInputElement) {
          return;
        }

        event.preventDefault();
        onChange(!checked);
      }}
    >
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="settings-mobile-switch-track" aria-hidden="true">
        <span className="settings-mobile-switch-thumb" />
      </span>
    </label>
  );
}

function resolveRelayTunnelPhaseLabel(phase: RelayTunnelStatusView["phase"]): string {
  switch (phase) {
    case "blocked_uninitialized":
      return t("settings.relayTunnelPhaseBlockedUninitialized");
    case "unbound":
      return t("settings.relayTunnelPhaseUnbound");
    case "binding":
      return t("settings.relayTunnelPhaseBinding");
    case "connecting":
      return t("settings.relayTunnelPhaseConnecting");
    case "running":
      return t("settings.relayTunnelPhaseRunning");
    case "quota_exhausted":
      return t("settings.relayTunnelPhaseQuotaExhausted");
    case "error":
      return t("settings.relayTunnelPhaseError");
    default:
      return t("settings.relayTunnelPhaseDisabled");
  }
}

function resolveOrderStatusLabel(status: RelayTrafficOrderSummary["status"]): string {
  switch (status) {
    case "paid":
      return t("settings.relayTunnelOrderPaid");
    case "expired":
      return t("settings.relayTunnelOrderExpired");
    case "failed":
      return t("settings.relayTunnelOrderFailed");
    default:
      return t("settings.relayTunnelOrderPending");
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

function formatMoney(currency: string, amountMinor: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase()
  }).format(amountMinor / 100);
}

async function openCheckoutUrl(
  openExternal: (url: string) => Promise<{ ok: boolean; detail?: string }>,
  checkoutUrl: string
): Promise<void> {
  const result = await openExternal(checkoutUrl);

  if (!result.ok && typeof window !== "undefined") {
    window.open(checkoutUrl, "_blank", "noopener,noreferrer");
  }
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
  );
}
