import { useState } from "react";

import type { ServiceUpdateInfo } from "../config/client-config-types";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { checkForServiceUpdate } from "../platform/server/service-update-manager";
import { t } from "../shared/i18n";

export function ServiceUpdatePanel() {
  const platform = createPlatformAdapter();
  const [loading, setLoading] = useState(false);
  const [openingPage, setOpeningPage] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<ServiceUpdateInfo | null>(null);

  async function handleCheckUpdate() {
    setLoading(true);
    setStatusText(null);

    try {
      const result = await checkForServiceUpdate();
      setUpdateInfo(result);
      setStatusText(resolveServiceStatus(result));

      if (result.hasUpdate) {
        await platform.bridge.showNotification(
          t("settings.serverUpdateReady"),
          `${t("settings.serverTargetVersion")}: ${result.latestVersion ?? "-"}`
        );
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.serverCheckFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenPackagePage() {
    if (!updateInfo?.packagePageUrl) {
      return;
    }

    setOpeningPage(true);

    try {
      const result = await platform.bridge.openExternal(updateInfo.packagePageUrl);

      if (!result.ok) {
        setStatusText(result.detail ?? t("settings.serverOpenPageFailed"));
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.serverOpenPageFailed"));
    } finally {
      setOpeningPage(false);
    }
  }

  return (
    <div className="settings-release-card">
      <div className="settings-release-meta">
        <span>{t("settings.serverCurrentVersion")}: {updateInfo?.currentVersion ?? "-"}</span>
        <span>{t("settings.serverTargetVersion")}: {updateInfo?.latestVersion ?? t("settings.serverLatestUnknown")}</span>
        <span>{t("settings.serverPackageName")}: {updateInfo?.packageName ?? "-"}</span>
      </div>
      {updateInfo ? (
        <div className="settings-release-notes">
          <strong>{t("settings.serverUpdateCommand")}</strong>
          <p className="settings-release-command">{updateInfo.updateCommand}</p>
        </div>
      ) : null}
      {statusText ? <p className="settings-release-status">{statusText}</p> : null}
      <div className="settings-release-actions">
        <button className="secondary-button" type="button" disabled={loading} onClick={handleCheckUpdate}>
          {loading ? t("common.loading") : t("settings.serverCheckNow")}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!updateInfo?.packagePageUrl || loading || openingPage}
          onClick={handleOpenPackagePage}
        >
          {openingPage ? t("common.loading") : t("settings.serverOpenPage")}
        </button>
      </div>
    </div>
  );
}

function resolveServiceStatus(updateInfo: ServiceUpdateInfo): string {
  if (!updateInfo.latestVersion) {
    return t("settings.serverLatestUnknown");
  }

  return updateInfo.hasUpdate
    ? t("settings.serverUpdateReady")
    : t("settings.serverUpToDate");
}
