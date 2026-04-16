import { useClientConfigSelector } from "../../../config/client-config-store";
import { useDesktopUpdateSelector } from "../../../platform/desktop/desktop-update-store";
import { t } from "../../../shared/i18n";

export function WorkbenchUpdateBadge({
  onOpenSoftwareUpdate
}: {
  onOpenSoftwareUpdate: () => void;
}) {
  const platform = useClientConfigSelector((state) => state.platform);
  const latestState = useDesktopUpdateSelector((state) => state.latestState);

  if (platform !== "desktop" || !latestState?.hasUpdate) {
    return null;
  }

  return (
    <button
      className="workbench-nav-update-badge"
      type="button"
      title={latestState.manifest?.version ?? t("settings.releaseUpdateReady")}
      onClick={onOpenSoftwareUpdate}
    >
      <span className="workbench-nav-update-badge-label">{t("settings.releaseUpdateBadge")}</span>
    </button>
  );
}
