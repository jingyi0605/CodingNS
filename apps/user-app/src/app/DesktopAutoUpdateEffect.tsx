import { useEffect } from "react";

import { useClientConfigSelector } from "../config/client-config-store";
import { useDesktopUpdateSelector } from "../platform/desktop/desktop-update-store";
import { createPlatformAdapter } from "../platform/platform-adapter";
import {
  downloadDesktopUpdate,
  refreshDesktopUpdateState
} from "../platform/desktop/release-manager";
import { checkForServiceUpdate } from "../platform/server/service-update-manager";
import { t } from "../shared/i18n";

const DESKTOP_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function DesktopAutoUpdateEffect() {
  const platform = useClientConfigSelector((state) => state.platform);
  const autoCheckUpdate = useClientConfigSelector((state) => state.autoCheckUpdate);
  const autoDownloadUpdate = useClientConfigSelector((state) => state.autoDownloadUpdate);
  const releaseChannel = useClientConfigSelector((state) => state.releaseChannel);
  const pendingRestartVersion = useDesktopUpdateSelector((state) => state.pendingRestartVersion);

  useEffect(() => {
    if (platform !== "desktop" || !autoCheckUpdate || pendingRestartVersion) {
      return;
    }

    async function runAutoCheck() {
      await Promise.all([
        runServiceAutoCheck(),
        runDesktopAutoCheck(autoDownloadUpdate)
      ]);
    }

    void runAutoCheck();

    const timerId = window.setInterval(() => {
      void runAutoCheck();
    }, DESKTOP_UPDATE_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [autoCheckUpdate, autoDownloadUpdate, pendingRestartVersion, platform, releaseChannel]);

  return null;
}

async function runServiceAutoCheck(): Promise<void> {
  try {
    const snapshot = await checkForServiceUpdate();
    const updatePackage = snapshot.packages.find((item) => item.hasUpdate && !item.restartRequired);

    if (!updatePackage) {
      return;
    }

    const adapter = createPlatformAdapter();
    await adapter.bridge.showNotification(
      t("settings.serverUpdateReady"),
      `${t("settings.serverTargetVersion")}: ${updatePackage.latestVersion ?? "-"}`
    );
  } catch {
    // 服务端自动检查失败不影响客户端自动检查，用户仍可在设置页手动检查。
  }
}

async function runDesktopAutoCheck(autoDownloadUpdate: boolean): Promise<void> {
  try {
    const state = await refreshDesktopUpdateState({ notify: autoDownloadUpdate ? "never" : "if-new" });

    if (!autoDownloadUpdate || !state.hasUpdate || !state.manifest) {
      return;
    }

    const result = await downloadDesktopUpdate();
    if (!result.ok) {
      return;
    }

    const adapter = createPlatformAdapter();
    await adapter.bridge.showNotification(
      t("settings.releaseDownloadedNotificationTitle"),
      t("settings.releaseDownloadedNotificationBody", {
        version: result.version ?? state.manifest.version
      })
    );
  } catch {
    // 客户端自动检查失败不影响主流程，用户仍可在设置页手动检查。
  }
}
