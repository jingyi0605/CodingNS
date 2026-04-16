import { useEffect } from "react";

import { useClientConfigSelector } from "../config/client-config-store";
import { useDesktopUpdateSelector } from "../platform/desktop/desktop-update-store";
import { refreshDesktopUpdateState } from "../platform/desktop/release-manager";

const DESKTOP_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function DesktopAutoUpdateEffect() {
  const platform = useClientConfigSelector((state) => state.platform);
  const autoCheckUpdate = useClientConfigSelector((state) => state.autoCheckUpdate);
  const releaseChannel = useClientConfigSelector((state) => state.releaseChannel);
  const pendingRestartVersion = useDesktopUpdateSelector((state) => state.pendingRestartVersion);

  useEffect(() => {
    if (platform !== "desktop" || !autoCheckUpdate || pendingRestartVersion) {
      return;
    }

    async function runAutoCheck() {
      try {
        await refreshDesktopUpdateState({ notify: "if-new" });
      } catch {
        // 自动检查失败不打断主流程，用户仍可在设置页手动检查。
      }
    }

    void runAutoCheck();

    const timerId = window.setInterval(() => {
      void runAutoCheck();
    }, DESKTOP_UPDATE_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [autoCheckUpdate, pendingRestartVersion, platform, releaseChannel]);

  return null;
}
