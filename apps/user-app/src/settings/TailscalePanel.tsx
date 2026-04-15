import { useEffect, useRef, useState, type ReactNode } from "react";

import { WorkbenchModal } from "../features/conversation/components/WorkbenchModal";
import { usePlatform } from "../platform/platform-provider";
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
import type { PlatformOsFamily } from "../platform/platform-adapter";

type PendingAction =
  | "refresh"
  | "save"
  | "install"
  | "enable"
  | "disable"
  | "login"
  | "logout"
  | null;

export function TailscalePanel() {
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

  awaitingInstallDetectionRef.current = awaitingInstallDetection;

  function applyLoadedStatus(nextStatus: TailscaleStatusView): void {
    setStatus(nextStatus);
    setControlServerUrlDraft(nextStatus.controlServerUrl ?? "");
    setHostnameDraft(nextStatus.hostname ?? "");
    setPanelError(null);

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

    // 第一阶段继续用轮询同步状态，先把状态真相稳定下来，不提前引入额外实时通道。
    void loadStatusRef.current(false);
    const timer = window.setInterval(() => {
      void loadStatusRef.current(true);
    }, 5000);

    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!awaitingInstallDetection) {
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
  }, [awaitingInstallDetection]);

  const configDirty =
    (status?.controlServerUrl ?? "") !== controlServerUrlDraft.trim()
    || (status?.hostname ?? "") !== hostnameDraft.trim();
  const cliUnavailable = isTailscaleCliUnavailable(status?.lastError);
  const canInstallTailscale = supportsTailscaleInstall(platform.ui.osFamily) && cliUnavailable;

  async function persistConfig(): Promise<TailscaleStatusView> {
    const nextStatus = await updateTailscaleConfig({
      controlServerUrl: normalizeTextInput(controlServerUrlDraft),
      hostname: normalizeTextInput(hostnameDraft)
    });
    applyLoadedStatus(nextStatus);
    return nextStatus;
  }

  async function runAction(action: Exclude<PendingAction, "refresh" | "save">): Promise<void> {
    setPendingAction(action);
    setPanelError(null);

    try {
      // 启用和绑定前先落盘配置，避免用户刚改完 control server 或 hostname 却没有真正生效。
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

      setStatus(nextStatus);
      setControlServerUrlDraft(nextStatus.controlServerUrl ?? "");
      setHostnameDraft(nextStatus.hostname ?? "");
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
      const nextStatus = await persistConfig();
      setStatus(nextStatus);
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

  return (
    <>
      <div className="settings-tailscale-panel">
        <div className="settings-release-card">
          <div className="settings-tailscale-summary">
            <SummaryRow
              label={t("settings.tailscaleStatusIndicator")}
              value={(
                <span
                  className="settings-tailscale-status-indicator"
                  data-tone={resolveTailscaleIndicatorTone(status?.phase ?? "disabled")}
                >
                  <span className="settings-tailscale-status-dot" aria-hidden="true" />
                  {resolveTailscalePhaseLabel(status?.phase ?? "disabled")}
                </span>
              )}
            />
            <SummaryRow
              label={t("settings.tailscaleServerAddress")}
              value={status?.reachableBaseUrl ?? t("settings.tailscaleUnavailable")}
              href={status?.reachableBaseUrl ?? undefined}
            />
            <SummaryRow
              label={t("settings.tailscaleAccountName")}
              value={status?.accountName ?? t("settings.tailscaleUnavailable")}
            />
            <SummaryRow
              label={t("settings.tailscaleIpAddress")}
              value={resolveIpAddress(status)}
            />
          </div>

          {status?.phase === "needs_login" && status.loginUrl ? (
            <div className="settings-release-notes">
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
            </div>
          ) : null}

          {status?.lastError || panelError ? (
            <p className="settings-release-status">{panelError ?? status?.lastError}</p>
          ) : null}

          <div className="settings-release-actions settings-tailscale-panel-actions">
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
            <button
              className="secondary-button"
              type="button"
              disabled={loading || pendingAction !== null}
              onClick={() => setConfigModalOpen(true)}
            >
              {t("settings.tailscaleConfigure")}
            </button>
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
          </div>
        </div>
      </div>

      <WorkbenchModal
        open={configModalOpen}
        title={t("settings.tailscaleConfigModalTitle")}
        description={t("settings.tailscaleConfigModalDescription")}
        className="settings-tailscale-modal"
        onClose={handleCloseConfigModal}
      >
        <div className="settings-tailscale-modal-body">
          <div className="settings-tailscale-form">
            <label className="settings-tailscale-field">
              <span className="settings-tailscale-field-label">{t("settings.tailscaleControlServer")}</span>
              <input
                aria-label={t("settings.tailscaleControlServer")}
                className="settings-text-input"
                placeholder={t("settings.tailscaleControlServerPlaceholder")}
                value={controlServerUrlDraft}
                onChange={(event) => setControlServerUrlDraft(event.target.value)}
              />
            </label>

            <label className="settings-tailscale-field">
              <span className="settings-tailscale-field-label">{t("settings.tailscaleHostname")}</span>
              <input
                aria-label={t("settings.tailscaleHostname")}
                className="settings-text-input"
                placeholder={t("settings.tailscaleHostnamePlaceholder")}
                value={hostnameDraft}
                onChange={(event) => setHostnameDraft(event.target.value)}
              />
            </label>
          </div>

          <div className="settings-tailscale-modal-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={pendingAction === "save"}
              onClick={handleCloseConfigModal}
            >
              {t("common.cancel")}
            </button>
            <button
              className="settings-button"
              type="button"
              disabled={pendingAction !== null || !configDirty}
              onClick={() => {
                void handleSaveConfig();
              }}
            >
              {pendingAction === "save" ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </div>
      </WorkbenchModal>
    </>
  );
}

function SummaryRow({
  label,
  value,
  href
}: {
  label: string;
  value: ReactNode;
  href?: string;
}) {
  return (
    <section className="settings-model-card settings-tailscale-summary-card">
      <div className="settings-model-card-main settings-tailscale-summary-card-main">
        <div className="settings-model-card-copy">
          <strong className="settings-model-card-title">{label}</strong>
        </div>
        <div className="settings-tailscale-summary-value">
          {href && typeof value === "string" ? (
            <a className="settings-tailscale-link" href={href} target="_blank" rel="noreferrer">
              {value}
            </a>
          ) : (
            value
          )}
        </div>
      </div>
    </section>
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
