import { useEffect, useRef, useState } from "react";

import type { AndroidApkManifest } from "../config/client-config-types";
import {
  checkForAndroidUpdate,
  installAndroidUpdate
} from "../platform/android/release-manager";
import { t } from "../shared/i18n";

export function AndroidReleasePanel() {
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [checkedVersion, setCheckedVersion] = useState<string | null>(null);
  const [manifest, setManifest] = useState<AndroidApkManifest | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [pendingInstallVersionCode, setPendingInstallVersionCode] = useState<number | null>(null);
  const resumeCheckStartedRef = useRef(false);

  useEffect(() => {
    if (pendingInstallVersionCode === null) {
      resumeCheckStartedRef.current = false;
      return;
    }

    const expectedVersionCode = pendingInstallVersionCode;

    async function resolveInstallerReturn() {
      if (resumeCheckStartedRef.current) {
        return;
      }

      resumeCheckStartedRef.current = true;

      try {
        const state = await checkForAndroidUpdate();
        setManifest(state.manifest);
        setCheckedVersion(state.currentVersion);
        setHasUpdate(state.hasUpdate);

        if (!state.hasUpdate || state.currentVersionCode >= expectedVersionCode) {
          setStatusText(t("settings.androidInstallSucceeded"));
          return;
        }

        setStatusText(t("settings.androidInstallCancelled"));
      } catch (error) {
        setStatusText(error instanceof Error ? error.message : t("settings.releaseCheckFailed"));
      } finally {
        setPendingInstallVersionCode(null);
      }
    }

    function handleWindowFocus() {
      void resolveInstallerReturn();
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        return;
      }

      void resolveInstallerReturn();
    }

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pendingInstallVersionCode]);

  async function handleCheckUpdate() {
    setLoading(true);
    setStatusText(null);
    setPendingInstallVersionCode(null);

    try {
      const state = await checkForAndroidUpdate();
      setManifest(state.manifest);
      setCheckedVersion(state.currentVersion);
      setHasUpdate(state.hasUpdate);
      setStatusText(state.hasUpdate ? t("settings.releaseUpdateReady") : t("settings.releaseUpToDate"));
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releaseCheckFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleInstallUpdate() {
    if (!manifest) {
      return;
    }

    setInstalling(true);
    setStatusText(null);
    setPendingInstallVersionCode(null);

    try {
      const result = await installAndroidUpdate(manifest);

      if (result.status === "installer_started") {
        setStatusText(t("settings.androidInstallerStarted"));
        setPendingInstallVersionCode(manifest.versionCode);
        return;
      }

      if (result.status === "permission_required") {
        setStatusText(result.detail ?? t("settings.androidInstallPermissionRequired"));
        setPendingInstallVersionCode(null);
        return;
      }

      if (result.status === "already_up_to_date") {
        setStatusText(t("settings.releaseUpToDate"));
        setHasUpdate(false);
        setPendingInstallVersionCode(null);
        return;
      }

      setStatusText(result.detail ?? t("settings.releaseInstallFailed"));
      setPendingInstallVersionCode(null);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releaseInstallFailed"));
      setPendingInstallVersionCode(null);
    } finally {
      setInstalling(false);
    }
  }

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
      {statusText ? (
        <p className="settings-update-status" data-tone={hasUpdate ? "warning" : "success"}>
          {statusText}
        </p>
      ) : null}
      <div className="settings-update-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={loading || installing}
          onClick={handleCheckUpdate}
        >
          {loading ? t("common.loading") : t("settings.releaseCheckNow")}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={!manifest || !hasUpdate || installing}
          onClick={handleInstallUpdate}
        >
          {installing ? t("common.loading") : t("settings.releaseInstallNow")}
        </button>
      </div>
    </div>
  );
}
