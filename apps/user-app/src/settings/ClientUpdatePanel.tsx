import { createPlatformAdapter } from "../platform/platform-adapter";
import { t } from "../shared/i18n";
import { AndroidReleasePanel } from "./AndroidReleasePanel";
import { ReleasePanel } from "./ReleasePanel";

export function ClientUpdatePanel() {
  const platform = createPlatformAdapter();

  if (platform.platform === "desktop") {
    return <ReleasePanel />;
  }

  if (platform.platform === "android") {
    return <AndroidReleasePanel />;
  }

  return (
    <div className="settings-update-card">
      <p className="settings-update-status" data-tone="neutral">
        {t("settings.clientUpdateUnsupported")}
      </p>
    </div>
  );
}
