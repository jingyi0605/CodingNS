import { useState } from "react";

import type { ReleaseManifest } from "../config/client-config-types";
import { t } from "../shared/i18n";
import {
  checkForDesktopUpdate,
  installDesktopUpdate,
  rollbackDesktopUpdate
} from "../platform/desktop/release-manager";

export function ReleasePanel({ enabled }: { enabled: boolean }) {
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [checkedVersion, setCheckedVersion] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ReleaseManifest | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);

  async function handleCheckUpdate() {
    setLoading(true);
    setStatusText(null);

    try {
      const state = await checkForDesktopUpdate();
      setManifest(state.manifest);
      setCheckedVersion(state.currentVersion);
      setHasUpdate(state.hasUpdate);
      setStatusText(
        state.hasUpdate
          ? t("settings.releaseUpdateReady")
          : t("settings.releaseUpToDate")
      );
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

    try {
      const result = await installDesktopUpdate(manifest);

      if (!result.ok) {
        setStatusText(result.detail ?? t("settings.releaseInstallFailed"));
        return;
      }

      setStatusText(t("settings.releaseInstallStarted"));
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releaseInstallFailed"));
    } finally {
      setInstalling(false);
    }
  }

  async function handleRollback() {
    setInstalling(true);
    setStatusText(null);

    try {
      const result = await rollbackDesktopUpdate();
      setStatusText(result.ok ? t("settings.releaseRollbackStarted") : (result.detail ?? t("settings.releaseRollbackFailed")));
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releaseRollbackFailed"));
    } finally {
      setInstalling(false);
    }
  }

  if (!enabled) {
    return (
      <div className="settings-release-card">
        <p className="settings-row-description">{t("settings.releaseDesktopOnly")}</p>
      </div>
    );
  }

  return (
    <div className="settings-release-card">
      <div className="settings-release-meta">
        <span>{t("settings.releaseCurrentVersion")}: {checkedVersion ?? t("settings.releaseUnknownVersion")}</span>
        <span>{t("settings.releaseTargetVersion")}: {manifest?.version ?? "-"}</span>
      </div>
      {manifest ? (
        <div className="settings-release-notes">
          <strong>{t("settings.releaseNotes")}</strong>
          <p>{manifest.notes || t("settings.releaseNotesEmpty")}</p>
        </div>
      ) : null}
      {statusText ? <p className="settings-release-status">{statusText}</p> : null}
      <div className="settings-release-actions">
        <button className="secondary-button" type="button" disabled={loading || installing} onClick={handleCheckUpdate}>
          {loading ? t("common.loading") : t("settings.releaseCheckNow")}
        </button>
        <button className="primary-button" type="button" disabled={!manifest || !hasUpdate || installing} onClick={handleInstallUpdate}>
          {installing ? t("common.loading") : t("settings.releaseInstallNow")}
        </button>
        <button className="secondary-button" type="button" disabled={installing} onClick={handleRollback}>
          {t("settings.releaseRollback")}
        </button>
      </div>
    </div>
  );
}
