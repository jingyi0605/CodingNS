import { useState } from "react";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { t } from "../shared/i18n";
import {
  refreshDesktopUpdateState,
  installDesktopUpdate
} from "../platform/desktop/release-manager";
import { useDesktopUpdateSelector } from "../platform/desktop/desktop-update-store";

export function ReleasePanel() {
  const platform = createPlatformAdapter();
  const supportsClientPackageUpdate = platform.isDesktop;
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [openingPage, setOpeningPage] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const latestState = useDesktopUpdateSelector((state) => state.latestState);
  const checkedVersion = latestState?.currentVersion ?? null;
  const manifest = latestState?.manifest ?? null;
  const hasUpdate = latestState?.hasUpdate ?? false;

  async function handleCheckUpdate() {
    setLoading(true);
    setStatusText(null);

    try {
      const state = await refreshDesktopUpdateState({ notify: "always" });
      setStatusText(resolveReleaseStatus(state.manifest, state.hasUpdate));
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releaseCheckFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleInstallUpdate() {
    if (!manifest || !hasUpdate) {
      return;
    }

    setInstalling(true);
    setStatusText(null);

    try {
      const result = await installDesktopUpdate();

      if (!result.ok) {
        setStatusText(result.detail ?? t("settings.releaseInstallFailed"));
        return;
      }

      setStatusText(t("settings.releaseInstallStarted"));
      await platform.bridge.showNotification(
        t("settings.releaseInstallStarted"),
        manifest.version
      );
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releaseInstallFailed"));
    } finally {
      setInstalling(false);
    }
  }

  async function handleOpenReleasePage() {
    if (!manifest?.htmlUrl) {
      return;
    }

    setOpeningPage(true);

    try {
      const result = await platform.bridge.openExternal(manifest.htmlUrl);

      if (!result.ok) {
        setStatusText(result.detail ?? t("settings.releasePageOpenFailed"));
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releasePageOpenFailed"));
    } finally {
      setOpeningPage(false);
    }
  }

  const canInstall = Boolean(supportsClientPackageUpdate && manifest && hasUpdate);
  const effectiveStatusText =
    statusText ??
    (!supportsClientPackageUpdate
      ? t("settings.clientUpdateUnsupported")
      : latestState
        ? resolveReleaseStatus(latestState.manifest, latestState.hasUpdate)
        : null);

  return (
    <div className="settings-update-card">
      <div className="settings-update-summary">
        <div className="settings-update-field">
          <span className="settings-update-label">{t("settings.releaseCurrentVersion")}</span>
          <strong className="settings-update-value">
            {checkedVersion ?? t("settings.releaseUnknownVersion")}
          </strong>
        </div>
        <div className="settings-update-field">
          <span className="settings-update-label">{t("settings.releaseTargetVersion")}</span>
          <strong className="settings-update-value">{manifest?.version ?? "-"}</strong>
        </div>
      </div>
      {effectiveStatusText ? (
        <p
          className="settings-update-status"
          data-tone={resolveReleaseTone(manifest, hasUpdate, effectiveStatusText)}
        >
          {effectiveStatusText}
        </p>
      ) : null}
      <div className="settings-update-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={!supportsClientPackageUpdate || loading || installing}
          onClick={handleCheckUpdate}
        >
          {loading ? t("common.loading") : t("settings.releaseCheckNow")}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={!canInstall || installing}
          onClick={handleInstallUpdate}
        >
          {installing ? t("common.loading") : t("settings.releaseInstallNow")}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!manifest?.htmlUrl || loading || installing || openingPage}
          onClick={handleOpenReleasePage}
        >
          {openingPage ? t("common.loading") : t("settings.releaseOpenPage")}
        </button>
      </div>
    </div>
  );
}

function resolveReleaseStatus(
  manifest: Awaited<ReturnType<typeof refreshDesktopUpdateState>>["manifest"],
  hasUpdate: boolean
): string {
  if (!hasUpdate) {
    return t("settings.releaseUpToDate");
  }

  return t("settings.releaseUpdateReady");
}

function resolveReleaseTone(
  manifest: Awaited<ReturnType<typeof refreshDesktopUpdateState>>["manifest"],
  hasUpdate: boolean,
  statusText: string
): "neutral" | "success" | "warning" | "danger" {
  if (statusText === t("settings.clientUpdateUnsupported")) {
    return "neutral";
  }

  if (!hasUpdate) {
    return "success";
  }

  return "warning";
}
