import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  ModalActions,
  ModalField,
  ModalSection
} from "../components/ModalAtoms";
import { WorkbenchModal } from "../features/conversation/components/WorkbenchModal";
import { usePlatform } from "../platform/platform-provider";
import type { PlatformOsFamily } from "../platform/platform-adapter";
import {
  disableTailscale,
  enableTailscale,
  fetchTailscaleStatus,
  loginTailscale,
  logoutTailscale,
  updateTailscaleConfig,
  type TailscaleStatusView
} from "../platform/server/tailscale-manager";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";
import {
  RemoteAccessActivationSwitch,
  RemoteAccessMetricCard,
  RemoteAccessMetricGrid
} from "./RemoteAccessPanelAtoms";

type PendingAction =
  | "refresh"
  | "save"
  | "install"
  | "enable"
  | "disable"
  | "login"
  | "logout"
  | "toggle-activation"
  | null;

interface TailscalePanelProps {
  readonly configMode?: "modal" | "inline";
}

export function TailscalePanel({ configMode = "modal" }: TailscalePanelProps) {
  const platform = usePlatform();
  const [status, setStatus] = useState<TailscaleStatusView | null>(null);
  const [controlServerUrlDraft, setControlServerUrlDraft] = useState("");
  const [hostnameDraft, setHostnameDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [awaitingInstallDetection, setAwaitingInstallDetection] = useState(false);
  const activeRef = useRef(true);
  const awaitingInstallDetectionRef = useRef(false);
  const loadStatusRef = useRef<(silent: boolean) => Promise<void>>(async () => undefined);
  const inlineConfig = configMode === "inline";
  const activated = status?.activated ?? false;

  awaitingInstallDetectionRef.current = awaitingInstallDetection;

  function applyLoadedStatus(nextStatus: TailscaleStatusView): void {
    setStatus(nextStatus);
    setControlServerUrlDraft(nextStatus.controlServerUrl ?? "");
    setHostnameDraft(nextStatus.hostname ?? "");
    setPanelError(null);

    if (!nextStatus.activated) {
      setAwaitingInstallDetection(false);
      setConfigModalOpen(false);
      return;
    }

    if (
      awaitingInstallDetectionRef.current &&
      !isTailscaleCliUnavailable(nextStatus.lastError)
    ) {
      setAwaitingInstallDetection(false);
    }
  }

  loadStatusRef.current = async (silent: boolean) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const nextStatus = await fetchTailscaleStatus();

      if (!activeRef.current) {
        return;
      }

      applyLoadedStatus(nextStatus);
    } catch (error) {
      if (!activeRef.current) {
        return;
      }

      setPanelError(resolvePanelError(error));
    } finally {
      if (activeRef.current && !silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    activeRef.current = true;
    void loadStatusRef.current(false);

    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!activated) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadStatusRef.current(true);
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activated]);

  useEffect(() => {
    if (!awaitingInstallDetection || !activated) {
      return;
    }

    function handleFocus() {
      void loadStatusRef.current(true);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void loadStatusRef.current(true);
      }
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activated, awaitingInstallDetection]);

  const configDirty =
    (status?.controlServerUrl ?? "") !== controlServerUrlDraft.trim()
    || (status?.hostname ?? "") !== hostnameDraft.trim();
  const cliUnavailable = activated && isTailscaleCliUnavailable(status?.lastError);
  const canInstallTailscale = activated && supportsTailscaleInstall(platform.ui.osFamily) && cliUnavailable;

  async function persistConfig(): Promise<TailscaleStatusView> {
    const nextStatus = await updateTailscaleConfig({
      controlServerUrl: normalizeTextInput(controlServerUrlDraft),
      hostname: normalizeTextInput(hostnameDraft)
    });
    applyLoadedStatus(nextStatus);
    return nextStatus;
  }

  async function handleActivationToggle(nextActivated: boolean): Promise<void> {
    setPendingAction("toggle-activation");
    setPanelError(null);

    try {
      const nextStatus = await updateTailscaleConfig({
        activated: nextActivated
      });
      applyLoadedStatus(nextStatus);
    } catch (error) {
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
      setLoading(false);
    }
  }

  async function runAction(action: Exclude<PendingAction, "refresh" | "save" | "toggle-activation">): Promise<void> {
    setPendingAction(action);
    setPanelError(null);

    try {
      if (configDirty && action !== "disable" && action !== "logout") {
        await persistConfig();
      }

      const nextStatus =
        action === "enable"
          ? await enableTailscale()
          : action === "disable"
            ? await disableTailscale()
            : action === "login"
              ? await loginTailscale()
              : await logoutTailscale();

      applyLoadedStatus(nextStatus);
    } catch (error) {
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSaveConfig(): Promise<void> {
    setPendingAction("save");
    setPanelError(null);

    try {
      await persistConfig();
      setConfigModalOpen(false);
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
      const nextStatus = await fetchTailscaleStatus();
      applyLoadedStatus(nextStatus);
    } catch (error) {
      setPanelError(resolvePanelError(error));
    } finally {
      setPendingAction(null);
      setLoading(false);
    }
  }

  async function handleInstallTailscale(): Promise<void> {
    const installUrl = resolveTailscaleInstallUrl(platform.ui.osFamily);

    if (!installUrl) {
      return;
    }

    setPendingAction("install");
    setPanelError(null);

    try {
      const result = await platform.bridge.openExternal(installUrl);

      if (!result.ok) {
        setPanelError(result.detail ?? t("settings.tailscaleInstallOpenFailed"));
        return;
      }

      setAwaitingInstallDetection(true);
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : t("settings.tailscaleInstallOpenFailed")
      );
    } finally {
      setPendingAction(null);
    }
  }

  function handleCloseConfigModal(): void {
    if (pendingAction === "save") {
      return;
    }

    setConfigModalOpen(false);
  }

  const statusValue = activated
    ? (
      <span
        className="settings-tailscale-status-indicator"
        data-tone={resolveTailscaleIndicatorTone(status?.phase ?? "disabled")}
      >
        <span className="settings-tailscale-status-dot" aria-hidden="true" />
        {resolveTailscalePhaseLabel(status?.phase ?? "disabled")}
      </span>
    )
    : t("settings.remoteAccessFeatureDisabledValue");

  return (
    <>
      <div className="settings-tailscale-panel">
        <ModalSection
          heading={t("settings.tailscaleSectionTitle")}
          description={t("settings.tailscaleSectionDescription")}
          actions={(
            <RemoteAccessActivationSwitch
              checked={activated}
              label={t("settings.tailscaleMasterSwitchLabel")}
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
                  label={t("settings.tailscaleStatusIndicator")}
                  value={statusValue}
                />
                <RemoteAccessMetricCard
                  label={t("settings.tailscaleServerAddress")}
                  value={activated ? (status?.reachableBaseUrl ?? t("settings.tailscaleUnavailable")) : t("settings.tailscaleUnavailable")}
                />
                <RemoteAccessMetricCard
                  label={t("settings.tailscaleAccountName")}
                  value={activated ? (status?.accountName ?? t("settings.tailscaleUnavailable")) : t("settings.tailscaleUnavailable")}
                />
                <RemoteAccessMetricCard
                  label={t("settings.tailscaleIpAddress")}
                  value={activated ? resolveIpAddress(status) : t("settings.tailscaleUnavailable")}
                />
              </RemoteAccessMetricGrid>

              {!activated ? (
                <p className="settings-remote-access-panel-note">
                  {t("settings.tailscaleActivationHint")}
                </p>
              ) : null}

              {activated && status?.phase === "needs_login" && status.loginUrl ? (
                <p className="settings-tailscale-login-url">
                  <a
                    className="settings-tailscale-link"
                    href={status.loginUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {status.loginUrl}
                  </a>
                </p>
              ) : null}

              {panelError || status?.lastError ? (
                <p className="settings-relay-tunnel-error">{panelError ?? status?.lastError}</p>
              ) : null}

              {activated ? (
                <ModalActions align="start">
                  {canInstallTailscale ? (
                    <button
                      className="settings-button"
                      type="button"
                      disabled={loading || pendingAction !== null}
                      onClick={() => {
                        void handleInstallTailscale();
                      }}
                    >
                      {pendingAction === "install"
                        ? t("common.loading")
                        : t("settings.tailscaleInstallAction")}
                    </button>
                  ) : null}
                  {!inlineConfig ? (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={loading || pendingAction !== null}
                      onClick={() => setConfigModalOpen(true)}
                    >
                      {t("settings.tailscaleConfigure")}
                    </button>
                  ) : null}
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={loading || pendingAction !== null}
                    onClick={() => {
                      void handleRefresh();
                    }}
                  >
                    {pendingAction === "refresh" ? t("common.loading") : t("settings.tailscaleRefresh")}
                  </button>
                  {status?.enabled ? (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={loading || pendingAction !== null || cliUnavailable}
                      onClick={() => {
                        void runAction("disable");
                      }}
                    >
                      {pendingAction === "disable" ? t("common.loading") : t("settings.tailscaleDisable")}
                    </button>
                  ) : (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={loading || pendingAction !== null || cliUnavailable}
                      onClick={() => {
                        void runAction("enable");
                      }}
                    >
                      {pendingAction === "enable" ? t("common.loading") : t("settings.tailscaleEnable")}
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={loading || pendingAction !== null || !status?.enabled || cliUnavailable}
                    onClick={() => {
                      void runAction("login");
                    }}
                  >
                    {pendingAction === "login" ? t("common.loading") : t("settings.tailscaleLogin")}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={loading || pendingAction !== null || !status?.enabled || cliUnavailable}
                    onClick={() => {
                      void runAction("logout");
                    }}
                  >
                    {pendingAction === "logout" ? t("common.loading") : t("settings.tailscaleLogout")}
                  </button>
                </ModalActions>
              ) : null}
            </>
          )}
        </ModalSection>

        {inlineConfig && activated ? (
          <ModalSection
            heading={t("settings.tailscaleConfigModalTitle")}
            description={t("settings.tailscaleConfigModalDescription")}
          >
            <TailscaleConfigForm
              controlServerUrlDraft={controlServerUrlDraft}
              hostnameDraft={hostnameDraft}
              pendingAction={pendingAction}
              configDirty={configDirty}
              onControlServerUrlChange={setControlServerUrlDraft}
              onHostnameChange={setHostnameDraft}
              onSave={() => {
                void handleSaveConfig();
              }}
            />
          </ModalSection>
        ) : null}
      </div>

      <WorkbenchModal
        open={!inlineConfig && activated && configModalOpen}
        title={t("settings.tailscaleConfigModalTitle")}
        description={t("settings.tailscaleConfigModalDescription")}
        size="regular"
        onClose={handleCloseConfigModal}
      >
        <TailscaleConfigForm
          controlServerUrlDraft={controlServerUrlDraft}
          hostnameDraft={hostnameDraft}
          pendingAction={pendingAction}
          configDirty={configDirty}
          footer={(
            <div className="settings-tailscale-modal-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={pendingAction === "save"}
                onClick={handleCloseConfigModal}
              >
                {t("common.cancel")}
              </button>
            </div>
          )}
          onControlServerUrlChange={setControlServerUrlDraft}
          onHostnameChange={setHostnameDraft}
          onSave={() => {
            void handleSaveConfig();
          }}
        />
      </WorkbenchModal>
    </>
  );
}

function TailscaleConfigForm({
  controlServerUrlDraft,
  hostnameDraft,
  pendingAction,
  configDirty,
  footer,
  onControlServerUrlChange,
  onHostnameChange,
  onSave
}: {
  readonly controlServerUrlDraft: string;
  readonly hostnameDraft: string;
  readonly pendingAction: PendingAction;
  readonly configDirty: boolean;
  readonly footer?: ReactNode;
  readonly onControlServerUrlChange: (value: string) => void;
  readonly onHostnameChange: (value: string) => void;
  readonly onSave: () => void;
}) {
  return (
    <>
      <div className="settings-tailscale-form">
        <ModalField label={t("settings.tailscaleControlServer")}>
          <input
            aria-label={t("settings.tailscaleControlServer")}
            className="settings-text-input"
            placeholder={t("settings.tailscaleControlServerPlaceholder")}
            value={controlServerUrlDraft}
            onChange={(event) => onControlServerUrlChange(event.target.value)}
          />
        </ModalField>

        <ModalField label={t("settings.tailscaleHostname")}>
          <input
            aria-label={t("settings.tailscaleHostname")}
            className="settings-text-input"
            placeholder={t("settings.tailscaleHostnamePlaceholder")}
            value={hostnameDraft}
            onChange={(event) => onHostnameChange(event.target.value)}
          />
        </ModalField>
      </div>

      <ModalActions align="start" className="settings-tailscale-config-actions">
        {footer}
        <button
          className="settings-button"
          type="button"
          disabled={pendingAction !== null || !configDirty}
          onClick={onSave}
        >
          {pendingAction === "save" ? t("common.loading") : t("common.save")}
        </button>
      </ModalActions>
    </>
  );
}

function normalizeTextInput(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolvePanelError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return error instanceof Error ? error.message : t("settings.tailscaleLoadFailed");
}

function resolveIpAddress(status: TailscaleStatusView | null): string {
  if (!status) {
    return t("settings.tailscaleUnavailable");
  }

  const addresses = [status.tailnetIpv4, status.tailnetIpv6].filter(
    (value): value is string => Boolean(value)
  );

  return addresses.length > 0 ? addresses.join(" / ") : t("settings.tailscaleUnavailable");
}

function resolveTailscalePhaseLabel(phase: TailscaleStatusView["phase"]): string {
  switch (phase) {
    case "blocked_uninitialized":
      return t("settings.tailscalePhaseBlockedUninitialized");
    case "starting":
      return t("settings.tailscalePhaseStarting");
    case "needs_login":
      return t("settings.tailscalePhaseNeedsLogin");
    case "running":
      return t("settings.tailscalePhaseRunning");
    case "stopping":
      return t("settings.tailscalePhaseStopping");
    case "error":
      return t("settings.tailscalePhaseError");
    case "disabled":
    default:
      return t("settings.tailscalePhaseDisabled");
  }
}

function isTailscaleCliUnavailable(detail: string | null | undefined): boolean {
  if (!detail) {
    return false;
  }

  return detail.includes("Tailscale CLI");
}

function supportsTailscaleInstall(osFamily: PlatformOsFamily): boolean {
  return osFamily === "macos" || osFamily === "windows";
}

function resolveTailscaleInstallUrl(osFamily: PlatformOsFamily): string | null {
  switch (osFamily) {
    case "macos":
      return "https://tailscale.com/download/mac";
    case "windows":
      return "https://tailscale.com/download/windows";
    default:
      return null;
  }
}

function resolveTailscaleIndicatorTone(
  phase: TailscaleStatusView["phase"]
): "green" | "yellow" | "gray" {
  switch (phase) {
    case "running":
      return "green";
    case "starting":
    case "needs_login":
    case "error":
      return "yellow";
    case "disabled":
    case "blocked_uninitialized":
    case "stopping":
    default:
      return "gray";
  }
}
