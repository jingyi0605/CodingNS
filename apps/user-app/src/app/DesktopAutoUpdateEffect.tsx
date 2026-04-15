import { useEffect, useRef } from "react";

import { useClientConfigSelector } from "../config/client-config-store";
import { checkForDesktopUpdate } from "../platform/desktop/release-manager";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { t } from "../shared/i18n";

export function DesktopAutoUpdateEffect() {
  const platform = useClientConfigSelector((state) => state.platform);
  const autoCheckUpdate = useClientConfigSelector((state) => state.autoCheckUpdate);
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    if (hasCheckedRef.current) {
      return;
    }

    if (platform !== "desktop" || !autoCheckUpdate) {
      return;
    }

    hasCheckedRef.current = true;

    let cancelled = false;

    async function runAutoCheck() {
      try {
        const state = await checkForDesktopUpdate();

        if (cancelled || !state.hasUpdate) {
          return;
        }

        const adapter = createPlatformAdapter();
        await adapter.bridge.showNotification(
          t("settings.releaseUpdateReady"),
          state.manifest?.version ?? state.currentVersion
        );
      } catch {
        // 启动自动检查失败不打断主流程，用户仍可手动检查。
      }
    }

    void runAutoCheck();

    return () => {
      cancelled = true;
    };
  }, [autoCheckUpdate, platform]);

  return null;
}
