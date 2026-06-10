import { useEffect } from "react";

import { useClientConfigSelector } from "../config/client-config-store";
import { useDesktopUpdateSelector } from "../platform/desktop/desktop-update-store";
import { createPlatformAdapter } from "../platform/platform-adapter";
import {
  downloadDesktopUpdate,
  notifyDesktopUpdate
} from "../platform/desktop/release-manager";
import { checkCombinedUpdates } from "../platform/update/unified-update-manager";
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
      await runCombinedAutoCheck(autoDownloadUpdate);
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

async function runCombinedAutoCheck(autoDownloadUpdate: boolean): Promise<void> {
  try {
    const result = await checkCombinedUpdates({ notify: "never" });
    const servicePackage = result.servicePackage;
    const clientState = result.clientState;
    const serviceHasUpdate = Boolean(servicePackage?.hasUpdate && !servicePackage.restartRequired);
    const clientHasUpdate = Boolean(clientState?.hasUpdate && clientState.manifest);

    if (
      autoDownloadUpdate
      && clientState?.hasUpdate
      && clientState.manifest
    ) {
      const result = await downloadDesktopUpdate();
      if (!result.ok) {
        return;
      }

      const adapter = createPlatformAdapter();
      await adapter.bridge.showNotification(
        t("settings.releaseDownloadedNotificationTitle"),
        t("settings.releaseDownloadedNotificationBody", {
          version: result.version ?? clientState.manifest.version
        })
      );
      return;
    }

    if (serviceHasUpdate && clientHasUpdate) {
      const adapter = createPlatformAdapter();
      await adapter.bridge.showNotification(
        t("settings.softwareUpdate"),
        t("settings.updateBothReady")
      );
      return;
    }

    if (serviceHasUpdate) {
      const adapter = createPlatformAdapter();
      await adapter.bridge.showNotification(
        t("settings.serverUpdateReady"),
        `${t("settings.serverTargetVersion")}: ${servicePackage?.latestVersion ?? "-"}`
      );
      return;
    }

    if (clientHasUpdate && clientState) {
      await notifyDesktopUpdate(clientState, "if-new");
    }
  } catch {
    // 自动检查失败不影响主流程，用户仍可在设置页手动检查。
  }
}
